import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCustomerAuth,AUTH_COOKIE,PROOF_COOKIE} from '../server/customer-auth.mjs';
import {createApi} from '../server/api-core.mjs';
import {workspace,cloudPersistence,exportState} from '../server/cloud-ledger.mjs';

const user={id:'b4ab49de-0b0d-4b00-a4d1-b4f3cd867aef',email:'player@example.test',user_metadata:{name:'Player'}};
const tokens={access_token:'private-access',refresh_token:'private-refresh'};
const env={NODE_ENV:'production',TURF_SUPABASE_URL:'https://auth.test',TURF_SUPABASE_PUBLISHABLE_KEY:'public-key'};
const value=cookie=>cookie.split(';')[0].split('=').slice(1).join('=');

test('customer credentials go only to Auth and the verified identity stays in HttpOnly cookies',async()=>{
  const calls=[];
  const auth=createCustomerAuth(env,async(url,options)=>{
    calls.push(url);assert.equal(options.headers.apikey,'public-key');
    if(url.includes('/token?')){assert.equal(JSON.parse(options.body).email,user.email);return Response.json({...tokens,user:{id:'untrusted-response'}});}
    assert.equal(options.headers.Authorization,'Bearer private-access');return Response.json(user);
  });
  const result=await auth.action('login',{email:' PLAYER@example.test ',password:'test password'},{},'https://futly.test');
  assert.equal(result.user.id,user.id);assert.equal(calls.length,2);
  assert.match(result.cookie,/HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
  assert.match(result.cookie,/Path=\/api\/public\//);
  assert.equal((await auth.session(value(result.cookie))).user.email,user.email);
});
test('expired tokens refresh; revoked sessions disappear, while service failures remain visible',async()=>{
  const encoded=Buffer.from(JSON.stringify({access_token:'old',refresh_token:'refresh'})).toString('base64url');
  let refreshed=0;
  const auth=createCustomerAuth(env,async(url,options)=>{
    if(url.includes('grant_type=refresh_token')){refreshed++;return Response.json(tokens);}
    return options.headers.Authorization==='Bearer old'?Response.json({},{status:401}):Response.json(user);
  });
  assert.equal((await auth.session(encoded)).user.id,user.id);assert.equal(refreshed,1);
  const revoked=createCustomerAuth(env,async()=>Response.json({},{status:401}));
  const result=await revoked.session(encoded);assert.equal(result.user,null);assert.equal(result.expired,true);assert.match(result.cookie,/Max-Age=0/);
  const offline=createCustomerAuth(env,async()=>{throw new Error('offline')});
  await assert.rejects(offline.session(encoded),e=>e.status===503);
  assert.equal((await revoked.session('malformed')).user,null);
});
test('signup and password recovery use browser-bound PKCE; callback cannot substitute a customer ID',async()=>{
  let challenge;
  const auth=createCustomerAuth(env,async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;
    if(url.includes('/signup?')){
      challenge=body.code_challenge;assert.equal(body.code_challenge_method,'s256');assert.match(url,/redirect_to=https%3A%2F%2Ffutly.test%2Fbook%2F/);
      return Response.json(user);
    }
    if(url.includes('grant_type=pkce')){
      assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),challenge);
      assert.equal(body.auth_code,'one-use-code');return Response.json(tokens);
    }
    return Response.json(user);
  });
  const registered=await auth.action('signup',{email:user.email,password:'good password',name:'Player'},{},'https://futly.test');
  assert.equal(registered.user,null);assert.equal(registered.confirmationRequired,true);
  const proof=value(registered.cookie);
  const confirmed=await auth.action('exchange',{code:'one-use-code',userId:'attacker'},{[PROOF_COOKIE]:proof},'https://futly.test');
  assert.equal(confirmed.user.id,user.id);assert.equal(confirmed.cookie.length,2);assert.match(confirmed.cookie[1],/Max-Age=0/);
  await assert.rejects(auth.action('exchange',{code:'code'},{},'https://futly.test'),e=>e.status===400);
  await assert.rejects(auth.action('signup',{email:'invalid',password:'password'},{},'https://futly.test'),e=>e.code==='invalid_email');
  await assert.rejects(auth.action('signup',{email:user.email,password:'short'},{},'https://futly.test'),e=>e.code==='invalid_password');
});

