import { occupiedOnDay } from './occupancy.js';

// Preview the same reserved window the server checks. The operator explicitly
// chooses whether a late game keeps its booked end or takes its full duration.
export function sessionStartPlan(session, state, at, today, now){
  const previous=state.bookings.find(b=>b.id!==session.id&&b.pitch===session.pitch&&b.status==='running');
  let reason='';
  if(session.date!==today)reason='Only today’s bookings can start here. Ask a manager to review this booking.';
  else if(now<session.start-15)reason='This game can start 15 minutes before its booked time.';
  else if(now>=session.end)reason='The booked time has ended. Ask a manager to review it or mark a no-show.';
  else if(at>Math.floor(now)||at<session.start-15||at>=session.end)reason='Choose a start within the booking window, no later than now.';
  const start=Math.min(session.start,at),end=Math.max(session.end,at+session.end-session.start);
  const clashes=record=>{
    if(record.pitch!==session.pitch)return false;
    const window=occupiedOnDay(record,session.date);
    return window&&window.start<end&&window.end>start;
  };
  const booking=state.bookings.find(b=>b.id!==session.id&&b.id!==previous?.id&&!['noshow','cancelled'].includes(b.status)&&clashes(b));
  const hold=state.holds.find(h=>new Date(h.expiresAt).getTime()>Date.now()&&clashes(h));
  const block=state.blocks.find(clashes);
  // Ending a previous game keeps its scheduled slot reserved.
  const previousWindow=previous?occupiedOnDay({...previous,status:'done'},session.date):null;
  if(!reason&&previousWindow&&previousWindow.start<end&&previousWindow.end>start)reason='The previous game’s booked slot has not ended. Choose a later start.';
  if(!reason&&booking)reason='This clock would overlap '+booking.team+'. Use the booked start to keep the scheduled end.';
  if(!reason&&hold)reason='This clock would overlap a held slot.';
  if(!reason&&block)reason='This clock would overlap maintenance.';
  return {ok:!reason,reason,previous,end:at+session.end-session.start};
}
