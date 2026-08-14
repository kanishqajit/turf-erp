import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, ProductError } from './server/store.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 5174);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const DATABASE_PATH = process.env.TURF_DATABASE_PATH || join(ROOT, 'data', 'turf.sqlite');
const SESSION_COOKIE = 'turf_session';
const store = createStore({ filename:DATABASE_PATH });
store.bootstrapFromEnv(process.env);

const clientModules = [
  'actions.js', 'api.js', 'constants.js', 'datetime.js', 'domain.js', 'modals.js', 'render.js', 'state.js',
  'views/alerts.js', 'views/availability.js', 'views/dashboard.js', 'views/sessions.js', 'views/settings.js',
];
const staticFiles = new Map([
  ['/','index.html'], ['/index.html','index.html'], ['/app.js','app.js'], ['/styles.css','styles.css'],
  ...clientModules.map(file => [`/client/${file}`, `client/${file}`]),
]);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };
const loginAttempts = new Map();
const trustProxy = process.env.TRUST_PROXY === '1';

function securityHeaders(res, api = false){
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
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
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}
function clearCookie(){
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

async function readJson(req){
  let bytes = 0, raw = '';
  for await (const chunk of req){
    bytes += chunk.length;
    if (bytes > 64 * 1024) throw new ProductError(413, 'body_too_large', 'Request body is too large.');
    raw += chunk;
  }
  if (!raw) return {};
  try { return JSON.parse(raw); }
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
    const proto = trustProxy ? String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() : 'http';
    const expected = `${proto}://${req.headers.host}`;
    if (origin !== expected) throw new ProductError(403, 'invalid_origin', 'Cross-origin changes are not allowed.');
  }
}

const actor = row => ({ id:row.id, email:row.email, name:row.name, role:row.role });
const routeMatch = (pathname, pattern) => pathname.match(pattern);

function rateLimitLogin(req){
  const key = trustProxy
    ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim()
    : String(req.socket.remoteAddress || 'unknown');
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter(at => now - at < 15 * 60 * 1000);
  if (attempts.length >= 10) throw new ProductError(429, 'login_rate_limited', 'Too many login attempts. Try again later.');
  attempts.push(now); loginAttempts.set(key, attempts);
  return () => loginAttempts.delete(key);
}

async function api(req, res, url){
  const path = url.pathname;
  if (req.method === 'GET' && path === '/api/health'){
    const setupRequired = store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
    return json(res, 200, { ok:true, setupRequired, time:new Date().toISOString() });
  }
  if (req.method === 'POST' && path === '/api/auth/login'){
    const success = rateLimitLogin(req);
    const body = await readJson(req);
    const user = store.authenticate(body.email, body.password);
    success();
    const session = store.createSession(user);
    return json(res, 200, { user, csrfToken:session.csrf }, { 'Set-Cookie':sessionCookie(session.token, session.expiresAt) });
  }
  if (req.method === 'GET' && path === '/api/auth/me'){
    const row = requireUser(req);
    return json(res, 200, { user:actor(row), csrfToken:row.csrf_token });
  }
  if (req.method === 'POST' && path === '/api/auth/logout'){
    const row = requireUser(req); requireCsrf(req, row);
    store.deleteSession(parseCookies(req)[SESSION_COOKIE]);
    return json(res, 200, { ok:true }, { 'Set-Cookie':clearCookie() });
  }

  const row = requireUser(req);
  const user = actor(row);
  if (!['GET','HEAD'].includes(req.method)) requireCsrf(req, row);

  if (req.method === 'GET' && path === '/api/state'){
    return json(res, 200, store.listState(url.searchParams.get('from'), url.searchParams.get('to')));
  }
  if (req.method === 'GET' && path === '/api/audit'){
    return json(res, 200, { events:store.listAudit(url.searchParams.get('limit'), user) });
  }
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
  if ((match = routeMatch(path, /^\/api\/holds\/([^/]+)\/confirm$/)) && req.method === 'POST')
    return json(res, 200, { booking:store.confirmHold(match[1], user) });
  if ((match = routeMatch(path, /^\/api\/holds\/([^/]+)\/release$/)) && req.method === 'POST'){
    const body = await readJson(req); store.releaseHold(match[1], user, body.reason); return json(res, 200, { ok:true });
  }
  if ((match = routeMatch(path, /^\/api\/blocks\/([^/]+)\/release$/)) && req.method === 'POST'){
    const body = await readJson(req); store.releaseBlock(match[1], user, body.reason); return json(res, 200, { ok:true });
  }
  if ((match = routeMatch(path, /^\/api\/bookings\/([^/]+)\/release$/)) && req.method === 'POST'){
    const body = await readJson(req); store.releaseBooking(match[1], user, body.reason); return json(res, 200, { ok:true });
  }
  if ((match = routeMatch(path, /^\/api\/bookings\/([^/]+)\/status$/)) && req.method === 'POST'){
    const body = await readJson(req);
    return json(res, 200, { booking:store.setStatus(match[1], body.status, user, body.reason, body.atMinute) });
  }
  if ((match = routeMatch(path, /^\/api\/bookings\/([^/]+)\/extend$/)) && req.method === 'POST'){
    const body = await readJson(req);
    return json(res, 200, { booking:store.extendBooking(match[1], body.minutes, user) });
  }
  if ((match = routeMatch(path, /^\/api\/bookings\/([^/]+)\/payments$/)) && req.method === 'POST'){
    return json(res, 200, { booking:store.recordPayment(match[1], await readJson(req), user) });
  }
  throw new ProductError(404, 'not_found', 'API route not found.');
}

async function handler(req, res){
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const file = staticFiles.get(url.pathname);
    if (!file){ securityHeaders(res); res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }); return res.end('Not found'); }
    if (!['GET','HEAD'].includes(req.method)){
      securityHeaders(res); res.writeHead(405, { 'Content-Type':'text/plain; charset=utf-8', Allow:'GET, HEAD' });
      return res.end('Method not allowed');
    }
    const body = await readFile(join(ROOT, file));
    securityHeaders(res);
    res.writeHead(200, { 'Content-Type':types[extname(file)] || 'application/octet-stream',
      'Content-Length':body.length, 'Cache-Control':'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error){
    const status = error instanceof ProductError ? error.status : 500;
    if (!(error instanceof ProductError)) console.error(error);
    json(res, status, { error:{ code:error.code || 'internal_error', message:status === 500 ? 'Internal server error.' : error.message,
      details:error.details } });
  }
}

const server = createServer(handler);
server.listen(PORT, HOST, () => {
  console.log(`Turf Operations on http://${HOST}:${PORT}`);
  if (store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0)
    console.warn('No users configured. Set TURF_BOOTSTRAP_EMAIL and TURF_BOOTSTRAP_PASSWORD, then restart.');
});

for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
