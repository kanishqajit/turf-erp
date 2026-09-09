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

/* ─── the API ─────────────────────────────────────────── */
/* This app is a second front end over the console's server, not a second copy
   of the turf. There is no mock data left in it: the board is drawn from
   /api/state, every button posts to the same audited endpoints the counter
   posts to, and the session cookie is the console's — which is why the server
   serves this file itself. Open it on another origin and the cookie
   (HttpOnly, SameSite=Strict) never arrives. */

async function apiRequest(path, { method = 'GET', body } = {}){
  const headers = { Accept:'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET','HEAD'].includes(method) && S.csrf) headers['X-CSRF-Token'] = S.csrf;
  const response = await fetch(path, { method, headers, credentials:'same-origin',
    body:body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok){
    if (response.status === 401){ S.user = null; S.csrf = ''; }
    const gone = path.startsWith('/api/') && [404, 405, 501].includes(response.status);
    const error = new Error(data.error?.message || (gone
      ? 'The Turf Operations API is not running at this address.'
      : 'Request failed (' + response.status + ').'));
    error.code = data.error?.code;
    throw error;
  }
  return data;
}

/* ─── time ────────────────────────────────────────────── */
const pad2 = n => String(n).padStart(2, '0');
const isoDate = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/* The board addresses days as an offset from today, so "day 0" is always the
   shift you are standing in and no week arithmetic is needed on a phone. */
const dateAt = offset => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };
const dateFor = offset => isoDate(dateAt(offset));
const dayLabel = offset => { const d = dateAt(offset); return DOW[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; };
/* An accounts row can be weeks old, so it names its own day rather than
   assuming today. Parsed as local parts — new Date('2026-08-15') is UTC and
   lands a day early east of Greenwich. */
function dayName(iso){
  const p = String(iso).split('-');
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  return dateFor(0) === iso ? 'Today'
    : dateFor(-1) === iso ? 'Yesterday'
    : DOW[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + MON[d.getMonth()];
}
const todayIso = () => dateFor(0);
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };

/* ─── venue constants ─────────────────────────────────── */
/* Mirrors client/constants.js. OVERVIEW.md flags that pitches and rates exist
   in two tiers already and that the real fix is the server sending them in
   /api/state; this is now a third reader of the same duplication, so when that
   fix lands, delete this block rather than adding to it. */
const PITCHES = [
  { name:'Pitch A',     short:'A',    sub:'7-a-side',  rate:1800 },
  { name:'Pitch B',     short:'B',    sub:'5-a-side',  rate:1200 },
  { name:'Main Ground', short:'Main', sub:'11-a-side', rate:3200 },
];
/* Midnight, mirroring CLOSE_MIN in server/store.mjs and END_HOUR in
   client/constants.js. All three are the same fact in three files. */
const START_HOUR = 6, END_HOUR = 24;
const PAY_FORM = ['Payment at venue','Advance paid','Payment done'];
const TENDERS = ['Cash','UPI','Card','Split'];
const ROLES = { operator:1, manager:2, owner:3 };

/* ─── state ───────────────────────────────────────────── */
const blankForm = () => ({ team:'', contact:'', pay:'Payment at venue' });

const S = {
  /* session */
  ready:false, user:null, csrf:'', authError:'', apiError:'', busy:false, syncedAt:0,
  /* server records */
  bookings:[], holds:[], blocks:[], payments:[], accounts:[], settings:{ depositAmount:500 },
  /* screens */
  screen:'home', sheet:null, dayIndex:0,
  boardMode:'all', pitch:0,   // the days grid: all pitches on a day, or one across the week
  collapsedBands:{},
  /* Check-in is the one piece of session state the server has no column for
     (OVERVIEW.md); starting the timer is the real, audited transition. */
  checkedIn:{},
  tender:'UPI', splitCash:'', timerAt:null,
  /* Clocks stopped mid-game. The server has no paused status (OVERVIEW.md), so
     a pause is held here and settled on the server when play resumes. */
  paused:{},
  form:blankForm(), blockReason:'', cancelReason:'', releaseReason:'',
  sellPitch:0, sellStart:'20:00', sellDur:60,
  sellName:'', sellPhone:'', sellPay:'Payment at venue', sellDone:'',
  moneyFilter:'open', moneyOpen:null, todayFilter:'all',
  /* Settings. The theme is a property of this handset — a counter phone and
     the manager's own can differ — so it never goes to the server. The deposit
     is the venue's, so it does. */
  theme:'system', depositDraft:'',
  revAsk:null, revMode:'Cash', revVal:'', revReason:'',
  scrollMem:{}, _rendered:null, homeParked:false,
  login:{ email:'', password:'' },
};

const can = role => !!S.user && ROLES[S.user.role] >= ROLES[role];
const APP_NAME = 'Futly Console';
/* "R. Kumar" and "operator@turf.test" both have to come out as two letters. */
function initials(){
  const raw = String((S.user && (S.user.name || S.user.email)) || '').trim();
  const parts = raw.split(/[ .@_-]+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}
const avatarBtn = cls => `<button class="${cls}" data-act="profile"
  aria-label="Account and sign out">${esc(initials())}</button>`;

/* ─── the theme ──────────────────────────────── */
/* Three settings, two themes: "system" is resolved against the handset here and
   written out as light or dark, so the stylesheet carries one dark block rather
   than the same thirty declarations under an attribute and again under a media
   query. Stored on the device, the way the console stores it per terminal — a
   phone used pitchside at night and a laptop in an office are different rooms,
   and this is a property of the room. */
const PREF_KEY = 'turf.mobile.prefs';
const THEMES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const resolvedTheme = () => S.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : S.theme;

function applyTheme(){
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  /* Launched from the home screen the status bar sits over the header, so it
     has to turn with it or the notch stays pale over a black page. */
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#000000' : '#16181C');
}

function loadPrefs(){
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {};
    if (THEMES.some(([v]) => v === p.theme)) S.theme = p.theme;
  } catch (_) {}
}
const savePrefs = () => {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ theme:S.theme })); } catch (_) {}
};

loadPrefs();
applyTheme();
/* Only while following the phone: an explicit choice is not a suggestion. */
darkQuery.addEventListener('change', () => {
  if (S.theme !== 'system') return;
  applyTheme();
  render();
});

/* ─── helpers ─────────────────────────────────────────── */
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money = n => '₹' + Math.round(n).toLocaleString('en-IN');
const toMin = t => { const p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); };

function t12(min){
  const t = Math.floor(min), h = Math.floor(t / 60) % 24, m = t % 60;
  return (h % 12 === 0 ? 12 : h % 12) + (m ? ':' + pad2(m) : '') + (h < 12 ? 'AM' : 'PM');
}
function rng12(a, b){
  const x = t12(a), y = t12(b);
  /* Dropping the first meridiem only reads correctly inside one half of the
     clock. A whole trading day is 6AM to 12AM, and collapsing that to "6–12AM"
     says six hours where eighteen were meant. */
  return b - a < 720 && x.slice(-2) === y.slice(-2)
    ? x.slice(0, -2) + '–' + y : x + '–' + y;
}
const hourRng12 = h => rng12(h * 60, (h + 1) * 60);
const hours = () => Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
const mins = n => {
  const v = Math.max(0, Math.round(n));
  if (v < 60) return v + 'm';
  const h = Math.floor(v / 60), m = v % 60;
  return m ? h + 'h ' + m + 'm' : h + 'h';
};
const tel = c => 'tel:' + String(c).replace(/[^\d+]/g, '');
const wa = c => 'https://wa.me/' + String(c).replace(/\D/g, '');
const bandOf = h => h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Late night';

const label = s => ({ free:'Open', booked:'Booked', hold:'On hold', blocked:'Maintenance' }[s]);
/* A cell is ~88px wide on a 360px screen, so it gets the short word. */
const shortLabel = s => ({ free:'Open', booked:'Booked', hold:'Hold', blocked:'Blocked' }[s]);
const srcWord = src => src === 'app' ? 'APP' : 'OTC';
const srcMark = src => `<span class="m-src">${srcWord(src)}</span>`;

/* ── what a slot costs ──
   The arithmetic the server bills by (store.mjs priceFor, mirrored in
   client/domain.js and pinned by a test). Quoted money and billed money have
   to be one rule, so this quotes and the server confirms. */
const FLOODLIGHT_FROM = 18 * 60, FLOODLIGHT_FEE = 300;
const needsFloodlights = end => end > FLOODLIGHT_FROM;
const priceFor = (pi, start, end) => Math.round(
  PITCHES[pi].rate * (end - start) / 60 + (needsFloodlights(end) ? FLOODLIGHT_FEE : 0));

/* ─── bookings ────────────────────────────────────────── */
/* Statuses a booking has exited through: no slot held, no money owed. */
const GONE = new Set(['noshow', 'cancelled']);

const sess = () => S.bookings.filter(b => b.date === todayIso());
/* The accounts worklist reaches weeks back, so a row there may not be one of
   the days the board loaded. */
const sessById = id => S.bookings.find(b => b.id === id) || S.accounts.find(b => b.id === id);
/* The server derives every one of these; they are read here, never written. */
const totalOf = b => Math.max(0, b.amount - (b.discount || 0));
const paidFor = b => b.collected || 0;
const outstanding = b => GONE.has(b.status) ? 0 : Math.max(0, totalOf(b) - paidFor(b));

const dueList = () => sess().filter(b => outstanding(b) > 0).sort((a, b) => a.end - b.end);
const dueTotal = () => dueList().reduce((n, b) => n + outstanding(b), 0);
/* Owed today and collectable now are different numbers: money on a game that
   has not kicked off is nobody's job yet. */
const collectable = () => dueList().filter(b => b.status === 'running' || b.status === 'done');
const collectTotal = () => collectable().reduce((n, b) => n + outstanding(b), 0);

/* What the till should hold, by tender, straight off the server's own
   per-mode sums — the drawer is counted against these three figures. */
function takings(){
  const by = { Cash:0, UPI:0, Card:0 };
  sess().forEach(b => Object.keys(by).forEach(m => { by[m] += (b.collectedByMode || {})[m] || 0; }));
  return { by, total:by.Cash + by.UPI + by.Card };
}

/* ─── what is on a cell ───────────────────────────────── */
/* The board used to be a deterministic hash. It is now occupancy: a booking, a
   live hold, or a maintenance block, in that order of precedence — the same
   order the server enforces when it refuses a double sale. */
const overlaps = (r, a, b) => r.start < b && r.end > a;
function cellAt(date, pitch, hi){
  const h = hours()[hi], a = h * 60, b = a + 60;
  const booking = S.bookings.find(x => x.date === date && x.pitch === pitch
    && !GONE.has(x.status) && overlaps(x, a, b));
  if (booking) return { st:'booked', booking };
  const hold = S.holds.find(x => x.date === date && x.pitch === pitch && overlaps(x, a, b));
  if (hold) return { st:'hold', hold };
  const block = S.blocks.find(x => x.date === date && x.pitch === pitch && overlaps(x, a, b));
  if (block) return { st:'blocked', block };
  return { st:'free' };
}
const cellState = (date, hi, pi) => cellAt(date, pi, hi).st;
/* The window a cell really holds — a walk-in taken at the gate can sit on an
   odd one, and the cell should say so rather than round it to a tidy hour. */
function cellRange(date, pitch, hi){
  const c = cellAt(date, pitch, hi), r = c.booking || c.hold || c.block;
  const h = hours()[hi];
  return r ? [r.start, r.end] : [h * 60, (h + 1) * 60];
}
const cellSource = (date, pitch, hi) => (cellAt(date, pitch, hi).booking || {}).source || 'counter';
const holdLeft = hold => Math.max(0, Math.ceil((new Date(hold.expiresAt).getTime() - Date.now()) / 60000));

/* ─── reminders ───────────────────────────────────────── */
/* The console's rules (views/alerts.js), so clearing one here clears the same
   thing there — both are reading one server. */
function buildAlerts(){
  const now = nowMin(), game = [], cash = [];
  sess().forEach(b => {
    if (GONE.has(b.status)) return;
    const p = PITCHES[b.pitch];
    if (b.status === 'upcoming' && b.start - now < 120){
      const late = now - b.start;
      game.push({ at:b.start, rel: late > 0 ? mins(late) + ' ago' : 'in ' + mins(b.start - now),
        tag: late > 5 ? 'Not started' : 'Starts soon', warn: late > 5,
        title: b.team + ' · ' + p.name,
        body: late > 5
          ? 'Slot began ' + mins(late) + ' ago and the timer is not running.'
          : 'Booked ' + rng12(b.start, b.end) + '. Start the timer when they take the pitch.',
        action:'Start timer', act:'start', id:b.id });
    }
    const w = b.status === 'running' ? liveWindow(b) : null;
    if (w && now > w.until){
      game.push({ at:w.until, rel: mins(now - w.until) + ' over', tag:'Overtime', warn:true,
        title: b.team + ' · ' + p.name,
        body: 'Running ' + mins(now - w.until) + ' past the end of its hour.',
        action:'Mark complete', act:'ask-end', id:b.id });
    } else if (w && w.until - now < 15){
      game.push({ at:w.until, rel: mins(w.until - now) + ' left', tag:'Ending', warn:false,
        title: b.team + ' · ' + p.name,
        body: 'Whistle at ' + t12(w.until) + '. Mark complete or add 30 minutes.',
        action:'Mark complete', act:'ask-end', id:b.id });
    }
    if (outstanding(b) > 0){
      cash.push({ at:b.end, rel: b.status === 'done' ? 'overdue' : 'at whistle',
        tag: b.status === 'done' ? 'Overdue' : paidFor(b) ? 'Balance due' : 'Due at venue',
        title: money(outstanding(b)) + ' · ' + b.team,
        body: p.name + ' · ' + rng12(b.start, b.end) + ' · ' + b.contact,
        action:'Collect over UPI', act:'collect', id:b.id });
    }
  });
  game.sort((a, b) => a.at - b.at);
  cash.sort((a, b) => a.at - b.at);
  return { game, cash };
}

