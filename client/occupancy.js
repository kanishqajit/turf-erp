// One occupied-window rule for the API and calendar. Scheduled time is always
// reserved; a running match also owns its remaining play and elapsed pauses.
const dayNumber=date=>Date.parse(date+'T00:00:00Z')/86400000;
export const playingDuration=record=>record.playDuration??(record.end-record.start);
export function occupiedWindow(record,date=record.date,now=Date.now(),timeZone='Asia/Kolkata'){
  const shift=(dayNumber(record.date)-dayNumber(date))*1440;
  let start=record.start,end=record.end;
  if(record.status==='running'){
    const began=record.startedAt??record.start;
    const paused=(record.pausedMilliseconds||0)+(record.pausedAt?Math.max(0,now-record.pausedAt):0);
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
      .formatToParts(new Date(now)).reduce((a,p)=>(a[p.type]=p.value,a),{});
    const current=(dayNumber(`${parts.year}-${parts.month}-${parts.day}`)-dayNumber(record.date))*1440+Number(parts.hour)*60+Number(parts.minute)+Number(parts.second)/60;
    start=Math.min(start,began);
    end=Math.max(end,began+playingDuration(record)+paused/60000,current+1/60);
  }
  return {start:start+shift,end:end+shift};
}
export function occupiedOnDay(record,date,now=Date.now(),timeZone='Asia/Kolkata'){
  const window=occupiedWindow(record,date,now,timeZone);
  const start=Math.max(0,window.start),end=Math.min(1440,window.end);
  return end>start?{start,end}:null;
}
