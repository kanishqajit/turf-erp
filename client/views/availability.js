import { DOW, DOWL, END_HOUR, MON, PAY_FORM, PITCHES, START_HOUR } from '../constants.js';
import { clock12, dateAt, dateForAddress, daysFromToday, hourRng12, hours, hourT12, isoDate, nowMin, relDay, rng12, slotRng12, t12,
  TODAY_DI, toMin } from '../datetime.js';
import { blockAtTime, bookingAtTime, bookingWindow, bookingWindowAt, chipCls, coverage, esc, FLOODLIGHT_FEE, hbar, holdAtTime, needsFloodlights, priceFor,
  label, money, outstandingFor, pitchColorFor, segCls, sourceFor, statusAtTime, statusFor, tintFor, tintVars, validContact, weekStart } from '../domain.js';
import { can, S } from '../state.js';

const blockReady = () => S.blockReason.trim().length >= 15;

/* The two board switches are shapes, not sentences: each pair is a picture of
   the layout it produces, so the control states its own outcome and stops
   spending a third of the bar on words the operator reads once. The names stay
   on the title and the aria-label, which is where a screen reader and a hover
   look for them anyway. */
const VIEW_ICONS = {
  day:'<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><rect x="3" y="4" width="4.6" height="16" rx="1.6"/><rect x="9.7" y="4" width="4.6" height="16" rx="1.6"/><rect x="16.4" y="4" width="4.6" height="16" rx="1.6"/></svg>',
  week:'<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><rect x="6.5" y="4" width="11" height="16" rx="2"/></svg>',
  timeline:'<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><rect x="4" y="3.5" width="16" height="6.4" rx="2"/><rect x="4" y="11.6" width="16" height="8.9" rx="2"/></svg>',
  compact:'<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><rect x="4" y="5" width="16" height="3.1" rx="1.55"/><rect x="4" y="10.5" width="16" height="3.1" rx="1.55"/><rect x="4" y="16" width="16" height="3.1" rx="1.55"/></svg>',
};
const iconOpt = (act, value, on, icon, name) =>
  `<button class="modeopt is-ico${on ? ' on' : ''}" data-act="${act}" data-v="${value}"
    aria-pressed="${on}" title="${esc(name)}" aria-label="${esc(name)}">${VIEW_ICONS[icon]}</button>`;
const CAL_ICON='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="3"></rect><path d="M8 2.8v3.4M16 2.8v3.4M3 9.5h18"></path></svg>';
const CHEV_ICON='<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>';
/* The column states its own load as a ring rather than a number alone: three
   pitches side by side are compared at a glance by arc length, and the figure
   underneath it is there for when the glance is not enough. */
function pitchDonut(percent){
  const r=13,c=2*Math.PI*r,on=(c*Math.max(0,Math.min(100,percent))/100).toFixed(1);
  return `<svg class="pdonut" viewBox="0 0 34 34" width="34" height="34" aria-hidden="true">
    <circle cx="17" cy="17" r="${r}" fill="none" stroke="var(--edge2)" stroke-width="3.4"></circle>
    <circle cx="17" cy="17" r="${r}" fill="none" stroke="${percent>=70?'var(--ink)':'var(--lime-deep)'}" stroke-width="3.4"
      stroke-linecap="round" stroke-dasharray="${on} ${c.toFixed(1)}" transform="rotate(-90 17 17)"></circle>
    <text x="17" y="20.5" text-anchor="middle" class="pdonut-t">${percent}%</text></svg>`;
}

/* "6–7AM" reads as a big "6–7" beside a small "AM": the hour is what the eye
   is scanning for, the meridiem only disambiguates it. A range that crosses
   noon carries two meridiems ("11AM–12PM") and cannot be split that way, so it
   stays whole and CSS sizes it down instead. */
function timeParts(text){
  const match = /^(.*?)(AM|PM)$/.exec(text);
  if (!match || /AM|PM/.test(match[1])) return { range:text, suffix:'' };
  return { range:match[1], suffix:match[2] };
}
function timeHtml(text){
  const { range, suffix } = timeParts(text);
  return `<span class="bub-time${suffix ? '' : ' wide'}"><b>${esc(range)}</b>${suffix ? `<i>${suffix}</i>` : ''}</span>`;
}

const bubble = (status, source, selected, covered, full) => {
  const kind = covered && !full ? 'part'
    : status === 'booked' ? (source === 'app' ? 'via-app' : 'counter')
    : status === 'free' ? '' : status;
  return ['bub',kind,selected ? 'sel' : ''].filter(Boolean).join(' ');
};

function slotHtml(di, hi, hour, pitch = S.pitch){
  /* Collapsed, the row states the hour and the column states the day, so a cell
     that repeats either says nothing. It states instead what neither can — who
     holds the hour and the run it belongs to — which is the same collapsed line
     the cell renderer already builds, so it is deferred to rather than doubled
     here. That also retires the part-booked overlay, which had to clip its own
     label to draw the split and so printed the hour twice over. */
  if (S.dense) return denseCellHtml(di, pitch, hour);
  const covered = coverage(pitch, di, hour);
  const status = covered ? 'booked' : statusFor(di, hi, pitch);
  const source = covered ? covered.c.source || 'counter' : sourceFor(di, hi, pitch);
  const selected = !!(S.sel && S.sel.di === di && S.sel.hi === hi && S.pitch === pitch);
  const full = !!(covered && covered.s <= 0 && covered.e >= 100);
  const time = hourRng12(hour);
  const title = covered ? rng12(covered.c.start, covered.c.end) + ' · custom booking'
      + (covered.c.team ? ' · ' + covered.c.team : '')
    : time + ' · ' + label(status) + (status === 'booked' ? ' · ' + (source === 'app' ? 'app' : 'counter') : '');
  const indicator = status === 'booked'
    ? { text:source === 'app' ? 'APP' : 'Counter', cls:`source ${source}` }
    : status === 'hold' ? { text:'Hold', cls:'state hold' }
    : status === 'blocked' ? { text:'Maintenance', cls:'state maintenance' }
    : null;
  const indicatorPill = indicator
    ? `<span class="bub-indicator ${indicator.cls}" aria-hidden="true">${indicator.text}</span>`
    : '';
  const overlay = covered && !full
    ? `<span class="ovl" style="clip-path:inset(0 ${100-covered.e}% 0 ${covered.s}%)">${time}</span>` : '';
  return `<button class="${bubble(status,source,selected,covered,full)}" title="${esc(title)}"
    data-act="slot" data-di="${di}" data-hi="${hi}" data-pi="${pitch}">
    ${timeHtml(time)}${indicatorPill}${overlay}</button>`;
}

/* ── the collapsed grid ──
   A row per hour, every cell the same size — the shape that can be scanned in
   one pass. The hard part is the part-booked hour: splitting the cell clips its
   own label, and filling it whole hides time that is still on sale. So the cell
   fills solid and states the leftover instead. "30m free" is read, not
   interpreted, and it costs no height. */
function hourFill(di, pitch, hour){
  const date = dateForAddress(S.weekOffset, di), start = hour * 60, end = start + 60;
  const hit = (record, kind) => record.date === date && record.pitch === pitch
    && record.start < end && record.end > start ? { kind, record } : null;
  const items = [
    ...S.bookings.filter(b => b.status !== 'noshow' && b.status !== 'cancelled').map(b => hit(b, 'booked')),
    ...S.holds.filter(h => h.expiresAt > Date.now()).map(h => hit(h, 'hold')),
    ...S.blocks.map(b => hit(b, 'blocked')),
  ].filter(Boolean).sort((a, b) => a.record.start - b.record.start);

  /* union of the taken minutes, so two bookings meeting inside the hour do not
     double-count the overlap and report free time that is not there */
  let taken = 0, cursor = start;
  for (const { record } of items){
    const from = Math.max(record.start, start), to = Math.min(record.end, end);
    if (to > cursor){ taken += to - Math.max(from, cursor); cursor = Math.max(cursor, to); }
  }
  return { items, freeMin:60 - taken };
}

