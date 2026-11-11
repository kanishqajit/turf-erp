/* The same demonstration day, written to a hosted deployment over the API.

   scripts/seed-showday.mjs talks to a local SQLite file through the store.
   This one signs in and uses the public endpoints, so it works against the
   Cloudflare/Supabase prototype — or any other deployment — without needing
   the database.

   It never deletes anything. Clearing a day needs a manager (releaseBooking),
   and the demonstration account is an operator, so this works around whatever
   is already on the board instead of wiping it.

     TURF_BASE_URL=https://futly-prototype.pages.dev \
     TURF_SEED_EMAIL=... TURF_SEED_PASSWORD=... node scripts/seed-showday-cloud.mjs

   Re-runnable: it skips any slot that is already taken, so running it twice
   adds nothing and breaks nothing. */

import { randomUUID } from 'node:crypto';

const BASE = (process.env.TURF_BASE_URL || '').replace(/\/$/, '');
const EMAIL = process.env.TURF_SEED_EMAIL;
const PASSWORD = process.env.TURF_SEED_PASSWORD;
if (!BASE || !EMAIL || !PASSWORD){
  console.error('Set TURF_BASE_URL, TURF_SEED_EMAIL and TURF_SEED_PASSWORD.');
  process.exit(1);
}

const iso = offset => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const TODAY = iso(0), TOMORROW = iso(1);
const now = new Date();
const NOW = now.getHours() * 60 + now.getMinutes();
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const money = n => '₹' + Math.round(n).toLocaleString('en-IN');
const pause = ms => new Promise(r => setTimeout(r, ms));

/* ── the wire ─────────────────────────────────────────── */
let cookie = '', csrf = '';
const failures = [];

async function call(path, { method = 'GET', body } = {}){
  const headers = { Accept:'application/json', Origin:BASE, Referer:BASE + '/m' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined){ headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = csrf; }
  const res = await fetch(BASE + path, { method, headers,
    body:body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw:text.slice(0, 160) }; }
  if (!res.ok){
    const error = new Error(data?.error?.message || `${res.status} on ${path}`);
    error.status = res.status; error.code = data?.error?.code;
    throw error;
  }
  return { res, data };
}

/* A mutation that is allowed to fail without stopping the run — a slot taken
   by something already on the board is expected, not an error. */
async function soft(label, fn){
  try { return await fn(); }
  catch (error){ failures.push(`${label}: ${error.code || error.status || ''} ${error.message}`); return null; }
}

const login = await call('/api/auth/login', { method:'POST', body:{ email:EMAIL, password:PASSWORD } });
cookie = (login.res.headers.getSetCookie?.()[0] || login.res.headers.get('set-cookie') || '').split(';')[0];
csrf = login.data.csrfToken;
const me = login.data.user;
console.log(`\nSigned in to ${BASE} as ${me.email} (${me.role}).`);
if (me.role !== 'owner'){
  console.log('  Note: only an owner may mark a booking as app-sourced, so every');
  console.log('  booking below will show as over-the-counter.');
}

/* ── what is already there ────────────────────────────── */
const before = (await call(`/api/state?from=${TODAY}&to=${TOMORROW}`)).data;
const taken = before.bookings
  .filter(b => !['cancelled','noshow'].includes(b.status))
  .map(b => ({ date:b.date, pitch:b.pitch, start:b.start, end:b.end }));
const isFree = (date, pitch, start, end) =>
  !taken.some(t => t.date === date && t.pitch === pitch && t.start < end && t.end > start);
const occupy = (date, pitch, start, end) => taken.push({ date, pitch, start, end });
console.log(`  Already on the board: ${before.bookings.length} booking(s).`);

/* ── the cast ─────────────────────────────────────────── */
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

/* Mornings belong to the fitness crowd, the middle of the day is dead, and
   everything after six is the business. */
const DEMAND = {
  6:[1,1,0], 7:[1,1,0], 8:[1,0,0], 9:[0,0,0], 10:[0,0,0], 11:[0,0,0],
  12:[0,0,0], 13:[0,0,0], 14:[0,0,0], 15:[0,0,1], 16:[1,0,1], 17:[1,1,1],
  18:[1,1,1], 19:[1,1,1], 20:[1,1,1], 21:[1,1,1], 22:[1,0,0], 23:[1,0,0],
};
/* Gaps kept open on purpose, so there is always a slot to tap in a demo. */
const KEEP_OPEN = {
  [TODAY]:    [[0,21],[1,19],[2,17]],
  [TOMORROW]: [[0,20],[1,18],[2,19],[0,7]],
};

