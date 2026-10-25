import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const quote=value=>"'"+value.replaceAll("'","''")+"'";

export function migrationSql(migrations){
  if(!migrations.length)throw new Error('No migrations found.');
  const versions=migrations.map(m=>m.version);
  if(new Set(versions).size!==versions.length)throw new Error('Duplicate migration version.');
  for(const m of migrations)if(!/^\d{14}$/.test(m.version))throw new Error('Invalid migration version.');
  const blocks=migrations.map(({version,name,sql})=>`
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(version)}) THEN
      IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations
        WHERE version=${quote(version)} AND name=${quote(name)} AND statements=ARRAY[${quote(sql)}]::text[]) THEN
        RAISE EXCEPTION 'Applied migration ${version} differs from Git';
      END IF;
    ELSE
      EXECUTE ${quote(sql)};
      INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
        VALUES (${quote(version)},${quote(name)},ARRAY[${quote(sql)}]::text[]);
    END IF;`).join('\n');
  const body=`BEGIN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version NOT IN (${versions.map(quote).join(',')})) THEN
      RAISE EXCEPTION 'Database has migrations absent from Git';
    END IF;
    ${blocks}
  END;`;
  const delimiter='$deploy_'+createHash('sha256').update(body).digest('hex').slice(0,16)+'$';
  return `BEGIN;\nSELECT pg_advisory_xact_lock(179292,1);\nDO ${delimiter}\n${body}\n${delimiter};\nCOMMIT;`;
}

export async function deployMigrations(env=process.env,fetcher=fetch){
  const token=env.SUPABASE_ACCESS_TOKEN,project=env.SUPABASE_PROJECT_ID;
  if(!token||!project||!/^[a-z]{20}$/.test(project))throw new Error('Supabase deployment credentials are missing.');
  const directory=new URL('../supabase/migrations/',import.meta.url);
  const migrations=await Promise.all((await readdir(directory)).filter(n=>n.endsWith('.sql')).sort().map(async file=>{
    const match=file.match(/^(\d{14})_(.+)\.sql$/);if(!match)throw new Error('Invalid migration filename: '+file);
    return {version:match[1],name:match[2],sql:await readFile(new URL(file,directory),'utf8')};
  }));
  // Management API uses the existing CI token; no database password is needed.
  // Schema changes and history updates share one locked transaction.
  const response=await fetcher(`https://api.supabase.com/v1/projects/${project}/database/query`,{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({query:migrationSql(migrations)}),signal:AbortSignal.timeout(120000),
  });
  if(!response.ok)throw new Error('Database migration failed ('+response.status+'): '+await response.text());
  console.log('Database migrations match Git: '+migrations.map(m=>m.version).join(', '));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  await deployMigrations();
}
