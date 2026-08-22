/* ═══════════════════════════════════════════════════════
   TURF OPERATIONS — mobile, built to the Claude Design
   handoff (Turf ERP Mobile.dc.html).

   The holder is ground staff walking between three pitches,
   not the counter. Home is the board itself: today's grid,
   with a red line sweeping down it in real time.

   Rows far from that line stay bubbles. The row it is
   crossing — and the row it is about to reach — opens, and a
   booking on it stops being a bubble and becomes the control
   for that match: check in, start, end, collect. That card
   grammar is the console's, in FRONTEND.md under "A match,
   from arrival to settled".

   Three surfaces push over home and come back with one thumb
   reach: the other days, the custom-slot form and the
   reminder list.

   Same conventions as the console (app.js): one state
   object, full re-render, delegated events, mock data.
   ═══════════════════════════════════════════════════════ */

/* ─── data ────────────────────────────────────────────── */
/* Mirrors app.js so both devices describe the same day. Changing a seed here
   without changing it there makes the console and the phone disagree. */
const PITCHES = [
  { name:'Pitch A',     short:'A',    sub:'7-a-side',  rate:1800 },
  { name:'Pitch B',     short:'B',    sub:'5-a-side',  rate:1200 },
  { name:'Main Ground', short:'Main', sub:'11-a-side', rate:3200 },
];

const SESSION_SEED = [
  { id:1, pitch:0, team:'Old Boys XI',     contact:'+91 98450 22110', source:'app',     pay:'Payment done',     payMode:'UPI',  start:960,  end:1020, status:'done',     startedAt:962, endedAt:1020 },
  { id:2, pitch:0, team:'Northside FC',    contact:'+91 99001 84523', source:'app',     pay:'Payment done',     payMode:'UPI',  start:1020, end:1080, status:'running',  startedAt:1032 },
  { id:3, pitch:2, team:'Academy U16',     contact:'+91 90080 33421', source:'counter', pay:'Advance paid',     payMode:'Cash', start:1035, end:1125, status:'running',  startedAt:1038, advance:1600 },
  { id:4, pitch:1, team:'Kickers 05',      contact:'+91 98862 77014', source:'counter', pay:'Payment at venue', start:1080, end:1140, status:'upcoming' },
  { id:5, pitch:2, team:'Corporate: Zeta', contact:'+91 97310 55290', source:'app',     pay:'Payment at venue', start:1140, end:1230, status:'upcoming' },
];

const OTHER_ALERTS = [
  { at:1045, tag:'Maintenance', title:'Floodlight repair logged on Pitch B',
    body:'Blocked 9–10PM by R. Kumar. Owner audit trail updated.' },
  { at:1010, tag:'App booking', title:'New app booking · Falcon SC',
    body:'Main Ground, tomorrow 7–8PM. Paid in full through the app.' },
  { at:960,  tag:'Cancellation', title:'Astro Blues cancelled 8AM on Pitch A',
    body:'Cancelled 3 hours ahead. Slot returned to the sellable pool.' },
];

const START_HOUR = 6, END_HOUR = 22;
const PAY_FORM = ['Payment done','Payment at venue','Advance paid'];
const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const STAFF = { name:'R. Kumar' };

/* The demo's today, same as the console: Mon 3 Aug 2026. */
const TODAY_LABEL = 'Mon 3 Aug';
const TODAY_DI = 0;

/* ─── state ───────────────────────────────────────────── */
const blankForm = () => ({ team:'', contact:'', pay:'Payment at venue' });

const S = {
  screen:'home',            // 'home' | 'slots' | 'sell' | 'reminders'
  sheet:null,               // {kind, ...} — see sheetHtml()
  sessions:null,            // null until the first patch, then the working copy
  dayIndex:0,               // which day the slot board shows, 0–6
  checkedIn:{},             // sessions checked in but not yet started
  homeParked:false,         // has home been scrolled to the now-line once
  /* Bands start open. A board that opens collapsed hides the only thing the
     screen is for; collapsing is for putting a finished part of the day away. */
  collapsedBands:{},
  overrides:{}, sources:{}, details:{}, blocks:{},
  form:blankForm(), blockReason:'',
  sellPitch:0, sellStart:'20:00', sellDur:60,
  sellName:'', sellPhone:'', sellPay:'Payment at venue', sellDone:'',
  scrollMem:{}, _rendered:null,
};

/* The demo clock starts at 5:32PM and runs in real time, same as the console. */
const T0 = Date.now();
const nowMin = () => 1052 + (Date.now() - T0) / 60000;

/* ─── helpers ─────────────────────────────────────────── */
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money = n => '₹' + Math.round(n).toLocaleString('en-IN');
const toMin = t => { const p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); };

/* One clock across both devices: 12-hour, whole hours without the ":00". */
function t12(min){
  const t = Math.floor(min), h = Math.floor(t / 60) % 24, m = t % 60;
  return (h % 12 === 0 ? 12 : h % 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? 'AM' : 'PM');
}
function rng12(a, b){
  const x = t12(a), y = t12(b);
  return x.slice(-2) === y.slice(-2) ? x.slice(0, -2) + '–' + y : x + '–' + y;
}
const hourRng12 = h => rng12(h * 60, (h + 1) * 60);
const hours = () => Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
/* Durations read as "45m" / "1h 20m" — never "0h 45m". */
const mins = n => { const v = Math.max(0, Math.round(n)); return v >= 60 ? Math.floor(v / 60) + 'h ' + (v % 60) + 'm' : v + 'm'; };
const tel = c => 'tel:' + String(c).replace(/[^\d+]/g, '');
const wa = c => 'https://wa.me/' + String(c).replace(/\D/g, '');

/* Deterministic pseudo-random, identical to app.js — the phone and the counter
   must show the same board or the whole thing is worthless. */
const rnd = (a, b, c) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return x - Math.floor(x);
};
const slotKey = (di, hi, pi) => pi + '|0|' + di + '|' + hi;

