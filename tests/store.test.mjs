import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLOSE_MIN, createStore, ProductError } from '../server/store.mjs';

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
const key = label => `${label}-00000000-0000-4000-8000-000000000000`;

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
    if (process.platform !== 'win32'){
      assert.equal(statSync(dir).mode & 0o777,0o700);
      assert.equal(statSync(filename).mode & 0o777,0o600);
    }
    const authenticated = store.authenticate(ownerInput.email, ownerInput.password);
    const session = store.createSession(authenticated);
    assert.equal(store.sessionUser(session.token).role, 'owner');
    assert.equal(store.listState('2026-08-13', '2026-08-13').bookings[0].team, 'Persistent Team');
    assert.equal(store.getSettings().depositAmount, 750);
    store.close();
  } finally { rmSync(dir, { recursive:true, force:true, maxRetries:5, retryDelay:50 }); }
});

test('sessions expire after the configured idle window', () => {
  const store=createStore({filename:':memory:',sessionIdleMs:30*60*1000});
  try{
    const owner=store.createUser(ownerInput),session=store.createSession(owner);
    assert.equal(store.sessionUser(session.token).role,'owner');
    store.db.prepare('UPDATE sessions SET last_seen_at=?').run(Date.now()-31*60*1000);
    assert.equal(store.sessionUser(session.token),null);
    store.deleteExpired();
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  }finally{store.close();}
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
      team:'First Team', contact:'+91 90000 00001', kind:'custom', source:'app',
    }], operator);
    expectCode('booking_conflict', () => store.createBookings([{
      date:'2026-08-14', pitch:0, start:1080, end:1140,
      team:'Conflicting Team', contact:'+91 90000 00002', kind:'custom',
    }], operator));
    const state = store.listState('2026-08-14', '2026-08-14');
    assert.equal(state.bookings.length, 1);
    assert.equal(state.bookings[0].id, created.id);
    assert.equal(state.bookings[0].kind, 'custom');
    assert.equal(state.bookings[0].source, 'counter');
    expectCode('invalid_customer',()=>store.createBookings([{date:'2026-08-14',pitch:1,start:900,end:960,
      team:'Bad Contact',contact:'123'}],operator));
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

    /* Anchored to the closing time rather than a literal, so moving opening
       hours cannot silently turn this into a test that asserts nothing. */
    const [late] = store.createBookings([{
      date:'2026-08-18', pitch:2, start:CLOSE_MIN - 60, end:CLOSE_MIN,
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
    store.setStatus(second.id, 'noshow', manager, 'Team did not arrive', second.start);
    expectCode('forbidden', () => store.setStatus(second.id, 'upcoming', operator, 'Wrong status'));
    store.setStatus(second.id, 'upcoming', manager, 'Operator marked wrong team', second.start);

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
    let current = store.recordPayment(booking.id, { amount:500, mode:'UPI', reference:'UPI-TEST-001', idempotencyKey:key('advance') }, operator);
    assert.equal(current.collected, 500);
    assert.equal(current.pay, 'Advance paid');
    expectCode('payment_reconciliation_required', () =>
      store.releaseBooking(booking.id, manager, 'Customer requested cancellation'));
    expectCode('forbidden', () => store.recordRefund(booking.id, {
      amount:500, mode:'UPI', reason:'Customer cancellation',
      reference:'UPI-REF-001',idempotencyKey:key('forbidden-refund'),
    }, operator));
    current = store.recordRefund(booking.id, {
      amount:500, mode:'UPI', reason:'Customer cancellation',
      reference:'UPI-REF-001',idempotencyKey:key('refund'),
    }, manager);
    assert.equal(current.collected, 0);
    store.releaseBooking(booking.id, manager, 'Customer requested cancellation');

    const [discounted] = store.createBookings([{
      date:'2026-08-23', pitch:0, start:900, end:960,
      team:'Discount Team', contact:'+91 90000 00014',
    }], operator);
    expectCode('forbidden', () => store.recordPayment(discounted.id, {
      amount:1000, mode:'Cash', settle:true, reason:'Manager-approved offer',
      idempotencyKey:key('operator-discount'),
    }, operator));
    current = store.recordPayment(discounted.id, {
      amount:1700, mode:'Cash', settle:true, reason:'Service recovery discount',
      idempotencyKey:key('manager-discount'),
    }, manager);
    assert.equal(current.collected, 1700);
    assert.equal(current.discount, 100);
    assert.equal(current.pay, 'Payment done');
  } finally { store.close(); }
});

