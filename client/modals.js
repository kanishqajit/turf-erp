import { DOWL, MON, PAY_FORM, PAY_MODES, PITCHES } from './constants.js';
import { dateForAddress, durTxt, hours, nowMin, rng12, t12 } from './datetime.js';
import { bookingWindow, clampTimerAt, esc, money, priceFor, segCls, sessionById, timerCeil, timerFloor, validContact, weekStart } from './domain.js';
import { can, S } from './state.js';
import { refundDialogHtml } from './views/accounts.js';
import { formFieldsHtml } from './views/availability.js';
import { buildSessions, matchOptsHtml, payOptsHtml } from './views/sessions.js';

const confirmValid = () => S.form.team.trim().length > 0 && validContact(S.form.contact);

function confirmDialogHtml(){
  const selection=S.sel,mode=S.confirm;
  const isHold=mode==='hold',hour=hours()[selection.hi],probe=hour*60+S.startOffset;
  const held=mode==='confirm-hold'?S.holds.find(record=>record.date===dateForAddress(S.weekOffset,selection.di)
    &&record.pitch===S.pitch&&record.start<probe+30&&record.end>probe):null;
  const duration=held?held.end-held.start:S.dur,date=new Date(weekStart());date.setDate(date.getDate()+selection.di);
  const pitch=PITCHES[S.pitch],start=held?held.start:hour*60+S.startOffset;
  const windowCheck=mode==='book'?bookingWindow(selection.di,S.pitch,start,duration):{ok:true};
  const valid=(mode==='confirm-hold'||confirmValid())&&windowCheck.ok;
  return `<div class="backdrop"><div class="modal wide" role="dialog" aria-modal="true" aria-label="${isHold?'Confirm hold':mode==='confirm-hold'?'Convert hold to booking':'Confirm booking'}" tabindex="-1"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
    <span class="modal-kicker">${isHold?'Confirm hold':mode==='confirm-hold'?'Convert hold to booking':'Confirm booking'}</span>
    <button class="x" data-act="dlg-cancel" aria-label="Close confirmation">&times;</button></div><div class="plate"><div class="plate-kicker">You are confirming</div>
    <div class="plate-time">${rng12(start,start+duration)}</div><div class="plate-dur">${duration===60?'':duration+' min booking'}</div>
    <div class="plate-day">${DOWL[selection.di]}, ${date.getDate()} ${MON[date.getMonth()]} ${date.getFullYear()}</div><div class="plate-foot">
    <span>${esc(pitch.name)} &middot; ${esc(pitch.sub)}</span><b>${money(priceFor(S.pitch,start,start+duration))}</b></div></div>
    <p class="dnote">${isHold?'The slot is held for 20 minutes and stays off sale until you confirm or release it.':mode==='confirm-hold'
      ?'This converts the existing hold into a confirmed booking. Details already captured are kept.'
      :'Check the date and time above before confirming. Confirmed slots leave the sellable pool immediately.'}</p>
    ${mode!=='confirm-hold'?`<div class="drule" style="margin-top:16px;padding-top:14px">${formFieldsHtml('dlg')}
    <span class="dlabel" style="margin:12px 0 6px">Payment status</span><div class="optrow wide">${PAY_FORM.map(option=>
      `<button class="${segCls(S.form.pay===option,true)}" data-act="form-pay" data-v="${esc(option)}" style="height:40px;border-radius:13px">${option}</button>`).join('')}</div></div>`:''}
    <div style="display:flex;gap:9px;margin-top:18px"><button class="dbtn primary" data-act="dlg-confirm"
    style="border-radius:18px;font-size:15px;cursor:${valid?'pointer':'not-allowed'};opacity:${valid?1:.45}">${isHold?'Hold this slot':'Confirm booking'}</button>
    <button class="dbtn" data-act="dlg-cancel" style="border-radius:18px">Cancel</button></div></div></div>`;
}

