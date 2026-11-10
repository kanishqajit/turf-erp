import { Buffer } from 'node:buffer';
import { cloudPersistence } from './cloud-ledger.mjs';
import { ProductError } from './store.mjs';
import { createApi } from './api-core.mjs';
import { readPublicVenues } from './public-venues.mjs';
import { readApiSnapshot, snapshotScope } from './api-snapshot.mjs';

export async function handleApiRequest(request,environment,fetcher=fetch,release='local'){
  const started=performance.now();let persistence,snapshotMs=0;
  const reply=(status,code,message)=>Response.json({error:{code,message}},{status,headers:{'Cache-Control':'no-store','X-Futly-Commit':release}});
  const token=request.headers.get('x-futly-server-token')||'';
  if(!/^[A-Za-z0-9_-]{40,150}$/.test(token))return reply(401,'proxy_required','Trusted frontend required.');
  const origin=request.headers.get('x-futly-public-origin')||'';
  let publicUrl;
  try{publicUrl=new URL(origin);if(publicUrl.protocol!=='https:'||publicUrl.origin!==origin)throw new Error();}
  catch{return reply(400,'invalid_origin','Public origin is invalid.');}
  const incoming=new URL(request.url),path=incoming.pathname.replace(/^\/futly-api(?=\/)/,'');
  if(!path.startsWith('/api/'))return reply(404,'not_found','API route not found.');
  if(request.method==='GET'&&path==='/api/public/venues'){
    const response=await readPublicVenues(token,environment,fetcher);response.headers.set('X-Futly-Commit',release);return response;
  }
  const headers=Object.fromEntries(request.headers);
  headers.host=publicUrl.host;headers['x-forwarded-proto']='https';
  headers['x-forwarded-for']=request.headers.get('x-futly-client-ip')||'unknown';
  const url=new URL(path+incoming.search,origin);
  const req={url:url.pathname+url.search,method:request.method,headers,socket:{remoteAddress:headers['x-forwarded-for']},
    async *[Symbol.asyncIterator](){
      if(request.body){const reader=request.body.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;yield Buffer.from(value);}}finally{reader.releaseLock();}}
    },
  };
  const env={NODE_ENV:'production',TRUST_PROXY:'1',TURF_TIME_ZONE:'Asia/Kolkata',SUPABASE_URL:environment.get('SUPABASE_URL'),SUPABASE_ANON_KEY:environment.get('SUPABASE_ANON_KEY')};
  try{
    if(!['GET','HEAD'].includes(request.method))await createApi({store:{},customer:{}},env).readJson(req);
    const scope=snapshotScope(url,request.method,req.parsedBody,headers.cookie,headers['x-forwarded-for']);
    const read=async(initial=false)=>{
      // Durable limits are charged once, even when a revision conflict reruns
      // domain checks. Authentication and snapshot selection remain in one RPC.
      const at=performance.now();
      const response=await readApiSnapshot(token,initial?scope:{...scope,rate:[]},environment,fetcher);
      const data=await response.json();
      snapshotMs+=performance.now()-at;
      if(!response.ok)throw new ProductError(data.code==='42501'?401:503,'backend_unavailable',data.code==='42501'?'Trusted frontend required.':'Shared ledger unavailable.');
      if(data.rateLimited)throw new ProductError(429,'rate_limited','Too many requests. Try again shortly.');
      if(data.schemaVersion!==1)throw new ProductError(503,'backend_unavailable','Shared ledger unavailable.');
      return data;
    };
    let first=await read(true);
    const timed=response=>{
      const spans={snapshot:snapshotMs,...persistence?.timings,total:performance.now()-started};
      response.headers.set('Server-Timing',Object.entries(spans).map(([key,value])=>`${key};dur=${Number(value).toFixed(1)}`).join(', '));
      response.headers.set('X-Futly-Commit',release);return response;
    };
    if(request.method==='GET'&&path==='/api/public/events')return timed(new Response(null,{status:204,headers:{'Cache-Control':'no-store'}}));
    if(request.method==='GET'&&path==='/api/health')return timed(Response.json({ok:true,persistence:'supabase',time:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}}));
    const transport={
      read:async()=>{if(first){const result=first;first=null;return result;}return read();},
      commit:async(expectedRevision,operationId,changes)=>{
        for(let attempt=0;attempt<2;attempt++){
          try{
            const secret=environment.get('SUPABASE_SERVICE_ROLE_KEY');
            const response=await fetcher(environment.get('SUPABASE_URL')+'/rest/v1/rpc/futly_ledger_commit',{
              method:'POST',headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'},
              body:JSON.stringify({p_token:token,p_revision:expectedRevision,p_operation_id:operationId,p_changes:changes}),signal:AbortSignal.timeout(15000),
            });
            if(response.ok)return response.json();
          }catch(error){if(attempt===1)throw new ProductError(503,'cloud_unavailable','Change could not be confirmed. Retry shortly.');}
        }
        throw new ProductError(503,'cloud_unavailable','Change could not be confirmed. Retry shortly.');
      },
    };
    persistence=cloudPersistence(transport,env);
    const {api}=createApi(persistence,env);
    const output=await persistence.run(async()=>{
      let status=200,body=null;const responseHeaders=new Headers();
      const res={setHeader:(key,value)=>{responseHeaders.delete(key);for(const item of [value].flat())responseHeaders.append(key,item);},
        writeHead:(code,extra={})=>{status=code;for(const [key,value]of Object.entries(extra))responseHeaders.set(key,String(value));},end:value=>{body=value;}};
      await api(req,res,url);return {status,body,headers:responseHeaders};
    });
    output.headers.delete('Content-Length');
    return timed(new Response(request.method==='HEAD'?null:output.body,{status:output.status,headers:output.headers}));
  }catch(error){
    const status=error instanceof ProductError?error.status:500;
    if(status===500)console.error('Application API error',error);
    return reply(status,error instanceof ProductError?error.code:'internal_error',status===500?'Internal server error.':error.message);
  }finally{persistence?.close();}
}