function denseCellHtml(di, pitch, hour){
  const start = hour * 60;
  const { items, freeMin } = hourFill(di, pitch, hour);
  const first = items[0] || null;
  const status = first ? first.kind : 'free';
  const source = status === 'booked' ? first.record.source || 'counter' : null;
  const hi = clamp(hour - START_HOUR, 0, hours().length - 1);
  /* Clicking a part-booked hour should open the booking in it, not the sliver
     in front of it, so the offset points at whatever holds the hour. */
  const offset = first ? Math.max(0, Math.max(first.record.start, start) - start) : 0;
  const selected = !!(S.sel && S.sel.di === di && S.pitch === pitch
    && hours()[S.sel.hi] * 60 + S.startOffset === start + offset);
  const kind = status === 'booked' ? (source === 'app' ? 'via-app' : 'counter')
    : status === 'free' ? '' : status;
  const who = first ? (first.record.team || first.record.reason || '') : '';
  const time = hourRng12(hour);
  const partly = !!first && freeMin > 0;
  const title = first ? `${who} · ${rng12(first.record.start, first.record.end)}`
    + (partly ? ` · ${freeMin}m of this hour free` : '')
    : `${time} · ${label(status)}`;
  /* Collapsed, the cell is the plainest thing on the board: one hour, stated
     once, and a fill. The question this view answers is "which of these is
     free tonight" — a pattern of colour read down a column, not a list to be
     read across. Who holds a taken hour is on the tooltip and in the panel; put
     it in the cell and every row becomes a line of text to parse instead of a
     shape to scan, which is the timeline's job, not this one. */
  const cls = ['bub', kind, partly ? 'partly' : '', selected ? 'sel' : ''].filter(Boolean).join(' ');
  return `<button class="${cls}"
    title="${esc(title)}" data-act="slot" data-di="${di}" data-hi="${hi}" data-pi="${pitch}"
    data-offset="${offset}">${timeHtml(time)}${partly
      ? `<i class="bub-free">${freeMin}m free</i>` : ''}</button>`;
}

