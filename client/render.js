import { DOW, MON } from './constants.js';
import { nowMin, t12, TODAY, TODAY_DI } from './datetime.js';
import { chipCls, esc, sessionsToday } from './domain.js';
import { refreshOperationalState, loginHtml } from './api.js';
import { S, staffInitials } from './state.js';
import { modalsHtml } from './modals.js';
import { buildAlerts, viewAlerts } from './views/alerts.js';
import { viewAvailability } from './views/availability.js';
import { viewDashboard } from './views/dashboard.js';
import { viewSessions } from './views/sessions.js';
import { viewSettings } from './views/settings.js';

const VIEWS={availability:viewAvailability,sessions:viewSessions,alerts:viewAlerts,dashboard:viewDashboard,settings:viewSettings};
const TABS=[['availability','Availability'],['sessions','Sessions'],['alerts','Reminders'],['dashboard','Dashboard']];
const LIVE_VIEWS=new Set(['sessions','alerts']);
const SCROLL_PANES=['liveRail','grid'];
const scrollPane=id=>document.getElementById(id)||document.querySelector(`[data-scroll-pane="${id}"]`);

export function renderTopbar(){
  const topbar=document.getElementById('topbar');
  if(!S.user){topbar.innerHTML='';return;}
  const {game,cash}=buildAlerts(),notifications=game.length+cash.length;
  const running=sessionsToday().filter(session=>session.status==='running').length;
  topbar.innerHTML=`<div class="brand"><div class="mark">TF</div><div class="brand-txt"><b>Turf Operations</b>
    <span>Koramangala &middot; 3 pitches</span></div></div><nav class="tabs">${TABS.map(([view,text])=>
    `<button class="${chipCls(S.view===view)} big" data-act="goto" data-v="${view}">${text}</button>${view==='alerts'
      ?`<span class="badge"${notifications?'':' hidden'}>${notifications}</span>`:''}`).join('')}</nav><div class="topbar-end">
    <span class="livepill"><i></i>${running} in play &middot; ${t12(nowMin())}</span>
    <span class="today">${DOW[TODAY_DI]}, ${TODAY.getDate()} ${MON[TODAY.getMonth()]} ${TODAY.getFullYear()}</span>
    <button class="cog${S.view==='settings'?' on':''}" title="Settings" aria-label="Settings" data-act="goto" data-v="settings">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button>
    <button class="account" data-act="logout" title="Sign out ${esc(S.user.name)}"><span class="avatar">${esc(staffInitials())}</span>
    <span><b>${esc(S.user.name)}</b><small>${esc(S.user.role)}</small></span></button></div>`;
}

export function render(){
  const active=document.activeElement;
  let caret=null;
  try{caret=active?[active.selectionStart,active.selectionEnd]:null;}catch(_){}
  const keep=active&&active.id?{id:active.id,caret}:null;
  const scrolls=SCROLL_PANES.map(id=>{const element=scrollPane(id);return element?{id,top:element.scrollTop,left:element.scrollLeft}:null;}).filter(Boolean);
  renderTopbar();
  if(!S.user){document.getElementById('view').innerHTML=loginHtml();document.getElementById('modals').innerHTML='';return;}
  const error=S.apiError?`<div class="error-banner app-error" role="alert"><span>${esc(S.apiError)}</span>
    <button data-act="dismiss-error" aria-label="Dismiss">&times;</button></div>`:'';
  document.getElementById('view').innerHTML=error+VIEWS[S.view]();
  document.getElementById('modals').innerHTML=modalsHtml();
  scrolls.forEach(scroll=>{const element=scrollPane(scroll.id);if(element){element.scrollTop=scroll.top;element.scrollLeft=scroll.left;}});
  if(keep){const next=document.getElementById(keep.id);if(next){next.focus();if(keep.caret&&keep.caret[0]!=null){try{next.setSelectionRange(keep.caret[0],keep.caret[1]);}catch(_){}}}}
  syncStuck(false);
}

let stuckRaf=0;
const STICKY_MOVERS=['.gridcard-head','.dayjump','.pitchpicker','.pitchstrip','.daystrip'];
function setStuck(grid,next,animate){
  if(grid.classList.contains('stuck')===next)return;
  if(!animate||matchMedia('(prefers-reduced-motion: reduce)').matches||!grid.animate){grid.classList.add('measuring');grid.classList.toggle('stuck',next);
    void grid.offsetHeight;grid.classList.remove('measuring');return;}
  const movers=STICKY_MOVERS.map(selector=>grid.querySelector(selector)).filter(Boolean);
  const beforeHeight=grid.getBoundingClientRect().height,before=new Map(movers.map(element=>[element,element.getBoundingClientRect()]));
  [grid,...movers].forEach(element=>(element.getAnimations?element.getAnimations():[]).forEach(animation=>animation.cancel()));
  grid.classList.add('measuring');grid.classList.toggle('stuck',next);
  const afterHeight=grid.getBoundingClientRect().height,after=new Map(movers.map(element=>[element,element.getBoundingClientRect()]));
  grid.classList.remove('measuring');
  const timing={duration:280,easing:'cubic-bezier(.22,1,.36,1)'};
  grid.animate([{height:beforeHeight+'px'},{height:afterHeight+'px'}],timing);
  movers.forEach(element=>{const nextBox=after.get(element),priorBox=before.get(element),dx=priorBox.left-nextBox.left,dy=priorBox.top-nextBox.top;
    if(Math.abs(dx)<.5&&Math.abs(dy)<.5)return;element.animate([{transform:`translate3d(${dx}px,${dy}px,0)`,transformOrigin:'top left'},
      {transform:'translate3d(0,0,0)',transformOrigin:'top left'}],timing);});
}

export function syncStuck(animate=true){
  stuckRaf=0;
  const grid=document.querySelector('.gridsticky');
  if(grid)setStuck(grid,grid.getBoundingClientRect().top<=71,animate);
}

export function syncNowLine(){
  const line=document.querySelector('[data-now-line]');
  if(!line)return;
  const now=nowMin(),hour=Math.floor(now/60);
  if(line.dataset.scheduleNow!=null){
    line.style.setProperty('--now-row',(now-(+line.dataset.startHour*60))/30);
    const label=line.querySelector('b');if(label)label.textContent=t12(now);
    return;
  }
  if(+line.dataset.hour!==hour){render();return;}
  line.style.setProperty('--now-offset',((now%60)/60)*44+'px');
  const label=line.querySelector('.now-line-label');if(label)label.textContent=t12(now);
}

export function startRendering(){
  addEventListener('scroll',()=>{if(!stuckRaf)stuckRaf=requestAnimationFrame(()=>syncStuck());},{passive:true});
  setInterval(()=>{if(!S.user)return;if(LIVE_VIEWS.has(S.view))render();else{renderTopbar();if(S.view==='availability')syncNowLine();}},1000);
  setInterval(async()=>{if(!S.user||S.busy)return;await refreshOperationalState();render();},15000);
}