/* ─── loading and mutating ────────────────────────────── */
async function loadState(){
  const from = dateFor(-1), to = dateFor(8);
  const state = await apiRequest('/api/state?from=' + from + '&to=' + to);
  S.bookings = state.bookings || [];
  S.holds = state.holds || [];
  S.blocks = state.blocks || [];
  S.settings = state.settings || { depositAmount:500 };
  try {
    /* The board only needs the days it draws; the accounts worklist needs
       enough history to be worth opening, without pulling a year onto a phone. */
    const acc = await apiRequest('/api/accounts?from=' + dateFor(-30) + '&to=' + dateFor(8));
    S.accounts = acc.bookings || [];
    S.payments = acc.payments || [];
  } catch (_) { /* the worklist still works off today's bookings alone */ }
  S.syncedAt = Date.now();
}

/* Every write goes through here: post, reload, repaint. A phone loses signal
   in a stairwell, so a failure has to say so on screen rather than leave a
   button looking as though it worked. */
async function mutate(path, body = {}){
  if (S.busy) return null;
  S.busy = true; S.apiError = '';
  render();
  try {
    const result = await apiRequest(path, { method:'POST', body });
    await loadState();
    return result;
  } catch (error){
    S.apiError = error.message;
    return null;
  } finally {
    S.busy = false;
    render();
  }
}

async function boot(){
  loadPauses();
  try {
    const auth = await apiRequest('/api/auth/me');
    S.user = auth.user;
    S.csrf = auth.csrfToken;
    if (!S.user.mustChangePassword) await loadState();
  } catch (error){
    if (error.code !== 'authentication_required') S.authError = error.message;
  }
  S.ready = true;
  render();
}

/* ─── icons ───────────────────────────────────────────── */
const SVG = (d, extra) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"
  stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  back: SVG('<path d="M14.5 5 8 12l6.5 7"/>'),
  bell: SVG('<path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>'),
  grid: SVG('<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>'),
  list: SVG('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1.1"/><circle cx="4" cy="12" r="1.1"/><circle cx="4" cy="18" r="1.1"/>'),
  cal: SVG('<rect x="3" y="5" width="18" height="16" rx="2.4"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  wallet: SVG('<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5z"/><path d="M16.5 12.5h.01"/>'),
  gear: SVG('<circle cx="12" cy="12" r="3.1"/><path d="M19.6 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.55V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1.03H3a2 2 0 1 1 0-4h.11a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.55V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.55 1.03H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.29 1.03z"/>'),
};

/* The bell used to be the fifth tab. Settings took that place, so the count of
   things still needing a decision moves to the shift header — one tap from the
   board, which is where the shift is actually read. */
function bellBtn(){
  const a = buildAlerts(), n = a.game.length + a.cash.length;
  return `<button class="m-bell" data-act="go" data-v="reminders"
    aria-label="Alerts${n ? ', ' + n + ' pending' : ''}">${ICON.bell}${
    n ? `<em>${n > 9 ? '9+' : n}</em>` : ''}</button>`;
}

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


/* The header on every screen that is not home: one back arrow, a kicker and a
   title. `back` names where the arrow goes, because the custom-slot form is
   reached from the board and should return there. */
const bar = (kicker, title, back) => `<div class="m-bar">
  <button class="m-back" data-act="go" data-v="${back || 'home'}" aria-label="Back">${ICON.back}</button>
  <div class="m-bar-txt"><small>${esc(kicker)}</small><h1>${esc(title)}</h1></div>
  ${avatarBtn('m-bar-avatar')}
</div>`;

/* ═══ SCREEN: home — the live board ════════════════════ */
/* Today's grid with a red line sweeping down it in real time. Rows far from
   the line stay bubbles; the row it is crossing — and the row it is about to
   reach — opens, and a booking on it becomes the control for that match.
   Check in, start, end, collect: the four things a shift consists of, on the
   cell they belong to.

   Card grammar is the console's (FRONTEND.md, "A match, from arrival to
   settled"), and every control on it posts to the same audited endpoint the
   counter posts to. */

const START_WINDOW = 20;   // minutes before kick-off that check-in opens

/* Which face a booking is wearing. null means it is still just a line on the
   schedule and needs no controls. */
function liveMode(b){
  if (GONE.has(b.status)) return null;
  if (b.status === 'done') return outstanding(b) > 0 ? 'owed' : 'settled';
  if (b.status === 'running') return 'running';
  if (S.paused[b.id]) return 'paused';
  if (S.checkedIn[b.id]) return 'ready';
  return b.start - nowMin() <= START_WINDOW ? 'arriving' : null;
}

/* The clock runs from the minute the operator said play began, not the minute
   the slot was sold for — those differ whenever a team walks on late, and the
   countdown is the number staff read to know when to call time. The booked
   window still owns the grid: the cell keeps its placement, and a session that
   overruns says so by going over rather than being redrawn somewhere else.
   Mirrors liveStateFor() in client/views/availability.js — the two clocks have
   to agree or the counter and the pitch call time a quarter of an hour apart. */
function liveWindow(b){
  const total = Math.max(1, b.end - b.start);
  const held = S.paused[b.id];
  /* Held: the clock reads whatever it read at the moment it was stopped. */
  const from = held ? held.from : b.startedAt == null ? b.start : b.startedAt;
  return { from, until:from + total, total, at:held ? held.at : null };
}

/* A pause is a local hold plus a correction posted when play resumes: the
   restart minute is pushed forward by exactly the time the clock stood still,
   so the session keeps the minutes it paid for and the counter's screen agrees
   again the moment it is running. Kept in localStorage because a phone that
   locks mid-rain-delay must not come back with the clock running. */
const PAUSE_KEY = 'turf-erp:paused';
function loadPauses(){
  try { S.paused = JSON.parse(localStorage.getItem(PAUSE_KEY) || '{}') || {}; } catch (_) { S.paused = {}; }
}
function savePauses(){
  try { localStorage.setItem(PAUSE_KEY, JSON.stringify(S.paused)); } catch (_) {}
}
/* A session someone restarted from the counter is not paused any more. */
function sweepPauses(){
  if (S.busy) return;
  let moved = false;
  Object.keys(S.paused).forEach(id => {
    const b = sessById(id);
    if (!b || b.status !== 'upcoming'){ delete S.paused[id]; moved = true; }
  });
  if (moved) savePauses();
}

/* What the server will accept as a start minute, so a bound the operator
   cannot cross shows as a dead button rather than an error after the fact. */
const timerFloor = b => b.start - 15;
const timerCeil = b => Math.min(Math.floor(nowMin()), b.end - 1);
const clampTimerAt = (b, m) => Math.max(timerFloor(b), Math.min(timerCeil(b), Math.round(m)));

const bookingOn = (date, pitch, hi) => cellAt(date, pitch, hi).booking || null;
/* One pitch, one match — the server refuses a second, so the button says so
   first rather than letting the tap come back as a red banner. */
const pitchBusy = b => S.bookings.find(x => x.date === b.date && x.pitch === b.pitch
  && x.status === 'running' && x.id !== b.id);
/* The row a booking is drawn on. One that began before the board opens still
   has to appear somewhere, so it clamps to the first visible hour. */
function firstHiOf(b){
  const i = hours().indexOf(Math.floor(b.start / 60));
  return i < 0 ? 0 : i;
}

/* A row opens when the line is inside it, when the check-in window is about to
   reach it, or when a match on it ended owing money — cash stays on the board
   until it is taken, which is the leak this exists to close. */
function rowOpen(hi){
  const date = todayIso();
  /* An hour opens for what is on it, never for the clock alone — the hour the
     line is crossing was opening too, which on an empty morning gave three tall
     blank cells and nothing to do in them. The line draws across a closed row
     perfectly well. */
  return PITCHES.some((p, pi) => {
    const b = bookingOn(date, pi, hi);
    return b && firstHiOf(b) === hi
      && ['owed', 'running', 'paused', 'ready', 'arriving'].includes(liveMode(b));
  });
}

/* "45:00", seconds at 44%. Past an hour it grows an hours field rather than
   counting to "72:43", which nobody reads as an hour and a bit. */
function countTxt(end, at){
  const raw = Math.floor((end - (at == null ? nowMin() : at)) * 60), over = raw < 0, v = Math.abs(raw);
  const h = Math.floor(v / 3600), m = Math.floor(v % 3600 / 60);
  return (over ? '+' : '') + (h ? h + ':' + pad2(m) : m) + '<i>:' + pad2(v % 60) + '</i>';
}

const TICON = {
  check:'<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.8l4.6 4.4L19 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play:'<svg viewBox="0 0 24 24"><path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor"/></svg>',
  undo:'<svg viewBox="0 0 24 24" fill="none"><path d="M9 5L4.5 9.5 9 14M4.5 9.5H14a5.5 5.5 0 010 11H8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pause:'<svg viewBox="0 0 24 24"><rect x="7" y="4.5" width="3.8" height="15" rx="1.8" fill="currentColor"/><rect x="13.2" y="4.5" width="3.8" height="15" rx="1.8" fill="currentColor"/></svg>',
  cross:'<svg viewBox="0 0 24 24" fill="none"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>',
  cash:'<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6.5" width="18" height="11" rx="2.4" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="2.2"/></svg>',
  bell:'<svg viewBox="0 0 24 24"><path d="M12 2.6a5.6 5.6 0 00-5.6 5.6v3.4L4.6 15.2a1 1 0 00.9 1.5h13a1 1 0 00.9-1.5l-1.8-3.6V8.2A5.6 5.6 0 0012 2.6zM9.6 18.4a2.6 2.6 0 004.8 0z" fill="currentColor"/></svg>',
};

/* One bar across the base of the card, never a chip in a corner — the corner
   is where nothing looks, and this is the action the card exists to offer. */
const cta = (act, id, icon, label, mod) => `<button class="m-cta${mod ? ' ' + mod : ''}"
  data-act="${act}" data-id="${esc(id)}" aria-label="${esc(label || act)}"${S.busy ? ' disabled' : ''}>${
  icon ? `<i>${TICON[icon]}</i>` : ''}${label ? `<span>${esc(label)}</span>` : ''}</button>`;

/* The ring is the card's own outline, so the countdown and how far through it
   is are one object rather than a bar sitting inside a box. */
const ringHtml = pct => `<svg class="m-ring" preserveAspectRatio="none" aria-hidden="true">
  <rect class="m-ring-track" pathLength="100"></rect>
  <rect class="m-ring-fill" pathLength="100" style="stroke-dasharray:${pct.toFixed(2)} 100"></rect></svg>`;

