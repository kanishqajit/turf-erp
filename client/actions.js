import { PITCHES, START_HOUR } from './constants.js';
import { dateForAddress, dayOffsetOf, hourRng12, hours, nowMin, rng12, toMin } from './datetime.js';
import { blockAtTime, bookingAtTime, bookingById, bookingWindow, goToDayOffset, holdAtTime, sessionById, statusAtTime, validContact } from './domain.js';
import { apiRequest, loadState, mutate, refreshOperationalState } from './api.js';
import { blankForm, can, S, savePrefs } from './state.js';
import { dateAddress, groupValid } from './views/availability.js';
import { render } from './render.js';

const confirmValid=()=>S.form.team.trim().length>0&&validContact(S.form.contact);
const blockReady=()=>S.blockReason.trim().length>=15;
const accountBookingById=id=>S.accounts.find(booking=>booking.id===id)||bookingById(id);
const pendingKey=(kind,id)=>S.pendingKeys[`${kind}:${id}`]||(S.pendingKeys[`${kind}:${id}`]=crypto.randomUUID());
const clearPendingKey=(kind,id)=>delete S.pendingKeys[`${kind}:${id}`];
function select(dayIndex,hourIndex,pitchIndex,startOffset=0){
  S.sel={di:dayIndex,hi:hourIndex};
  if(pitchIndex!=null)S.pitch=pitchIndex;
  S.customOpen=false;S.groupOpen=false;S.formOpen=false;S.form=blankForm();S.dur=60;S.startOffset=startOffset;S.confirm=null;
}

const selectedStart = () => hours()[S.sel.hi] * 60 + S.startOffset;

function setMatch(session,status){
  if(status==='running'&&session.status!=='running'){S.timerAsk=session.id;return;}
  if(status==='done'&&session.status!=='done'){S.doneAsk=session.id;return;}
  if(status===session.status)return;
  S.actionAsk={kind:'status',id:session.id,target:status,title:status==='noshow'?'Mark no-show':'Change session status',
    subject:`${session.team} · ${rng12(session.start,session.end)} · ${session.status} → ${status}`};
  S.actionReason='';
}

function pickPay(session,status){
  if(!['Payment done','Advance paid'].includes(status))return;
  const outstanding=Math.max(0,session.amount-(session.discount||0)-(session.collected||0));
  if(!outstanding)return;
  S.advAsk=session.id;S.advMode=status==='Payment done'?'settle':'advance';
  const deposit=Math.min(S.settings.depositAmount,outstanding);
  S.advVal=status==='Payment done'?String(outstanding):deposit>0?String(deposit):'';S.advReason='';S.advPayMode='Cash';S.advReference='';
}

async function saveAdvance(){
  const session=sessionById(S.advAsk),amount=Math.max(0,parseInt(S.advVal,10)||0);
  if(!session||amount<=0)return;
  const result=await mutate(`/api/bookings/${encodeURIComponent(session.id)}/payments`,{
    amount,mode:S.advPayMode,settle:S.advMode==='settle',reason:S.advReason,reference:S.advReference,
    idempotencyKey:pendingKey('payment',session.id),version:session.version});
  if(result){clearPendingKey('payment',session.id);S.advAsk=null;S.advVal='';S.advReason='';S.advReference='';}
}

async function saveRefund(){
  const booking=accountBookingById(S.refundAsk),amount=Math.max(0,parseInt(S.refundVal,10)||0);
  if(!booking||amount<=0||amount>booking.collected||S.refundReason.trim().length<5)return;
  const result=await mutate(`/api/bookings/${encodeURIComponent(booking.id)}/refunds`,{
    amount,mode:S.refundPayMode,reason:S.refundReason,reference:S.refundReference,
    idempotencyKey:pendingKey('refund',booking.id),version:booking.version});
  if(result){clearPendingKey('refund',booking.id);S.refundAsk=null;S.refundVal='';S.refundReason='';S.refundReference='';}
}

