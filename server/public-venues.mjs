import { publicVenue } from './venue.mjs';

// One authenticated, scoped database read; no ERP snapshot or SQLite workspace.
export async function readPublicVenues(token, env, fetcher=fetch){
  const secret=env.get('SUPABASE_SERVICE_ROLE_KEY');
  const url=env.get('SUPABASE_URL');
  if(!secret||!url)return Response.json({error:{code:'backend_unavailable',message:'Shared service unavailable.'}},{status:503});
  try{
    const response=await fetcher(url+'/rest/v1/rpc/futly_public_venue_settings',{
      method:'POST',headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'},
      body:JSON.stringify({p_token:token}),signal:AbortSignal.timeout(10000),
    });
    const data=await response.json();
    if(!response.ok){
      const status=data.code==='42501'?401:503;
      return Response.json({error:{code:'backend_unavailable',message:status===401?'Trusted frontend required.':'Shared service unavailable.'}},{status});
    }
    if(!Number.isInteger(data.depositAmount)||data.depositAmount<0)throw new Error('Invalid venue settings');
    return Response.json({venues:[publicVenue(data.depositAmount,{TURF_TIME_ZONE:'Asia/Kolkata'})]},
      {headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch{
    return Response.json({error:{code:'backend_unavailable',message:'Shared service unavailable. Retry shortly.'}},{status:503});
  }
}