function cardHtml(b, mode){
  const now = nowMin(), span = rng12(b.start, b.end);
  const open = ` data-act="sheet-sess" data-id="${esc(b.id)}"`;

  if (mode === 'running' || mode === 'paused'){
    const w = liveWindow(b), held = mode === 'paused';
    /* Held, the clock reads the minute it stopped on rather than the wall. */
    const mark = held ? w.at : now;
    const over = mark > w.until;
    const pct = Math.max(0, Math.min(100, (mark - w.from) / w.total * 100));
    return `<div class="m-cell is-timer${over ? ' is-over' : ''}${held ? ' is-paused' : ''}">
      <button class="m-cellface"${open}>
        <span class="m-tm-top">${held ? TICON.pause + 'Paused' : TICON.bell + 'Ends ' + esc(t12(w.until))}</span>
        <b class="m-tm-count${over ? ' is-over' : ''}">${countTxt(w.until, mark)}</b>
        <span class="m-tm-sub">${esc(b.team)}</span>
      </button>
      ${ringHtml(pct)}
      <span class="m-tm-acts">
        <button class="m-tm-btn${held ? ' is-go' : ''}" data-act="${held ? 'resume-timer' : 'pause-timer'}"
          data-id="${esc(b.id)}" aria-label="${held ? 'Resume the timer' : 'Pause the timer'}"${
          S.busy ? ' disabled' : ''}>${held ? TICON.play : TICON.pause}</button>
        <button class="m-tm-btn is-end" data-act="ask-end" data-id="${esc(b.id)}"
          aria-label="End session"${S.busy ? ' disabled' : ''}>${TICON.cross}</button>
      </span>
    </div>`;
  }

  if (mode === 'owed'){
    return `<div class="m-cell is-owed">
      <button class="m-cellface"${open}>
        <span class="m-owed-top"><b>Payment due</b></span>
        <b class="m-owed-sum">${esc(money(outstanding(b)))}</b>
        <span class="m-owed-who">${esc(b.team)}</span>
        <span class="m-owed-when">${esc('Ended ' + t12(b.endedAt == null ? b.end : b.endedAt))}</span>
      </button>
      <span class="m-tray">${
        can('manager') ? cta('ask-reopen', b.id, 'undo', '', 'is-quiet is-icon') : ''}${
        cta('collect', b.id, null, 'Collect', 'is-paper')}</span>
    </div>`;
  }

  if (mode === 'arriving' || mode === 'ready'){
    const late = now - b.start, busy = pitchBusy(b);
    return `<div class="m-cell is-face${mode === 'ready' ? ' is-ready' : ''}">
      <button class="m-cellface"${open}>
        <span class="m-face-tag">${esc(srcWord(b.source))}</span>
        <span class="m-face-top">${esc(span)}</span>
        <b class="m-face-cue">${mode === 'ready' ? 'Ready' : late > 0 ? 'Late' : 'Starting soon'}</b>
        <span class="m-face-sub">${esc(b.team)}</span>
      </button>
      <span class="m-tray">${busy
        ? `<span class="m-tray-note">${esc(busy.team)} still on</span>`
        : mode === 'ready'
        ? cta('undo-check-in', b.id, 'undo', '', 'is-quiet is-icon') + cta('start', b.id, null, 'Start')
        : cta('check-in', b.id, 'check', 'Check in')}</span>
    </div>`;
  }

  /* Played and paid for. It keeps the colour of the booking it was so the
     board reads the same as the days grid, and recedes rather than competing
     with the slots that still need something. */
  const paid = outstanding(b) === 0;
  const face = `<span class="m-face-top">${esc(span)}</span>
    <b class="m-plain-who">${esc(b.team)}</b>
    <span class="m-plain-foot">${esc(paid ? 'Paid' : money(outstanding(b)) + ' due')}${srcMark(b.source)}</span>`;
  /* A settled card asks for nothing, so it recedes — but money is corrected
     more often than anyone likes, so it keeps one quiet chip. Editing a payment
     is not refunding one: a card marked paid in error needs the entry undone,
     and the operator should not have to call that a refund to get at it. */
  if (mode === 'settled' && paidFor(b) > 0 && can('manager'))
    return `<div class="m-cell is-plain is-${esc(b.source)} is-settled">
      <button class="m-cellface is-flat"${open}>${face}</button>
      <span class="m-tray">${cta('ask-reverse', b.id, null, 'Edit payment', 'is-quiet')}</span>
    </div>`;
  return `<button class="m-cell is-plain is-${esc(b.source)}${
    mode === 'settled' ? ' is-settled' : ''}"${open}>${face}</button>`;
}

function bubHtml(date, hi, pi, tall, week){
  const c = cellAt(date, pi, hi), st = c.st;
  const sel = S.sheet && S.sheet.kind === 'slot' && S.sheet.pi === pi
    && S.sheet.hi === hi && S.sheet.date === date;
  const [a, b] = cellRange(date, pi, hi);
  const extra = st === 'booked' ? ' · ' + srcWord(c.booking.source)
    : st === 'hold' ? ' · ' + holdLeft(c.hold) + 'm' : '';
  const title = PITCHES[pi].name + ' · ' + dayName(date) + ' · '
    + rng12(a, b) + ' · ' + label(st) + extra;
  /* In the week the tile names the hour it stands for rather than the booking's
     own window — the column has to read consistently downward, and the real
     times are in the sheet a tap away. Blank tiles were the whole problem: the
     only way to know what one meant was to trace to the left edge and the top
     and come back. */
  const face = week
    ? `<b>${esc(t12(hours()[hi] * 60))}</b><em>${esc(shortLabel(st))}</em>`
    : `<b>${esc(rng12(a, b))}</b><em>${esc(shortLabel(st) + extra)}</em>`;
  return `<button class="m-bub is-${st}${st === 'booked' ? ' is-' + c.booking.source : ''}${
    sel ? ' is-sel' : ''}${tall ? ' is-tall' : ''}${week ? ' is-week' : ''}"
    data-act="sheet-slot" data-pi="${pi}" data-hi="${hi}" data-date="${date}"
    title="${esc(title)}" aria-label="${esc(title)}">${face}</button>`;
}

/* A column is a (date, pitch) pair with a name on it. All pitches on one day
   makes three of them; one pitch across the week makes seven. Everything below
   reads columns rather than pitches, so the two views are one grid.

   The head and the bands are built separately because the days screen pins the
   head to the top of the scroll along with its date chips, while home keeps the
   two together. */
const pitchCols = date => PITCHES.map((p, pi) =>
  ({ date, pitch:pi, label:p.name, sub:null, title:p.name + ' · ' + p.sub }));
const weekCols = pitch => Array.from({ length:7 }, (_, i) => {
  const d = dateAt(i);
  return { date:dateFor(i), pitch, label:DOW[(d.getDay() + 6) % 7], sub:String(d.getDate()),
    title:PITCHES[pitch].name + ' · ' + dayLabel(i) };
});
/* Seven columns on a phone leave about 35px each, which holds a colour and
   nothing else. The hour stays in the gutter and the detail is one tap away,
   so a week reads as a shape rather than a table. */
const isWeek = cols => cols.length > 3;

function boardHead(cols){
  const hs = hours(), week = isWeek(cols);
  const open = cols.map(c => hs.filter((h, hi) => cellState(c.date, hi, c.pitch) === 'free').length);
  return `<div class="m-cols">
    ${week ? '' : '<span class="m-cols-time">Time</span>'}
    ${cols.map((c, i) => `<span class="m-col" title="${esc(c.title)}">
      <b>${esc(c.label)}</b>
      <small>${week ? esc(c.sub) : open[i] + ' of ' + hs.length + ' open'}</small></span>`).join('')}
  </div>`;
}

function boardBands(cols, live){
  const hs = hours(), now = nowMin(), week = isWeek(cols);

  return ['Morning','Afternoon','Evening','Late night'].map(name => {
    const idx = hs.map((h, hi) => hi).filter(hi => bandOf(hs[hi]) === name);
    if (!idx.length) return '';
    const closed = !!S.collapsedBands[name];
    const free = idx.reduce((n, hi) =>
      n + cols.filter(c => cellState(c.date, hi, c.pitch) === 'free').length, 0);

    const rows = closed ? '' : idx.map(hi => {
      const h = hs[hi], a = h * 60;
      const opened = live && rowOpen(hi);
      const onNow = live && now >= a && now < a + 60;

      const cells = cols.map(c => {
        const b = live ? bookingOn(c.date, c.pitch, hi) : null;
        if (!b || firstHiOf(b) !== hi) return bubHtml(c.date, hi, c.pitch, opened, week);
        const mode = liveMode(b);
        return opened && mode ? cardHtml(b, mode) : bubHtml(c.date, hi, c.pitch, opened, week);
      }).join('');

      return `<div class="m-hour${opened ? ' is-open' : ''}${onNow ? ' has-now' : ''}">
        ${week ? '' : `<span class="m-hourlbl">${esc(rng12(a, a + 60))}</span>`}
        ${cells}
        ${onNow ? `<span class="m-now" style="--frac:${((now - a) / 60).toFixed(4)}">
          <span class="m-now-lbl">${esc(t12(now))}</span></span>` : ''}
      </div>`;
    }).join('');

    /* The dates sit at the top of a scroll eighteen rows long. The bands
       already cut that into four, so each repeats them: the columns are never
       more than about six rows from something that names them. */
    const restate = week && !closed ? `<div class="m-hour is-restate" aria-hidden="true">${
      cols.map(c => `<span>${esc(c.label + ' ' + c.sub)}</span>`).join('')}</div>` : '';

    return `<div class="m-band">
      <button class="m-band-head${closed ? ' is-closed' : ''}" data-act="band" data-v="${esc(name)}"
        aria-expanded="${!closed}">
        <i class="m-chev">${closed ? '▸' : '▾'}</i><b>${name}</b><i class="m-rule"></i>
        <span class="m-band-span">${esc(rng12(hs[idx[0]] * 60, (hs[idx[idx.length - 1]] + 1) * 60))}</span>
        <em>${closed ? 'SHOW' : 'HIDE'}</em>
      </button>${restate}${rows}
    </div>`;
  }).join('');
}

function headerHome(){
  const now = nowMin();
  const playing = sess().filter(b => b.status === 'running').length;
  const waiting = collectable().length;
  const count = (v, lbl, mod) => `<span class="m-count${mod ? ' ' + mod : ''}">
    <b>${esc(v)}</b>${esc(lbl)}</span>`;

  return `<div class="m-shift">
    <div class="m-brand">
      <span class="m-brand-mark">F</span><b>${esc(APP_NAME)}</b>${bellBtn()}${avatarBtn('m-avatar')}
    </div>
    <div class="m-shift-top">
      <div>
        <div class="m-kicker"><i></i>Live shift · ${esc(dayLabel(0))}</div>
        <div class="m-clock">${t12(now)}</div>
      </div>
      <div class="m-shift-end">
        <div class="m-due-total"><span>Still to collect</span><b>${money(dueTotal())}</b></div>
      </div>
    </div>
    <div class="m-counts">
      ${count(playing, 'in play', playing ? 'is-play' : '')}
      ${count(PITCHES.length - playing, 'idle', '')}
      ${count(waiting, 'to collect', waiting ? 'is-warn' : '')}
    </div>
  </div>`;
}

const homeHtml = () => {
  const cols = pitchCols(todayIso());
  return `<div class="m-board" style="--ncols:${cols.length}">${
    boardHead(cols)}${boardBands(cols, true)}</div>`;
};

/* ═══ SCREEN: slots — the same grid, other days ════════ */
function headerSlots(){ return bar('Week from ' + dayLabel(0), 'Slot availability'); }

function screenSlots(){
  const week = S.boardMode !== 'all';
  const cols = week ? weekCols(S.pitch) : pitchCols(dateFor(S.dayIndex));
  const hs = hours();

  /* All three pitches on one day, or one pitch across the week \u2014 the console's
     two ways of reading availability, picked in one tap rather than a mode
     switch followed by a pitch chooser. */
  const modes = [['all', 'All']].concat(PITCHES.map((p, pi) => [String(pi), p.short]));
  const modeRow = `<div class="m-filters">${modes.map(([v, lbl]) => `<button
    class="m-filter${(v === 'all' ? !week : week && S.pitch === +v) ? ' is-on' : ''}"
    data-act="board-mode" data-v="${v}">${esc(lbl)}</button>`).join('')}</div>`;

  const days = week ? '' : `<div class="m-days">${Array.from({ length:7 }, (_, i) => {
    const d = dateAt(i);
    return `<button class="m-day${i === S.dayIndex ? ' is-on' : ''}" data-act="day" data-v="${i}">
      <small>${DOW[(d.getDay() + 6) % 7]}</small><b>${d.getDate()}</b></button>`;
  }).join('')}</div>`;

  const walkin = `<button class="m-walkin" data-act="go-sell">
    <span><b>New walk-in booking</b><small>Custom time slot \u00b7 any start, any length</small></span>
    <em>OPEN</em>
  </button>`;

  let open = 0;
  hs.forEach((h, hi) => cols.forEach(c => { if (cellState(c.date, hi, c.pitch) === 'free') open++; }));

  const legend = `<div class="m-legend">
    <span><i class="is-open"></i>Open</span>
    <span><i class="is-app"></i>App</span>
    <span><i class="is-counter"></i>OTC \u00b7 counter</span>
    <span><i class="is-hold"></i>On hold</span>
    <span><i class="is-blocked"></i>Maintenance</span>
    <em>${open} of ${hs.length * cols.length} slots open ${esc(week
      ? 'on ' + PITCHES[S.pitch].name + ' this week' : 'on ' + dayLabel(S.dayIndex))}</em>
  </div>`;

  /* The view picker, the dates and the column names ride together at the top of
     the scroll: which day you are looking at is the question the grid under it
     answers, so it must not scroll away from its own answer. */
  return `<div class="m-board${week ? ' is-week' : ''}" style="--ncols:${cols.length}">
    ${walkin}
    <div class="m-pinned">${modeRow}${days}${boardHead(cols)}</div>
    ${boardBands(cols, false)}
    ${legend}
  </div>`;
}

/* ═══ SCREEN: sell — custom time slot ══════════════════ */
/* Reached from the board, so back goes there. */
function headerSell(){ return bar('Walk-in at the gate', 'Custom time slot', 'slots'); }

