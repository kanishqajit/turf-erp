import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, ProductError } from '../server/store.mjs';

const ownerInput = {
  email:'owner@example.test',
  name:'Test Owner',
  role:'owner',
  password:'correct horse battery staple',
};

function fixture(){
  const store = createStore({ filename:':memory:' });
  const owner = store.createUser(ownerInput);
  const operator = store.createUser({
    email:'operator@example.test', name:'Test Operator', role:'operator',
    password:'another correct horse battery',
  }, owner);
  const manager = store.createUser({
    email:'manager@example.test', name:'Test Manager', role:'manager',
    password:'manager correct horse battery',
  }, owner);
  return { store, owner, operator, manager };
}

function expectCode(code, fn){
  assert.throws(fn, error => error instanceof ProductError && error.code === code);
}

test('accounts, sessions, and operational records survive a process restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'turf-store-'));
  const filename = join(dir, 'turf.sqlite');
  try {
    let store = createStore({ filename });
    const owner = store.createUser(ownerInput);
    store.createBookings([{
      date:'2026-08-13', pitch:0, start:600, end:660,
      team:'Persistent Team', contact:'+91 90000 00000',
    }], owner);
    store.updateSettings({ depositAmount:750 }, owner);
    store.close();

    store = createStore({ filename });
    const authenticated = store.authenticate(ownerInput.email, ownerInput.password);
    const session = store.createSession(authenticated);
    assert.equal(store.sessionUser(session.token).role, 'owner');
    assert.equal(store.listState('2026-08-13', '2026-08-13').bookings[0].team, 'Persistent Team');
    assert.equal(store.getSettings().depositAmount, 750);
    store.close();
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('deposit policy is configurable by managers, validated, shared, and audited', () => {
  const { store, operator, manager } = fixture();
  try {
    assert.equal(store.getSettings().depositAmount, 500);
    expectCode('forbidden', () => store.updateSettings({ depositAmount:800 }, operator));
    expectCode('invalid_deposit', () => store.updateSettings({ depositAmount:-1 }, manager));
    assert.deepEqual(store.updateSettings({ depositAmount:800 }, manager), { depositAmount:800 });
    assert.equal(store.listState('2026-08-13', '2026-08-13').settings.depositAmount, 800);
    const event = store.listAudit(1, manager)[0];
    assert.equal(event.action, 'settings.deposit.updated');
    assert.deepEqual(event.before, { depositAmount:500 });
    assert.deepEqual(event.after, { depositAmount:800 });
  } finally { store.close(); }
});

test('calendar and state range validation reject ambiguous or unbounded reads', () => {
  const { store, operator } = fixture();
  try {
    expectCode('invalid_date', () => store.createBookings([{
      date:'2026-02-30', pitch:0, start:600, end:660,
      team:'Invalid Date', contact:'+91 90000 00013',
    }], operator));
    expectCode('range_too_large', () => store.listState('2026-01-01', '2026-04-01'));
  } finally { store.close(); }
});

test('custom bookings are collision checked and appear in the shared session state', () => {
  const { store, operator } = fixture();
  try {
    const [created] = store.createBookings([{
      date:'2026-08-14', pitch:0, start:1050, end:1110,
      team:'First Team', contact:'+91 90000 00001', kind:'custom',
    }], operator);
    expectCode('booking_conflict', () => store.createBookings([{
      date:'2026-08-14', pitch:0, start:1080, end:1140,
      team:'Conflicting Team', contact:'+91 90000 00002', kind:'custom',
    }], operator));
    const state = store.listState('2026-08-14', '2026-08-14');
    assert.equal(state.bookings.length, 1);
    assert.equal(state.bookings[0].id, created.id);
    assert.equal(state.bookings[0].kind, 'custom');
  } finally { store.close(); }
});

test('batch booking is atomic when any requested date conflicts', () => {
  const { store, operator } = fixture();
  try {
    store.createBookings([{
      date:'2026-08-15', pitch:1, start:660, end:750,
      team:'Existing', contact:'+91 90000 00003', kind:'group', groupType:'Corporate',
    }], operator);
    expectCode('booking_conflict', () => store.createBookings([
      { date:'2026-08-16', pitch:1, start:660, end:750, team:'Group', contact:'+91 90000 00004', kind:'group' },
      { date:'2026-08-15', pitch:1, start:660, end:750, team:'Group', contact:'+91 90000 00004', kind:'group' },
    ], operator));
    assert.equal(store.listState('2026-08-16', '2026-08-16').bookings.length, 0);
  } finally { store.close(); }
});

test('holds expire, disappear from availability, and cannot be confirmed', () => {
  const { store, operator } = fixture();
  try {
    const hold = store.createHold({
      date:'2026-08-17', pitch:2, start:720, end:780,
      team:'Held Team', contact:'+91 90000 00005',
    }, operator);
    store.db.prepare('UPDATE holds SET expires_at=? WHERE id=?').run(Date.now() - 1, hold.id);
    assert.equal(store.listState('2026-08-17', '2026-08-17').holds.length, 0);
    expectCode('hold_expired', () => store.confirmHold(hold.id, operator));
  } finally { store.close(); }
});

test('extensions cannot cross a booking or closing time and recalculate the actual total', () => {
  const { store, operator } = fixture();
  try {
    const [first] = store.createBookings([{
      date:'2026-08-18', pitch:0, start:1080, end:1140,
      team:'First', contact:'+91 90000 00006',
    }], operator);
    store.createBookings([{
      date:'2026-08-18', pitch:0, start:1170, end:1230,
      team:'Next', contact:'+91 90000 00007',
    }], operator);
    expectCode('booking_conflict', () => store.extendBooking(first.id, 60, operator));

    const [late] = store.createBookings([{
      date:'2026-08-18', pitch:2, start:1260, end:1320,
      team:'Late', contact:'+91 90000 00008',
    }], operator);
    expectCode('outside_hours', () => store.extendBooking(late.id, 30, operator));

    const [safe] = store.createBookings([{
      date:'2026-08-19', pitch:1, start:600, end:660,
      team:'Safe', contact:'+91 90000 00009',
    }], operator);
    const extended = store.extendBooking(safe.id, 30, operator);
    assert.equal(extended.end, 690);
    assert.equal(extended.amount, 1800);
    assert.equal(extended.pay, 'Payment at venue');
  } finally { store.close(); }
});

test('privileged releases and reversals require role, confirmation reason, and create audit evidence', () => {
  const { store, owner, operator, manager } = fixture();
  try {
    const [booking] = store.createBookings([{
      date:'2026-08-20', pitch:0, start:900, end:960,
      team:'Audited Team', contact:'+91 90000 00010',
    }], operator);
    expectCode('forbidden', () => store.releaseBooking(booking.id, operator, 'Customer cancelled'));
    expectCode('reason_required', () => store.releaseBooking(booking.id, manager, ''));
    store.releaseBooking(booking.id, manager, 'Customer cancelled by phone');

    const [second] = store.createBookings([{
      date:'2026-08-21', pitch:0, start:900, end:960,
      team:'Status Team', contact:'+91 90000 00011',
    }], operator);
    store.setStatus(second.id, 'noshow', operator, 'Team did not arrive');
    expectCode('forbidden', () => store.setStatus(second.id, 'upcoming', operator, 'Wrong status'));
    store.setStatus(second.id, 'upcoming', manager, 'Operator marked wrong team');

    const actions = store.listAudit(50, owner).map(event => event.action);
    assert.ok(actions.includes('booking.released'));
    assert.ok(actions.includes('booking.status.noshow'));
    assert.ok(actions.includes('booking.status.upcoming'));
  } finally { store.close(); }
});

test('payments are append-only and discounts need manager authority', () => {
  const { store, operator, manager } = fixture();
  try {
    const [booking] = store.createBookings([{
      date:'2026-08-22', pitch:0, start:900, end:960,
      team:'Payment Team', contact:'+91 90000 00012',
    }], operator);
    let current = store.recordPayment(booking.id, { amount:500, mode:'UPI' }, operator);
    assert.equal(current.collected, 500);
    assert.equal(current.pay, 'Advance paid');
    expectCode('payment_reconciliation_required', () =>
      store.releaseBooking(booking.id, manager, 'Customer requested cancellation'));
    expectCode('forbidden', () => store.recordPayment(booking.id, {
      amount:1000, mode:'Cash', settle:true, reason:'Manager-approved offer',
    }, operator));
    current = store.recordPayment(booking.id, {
      amount:1200, mode:'Cash', settle:true, reason:'Service recovery discount',
    }, manager);
    assert.equal(current.collected, 1700);
    assert.equal(current.discount, 100);
    assert.equal(current.pay, 'Payment done');
  } finally { store.close(); }
});
