import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProductError } from './server/store.mjs';
import { createApi } from './server/api-core.mjs';
import { createPersistence, bufferedResponse } from './server/cloud-ledger.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 5174);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const DATABASE_PATH = process.env.TURF_DATABASE_PATH || join(ROOT, 'data', 'turf.sqlite');
const SESSION_COOKIE = 'turf_session';
const idleMinutes=Number(process.env.TURF_SESSION_IDLE_MINUTES || 30);
if (!Number.isFinite(idleMinutes) || idleMinutes < 5 || idleMinutes > 720)
  throw new ProductError(500,'invalid_session_idle','TURF_SESSION_IDLE_MINUTES must be between 5 and 720.');
const eventClients=new Set();
function broadcastLedger(){for(const res of eventClients)res.write('event: ledger\ndata: {}\n\n');}
const persistence=await createPersistence(process.env,DATABASE_PATH,broadcastLedger);
const store=persistence.store;
const customerApi=persistence.customer;
const CUSTOMER_COOKIE = 'futly_customer';
const CUSTOMER_ROOT = process.env.TURF_CUSTOMER_APP_DIR || join(ROOT,'..','Turf-app');
const customerFiles = new Map([['/book/','index.html'],['/book/index.html','index.html'],
  ['/book/app.js','app.js'],['/book/art.js','art.js'],['/book/styles.css','styles.css']]);

const clientModules = [
  'actions.js', 'api.js', 'constants.js', 'datetime.js', 'domain.js', 'modals.js', 'render.js', 'state.js',
  'views/accounts.js', 'views/alerts.js', 'views/availability.js', 'views/dashboard.js', 'views/sessions.js', 'views/settings.js',
];
/* The phone app is a second front end over the same API, not a second product:
   it has to be served from this origin or the session cookie (HttpOnly,
   SameSite=Strict) never reaches it. "/m" is the address a thumb types. */
const staticFiles = new Map([
  ['/','index.html'], ['/index.html','index.html'], ['/app.js','app.js'], ['/styles.css','styles.css'],
  ['/m','mobile.html'], ['/mobile.html','mobile.html'],
  ['/mobile.js','mobile.js'], ['/mobile.css','mobile.css'],
  /* Installing the phone app to a home screen needs these two by name: the
     manifest says what the app is called and how it launches, the icons are
     what the launcher draws. */
  ['/manifest.webmanifest','manifest.webmanifest'],
  ...['icon-192.png','icon-512.png','icon-maskable.png','apple-touch-icon.png']
    .map(file => [`/icons/${file}`, `icons/${file}`]),
  ...clientModules.map(file => [`/client/${file}`, `client/${file}`]),
]);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.png':'image/png',
  '.webmanifest':'application/manifest+json; charset=utf-8' };
const {api,readJson,securityHeaders,json}=createApi(persistence,process.env);

async function handler(req, res){
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if(url.pathname==='/api/public/events'&&req.method==='GET'){
      if(eventClients.size>=100)throw new ProductError(429,'too_many_connections','Too many live connections.');
      securityHeaders(res,true);res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});
      res.write(': connected\n\n');eventClients.add(res);
      const pulse=setInterval(()=>res.write(': heartbeat\n\n'),25000);
      req.on('close',()=>{clearInterval(pulse);eventClients.delete(res);});return;
    }
    if (url.pathname.startsWith('/api/')){
      if(!['GET','HEAD'].includes(req.method))await readJson(req);
      // A retry never emits cookies or a success response before durable commit.
      const output=await persistence.run(async()=>{
        const buffered=bufferedResponse();await api(req,buffered,url);return buffered;
      });
      output.flush(res);
      if(persistence.mode==='sqlite'&&!['GET','HEAD'].includes(req.method))broadcastLedger();
      return;
    }
    if(url.pathname==='/book'){securityHeaders(res);res.writeHead(302,{Location:'/book/'});return res.end();}
    const customerFile=customerFiles.get(url.pathname);
    const file = customerFile || staticFiles.get(url.pathname);
    if (!file){ securityHeaders(res); res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }); return res.end('Not found'); }
    if (!['GET','HEAD'].includes(req.method)){
      securityHeaders(res); res.writeHead(405, { 'Content-Type':'text/plain; charset=utf-8', Allow:'GET, HEAD' });
      return res.end('Method not allowed');
    }
    const body = await readFile(join(customerFile?CUSTOMER_ROOT:ROOT, file));
    securityHeaders(res);
    res.writeHead(200, { 'Content-Type':types[extname(file)] || 'application/octet-stream',
      'Content-Length':body.length, 'Cache-Control':'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error){
    const status = error instanceof ProductError ? error.status : 500;
    if (!(error instanceof ProductError)) console.error(error);
    json(res, status, { error:{ code:error.code || 'internal_error', message:status === 500 ? 'Internal server error.' : error.message,
      details:String(req.url).startsWith('/api/public/')?undefined:error.details } });
  }
}

/* TLS is opt-in through a key/cert pair on disk. It exists because a browser
   only treats an origin as secure over HTTPS, and without a secure origin
   Chrome will not install the phone app to a home screen — it stays a tab with
   an address bar. Serving the LAN over a locally-trusted certificate is what
   turns it into something that launches like an app. Plain HTTP stays the
   default so nothing changes for anyone who has not set these. */
const TLS_KEY = process.env.TURF_TLS_KEY, TLS_CERT = process.env.TURF_TLS_CERT;
const secure = Boolean(TLS_KEY && TLS_CERT);
const server = secure
  ? createTlsServer({ key:readFileSync(TLS_KEY), cert:readFileSync(TLS_CERT) }, handler)
  : createServer(handler);
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, HOST, () => {
  console.log(`Turf Operations on ${secure ? 'https' : 'http'}://${HOST}:${PORT}`);
  if (persistence.mode==='sqlite'&&store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0)
    console.warn('No users configured. Set TURF_BOOTSTRAP_EMAIL and TURF_BOOTSTRAP_PASSWORD, then restart.');
});

for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
