import { readPublicVenues } from '../futly-api/runtime/public-venues.mjs';
import { RELEASE } from '../futly-api/runtime/release.mjs';

// Separate entrypoint keeps the SQLite engine out of venue-list cold starts.
Deno.serve(async request=>{
  const token=request.headers.get('x-futly-server-token')||'';
  if(!/^[A-Za-z0-9_-]{40,150}$/.test(token))return Response.json({error:{code:'proxy_required',message:'Trusted frontend required.'}},{status:401});
  const origin=request.headers.get('x-futly-public-origin')||'';
  try{const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin)throw new Error();}
  catch{return Response.json({error:{code:'invalid_origin',message:'Public origin is invalid.'}},{status:400});}
  const path=new URL(request.url).pathname.replace(/^\/futly-venues(?=\/)/,'');
  if(request.method!=='GET'||path!=='/api/public/venues')return new Response(null,{status:404});
  const response=await readPublicVenues(token,Deno.env);
  response.headers.set('X-Futly-Commit',RELEASE);
  return response;
});