async function addCustom(){
  const start=toMin(S.cStart);
  const result=await mutate('/api/bookings',{pitch:S.pitch,date:dateForAddress(S.weekOffset,S.cDay),start,end:start+S.cDur,
    team:S.cName.trim(),contact:S.cPhone.trim(),pay:S.cPay,kind:'custom',source:'counter'});
  if(result){S.customOpen=false;S.cName='';S.cPhone='';S.sel=null;}
}

async function addGroup(){
  if(!groupValid())return;
  const start=toMin(S.gStart),groupId='group-'+Date.now();
  const bookings=S.gDates.map(offset=>{const address=dateAddress(offset);return {pitch:S.gPitch,
    date:dateForAddress(address.week,address.di),start,end:start+S.gDur,team:S.gName.trim(),contact:S.gPhone.trim(),
    notes:S.gNotes.trim(),pay:S.gPay,groupType:S.gType,groupId,kind:'group',source:'counter'};});
  const first=dateAddress(S.gDates.slice().sort((a,b)=>a-b)[0]);
  const result=await mutate('/api/bookings/batch',{bookings});
  if(!result)return;
  S.pitch=S.gPitch;S.weekOffset=first.week;S.dayIndex=first.di;S.availMode='day';
  S.sel={di:first.di,hi:Math.floor(start/60)-START_HOUR};S.groupOpen=false;S.gDates=[];S.gName='';S.gPhone='';S.gNotes='';
}

let holdInterval=null,holdStartedAt=0;
function startHold(){
  if(!blockReady())return;
  holdStartedAt=Date.now();clearInterval(holdInterval);
  holdInterval=setInterval(()=>{const progress=Math.min(100,((Date.now()-holdStartedAt)/2000)*100);S.holdPct=progress;
    const fill=document.getElementById('holdFill'),label=document.getElementById('holdLbl');
    if(fill)fill.style.width=progress+'%';if(label)label.textContent='Keep holding… '+Math.round(progress)+'%';
    if(progress>=100)endHold(true);},40);
}

async function submitBlock(){
  if(!blockReady()||!S.sel)return;
  const start=selectedStart();
  const result=await mutate('/api/blocks',{date:dateForAddress(S.weekOffset,S.sel.di),pitch:S.pitch,start,end:start+S.dur,reason:S.blockReason});
  if(result){S.blockOpen=false;S.blockReason='';}S.holdPct=0;
}

async function endHold(done){
  clearInterval(holdInterval);holdInterval=null;
  if(!done){S.holdPct=0;const fill=document.getElementById('holdFill'),label=document.getElementById('holdLbl');
    if(fill)fill.style.width='0%';if(label)label.textContent=blockReady()?'Or press and hold 2s to block':'Write a reason to continue';return;}
  await submitBlock();render();
}

async function confirmAuditedAction(){
  const ask=S.actionAsk,reason=S.actionReason.trim();
  if(!ask||reason.length<5)return;
  let result=null;
  if(ask.kind==='booking'){const current=sessionById(ask.id);result=await mutate(`/api/bookings/${encodeURIComponent(ask.id)}/release`,{reason,version:current?.version});}
  if(ask.kind==='hold')result=await mutate(`/api/holds/${encodeURIComponent(ask.id)}/release`,{reason});
  if(ask.kind==='block')result=await mutate(`/api/blocks/${encodeURIComponent(ask.id)}/release`,{reason});
  if(ask.kind==='status'){const current=sessionById(ask.id);result=await mutate(`/api/bookings/${encodeURIComponent(ask.id)}/status`,{status:ask.target,reason,version:current?.version});}
  if(result){S.actionAsk=null;S.actionReason='';S.sel=null;}
}

async function confirmStaffAction(){
  const ask=S.staffAsk,reason=S.staffReason.trim();if(!ask||reason.length<5)return;
  const path=ask.kind==='revoke'?`/api/users/${encodeURIComponent(ask.id)}/revoke-sessions`
    :`/api/users/${encodeURIComponent(ask.id)}/${ask.kind==='activate'?'activate':'deactivate'}`;
  const result=await mutate(path,{reason});if(result){S.staffAsk=null;S.staffReason='';}
}

