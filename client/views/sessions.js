import { DAY_END, DAY_START, MATCH_STATES, PAY_STATES, PITCHES, SPAN, payShort } from '../constants.js';
import { durTxt, nowMin, pos, rng12, t12 } from '../datetime.js';
import { collectTotal, esc, money, segCls, sessionsToday, tintFor, tintVars } from '../domain.js';
import { S } from '../state.js';

const STATUS_ORDER = { running:0, upcoming:1, done:2, noshow:3 };
const SESSION_MODES = [
  ['now','Now'], ['schedule','Schedule'], ['ledger','Ledger'],
];

export function buildSessions(){
  const now = nowMin();
  return sessionsToday().slice()
    .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (a.start - b.start))
    .map(s => {
      const pitch = PITCHES[s.pitch];
      const running = s.status === 'running', upcoming = s.status === 'upcoming', done = s.status === 'done';
      const left = s.end - now, over = running && left < 0;
      const elapsed = running ? now - (s.startedAt || s.start) : 0;
      const pct = running ? Math.max(0, Math.min(100, ((now - s.start) / (s.end - s.start)) * 100)) : done ? 100 : 0;
      const amount = s.amount, unpaid = s.pay !== 'Payment done', duePay = done && unpaid;
      const actions = (running
        ? [{label:'End match',primary:true,act:'ask-done'},{label:'+30 min',act:'plus30'}]
        : upcoming ? [{label:'Start match',primary:true,act:'mark-started'},{label:'No-show',act:'noshow'}]
        : s.status === 'noshow' ? [{label:'Undo no-show',primary:true,act:'undo-noshow'}] : [])
        .concat(unpaid && s.status !== 'noshow' ? [{label:'Collect money',primary:duePay,act:'collect'}] : []);
      return {
        raw:s, id:s.id, pitchIndex:s.pitch, team:s.team, contact:s.contact,
        pitchName:pitch.name + ' · ' + pitch.sub, range:rng12(s.start,s.end), status:s.status,
        running, upcoming, done, over, unpaid, duePay, pct, amount,
        awaitingPay:duePay, focused:S.focusSession === s.id,
        rowCls:over ? 'over' : running ? 'play' : duePay ? 'duepay' : upcoming ? 'upcoming' : s.status === 'noshow' ? 'noshow' : 'done',
        statusLabel:over ? 'Overtime' : running ? 'In play' : upcoming ? 'Up next'
          : done ? (unpaid ? 'Payment due' : 'Completed') : 'No-show',
        statusCls:over ? 'over' : running ? 'play' : duePay ? 'duepay' : '',
        sourceLabel:s.source === 'app' ? 'App' : 'Counter', sourceCls:s.source === 'app' ? 'via-app' : '',
        payLabel:s.pay === 'Advance paid'
          ? money(s.collected || 0) + ' of ' + money(amount - (s.discount || 0)) + ' paid · '
            + money(Math.max(0, amount - (s.discount || 0) - (s.collected || 0))) + ' due'
          : s.pay === 'Payment done'
          ? 'Paid ' + money(s.collected || 0) + (s.discount ? ' · ' + money(s.discount) + ' approved discount' : '')
          : s.pay,
        amountSuffix:s.pay === 'Advance paid' || s.pay === 'Payment done' ? '' : ' · ' + money(amount),
        clock:running ? (over ? '+' + durTxt(-left) + ' over' : durTxt(left) + ' left')
          : upcoming ? 'starts in ' + durTxt(Math.max(0,s.start - now))
          : done ? 'ended ' + t12(s.endedAt || s.end) : '—',
        elapsedLabel:running ? durTxt(Math.max(0,elapsed)) + ' played · ' : '',
        liveNote:duePay ? 'Match finished · collect payment to clear' : '',
        actions,
      };
    });
}

export const matchOptsHtml = (card, dark = false) => `<div class="opts">${MATCH_STATES.map(option =>
  `<button class="${segCls(card.status === option.k,dark)}" data-act="match" data-id="${card.id}" data-v="${option.k}">${option.label}</button>`).join('')}</div>`;
export const payOptsHtml = (card, dark = false) => `<div class="opts">${PAY_STATES.map(option =>
  `<button class="${segCls(card.raw.pay === option,dark)}" data-act="pay" data-id="${card.id}" data-v="${esc(option)}">${payShort(option)}</button>`).join('')}</div>`;

