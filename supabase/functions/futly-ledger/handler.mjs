// Server-to-server bridge. The private database authenticates the high-entropy
// integration token before reading any ledger row. No CORS or browser access.
export async function handleRequest(req,env,fetcher=fetch){
  const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if(req.method!=='POST')return reply(405,{error:'Method not allowed'});
  const token=req.headers.get('x-futly-server-token')||'';
  if(!/^[A-Za-z0-9_-]{40,150}$/.test(token))return reply(401,{error:'Server authentication required'});
  let body;
  try{const text=await req.text();if(text.length>10000000)return reply(413,{error:'Request too large'});body=JSON.parse(text);}catch{return reply(400,{error:'Invalid JSON'});}
  if(!body||!['read','commit'].includes(body.action))return reply(400,{error:'Invalid action'});
  const secret=env.get('SUPABASE_SERVICE_ROLE_KEY'),url=env.get('SUPABASE_URL');
  if(!secret||!url)return reply(503,{error:'Ledger is not configured'});
  const payload=body.action==='read'?{p_token:token}:{p_token:token,p_revision:body.expectedRevision,p_operation_id:body.operationId,p_changes:body.changes};
  try{
    const response=await fetcher(url+'/rest/v1/rpc/futly_ledger_'+body.action,{method:'POST',headers:{apikey:secret,
      Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(!response.ok)return reply(data.code==='42501'?401:503,{error:data.code==='42501'?'Server authentication required':'Ledger operation failed'});
    return reply(200,data);
  }catch{return reply(503,{error:'Ledger unavailable'});}
}
