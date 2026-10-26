import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {publicVenue} from '../server/venue.mjs';

const source=readFileSync(new URL('../customer/app.js',import.meta.url),'utf8')
  .replace(/render\(\);\nstartupVenues=loadVenues\(\);\s*$/, '');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function app(fetch){
  const saved=new Map();
  const context=vm.createContext({location:{origin:'https://futly.test'},fetch,Intl,Date,console,URLSearchParams,
    sessionStorage:{setItem:(k,v)=>saved.set(k,v),getItem:k=>saved.get(k)||null,removeItem:k=>saved.delete(k)},
    document:{addEventListener(){},hidden:false},setInterval(){},EventSource:class{addEventListener(){}},
  });
  vm.runInContext(source+'\nrender=()=>{};globalThis.app={S,TURFS,loadVenues,loadAvailability,loadBookings,api,screenBookings,screenProfile,saveGoogleDraft,restoreGoogleDraft,saved:sessionStorage};',context);
  return context.app;
}
const venue=publicVenue(500);
const availability={resources:venue.resources,unavailable:[],settings:venue.settings};

test('venues appear while session, availability and history are still pending',async()=>{
  const session=deferred(),times=deferred(),history=deferred();const calls=[];
  const a=app(async url=>{
    calls.push(new URL(url).pathname);
    if(url.endsWith('/session'))return session.promise;
    if(url.endsWith('/venues'))return Response.json({venues:[venue]});
    if(url.includes('/availability'))return times.promise;
    if(url.endsWith('/bookings'))return history.promise;
    throw new Error('Unexpected request');
  });
  const loading=a.loadVenues();await tick();
  assert.equal(a.S.loadingVenues,false);assert.equal(a.TURFS[0].name,venue.name);
  assert.equal(a.S.loadingBookings,true);assert.match(a.screenBookings(),/Loading your bookings/);
  assert.equal(calls.includes('/api/public/bookings'),false);
  const same=a.loadAvailability(venue.slug,0);await tick();
  assert.equal(calls.filter(p=>p.includes('/availability')).length,1);
  times.resolve(Response.json(availability));await Promise.all([loading,same]);
  session.resolve(Response.json({csrfToken:'csrf'}));await tick();
  assert.equal(calls.filter(p=>p.endsWith('/bookings')).length,1);
  history.resolve(Response.json({bookings:[]}));await tick();
  assert.equal(a.S.loadingBookings,false);assert.equal(a.S.bookingsError,'');
});

test('failed guest session leaves browsing usable and mutations retry session before sending CSRF',async()=>{
  let sessions=0,mutations=0;
  const a=app(async(url,options)=>{
    if(url.endsWith('/session')){sessions++;return sessions===1?Response.json({error:{message:'Session offline'}},{status:503}):Response.json({csrfToken:'restored'});}
    if(url.endsWith('/venues'))return Response.json({venues:[venue]});
    if(url.includes('/availability'))return Response.json(availability);
    if(options.method==='POST'){mutations++;assert.equal(options.headers['X-CSRF-Token'],'restored');return Response.json({ok:true});}
    throw new Error('Unexpected request');
  });
  await a.loadVenues();await tick();
  assert.equal(a.S.loadingVenues,false);assert.equal(a.S.apiError,'');
  assert.equal(a.S.bookingsError,'Session offline');
  assert.doesNotMatch(a.screenBookings(),/No bookings yet/);
  await a.api('/api/public/venues/futly-demo/holds',{method:'POST',body:{}});
  assert.equal(sessions,2);assert.equal(mutations,1);
});

test('Google round trips restore only an unfinished booking and recheck the live slot',async()=>{
  let busy=false;
  const a=app(async url=>{
    if(url.endsWith('/session'))return Response.json({csrfToken:'csrf'});
    if(url.endsWith('/venues'))return Response.json({venues:[venue]});
    if(url.endsWith('/bookings'))return Response.json({bookings:[]});
    if(url.includes('/availability'))return Response.json({...availability,unavailable:busy?[{resourceId:0,start:1080,end:1170,kind:'booked'}]:[]});
    throw new Error('Unexpected request');
  });
  await a.loadVenues();
  Object.assign(a.S,{authReturn:'checkout',turfId:venue.slug,court:'0',day:1,start:1080,dur:90,customerName:'My Team',customerPhone:'9000000001'});
  a.saveGoogleDraft();
  const stored=JSON.parse(a.saved.getItem('futly-google-booking'));
  assert.ok(!('csrf' in stored));assert.ok(!('user' in stored));assert.ok(!('bookings' in stored));
  Object.assign(a.S,{screen:'profile',start:null,customerName:'',customerPhone:''});
  await a.restoreGoogleDraft();assert.equal(a.S.screen,'checkout');assert.equal(a.S.start,1080);assert.equal(a.S.customerName,'My Team');assert.equal(a.S.customerPhone,'9000000001');
  assert.equal(a.saved.getItem('futly-google-booking'),null);
  a.S.authReturn='checkout';a.saveGoogleDraft();a.S.screen='home';
  await a.restoreGoogleDraft(false);assert.equal(a.S.screen,'profile');assert.equal(a.S.authReturn,'checkout');assert.equal(a.S.start,1080);
  a.S.authReturn='checkout';a.saveGoogleDraft();busy=true;
  await a.restoreGoogleDraft();assert.equal(a.S.screen,'turf');assert.equal(a.S.start,null);assert.match(a.S.apiError,/no longer available/);
  const stale={...stored,at:Date.now()-3600001};a.saved.setItem('futly-google-booking',JSON.stringify(stale));a.S.screen='profile';
  await a.restoreGoogleDraft();assert.equal(a.S.screen,'profile');assert.equal(a.saved.getItem('futly-google-booking'),null);
});
