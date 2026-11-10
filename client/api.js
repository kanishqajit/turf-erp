import { TODAY, isoDate } from './datetime.js';
import { can, applyTheme, loadPrefs, S } from './state.js';
import { esc, weekStart } from './domain.js';

export async function apiRequest(path, { method='GET', body } = {}){
  const requestUser=S.user;
  const headers = { Accept:'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET','HEAD'].includes(method) && S.csrf) headers['X-CSRF-Token'] = S.csrf;
  const response = await fetch(path, {
    method, headers, credentials:'same-origin', body:body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok){
    if (response.status === 401&&S.user===requestUser){ S.user = null; S.csrf = ''; }
    const apiUnavailable = path.startsWith('/api/') && [404, 405, 501].includes(response.status);
    const error = new Error(data.error?.message || (apiUnavailable
      ? 'The Turf Operations API is not running at this address. Start the app with npm start and open the URL printed in the terminal.'
      : `Request failed (${response.status}).`));
    error.code = data.error?.code;
    error.details = data.error?.details;
    throw error;
  }
  return data;
}

function stateRange(){
  const fromDate = weekStart(), toDate = new Date(fromDate);
  toDate.setDate(toDate.getDate() + 20);
  return { from:isoDate(fromDate), to:isoDate(toDate) };
}

function accountRange(){
  const fromDate=new Date(TODAY),toDate=new Date(TODAY);
  fromDate.setDate(fromDate.getDate()-180);toDate.setDate(toDate.getDate()+180);
  return { from:isoDate(fromDate),to:isoDate(toDate) };
}

let stateFlight=null,stateOwner=null,stateVersion=0;

function desktopQuery(){
  const {from,to}=stateRange(),accounts=accountRange(),include=[];
  if(S.view==='accounts')include.push('accounts');
  if(S.view==='settings'){
    if(can('manager'))include.push('audit');
    if(can('owner'))include.push('users');
  }
  return new URLSearchParams({from,to,include:include.join(','),accountsFrom:accounts.from,accountsTo:accounts.to});
}

function applyDesktop(data){
  if(stateOwner!==data.user.id){
    S.bookings=[];S.holds=[];S.blocks=[];S.checkedIn={};
    S.accounts=[];S.paymentEvents=[];S.audit=[];S.users=[];stateOwner=data.user.id;
  }
  S.user=data.user;S.csrf=data.csrfToken;
  if(data.user.mustChangePassword)return;
  S.bookings=data.state.bookings;S.holds=data.state.holds;S.blocks=data.state.blocks;
  S.checkedIn=Object.fromEntries(S.bookings.filter(b=>b.checkedInAt).map(b=>[b.id,b.checkedInAt]));
  S.settings=data.state.settings||{depositAmount:500};
  if(!S.depositDirty)S.depositDraft=String(S.settings.depositAmount);
  if(data.accounts){S.accounts=data.accounts.bookings;S.paymentEvents=data.accounts.payments;}
  if(data.audit){S.audit=data.audit;S.auditError='';}
  if(data.users)S.users=data.users;
  if(!can('manager'))S.audit=[];
  if(!can('owner'))S.users=[];
  S.lastSyncedAt=Date.now();
}

export async function loadState({force=false}={}){
  const query=desktopQuery(),initialUser=S.user?.id,key=(initialUser||'')+':'+query;
  if(stateFlight?.key===key){
    if(!force)return stateFlight.promise;
    await stateFlight.promise.catch(()=>{});
  }
  const version=++stateVersion;
  const promise=(async()=>{
    const data=await apiRequest('/api/desktop?'+query);
    // A response from an old range or signed-out session cannot replace newer
    // screen data or repopulate a shared console after logout.
    if(version===stateVersion&&S.user?.id===initialUser)applyDesktop(data);
  })();
  const flight={key,promise};stateFlight=flight;
  try{return await promise;}finally{if(stateFlight===flight)stateFlight=null;}
}

export async function mutate(path, body = {}){
  if (S.busy) return null;
  S.busy = true;
  S.apiError = '';
  try {
    const userId=S.user?.id;
    ++stateVersion;
    const query=desktopQuery();query.set('refresh','desktop');
    const result = await apiRequest(path+(path.includes('?')?'&':'?')+query, { method:'POST', body });
    try {
      if(S.user?.id===userId){
        if(result.desktop)applyDesktop(result.desktop);
        else await loadState({force:true});
      }
    }
    catch (error){ S.apiError=`Change saved, but the screen could not refresh: ${error.message}`; }
    return result;
  } catch (error){
    S.apiError = error.message;
    return null;
  } finally { S.busy = false; }
}

export async function refreshOperationalState(){
  try { await loadState(); S.apiError = ''; }
  catch (error){ S.apiError = error.message; }
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