function statusFor(di, hi, pi){
  const k = slotKey(di, hi, pi);
  if (S.overrides[k]) return S.overrides[k];
  const h = hours()[hi];
  const r = rnd(di, hi, pi);
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
/* A slot bubble is ~99px wide on a 402px screen, so it gets the short word. */
const shortLabel = s => ({ free:'Open', booked:'Booked', hold:'Hold', blocked:'Blocked' }[s]);
const bandOf = h => h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Late night';

function setSlot(pi, di, hi, st, src){
  const k = slotKey(di, hi, pi);
  S.overrides[k] = st;
  if (src) S.sources[k] = src;
}

/* The board is drawn in whole hours, but a walk-in taken at the gate can sit on
   an odd window — 8–9:30PM — and the cell holding it should say so rather than
   round it to a tidy hour. A cell with no booking of its own falls back to the
   grid hour it represents. */
function slotRange(di, hi, pi){
  const d = S.details[slotKey(di, hi, pi)], h = hours()[hi];
  return d && d.start != null ? [d.start, d.end] : [h * 60, (h + 1) * 60];
}

/* Where a booking came from: the app, or OTC — over the counter. Deliberately a
   watermark and never a pill. Status is what you scan for at a glance; the
   channel is what you check once you have stopped walking. */
const srcWord = src => src === 'app' ? 'APP' : 'OTC';
const srcMark = src => `<span class="m-src">${srcWord(src)}</span>`;

/* ─── sessions ────────────────────────────────────────── */
const sess = () => S.sessions || SESSION_SEED;
const sessById = id => sess().find(s => s.id === id);
function setSess(id, patch){
  S.sessions = sess().map(x => x.id === id ? Object.assign({}, x, patch) : x);
}
const totalOf = s => Math.round(PITCHES[s.pitch].rate * (s.end - s.start) / 60);
/* Matches the console's collectTotal(): "Payment done" clears the balance,
   an advance only reduces it. */
const outstanding = s => s.pay === 'Payment done' || s.status === 'noshow'
  ? 0 : Math.max(0, totalOf(s) - (s.advance || 0));

const dueList = () => sess().filter(s => outstanding(s) > 0).sort((a, b) => a.end - b.end);
const dueTotal = () => dueList().reduce((n, s) => n + outstanding(s), 0);
/* Owed today and collectable now are different numbers. Money on a game that
   has not kicked off yet is nobody's job — the header carries the day's total,
   the dock only ever offers what a hand could actually take right now. */
const collectable = () => dueList().filter(s => s.status === 'running' || s.status === 'done');
const collectTotal = () => collectable().reduce((n, s) => n + outstanding(s), 0);

function markPaid(id, mode){
  const s = sessById(id);
  setSess(id, { pay:'Payment done', payMode:mode, advance:totalOf(s) });
  S.sheet = null;
}

/* ─── reminders ───────────────────────────────────────── */
/* Same rules as the console's buildAlerts(), so clearing one here clears the
   same thing there. */
function buildAlerts(){
  const now = nowMin(), game = [], cash = [];
  sess().forEach(s => {
    const p = PITCHES[s.pitch];
    if (s.status === 'upcoming' && s.start - now < 120){
      const late = now - s.start;
      game.push({ at:s.start, rel: late > 0 ? mins(late) + ' ago' : 'in ' + mins(s.start - now),
        tag: late > 5 ? 'Not started' : 'Starts soon', warn: late > 5,
        title: s.team + ' · ' + p.name,
        body: late > 5
          ? 'Slot began ' + mins(late) + ' ago and the timer is not running.'
          : 'Booked ' + rng12(s.start, s.end) + '. Start the timer when they take the pitch.',
        action:'Start timer', act:'start', id:s.id });
    }
    if (s.status === 'running' && now > s.end){
      game.push({ at:s.end, rel: mins(now - s.end) + ' over', tag:'Overtime', warn:true,
        title: s.team + ' · ' + p.name,
        body: 'Running ' + mins(now - s.end) + ' past the booked end time.',
        action:'Mark complete', act:'complete', id:s.id });
    } else if (s.status === 'running' && s.end - now < 15){
      game.push({ at:s.end, rel: mins(s.end - now) + ' left', tag:'Ending', warn:false,
        title: s.team + ' · ' + p.name,
        body: 'Whistle at ' + t12(s.end) + '. Mark complete or add 30 minutes.',
        action:'Mark complete', act:'complete', id:s.id });
    }
    if (outstanding(s) > 0){
      cash.push({ at:s.end, rel: s.status === 'done' ? 'overdue' : 'at whistle',
        tag: s.status === 'done' ? 'Overdue' : s.advance ? 'Balance due' : 'Due at venue',
        title: money(outstanding(s)) + ' · ' + s.team,
        body: p.name + ' · ' + rng12(s.start, s.end) + ' · ' + s.contact,
        action:'Collect over UPI', act:'collect', id:s.id });
    }
  });
  game.sort((a, b) => a.at - b.at);
  cash.sort((a, b) => a.at - b.at);
  return { game, cash };
}

/* ─── icons ───────────────────────────────────────────── */
const SVG = (d, extra) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"
  stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  back: SVG('<path d="M14.5 5 8 12l6.5 7"/>'),
  bell: SVG('<path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>'),
  grid: SVG('<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>'),
};

/* ─── small builders ──────────────────────────────────── */
const tag = (txt, mod) => `<span class="m-tag${mod ? ' ' + mod : ''}">${esc(txt)}</span>`;

const btn = (txt, act, mod, data) => `<button class="m-btn${mod ? ' ' + mod : ''}"
  data-act="${act}"${data || ''}>${esc(txt)}</button>`;
const link = (txt, href, mod) => `<a class="m-btn${mod ? ' ' + mod : ''}" href="${esc(href)}">${esc(txt)}</a>`;
const opt = (txt, on, act, v) => `<button class="m-opt${on ? ' is-on' : ''}"
  data-act="${act}" data-v="${esc(v == null ? txt : v)}">${esc(txt)}</button>`;
