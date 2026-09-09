import { END_HOUR, NEUTRAL_TINT, PITCH_DEFAULT_HEX, PITCHES, START_HOUR } from './constants.js';
import { dateForAddress, hourRng12, hours, isoDate, nowMin, rng12, t12, TODAY, weekStartAt } from './datetime.js';
import { S } from './state.js';

export const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g,
  char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const money = value => '₹' + Math.round(value).toLocaleString('en-IN');

/* ── what a slot costs ──
   The same arithmetic the server bills by (store.mjs priceFor). It was written
   out at four separate call sites, so changing the floodlight fee meant finding
   all four or quoting a customer a price the server would not charge. Quoted
   money and billed money have to come from one rule.

   The constants still exist twice — here and in store.mjs — because only the
   deposit is configurable today. If the fee ever becomes a venue setting, this
   should read it rather than hold its own copy. */
/* ── how a payment was verified ──
   Money is confirmed face to face at this venue: whoever takes it watches it
   land rather than copying a transaction id off the payer's phone, so no
   dialog asks for one. The server still wants a reference on anything that is
   not cash, and the ledger gets a truthful account of the check that actually
   happened instead of a number nobody typed. Change this and the accounts
   view's history changes with it — it is the only thing distinguishing a
   face-to-face collection from an imported one. */
export const inPersonRef = () => 'In person · '
  + ((S.user && (S.user.name || S.user.email)) || 'staff');

export const FLOODLIGHT_FROM = 18 * 60;
export const FLOODLIGHT_FEE = 300;
export const needsFloodlights = end => end > FLOODLIGHT_FROM;
export const priceFor = (pitch, start, end) =>
  Math.round(PITCHES[pitch].rate * (end - start) / 60 + (needsFloodlights(end) ? FLOODLIGHT_FEE : 0));
export const weekStart = () => weekStartAt(S.weekOffset);
export function goToDayOffset(offset){
  const absolute = (TODAY.getDay() + 6) % 7 + offset;
  S.weekOffset = Math.floor(absolute / 7);
  S.dayIndex = ((absolute % 7) + 7) % 7;
  S.sel = null;
}

export const pitchColorFor = pitch => S.pitchColors[pitch] || PITCH_DEFAULT_HEX[pitch];
function readableFg(hex){
  const value = parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255, green = (value >> 8) & 255, blue = value & 255;
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 > 0.55 ? '#16181C' : '#FFFFFF';
}
function buildTint(hex){
  const fg = readableFg(hex);
  return { bg:hex, line:hex, fg, soft:fg === '#FFFFFF' ? 'rgba(255,255,255,.72)' : 'rgba(22,24,28,.62)',
    chip:'#FFF44F', chipFg:'#16181C' };
}
export const tintFor = pitch => S.showPitchColors ? buildTint(pitchColorFor(pitch)) : NEUTRAL_TINT;
export const tintVars = tint => `--tint-bg:${tint.bg};--tint-line:${tint.line};--tint-fg:${tint.fg};`
  + `--tint-soft:${tint.soft};--tint-chip:${tint.chip};--tint-chip-fg:${tint.chipFg}`;

export const overlaps = (record, date, pitch, start, end) => record.date === date && record.pitch === pitch
  && record.start < end && record.end > start;
export const bookingAt = (di, hi, pitch, week = S.weekOffset) => {
  const start = hours()[hi] * 60;
  return bookingAtTime(di, pitch, start, start + 60, week);
};
export const holdAt = (di, hi, pitch, week = S.weekOffset) => {
  const start = hours()[hi] * 60;
  return holdAtTime(di, pitch, start, start + 60, week);
};
export const blockAt = (di, hi, pitch, week = S.weekOffset) => {
  const start = hours()[hi] * 60;
  return blockAtTime(di, pitch, start, start + 60, week);
};
export const bookingAtTime = (di, pitch, start, end = start + 30, week = S.weekOffset) => {
  const date = dateForAddress(week, di);
  return S.bookings.find(record => record.status !== 'noshow' && record.status !== 'cancelled'
    && overlaps(record, date, pitch, start, end));
};
export const holdAtTime = (di, pitch, start, end = start + 30, week = S.weekOffset) => {
  const date = dateForAddress(week, di);
  return S.holds.find(record => record.expiresAt > Date.now() && overlaps(record, date, pitch, start, end));
};
export const blockAtTime = (di, pitch, start, end = start + 30, week = S.weekOffset) => {
  const date = dateForAddress(week, di);
  return S.blocks.find(record => overlaps(record, date, pitch, start, end));
};
export function statusFor(di, hi, pitch, week = S.weekOffset){
  if (bookingAt(di, hi, pitch, week)) return 'booked';
  if (holdAt(di, hi, pitch, week)) return 'hold';
  if (blockAt(di, hi, pitch, week)) return 'blocked';
  return 'free';
}
export function statusAtTime(di, pitch, start, end = start + 30, week = S.weekOffset){
  if (bookingAtTime(di, pitch, start, end, week)) return 'booked';
  if (holdAtTime(di, pitch, start, end, week)) return 'hold';
  if (blockAtTime(di, pitch, start, end, week)) return 'blocked';
  return 'free';
}
export const sourceFor = (di, hi, pitch, week = S.weekOffset) => bookingAt(di, hi, pitch, week)?.source || 'counter';
export const label = status => ({ free:'Open', booked:'Booked', hold:'On hold', blocked:'Maintenance' }[status]);

