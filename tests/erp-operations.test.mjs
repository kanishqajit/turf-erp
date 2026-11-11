import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../server/store.mjs';
import {sessionStartPlan} from '../client/session-start.js';
import {S} from '../client/state.js';
import {TODAY,isoDate} from '../client/datetime.js';
import {viewSessions} from '../client/views/sessions.js';
const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
function fixture(){
  const store=createStore({filename:':memory:'});
  const owner=store.createUser({email:'audit@turf.test',name:'Owner',role:'owner',password:'operations-test-password'});
  return {store,owner,operator:{...owner,role:'operator'}};
}
const input=(start,end,team='Team',pitch=0)=>({date,pitch,start,end,team,contact:'9000000000'});
test('handover closes the old clock and starts the next game atomically while preserving its debt',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date(date+'T13:00:00Z')});
  const {store,owner,operator}=fixture();try{
    let [previous,next]=store.createBookings([input(1080,1140,'Previous'),input(1140,1200,'Next')],owner);
    previous=store.setStatus(previous.id,'running',owner,'',1080,previous.version);
    t.mock.timers.tick(30*60000);
    const result=store.startSession(next.id,{version:next.version,atMinute:1140,previous:{id:previous.id,version:previous.version}},operator);
    assert.equal(result.status,'running');assert.equal(result.startedAt,1140);
    const ended=store.getBooking(previous.id);assert.equal(ended.status,'done');assert.equal(ended.collected,0);assert.equal(ended.amount,previous.amount);
    assert.equal(store.listState(date,date).bookings.filter(b=>b.status==='running').length,1);
  }finally{store.close();}
});
test('a failed or stale handover rolls back the previous end and its audit event',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date(date+'T13:00:00Z')});
  const {store,owner,operator}=fixture();try{
    let [previous,next,after]=store.createBookings([input(1080,1140,'Previous'),input(1140,1200,'Next'),input(1200,1260,'After')],owner);
    previous=store.setStatus(previous.id,'running',owner,'',1080,previous.version);
    t.mock.timers.tick(30*60000);
    const count=store.listAudit(100,owner).length;
    assert.throws(()=>store.startSession(next.id,{version:next.version,atMinute:1150,previous:{id:previous.id,version:previous.version}},operator),e=>e.code==='booking_conflict');
    assert.equal(store.getBooking(previous.id).status,'running');assert.equal(store.getBooking(next.id).status,'upcoming');assert.equal(store.listAudit(100,owner).length,count);
    assert.throws(()=>store.startSession(next.id,{version:next.version,atMinute:1140,previous:{id:previous.id,version:previous.version-1}},operator),e=>e.code==='stale_booking');
    assert.equal(store.getBooking(previous.id).status,'running');
  }finally{store.close();}
});
test('split receipts are all-or-nothing and replay safely after an uncertain response',()=>{
  const {store,owner,operator}=fixture();try{
    const booking=store.createBookings([input(1080,1140)],owner)[0];
    const payload={cashAmount:500,upiAmount:booking.amount-500,reference:'In person',idempotencyKey:'split-operation-0001',version:booking.version};
    assert.throws(()=>store.recordSplitPayment(booking.id,{...payload,reference:''},operator),e=>e.code==='reference_required');
    assert.equal(store.getBooking(booking.id).collected,0);
    const paid=store.recordSplitPayment(booking.id,payload,operator);assert.equal(paid.collected,booking.amount);
    assert.equal(store.recordSplitPayment(booking.id,payload,operator).collected,booking.amount);
    const receipts=store.listAccounts(date,date,owner).payments;assert.equal(receipts.length,2);
    assert.equal(paid.collectedByMode.Cash,500);assert.equal(paid.collectedByMode.UPI,booking.amount-500);
  }finally{store.close();}
});
test('start preview explains late overlap, accepts the scheduled end, and finds earlier-day handovers',()=>{
  const booking={id:'next',date:'2026-11-11',pitch:0,start:1080,end:1140,status:'upcoming'};
  const after={...booking,id:'after',team:'Next team',start:1140,end:1200};
  const state={bookings:[booking,after],holds:[],blocks:[]};
  assert.match(sessionStartPlan(booking,state,1090,booking.date,1090).reason,/overlap Next team/);
  assert.equal(sessionStartPlan(booking,state,1080,booking.date,1090).ok,true);
  state.bookings.push({...booking,id:'previous-day',date:'2026-11-10',status:'running',version:3});
  assert.equal(sessionStartPlan(booking,state,1080,booking.date,1090).previous.id,'previous-day');
  assert.equal(sessionStartPlan(booking,state,1065,booking.date,1060).ok,false);
});
test('Now queue keeps the next team visible beside a running game and an unpaid finish',()=>{
  globalThis.location={hostname:'localhost'};globalThis.localStorage={getItem:()=>'18:00'};
  const original={...S};try{
    const base={date:isoDate(TODAY),pitch:0,start:1080,end:1140,contact:'9000000000',amount:1800,collected:0,pay:'Payment at venue',source:'counter'};
    Object.assign(S,{bookings:[{...base,id:'live',team:'Playing team',status:'running',startedAt:1080},
      {...base,id:'next',team:'Next team visible',status:'upcoming',start:1140,end:1200}],sessionsMode:'now',focusSession:null});
    const html=viewSessions();assert.match(html,/Next team visible/);assert.match(html,/data-act="mark-started" data-id="next"/);
    assert.ok(html.indexOf('Next team visible')>html.indexOf('Playing team'));
  }finally{Object.assign(S,original);delete globalThis.location;delete globalThis.localStorage;}
});
