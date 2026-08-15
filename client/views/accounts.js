import { PAY_MODES, PITCHES } from '../constants.js';
import { isoDate, rng12 } from '../datetime.js';
import { esc, money, outstandingFor, segCls } from '../domain.js';
import { can, S } from '../state.js';

const dateLabel = value => new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {
  weekday:'short', day:'numeric', month:'short', year:'numeric',
});
const actionable = booking => !['cancelled','noshow'].includes(booking.status);
const eventsFor = id => S.paymentEvents.filter(event => event.bookingId === id);

function accountStatus(booking){
  const outstanding = outstandingFor(booking);
  if (booking.status === 'cancelled') return booking.collected > 0 ? 'Refund still required' : 'Released';
  if (booking.status === 'noshow') return booking.collected > 0 ? 'No-show · payment retained' : 'No-show';
  if (booking.collected > 0 && booking.date >= isoDate(new Date())) return 'Payment blocks release';
  if (outstanding > 0) return 'Collect balance';
  return 'Settled';
}

function historyHtml(booking){
  const events=eventsFor(booking.id);
  return `<div class="acct-history"><b>Account history</b>${events.length ? events.map(event => `<div class="acct-event">
    <time>${new Date(event.createdAt).toLocaleString('en-IN')}</time><span>${event.kind === 'refund' ? 'Refunded' : 'Collected'} ${money(event.amount)} · ${esc(event.mode)}${event.reference ? ' · ref '+esc(event.reference) : ''}</span>
    <small>${esc(event.createdBy)}${event.reason ? ' · '+esc(event.reason) : ''}</small></div>`).join('') : '<span>No payment events recorded.</span>'}</div>`;
}

function rowHtml(booking){
  const outstanding = outstandingFor(booking), pitch = PITCHES[booking.pitch];
  const refundable = Object.values(booking.collectedByMode || {}).some(value => value > 0);
  return `<div class="acct-row${S.accountFocus === booking.id ? ' focus' : ''}">
    <div class="acct-when"><b>${dateLabel(booking.date)}</b><span>${rng12(booking.start, booking.end)}</span></div>
    <div class="acct-who"><b>${esc(booking.team)}</b><span>${esc(pitch.name)} &middot; ${esc(booking.contact)}</span></div>
    <div class="acct-money"><b>${money(booking.amount - (booking.discount || 0))}</b>
      <span>${money(booking.collected || 0)} collected${outstanding ? ' · ' + money(outstanding) + ' due' : ''}</span></div>
    <div class="acct-state"><span>${esc(accountStatus(booking))}</span><small>${esc(booking.status)}</small></div>
    <div class="acct-actions">
      ${actionable(booking) && outstanding > 0 ? `<button class="mini primary" data-act="account-collect" data-id="${booking.id}">Collect</button>` : ''}
      ${can('manager') && refundable ? `<button class="mini" data-act="account-refund" data-id="${booking.id}">Refund</button>` : ''}
      <button class="mini" data-act="account-history" data-id="${booking.id}" aria-expanded="${S.accountHistory===booking.id}">History</button>
    </div>${S.accountHistory===booking.id ? historyHtml(booking) : ''}</div>`;
}

export function refundDialogHtml(){
  const booking = S.accounts.find(item => item.id === S.refundAsk) || S.bookings.find(item => item.id === S.refundAsk);
  if (!booking) return '';
  const available=Number(booking.collectedByMode?.[S.refundPayMode] || 0);
  const value = Math.max(0, parseInt(S.refundVal,10) || 0),referenceOk=S.refundPayMode==='Cash'||S.refundReference.trim().length>=4;
  const canSave = value > 0 && value <= available && S.refundReason.trim().length >= 5 && referenceOk;
  const quick = [...new Set([available, Math.round(available / 2)].filter(amount => amount > 0))]
    .map(amount => `<button class="${segCls(value === amount,true)}" data-act="refund-quick" data-v="${amount}"
      style="height:38px;border-radius:13px">${amount === available ? 'Full ' : ''}${money(amount)}</button>`).join('');
  return `<div class="backdrop over"><div class="modal" role="dialog" aria-modal="true" aria-label="Record refund" tabindex="-1"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
    <span class="modal-kicker">Accounts refund</span><button class="x" data-act="refund-cancel" aria-label="Close refund dialog">&times;</button></div>
    <div style="margin-top:12px"><b style="display:block;font:700 21px var(--sans)">${esc(booking.team)}</b>
    <span class="dsub">${dateLabel(booking.date)} &middot; ${rng12(booking.start, booking.end)} &middot; ${money(booking.collected || 0)} net collected</span></div>
    <span class="dlabel" style="margin:14px 0 6px">Refund through the original rail</span><div class="optrow">${PAY_MODES.map(mode => {
      const amount=Number(booking.collectedByMode?.[mode]||0);return `<button class="${segCls(S.refundPayMode === mode,true)}" data-act="refund-mode" data-v="${mode}"
      style="height:38px;border-radius:13px"${amount>0?'': ' disabled'}>${mode} · ${money(amount)}</button>`;}).join('')}</div>
    <label style="display:block;margin-top:14px"><span class="dlabel">Refund amount · up to ${money(available)} via ${esc(S.refundPayMode)}</span>
      <input class="dinput amount" id="refund-val" data-act="refund-val" value="${esc(S.refundVal)}" inputmode="numeric" placeholder="0"></label>
    <div class="optrow" style="margin-top:9px">${quick}</div>${S.refundPayMode!=='Cash'?`<label style="display:block;margin-top:12px">
    <span class="dlabel">${esc(S.refundPayMode)} refund reference · required</span><input class="dinput" id="refund-reference" data-act="refund-reference"
      value="${esc(S.refundReference)}" placeholder="Transaction or receipt reference"></label>`:''}<label style="display:block;margin-top:12px">
    <span class="dlabel">Reason · manager approval required</span><input class="dinput" id="refund-reason" data-act="refund-reason"
      value="${esc(S.refundReason)}" placeholder="Why is this account being refunded?"></label>
    <p class="dnote" style="margin-top:12px">This creates an auditable refund event. Release the booking separately after its net collected amount reaches zero.</p>
    <div style="display:flex;gap:9px;margin-top:16px"><button class="dbtn primary sm" data-act="refund-save" ${canSave ? '' : 'disabled'}>Record refund</button>
    <button class="dbtn sm" data-act="refund-cancel">Cancel</button></div></div></div>`;
}