function liveCardHtml(card){
  const dark = card.running;
  const cls = 'scard big actioncard' + (card.duePay ? ' duepay' : dark ? ' live' : '') + (card.focused ? ' focus' : '');
  return `<div class="${cls}"><div class="row"><span class="sstat ${card.statusCls}">${card.statusLabel}</span>
    <span class="ssrc ${card.sourceCls}">${card.sourceLabel}</span><span class="bigclock">${card.clock}</span></div>
    <div><b class="team">${esc(card.team)}</b><span class="sub">${esc(card.pitchName)} &middot; ${card.range}</span></div>
    ${card.running ? `<div class="strack"><div class="fill${card.over ? ' over' : ''}" style="width:${card.pct}%"></div></div>` : ''}
    <div class="split"><span class="sub">${card.elapsedLabel}${esc(card.contact)}</span>
      <span class="pay${card.unpaid ? ' due' : ''}">${esc(card.payLabel)}${card.amountSuffix}</span></div>
    ${card.liveNote ? `<span class="sub">${card.liveNote}</span>` : ''}
    <div class="acts">${card.actions.map(action => `<button class="act${action.primary ? ' primary' : ''}"
      data-act="${action.act}" data-id="${card.id}">${action.label}</button>`).join('')}</div></div>`;
}

function timelineHtml(pitchIndex){
  const now = nowMin();
  const blocks = sessionsToday().filter(session => session.pitch === pitchIndex).map(session => {
    const running = session.status === 'running';
    const duePay = session.status === 'done' && session.pay !== 'Payment done';
    const over = running && session.end < now;
    const background = session.status === 'noshow' ? 'var(--edge2)' : over ? 'var(--red)'
      : duePay ? 'var(--amber-bg)' : session.status === 'done' ? 'var(--edge2)'
      : running ? 'var(--lime)' : 'var(--paper)';
    const border = over ? '1px solid var(--red-deep)' : duePay ? '1px solid var(--amber)'
      : running ? '1.5px solid var(--ink)' : '1px solid var(--edge3)';
    const width = pos(session.end) - pos(session.start);
    const onDark = over;
    const word = over ? 'OVER' : running ? 'LIVE' : duePay ? 'DUE'
      : session.status === 'done' ? 'DONE' : session.status === 'noshow' ? 'NO-SHOW' : 'NEXT';
    const color = over ? '#fff' : session.status === 'noshow' ? 'var(--body)' : 'var(--ink)';
    const title = session.team + ' · ' + rng12(session.start,session.end) + ' · '
      + (session.status === 'done' ? 'finished' : session.status) + ' · ' + session.pay;
    return `<div class="tl-block" title="${esc(title)}" data-act="tl-block" data-id="${session.id}"
      style="left:${pos(session.start)}%;width:${width}%;background:${background};color:${color};
        border:${border};box-shadow:${S.focusSession === session.id ? '0 0 0 2px var(--ink)' : 'none'}">
      <span>${width >= 22 ? esc(session.team) : ''}</span><span class="tl-marks">
        ${width >= 14 ? `<span class="tl-word${onDark ? ' ondark' : ''}">${word}</span>` : ''}
        ${session.pay === 'Payment done' ? '<span class="tick-dot paid" title="Payment received">₹</span>' : ''}</span></div>`;
  }).join('');
  const ticks = Array.from({length:Math.floor(SPAN / 120) + 1},(_,index) => DAY_START + index * 120)
    .filter(minute => minute <= DAY_END).map(minute => `<span style="left:${pos(minute)}%">${t12(minute)}</span>`).join('');
  return `<div class="timeline"><div class="tl-track">${blocks}<div class="tl-nowdot" style="left:${pos(now)}%"></div>
    <div class="tl-now" style="left:${pos(now)}%"></div></div><div class="tl-ticks">${ticks}</div></div>`;
}

