import { DOWL, MON, PAY_FORM, PAY_MODES, PITCHES } from './constants.js';
import { durTxt, hours, nowMin, rng12, t12 } from './datetime.js';
import { bookingWindow, esc, money, segCls, sessionById, weekStart } from './domain.js';
import { can, S } from './state.js';
import { formFieldsHtml } from './views/availability.js';
import { buildSessions, matchOptsHtml, payOptsHtml } from './views/sessions.js';

const confirmValid = () => S.form.team.trim().length > 0 && S.form.contact.trim().length >= 6;

function confirmDialogHtml(){
  const selection=S.sel,mode=S.confirm;
  const isHold=mode==='hold',duration=mode==='confirm-hold'?60:S.dur,hour=hours()[selection.hi],date=new Date(weekStart());date.setDate(date.getDate()+selection.di);
  const pitch=PITCHES[S.pitch],start=mode==='confirm-hold'?hour*60:hour*60+S.startOffset;
  const windowCheck=mode==='book'?bookingWindow(selection.di,S.pitch,start,duration):{ok:true};
  const valid=(mode==='confirm-hold'||confirmValid())&&windowCheck.ok;
  return `<div class="backdrop"><div class="modal wide"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
    <span class="modal-kicker">${isHold?'Confirm hold':mode==='confirm-hold'?'Convert hold to booking':'Confirm booking'}</span>
    <button class="x" data-act="dlg-cancel">&times;</button></div><div class="plate"><div class="plate-kicker">You are confirming</div>
    <div class="plate-time">${rng12(start,start+duration)}</div><div class="plate-dur">${duration===60?'':duration+' min booking'}</div>
    <div class="plate-day">${DOWL[selection.di]}, ${date.getDate()} ${MON[date.getMonth()]} ${date.getFullYear()}</div><div class="plate-foot">
    <span>${esc(pitch.name)} &middot; ${esc(pitch.sub)}</span><b>${money(pitch.rate*duration/60+(start+duration>18*60?300:0))}</b></div></div>
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

function timerDialogHtml(){
  const session=sessionById(S.timerAsk),now=nowMin(),pitch=PITCHES[session.pitch],late=Math.round(now-session.start);
  return `<div class="backdrop"><div class="modal"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
    <span class="modal-kicker">Start match timer</span><button class="x" data-act="timer-cancel">&times;</button></div><div class="plate">
    <div class="plate-kicker">Clock now</div><div class="plate-time">${t12(now)}</div><div class="plate-day">${esc(session.team)}</div>
    <div class="plate-foot"><span>${esc(pitch.name)} &middot; ${esc(pitch.sub)}</span><b>${rng12(session.start,session.end)}</b></div></div>
    <p class="dnote">${late>0?'Slot began '+late+' min ago. Starting now runs the timer from '+t12(now)+', ending '+t12(session.end)+'.'
      :'Slot has not begun yet. Starting now runs the timer from '+t12(now)+'.'}</p><div class="stack">
    <button class="dbtn primary wide sm" data-act="timer-start" data-v="now">Start now &middot; ${t12(now)}</button>
    <button class="dbtn wide sm" data-act="timer-start" data-v="slot">Start from slot time &middot; ${t12(session.start)}</button>
    <button class="dbtn ghost wide" data-act="timer-cancel" style="height:44px">Cancel</button></div></div></div>`;
}

function doneDialogHtml(){
  const session=sessionById(S.doneAsk),now=nowMin(),pitch=PITCHES[session.pitch];
  const outstanding=Math.max(0,session.amount-(session.discount||0)-(session.collected||0));
  const unpaid=session.pay!=='Payment done',early=Math.round(session.end-now);
  return `<div class="backdrop top"><div class="modal"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
    <span class="modal-kicker">End this session?</span><button class="x" data-act="done-cancel">&times;</button></div><div class="plate">
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
  const value=Math.max(0,parseInt(S.advVal,10)||0),discounting=settle&&value>0&&value<outstanding;
  const canSave=value>0&&value<=outstanding&&(!discounting||(can('manager')&&S.advReason.trim().length>=5));
  const balance=settle?(outstanding-value>0?money(outstanding-value)+' discount against '+money(outstanding)+' outstanding'
    :outstanding-value<0?money(value-outstanding)+' above the outstanding amount':'Settles in full, no discount')
    :money(Math.max(0,outstanding-value))+' balance due';
  const configuredDeposit=Math.min(S.settings.depositAmount,outstanding);
  const quickAmounts=settle?[Math.round(outstanding*.9),outstanding]:[configuredDeposit,Math.round(outstanding*.5),outstanding];
  const quick=[...new Set(quickAmounts.filter(amount=>amount>0&&amount<=outstanding))]
    .map(amount=>`<button class="${segCls(value===amount,true)}" data-act="adv-quick" data-v="${amount}" style="height:38px;border-radius:13px">
      ${amount===outstanding?'Full '+money(amount):!settle&&amount===configuredDeposit?'Deposit '+money(amount):(settle?'10% off · ':'')+money(amount)}</button>`).join('');
  return `<div class="backdrop over"><div class="modal"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
    <span class="modal-kicker">${settle?'Record payment':'Advance received'}</span><button class="x" data-act="adv-cancel">&times;</button></div>
    <div style="margin-top:12px"><b style="display:block;font:700 21px var(--sans)">${esc(session.team)}</b><span class="dsub">${esc(pitch.name)} &middot; ${esc(pitch.sub)} &middot; ${rng12(session.start,session.end)}
    &middot; total ${money(session.amount)}${paid?' · '+money(paid)+' already paid':''}</span></div><label style="display:block;margin-top:14px">
    <span class="dlabel">Amount collected now</span><input class="dinput amount" id="adv-val" data-act="adv-val" value="${esc(S.advVal)}" placeholder="0"></label>
    <div class="optrow" style="margin-top:9px">${quick}</div><span class="dlabel" style="margin:14px 0 6px">Payment type</span>
    <div class="optrow">${PAY_MODES.map(mode=>`<button class="${segCls(S.advPayMode===mode,true)}" data-act="adv-mode" data-v="${mode}"
    style="height:38px;border-radius:13px">${mode}</button>`).join('')}</div>${discounting?`<label style="display:block;margin-top:12px">
    <span class="dlabel">Discount reason · manager approval required</span><input class="dinput" id="adv-reason" data-act="adv-reason"
    value="${esc(S.advReason)}" placeholder="Why is the remaining ${money(outstanding-value)} being waived?"></label>`:''}
    <div style="font:700 14px var(--sans);margin-top:12px;color:${settle&&outstanding-value===0?'var(--lime)':'var(--warn)'}">${balance}</div>
    <div style="display:flex;gap:9px;margin-top:16px"><button class="dbtn primary sm" data-act="adv-save" ${canSave?'':'disabled'}
    style="cursor:${canSave?'pointer':'not-allowed'};opacity:${canSave?1:.45}">${settle?'Mark paid':'Save advance'}</button>
    <button class="dbtn sm" data-act="adv-cancel">Cancel</button></div></div></div>`;
}

