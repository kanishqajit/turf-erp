import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { createStore } from '../server/store.mjs';
import { createCustomerApi } from '../server/customer.mjs';
import { createCloudTransport,exportState,changesBetween,TABLES } from '../server/cloud-ledger.mjs';

const source=process.argv[2];
if(!source||!existsSync(source))throw new Error('Pass an existing SQLite ledger path.');
const cloud=createCloudTransport(process.env);
const before=await cloud.read();
if(TABLES.some(table=>(before.state[table]||[]).length))throw new Error('Import requires an empty cloud ledger; existing cloud records will not be overwritten.');
const store=createStore({filename:source});
try{
  createCustomerApi(store);
  const state=exportState(store);
  mkdirSync('tmp/supabase-work',{recursive:true,mode:0o700});
  const backup='tmp/supabase-work/import-backup-'+Date.now()+'.json';
  writeFileSync(backup,JSON.stringify(state),{mode:0o600});
  const result=await cloud.commit(before.revision,crypto.randomUUID(),changesBetween(before.state,state));
  if(result.conflict)throw new Error('Cloud ledger changed during import; import was not applied.');
  const verified=await cloud.read();
  for(const table of TABLES)if(JSON.stringify(verified.state[table].map(row=>Object.fromEntries(Object.entries(row).sort())))!==
    JSON.stringify(state[table].map(row=>Object.fromEntries(Object.entries(row).sort()))))throw new Error('Import verification failed for '+table);
  console.log('Import verified. Original SQLite ledger retained. Private backup: '+backup);
  console.log(JSON.stringify(Object.fromEntries(TABLES.map(t=>[t,state[t].length]))));
}finally{store.close();}