function denseGridHtml(di, showNow){
  const liveNow = showNow ? nowMin() : null, liveHour = liveNow == null ? -1 : Math.floor(liveNow / 60);
  const bands = [];
  hours().forEach(hour => {
    const name = bandOf(hour);
    let band = bands[bands.length - 1];
    if (!band || band.name !== name){ band = { name, rows:[], firstH:hour }; bands.push(band); }
    band.lastH = hour;
    band.rows.push({ hour, isNow:hour === liveHour, cells:PITCHES.map((_, pitch) => denseCellHtml(di, pitch, hour)) });
  });
  return bands.map(band => {
    const closed = !!S.collapsedBands[band.name];
    return `<div class="band${closed ? ' closed' : ''}">
      <button class="band-head" data-act="toggle-band" data-v="${band.name}" aria-expanded="${!closed}">
        <i class="band-chev">&#9662;</i><span class="band-name">${band.name}</span><i class="band-rule"></i>
        <span class="band-span">${slotRng12(band.firstH * 60, (band.lastH + 1) * 60)}</span>
        <span class="band-toggle">${closed ? 'Show' : 'Hide'}</span>
      </button>
      ${closed ? '' : band.rows.map(row => `<div class="bandrow${row.isNow ? ' has-now' : ''}">
        <span class="hourlbl"><span class="hourtxt">${hourT12(row.hour)}</span></span>
        ${row.cells.join('')}
      </div>`).join('')}
    </div>`;
  }).join('');
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rowOf = minute => Math.floor((minute - START_HOUR * 60) / 30) + 1;
const rowSpan = (start, end) => Math.max(1, Math.ceil((end - start) / 30));
const recordOverlaps = (record, start, end) => record.start < end && record.end > start;
const bookingClass = booking => bubble('booked', booking.source || 'counter', false, true, true);
const recordHi = record => clamp(Math.floor(record.start / 60) - START_HOUR, 0, hours().length - 1);
const sourceText = booking => booking.source === 'app' ? 'App' : booking.groupType ? booking.groupType : 'Counter';

const durTxt = mins => mins < 60 ? mins + 'm'
  : Math.floor(mins / 60) + 'h' + (mins % 60 ? ' ' + (mins % 60) + 'm' : '');

/* A taken slot is drawn as a run of time rather than a filled cell: the start
   and end anchored at the two outer edges, the length riding the rail between
   them, and underneath the only two things the counter acts on — who it is and
   the number to call them on. Open time keeps the single centred hour, because
   there is nothing to read there, only space to see. */
function railHtml(from, to){
  return `<span class="ev-head">${timeHtml(t12(from))}
    <span class="ev-rail" aria-hidden="true"><i></i><b class="ev-chip">${durTxt(to - from)}</b><i></i></span>
    ${timeHtml(t12(to))}</span>`;
}

/* The taken card is in two tones: the run of time on the bright field, then a
   deeper band of the same hue carrying who and how to reach them. Two shades
   rather than two borders, so the split is felt before it is read. The kind
   tag rides the top edge like a masthead — it labels the card, it is not part
   of what you act on. */
/* A longer booking should read as a bigger card, not as an hour card with air
   added. Two things grow with the height, and they grow differently:

   The times grow only until the column's width runs out — it does not grow with
   the booking, and past about 29px the two of them crowd the rail between them
   down to nothing. So the type stops there.

   The band takes the rest. Holding it at a roughly constant share of the card
   is what keeps a three-hour card looking like a bigger version of an hour card
   rather than one with a stripe along the bottom — and it is the slack going
   somewhere deliberate instead of collecting in the gaps. */
const EV_SCALE = { 2:[21, 7], 3:[27, 10], 4:[29, 15], 5:[29, 19] };
/* ── a session arriving, then running ──
   The board already knows a match is about to start; the counter should not
   have to leave it to say so. Within the arrival window a booking offers
   check-in, once checked in it offers the timer, and once running it carries
   the clock itself — the ring is the booking's own edge filling up, so the
   card is the progress bar rather than containing one.

   Check-in is local: there is no arrival status on the server, only
   upcoming/running/done/noshow. Starting the timer is the real transition and
   goes through the API, which is why only that step can fail. */
const ARRIVAL_WINDOW = 20;

/* What the card is being asked to do right now. One function, because the
   states are a sequence and the transitions between them are the whole point:
   arriving → checked in → running → ended, and if money is still owed at the
   end the card stops being a schedule entry and becomes a debt. */
function liveStateFor(booking, di){
  const offset = daysFromToday(S.weekOffset, di);
  const owed = outstandingFor(booking);
  /* A session that ended owing money stays loud until it is collected — the
     leak this closes is the match that finishes, everyone leaves, and nobody
     chased the cash. It outlives the day it happened on. */
  if (booking.status === 'done' && offset <= 0){
    if (owed > 0) return { mode:'owed', id:booking.id, owed, contact:booking.contact, team:booking.team };
    /* Played and paid for. Nothing left to do with it, so it stops competing
       for attention with the slots that still need something — present, still
       readable, but visibly finished business. */
    return { mode:'settled', id:booking.id };
  }
  if (offset !== 0) return null;
  const now = nowMin();
  /* The clock runs from the minute the operator said play began, not from the
     minute the slot was sold for — those differ whenever a team walks on late,
     and the countdown on the card is the one the staff read to know when to
     call time. The booked window still owns the grid: the card keeps its
     placement and its height, and a session that overruns its slot says so by
     going over rather than by being redrawn somewhere else. */
  if (booking.status === 'running'){
    const total = Math.max(1, booking.end - booking.start);
    const from = booking.startedAt == null ? booking.start : booking.startedAt;
    const until = from + total;
    return { mode:'running', id:booking.id, start:from, end:until,
      pct:clamp((now - from) / total, 0, 1) * 100, over:now > until };
  }
  if (booking.status !== 'upcoming' || now >= booking.end) return null;
  if (now < booking.start - ARRIVAL_WINDOW) return null;
  return { mode:S.checkedIn[booking.id] ? 'ready' : 'arriving', id:booking.id };
}

/* Seconds, because a countdown that only moves once a minute reads as broken.
   Taken from the wall clock rather than a stored deadline so it cannot drift. */
/* Minutes are what the operator reads; the seconds only confirm the clock is
   moving, so they ride a size down inside their own element rather than taking
   equal weight. Past an hour the hour joins the minutes and the seconds stay
   where they are. */
export function countTxt(endMinute){
  /* Through nowMin like everything else on the board: reading the wall clock
     directly here let the countdown and the ring around it disagree, since the
     ring measures elapsed time from the same nowMin the now-line uses. */
  const left = Math.max(0, Math.round((endMinute - nowMin()) * 60));
  const hh = Math.floor(left / 3600), mm = Math.floor((left % 3600) / 60), ss = left % 60;
  const pad = value => String(value).padStart(2, '0');
  return (hh ? `${hh}:${pad(mm)}` : pad(mm)) + `<i>:${pad(ss)}</i>`;
}

/* pathLength normalises the outline to 100 units, so progress is a plain
   percentage and no rounded rectangle has to be measured at any size. The
   radius has to track the card's own, or the stroke cuts across its corners. */
/* ── icons ──
   Ported from the design system's live-state card. Solid glyphs on the two
   destructive controls, stroked on the rest. */
const ICONS = {
  play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5l11 6.5-11 6.5z" stroke="none"></path></svg>',
  check:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><path d="M5 12.8l4.6 4.4L19 7" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  undo:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><path d="M9 5L4.5 9.5 9 14M4.5 9.5H14a5.5 5.5 0 010 11H8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  cash:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><rect x="3" y="6.5" width="18" height="11" rx="2.4" stroke-width="2.2"></rect><circle cx="12" cy="12" r="2.6" stroke-width="2.2"></circle></svg>',
  phone:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><path d="M7 3.5l3 4-2.2 2.2a12 12 0 006.5 6.5L16.5 14l4 3v3a1.5 1.5 0 01-1.7 1.5C10.6 20.6 3.4 13.4 2.5 5.2A1.5 1.5 0 014 3.5z" stroke-width="2"></path></svg>',
  pause:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="4.5" width="3.8" height="15" rx="1.8" stroke="none"></rect><rect x="13.2" y="4.5" width="3.8" height="15" rx="1.8" stroke="none"></rect></svg>',
  cross:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke-width="3" stroke-linecap="round"></path></svg>',
  bell:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6a5.6 5.6 0 00-5.6 5.6v3.4L4.6 15.2a1 1 0 00.9 1.5h13a1 1 0 00.9-1.5l-1.8-3.6V8.2A5.6 5.6 0 0012 2.6zM9.6 18.4a2.6 2.6 0 004.8 0z" stroke="none"></path></svg>',
};

/* The ring traces the card's own outline, so its radius has to match the
   timer card's — 30, not the planning card's 24. */
const ringHtml = pct => `<svg class="tm-ring" aria-hidden="true" preserveAspectRatio="none">
  <rect class="tm-ring-track" x="3" y="3" rx="30" pathLength="100"></rect>
  <rect class="tm-ring-fill" x="3" y="3" rx="30" pathLength="100"
    style="stroke-dasharray:${pct.toFixed(2)} 100"></rect></svg>`;

/* ── the tray ──
   One bar across the base of the card rather than chips in a corner. The
   corner is where nothing looks, and these are the actions the card exists to
   offer; a tray states the single thing to do at a size that says so. */
const cta = (act, id, icon, label, cls = '', accessibleLabel = label) =>
  `<button class="ev-cta ${cls}" data-act="${act}" data-id="${esc(id)}"${
    accessibleLabel ? ` title="${esc(accessibleLabel)}" aria-label="${esc(accessibleLabel)}"` : ''}><i>${ICONS[icon]}</i>${
    label ? `<span>${esc(label)}</span>` : ''}</button>`;

function liveActionHtml(live){
  if (!live) return '';
  if (live.mode === 'arriving')
    return `<span class="ev-tray">${cta('check-in', live.id, 'check', 'Check in')}</span>`;
  if (live.mode === 'ready')
    return `<span class="ev-tray">${
      cta('undo-check-in', live.id, 'undo', 'Undo', 'is-quiet')}${
      cta('start-on-board', live.id, 'play', 'Start timer')}</span>`;
  /* Running keeps its controls flanking the clock rather than in a tray: the
     count is the card's whole content, and a bar under it would push the one
     number being read off centre. */
  if (live.mode === 'running')
    return `<span class="tm-acts">
      <button class="tm-btn" data-act="stop-timer" data-id="${esc(live.id)}"
        title="Stop the timer" aria-label="Stop the timer">${ICONS.pause}</button>
      <button class="tm-btn is-end" data-act="end-game" data-id="${esc(live.id)}"
        title="End session" aria-label="End session">${ICONS.cross}</button></span>`;
  if (live.mode === 'owed')
    return `<span class="ev-tray">${
      cta('reopen-on-board', live.id, 'undo', '', 'is-quiet is-icon', 'Reopen session')}${
      cta('collect-on-board', live.id, 'cash', 'Collect ' + money(live.owed), 'is-paper')}</span>`;
  /* A settled card asks for nothing, so it gets no tray — but money is
     corrected more often than anyone likes, so it keeps one quiet chip in the
     corner the composition leaves empty. It sits at .55 and comes up on hover.
     A refund is what sends a paid card back to collection, which is what
     "edit payment" means here; the server keeps it manager-only. */
  if (live.mode === 'settled')
    return `<span class="ev-acts"><button class="ev-act is-quiet" data-act="edit-payment"
      data-id="${esc(live.id)}">Edit payment</button></span>`;
  return '';
}

/* ── the live face ──
   A card that is about to start, or running, stops looking like a schedule
   entry. The times and the rail are what you read when planning the day; when
   the match is at the door the only things that matter are the one number that
   is counting and the two controls either side of it, so the card is rebuilt
   around them and the planning detail demotes to a caption. */
function liveFaceHtml(live, { time, detail, contact, from, to }){
  const who = [detail, contact].filter(Boolean).map(esc).join(' · ');
  /* The alarm line states the clock time the session ends at, not a duration —
     the one number an operator can act on without doing arithmetic. */
  /* The alarm line and the count both read the live end, which is the booked
     end only when the session started on time. */
  if (live.mode === 'running')
    return `<span class="tm">
      <span class="tm-top">${ICONS.bell}Ends ${esc(t12(live.end))}</span>
      <b class="tm-count${live.over ? ' is-over' : ''}" data-count data-to="${live.end}">${countTxt(live.end)}</b>
      <span class="tm-sub">${who}</span></span>`;
  return `<span class="ev-face">
    <span class="ev-face-top">${esc(time)}</span>
    <b class="ev-face-cue">${live.mode === 'ready' ? 'Ready to start' : 'Starting soon'}</b>
    <span class="ev-face-sub">${who}</span></span>`;
}

function scheduleBubble({ cls, title, di, pitch, start, span, time, detail = '', meta = '', contact = '', from = null, to = null, live = null, lane = null, openRun = false }){
  const [timePx, bandPad] = EV_SCALE[span] || (span < 2 ? [15, 6] : [29, 22]);
  const tag = meta ? `<small>${esc(meta)}</small>` : '';
  const onstage = !!live && live.mode !== 'owed' && live.mode !== 'settled';
  /* A running card carries no kind tag: the clock and its two controls own the
     whole width, and the tag was being clipped against the pause button. The
     design system's own live card drops it for the same reason — while a match
     is on, whether it came from the counter or the app is not the question. */
  /* An unpaid card is not a booking any more, it is a debt, so it states the
     problem and the money rather than the kind and the phone. The tag names
     what is wrong, the right of that row states when the session ended, and the
     band trades the contact for the amount — the number to ring is one tap away
     on the tray under it, the figure to collect is not. */
  const body = live && live.mode === 'owed'
    ? `<span class="ev-owedtop"><b>Payment pending</b><i>Ended ${esc(t12(to))}</i></span>`
      + `${railHtml(from, to)}<span class="ev-range">${timeHtml(time)}</span>`
      + `<span class="ev-foot">${detail ? `<strong>${esc(detail)}</strong>` : ''}<em>${esc(money(live.owed))} due</em></span>`
    : onstage
    ? `${live.mode === 'running' ? '' : tag}${liveFaceHtml(live, { time, detail, contact, from, to })}`
    : openRun
    ? `${tag}${railHtml(from, to)}<span class="ev-range">${timeHtml(time)}</span>`
    : from == null
    ? `${timeHtml(time)}${detail ? `<strong>${esc(detail)}</strong>` : ''}${tag}`
    : `${tag}${railHtml(from, to)}<span class="ev-range">${timeHtml(time)}</span>`
      + `<span class="ev-foot">${detail ? `<strong>${esc(detail)}</strong>` : ''}${contact ? `<em>${esc(contact)}</em>` : ''}</span>`;
  const [laneIndex, laneCount] = Array.isArray(lane) ? lane : [0, 1];
  return `<div class="schedule-cell${span === 1 ? ' compact' : ''}${laneCount > 1 ? ' is-split' : ''}${
    onstage ? ' is-onstage' : ''}"${live ? ` data-state="${live.mode}"` : ''}
    style="--grid-col:${pitch + 2};--grid-row:${rowOf(start)};--grid-span:${span};--lane:${laneIndex};--lanes:${laneCount}">
    <button class="${cls} schedule-bub${from == null && !openRun ? '' : ' is-run'}${span >= 3 && !live ? ' is-tall' : ''}${
      span >= 4 && !live ? ' is-long' : ''}${
      live ? ' is-' + live.mode : ''}${live && live.mode === 'running' ? ' is-timer' : ''}${
      onstage && live.mode !== 'running' ? ' is-face' : ''}${
      live && ['arriving','ready','owed'].includes(live.mode) ? ' has-tray' : ''}${
      live && span <= 3 ? ' is-short' : ''}${live && span === 2 ? ' is-live-hour' : ''}" title="${esc(title)}" data-act="slot" data-di="${di}" data-hi="${recordHi({ start })}"
      data-pi="${pitch}" data-offset="${start % 60}"${from == null ? '' : ` data-from="${
        live && live.mode === 'running' ? live.start : from}" data-to="${
        live && live.mode === 'running' ? live.end : to}"`}
      style="--ev-time:${timePx}px;--ev-bandpad:${bandPad}px">
      ${body}${live && live.mode === 'running' ? ringHtml(live.pct) : ''}
    </button>${liveActionHtml(live)}</div>`;
}

function scheduleHtml(di, showNow){
  const startMin = START_HOUR * 60, endMin = (START_HOUR + hours().length) * 60;
  const date = dateForAddress(S.weekOffset, di), rows = hours().length * 2, pieces = [];
  const records = [];
  PITCHES.forEach((_, pitch) => {
    S.bookings.filter(booking => booking.date === date && booking.pitch === pitch
      && booking.status !== 'noshow' && booking.status !== 'cancelled' && booking.end > startMin && booking.start < endMin)
      .forEach(booking => records.push({ type:'booking', pitch, record:booking }));
    S.holds.filter(hold => hold.expiresAt > Date.now() && hold.date === date && hold.pitch === pitch
      && hold.end > startMin && hold.start < endMin)
      .forEach(hold => records.push({ type:'hold', pitch, record:hold }));
    S.blocks.filter(block => block.date === date && block.pitch === pitch && block.end > startMin && block.start < endMin)
      .forEach(block => records.push({ type:'blocked', pitch, record:block }));
  });
  records.sort((a, b) => a.record.start - b.record.start || a.pitch - b.pitch);

  /* Records on one pitch should never overlap — the server refuses to write a
     booking over another. Should one ever appear anyway (a direct write, a
     migration, a restore), drawing them on top of each other hides a booking
     completely, and a match nobody can see is worse than an ugly board. So
     anything that overlaps splits the column between them, the way a calendar
     splits two events at the same hour. */
  const laneOf = new Map();
  PITCHES.forEach((_, pitch) => {
    const mine = records.filter(item => item.pitch === pitch);
    const laneEnds = [];
    mine.forEach(item => {
      let lane = 0;
      while (laneEnds[lane] != null && laneEnds[lane] > item.record.start) lane++;
      laneEnds[lane] = item.record.end;
      laneOf.set(item, lane);
    });
    /* Everything in one run of overlaps shares a lane count, so a run reads as
       a single band of columns rather than each card guessing its own width. */
    let run = [], edge = -1;
    const close = () => {
      if (!run.length) return;
      const lanes = run.reduce((most, item) => Math.max(most, laneOf.get(item)), 0) + 1;
      run.forEach(item => laneOf.set(item, [laneOf.get(item), lanes]));
      run = [];
    };
    mine.forEach(item => {
      if (run.length && item.record.start >= edge) close();
      run.push(item); edge = Math.max(edge, item.record.end);
    });
    close();
  });
  records.forEach(item => {
    const record = item.record, start = clamp(record.start, startMin, endMin), end = clamp(record.end, startMin, endMin);
    const selected = !!(S.sel && S.sel.di === di && S.pitch === item.pitch
      && hours()[S.sel.hi] * 60 + S.startOffset >= start && hours()[S.sel.hi] * 60 + S.startOffset < end);
    const cls = item.type === 'booking' ? bookingClass(record) : bubble(item.type, null, false, false, true);
    const detail = item.type === 'booking' ? record.team || sourceText(record)
      : item.type === 'hold' ? record.team || 'On hold' : record.reason || 'Maintenance';
    const live = item.type === 'booking' ? liveStateFor(record, di) : null;
    const meta = live && live.mode === 'owed' ? `Payment due · ${money(live.owed)}`
      : item.type === 'booking' ? sourceText(record) : item.type === 'hold' ? 'Hold' : 'Maintenance';
    /* Maintenance has no customer behind it, so only bookings and holds carry a
       contact — a blocked hour showing a phone number would be a lie. */
    const contact = item.type === 'blocked' ? '' : record.contact || '';
    pieces.push(scheduleBubble({ cls:cls + (selected ? ' sel' : ''), title:(detail ? detail + ' · ' : '') + rng12(record.start, record.end),
      di, pitch:item.pitch, start, span:rowSpan(start, end), time:rng12(record.start, record.end), detail, meta, contact,
      from:record.start, to:record.end, live, lane:laneOf.get(item) }));
  });
  hours().forEach(hour => {
    pieces.push(`<span class="hourlbl schedule-hour" style="--grid-row:${rowOf(hour * 60)};--grid-span:2">
      <span class="hourtxt">${hourT12(hour)}</span></span>`);
  });
  /* Open time is one slot for as long as it actually runs, not one per hour.
     A gap that straddles an hour boundary was being cut in two by the loop that
     drew it — 11:30 to 12:30 came out as two half-hour cards with a seam down
     the middle of a slot nobody would ever sell separately. The taken windows
     are merged first, and what is left between them is the slot. */
  PITCHES.forEach((_, pitch) => {
    const selectedStart = S.sel && S.sel.di === di && S.pitch === pitch
      ? hours()[S.sel.hi] * 60 + S.startOffset : -1;
    const taken = records.filter(item => item.pitch === pitch)
      .map(item => [clamp(item.record.start, startMin, endMin), clamp(item.record.end, startMin, endMin)])
      .sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const window of taken){
      const last = merged[merged.length - 1];
      if (last && window[0] <= last[1]) last[1] = Math.max(last[1], window[1]);
      else merged.push(window.slice());
    }
    let cursor = startMin;
    const gaps = [];
    for (const [from, to] of merged){
      if (from > cursor) gaps.push([cursor, from]);
      cursor = Math.max(cursor, to);
    }
    if (cursor < endMin) gaps.push([cursor, endMin]);
    /* A gap is cut into the lengths it can actually be sold in — whole hours
       measured from where the gap starts, not from the clock, so 11:30 to 12:30
       is one slot rather than two halves either side of noon. What is left over
       is a half hour, and it is still a normal sellable slot.

       The dotted treatment is reserved for the one case that deserves a
       warning: a lone half hour with a booking hard against both sides. That is
       the slot nobody can grow, and the only one worth drawing as awkward. */
    const emit = (from, to, wedged) => {
      const span = rowSpan(from, to);
      const selected = selectedStart >= from && selectedStart < to;
      pieces.push(scheduleBubble({ cls:`bub schedule-open ${wedged ? 'partial' : 'full'}${selected ? ' sel' : ''}`,
        title:`${wedged ? 'Half hour between bookings' : 'Open'} · ${rng12(from, to)}`,
        di, pitch, start:from, span, time:rng12(from, to),
        meta:wedged ? 'Half hour' : 'Open', from, to, openRun:true }));
    };
    /* The board sells hours, so open time is drawn in hours and a leftover half
       hour is drawn as itself — never as a 90-minute bubble, which is not a
       thing anyone books.

       Contiguous free time has already been merged into one gap above, so two
       free halves either side of an hour boundary arrive here as a single
       60-minute run and come out as one bubble rather than two.

       That leaves the half hours. One is dotted only when the whole gap is a
       half hour with a booking hard against both ends — the slot nobody can
       grow. A half hour that trails an open hour is ordinary sellable time and
       reads as a normal open slot, just shorter, because that is what it is. */
    /* An open slot is a run of time too, so it is drawn like one — tag, then the
       two ends with the rail between them. It used to centre a single range,
       which left open time as the only thing on the board with its own grammar. */
    gaps.forEach(([from, to]) => {
      if (to - from <= 30) return emit(from, to, from > startMin && to < endMin);
      let cursor = from;
      while (to - cursor >= 60){ emit(cursor, cursor + 60, false); cursor += 60; }
      if (cursor < to) emit(cursor, to, false);
    });
  });
  const now = showNow ? nowMin() : null;
  if (now != null && now >= startMin && now <= endMin){
    pieces.push(`<span class="schedule-now" data-now-line data-schedule-now data-start-hour="${START_HOUR}"
      style="--now-row:${(now - startMin) / 30}" aria-hidden="true"><b>${t12(now)}</b></span>`);
  }
  return `<div class="schedule-board" style="--rows:${rows}">${pieces.join('')}</div>`;
}

const bandOf = hour => hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : hour < 21 ? 'Evening' : 'Late night';
function buildBands(allHours, cellsFor){
  const bands = [];
  allHours.forEach((hour, hi) => {
    const name = bandOf(hour);
    let band = bands[bands.length - 1];
    if (!band || band.name !== name){ band = { name, rows:[], firstH:hour }; bands.push(band); }
    band.lastH = hour;
    band.rows.push({ h:hour, hi, cells:cellsFor(hour, hi) });
  });
  return bands;
}

function bandsHtml(bands, withHourLabel, showNow = false){
  const liveNow = showNow ? nowMin() : null;
  const liveHour = liveNow == null ? -1 : Math.floor(liveNow / 60);
  return bands.map(band => {
    const closed = !!S.collapsedBands[band.name];
    return `<div class="band${closed ? ' closed' : ''}">
      <button class="band-head" data-act="toggle-band" data-v="${band.name}" aria-expanded="${!closed}">
        <i class="band-chev">&#9662;</i><span class="band-name">${band.name}</span><i class="band-rule"></i>
        <span class="band-span">${slotRng12(band.firstH * 60, (band.lastH + 1) * 60)}</span>
        <span class="band-toggle">${closed ? 'Show' : 'Hide'}</span>
      </button>
      ${closed ? '' : band.rows.map(row => {
        const isNow = row.h === liveHour;
        return `<div class="bandrow${isNow ? ' has-now' : ''}">
          ${withHourLabel ? `<span class="hourlbl"><span class="hourtxt">${hourT12(row.h)}</span></span>` : ''}
          ${row.cells.join('')}
          ${isNow ? `<span class="now-line" data-now-line data-hour="${row.h}"
            style="--now-offset:${((liveNow % 60) / 60) * 44}px" aria-hidden="true">
            <span class="now-line-label">${t12(liveNow)}</span></span>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

function selectionHtml(){
  const allHours = hours(), startOfWeek = weekStart(), selection = S.sel;
  const hour = allHours[selection.hi];
  const date = new Date(startOfWeek); date.setDate(date.getDate() + selection.di);
  const pitch = PITCHES[S.pitch];
  const probeStart = hour * 60 + S.startOffset;
  const coveredBooking = bookingAtTime(selection.di, S.pitch, probeStart);
  const covered = coveredBooking ? { c:coveredBooking } : null;
  const bookingStart = hour * 60 + S.startOffset, bookingEnd = bookingStart + S.dur;

  if (covered){
    const booking = covered.c;
    const rows = [
      ['Duration', booking.end - booking.start + ' min'],
      ['Booked via', booking.source === 'app' ? 'Turf app · online'
        : booking.groupType ? 'Counter · group booking' : booking.kind === 'custom' ? 'Counter · custom' : 'Counter · walk-in'],
      ['Payment', booking.pay], ['Amount', money(booking.amount)],
    ].concat(booking.groupType ? [['Booking type', booking.groupType]] : [])
      .concat(booking.team ? [[booking.groupType === 'Corporate' ? 'Company' : 'Group name', booking.team]] : [])
      .concat(booking.contact ? [['Contact', booking.contact]] : [])
      .concat(booking.notes ? [['Notes', booking.notes]] : []);
    return `<div class="panel" role="region" aria-label="Selected booking details"><div class="panel-head">
      <span class="tag ondark">${booking.groupType ? esc(booking.groupType) + ' group'
        : booking.kind === 'custom' ? 'Custom booking' : 'Confirmed booking'}</span>
      <button class="x" data-act="clear-sel" aria-label="Close booking details">&times;</button></div>
      <div class="sel-time">${slotRng12(booking.start, booking.end)}</div>
      <div class="sel-where">${DOWL[selection.di]}, ${date.getDate()} ${MON[date.getMonth()]} &middot; ${esc(pitch.name)} &middot; ${esc(pitch.sub)}</div>
      <div class="drule" style="margin:16px 0 4px"></div>
      ${rows.map(row => `<div class="drow"><span>${esc(row[0])}</span><b>${esc(row[1])}</b></div>`).join('')}
      <div style="display:flex;gap:9px;margin-top:14px">${can('manager')
        ? booking.collected > 0
          ? `<button class="dbtn primary" data-act="booking-account" data-id="${booking.id}">Manage account before release</button>`
          : '<button class="dbtn primary" data-act="drop-custom">Release this booking</button>'
        : '<span class="dsub">A manager must release confirmed bookings.</span>'}</div></div>`;
  }

  const status = statusAtTime(selection.di, S.pitch, probeStart);
  const windowCheck = status === 'free' ? bookingWindow(selection.di, S.pitch, bookingStart, S.dur) : null;
  const extendedCheck = status === 'free' && S.dur < 240
    ? bookingWindow(selection.di, S.pitch, bookingStart, S.dur + 30) : null;
  /* The two arrows either side of the time slide the whole window half an hour,
     they do not stretch it: the length is set in the box below and stays where
     it was put, so moving a 90-minute booking half an hour later leaves it 90
     minutes long. Each is offered only if the window actually fits where it
     would land — clear of trading hours at both ends and of whatever is already
     booked there. */
  const shiftFits = delta => status === 'free'
    && bookingStart + delta >= START_HOUR * 60 && bookingEnd + delta <= END_HOUR * 60
    && bookingWindow(selection.di, S.pitch, bookingStart + delta, S.dur).ok;
  const canBack = shiftFits(-30);
  const canForward = shiftFits(30);
  const hold = holdAtTime(selection.di, S.pitch, probeStart);
  const maintenance = blockAtTime(selection.di, S.pitch, probeStart);
  const rows = status === 'hold' ? [
      ['Booked via','Counter · walk-in'], ['Contact',hold?.contact || '—'], ['Format',pitch.sub],
      ['Hold expires', hold ? clock12(hold.expiresAt)
        + ` · ${Math.max(0, Math.ceil((hold.expiresAt - Date.now()) / 60000))} min left` : '—'],
      ['Amount',hold?money(priceFor(S.pitch,hold.start,hold.end)):'—'],
    ].concat(hold?.team ? [['Team',hold.team]] : []).concat(hold?.notes ? [['Notes',hold.notes]] : [])
    : status === 'blocked' ? [
      ['Reason',maintenance?.reason || 'Maintenance'], ['Blocked by',maintenance?.createdBy || 'Grounds team'],
      ['Logged',maintenance?.createdAt ? new Date(maintenance.createdAt).toLocaleString('en-IN') : '—'],
      ['Revenue at risk',maintenance?money(priceFor(S.pitch,maintenance.start,maintenance.end)):'—'],
    ] : [
      ['Rate',money(pitch.rate) + ' / hour'], ['Format',pitch.sub],
      ['Floodlights',needsFloodlights(bookingEnd) ? `Required (+${money(FLOODLIGHT_FEE)})` : 'Not needed'], ['Deposit',money(S.settings.depositAmount)],
    ];
  const primaryLabel = status === 'free' ? 'Book this slot' : status === 'hold' ? 'Confirm hold' : 'Reopen slot';

  const duration = status === 'free' ? `<div class="durbox">
    <div class="durbox-head is-first"><span class="dlabel" style="margin:0">Duration</span><span class="val">${slotRng12(bookingStart,bookingEnd)}</span></div>
    <div class="durbox-row"><button class="step" data-act="dur" data-v="-30" aria-label="Reduce duration by 30 minutes"${S.dur <= 30 ? ' disabled' : ''}>&minus;</button>
      <div class="mid"><b>${S.dur} min</b><small>${S.dur === 60 ? 'Standard hour' : 'Custom length · billed pro rata'}</small></div>
      <button class="step" data-act="dur" data-v="30" aria-label="Increase duration by 30 minutes"${S.dur >= 240 || !extendedCheck.ok ? ' disabled' : ''}>+</button></div>
    </div>` : '';

  const maintenanceBox = status === 'free' && can('manager') ? `<div style="margin-top:12px">
    <button class="block-toggle" data-act="toggle-block">${S.blockOpen ? 'Cancel maintenance block' : 'Block for maintenance'}</button>
    ${S.blockOpen ? `<div class="blockbox"><div class="blockbox-warn"><i></i><p>Blocking removes a sellable slot.
      Every block is logged to the owner audit trail against your name and reviewed weekly.</p></div>
      <label><span class="dlabel">Reason &mdash; written, min 15 characters</span>
        <textarea class="reason" id="b-reason" data-act="reason" placeholder="Describe the work and why this slot cannot be sold">${esc(S.blockReason)}</textarea></label>
      <div class="reason-count">${S.blockReason.trim().length} / 15</div>
      <button class="dbtn wide" data-act="block-confirm"${blockReady() ? '' : ' disabled'} style="margin-top:11px">Block slot</button>
      <button class="holdbtn" id="holdBtn" data-act="hold-block"${blockReady() ? '' : ' disabled'}>
        <span class="fill" id="holdFill"></span><span class="lbl" id="holdLbl">${blockReady()
          ? (S.holdPct > 0 ? 'Keep holding… ' + Math.round(S.holdPct) + '%' : 'Or press and hold 2s to block')
          : 'Write a reason to continue'}</span></button></div>` : ''}</div>` : '';

  return `<div class="panel" role="region" aria-label="Selected slot details"><div class="panel-head"><span class="tag ondark">${label(status)}</span>
    <button class="x" data-act="clear-sel" aria-label="Close slot details">&times;</button></div>
    <div class="sel-time${status === 'free' ? ' is-adjust' : ''}">${status === 'free'
      ? `<button class="tstep" data-act="sel-shift" data-v="back" aria-label="Move 30 minutes earlier"${canBack ? '' : ' disabled'}>&minus;</button>
        <span class="sel-time-txt">${slotRng12(bookingStart,bookingEnd)}</span>
        <button class="tstep" data-act="sel-shift" data-v="forward" aria-label="Move 30 minutes later"${canForward ? '' : ' disabled'}>+</button>`
      : status==='hold'&&hold?slotRng12(hold.start,hold.end):status==='blocked'&&maintenance?slotRng12(maintenance.start,maintenance.end):hourRng12(hour)}</div>
    <div class="sel-where">${DOWL[selection.di]}, ${date.getDate()} ${MON[date.getMonth()]} &middot; ${esc(pitch.name)} &middot; ${esc(pitch.sub)}</div>
    <div class="drule" style="margin:16px 0 4px"></div>
    ${rows.map(row => `<div class="drow"><span>${esc(row[0])}</span><b>${esc(row[1])}</b></div>`).join('')}
    ${duration}<div style="display:flex;gap:9px;margin-top:14px">
      <button class="dbtn primary" data-act="sel-primary"${status === 'free' && !windowCheck.ok ? ' disabled' : ''}>${primaryLabel}</button>
      ${status === 'free' && windowCheck.ok ? '<button class="dbtn" data-act="sel-hold">Hold slot</button>' : ''}
      ${status === 'hold' ? '<button class="dbtn" data-act="sel-release">Release hold</button>' : ''}</div>${maintenanceBox}</div>`;
}

export function formFieldsHtml(namespace){
  return [
    { k:'team',label:'Name / team · required',ph:'e.g. Northside FC' },
    { k:'contact',label:'Contact number · required',ph:'+91 ' },
    { k:'notes',label:'Notes (optional)',ph:'Bibs, coaching, floodlights…' },
  ].map(field => `<label class="dfield"><span class="dlabel">${field.label}</span>
    <input class="dinput" id="${namespace}-${field.k}" data-act="form-field" data-k="${field.k}"
      value="${esc(S.form[field.k])}" placeholder="${esc(field.ph)}"></label>`).join('');
}

function customPanelHtml(){
  const ready = S.cName.trim() && S.cPhone.trim().length >= 6, startOfWeek = weekStart();
  return `<div class="panel" role="region" aria-label="Custom time slot"><div class="panel-head"><b class="panel-title">Custom time slot</b>
    <button class="x" data-act="close-custom" aria-label="Close custom booking form">&times;</button></div>
    <span class="dlabel" style="margin-bottom:6px">Day</span><div style="display:flex;flex-wrap:wrap;gap:6px">
    ${DOW.map((day, index) => { const date = new Date(startOfWeek); date.setDate(date.getDate() + index); const active = S.cDay === index;
      return `<button data-act="c-day" data-v="${index}" style="height:34px;padding:0 12px;border-radius:11px;border:0;cursor:pointer;
        font:${active ? 700 : 600} 12.5px var(--sans);background:${active ? '#fff' : 'var(--field)'};
        color:${active ? '#16181C' : 'var(--d-muted)'}">${day} ${date.getDate()}</button>`; }).join('')}</div>
    <label style="display:block;margin-top:13px"><span class="dlabel">Start time</span>
      <input class="dinput time" id="c-start" type="time" step="1800" value="${esc(S.cStart)}" data-act="c-start"></label>
    <span class="dlabel" style="margin:13px 0 6px">Pitch</span><div class="optrow wide">${PITCHES.map((pitch, index) =>
      `<button class="${segCls(S.pitch === index, true)}" data-act="pitch" data-v="${index}" title="${esc(pitch.sub)}">${esc(pitch.name)}</button>`).join('')}</div>
    <span class="dlabel" style="margin:13px 0 6px">Duration</span><div class="optrow">${[60,90,120,150].map(duration =>
      `<button class="${segCls(S.cDur === duration,true)}" data-act="c-dur" data-v="${duration}">${duration < 120 ? duration + ' min'
        : Math.floor(duration / 60) + ' hr' + (duration % 60 ? ' 30' : '')}</button>`).join('')}</div>
    <div style="font:700 15px var(--sans);color:var(--lime);margin:13px 0 3px">${rng12(toMin(S.cStart),toMin(S.cStart)+S.cDur)}
      &middot; ${esc(PITCHES[S.pitch].name)}</div><div class="drule" style="margin:10px 0 13px"></div>
    <label class="dfield"><span class="dlabel">Name / team · required</span><input class="dinput" id="c-name" data-act="c-field"
      data-k="cName" value="${esc(S.cName)}" placeholder="e.g. Northside FC"></label>
    <label class="dfield"><span class="dlabel">Contact number · required</span><input class="dinput" id="c-phone" data-act="c-field"
      data-k="cPhone" value="${esc(S.cPhone)}" placeholder="+91 "></label>
    <span class="dlabel" style="margin:11px 0 6px">Payment status</span><div class="optrow">${PAY_FORM.map(option =>
      `<button class="${segCls(S.cPay === option,true)}" data-act="c-pay" data-v="${esc(option)}">${option}</button>`).join('')}</div>
    <button data-act="add-custom" style="width:100%;height:50px;border-radius:18px;border:0;margin-top:13px;background:var(--lime);
      color:#16181C;font:700 14.5px var(--sans);cursor:${ready ? 'pointer' : 'not-allowed'};opacity:${ready ? 1 : .45}">
      Confirm custom booking</button></div>`;
}

export const dateAddress = offset => {
  const absolute = TODAY_DI + offset;
  return { week:Math.floor(absolute / 7), di:((absolute % 7) + 7) % 7 };
};
const groupDateOptions = () => {
  const base = daysFromToday(S.weekOffset,S.dayIndex);
  return Array.from({length:14},(_,index) => {
    const offset = base + index, address = dateAddress(offset), date = dateAt(offset);
    return { offset,...address,date,check:bookingWindowAt(address.week,address.di,S.gPitch,toMin(S.gStart),S.gDur) };
  });
};
const groupChecks = () => S.gDates.map(offset => {
  const address = dateAddress(offset);
  return { offset,...address,check:bookingWindowAt(address.week,address.di,S.gPitch,toMin(S.gStart),S.gDur) };
});
export const groupValid = () => {
  const checks = groupChecks();
  return !!(S.gName.trim() && validContact(S.gPhone) && checks.length && checks.every(item => item.check.ok));
};

function groupPanelHtml(){
  const start = toMin(S.gStart), end = start + S.gDur, options = groupDateOptions(), checks = groupChecks();
  const conflicts = checks.filter(item => !item.check.ok), count = S.gDates.length;
  const perSession = priceFor(S.gPitch, start, end), total = perSession * count;
  const nameLabel = S.gType === 'Corporate' ? 'Company name' : 'Group name';
  return `<div class="panel group-panel" role="region" aria-label="Group booking"><div class="panel-head"><div><span class="modal-kicker">Multi-date booking</span>
    <b class="panel-title">Group booking</b></div><button class="x" data-act="close-group" aria-label="Close group booking form">&times;</button></div>
    <p class="group-intro">Reserve one time across several dates for a company or organised group.</p>
    <span class="dlabel">Booking type</span><div class="optrow group-type">${['Corporate','Group'].map(type =>
      `<button class="${segCls(S.gType===type,true)}" data-act="g-type" data-v="${type}">${type}</button>`).join('')}</div>
    <span class="dlabel group-label">Pitch</span><div class="optrow wide">${PITCHES.map((pitch,index) =>
      `<button class="${segCls(S.gPitch===index,true)}" data-act="g-pitch" data-v="${index}" title="${esc(pitch.sub)}">${esc(pitch.name)}</button>`).join('')}</div>
    <div class="group-time-row"><label><span class="dlabel">Start time</span><input class="dinput time" id="g-start" type="time"
      step="1800" value="${esc(S.gStart)}" data-act="g-start"></label><div><span class="dlabel">Duration</span>
      <div class="group-duration">${[60,90,120,180].map(duration => `<button class="${segCls(S.gDur===duration,true)}"
        data-act="g-dur" data-v="${duration}">${duration < 120 ? duration+'m' : duration/60+'h'}</button>`).join('')}</div></div></div>
    <div class="group-date-head"><span class="dlabel">Select dates · next 14 days</span>
      <button data-act="g-clear-dates"${count ? '' : ' disabled'}>Clear</button></div>
    <div class="group-dates">${options.map(option => { const selected=S.gDates.includes(option.offset), conflict=selected&&!option.check.ok,
      blocked=!option.check.ok&&!selected; return `<button class="group-date${selected?' on':''}${conflict?' conflict':''}${blocked?' unavailable':''}"
        data-act="g-date" data-v="${option.offset}" aria-pressed="${selected}" ${blocked?`disabled title="${esc(option.check.reason)}"`:''}>
        <span>${DOW[option.di]}</span><b>${option.date.getDate()} ${MON[option.date.getMonth()]}</b>
        <small>${conflict?'! Conflict':selected?'&#10003; Selected':blocked?'Unavailable':'Available'}</small></button>`; }).join('')}</div>
    <div class="group-summary${conflicts.length?' conflict':''}"><div><span>${count} session${count===1?'':'s'}</span>
      <b>${count?rng12(start,end):'Choose dates'}</b></div><strong>${count?money(total):'—'}</strong>
      ${conflicts.length?`<p>${conflicts.length} selected date${conflicts.length===1?'':'s'} no longer available.</p>`:''}</div>
    <div class="drule group-details"><label class="dfield"><span class="dlabel">${nameLabel} · required</span>
      <input class="dinput" id="g-name" data-act="g-field" data-k="gName" value="${esc(S.gName)}"></label>
      <label class="dfield"><span class="dlabel">Organizer contact · required</span><input class="dinput" id="g-phone"
        data-act="g-field" data-k="gPhone" value="${esc(S.gPhone)}" placeholder="+91 "></label>
      <label class="dfield"><span class="dlabel">Notes (optional)</span><input class="dinput" id="g-notes" data-act="g-field"
        data-k="gNotes" value="${esc(S.gNotes)}"></label>
      <span class="dlabel" style="margin:11px 0 6px">Payment status</span><div class="optrow wide">${PAY_FORM.map(option =>
        `<button class="${segCls(S.gPay===option,true)}" data-act="g-pay" data-v="${esc(option)}">${option}</button>`).join('')}</div></div>
    <button class="dbtn primary wide group-confirm" data-act="add-group"${groupValid()?'':' disabled'}>
      ${count?`Confirm ${count} booking${count===1?'':'s'} · ${money(total)}`:'Select dates to continue'}</button></div>`;
}

export function viewAvailability(){
  const allHours = hours(), startOfWeek = weekStart(), isDay = S.availMode === 'day';
  let free = 0, total = 0;
  for (let di=0;di<7;di++) for (let start=START_HOUR*60;start<END_HOUR*60;start+=60){
    total++;if(statusAtTime(di,S.pitch,start,start+60)==='free')free++;
  }
  const weekEnd = new Date(startOfWeek); weekEnd.setDate(weekEnd.getDate()+6);
  const weekLabel = startOfWeek.getDate()+' '+MON[startOfWeek.getMonth()]+' – '+weekEnd.getDate()+' '+MON[weekEnd.getMonth()];
  const tint = tintFor(S.pitch);
  /* Only the all-pitches board collapses, so every read of the flag is gated
     here rather than at each use — a stale `dense:true` cannot strand the
     one-pitch board. */
  const dense = isDay && S.dense;
  const days = DOW.map((dow,di) => { const date=new Date(startOfWeek);date.setDate(date.getDate()+di);let booked=0,count=0;
    for(let start=START_HOUR*60;start<END_HOUR*60;start+=60){count++;if(statusAtTime(di,S.pitch,start,start+60)!=='free')booked++;}
    return {dow,dayNum:date.getDate(),month:MON[date.getMonth()],load:Math.round(booked/count*100),today:S.weekOffset===0&&di===TODAY_DI}; });
  const pitchChips = `<div class="pitchpicker">${PITCHES.map((pitch,index)=>`<button class="${chipCls(index===S.pitch)}" data-act="pitch"
    data-v="${index}" aria-pressed="${index===S.pitch}" ${index===S.pitch||!S.showPitchColors?'':`style="background:${pitchColorFor(index)};border-color:${pitchColorFor(index)};color:#fff"`}>
    ${esc(pitch.name)}</button>`).join('')}</div>`;
  const weekGrid = `<div class="gridcard" data-scroll-pane="grid" style="${tintVars(tint)}"><div class="gridsticky"><div class="gridtop">${pitchChips}
    <span class="grid-soft push">${esc(PITCHES[S.pitch].sub)} &middot; ${free} of ${total} open this week</span></div>
    <div class="daystrip">${days.map((day, dayIndex)=>`<div><button type="button" class="dayhead${day.today?' today':''}"
      data-act="day-focus" data-v="${dayIndex}" aria-label="View ${day.dow} ${day.dayNum} across all pitches"><small>${day.dow}</small><b>${day.dayNum}</b>
      <span class="mon">${day.month}</span></button><div class="dayload"><i style="background:${day.load>=70?'var(--ink)':'var(--lime)'}"></i>${day.load}% full</div></div>`).join('')}</div></div>
    ${bandsHtml(buildBands(allHours,(hour,hi)=>days.map((_,di)=>slotHtml(di,hi,hour,S.pitch))),false,S.weekOffset===0)}</div>`;

  const di=S.dayIndex,dayDate=new Date(startOfWeek);dayDate.setDate(dayDate.getDate()+di);let dayFree=0,dayTotal=0;
  const pitchPct=PITCHES.map((_,index)=>{let booked=0,count=0;
    if(isDay)for(let start=START_HOUR*60;start<END_HOUR*60;start+=60){count++;if(statusAtTime(di,index,start,start+60)!=='free')booked++;}
    else for(let day=0;day<7;day++)for(let start=START_HOUR*60;start<END_HOUR*60;start+=60){count++;if(statusAtTime(day,index,start,start+60)!=='free')booked++;}
    return Math.round(booked/count*100);});
  const pitchOpen=PITCHES.map((_,pitch)=>{let count=0;for(let start=START_HOUR*60;start<END_HOUR*60;start+=60){
    dayTotal++;if(statusAtTime(di,pitch,start,start+60)==='free'){count++;dayFree++;}}return count;});
  const offsetNow=daysFromToday(S.weekOffset,di),relative=relDay(offsetNow);
  const jumps=Array.from({length:8},(_,offset)=>{const date=dateAt(offset);return {offset,on:offset===offsetNow,label:relDay(offset)||DOW[(date.getDay()+6)%7]+' '+date.getDate()};});
  const pitchCols=PITCHES.map((pitch,index)=>`<button type="button" class="pitchcol${index===S.pitch?' on':''}"
      data-act="pitch" data-v="${index}" style="${S.showPitchColors?`--col-accent:${pitchColorFor(index)}`:''}"
      title="${esc(pitch.name)} &middot; ${esc(pitch.sub)}"><span class="pitchcol-txt"><b>${esc(pitch.name)}</b>
      <span class="side">${esc(pitch.sub)}</span>
      <span class="open">${pitchOpen[index]} of ${allHours.length} open</span></span>${pitchDonut(pitchPct[index])}</button>`).join('');
  const dayGrid=`<div class="gridcard daycard${dense?' is-dense':''}" data-scroll-pane="grid" style="--cols:${PITCHES.length}"><div class="gridsticky">
    <div class="pitchstrip"><span class="hourlbl head">Time</span>${pitchCols}</div></div>
    ${dense ? denseGridHtml(di,offsetNow===0) : scheduleHtml(di,offsetNow===0)}</div>`;
  const pitchLoad=PITCHES.map((pitch,index)=>{const percent=pitchPct[index];
    return `<div class="loadrow"><div class="top"><span>${esc(pitch.name)}</span><b>${percent}%</b></div>
      <div class="track"><div class="fill" style="${hbar(percent)}"></div></div></div>`;}).join('');
  const loadCap=isDay?`Pitch load, ${DOW[di]} ${dayDate.getDate()}`:'Pitch load, this week';
  const asidePanel=!!(S.sel||S.customOpen||S.groupOpen);
  const asideBody=S.groupOpen?groupPanelHtml():S.customOpen?customPanelHtml():S.sel?selectionHtml()
    :'<div class="noselect"><b>No slot selected</b><p>Tap a time bubble to see the booking, confirm a hold, or block the slot for maintenance.</p></div>';
  /* One bar carries the whole board: where you are in time on the left, the days
     you can jump to in the middle, and what shape the board takes on the right.
     The page title and the colour legend that used to sit above it are gone —
     the view is named in the nav, and the fills are learned once, so both were
     costing a band of screen the board itself could use. */
  const dayLead = `<button class="rbtn round" data-act="day" data-v="-1" aria-label="Previous day">&#8592;</button>
    <label class="daypill"><span class="daypill-ico">${CAL_ICON}</span><span class="daypill-txt"><b>${relative||DOWL[di]}</b>
    <span>${DOW[di]}, ${dayDate.getDate()} ${MON[dayDate.getMonth()]} ${dayDate.getFullYear()}</span></span>
    <span class="daypill-chev">${CHEV_ICON}</span>
    <input type="date" value="${isoDate(dayDate)}" data-act="day-date" aria-label="Jump to date"></label>
    <button class="rbtn round" data-act="day" data-v="1" aria-label="Next day">&#8594;</button>`;
  const weekLead = `<button class="rbtn round" data-act="week" data-v="-1" aria-label="Previous week">&#8592;</button>
    <span class="daypill is-static"><span class="daypill-ico">${CAL_ICON}</span><span class="daypill-txt"><b>This week</b>
    <span>${weekLabel}</span></span></span>
    <button class="rbtn round" data-act="week" data-v="1" aria-label="Next week">&#8594;</button>`;
  const dayChips = isDay ? `<div class="dayjump">${jumps.map(jump=>`<button class="jchip${jump.on?' on':''}"
    data-act="day-jump" data-v="${jump.offset}">${jump.label}</button>`).join('')}</div>` : '';
  /* Collapsing is an all-pitches idea: three columns of one day is the scan that
     needs it. The one-pitch board stays a timeline and is not offered a switch
     it does not need. */
  const densitySeg = isDay ? `<div class="modeseg" role="group" aria-label="Board density">
    ${iconOpt('avail-dense','timeline',!dense,'timeline','Timeline')}
    ${iconOpt('avail-dense','compact',dense,'compact','Compact')}</div>` : '';
  return `<main class="avail"><section class="avail-main">
    <div class="boardbar"><div class="boardbar-lead">${isDay?dayLead:weekLead}</div>${dayChips}
    <div class="boardbar-end"><div class="modeseg" role="group" aria-label="Board scope">
    ${iconOpt('avail-mode','day',isDay,'day','All pitches')}
    ${iconOpt('avail-mode','week',!isDay,'week','One pitch')}</div>${densitySeg}
    <button class="pillbtn secondary" data-act="open-group">+ Group</button>
    <button class="pillbtn" data-act="open-custom">+ Custom<span class="pill-long"> time slot</span></button></div></div>
    ${isDay?dayGrid:weekGrid}</section><aside class="aside${asidePanel?' has-panel':''}">${asideBody}
    <div class="loadcard"><div class="cap">${loadCap}</div>${pitchLoad}</div>
    <p class="asidenote">${CAL_ICON}<span>${isDay?dayFree+' of '+dayTotal+' slots open on '+DOW[di]+' '+dayDate.getDate()
      :free+' of '+total+' slots open this week'} &middot; all times local</span></p></aside></main>`;
}