async function invoke(api,path,{method='GET',cookies='',csrf='',body}={},reqReuse){
  const headers={host:'futly.test',origin:'https://futly.test',cookie:cookies,'x-csrf-token':csrf,'x-forwarded-proto':'https','content-type':'application/json'};
  const req=reqReuse||{headers,method,socket:{remoteAddress:'127.0.0.1'},...(body?{parsedBody:body}:{})};
  let status=200,data;const out={};
  const res={setHeader:(key,val)=>{out[key]=val},writeHead:code=>{status=code},end:raw=>{data=JSON.parse(raw)}};
  await api(req,res,new URL(path,'https://futly.test'));return {status,data,headers:out,req};
}
test('API enforces login and CSRF, supports cross-device history, and hides it after sign-out',async()=>{
  const w=workspace();w.store.createUser({name:'Owner',role:'owner',email:'owner@futly.test',password:'owner secure password'});
  const profile={id:user.id,email:user.email,name:'Player'};
  const auth={session:async c=>({user:c==='signed'?profile:c==='other'?{...profile,id:'another-customer'}:null}),
    action:async name=>({user:name==='logout'?null:profile,cookie:'new-auth-cookie; HttpOnly'})};
  const {api}=createApi({store:w.store,customer:w.customer},{...env,TRUST_PROXY:'1'},auth);
  try{
    const start=await invoke(api,'/api/public/session');
    const guest=start.headers['Set-Cookie'][0].split(';')[0],csrf=start.data.csrfToken;
    const date=new Date(Date.now()+86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
    const input={date,pitch:0,start:1080,end:1140,team:'Account FC',contact:'9000000001',idempotencyKey:'account-test-0001'};
    await assert.rejects(invoke(api,'/api/public/auth/login',{method:'POST',cookies:guest,body:{}}),e=>e.code==='invalid_csrf');
    await assert.rejects(invoke(api,'/api/public/venues/futly-demo/holds',{method:'POST',cookies:guest,csrf,body:input}),e=>e.code==='customer_login_required');
    const cookies=guest+'; '+AUTH_COOKIE+'=signed';
    const held=await invoke(api,'/api/public/venues/futly-demo/holds',{method:'POST',cookies,csrf,body:{...input,profileId:'another-customer'}});
    const confirmed=await invoke(api,'/api/public/venues/futly-demo/holds/'+held.data.hold.id+'/confirm',{method:'POST',cookies,csrf,body:{}});
    const logout=await invoke(api,'/api/public/auth/logout',{method:'POST',cookies,csrf,body:{}});assert.equal(logout.data.user,null);
    const fresh=await invoke(api,'/api/public/session');const otherBrowser=fresh.headers['Set-Cookie'][0].split(';')[0];
    const history=await invoke(api,'/api/public/bookings',{cookies:otherBrowser+'; '+AUTH_COOKIE+'=signed'});
    assert.equal(history.data.bookings[0].id,confirmed.data.booking.id);
    assert.ok(!JSON.stringify(history.data).includes('private-access'));
    assert.equal((await invoke(api,'/api/public/bookings',{cookies:guest})).data.bookings.length,0);
    await assert.rejects(invoke(api,'/api/public/bookings/'+confirmed.data.booking.id+'/cancel',{method:'POST',cookies:guest+'; '+AUTH_COOKIE+'=other',csrf,body:{}}),e=>e.code==='not_found');
  }finally{w.store.close();}
});
test('optimistic ledger retries never repeat an external sign-in or issue a premature cookie',async()=>{
  const seed=workspace();const session=seed.customer.createSession();const state=exportState(seed.store);seed.store.close();
  // A legacy browser record is claimed on login, causing a durable write and a retry.
  state.customer_reservations=[];
  let calls=0,runs=0,commits=0;
  const transport={read:async()=>({schemaVersion:1,revision:0,state}),commit:async()=>{commits++;return commits===1?{conflict:true}:{revision:1}}};
  const persistence=cloudPersistence(transport);
  // Ensure claim changes state, without requiring synthetic booking records.
  const customer=new Proxy(persistence.customer,{get:(target,key)=>key==='claim'?()=>{runs++;persistence.store.db.prepare('UPDATE customer_sessions SET expires_at=expires_at+1').run();}:Reflect.get(target,key)});
  const {api}=createApi({...persistence,customer},{...env,TRUST_PROXY:'1'},{action:async()=>{calls++;return {user:{id:user.id,email:user.email},cookie:'session-cookie'}},session:async()=>({user:null})});
  const req={method:'POST',headers:{host:'futly.test',origin:'https://futly.test','x-forwarded-proto':'https',cookie:'futly_customer='+session.token,'x-csrf-token':session.csrf},socket:{remoteAddress:'127.0.0.1'},parsedBody:{email:user.email,password:'password'}};
  try{
    const result=await persistence.run(()=>invoke(api,'/api/public/auth/login',{},req));
    assert.equal(calls,1);assert.equal(runs,2);assert.equal(commits,2);assert.equal(result.headers['Set-Cookie'],'session-cookie');
  }finally{persistence.close();}
});

test('password recovery is generic and logout revokes the current Auth session',async()=>{
  const calls=[];const auth=createCustomerAuth(env,async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/user')&&options.method==='GET')return Response.json(user);
    if(url.includes('/logout'))return new Response(null,{status:204});
    return Response.json({});
  });
  const reset=await auth.action('recover',{email:user.email},{},'https://futly.test');
  assert.equal(reset.confirmationRequired,true);assert.equal(reset.user,null);
  assert.equal(JSON.parse(calls[0].options.body).code_challenge_method,'s256');
  const encoded=Buffer.from(JSON.stringify(tokens)).toString('base64url');
  const changed=await auth.action('password',{password:'a much better password'},{[AUTH_COOKIE]:encoded},'https://futly.test');
  assert.equal(changed.user.id,user.id);assert.equal(calls.at(-1).options.method,'PUT');
  const signedOut=await auth.action('logout',{}, {[AUTH_COOKIE]:encoded},'https://futly.test');
  assert.equal(signedOut.user,null);assert.equal(signedOut.cookie.length,2);assert.ok(signedOut.cookie.every(c=>c.includes('Max-Age=0')));
  assert.ok(calls.at(-1).url.endsWith('logout?scope=local'));
});