function screenSell(){
  const p = PITCHES[S.sellPitch];
  const a = toMin(S.sellStart), b = a + S.sellDur;
  /* The server refuses a window that ends after closing, so the form says so
     rather than letting the tap fail. */
  const fits = b <= END_HOUR * 60;
  const ready = fits && S.sellName.trim().length > 1
    && digits(S.sellPhone) >= 8 && digits(S.sellPhone) <= 15 && !S.busy;

  return `<div class="m-pad">
    <div class="m-panel">
      <span class="m-label">Pitch</span>
      <div class="m-opts">${PITCHES.map((x, i) =>
        opt(x.short, i === S.sellPitch, 'sell-pitch', i)).join('')}</div>

      <label class="m-label is-spaced" for="sStart">Start time</label>
      <input class="m-field" id="sStart" type="time" step="1800"
        value="${esc(S.sellStart)}" data-model="sellStart">

      <span class="m-label is-spaced">Duration</span>
      <div class="m-opts">${[30, 60, 90, 120].map(d =>
        opt(d >= 60 ? (d / 60) + 'h' : d + 'm', d === S.sellDur, 'sell-dur', d)).join('')}</div>

      <div class="m-quote">${esc(rng12(a, b) + ' · ' + p.name + ' · '
        + money(priceFor(S.sellPitch, a, b)))}
        ${needsFloodlights(b) ? `<small>includes ${esc(money(FLOODLIGHT_FEE))} floodlights</small>` : ''}</div>
      <div class="m-hr"></div>

      ${field('sName', 'Name / team · required', S.sellName, 'sellName', 'e.g. Northside FC')}
      ${field('sPhone', 'Contact number · required', S.sellPhone, 'sellPhone', '+91', 'tel')}

      <span class="m-label is-spaced">Payment status</span>
      <div class="m-opts">${PAY_FORM.map(o => opt(o, o === S.sellPay, 'sell-pay')).join('')}</div>

      <button class="m-btn is-wide is-tall ${ready ? 'is-lime' : ''}" data-act="sell-confirm"
        ${ready ? '' : 'disabled'} style="margin-top:18px">
        ${ready ? 'Confirm custom booking'
          : !fits ? 'Runs past closing at ' + t12(END_HOUR * 60)
          : 'Name and contact required'}
      </button>
    </div>
    ${S.sellDone ? `<div class="m-banner">${esc(S.sellDone)}</div>` : ''}
  </div>`;
}

/* ═══ SCREEN: reminders ════════════════════════════════ */
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
    ${btn(r.action, r.act, 'is-wide ' + (cashRow || r.warn ? 'is-ink' : 'is-lime'),
      ` data-id="${esc(r.id)}"`)}
  </div>`;

  const group = (title, count, rows, emptyNote) => `<div class="m-group">
    <div class="m-group-head"><h2>${esc(title)}</h2><span>${esc(count)}</span></div>
    ${rows.length ? rows.join('') : `<div class="m-empty">${esc(emptyNote)}</div>`}
  </div>`;

  return `<div class="m-groups">
    <p class="m-lede">Everything the shift still needs a decision on. Clearing one here clears
      it at the counter too — both screens read the same server.</p>
    ${group('Game reminders', game.length + ' pending', game.map(r => remHtml(r, false)),
      'Nothing needs a whistle in the next two hours.')}
    ${group('Cash collection', money(dueTotal()) + ' across ' + cash.length,
      cash.map(r => remHtml(r, true)), 'Nothing left to collect today.')}
    ${can('manager') ? group('Maintenance', S.blocks.filter(x => x.date === todayIso()).length + ' today',
      S.blocks.filter(x => x.date === todayIso()).map(x => `<div class="m-rem">
        <div class="m-rem-top"><b>${esc(rng12(x.start, x.end))}</b>
          <span>${esc(PITCHES[x.pitch].name)}</span>${tag('Blocked', '')}</div>
        <h3>${esc(x.reason)}</h3>
        <p>This hour is off the board. Reopen it from the slot itself.</p>
      </div>`), 'No hours blocked today.') : ''}
  </div>`;
}

/* ═══ SCREEN: today — the shift as a list ══════════════ */
/* The board answers "what is free at seven". This answers "what have I got on
   today, and what does each one still need" — the console's Sessions view,
   which a grid cannot give you because a grid is organised by time and this
   question is organised by state. */
function headerToday(){ return bar('Every booking today · ' + dayLabel(0), 'Today'); }

const TODAY_FILTERS = [['all','All'],['live','Live'],['next','Upcoming'],['unpaid','Unpaid'],['done','Done']];

function screenToday(){
  const now = nowMin();
  const list = sess().filter(b => {
    if (S.todayFilter === 'live') return b.status === 'running';
    if (S.todayFilter === 'next') return b.status === 'upcoming';
    if (S.todayFilter === 'unpaid') return outstanding(b) > 0;
    if (S.todayFilter === 'done') return b.status === 'done' || GONE.has(b.status);
    return true;
  }).sort((a, b) => a.start - b.start);

  const chip = (k, lbl) => `<button class="m-filter${S.todayFilter === k ? ' is-on' : ''}"
    data-act="today-filter" data-v="${k}">${lbl}</button>`;

  const stateOf = b => b.status === 'running' ? ['In play', 'is-play']
    : b.status === 'done' ? ['Finished', '']
    : b.status === 'noshow' ? ['No-show', 'is-dim']
    : b.status === 'cancelled' ? ['Cancelled', 'is-dim']
    : S.paused[b.id] ? ['Paused', 'is-dim']
    : S.checkedIn[b.id] ? ['Checked in', 'is-good']
    : b.start - now <= START_WINDOW ? ['At the gate', 'is-good']
    : ['Not started', ''];

  return `<div class="m-pad">
    <button class="m-walkin" data-act="go-sell">
      <span><b>New walk-in booking</b><small>Custom time slot · any start, any length</small></span>
      <em>OPEN</em>
    </button>
    <div class="m-filters">${TODAY_FILTERS.map(([k, l]) => chip(k, l)).join('')}</div>
    ${list.length ? list.map(b => {
      const [word, mod] = stateOf(b), out = outstanding(b), p = PITCHES[b.pitch];
      return `<button class="m-trow${b.status === 'running' ? ' is-live'
        : out > 0 && b.status !== 'upcoming' ? ' is-due' : ''}"
        data-act="sheet-sess" data-id="${esc(b.id)}">
        <span class="m-trow-when"><b>${esc(t12(b.start))}</b><small>${esc(mins(b.end - b.start))}</small></span>
        <span class="m-trow-mid">
          <b>${esc(b.team)}</b>
          <small>${esc(p.name + ' · ' + rng12(b.start, b.end))}</small>
        </span>
        <span class="m-trow-end">
          ${tag(word, mod)}
          <small>${esc(out > 0 ? money(out) + ' due' : 'Paid')}</small>
        </span>
      </button>`;
    }).join('') : '<div class="m-empty">Nothing in this filter.</div>'}
  </div>`;
}

/* ═══ SCREEN: settings ═════════════════════════ */
/* Two kinds of setting, kept apart because undoing them is not the same job:
   what this handset does (the theme, which nobody else sees) and what the venue
   does (the deposit, which every console shares and the server audits). */
function headerSettings(){ return bar('This phone and this venue', 'Settings'); }

function screenSettings(){
  const u = S.user || {};
  const a = buildAlerts(), pending = a.game.length + a.cash.length;
  const deposit = Number(S.settings.depositAmount || 0);
  const draft = S.depositDraft === '' ? String(deposit) : S.depositDraft;
  const amount = parseInt(draft, 10);
  const depositReady = /^\d+$/.test(draft.trim()) && amount >= 0 && amount <= 50000
    && amount !== deposit && !S.busy;

  const card = (title, note, inner) => `<div class="m-card">
    <div class="m-card-head"><h2>${esc(title)}</h2><span>${esc(note)}</span></div>${inner}</div>`;

  const row = (title, note, val, v, mod) => `<button class="m-setrow" data-act="go" data-v="${v}">
    <span class="m-setrow-txt"><b>${esc(title)}</b><small>${esc(note)}</small></span>
    <span class="m-setrow-val${mod ? ' ' + mod : ''}">${esc(val)}</span><i>›</i>
  </button>`;

  return `<div class="m-set">
    ${card('Appearance', 'This phone', `<p>Dark turns the page off rather than repainting it:
      surfaces step by lightness alone and the lime is untouched, because it is the one thing on
      screen with a colour and it does the same job either way. Kept on this handset, so the
      counter phone and your own can differ.</p>
      <div class="m-filters">${THEMES.map(([v, lbl]) => `<button
        class="m-filter${S.theme === v ? ' is-on' : ''}" data-act="theme"
        data-v="${v}">${esc(lbl)}</button>`).join('')}</div>
      ${S.theme === 'system'
        ? `<p>Following the phone — ${esc(resolvedTheme())} right now.</p>` : ''}`)}

    ${card('The shift', 'Live', row('Alerts', 'Whistles due and cash still to take',
      pending ? pending + ' waiting' : 'Clear', 'reminders', pending ? 'is-warn' : '')
      + row('Money', 'The drawer today, and the whole ledger',
        dueTotal() ? money(dueTotal()) + ' owed' : 'Settled', 'money',
        dueTotal() ? 'is-warn' : ''))}

    ${card('Booking policy', 'Every console', `<p>Shown when a slot is booked and prefilled when
      staff record an advance. What is actually collected can still differ per booking.</p>
      ${can('manager') ? `<label class="m-label is-spaced" for="sDep">Default deposit ·
        ₹0 to ₹50,000</label>
      <div class="m-money-edit">
        <input class="m-field" id="sDep" inputmode="numeric" value="${esc(draft)}"
          data-model="depositDraft">
        <button class="m-btn ${depositReady ? 'is-lime' : ''}" data-act="save-deposit"
          ${depositReady ? '' : 'disabled'}>Save</button>
      </div>
      <p>Currently ${esc(money(deposit))}. Every change is audited against your name.</p>`
      : `<div class="m-kvs">${kv('Default deposit', money(deposit))}</div>
      <p>Managers and owners set this one. Ask the counter if it needs changing.</p>`}`)}

    ${card('Venue', PITCHES.length + ' pitches', `<div class="m-kvs">
      ${PITCHES.map(p => kv(p.name, money(p.rate) + '/hr')).join('')}
      ${kv('Trading hours', rng12(START_HOUR * 60, END_HOUR * 60))}
      ${kv('Floodlights', money(FLOODLIGHT_FEE) + ' after ' + t12(FLOODLIGHT_FROM))}
    </div>`)}

    ${card('Signed in', u.role || '', `<div class="m-kvs">
      ${kv('Name', u.name || '—')}${kv('Email', u.email || '—')}
      ${kv('Role', u.role || '—')}</div>
      <p>Operators manage bookings and payments. Managers can also release a booking, block an
      hour for maintenance and reverse a payment. Owners create staff accounts, which is desk
      work and stays on the console.</p>
      <div class="m-stack">${btn('Sign out', 'logout', 'is-ink is-wide')}</div>`)}

    <div class="m-ver">${esc(APP_NAME)} · reading the same server as the counter</div>
  </div>`;
}

/* ═══ the bottom nav ═══════════════════════════════════ */
/* Five destinations, always in the same order, always in the same place. The
   dock used to carry two and everything else hid in the header or inside the
   board, which made a five-screen app feel like a two-screen one. */
const NAV = [
  ['home',      'Board',  ICON.grid],
  ['today',     'Today',  ICON.list],
  ['slots',     'Days',   ICON.cal],
  ['money',     'Money',  ICON.wallet],
  ['settings',  'Settings', ICON.gear],
];

function dockHtml(){
  const total = collectTotal(), any = total > 0;
  const owing = collectable().length;

  const items = NAV.map(([screen, label, icon]) => {
    const badge = screen === 'money' ? owing : 0;
    return `<button class="m-nav-item${S.screen === screen ? ' is-on' : ''}"
      data-act="go" data-v="${screen}" aria-current="${S.screen === screen}">
      <i>${icon}</i><span>${label}</span>
      ${badge ? `<em class="m-nav-badge">${badge}</em>` : ''}
    </button>`;
  }).join('');

  /* Money you could take right now gets its own bar above the nav rather than
     a tab you have to remember to visit. It is the one thing on this app that
     leaks if nobody looks. */
  return `${any ? `<button class="m-collect-bar" data-act="collect-first">
      <i>${ICON.wallet}</i><span>Collect ${money(total)}</span>
      <em>${owing} ${owing === 1 ? 'session' : 'sessions'}</em>
    </button>` : ''}
    <nav class="m-nav">${items}</nav>`;
}

/* ═══ SCREEN: money — the till and the accounts ════════ */
/* The console splits this in two: a shift till and an Accounts view over the
   whole ledger. On a phone they are the same question asked twice, so they are
   one screen — today's drawer at the top, the worklist under it, and every row
   able to show the payment events behind its balance. */
function headerMoney(){ return bar('Takings and accounts · ' + dayLabel(0), 'Money'); }

/* The console's own five (views/accounts.js). "Closed" is a booking that never
   happened; it stays visible because a cancelled record with money on it is
   exactly the one somebody has to go and look at. */
const MONEY_FILTERS = [['open','Open'],['paid','Settled'],['refunds','Refunded'],
  ['cancelled','Closed'],['all','All']];

const eventsFor = id => S.payments.filter(e => e.bookingId === id);
const isLive = b => !GONE.has(b.status);
/* The worklist reads the wider accounts range so history is reachable; the till
   above it stays today, because that is the drawer being counted. */
const ledgerBookings = () => (S.accounts.length ? S.accounts : sess());

function moneyMatch(b){
  const f = S.moneyFilter, out = outstanding(b);
  if (f === 'all') return true;
  if (f === 'open') return isLive(b) && out > 0;
  if (f === 'paid') return isLive(b) && out === 0 && paidFor(b) > 0;
  if (f === 'refunds') return eventsFor(b.id).some(e => e.kind === 'refund');
  if (f === 'cancelled') return GONE.has(b.status);
  return true;
}

function screenMoney(){
  const t = takings();
  const list = ledgerBookings().filter(moneyMatch)
    .sort((a, b) => Number(isLive(b) && outstanding(b) > 0) - Number(isLive(a) && outstanding(a) > 0)
      || b.date.localeCompare(a.date) || b.start - a.start);

  const chip = (k, lbl) => `<button class="m-filter${S.moneyFilter === k ? ' is-on' : ''}"
    data-act="money-filter" data-v="${k}">${lbl}</button>`;

  return `<div class="m-pad">
    <div class="m-panel">
      <span class="m-label">Taken today</span>
      <div class="m-till">${money(t.total)}</div>
      <div class="m-kvs">${['Cash','UPI','Card'].map(m => kv(m, money(t.by[m] || 0))).join('')}</div>
      <div class="m-hr"></div>
      <span class="m-label">Still outstanding</span>
      <div class="m-till is-due">${money(dueTotal())}</div>
    </div>

    <div class="m-filters">${MONEY_FILTERS.map(([k, l]) => chip(k, l)).join('')}</div>

    ${list.length ? list.map(b => {
      const out = outstanding(b), p = PITCHES[b.pitch], paid = paidFor(b);
      const rows = eventsFor(b.id), shown = S.moneyOpen === b.id;
      const refunded = rows.some(e => e.kind === 'refund');
      const state = b.status === 'cancelled' ? 'Cancelled' : b.status === 'noshow' ? 'No-show'
        : out > 0 ? (b.status === 'done' ? 'Overdue' : 'Due') : refunded ? 'Refunded' : 'Settled';
      return `<div class="m-mrow${out > 0 && isLive(b) ? ' is-due' : ''}">
        <div class="m-mrow-top"><b>${esc(b.team)}</b>${tag(state, out > 0 && isLive(b) ? 'is-warn2' : 'is-good')}</div>
        <span class="m-mrow-sub">${esc(dayName(b.date) + ' · ' + p.name + ' · '
          + rng12(b.start, b.end) + ' · ' + money(totalOf(b)))}</span>
        <div class="m-mrow-foot">
          <button class="m-mrow-hist" data-act="money-open" data-id="${esc(b.id)}"
            aria-expanded="${shown}">${esc(paid ? money(paid) + ' paid' : 'nothing paid')}
            ${rows.length ? `<em>${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} ${shown ? '▴' : '▾'}</em>` : ''}</button>
          ${out > 0 && isLive(b)
            ? btn('Collect ' + money(out), 'collect', 'is-ink is-slim', ` data-id="${esc(b.id)}"`)
            : paid > 0 && can('manager')
            ? btn('Reverse', 'ask-reverse', 'is-outline is-slim', ` data-id="${esc(b.id)}"`) : ''}
        </div>
        ${shown ? `<div class="m-hist">${rows.length ? rows.map(e => `<div class="m-hist-row${
          e.kind === 'refund' ? ' is-back' : ''}">
          <b>${esc(e.kind === 'refund' ? '−' : '+')}${esc(money(e.amount))}</b>
          <span>${esc(e.mode + (e.reference ? ' · ' + e.reference : ''))}</span>
          <em>${esc(e.reason || (e.kind === 'refund' ? 'reversal' : 'payment'))}</em>
        </div>`).join('') : '<div class="m-hist-none">No payment events yet.</div>'}</div>` : ''}
      </div>`;
    }).join('') : '<div class="m-empty">Nothing in this filter.</div>'}
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
    ${S.apiError ? `<div class="m-alert" role="alert">${esc(S.apiError)}</div>` : ''}
    ${body}
  </div>
