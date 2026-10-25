import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {publicVenue} from '../server/venue.mjs';

const source=readFileSync(new URL('../customer/app.js',import.meta.url),'utf8')
  .replace(/render\(\);\nloadVenues\(\);\s*$/, '');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function app(fetch){
  const context=vm.createContext({location:{origin:'https://futly.test'},fetch,Intl,Date,console,
    document:{addEventListener(){},hidden:false},setInterval(){},EventSource:class{addEventListener(){}},
  });
  vm.runInContext(source+'\nrender=()=>{};globalThis.app={S,TURFS,loadVenues,loadAvailability,loadBookings,api,screenBookings};',context);
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