test('financial writes are idempotent, rail constrained, and reject stale booking versions', () => {
  const { store, operator, manager } = fixture();
  try {
    const [booking]=store.createBookings([{ date:'2026-08-24',pitch:0,start:900,end:960,
      team:'Safe Ledger',contact:'+91 90000 00020' }],operator);
    const input={amount:600,mode:'UPI',reference:'UPI-SAFE-001',idempotencyKey:key('safe-payment'),version:booking.version};
    const first=store.recordPayment(booking.id,input,operator),again=store.recordPayment(booking.id,input,operator);
    assert.equal(first.collected,600);assert.equal(again.collected,600);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM payment_events WHERE booking_id=? AND kind='payment'").get(booking.id).n,1);
    expectCode('refund_exceeds_mode',()=>store.recordRefund(booking.id,{amount:100,mode:'Cash',reason:'Wrong refund rail',
      idempotencyKey:key('wrong-rail'),version:first.version},manager));
    expectCode('stale_booking',()=>store.extendBooking(booking.id,30,operator,booking.version));
  } finally { store.close(); }
});

test('staff accounts require a first-login password change and owners can revoke access safely', () => {
  const { store, owner } = fixture();
  try {
    const staff=store.createUser({email:'new@example.test',name:'New Staff',role:'operator',password:'temporary password 123'},owner);
    assert.equal(store.authenticate('new@example.test','temporary password 123').mustChangePassword,true);
    const logged=store.authenticate('new@example.test','temporary password 123');
    const session=store.createSession(logged),actor={...staff,session_id:store.sessionUser(session.token).session_id};
    store.changePassword(actor,'temporary password 123','private replacement 456');
    assert.equal(store.authenticate('new@example.test','private replacement 456').mustChangePassword,false);
    store.setUserActive(staff.id,false,owner,'Staff member left venue');
    expectCode('invalid_credentials',()=>store.authenticate('new@example.test','private replacement 456'));
    expectCode('self_deactivation',()=>store.setUserActive(owner.id,false,owner,'Accidental self removal'));
  } finally { store.close(); }
});

/* The client quotes prices before the server bills them — two implementations
   of one rule, in different tiers, that must agree. Nothing can import across
   that boundary, so this pins the server side: if the rate or the floodlight
   fee moves here, this fails and whoever changed it has to move the matching
   constants in client/domain.js. */
test('pricing is pro rata with a flat floodlight fee after 6pm', () => {
  const { store, operator } = fixture();
  try {
    const quote = (pitch, start, end, team) => store.createBookings([{
      date:'2026-08-21', pitch, start, end, team, contact:'+91 90000 00010',
    }], operator)[0].amount;

    /* Pitch A is 1800/hour: a full hour, a half hour pro rata, both before 6pm. */
    assert.equal(quote(0, 600, 660, 'Hour'), 1800);
    assert.equal(quote(0, 720, 750, 'Half'), 900);
    /* Ending exactly at 6pm is still daylight — the fee starts strictly after. */
    assert.equal(quote(0, 1020, 1080, 'Dusk'), 1800);
    /* One minute past and the flat 300 applies once, not per hour. */
    assert.equal(quote(1, 1080, 1140, 'Lit'), 1200 + 300);
    /* A different pitch, because the same one would collide with 'Lit'. */
    assert.equal(quote(2, 1080, 1200, 'LitLong'), 6400 + 300);
  } finally { store.close(); }
});

/* The console quotes from client/constants.js and the server bills from its own
   PITCHES list. Nothing keeps the two in step, and a drift is invisible: the
   operator reads one price off the screen while the customer is charged
   another. Cheaper to fail here than to find it in a till reconciliation. */
