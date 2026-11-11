import { TODAY, isoDate } from './datetime.js';
import { can, applyTheme, loadPrefs, S } from './state.js';
import { esc, weekStart } from './domain.js';

export async function apiRequest(path, { method='GET', body, signal } = {}){
  const requestUser=S.user;
  const headers = { Accept:'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET','HEAD'].includes(method) && S.csrf) headers['X-CSRF-Token'] = S.csrf;
  const response = await fetch(path, {
    method, headers, signal, credentials:'same-origin', body:body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok){
    if (response.status === 401&&S.user===requestUser){ S.user = null; S.csrf = ''; S.dataKey=null; }
    const apiUnavailable = path.startsWith('/api/') && [404, 405, 501].includes(response.status);
    const error = new Error(data.error?.message || (apiUnavailable
      ? 'The Turf Operations API is not running at this address. Start the app with npm start and open the URL printed in the terminal.'
      : `Request failed (${response.status}).`));
    error.code = data.error?.code;
    error.details = data.error?.details;
    error.status=response.status;
    throw error;
  }
  return data;
}

function stateRange(){
  const fromDate = weekStart(), toDate = new Date(fromDate);
  toDate.setDate(toDate.getDate() + (S.groupOpen?Math.max(20,(S.dayIndex||0)+(S.gRange||14)-1):20));
  return { from:isoDate(fromDate), to:isoDate(toDate) };
}

function accountRange(){
  const fromDate=new Date(TODAY),toDate=new Date(TODAY);
  fromDate.setDate(fromDate.getDate()-180);toDate.setDate(toDate.getDate()+180);
  return { from:S.accountFrom||isoDate(fromDate),to:S.accountTo||isoDate(toDate) };
}

const stateFlights=new Map();
let stateOwner=null,stateVersion=0,sessionEpoch=0,failedKey=null,operationOrder=0,lastAppliedOrder=0;

function desktopQuery(){
  const {from,to}=stateRange(),accounts=accountRange(),include=[];
  if(S.view==='accounts')include.push('accounts');
  if(S.view==='settings'){
    if(can('manager'))include.push('audit');
    if(can('owner'))include.push('users');
  }
  const query=new URLSearchParams({from,to,include:include.join(',')});
  if(include.includes('accounts')){query.set('accountsFrom',accounts.from);query.set('accountsTo',accounts.to);}
  if(S.groupOpen)query.set('groupRange','1');
  return query;
}
const keyFor=(query,userId=S.user?.id,epoch=sessionEpoch)=>epoch+':'+(userId||'')+':'+query;
export function stateReady(){
  if(!S.dataKey)return false;
  const query=desktopQuery();
  if(S.dataKey===keyFor(query))return true;
  // A freshly loaded Accounts/Settings response also contains the same board.
  // Reuse that superset without replaying an older cached snapshot.
  if(query.get('include'))return false;
  const prefix=sessionEpoch+':'+(S.user?.id||'')+':';
  if(!S.dataKey.startsWith(prefix))return false;
  const loaded=new URLSearchParams(S.dataKey.slice(prefix.length));
  loaded.set('include','');loaded.delete('accountsFrom');loaded.delete('accountsTo');
  return loaded.toString()===query.toString();
}
export function ensureViewData(onSettled){
  if(!S.user||S.user.mustChangePassword)return;
  const key=keyFor(desktopQuery());
  if(stateReady()||failedKey===key||stateFlights.has(key))return;
  void loadState().catch(()=>{}).finally(onSettled);
}

function applyDesktop(data,query,order){
  if(order<lastAppliedOrder)return;
  lastAppliedOrder=order;
  if(S.apiError===S.dataError)S.apiError='';
  if(stateOwner!==data.user.id){
    S.bookings=[];S.holds=[];S.blocks=[];S.checkedIn={};
    S.accounts=[];S.paymentEvents=[];S.audit=[];S.users=[];stateOwner=data.user.id;
  }
  S.user=data.user;S.csrf=data.csrfToken;
  if(!data.user.mustChangePassword){
    S.bookings=data.state.bookings;S.holds=data.state.holds;S.blocks=data.state.blocks;
    S.checkedIn=Object.fromEntries(S.bookings.filter(b=>b.checkedInAt).map(b=>[b.id,b.checkedInAt]));
    S.settings=data.state.settings||{depositAmount:500};
    if(!S.depositDirty)S.depositDraft=String(S.settings.depositAmount);
    if(data.accounts){S.accounts=data.accounts.bookings;S.paymentEvents=data.accounts.payments;}
    if(data.audit){S.audit=data.audit;S.auditError='';}
    if(data.users)S.users=data.users;
    if(!can('manager'))S.audit=[];
    if(!can('owner'))S.users=[];
  }
  S.dataKey=keyFor(query);S.dataError='';failedKey=null;S.lastSyncedAt=Date.now();
}

export async function loadState({force=false}={}){
  const query=desktopQuery(),initialUser=S.user?.id,epoch=sessionEpoch,key=keyFor(query);
  const existing=stateFlights.get(key);
  if(existing&&!force&&existing.version===stateVersion)return existing.promise;
  for(const [otherKey,flight] of stateFlights){
    if(otherKey!==key||force||flight.version!==stateVersion){flight.controller.abort();stateFlights.delete(otherKey);}
  }
  const controller=new AbortController(),version=stateVersion;
  failedKey=null;if(S.apiError===S.dataError)S.apiError='';S.dataError='';
  const flight={controller,version,order:++operationOrder,promise:null};
  const current=()=>sessionEpoch===epoch&&S.user?.id===initialUser&&keyFor(desktopQuery())===key&&stateVersion===version&&stateFlights.get(key)===flight;
  flight.promise=(async()=>{
    try{
      const data=await apiRequest('/api/desktop?'+query,{signal:controller.signal});
      if(current())applyDesktop(data,query,flight.order);
    }catch(error){
      if(current()&&error.name!=='AbortError'){
        failedKey=key;S.dataKey=null;S.dataError=error.message;S.apiError=error.message;
      }
      if(error.name!=='AbortError')throw error;
    }finally{if(stateFlights.get(key)===flight)stateFlights.delete(key);}
  })();
  stateFlights.set(key,flight);
  return flight.promise;
}

