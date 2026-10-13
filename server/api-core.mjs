import { Buffer } from 'node:buffer';
import { ProductError } from './store.mjs';

export function createApi(persistence,env={}){
const store=persistence.store,customerApi=persistence.customer;
const SESSION_COOKIE='turf_session',CUSTOMER_COOKIE='futly_customer';
const loginAttempts = new Map();
const mutationAttempts = new Map();
const trustProxy = env.TRUST_PROXY === '1';

function securityHeaders(res, api = false){
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'",
    "form-action 'self'", "script-src 'self'", "connect-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:",
  ].join('; '));
  if (api) res.setHeader('Cache-Control', 'no-store');
}

function json(res, status, payload, extra = {}){
  securityHeaders(res, true);
  for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Content-Length':Buffer.byteLength(body) });
  res.end(body);
}

function parseCookies(req){
  const result = {};
  for (const part of String(req.headers.cookie || '').split(';')){
    const i = part.indexOf('=');
    if (i > 0){
      try { result[part.slice(0,i).trim()] = decodeURIComponent(part.slice(i+1).trim()); }
      catch (_) { /* Ignore malformed cookies instead of turning them into a server error. */ }
    }
  }
  return result;
}

function sessionCookie(token, expiresAt){
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}
function clearCookie(){
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

async function readJson(req){
  if(Object.hasOwn(req,'parsedBody'))return req.parsedBody;
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new ProductError(415, 'json_required', 'Requests with a body must use application/json.');
  let bytes = 0, raw = '';
  for await (const chunk of req){
    bytes += chunk.length;
    if (bytes > 64 * 1024) throw new ProductError(413, 'body_too_large', 'Request body is too large.');
    raw += chunk;
  }
  if (!raw) return req.parsedBody={};
  try {
    const body=JSON.parse(raw);
    if(!body||typeof body!=='object'||Array.isArray(body))throw new ProductError(400,'invalid_json','Request body must be a JSON object.');
    return req.parsedBody=body;
  }
  catch (_) { throw new ProductError(400, 'invalid_json', 'Request body must be valid JSON.'); }
}

function requestUser(req){
  return store.sessionUser(parseCookies(req)[SESSION_COOKIE]);
}

function requireUser(req){
  const user = requestUser(req);
  if (!user) throw new ProductError(401, 'authentication_required', 'Sign in to continue.');
  return user;
}

function requireCsrf(req, user){
  const token = String(req.headers['x-csrf-token'] || '');
  if (!token || token !== user.csrf_token) throw new ProductError(403, 'invalid_csrf', 'The security token is missing or expired.');
  const origin = req.headers.origin;
  if (origin){
    const proto = trustProxy ? String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
      : req.socket && req.socket.encrypted ? 'https' : 'http';
    const expected = `${proto}://${req.headers.host}`;
    if (origin !== expected) throw new ProductError(403, 'invalid_origin', 'Cross-origin changes are not allowed.');
  }
}

const actor = row => ({ id:row.id, email:row.email, name:row.name, role:row.role,
  mustChangePassword:!!row.must_change_password, session_id:row.session_id });
const publicActor = row => { const value=actor(row); delete value.session_id; return value; };
const routeMatch = (pathname, pattern) => pathname.match(pattern);

function requestIp(req){
  return trustProxy
    ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim()
    : String(req.socket.remoteAddress || 'unknown');
}

function recentAttempts(key, windowMs){
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter(at => now - at < windowMs);
  loginAttempts.set(key,attempts);
  return attempts;
}

function checkLoginLimit(req,email){
  const ipKey=`ip:${requestIp(req)}`, accountKey=`account:${String(email || '').trim().toLowerCase()}`;
  if (recentAttempts(ipKey,15*60*1000).length >= 20 || recentAttempts(accountKey,15*60*1000).length >= 5)
    throw new ProductError(429, 'login_rate_limited', 'Too many failed sign-in attempts. Try again in 15 minutes.');
  return { ipKey,accountKey };
}
function recordLoginFailure(keys){ const now=Date.now(); for (const key of Object.values(keys)) loginAttempts.set(key,recentAttempts(key,15*60*1000).concat(now)); }
function clearLoginFailures(keys){ for (const key of Object.values(keys)) loginAttempts.delete(key); }

function rateLimitMutation(row){
  const key=row.session_id || row.id,now=Date.now();
  const attempts=(mutationAttempts.get(key)||[]).filter(at=>now-at<60*1000);
  if (attempts.length>=120) throw new ProductError(429,'mutation_rate_limited','Too many changes were submitted. Wait one minute and try again.');
  attempts.push(now);mutationAttempts.set(key,attempts);
}

async function api(req, res, url){
  const path = url.pathname;
  if (path.startsWith('/api/public/')){
    if(req.method==='GET'&&path==='/api/public/session'){
      const existing=customerApi.session(parseCookies(req)[CUSTOMER_COOKIE]);
      if(existing)return json(res,200,{csrfToken:existing.csrf,guest:true});
      rateLimitMutation({session_id:'public-session:'+requestIp(req)});
      const session=customerApi.createSession();
      return json(res,200,{csrfToken:session.csrf,guest:true},{'Set-Cookie':
        `${CUSTOMER_COOKIE}=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${env.NODE_ENV==='production'?'; Secure':''}`});
    }
    if(req.method==='GET'&&path==='/api/public/venues')return json(res,200,{venues:[{...customerApi.venue,resources:customerApi.resources,settings:customerApi.settings()}]});
    const customer=customerApi.session(parseCookies(req)[CUSTOMER_COOKIE]);
    let match;
    if((match=path.match(/^\/api\/public\/venues\/([^/]+)\/availability$/))&&req.method==='GET'){
      if(decodeURIComponent(match[1])!==customerApi.slug)throw new ProductError(404,'not_found','Venue not found.');
      return json(res,200,customerApi.availability(url.searchParams.get('date')));
    }
    if(!customer)throw new ProductError(401,'customer_session_required','Reload the app to restore your booking session.');
    if(!['GET','HEAD'].includes(req.method)){
      requireCsrf(req,{csrf_token:customer.csrf});
      rateLimitMutation({session_id:'customer:'+customer.id});
      rateLimitMutation({session_id:'public-ip:'+requestIp(req)});
    }
    if(req.method==='GET'&&path==='/api/public/bookings')return json(res,200,{bookings:customerApi.bookings(customer)});
    if((match=path.match(/^\/api\/public\/bookings\/([^/]+)\/cancel$/))&&req.method==='POST')
      return json(res,200,customerApi.cancel(customer,match[1]));
    if((match=path.match(/^\/api\/public\/venues\/([^/]+)\/holds(?:\/([^/]+)\/confirm)?$/))&&req.method==='POST'){
      if(decodeURIComponent(match[1])!==customerApi.slug)throw new ProductError(404,'not_found','Venue not found.');
      const body=await readJson(req);
      return match[2]?json(res,200,customerApi.confirmHold(customer,match[2]))
        :json(res,201,customerApi.createHold(customer,body));
    }
    throw new ProductError(404,'not_found','Customer API route not found.');
  }
  if (req.method === 'GET' && path === '/api/health'){
    const setupRequired = store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
    return json(res, 200, { ok:true, persistence:persistence.mode, ...(env.NODE_ENV === 'production' ? {} : { setupRequired }), time:new Date().toISOString() });
  }
  if (req.method === 'POST' && path === '/api/auth/login'){
    const body = await readJson(req);
    const keys = checkLoginLimit(req,body.email);
    let user;
    try { user = store.authenticate(body.email, body.password); }
    catch (error){ recordLoginFailure(keys); throw error; }
    clearLoginFailures(keys);
    const session = store.createSession(user);
    store.recordAuthEvent({ ...user,session_id:store.sessionUser(session.token).session_id },'auth.login');
    return json(res, 200, { user, csrfToken:session.csrf }, { 'Set-Cookie':sessionCookie(session.token, session.expiresAt) });
  }
  if (req.method === 'GET' && path === '/api/auth/me'){
    const row = requireUser(req);
    return json(res, 200, { user:publicActor(row), csrfToken:row.csrf_token });
  }
  if (req.method === 'POST' && path === '/api/auth/logout'){
    const row = requireUser(req); requireCsrf(req, row);
    store.recordAuthEvent(row,'auth.logout'); store.deleteSession(parseCookies(req)[SESSION_COOKIE]);
    return json(res, 200, { ok:true }, { 'Set-Cookie':clearCookie() });
  }

  if (req.method === 'POST' && path === '/api/auth/change-password'){
    const row = requireUser(req); requireCsrf(req,row); rateLimitMutation(row);
    const body=await readJson(req);
    const user=store.changePassword(row,body.currentPassword,body.newPassword);
    return json(res,200,{ user:{ ...user,mustChangePassword:false } });
  }

  const row = requireUser(req);
  const user = actor(row);
  if (row.must_change_password) throw new ProductError(403,'password_change_required','Change the temporary password before using the console.');
  if (!['GET','HEAD'].includes(req.method)) requireCsrf(req, row);
  if (!['GET','HEAD'].includes(req.method)) rateLimitMutation(row);

  if (req.method === 'GET' && path === '/api/state'){
    return json(res, 200, store.listState(url.searchParams.get('from'), url.searchParams.get('to')));
  }
  if (req.method === 'GET' && path === '/api/audit'){
    return json(res, 200, { events:store.listAudit(url.searchParams.get('limit'), user) });
  }
  if (req.method === 'GET' && path === '/api/accounts'){
    return json(res,200,store.listAccounts(url.searchParams.get('from'),url.searchParams.get('to'),user));
  }
  if (req.method === 'GET' && path === '/api/users') return json(res,200,{ users:store.listUsers(user) });
  if (req.method === 'GET' && path === '/api/settings'){
    return json(res, 200, { settings:store.getSettings() });
  }
  if (req.method === 'POST' && path === '/api/settings'){
    return json(res, 200, { settings:store.updateSettings(await readJson(req), user) });
  }
  if (req.method === 'POST' && path === '/api/users'){
    return json(res, 201, { user:store.createUser(await readJson(req), user) });
  }
  if (req.method === 'POST' && path === '/api/bookings'){
    const body = await readJson(req);
    return json(res, 201, { bookings:store.createBookings([body], user) });
  }
  if (req.method === 'POST' && path === '/api/bookings/batch'){
    const body = await readJson(req);
    return json(res, 201, { bookings:store.createBookings(body.bookings, user) });
  }
  if (req.method === 'POST' && path === '/api/holds'){
    return json(res, 201, { hold:store.createHold(await readJson(req), user) });
  }
  if (req.method === 'POST' && path === '/api/blocks'){
    return json(res, 201, { block:store.createBlock(await readJson(req), user) });
  }

  let match;
  if((match=routeMatch(path,/^\/api\/bookings\/([^/]+)\/check-in$/))&&req.method==='POST'){
    const body=await readJson(req);return json(res,200,{booking:store.checkIn(match[1],body.checked,user,body.version)});
  }
  if((match=routeMatch(path,/^\/api\/bookings\/([^/]+)\/clock$/))&&req.method==='POST'){
    const body=await readJson(req);return json(res,200,{booking:store.controlClock(match[1],body.action,user,body.version)});
  }
  if ((match = routeMatch(path, /^\/api\/holds\/([^/]+)\/confirm$/)) && req.method === 'POST')
    return json(res, 200, { booking:store.confirmHold(match[1], user) });
  if ((match = routeMatch(path, /^\/api\/holds\/([^/]+)\/release$/)) && req.method === 'POST'){
    const body = await readJson(req); store.releaseHold(match[1], user, body.reason); return json(res, 200, { ok:true });
  }
  if ((match = routeMatch(path, /^\/api\/blocks\/([^/]+)\/release$/)) && req.method === 'POST'){
    const body = await readJson(req); store.releaseBlock(match[1], user, body.reason); return json(res, 200, { ok:true });
  }
  if ((match = routeMatch(path, /^\/api\/bookings\/([^/]+)\/release$/)) && req.method === 'POST'){
    const body = await readJson(req); store.releaseBooking(match[1], user, body.reason, body.version); return json(res, 200, { ok:true });
  }
  if ((match = routeMatch(path, /^\/api\/bookings\/([^/]+)\/status$/)) && req.method === 'POST'){
    const body = await readJson(req);
    return json(res, 200, { booking:store.setStatus(match[1], body.status, user, body.reason, body.atMinute, body.version) });
  }
  if ((match = routeMatch(path, /^\/api\/bookings\/([^/]+)\/extend$/)) && req.method === 'POST'){
    const body = await readJson(req);
    return json(res, 200, { booking:store.extendBooking(match[1], body.minutes, user, body.version) });
  }
  if ((match = routeMatch(path, /^\/api\/bookings\/([^/]+)\/payments$/)) && req.method === 'POST'){
    return json(res, 200, { booking:store.recordPayment(match[1], await readJson(req), user) });
  }
  if ((match = routeMatch(path, /^\/api\/bookings\/([^/]+)\/refunds$/)) && req.method === 'POST'){
    return json(res, 200, { booking:store.recordRefund(match[1], await readJson(req), user) });
  }
  if ((match = routeMatch(path, /^\/api\/users\/([^/]+)\/(activate|deactivate)$/)) && req.method === 'POST'){
    const body=await readJson(req); return json(res,200,{ user:store.setUserActive(match[1],match[2]==='activate',user,body.reason) });
  }
  if ((match = routeMatch(path, /^\/api\/users\/([^/]+)\/revoke-sessions$/)) && req.method === 'POST'){
    const body=await readJson(req); return json(res,200,store.revokeUserSessions(match[1],user,body.reason));
  }
  throw new ProductError(404, 'not_found', 'API route not found.');
}

return {api,readJson,securityHeaders,json};
}
