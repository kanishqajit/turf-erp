import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { proxyApi } from '../cloudflare/api-proxy.mjs';

const env=process.env;
if(!env.TEST_EMAIL||!env.TEST_PASSWORD)throw new Error('Load private staff test credentials before running.');
if(!env.TEST_CUSTOMER_EMAIL||!env.TEST_CUSTOMER_PASSWORD)throw new Error('This customer booking test requires TEST_CUSTOMER_EMAIL and TEST_CUSTOMER_PASSWORD for an existing verified test account. No bookings have been created.');
const origin=env.TEST_PUBLIC_ORIGIN||'https://futly-prototype.pages.dev';
const results=[];
const client=()=>({cookie:'',csrf:''});
const staff=client(),guest=client(),stranger=client();
async function call(session,path,method='GET',body,expected=200){
  const headers={Origin:origin};
  if(!env.TEST_PUBLIC_ORIGIN)headers['CF-Connecting-IP']='192.0.2.43';
  if(session.cookie)headers.Cookie=session.cookie;
  if(session.csrf)headers['X-CSRF-Token']=session.csrf;
  if(body!==undefined)headers['Content-Type']='application/json';
  const request=new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const response=env.TEST_PUBLIC_ORIGIN?await fetch(request):await proxyApi(request,env);
  const payload=await response.json();
  assert.equal(response.status,expected,path+': '+JSON.stringify(payload));
  const cookies=response.headers.getSetCookie();
  const jar=new Map(session.cookie.split('; ').filter(Boolean).map(value=>{const at=value.indexOf('=');return [value.slice(0,at),value.slice(at+1)];}));
  for(const value of cookies){const pair=value.split(';')[0],at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}
  session.cookie=[...jar].map(([name,value])=>name+'='+value).join('; ');
  if(payload.csrfToken)session.csrf=payload.csrfToken;
  return payload;
}
function passed(name){results.push(name);console.log('PASS '+name);}
assert.equal((await call(guest,'/api/health')).persistence,'supabase');passed('API health uses Supabase');
const unauth=await fetch(env.TURF_SUPABASE_URL+'/functions/v1/futly-api/api/health');assert.equal(unauth.status,401);passed('Direct requests without proxy token denied');
await call(guest,'/api/public/session');await call(stranger,'/api/public/session');
await call(guest,'/api/public/auth/login','POST',{email:env.TEST_CUSTOMER_EMAIL,password:env.TEST_CUSTOMER_PASSWORD});
assert.ok((await call(guest,'/api/public/session')).user?.id,'Customer must be signed in before the booking journey.');passed('Verified customer signs in');
const login=await call(staff,'/api/auth/login','POST',{email:env.TEST_EMAIL,password:env.TEST_PASSWORD});
assert.equal(login.user.role,'operator');passed('Original operator credentials preserved');
await call(guest,'/api/state', 'GET',undefined,401);
await call(staff,'/api/users','POST',{email:'must-not-create@example.test',name:'Blocked',password:'NoAccountCreated2026!',role:'owner'},403);passed('Guest and operator permissions enforced');
const {venues}=await call(guest,'/api/public/venues');const slug=venues[0].slug;
const date=new Date(Date.now()+7*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const availability=await call(guest,`/api/public/venues/${slug}/availability?date=${date}`);
let slot;
for(let pitch=0;pitch<3&&!slot;pitch++)for(let start=360;start<=1380&&!slot;start+=30){if(!availability.unavailable.some(v=>v.resourceId===pitch&&v.start<start+60&&v.end>start))slot={date,pitch,start,end:start+60};}
assert.ok(slot,'A free synthetic-test slot is required.');
const input={...slot,team:'Edge Verification FC',contact:'9000000001',idempotencyKey:randomUUID()};
const hold=await call(guest,`/api/public/venues/${slug}/holds`,'POST',input,201);
await call(stranger,`/api/public/venues/${slug}/holds`,'POST',{...input,idempotencyKey:randomUUID()},401);
await call(staff,'/api/holds','POST',input,409);passed('Anonymous reservation denied and competing staff hold rejected');
const confirmed=await call(guest,`/api/public/venues/${slug}/holds/${hold.hold.id}/confirm`,'POST',{});
const booking=confirmed.booking;
const duplicate=await call(guest,`/api/public/venues/${slug}/holds/${hold.hold.id}/confirm`,'POST',{});assert.equal(duplicate.booking.id,booking.id);passed('Confirmation retries stay idempotent');
assert.equal((await call(stranger,'/api/public/bookings')).bookings.some(b=>b.id===booking.id),false);passed('Customer histories isolated');
const state=await call(staff,`/api/state?from=${date}&to=${date}`);assert.ok(state.bookings.some(b=>b.id===booking.id));passed('Customer booking visible to staff');
// Cancel the synthetic unpaid booking, leaving existing bookings and receipts untouched.
await call(guest,`/api/public/bookings/${booking.id}/cancel`,'POST',{});
const reopened=await call(stranger,`/api/public/venues/${slug}/availability?date=${date}`);
assert.equal(reopened.unavailable.some(v=>v.resourceId===slot.pitch&&v.start<slot.end&&v.end>slot.start),false);passed('Cancellation reopens availability');
await call(guest,'/api/public/auth/logout','POST',{});
assert.equal((await call(guest,'/api/public/bookings')).bookings.length,0);passed('Customer logout hides private history');
await call(staff,'/api/auth/logout','POST',{});
await call(staff,'/api/auth/me','GET',undefined,401);passed('Logout revokes staff session');
console.log(JSON.stringify({passed:results.length,bookingId:booking.id,syntheticBookingCancelled:true}));
