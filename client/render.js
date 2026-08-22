import { DOW, MON } from './constants.js';
import { isoDate, nowMin, t12, TODAY, TODAY_DI } from './datetime.js';
import { chipCls, esc, sessionsToday } from './domain.js';
import { refreshOperationalState, loginHtml, passwordChangeHtml } from './api.js';
import { S, staffInitials } from './state.js';
import { modalsHtml } from './modals.js';
import { viewAccounts } from './views/accounts.js';
import { buildAlerts, viewAlerts } from './views/alerts.js';
import { countTxt, viewAvailability } from './views/availability.js';
import { viewDashboard } from './views/dashboard.js';
import { viewSessions } from './views/sessions.js';
import { viewSettings } from './views/settings.js';

const VIEWS={availability:viewAvailability,sessions:viewSessions,accounts:viewAccounts,alerts:viewAlerts,dashboard:viewDashboard,settings:viewSettings};
/* Accounts is a first-class view — the whole collections and refunds surface —
   but its only entry was a manager-only action on one booking that had already
   taken money, so an operator could never reach it at all. The actions inside
   it are role-gated on their own; getting to it is not privileged. */
const TABS=[['availability','Availability','Slots'],['sessions','Sessions','Sessions'],
  ['accounts','Accounts','Money'],
  ['alerts','Reminders','Alerts'],['dashboard','Dashboard','Overview']];
const LIVE_VIEWS=new Set(['sessions','alerts']);
const SCROLL_PANES=['liveRail','grid'];
const scrollPane=id=>document.getElementById(id)||document.querySelector(`[data-scroll-pane="${id}"]`);

export function renderTopbar(){
  const topbar=document.getElementById('topbar');
  if(!S.user||S.user.mustChangePassword){topbar.innerHTML='';return;}
  const {game,cash}=buildAlerts(),notifications=game.length+cash.length;
  const running=sessionsToday().filter(session=>session.status==='running').length;
  topbar.innerHTML=`<div class="brand"><div class="mark">TF</div><div class="brand-txt"><b>Turf Operations</b>
    <span>Koramangala &middot; 3 pitches</span></div></div><nav class="tabs">${TABS.map(([view,text,short])=>
    `<button class="${chipCls(S.view===view)} big${view==='alerts'?' nav-alert':''}" data-act="goto" data-v="${view}"><span class="nav-full">${text}</span><span class="nav-short">${short}</span>${view==='alerts'
      ?`<span class="badge"${notifications?'':' hidden'}>${notifications}</span>`:''}</button>`).join('')}</nav><div class="topbar-end">
    <span class="livepill"><i></i>${running} in play &middot; ${t12(nowMin())}</span>
    <span class="today"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="3"></rect><path d="M8 2.8v3.4M16 2.8v3.4M3 9.5h18"></path></svg><span>${DOW[TODAY_DI]}, ${TODAY.getDate()} ${MON[TODAY.getMonth()]}</span></span>
    <button class="cog${S.view==='settings'?' on':''}" title="Settings" aria-label="Settings" data-act="goto" data-v="settings">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button>
    <button class="account" data-act="logout" title="Sign out ${esc(S.user.name)}" aria-label="Sign out ${esc(S.user.name)}"><span class="avatar">${esc(staffInitials())}<i class="avatar-dot" aria-hidden="true"></i></span></button></div>`;
}

/* ── the density switch ──
   Collapsing is the same cards at a different size, not a different board, so
   the change is played rather than cut: every bubble is measured before the
   class flips, then animated from where it was to where it landed. Cutting
   straight to the collapsed grid moves ~112 cells at once and you lose the row
   you were reading; watching them draw in keeps the place. Measured after the
   scroll is restored, so the two rects are in the same frame of reference. */
let flipFrom=null;
const flipKey=el=>el.dataset.pi+':'+el.dataset.di+':'+el.dataset.hi;
const flipCells=()=>document.querySelectorAll('[data-scroll-pane="grid"] .bub[data-hi]');