/* ── starting the clock ──
   Pressing play is not the same question as when the session began. A team that
   walked on at 7:07 for a 7:00 slot can be given the clock from either minute,
   and only the person at the counter knows which. So the two minutes worth
   naming are offered outright, the plate states what is being started, and a
   one-minute nudge covers the case where neither preset is quite right.

   Everything reads off S.timerAt, which is already clamped to what the server
   will accept, so a bound the operator cannot cross is shown as a dead button
   rather than an error after the fact. */
function timerDialogHtml(){
  const session=sessionById(S.timerAsk),pitch=PITCHES[session.pitch];
  const now=Math.floor(nowMin()),at=clampTimerAt(session,S.timerAt==null?now:S.timerAt);
  const duration=session.end-session.start,ends=at+duration;
  const floor=timerFloor(session),ceil=timerCeil(session);
  const late=at-session.start,over=ends-session.end;
  /* Before the booked start there is no "from session start" to offer — that
     minute has not happened, and a clock cannot begin in the future. The option
     stays on the dialog stating the minute it would use, but dead, so the
     choice reads the same whichever side of the start time the team arrives. */
  const bookedReach=clampTimerAt(session,session.start)===session.start;
  const onBooked=bookedReach&&at===session.start,onNow=!onBooked&&at===clampTimerAt(session,now);
  const opt=(mode,label,minute,active,live=true)=>`<button class="${segCls(active,true)} timeropt${live?'':' is-off'}"
    data-act="timer-mode" data-v="${mode}"${live?'':' disabled'}><b>${label}</b><i>${t12(minute)}</i></button>`;
  const nudge=(delta,label,enabled)=>`<button class="dbtn timerstep" data-act="timer-nudge" data-v="${delta}"
    ${enabled?'':'disabled'} aria-label="${delta>0?'Start one minute later':'Start one minute earlier'}">${label}</button>`;
  return `<div class="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="Start match timer" tabindex="-1"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
    <span class="modal-kicker">Start match timer</span><button class="x" data-act="timer-cancel" aria-label="Close timer dialog">&times;</button></div><div class="plate">
    <div class="plate-kicker">Clock starts at</div><div class="plate-time">${t12(at)}</div>
    <div class="plate-dur">${durTxt(duration)} &middot; ends ${t12(ends)}</div>
    <div class="plate-day">${esc(session.team)}</div>
    <div class="plate-foot"><span>${esc(pitch.name)} &middot; ${esc(pitch.sub)}</span><b>${rng12(session.start,session.end)}</b></div></div>
    <span class="dlabel" style="margin:16px 0 6px">Run the clock from</span>
    <div class="optrow wide">${opt('now','Now',clampTimerAt(session,now),onNow)}${
      opt('booked','Session start',session.start,onBooked,bookedReach)}</div>
    <span class="dlabel" style="margin:14px 0 6px">Adjust by the minute</span>
    <div style="display:flex;align-items:center;gap:8px">${nudge(-1,'&minus;',at>floor)}
    <div class="timernow">${t12(at)}</div>
    ${nudge(1,'+',at<ceil)}</div>
    <p class="dnote">${late>0?'Team went on '+late+' min after the booked start, so the clock ends '+over+' min late at '+t12(ends)+'.'
      :late<0?'Starting '+(-late)+' min early. The clock runs its full '+durTxt(duration)+' and ends at '+t12(ends)+'.'
      :'The clock runs the booked slot exactly, ending at '+t12(ends)+'.'}</p><div class="stack">
    <button class="dbtn primary wide sm" data-act="timer-start">Start timer &middot; ${t12(at)}</button>
    <button class="dbtn ghost wide" data-act="timer-cancel" style="height:44px">Cancel</button></div></div></div>`;
}

