const json=(status,code,message)=>Response.json({error:{code,message}},{status,headers:{'Cache-Control':'no-store'}});

export async function proxyApi(request,env,fetcher=fetch){
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/'))return json(404,'not_found','API route not found.');
  if(!['GET','HEAD','POST'].includes(request.method))return json(405,'method_not_allowed','Method not allowed.');
  if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json(403,'invalid_origin','Cross-origin requests are not allowed.');
  if(!env.TURF_SUPABASE_URL||!env.TURF_SUPABASE_SERVER_TOKEN)return json(503,'backend_unconfigured','Shared service is not configured.');
  let target;
  try{
    target=new URL(env.TURF_SUPABASE_URL);
    if(target.protocol!=='https:'||!target.hostname.endsWith('.supabase.co')||target.pathname!=='/'||target.username||target.password)throw new Error();
    target.pathname='/functions/v1/futly-api'+url.pathname;target.search=url.search;
  }catch{return json(503,'backend_unconfigured','Shared service is not configured.');}
  const headers=new Headers();
  for(const name of ['cookie','content-type','x-csrf-token','origin']){
    const value=request.headers.get(name);if(value)headers.set(name,value);
  }
  // Never trust browser-provided proxy credentials or forwarded identity.
  headers.set('X-Futly-Server-Token',env.TURF_SUPABASE_SERVER_TOKEN);
  headers.set('X-Futly-Public-Origin',url.origin);
  headers.set('X-Futly-Client-IP',request.headers.get('CF-Connecting-IP')||'unknown');
  let body;
  if(request.method==='POST'){
    const declared=Number(request.headers.get('content-length')||0);
    if(declared>65536)return json(413,'body_too_large','Request body is too large.');
    const chunks=[];let length=0;
    if(request.body){
      const reader=request.body.getReader();
      try{
        while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>65536){await reader.cancel();return json(413,'body_too_large','Request body is too large.');}chunks.push(value);}
      }finally{reader.releaseLock();}
    }
    body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
  }
  try{
    const response=await fetcher(target,{method:request.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(25000)});
    if(response.status>=300&&response.status<400)return json(502,'backend_redirect','Shared service returned an unexpected redirect.');
    const outgoing=new Headers(response.headers);
    outgoing.delete('Access-Control-Allow-Origin');outgoing.delete('Access-Control-Allow-Credentials');
    outgoing.set('Cache-Control','no-store');outgoing.set('X-Content-Type-Options','nosniff');
    return new Response(response.body,{status:response.status,headers:outgoing});
  }catch{return json(503,'backend_unavailable','Shared service unavailable. Retry shortly.');}
}