test('client and server agree on pitch names and rates', async () => {
  const { PITCHES:server } = await import('../server/store.mjs');
  const { PITCHES:client } = await import('../client/constants.js');
  assert.equal(client.length, server.length, 'pitch count differs between tiers');
  client.forEach((pitch, index) => {
    assert.equal(pitch.name, server[index].name, `pitch ${index} name differs`);
    assert.equal(pitch.rate, server[index].rate, `pitch ${index} rate differs`);
  });
});

/* The group tag is drawn from the client's accent palette but validated
   against the server's own copy, so the two lists have to stay identical for
   the same reason the rates do — except here a drift is silent: the colour is
   simply dropped and the booking saves untagged. */
test('client and server agree on the group colour palette', async () => {
  const { GROUP_COLORS:server } = await import('../server/store.mjs');
  const { PITCH_PALETTE:client } = await import('../client/constants.js');
  assert.deepEqual(client.map(entry => entry.hex), server, 'group colour palettes differ between tiers');
});

test('a group booking carries its colour and its discount, and the discount needs a manager', () => {
  const { store, owner, operator, manager } = fixture();
  try {
    const base = { date:'2026-08-20', pitch:1, start:600, end:660,
      team:'Acme United', contact:'+91 90000 00040', kind:'group', groupType:'Corporate' };

    /* An operator may tag a group, because a colour is not money. */
    const [plain] = store.createBookings([{ ...base, groupColor:'#69359C' }], operator);
    assert.equal(plain.groupColor, '#69359C');
    assert.equal(plain.discount, 0);

    /* A colour outside the palette is dropped rather than stored. */
    const [odd] = store.createBookings([{ ...base, date:'2026-08-21', groupColor:'#123456' }], operator);
    assert.equal(odd.groupColor, null);

    /* Money is another matter: the same authority the payment-time discount asks for. */
    expectCode('forbidden', () => store.createBookings([{ ...base, date:'2026-08-22', discountPct:10 }], operator));

    const [cut] = store.createBookings([{ ...base, date:'2026-08-22', discountPct:10 }], manager);
    assert.equal(cut.amount, 1200);
    assert.equal(cut.discount, 120);

    /* And past a fifth of the booking it is the owner's call. */
    expectCode('discount_limit', () => store.createBookings([{ ...base, date:'2026-08-23', discountPct:30 }], manager));
    const [deep] = store.createBookings([{ ...base, date:'2026-08-23', discountPct:30 }], owner);
    assert.equal(deep.discount, 360);
  } finally { store.close(); }
});

/* ── stating when play began ──
   The counter says when a team walked on; that is not the same claim as
   correcting a session's time after the fact, and it must not need a manager
   standing over the operator to record it. Everything about the rule is keyed
   to "today" and "now" in the venue's zone, so the test picks a fixed-offset
   zone that puts the store's local clock near midday. That keeps the booking
   inside opening hours and the assertions deterministic whatever hour the
   suite is actually run at. */
function middayFixture(){
  const now = new Date();
  const utcMinute = now.getUTCHours() * 60 + now.getUTCMinutes();
  let offset = Math.round((12 * 60 - utcMinute) / 60);
  if (offset > 12) offset -= 24;
  if (offset < -11) offset += 24;
  /* POSIX inverts the sign inside these zone names: Etc/GMT-5 is UTC+5. */
  const timeZone = offset === 0 ? 'UTC' : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
  const store = createStore({ filename:':memory:', timeZone });
  const owner = store.createUser(ownerInput);
  const operator = store.createUser({
    email:'operator@example.test', name:'Test Operator', role:'operator',
    password:'another correct horse battery',
  }, owner);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23' })
    .formatToParts(new Date()).reduce((all, part) => (all[part.type] = part.value, all), {});
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return { store, owner, operator, date, minute };
}

