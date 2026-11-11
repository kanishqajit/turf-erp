import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sessionStartPlan} from '../client/session-start.js';
import {occupiedOnDay} from '../client/occupancy.js';
const user={id:'operator',role:'operator',name:'Operator'};
const payload=(bookings=[])=>({user,csrfToken:'csrf',state:{bookings,holds:[],blocks:[],settings:{depositAmount:500}}});
const source=readFileSync(new URL('../mobile.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
function client(fetch){
  const listeners={};
  const context=vm.createContext({fetch,Response,URLSearchParams,Date,Map,Set,console,crypto,sessionStartPlan,occupiedOnDay,
    matchMedia:()=>({matches:false,addEventListener(){}}),localStorage:{getItem:()=>null,setItem(){}},
    document:{hidden:false,querySelector:()=>null,documentElement:{dataset:{},style:{setProperty(){}}},addEventListener:(name,fn)=>{listeners[name]=fn;}},
    addEventListener(){},setInterval(){},EventSource:class{addEventListener(){}},setTimeout,requestAnimationFrame(){},cancelAnimationFrame(){}});
  const ready=source.replace('render();\nboot();','/* no startup */')+`\nrender=()=>{};globalThis.app={S,boot,loadState,mutate,signOut,mobileQuery,cellSegments,bubHtml,sheetHtml,collectNow,click:listenersUnused};`;
  vm.runInContext(ready.replace('click:listenersUnused','click:null'),context);
  context.app.click=listeners.click;return context.app;
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};
test('phone boots with one bundled request and loads Accounts only on Money',async()=>{
  const calls=[];const a=client(async path=>{calls.push(path);return Response.json({...payload(),accounts:{bookings:[],payments:[]}});});
  await a.boot();assert.equal(calls.length,1);assert.ok(calls[0].startsWith('/api/desktop?'));assert.equal(new URL(calls[0],'https://test').searchParams.get('include'),'');
  a.S.screen='money';await a.loadState();assert.equal(new URL(calls[1],'https://test').searchParams.get('include'),'accounts');
});
test('phone saves once, applies the committed board, and rejects an older poll',async()=>{
  const waiting=deferred(),calls=[];const a=client(async(path,options)=>{calls.push(path);return options.method==='POST'?Response.json({booking:{id:'saved'},desktop:payload([{id:'saved'}])}):waiting.promise;});
  a.S.user=user;const read=a.loadState();const result=await a.mutate('/api/bookings/one/check-in',{checked:true});
  assert.ok(result);assert.equal(calls.length,2);assert.ok(calls[1].includes('refresh=desktop'));assert.equal(a.S.bookings[0].id,'saved');
  waiting.resolve(Response.json(payload([{id:'stale'}])));await read;assert.equal(a.S.bookings[0].id,'saved');
});
test('an acknowledged phone save remains successful when the follow-up refresh fails',async()=>{
  const a=client(async(path,options)=>options.method==='POST'?Response.json({booking:{id:'saved'}}):Response.json({error:{message:'Offline'}},{status:503}));a.S.user=user;
  const result=await a.mutate('/api/bookings/one/check-in',{});assert.ok(result);assert.match(a.S.apiError,/Saved.*could not refresh/);assert.equal(a.S.busy,false);
});
test('failed phone booking retains details and sheet',async()=>{
  const a=client(async()=>Response.json({error:{message:'Offline'}},{status:503}));a.S.user=user;
  a.S.sheet={kind:'slot',pi:0,hi:12,date:'2026-11-12'};a.S.form={team:'Keep me',contact:'9000000000'};
  a.click({target:{closest:()=>({disabled:false,dataset:{act:'book-slot'}})}});
  await new Promise(r=>setTimeout(r,10));assert.equal(a.S.form.team,'Keep me');assert.equal(a.S.sheet.kind,'slot');
});
test('failed logout retains the signed-in phone; success ignores an in-flight response',async()=>{
  let fail=true;const waiting=deferred();const a=client(async path=>path.includes('logout')?(fail?Response.json({error:{message:'Offline'}},{status:503}):Response.json({ok:true})):waiting.promise);
  a.S.user=user;await a.signOut();assert.equal(a.S.user.id,user.id);
  const reading=a.loadState();fail=false;await a.signOut();waiting.resolve(Response.json(payload([{id:'private'}])));await reading;
  assert.equal(a.S.user,null);assert.equal(a.S.bookings.length,0);
});
test('phone partial-hour cells show both bookings and the free remainder with exact selection bounds',()=>{
  const a=client(async()=>Response.json(payload()));const date='2026-11-12',base={date,pitch:0,status:'upcoming'};
  a.S.bookings=[{...base,id:'a',start:1080,end:1095,team:'First'},{...base,id:'b',start:1095,end:1110,team:'Second'}];
  const segments=a.cellSegments(date,0,12);assert.equal(segments.length,3);assert.equal(segments[2].cell.st,'free');
  const html=a.bubHtml(date,12,0,false,false);assert.match(html,/First/);assert.match(html,/Second/);assert.match(html,/data-start="1110" data-end="1140"/);
});

test('retrying an unconfirmed phone receipt reuses its payment identity',async()=>{
  const keys=[];const a=client(async(path,options)=>{keys.push(JSON.parse(options.body).idempotencyKey);return Response.json({error:{message:'Unconfirmed'}},{status:503});});
  a.S.user=user;a.S.bookings=[{id:'payment',amount:1000,collected:0,version:1}];a.S.sheet={kind:'collect',id:'payment'};
  await a.collectNow('payment');await a.collectNow('payment');assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal(a.S.sheet.kind,'collect');
});
test('cancelling on the phone uses release and retains the reason when it fails',async()=>{
  const paths=[];const a=client(async path=>{paths.push(path);return Response.json({error:{message:'Offline'}},{status:503});});
  a.S.user=user;a.S.bookings=[{id:'cancel',version:1}];a.S.sheet={kind:'cancel',id:'cancel'};a.S.cancelReason='Customer called to cancel';
  a.click({target:{closest:()=>({disabled:false,dataset:{act:'cancel-booking'}})}});await new Promise(r=>setTimeout(r,10));
  assert.ok(paths[0].startsWith('/api/bookings/cancel/release?'));assert.equal(a.S.cancelReason,'Customer called to cancel');assert.equal(a.S.sheet.kind,'cancel');
});
test('switching phone accounts clears cached history before the new board is shown',async()=>{
  let who=user;const a=client(async()=>Response.json({...payload(),user:who}));await a.boot();a.S.accounts=[{id:'old-private'}];
  who={...user,id:'different'};await a.loadState();assert.equal(a.S.accounts.length,0);assert.equal(a.S.user.id,'different');
});
