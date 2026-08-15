import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const source=resolve(process.env.TURF_DATABASE_PATH || join(root,'data','turf.sqlite'));
const destination=resolve(process.env.TURF_BACKUP_DIR || join(root,'backups'));
const retention=Math.max(1,Math.min(365,Number(process.env.TURF_BACKUP_RETENTION || 14)));
if(!existsSync(source))throw new Error(`Database not found: ${source}`);
if(!Number.isInteger(retention))throw new Error('TURF_BACKUP_RETENTION must be a whole number from 1 to 365.');
mkdirSync(destination,{recursive:true,mode:0o700});chmodSync(destination,0o700);
const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const target=join(destination,`${basename(source,'.sqlite')}-${stamp}.sqlite`);
const db=new DatabaseSync(source,{readOnly:true});
try{db.exec(`VACUUM INTO '${target.replaceAll("'","''")}'`);}finally{db.close();}
chmodSync(target,0o600);
const prefix=`${basename(source,'.sqlite')}-`;
const backups=readdirSync(destination).filter(name=>name.startsWith(prefix)&&name.endsWith('.sqlite'))
  .map(name=>({name,path:join(destination,name),time:statSync(join(destination,name)).mtimeMs})).sort((a,b)=>b.time-a.time);
for(const backup of backups.slice(retention))unlinkSync(backup.path);
console.log(JSON.stringify({source,target,bytes:statSync(target).size,retained:Math.min(backups.length,retention)},null,2));
