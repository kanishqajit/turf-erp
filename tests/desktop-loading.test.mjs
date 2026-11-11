import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../client/api.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
const user={id:'operator-1',role:'operator',name:'Test Operator'};
const payload=(bookings=[])=>({user,csrfToken:'csrf',state:{bookings,holds:[],blocks:[],settings:{depositAmount:500}}});
function client(fetch){
  const S={user:null,view:'availability',accounts:[],bookings:[],holds:[],blocks:[],audit:[],users:[],paymentEvents:[],csrf:'',busy:false};
  const context=vm.createContext({S,fetch,URLSearchParams,Date,Map,Set,console,AbortController,TODAY:new Date('2026-11-10T12:00:00Z'),isoDate:d=>d.toISOString().slice(0,10),weekStart:()=>new Date(Date.parse('2026-11-09T12:00:00Z')+(S.weekOffset||0)*7*86400000),can:role=>({operator:1,manager:2,owner:3}[S.user?.role]||0)>={operator:1,manager:2,owner:3}[role],applyTheme(){},loadPrefs(){},esc:x=>x});
  vm.runInContext(source+'\nglobalThis.app={S,boot,loadState,mutate,signOut,stateReady,ensureViewData,refreshOperationalState};',context);return context.app;
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('desktop boots with one authenticated request and loads histories only on their screens',async()=>{
  const calls=[];const a=client(async path=>{calls.push(path);const data=payload();if(path.includes('include=accounts'))data.accounts={bookings:[{id:'past-booking'}],payments:[]};return Response.json(data);});
  await a.boot(()=>{});assert.equal(calls.length,1);assert.ok(calls[0].startsWith('/api/desktop?'));assert.equal(new URL(calls[0],'https://test').searchParams.get('include'),'');
  assert.equal(a.S.ready,true);assert.equal(a.S.user.id,user.id);
  a.S.view='accounts';await a.loadState();assert.equal(calls.length,2);assert.equal(a.S.accounts[0].id,'past-booking');
  assert.equal(new URL(calls[1],'https://test').searchParams.get('include'),'accounts');
});

test('desktop shares duplicate in-flight reads and discards responses after sign-out',async()=>{
  const waiting=deferred();let calls=0;const a=client(async()=>{calls++;return waiting.promise;});a.S.user=user;
  const first=a.loadState(),second=a.loadState();assert.equal(calls,1);a.S.user=null;
  waiting.resolve(Response.json(payload([{id:'private-booking'}])));await Promise.all([first,second]);assert.equal(a.S.user,null);assert.equal(a.S.bookings.length,0);
});

test('saving uses one request and its committed state supersedes an older poll',async()=>{
  const pending=deferred(),calls=[];
  const a=client(async(path,options)=>{calls.push({path,options});if(options.method==='POST')return Response.json({booking:{id:'saved'},desktop:payload([{id:'saved',version:2}])});return pending.promise;});
  a.S.user=user;a.S.csrf='csrf';const old=a.loadState();
  const result=await a.mutate('/api/bookings/existing/check-in',{checked:true,version:1});
  assert.ok(result);assert.equal(calls.length,2);assert.equal(calls[1].options.headers['X-CSRF-Token'],'csrf');
  assert.equal(new URL(calls[1].path,'https://test').searchParams.get('refresh'),'desktop');assert.equal(a.S.bookings[0].id,'saved');assert.equal(a.S.busy,false);
  pending.resolve(Response.json(payload([{id:'stale'}])));await old;assert.equal(a.S.bookings[0].id,'saved');
});

test('a save finishing after a newer range refresh reloads the current range and never restores the old one',async()=>{
  const save=deferred(),calls=[];
  const a=client(async(path,options)=>{calls.push(path);return options.method==='POST'?save.promise:Response.json(payload([{id:'new-week'}]));});
  a.S.user=user;a.S.csrf='csrf';
  const saving=a.mutate('/api/bookings/one/check-in',{checked:true,version:1});
  a.S.weekOffset=1;await a.loadState();assert.equal(a.S.bookings[0].id,'new-week');
  save.resolve(Response.json({booking:{id:'saved'},desktop:payload([{id:'old-week'}])}));await saving;
  assert.equal(a.S.bookings[0].id,'new-week');assert.equal(a.S.weekOffset,1);assert.ok(a.stateReady());
  assert.ok(calls.at(-1).includes('from=2026-11-16'));
});

test('rapid A-B-A navigation cancels old reads and only the final response owns loading and errors',async()=>{
  const requests=[];
  const a=client((path,options)=>{const d=deferred();requests.push({path,options,...d});return d.promise;});a.S.user=user;
  const first=a.loadState();a.S.view='accounts';const second=a.loadState();a.S.view='availability';const third=a.loadState();
  assert.ok(requests[0].options.signal.aborted);assert.ok(requests[1].options.signal.aborted);
  requests[2].resolve(Response.json(payload([{id:'correct'}])));await third;
  requests[0].resolve(Response.json(payload([{id:'obsolete'}])));await first;
  requests[1].resolve(Response.json({error:{message:'obsolete failure'}},{status:503}));await assert.rejects(second);
  assert.equal(a.S.bookings[0].id,'correct');assert.ok(a.stateReady());assert.equal(a.S.dataError,'');assert.equal(a.S.apiError,'');
});

test('failed logout keeps the account visibly signed in; successful logout clears data and ignores pending reads',async()=>{
  let fail=true;const pending=deferred();
  const a=client(async(path)=>path.includes('logout')?(fail?Response.json({error:{message:'Offline'}},{status:503}):Response.json({ok:true})):pending.promise);
  a.S.user=user;a.S.csrf='csrf';a.S.bookings=[{id:'private'}];
  assert.equal(await a.signOut(),false);assert.equal(a.S.user.id,user.id);assert.match(a.S.apiError,/still signed in/);assert.equal(a.S.csrf,'csrf');
  const reading=a.loadState();fail=false;assert.equal(await a.signOut(),true);
  pending.resolve(Response.json(payload([{id:'must-not-return'}])));await reading;
  assert.equal(a.S.user,null);assert.equal(a.S.csrf,'');assert.equal(a.S.bookings.length,0);
});

test('failed current navigation offers retry and a successful retry restores the current view',async()=>{
  let fails=true;
  const a=client(async()=>fails?Response.json({error:{message:'Service offline'}},{status:503}):Response.json(payload([{id:'restored'}])));a.S.user=user;
  await assert.rejects(a.loadState());assert.equal(a.stateReady(),false);assert.equal(a.S.dataError,'Service offline');
  fails=false;await a.loadState({force:true});assert.ok(a.stateReady());assert.equal(a.S.apiError,'');
});

test('group availability requests cover all extended dates, bounded to ninety days',async()=>{
  let url;
  const a=client(async path=>{url=new URL(path,'https://futly.test');return Response.json(payload());});
  a.S.user=user;a.S.groupOpen=true;a.S.gRange=84;a.S.dayIndex=6;await a.loadState();
  assert.equal(url.searchParams.get('groupRange'),'1');
  assert.equal((Date.parse(url.searchParams.get('to'))-Date.parse(url.searchParams.get('from')))/86400000,89);
});


test('date filters scope Accounts requests and its fresh board is reusable on return',async()=>{
  const calls=[];const a=client(async path=>{calls.push(path);return Response.json({...payload([{id:'latest'}]),accounts:{bookings:[],payments:[]}});});
  a.S.user=user;a.S.view='accounts';a.S.accountFrom='2026-11-01';a.S.accountTo='2026-11-30';
  await a.loadState();const query=new URL(calls[0],'https://test').searchParams;
  assert.equal(query.get('accountsFrom'),'2026-11-01');assert.equal(query.get('accountsTo'),'2026-11-30');
  a.S.view='availability';assert.ok(a.stateReady());
  await a.refreshOperationalState({ifNeeded:true});assert.equal(calls.length,1);
  a.S.dayIndex=3;await a.refreshOperationalState({ifNeeded:true});assert.equal(calls.length,1);
  a.S.weekOffset=1;assert.equal(a.stateReady(),false);await a.refreshOperationalState({ifNeeded:true});assert.equal(calls.length,2);
  a.S.view='accounts';a.S.accountFrom='2026-10-01';assert.equal(a.stateReady(),false);
});

test('navigation reuse expires and never suppresses explicit background refresh',async()=>{
  let calls=0;const a=client(async()=>{calls++;return Response.json(payload());});a.S.user=user;
  await a.loadState();a.S.lastSyncedAt=Date.now()-16000;await a.refreshOperationalState({ifNeeded:true});assert.equal(calls,2);
  await a.refreshOperationalState();assert.equal(calls,3);
});