export function captureBoard(){
  flipFrom=null;
  if(!document.body.animate||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const map=new Map();
  flipCells().forEach(el=>map.set(flipKey(el),el.getBoundingClientRect()));
  if(map.size)flipFrom=map;
}

function playBoard(){
  const from=flipFrom;flipFrom=null;
  if(!from)return;
  flipCells().forEach(el=>{
    const before=from.get(flipKey(el));
    /* The two densities of the all-pitches board are not the same cards: a
       two-hour booking is one card on the timeline and two rows collapsed, so
       some cells have nothing to fly from. Those fade up in place instead of
       appearing between one frame and the next, which keeps the whole switch
       reading as one movement rather than an animation with holes in it. */
    if(!before||!before.width||!before.height){
      el.animate([{opacity:0,transform:'scale(.94)'},{opacity:1,transform:'none'}],
        {duration:260,easing:'cubic-bezier(.22,.61,.36,1)'});
      return;
    }
    const after=el.getBoundingClientRect();
    if(!after.width||!after.height)return;
    const dx=before.left-after.left,dy=before.top-after.top;
    const sx=before.width/after.width,sy=before.height/after.height;
    if(Math.abs(dx)<.5&&Math.abs(dy)<.5&&Math.abs(sx-1)<.01&&Math.abs(sy-1)<.01)return;
    el.animate([{transform:`translate(${dx}px,${dy}px) scale(${sx},${sy})`},{transform:'none'}],
      {duration:340,easing:'cubic-bezier(.22,.61,.36,1)'});
  });
}

export function render(){
  const active=document.activeElement;
  let caret=null;
  try{caret=active?[active.selectionStart,active.selectionEnd]:null;}catch(_){}
  const keep=active&&active.id?{id:active.id,caret}:null;
  const scrolls=SCROLL_PANES.map(id=>{const element=scrollPane(id);return element?{id,top:element.scrollTop,left:element.scrollLeft}:null;}).filter(Boolean);
  renderTopbar();
  if(!S.user){document.getElementById('view').innerHTML=loginHtml();document.getElementById('modals').innerHTML='';return;}
  if(S.user.mustChangePassword){document.getElementById('view').innerHTML=passwordChangeHtml();document.getElementById('modals').innerHTML='';return;}
  const error=S.apiError?`<div class="error-banner app-error" role="alert"><span>${esc(S.apiError)}</span>
    <button data-act="dismiss-error" aria-label="Dismiss">&times;</button></div>`:'';
  document.getElementById('view').innerHTML=error+VIEWS[S.view]();
  const modalRoot=document.getElementById('modals'),hadModal=!!modalRoot.querySelector('[role="dialog"]');
  modalRoot.innerHTML=modalsHtml();
  const dialog=modalRoot.querySelector('[role="dialog"]'),blocked=!!dialog;
  document.getElementById('topbar').inert=blocked;document.getElementById('view').inert=blocked;
  if(dialog&&!hadModal)(dialog.querySelector('input,textarea,select,button')||dialog).focus();
  scrolls.forEach(scroll=>{const element=scrollPane(scroll.id);if(element){element.scrollTop=scroll.top;element.scrollLeft=scroll.left;}});
  if(keep){const next=document.getElementById(keep.id);if(next){next.focus();if(keep.caret&&keep.caret[0]!=null){try{next.setSelectionRange(keep.caret[0],keep.caret[1]);}catch(_){}}}}
  playBoard();
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
  if(!grid)return;
  /* The board bar above it is sticky too, so the offset the column heads park at
     is whatever their own `top` resolves to. Reading it beats hardcoding the
     topbar height, which stopped being the whole story the moment a second bar
     started sticking above them. */
  const parkAt=parseFloat(getComputedStyle(grid).top)||0;
  setStuck(grid,grid.getBoundingClientRect().top<=parkAt+1,animate);
}

/* The availability board is not a live view — repainting three columns of cards
   every second to advance a ring would be absurd — so the running cards are
   nudged in place on the same tick that moves the now-line.

   A running card's data-from/data-to are the clock's window, not the booked
   one: they are the same thing only when the session started on time, and this
   tick would otherwise overwrite the rendered countdown with a count to the
   booked end a second after the card was drawn. */
export function syncLiveCards(){
  const now = nowMin();
  document.querySelectorAll('.schedule-bub.is-running').forEach(card => {
    const from = +card.dataset.from, to = +card.dataset.to;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
    const fill = card.querySelector('.tm-ring-fill');
    if (fill) fill.style.strokeDasharray =
      `${Math.min(100, Math.max(0, ((now - from) / (to - from)) * 100)).toFixed(2)} 100`;
    const count = card.querySelector('[data-count]');
    /* countTxt returns markup — the seconds sit in their own element so they can
       ride a size down. Digits and tags only; no user data reaches this. */
    if (count) count.innerHTML = countTxt(to);
  });
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
  const bootDay=isoDate(new Date());
  addEventListener('scroll',()=>{if(!stuckRaf)stuckRaf=requestAnimationFrame(()=>syncStuck());},{passive:true});
  setInterval(()=>{if(isoDate(new Date())!==bootDay){location.reload();return;}if(!S.user)return;if(LIVE_VIEWS.has(S.view))render();else{renderTopbar();if(S.view==='availability'){syncNowLine();syncLiveCards();}}},1000);
  setInterval(async()=>{if(!S.user||S.busy)return;await refreshOperationalState();render();},15000);
}