const kv = (k, v) => `<div class="m-kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
const field = (id, lbl, val, model, ph, type) => `<label class="m-label"
  for="${id}">${esc(lbl)}</label><input class="m-field" id="${id}" type="${type || 'text'}"
  value="${esc(val)}" data-model="${model}" placeholder="${esc(ph || '')}">`;

const formReady = () => S.form.team.trim().length > 1 && S.form.contact.trim().length > 5;

/* ═══ SCREEN: home — the live board ════════════════════ */
/* The board itself is home now. One grid, today, with a red line sweeping down
   it in real time — the same shape the counter console shows, so both devices
   describe the day the same way.

   The line is what makes it a phone screen rather than a shrunk desktop one.
   Rows far from it stay bubbles: a time, a state, a channel. The row the line
   is crossing — and the row it is about to reach — opens up, and any booking on
   it stops being a bubble and becomes the control for that match. Check in,
   start, end, collect: the four things a shift actually consists of, on the
   cell they belong to, never on another screen.

   Card grammar is the console's (see FRONTEND.md, "A match, from arrival to
   settled"): arriving → ready → running → owed → settled, actions in a tray
   along the base rather than in a corner, and a running card that drops the
   planning detail for one count and two controls. */

const START_WINDOW = 20;   // minutes before kick-off that check-in opens

/* Which face a booking is wearing right now. null means it is still just a
   line on the schedule and needs no controls. */
function liveMode(s){
  if (s.status === 'noshow') return null;
  if (s.status === 'done') return outstanding(s) > 0 ? 'owed' : 'settled';
  if (s.status === 'running') return 'running';
  if (S.checkedIn[s.id]) return 'ready';
  return s.start - nowMin() <= START_WINDOW ? 'arriving' : null;
}

/* Sessions only exist for today; other days are the hash board alone. */
function sessionOn(di, hi, pi){
  if (di !== TODAY_DI) return null;
  const h = hours()[hi], a = h * 60, b = a + 60;
  return sess().find(s => s.pitch === pi && s.status !== 'noshow' && s.start < b && s.end > a) || null;
}
/* The row a booking gets drawn on. A match that began before the board opens
   still has to appear somewhere, so it clamps to the first visible hour. */
function firstHiOf(s){
  const i = hours().indexOf(Math.floor(s.start / 60));
  return i < 0 ? 0 : i;
}
/* One state per cell, sessions included — the counts, the bubbles and the
   sheets all read this, so none of them can disagree about what is free. */
function cellState(di, hi, pi){
  return sessionOn(di, hi, pi) ? 'booked' : statusFor(di, hi, pi);
}

/* A row opens when the line is inside it, when the check-in window is about to
   reach it, or when a match on it ended owing money — cash stays on the board
   until it is taken, which is the leak the whole thing exists to close. */
function rowOpen(hi){
  const now = nowMin(), a = hours()[hi] * 60;
  if (now >= a && now < a + 60) return true;
  if (a - now > 0 && a - now <= START_WINDOW) return true;
  return PITCHES.some((p, pi) => {
    const s = sessionOn(TODAY_DI, hi, pi);
    return s && firstHiOf(s) === hi && ['owed', 'running', 'ready'].includes(liveMode(s));
  });
}

/* "45:00", seconds at 44% — the minutes are the number being read, the seconds
   are only there to prove the thing is running. Past an hour it grows an hours
   field rather than counting to "72:43", which nobody reads as an hour and a
   bit. Over the booked end it counts up behind a "+". */
function countTxt(end){
  const raw = Math.floor((end - nowMin()) * 60), over = raw < 0, v = Math.abs(raw);
  const h = Math.floor(v / 3600), m = Math.floor(v % 3600 / 60), sec = v % 60;
  const pad = n => String(n).padStart(2, '0');
  return (over ? '+' : '') + (h ? h + ':' + pad(m) : m)
    + '<i>:' + pad(sec) + '</i>';
}

const TICON = {
  check:'<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.8l4.6 4.4L19 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  undo:'<svg viewBox="0 0 24 24" fill="none"><path d="M9 5L4.5 9.5 9 14M4.5 9.5H14a5.5 5.5 0 010 11H8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play:'<svg viewBox="0 0 24 24"><path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor"/></svg>',
  pause:'<svg viewBox="0 0 24 24"><rect x="7" y="4.5" width="3.8" height="15" rx="1.8" fill="currentColor"/><rect x="13.2" y="4.5" width="3.8" height="15" rx="1.8" fill="currentColor"/></svg>',
  cross:'<svg viewBox="0 0 24 24" fill="none"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>',
  cash:'<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6.5" width="18" height="11" rx="2.4" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="2.2"/></svg>',
  bell:'<svg viewBox="0 0 24 24"><path d="M12 2.6a5.6 5.6 0 00-5.6 5.6v3.4L4.6 15.2a1 1 0 00.9 1.5h13a1 1 0 00.9-1.5l-1.8-3.6V8.2A5.6 5.6 0 0012 2.6zM9.6 18.4a2.6 2.6 0 004.8 0z" fill="currentColor"/></svg>',
};

/* One bar across the base of the card, never a chip in a corner — the corner is
   where nothing looks, and this is the action the card exists to offer. */
const cta = (act, id, icon, label, mod) => `<button class="m-cta${mod ? ' ' + mod : ''}"
  data-act="${act}" data-id="${id}" aria-label="${esc(label || act)}">${
  icon ? `<i>${TICON[icon]}</i>` : ''}${label ? `<span>${esc(label)}</span>` : ''}</button>`;

/* The ring traces the card's own outline, so it is drawn as the border rather
   than sitting inside it — the countdown and its progress are one object. */
const ringHtml = pct => `<svg class="m-ring" preserveAspectRatio="none" aria-hidden="true">
  <rect class="m-ring-track" pathLength="100"></rect>
  <rect class="m-ring-fill" pathLength="100" style="stroke-dasharray:${pct.toFixed(2)} 100"></rect></svg>`;

function cardHtml(s, mode, hi){
  const p = PITCHES[s.pitch], now = nowMin();
  const span = rng12(s.start, s.end);
  const data = ` data-act="sheet-sess" data-id="${s.id}"`;

  if (mode === 'running'){
    const over = now > s.end;
    const pct = Math.max(0, Math.min(100, (now - s.start) / (s.end - s.start) * 100));
    return `<div class="m-cell is-timer${over ? ' is-over' : ''}">
      <button class="m-cellface"${data}>
        <span class="m-tm-top">${TICON.bell}Ends ${esc(t12(s.end))}</span>
        <b class="m-tm-count${over ? ' is-over' : ''}">${countTxt(s.end)}</b>
        <span class="m-tm-sub">${esc(s.team)}</span>
      </button>
      ${ringHtml(pct)}
      <span class="m-tm-acts">
        <button class="m-tm-btn" data-act="pause-timer" data-id="${s.id}" aria-label="Stop the timer">${TICON.pause}</button>
        <button class="m-tm-btn is-end" data-act="end-game" data-id="${s.id}" aria-label="End session">${TICON.cross}</button>
      </span>
    </div>`;
  }

  if (mode === 'owed'){
    return `<div class="m-cell is-owed">
      <button class="m-cellface"${data}>
        <span class="m-owed-top"><b>Payment due</b></span>
        <b class="m-owed-sum">${esc(money(outstanding(s)))}</b>
        <span class="m-owed-who">${esc(s.team)}</span>
        <span class="m-owed-when">${esc('Ended ' + t12(s.endedAt || s.end))}</span>
      </button>
      <span class="m-tray">${cta('collect', s.id, 'cash', 'Collect', 'is-paper')}</span>
    </div>`;
  }

  if (mode === 'arriving' || mode === 'ready'){
    const late = now - s.start;
    return `<div class="m-cell is-face${mode === 'ready' ? ' is-ready' : ''}">
      <button class="m-cellface"${data}>
        <span class="m-face-tag">${esc(srcWord(s.source))}</span>
        <span class="m-face-top">${esc(span)}</span>
        <b class="m-face-cue">${mode === 'ready' ? 'Ready' : late > 0 ? 'Late' : 'Starting soon'}</b>
        <span class="m-face-sub">${esc(s.team)}</span>
      </button>
      <span class="m-tray">${mode === 'ready'
        ? cta('start', s.id, null, 'Start timer')
        : cta('check-in', s.id, 'check', 'Check in')}</span>
    </div>`;
  }

  /* Settled, or simply not due yet — a line on the schedule, at row height. */
  const paid = outstanding(s) === 0;
  return `<button class="m-cell is-plain${mode === 'settled' ? ' is-settled' : ''}"${data}>
    <span class="m-face-top">${esc(span)}</span>
    <b class="m-plain-who">${esc(s.team)}</b>
    <span class="m-plain-foot">${esc(paid ? 'Paid' : money(outstanding(s)) + ' due')}${srcMark(s.source)}</span>
  </button>`;
}

/* A booking that runs past its first hour keeps its controls on that first hour
   and leaves a quiet marker on the rest — one session, one set of buttons. */
const contHtml = s => `<div class="m-cont" aria-hidden="true"><i></i><span>${esc(s.team)}</span></div>`;

function bubHtml(di, hi, pi, tall){
  const st = cellState(di, hi, pi), src = sourceFor(di, hi, pi);
  const sel = S.sheet && S.sheet.kind === 'slot' && S.sheet.pi === pi && S.sheet.hi === hi && S.sheet.di === di;
  const [a, b] = slotRange(di, hi, pi);
  const chan = st === 'booked' ? ' · ' + srcWord(src) : '';
  return `<button class="m-bub is-${st}${st === 'booked' ? ' is-' + src : ''}${sel ? ' is-sel' : ''}${
    tall ? ' is-tall' : ''}" data-act="sheet-slot" data-pi="${pi}" data-hi="${hi}"
    title="${esc(PITCHES[pi].name + ' · ' + rng12(a, b) + ' · ' + label(st) + chan)}">
    <b>${esc(rng12(a, b))}</b><em>${esc(shortLabel(st) + chan)}</em>
  </button>`;
}

function boardHtml(di, live){
  const hs = hours(), now = nowMin();

  const open = PITCHES.map((p, pi) =>
    hs.filter((h, hi) => cellState(di, hi, pi) === 'free').length);

  /* The sticky head. It sat on the page ground and read as three loose words,
     so it is a band: paper, a rule under it and a shadow the rows pass beneath.
     The negative margin and the matching inner padding are what keep its
     columns on the bubbles — change one and you must change the other. */
  const head = `<div class="m-cols">
    <span class="m-cols-time">Time</span>
    ${PITCHES.map((p, pi) => `<span class="m-col">
      <b>${esc(p.name)}</b><small>${open[pi]} of ${hs.length} open</small></span>`).join('')}
  </div>`;

  const bands = ['Morning','Afternoon','Evening','Late night'].map(name => {
    const idx = hs.map((h, hi) => hi).filter(hi => bandOf(hs[hi]) === name);
    if (!idx.length) return '';
    const closed = !!S.collapsedBands[name];
    const free = idx.reduce((n, hi) => n + PITCHES.filter((p, pi) => cellState(di, hi, pi) === 'free').length, 0);

    const rows = closed ? '' : idx.map(hi => {
      const h = hs[hi], a = h * 60;
      const opened = live && rowOpen(hi);
      const onNow = live && now >= a && now < a + 60;

      const cells = PITCHES.map((p, pi) => {
        const s = live ? sessionOn(di, hi, pi) : null;
        if (!s) return bubHtml(di, hi, pi, opened);
        if (firstHiOf(s) !== hi) return contHtml(s);
        const mode = liveMode(s);
        return opened && mode ? cardHtml(s, mode, hi) : bubHtml(di, hi, pi, opened);
      }).join('');

      return `<div class="m-hour${opened ? ' is-open' : ''}${onNow ? ' has-now' : ''}">
        <span class="m-hourlbl">${esc(rng12(a, a + 60))}</span>
        ${cells}
        ${onNow ? `<span class="m-now" style="--frac:${((now - a) / 60).toFixed(4)}">
          <span class="m-now-lbl">${esc(t12(now))}</span></span>` : ''}
      </div>`;
    }).join('');

    return `<div class="m-band">
      <button class="m-band-head${closed ? ' is-closed' : ''}" data-act="band" data-v="${esc(name)}"
        aria-expanded="${!closed}">
        <i class="m-chev">${closed ? '▸' : '▾'}</i><b>${name}</b><i class="m-rule"></i>
        <span class="m-band-span">${esc(rng12(hs[idx[0]] * 60, (hs[idx[idx.length - 1]] + 1) * 60))}</span>
        <em>${closed ? 'SHOW' : 'HIDE'}</em>
      </button>${rows}
    </div>`;
  }).join('');

  return head + bands;
}

function headerHome(){
  const now = nowMin(), a = buildAlerts(), n = a.game.length + a.cash.length;
  const playing = sess().filter(s => s.status === 'running').length;
  const waiting = collectable().length;
  const count = (v, lbl, mod) => `<span class="m-count${mod ? ' ' + mod : ''}">
    <b>${esc(v)}</b>${esc(lbl)}</span>`;

  return `<div class="m-shift">
    <div class="m-shift-top">
      <div>
        <div class="m-kicker"><i></i>Live shift · ${TODAY_LABEL}</div>
        <div class="m-clock">${t12(now)}</div>
      </div>
      <div class="m-shift-end">
        <div class="m-due-total"><span>Still to collect</span><b>${money(dueTotal())}</b></div>
        <button class="m-bell" data-act="go" data-v="reminders" aria-label="Reminders${n ? ', ' + n + ' pending' : ''}">
          ${ICON.bell}${n ? `<span class="m-badge">${n}</span>` : ''}
        </button>
      </div>
    </div>
    <div class="m-counts">
      ${count(playing, 'in play', playing ? 'is-play' : '')}
      ${count(PITCHES.length - playing, 'idle', '')}
      ${count(waiting, 'to collect', waiting ? 'is-warn' : '')}
    </div>
  </div>`;
}

const homeHtml = () => `<div class="m-board">${boardHtml(TODAY_DI, true)}</div>`;

/* Two things. The board is home, so the dock's job is the other days and the
   money — the two places the live grid cannot take you. */
function dockHtml(){
  const total = collectTotal(), any = total > 0;
  return `<div class="m-dock">
    <button class="m-dock-board" data-act="go" data-v="slots">${ICON.grid}<span>Other days</span></button>
    <button class="m-dock-collect${any ? '' : ' is-clear'}" data-act="collect-first"${any ? '' : ' disabled'}>
      ${any ? 'Collect ' + money(total) : dueTotal() ? 'Nothing due yet' : 'All collected'}
    </button>
  </div>`;
}

/* ═══ SCREEN: slots — the board (frame 1a) ═════════════ */
function headerSlots(){
  return bar('Week of 3 Aug', 'Slot availability');
}
const bar = (kicker, title, back) => `<div class="m-bar">
  <button class="m-back" data-act="go" data-v="${back || 'home'}" aria-label="Back">${ICON.back}</button>
  <div class="m-bar-txt"><small>${esc(kicker)}</small><h1>${esc(title)}</h1></div>