export function coverage(pitch, di, hour, week = S.weekOffset){
  let startFraction = 1, endFraction = 0, hit = null;
  const date = dateForAddress(week, di);
  for (const booking of S.bookings){
    if (booking.pitch !== pitch || booking.date !== date || ['noshow','cancelled'].includes(booking.status)) continue;
    const start = Math.max(booking.start, hour * 60), end = Math.min(booking.end, (hour + 1) * 60);
    if (end > start){
      startFraction = Math.min(startFraction, (start - hour * 60) / 60);
      endFraction = Math.max(endFraction, (end - hour * 60) / 60);
      hit = booking;
    }
  }
  return hit ? { s:startFraction * 100, e:endFraction * 100, c:hit } : null;
}

export function bookingWindowAt(week, di, pitch, start, duration){
  const end = start + duration;
  if (start < START_HOUR * 60 || end > END_HOUR * 60)
    return { ok:false, reason:`Extends past the ${t12(END_HOUR * 60)} closing time.` };
  const date = dateForAddress(week, di);
  const booking = S.bookings.find(record => !['noshow','cancelled'].includes(record.status)
    && overlaps(record, date, pitch, start, end));
  if (booking) return { ok:false, reason:`Overlaps ${booking.team} at ${rng12(booking.start, booking.end)}.` };
  const hold = S.holds.find(record => record.expiresAt > Date.now() && overlaps(record, date, pitch, start, end));
  if (hold) return { ok:false, reason:`Overlaps an active hold at ${rng12(hold.start, hold.end)}.` };
  const block = S.blocks.find(record => overlaps(record, date, pitch, start, end));
  if (block) return { ok:false, reason:`Overlaps maintenance at ${rng12(block.start, block.end)}.` };
  return { ok:true, reason:'Available for the full booking.' };
}
export const bookingWindow = (di, pitch, start, duration) => bookingWindowAt(S.weekOffset, di, pitch, start, duration);

export const sessionsToday = () => S.bookings.filter(record => record.date === isoDate(TODAY));
export const bookingById = id => S.bookings.find(booking => booking.id === id);
export const sessionById = id => bookingById(id) || S.accounts.find(booking => booking.id === id);
export const validContact = value => {
  const text = String(value || '').trim();
  const digits = text.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 && /^[+\d][\d\s().-]*$/.test(text);
};
/* ── when the clock may be said to have started ──
   The origin an operator can give the timer, bounded the way the server bounds
   it: a quarter hour of grace before the booked start, never past the booked
   end, and never later than now — a session cannot begin in the future. Both
   the dialog and the action clamp through this, so the buttons can never offer
   a minute the server will refuse. */
export const timerFloor = session => session.start - 15;
export const timerCeil = session => Math.min(Math.floor(nowMin()), session.end - 1);
export const clampTimerAt = (session, minute) =>
  Math.max(timerFloor(session), Math.min(timerCeil(session), Math.round(minute)));

export const outstandingFor = session => Math.max(0, session.amount - (session.discount || 0) - (session.collected || 0));
export const collectTotal = () => sessionsToday().filter(session => session.pay !== 'Payment done' && session.status !== 'noshow')
  .reduce((total, session) => total + outstandingFor(session), 0);

const barFill = percent => percent >= 75 ? 'var(--ink)' : percent >= 50 ? 'var(--lime)' : 'var(--lime-tint)';
export const vbar = percent => `height:${Math.max(percent,3)}%;background:${barFill(percent)}`;
export const hbar = percent => `width:${Math.max(percent,3)}%;background:${barFill(percent)}`;
export const chipCls = active => 'chip' + (active ? ' on' : '');
export const segCls = (active, dark) => 'seg-opt' + (dark ? ' dark' : '') + (active ? ' on' : '');