function doneDialogHtml(){
  const session=sessionById(S.doneAsk),now=nowMin(),pitch=PITCHES[session.pitch];
  const outstanding=Math.max(0,session.amount-(session.discount||0)-(session.collected||0));
  const unpaid=session.pay!=='Payment done',early=Math.round(session.end-now);
  return `<div class="backdrop top"><div class="modal" role="dialog" aria-modal="true" aria-label="End this session" tabindex="-1"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
    <span class="modal-kicker">End this session?</span><button class="x" data-act="done-cancel" aria-label="Close end-session dialog">&times;</button></div><div class="plate">
    <div class="plate-kicker">Stopping at</div><div class="plate-time">${t12(now)}</div><div class="plate-day">${esc(session.team)}</div>
    <div class="plate-foot"><span>${esc(pitch.name)} &middot; ${esc(pitch.sub)}</span><b>${rng12(session.start,session.end)}</b></div></div>
    <p class="dnote">${early>0?'Ending '+early+' min before the booked end time. The timer stops now; the scheduled slot stays reserved.'
      :'Slot has run its full time. The timer stops now and the completed record remains in the ledger.'}</p>
    <div style="font:700 12.5px var(--sans);margin-top:10px;color:${unpaid?'var(--warn)':'var(--lime)'}">${unpaid
      ?money(outstanding)+' is still outstanding — the session stays in Happening now until you collect it.':'Payment already settled.'}</div>
    <div class="stack">${unpaid?'<button class="dbtn primary wide sm" data-act="done-collect">End and collect money</button>':''}
    <button class="dbtn wide xs" data-act="done-confirm">End session only</button><button class="dbtn ghost wide" data-act="done-cancel">Cancel</button></div></div></div>`;
}