function plan(date){
  const rows = [], open = KEEP_OPEN[date] || [];
  for (const hour of Object.keys(DEMAND).map(Number)){
    DEMAND[hour].forEach((wanted, pitch) => {
      if (!wanted) return;
      if (open.some(([p, h]) => p === pitch && h === hour)) return;
      const start = hour * 60, end = start + 60;
      if (!isFree(date, pitch, start, end)) return;
      const [team, contact] = nextTeam();
      occupy(date, pitch, start, end);
      rows.push({ date, pitch, start, end, team, contact });
    });
  }
  return rows;
}

const todayRows = plan(TODAY);
const tomorrowRows = plan(TOMORROW);

/* ── a live match, on whichever pitch is free this hour ── */
const liveHour = Math.min(23, Math.max(6, Math.floor(NOW / 60)));
const liveStart = liveHour * 60;
let live = null;
for (const pitch of [0, 1, 2]){
  const i = todayRows.findIndex(r => r.pitch === pitch && r.start === liveStart);
  if (i >= 0){ live = todayRows[i]; live.team = LIVE_TEAM[0]; live.contact = LIVE_TEAM[1]; live._live = true; break; }
  if (isFree(TODAY, pitch, liveStart, liveStart + 60)){
    occupy(TODAY, pitch, liveStart, liveStart + 60);
    live = { date:TODAY, pitch, start:liveStart, end:liveStart + 60,
      team:LIVE_TEAM[0], contact:LIVE_TEAM[1], _live:true };
    todayRows.push(live);
    break;
  }
}

/* And one that finished in the last hour without paying. */
const owedStart = Math.max(6 * 60, liveStart - 60);
let owed = null;
if (owedStart < liveStart){
  for (const pitch of [2, 1, 0]){
    const i = todayRows.findIndex(r => r.pitch === pitch && r.start === owedStart);
    if (i >= 0){ owed = todayRows[i]; owed.team = OWED_TEAM[0]; owed.contact = OWED_TEAM[1]; owed._owed = true; break; }
    if (isFree(TODAY, pitch, owedStart, owedStart + 60)){
      occupy(TODAY, pitch, owedStart, owedStart + 60);
      owed = { date:TODAY, pitch, start:owedStart, end:owedStart + 60,
        team:OWED_TEAM[0], contact:OWED_TEAM[1], _owed:true };
      todayRows.push(owed);
      break;
    }
  }
}

/* ── create them ──────────────────────────────────────── */
const all = [...todayRows, ...tomorrowRows];
const created = [];
for (let i = 0; i < all.length; i += 12){
  const batch = all.slice(i, i + 12);
  const made = await soft(`batch ${i / 12 + 1}`, () => call('/api/bookings/batch', { method:'POST',
    body:{ bookings:batch.map(r => ({ date:r.date, pitch:r.pitch, start:r.start, end:r.end,
      team:r.team, contact:r.contact })) } }));
  if (made) made.data.bookings.forEach((b, k) => created.push({ ...batch[k], id:b.id, version:b.version }));
  await pause(120);
}
console.log(`  Created ${created.length} booking(s).`);

/* ── give each one a life ─────────────────────────────── */
const MODES = ['UPI','Cash','UPI','Card','Cash','UPI'];
let paid = 0, owedTotal = 0, started = 0, checked = 0, advances = 0;

const setStatus = (row, status, atMinute, version) =>
  call(`/api/bookings/${row.id}/status`, { method:'POST',
    body:{ status, reason:'', atMinute:atMinute ?? null, version } });

