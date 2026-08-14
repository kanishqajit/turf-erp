import { PITCHES } from '../constants.js';
import { durTxt, isoDate, nowMin, rng12, t12, TODAY } from '../datetime.js';
import { collectTotal, esc, money, sessionsToday } from '../domain.js';
import { S } from '../state.js';

function relTime(minute){
  const difference = Math.round(minute - nowMin());
  if (Math.abs(difference) < 1) return 'now';
  return difference > 0 ? 'in ' + (difference >= 60 ? durTxt(difference) : difference + ' min')
    : (Math.abs(difference) >= 60 ? durTxt(-difference) : -difference + ' min') + ' ago';
}

export function buildAlerts(){
  const now = nowMin(), game = [], cash = [];
  sessionsToday().forEach(session => {
    const pitch = PITCHES[session.pitch];
    const outstanding = Math.max(0,session.amount - (session.discount || 0) - (session.collected || 0));
    if (session.status === 'upcoming'){
      const late = now - session.start;
      game.push({kind:'game',at:session.start,urgent:late>5,tag:late>5?'Not started':'Starts soon',
        title:session.team+' · '+pitch.name,
        body:late>5 ? 'Slot began '+Math.round(late)+' min ago and the timer is not running.'
          : 'Booked '+rng12(session.start,session.end)+'. Start the timer when they take the pitch.',
        action:'Start timer',act:'alert-timer',id:session.id});
    }
    if (session.status === 'running' && now > session.end){
      game.push({kind:'game',at:session.end,urgent:true,tag:'Overtime',title:session.team+' · '+pitch.name,
        body:'Running '+durTxt(now-session.end)+' past the booked end time.',action:'End session',act:'alert-done',id:session.id});
    }
    if (session.pay !== 'Payment done' && session.status !== 'noshow'){
      cash.push({kind:'cash',at:session.end,urgent:session.status==='done',
        tag:session.status==='done'?'Overdue':session.pay==='Advance paid'?'Balance due':'Due at venue',
        title:money(outstanding)+' · '+session.team,
        body:pitch.name+' · '+rng12(session.start,session.end)+' · '+session.contact
          +(session.collected?' · '+money(session.collected)+' received':''),action:'Collect',act:'alert-collect',id:session.id});
    }
  });
  game.sort((a,b)=>a.at-b.at); cash.sort((a,b)=>a.at-b.at);
  const today = isoDate(TODAY);
  const other = S.holds.filter(hold=>hold.date===today).map(hold=>({kind:'other',at:hold.start,tag:'Active hold',
    title:hold.team+' · '+PITCHES[hold.pitch].name,
    body:'Expires '+new Date(hold.expiresAt).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'})+'.'}))
    .concat(S.blocks.filter(block=>block.date===today).map(block=>({kind:'other',at:block.start,tag:'Maintenance',
      title:PITCHES[block.pitch].name+' · '+rng12(block.start,block.end),body:block.reason+' · logged by '+block.createdBy})));
  return {game,cash,other};
}

function alertHtml(alert){
  const kind = alert.urgent ? 'urgent' : alert.kind;
  return `<div class="alert ${kind}"><div><b class="time">${t12(alert.at)}</b><span class="rel">${relTime(alert.at)}</span></div>
    <div class="alert-body"><div class="line"><span class="atag ${kind}">${esc(alert.tag)}</span><b>${esc(alert.title)}</b></div>
    <span class="txt">${esc(alert.body)}</span></div>${alert.action
      ? `<button class="abtn ${kind}" data-act="${alert.act}" data-id="${alert.id}">${alert.action}</button>` : '<span></span>'}</div>`;
}

export function viewAlerts(){
  const {game,cash,other} = buildAlerts();
  const list = (items,empty) => `<div class="alertlist"><div class="alert-th"><span>Time</span><span>Reminder</span><span></span></div>
    ${items.map(alertHtml).join('')}${items.length ? '' : `<div class="alert-none">${empty}</div>`}</div>`;
  return `<main class="alerts"><div><div class="kicker dot"><i style="background:var(--red)"></i>Live &middot; ${t12(nowMin())}</div>
    <h1 class="h1">Reminders</h1></div><section><div class="sechead"><h2 class="h2 sm">Pending game reminders</h2>
    <span class="count">${game.length} pending</span></div>${list(game,'Every scheduled match is either running or finished.')}</section>
    <section><div class="sechead"><h2 class="h2 sm">Cash collection reminders</h2><span class="count">${money(collectTotal())} across ${cash.length}</span></div>
    ${list(cash,'Nothing left to collect today.')}</section><section><div class="sechead"><h2 class="h2 sm">Other notifications</h2>
    <span class="count">${other.length} updates</span></div><div class="alertlist">${other.map(alertHtml).join('')}</div></section></main>`;
}