function advanceDialogHtml(){
  const session=sessionById(S.advAsk),pitch=PITCHES[session.pitch],settle=S.advMode==='settle';
  const paid=session.collected||0,outstanding=Math.max(0,session.amount-(session.discount||0)-paid);
  /* Split: the amount is the two legs added up, so every check below — the
     balance line, the discount test, the save gate — reads one number whichever
     way the money came in. */
  const split=S.advPayMode==='Split';
  const cash=Math.max(0,parseInt(S.advCash,10)||0),upi=Math.max(0,parseInt(S.advUpi,10)||0);
  const value=split?cash+upi:Math.max(0,parseInt(S.advVal,10)||0);
  const discounting=settle&&value>0&&value<outstanding;
  const referenceOk=split?(upi===0||S.advReference.trim().length>=4)
    :(S.advPayMode==='Cash'||S.advReference.trim().length>=4);
  const canSave=value>0&&value<=outstanding&&referenceOk&&(!split||(cash>0&&upi>0))
    &&(!discounting||(can('manager')&&S.advReason.trim().length>=5));
  const balance=settle?(outstanding-value>0?money(outstanding-value)+' discount against '+money(outstanding)+' outstanding'
    :outstanding-value<0?money(value-outstanding)+' above the outstanding amount':'Settles in full, no discount')
    :money(Math.max(0,outstanding-value))+' balance due';
  const configuredDeposit=Math.min(S.settings.depositAmount,outstanding);
  const quickAmounts=settle?[Math.round(outstanding*.9),outstanding]:[configuredDeposit,Math.round(outstanding*.5),outstanding];
  const quick=[...new Set(quickAmounts.filter(amount=>amount>0&&amount<=outstanding))]
    .map(amount=>`<button class="${segCls(value===amount,true)}" data-act="adv-quick" data-v="${amount}" style="height:38px;border-radius:13px">
      ${amount===outstanding?'Full '+money(amount):!settle&&amount===configuredDeposit?'Deposit '+money(amount):(settle?'10% off · ':'')+money(amount)}</button>`).join('');
  /* ── nothing left to collect ──
     Then this sheet is not for taking money, it is for correcting it: a card
     marked paid in error, or paid in the wrong tender. The ledger is
     append-only, so the correction is a reversing entry against the mode it was
     taken in — which is also why the server caps it at what that mode actually
     holds. Manager only, and it has to say what happened. */
  if (settle && outstanding === 0 && paid > 0) return correctionDialogHtml(session, pitch, paid);

  return `<div class="backdrop over"><div class="modal" role="dialog" aria-modal="true" aria-label="${settle?'Record payment':'Advance received'}" tabindex="-1"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
    <span class="modal-kicker">${settle?'Record payment':'Advance received'}</span><button class="x" data-act="adv-cancel" aria-label="Close payment dialog">&times;</button></div>
    <div style="margin-top:12px"><b style="display:block;font:700 21px var(--sans)">${esc(session.team)}</b><span class="dsub">${esc(pitch.name)} &middot; ${esc(pitch.sub)} &middot; ${rng12(session.start,session.end)}
    &middot; total ${money(session.amount)}${paid?' · '+money(paid)+' already paid':''}</span></div>${split?`<div style="margin-top:14px;display:flex;gap:10px">
    <label style="flex:1 1 0;min-width:0"><span class="dlabel">Cash</span>
      <input class="dinput amount" id="adv-cash" data-act="adv-cash" value="${esc(S.advCash)}" placeholder="0"></label>
    <label style="flex:1 1 0;min-width:0"><span class="dlabel">UPI</span>
      <input class="dinput amount" id="adv-upi" data-act="adv-upi" value="${esc(S.advUpi)}" placeholder="0"></label></div>
    <div class="dsub" style="margin-top:8px">${value>0?money(value)+' collected now'
      :'Enter both parts of the tender'}</div>`
    :`<label style="display:block;margin-top:14px">
    <span class="dlabel">Amount collected now</span><input class="dinput amount" id="adv-val" data-act="adv-val" value="${esc(S.advVal)}" placeholder="0"></label>
    <div class="optrow" style="margin-top:9px">${quick}</div>`}<span class="dlabel" style="margin:14px 0 6px">Payment type</span>
    <div class="optrow">${[...PAY_MODES,'Split'].map(mode=>`<button class="${segCls(S.advPayMode===mode,true)}" data-act="adv-mode" data-v="${mode}"
    style="height:38px;border-radius:13px">${mode==='Split'?'Cash + UPI':mode}</button>`).join('')}</div>${(split?upi>0:S.advPayMode!=='Cash')?`<label style="display:block;margin-top:12px">
    <span class="dlabel">${split?'UPI':S.advPayMode} reference · required</span><input class="dinput" id="adv-reference" data-act="adv-reference"
    value="${esc(S.advReference)}" placeholder="Transaction or receipt reference"></label>`:''}${discounting?`<label style="display:block;margin-top:12px">
    <span class="dlabel">Discount reason · manager approval required</span><input class="dinput" id="adv-reason" data-act="adv-reason"
    value="${esc(S.advReason)}" placeholder="Why is the remaining ${money(outstanding-value)} being waived?"></label>`:''}
    <div style="font:700 14px var(--sans);margin-top:12px;color:${settle&&outstanding-value===0?'var(--lime)':'var(--warn)'}">${balance}</div>
    <div style="display:flex;gap:9px;margin-top:16px"><button class="dbtn primary sm" data-act="adv-save" ${canSave?'':'disabled'}
    style="cursor:${canSave?'pointer':'not-allowed'};opacity:${canSave?1:.45}">${settle?'Mark paid':'Save advance'}</button>
    <button class="dbtn sm" data-act="adv-cancel">Cancel</button></div></div></div>`;
}

function actionDialogHtml(){
  const ask=S.actionAsk;
  const bookingNote=ask.kind==='booking' ? '<p class="dnote" style="margin-top:10px">Release only reopens the slot. Refunds and account clearing are handled in Accounts before this step.</p>' : '';
  return `<div class="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(ask.title)}" tabindex="-1"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
    <span class="modal-kicker">${esc(ask.title)}</span><button class="x" data-act="action-cancel" aria-label="Close action dialog">&times;</button></div>
    <h2 class="h2 sm" style="margin-top:14px">${esc(ask.subject||'Confirm this change')}</h2><p class="dnote">This action changes operational state and will be written to the audit log against your account.</p>
    ${bookingNote}<label style="display:block;margin-top:14px"><span class="dlabel">Reason · required</span><textarea class="reason" id="action-reason" data-act="action-reason"
    placeholder="Describe why this change is needed">${esc(S.actionReason)}</textarea></label><div style="display:flex;gap:9px;margin-top:16px">
    <button class="dbtn primary sm" data-act="action-confirm"${S.actionReason.trim().length<5?' disabled':''}>Confirm</button>
    <button class="dbtn sm" data-act="action-cancel">Cancel</button></div></div></div>`;
}

