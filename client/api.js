import { TODAY, isoDate } from './datetime.js';
import { can, loadPrefs, S } from './state.js';
import { esc, weekStart } from './domain.js';

export async function apiRequest(path, { method='GET', body } = {}){
  const headers = { Accept:'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET','HEAD'].includes(method) && S.csrf) headers['X-CSRF-Token'] = S.csrf;
  const response = await fetch(path, {
    method, headers, credentials:'same-origin', body:body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok){
    if (response.status === 401){ S.user = null; S.csrf = ''; }
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

export async function loadState(){
  const { from, to } = stateRange();
  const states = [await apiRequest(`/api/state?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)];
  const today = isoDate(TODAY);
  if (today < from || today > to) states.push(await apiRequest(`/api/state?from=${today}&to=${today}`));
  const merge = key => Array.from(new Map(states.flatMap(state => state[key]).map(record => [record.id, record])).values());
  S.bookings = merge('bookings');
  S.holds = merge('holds');
  S.blocks = merge('blocks');
  S.settings = states[0].settings || { depositAmount:500 };
  if (!S.depositDirty) S.depositDraft = String(S.settings.depositAmount);
  if (can('manager')){
    try { S.audit = (await apiRequest('/api/audit?limit=50')).events; }
    catch (_) { S.audit = []; }
  } else S.audit = [];
}

export async function mutate(path, body = {}){
  if (S.busy) return null;
  S.busy = true;
  S.apiError = '';
  try {
    const result = await apiRequest(path, { method:'POST', body });
    await loadState();
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
  try {
    const auth = await apiRequest('/api/auth/me');
    S.user = auth.user;
    S.csrf = auth.csrfToken;
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
