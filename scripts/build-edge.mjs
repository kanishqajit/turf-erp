import { readFile,writeFile,mkdir,rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=join(root,'supabase/functions/futly-api/runtime');
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await writeFile(join(output,'release.mjs'),'export const RELEASE = '+JSON.stringify(process.env.GITHUB_SHA || 'local')+';\n');
await writeFile(join(output,'occupancy.mjs'),await readFile(join(root,'client/occupancy.js'),'utf8'));
for(const name of ['store.mjs','customer.mjs','customer-auth.mjs','cloud-ledger.mjs','api-core.mjs','api-snapshot.mjs','edge-api.mjs','sqlite-memory.mjs','venue.mjs','public-venues.mjs']){
  let code=await readFile(join(root,'server',name),'utf8');
  if(name==='store.mjs')code=code.replace("from 'node:sqlite'","from './sqlite-memory.mjs'");
  if(name==='sqlite-memory.mjs')code=code.replace("from 'sql.js/dist/sql-asm.js'","from 'npm:sql.js@1.13.0/dist/sql-asm.js'");
  code=code.replaceAll("from '../client/occupancy.js'","from './occupancy.mjs'");
  await writeFile(join(output,name),code);
}
console.log('Supabase API runtime prepared; shared domain sources retained.');
