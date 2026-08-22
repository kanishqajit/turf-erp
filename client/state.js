import { TODAY_DI } from './datetime.js';

export const blankForm = () => ({ team:'', contact:'', notes:'', pay:'Payment at venue' });

export const S = {
  ready:false, busy:false, user:null, csrf:'', authError:'', apiError:'', lastSyncedAt:0,
  bookings:[], holds:[], blocks:[], audit:[], accounts:[], paymentEvents:[], users:[], auditError:'',
  settings:{ depositAmount:500 }, depositDraft:'500', depositDirty:false,
  view:'availability', pitch:0, weekOffset:0, dayIndex:TODAY_DI, sessionsMode:'now',
  showPitchColors:false, pitchColors:{}, colorPickerOpen:null, collapsedBands:{},
  availMode:'day', sel:null, dense:false, checkedIn:{}, theme:'light',
  formOpen:false, form:blankForm(), blockOpen:false, blockReason:'', holdPct:0,
  confirm:null, dur:60, startOffset:0,
  focusSession:null, timerAsk:null, timerAt:null, doneAsk:null, blockDetail:null,
  advAsk:null, advVal:'', advMode:'advance', advPayMode:'Cash', advReason:'', advReference:'',
  advCash:'', advUpi:'',
  accountFocus:null, accountHistory:null, accountSearch:'', accountStatus:'open', accountFrom:'', accountTo:'',
  refundAsk:null, refundVal:'', refundPayMode:'Cash', refundReason:'', refundReference:'',
  pendingKeys:{},
  actionAsk:null, actionReason:'',
  staffAsk:null, staffReason:'',
  newName:'', newEmail:'', newRole:'operator', newPassword:'',
  currentPassword:'', replacementPassword:'', confirmPassword:'', passwordError:'',
  customOpen:false, cDay:TODAY_DI, cStart:'17:30', cDur:60, cName:'', cPhone:'', cPay:'Payment at venue',
  groupOpen:false, gType:'Corporate', gPitch:0, gStart:'11:00', gDur:90,
  gDates:[], gName:'', gPhone:'', gNotes:'', gPay:'Payment at venue',
};

const ROLE_LEVEL = { operator:1, manager:2, owner:3 };
export const can = role => (ROLE_LEVEL[S.user?.role] || 0) >= ROLE_LEVEL[role];
export const staffInitials = () => (S.user?.name || '?').split(/\s+/).filter(Boolean).slice(0,2)
  .map(part => part[0]).join('').toUpperCase();

export function savePrefs(){
  try {
    localStorage.setItem('turf-erp:prefs', JSON.stringify({
      showPitchColors:S.showPitchColors, pitchColors:S.pitchColors, collapsedBands:S.collapsedBands,
      dense:S.dense, checkedIn:S.checkedIn, theme:S.theme, availMode:S.availMode,
    }));
  } catch (_) {}
}

/* Written to the document root so it covers the page itself — the chrome
   outside any view — and so a reload can restore it before the first paint. */
export function applyTheme(){
  document.documentElement.dataset.theme = S.theme === 'dark' ? 'dark' : 'light';
}

export function loadPrefs(){
  try {
    const prefs = JSON.parse(localStorage.getItem('turf-erp:prefs') || '{}');
    if (typeof prefs.showPitchColors === 'boolean') S.showPitchColors = prefs.showPitchColors;
    if (prefs.pitchColors && typeof prefs.pitchColors === 'object') S.pitchColors = prefs.pitchColors;
    if (prefs.collapsedBands && typeof prefs.collapsedBands === 'object') S.collapsedBands = prefs.collapsedBands;
    if (typeof prefs.dense === 'boolean') S.dense = prefs.dense;
    /* Which board you were on is a working preference like any other: a console
       left on one pitch should come back on one pitch after a reload. */
    if (prefs.availMode === 'day' || prefs.availMode === 'week') S.availMode = prefs.availMode;
    if (prefs.theme === 'dark' || prefs.theme === 'light') S.theme = prefs.theme;
    /* Check-in has no server-side status behind it, so it lives here and is
       dropped once it is a day old — a stale arrival flag on tomorrow's board
       would be worse than none. */
    if (prefs.checkedIn && typeof prefs.checkedIn === 'object'){
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      S.checkedIn = Object.fromEntries(Object.entries(prefs.checkedIn).filter(([, at]) => at > cutoff));
    }
  } catch (_) {}
}
