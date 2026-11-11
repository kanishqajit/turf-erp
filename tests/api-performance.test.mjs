import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {cloudPersistence} from '../server/cloud-ledger.mjs';
import {handleApiRequest} from '../server/edge-api.mjs';
import {snapshotScope} from '../server/api-snapshot.mjs';

const origin='https://futly.test';
const day=offset=>new Date(Date.now()+offset*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});

test('scoped hosted APIs preserve domain rules, identities, authentication and durable writes',async t=>{
  const pg=new PGlite(),token=randomUUID()+randomUUID(),password='a private test password';
  const directory=new URL('../supabase/migrations/',import.meta.url);
  await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;');
  for(const name of readdirSync(directory).filter(x=>x.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL(name,directory),'utf8'));
  await pg.query('UPDATE futly.ledger_meta SET integration_token_hash=$1',[createHash('sha256').update(token).digest('hex')]);
  const transport={read:async()=>(await pg.query('SELECT public.futly_ledger_read($1) data',[token])).rows[0].data,
    commit:async(rev,id,changes)=>(await pg.query('SELECT public.futly_ledger_commit($1,$2,$3,$4) data',[token,rev,id,changes])).rows[0].data};
  const ledger=cloudPersistence(transport);let owner,operator,manager,farBooking,nearBooking;const receipts=[];
  await ledger.run(()=>{
    owner=ledger.store.createUser({email:'owner@futly.test',name:'Owner',role:'owner',password});
    operator=ledger.store.createUser({email:'operator@futly.test',name:'Operator',role:'operator',password},owner);
    manager=ledger.store.createUser({email:'manager@futly.test',name:'Manager',role:'manager',password},owner);
    ledger.store.db.exec('UPDATE users SET must_change_password=0');
    farBooking=ledger.store.createBookings([{date:day(90),pitch:0,start:600,end:660,team:'Outside window',contact:'9000000000'}],owner)[0];
    nearBooking=ledger.store.createBookings([{date:day(2),pitch:0,start:600,end:660,team:'Existing booking',contact:'9000000001'}],owner)[0];
    for(let i=0;i<20;i++)ledger.store.recordAuthEvent(owner,'test.history');
    ledger.store.recordPayment(farBooking.id,{amount:100,mode:'Cash',idempotencyKey:'outside-receipt-0001'},owner);
  });
  const env={get:key=>({SUPABASE_URL:'https://private.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only'})[key]};
  let rpcCalls=[],race=false,raceBooking=null;
  const fetcher=async(url,options)=>{
    assert.equal(options.headers.apikey,'server-only');const args=JSON.parse(options.body);rpcCalls.push(new URL(url).pathname);
    try{
      if(url.endsWith('/futly_api_snapshot'))return Response.json((await pg.query('SELECT public.futly_api_snapshot($1,$2) data',[args.p_token,args.p_scope])).rows[0].data);
      if(url.endsWith('/futly_ledger_commit')){
        if(race){race=false;await pg.query('UPDATE futly.ledger_meta SET revision=revision+1');}
        if(raceBooking){const input=raceBooking;raceBooking=null;await ledger.run(()=>ledger.store.createBookings([input],owner));}
        return Response.json((await pg.query('SELECT public.futly_ledger_commit($1,$2,$3,$4) data',[args.p_token,args.p_revision,args.p_operation_id,args.p_changes])).rows[0].data);
      }
      throw Error('Unexpected RPC '+url);
    }catch(e){return Response.json({code:e.code,message:e.message},{status:400});}
  };
  const client=()=>({cookie:'',csrf:''});const admin=client(),staff=client(),supervisor=client();
  async function call(session,path,method='GET',body,expected=200){
    const response=await handleApiRequest(new Request(origin+path,{method,headers:{'X-Futly-Server-Token':token,'X-Futly-Public-Origin':origin,'X-Futly-Client-IP':'192.0.2.1',Origin:origin,Cookie:session.cookie,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env,fetcher,'test-release');
    const data=response.status===204?{}:await response.json();assert.equal(response.status,expected,JSON.stringify(data));
    const cookie=response.headers.getSetCookie().find(x=>x.startsWith('turf_session='));if(cookie)session.cookie=cookie.split(';')[0];if(data.csrfToken)session.csrf=data.csrfToken;
    assert.equal(response.headers.get('X-Futly-Commit'),'test-release');return {data,response};
  }
  try{
    await t.test('snapshot RPC denies browser roles and invalid integration tokens',async()=>{
      await assert.rejects(pg.query('SELECT public.futly_api_snapshot($1,$2)',['invalid',{kind:'staff'}]),/Server authentication required/);
      const permissions=(await pg.query("SELECT has_function_privilege('anon','public.futly_api_snapshot(text,jsonb)','EXECUTE') a,has_function_privilege('authenticated','public.futly_api_snapshot(text,jsonb)','EXECUTE') b")).rows[0];assert.deepEqual(permissions,{a:false,b:false});
    });
    for(const [session,user] of [[admin,owner],[staff,operator],[supervisor,manager]])await call(session,'/api/auth/login','POST',{email:user.email,password});
    const range=`from=${day(1)}&to=${day(21)}`;
    await t.test('desktop bundles session and operational state without optional histories',async()=>{
      rpcCalls=[];const {data,response}=await call(staff,'/api/desktop?'+range);
      assert.equal(data.user.role,'operator');assert.equal(data.accounts,undefined);assert.equal(data.audit,undefined);assert.equal(data.users,undefined);
      assert.equal(data.state.till.by.Cash,100);assert.ok(data.state.bookings.some(b=>b.id===nearBooking.id));assert.ok(!data.state.bookings.some(b=>b.id===farBooking.id));
      assert.equal(rpcCalls.length,1);assert.match(response.headers.get('Server-Timing'),/snapshot;dur=/);
      const snapshot=(await pg.query('SELECT public.futly_api_snapshot($1,$2) data',[token,snapshotScope(new URL(origin+'/api/desktop?'+range),'GET',{},staff.cookie)])).rows[0].data;
      assert.equal(snapshot.state.audit_events.length,0);assert.equal(snapshot.state.customer_sessions.length,0);
    });
    await t.test('optional histories remain role gated, with bounded audit reads',async()=>{
      await call(staff,'/api/desktop?'+range+'&include=audit','GET',undefined,403);
      await call(supervisor,'/api/desktop?'+range+'&include=users','GET',undefined,403);
      const {data}=await call(admin,'/api/desktop?'+range+'&include=accounts,audit,users&accountsFrom='+day(-180)+'&accountsTo='+day(180));
      assert.equal(data.users.length,3);assert.ok(data.accounts.bookings.some(b=>b.id===farBooking.id));assert.ok(data.audit.length>20);
      assert.equal((await call(admin,'/api/audit?limit=1')).data.events.length,1);
    });
    let created;
    await t.test('partial snapshots allocate global ordinals and append audit instead of overwriting history',async()=>{
      const history=(await pg.query('SELECT count(*)::int n,max(id)::int m FROM futly.audit_events')).rows[0];
      const {data}=await call(staff,'/api/bookings','POST',{date:day(3),pitch:1,start:600,end:660,team:'Scoped new booking',contact:'9000000002'},201);created=data.bookings[0];
      assert.ok(created.id);assert.equal((await pg.query('SELECT count(*)::int n FROM futly.bookings')).rows[0].n,3);
      const after=(await pg.query('SELECT count(*)::int n,max(id)::int m FROM futly.audit_events')).rows[0];assert.equal(after.n,history.n+1);assert.ok(after.m>history.m);
      assert.equal((await call(staff,'/api/state?from='+day(3)+'&to='+day(3))).data.bookings[0].id,created.id);
      await call(staff,'/api/bookings','POST',{date:day(3)+' trailing text',pitch:1,start:630,end:690,team:'Conflict',contact:'9000000003'},409);
    });
    await t.test('payments preserve global idempotency, totals and versions across narrowed snapshots',async()=>{
      const key='scoped-payment-0001';
      const body={amount:200,mode:'UPI',reference:'test-upi-0001',idempotencyKey:key,version:created.version};
      const first=(await call(staff,`/api/bookings/${created.id}/payments`,'POST',body)).data.booking;assert.equal(first.collected,200);
      const repeat=(await call(staff,`/api/bookings/${created.id}/payments`,'POST',{...body,idempotencyKey:' '+key+' '})).data.booking;assert.equal(repeat.collected,200);
      await call(staff,`/api/bookings/${nearBooking.id}/payments`,'POST',{...body},409);
      await call(staff,`/api/bookings/${created.id}/check-in`,'POST',{checked:true,version:created.version},409);
      const fresh=(await call(staff,`/api/bookings/${created.id}/check-in`,'POST',{checked:true,version:first.version})).data.booking;assert.ok(fresh.checkedInAt);created=fresh;
      assert.equal((await pg.query('SELECT count(*)::int n FROM futly.payment_events WHERE idempotency_key=$1',[key])).rows[0].n,1);
    });
    await t.test('conflicts refresh scoped snapshots before rerunning domain writes',async()=>{
      race=true;
      const result=await call(staff,`/api/bookings/${created.id}/check-in`,'POST',{checked:false,version:created.version});created=result.data.booking;
      assert.equal(created.checkedInAt,null);assert.match(result.response.headers.get('Server-Timing'),/retries;dur=1.0/);
    });
    await t.test('a competing scoped booking wins atomically and retry rechecks overlap',async()=>{
      const input={date:day(7),pitch:2,start:900,end:960,team:'Concurrent booking',contact:'9000000008'};
      const before=(await pg.query('SELECT COALESCE(sum(attempts),0)::int n FROM futly.api_rate_windows')).rows[0].n;
      raceBooking=input;
      await call(staff,'/api/bookings','POST',{...input,team:'Losing attempt'},409);
      const after=(await pg.query('SELECT sum(attempts)::int n FROM futly.api_rate_windows')).rows[0].n;
      assert.equal(after,before+1);
      const rows=(await pg.query('SELECT team FROM futly.bookings WHERE date=$1 AND pitch=2',[day(7)])).rows;
      assert.deepEqual(rows,[{team:'Concurrent booking'}]);
    });
    await t.test('holds and blocks still constrain fresh availability and confirmation',async()=>{
      const input={date:day(4),pitch:2,start:720,end:780,team:'Scoped hold',contact:'9000000004'};
      const hold=(await call(staff,'/api/holds','POST',input,201)).data.hold;
      await call(staff,'/api/bookings','POST',input,409);
      const b=(await call(staff,`/api/holds/${hold.id}/confirm`,'POST',{})).data.booking;assert.ok(b.id);
      const block=(await call(supervisor,'/api/blocks','POST',{date:day(4),pitch:1,start:720,end:780,reason:'Maintenance test'},201)).data.block;
      const available=(await call(client(),'/api/public/venues/futly-demo/availability?date='+day(4))).data;
      assert.ok(available.unavailable.some(v=>v.kind==='maintenance'));assert.ok(available.unavailable.some(v=>v.kind==='booked'));
      await call(supervisor,`/api/blocks/${block.id}/release`,'POST',{reason:'Maintenance completed'});
    });
    await t.test('desktop saves return committed refreshed state with one snapshot and one commit',async()=>{
      rpcCalls=[];
      const path='/api/bookings?refresh=desktop&'+range+'&include=accounts,audit,users&accountsFrom='+day(-180)+'&accountsTo='+day(180);
      const {data}=await call(admin,path,'POST',{date:day(5),pitch:0,start:600,end:660,team:'Bundled save',contact:'9000000005'},201);
      const id=data.bookings[0].id;
      assert.ok(data.desktop.state.bookings.some(b=>b.id===id));
      assert.ok(data.desktop.accounts.bookings.some(b=>b.id===id));
      assert.ok(data.desktop.audit.some(a=>a.entityId===id));
      assert.equal(data.desktop.users.length,3);
      assert.deepEqual(rpcCalls,['/rest/v1/rpc/futly_api_snapshot','/rest/v1/rpc/futly_ledger_commit']);
      const durable=(await pg.query('SELECT team FROM futly.bookings WHERE id=$1',[id])).rows[0];assert.equal(durable.team,'Bundled save');
      const before=(await pg.query('SELECT count(*)::int n FROM futly.bookings')).rows[0].n;
      await call(staff,'/api/bookings?refresh=desktop&'+range+'&include=users','POST',{date:day(6),pitch:0,start:600,end:660,team:'Forbidden bundle',contact:'9000000005'},403);
      assert.equal((await pg.query('SELECT count(*)::int n FROM futly.bookings')).rows[0].n,before);
    });
    await t.test('scoped refunds and releases preserve financial reconciliation',async()=>{
      const b=(await call(admin,`/api/bookings/${created.id}/refunds`,'POST',{amount:200,mode:'UPI',reference:'refund-test-0001',idempotencyKey:'scoped-refund-0001',reason:'Test customer cancellation',version:created.version})).data.booking;
      assert.equal(b.collected,0);
      await call(supervisor,`/api/bookings/${created.id}/release`,'POST',{reason:'Test booking no longer needed',version:b.version});
      const state=(await call(staff,'/api/state?from='+day(3)+'&to='+day(3))).data;assert.ok(!state.bookings.some(b=>b.id===created.id));
      assert.equal((await pg.query('SELECT count(*)::int n FROM futly.payment_events WHERE booking_id=$1',[created.id])).rows[0].n,2);
    });
    await t.test('reactivating a resold no-show fails without changing either booking',async()=>{
      const input={date:day(0),pitch:2,start:720,end:780,team:'Missed',contact:'9000000000'};
      const a=(await call(admin,'/api/bookings','POST',input,201)).data.bookings[0];
      const noShow=(await call(admin,`/api/bookings/${a.id}/status`,'POST',{status:'noshow',version:a.version})).data.booking;
      const b=(await call(admin,'/api/bookings','POST',{...input,team:'Replacement'},201)).data.bookings[0];
      await call(admin,`/api/bookings/${a.id}/status`,'POST',{status:'upcoming',version:noShow.version},409);
      const rows=(await pg.query('SELECT id,status FROM futly.bookings WHERE id=ANY($1)',[[a.id,b.id]])).rows;
      assert.equal(rows.find(r=>r.id===a.id).status,'noshow');assert.equal(rows.find(r=>r.id===b.id).status,'upcoming');
    });
    await t.test('running time is protected in scoped staff writes and public availability',async()=>{
      const input={date:day(1),pitch:2,start:600,end:660,team:'Late running',contact:'9000000000'};
      const a=(await call(admin,'/api/bookings','POST',input,201)).data.bookings[0];
      await call(admin,`/api/bookings/${a.id}/status`,'POST',{status:'running',atMinute:630,version:a.version});
      const available=(await call(client(),'/api/public/venues/futly-demo/availability?date='+day(1))).data;
      assert.ok(available.unavailable.some(r=>r.resourceId===2&&r.end>=690));
      await call(staff,'/api/holds','POST',{...input,start:660,end:720,team:'Would overlap'},409);
      await call(staff,'/api/bookings','POST',{...input,start:660,end:720,team:'Would overlap'},409);
    });
    await t.test('expanded group ranges load real future bookings and keep ordinary queries bounded',async()=>{
      const input={date:day(30),pitch:1,start:600,end:660,team:'Future group day',contact:'9000000000'};
      const b=(await call(admin,'/api/bookings','POST',input,201)).data.bookings[0];
      const data=(await call(staff,'/api/desktop?from='+day(0)+'&to='+day(83)+'&groupRange=1')).data;
      assert.ok(data.state.bookings.some(r=>r.id===b.id));
      await call(staff,'/api/desktop?from='+day(0)+'&to='+day(83),'GET',undefined,400);
      await call(staff,'/api/desktop?from='+day(0)+'&to='+day(90)+'&groupRange=1','GET',undefined,400);
    });
    await t.test('today operations survive switching to sessions after a distant calendar jump',async()=>{
      const data=(await call(staff,'/api/desktop?from='+day(30)+'&to='+day(50))).data;
      assert.ok(data.state.bookings.some(b=>b.date===day(0)&&b.team==='Replacement'));
    });
    await t.test('health and events authenticate without constructing application workspaces',async()=>{
      for(const path of ['/api/health','/api/public/events']){const {response}=await call(client(),path,'GET',undefined,path.endsWith('events')?204:200);assert.doesNotMatch(response.headers.get('Server-Timing'),/hydrate/);}
    });
    await t.test('scoped split payments commit both tenders once and detect cross-booking key reuse',async()=>{
      const b=(await call(admin,'/api/bookings','POST',{date:day(12),pitch:0,start:600,end:660,team:'Atomic split',contact:'9000000000'},201)).data.bookings[0];
      const path=`/api/bookings/${b.id}/payments/split?refresh=desktop&${range}`;
      const body={cashAmount:500,upiAmount:b.amount-500,reference:'In person',idempotencyKey:'hosted-split-0001',version:b.version};
      rpcCalls=[];
      const paid=(await call(staff,path,'POST',body)).data;assert.equal(paid.booking.collected,b.amount);assert.ok(paid.desktop.state.bookings.some(x=>x.id===b.id));
      assert.deepEqual(rpcCalls,['/rest/v1/rpc/futly_api_snapshot','/rest/v1/rpc/futly_ledger_commit']);
      assert.equal((await call(staff,path,'POST',body)).data.booking.collected,b.amount);
      await call(staff,`/api/bookings/${created.id}/payments/split`,'POST',{...body,version:created.version},409);
      assert.equal((await pg.query('SELECT count(*)::int n FROM futly.payment_events WHERE booking_id=$1',[b.id])).rows[0].n,2);
    });
    await t.test('hosted handover loads an earlier clock, ends it and starts today in one commit',async()=>{
      const minute=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',hourCycle:'h23'}).format(new Date()))*60;
      const start=Math.max(360,Math.min(1380,minute));
      const b=(await call(admin,'/api/bookings','POST',{date:day(0),pitch:1,start,end:start+60,team:'Handover next',contact:'9000000000'},201)).data.bookings[0];
      let previous;await ledger.run(()=>{
        previous=ledger.store.createBookings([{date:day(-1),pitch:1,start:600,end:660,team:'Earlier unfinished',contact:'9000000001'}],owner)[0];
        ledger.store.db.prepare("UPDATE bookings SET status='running',started_at=600 WHERE id=?").run(previous.id);
      });
      rpcCalls=[];
      const result=(await call(staff,`/api/bookings/${b.id}/start?refresh=desktop&${range}`,'POST',{
        version:b.version,atMinute:start,previous:{id:previous.id,version:previous.version}})).data;
      assert.equal(result.booking.status,'running');
      assert.deepEqual(rpcCalls,['/rest/v1/rpc/futly_api_snapshot','/rest/v1/rpc/futly_ledger_commit']);
      const ended=(await pg.query('SELECT status FROM futly.bookings WHERE id=$1',[previous.id])).rows[0];assert.equal(ended.status,'done');
      assert.ok(result.desktop.state.bookings.some(x=>x.id===b.id&&x.status==='running'));
    });
    await t.test('session heartbeats and revocation persist across fresh snapshots',async()=>{
      await pg.query('UPDATE futly.sessions SET last_seen_at=$1 WHERE token_hash=$2',[Date.now()-60000,createHash('sha256').update(staff.cookie.split('=')[1]).digest('hex')]);
      await call(staff,'/api/auth/me');const session=(await pg.query('SELECT last_seen_at FROM futly.sessions WHERE token_hash=$1',[createHash('sha256').update(staff.cookie.split('=')[1]).digest('hex')])).rows[0];assert.ok(session.last_seen_at>Date.now()-10000);
      await call(admin,`/api/users/${operator.id}/revoke-sessions`,'POST',{reason:'Revoke test session'});
      await call(staff,'/api/desktop?'+range,'GET',undefined,401);
    });
  }finally{ledger.close();await pg.close();}
});
