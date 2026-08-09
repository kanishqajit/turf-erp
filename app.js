/* ═══════════════════════════════════════════════════════
   TURF OPERATIONS — the operator console, built to the
   Claude Design handoff (Turf Booking ERP.dc.html).

   Four views on one shell: Availability, Sessions,
   Reminders, Dashboard. Mock data only — the availability
   grid is a deterministic hash so the board is stable
   across renders; a real API would replace it wholesale.
   ═══════════════════════════════════════════════════════ */

/* ─── data ────────────────────────────────────────────── */
const PITCHES = [
  { name:'Pitch A',     sub:'7-a-side',  rate:1800 },
  { name:'Pitch B',     sub:'5-a-side',  rate:1200 },
  { name:'Main Ground', sub:'11-a-side', rate:3200 },
];

const TEAMS = ['Northside FC','Rovers United','Sunday League A','Corporate: Zeta','Kickers 05',
  'Old Boys XI','Astro Blues','Academy U16','Falcon SC','Midweek Six'];
const CONTACTS = ['+91 98450 22110','+91 99001 84523','+91 90080 33421','+91 98862 77014','+91 97310 55290'];

const SESSION_SEED = [
  { id:1, pitch:0, team:'Old Boys XI',    contact:'+91 98450 22110', source:'app',     pay:'Payment done',     start:960,  end:1020, status:'done',     startedAt:962, endedAt:1020 },
  { id:2, pitch:0, team:'Northside FC',   contact:'+91 99001 84523', source:'app',     pay:'Payment done',     start:1020, end:1080, status:'running',  startedAt:1032 },
  { id:3, pitch:2, team:'Academy U16',    contact:'+91 90080 33421', source:'counter', pay:'Advance paid',     start:1035, end:1125, status:'running',  startedAt:1038, advance:1600 },
  { id:4, pitch:1, team:'Kickers 05',     contact:'+91 98862 77014', source:'counter', pay:'Payment at venue', start:1080, end:1140, status:'upcoming' },
  { id:5, pitch:2, team:'Corporate: Zeta',contact:'+91 97310 55290', source:'app',     pay:'Payment at venue', start:1140, end:1230, status:'upcoming' },
];

/* Schedule window. The grid runs 06:00 to 22:00; the session timeline gets one
   hour of headroom past close so a late finish still lands on it. */
const START_HOUR = 6, END_HOUR = 22;
const DAY_START = START_HOUR * 60, DAY_END = (END_HOUR + 1) * 60, SPAN = DAY_END - DAY_START;

/* Optional per-pitch colour coding, off unless switched on in Settings. No
   colour wheel — staff pick from a curated set so every pitch stays legible
   against ink and lime, whatever they choose. */
const PITCH_PALETTE = [
  { name:'Forest',     hex:'#006B3C' },
  { name:'Crimson',    hex:'#C8102E' },
  { name:'Royal',      hex:'#69359C' },
  { name:'Teal',       hex:'#0B6E6E' },
  { name:'Navy',       hex:'#1E3A6E' },
  { name:'Ember',      hex:'#C1541C' },
  { name:'Plum',       hex:'#7A2048' },
  { name:'Indigo',     hex:'#3D2C8D' },
  { name:'Olive',      hex:'#5B6B1E' },
  { name:'Maroon',     hex:'#7A1F2B' },
  { name:'Umber',      hex:'#8A5A11' },
  { name:'Steel',      hex:'#2F5673' },
  { name:'Berry',      hex:'#A6215B' },
  { name:'Terracotta', hex:'#A24B2E' },
  { name:'Slate',      hex:'#4A5568' },
  { name:'Denim',      hex:'#35507A' },
];
/* One pitch's colour absent an override — the first three palette entries,
   so the out-of-the-box look matches what shipped before this was editable. */
const PITCH_DEFAULT_HEX = ['#006B3C', '#C8102E', '#69359C'];

/* The default: paper and ink, no pitch identity. */
const NEUTRAL_TINT =
  { bg:'#FFFFFF', line:'#EAECE4', fg:'#16181C', soft:'#8E949B', chip:'#F4F5F0', chipFg:'#16181C' };

const pitchColorFor = pi => S.pitchColors[pi] || PITCH_DEFAULT_HEX[pi];

/* Every palette pick is dark/saturated enough that white type always wins,
   but this is the fallback should that ever not hold. */
function readableFg(hex){
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? '#16181C' : '#FFFFFF';
}
function buildTint(hex){
  const fg = readableFg(hex);
  return { bg:hex, line:hex, fg,
    soft: fg === '#FFFFFF' ? 'rgba(255,255,255,.72)' : 'rgba(22,24,28,.62)',
    chip:'#FFF44F', chipFg:'#16181C' };
}
const tintFor = pi => S.showPitchColors ? buildTint(pitchColorFor(pi)) : NEUTRAL_TINT;

const MATCH_STATES = [
  { k:'upcoming', label:'Not started' },
  { k:'running',  label:'In play' },
  { k:'done',     label:'Finished' },
  { k:'noshow',   label:'No-show' },
];
const PAY_STATES = ['Payment at venue','Advance paid','Payment done'];
const PAY_MODES  = ['Cash','UPI','Card'];
const PAY_FORM   = ['Payment done','Payment at venue','Advance paid'];
const payShort = o => o === 'Payment at venue' ? 'Due' : o === 'Advance paid' ? 'Advance' : 'Paid';

const DOW  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DOWL = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const MON  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const OTHER_ALERTS = [
  { at:1045, tag:'Maintenance', title:'Floodlight repair logged on Pitch B',
    body:'Blocked 9–10PM by R. Kumar. Owner audit trail updated.' },
  { at:1010, tag:'App booking', title:'New app booking · Falcon SC',
    body:'Main Ground, tomorrow 7–8PM. Paid in full through the app.' },
  { at:960,  tag:'Cancellation', title:'Astro Blues cancelled 8AM on Pitch A',
    body:'Cancelled 3 hours ahead. Slot returned to the sellable pool.' },
  { at:930,  tag:'Staff', title:'Shift handover due at 6PM',
    body:'Evening staff take over. Hand across cash box and pending collections.' },
];

/* ─── state ───────────────────────────────────────────── */
const blankForm = () => ({ team:'', contact:'', notes:'', pay:'Payment at venue' });

const S = {
  view:'availability', pitch:0, weekOffset:0,
  showPitchColors:false,   // off by default — toggled from Settings
  pitchColors:{},          // pitch index → hex, only for pitches with a chosen override
  colorPickerOpen:null,    // pitch index whose palette is expanded in Settings, or null
  collapsedBands:{},       // band name → true, for the Morning/Afternoon/Evening/Late night groups. On by default.
  availMode:'day',         // 'day' = every pitch for one date, 'week' = one pitch across the week
  dayIndex:0,              // which day the day view is showing, 0–6 within the current week
  sel:null, overrides:{}, sources:{}, details:{}, blocks:{},
  formOpen:false, form:blankForm(),
  blockOpen:false, blockReason:'', holdPct:0,
  confirm:null, dur:60,
  custom:[], sessions:null,
  focusSession:null, timerAsk:null, doneAsk:null, blockDetail:null,
  advAsk:null, advVal:'', advMode:'advance', advPayMode:'Cash',
  customOpen:false, cDay:0, cStart:'17:30', cDur:60, cName:'', cPhone:'', cPay:'Payment at venue',
};

/* Stands in for the signed-in operator until there is real auth. Everything
   that needs attribution — audit entries, who took a payment — reads this. */
const STAFF = { id:'rk', name:'R. Kumar', initials:'RK' };

/* The demo clock starts at 17:32 and runs in real time. */
const T0 = Date.now();
const nowMin = () => 1052 + (Date.now() - T0) / 60000;

/* ─── helpers ─────────────────────────────────────────── */
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money = n => '₹' + Math.round(n).toLocaleString('en-IN');
const toMin = t => { const p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); };
/* One clock across the whole console: 12-hour, whole hours without the ":00"
   — "6PM", "6:30PM". Floors first, because the live clock hands out fractional
   minutes and `endedAt` is stamped straight from it. */
function t12(min){
  const t = Math.floor(min), h = Math.floor(t / 60) % 24, m = t % 60;
  return (h % 12 === 0 ? 12 : h % 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? 'AM' : 'PM');
}
/* A range drops the shared meridiem: "6–7PM", but "11AM–12PM". */
function rng12(a, b){
  const x = t12(a), y = t12(b);
  return x.slice(-2) === y.slice(-2) ? x.slice(0, -2) + '–' + y : x + '–' + y;
}
const hourT12 = h => t12(h * 60);
const hourRng12 = h => rng12(h * 60, (h + 1) * 60);
const hours = () => Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
const durTxt = m => Math.floor(m / 60) + 'h ' + String(Math.abs(Math.round(m % 60))).padStart(2,'0') + 'm';
const pos = m => Math.max(0, Math.min(100, ((m - DAY_START) / SPAN) * 100));

/* Deterministic pseudo-random so the same slot always reads the same way. */
const rnd = (a, b, c) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return x - Math.floor(x);
};

/* The demo's "today". Week 0 / day 0 lands on it, so a day is addressable
   either as (weekOffset, dayIndex) or as a plain offset in days from today. */
const TODAY = new Date(2026, 7, 3);        // Mon 3 Aug 2026

function weekStart(){
  const d = new Date(TODAY);
  d.setDate(d.getDate() + S.weekOffset * 7);
  return d;
}
const dateAt = n => { const d = new Date(TODAY); d.setDate(d.getDate() + n); return d; };
const daysFromToday = (weekOffset, dayIndex) => weekOffset * 7 + dayIndex;
const relDay = n => n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : null;
/* <input type="date"> speaks YYYY-MM-DD, parsed in local time below —
   `new Date('2026-08-15')` would be read as UTC and can land a day early.
   Midnight-normalised so a DST shift can't round the difference to 0.5 days. */
const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayOffsetOf = d => Math.round((midnight(d) - midnight(TODAY)) / 86400000);
const isoDate = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
  + '-' + String(d.getDate()).padStart(2, '0');
/* One place that turns "n days from today" into the (week, day) pair the grid
   indexes by — shared by the quick chips and the date picker. */
function goToDayOffset(n){
  S.weekOffset = Math.floor(n / 7);
  S.dayIndex = ((n % 7) + 7) % 7;
  S.sel = null;
}
const slotKey = (di, hi, pi) => (pi == null ? S.pitch : pi) + '|' + S.weekOffset + '|' + di + '|' + hi;

function statusFor(di, hi, pi){
  const k = slotKey(di, hi, pi);
  if (S.overrides[k]) return S.overrides[k];
  const h = hours()[hi];
  const r = rnd(di + S.weekOffset * 9, hi, pi);
  const peak = h >= 18 && h <= 21 ? 0.34 : h <= 8 ? -0.2 : h >= 12 && h <= 15 ? -0.16 : 0;
  if (r < 0.03) return 'blocked';
  if (r < 0.11) return 'hold';
  return r < 0.42 + peak ? 'booked' : 'free';
}
function sourceFor(di, hi, pi){
  const k = slotKey(di, hi, pi);
  if (S.overrides[k]) return S.sources[k] || 'counter';
  return rnd(di + 5, hi + 11, pi + 2) < 0.62 ? 'app' : 'counter';
}
const label = s => ({ free:'Open', booked:'Booked', hold:'On hold', blocked:'Maintenance' }[s]);

