/* A board worth showing an owner.

   Fills today and tomorrow with a day that looks like a working turf rather
   than a test fixture: quiet mornings, a dead middle, a packed evening, one
   match on the clock right now, money still owed on the one that just
   finished, a hold about to lapse and a pitch closed for net repair.

   Everything is written through the store's own functions, so the prices,
   the floodlight surcharge, the payment ledger and the audit trail are the
   real ones — the demo board is not a drawing of the product, it is the
   product with plausible rows in it.

   Re-runnable. It clears today and tomorrow first, then rebuilds relative to
   the current clock, so the live match is always live. Run it again in the
   car before you walk into the next turf.

     node scripts/seed-showday.mjs

   Local demonstration data only; it refuses to touch a production database. */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createStore } from '../server/store.mjs';

if (process.env.NODE_ENV === 'production'){
  console.error('Refusing to seed demonstration data in production.');
  process.exit(1);
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATABASE_PATH = process.env.TURF_DATABASE_PATH || join(ROOT, 'data', 'turf.sqlite');
const store = createStore({ filename:DATABASE_PATH, sessionIdleMs:30 * 60 * 1000 });

const iso = offset => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const TODAY = iso(0), TOMORROW = iso(1);
const now = new Date();
const NOW = now.getHours() * 60 + now.getMinutes();
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/* The owner account signs these in, because only an owner may mark a booking
   as having arrived through the app — and a board where every single row came
   over the counter is the one thing that would look staged. */
const owner = store.db.prepare(`SELECT id,email,name,role FROM users
  WHERE role='owner' AND active=1 ORDER BY email LIMIT 1`).get();
if (!owner){
  console.error('No active owner account in this database. Run scripts/seed-users.mjs first.');
  process.exit(1);
}

/* ── wipe the two demonstration days ──────────────────── */
function wipe(dates){
  let removed = 0;
  store.db.exec('BEGIN');
  try {
    for (const date of dates){
      const ids = store.db.prepare('SELECT id FROM bookings WHERE date=?').all(date).map(r => r.id);
      for (const id of ids){
        store.db.prepare('DELETE FROM payment_events WHERE booking_id=?').run(id);
        store.db.prepare('DELETE FROM bookings WHERE id=?').run(id);
        removed++;
      }
      store.db.prepare('DELETE FROM holds WHERE date=?').run(date);
      store.db.prepare('DELETE FROM blocks WHERE date=?').run(date);
    }
    store.db.exec('COMMIT');
  } catch (error){
    store.db.exec('ROLLBACK');
    throw error;
  }
  return removed;
}
const cleared = wipe([TODAY, TOMORROW]);

/* ── the cast ─────────────────────────────────────────── */
/* Club-sounding and casual in roughly the proportion a real board carries. */
/* Falcon FC and Kakkanad Strikers are held back for the live match and the
   unpaid one below. A team that appears on two pitches in the same hour is the
   first thing an owner would notice. */
const LIVE_TEAM = ['Falcon FC', '9847112233'];
const OWED_TEAM = ['Kakkanad Strikers', '9847709962'];
const TEAMS = [
  ['Kaloor Kings', '9995640182'],     ['Edappally Eagles', '8086774510'],
  ['Vyttila Warriors', '9744328815'], ['Panampilly FC', '9846051127'],
  ['Thrikkakara XI', '9633870244'],   ['Marine Drive FC', '9961245508'],
  ['Palarivattom FC', '9048336721'],  ['Nellikka Boys', '9895412067'],
  ['MG Road United', '7593008841'],   ['Kadavanthra Lions', '9567120934'],
  ['Aluva Athletic', '9605778213'],   ['Office Team', '9847665031'],
  ['Sunday Regulars', '9388221470'],  ['Infopark XI', '9496550318'],
  ['Thevara Titans', '9847330116'],   ['Cheranalloor FC', '9846772204'],
];
let cast = 0;
const nextTeam = () => TEAMS[cast++ % TEAMS.length];

/* ── the shape of a turf's day ────────────────────────── */
/* Hour-of-day → how likely each pitch is to be sold. Mornings belong to the
   fitness crowd, the middle of the day is dead, and everything after six is
   the business. These weights are what stop the board looking generated. */
const DEMAND = {
  6:[1,1,0], 7:[1,1,0], 8:[1,0,0], 9:[0,0,0], 10:[0,0,0], 11:[0,0,0],
  12:[0,0,0], 13:[0,0,0], 14:[0,0,0], 15:[0,0,1], 16:[1,0,1], 17:[1,1,1],
  18:[1,1,1], 19:[1,1,1], 20:[1,1,1], 21:[1,1,1], 22:[1,1,0], 23:[1,0,0],
};
/* Deliberate gaps so there is always an empty slot to tap during a demo. */
const KEEP_OPEN = {
  [TODAY]:    [[0,21],[1,19],[2,17]],
  [TOMORROW]: [[0,20],[1,18],[2,19],[0,7]],
};

function plan(date){
  const rows = [];
  const open = KEEP_OPEN[date] || [];
  for (const hour of Object.keys(DEMAND).map(Number)){
    DEMAND[hour].forEach((wanted, pitch) => {
      if (!wanted) return;
      if (open.some(([p, h]) => p === pitch && h === hour)) return;
      const [team, contact] = nextTeam();
      rows.push({ date, pitch, start:hour * 60, end:hour * 60 + 60, team, contact,
        source:(pitch + hour) % 3 === 0 ? 'app' : 'counter' });
    });
  }
  return rows;
}

/* Tomorrow carries one two-hour booking — a real board always has one. */
function withLongBooking(rows){
  const i = rows.findIndex(r => r.pitch === 2 && r.start === 20 * 60);
  if (i >= 0){
    rows[i].end = 22 * 60;
    rows[i].team = 'Corporate 7s';
    rows.splice(rows.findIndex(r => r.pitch === 2 && r.start === 21 * 60), 1);
  }
  return rows;
}

const todayRows = plan(TODAY);
const tomorrowRows = withLongBooking(plan(TOMORROW));

/* ── a live match, right now ──────────────────────────── */
/* Whatever hour the script is run, Pitch A has a game on the clock — that card
   with the counting digits is the single most convincing thing on the board. */
const liveHour = Math.min(23, Math.max(6, Math.floor(NOW / 60)));
const liveStart = liveHour * 60;
const existingLive = todayRows.findIndex(r => r.pitch === 0 && r.start === liveStart);
if (existingLive >= 0) todayRows.splice(existingLive, 1);
todayRows.push({ date:TODAY, pitch:0, start:liveStart, end:liveStart + 60,
  team:LIVE_TEAM[0], contact:LIVE_TEAM[1], source:'app', _live:true });

/* And one that finished in the last hour without paying, so "still to collect"
   is a real number and not a zero. */
const owedStart = Math.max(6 * 60, liveStart - 60);
if (owedStart < liveStart){
  const clash = todayRows.findIndex(r => r.pitch === 2 && r.start === owedStart);
  if (clash >= 0) todayRows.splice(clash, 1);
  todayRows.push({ date:TODAY, pitch:2, start:owedStart, end:owedStart + 60,
    team:OWED_TEAM[0], contact:OWED_TEAM[1], source:'counter', _owed:true });
}

/* ── write them ───────────────────────────────────────── */
const created = [];
for (const batch of chunk([...todayRows, ...tomorrowRows], 20)){
  const made = store.createBookings(batch.map(r => ({
    date:r.date, pitch:r.pitch, start:r.start, end:r.end,
    team:r.team, contact:r.contact, source:r.source,
  })), owner);
  made.forEach((booking, i) => created.push({ ...batch[i], id:booking.id, booking }));
}
function chunk(list, n){
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/* ── give each one a believable life ──────────────────── */
const MODES = ['UPI','Cash','UPI','Card','Cash','UPI'];
let paid = 0, owedTotal = 0, cashTotal = 0, run = 0;

for (const row of created){
  const fresh = store.getBooking(row.id);
  const due = fresh.amount - (fresh.discount || 0);

  if (row._live){
    /* Started twenty-odd minutes ago, so the clock reads most of an hour left. */
    const began = Math.max(row.start, Math.min(NOW - 22, row.end - 5));
    store.setStatus(row.id, 'running', owner, '', began, fresh.version);
    run++;
    continue;
  }

  if (row._owed){
    const began = row.start + 3;
    const mid = store.getBooking(row.id);
    store.setStatus(row.id, 'running', owner, '', began, mid.version);
    const after = store.getBooking(row.id);
    store.setStatus(row.id, 'done', owner, '', null, after.version);
    owedTotal += due;
    continue;
  }

  if (row.date === TODAY && row.end <= NOW){
    /* Played and settled. One in six went home still owing. */
    const began = row.start + (row.pitch % 3);
    const b1 = store.getBooking(row.id);
    store.setStatus(row.id, 'running', owner, '', began, b1.version);
    const b2 = store.getBooking(row.id);
    store.setStatus(row.id, 'done', owner, '', null, b2.version);
    if (paid % 6 === 5){ owedTotal += due; paid++; continue; }
    const mode = MODES[paid % MODES.length];
    store.recordPayment(row.id, { amount:due, mode, settle:true,
      reference:mode === 'Cash' ? '' : 'UTR' + String(100000 + paid * 37),
      idempotencyKey:'showday-' + randomUUID() }, owner);
    if (mode === 'Cash') cashTotal += due;
    paid++;
    continue;
  }

  if (row.date === TODAY && row.start <= NOW + 25 && row.start > NOW){
    /* Arriving shortly — one of them is already at the gate. */
    store.checkIn(row.id, true, owner, fresh.version);
    continue;
  }

  /* Still ahead: a few have paid an advance, which is what a deposit looks
     like on the board. */
  if ((row.pitch + row.start) % 4 === 0){
    store.recordPayment(row.id, { amount:500, mode:'UPI', settle:false,
      reference:'UTR' + String(500000 + row.start), idempotencyKey:'showday-' + randomUUID() }, owner);
  }
}

/* ── a hold and a closed pitch ────────────────────────── */
/* Someone rang, the slot is held for them, and it lapses shortly — the amber
   state exists and a board that never shows it looks thinner than it is. */
/* Find a slot that is genuinely free and still ahead of us, rather than
   assuming one — the evening is deliberately crowded. */
function freeSlotAhead(date, fromMinute){
  const taken = store.listState(date, date).bookings
    .filter(b => b.date === date)
    .map(b => [b.pitch, b.start, b.end]);
  for (let hour = Math.floor(fromMinute / 60) + 1; hour <= 22; hour++){
    for (const pitch of [1, 0, 2]){
      const start = hour * 60;
      const clash = taken.some(([p, s, e]) => p === pitch && s < start + 60 && e > start);
      if (!clash) return { pitch, start };
    }
  }
  return null;
}

const holdAt = freeSlotAhead(TODAY, NOW);
if (holdAt){
  try {
    store.createHold({ date:TODAY, pitch:holdAt.pitch, start:holdAt.start, end:holdAt.start + 60,
      team:'Sunday Regulars', contact:'9388221470', pay:'Payment at venue',
      expiresAt:new Date(Date.now() + 11 * 60000).toISOString() }, owner);
  } catch (error){ console.warn('  hold skipped:', error.message); }
}

try {
  /* The store wants a reason somebody could act on, not a label. */
  store.createBlock({ date:TOMORROW, pitch:1, start:15 * 60, end:16 * 60,
    reason:'Net repair and line marking' }, owner);
} catch (error){ console.warn('  block skipped:', error.message); }

/* ── what the owner will be looking at ────────────────── */
const state = store.listState(TODAY, TOMORROW);
const forDay = date => state.bookings.filter(b => b.date === date);
const sold = date => forDay(date).length;
const money = n => '₹' + Math.round(n).toLocaleString('en-IN');

console.log(`\nCleared ${cleared} existing booking(s) on the two demonstration days.\n`);
console.log(`  Today      ${TODAY}   ${sold(TODAY)} booked, ${54 - sold(TODAY) * 1} of 54 slot-hours open`);
console.log(`  Tomorrow   ${TOMORROW}   ${sold(TOMORROW)} booked`);
console.log(`  Live now   Pitch A, ${hhmm(liveStart)}–${hhmm(liveStart + 60)}, clock running`);
console.log(`  Owed       ${money(owedTotal)} across the day`);
console.log(`  Collected  ${money(state.bookings.filter(b => b.date === TODAY)
  .reduce((n, b) => n + (b.collected || 0), 0))}`);
console.log(`  Hold       ${holdAt ? 'Pitch ' + 'ABC'[holdAt.pitch] + ' ' + hhmm(holdAt.start) + ', lapses in 11 minutes' : 'none free'}`);
console.log(`  Blocked    Pitch B tomorrow 15:00, net repair\n`);
console.log('Re-run this before the next visit and the live match moves to the current hour.\n');

store.close();
