const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=minute=>{const h=Math.floor(minute/60)%24;return (h%12||12)+':'+String(minute%60).padStart(2,'0')+(h>=12?' PM':' AM');};
const timeValue=minute=>String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
export function startOptionsHtml(session,plan){
  const choices=[['scheduled','Keep booked end','Ends '+clock(session.end)],['full','Full duration',(session.end-session.start)+' min of play'],['shift','Adjust following','Preview new times']];
  return `<div class="start-choices" role="group" aria-label="Playing time">${choices.map(([value,title,note])=>`<button class="start-policy${plan.policy===value?' on':''}" data-act="timer-policy" data-v="${value}" aria-pressed="${plan.policy===value}"><b>${title}</b><span>${note}</span></button>`).join('')}</div>
  <p class="start-summary">${plan.duration>0?safe(plan.duration)+' min of play · ends '+clock(plan.end):'Choose a new finish time.'}</p>
  ${plan.adjustments.length?`<div class="start-preview"><b>Following bookings · ${plan.adjustments.length} change${plan.adjustments.length===1?'':'s'}</b>${plan.adjustments.map(row=>`<label class="start-shift"><span>${safe(row.team)}<small>${clock(row.fromStart)} – ${clock(row.fromEnd)} → ${clock(row.start)} – ${clock(row.end)}</small></span><input id="shift-${safe(row.id)}" type="time" step="60" min="${timeValue(row.fromStart)}" aria-label="New start for ${safe(row.team)}" data-act="timer-shift" data-model="timer-shift" data-id="${safe(row.id)}" value="${timeValue(row.start)}"></label>`).join('')}<p>Confirm the new times with the affected teams before saving.</p></div>`:''}
  <p class="start-charge">Agreed charges and recorded payments stay the same.</p>`;
}
