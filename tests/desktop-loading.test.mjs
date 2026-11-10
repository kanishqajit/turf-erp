import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../client/api.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
const user={id:'operator-1',role:'operator',name:'Test Operator'};
const payload=(bookings=[])=>({user,csrfToken:'csrf',state:{bookings,holds:[],blocks:[],settings:{depositAmount:500}}});
function client(fetch){
  const S={user:null,view:'availability',accounts:[],bookings:[],holds:[],blocks:[],audit:[],users:[],paymentEvents:[],csrf:'',busy:false};
  const context=vm.createContext({S,fetch,URLSearchParams,Date,Map,Set,console,TODAY:new Date('2026-11-10T12:00:00Z'),isoDate:d=>d.toISOString().slice(0,10),weekStart:()=>new Date('2026-11-09T12:00:00Z'),can:role=>({operator:1,manager:2,owner:3}[S.user?.role]||0)>={operator:1,manager:2,owner:3}[role],applyTheme(){},loadPrefs(){},esc:x=>x});
  vm.runInContext(source+'\nglobalThis.app={S,boot,loadState,mutate};',context);return context.app;
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