</div>`;

const formFields = () => field('fTeam', 'Name / team · required', S.form.team, 'form.team', 'e.g. Northside FC')
  + field('fContact', 'Contact number · required', S.form.contact, 'form.contact', '+91', 'tel');

/* The server wants 8 to 15 digits and a name; refusing here saves a round trip
   and, more to the point, a red banner for something the form could have said. */
const digits = s => String(s).replace(/\D/g, '').length;
const formReady = () => S.form.team.trim().length > 1
  && digits(S.form.contact) >= 8 && digits(S.form.contact) <= 15;

/* The counter takes a transaction id because it is at a desk with a card
   machine and a receipt printer. On the pitch the operator is standing in front
   of the person paying and watches the money land — asking them to copy four
   digits off a phone screen adds a step and no certainty.

   The server still records how a payment was verified (it wants a reference on
   anything that is not cash), so the ledger says exactly that rather than a
   number nobody typed. It is a truthful account of the check that happened,
   which a fabricated transaction id would not be. */
const inPersonRef = () => 'In person · ' + ((S.user && (S.user.name || S.user.email)) || 'staff');

function collectReady(b){
  const out = outstanding(b);
  if (out <= 0 || S.busy) return false;
  if (S.tender !== 'Split') return true;
  const cash = Math.round(+S.splitCash || 0);
  return cash > 0 && cash < out;
}

/* A split tender is not a new kind of payment: the ledger is append-only, so
   it posts two rows. That is what keeps the per-mode totals right for the till
   and caps a later reversal to the tender the money came in on. */
async function collectNow(id){
  const b = sessById(id);
  if (!b || !collectReady(b)) return;
  const out = outstanding(b), ref = inPersonRef();
  const key = () => (crypto.randomUUID ? crypto.randomUUID() : 'k' + Date.now() + Math.random());
  if (S.tender === 'Split'){
    const cash = Math.round(+S.splitCash || 0);
    const first = await mutate('/api/bookings/' + id + '/payments',
      { amount:cash, mode:'Cash', idempotencyKey:key() });
    if (!first) return;
    await mutate('/api/bookings/' + id + '/payments',
      { amount:out - cash, mode:'UPI', reference:ref, idempotencyKey:key() });
  } else {
    const done = await mutate('/api/bookings/' + id + '/payments',
      { amount:out, mode:S.tender, reference:S.tender === 'Cash' ? '' : ref, idempotencyKey:key() });
    if (!done) return;
  }
  if (!S.apiError){ S.sheet = null; S.splitCash = ''; }
}

function sheetHtml(){
  const sh = S.sheet;
  if (!sh) return '';
  const hs = hours();

  /* — collect — */
  if (sh.kind === 'collect'){
    const b = sessById(sh.id);
    if (!b) return '';
    const out = outstanding(b), split = S.tender === 'Split';
    const cash = Math.round(+S.splitCash || 0), rest = Math.max(0, out - cash);
    const rows = S.payments.filter(p => p.bookingId === b.id);
    const ready = collectReady(b);
    const why = split && !(cash > 0 && cash < out) ? 'Cash share must be under ' + money(out)
      : S.busy ? 'Working…' : 'Nothing to collect';

    return sheetShell('Collect', 'is-play', money(out),
      b.team + ' · ' + PITCHES[b.pitch].name + ' · ' + rng12(b.start, b.end),
      `<span class="m-label is-spaced">Tender</span>
      <div class="m-opts">${TENDERS.map(t =>
        opt(t === 'Split' ? 'Cash+UPI' : t, t === S.tender, 'tender', t)).join('')}</div>`
      + (split || S.tender === 'UPI' ? upiHtml(split ? rest : out) : '')
      + (split
        ? field('fCash', 'Cash taken · required', S.splitCash, 'splitCash', '0', 'tel')
          + `<div class="m-quote">${esc(money(cash) + ' cash + ' + money(rest) + ' UPI')}</div>`
        : '')
      + `<div class="m-kvs">${kv('Booking total', money(totalOf(b)))}
         ${needsFloodlights(b.end) ? kv('Includes floodlights', money(FLOODLIGHT_FEE)) : ''}
         ${kv('Already paid', money(paidFor(b)))}${kv('Contact', b.contact)}</div>`
      /* The ledger is append-only, so what has already been taken is shown
         rather than folded into one "paid" number. */
      + (rows.length ? `<span class="m-label is-spaced">On the ledger</span>
          <div class="m-kvs">${rows.map(p => kv(
            (p.kind === 'refund' ? 'Refund · ' : '') + p.mode + (p.reference ? ' · ' + p.reference : ''),
            money(p.amount))).join('')}</div>` : '')
      + `<div class="m-stack">
          <button class="m-btn is-wide is-tall ${ready ? 'is-lime' : ''}" data-act="collect-now"
            data-id="${esc(b.id)}" ${ready ? '' : 'disabled'}>${
            ready ? 'Mark ' + money(out) + ' received' : esc(why)}</button>
        </div>`);
  }

  /* — start the match clock — */
  /* A team that walks on eighteen minutes late has not lost eighteen minutes,
     and one already on the pitch when you get to your phone did not start when
     you tapped. So the clock asks which minute it runs from instead of
     assuming now. Bounds are the server's: no earlier than fifteen minutes
     before the booked start, no later than this minute. */
  if (sh.kind === 'timer'){
    const b = sessById(sh.id);
    if (!b) return '';
    const p = PITCHES[b.pitch], now = Math.floor(nowMin());
    const at = clampTimerAt(b, S.timerAt == null ? now : S.timerAt);
    const dur = b.end - b.start, ends = at + dur;
    const floor = timerFloor(b), ceil = timerCeil(b);
    const late = at - b.start;
    /* Before the booked start there is no "from session start" to offer — that
       minute has not happened. The option stays, stating the minute it would
       use, but dead, so the choice reads the same either side of kick-off. */
    const busy = pitchBusy(b);
    const bookedReach = clampTimerAt(b, b.start) === b.start;
    const onBooked = bookedReach && at === b.start;
    const onNow = !onBooked && at === clampTimerAt(b, now);
    const choice = (mode, lbl, minute, on, live) => `<button
      class="m-opt is-two${on ? ' is-on' : ''}" data-act="timer-mode" data-v="${mode}"
      ${live ? '' : 'disabled'}><b>${esc(lbl)}</b><i>${esc(t12(minute))}</i></button>`;
    const nudge = (d, lbl, ok) => `<button class="m-step" data-act="timer-nudge" data-v="${d}"
      ${ok ? '' : 'disabled'} aria-label="${d > 0 ? 'One minute later' : 'One minute earlier'}">${lbl}</button>`;
    /* Nobody started the clock and the match is already running: the operator
       knows how long is left, not what minute it began. Working back from the
       remaining time is the question they can actually answer. An option that
       would have to be clamped is shown dead rather than quietly landing on a
       different minute than it promises. */
    const forLeft = m => clampTimerAt(b, Math.round(now) + m - dur);
    const leftOpt = m => {
      const want = Math.round(now) + m - dur, live = forLeft(m) === want && m <= dur;
      return `<button class="m-opt${at === want && live ? ' is-on' : ''}" data-act="timer-left"
        data-v="${m}"${live ? '' : ' disabled'}>${esc(mins(m) + ' left')}</button>`;
    };

    return sheetShell('Start match timer', 'is-play', t12(at),
      b.team + ' · ' + p.name + ' · ' + rng12(b.start, b.end),
      `<div class="m-kvs">${kv('Runs for', mins(dur))}${kv('Ends at', t12(ends))}</div>
      <span class="m-label is-spaced">Run the clock from</span>
      <div class="m-opts">${choice('now', 'Now', clampTimerAt(b, now), onNow, true)}${
        choice('booked', 'Session start', b.start, onBooked, bookedReach)}</div>
      <span class="m-label is-spaced">Or say how long is left</span>
      <div class="m-opts">${[15, 20, 30, 45].map(leftOpt).join('')}</div>
      <span class="m-label is-spaced">Adjust by the minute</span>
      <div class="m-stepper">${nudge(-1, '−', at > floor)}
        <div class="m-stepper-now">${esc(t12(at))}</div>${nudge(1, '+', at < ceil)}</div>
      <p class="m-sheet-sub" style="margin-top:12px">${esc(late > 0
        ? 'Team went on ' + mins(late) + ' after the booked start, so the clock ends ' + mins(ends - b.end) + ' late at ' + t12(ends) + '.'
        : late < 0
        ? 'Starting ' + mins(-late) + ' early. The clock runs its full ' + mins(dur) + ' and ends at ' + t12(ends) + '.'
        : 'The clock runs the booked slot exactly, ending at ' + t12(ends) + '.')}</p>
      <div class="m-stack">
        <button class="m-btn is-wide is-tall ${busy ? '' : 'is-lime'}" data-act="timer-start"
          data-id="${esc(b.id)}"${busy ? ' disabled' : ''}>${busy
            ? esc(PITCHES[b.pitch].name + ' still has ' + busy.team + ' on')
            : esc('Start timer · ' + t12(at))}</button>
        ${btn('Cancel', 'close-sheet', 'is-dark is-wide')}
      </div>`);
  }

  /* — a booking on the live board — */
  if (sh.kind === 'sess'){
    const b = sessById(sh.id);
    if (!b) return '';
    const p = PITCHES[b.pitch], mode = liveMode(b), out = outstanding(b);
    const head = mode === 'running' ? ['In play', 'is-play']
      : mode === 'owed' ? ['Payment due', 'is-warn2']
      : mode === 'settled' ? ['Settled', 'is-dim']
      : b.status === 'cancelled' ? ['Cancelled', 'is-dim']
      : b.status === 'noshow' ? ['No-show', 'is-dim']
      : [mode === 'ready' ? 'Checked in' : 'Not started', ''];
    return sheetShell(head[0], head[1], b.team,
      p.name + ' · ' + p.sub + ' · ' + rng12(b.start, b.end),
      `<div class="m-kvs">${kv('Booked via', b.source === 'app' ? 'App · online' : 'OTC · over the counter')}
        ${kv('Booking total', money(totalOf(b)))}${kv('Already paid', money(paidFor(b)))}
        ${kv('Outstanding', money(out))}${kv('Contact', b.contact)}</div>
      <div class="m-stack">
        ${out > 0 ? btn('Collect ' + money(out), 'collect', 'is-lime is-wide is-tall', ` data-id="${esc(b.id)}"`) : ''}
        ${link('Call the team', tel(b.contact), (out > 0 ? 'is-dark' : 'is-lime is-tall') + ' is-wide')}
        ${link('WhatsApp', wa(b.contact), 'is-dark is-wide')}
        ${b.status === 'running' ? btn('Add 30 minutes', 'extend', 'is-dark is-wide', ` data-id="${esc(b.id)}"`) : ''}
        ${mode === 'ready' ? btn('Undo check-in', 'undo-check-in', 'is-ghost is-wide', ` data-id="${esc(b.id)}"`) : ''}
        ${b.status === 'upcoming' && nowMin() > b.start
          ? btn('Nobody turned up · no-show', 'no-show', 'is-ghost is-wide', ` data-id="${esc(b.id)}"`) : ''}
        ${b.status === 'upcoming'
          ? btn('Cancel this booking', 'ask-cancel', 'is-ghost is-wide', ` data-id="${esc(b.id)}"`) : ''}
      </div>`);
  }

  /* — confirm a walk-in on one hour — */
  if (sh.kind === 'confirm'){
    const p = PITCHES[sh.pi], h = hs[sh.hi];
    const ready = formReady() && !S.busy;
    return sheetShell('Confirm walk-in', null, hourRng12(h),
      dayLabel(0) + ' · ' + p.name + ' · ' + p.sub,
      `<div class="m-kvs">${kv('Amount', money(priceFor(sh.pi, h * 60, (h + 1) * 60)))}
        ${needsFloodlights((h + 1) * 60) ? kv('Includes floodlights', money(FLOODLIGHT_FEE)) : ''}
        ${kv('Deposit', money(S.settings.depositAmount))}</div>
      ${formFields()}
      <div class="m-stack">
        <button class="m-btn is-wide is-tall ${ready ? 'is-lime' : ''}" data-act="book-slot"
          data-pay="paid" ${ready ? '' : 'disabled'}>
          ${ready ? 'Book and collect ' + money(priceFor(sh.pi, h * 60, (h + 1) * 60))
            : 'Name and contact required'}</button>
        <button class="m-btn is-dark is-wide" data-act="book-slot" data-pay="venue"
          ${ready ? '' : 'disabled'}>Book, pay at venue</button>
      </div>`);
  }

  /* — ending a session, and the way back out of one —
     The cross used to end a match on one tap, which is the wrong weight for
     something that stops a clock and sends a bill to collection. It asks now,
     and the asking is also where "this was the wrong pitch" lives: undoing a
     start is the same conversation as ending one, and an operator who has just
     realised their mistake should not have to go looking for it somewhere
     else. */
  if (sh.kind === 'endask'){
    const b = sessById(sh.id);
    if (!b) return '';
    const p = PITCHES[b.pitch], w = liveWindow(b), held = !!S.paused[b.id];
    const mark = held ? w.at : nowMin();
    const played = Math.max(0, mark - w.from), out = outstanding(b);
    const over = mark > w.until;
    /* A paused match already reads as "not started" on the server, so undoing
       it costs nothing and needs nobody's permission. Undoing a running one
       runs the record backwards, which the server treats as manager work. */
    const canUndo = held || can('manager');
    return sheetShell(held ? 'Paused session' : 'End session', 'is-warn2',
      mins(played) + ' played',
      b.team + ' · ' + p.name + ' · ' + rng12(b.start, b.end),
      `<div class="m-kvs">${kv('Clock started', t12(w.from))}
        ${kv(over ? 'Ran past' : 'Runs until', t12(w.until))}
        ${kv('Outstanding', money(out))}</div>
      <p class="m-sheet-sub" style="margin-top:14px">Ending stops the clock and sends the
        session to collection${out > 0 ? esc(', with ' + money(out) + ' still to take from ' + b.team) : ''}.</p>
      <div class="m-stack">
        ${btn('End the match', 'end-game', 'is-lime is-wide is-tall', ` data-id="${esc(b.id)}"`)}
        ${canUndo ? btn('Wrong game — undo the start', 'undo-start', 'is-ghost is-wide',
          ` data-id="${esc(b.id)}"`) : ''}
        ${btn(held ? 'Leave it paused' : 'Keep playing', 'close-sheet', 'is-dark is-wide')}
      </div>`);
  }

  /* — who is signed in — */
  if (sh.kind === 'profile'){
    const u = S.user || {};
    return sheetShell(APP_NAME, null, u.name || u.email || 'Signed in',
      u.email + ' · ' + u.role,
      `<div class="m-kvs">${kv('Role', u.role)}${kv('Signed in as', u.email)}
        ${kv('Venue', PITCHES.length + ' pitches')}
        ${kv('Trading hours', rng12(START_HOUR * 60, END_HOUR * 60))}</div>
      <p class="m-sheet-sub" style="margin-top:14px">What you can reach depends on this role:
        blocking an hour, releasing a booking and reversing a payment are manager
        work.</p>
      <div class="m-stack">${btn('Sign out', 'logout', 'is-dark is-wide')}</div>`);
  }

  /* — reopen a session ended by mistake — */
  if (sh.kind === 'reopen'){
    const b = sessById(sh.id);
    if (!b) return '';
    const ready = S.cancelReason.trim().length > 3 && !S.busy;
    return sheetShell('Reopen session', 'is-dim', b.team,
      PITCHES[b.pitch].name + ' · ' + rng12(b.start, b.end),
      `<p class="m-sheet-sub" style="margin-top:14px">The session goes back to not started and the
        clock can be run again. This runs the record backwards, so it is logged against
        ${esc(S.user.name || S.user.email)} with the reason you give. Money already taken stays
        on the ledger.</p>
      ${field('fReopen', 'Reason · required', S.cancelReason, 'cancelReason', 'e.g. ended the wrong pitch')}
      <div class="m-stack">
        <button class="m-btn is-wide is-tall ${ready ? 'is-lime' : ''}" data-act="reopen-session"
          data-id="${esc(b.id)}" ${ready ? '' : 'disabled'}>${ready ? 'Reopen it' : 'Reason required'}</button>
        ${btn('Leave it', 'close-sheet', 'is-dark is-wide')}
      </div>`);
  }

  /* — reverse a payment —
     Editing a payment is not refunding one. A refund sends money back; a card
     marked paid in error needs the entry undone, and nobody should have to call
     that a refund to reach it. Either way the ledger stays append-only — this
     writes a reversing entry — so the language is the only thing that differs,
     and the reason says which happened. */
  if (sh.kind === 'reverse'){
    const b = sessById(sh.id);
    if (!b) return '';
    const byMode = b.collectedByMode || {};
    const taken = ['Cash','UPI','Card'].filter(m => (byMode[m] || 0) > 0);
    const mode = taken.includes(S.revMode) ? S.revMode : (taken[0] || 'Cash');
    const inMode = Math.round(byMode[mode] || 0);
    const value = Math.max(0, parseInt(S.revVal, 10) || 0);
    const ready = can('manager') && value > 0 && value <= inMode
      && S.revReason.trim().length >= 5 && !S.busy;
    const why = !can('manager') ? 'Manager only'
      : value > inMode ? 'Only ' + money(inMode) + ' came in by ' + mode
      : S.revReason.trim().length < 5 ? 'Reason required'
      : value <= 0 ? 'Enter an amount' : 'Working…';

    return sheetShell('Edit payment', 'is-warn2', money(paidFor(b)) + ' taken',
      b.team + ' · ' + PITCHES[b.pitch].name + ' · ' + rng12(b.start, b.end),
      `<div class="m-kvs">${taken.map(m => kv(m, money(byMode[m]))).join('')
        || kv('Nothing collected', money(0))}</div>
      <span class="m-label is-spaced">Reverse from</span>
      <div class="m-opts">${(taken.length ? taken : ['Cash']).map(m =>
        opt(m, m === mode, 'rev-mode', m)).join('')}</div>
      ${field('fRevVal', 'Amount · up to ' + money(inMode), S.revVal, 'revVal', '0', 'tel')}
      <div class="m-opts" style="margin-top:8px">${opt('All ' + money(inMode),
        value === inMode && inMode > 0, 'rev-all', String(inMode))}</div>
      ${field('fRevWhy', 'What happened · required', S.revReason, 'revReason',
        'e.g. recorded against the wrong booking')}
      <p class="m-sheet-sub" style="margin-top:12px">This writes a reversing entry. The original
        payment stays on the ledger — nothing is deleted.</p>
      <div class="m-stack">
        <button class="m-btn is-wide is-tall ${ready ? 'is-lime' : ''}" data-act="reverse-payment"
          data-id="${esc(b.id)}" ${ready ? '' : 'disabled'}>${
          ready ? 'Reverse ' + money(value) + ' · ' + mode : esc(why)}</button>
        ${btn('Cancel', 'close-sheet', 'is-dark is-wide')}
      </div>`);
  }

  /* — cancel a booking, with a reason — */
  if (sh.kind === 'cancel'){
    const b = sessById(sh.id);
    if (!b) return '';
    const ready = S.cancelReason.trim().length > 3 && !S.busy;
    return sheetShell('Cancel booking', 'is-warn2', b.team,
      PITCHES[b.pitch].name + ' · ' + rng12(b.start, b.end),
      `<p class="m-sheet-sub" style="margin-top:14px">The slot goes back on sale and the owner gets an
        audit entry against ${esc(S.user.name || S.user.email)}. ${paidFor(b) > 0
          ? esc('Money already taken (' + money(paidFor(b)) + ') stays on the ledger — refund it separately.')
          : 'Nothing has been collected on it.'}</p>
      ${field('fCancel', 'Reason · required', S.cancelReason, 'cancelReason', 'e.g. Team called off')}
      <div class="m-stack">
        <button class="m-btn is-wide is-tall ${ready ? 'is-lime' : ''}" data-act="cancel-booking"
          ${ready ? '' : 'disabled'}>${ready ? 'Cancel the booking' : 'Reason required'}</button>
        ${btn('Keep it', 'close-sheet', 'is-dark is-wide')}
      </div>`);
  }

  /* — block an hour for maintenance — */
  if (sh.kind === 'block'){
    const p = PITCHES[sh.pi], h = hs[sh.hi];
    /* Fifteen characters, because that is what the server insists on. */
    const ready = S.blockReason.trim().length >= 15 && !S.busy;
    return sheetShell('Block for maintenance', 'is-dim', hourRng12(h),
      p.name + ' · ' + dayLabel(S.dayIndex),
      `<p class="m-sheet-sub" style="margin-top:14px">This hour stops being sellable and the owner
        gets an audit entry against ${esc(S.user.name || S.user.email)}. A written reason of at
        least 15 characters is required.</p>
      ${field('fReason', 'Reason · required', S.blockReason, 'blockReason', 'e.g. Floodlight repair on the east bank')}
      <div class="m-stack">
        <button class="m-btn is-wide is-tall ${ready ? 'is-lime' : ''}" data-act="block-slot"
          ${ready ? '' : 'disabled'}>${ready ? 'Block this hour'
            : S.blockReason.trim().length + ' of 15 characters'}</button>
        ${btn('Cancel', 'close-sheet', 'is-dark is-wide')}
      </div>`);
  }

  /* — a slot on the board — */
  if (sh.kind === 'slot'){
    const date = sh.date, p = PITCHES[sh.pi], h = hs[sh.hi];
    const c = cellAt(date, sh.pi, sh.hi), st = c.st;
    const win = cellRange(date, sh.pi, sh.hi), span = rng12(win[0], win[1]);
    const amount = money(priceFor(sh.pi, win[0], win[1]));
    const head = [label(st), st === 'free' ? 'is-play' : st === 'hold' ? 'is-hold' : 'is-dim'];
    const sub = dayLabel(S.dayIndex) + ' · ' + p.name + ' · ' + p.sub;

    if (st === 'free'){
      const ready = formReady() && !S.busy;
      return sheetShell(head[0], head[1], span, sub,
        `<div class="m-kvs">${kv('Rate', money(p.rate) + ' / hour')}${kv('Format', p.sub)}
          ${needsFloodlights(win[1]) ? kv('Floodlights', money(FLOODLIGHT_FEE)) : ''}
          ${kv('This slot', amount)}${kv('Deposit', money(S.settings.depositAmount))}</div>
        ${formFields()}
        <span class="m-label is-spaced">Payment status</span>
        <div class="m-opts">${PAY_FORM.map(o => opt(o, o === S.form.pay, 'form-pay')).join('')}</div>
        <div class="m-stack">
          <button class="m-btn is-wide is-tall ${ready ? 'is-lime' : ''}" data-act="book-slot"
            ${ready ? '' : 'disabled'}>${ready ? 'Book this slot' : 'Name and contact required'}</button>
          <button class="m-btn is-dark is-wide" data-act="hold-slot" ${ready ? '' : 'disabled'}>
            Hold for 20 minutes</button>
        </div>
        ${can('manager') ? `<button class="m-foot-note" data-act="ask-block">Block for
          maintenance · needs a written reason</button>` : ''}`);
    }
    if (st === 'hold'){
      return sheetShell(head[0], head[1], span, sub,
        `<div class="m-kvs">${kv('Held for', c.hold.team)}${kv('Contact', c.hold.contact)}
          ${kv('Expires', 'in ' + holdLeft(c.hold) + ' min')}${kv('Amount', amount)}</div>
        <div class="m-stack">
          ${btn('Confirm the booking', 'confirm-hold', 'is-lime is-wide is-tall', ` data-id="${esc(c.hold.id)}"`)}
          ${btn('Release hold', 'release-hold', 'is-dark is-wide', ` data-id="${esc(c.hold.id)}"`)}
        </div>`);
    }
    if (st === 'booked'){
      const b = c.booking;
      return sheetShell(head[0], head[1], span, sub,
        `<div class="m-kvs">${kv('Team', b.team)}
          ${kv('Booked via', b.source === 'app' ? 'App · online' : 'OTC · over the counter')}
          ${kv('Contact', b.contact)}${kv('Format', p.sub)}
          ${kv('Payment', b.pay)}${kv('Amount', money(totalOf(b)))}
          ${kv('Outstanding', money(outstanding(b)))}</div>
        <div class="m-stack">
          ${link('Call the team', tel(b.contact), 'is-lime is-wide is-tall')}
          ${link('WhatsApp the booking', wa(b.contact), 'is-dark is-wide')}
          ${b.date === todayIso() ? btn('Open the session', 'sheet-sess', 'is-dark is-wide', ` data-id="${esc(b.id)}"`) : ''}
          ${can('manager') ? btn('Release this booking', 'ask-release', 'is-ghost is-wide', ` data-id="${esc(b.id)}"`) : ''}
        </div>`);
    }
    return sheetShell(head[0], head[1], span, sub,
      `<div class="m-kvs">${kv('Reason', c.block.reason)}${kv('Audit trail', 'Sent to owner')}</div>
      ${can('manager') ? `<div class="m-stack">${btn('Cancel maintenance block', 'release-block',
        'is-dark is-wide', ` data-id="${esc(c.block.id)}"`)}</div>`
        : '<p class="m-sheet-sub" style="margin-top:16px">A manager can reopen this hour.</p>'}`);
  }

  /* — release a booking, manager only, with a reason — */
  if (sh.kind === 'release'){
    const b = sessById(sh.id);
    if (!b) return '';
    const ready = S.releaseReason.trim().length > 3 && !S.busy;
    return sheetShell('Release booking', 'is-dim', b.team,
      PITCHES[b.pitch].name + ' · ' + rng12(b.start, b.end),
      `<p class="m-sheet-sub" style="margin-top:14px">The hour goes back on sale. This is a
        reversal, so it is recorded against ${esc(S.user.name || S.user.email)} with the reason
        you give.</p>
      ${field('fRelease', 'Reason · required', S.releaseReason, 'releaseReason', 'e.g. Double booked')}
      <div class="m-stack">
        <button class="m-btn is-wide is-tall ${ready ? 'is-lime' : ''}" data-act="release-booking"
          data-id="${esc(b.id)}" ${ready ? '' : 'disabled'}>${ready ? 'Release the hour' : 'Reason required'}</button>
        ${btn('Keep it', 'close-sheet', 'is-dark is-wide')}
      </div>`);
  }
  return '';
}

/* ─── render ──────────────────────────────────────────── */
const HEADERS = { home:headerHome, today:headerToday, slots:headerSlots, sell:headerSell,
  reminders:headerReminders, money:headerMoney, settings:headerSettings };
const SCREENS = { home:homeHtml, today:screenToday, slots:screenSlots, sell:screenSell,
  reminders:screenReminders, money:screenMoney, settings:screenSettings };
/* Every screen. The walk-in form used to keep the screen to itself on the
   grounds that it is a task rather than a destination, but a nav that comes and
   goes is worse than one line of lost height. */
const NAV_SCREENS = new Set(['home', 'today', 'slots', 'sell', 'money', 'reminders',
  'settings']);
/* Screens carrying a running clock or a countdown need the whole redraw. */
const LIVE_SCREENS = new Set(['home', 'reminders']);

let sheetScroll = 0;
const painted = {};

/* Is a thumb in a text field right now? A repaint replaces the input it is in,
   and on a phone a field swapped mid-word loses characters — so the tick, the
   background poll and the keystroke repaint all defer to this. */
function typingNow(){
  const el = document.activeElement;
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return false;
  return !['button','submit','checkbox','radio'].includes(el.type);
}

/* A form cannot live on a screen that throws its DOM away, and delaying the
   rebuild only makes it rarer, not harmless — pause mid-sentence and the field
   is still swapped out from under the thumb.

   So while a field has focus the sheet is not rebuilt at all. The new markup is
   compared against the live tree and only what actually differs is written: a
   button's label, a disabled attribute, a running total. The focused field is
   skipped entirely, so it is never replaced and never loses a character. A
   change of structure — a new row, a different sheet — fails the comparison and
   falls back to a full rebuild, which is right, because at that point it really
   is a different form. */
function morph(live, next){
  if (live.nodeType === 3 || next.nodeType === 3){
    if (live.nodeType !== next.nodeType) return false;
    if (live.data !== next.data) live.data = next.data;
    return true;
  }
  if (live.nodeType !== 1 || next.nodeType !== 1) return live.isEqualNode(next);
  if (live.tagName !== next.tagName) return false;
  if (live.childNodes.length !== next.childNodes.length) return false;

  const wanted = new Set();
  for (const a of next.attributes){
    wanted.add(a.name);
    if (live.getAttribute(a.name) !== a.value) live.setAttribute(a.name, a.value);
  }
  for (const a of Array.from(live.attributes))
    if (!wanted.has(a.name)) live.removeAttribute(a.name);

  if (['INPUT','TEXTAREA','SELECT'].includes(live.tagName)){
    /* The field the thumb is in keeps exactly what it holds. Setting the
       attribute would not move a dirty field's value anyway — the property
       has to be assigned, and assigning it is what resets a caret. */
    if (live === document.activeElement) return true;
    const v = next.getAttribute('value');
    if (v != null && live.value !== v) live.value = v;
    return true;
  }
  for (let i = 0; i < live.childNodes.length; i++)
    if (!morph(live.childNodes[i], next.childNodes[i])) return false;
  return true;
}

/* One repaint per frame at most. State moves on the keystroke, so the button
   under the form reacts immediately rather than after a pause. */
let rafPending = 0;
function renderSoon(){
  if (rafPending) return;
  rafPending = requestAnimationFrame(() => { rafPending = 0; render(); });
}

/* Writing innerHTML that is byte-identical to what is already there still
   throws the DOM away and builds it again. On a screen that repaints every
   second that is invisible for the board — its clock really does change — but
   it made an open sheet replay its entry animation once a second and feel like
   it was reloading under the thumb. So each pane is written only when its
   markup has moved. */
function paint(id, html){
  if (painted[id] === html) return false;
  const host = document.getElementById(id);
  const active = document.activeElement;
  /* A rebuild that would swap the field under the thumb is applied as a patch
     instead. If the shapes do not line up the patch is abandoned and the
     rebuild goes ahead — a partially applied patch is then overwritten. */
  if (active && typingNow() && host.contains(active)){
    const next = document.createElement('div');
    next.innerHTML = html;
    if (next.childNodes.length === host.childNodes.length
      && Array.from(host.childNodes).every((n, i) => morph(n, next.childNodes[i]))){
      painted[id] = html;
      return false;
    }
  }
  painted[id] = html;
  host.innerHTML = html;
  return true;
}

/* ── signing in ──
   The console's own auth, on a phone. Nothing here stores a password: the form
   posts it once and the server sets an HttpOnly cookie, which is also why this
   file has to be served from the same origin as the API. */
function authHtml(){
  if (!S.ready) return `<div class="m-auth"><div class="m-auth-card">
    <div class="m-mark">TF</div><h1>Turf Operations</h1><p>Connecting…</p></div></div>`;
  if (S.user && S.user.mustChangePassword) return `<div class="m-auth"><div class="m-auth-card">
    <div class="m-mark">TF</div>
    <span class="m-kick">Account protection</span>
    <h1>Change your password</h1>
    <p>This account still has its temporary password. Finish setting it up on the
      desk console, then sign back in here.</p>
    <button class="m-btn is-dark is-wide" data-act="logout">Sign out</button>
  </div></div>`;
  return `<div class="m-auth"><form class="m-auth-card" data-login>
    <div class="m-mark">TF</div>
    <span class="m-kick">Operator sign-in</span>
    <h1>Turf Operations</h1>
    <p>Use the account the venue owner issued you.</p>
    ${S.authError ? `<div class="m-alert" role="alert">${esc(S.authError)}</div>` : ''}
    <label class="m-label" for="lEmail">Email</label>
    <input class="m-field" id="lEmail" name="email" type="email" autocomplete="username"
      inputmode="email" required>
    <label class="m-label is-spaced" for="lPass">Password</label>
    <input class="m-field" id="lPass" name="password" type="password"
      autocomplete="current-password" minlength="12" required>
    <button class="m-btn is-lime is-wide is-tall" type="submit"${S.busy ? ' disabled' : ''}
      style="margin-top:18px">${S.busy ? 'Signing in…' : 'Sign in'}</button>
  </form></div>`;
}

function render(){
  sweepPauses();
  /* An immediate render supersedes a pending one rather than racing it. */
  if (rafPending){ cancelAnimationFrame(rafPending); rafPending = 0; }
  const body = document.getElementById('mBody');
  const sheetPane = document.getElementById('mSheetBody');

  /* Signed out, there is one screen and no dock. */
  if (!S.user || S.user.mustChangePassword){
    paint('mHeader', '');
    paint('mBody', authHtml());
    paint('mDock', '');
    paint('mSheet', '');
    S._rendered = 'auth';
    return;
  }

  /* Home is rebuilt every second, so its offset has to be put back or the tick
     would yank it to the top mid-scroll. Kept per screen, so coming back from
     the board lands on the row you were looking at. */
  if (body && S._rendered && S._rendered !== 'auth') S.scrollMem[S._rendered] = body.scrollTop;
  if (sheetPane) sheetScroll = sheetPane.scrollTop;

  const el = document.activeElement;
  let caret = null;
  /* selectionStart throws on input[type=time], so probe it defensively. */
  try { caret = el ? [el.selectionStart, el.selectionEnd] : null; } catch (_) {}
  const keep = el && el.id ? { id:el.id, caret } : null;

  /* The sheet animates when it opens, not every time its contents move —
     otherwise typing a team name replays the rise on every keystroke. */
  const key = S.sheet ? S.sheet.kind + ':' + (S.sheet.id || S.sheet.pi + '/' + S.sheet.hi) : '';
  const opening = key && key !== S._sheetKey;
  S._sheetKey = key;

  paint('mHeader', HEADERS[S.screen]());
  /* Sixteen rows of board sit behind the scrim while a sheet is open. Building
     that string again on every keystroke is work nobody can see, and it was
     most of what made typing feel heavy. */
  const bodyMoved = S.sheet && typingNow() ? false
    : paint('mBody', (S.apiError && !S.sheet
      ? `<div class="m-alert is-page" role="alert">${esc(S.apiError)}</div>` : '')
      + SCREENS[S.screen]());
  paint('mDock', NAV_SCREENS.has(S.screen) ? dockHtml() : '');
  const sheetMoved = paint('mSheet', sheetHtml()
    .replace('class="m-sheet-card"', 'class="m-sheet-card' + (opening ? ' is-new' : '') + '"'));

  if (bodyMoved) body.scrollTop = S.scrollMem[S.screen] || 0;
  /* Opening the board at 6AM when it is a quarter to six in the evening makes
     the one row that matters the one row you have to go looking for. */
  if (S.screen === 'home' && !S.homeParked){
    const nowRow = body.querySelector('.m-hour.has-now');
    if (nowRow){
      body.scrollTop = Math.max(0, nowRow.offsetTop - body.clientHeight * 0.34);
      S.homeParked = true;
    }
  }
  /* The nav is pinned on a phone, so the body has to reserve exactly what it
     takes — which changes when the collect strip appears or goes. */
  const dock = document.getElementById('mDock');
  document.documentElement.style.setProperty('--dock-h', (dock.offsetHeight || 0) + 'px');

  const nextSheet = document.getElementById('mSheetBody');
  if (nextSheet){ if (sheetMoved) nextSheet.scrollTop = sheetScroll; } else sheetScroll = 0;
  S._rendered = S.screen;

  /* Nothing was replaced, so nothing lost focus, and putting the caret back
     would fight a selection the thumb is still making. */
  if (keep && (bodyMoved || sheetMoved)){
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
   and back lands on the same row you were looking at. */
function go(screen){
  S.screen = screen;
  S.sheet = null;
  S.apiError = '';
}

/* ─── events ──────────────────────────────────────────── */
/* Every write is a POST to the same audited endpoint the counter uses. The
   local-only exception is check-in, which the server has no column for. */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t || t.disabled) return;
  const act = t.dataset.act, v = t.dataset.v;
  const id = t.dataset.id || null;
  const pi = t.dataset.pi ? +t.dataset.pi : null;
  const hi = t.dataset.hi ? +t.dataset.hi : null;
  const b = id ? sessById(id) : null;
  const sh = S.sheet;
  const at = Math.round(nowMin());

  switch (act){
    /* navigation */
    case 'go': go(v); break;
    case 'go-sell': go('sell'); break;
    case 'day': S.dayIndex = +v; S.sheet = null; break;
    case 'board-mode':
      if (v === 'all') S.boardMode = 'all';
      else { S.boardMode = 'pitch'; S.pitch = +v; }
      S.sheet = null;
      break;
    case 'band':
      if (S.collapsedBands[v]) delete S.collapsedBands[v];
      else S.collapsedBands[v] = true;
      break;
    /* The theme is a property of the page, not of any screen, so it is written
       to the document rather than waiting for the repaint below. */
    case 'theme': S.theme = v; savePrefs(); applyTheme(); break;
    case 'save-deposit': {
      const rupees = parseInt(S.depositDraft, 10);
      if (!(rupees >= 0 && rupees <= 50000)) return;
      mutate('/api/settings', { depositAmount:rupees }).then(result => {
        if (result) S.depositDraft = '';
        render();
      });
      return;
    }
    case 'logout':
      mutate('/api/auth/logout').then(() => { S.user = null; S.csrf = ''; render(); });
      return;

    /* sheets */
    case 'close-sheet':
      S.sheet = null; S.blockReason = ''; S.cancelReason = ''; S.releaseReason = '';
      S.timerAt = null; S.revVal = ''; S.revReason = ''; S.apiError = '';
      break;
    case 'sheet-slot':
      S.sheet = { kind:'slot', pi, hi, date:t.dataset.date };
      S.form = blankForm();
      break;
    case 'sheet-sess': S.sheet = { kind:'sess', id }; break;
    case 'sheet-confirm': S.sheet = { kind:'confirm', pi, hi }; S.form = blankForm(); break;
    case 'ask-block': S.sheet = { kind:'block', pi:sh.pi, hi:sh.hi }; S.blockReason = ''; break;
    case 'ask-cancel': S.sheet = { kind:'cancel', id }; S.cancelReason = ''; break;
    case 'ask-release': S.sheet = { kind:'release', id }; S.releaseReason = ''; break;

    /* a match, from arrival to settled */
    case 'check-in': S.checkedIn[id] = true; break;
    case 'undo-check-in': delete S.checkedIn[id]; break;
    /* Which minute the clock runs from is the operator's call, not a default. */
    case 'start': S.sheet = { kind:'timer', id }; S.timerAt = null; break;
    case 'timer-mode':
      S.timerAt = clampTimerAt(sessById(sh.id), v === 'booked' ? sessById(sh.id).start : nowMin());
      break;
    case 'timer-left': {
      const s = sessById(sh.id);
      S.timerAt = clampTimerAt(s, Math.round(nowMin()) + (+v) - (s.end - s.start));
      break;
    }
    case 'timer-nudge': {
      const s = sessById(sh.id);
      S.timerAt = clampTimerAt(s, (S.timerAt == null ? Math.floor(nowMin()) : S.timerAt) + (+v));
      break;
    }
    case 'timer-start': {
      const s = sessById(id);
      const atMinute = clampTimerAt(s, S.timerAt == null ? nowMin() : S.timerAt);
      delete S.checkedIn[id];
      S.sheet = null; S.timerAt = null;
      mutate('/api/bookings/' + id + '/status',
        { status:'running', atMinute, version:s.version });
      return;
    }
    /* Pausing does not end anything: the clock stops where it is and the
       remaining minutes are kept. The server has no paused status, so the
       booking goes back to upcoming there — which is true, the clock is not
       running — and the minute it restarts from is corrected on resume.
       Stopping a running match is not a normal transition, so the server wants
       a manager for it; the button is hidden from operators rather than
       offered and refused. */
    case 'pause-timer': {
      const w = liveWindow(b);
      S.paused[id] = { from:w.from, at:Math.floor(nowMin()) };
      savePauses();
      mutate('/api/bookings/' + id + '/status',
        { status:'upcoming', reason:'Clock paused from the phone', version:b.version })
        .then(result => { if (!result){ delete S.paused[id]; savePauses(); render(); } });
      return;
    }
    /* Restart from the minute the clock stopped on, pushed forward by however
       long it stood still — so the session ends later by exactly the length of
       the interruption, and both screens agree again. */
    case 'resume-timer': {
      const held = S.paused[id];
      if (!held) return;
      const atMinute = Math.round(held.from + (nowMin() - held.at));
      delete S.paused[id]; savePauses();
      mutate('/api/bookings/' + id + '/status',
        { status:'running', atMinute, version:b.version });
      return;
    }
    case 'ask-end': S.sheet = { kind:'endask', id }; break;
    case 'end-game':
    case 'complete':
      S.sheet = null;
      /* No atMinute: stating a minute outside the booking's own window makes
         the change a correction, and a match that ran over is outside it by
         definition — which would have asked an operator for a manager to end
         the very sessions that most often need ending. The server's own clock
         is the right answer for "now". */
      mutate('/api/bookings/' + id + '/status', { status:'done', version:b.version });
      return;
    /* The clock never should have run. A paused match is already back at
       "upcoming" on the server, so this only forgets what the phone was
       holding; a running one has to be walked back, and the audit row says
       why in plain words rather than making somebody type it on a pitch. */
    case 'undo-start': {
      const held = !!S.paused[id];
      delete S.paused[id]; savePauses();
      delete S.checkedIn[id];
      S.sheet = null;
      if (held){ render(); return; }
      mutate('/api/bookings/' + id + '/status',
        { status:'upcoming', reason:'Started in error, undone from the phone', version:b.version });
      return;
    }
    case 'extend':
      mutate('/api/bookings/' + id + '/extend', { minutes:30, version:b.version });
      return;
    case 'no-show':
      S.sheet = null;
      mutate('/api/bookings/' + id + '/status', { status:'noshow', version:b.version });
      return;
    case 'cancel-booking': {
      if (S.cancelReason.trim().length <= 3) return;
      const reason = S.cancelReason.trim();
      S.sheet = null; S.cancelReason = '';
      mutate('/api/bookings/' + sh.id + '/status',
        { status:'cancelled', reason, version:sessById(sh.id).version });
      return;
    }
    case 'release-booking': {
      if (S.releaseReason.trim().length <= 3) return;
      const reason = S.releaseReason.trim();
      S.sheet = null; S.releaseReason = '';
      mutate('/api/bookings/' + id + '/release', { reason, version:b.version });
      return;
    }

    /* money */
    case 'collect': S.sheet = { kind:'collect', id }; S.splitCash = ''; break;
    case 'collect-first': {
      const first = collectable()[0];
      if (first){ S.sheet = { kind:'collect', id:first.id }; S.splitCash = ''; }
      break;
    }
    case 'tender': S.tender = v; break;
    case 'collect-now': collectNow(id); return;
    case 'money-filter': S.moneyFilter = v; S.moneyOpen = null; break;
    case 'money-open': S.moneyOpen = S.moneyOpen === id ? null : id; break;
    case 'profile': S.sheet = { kind:'profile' }; break;

    /* corrections: both run a record backwards, so both state a reason */
    case 'ask-reopen': S.sheet = { kind:'reopen', id }; S.cancelReason = ''; break;
    case 'reopen-session': {
      if (S.cancelReason.trim().length <= 3) return;
      const reason = S.cancelReason.trim();
      S.sheet = null; S.cancelReason = '';
      mutate('/api/bookings/' + id + '/status',
        { status:'upcoming', reason, version:b.version });
      return;
    }
    case 'ask-reverse': {
      const rec = sessById(id), held = rec && rec.collectedByMode || {};
      S.sheet = { kind:'reverse', id };
      S.revMode = ['Cash','UPI','Card'].find(m => (held[m] || 0) > 0) || 'Cash';
      S.revVal = ''; S.revReason = '';
      break;
    }
    case 'rev-mode': S.revMode = v; S.revVal = ''; break;
    case 'rev-all': S.revVal = v; break;
    case 'reverse-payment': {
      const rec = sessById(id);
      const inMode = Math.round((rec.collectedByMode || {})[S.revMode] || 0);
      const amount = Math.max(0, parseInt(S.revVal, 10) || 0);
      if (!can('manager') || amount <= 0 || amount > inMode || S.revReason.trim().length < 5) return;
      const body = { amount, mode:S.revMode, reason:S.revReason.trim(),
        reference:S.revMode === 'Cash' ? '' : inPersonRef(),
        idempotencyKey:crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now() + Math.random(),
        version:rec.version };
      S.sheet = null; S.revVal = ''; S.revReason = '';
      mutate('/api/bookings/' + id + '/refunds', body);
      return;
    }
    case 'today-filter': S.todayFilter = v; break;

    /* the board */
    case 'book-slot': {
      if (!formReady()) return;
      const confirm = sh.kind === 'confirm';
      const h = hours()[sh.hi];
      /* Read before the form is cleared, or the booking goes up nameless. */
      const body = { date:confirm ? todayIso() : sh.date, pitch:sh.pi,
        start:h * 60, end:(h + 1) * 60,
        team:S.form.team.trim(), contact:S.form.contact.trim(),
        pay:confirm ? (t.dataset.pay === 'paid' ? 'Payment done' : 'Payment at venue') : S.form.pay };
      S.sheet = null; S.form = blankForm();
      mutate('/api/bookings', body);
      return;
    }
    case 'hold-slot': {
      if (!formReady()) return;
      const h = hours()[sh.hi];
      const body = { date:sh.date, pitch:sh.pi, start:h * 60, end:(h + 1) * 60,
        team:S.form.team.trim(), contact:S.form.contact.trim(), pay:S.form.pay };
      S.sheet = null; S.form = blankForm();
      mutate('/api/holds', body);
      return;
    }
    case 'confirm-hold': S.sheet = null; mutate('/api/holds/' + id + '/confirm'); return;
    case 'release-hold':
      S.sheet = null;
      mutate('/api/holds/' + id + '/release', { reason:'Released from the phone' });
      return;
    case 'release-block':
      S.sheet = null;
      mutate('/api/blocks/' + id + '/release', { reason:'Maintenance finished' });
      return;
    case 'block-slot': {
      if (S.blockReason.trim().length < 15) return;
      const h = hours()[sh.hi], reason = S.blockReason.trim();
      S.sheet = null; S.blockReason = '';
      mutate('/api/blocks', { date:dateFor(S.dayIndex), pitch:sh.pi,
        start:h * 60, end:(h + 1) * 60, reason });
      return;
    }
    case 'form-pay': S.form.pay = v; break;

    /* custom slot screen */
    case 'sell-pitch': S.sellPitch = +v; break;
    case 'sell-dur': S.sellDur = +v; break;
    case 'sell-pay': S.sellPay = v; break;
    case 'sell-confirm': {
      const a = toMin(S.sellStart), z = a + S.sellDur;
      if (!(S.sellName.trim().length > 1 && digits(S.sellPhone) >= 8)) return;
      const name = S.sellName.trim();
      mutate('/api/bookings', { date:todayIso(), pitch:S.sellPitch, start:a, end:z,
        team:name, contact:S.sellPhone.trim(), pay:S.sellPay }).then(result => {
          if (!result) return;
          S.sellDone = name + ' booked · ' + rng12(a, z) + ' on '
            + PITCHES[S.sellPitch].name + ' · ' + S.sellPay;
          S.sellName = ''; S.sellPhone = '';
          render();
        });
      return;
    }

    default: return;
  }
  render();
});

/* Text fields write straight into state; the repaint that follows is coalesced
   so it lands between words rather than between letters. */
document.addEventListener('input', e => {
  const el = e.target.closest('[data-model]');
  if (!el) return;
  const path = el.dataset.model;
  if (path.startsWith('form.')) S.form[path.slice(5)] = el.value;
  else S[path] = el.value;
  renderSoon();
});

/* The one form on the page that is a real form: the password never touches S. */
document.addEventListener('submit', e => {
  const form = e.target.closest('[data-login]');
  if (!form) return;
  e.preventDefault();
  if (S.busy) return;
  const data = new FormData(form);
  S.busy = true; S.authError = ''; render();
  apiRequest('/api/auth/login', { method:'POST',
    body:{ email:String(data.get('email') || ''), password:String(data.get('password') || '') } })
    .then(async result => {
      S.user = result.user; S.csrf = result.csrfToken;
      if (!S.user.mustChangePassword) await loadState();
    })
    .catch(error => { S.authError = error.message; })
    .finally(() => { S.busy = false; render(); });
});

/* Escape closes a sheet, then steps back to the board. */
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
addEventListener('focusout', () => { if (missedTick){ missedTick = false; setTimeout(render, 0); } }, true);
addEventListener('pointerdown', () => { holding = true; }, true);
addEventListener('pointerup', () => setTimeout(release, 0), true);
addEventListener('pointercancel', () => setTimeout(release, 0), true);

render();
boot();

setInterval(() => {
  if (!S.user || !LIVE_SCREENS.has(S.screen)) return;
  if (holding){ missedTick = true; return; }
  /* The keyboard is up and a sheet is covering the board — there is nothing
     behind it being read, and repainting would take the field out from under
     the thumb. The clock catches up the moment the field is left. */
  if (typingNow()){ missedTick = true; return; }
  render();
}, 1000);

/* Two people work this venue and one of them is at the counter. A phone that
   only repainted its own changes would show a hour as free thirty seconds
   after somebody else sold it, so it re-reads the server on a slow beat and
   whenever it comes back to the foreground. */
setInterval(() => {
  if (!S.user || S.busy || S.sheet || typingNow()) return;
  loadState().then(render).catch(() => {});
}, 20000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.user && !S.busy) loadState().then(render).catch(() => {});
});
