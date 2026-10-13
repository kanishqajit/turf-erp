import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { proxyApi } from '../cloudflare/api-proxy.mjs';

const env=process.env;
if(!env.TEST_EMAIL||!env.TEST_PASSWORD)throw new Error('Load private staff test credentials before running.');
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
  const cookie=cookies.find(value=>/^(turf_session|futly_customer)=/.test(value));
  if(cookie)session.cookie=cookie.split(';')[0];
  if(payload.csrfToken)session.csrf=payload.csrfToken;
  return payload;
}
function passed(name){results.push(name);console.log('PASS '+name);}
assert.equal((await call(guest,'/api/health')).persistence,'supabase');passed('API health uses Supabase');
const unauth=await fetch(env.TURF_SUPABASE_URL+'/functions/v1/futly-api/api/health');assert.equal(unauth.status,401);passed('Direct requests without proxy token denied');
await call(guest,'/api/public/session');await call(stranger,'/api/public/session');
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
await call(stranger,`/api/public/venues/${slug}/holds`,'POST',{...input,idempotencyKey:randomUUID()},409);passed('Competing customer reservation rejected');
const confirmed=await call(guest,`/api/public/venues/${slug}/holds/${hold.hold.id}/confirm`,'POST',{});
const booking=confirmed.booking;
const duplicate=await call(guest,`/api/public/venues/${slug}/holds/${hold.hold.id}/confirm`,'POST',{});assert.equal(duplicate.booking.id,booking.id);passed('Confirmation retries stay idempotent');
assert.equal((await call(stranger,'/api/public/bookings')).bookings.some(b=>b.id===booking.id),false);passed('Customer histories isolated');
const state=await call(staff,`/api/state?from=${date}&to=${date}`);assert.ok(state.bookings.some(b=>b.id===booking.id));passed('Customer booking visible to staff');
// Cancel the synthetic unpaid booking, leaving existing bookings and receipts untouched.
await call(guest,`/api/public/bookings/${booking.id}/cancel`,'POST',{});
const reopened=await call(stranger,`/api/public/venues/${slug}/availability?date=${date}`);
assert.equal(reopened.unavailable.some(v=>v.resourceId===slot.pitch&&v.start<slot.end&&v.end>slot.start),false);passed('Cancellation reopens availability');
await call(staff,'/api/auth/logout','POST',{});
await call(staff,'/api/auth/me','GET',undefined,401);passed('Logout revokes staff session');
console.log(JSON.stringify({passed:results.length,bookingId:booking.id,syntheticBookingCancelled:true}));