export function viewAccounts(){
  const today=isoDate(new Date()),search=S.accountSearch.trim().toLowerCase();
  const statusMatch=booking=>S.accountStatus==='all'||(S.accountStatus==='open'&&actionable(booking)&&outstandingFor(booking)>0)
    ||(S.accountStatus==='paid'&&outstandingFor(booking)===0)||(S.accountStatus==='refunds'&&eventsFor(booking.id).some(event=>event.kind==='refund'))
    ||(S.accountStatus==='cancelled'&&['cancelled','noshow'].includes(booking.status));
  const rows=S.accounts.filter(booking=>(!S.accountFrom||booking.date>=S.accountFrom)&&(!S.accountTo||booking.date<=S.accountTo)
    &&statusMatch(booking)&&(!search||`${booking.team} ${booking.contact} ${booking.id}`.toLowerCase().includes(search)))
    .sort((a,b)=>Number(actionable(b)&&outstandingFor(b)>0)-Number(actionable(a)&&outstandingFor(a)>0)||b.date.localeCompare(a.date)||b.start-a.start);
  const active=S.accounts.filter(actionable),releaseBlocked=active.filter(booking=>booking.collected>0&&booking.date>=today);
  const due=active.filter(booking=>outstandingFor(booking)>0),netCollected=S.accounts.reduce((sum,booking)=>sum+(booking.collected||0),0);
  const outstanding=due.reduce((sum,booking)=>sum+outstandingFor(booking),0);
  return `<main class="accounts"><div class="headrow"><div><div class="kicker">Accounts</div><h1 class="h1">Collections and refunds</h1></div>
    <button class="pillbtn" data-act="account-export">Export loaded ledger</button></div>
    <div class="acct-stats">${[['Net collected',money(netCollected),''],['Outstanding',money(outstanding),outstanding?' cash':''],
      ['Blocks release',String(releaseBlocked.length),releaseBlocked.length?' danger':''],['Due bookings',String(due.length),due.length?' cash':'']]
      .map(([label,value,cls])=>`<div class="stat${cls}"><span class="lbl">${label}</span><b>${value}</b></div>`).join('')}</div>
    <section class="acct-card"><div class="chart-head"><div><h2 class="h3">Payment worklist</h2><span class="note">${rows.length} matching bookings · cancelled and refunded records remain visible</span></div></div>
    <div class="acct-filters"><label><span class="sr-only">Search accounts</span><input class="dinput" data-act="account-search" value="${esc(S.accountSearch)}" placeholder="Search team, contact or booking ID"></label>
    <label><span>From</span><input class="dinput" type="date" data-act="account-from" value="${esc(S.accountFrom)}"></label>
    <label><span>To</span><input class="dinput" type="date" data-act="account-to" value="${esc(S.accountTo)}"></label>
    <div class="optrow">${[['open','Open'],['paid','Settled'],['refunds','Refunded'],['cancelled','Closed'],['all','All']].map(([value,label])=>
      `<button class="${segCls(S.accountStatus===value,true)}" data-act="account-status" data-v="${value}">${label}</button>`).join('')}</div></div>
    ${rows.length ? `<div class="acct-table"><div class="acct-head"><span>Date</span><span>Booking</span><span>Money</span><span>State</span><span>Action</span></div>${rows.map(rowHtml).join('')}</div>`
      : '<div class="empty tight">No accounts match these filters.</div>'}</section></main>`;
}
