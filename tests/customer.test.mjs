import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStore, ProductError } from '../server/store.mjs';
import { createCustomerApi } from '../server/customer.mjs';

function fixture(){
  let clock=Date.parse('2026-10-08T10:00:00Z');
  const store=createStore({filename:':memory:'});
  const owner=store.createUser({email:'owner@test.example',name:'Owner',role:'owner',password:'prototype owner password'});
  const api=createCustomerApi(store,{},()=>clock);
  const a=api.createSession(),b=api.createSession();
  const customer={...api.session(a.token),profileId:'profile-a'},other={...api.session(b.token),profileId:'profile-b'};
  const input={date:'2026-10-09',pitch:0,start:1080,end:1140,team:'Customer FC',contact:'9000000001',idempotencyKey:'request-0001'};
  return {store,owner,api,customer,other,input,advance:ms=>{clock+=ms}};
}
const code=(name,fn)=>assert.throws(fn,e=>e instanceof ProductError&&e.code===name);

test('customer confirmation uses the shared app-origin ledger and survives retries',()=>{
  const {store,api,customer,input}=fixture();
  try{
    const first=api.createHold(customer,input),retry=api.createHold(customer,input);
    assert.equal(first.hold.id,retry.hold.id);
    assert.equal(store.listState(input.date,input.date).holds.length,1);
    const {booking}=api.confirmHold(customer,first.hold.id);
    assert.equal(booking.amount,2100);
    assert.equal(store.getBooking(booking.id).source,'app');
    assert.equal(booking.outstanding,2100);
    assert.equal(api.confirmHold(customer,first.hold.id).booking.id,booking.id);
    assert.equal(api.createHold(customer,input).confirmedBooking.id,booking.id);
    assert.equal(store.listState(input.date,input.date).bookings.length,1);
    code('request_key_reused',()=>api.createHold(customer,{...input,start:1200,end:1260}));
  }finally{store.close()}
});
test('public availability exposes intervals without customer or ledger details',()=>{
  const {store,owner,api,input}=fixture();
  try{
    store.createBookings([input],owner);
    const data=api.availability(input.date);
    assert.deepEqual(data.unavailable,[{resourceId:0,start:1080,end:1140,kind:'booked'}]);
    const json=JSON.stringify(data);
    assert.ok(!json.includes(input.contact));assert.ok(!json.includes(input.team));
    assert.equal(data.settings.closeMinute,1440);
  }finally{store.close()}
});
test('customer sessions cannot read, confirm or cancel another customer booking',()=>{
  const {store,api,customer,other,input}=fixture();
  try{
    const {hold}=api.createHold(customer,input);
    code('not_found',()=>api.confirmHold(other,hold.id));
    const {booking}=api.confirmHold(customer,hold.id);
    assert.equal(api.bookings(other).length,0);
    code('not_found',()=>api.cancel(other,booking.id));
    assert.equal(api.bookings(customer).length,1);
  }finally{store.close()}
});
test('customer slots reject conflicts, past times and sub-hour durations',()=>{
  const {store,owner,api,customer,input}=fixture();
  try{
    store.createBookings([input],owner);
    code('booking_conflict',()=>api.createHold(customer,input));
    code('invalid_duration',()=>api.createHold(customer,{...input,end:1110}));
    code('past_slot',()=>api.createHold(customer,{...input,date:'2026-10-08',start:900,end:960}));
    code('date_out_of_range',()=>api.availability('2026-10-07'));
    code('invalid_date',()=>api.availability('2026-02-31'));
  }finally{store.close()}
});
test('customer holds expire and blocked slots cannot be reserved',()=>{
  const {store,owner,api,customer,input,advance}=fixture();
  try{
    const {hold}=api.createHold(customer,input);advance(21*60000);
    store.db.prepare('UPDATE holds SET expires_at=? WHERE id=?').run(Date.now()-1,hold.id);
    code('hold_expired',()=>api.confirmHold(customer,hold.id));
    store.createBlock({...input,reason:'Pitch drainage maintenance'},owner);
    code('maintenance_conflict',()=>api.createHold(customer,{...input,idempotencyKey:'request-0002'}));
  }finally{store.close()}
});
test('customer history reflects staff collections; unpaid future cancellation frees the slot',()=>{
  const {store,owner,api,customer,input}=fixture();
  try{
    const {hold}=api.createHold(customer,input),{booking}=api.confirmHold(customer,hold.id);
    store.recordPayment(booking.id,{amount:500,mode:'Cash',idempotencyKey:'customer-test-deposit'},owner);
    assert.equal(api.bookings(customer)[0].outstanding,1600);
    code('payment_reconciliation_required',()=>api.cancel(customer,booking.id));
    const second=api.createHold(customer,{...input,pitch:1,idempotencyKey:'request-0002'});
    const free=api.confirmHold(customer,second.hold.id).booking;
    assert.equal(api.cancel(customer,free.id).booking.status,'cancelled');
    assert.ok(!api.availability(input.date).unavailable.some(b=>b.resourceId===1));
    assert.equal(api.cancel(customer,free.id).booking.status,'cancelled');
  }finally{store.close()}
});

test('account ownership follows the customer across browsers and survives sign-out safely',()=>{
  const {store,api,customer,other,input}=fixture();
  try{
    const guest={...customer};delete guest.profileId;
    code('customer_login_required',()=>api.createHold(guest,input));
    const {hold}=api.createHold(customer,input),{booking}=api.confirmHold(customer,hold.id);
    const fresh=api.session(api.createSession().token);
    assert.equal(api.bookings({...fresh,profileId:customer.profileId})[0].id,booking.id);
    assert.equal(api.bookings(guest).length,0);
    code('not_found',()=>api.cancel(guest,booking.id));
    code('not_found',()=>api.confirmHold(other,hold.id));
    api.claim(guest,other.profileId);
    assert.equal(api.bookings(other).length,0,'an account cannot re-claim another account booking');
    assert.equal(api.cancel({...fresh,profileId:customer.profileId},booking.id).booking.status,'cancelled');
  }finally{store.close();}
});
test('sign-in claims only unowned bookings from the current browser',()=>{
  const {store,api,customer,other,input}=fixture();
  try{
    const {hold}=api.createHold(customer,input),{booking}=api.confirmHold(customer,hold.id);
    store.db.prepare('UPDATE customer_reservations SET profile_id=NULL WHERE hold_id=?').run(hold.id);
    api.claim(other,other.profileId);
    assert.equal(api.bookings(other).length,0);
    api.claim(customer,customer.profileId);
    assert.equal(api.bookings(customer)[0].id,booking.id);
    assert.equal(api.bookings({...customer,profileId:undefined}).length,0);
  }finally{store.close();}
});
