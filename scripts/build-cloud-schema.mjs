import { writeFileSync } from 'node:fs';
import { workspace,TABLES } from '../server/cloud-ledger.mjs';
const {store}=workspace();
const tables=TABLES.map(name=>{
  let sql=store.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name).sql;
  sql=sql.replace(/email TEXT NOT NULL UNIQUE/,'email TEXT NOT NULL').replace(/CREATE TABLE(?: IF NOT EXISTS)? (\w+)/,'CREATE TABLE futly.$1')
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g,'BIGINT PRIMARY KEY').replace(/\bINTEGER\b/g,'BIGINT')
    .replace(/\bend\b/g,'"end"').replace(/\bstart\b/g,'"start"').replace(/ COLLATE NOCASE/g,'').replace(/REFERENCES (\w+)/g,'REFERENCES futly.$1')
    .replace(/\)\s*$/,', _ordinal BIGINT NOT NULL UNIQUE)');
  return sql+';\nALTER TABLE futly.'+name+' ENABLE ROW LEVEL SECURITY;';
}).join('\n');
const indexes=store.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all()
  .map(r=>r.sql.replace(/ ON (\w+)/,' ON futly.$1').replace(/\bend\b/g,'"end"').replace(/\bstart\b/g,'"start"').replace(/ COLLATE NOCASE/g,'')+';').join('\n');
