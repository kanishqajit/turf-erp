import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { createStore, ProductError } from './store.mjs';
import { createCustomerApi } from './customer.mjs';

// PostgreSQL is authoritative. The existing synchronous domain rules run against
// a request-scoped in-memory workspace, then only changed relational rows commit
// atomically with a revision check. No SQLite file is used in cloud mode.
export const TABLES=['users','sessions','bookings','holds','blocks','payment_events',
  'audit_events','venue_settings','customer_sessions','customer_reservations'];
const EVENTS=new Set(['bookings','holds','blocks','payment_events','venue_settings']);
const quote=value=>'"'+value.replaceAll('"','""')+'"';

export function workspace(env={},state=null){
  const store=createStore({filename:':memory:',sessionIdleMs:Number(env.TURF_SESSION_IDLE_MINUTES||30)*60000,
    timeZone:env.TURF_TIME_ZONE||'Asia/Kolkata'});
  const customer=createCustomerApi(store,env);
  if(state){
    store.db.exec('PRAGMA foreign_keys=OFF');
    for(const table of TABLES)store.db.exec(`DELETE FROM ${quote(table)}`);
    for(const table of TABLES){
      const columns=store.db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(c=>c.name);
      const insert=store.db.prepare(`INSERT INTO ${quote(table)} (rowid,${columns.map(quote).join(',')}) VALUES (${['?',...columns.map(()=>'?')].join(',')})`);
      for(const row of state[table]||[])insert.run(row._ordinal,...columns.map(c=>row[c]??null));
    }
    store.db.exec('PRAGMA foreign_keys=ON');
    if(store.db.prepare('PRAGMA foreign_key_check').all().length){store.close();throw new Error('Cloud ledger has invalid record references.');}
    store.db.prepare("INSERT OR IGNORE INTO venue_settings (key,value_integer,updated_at) VALUES ('deposit_amount',500,?)").run(new Date().toISOString());
  }
  return {store,customer};
}

export function exportState(store){
  return Object.fromEntries(TABLES.map(table=>[table,store.db.prepare(`SELECT rowid AS _ordinal,* FROM ${quote(table)} ORDER BY rowid`).all().map(row=>({...row}))]));
}

export function changesBetween(before,after){
  const changes={};
  for(const table of TABLES){
    const key=table==='venue_settings'?'key':'id';
    if(table==='customer_reservations'){
      // Reservation identity is the original hold even after confirmation.
      changes[table]=diff(before[table]||[],after[table]||[],'hold_id');
    }else changes[table]=diff(before[table]||[],after[table]||[],key);
    if(!changes[table].upsert.length&&!changes[table].remove.length)delete changes[table];
  }
  return changes;
}
function diff(before,after,key){
  const old=new Map(before.map(row=>[String(row[key]),row]));
  const next=new Map(after.map(row=>[String(row[key]),row]));
  const same=(a,b)=>Object.keys(b).every(k=>a[k]===b[k]);
  return {upsert:after.filter(row=>!old.has(String(row[key]))||!same(old.get(String(row[key])),row)),
    remove:before.filter(row=>!next.has(String(row[key]))).map(row=>String(row[key]))};
}

export function createCloudTransport(env,fetcher=fetch){
  if(!env.TURF_SUPABASE_URL||!env.TURF_SUPABASE_SERVER_TOKEN)
    throw new Error('Supabase mode requires TURF_SUPABASE_URL and TURF_SUPABASE_SERVER_TOKEN.');
  const url=new URL('/functions/v1/futly-ledger',env.TURF_SUPABASE_URL);
  if(url.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Supabase must use HTTPS.');
  async function request(action,payload={}){
    const body=JSON.stringify({action,...payload});
    for(let attempt=0;attempt<2;attempt++){
      try{
        const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json',
          'X-Futly-Server-Token':env.TURF_SUPABASE_SERVER_TOKEN,
          ...(env.TURF_SUPABASE_PUBLISHABLE_KEY?{apikey:env.TURF_SUPABASE_PUBLISHABLE_KEY}:{})},
          body,signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw new Error('Supabase ledger request failed with HTTP '+response.status);
        const data=await response.json();
        if(data.schemaVersion!==1)throw new Error('Supabase ledger schema version mismatch.');
        return data;
      }catch(error){
        if(attempt===1)throw new ProductError(503,'cloud_unavailable','The shared venue service is unavailable. Your screen has not confirmed this change. Try again shortly.');
      }
    }
  }
  return {read:()=>request('read'),commit:(expectedRevision,operationId,changes)=>request('commit',{expectedRevision,operationId,changes})};
}

export function cloudPersistence(transport,env={},onChange=()=>{}){
  const context=new AsyncLocalStorage();
  const fallback=workspace(env);
  const proxy=kind=>new Proxy({}, {get:(_,key)=>{
    const target=(context.getStore()||fallback)[kind];
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
  async function run(callback){
    for(let attempt=0;attempt<5;attempt++){
      const before=await transport.read();
      const working=workspace(env,before.state);
      try{
        const result=await context.run(working,callback);
        const changes=changesBetween(before.state,exportState(working.store));
        if(!Object.keys(changes).length)return result;
        const committed=await transport.commit(before.revision,randomUUID(),changes);
        if(committed.conflict)continue;
        if(Object.keys(changes).some(table=>EVENTS.has(table)))onChange();
        return result;
      }finally{working.store.close();}
    }
    throw new ProductError(409,'cloud_busy','Another staff member changed the ledger. Retry your action.');
  }
  return {mode:'supabase',store:proxy('store'),customer:proxy('customer'),run,close:()=>fallback.store.close()};
}

export async function createPersistence(env,databasePath,onChange=()=>{}){
  if(env.TURF_PERSISTENCE==='supabase'){
    const persistence=cloudPersistence(createCloudTransport(env),env,onChange);
    await persistence.run(()=>persistence.store.bootstrapFromEnv(env));
    return persistence;
  }
  if(env.TURF_PERSISTENCE&&env.TURF_PERSISTENCE!=='sqlite')throw new Error('TURF_PERSISTENCE must be sqlite or supabase.');
  const store=createStore({filename:databasePath,sessionIdleMs:Number(env.TURF_SESSION_IDLE_MINUTES||30)*60000});
  store.bootstrapFromEnv(env);const customer=createCustomerApi(store,env);
  return {mode:'sqlite',store,customer,run:async fn=>fn(),close:()=>store.close()};
}

// HTTP success and cookies are released only after PostgreSQL acknowledges COMMIT.
export function bufferedResponse(){
  const headers={};let status,body;
  return {setHeader:(k,v)=>{headers[k]=v;},writeHead:(s,h={})=>{status=s;Object.assign(headers,h);},end:value=>{body=value;},
    flush:res=>{for(const [k,v]of Object.entries(headers))res.setHeader(k,v);res.writeHead(status||200);res.end(body);}};
}