test('an operator may state the minute a session began, inside its own window', () => {
  const { store, owner, operator, date, minute } = middayFixture();
  try {
    const [booking] = store.createBookings([{
      date, pitch:0, start:minute - 20, end:minute + 40,
      team:'Late Arrivals', contact:'+91 90000 00030',
    }], operator);

    /* No manager, no reason: the operator says play began ten minutes ago. */
    const running = store.setStatus(booking.id, 'running', operator, '', minute - 10, booking.version);
    assert.equal(running.status, 'running');
    assert.equal(running.startedAt, minute - 10);

    /* The window is the only bound: a minute the server clock has not reached
       yet is still an ordinary start, because the counter's clock and the
       venue timezone's need not agree to the minute and a booking that has
       not ended cannot be corrected by knowing which of them is right. */
    const ahead = store.setStatus(booking.id, 'upcoming', owner, 'resetting for the skew case', null, running.version);
    const later = store.setStatus(booking.id, 'running', operator, '', minute + 5, ahead.version);
    assert.equal(later.startedAt, minute + 5);

    /* And it is on the record as an ordinary status change. */
    const actions = store.listAudit(20, owner).map(event => event.action);
    assert.ok(actions.includes('booking.status.running'));
  } finally { store.close(); }
});

test('a stated start outside the booking window is still a manager correction', () => {
  const { store, operator, date, minute } = middayFixture();
  try {
    const [booking] = store.createBookings([{
      date, pitch:1, start:minute - 20, end:minute + 40,
      team:'Early Birds', contact:'+91 90000 00031',
    }], operator);

    /* More than a quarter hour before the booked start. */
    expectCode('session_too_early', () =>
      store.setStatus(booking.id, 'running', operator, '', minute - 40, booking.version));
    /* At or past the booked end there is no session left to start. */
    expectCode('session_elapsed', () =>
      store.setStatus(booking.id, 'running', operator, '', minute + 40, booking.version));
    /* Another day is a correction whatever the minute says, and needs the role. */
    const [yesterday] = store.createBookings([{
      date:'2026-01-05', pitch:2, start:minute - 20, end:minute + 40,
      team:'Last Week', contact:'+91 90000 00032',
    }], operator);
    expectCode('forbidden', () =>
      store.setStatus(yesterday.id, 'running', operator, '', minute, yesterday.version));
    /* Untouched by either refusal. */
    assert.equal(store.listState(date, date).bookings.find(row => row.id === booking.id).status, 'upcoming');
  } finally { store.close(); }
});

test('a pitch runs one match at a time', () => {
  const { store, operator, date, minute } = middayFixture();
  try {
    const [first] = store.createBookings([{
      date, pitch:1, start:minute - 30, end:minute, team:'Ran Over',
      contact:'+91 90000 00041',
    }], operator);
    const [second] = store.createBookings([{
      date, pitch:1, start:minute, end:minute + 60, team:'Next Up',
      contact:'+91 90000 00042',
    }], operator);
    /* Another pitch is a different piece of grass and is unaffected. */
    const [elsewhere] = store.createBookings([{
      date, pitch:2, start:minute, end:minute + 60, team:'Other Pitch',
      contact:'+91 90000 00043',
    }], operator);

    const running = store.setStatus(first.id, 'running', operator, '', minute - 20, first.version);
    assert.equal(running.status, 'running');

    /* The first has run past its booked end, but the ball is still on the
       pitch: the next hour cannot start until it is closed. */
    expectCode('pitch_busy', () =>
      store.setStatus(second.id, 'running', operator, '', minute, second.version));
    assert.equal(store.listState(date, date).bookings.find(row => row.id === second.id).status, 'upcoming');

    store.setStatus(elsewhere.id, 'running', operator, '', minute, elsewhere.version);
    assert.equal(store.listState(date, date).bookings.find(row => row.id === elsewhere.id).status, 'running');

    /* Close the first and the pitch is free again. */
    const done = store.setStatus(first.id, 'done', operator, '', null, running.version);
    const ready = store.listState(date, date).bookings.find(row => row.id === second.id);
    assert.equal(done.status, 'done');
    assert.equal(store.setStatus(second.id, 'running', operator, '', minute, ready.version).status, 'running');
  } finally { store.close(); }
});