const fkIndexes=TABLES.flatMap(table=>store.db.prepare(`PRAGMA foreign_key_list(${table})`).all().filter(fk=>{
  const indexes=store.db.prepare(`PRAGMA index_list(${table})`).all();
  return !indexes.some(index=>store.db.prepare(`PRAGMA index_info(${index.name})`).all()[0]?.name===fk.from);
}).map(fk=>`CREATE INDEX ${table}_${fk.from}_fk ON futly.${table} (${fk.from});`)).join('\n');
const state=TABLES.map(t=>`'${t}',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r._ordinal) FROM futly.${t} r),'[]'::jsonb)`).join(',\n');
const list=TABLES.map(t=>`'${t}'`).join(',');
const sql=`-- Private relational ledger; accessed only through the authenticated ERP backend.
CREATE SCHEMA futly;
REVOKE ALL ON SCHEMA futly FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA futly TO service_role;
${tables}
${indexes}
${fkIndexes}
CREATE UNIQUE INDEX users_email_ci ON futly.users (lower(email));
CREATE TABLE futly.ledger_meta (id integer PRIMARY KEY CHECK(id=1),revision bigint NOT NULL DEFAULT 0,integration_token_hash text);
INSERT INTO futly.ledger_meta(id) VALUES(1);
CREATE TABLE futly.ledger_operations (id uuid PRIMARY KEY,payload_hash text NOT NULL,revision bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE futly.ledger_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE futly.ledger_operations ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA futly TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA futly FROM PUBLIC,anon,authenticated;

CREATE FUNCTION futly.assert_backend(p_token text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_token IS NULL OR length(p_token)<40 OR NOT EXISTS (
    SELECT 1 FROM futly.ledger_meta WHERE id=1 AND integration_token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')) THEN
    RAISE EXCEPTION 'Server authentication required' USING ERRCODE='42501';
  END IF;
END;$$;
REVOKE ALL ON FUNCTION futly.assert_backend(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION futly.assert_backend(text) TO service_role;

CREATE FUNCTION public.futly_ledger_read(p_token text) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_revision bigint;
BEGIN
  PERFORM futly.assert_backend(p_token);
  SELECT revision INTO v_revision FROM futly.ledger_meta WHERE id=1 FOR SHARE;
  RETURN jsonb_build_object('schemaVersion',1,'revision',v_revision,'state',jsonb_build_object(${state}));
END;$$;
REVOKE ALL ON FUNCTION public.futly_ledger_read(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.futly_ledger_read(text) TO service_role;

CREATE FUNCTION public.futly_ledger_commit(p_token text,p_revision bigint,p_operation_id uuid,p_changes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_revision bigint; v_prior futly.ledger_operations%ROWTYPE;
  v_hash text; v_table text; v_key text; v_columns text; v_updates text; v_entry jsonb;
  v_tables text[]=ARRAY[${list}];
BEGIN
  PERFORM futly.assert_backend(p_token);
  IF jsonb_typeof(p_changes)<>'object' OR octet_length(p_changes::text)>10000000 THEN RAISE EXCEPTION 'Invalid change set'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE NOT(k=ANY(v_tables))) THEN RAISE EXCEPTION 'Unknown ledger table'; END IF;
  SELECT revision INTO v_revision FROM futly.ledger_meta WHERE id=1 FOR UPDATE;
  v_hash=encode(sha256(convert_to(p_changes::text,'UTF8')),'hex');
  SELECT * INTO v_prior FROM futly.ledger_operations WHERE id=p_operation_id;
  IF FOUND THEN
    IF v_prior.payload_hash<>v_hash THEN RAISE EXCEPTION 'Operation key reused'; END IF;
    RETURN jsonb_build_object('schemaVersion',1,'revision',v_prior.revision,'replayed',true);
  END IF;
  IF v_revision<>p_revision THEN RETURN jsonb_build_object('schemaVersion',1,'revision',v_revision,'conflict',true); END IF;
  -- Remove dependants before parents. FK and CHECK constraints also protect cloud writes.
  FOR i IN REVERSE array_length(v_tables,1)..1 LOOP
    v_table=v_tables[i]; v_entry=p_changes->v_table;
    IF v_entry IS NULL THEN CONTINUE; END IF;
    v_key=CASE v_table WHEN 'venue_settings' THEN 'key' WHEN 'customer_reservations' THEN 'hold_id' ELSE 'id' END;
    EXECUTE format('DELETE FROM futly.%I WHERE %I::text IN (SELECT jsonb_array_elements_text($1))',v_table,v_key) USING v_entry->'remove';
  END LOOP;
  FOREACH v_table IN ARRAY v_tables LOOP
    v_entry=p_changes->v_table;
    IF v_entry IS NULL OR jsonb_array_length(v_entry->'upsert')=0 THEN CONTINUE; END IF;
    v_key=CASE v_table WHEN 'venue_settings' THEN 'key' WHEN 'customer_reservations' THEN 'hold_id' ELSE 'id' END;
    SELECT string_agg(format('%I',a.attname),',' ORDER BY a.attnum),
      string_agg(format('%I=EXCLUDED.%I',a.attname,a.attname),',' ORDER BY a.attnum) FILTER(WHERE a.attname<>v_key)
      INTO v_columns,v_updates FROM pg_catalog.pg_attribute a
      WHERE a.attrelid=format('futly.%I',v_table)::regclass AND a.attnum>0 AND NOT a.attisdropped;
    EXECUTE format('INSERT INTO futly.%I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::futly.%I,$1) ON CONFLICT(%I) DO UPDATE SET %s',v_table,v_columns,v_columns,v_table,v_key,v_updates) USING v_entry->'upsert';
  END LOOP;
  v_revision=v_revision+1;
  UPDATE futly.ledger_meta SET revision=v_revision WHERE id=1;
  INSERT INTO futly.ledger_operations(id,payload_hash,revision) VALUES(p_operation_id,v_hash,v_revision);
  DELETE FROM futly.ledger_operations WHERE created_at<now()-interval '7 days';
  RETURN jsonb_build_object('schemaVersion',1,'revision',v_revision);
END;$$;
REVOKE ALL ON FUNCTION public.futly_ledger_commit(text,bigint,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.futly_ledger_commit(text,bigint,uuid,jsonb) TO service_role;
`;
store.close();
if(!process.argv[2])throw new Error('Pass the CLI-generated migration path.');
writeFileSync(process.argv[2],sql);
