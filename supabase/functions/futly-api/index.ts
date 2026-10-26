import { Buffer } from 'node:buffer';
import { cloudPersistence } from './runtime/cloud-ledger.mjs';
import { ProductError } from './runtime/store.mjs';
import { createApi } from './runtime/api-core.mjs';
import { handleRequest as ledgerRequest } from '../futly-ledger/handler.mjs';
import { readPublicVenues } from './runtime/public-venues.mjs';
import { RELEASE } from './runtime/release.mjs';

Deno.serve(async request=>{
  const reply=(status:number,code:string,message:string)=>Response.json({error:{code,message}},{status,headers:{'Cache-Control':'no-store'}});
  const token=request.headers.get('x-futly-server-token')||'';
  if(!/^[A-Za-z0-9_-]{40,150}$/.test(token))return reply(401,'proxy_required','Trusted frontend required.');
  const origin=request.headers.get('x-futly-public-origin')||'';
  let publicUrl:URL;
  try{publicUrl=new URL(origin);if(publicUrl.protocol!=='https:'||publicUrl.origin!==origin)throw new Error();}
  catch{return reply(400,'invalid_origin','Public origin is invalid.');}
  const path=new URL(request.url).pathname.replace(/^\/futly-api(?=\/)/,'');
  if(!path.startsWith('/api/'))return reply(404,'not_found','API route not found.');
  if(request.method==='GET'&&path==='/api/public/venues'){
    const response=await readPublicVenues(token,Deno.env);response.headers.set('X-Futly-Commit',RELEASE);return response;
  }
  const rpc=async(action:string,payload={})=>ledgerRequest(new Request('https://internal/ledger',{
    method:'POST',headers:{'Content-Type':'application/json','X-Futly-Server-Token':token},body:JSON.stringify({action,...payload}),
  }),Deno.env);
  // Authenticate the frontend against the private ledger before creating a
  // workspace. Failed credentials never gain access to the application API.
  const initial=await rpc('read');
  if(!initial.ok)return reply(initial.status,'backend_unavailable',initial.status===401?'Trusted frontend required.':'Shared ledger unavailable.');
  let first=await initial.json();
  const transport={
    read:async()=>{
      if(first){const result=first;first=null;return result;}
      const response=await rpc('read');if(!response.ok)throw new ProductError(503,'cloud_unavailable','Shared ledger unavailable.');return response.json();
    },
    commit:async(expectedRevision:number,operationId:string,changes:unknown)=>{
      for(let attempt=0;attempt<2;attempt++){
        const response=await rpc('commit',{expectedRevision,operationId,changes});
        if(response.ok)return response.json();
      }
      throw new ProductError(503,'cloud_unavailable','Change could not be confirmed. Retry shortly.');
    },
  };
  // Cloud instances do not share an in-memory connection list. Clients use
  // their existing periodic refresh until a durable event channel is added.
  if(path==='/api/public/events')return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
  const env={NODE_ENV:'production',TRUST_PROXY:'1',TURF_TIME_ZONE:'Asia/Kolkata',SUPABASE_URL:Deno.env.get('SUPABASE_URL'),SUPABASE_ANON_KEY:Deno.env.get('SUPABASE_ANON_KEY')};
  const persistence=cloudPersistence(transport,env);
  const {api,readJson}=createApi(persistence,env);
  const headers=Object.fromEntries(request.headers);
  headers.host=publicUrl.host;
  headers['x-forwarded-proto']='https';
  headers['x-forwarded-for']=request.headers.get('x-futly-client-ip')||'unknown';
  const url=new URL(path+new URL(request.url).search,origin);
  const req={url:url.pathname+url.search,method:request.method,headers,socket:{remoteAddress:headers['x-forwarded-for']},
    async *[Symbol.asyncIterator](){
      if(request.body){const reader=request.body.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;yield Buffer.from(value);}}finally{reader.releaseLock();}}
    },
  };
  try{
    if(!['GET','HEAD'].includes(request.method))await readJson(req);
    // Database counters survive cold starts and are shared by all instances.
    const checkRate=async(key:string,limit:number,seconds:number)=>{
      const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
      const response=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/futly_api_rate_limit',{
        method:'POST',headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'},
        body:JSON.stringify({p_token:token,p_key:key,p_limit:limit,p_seconds:seconds}),signal:AbortSignal.timeout(10000),
      });
      if(!response.ok)throw new ProductError(503,'rate_limit_unavailable','Shared service unavailable.');
      if(!await response.json())throw new ProductError(429,'rate_limited','Too many requests. Try again shortly.');
    };
    const ip=headers['x-forwarded-for'];
    if(path==='/api/auth/login'||/^\/api\/public\/auth\/(login|signup|recover|exchange|password)$/.test(path)){
      await checkRate('login-ip:'+ip,30,900);
      if(req.parsedBody?.email)await checkRate('login-account:'+String(req.parsedBody.email).trim().toLowerCase(),10,900);
    }else if(!['GET','HEAD'].includes(request.method))await checkRate('mutation-ip:'+ip,120,60);
    else if(path==='/api/public/session')await checkRate('guest-ip:'+ip,60,60);
    const output=await persistence.run(async()=>{
      let status=200,body:BodyInit|null=null;
      const responseHeaders=new Headers();
      const res={setHeader:(key:string,value:string|string[])=>{responseHeaders.delete(key);for(const item of [value].flat())responseHeaders.append(key,item);},
        writeHead:(code:number,extra={})=>{status=code;for(const [key,value]of Object.entries(extra))responseHeaders.set(key,String(value));},
        end:(value:BodyInit|null)=>{body=value;}};
      await api(req,res,url);
      return {status,body,headers:responseHeaders};
    });
    output.headers.delete('Content-Length');
    output.headers.set('X-Futly-Commit',RELEASE);
    return new Response(request.method==='HEAD'?null:output.body,{status:output.status,headers:output.headers});
  }catch(error){
    const status=error instanceof ProductError?error.status:500;
    if(status===500)console.error('Application API error',error);
    return reply(status,error instanceof ProductError?error.code:'internal_error',status===500?'Internal server error.':error.message);
  }finally{persistence.close();}
});
