import { TODAY_DI } from './datetime.js';

export const blankForm = () => ({ team:'', contact:'', notes:'', pay:'Payment at venue' });

export const S = {
  ready:false, busy:false, user:null, csrf:'', authError:'', apiError:'',
  bookings:[], holds:[], blocks:[], audit:[],
  settings:{ depositAmount:500 }, depositDraft:'500', depositDirty:false,
  view:'availability', pitch:0, weekOffset:0, dayIndex:TODAY_DI, sessionsMode:'now',
  showPitchColors:false, pitchColors:{}, colorPickerOpen:null, collapsedBands:{},
  availMode:'day', sel:null,
  formOpen:false, form:blankForm(), blockOpen:false, blockReason:'', holdPct:0,
  confirm:null, dur:60, startOffset:0,
  focusSession:null, timerAsk:null, doneAsk:null, blockDetail:null,
  advAsk:null, advVal:'', advMode:'advance', advPayMode:'Cash', advReason:'',
  actionAsk:null, actionReason:'',
  newName:'', newEmail:'', newRole:'operator', newPassword:'',
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
    }));
  } catch (_) {}
}

export function loadPrefs(){
  try {
    const prefs = JSON.parse(localStorage.getItem('turf-erp:prefs') || '{}');
    if (typeof prefs.showPitchColors === 'boolean') S.showPitchColors = prefs.showPitchColors;
    if (prefs.pitchColors && typeof prefs.pitchColors === 'object') S.pitchColors = prefs.pitchColors;
    if (prefs.collapsedBands && typeof prefs.collapsedBands === 'object') S.collapsedBands = prefs.collapsedBands;
  } catch (_) {}
}