/* How much of hour `h` on day `di` a custom booking covers, 0–100 either side. */
function coverage(pi, di, h){
  let s = 1, e = 0, hit = null;
  for (const c of S.custom){
    if (c.pitch !== pi || c.week !== S.weekOffset || c.di !== di) continue;
    const a = Math.max(c.start, h * 60), b = Math.min(c.end, (h + 1) * 60);
    if (b > a){ s = Math.min(s, (a - h * 60) / 60); e = Math.max(e, (b - h * 60) / 60); hit = c; }
  }
  return hit ? { s: s * 100, e: e * 100, c: hit } : null;
}

const sess = () => S.sessions || SESSION_SEED;
function setSess(id, patch){
  S.sessions = sess().map(x => x.id === id ? Object.assign({}, x, patch) : x);
}
const sessById = id => sess().find(s => s.id === id);

/* Bars share one fill ramp: dark when saturated, lime mid, tint when quiet. */
const barFill = pct => pct >= 75 ? 'var(--ink)' : pct >= 50 ? 'var(--lime)' : 'var(--lime-tint)';
const vbar = pct => `height:${Math.max(pct,3)}%;background:${barFill(pct)}`;
const hbar = pct => `width:${Math.max(pct,3)}%;background:${barFill(pct)}`;

/* A pitch's colour travels as custom properties, so the same classes serve the
   availability grid and the per-pitch session sections. */
const tintVars = t =>
  `--tint-bg:${t.bg};--tint-line:${t.line};--tint-fg:${t.fg};--tint-soft:${t.soft};` +
  `--tint-chip:${t.chip};--tint-chip-fg:${t.chipFg}`;

const chipCls = on => 'chip' + (on ? ' on' : '');
const segCls  = (on, dark) => 'seg-opt' + (dark ? ' dark' : '') + (on ? ' on' : '');

/* ─── availability: the board ─────────────────────────── */
function bubble(st, src, isSel, cov, full){
  const kind = cov && !full ? 'part'
    : st === 'booked' ? (src === 'app' ? 'via-app' : 'counter')
    : st === 'free' ? '' : st;
  return ['bub', kind, isSel ? 'sel' : ''].filter(Boolean).join(' ');
}

/* One cell of either grid. `pi` is explicit so the day view can lay several
   pitches side by side; the week view always passes the pitch on screen. */
function slotHtml(di, hi, h, pi = S.pitch){
  const cov = coverage(pi, di, h);
  const st  = cov ? 'booked' : statusFor(di, hi, pi);
  const src = cov ? 'counter' : sourceFor(di, hi, pi);
  const isSel = !!(S.sel && S.sel.di === di && S.sel.hi === hi && S.pitch === pi);
  const full = !!(cov && cov.s <= 0 && cov.e >= 100);
  const time = hourRng12(h);
  const title = cov
    ? rng12(cov.c.start, cov.c.end) + ' · custom booking' + (cov.c.team ? ' · ' + cov.c.team : '')
    : hourRng12(h) + ' · ' + label(st) + (st === 'booked' ? ' · ' + (src === 'app' ? 'app' : 'counter') : '');
  const ovl = cov && !full
    ? `<span class="ovl" style="clip-path:inset(0 ${100 - cov.e}% 0 ${cov.s}%)">${time}</span>`
    : '';
  return `<button class="${bubble(st, src, isSel, cov, full)}" title="${esc(title)}"
    data-act="slot" data-di="${di}" data-hi="${hi}" data-pi="${pi}"><span>${time}</span>${ovl}</button>`;
}

/* Hours fall into four named bands. Both grids group by them, so an operator
   scanning for "something this evening" has one block to look at. */
const bandOf = h => h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Late night';

/* `cellsFor(h, hi)` returns one row's worth of buttons — the week grid maps
   over days, the day grid over pitches. */
function buildBands(hrs, cellsFor){
  const bands = [];
  hrs.forEach((h, hi) => {
    const name = bandOf(h);
    let b = bands[bands.length - 1];
    if (!b || b.name !== name){ b = { name, rows:[], firstH:h }; bands.push(b); }
    b.lastH = h;
    b.rows.push({ h, hi, cells: cellsFor(h, hi) });
  });
  return bands;
}

/* Each band collapses on its own — the header stays clickable and keeps
   showing its time span even when the rows underneath are hidden, so
   Morning/Afternoon/Evening/Late night double as a table of contents. */
function bandsHtml(bands, withHourLabel){
  return bands.map(b => {
    const closed = !!S.collapsedBands[b.name];
    return `<div class="band${closed ? ' closed' : ''}">
    <button class="band-head" data-act="toggle-band" data-v="${b.name}" aria-expanded="${!closed}">
      <i class="band-chev">&#9662;</i>
      <span class="band-name">${b.name}</span>
      <i class="band-rule"></i>
      <span class="band-span">${rng12(b.firstH * 60, (b.lastH + 1) * 60)}</span>
      <span class="band-toggle">${closed ? 'Show' : 'Hide'}</span>
    </button>
    ${closed ? '' : b.rows.map(r => `<div class="bandrow">
      ${withHourLabel ? `<span class="hourlbl">${hourRng12(r.h)}</span>` : ''}
      ${r.cells.join('')}
    </div>`).join('')}
  </div>`;
  }).join('');
}