function staffDialogHtml(){
  const ask=S.staffAsk;if(!ask)return '';
  const labels={activate:'Activate staff account',deactivate:'Deactivate staff account',revoke:'Revoke staff sessions'};
  return `<div class="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(labels[ask.kind])}" tabindex="-1">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><span class="modal-kicker">Owner approval</span>
    <button class="x" data-act="staff-cancel" aria-label="Close staff action">&times;</button></div>
    <h2 class="h2 sm" style="margin-top:14px">${esc(labels[ask.kind])}</h2><p class="dnote">${esc(ask.name)} · this access change is immediate and audited.</p>
    <label style="display:block;margin-top:14px"><span class="dlabel">Reason · required</span><textarea class="reason" data-act="staff-reason" placeholder="Why is this access change needed?">${esc(S.staffReason)}</textarea></label>
    <div style="display:flex;gap:9px;margin-top:16px"><button class="dbtn primary sm" data-act="staff-confirm"${S.staffReason.trim().length<5?' disabled':''}>Confirm</button>
    <button class="dbtn sm" data-act="staff-cancel">Cancel</button></div></div></div>`;
}

function blockDialogHtml(){
  const card=buildSessions().find(item=>item.id===S.blockDetail);
  if(!card)return '';
  const session=card.raw,pitch=PITCHES[session.pitch];
  const rows=[['Booked via',session.source==='app'?'Turf app · online':'Counter · walk-in'],['Contact',session.contact],
    ['Amount',money(session.amount)],['Payment',card.payLabel]].concat(card.running?[['Played',durTxt(Math.max(0,nowMin()-(session.startedAt||session.start)))]]:[]);
  return `<div class="backdrop"><div class="modal detail" role="dialog" aria-modal="true" aria-label="Session details" tabindex="-1"><div class="detail-top"><div><div class="detail-time">${card.range}</div>
    <div class="sel-where">${esc(card.team)} &middot; ${esc(pitch.name)} &middot; ${esc(pitch.sub)}</div></div>
    <button class="x" data-act="block-close" aria-label="Close session details">&times;</button></div><div class="detail-status"><span class="tag ondark">${card.statusLabel}</span>
    <span class="dsub">${card.clock}</span></div>${card.running?`<div class="strack"><div class="fill${card.over?' over':''}" style="width:${card.pct}%"></div></div>`:''}
    ${rows.map(row=>`<div class="drow"><span>${esc(row[0])}</span><b>${esc(row[1])}</b></div>`).join('')}<span class="dlabel">Match</span>
    ${matchOptsHtml(card,true)}<span class="dlabel">Payment</span>${payOptsHtml(card,true)}<div class="detail-acts">
    ${card.running?`<button class="dbtn sm" data-act="plus30" data-id="${card.id}">+30 min</button>`:''}
    <button class="dbtn primary sm" data-act="block-focus" data-id="${card.id}">Show in list</button></div></div></div>`;
}

export function modalsHtml(){
  let output='';
  if(S.blockDetail!=null&&sessionById(S.blockDetail))output+=blockDialogHtml();
  if(S.sel&&S.confirm)output+=confirmDialogHtml();
  if(S.timerAsk!=null&&sessionById(S.timerAsk))output+=timerDialogHtml();
  if(S.advAsk!=null&&sessionById(S.advAsk))output+=advanceDialogHtml();
  if(S.refundAsk!=null)output+=refundDialogHtml();
  if(S.doneAsk!=null&&sessionById(S.doneAsk))output+=doneDialogHtml();
  if(S.actionAsk)output+=actionDialogHtml();
  if(S.staffAsk)output+=staffDialogHtml();
  return output;
}