function actionDialogHtml(){
  const ask=S.actionAsk;
  return `<div class="backdrop"><div class="modal"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
    <span class="modal-kicker">${esc(ask.title)}</span><button class="x" data-act="action-cancel">&times;</button></div>
    <h2 class="h2 sm" style="margin-top:14px">${esc(ask.subject||'Confirm this change')}</h2><p class="dnote">This action changes operational state and will be written to the audit log against your account.</p>
    <label style="display:block;margin-top:14px"><span class="dlabel">Reason · required</span><textarea class="reason" id="action-reason" data-act="action-reason"
    placeholder="Describe why this change is needed">${esc(S.actionReason)}</textarea></label><div style="display:flex;gap:9px;margin-top:16px">
    <button class="dbtn primary sm" data-act="action-confirm"${S.actionReason.trim().length<5?' disabled':''}>Confirm</button>
    <button class="dbtn sm" data-act="action-cancel">Cancel</button></div></div></div>`;
}

function blockDialogHtml(){
  const card=buildSessions().find(item=>item.id===S.blockDetail);
  if(!card)return '';
  const session=card.raw,pitch=PITCHES[session.pitch];
  const rows=[['Booked via',session.source==='app'?'Turf app · online':'Counter · walk-in'],['Contact',session.contact],
    ['Amount',money(session.amount)],['Payment',card.payLabel]].concat(card.running?[['Played',durTxt(Math.max(0,nowMin()-(session.startedAt||session.start)))]]:[]);
  return `<div class="backdrop"><div class="modal detail"><div class="detail-top"><div><div class="detail-time">${card.range}</div>
    <div class="sel-where">${esc(card.team)} &middot; ${esc(pitch.name)} &middot; ${esc(pitch.sub)}</div></div>
    <button class="x" data-act="block-close">&times;</button></div><div class="detail-status"><span class="tag ondark">${card.statusLabel}</span>
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
  if(S.doneAsk!=null&&sessionById(S.doneAsk))output+=doneDialogHtml();
  if(S.actionAsk)output+=actionDialogHtml();
  return output;
}
