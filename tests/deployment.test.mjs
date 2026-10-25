import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {migrationSql} from '../scripts/deploy-migrations.mjs';

const directory=new URL('../supabase/migrations/',import.meta.url);
const migrations=readdirSync(directory).filter(n=>n.endsWith('.sql')).sort().map(file=>{
  const [,version,name]=file.match(/^(\d+)_(.+)\.sql$/);
  return {version,name,sql:readFileSync(new URL(file,directory),'utf8')};
});

test('deployment applies the Git migrations once, detects drift and rolls back failed changes',async()=>{
  const pg=new PGlite();
  try{
    await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);');
    await pg.exec(migrationSql(migrations));
    await pg.exec(migrationSql(migrations));
    assert.equal((await pg.query('SELECT count(*)::int n FROM supabase_migrations.schema_migrations')).rows[0].n,migrations.length);
    const modified=migrations.map((m,i)=>i===0?{...m,sql:m.sql+'\n-- changed'}:m);
    await assert.rejects(pg.exec(migrationSql(modified)),/differs from Git/);
    await pg.exec('ROLLBACK');
    const invalid=[...migrations,{version:'20261025150000',name:'test_rollback',sql:'CREATE TABLE public.must_rollback(id integer);SELECT * FROM public.missing_deployment_table;'}];
    await assert.rejects(pg.exec(migrationSql(invalid)),/does not exist/);
    await pg.exec('ROLLBACK');
    assert.equal((await pg.query("SELECT to_regclass('public.must_rollback') AS table_name")).rows[0].table_name,null);
    assert.equal((await pg.query('SELECT count(*)::int n FROM supabase_migrations.schema_migrations')).rows[0].n,migrations.length);
    await assert.rejects(pg.exec(migrationSql(migrations.slice(1))),/absent from Git/);
    await pg.exec('ROLLBACK');
  }finally{await pg.close();}
});
