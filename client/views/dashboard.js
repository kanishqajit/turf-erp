import { DOW, END_HOUR, MON, PITCHES, START_HOUR } from '../constants.js';
import { dateForAddress, hourT12, hours, isoDate, rng12, TODAY, TODAY_DI } from '../datetime.js';
import { esc, hbar, money, sessionsToday, vbar, weekStart } from '../domain.js';
import { S } from '../state.js';

export function viewDashboard(){
  const start = weekStart(), end = new Date(start); end.setDate(end.getDate()+6);
  const weekLabel=start.getDate()+' '+MON[start.getMonth()]+' – '+end.getDate()+' '+MON[end.getMonth()];
  const from=isoDate(start),to=isoDate(end);
  const week=S.bookings.filter(booking=>booking.date>=from&&booking.date<=to&&booking.status!=='noshow');
  const online=week.filter(booking=>booking.source==='app').length;
  const capacity=PITCHES.length*7*(END_HOUR-START_HOUR)*60;
  const booked=week.reduce((sum,booking)=>sum+booking.end-booking.start,0);
  const utilisation=Math.round(booked/capacity*100);
  const collected=week.reduce((sum,booking)=>sum+booking.collected,0);
  const openHours=Math.max(0,(capacity-booked)/60);
  const utilBars=DOW.map((dow,dayIndex)=>{const date=dateForAddress(S.weekOffset,dayIndex);
    const used=week.filter(booking=>booking.date===date).reduce((sum,booking)=>sum+booking.end-booking.start,0);
    return {dow,pct:Math.round(used/(PITCHES.length*(END_HOUR-START_HOUR)*60)*100)};});
  const kpis=[['Utilisation',utilisation+'%','All pitches · confirmed time only',true],
    ['Confirmed bookings',String(week.length),online+' in app · '+(week.length-online)+' at counter',false],
    ['Collected revenue',money(collected),'Payments recorded this week',false],
    ['Open capacity',openHours.toFixed(openHours%1?1:0)+'h','Excludes confirmed booking time',false]]
    .map(([label,value,note,fill])=>`<div class="tile${fill?' fill':''}"><div class="lbl">${label}</div>
      <div class="val">${value}</div><div class="nte">${note}</div></div>`).join('');
  const hourDemand=hours().map(hour=>{const used=week.reduce((sum,booking)=>sum+Math.max(0,
    Math.min(booking.end,(hour+1)*60)-Math.max(booking.start,hour*60)),0);
    return {time:hourT12(hour),pct:Math.round(used/(PITCHES.length*7*60)*100)};}).sort((a,b)=>b.pct-a.pct).slice(0,8)
    .map(item=>`<div class="hrow"><span class="t">${item.time}</span><div class="htrack"><div class="fill" style="${hbar(item.pct)}"></div></div>
      <span class="p">${item.pct}%</span></div>`).join('');
  const bookings=sessionsToday().map(booking=>{const pitch=PITCHES[booking.pitch],app=booking.source==='app';return `<div class="bkrow">
    <b class="slot">${rng12(booking.start,booking.end)}</b><span>${esc(pitch.name)}</span><b class="team">${esc(booking.team)}</b>
    <span class="contact">${esc(booking.contact)}</span><span><span class="src${app?' via-app':''}">${app?'App':'Counter'}</span></span>
    <span><span class="tag booked">${esc(booking.status==='noshow'?'No-show':booking.status)}</span></span>
    <b class="amt">${money(booking.amount-booking.discount)}</b></div>`;}).join('')||'<div class="alert-none">No confirmed bookings today.</div>';
  return `<main class="dash"><div><div class="kicker">Operations &middot; week of ${weekLabel}</div><h1 class="h1">Dashboard</h1></div>
    <div class="tiles">${kpis}</div><div class="charts"><div class="chart"><div class="chart-head"><h2 class="h3">Utilisation by day</h2>
    <span class="note">All pitches</span></div><div class="bars">${utilBars.map(item=>`<div class="col"><span>${item.pct}%</span>
    <div class="vbar" style="${vbar(item.pct)}"></div></div>`).join('')}</div><div class="barlabels">${utilBars.map(item=>`<span>${item.dow}</span>`).join('')}</div></div>
    <div class="chart"><h2 class="h3" style="margin-bottom:18px">Demand by hour</h2>${hourDemand}</div></div><div class="bookings">
    <div class="chart-head" style="margin-bottom:14px"><h2 class="h3">Today&rsquo;s bookings</h2>
    <span class="note">${DOW[TODAY_DI]}, ${TODAY.getDate()} ${MON[TODAY.getMonth()]} ${TODAY.getFullYear()}</span></div>
    <div class="bkhead"><span>Slot</span><span>Pitch</span><span>Team</span><span>Contact</span><span>Source</span><span>Status</span><span class="r">Amount</span></div>
    ${bookings}</div></main>`;
}
