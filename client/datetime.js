import { DAY_START, END_HOUR, SPAN, START_HOUR } from './constants.js';

export const midnight = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
export const TODAY = midnight(new Date());
export const TODAY_DI = (TODAY.getDay() + 6) % 7;
export const WEEK_ZERO = new Date(TODAY);
WEEK_ZERO.setDate(WEEK_ZERO.getDate() - TODAY_DI);

/* Every clock-dependent thing on the board — the now-line, the arrival window,
   the countdowns, which slots count as past — reads the time through here, so
   overriding this one function moves all of them together and nothing can
   disagree about what time it is.

   Local development only: on any other host the override is ignored outright,
   so it cannot ship a fake clock to a real venue. Set it from the console with
   localStorage['turf-erp:clock'] = '18:20', clear it with removeItem. */
const clockOverride = () => {
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return null;
  let raw = null;
  try { raw = localStorage.getItem('turf-erp:clock'); } catch { return null; }
  if (!raw) return null;
  const [hour, minute] = String(raw).split(':').map(Number);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return hour * 60 + (Number.isFinite(minute) ? minute : 0);
};
export const nowMin = () => {
  const forced = clockOverride();
  if (forced != null) return forced;
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60 + now.getMilliseconds() / 60000;
};
export const toMin = value => {
  const parts = String(value).split(':');
  return Number(parts[0]) * 60 + (Number(parts[1]) || 0);
};
export function t12(minute){
  const value = Math.floor(minute), hour = Math.floor(value / 60) % 24, mins = value % 60;
  return (hour % 12 === 0 ? 12 : hour % 12) + ':' + String(mins).padStart(2, '0') + ' ' + (hour < 12 ? 'AM' : 'PM');
}
function compactParts(minute){
  const value = Math.floor(minute), hour = Math.floor(value / 60) % 24, mins = value % 60;
  return {
    hour:hour % 12 === 0 ? 12 : hour % 12,
    mins,
    period:hour < 12 ? 'AM' : 'PM',
  };
}
function compactTime(minute, showPeriod){
  const parts = compactParts(minute);
  return parts.hour + (parts.mins ? ':' + String(parts.mins).padStart(2, '0') : '')
    + (showPeriod ? ' ' + parts.period : '');
}
export function rng12(start, end){
  const startParts = compactParts(start), endParts = compactParts(end);
  const samePeriod = startParts.period === endParts.period;
  return compactTime(start, !samePeriod) + ' to ' + compactTime(end, true);
}
export function slotRng12(start, end){
  const startParts = compactParts(start), endParts = compactParts(end);
  const samePeriod = startParts.period === endParts.period;
  const compact = value => value.replace(' ', '');
  return compact(compactTime(start, !samePeriod)) + '–' + compact(compactTime(end, true));
}
export const hourT12 = hour => t12(hour * 60);
export const hourRng12 = hour => slotRng12(hour * 60, (hour + 1) * 60);
export const clock12 = value => {
  const date = new Date(value);
  return t12(date.getHours() * 60 + date.getMinutes());
};
export const hours = () => Array.from({ length:END_HOUR - START_HOUR }, (_, index) => START_HOUR + index);
export const durTxt = minutes => Math.floor(minutes / 60) + 'h ' + String(Math.abs(Math.round(minutes % 60))).padStart(2,'0') + 'm';
export const pos = minute => Math.max(0, Math.min(100, ((minute - DAY_START) / SPAN) * 100));

export const isoDate = date => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0')
  + '-' + String(date.getDate()).padStart(2, '0');
export const weekStartAt = weekOffset => {
  const date = new Date(WEEK_ZERO);
  date.setDate(date.getDate() + weekOffset * 7);
  return date;
};
export const dateAt = offset => {
  const date = new Date(TODAY);
  date.setDate(date.getDate() + offset);
  return date;
};
export const daysFromToday = (weekOffset, dayIndex) => weekOffset * 7 + dayIndex - TODAY_DI;
export const relDay = offset => offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday' : null;
export const dayOffsetOf = date => Math.round((midnight(date) - midnight(TODAY)) / 86400000);
export const dateForAddress = (week, dayIndex) => {
  const date = new Date(WEEK_ZERO);
  date.setDate(date.getDate() + week * 7 + dayIndex);
  return isoDate(date);
};
export const addressForDayOffset = offset => {
  const absolute = TODAY_DI + offset;
  return { week:Math.floor(absolute / 7), di:((absolute % 7) + 7) % 7 };
};