export function viewSessions(){
  const now = nowMin(), cards = buildSessions(), sessions = sessionsToday();
  const runCount = sessions.filter(session => session.status === 'running').length;
  const overCount = cards.filter(card => card.over).length;
  const dueCount = cards.filter(card => card.awaitingPay).length;
  const upcomingAll = cards.filter(card => card.upcoming).sort((a,b) => a.raw.start - b.raw.start);
  const next = upcomingAll[0];
  const toCollect = collectTotal();
  const activeMode = SESSION_MODES.some(([mode]) => mode === S.sessionsMode) ? S.sessionsMode : 'now';
  const statbar = `<div class="statbar">${[
    ['In play',String(runCount),runCount>0?' live':''],
    ['Overtime',String(overCount),overCount>0?' danger':''],
    ['Payment due',String(dueCount),dueCount>0?' cash':''],
    ['To collect',money(toCollect),toCollect>0?' cash':''],
    ['Next',next ? t12(next.raw.start) : 'None',''],
  ].map(([label,value,cls]) => `<div class="stat${cls}">
      <span class="lbl">${label}</span><b>${value}</b></div>`).join('')}</div>`;
  const marks = [['NEXT','Not started','var(--ink)','#fff',false],['LIVE','In play','var(--lime)','var(--ink)',false],
    ['OVER','Overtime','var(--red)','#fff',false],['DUE','Payment due','var(--amber)','var(--ink)',false],
    ['DONE','Finished','var(--edge2)','var(--ink)',false],['₹','Payment received','var(--green)','#fff',true]].map(([mark,text,background,color,dot]) =>
      `<span><b class="${dot ? 'dot' : ''}" style="background:${background};color:${color}">${mark}</b>${text}</span>`).join('');
  const attention = cards.filter(card => card.running || card.duePay);
  const actionCards = attention.length ? attention : upcomingAll.slice(0,3);
  const actionNote = attention.length ? 'Live matches and finished sessions with money due'
    : next ? 'No urgent work. Showing the next sessions to prepare.' : 'No sessions left today.';
  const actionHtml = `<div class="sess-sec priority"><div class="sechead">
    <h2 class="h2 sm">Action queue</h2><span class="count">${actionNote}</span></div><div class="priority-strip">
    ${actionCards.length ? actionCards.map(liveCardHtml).join('') : '<div class="empty tight">No sessions left today.</div>'}</div></div>`;
  const sections = PITCHES.map((pitch,pitchIndex) => {
    const raw = sessions.filter(session => session.pitch === pitchIndex && session.status !== 'cancelled');
    const live = raw.some(session => session.status === 'running');
    const next = raw.filter(session => session.status === 'upcoming').sort((a,b) => a.start - b.start)[0];
    const busy = raw.filter(session => session.status !== 'noshow').reduce((total,session) => total + session.end - session.start,0);
    return `<div class="pitchsec"><div class="pitchhead${S.showPitchColors ? '' : ' neutral'}${live ? ' live' : ''}" style="${tintVars(tintFor(pitchIndex))}">
      <b>${esc(pitch.name)}</b><span class="sub">${esc(pitch.sub)}</span><span class="state${live ? ' live' : ''}">
      ${live ? 'In play now' : next ? 'Next ' + t12(next.start) : 'Idle rest of day'}</span><span class="end">
      <span class="sub">${durTxt(busy)} booked</span><b>${rng12(DAY_START,DAY_END)}</b></span></div>${timelineHtml(pitchIndex)}</div>`;
  }).join('');
  const pitchStatus = PITCHES.map((pitch,pitchIndex) => {
    const list = cards.filter(card => card.pitchIndex === pitchIndex);
    const live = list.find(card => card.running);
    const due = list.find(card => card.duePay);
    const upcoming = list.filter(card => card.upcoming).sort((a,b) => a.raw.start - b.raw.start)[0];
    const primary = live || due || upcoming;
    const booked = sessions.filter(session => session.pitch === pitchIndex && session.status !== 'noshow').reduce((total,session) => total + session.end - session.start,0);
    return `<button class="pitchstatus${live ? ' live' : due ? ' duepay' : ''}" data-act="${primary ? 'tl-block' : 'sessions-mode'}"
      data-id="${primary ? primary.id : ''}" data-v="schedule">
      <span><b>${esc(pitch.name)}</b><small>${esc(pitch.sub)}</small></span>
      <strong>${live ? 'In play' : due ? 'Collect' : upcoming ? t12(upcoming.raw.start) : 'Idle'}</strong>
      <em>${primary ? esc(primary.team) : durTxt(booked) + ' booked'}</em></button>`;
  }).join('');
  const rowActionsFor = card => {
    const actions = card.actions.length ? card.actions : [{label:'Details',act:'tl-block'}];
    const visible = actions.slice(0,3);
    if (!visible.some(action => action.act === 'tl-block')) visible.push({label:'Details',act:'tl-block'});
    return visible.map(action => `<button class="mini${action.primary ? ' primary' : ''}" data-act="${action.act}"
      data-id="${card.id}">${action.label}</button>`).join('');
  };
  const rowsFor = list => list.map(card => `<div class="strow ${card.rowCls}${card.focused ? ' focus' : ''}" id="row-${card.id}">
    <div class="whn"><b>${card.range}</b><span>${card.clock}</span></div><div class="who"><b>${esc(card.team)}</b>
      <span>${esc(card.pitchName)} &middot; ${esc(card.contact)}</span></div><div class="stt"><span class="sstat ${card.statusCls}">${card.statusLabel}</span>
      <span class="ssrc ${card.sourceCls}">${card.sourceLabel}</span></div>
    <div class="paycell"><span class="pay${card.unpaid ? ' due' : ''}">${esc(card.payLabel)}${card.amountSuffix}</span>
      ${!card.unpaid ? '<span class="paidmark">₹ Paid</span>' : ''}</div>
    <div class="xtra">${rowActionsFor(card)}</div></div>`).join('');
  const listSection = (title, list, note) => `<div class="sess-group"><div class="sechead compact">
    <h3 class="h3">${title}</h3><span class="count">${list.length} session${list.length===1?'':'s'}${note ? ' · ' + note : ''}</span></div>
    ${list.length ? `<div class="stable"><div class="sthead"><span>Time</span><span>Booking</span><span>State</span><span>Payment</span><span>Action</span></div>
    ${rowsFor(list)}</div>` : `<div class="empty tight">No sessions in this group.</div>`}</div>`;
  const focused = cards.find(card => card.focused);
  const visibleCards = focused ? [focused] : cards;
  const nowCards = visibleCards.filter(card => card.running || card.duePay);
  const upcoming = visibleCards.filter(card => card.upcoming).sort((a,b) => a.raw.start - b.raw.start);
  const complete = visibleCards.filter(card => !card.running && !card.duePay && !card.upcoming);
  const modeHtml = `<div class="modeseg">${SESSION_MODES.map(([mode,label]) =>
    `<button class="modeopt${activeMode === mode ? ' on' : ''}" data-act="sessions-mode" data-v="${mode}">${label}</button>`).join('')}</div>`;
  const nowHtml = `${actionHtml}<div class="sess-sec"><div class="sechead"><h2 class="h2 sm">Pitch status</h2>
    <span class="count">Current state across all pitches</span></div><div class="pitchstatus-grid">${pitchStatus}</div></div>`;
  const scheduleHtml = `<div class="sess-sec schedule-mode"><div class="sechead"><h2 class="h2 sm">Pitch schedule</h2>
    <div class="legendmarks">${marks}</div></div><div class="pitchgrid">${sections}</div></div>`;
  const ledgerHtml = `<div class="sess-sec ledger-mode"><div class="sechead">
    <h2 class="h2 sm">Session ledger</h2><span class="count">${cards.length} session${cards.length===1?'':'s'}${focused ? ' · showing ' + esc(focused.team) : ''}</span>
    ${focused ? '<button class="mini clear" data-act="clear-focus">Show all</button>' : ''}</div>
    ${listSection('Now',nowCards,'running or payment due')}${listSection('Upcoming',upcoming,'not started')}
    ${listSection('Closed',complete,'finished, paid, or no-show')}</div>`;
  const bodyHtml = activeMode === 'schedule' ? scheduleHtml : activeMode === 'ledger' ? ledgerHtml : nowHtml;
  return `<main class="sessions"><section class="sess-main"><div class="headrow"><div class="headrow-lead"><div class="headrow-title">
    <div class="kicker dot"><i style="background:${runCount ? 'var(--lime)' : 'var(--ink)'}"></i>Now &middot; ${t12(now)}</div><h1 class="h1">Today's sessions</h1>
    </div>${modeHtml}</div>${statbar}</div>${bodyHtml}</section></main>`;
}
