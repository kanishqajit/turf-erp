import { occupiedOnDay } from './occupancy.js';

// Build the complete, reviewable schedule before any booking is changed.
// The server recomputes this against its fresh transactional snapshot.
export function sessionStartPlan(session,state,at,today,now,{policy='full',edits=[],closeMinute=1440}={}){
  const bookings=state.bookings,previous=bookings.find(b=>b.id!==session.id&&b.pitch===session.pitch&&b.status==='running');
  const duration=policy==='scheduled'?session.end-at:session.end-session.start;
  const end=at+duration,adjustments=[];
  const result=reason=>({ok:!reason,reason,previous,end,duration,policy,adjustments});
  if(!['scheduled','full','shift'].includes(policy))return result('Choose how this game should finish.');
  if(session.date!==today)return result('Only today’s bookings can start here. Ask a manager to review this booking.');
  if(now<session.start-15||at<session.start-15||at>Math.floor(now)||!Number.isInteger(at))return result('Choose a start within the booking window, no later than now.');
  if(duration<=0)return result('The booked end has passed. Choose full duration or adjust following bookings.');
  if(at<0||end>closeMinute)return result('This game would run past closing time.');
  if(!Array.isArray(edits)||edits.length>100)return result('Refresh the proposed schedule.');
  const following=bookings.filter(b=>b.id!==session.id&&b.date===session.date&&b.pitch===session.pitch&&b.status==='upcoming'&&b.start>=session.start).sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));
  const overrides=new Map();
  for(const edit of edits){
    if(!edit||typeof edit!=='object'||policy!=='shift'||overrides.has(edit.id)||!following.some(b=>b.id===edit.id)||!Number.isInteger(edit.start))return result('A following booking changed. Refresh the proposed schedule.');
    overrides.set(edit.id,edit.start);
  }
  if(policy==='shift'){
    let cursor=end,scheduleReason='';
    for(const booking of following){
      const start=overrides.has(booking.id)?overrides.get(booking.id):Math.max(booking.start,cursor);
      const finish=start+booking.end-booking.start;
      if(start<booking.start||start<cursor)scheduleReason||='Following bookings must keep their order and cannot start before the preceding game ends.';
      if(finish>closeMinute)return result(booking.team+' would run past closing time. Shorten this game or adjust the schedule.');
      if(start!==booking.start)adjustments.push({id:booking.id,version:booking.version,team:booking.team,fromStart:booking.start,fromEnd:booking.end,start,end:finish,amount:booking.amount,discount:booking.discount||0});
      cursor=finish;
    }
    if(scheduleReason)return result(scheduleReason);
  }
  const moved=new Map(adjustments.map(change=>[change.id,change]));
  const occupied=[{...session,status:'upcoming',start:Math.min(session.start,at),end:Math.max(session.end,end)},
    ...adjustments.map(change=>({...bookings.find(b=>b.id===change.id),...change}))];
  const overlaps=(a,b)=>a.start<b.end&&a.end>b.start;
  const windowFor=b=>occupiedOnDay(b,session.date);
  for(const record of occupied){
    const window=windowFor(record);
    for(const other of bookings){
      if(other.id===record.id||other.pitch!==session.pitch||['noshow','cancelled'].includes(other.status))continue;
      const candidate=other.id===previous?.id?{...other,status:'done'}:{...other,...moved.get(other.id)};
      const otherWindow=windowFor(candidate);
      if(otherWindow&&overlaps(window,otherWindow)){
        if(other.id===previous?.id)return result('The previous game’s booked slot has not ended. Choose a later start.');
        return result('This clock would overlap '+other.team+'. Keep the booked end or adjust following bookings.');
      }
    }
    if(state.holds.some(h=>h.pitch===session.pitch&&new Date(h.expiresAt).getTime()>Date.now()&&windowFor(h)&&overlaps(window,windowFor(h))))return result('The proposed schedule overlaps an active hold.');
    if(state.blocks.some(b=>b.pitch===session.pitch&&b.active!==false&&b.active!==0&&windowFor(b)&&overlaps(window,windowFor(b))))return result('The proposed schedule overlaps maintenance.');
  }
  return result('');
}
