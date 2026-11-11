import { createHash } from 'node:crypto';
import { ProductError } from './store.mjs';

const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value))?value:null;
export function snapshotScope(url,method,body={},cookie='',ip='unknown'){
  const path=url.pathname,query=url.searchParams;
  let kind=path.startsWith('/api/public/')?'customer':'staff';
  if(path==='/api/health'||path==='/api/public/events')kind='empty';
  else if(path.startsWith('/api/auth/')||path==='/api/users'||path.startsWith('/api/users/')||path==='/api/settings')kind='auth';
  else if(path==='/api/audit')kind='audit';
  else if(method==='GET'&&/^\/api\/public\/venues\/[^/]+\/availability$/.test(path))kind='availability';
  if(method==='POST'&&query.get('refresh')==='desktop'&&!path.startsWith('/api/auth/')&&!path.startsWith('/api/public/'))kind='staff';
  const include=new Set((query.get('include')||'').split(','));
  const match=path.match(/^\/api\/(bookings|holds|blocks)\/([^/]+)/);
  const session=cookie.split(';').map(s=>s.trim()).filter(s=>s.startsWith('turf_session=')).at(-1);
  let sessionToken='';try{sessionToken=decodeURIComponent(session?.slice('turf_session='.length)||'');}catch{}
  const rate=[];
  if(path==='/api/auth/login'||/^\/api\/public\/auth\/(login|signup|recover|exchange|password|google)$/.test(path)){
    rate.push({key:'login-ip:'+ip,limit:30,seconds:900});
    if(body.email)rate.push({key:'login-account:'+String(body.email).trim().toLowerCase(),limit:10,seconds:900});
  }else if(!['GET','HEAD'].includes(method))rate.push({key:'mutation-ip:'+ip,limit:120,seconds:60});
  else if(path==='/api/public/session')rate.push({key:'guest-ip:'+ip,limit:60,seconds:60});
  return {kind,method,path,refresh:query.get('refresh')==='desktop',fullSessions:path.startsWith('/api/users')||path==='/api/auth/change-password',from:date(query.get('from')),to:date(query.get('to')),
    today:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}),
    date:date(query.get('date')),dates:[...new Set([body.date,...(Array.isArray(body.bookings)?body.bookings.slice(0,31).map(b=>b?.date):[])].map(value=>date(String(value??'').trim().slice(0,10))).filter(Boolean))],
    paymentKey:(path.endsWith('/payments/split')?String(body.idempotencyKey||'').trim().slice(0,70)+'-cash':String(body.idempotencyKey||'').trim()).slice(0,100),targetTable:match?.[1]||null,targetId:match?.[2]||null,
    accountsFrom:date(query.get(path==='/api/accounts'?'from':'accountsFrom')),
    accountsTo:date(query.get(path==='/api/accounts'?'to':'accountsTo')),
    accounts:path==='/api/accounts'||include.has('accounts'),
    auditLimit:kind==='audit'?Math.max(1,Math.min(500,Number(query.get('limit'))||100)):(include.has('audit')?200:0),
    sessionHash:sessionToken?createHash('sha256').update(sessionToken).digest('hex'):null,rate};
}

export async function readApiSnapshot(token,scope,env,fetcher=fetch){
  const secret=env.get('SUPABASE_SERVICE_ROLE_KEY'),url=env.get('SUPABASE_URL');
  try{return await fetcher(url+'/rest/v1/rpc/futly_api_snapshot',{
    method:'POST',headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'},
    body:JSON.stringify({p_token:token,p_scope:scope}),signal:AbortSignal.timeout(15000),
  });}catch{throw new ProductError(503,'backend_unavailable','Shared service unavailable. Retry shortly.');}
}