for (const row of created){
  const amount = 0; // resolved from the response below

  if (row._live){
    const began = Math.max(row.start, Math.min(NOW - 22, row.end - 5));
    const r = await soft(`live ${row.team}`, () => setStatus(row, 'running', began, row.version));
    if (r) started++;
    await pause(90);
    continue;
  }

  if (row._owed || (row.date === TODAY && row.end <= NOW)){
    const began = row.start + (row.pitch % 3);
    const a = await soft(`run ${row.team}`, () => setStatus(row, 'running', began, row.version));
    if (!a){ await pause(90); continue; }
    const b = await soft(`end ${row.team}`, () => setStatus(row, 'done', null,
      a.data.booking.version));
    if (!b){ await pause(90); continue; }
    const due = b.data.booking.amount - (b.data.booking.discount || 0);

    /* The unpaid one, plus roughly one in six of the rest, goes home owing. */
    if (row._owed || paid % 6 === 5){ owedTotal += due; paid++; await pause(90); continue; }
    const mode = MODES[paid % MODES.length];
    await soft(`pay ${row.team}`, () => call(`/api/bookings/${row.id}/payments`, { method:'POST',
      body:{ amount:due, mode, settle:true,
        reference:mode === 'Cash' ? '' : 'UTR' + String(100000 + paid * 37),
        idempotencyKey:'showday-' + randomUUID() } }));
    paid++;
    await pause(90);
    continue;
  }

  if (row.date === TODAY && row.start > NOW && row.start <= NOW + 25){
    const r = await soft(`check-in ${row.team}`, () => call(`/api/bookings/${row.id}/check-in`,
      { method:'POST', body:{ checked:true, version:row.version } }));
    if (r) checked++;
    await pause(90);
    continue;
  }

  if ((row.pitch + row.start) % 4 === 0){
    const r = await soft(`advance ${row.team}`, () => call(`/api/bookings/${row.id}/payments`,
      { method:'POST', body:{ amount:500, mode:'UPI', settle:false,
        reference:'UTR' + String(500000 + row.start), idempotencyKey:'showday-' + randomUUID() } }));
    if (r) advances++;
    await pause(90);
  }
}

/* ── a hold on a slot that is genuinely free ──────────── */
let holdAt = null;
for (let hour = Math.floor(NOW / 60) + 1; hour <= 22 && !holdAt; hour++){
  for (const pitch of [1, 0, 2]){
    if (isFree(TODAY, pitch, hour * 60, hour * 60 + 60)){ holdAt = { pitch, start:hour * 60 }; break; }
  }
}
if (holdAt){
  const ok = await soft('hold', () => call('/api/holds', { method:'POST',
    body:{ date:TODAY, pitch:holdAt.pitch, start:holdAt.start, end:holdAt.start + 60,
      team:'Sunday Regulars', contact:'9388221470', pay:'Payment at venue' } }));
  if (!ok) holdAt = null;
}

/* Maintenance blocks need a manager; the demo account is an operator. */
const block = await soft('block', () => call('/api/blocks', { method:'POST',
  body:{ date:TOMORROW, pitch:1, start:15 * 60, end:16 * 60, reason:'Net repair and line marking' } }));

/* ── what the owner will see ──────────────────────────── */
const after = (await call(`/api/state?from=${TODAY}&to=${TOMORROW}`)).data;
const day = after.bookings.filter(b => b.date === TODAY);
const live2 = day.filter(b => b.status === 'running');
const collected = day.reduce((n, b) => n + (b.collected || 0), 0);
const due = day.filter(b => !['cancelled','noshow'].includes(b.status))
  .reduce((n, b) => n + Math.max(0, b.amount - (b.discount || 0) - (b.collected || 0)), 0);

console.log(`\n  Today      ${TODAY}   ${day.length} booked`);
console.log(`  Tomorrow   ${TOMORROW}   ${after.bookings.filter(b => b.date === TOMORROW).length} booked`);
console.log(`  Live now   ${live2.map(b => b.team + ' · pitch ' + 'ABC'[b.pitch] + ' · ' + hhmm(b.start)).join(', ') || 'none'}`);
console.log(`  Collected  ${money(collected)}`);
console.log(`  Owed       ${money(due)}`);
console.log(`  Checked in ${checked}   Advances ${advances}`);
console.log(`  Hold       ${holdAt ? 'pitch ' + 'ABC'[holdAt.pitch] + ' ' + hhmm(holdAt.start) : 'none'}`);
console.log(`  Block      ${block ? 'tomorrow 15:00' : 'skipped (needs a manager account)'}`);

if (failures.length){
  console.log(`\n  ${failures.length} call(s) did not apply:`);
  failures.slice(0, 10).forEach(f => console.log('    ' + f));
}
console.log('');
