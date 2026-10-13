import {test} from 'node:test';
import assert from 'node:assert/strict';
import {proxyApi} from '../cloudflare/api-proxy.mjs';
const env={TURF_SUPABASE_URL:'https://example.supabase.co',TURF_SUPABASE_SERVER_TOKEN:'private-server-secret'};

test('proxy rejects a cross-origin mutation without contacting the backend',async()=>{
  const response=await proxyApi(new Request('https://futly.pages.dev/api/bookings',{method:'POST',headers:{Origin:'https://attacker.test'}}),env,()=>{throw new Error('must not call');});
  assert.equal(response.status,403);
});
test('proxy replaces spoofed identity and keeps guest cookies and CSRF on one origin',async()=>{
  const request=new Request('https://futly.pages.dev/api/public/bookings',{method:'POST',headers:{Origin:'https://futly.pages.dev','Content-Type':'application/json',Cookie:'futly_customer=guest','X-CSRF-Token':'csrf','X-Futly-Server-Token':'attacker','X-Futly-Public-Origin':'https://attacker.test','X-Forwarded-For':'attacker','CF-Connecting-IP':'192.0.2.1'},body:'{}'});
  const response=await proxyApi(request,env,async(url,options)=>{
    assert.equal(url.href,'https://example.supabase.co/functions/v1/futly-api/api/public/bookings');
    assert.equal(options.headers.get('x-futly-server-token'),env.TURF_SUPABASE_SERVER_TOKEN);
    assert.equal(options.headers.get('x-futly-public-origin'),'https://futly.pages.dev');
    assert.equal(options.headers.get('x-futly-client-ip'),'192.0.2.1');
    assert.equal(options.headers.get('cookie'),'futly_customer=guest');
    assert.equal(options.headers.get('x-csrf-token'),'csrf');
    assert.equal(options.headers.get('x-forwarded-for'),null);
    return new Response('{}',{headers:{'Set-Cookie':'futly_customer=new; HttpOnly; Secure; SameSite=Strict','Access-Control-Allow-Origin':'*'}});
  });
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.match(response.headers.get('set-cookie'),/HttpOnly/);
  assert.equal(response.headers.get('cache-control'),'no-store');
});
test('proxy caps streamed bodies and fails closed on upstream errors',async()=>{
  const large=new Request('https://futly.pages.dev/api/bookings',{method:'POST',body:'x'.repeat(65537)});
  assert.equal((await proxyApi(large,env,()=>{throw new Error('must not call');})).status,413);
  const request=new Request('https://futly.pages.dev/api/health');
  assert.equal((await proxyApi(request,env,async()=>{throw new Error('network');})).status,503);
  assert.equal((await proxyApi(request,env,async()=>new Response(null,{status:302,headers:{Location:'https://attacker.test'}}))).status,502);
});