test('Google authorization uses a fixed provider, browser-bound PKCE and the same verified account',async()=>{
  let verifier;
  const auth=createCustomerAuth(env,async(url,options)=>{
    if(url.endsWith('/settings'))return Response.json({external:{google:true}});
    if(url.includes('grant_type=pkce')){verifier=JSON.parse(options.body).code_verifier;return Response.json(tokens);}
    return Response.json({...user,user_metadata:{full_name:'Google Player'}});
  });
  const started=await auth.action('google',{provider:'attacker',redirectTo:'https://attacker.test'},{},'https://futly.test');
  assert.equal(started.user,null);assert.ok(!started.confirmationRequired);
  const url=new URL(started.url);assert.equal(url.origin,'https://auth.test');assert.equal(url.pathname,'/auth/v1/authorize');
  assert.equal(url.searchParams.get('provider'),'google');assert.equal(url.searchParams.get('redirect_to'),'https://futly.test/book/?auth=google');
  assert.equal(url.searchParams.get('code_challenge_method'),'s256');assert.equal(url.searchParams.get('prompt'),'select_account');
  const exchanged=await auth.action('exchange',{code:'google-code'},{[PROOF_COOKIE]:value(started.cookie)},'https://futly.test');
  assert.equal(createHash('sha256').update(verifier).digest('base64url'),url.searchParams.get('code_challenge'));
  assert.equal(exchanged.user.id,user.id);assert.equal(exchanged.user.name,'Google Player');assert.equal(exchanged.provider,'google');assert.equal(exchanged.recovery,false);
  const disabled=createCustomerAuth(env,async()=>Response.json({external:{google:false}}));
  await assert.rejects(disabled.action('google',{}, {},'https://futly.test'),e=>e.status===503&&e.code==='google_not_configured');
});

test('Google start endpoint requires CSRF and returns only a public authorization URL',async()=>{
  const w=workspace();let calls=0;
  const auth=createCustomerAuth(env,async()=>{calls++;return Response.json({external:{google:true}})});
  const {api}=createApi({store:w.store,customer:w.customer},{...env,TRUST_PROXY:'1'},auth);
  try{
    const guest=await invoke(api,'/api/public/session');const cookies=guest.headers['Set-Cookie'][0].split(';')[0];
    await assert.rejects(invoke(api,'/api/public/auth/google',{method:'POST',cookies,body:{}}),e=>e.code==='invalid_csrf');assert.equal(calls,0);
    const response=await invoke(api,'/api/public/auth/google',{method:'POST',cookies,csrf:guest.data.csrfToken,body:{redirectTo:'https://attacker.test'}});
    assert.equal(response.status,200);assert.equal(response.data.user,null);assert.ok(response.data.url.startsWith('https://auth.test/auth/v1/authorize?'));
    assert.match(response.headers['Set-Cookie'],/HttpOnly/);assert.ok(!JSON.stringify(response.data).includes('verifier'));
  }finally{w.store.close();}
});