</div>`;

function screenSlots(){
  const di = S.dayIndex, hs = hours();
  const days = DOW.map((d, i) => `<button class="m-day${i === di ? ' is-on' : ''}"
    data-act="day" data-v="${i}"><small>${d}</small><b>${3 + i}</b></button>`).join('');

  /* The only way into the custom-slot form now that the dock's sell sheet is
     gone. It belongs here: an odd window is a board question. */
  const walkin = `<button class="m-walkin" data-act="go-sell">
    <span><b>Walk-in at the gate</b><small>Custom time slot \u00b7 any start, any length</small></span>
    <em>OPEN</em>
  </button>`;

  let open = 0;
  hs.forEach((h, hi) => PITCHES.forEach((p, pi) => { if (cellState(di, hi, pi) === 'free') open++; }));

  const legend = `<div class="m-legend">
    <span><i class="is-open"></i>Open</span>
    <span><i class="is-app"></i>App</span>
    <span><i class="is-counter"></i>OTC \u00b7 counter</span>
    <span><i class="is-hold"></i>On hold</span>
    <span><i class="is-blocked"></i>Maintenance</span>
    <em>${open} of ${hs.length * 3} slots open on ${DOW[di]} ${3 + di} Aug</em>
  </div>`;

  /* Same grid as home, without the line: this one is for planning a day you
     are not standing in, so nothing on it needs a control. */
  return `<div class="m-board">
    <div class="m-days">${days}</div>
    ${walkin}${legend}${boardHtml(di, false)}
  </div>`;
}

/* ═══ SCREEN: sell — custom time slot (frame 1a) ═══════ */
/* Reached from the board now that the sell sheet is gone, so back goes there. */
function headerSell(){ return bar('Walk-in at the gate', 'Custom time slot', 'slots'); }

function screenSell(){
  const p = PITCHES[S.sellPitch];
  const a = toMin(S.sellStart), b = a + S.sellDur;
  const ready = S.sellName.trim().length > 1 && S.sellPhone.trim().length > 5;

  return `<div class="m-pad">
    <div class="m-panel">
      <span class="m-label">Pitch</span>
      <div class="m-opts">${PITCHES.map((x, i) => opt(x.short, i === S.sellPitch, 'sell-pitch', i)).join('')}</div>

      <label class="m-label is-spaced" for="sStart">Start time</label>
      <input class="m-field" id="sStart" type="time" step="1800" value="${esc(S.sellStart)}" data-model="sellStart">

      <span class="m-label is-spaced">Duration</span>
      <div class="m-opts">${[30, 60, 90, 120]
        .map(d => opt(d >= 60 ? (d / 60) + 'h' : d + 'm', d === S.sellDur, 'sell-dur', d)).join('')}</div>

      <div class="m-quote">${esc(rng12(a, b) + ' · ' + p.name + ' · ' + money(p.rate * S.sellDur / 60))}</div>
      <div class="m-hr"></div>

      ${field('sName', 'Name / team · required', S.sellName, 'sellName', 'e.g. Northside FC')}
      ${field('sPhone', 'Contact number · required', S.sellPhone, 'sellPhone', '+91', 'tel')}

      <span class="m-label is-spaced">Payment status</span>
      <div class="m-opts">${PAY_FORM.map(o => opt(o, o === S.sellPay, 'sell-pay')).join('')}</div>

      <button class="m-btn is-wide is-tall ${ready ? 'is-lime' : ''}" data-act="sell-confirm"
        ${ready ? '' : 'disabled'} style="margin-top:18px">
        ${ready ? 'Confirm custom booking' : 'Name and contact required'}
      </button>
    </div>
    ${S.sellDone ? `<div class="m-banner">${esc(S.sellDone)}</div>` : ''}
  </div>`;
}

/* ═══ SCREEN: reminders (frame 1a) ═════════════════════ */
function headerReminders(){ return bar('Live · ' + t12(nowMin()), 'Reminders'); }

function screenReminders(){
  const { game, cash } = buildAlerts();

  const remHtml = (r, cashRow) => `<div class="m-rem${cashRow ? ' is-cash' : ''}">
    <div class="m-rem-top">
      <b>${esc(t12(r.at))}</b><span>${esc(r.rel)}</span>
      ${tag(r.tag, cashRow ? 'is-warn' : r.warn ? 'is-warn2' : r.tag === 'Ending' ? 'is-good' : '')}
    </div>
    <h3>${esc(r.title)}</h3>
    <p>${esc(r.body)}</p>
    ${btn(r.action, r.act, 'is-wide ' + (cashRow || r.warn ? 'is-ink' : 'is-lime'), ` data-id="${r.id}"`)}
  </div>`;

  const group = (title, count, rows, emptyNote) => `<div class="m-group">
    <div class="m-group-head"><h2>${esc(title)}</h2><span>${esc(count)}</span></div>
    ${rows.length ? rows.join('') : `<div class="m-empty">${esc(emptyNote)}</div>`}
  </div>`;

  return `<div class="m-groups">
    <p class="m-lede">Each one arrives as a push, and clearing it here clears it on the counter console too.</p>
    ${group('Game reminders', game.length + ' pending', game.map(r => remHtml(r, false)),
      'Nothing needs a whistle in the next two hours.')}
    ${group('Cash collection', money(dueTotal()) + ' across ' + cash.length,
      cash.map(r => remHtml(r, true)), 'Nothing left to collect today.')}
    ${group('Other notifications', OTHER_ALERTS.length + ' updates', OTHER_ALERTS.map(o => `<div class="m-rem">
      <div class="m-rem-top">
        <b>${esc(t12(o.at))}</b><span>${esc(mins(nowMin() - o.at) + ' ago')}</span>
        ${tag(o.tag, o.tag === 'App booking' ? 'is-good' : '')}
      </div>
      <h3>${esc(o.title)}</h3>
      <p>${esc(o.body)}</p>
    </div>`), '')}
  </div>`;
}

/* ═══ SHEETS ═══════════════════════════════════════════ */
const upiHtml = amount => `<div class="m-upi">
  <div class="m-qr"></div>
  <b>${esc('turfops@upi · ' + money(amount))}</b>
  <span>Show the phone. Amount is pre-filled.</span>