function exportAccounts(){
  const quote=value=>`"${String(value??'').replaceAll('"','""')}"`;
  const rows=[['Date','Time','Pitch','Customer','Contact','Status','Amount','Discount','Collected','Outstanding'],
    ...S.accounts.map(booking=>[booking.date,rng12(booking.start,booking.end),PITCHES[booking.pitch]?.name,booking.team,booking.contact,
      booking.status,booking.amount,booking.discount||0,booking.collected||0,Math.max(0,booking.amount-(booking.discount||0)-(booking.collected||0))])];
  const blob=new Blob([rows.map(row=>row.map(quote).join(',')).join('\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=`turf-accounts-${new Date().toISOString().slice(0,10)}.csv`;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function handleClick(event){
  const target=event.target.closest('[data-act]');
  if(!target)return;
  const action=target.dataset.act,value=target.dataset.v,id=target.dataset.id||null;
  const session=id!=null?sessionById(id):null;
  switch(action){
    case 'goto':S.view=value;break;
    case 'dismiss-error':S.apiError='';break;
    case 'logout':
      try{await apiRequest('/api/auth/logout',{method:'POST',body:{}});}catch(_){}
      S.user=null;S.csrf='';S.bookings=[];S.holds=[];S.blocks=[];break;
    case 'create-user':{const result=await mutate('/api/users',{name:S.newName,email:S.newEmail,password:S.newPassword,role:S.newRole});
      if(result){S.newName='';S.newEmail='';S.newPassword='';S.newRole='operator';}break;}
    case 'save-deposit':{const depositAmount=Number(S.depositDraft);if(S.depositDraft===''||!Number.isInteger(depositAmount)||depositAmount<0||depositAmount>50000)return;
      const result=await mutate('/api/settings',{depositAmount});if(result){S.depositDirty=false;S.depositDraft=String(result.settings.depositAmount);}break;}
    case 'toggle-pitch-colors':S.showPitchColors=!S.showPitchColors;if(!S.showPitchColors)S.colorPickerOpen=null;savePrefs();break;
    case 'toggle-pitch-picker':{const pitch=+target.dataset.pi;S.colorPickerOpen=S.colorPickerOpen===pitch?null:pitch;break;}
    case 'set-pitch-color':S.pitchColors[+target.dataset.pi]=value;S.colorPickerOpen=null;savePrefs();break;
    case 'pitch':S.pitch=+value;S.sel=null;break;
    case 'week':S.weekOffset+=+value;S.sel=null;await refreshOperationalState();break;
    case 'avail-mode':S.availMode=value;S.sel=null;break;
    case 'sessions-mode':S.sessionsMode=value;S.focusSession=null;break;
    case 'toggle-band':if(S.collapsedBands[value])delete S.collapsedBands[value];else S.collapsedBands[value]=true;savePrefs();break;
    case 'day-focus':S.dayIndex=+value;S.availMode='day';S.sel=null;break;
    case 'day-jump':goToDayOffset(+value);await refreshOperationalState();break;
    case 'day':{const next=S.dayIndex+(+value);if(next<0){S.dayIndex=6;S.weekOffset-=1;}else if(next>6){S.dayIndex=0;S.weekOffset+=1;}
      else S.dayIndex=next;S.sel=null;await refreshOperationalState();break;}
    case 'slot':select(+target.dataset.di,+target.dataset.hi,+target.dataset.pi,+(target.dataset.offset || 0));break;
    case 'clear-sel':S.sel=null;S.formOpen=false;S.form=blankForm();break;
    case 'sel-primary':{const start=selectedStart(),status=statusAtTime(S.sel.di,S.pitch,start),hour=hours()[S.sel.hi];
      if(status==='free'){if(!bookingWindow(S.sel.di,S.pitch,start,S.dur).ok)return;S.confirm='book';S.formOpen=false;S.form=blankForm();}
      else if(status==='hold'){S.confirm='confirm-hold';S.formOpen=false;S.form=blankForm();}
      else if(status==='blocked'){const block=blockAtTime(S.sel.di,S.pitch,start);if(block&&can('manager')){S.actionAsk={kind:'block',id:block.id,
        title:'Reopen maintenance slot',subject:`${PITCHES[S.pitch].name} · ${rng12(block.start,block.end)}`};S.actionReason='';}}break;}
    case 'sel-hold':S.confirm='hold';S.formOpen=false;S.form=blankForm();break;
    case 'sel-release':{const hold=holdAtTime(S.sel.di,S.pitch,selectedStart());if(hold){S.actionAsk={kind:'hold',id:hold.id,title:'Release active hold',
      subject:`${hold.team} · ${rng12(hold.start,hold.end)}`};S.actionReason='';}break;}
    case 'drop-custom':{const booking=bookingAtTime(S.sel.di,S.pitch,selectedStart());if(booking&&can('manager')){S.actionAsk={kind:'booking',id:booking.id,
      title:'Release confirmed booking',subject:`${booking.team} · ${rng12(booking.start,booking.end)}`};S.actionReason='';}break;}
    case 'booking-account':S.view='accounts';S.accountFocus=id;S.sel=null;break;
    case 'start-offset':S.startOffset=+value;S.blockOpen=false;break;
    case 'dur':{const next=Math.min(240,Math.max(30,S.dur+(+value)));if(+value>0){const hour=hours()[S.sel.hi];
      if(!bookingWindow(S.sel.di,S.pitch,hour*60+S.startOffset,next).ok)return;}S.dur=next;S.blockOpen=false;break;}
    case 'form-pay':S.form.pay=value;break;
    case 'toggle-block':S.blockOpen=!S.blockOpen;if(S.blockOpen){S.startOffset=0;S.dur=60;}S.blockReason='';S.holdPct=0;break;
    case 'block-confirm':await submitBlock();break;
    case 'open-custom':S.customOpen=true;S.groupOpen=false;S.sel=null;S.cDay=S.dayIndex;break;
    case 'close-custom':S.customOpen=false;break;
    case 'c-day':S.cDay=+value;break;
    case 'c-dur':S.cDur=+value;break;
    case 'c-pay':S.cPay=value;break;
    case 'add-custom':if(!(S.cName.trim()&&S.cPhone.trim().length>=6))return;await addCustom();break;
    case 'open-group':S.groupOpen=true;S.customOpen=false;S.sel=null;S.gPitch=S.pitch;S.gDates=[];break;
    case 'close-group':S.groupOpen=false;break;
    case 'g-type':S.gType=value;break;
    case 'g-pitch':S.gPitch=+value;break;
    case 'g-dur':S.gDur=+value;break;
    case 'g-pay':S.gPay=value;break;
    case 'g-date':{const offset=+value;S.gDates=S.gDates.includes(offset)?S.gDates.filter(item=>item!==offset):S.gDates.concat(offset).sort((a,b)=>a-b);break;}
    case 'g-clear-dates':S.gDates=[];break;
    case 'add-group':await addGroup();break;
    case 'dlg-cancel':S.confirm=null;S.form=blankForm();break;
    case 'dlg-confirm':{const mode=S.confirm;if(mode!=='confirm-hold'&&!confirmValid())return;
      const start=selectedStart();
      if(mode==='hold'){const result=await mutate('/api/holds',{date:dateForAddress(S.weekOffset,S.sel.di),pitch:S.pitch,start,end:start+S.dur,...S.form});
        if(result){S.confirm=null;S.formOpen=false;S.form=blankForm();}break;}
      if(mode==='book'&&!bookingWindow(S.sel.di,S.pitch,start,S.dur).ok)return;let result;
      if(mode==='confirm-hold'){const hold=holdAtTime(S.sel.di,S.pitch,start);if(!hold)return;result=await mutate(`/api/holds/${encodeURIComponent(hold.id)}/confirm`);}
      else result=await mutate('/api/bookings',{date:dateForAddress(S.weekOffset,S.sel.di),pitch:S.pitch,start,end:start+S.dur,
        team:S.form.team.trim(),contact:S.form.contact.trim(),notes:S.form.notes,kind:S.startOffset||S.dur!==60?'custom':'standard',source:'counter'});
      if(result){S.confirm=null;S.sel=null;S.dur=60;S.startOffset=0;S.form=blankForm();}break;}
    case 'tl-block':S.blockDetail=id;break;
    case 'block-close':S.blockDetail=null;break;
    case 'block-focus':S.focusSession=id;S.sessionsMode='ledger';S.blockDetail=null;break;
    case 'clear-focus':S.focusSession=null;break;
    case 'match':setMatch(session,value);break;
    case 'pay':pickPay(session,value);break;
    case 'ask-done':S.doneAsk=id;break;
    case 'plus30':await mutate(`/api/bookings/${encodeURIComponent(id)}/extend`,{minutes:30,version:session?.version});break;
    case 'mark-started':S.timerAsk=id;break;
    case 'noshow':setMatch(session,'noshow');break;
    case 'undo-noshow':setMatch(session,'upcoming');break;
    case 'collect':pickPay(session,'Payment done');break;
    case 'timer-cancel':S.timerAsk=null;break;
    case 'timer-start':{const current=sessionById(S.timerAsk);const result=await mutate(`/api/bookings/${encodeURIComponent(current.id)}/status`,
      {status:'running',version:current.version});if(result)S.timerAsk=null;break;}
    case 'done-cancel':S.doneAsk=null;break;
    case 'done-confirm':{const current=sessionById(S.doneAsk);const result=await mutate(`/api/bookings/${encodeURIComponent(current.id)}/status`,
      {status:'done',version:current.version});if(result)S.doneAsk=null;break;}
    case 'done-collect':{const current=sessionById(S.doneAsk);const result=await mutate(`/api/bookings/${encodeURIComponent(current.id)}/status`,
      {status:'done',version:current.version});if(result){S.doneAsk=null;pickPay(sessionById(current.id),'Payment done');}break;}
    case 'adv-cancel':if(S.advAsk)clearPendingKey('payment',S.advAsk);S.advAsk=null;S.advVal='';S.advReason='';S.advReference='';break;
    case 'adv-quick':S.advVal=value;break;
    case 'adv-mode':S.advPayMode=value;S.advReference='';break;
    case 'adv-save':await saveAdvance();break;
    case 'account-clear-focus':S.accountFocus=null;break;
    case 'account-history':S.accountHistory=S.accountHistory===id?null:id;break;
    case 'account-status':S.accountStatus=value;break;
    case 'account-export':exportAccounts();break;
    case 'account-collect':{const booking=accountBookingById(id);if(booking)pickPay(booking,'Payment done');break;}
    case 'account-refund':{const booking=accountBookingById(id);if(booking&&can('manager')&&booking.collected>0){const modes=['Cash','UPI','Card'];
      S.refundPayMode=modes.find(mode=>(booking.collectedByMode?.[mode]||0)>0)||'Cash';S.refundAsk=booking.id;
      S.refundVal=String(booking.collectedByMode?.[S.refundPayMode]||booking.collected);S.refundReason='';S.refundReference='';}break;}
    case 'refund-cancel':if(S.refundAsk)clearPendingKey('refund',S.refundAsk);S.refundAsk=null;S.refundVal='';S.refundReason='';S.refundReference='';break;
    case 'refund-quick':S.refundVal=value;break;
    case 'refund-mode':{S.refundPayMode=value;const booking=accountBookingById(S.refundAsk);S.refundVal=String(booking?.collectedByMode?.[value]||'');S.refundReference='';break;}
    case 'refund-save':await saveRefund();break;
    case 'action-cancel':S.actionAsk=null;S.actionReason='';break;
    case 'action-confirm':await confirmAuditedAction();break;
    case 'alert-timer':S.view='sessions';S.sessionsMode='now';S.timerAsk=id;break;
    case 'alert-resolve':S.view='sessions';S.sessionsMode='ledger';S.focusSession=id;break;
    case 'alert-done':S.view='sessions';S.sessionsMode='now';S.doneAsk=id;break;
    case 'alert-collect':S.view='sessions';S.sessionsMode='now';pickPay(session,'Payment done');break;
    case 'staff-deactivate':case 'staff-activate':case 'staff-revoke':{const staff=S.users.find(user=>user.id===id);if(staff){S.staffAsk={id,kind:action.replace('staff-',''),name:staff.name};S.staffReason='';}break;}
    case 'staff-cancel':S.staffAsk=null;S.staffReason='';break;
    case 'staff-confirm':await confirmStaffAction();break;
    default:return;
  }
  render();
}

async function handleSubmit(event){
  const passwordForm=event.target.closest('[data-password-form]');
  if(passwordForm){event.preventDefault();if(S.busy)return;S.busy=true;S.passwordError='';render();
    try{const result=await apiRequest('/api/auth/change-password',{method:'POST',body:{currentPassword:S.currentPassword,newPassword:S.replacementPassword}});
      S.user={...S.user,...result.user,mustChangePassword:false};S.currentPassword='';S.replacementPassword='';S.confirmPassword='';await loadState();}
    catch(error){S.passwordError=error.message;}finally{S.busy=false;render();}return;}
  const form=event.target.closest('[data-login-form]');if(!form)return;
  event.preventDefault();if(S.busy)return;
  const values=new FormData(form),credentials={email:values.get('email'),password:values.get('password')};
  S.busy=true;S.authError='';render();
  try{const auth=await apiRequest('/api/auth/login',{method:'POST',body:credentials});S.user=auth.user;S.csrf=auth.csrfToken;if(!S.user.mustChangePassword)await loadState();}
  catch(error){S.authError=error.message;}finally{S.busy=false;render();}
}

async function handleInput(event){
  const target=event.target.closest('[data-act]');if(!target)return;
  switch(target.dataset.act){
    case 'form-field':S.form[target.dataset.k]=target.value;refreshGate();break;
    case 'c-field':S[target.dataset.k]=target.value;refreshGate();break;
    case 'c-start':S.cStart=target.value;render();break;
    case 'g-field':S[target.dataset.k]=target.value;refreshGate();break;
    case 'g-start':S.gStart=target.value;render();break;
    case 'day-date':{const [year,month,day]=target.value.split('-').map(Number);if(year&&month&&day){goToDayOffset(dayOffsetOf(new Date(year,month-1,day)));
      await refreshOperationalState();render();}break;}
    case 'adv-val':S.advVal=target.value.replace(/\D/g,'').slice(0,7);if(target.value!==S.advVal)target.value=S.advVal;render();break;
    case 'reason':S.blockReason=target.value;refreshGate();break;
    case 'adv-reason':S.advReason=target.value;refreshGate();break;
    case 'adv-reference':S.advReference=target.value;refreshGate();break;
    case 'refund-val':S.refundVal=target.value.replace(/\D/g,'').slice(0,7);if(target.value!==S.refundVal)target.value=S.refundVal;render();break;
    case 'refund-reason':S.refundReason=target.value;refreshGate();break;
    case 'refund-reference':S.refundReference=target.value;refreshGate();break;
    case 'account-search':S.accountSearch=target.value;render();break;
    case 'account-from':S.accountFrom=target.value;render();break;
    case 'account-to':S.accountTo=target.value;render();break;
    case 'staff-reason':S.staffReason=target.value;refreshGate();break;
    case 'password-field':S[target.dataset.k]=target.value;render();break;
    case 'action-reason':S.actionReason=target.value;refreshGate();break;
    case 'new-user':S[target.dataset.k]=target.value;refreshGate();break;
    case 'new-role':S.newRole=target.value;break;
    case 'deposit-draft':S.depositDraft=target.value.replace(/\D/g,'').slice(0,5);if(target.value!==S.depositDraft)target.value=S.depositDraft;
      S.depositDirty=Number(S.depositDraft)!==S.settings.depositAmount;refreshGate();break;
  }
}

function refreshGate(){
  const count=document.querySelector('.reason-count');if(count)count.textContent=S.blockReason.trim().length+' / 15';
  const hold=document.getElementById('holdBtn'),label=document.getElementById('holdLbl');if(hold){hold.disabled=!blockReady();
    if(label&&S.holdPct===0)label.textContent=blockReady()?'Or press and hold 2s to block':'Write a reason to continue';}
  const blockConfirm=document.querySelector('[data-act="block-confirm"]');if(blockConfirm)blockConfirm.disabled=!blockReady();
  const dialog=document.querySelector('[data-act="dlg-confirm"]');if(dialog){const valid=S.confirm==='confirm-hold'||confirmValid();
    dialog.style.cursor=valid?'pointer':'not-allowed';dialog.style.opacity=valid?1:.45;}
  const custom=document.querySelector('[data-act="add-custom"]');if(custom){const valid=!!(S.cName.trim()&&S.cPhone.trim().length>=6);
    custom.style.cursor=valid?'pointer':'not-allowed';custom.style.opacity=valid?1:.45;}
  const group=document.querySelector('[data-act="add-group"]');if(group)group.disabled=!groupValid();
  const action=document.querySelector('[data-act="action-confirm"]');if(action)action.disabled=S.actionReason.trim().length<5;
  const advance=document.querySelector('[data-act="adv-save"]');if(advance&&S.advAsk){const session=sessionById(S.advAsk),value=Math.max(0,parseInt(S.advVal,10)||0);
    const outstanding=session?Math.max(0,session.amount-(session.discount||0)-(session.collected||0)):0;
    const discounting=S.advMode==='settle'&&value>0&&value<outstanding,referenceOk=S.advPayMode==='Cash'||S.advReference.trim().length>=4;
    advance.disabled=!(value>0&&value<=outstanding&&referenceOk&&(!discounting||(can('manager')&&S.advReason.trim().length>=5)));}
  const refund=document.querySelector('[data-act="refund-save"]');if(refund&&S.refundAsk){const booking=accountBookingById(S.refundAsk),value=Math.max(0,parseInt(S.refundVal,10)||0);
    const available=booking?.collectedByMode?.[S.refundPayMode]||0,referenceOk=S.refundPayMode==='Cash'||S.refundReference.trim().length>=4;
    refund.disabled=!(booking&&value>0&&value<=available&&referenceOk&&S.refundReason.trim().length>=5);}
  const createUser=document.querySelector('[data-act="create-user"]');if(createUser)createUser.disabled=!(S.newName.trim()&&/^\S+@\S+\.\S+$/.test(S.newEmail.trim())&&S.newPassword.length>=12);
  const deposit=document.querySelector('[data-act="save-deposit"]');if(deposit){const amount=Number(S.depositDraft);
    deposit.disabled=!(S.depositDirty&&S.depositDraft!==''&&Number.isInteger(amount)&&amount>=0&&amount<=50000);}
  const staff=document.querySelector('[data-act="staff-confirm"]');if(staff)staff.disabled=S.staffReason.trim().length<5;
}

function handleKeydown(event){
  if(event.key!=='Escape')return;
  if(S.confirm)S.confirm=null;else if(S.staffAsk){S.staffAsk=null;S.staffReason='';}else if(S.actionAsk){S.actionAsk=null;S.actionReason='';}
  else if(S.advAsk!=null){S.advAsk=null;S.advVal='';}else if(S.refundAsk!=null){S.refundAsk=null;S.refundVal='';S.refundReason='';}
  else if(S.doneAsk!=null)S.doneAsk=null;else if(S.timerAsk!=null)S.timerAsk=null;
  else if(S.blockDetail!=null)S.blockDetail=null;else if(S.groupOpen)S.groupOpen=false;else if(S.customOpen)S.customOpen=false;
  else if(S.sel)S.sel=null;else return;render();
}

export function setupActions(){
  document.addEventListener('click',handleClick);
  document.addEventListener('submit',handleSubmit);
  document.addEventListener('input',handleInput);
  document.addEventListener('pointerdown',event=>{const target=event.target.closest('[data-act="hold-block"]');if(target&&!target.disabled&&S.sel)startHold();});
  ['pointerup','pointercancel'].forEach(type=>document.addEventListener(type,()=>{if(holdInterval&&S.sel)endHold(false);},true));
  document.addEventListener('pointerleave',event=>{if(holdInterval&&S.sel&&event.target.closest&&event.target.closest('[data-act="hold-block"]'))endHold(false);},true);
  document.addEventListener('keydown',handleKeydown);
}
