import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {workspace,exportState,changesBetween,cloudPersistence,createCloudTransport,bufferedResponse} from '../server/cloud-ledger.mjs';
import {handleRequest} from '../supabase/functions/futly-ledger/handler.mjs';

const token='prototype-server-token-'+randomUUID()+randomUUID();
const env={TURF_BOOTSTRAP_EMAIL:'cloud@turf.test',TURF_BOOTSTRAP_PASSWORD:'cloud prototype password',TURF_BOOTSTRAP_NAME:'Cloud Owner'};
const sha=s=>createHash('sha256').update(s).digest('hex');
const {store:template}=workspace();
const empty=Object.fromEntries(Object.keys(exportState(template)).map(key=>[key,[]]));template.close();
const sql=readFileSync(new URL('../supabase/migrations/20261008140531_futly_shared_ledger.sql',import.meta.url),'utf8');

test('Supabase relational ledger protects and persists the complete venue workflow',async t=>{
  const pg=new PGlite();
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await pg.exec(sql);
  await pg.query('UPDATE futly.ledger_meta SET integration_token_hash=$1 WHERE id=1',[sha(token)]);
  const transport={
    read:async()=> (await pg.query('SELECT public.futly_ledger_read($1) AS data',[token])).rows[0].data,
    commit:async(revision,id,changes)=>(await pg.query('SELECT public.futly_ledger_commit($1,$2,$3,$4::jsonb) AS data',[token,revision,id,JSON.stringify(changes)])).rows[0].data,
  };
  const ledger=cloudPersistence(transport,env);
  let owner,booking,customer,hold;
  try{
    await t.test('bootstrap persists owner in private Postgres records',async()=>{
      await ledger.run(()=>ledger.store.bootstrapFromEnv(env));
      owner=await ledger.run(()=>ledger.store.authenticate(env.TURF_BOOTSTRAP_EMAIL,env.TURF_BOOTSTRAP_PASSWORD));
      assert.equal((await pg.query('SELECT count(*)::int AS n FROM futly.users')).rows[0].n,1);
    });
    await t.test('customer booking and staff payment use the same cloud rows',async()=>{
      await ledger.run(()=>{const s=ledger.customer.createSession();customer=ledger.customer.session(s.token);});
      const date=new Date(Date.now()+86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
      hold=await ledger.run(()=>ledger.customer.createHold(customer,{date,pitch:1,start:1140,end:1230,team:'Cloud Customer FC',contact:'9000000001',idempotencyKey:'cloud-hold-0001'}));
      booking=(await ledger.run(()=>ledger.customer.confirmHold(customer,hold.hold.id))).booking;
      assert.equal(booking.amount,2100);assert.equal((await pg.query('SELECT source FROM futly.bookings WHERE id=$1',[booking.id])).rows[0].source,'app');
      await ledger.run(()=>ledger.store.recordPayment(booking.id,{amount:2100,mode:'Cash',idempotencyKey:'cloud-payment-0001'},owner));
      const history=await ledger.run(()=>ledger.customer.bookings(customer));assert.equal(history[0].outstanding,0);
      assert.equal((await pg.query('SELECT count(*)::int n FROM futly.payment_events')).rows[0].n,1);
    });
    await t.test('a new API process reads durable booking and receipt',async()=>{
      const restarted=cloudPersistence(transport,env);
      try{assert.equal((await restarted.run(()=>restarted.store.getBooking(booking.id))).collected,2100);}finally{restarted.close();}
    });
    await t.test('optimistic conflict reruns domain checks, preventing stale overlap',async()=>{
      let raced=false;
      const conflicting={...transport,commit:async(revision,id,changes)=>{
        if(!raced){raced=true;await pg.query('UPDATE futly.ledger_meta SET revision=revision+1');return {schemaVersion:1,conflict:true};}
        return transport.commit(revision,id,changes);
      }};
      const retry=cloudPersistence(conflicting,env);
      try{await retry.run(()=>retry.store.updateSettings({depositAmount:700},owner));assert.equal((await ledger.run(()=>ledger.store.getSettings())).depositAmount,700);}finally{retry.close();}
    });
    await t.test('unknown tables and invalid credentials cannot reach cloud data',async()=>{
      await assert.rejects(pg.query('SELECT public.futly_ledger_read($1)',['wrong-token']),/Server authentication required/);
      const state=await transport.read();await assert.rejects(transport.commit(state.revision,randomUUID(),{ledger_meta:{upsert:[],remove:[]}}),/Unknown ledger table/);
      await pg.exec('SET ROLE anon');
      try{await assert.rejects(pg.query('SELECT public.futly_ledger_read($1)',[token]),/permission denied/);await assert.rejects(pg.query('SELECT * FROM futly.bookings'),/permission denied/);}finally{await pg.exec('RESET ROLE');}
      await pg.exec('SET ROLE authenticated');
      try{await assert.rejects(pg.query('SELECT * FROM futly.users'),/permission denied/);}finally{await pg.exec('RESET ROLE');}
    });
    await t.test('commit acknowledgement retries cannot duplicate a receipt',async()=>{
      const before=await transport.read(),w=workspace(env,before.state);
      try{
        w.store.updateSettings({depositAmount:800},owner);const change=changesBetween(before.state,exportState(w.store));const id=randomUUID();
        const a=await transport.commit(before.revision,id,change),b=await transport.commit(before.revision,id,change);
        assert.equal(a.revision,b.revision);assert.equal(b.replayed,true);
      }finally{w.store.close();}
    });
    await t.test('constraint failures roll back every cloud write and revision',async()=>{
      const before=await transport.read();const bad={users:{upsert:[{...before.state.users[0],role:'hacker'}],remove:[]}};
      await assert.rejects(transport.commit(before.revision,randomUUID(),bad),/check constraint/);
      const after=await transport.read();assert.equal(after.revision,before.revision);assert.equal(after.state.users[0].role,'owner');
    });
    await t.test('the bridge rejects missing tokens and keeps service credentials server-side',async()=>{
      const e={get:k=>({SUPABASE_URL:'https://project.example',SUPABASE_SERVICE_ROLE_KEY:'private-service-key'})[k]};
      assert.equal((await handleRequest(new Request('https://example',{method:'POST',body:'{}'}),e)).status,401);
      let calls=0;
      const response=await handleRequest(new Request('https://example',{method:'POST',headers:{'x-futly-server-token':token},body:JSON.stringify({action:'read'})}),e,async(url,opts)=>{
        calls++;assert.equal(opts.headers.apikey,'private-service-key');assert.equal(JSON.parse(opts.body).p_token,token);return Response.json({schemaVersion:1,revision:0,state:empty});
      });assert.equal(calls,1);assert.equal(response.status,200);assert.ok(!(await response.text()).includes('private-service-key'));
    });
  }finally{ledger.close();await pg.close();}
});

test('cloud outages never fall back to a separate local ledger',async()=>{
  let attempts=0;const transport=createCloudTransport({TURF_SUPABASE_URL:'https://project.example',TURF_SUPABASE_SERVER_TOKEN:token},async()=>{attempts++;throw new Error('network down');});
  await assert.rejects(transport.read(),e=>e.status===503&&e.code==='cloud_unavailable');assert.equal(attempts,2);
});
test('API response buffers success and cookies until persistence returns',()=>{
  const res=bufferedResponse(),sent=[];const actual={setHeader:(...v)=>sent.push(v),writeHead:s=>sent.push(s),end:b=>sent.push(b)};
  res.setHeader('Set-Cookie','test-token');res.writeHead(201);res.end('saved');assert.equal(sent.length,0);res.flush(actual);assert.deepEqual(sent,[['Set-Cookie','test-token'],201,'saved']);
});