function correctionDialogHtml(session, pitch, paid){
  const byMode = session.collectedByMode || {};
  const mode = S.advPayMode === 'Split' ? 'Cash' : S.advPayMode;
  const inMode = Number(byMode[mode] || 0);
  const value = Math.max(0, parseInt(S.advVal, 10) || 0);
  const reasonOk = S.advReason.trim().length >= 5;
  /* A reversal off a card or a UPI line has to name the transaction it reverses,
     exactly as taking the money did — the server requires it either way. */
  const referenceOk = mode === 'Cash' || S.advReference.trim().length >= 4;
  const canSave = can('manager') && value > 0 && value <= inMode && reasonOk && referenceOk;
  const taken = PAY_MODES.filter(m => Number(byMode[m] || 0) > 0);
  return `<div class="backdrop over"><div class="modal" role="dialog" aria-modal="true" aria-label="Edit payment" tabindex="-1">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
    <span class="modal-kicker">Edit payment</span><button class="x" data-act="adv-cancel" aria-label="Close payment dialog">&times;</button></div>
    <div style="margin-top:12px"><b style="display:block;font:700 21px var(--sans)">${esc(session.team)}</b>
    <span class="dsub">${esc(pitch.name)} &middot; ${rng12(session.start,session.end)} &middot; ${money(paid)} collected, nothing outstanding</span></div>
    <span class="dlabel" style="margin:14px 0 6px">Recorded</span>
    <dl class="rows">${taken.map(m => `<div><dt>${m}</dt><dd class="v is-money">${money(byMode[m])}</dd></div>`).join('')}</dl>
    <span class="dlabel" style="margin:14px 0 6px">Reverse from</span>
    <div class="optrow">${taken.map(m => `<button class="${segCls(mode===m,true)}" data-act="adv-mode" data-v="${m}"
      style="height:38px;border-radius:13px">${m} &middot; ${money(byMode[m])}</button>`).join('')}</div>
    <label style="display:block;margin-top:12px"><span class="dlabel">Amount to reverse</span>
    <input class="dinput amount" id="adv-val" data-act="adv-val" value="${esc(S.advVal)}" placeholder="0"></label>
    <div class="optrow" style="margin-top:9px"><button class="${segCls(value===inMode,true)}" data-act="adv-quick" data-v="${inMode}"
      style="height:38px;border-radius:13px">All ${money(inMode)}</button></div>
    ${mode==='Cash'?'':`<label style="display:block;margin-top:12px">
    <span class="dlabel">${mode} reference &middot; required</span>
    <input class="dinput" id="adv-reference" data-act="adv-reference" value="${esc(S.advReference)}"
    placeholder="Transaction being reversed"></label>`}
    <label style="display:block;margin-top:12px"><span class="dlabel">What happened &middot; required</span>
    <input class="dinput" id="adv-reason" data-act="adv-reason" value="${esc(S.advReason)}"
    placeholder="e.g. recorded against the wrong booking"></label>
    <div style="font:700 14px var(--sans);margin-top:12px;color:${value>inMode?'var(--red)':'var(--warn)'}">${
      value>inMode?'Only '+money(inMode)+' was taken in '+mode
      :value>0?money(value)+' comes off '+mode+', leaving '+money(paid-value)+' collected'
      :'This writes a reversing entry to the ledger'}</div>
    ${can('manager')?'':`<div class="dsub" style="margin-top:8px;color:var(--warn)">A manager has to make this correction.</div>`}
    <div style="display:flex;gap:9px;margin-top:16px"><button class="dbtn primary sm" data-act="adv-correct" ${canSave?'':'disabled'}
    style="cursor:${canSave?'pointer':'not-allowed'};opacity:${canSave?1:.45}">Correct payment</button>
    <button class="dbtn sm" data-act="adv-cancel">Cancel</button></div></div></div>`;
}
