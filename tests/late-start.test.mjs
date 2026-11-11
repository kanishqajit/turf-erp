import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../server/store.mjs';
import {sessionStartPlan} from '../client/session-start.js';
import {occupiedOnDay} from '../client/occupancy.js';
import {startOptionsHtml} from '../client/start-options.js';
const date='2026-11-11';
function fixture(t){
  t.mock.timers.enable({apis:['Date'],now:new Date(date+'T12:40:00Z')}); // 18:10 at the venue
  const store=createStore({filename:':memory:'});
  const owner=store.createUser({email:'late@turf.test',name:'Owner',role:'owner',password:'late-start-test-password'});
  const operator={...owner,role:'operator'};
  const make=(start,end,team,pitch=0)=>({date,pitch,start,end,team,contact:'9000000000'});
  const bookings=store.createBookings([make(1080,1140,'Late team'),make(1140,1200,'Next team'),make(1200,1260,'Third team'),make(1290,1350,'After a gap')],owner);
  return {store,owner,operator,bookings,make};
}
const preview=(store,b,policy,edits=[])=>sessionStartPlan(b,store.listState(date,date),1090,date,1090,{policy,edits});
const request=(b,plan)=>({version:b.version,atMinute:1090,policy:plan.policy,adjustments:plan.adjustments.map(({id,version,start,end})=>({id,version,start,end}))});
test('start now keeps the booked end, records real kickoff and reserves only the chosen playing time',t=>{
  const {store,operator,bookings:[b,next]}=fixture(t);try{
    const plan=preview(store,b,'scheduled');assert.equal(plan.ok,true);assert.equal(plan.duration,50);assert.equal(plan.end,1140);
    const started=store.startSession(b.id,request(b,plan),operator);
    assert.equal(started.startedAt,1090);assert.equal(started.playDuration,50);assert.equal(started.start,1080);assert.equal(started.end,1140);assert.equal(started.amount,b.amount);
    assert.equal(occupiedOnDay(started,date).end,1140);assert.equal(store.getBooking(next.id).version,next.version);
    const paused=store.controlClock(b.id,'pause',operator,started.version);assert.equal(paused.playDuration,50);
  }finally{store.close();}
});
test('full duration can start now when there is room and gives the full clock',t=>{
  const {store,owner,operator,make}=fixture(t);try{
    const b=store.createBookings([make(1080,1140,'Free pitch',1)],owner)[0];
    const plan=preview(store,b,'full');assert.equal(plan.ok,true);assert.equal(plan.end,1150);
    const started=store.startSession(b.id,request(b,plan),operator);assert.equal(started.playDuration,60);assert.equal(started.startedAt,1090);
    assert.equal(occupiedOnDay(started,date).end,1150);
  }finally{store.close();}
});
test('shift preview cascades only as far as needed, permits manual delay and preserves every charge and receipt',t=>{
  const {store,owner,operator,bookings:[b,next,third,gap]}=fixture(t);try{
    store.recordPayment(next.id,{amount:500,mode:'Cash',idempotencyKey:'following-deposit-0001',version:next.version},owner);
    const plan=preview(store,b,'shift',[{id:next.id,start:1155}]);assert.equal(plan.ok,true);assert.equal(plan.adjustments.length,2);
    assert.equal(plan.adjustments[0].start,1155);assert.equal(plan.adjustments[1].start,1215);
    const started=store.startSession(b.id,request(b,plan),operator);assert.equal(started.playDuration,60);
    const moved=store.getBooking(next.id);assert.equal(moved.start,1155);assert.equal(moved.end,1215);assert.equal(moved.amount,next.amount);assert.equal(moved.collected,500);
    assert.equal(store.getBooking(third.id).start,1215);assert.equal(store.getBooking(gap.id).version,gap.version);
    assert.equal(store.listAudit(100,owner).filter(e=>e.action==='booking.rescheduled').length,2);
  }finally{store.close();}
});
test('full-duration conflicts lead to choices and the affected bookings remain editable in the preview',t=>{
  const {store,bookings:[b,next]}=fixture(t);try{
    assert.match(preview(store,b,'full').reason,/overlap Next team/);
    const invalid=preview(store,b,'shift',[{id:next.id,start:1145}]);assert.equal(invalid.ok,false);assert.ok(invalid.adjustments.some(x=>x.id===next.id));
    const html=startOptionsHtml(b,invalid);assert.match(html,/Keep booked end/);assert.match(html,/Full duration/);assert.match(html,/Adjust following/);assert.match(html,/type="time"/);
    assert.ok(!html.includes('disabled'),'policy choices remain available even when the selected plan conflicts');
  }finally{store.close();}
});
test('holds, maintenance and closing time block the whole adjustment without changing any booking',t=>{
  const {store,owner,operator,bookings:[b]}=fixture(t);try{
    const plan=preview(store,b,'shift');assert.equal(plan.ok,true);
    store.createBlock({date,pitch:0,start:1260,end:1280,reason:'Maintenance after third team'},owner);
    assert.match(preview(store,b,'shift').reason,/maintenance/);
    assert.throws(()=>store.startSession(b.id,request(b,plan),operator),e=>e.code==='start_conflict');assert.equal(store.getBooking(b.id).status,'upcoming');
    const late={...b,start:1380,end:1440};assert.match(sessionStartPlan(late,{bookings:[late],holds:[],blocks:[]},1390,date,1390,{policy:'full'}).reason,/closing/);
    const holdState={bookings:[b],holds:[{id:'h',date,pitch:0,start:1140,end:1200,expiresAt:Date.now()+60000}],blocks:[]};
    assert.match(sessionStartPlan(b,holdState,1090,date,1090,{policy:'shift'}).reason,/hold/);
  }finally{store.close();}
});
test('new bookings and stale versions invalidate the confirmed preview atomically',t=>{
  const {store,owner,operator,bookings:[b,next]}=fixture(t);try{
    const plan=preview(store,b,'shift');
    store.checkIn(next.id,true,operator,next.version);
    assert.throws(()=>store.startSession(b.id,request(b,plan),operator),e=>e.code==='schedule_changed');
    assert.equal(store.getBooking(b.id).status,'upcoming');assert.equal(store.getBooking(next.id).start,1140);
    const fresh=preview(store,b,'shift');store.createBookings([{date,pitch:0,start:1260,end:1280,team:'New arrival',contact:'9000000000'}],owner);
    assert.throws(()=>store.startSession(b.id,request(b,fresh),operator),e=>e.code==='schedule_changed');
    assert.equal(store.getBooking(b.id).status,'upcoming');assert.equal(store.getBooking(next.id).start,1140);
  }finally{store.close();}
});
test('a late start beyond the original end remains possible with an explicit full-duration policy',t=>{
  const {store,owner,operator,make}=fixture(t);try{
    const b=store.createBookings([make(960,1020,'Very late team',1)],owner)[0];
    const plan=preview(store,b,'full');assert.equal(plan.ok,true);
    assert.equal(store.startSession(b.id,request(b,plan),operator).startedAt,1090);
  }finally{store.close();}
});
test('malformed schedule edits are rejected without a partial start',t=>{
  const {store,operator,bookings:[b]}=fixture(t);try{
    for(const adjustments of [[null],[{}],{},[{id:'missing',start:1150}]]){
      assert.throws(()=>store.startSession(b.id,{version:b.version,atMinute:1090,policy:'shift',adjustments},operator),e=>e.code==='start_conflict');
      assert.equal(store.getBooking(b.id).status,'upcoming');
    }
  }finally{store.close();}
});
test('explicit playing duration survives pause, resume, extension and restart',t=>{
  const {store,owner,operator,make}=fixture(t);try{
    const b=store.createBookings([make(1080,1140,'Clock test',1)],owner)[0];
    let current=store.startSession(b.id,request(b,preview(store,b,'scheduled')),operator);
    current=store.controlClock(b.id,'pause',operator,current.version);
    t.mock.timers.tick(5*60000);
    current=store.controlClock(b.id,'resume',operator,current.version);
    assert.equal(current.playDuration,50);assert.equal(occupiedOnDay(current,date).end,1145);
    current=store.extendBooking(b.id,30,operator,current.version);
    assert.equal(current.playDuration,80);assert.equal(occupiedOnDay(current,date).end,1175);
    current=store.setStatus(b.id,'upcoming',owner,'Reset clock',null,current.version);
    assert.equal(current.playDuration,null);
  }finally{store.close();}
});