/* ─── availability: the selection panel ───────────────── */
function selectionHtml(){
  const hrs = hours(), ws = weekStart(), sel = S.sel;
  const h = hrs[sel.hi];
  const d = new Date(ws); d.setDate(d.getDate() + sel.di);
  const p = PITCHES[S.pitch];
  const k = slotKey(sel.di, sel.hi);
  const cov = coverage(S.pitch, sel.di, h);

  /* A custom booking sits on top of whatever the generated grid said. */
  if (cov){
    const c = cov.c;
    const rows = [
      ['Duration', (c.end - c.start) + ' min'],
      ['Booked via', 'Counter · custom'],
      ['Payment', c.pay],
    ].concat(c.team ? [['Name / team', c.team]] : [])
     .concat(c.contact ? [['Contact', c.contact]] : []);
    return `<div class="panel">
      <div class="panel-head">
        <span class="tag ondark">Custom booking</span>
        <button class="x" data-act="clear-sel">&times;</button>
      </div>
      <div class="sel-time">${rng12(c.start, c.end)}</div>
      <div class="sel-where">${DOWL[sel.di]}, ${d.getDate()} ${MON[d.getMonth()]} &middot; ${esc(p.name)} &middot; ${esc(p.sub)}</div>
      <div class="drule" style="margin:16px 0 4px"></div>
      ${rows.map(r => `<div class="drow"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}
      <div style="display:flex;gap:9px;margin-top:14px">
        <button class="dbtn primary" data-act="drop-custom">Release this booking</button>
      </div>
    </div>`;
  }

  const st = statusFor(sel.di, sel.hi, S.pitch);
  const saved = S.details[k];
  const rows = st === 'booked' || st === 'hold'
    ? [
        ['Booked via', sourceFor(sel.di, sel.hi, S.pitch) === 'app' ? 'Turf app · online' : 'Counter · walk-in'],
        ['Contact', (saved && saved.contact) || CONTACTS[Math.floor(rnd(sel.hi, sel.di, 7) * CONTACTS.length)]],
        ['Format', p.sub],
        ['Payment', (saved && saved.pay) || (st === 'hold' ? 'Unpaid · 20 min left' : 'Payment at venue')],
        ['Amount', money(p.rate)],
      ].concat(saved && saved.team  ? [['Team', saved.team]] : [])
       .concat(saved && saved.notes ? [['Notes', saved.notes]] : [])
    : st === 'blocked'
    ? (() => {
        const bl = S.blocks[k];
        return [
          ['Reason', bl ? bl.reason : 'Turf re-lay'],
          ['Blocked by', bl ? bl.by : 'Grounds team'],
          ['Logged', bl ? bl.at : 'Last Monday'],
          ['Revenue lost', money(p.rate)],
        ];
      })()
    : [
        ['Rate', money(p.rate) + ' / hour'],
        ['Format', p.sub],
        ['Floodlights', h >= 18 ? 'Required (+₹300)' : 'Not needed'],
        ['Deposit', '₹500'],
      ];

  const primaryLabel = st === 'free' ? 'Book this slot'
    : st === 'hold' ? 'Confirm hold' : st === 'booked' ? 'Release slot' : 'Reopen slot';

  /* booked → the details form; free → duration + hold + maintenance block */
  const detail = st === 'booked' ? `
    <div class="drule" style="margin:12px 0 0;padding-top:12px">
      <button class="toggle-form${S.formOpen ? ' on' : ''}" data-act="toggle-form">
        ${S.formOpen ? 'Hide booking details' : 'Edit booking details'}</button>
      ${S.formOpen ? `<div style="margin-top:2px">
        ${formFieldsHtml('sel')}
        <span class="dlabel" style="margin:11px 0 6px">Payment status</span>
        <div class="optrow wide">${PAY_FORM.map(o =>
          `<button class="${segCls(S.form.pay === o, true)}" data-act="form-pay" data-v="${esc(o)}">${o}</button>`).join('')}</div>
        <button class="save-details" data-act="save-details">Save details</button>
      </div>` : ''}
    </div>` : '';

  const durbox = st === 'free' ? `
    <div class="durbox">
      <div class="durbox-head">
        <span class="dlabel" style="margin:0">Duration</span>
        <span class="val">${rng12(h * 60, h * 60 + S.dur)}</span>
      </div>
      <div class="durbox-row">
        <button class="step" data-act="dur" data-v="-30" title="Reduce 30 min"${S.dur <= 30 ? ' disabled' : ''}>&minus;</button>
        <div class="mid">
          <b>${S.dur} min</b>
          <small>${S.dur === 60 ? 'Standard hour' : 'Custom length · billed pro rata'}</small>
        </div>
        <button class="step" data-act="dur" data-v="30" title="Extend 30 min"${S.dur >= 240 ? ' disabled' : ''}>+</button>
      </div>
    </div>` : '';

  const ready = blockReady();
  const blockbox = st === 'free' ? `
    <div style="margin-top:12px">
      <button class="block-toggle" data-act="toggle-block">
        ${S.blockOpen ? 'Cancel maintenance block' : 'Block for maintenance'}</button>
      ${S.blockOpen ? `<div class="blockbox">
        <div class="blockbox-warn">
          <i></i>
          <p>Blocking removes a sellable slot. Every block is logged to the owner
            audit trail against your name and reviewed weekly.</p>
        </div>
        <label>
          <span class="dlabel">Reason &mdash; written, min 15 characters</span>
          <textarea class="reason" id="b-reason" data-act="reason"
            placeholder="Describe the work and why this slot cannot be sold">${esc(S.blockReason)}</textarea>
        </label>
        <div class="reason-count">${S.blockReason.trim().length} / 15</div>
        <button class="holdbtn" id="holdBtn" data-act="hold-block"${ready ? '' : ' disabled'}>
          <span class="fill" id="holdFill"></span>
          <span class="lbl" id="holdLbl">${ready
            ? (S.holdPct > 0 ? 'Keep holding… ' + Math.round(S.holdPct) + '%' : 'Press and hold 2s to block')
            : 'Write a reason to continue'}</span>
        </button>
      </div>` : ''}
    </div>` : '';

  return `<div class="panel">
    <div class="panel-head">
      <span class="tag ondark">${label(st)}</span>
      <button class="x" data-act="clear-sel">&times;</button>
    </div>
    <div class="sel-time">${hourRng12(h)}</div>
    <div class="sel-where">${DOWL[sel.di]}, ${d.getDate()} ${MON[d.getMonth()]} &middot; ${esc(p.name)} &middot; ${esc(p.sub)}</div>
    <div class="drule" style="margin:16px 0 4px"></div>
    ${rows.map(r => `<div class="drow"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}
    ${detail}
    ${durbox}
    <div style="display:flex;gap:9px;margin-top:14px">
      <button class="dbtn primary" data-act="sel-primary">${primaryLabel}</button>
      ${st === 'free' && S.dur === 60 ? '<button class="dbtn" data-act="sel-hold">Hold slot</button>' : ''}
      ${st === 'hold' ? '<button class="dbtn" data-act="sel-release">Release hold</button>' : ''}
    </div>
    ${blockbox}
  </div>`;
}

/* Shared by the aside form and the confirm dialog — same three fields. */
function formFieldsHtml(ns){
  return [
    { k:'team',    label:'Name / team · required',   ph:'e.g. Northside FC' },
    { k:'contact', label:'Contact number · required', ph:'+91 ' },
    { k:'notes',   label:'Notes (optional)',          ph:'Bibs, coaching, floodlights…' },
  ].map(f => `<label class="dfield">
      <span class="dlabel">${f.label}</span>
      <input class="dinput" id="${ns}-${f.k}" data-act="form-field" data-k="${f.k}"
        value="${esc(S.form[f.k])}" placeholder="${esc(f.ph)}">
    </label>`).join('');
}

function customPanelHtml(){
  const ok = S.cName.trim() && S.cPhone.trim().length >= 6;
  const ws = weekStart();
  return `<div class="panel">
    <div class="panel-head">
      <b class="panel-title">Custom time slot</b>
      <button class="x" data-act="close-custom">&times;</button>
    </div>
    <span class="dlabel" style="margin-bottom:6px">Day</span>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${DOW.map((d, i) => {
        const dd = new Date(ws); dd.setDate(dd.getDate() + i);
        const on = S.cDay === i;
        return `<button data-act="c-day" data-v="${i}" style="height:34px;padding:0 12px;border-radius:11px;
          border:0;cursor:pointer;font:${on ? 700 : 600} 12.5px var(--sans);
          background:${on ? '#fff' : 'var(--field)'};color:${on ? 'var(--ink)' : 'var(--d-muted)'}"
          >${d} ${dd.getDate()}</button>`;
      }).join('')}
    </div>
    <label style="display:block;margin-top:13px">
      <span class="dlabel">Start time</span>
      <input class="dinput time" id="c-start" type="time" step="1800" value="${esc(S.cStart)}" data-act="c-start">
    </label>
    <span class="dlabel" style="margin:13px 0 6px">Duration</span>
    <div class="optrow">
      ${[60,90,120,150].map(d => `<button class="${segCls(S.cDur === d, true)}" data-act="c-dur" data-v="${d}"
        >${d < 120 ? d + ' min' : Math.floor(d / 60) + ' hr' + (d % 60 ? ' 30' : '')}</button>`).join('')}
    </div>
    <div style="font:700 15px var(--sans);color:var(--lime);margin:13px 0 3px">
      ${rng12(toMin(S.cStart), toMin(S.cStart) + S.cDur)} &middot; ${esc(PITCHES[S.pitch].name)}
    </div>
    <div class="drule" style="margin:10px 0 13px"></div>
    <label class="dfield">
      <span class="dlabel">Name / team · required</span>
      <input class="dinput" id="c-name" data-act="c-field" data-k="cName" value="${esc(S.cName)}" placeholder="e.g. Northside FC">
    </label>
    <label class="dfield">
      <span class="dlabel">Contact number · required</span>
      <input class="dinput" id="c-phone" data-act="c-field" data-k="cPhone" value="${esc(S.cPhone)}" placeholder="+91 ">
    </label>
    <span class="dlabel" style="margin:11px 0 6px">Payment status</span>
    <div class="optrow">
      ${PAY_FORM.map(o => `<button class="${segCls(S.cPay === o, true)}" data-act="c-pay" data-v="${esc(o)}">${o}</button>`).join('')}
    </div>
    <button data-act="add-custom" style="width:100%;height:50px;border-radius:18px;border:0;margin-top:13px;
      background:var(--lime);color:var(--ink);font:700 14.5px var(--sans);
      cursor:${ok ? 'pointer' : 'not-allowed'};opacity:${ok ? 1 : 0.45}">Confirm custom booking</button>
  </div>`;
}

function viewAvailability(){
  const hrs = hours(), ws = weekStart();
  const isDay = S.availMode === 'day';

  /* Week totals for the selected pitch — drives the legend, KPIs and bars. */
  let free = 0, total = 0, online = 0;
  for (let di = 0; di < 7; di++) hrs.forEach((h, hi) => {
    total++;
    const cov = coverage(S.pitch, di, h);
    const st  = cov ? 'booked' : statusFor(di, hi, S.pitch);
    const src = cov ? 'counter' : sourceFor(di, hi, S.pitch);
    if (st === 'free') free++;
    if (st === 'booked' && src === 'app') online++;
  });

  const weekEnd = new Date(ws); weekEnd.setDate(weekEnd.getDate() + 6);
  const weekLabel = ws.getDate() + ' ' + MON[ws.getMonth()] + ' – ' + weekEnd.getDate() + ' ' + MON[weekEnd.getMonth()];

  const legend = [
    ['free', null, 'Open'], ['booked','app','Booked in app'], ['booked','counter','Booked at counter'],
    ['hold', null, 'On hold'], ['blocked', null, 'Maintenance'],
  ].map(([st, src, txt]) => {
    const swatch = st === 'free' ? 'background:var(--paper);border:1px solid var(--edge2)'
      : st === 'booked' && src === 'app' ? 'background:var(--lime);border:1px solid var(--lime-deep)'
      : st === 'booked' ? 'background:var(--ink);border:1px solid var(--ink)'
      : st === 'hold' ? 'background:var(--lime-tint);border:1px solid var(--lime-tint)'
      : 'background:var(--soft);border:1px solid var(--soft)';
    return `<span><i style="${swatch}"></i>${txt}</span>`;
  }).join('') +
  `<span><i style="border:1px solid var(--ink);background:linear-gradient(90deg,#fff 0 50%,var(--ink) 50% 100%)"></i>Part-booked (custom)</span>`;

  /* ── Week grid: one pitch, seven days ── */
  const tint = tintFor(S.pitch);
  const days = DOW.map((dow, di) => {
    const d = new Date(ws); d.setDate(d.getDate() + di);
    let booked = 0;
    hrs.forEach((h, hi) => {
      if ((coverage(S.pitch, di, h) ? 'booked' : statusFor(di, hi, S.pitch)) !== 'free') booked++;
    });
    return { dow, dayNum:d.getDate(), month:MON[d.getMonth()],
      load: Math.round((booked / hrs.length) * 100), today: di === 0 };
  });

  /* Which pitch you are on is the other half of "what am I about to book", so
     it rides in the sticky region alongside the weekdays. */
  const pitchChips = `<div class="pitchpicker">
    ${PITCHES.map((p, i) => `<button class="${chipCls(i === S.pitch)}" data-act="pitch" data-v="${i}"
      ${i === S.pitch || !S.showPitchColors ? ''
        : `style="background:${pitchColorFor(i)};border-color:${pitchColorFor(i)};color:#fff"`}
      >${esc(p.name)}</button>`).join('')}
  </div>`;

  const weekGrid = `<div class="gridcard" style="${tintVars(tint)}">
    <div class="gridsticky">
      <div class="gridtop">
        ${pitchChips}
        <span class="grid-soft push">${esc(PITCHES[S.pitch].sub)} &middot; ${free} of ${total} open this week</span>
      </div>
      <div class="daystrip">
        ${days.map((d, di) => `<div>
          <div class="dayhead${d.today ? ' today' : ''}">
            <small>${d.dow}</small><b>${d.dayNum}</b><span class="mon">${d.month}</span>
          </div>
          <div class="dayload">
            <i style="background:${d.load >= 70 ? 'var(--ink)' : 'var(--lime)'}"></i>${d.load}% full
          </div>
        </div>`).join('')}
      </div>
    </div>
    ${bandsHtml(buildBands(hrs, (h, hi) => days.map((_, di) => slotHtml(di, hi, h, S.pitch))), false)}
  </div>`;

  /* ── Day grid: one date, every pitch side by side ──
     This is the counter question — "anything free 6–10pm?" — answered without
     tabbing through each pitch in turn. */
  const di = S.dayIndex;
  const dayDate = new Date(ws); dayDate.setDate(dayDate.getDate() + di);
  let dayFree = 0, dayTotal = 0;
  const pitchOpen = PITCHES.map((p, pi) => {
    let f = 0;
    hrs.forEach((h, hi) => {
      dayTotal++;
      const isFree = !coverage(pi, di, h) && statusFor(di, hi, pi) === 'free';
      if (isFree){ f++; dayFree++; }
    });
    return f;
  });

  /* Relative naming where it helps, plus a week of one-tap jumps — a counter
     is almost always asked about today, tomorrow or the coming weekend. */
  const offsetNow = daysFromToday(S.weekOffset, di);
  const relNow = relDay(offsetNow);
  const jumps = Array.from({ length: 8 }, (_, n) => {
    const d = dateAt(n);
    /* DOW is Monday-first; Date.getDay() is Sunday-first. */
    return { n, on: n === offsetNow,
      label: relDay(n) || DOW[(d.getDay() + 6) % 7] + ' ' + d.getDate() };
  });
  /* Anything outside the eight quick chips is reachable by date instead, and
     the picker itself then reads as the active choice. */
  const customDay = offsetNow < 0 || offsetNow > 7;

  const dayGrid = `<div class="gridcard daycard" style="--cols:${PITCHES.length}">
    <div class="gridsticky">
      <div class="gridtop">
      <div class="gridcard-head">
        <div class="daynav">
          <button class="rbtn sm" data-act="day" data-v="-1" title="Previous day">&#8592;</button>
          <div class="daynav-now">
            <b>${relNow || DOWL[di]}</b>
            <span>${relNow ? DOWL[di] + ' &middot; ' : ''}${dayDate.getDate()} ${MON[dayDate.getMonth()]} ${dayDate.getFullYear()}</span>
          </div>
          <button class="rbtn sm" data-act="day" data-v="1" title="Next day">&#8594;</button>
        </div>
        <span class="grid-soft dark">${dayFree} of ${dayTotal} open across ${PITCHES.length} pitches</span>
      </div>
      <div class="dayjump">
        ${jumps.map(j => `<button class="jchip${j.on ? ' on' : ''}" data-act="day-jump" data-v="${j.n}"
          >${j.label}</button>`).join('')}
        <label class="jchip jdate${customDay ? ' on' : ''}" title="Jump to any date">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"></rect>
            <path d="M16 3v4M8 3v4M3 11h18"></path></svg>
          <span>${customDay ? dayDate.getDate() + ' ' + MON[dayDate.getMonth()] : 'Pick date'}</span>
          <input type="date" value="${isoDate(dayDate)}" data-act="day-date" aria-label="Jump to date">
        </label>
      </div>
      </div>
      <div class="pitchstrip">
        <span class="hourlbl head">Time</span>
        ${PITCHES.map((p, pi) => `<div class="pitchcol${pi === S.pitch ? ' on' : ''}"
          style="${S.showPitchColors ? `--col-accent:${pitchColorFor(pi)}` : ''}">
          <b>${esc(p.name)}</b>
          <span>${esc(p.sub)}</span>
          <span class="open">${pitchOpen[pi]} of ${hrs.length} open</span>
        </div>`).join('')}
      </div>
    </div>
    ${bandsHtml(buildBands(hrs, (h, hi) => PITCHES.map((_, pi) => slotHtml(di, hi, h, pi))), true)}
  </div>`;

  const pitchLoad = PITCHES.map((p, pi) => {
    let bk = 0, t = 0;
    for (let di = 0; di < 7; di++) hrs.forEach((h, hi) => {
      t++;
      if (coverage(pi, di, h) || statusFor(di, hi, pi) !== 'free') bk++;
    });
    const pct = Math.round((bk / t) * 100);
    return `<div class="loadrow">
      <div class="top"><span>${esc(p.name)}</span><b>${pct}%</b></div>
      <div class="track"><div class="fill" style="${hbar(pct)}"></div></div>
    </div>`;
  }).join('');

  return `<main class="avail">
    <section class="avail-main">
      <div class="headrow">
        <div class="headrow-lead">
          <div class="headrow-title">
            <div class="kicker">Week of ${weekLabel}</div>
            <h1 class="h1">Slot availability</h1>
          </div>
          <div class="modeseg">
            <button class="modeopt${isDay ? ' on' : ''}" data-act="avail-mode" data-v="day">All pitches</button>
            <button class="modeopt${isDay ? '' : ' on'}" data-act="avail-mode" data-v="week">One pitch</button>
          </div>
        </div>
        <div class="headrow-tools">
          <div class="nudge">
            <button class="rbtn" data-act="week" data-v="-1" title="Previous week">&#8592;</button>
            <button class="rbtn" data-act="week" data-v="1" title="Next week">&#8594;</button>
          </div>
          <button class="pillbtn" data-act="open-custom">+ Custom time slot</button>
        </div>
      </div>

      <div class="legend">${legend}<span class="fill">${isDay
        ? dayFree + ' of ' + dayTotal + ' slots open on ' + DOW[di] + ' ' + dayDate.getDate()
        : free + ' of ' + total + ' slots open this week'}</span></div>

      ${isDay ? dayGrid : weekGrid}
    </section>

    <aside class="aside">
      ${S.customOpen ? customPanelHtml() : ''}
      ${S.sel ? selectionHtml() : `<div class="noselect">
        <b>No slot selected</b>
        <p>Tap a time bubble to see the booking, confirm a hold, or block the slot for maintenance.</p>
      </div>`}
      <div class="loadcard">
        <div class="cap">Pitch load, this week</div>
        ${pitchLoad}
      </div>
    </aside>
  </main>`;
}

/* ─── sessions ────────────────────────────────────────── */
const STATUS_ORDER = { running:0, upcoming:1, done:2, noshow:3 };

function buildSessions(){
  const now = nowMin();
  return sess().slice()
    .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (a.start - b.start))
    .map(s => {
      const p = PITCHES[s.pitch];
      const running = s.status === 'running', upcoming = s.status === 'upcoming';
      const done = s.status === 'done';
      const left = s.end - now;
      const over = running && left < 0;
      const elapsed = running ? now - (s.startedAt || s.start) : 0;
      const pct = running ? Math.max(0, Math.min(100, ((now - s.start) / (s.end - s.start)) * 100)) : done ? 100 : 0;
      const amount = Math.round(p.rate * (s.end - s.start) / 60);
      const unpaid = s.pay !== 'Payment done';
      const duePay = done && unpaid;

      return {
        raw:s, id:s.id, pitchIndex:s.pitch, team:s.team, contact:s.contact,
        pitchName: p.name + ' · ' + p.sub, range: rng12(s.start, s.end),
        status:s.status, running, upcoming, done, over, unpaid, duePay, pct, amount,
        onLive: running || duePay, awaitingPay: duePay,
        focused: S.focusSession === s.id,
        statusLabel: over ? 'Overtime' : running ? 'In play' : upcoming ? 'Up next'
          : done ? (unpaid ? 'Payment due' : 'Completed') : 'No-show',
        statusCls: over ? 'over' : running ? 'play' : duePay ? 'duepay' : '',
        sourceLabel: s.source === 'app' ? 'App' : 'Counter',
        sourceCls: s.source === 'app' ? 'via-app' : '',
        payLabel: s.pay === 'Advance paid'
          ? money(s.advance || 0) + ' of ' + money(amount) + ' paid · ' + money(Math.max(0, amount - (s.advance || 0))) + ' due'
          : s.pay === 'Payment done'
          ? 'Paid ' + money(s.collected != null ? s.collected : amount)
            + (s.payMode ? ' · ' + s.payMode : '')
            + (s.collected != null && s.collected < amount ? ' · ' + money(amount - s.collected) + ' discount' : '')
          : s.pay,
        amountSuffix: s.pay === 'Advance paid' || s.pay === 'Payment done' ? '' : ' · ' + money(amount),
        clock: running ? (over ? '+' + durTxt(-left) + ' over' : durTxt(left) + ' left')
          : upcoming ? 'starts in ' + durTxt(Math.max(0, s.start - now))
          : done ? 'ended ' + t12(s.endedAt || s.end) : '—',
        elapsedLabel: running ? durTxt(Math.max(0, elapsed)) + ' played · ' : '',
        liveNote: duePay ? 'Match finished · collect payment to clear' : '',
        actions: (running
          ? [{ label:'Mark complete', primary:true, act:'ask-done' }, { label:'+30 min', act:'plus30' }]
          : upcoming
          ? [{ label:'Mark started', primary:true, act:'mark-started' }, { label:'No-show', act:'noshow' }]
          : s.status === 'noshow'
          ? [{ label:'Undo no-show', act:'undo-noshow' }]
          : []
        ).concat(unpaid && s.status !== 'noshow' ? [{ label:'Collect money', act:'collect' }] : []),
      };
    });
}

const matchOptsHtml = (c, dark = false) => `<div class="opts">${MATCH_STATES.map(m =>
  `<button class="${segCls(c.status === m.k, dark)}" data-act="match" data-id="${c.id}" data-v="${m.k}">${m.label}</button>`).join('')}</div>`;
const payOptsHtml = (c, dark = false) => `<div class="opts">${PAY_STATES.map(o =>
  `<button class="${segCls(c.raw.pay === o, dark)}" data-act="pay" data-id="${c.id}" data-v="${esc(o)}">${payShort(o)}</button>`).join('')}</div>`;

/* The full-detail card, for the Live now board. Everything an operator needs
   for a match in progress without touching another screen: elapsed time,
   remaining time, contact, what is owed, and the actions. */
function liveCardHtml(c){
  const dark = c.running;
  const cls = 'scard big' + (c.duePay ? ' duepay' : dark ? ' live' : '') + (c.focused ? ' focus' : '');
  return `<div class="${cls}">
    <div class="row">
      <span class="sstat ${c.statusCls}">${c.statusLabel}</span>
      <span class="ssrc ${c.sourceCls}">${c.sourceLabel}</span>
      <span class="bigclock">${c.clock}</span>
    </div>
    <div>
      <b class="team">${esc(c.team)}</b>
      <span class="sub">${esc(c.pitchName)} &middot; ${c.range}</span>
    </div>
    <div class="strack"><div class="fill${c.over ? ' over' : ''}" style="width:${c.pct}%"></div></div>
    <div class="split">
      <span class="sub">${c.elapsedLabel}${esc(c.contact)}</span>
      <span class="pay${c.unpaid ? ' due' : ''}">${esc(c.payLabel)}${c.amountSuffix}</span>
    </div>
    ${c.liveNote ? `<span class="sub">${c.liveNote}</span>` : ''}
    <div class="acts">${c.actions.map(a =>
      `<button class="act${a.primary ? ' primary' : ''}" data-act="${a.act}" data-id="${c.id}">${a.label}</button>`).join('')}</div>
  </div>`;
}

/* The Live now rail — the side panel of the Sessions view, the way the
   selection panel is the side panel of Availability. */
function liveRailHtml(cards){
  const live = cards.filter(c => c.onLive);
  const next = cards.filter(c => c.upcoming).sort((a, b) => a.raw.start - b.raw.start)[0];
  return `<aside class="sess-aside" id="liveRail">
    <div class="railhead">
      <span class="kicker dot" style="margin:0"><i style="background:var(--red)"></i>Live now</span>
      <span class="count">${live.length ? live.length + ' on the pitch' : 'nothing running'}</span>
    </div>
    ${live.length
      ? live.map(liveCardHtml).join('')
      : `<div class="empty">No match in play right now.${next
          ? ' Next up is ' + esc(next.team) + ' on ' + esc(next.pitchName) + ' at ' + t12(next.raw.start) + '.'
          : ''}</div>`}
  </aside>`;
}

function timelineHtml(pi){
  const now = nowMin();
  const raw = sess().filter(s => s.pitch === pi);
  const blocks = raw.map(s => {
    const running = s.status === 'running';
    const bg = s.status === 'noshow' ? 'var(--edge2)' : s.status === 'done' ? 'var(--done)'
      : running ? 'var(--lime)' : 'var(--ink)';
    const w = pos(s.end) - pos(s.start);
    const onDark = !running && s.status !== 'done' && s.status !== 'noshow';
    const word = running ? 'LIVE' : s.status === 'done' ? 'DONE' : s.status === 'noshow' ? 'NO-SHOW' : 'NEXT';
    const color = s.status === 'noshow' ? 'var(--body)' : running || s.status === 'done' ? 'var(--ink)' : '#fff';
    const title = s.team + ' · ' + rng12(s.start, s.end) + ' · '
      + (s.status === 'done' ? 'finished' : s.status) + ' · ' + s.pay;
    return `<div class="tl-block" title="${esc(title)}" data-act="tl-block" data-id="${s.id}"
      style="left:${pos(s.start)}%;width:${w}%;background:${bg};color:${color};
        border:${running ? '1.5px solid var(--ink)' : '0'};
        box-shadow:${S.focusSession === s.id ? '0 0 0 2px var(--ink)' : 'none'}">
      <span>${w >= 22 ? esc(s.team) : ''}</span>
      <span class="tl-marks">
        ${w >= 14 ? `<span class="tl-word${onDark ? ' ondark' : ''}">${word}</span>` : ''}
        ${s.status === 'done' ? '<span class="tick-dot match">✓</span>' : ''}
        ${s.pay === 'Payment done' ? '<span class="tick-dot paid">✓</span>' : ''}
      </span>
    </div>`;
  }).join('');

  const ticks = Array.from({ length: Math.floor(SPAN / 120) + 1 }, (_, i) => DAY_START + i * 120)
    .filter(m => m <= DAY_END)
    .map(m => `<span style="left:${pos(m)}%">${t12(m)}</span>`).join('');

  return `<div class="timeline">
    <div class="tl-track">
      ${blocks}
      <div class="tl-nowdot" style="left:${pos(now)}%"></div>
      <div class="tl-now" style="left:${pos(now)}%"></div>
    </div>
    <div class="tl-ticks">${ticks}</div>
  </div>`;
}

function viewSessions(){
  const now = nowMin();
  const cards = buildSessions();
  const runCount  = sess().filter(s => s.status === 'running').length;
  const upCount   = sess().filter(s => s.status === 'upcoming').length;
  const doneCount = sess().filter(s => s.status === 'done').length;
  const toCollect = collectTotal();

  /* One compact strip instead of four large tiles — same numbers, a fifth of
     the vertical space, so the pitches and the session list stay above fold. */
  const statbar = `<div class="statbar">
    ${[['In play', String(runCount), runCount > 0],
       ['Up next', String(upCount), false],
       ['Completed', String(doneCount), false],
       ['Awaiting payment', String(cards.filter(c => c.awaitingPay).length), false],
       ['To collect', money(toCollect), toCollect > 0]]
      .map(([l, v, hot]) => `<div class="stat${hot ? ' hot' : ''}">
        <span class="lbl">${l}</span><b>${v}</b></div>`).join('')}
  </div>`;

  const marks = [
    ['NEXT','Not started','var(--ink)','#fff',false],
    ['LIVE','In play','var(--lime)','var(--ink)',false],
    ['DONE','Finished','var(--done)','var(--ink)',false],
    ['✓','Match finished','var(--blue)','#fff',true],
    ['✓','Payment received','var(--green)','#fff',true],
  ].map(([m, t, bg, fg, dot]) =>
    `<span><b class="${dot ? 'dot' : ''}" style="background:${bg};color:${fg}">${m}</b>${t}</span>`).join('');

  /* Head + timeline only. The session detail and its controls live once, in
     the table below — repeating them per pitch was the same row three times. */
  const sections = PITCHES.map((p, pi) => {
    const raw = sess().filter(s => s.pitch === pi);
    const isLive = raw.some(s => s.status === 'running');
    const next = raw.filter(s => s.status === 'upcoming').sort((a, b) => a.start - b.start)[0];
    const busy = raw.filter(s => s.status !== 'noshow').reduce((n, s) => n + (s.end - s.start), 0);
    return `<div class="pitchsec">
      <div class="pitchhead${S.showPitchColors ? '' : ' neutral'}${isLive ? ' live' : ''}" style="${tintVars(tintFor(pi))}">
        <b>${esc(p.name)}</b>
        <span class="sub">${esc(p.sub)}</span>
        <span class="state${isLive ? ' live' : ''}">${isLive ? 'In play now' : next ? 'Next ' + t12(next.start) : 'Idle rest of day'}</span>
        <span class="end">
          <span class="sub">${durTxt(busy)} booked</span>
          <b>${rng12(DAY_START, DAY_END)}</b>
        </span>
      </div>
      ${timelineHtml(pi)}
    </div>`;
  }).join('');

  const rowsFor = list => list.map(c => `<div class="strow${c.focused ? ' focus' : ''}" id="row-${c.id}">
    <div class="whn">
      <b>${c.range}</b>
      <span>${c.clock}</span>
    </div>
    <div class="who">
      <b>${esc(c.team)}</b>
      <span>${esc(c.pitchName)} &middot; ${esc(c.contact)}</span>
    </div>
    <div class="stt">
      <span class="sstat ${c.statusCls}">${c.statusLabel}</span>
      <span class="ssrc ${c.sourceCls}">${c.sourceLabel}</span>
      ${c.done ? '<span class="rowtick match" title="Match finished">&#10003;</span>' : ''}
      ${!c.unpaid ? '<span class="rowtick paid" title="Payment received">&#10003;</span>' : ''}
    </div>
    ${matchOptsHtml(c)}
    <div class="paycell">
      ${payOptsHtml(c)}
      <span class="pay${c.unpaid ? ' due' : ''}">${esc(c.payLabel)}${c.amountSuffix}</span>
    </div>
    <div class="xtra">
      ${c.running ? `<button class="mini" data-act="plus30" data-id="${c.id}" title="Extend 30 minutes">+30</button>` : ''}
    </div>
  </div>`).join('');

  const focused = cards.find(c => c.focused);

  return `<main class="sessions">
    <section class="sess-main">
      <div class="headrow">
        <div class="headrow-lead">
          <div class="headrow-title">
            <div class="kicker dot"><i style="background:var(--lime)"></i>Live &middot; ${t12(now)}</div>
            <h1 class="h1">Ongoing sessions</h1>
          </div>
        </div>
        ${statbar}
      </div>

      <div class="sess-sec">
        <div class="sechead">
          <h2 class="h2 sm">Today by pitch</h2>
          <div class="legendmarks">${marks}</div>
        </div>
        <div class="pitchgrid">${sections}</div>
      </div>

      <div class="sess-sec">
        <div class="sechead">
          <h2 class="h2 sm">All sessions today</h2>
          <span class="count">${cards.length} session${cards.length === 1 ? '' : 's'}${
            focused ? ' &middot; showing ' + esc(focused.team) : ''}</span>
          ${focused ? '<button class="mini clear" data-act="clear-focus">Show all</button>' : ''}
        </div>
        <div class="stable">
          <div class="sthead">
            <span>Time</span><span>Team &amp; pitch</span><span>Status</span>
            <span>Match</span><span>Payment</span><span></span>
          </div>
          ${rowsFor(focused ? [focused] : cards)}
        </div>
      </div>
    </section>

    ${liveRailHtml(cards)}
  </main>`;
}

/* ─── reminders ───────────────────────────────────────── */
function relTime(m){
  const now = nowMin();
  const d = Math.round(m - now);
  if (Math.abs(d) < 1) return 'now';
  return d > 0 ? 'in ' + (d >= 60 ? durTxt(d) : d + ' min')
    : (Math.abs(d) >= 60 ? durTxt(-d) : -d + ' min') + ' ago';
}

function buildAlerts(){
  const now = nowMin();
  const game = [], cash = [];
  sess().forEach(s => {
    const p = PITCHES[s.pitch];
    const total = Math.round(p.rate * (s.end - s.start) / 60);
    const outstanding = Math.max(0, total - (s.advance || 0));
    if (s.status === 'upcoming'){
      const late = now - s.start;
      game.push({ kind:'game', at:s.start, urgent:late > 5,
        tag: late > 5 ? 'Not started' : 'Starts soon',
        title: s.team + ' · ' + p.name,
        body: late > 5 ? 'Slot began ' + Math.round(late) + ' min ago and the timer is not running.'
          : 'Booked ' + rng12(s.start, s.end) + '. Start the timer when they take the pitch.',
        action:'Start timer', act:'alert-timer', id:s.id });
    }
    if (s.status === 'running' && now > s.end){
      game.push({ kind:'game', at:s.end, urgent:true, tag:'Overtime',
        title: s.team + ' · ' + p.name,
        body: 'Running ' + durTxt(now - s.end) + ' past the booked end time.',
        action:'End session', act:'alert-done', id:s.id });
    }
    if (s.pay !== 'Payment done' && s.status !== 'noshow'){
      cash.push({ kind:'cash', at:s.end, urgent:s.status === 'done',
        tag: s.status === 'done' ? 'Overdue' : s.pay === 'Advance paid' ? 'Balance due' : 'Due at venue',
        title: money(outstanding) + ' · ' + s.team,
        body: p.name + ' · ' + rng12(s.start, s.end) + ' · ' + s.contact
          + (s.advance ? ' · ' + money(s.advance) + ' advance received' : ''),
        action:'Collect', act:'alert-collect', id:s.id });
    }
  });
  game.sort((a, b) => a.at - b.at);
  cash.sort((a, b) => a.at - b.at);
  return { game, cash, other: OTHER_ALERTS.map(o => Object.assign({ kind:'other' }, o)) };
}

const collectTotal = () => sess()
  .filter(s => s.pay !== 'Payment done' && s.status !== 'noshow')
  .reduce((n, s) => n + Math.max(0, Math.round(PITCHES[s.pitch].rate * (s.end - s.start) / 60) - (s.advance || 0)), 0);

function alertHtml(a){
  const kind = a.urgent ? 'urgent' : a.kind;
  return `<div class="alert ${kind}">
    <div>
      <b class="time">${t12(a.at)}</b>
      <span class="rel">${relTime(a.at)}</span>
    </div>
    <div class="alert-body">
      <div class="line"><span class="atag ${kind}">${esc(a.tag)}</span><b>${esc(a.title)}</b></div>
      <span class="txt">${esc(a.body)}</span>
    </div>
    ${a.action
      ? `<button class="abtn ${kind}" data-act="${a.act}" data-id="${a.id}">${a.action}</button>`
      : '<span></span>'}
  </div>`;
}

function viewAlerts(){
  const { game, cash, other } = buildAlerts();
  const list = (items, empty) => `<div class="alertlist">
    <div class="alert-th"><span>Time</span><span>Reminder</span><span></span></div>
    ${items.map(alertHtml).join('')}
    ${items.length === 0 ? `<div class="alert-none">${empty}</div>` : ''}
  </div>`;

  return `<main class="alerts">
    <div>
      <div class="kicker dot"><i style="background:var(--red)"></i>Live &middot; ${t12(nowMin())}</div>
      <h1 class="h1">Reminders</h1>
    </div>

    <section>
      <div class="sechead"><h2 class="h2 sm">Pending game reminders</h2>
        <span class="count">${game.length} pending</span></div>
      ${list(game, 'Every scheduled match is either running or finished.')}
    </section>

    <section>
      <div class="sechead"><h2 class="h2 sm">Cash collection reminders</h2>
        <span class="count">${money(collectTotal())} across ${cash.length}</span></div>
      ${list(cash, 'Nothing left to collect today.')}
    </section>

    <section>
      <div class="sechead"><h2 class="h2 sm">Other notifications</h2>
        <span class="count">${other.length} updates</span></div>
      <div class="alertlist">${other.map(alertHtml).join('')}</div>
    </section>
  </main>`;
}

/* ─── dashboard ───────────────────────────────────────── */
function viewDashboard(){
  const hrs = hours(), ws = weekStart();
  const weekEnd = new Date(ws); weekEnd.setDate(weekEnd.getDate() + 6);
  const weekLabel = ws.getDate() + ' ' + MON[ws.getMonth()] + ' – ' + weekEnd.getDate() + ' ' + MON[weekEnd.getMonth()];

  let free = 0, total = 0, online = 0;
  const utilBars = [];
  for (let di = 0; di < 7; di++){
    let booked = 0;
    hrs.forEach((h, hi) => {
      total++;
      const cov = coverage(S.pitch, di, h);
      const st  = cov ? 'booked' : statusFor(di, hi, S.pitch);
      const src = cov ? 'counter' : sourceFor(di, hi, S.pitch);
      if (st === 'free') free++; else booked++;
      if (st === 'booked' && src === 'app') online++;
    });
    utilBars.push({ dow: DOW[di], pct: Math.round((booked / hrs.length) * 100) });
  }
  const rate = PITCHES[S.pitch].rate;
  const totalUtil = Math.round(100 - (free / total) * 100);

  const kpis = [
    ['Utilisation', totalUtil + '%', 'This pitch, this week', true],
    ['Confirmed bookings', String(total - free), online + ' in app · ' + (total - free - online) + ' at counter', false],
    ['Week revenue', '₹' + Math.round((total - free) * rate / 1000) + 'K', 'Net of cancellations', false],
    ['Open slots', String(free), 'Available to sell', false],
  ].map(([l, v, n, fill]) => `<div class="tile${fill ? ' fill' : ''}">
    <div class="lbl">${l}</div><div class="val">${v}</div><div class="nte">${n}</div></div>`).join('');

  const hourDemand = [18,19,20,21,17,7,16,12]
    .map(h => ({ time: hourT12(h), pct: Math.round(40 + rnd(h, 2, S.pitch) * 58) }))
    .sort((a, b) => b.pct - a.pct)
    .map(d => `<div class="hrow">
      <span class="t">${d.time}</span>
      <div class="htrack"><div class="fill" style="${hbar(d.pct)}"></div></div>
      <span class="p">${d.pct}%</span>
    </div>`).join('');

  const bookings = [10,11,16,17,18,19,20].map((h, i) => {
    const p = PITCHES[i % 3];
    const st = i === 2 ? 'hold' : 'booked';
    const app = rnd(h, i, 4) < 0.62;
    return `<div class="bkrow">
      <b class="slot">${hourRng12(h)}</b>
      <span>${esc(p.name)}</span>
      <b class="team">${esc(TEAMS[i])}</b>
      <span class="contact">${esc(CONTACTS[i % CONTACTS.length])}</span>
      <span><span class="src${app ? ' via-app' : ''}">${app ? 'App' : 'Counter'}</span></span>
      <span><span class="tag ${st}">${label(st)}</span></span>
      <b class="amt">${money(p.rate + (h >= 18 ? 300 : 0))}</b>
    </div>`;
  }).join('');

  return `<main class="dash">
    <div>
      <div class="kicker">Operations &middot; week of ${weekLabel}</div>
      <h1 class="h1">Dashboard</h1>
    </div>

    <div class="tiles">${kpis}</div>

    <div class="charts">
      <div class="chart">
        <div class="chart-head"><h2 class="h3">Utilisation by day</h2><span class="note">All pitches</span></div>
        <div class="bars">
          ${utilBars.map(b => `<div class="col"><span>${b.pct}%</span><div class="vbar" style="${vbar(b.pct)}"></div></div>`).join('')}
        </div>
        <div class="barlabels">${utilBars.map(b => `<span>${b.dow}</span>`).join('')}</div>
      </div>

      <div class="chart">
        <h2 class="h3" style="margin-bottom:18px">Demand by hour</h2>
        ${hourDemand}
      </div>
    </div>

    <div class="bookings">
      <div class="chart-head" style="margin-bottom:14px">
        <h2 class="h3">Today&rsquo;s bookings</h2><span class="note">Mon, 3 Aug 2026</span>
      </div>
      <div class="bkhead">
        <span>Slot</span><span>Pitch</span><span>Team</span><span>Contact</span><span>Source</span>
        <span>Status</span><span class="r">Amount</span>
      </div>
      ${bookings}
    </div>
  </main>`;
}

/* ─── settings ────────────────────────────────────────── */
function pitchColorRowHtml(p, pi){
  const hex = pitchColorFor(pi);
  const name = PITCH_PALETTE.find(sw => sw.hex === hex)?.name || 'Custom';
  const open = S.colorPickerOpen === pi;
  return `<div class="pcrow">
    <button class="pcrow-id" data-act="toggle-pitch-picker" data-pi="${pi}" aria-expanded="${open}">
      <i style="background:${hex}"></i>
      <div><b>${esc(p.name)}</b><span>${name} &middot; ${hex}</span></div>
      <span class="pcrow-chev">${open ? 'Close' : 'Change'}</span>
    </button>
    ${open ? `<div class="palette">
      ${PITCH_PALETTE.map(sw => `<button class="swatchbtn${sw.hex === hex ? ' on' : ''}" title="${sw.name}"
        aria-label="${sw.name}" aria-pressed="${sw.hex === hex}"
        data-act="set-pitch-color" data-pi="${pi}" data-v="${sw.hex}"
        style="background:${sw.hex}"></button>`).join('')}
    </div>` : ''}
  </div>`;
}

function viewSettings(){
  const on = S.showPitchColors;

  return `<main class="settings">
    <div>
      <div class="kicker">Console</div>
      <h1 class="h1">Settings</h1>
    </div>

    <section class="setcard">
      <div class="chart-head"><h2 class="h3">Appearance</h2>
        <span class="note">Applies to this console only</span></div>

      <div class="setrow">
        <div class="setrow-txt">
          <b>Colour-code pitches</b>
          <span>Gives each pitch its own colour on the availability grid and on its
            section under Sessions. When off, every pitch uses the standard ink and
            lime palette.</span>
        </div>
        <button class="switch${on ? ' on' : ''}" role="switch" aria-checked="${on}"
          data-act="toggle-pitch-colors"><i></i></button>
      </div>

      ${on ? `<div class="pitchcolors">
        <div class="pitchcolors-head">
          <b>Pitch colours</b>
          <span>${PITCH_PALETTE.length} preset colours, chosen to read clearly against ink and lime — no colour wheel.</span>
        </div>
        ${PITCHES.map((p, pi) => pitchColorRowHtml(p, pi)).join('')}
      </div>` : ''}
    </section>
  </main>`;
}

/* ─── modals ──────────────────────────────────────────── */
function confirmDialogHtml(){
  const hrs = hours(), ws = weekStart(), sel = S.sel, mode = S.confirm;
  const h = hrs[sel.hi];
  const d = new Date(ws); d.setDate(d.getDate() + sel.di);
  const p = PITCHES[S.pitch];
  const isHold = mode === 'hold';
  const dur = mode === 'book' ? S.dur : 60;
  const ok = mode === 'confirm-hold' ? true : confirmValid();

  return `<div class="backdrop"><div class="modal wide">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <span class="modal-kicker">${isHold ? 'Confirm hold' : mode === 'confirm-hold' ? 'Convert hold to booking' : 'Confirm booking'}</span>
      <button class="x" data-act="dlg-cancel">&times;</button>
    </div>

    <div class="plate">
      <div class="plate-kicker">You are confirming</div>
      <div class="plate-time">${rng12(h * 60, h * 60 + dur)}</div>
      <div class="plate-dur">${dur === 60 ? '' : dur + ' min booking'}</div>
      <div class="plate-day">${DOWL[sel.di]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}</div>
      <div class="plate-foot">
        <span>${esc(p.name)} &middot; ${esc(p.sub)}</span>
        <b>${money(p.rate * dur / 60 + (h >= 18 ? 300 : 0))}</b>
      </div>
    </div>

    <p class="dnote">${isHold
      ? 'The slot is held for 20 minutes and stays off sale until you confirm or release it.'
      : mode === 'confirm-hold'
      ? 'This converts the existing hold into a confirmed booking. Details already captured are kept.'
      : 'Check the date and time above before confirming. Confirmed slots leave the sellable pool immediately.'}</p>

    ${mode !== 'confirm-hold' ? `<div class="drule" style="margin-top:16px;padding-top:14px">
      ${formFieldsHtml('dlg')}
      <span class="dlabel" style="margin:12px 0 6px">Payment status</span>
      <div class="optrow wide">${PAY_FORM.map(o =>
        `<button class="${segCls(S.form.pay === o, true)}" data-act="form-pay" data-v="${esc(o)}"
          style="height:40px;border-radius:13px">${o}</button>`).join('')}</div>
    </div>` : ''}

    <div style="display:flex;gap:9px;margin-top:18px">
      <button class="dbtn primary" data-act="dlg-confirm"
        style="border-radius:18px;font-size:15px;cursor:${ok ? 'pointer' : 'not-allowed'};opacity:${ok ? 1 : 0.45}"
        >${isHold ? 'Hold this slot' : 'Confirm booking'}</button>
      <button class="dbtn" data-act="dlg-cancel" style="border-radius:18px">Cancel</button>
    </div>
  </div></div>`;
}

function timerDialogHtml(){
  const s = sessById(S.timerAsk);
  const now = nowMin(), p = PITCHES[s.pitch];
  const late = Math.round(now - s.start);
  return `<div class="backdrop"><div class="modal">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <span class="modal-kicker">Start match timer</span>
      <button class="x" data-act="timer-cancel">&times;</button>
    </div>
    <div class="plate">
      <div class="plate-kicker">Clock now</div>
      <div class="plate-time">${t12(now)}</div>
      <div class="plate-day">${esc(s.team)}</div>
      <div class="plate-foot"><span>${esc(p.name)} &middot; ${esc(p.sub)}</span>
        <b>${rng12(s.start, s.end)}</b></div>
    </div>
    <p class="dnote">${late > 0
      ? 'Slot began ' + late + ' min ago. Starting now runs the timer from ' + t12(now) + ', ending ' + t12(s.end) + '.'
      : 'Slot has not begun yet. Starting now runs the timer from ' + t12(now) + '.'}</p>
    <div class="stack">
      <button class="dbtn primary wide sm" data-act="timer-start" data-v="now">Start now &middot; ${t12(now)}</button>
      <button class="dbtn wide sm" data-act="timer-start" data-v="slot">Start from slot time &middot; ${t12(s.start)}</button>
      <button class="dbtn ghost wide" data-act="timer-cancel" style="height:44px">Cancel</button>
    </div>
  </div></div>`;
}

function doneDialogHtml(){
  const s = sessById(S.doneAsk);
  const now = nowMin(), p = PITCHES[s.pitch];
  const total = Math.round(p.rate * (s.end - s.start) / 60);
  const outstanding = Math.max(0, total - (s.advance || 0));
  const unpaid = s.pay !== 'Payment done';
  const early = Math.round(s.end - now);
  return `<div class="backdrop top"><div class="modal">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <span class="modal-kicker">End this session?</span>
      <button class="x" data-act="done-cancel">&times;</button>
    </div>
    <div class="plate">
      <div class="plate-kicker">Stopping at</div>
      <div class="plate-time">${t12(now)}</div>
      <div class="plate-day">${esc(s.team)}</div>
      <div class="plate-foot"><span>${esc(p.name)} &middot; ${esc(p.sub)}</span>
        <b>${rng12(s.start, s.end)}</b></div>
    </div>
    <p class="dnote">${early > 0
      ? 'Ending ' + early + ' min before the booked end time. The timer stops now and the slot is released.'
      : 'Slot has run its full time. The timer stops now and the slot is released.'}</p>
    <div style="font:700 12.5px var(--sans);margin-top:10px;color:${unpaid ? 'var(--warn)' : 'var(--lime)'}">
      ${unpaid
        ? money(outstanding) + ' is still outstanding — the session stays in Happening now until you collect it.'
        : 'Payment already settled.'}
    </div>
    <div class="stack">
      ${unpaid ? '<button class="dbtn primary wide sm" data-act="done-collect">End and collect money</button>' : ''}
      <button class="dbtn wide xs" data-act="done-confirm">End session only</button>
      <button class="dbtn ghost wide" data-act="done-cancel">Cancel</button>
    </div>
  </div></div>`;
}

function advDialogHtml(){
  const s = sessById(S.advAsk);
  const p = PITCHES[s.pitch];
  const total = Math.round(p.rate * (s.end - s.start) / 60);
  const settle = S.advMode === 'settle';
  const paidSoFar = s.advance || 0;
  const outstanding = Math.max(0, total - paidSoFar);
  const v = Math.max(0, parseInt(S.advVal, 10) || 0);

  const balance = settle
    ? (() => {
        const d = outstanding - v;
        return d > 0 ? money(d) + ' discount against ' + money(outstanding) + ' outstanding'
          : d < 0 ? money(-d) + ' above the outstanding amount'
          : 'Settles in full, no discount';
      })()
    : money(Math.max(0, total - v)) + ' balance due';

  const quick = (settle ? [Math.round(outstanding * 0.9), outstanding] : [Math.round(total * 0.25), Math.round(total * 0.5), total])
    .map(q => `<button class="${segCls(v === q, true)}" data-act="adv-quick" data-v="${q}"
      style="height:38px;border-radius:13px">${q === (settle ? outstanding : total)
        ? 'Full ' + money(q) : (settle ? '10% off · ' : '') + money(q)}</button>`).join('');

  return `<div class="backdrop over"><div class="modal">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <span class="modal-kicker">${settle ? 'Record payment' : 'Advance received'}</span>
      <button class="x" data-act="adv-cancel">&times;</button>
    </div>
    <div style="margin-top:12px">
      <b style="display:block;font:700 21px var(--sans)">${esc(s.team)}</b>
      <span class="dsub">${esc(p.name)} &middot; ${esc(p.sub)} &middot; ${rng12(s.start, s.end)}
        &middot; total ${money(total)}${paidSoFar ? ' · ' + money(paidSoFar) + ' already paid' : ''}</span>
    </div>
    <label style="display:block;margin-top:14px">
      <span class="dlabel">${settle ? 'Amount collected now' : 'How much advance paid till now'}</span>
      <input class="dinput amount" id="adv-val" data-act="adv-val" value="${esc(S.advVal)}" placeholder="0">
    </label>
    <div class="optrow" style="margin-top:9px">${quick}</div>
    <span class="dlabel" style="margin:14px 0 6px">Payment type</span>
    <div class="optrow">${PAY_MODES.map(m =>
      `<button class="${segCls(S.advPayMode === m, true)}" data-act="adv-mode" data-v="${m}"
        style="height:38px;border-radius:13px">${m}</button>`).join('')}</div>
    <div style="font:700 14px var(--sans);margin-top:12px;color:${settle && outstanding - v === 0 ? 'var(--lime)' : 'var(--warn)'}">${balance}</div>
    <div style="display:flex;gap:9px;margin-top:16px">
      <button class="dbtn primary sm" data-act="adv-save"
        style="cursor:${v > 0 ? 'pointer' : 'not-allowed'};opacity:${v > 0 ? 1 : 0.45}"
        >${settle ? 'Mark paid' : 'Save advance'}</button>
      <button class="dbtn sm" data-act="adv-cancel">Cancel</button>
    </div>
  </div></div>`;
}

/* Clicking a bar on a pitch timeline opens the session behind it, so the
   timeline reads as a control surface rather than just a picture. */
function blockDialogHtml(){
  const c = buildSessions().find(x => x.id === S.blockDetail);
  if (!c) return '';
  const s = c.raw, p = PITCHES[s.pitch];
  const total = Math.round(p.rate * (s.end - s.start) / 60);
  /* Only what the header line doesn't already say — no Slot row repeating the
     time, no Ended row repeating the clock. */
  const rows = [
    ['Booked via', s.source === 'app' ? 'Turf app · online' : 'Counter · walk-in'],
    ['Contact', s.contact],
    ['Amount', money(total)],
    ['Payment', c.payLabel],
  ].concat(c.running ? [['Played', durTxt(Math.max(0, nowMin() - (s.startedAt || s.start)))]] : []);

  return `<div class="backdrop"><div class="modal detail">
    <div class="detail-top">
      <div>
        <div class="detail-time">${c.range}</div>
        <div class="sel-where">${esc(c.team)} &middot; ${esc(p.name)} &middot; ${esc(p.sub)}</div>
      </div>
      <button class="x" data-act="block-close">&times;</button>
    </div>
    <div class="detail-status">
      <span class="tag ondark">${c.statusLabel}</span>
      <span class="dsub">${c.clock}</span>
    </div>
    ${c.running ? `<div class="strack"><div class="fill${c.over ? ' over' : ''}"
      style="width:${c.pct}%"></div></div>` : ''}
    ${rows.map(r => `<div class="drow"><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}
    <span class="dlabel">Match</span>
    ${matchOptsHtml(c, true)}
    <span class="dlabel">Payment</span>
    ${payOptsHtml(c, true)}
    <div class="detail-acts">
      ${c.running ? `<button class="dbtn sm" data-act="plus30" data-id="${c.id}">+30 min</button>` : ''}
      <button class="dbtn primary sm" data-act="block-focus" data-id="${c.id}">Show in list</button>
    </div>
  </div></div>`;
}

function modalsHtml(){
  let out = '';
  if (S.blockDetail != null && sessById(S.blockDetail)) out += blockDialogHtml();
  if (S.sel && S.confirm) out += confirmDialogHtml();
  if (S.timerAsk != null && sessById(S.timerAsk)) out += timerDialogHtml();
  if (S.advAsk   != null && sessById(S.advAsk))   out += advDialogHtml();
  if (S.doneAsk  != null && sessById(S.doneAsk))  out += doneDialogHtml();
  return out;
}

/* ─── actions ─────────────────────────────────────────── */
const confirmValid = () => S.form.team.trim().length > 0 && S.form.contact.trim().length >= 6;
const blockReady   = () => S.blockReason.trim().length >= 15;

function select(di, hi, pi){
  S.sel = { di, hi };
  if (pi != null) S.pitch = pi;
  S.formOpen = false; S.form = blankForm(); S.dur = 60; S.confirm = null;
}

/* free/hold → booked, anything else → free. */
function act(status, k){
  const next = status === 'free' || status === 'hold' ? 'booked' : 'free';
  S.overrides[k] = next;
  S.sources[k] = 'counter';
  if (next !== 'booked') delete S.details[k];
  S.formOpen = false; S.form = blankForm();
}

function setMatch(s, k){
  if (k === 'running' && s.status !== 'running'){ S.timerAsk = s.id; return; }
  if (k === 'done' && s.status !== 'done'){ S.doneAsk = s.id; return; }
  const patch = { status:k };
  if (k === 'done') patch.endedAt = nowMin();
  setSess(s.id, patch);
}

function pickPay(s, o){
  const total = Math.round(PITCHES[s.pitch].rate * (s.end - s.start) / 60);
  if (o === 'Payment done'){
    const outstanding = Math.max(0, total - (s.advance || 0));
    S.advAsk = s.id; S.advMode = 'settle';
    S.advVal = String(s.collected || outstanding);
    S.advPayMode = s.payMode || 'Cash';
    return;
  }
  if (o === 'Advance paid'){
    S.advAsk = s.id; S.advMode = 'advance';
    S.advVal = String(s.advance || '');
    S.advPayMode = s.payMode || 'Cash';
    return;
  }
  setSess(s.id, { pay:o, advance:0, collected:0 });
}

function saveAdvance(){
  const s = sessById(S.advAsk);
  if (!s) return;
  const total = Math.round(PITCHES[s.pitch].rate * (s.end - s.start) / 60);
  const v = Math.max(0, parseInt(S.advVal, 10) || 0);
  if (v <= 0) return;
  if (S.advMode === 'settle'){
    setSess(s.id, { pay:'Payment done', collected: v + (s.advance || 0), advance:0, payMode:S.advPayMode });
  } else {
    setSess(s.id, v >= total
      ? { pay:'Payment done', collected:v, advance:0, payMode:S.advPayMode }
      : { pay:'Advance paid', advance:v, payMode:S.advPayMode });
  }
  S.advAsk = null; S.advVal = '';
}

function addCustom(){
  const start = toMin(S.cStart);
  S.custom = S.custom.concat([{
    pitch:S.pitch, week:S.weekOffset, di:S.cDay,
    start, end: start + S.cDur,
    team:S.cName.trim(), contact:S.cPhone.trim(), pay:S.cPay,
  }]);
  S.customOpen = false; S.cName = ''; S.cPhone = ''; S.sel = null;
}

/* Press-and-hold to block. The fill is nudged directly so the 40ms tick
   never redraws the board underneath it. */
let holdIv = null, holdT0 = 0;
function startHold(k){
  if (!blockReady()) return;
  holdT0 = Date.now();
  clearInterval(holdIv);
  holdIv = setInterval(() => {
    const p = Math.min(100, ((Date.now() - holdT0) / 2000) * 100);
    S.holdPct = p;
    const fill = document.getElementById('holdFill'), lbl = document.getElementById('holdLbl');
    if (fill) fill.style.width = p + '%';
    if (lbl) lbl.textContent = 'Keep holding… ' + Math.round(p) + '%';
    if (p >= 100) endHold(k, true);
  }, 40);
}
function endHold(k, done){
  clearInterval(holdIv); holdIv = null;
  if (!done){
    S.holdPct = 0;
    const fill = document.getElementById('holdFill'), lbl = document.getElementById('holdLbl');
    if (fill) fill.style.width = '0%';
    if (lbl) lbl.textContent = blockReady() ? 'Press and hold 2s to block' : 'Write a reason to continue';
    return;
  }
  S.overrides[k] = 'blocked';
  S.blocks[k] = { reason:S.blockReason, by:STAFF.name, at:'just now' };
  S.blockOpen = false; S.blockReason = ''; S.holdPct = 0;
  render();
}

/* ─── render ──────────────────────────────────────────── */
const VIEWS = {
  availability: viewAvailability,
  sessions: viewSessions,
  alerts: viewAlerts,
  dashboard: viewDashboard,
  settings: viewSettings,
};
const TABS = [['availability','Availability'],['sessions','Sessions'],
  ['alerts','Reminders'],['dashboard','Dashboard']];
/* Views showing a running clock or a countdown need the whole redraw. */
const LIVE_VIEWS = new Set(['sessions', 'alerts']);

function renderTopbar(){
  const { game, cash } = buildAlerts();
  const n = game.length + cash.length;
  const runCount = sess().filter(s => s.status === 'running').length;
  document.getElementById('topbar').innerHTML = `
    <div class="brand">
      <div class="mark">TF</div>
      <div class="brand-txt"><b>Turf Operations</b><span>Koramangala &middot; 3 pitches</span></div>
    </div>
    <nav class="tabs">
      ${TABS.map(([v, t]) => `<button class="${chipCls(S.view === v)} big" data-act="goto" data-v="${v}">${t}</button>`
        + (v === 'alerts' ? `<span class="badge"${n ? '' : ' hidden'}>${n}</span>` : '')).join('')}
    </nav>
    <div class="topbar-end">
      <span class="livepill"><i></i>${runCount} in play &middot; ${t12(nowMin())}</span>
      <span class="today">Mon, 3 Aug 2026</span>
      <button class="cog${S.view === 'settings' ? ' on' : ''}" title="Settings" aria-label="Settings"
        data-act="goto" data-v="settings">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
      <div class="avatar" title="${esc(STAFF.name)}">${esc(STAFF.initials)}</div>
    </div>`;
}

/* Full redraw. Focus and caret are restored so typing in a dark-panel field
   survives the 1s clock tick. */
/* Panes that scroll inside the view. innerHTML replacement destroys them, so
   their offsets are captured by id and put back — otherwise the once-a-second
   clock tick would yank them to the top mid-scroll. */
const SCROLL_PANES = ['liveRail'];

function render(){
  const el = document.activeElement;
  /* selectionStart throws on input[type=time], so probe it defensively. */
  let caret = null;
  try { caret = el ? [el.selectionStart, el.selectionEnd] : null; } catch (_) {}
  const keep = el && el.id ? { id: el.id, caret } : null;

  const scrolls = SCROLL_PANES.map(id => {
    const p = document.getElementById(id);
    return p ? { id, top: p.scrollTop, left: p.scrollLeft } : null;
  }).filter(Boolean);

  renderTopbar();
  document.getElementById('view').innerHTML = VIEWS[S.view]();
  document.getElementById('modals').innerHTML = modalsHtml();

  for (const s of scrolls){
    const p = document.getElementById(s.id);
    if (p){ p.scrollTop = s.top; p.scrollLeft = s.left; }
  }

  if (keep){
    const next = document.getElementById(keep.id);
    if (next){
      next.focus();
      if (keep.caret && keep.caret[0] != null){
        try { next.setSelectionRange(keep.caret[0], keep.caret[1]); } catch (_) {}
      }
    }
  }

  /* The header is rebuilt on every render, so re-apply the stuck state or it
     would spring back to full height without the page having moved. */
  syncStuck();
}

/* The sticky grid header carries three rows of context, which is a lot of
   permanent chrome on a short screen. Once it is actually stuck, drop to the
   essentials — the quick-jump chips go, the date folds onto one line, the
   pitch columns lose their format line. Everything returns at the top. */
let stuckRaf = 0;
function syncStuck(){
  stuckRaf = 0;
  const g = document.querySelector('.gridsticky');
  if (g) g.classList.toggle('stuck', g.getBoundingClientRect().top <= 71);
}
addEventListener('scroll', () => {
  if (!stuckRaf) stuckRaf = requestAnimationFrame(syncStuck);
}, { passive: true });

/* ─── events ──────────────────────────────────────────── */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act_ = t.dataset.act, v = t.dataset.v, id = t.dataset.id ? +t.dataset.id : null;
  const s = id != null ? sessById(id) : null;
  const k = S.sel ? slotKey(S.sel.di, S.sel.hi) : null;

  switch (act_){
    /* header */
    case 'goto': S.view = v; break;

    /* settings */
    case 'toggle-pitch-colors':
      S.showPitchColors = !S.showPitchColors;
      if (!S.showPitchColors) S.colorPickerOpen = null;
      savePrefs();
      break;
    case 'toggle-pitch-picker': {
      const pi = +t.dataset.pi;
      S.colorPickerOpen = S.colorPickerOpen === pi ? null : pi;
      break;
    }
    case 'set-pitch-color':
      S.pitchColors[+t.dataset.pi] = v;
      S.colorPickerOpen = null;
      savePrefs();
      break;

    /* availability board */
    case 'pitch': S.pitch = +v; S.sel = null; break;
    case 'week':  S.weekOffset += +v; S.sel = null; break;
    case 'avail-mode': S.availMode = v; S.sel = null; break;
    case 'toggle-band':
      if (S.collapsedBands[v]) delete S.collapsedBands[v];
      else S.collapsedBands[v] = true;
      savePrefs();
      break;
    /* Rolls into the neighbouring week at either end, so you can walk the
       calendar day by day without switching to the week arrows. */
    case 'day-jump': goToDayOffset(+v); break;
    case 'day': {
      const next = S.dayIndex + (+v);
      if (next < 0){ S.dayIndex = 6; S.weekOffset -= 1; }
      else if (next > 6){ S.dayIndex = 0; S.weekOffset += 1; }
      else S.dayIndex = next;
      S.sel = null;
      break;
    }
    case 'slot':  select(+t.dataset.di, +t.dataset.hi, +t.dataset.pi); break;
    case 'clear-sel': S.sel = null; S.formOpen = false; S.form = blankForm(); break;

    /* selection panel */
    case 'sel-primary': {
      const st = statusFor(S.sel.di, S.sel.hi, S.pitch);
      if (st === 'free') { S.confirm = 'book'; S.formOpen = false; S.form = blankForm(); }
      else if (st === 'hold') { S.confirm = 'confirm-hold'; S.formOpen = false; S.form = blankForm(); }
      else act(st, k);
      break;
    }
    case 'sel-hold': S.confirm = 'hold'; S.formOpen = false; S.form = blankForm(); break;
    case 'sel-release':
      S.overrides[k] = 'free'; delete S.details[k];
      S.formOpen = false; S.form = blankForm();
      break;
    case 'drop-custom': {
      const h = hours()[S.sel.hi];
      const cov = coverage(S.pitch, S.sel.di, h);
      if (cov) S.custom = S.custom.filter(x => x !== cov.c);
      S.sel = null;
      break;
    }
    case 'dur': S.dur = Math.min(240, Math.max(30, S.dur + (+v))); break;
    case 'toggle-form':
      S.formOpen = !S.formOpen;
      if (S.formOpen) S.form = Object.assign(blankForm(), S.details[k] || {});
      break;
    case 'save-details':
      S.details[k] = Object.assign({}, S.form);
      S.formOpen = false;
      break;
    case 'form-pay': S.form.pay = v; break;
    case 'toggle-block':
      S.blockOpen = !S.blockOpen;
      S.blockReason = ''; S.holdPct = 0;
      break;

    /* custom slot panel */
    case 'open-custom':  S.customOpen = true; S.sel = null; break;
    case 'close-custom': S.customOpen = false; break;
    case 'c-day': S.cDay = +v; break;
    case 'c-dur': S.cDur = +v; break;
    case 'c-pay': S.cPay = v; break;
    case 'add-custom':
      if (!(S.cName.trim() && S.cPhone.trim().length >= 6)) return;
      addCustom();
      break;

    /* confirm dialog */
    case 'dlg-cancel': S.confirm = null; S.form = blankForm(); break;
    case 'dlg-confirm': {
      const mode = S.confirm;
      if (mode !== 'confirm-hold' && !confirmValid()) return;
      const h = hours()[S.sel.hi];
      if (mode === 'hold'){
        S.overrides[k] = 'hold';
        S.details[k] = Object.assign({}, S.form);
        S.confirm = null; S.formOpen = false; S.form = blankForm();
        break;
      }
      if (mode === 'book' && S.dur !== 60){
        S.custom = S.custom.concat([{
          pitch:S.pitch, week:S.weekOffset, di:S.sel.di,
          start: h * 60, end: h * 60 + S.dur,
          team:S.form.team.trim(), contact:S.form.contact.trim(), pay:S.form.pay,
        }]);
        S.confirm = null; S.sel = null; S.dur = 60; S.form = blankForm();
        break;
      }
      if (mode === 'book') S.details[k] = Object.assign({}, S.form);
      S.confirm = null;
      act(mode === 'confirm-hold' ? 'hold' : 'free', k);
      break;
    }

    /* sessions */
    case 'tl-block': S.blockDetail = id; break;
    case 'block-close': S.blockDetail = null; break;
    case 'block-focus': S.focusSession = id; S.blockDetail = null; break;
    case 'clear-focus': S.focusSession = null; break;
    case 'match': setMatch(s, v); break;
    case 'pay':   pickPay(s, v); break;
    case 'ask-done': S.doneAsk = id; break;
    case 'plus30': setSess(id, { end: s.end + 30 }); break;
    case 'mark-started': setSess(id, { status:'running', startedAt: nowMin() }); break;
    case 'noshow': setSess(id, { status:'noshow' }); break;
    case 'undo-noshow': setSess(id, { status:'upcoming' }); break;
    case 'collect': pickPay(s, 'Payment done'); break;

    /* dialogs on sessions */
    case 'timer-cancel': S.timerAsk = null; break;
    case 'timer-start': {
      const a = sessById(S.timerAsk);
      setSess(a.id, { status:'running', startedAt: v === 'now' ? nowMin() : a.start });
      S.timerAsk = null;
      break;
    }
    case 'done-cancel': S.doneAsk = null; break;
    case 'done-confirm': {
      const a = sessById(S.doneAsk);
      setSess(a.id, { status:'done', endedAt: nowMin() });
      S.doneAsk = null;
      break;
    }
    case 'done-collect': {
      const a = sessById(S.doneAsk);
      setSess(a.id, { status:'done', endedAt: nowMin() });
      S.doneAsk = null;
      pickPay(sessById(a.id), 'Payment done');
      break;
    }
    case 'adv-cancel': S.advAsk = null; S.advVal = ''; break;
    case 'adv-quick': S.advVal = v; break;
    case 'adv-mode': S.advPayMode = v; break;
    case 'adv-save': saveAdvance(); break;

    /* reminders */
    case 'alert-timer': S.view = 'sessions'; S.timerAsk = id; break;
    case 'alert-done':  S.view = 'sessions'; S.doneAsk = id; break;
    case 'alert-collect': S.view = 'sessions'; pickPay(s, 'Payment done'); break;

    default: return;
  }
  render();
});

/* Typed input never triggers a full redraw on its own — the 1s tick picks it
   up, and the fields that gate a button are patched in place. */
document.addEventListener('input', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  switch (t.dataset.act){
    case 'form-field': S.form[t.dataset.k] = t.value; refreshGate(); break;
    case 'c-field': S[t.dataset.k] = t.value; refreshGate(); break;
    case 'c-start': S.cStart = t.value; render(); break;
    case 'day-date': {
      /* Parse as local parts — `new Date("2026-08-06")` would be UTC and can
         land on the previous day west of Greenwich. */
      const [y, m, d] = t.value.split('-').map(Number);
      if (y && m && d){ goToDayOffset(dayOffsetOf(new Date(y, m - 1, d))); render(); }
      break;
    }
    case 'adv-val':
      S.advVal = t.value.replace(/\D/g, '').slice(0, 7);
      if (t.value !== S.advVal) t.value = S.advVal;
      render();
      break;
    case 'reason': S.blockReason = t.value; refreshGate(); break;
    default: return;
  }
});

/* Keep the enable/disable state and counters honest while typing. */
function refreshGate(){
  const count = document.querySelector('.reason-count');
  if (count) count.textContent = S.blockReason.trim().length + ' / 15';
  const hold = document.getElementById('holdBtn'), lbl = document.getElementById('holdLbl');
  if (hold){
    hold.disabled = !blockReady();
    if (lbl && S.holdPct === 0)
      lbl.textContent = blockReady() ? 'Press and hold 2s to block' : 'Write a reason to continue';
  }
  const dlg = document.querySelector('[data-act="dlg-confirm"]');
  if (dlg){
    const ok = S.confirm === 'confirm-hold' ? true : confirmValid();
    dlg.style.cursor = ok ? 'pointer' : 'not-allowed';
    dlg.style.opacity = ok ? 1 : 0.45;
  }
  const add = document.querySelector('[data-act="add-custom"]');
  if (add){
    const ok = !!(S.cName.trim() && S.cPhone.trim().length >= 6);
    add.style.cursor = ok ? 'pointer' : 'not-allowed';
    add.style.opacity = ok ? 1 : 0.45;
  }
}

/* press-and-hold on the maintenance block */
document.addEventListener('pointerdown', e => {
  const t = e.target.closest('[data-act="hold-block"]');
  if (!t || t.disabled || !S.sel) return;
  startHold(slotKey(S.sel.di, S.sel.hi));
});
/* Releasing anywhere aborts the hold — the pointer often ends up off the
   button, and leaving it mid-press must abort too. */
['pointerup','pointercancel'].forEach(ev =>
  document.addEventListener(ev, () => {
    if (holdIv && S.sel) endHold(slotKey(S.sel.di, S.sel.hi), false);
  }, true));
document.addEventListener('pointerleave', e => {
  if (!holdIv || !S.sel) return;
  if (e.target.closest && e.target.closest('[data-act="hold-block"]'))
    endHold(slotKey(S.sel.di, S.sel.hi), false);
}, true);

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (S.confirm) S.confirm = null;
  else if (S.advAsk != null) { S.advAsk = null; S.advVal = ''; }
  else if (S.doneAsk != null) S.doneAsk = null;
  else if (S.timerAsk != null) S.timerAsk = null;
  else if (S.blockDetail != null) S.blockDetail = null;
  else if (S.customOpen) S.customOpen = false;
  else if (S.sel) S.sel = null;
  else return;
  render();
});

/* Console preferences outlive the tab; operational data does not (it is mock). */
function savePrefs(){
  try {
    localStorage.setItem('turf-erp:prefs', JSON.stringify({
      showPitchColors: S.showPitchColors, pitchColors: S.pitchColors,
      collapsedBands: S.collapsedBands,
    }));
  } catch (_) {}
}
function loadPrefs(){
  try {
    const p = JSON.parse(localStorage.getItem('turf-erp:prefs') || '{}');
    if (typeof p.showPitchColors === 'boolean') S.showPitchColors = p.showPitchColors;
    if (p.pitchColors && typeof p.pitchColors === 'object') S.pitchColors = p.pitchColors;
    if (p.collapsedBands && typeof p.collapsedBands === 'object') S.collapsedBands = p.collapsedBands;
  } catch (_) {}
}

/* The clock. Views that show live counters redraw; the others only need the
   header pill, which keeps the 500-odd slot bubbles off the hot path. */
setInterval(() => {
  if (LIVE_VIEWS.has(S.view)) render();
  else renderTopbar();
}, 1000);

loadPrefs();
render();
