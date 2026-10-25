import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPublicVenues} from '../server/public-venues.mjs';
import {createStore} from '../server/store.mjs';
import {createCustomerApi} from '../server/customer.mjs';
const env={get:key=>({SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'secret'})[key]};

test('scoped venue endpoint matches ledger configuration using only the settings RPC',async()=>{
  const store=createStore({filename:':memory:'});
  try{
    store.db.prepare("UPDATE venue_settings SET value_integer=750 WHERE key='deposit_amount'").run();
    const customer=createCustomerApi(store);let calls=0;
    const response=await readPublicVenues('trusted-token',env,async(url,options)=>{
      calls++;assert.equal(url,'https://project.supabase.co/rest/v1/rpc/futly_public_venue_settings');
      assert.deepEqual(JSON.parse(options.body),{p_token:'trusted-token'});
      return Response.json({depositAmount:750});
    });
    assert.equal(calls,1);assert.equal(response.status,200);
    assert.deepEqual((await response.json()).venues,[{...customer.venue,resources:customer.resources,settings:customer.settings()}]);
  }finally{store.close();}
});
test('scoped venue read fails closed on invalid credentials and backend outages',async()=>{
  assert.equal((await readPublicVenues('invalid',env,async()=>Response.json({code:'42501'},{status:403}))).status,401);
  assert.equal((await readPublicVenues('token',env,async()=>{throw new Error('offline');})).status,503);
});