</div>`;

const sheetShell = (kick, kickMod, title, sub, body) => `<div class="m-sheet">
  <button class="m-scrim" data-act="close-sheet" aria-label="Close"></button>
  <div class="m-sheet-card" id="mSheetBody">
    <div class="m-grip"></div>
    <div class="m-sheet-top">
      ${kickMod ? tag(kick, kickMod) : `<span class="m-kick">${esc(kick)}</span>`}
      <button class="m-x" data-act="close-sheet" aria-label="Close">&times;</button>
    </div>
    <div class="m-sheet-title">${esc(title)}</div>
    <div class="m-sheet-sub">${esc(sub)}</div>
    ${body}
  </div>
</div>`;

const formFields = () => field('fTeam', 'Name / team · required', S.form.team, 'form.team', 'e.g. Northside FC')
  + field('fContact', 'Contact number · required', S.form.contact, 'form.contact', '+91', 'tel');

function sheetHtml(){
  const sh = S.sheet;
  if (!sh) return '';
  const di = S.dayIndex, hs = hours();

  /* — collect over UPI — */
  if (sh.kind === 'collect'){
    const s = sessById(sh.id);
    if (!s) return '';
    const out = outstanding(s);
    return sheetShell('Collect over UPI', 'is-play', money(out),
      s.team + ' · ' + PITCHES[s.pitch].name + ' · ' + rng12(s.start, s.end),
      upiHtml(out)
      + `<div class="m-kvs">${kv('Booking total', money(totalOf(s)))}
         ${kv('Already paid', money(s.advance || 0))}${kv('Contact', s.contact)}</div>`
      + `<div class="m-stack">
          ${btn('Mark ' + money(out) + ' received', 'paid', 'is-lime is-wide is-tall', ` data-id="${s.id}"`)}
          ${btn('Took cash instead', 'cash', 'is-dark is-wide', ` data-id="${s.id}"`)}
        </div>`);
  }

  /* — a booking on the live board — */
  if (sh.kind === 'sess'){
    const s = sessById(sh.id);
    if (!s) return '';
    const p = PITCHES[s.pitch], mode = liveMode(s), out = outstanding(s);
    const head = mode === 'running' ? ['In play', 'is-play']
      : mode === 'owed' ? ['Payment due', 'is-warn2']
      : mode === 'settled' ? ['Settled', 'is-dim']
      : [mode === 'ready' ? 'Checked in' : 'Not started', ''];
    return sheetShell(head[0], head[1], s.team,
      p.name + ' \u00b7 ' + p.sub + ' \u00b7 ' + rng12(s.start, s.end),
      `<div class="m-kvs">${kv('Booked via', s.source === 'app' ? 'App \u00b7 online' : 'OTC \u00b7 over the counter')}
        ${kv('Booking total', money(totalOf(s)))}${kv('Already paid', money(s.advance || 0))}
        ${kv('Outstanding', money(out))}${kv('Contact', s.contact)}</div>
      <div class="m-stack">
        ${out > 0 ? btn('Collect ' + money(out), 'collect', 'is-lime is-wide is-tall', ` data-id="${s.id}"`) : ''}
        ${link('Call the team', tel(s.contact), (out > 0 ? 'is-dark' : 'is-lime is-tall') + ' is-wide')}
        ${link('WhatsApp', wa(s.contact), 'is-dark is-wide')}
        ${mode === 'ready' ? btn('Undo check-in', 'undo-check-in', 'is-ghost is-wide', ` data-id="${s.id}"`) : ''}
      </div>`);
  }

  /* — confirm a walk-in on one hour — */
  if (sh.kind === 'confirm'){
    const p = PITCHES[sh.pi], h = hs[sh.hi];
    const ready = formReady();
    return sheetShell('Confirm walk-in', null, hourRng12(h),
      TODAY_LABEL + ' · ' + p.name + ' · ' + p.sub,
      `<div class="m-kvs">${kv('Amount', money(p.rate))}${kv('Deposit', money(500))}</div>
      ${formFields()}
      <div class="m-stack">
        <button class="m-btn is-wide is-tall ${ready ? 'is-lime' : ''}" data-act="book-slot"
          data-pay="paid" ${ready ? '' : 'disabled'}>
          ${ready ? 'Book and collect ' + money(p.rate) : 'Name and contact required'}</button>
        <button class="m-btn is-dark is-wide" data-act="book-slot" data-pay="venue"
          ${ready ? '' : 'disabled'}>Book, pay at venue</button>
      </div>`);
  }

  /* — block an hour for maintenance — */
  if (sh.kind === 'block'){
    const p = PITCHES[sh.pi], h = hs[sh.hi];
    const ready = S.blockReason.trim().length > 3;
    return sheetShell('Block for maintenance', 'is-dim', hourRng12(h),
      p.name + ' · ' + DOW[di] + ' ' + (3 + di) + ' Aug',
      `<p class="m-sheet-sub" style="margin-top:14px">This hour stops being sellable and the
        owner gets an audit entry against ${esc(STAFF.name)}. A written reason is required.</p>
      ${field('fReason', 'Reason · required', S.blockReason, 'blockReason', 'e.g. Floodlight repair')}
      <div class="m-stack">
        <button class="m-btn is-wide is-tall ${ready ? 'is-lime' : ''}" data-act="block-slot"
          ${ready ? '' : 'disabled'}>${ready ? 'Block this hour' : 'Reason required'}</button>
        ${btn('Cancel', 'close-sheet', 'is-dark is-wide')}
      </div>`);
  }

  /* — a slot on the board — */
  if (sh.kind === 'slot'){
    const p = PITCHES[sh.pi], h = hs[sh.hi];
    const st = statusFor(di, sh.hi, sh.pi), src = sourceFor(di, sh.hi, sh.pi);
    const k = slotKey(di, sh.hi, sh.pi);
    /* A walk-in on an odd window keeps its real times here too. */
    const win = slotRange(di, sh.hi, sh.pi), span = rng12(win[0], win[1]);
    /* Priced off the window it really holds — a 90-minute walk-in is not an
       hour, and quoting one hour here is how a till comes up short. */
    const amount = money(p.rate * (win[1] - win[0]) / 60);
    const det = S.details[k];
    const head = [label(st), st === 'free' ? 'is-play' : st === 'hold' ? 'is-hold' : 'is-dim'];
    const sub = DOW[di] + ' ' + (3 + di) + ' Aug · ' + p.name + ' · ' + p.sub;

    if (st === 'free'){
      const ready = formReady();
      return sheetShell(head[0], head[1], span, sub,
        `<div class="m-kvs">${kv('Rate', money(p.rate) + ' / hour')}${kv('Format', p.sub)}
          ${kv('Deposit', money(500))}</div>
        ${formFields()}
        <span class="m-label is-spaced">Payment status</span>
        <div class="m-opts">${PAY_FORM.map(o => opt(o, o === S.form.pay, 'form-pay')).join('')}</div>
        <div class="m-stack">
          <button class="m-btn is-wide is-tall ${ready ? 'is-lime' : ''}" data-act="book-slot"
            ${ready ? '' : 'disabled'}>${ready ? 'Book this slot' : 'Name and contact required'}</button>
          ${btn('Hold slot for 20 min', 'hold-slot', 'is-dark is-wide')}
        </div>
        <button class="m-foot-note" data-act="ask-block">Block for maintenance · needs a written reason</button>`);
    }
    if (st === 'hold'){
      return sheetShell(head[0], head[1], span, sub,
        `<div class="m-kvs">${kv('Booked via', 'App · online')}${kv('Payment', 'Unpaid · 20 min left')}
          ${kv('Amount', amount)}</div>
        <div class="m-stack">
          ${btn('Confirm hold', 'confirm-hold', 'is-lime is-wide is-tall')}
          ${btn('Release hold', 'release-slot', 'is-dark is-wide')}
        </div>`);
    }
    if (st === 'booked'){
      const who = det && det.team ? det.team : 'Northside FC';
      const num = det && det.contact ? det.contact : '+91 99001 84523';
      return sheetShell(head[0], head[1], span, sub,
        `<div class="m-kvs">${kv('Team', who)}
          ${kv('Booked via', src === 'app' ? 'App · online' : 'OTC · over the counter')}
          ${kv('Contact', num)}${kv('Format', p.sub)}
          ${kv('Payment', det && det.pay ? det.pay : src === 'app' ? 'Payment done · UPI' : 'Due at venue')}
          ${kv('Amount', amount)}</div>
        <div class="m-stack">
          ${link('Call the team', tel(num), 'is-lime is-wide is-tall')}
          ${link('WhatsApp the booking', wa(num), 'is-dark is-wide')}
          ${btn('Release this booking', 'release-slot', 'is-ghost is-wide')}
        </div>`);
    }
    const b = S.blocks[k];
    return sheetShell(head[0], head[1], span, sub,
      `<div class="m-kvs">${kv('Reason', b ? b.reason : 'Floodlight repair')}
        ${kv('Logged by', b ? b.by : STAFF.name)}${kv('Audit trail', 'Sent to owner')}</div>
      <div class="m-stack">${btn('Cancel maintenance block', 'release-slot', 'is-dark is-wide')}</div>`);
  }
  return '';
}

/* ─── render ──────────────────────────────────────────── */
const HEADERS = { home:headerHome, slots:headerSlots, sell:headerSell, reminders:headerReminders };
const SCREENS = { home:homeHtml, slots:screenSlots, sell:screenSell, reminders:screenReminders };
/* Screens carrying a running clock or a countdown need the whole redraw. */
const LIVE_SCREENS = new Set(['home', 'reminders']);

let sheetScroll = 0;

function render(){
  const body = document.getElementById('mBody');
  const sheetPane = document.getElementById('mSheetBody');

  /* Home is rebuilt every second, so its offset has to be put back or the tick
     would yank it to the top mid-scroll. Kept per screen, so coming back from
     the slot board lands on the pitch you were looking at. */
  if (body && S._rendered) S.scrollMem[S._rendered] = body.scrollTop;
  if (sheetPane) sheetScroll = sheetPane.scrollTop;

  const el = document.activeElement;
  let caret = null;
  /* selectionStart throws on input[type=time], so probe it defensively. */
  try { caret = el ? [el.selectionStart, el.selectionEnd] : null; } catch (_) {}
  const keep = el && el.id ? { id:el.id, caret } : null;

  document.getElementById('mHeader').innerHTML = HEADERS[S.screen]();
  body.innerHTML = SCREENS[S.screen]();
  document.getElementById('mDock').innerHTML = S.screen === 'home' ? dockHtml() : '';
  document.getElementById('mSheet').innerHTML = sheetHtml();

  body.scrollTop = S.scrollMem[S.screen] || 0;
  /* Opening the board at 6AM when it is a quarter to six in the evening makes
     the one row that matters the one row you have to go looking for. */
  if (S.screen === 'home' && !S.homeParked){
    const nowRow = body.querySelector('.m-hour.has-now');
    if (nowRow){
      body.scrollTop = Math.max(0, nowRow.offsetTop - body.clientHeight * 0.34);
      S.homeParked = true;
    }
  }
  const nextSheet = document.getElementById('mSheetBody');
  if (nextSheet) nextSheet.scrollTop = sheetScroll; else sheetScroll = 0;
  S._rendered = S.screen;

  if (keep){
    const next = document.getElementById(keep.id);
    if (next){
      next.focus();
      if (keep.caret && keep.caret[0] != null){
        try { next.setSelectionRange(keep.caret[0], keep.caret[1]); } catch (_) {}
      }
    }
  }
}

/* Scroll offsets are kept per screen by render(), so stepping out to the board
   and back lands on the same slab you were looking at. */
function go(screen){
  S.screen = screen;
  S.sheet = null;
}

/* ─── events ──────────────────────────────────────────── */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t || t.disabled) return;
  const act = t.dataset.act, v = t.dataset.v;
  const id = t.dataset.id ? +t.dataset.id : null;
  const pi = t.dataset.pi ? +t.dataset.pi : null;
  const hi = t.dataset.hi ? +t.dataset.hi : null;
  const s = id != null ? sessById(id) : null;
  const sh = S.sheet;

  switch (act){
    /* navigation */
    case 'go': go(v); break;
    case 'go-sell': go('sell'); break;
    case 'day': S.dayIndex = +v; S.sheet = null; break;
    case 'sheet-sess': S.sheet = { kind:'sess', id }; break;
    case 'band':
      if (S.collapsedBands[v]) delete S.collapsedBands[v];
      else S.collapsedBands[v] = true;
      break;

    /* a match, from arrival to settled */
    case 'check-in': S.checkedIn[id] = true; break;
    case 'undo-check-in': delete S.checkedIn[id]; break;
    case 'start':
      setSess(id, { status:'running', startedAt:nowMin() });
      delete S.checkedIn[id];
      break;
    /* Pause steps the match back to checked in rather than freezing a second
       clock. One stopped state is enough on a card this size, and "not running,
       team is here" is the only one an operator can act on. */
    case 'pause-timer': setSess(id, { status:'upcoming' }); S.checkedIn[id] = true; break;
    case 'end-game':
    case 'complete': setSess(id, { status:'done', endedAt:nowMin() }); S.sheet = null; break;
    case 'extend': setSess(id, { end:s.end + 30 }); break;

    /* money */
    case 'collect': S.sheet = { kind:'collect', id }; break;
    case 'collect-first': {
      const first = collectable()[0];
      if (first) S.sheet = { kind:'collect', id:first.id };
      break;
    }
    case 'paid': markPaid(id, 'UPI'); break;
    case 'cash': markPaid(id, 'Cash'); break;

    /* sheets */
    case 'close-sheet': S.sheet = null; S.blockReason = ''; break;
    case 'sheet-slot':
      S.sheet = { kind:'slot', pi, hi, di:S.dayIndex };
      S.form = blankForm();
      break;
    case 'sheet-confirm':
      S.sheet = { kind:'confirm', pi, hi };
      S.form = blankForm();
      break;
    case 'ask-block': S.sheet = { kind:'block', pi:sh.pi, hi:sh.hi }; S.blockReason = ''; break;

    /* the board */
    case 'book-slot': {
      if (!formReady()) return;
      const di = sh.kind === 'confirm' ? TODAY_DI : S.dayIndex;
      const key = slotKey(di, sh.hi, sh.pi), h = hours()[sh.hi];
      setSlot(sh.pi, di, sh.hi, 'booked', 'counter');
      /* The window is stored, not inferred, so a cell can later hold an odd one. */
      S.details[key] = { team:S.form.team.trim(), contact:S.form.contact.trim(),
        start:h * 60, end:(h + 1) * 60,
        pay: sh.kind === 'confirm' ? (t.dataset.pay === 'paid' ? 'Payment done · UPI' : 'Due at venue') : S.form.pay };
      S.sheet = null; S.form = blankForm();
      break;
    }
    case 'hold-slot': setSlot(sh.pi, S.dayIndex, sh.hi, 'hold'); S.sheet = null; break;
    case 'confirm-hold': setSlot(sh.pi, S.dayIndex, sh.hi, 'booked', 'app'); S.sheet = null; break;
    case 'release-slot': {
      const key = slotKey(S.dayIndex, sh.hi, sh.pi);
      setSlot(sh.pi, S.dayIndex, sh.hi, 'free');
      delete S.details[key]; delete S.blocks[key];
      S.sheet = null;
      break;
    }
    case 'block-slot': {
      if (S.blockReason.trim().length <= 3) return;
      const key = slotKey(S.dayIndex, sh.hi, sh.pi);
      setSlot(sh.pi, S.dayIndex, sh.hi, 'blocked');
      S.blocks[key] = { reason:S.blockReason.trim(), by:STAFF.name, at:'just now' };
      S.sheet = null; S.blockReason = '';
      break;
    }
    case 'form-pay': S.form.pay = v; break;

    /* custom slot screen */
    case 'sell-pitch': S.sellPitch = +v; break;
    case 'sell-dur': S.sellDur = +v; break;
    case 'sell-pay': S.sellPay = v; break;
    case 'sell-confirm': {
      if (!(S.sellName.trim().length > 1 && S.sellPhone.trim().length > 5)) return;
      const a = toMin(S.sellStart), b = a + S.sellDur;
      /* This is a real slot going off the market, so it goes onto the board —
         every hour it touches, all carrying the one odd window it really has.
         Without this the form was a receipt printer and nothing else. */
      hours().forEach((h, hi) => {
        if (a >= (h + 1) * 60 || b <= h * 60) return;
        setSlot(S.sellPitch, TODAY_DI, hi, 'booked', 'counter');
        S.details[slotKey(TODAY_DI, hi, S.sellPitch)] = {
          team:S.sellName.trim(), contact:S.sellPhone.trim(), pay:S.sellPay, start:a, end:b };
      });
      S.sellDone = S.sellName.trim() + ' booked · ' + rng12(a, b) + ' on '
        + PITCHES[S.sellPitch].name + ' · ' + S.sellPay;
      S.sellName = ''; S.sellPhone = '';
      break;
    }

    default: return;
  }
  render();
});

/* Text fields write straight into state; the redraw puts focus and caret back. */
document.addEventListener('input', e => {
  const el = e.target.closest('[data-model]');
  if (!el) return;
  const path = el.dataset.model;
  if (path.startsWith('form.')) S.form[path.slice(5)] = el.value;
  else S[path] = el.value;
  render();
});

/* Escape closes a sheet, then steps back to the stream. */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (S.sheet) S.sheet = null;
  else if (S.screen !== 'home') go('home');
  else return;
  render();
});

/* A tap is pointerdown → pointerup → click. If the once-a-second redraw lands
   between them the element under the thumb is replaced and the click never
   fires — the button visibly "does nothing". So the clock holds still from
   finger-down until just after the click, then catches up. */
let holding = false, missedTick = false;
const release = () => {
  holding = false;
  if (missedTick){ missedTick = false; render(); }
};
addEventListener('pointerdown', () => { holding = true; }, true);
addEventListener('pointerup', () => setTimeout(release, 0), true);
addEventListener('pointercancel', () => setTimeout(release, 0), true);

render();
setInterval(() => {
  if (!LIVE_SCREENS.has(S.screen)) return;
  if (holding){ missedTick = true; return; }
  render();
}, 1000);
