import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sessionStartPlan} from '../client/session-start.js';

test('standalone demo serves bundled phone state and replays split receipts without network',async()=>{
  const window={fetch:()=>{throw Error('Demo must not request the network');}};
  const context=vm.createContext({window,Response,URLSearchParams,Date,Map,Set,crypto,sessionStartPlan});
  vm.runInContext(readFileSync(new URL('../demo/backend.js',import.meta.url),'utf8'),context);
  const call=async(path,body)=>{
    const response=await window.fetch(path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});
    return {response,data:await response.json()};
  };
  const boot=await call('/api/desktop?include=accounts');
  assert.equal(boot.response.status,200);assert.ok(boot.data.state.bookings.length);assert.ok(boot.data.accounts);
  const booking=boot.data.state.bookings.find(b=>b.amount-b.collected>200&&b.status!=='cancelled');
  const input={cashAmount:100,upiAmount:100,reference:'In person',idempotencyKey:'demo-split-check',version:booking.version};
  const path='/api/bookings/'+booking.id+'/payments/split?refresh=desktop';
  const saved=await call(path,input);assert.equal(saved.response.status,200);assert.ok(saved.data.desktop.state);
  const replay=await call(path,input);assert.equal(replay.response.status,200);assert.equal(replay.data.booking.collected,saved.data.booking.collected);
  assert.equal((await call(path,{...input,cashAmount:200})).response.status,409);
});
