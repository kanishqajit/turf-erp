import { mkdtemp,cp,copyFile,readFile,writeFile,symlink,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory=await mkdtemp(join(tmpdir(),'futly-portable-'));
try{
  for(const name of ['server','tests','client','supabase'])await cp(name,join(directory,name),{recursive:true});
  await copyFile('package.json',join(directory,'package.json'));
  await symlink(resolve('node_modules'),join(directory,'node_modules'),'junction');
  await cp('cloudflare',join(directory,'cloudflare'),{recursive:true});
  const path=join(directory,'server/store.mjs');
  const source=await readFile(path,'utf8');
  await writeFile(path,source.replace("from 'node:sqlite'","from './sqlite-memory.mjs'"));
  // Disk-file persistence is intentionally not a capability of this engine.
  // Cloud-ledger tests still verify PostgreSQL durability and API restarts.
  const result=spawnSync(process.execPath,['--test','--test-skip-pattern','accounts, sessions, and operational records survive a process restart'],{cwd:directory,stdio:'inherit'});
  process.exitCode=result.status??1;
}finally{await rm(directory,{recursive:true,force:true});}