export async function mutate(path, body = {}){
  if(S.busy)return null;
  S.busy=true;S.apiError='';
  const userId=S.user?.id,epoch=sessionEpoch,query=desktopQuery(),key=keyFor(query);
  const version=++stateVersion,order=++operationOrder;
  for(const flight of stateFlights.values())flight.controller.abort();
  stateFlights.clear();
  try{
    query.set('refresh','desktop');
    const result=await apiRequest(path+(path.includes('?')?'&':'?')+query,{method:'POST',body});
    query.delete('refresh');
    if(S.user?.id===userId&&sessionEpoch===epoch){
      if(result.desktop&&keyFor(desktopQuery())===key&&version===stateVersion&&order>=lastAppliedOrder)applyDesktop(result.desktop,query,order);
      else{
        // The save is acknowledged, but the user may now be on another date or
        // screen. Invalidate the old snapshot and refresh the current context.
        S.dataKey=null;
        try{await loadState({force:true});}
        catch(error){S.apiError='Change saved, but the screen could not refresh: '+error.message;}
      }
    }
    return result;
  }catch(error){if(S.user?.id===userId&&sessionEpoch===epoch)S.apiError=error.message;return null;}
  finally{S.busy=false;}
}

export async function signOut(){
  if(S.busy)return false;
  S.busy=true;S.apiError='';
  try{
    await apiRequest('/api/auth/logout',{method:'POST',body:{}});
    sessionEpoch++;stateVersion++;stateOwner=null;failedKey=null;
    for(const flight of stateFlights.values())flight.controller.abort();stateFlights.clear();
    Object.assign(S,{user:null,csrf:'',dataKey:null,dataError:'',apiError:'',authError:'',
      bookings:[],holds:[],blocks:[],accounts:[],paymentEvents:[],audit:[],users:[],checkedIn:{},pendingKeys:{},
      sel:null,confirm:null,customOpen:false,groupOpen:false,blockOpen:false,blockDetail:null,
      advAsk:null,refundAsk:null,actionAsk:null,staffAsk:null,timerAsk:null,doneAsk:null,
      currentPassword:'',replacementPassword:'',confirmPassword:'',newPassword:''});
    return true;
  }catch(error){S.apiError='Sign-out could not be confirmed. You are still signed in. Please retry. '+error.message;return false;}
  finally{S.busy=false;}
}

export async function refreshOperationalState(options){
  if(options?.ifNeeded&&stateReady()&&Date.now()-S.lastSyncedAt<15000)return;
  try{await loadState(options);}catch{/* The current request owns its error state. */}
}

export async function boot(onReady){
  loadPrefs();
  /* Straight after the preference is read and before anything renders, so the
     page does not flash light on its way into dark. */
  applyTheme();
  try {
    await loadState();
  } catch (error){
    if (error.code !== 'authentication_required') S.authError = error.message;
  }
  S.ready = true;
  onReady();
}

export function loginHtml(){
  if (!S.ready) return '<main class="auth"><div class="authcard"><div class="mark">TF</div><h1>Loading Turf Operations</h1></div></main>';
  return `<main class="auth"><form class="authcard" data-login-form>
    <div class="mark">TF</div>
    <div><span class="modal-kicker">Secure operator console</span><h1>Turf Operations</h1>
      <p>Sign in with the account issued by the venue owner.</p></div>
    ${S.authError ? `<div class="error-banner" role="alert">${esc(S.authError)}</div>` : ''}
    <label><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
    <label><span>Password</span><input name="password" type="password" autocomplete="current-password" minlength="12" required></label>
    <button class="dbtn primary wide" type="submit"${S.busy ? ' disabled' : ''}>${S.busy ? 'Signing in…' : 'Sign in'}</button>
  </form></main>`;
}

export function passwordChangeHtml(){
  const valid=S.currentPassword.length>=12&&S.replacementPassword.length>=12&&S.replacementPassword.length<=256
    &&S.replacementPassword===S.confirmPassword&&S.replacementPassword!==S.currentPassword;
  return `<main class="auth"><form class="authcard" data-password-form><div class="mark">TF</div>
    <div><span class="modal-kicker">Account protection</span><h1>Change temporary password</h1>
    <p>Create a private password before entering the operations console. Other sessions for this account will be revoked.</p></div>
    ${S.passwordError?`<div class="error-banner" role="alert">${esc(S.passwordError)}</div>`:''}
    <label><span>Current temporary password</span><input id="current-password" name="currentPassword" data-act="password-field" data-k="currentPassword" value="${esc(S.currentPassword)}" type="password" autocomplete="current-password" minlength="12" maxlength="256" required></label>
    <label><span>New password</span><input id="replacement-password" name="newPassword" data-act="password-field" data-k="replacementPassword" value="${esc(S.replacementPassword)}" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label>
    <label><span>Confirm new password</span><input id="confirm-password" name="confirmPassword" data-act="password-field" data-k="confirmPassword" value="${esc(S.confirmPassword)}" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label>
    <button class="dbtn primary wide" type="submit"${valid&&!S.busy?'':' disabled'}>${S.busy?'Changing password…':'Change password'}</button>
    <button class="dbtn ghost wide" type="button" data-act="logout">Sign out and use another account</button>
  </form></main>`;
}
