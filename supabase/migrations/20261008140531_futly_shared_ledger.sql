-- Private relational ledger; accessed only through the authenticated ERP backend.
CREATE SCHEMA futly;
REVOKE ALL ON SCHEMA futly FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA futly TO service_role;
CREATE TABLE futly.users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','manager','operator')),
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      active BIGINT NOT NULL DEFAULT 1,
      must_change_password BIGINT NOT NULL DEFAULT 0,
      password_changed_at TEXT,
      created_at TEXT NOT NULL
    , _ordinal BIGINT NOT NULL UNIQUE);
ALTER TABLE futly.users ENABLE ROW LEVEL SECURITY;
CREATE TABLE futly.sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES futly.users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL
    , _ordinal BIGINT NOT NULL UNIQUE);
ALTER TABLE futly.sessions ENABLE ROW LEVEL SECURITY;
CREATE TABLE futly.bookings (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      pitch BIGINT NOT NULL,
      "start" BIGINT NOT NULL,
      "end" BIGINT NOT NULL,
      team TEXT NOT NULL,
      contact TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'counter' CHECK(source IN ('counter','app')),
      kind TEXT NOT NULL DEFAULT 'standard' CHECK(kind IN ('standard','custom','group')),
      group_type TEXT,
      group_id TEXT,
      group_color TEXT,
      status TEXT NOT NULL DEFAULT 'upcoming' CHECK(status IN ('upcoming','running','done','noshow','cancelled')),
      started_at BIGINT,
      ended_at BIGINT,
      total_amount BIGINT NOT NULL,
      discount_amount BIGINT NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES futly.users(id),
      version BIGINT NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    , checked_in_at BIGINT, paused_at BIGINT, paused_milliseconds BIGINT NOT NULL DEFAULT 0, _ordinal BIGINT NOT NULL UNIQUE);
ALTER TABLE futly.bookings ENABLE ROW LEVEL SECURITY;
CREATE TABLE futly.holds (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      pitch BIGINT NOT NULL,
      "start" BIGINT NOT NULL,
      "end" BIGINT NOT NULL,
      team TEXT NOT NULL,
      contact TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      pay TEXT NOT NULL DEFAULT 'Payment at venue',
      expires_at BIGINT NOT NULL,
      created_by TEXT NOT NULL REFERENCES futly.users(id),
      created_at TEXT NOT NULL
    , _ordinal BIGINT NOT NULL UNIQUE);
ALTER TABLE futly.holds ENABLE ROW LEVEL SECURITY;
CREATE TABLE futly.blocks (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      pitch BIGINT NOT NULL,
      "start" BIGINT NOT NULL,
      "end" BIGINT NOT NULL,
      reason TEXT NOT NULL,
      active BIGINT NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL REFERENCES futly.users(id),
      created_at TEXT NOT NULL,
      released_at TEXT,
      released_by TEXT REFERENCES futly.users(id)
    , _ordinal BIGINT NOT NULL UNIQUE);
ALTER TABLE futly.blocks ENABLE ROW LEVEL SECURITY;
CREATE TABLE futly.payment_events (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES futly.bookings(id),
      amount BIGINT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('Cash','UPI','Card')),
      kind TEXT NOT NULL DEFAULT 'payment' CHECK(kind IN ('payment','refund')),
      reference TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT,
      reason TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES futly.users(id),
      created_at TEXT NOT NULL
    , _ordinal BIGINT NOT NULL UNIQUE);
ALTER TABLE futly.payment_events ENABLE ROW LEVEL SECURITY;
CREATE TABLE futly.audit_events (
      id BIGINT PRIMARY KEY,
      actor_id TEXT NOT NULL REFERENCES futly.users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    , _ordinal BIGINT NOT NULL UNIQUE);
ALTER TABLE futly.audit_events ENABLE ROW LEVEL SECURITY;
CREATE TABLE futly.venue_settings (
      key TEXT PRIMARY KEY,
      value_integer BIGINT NOT NULL,
      updated_by TEXT REFERENCES futly.users(id),
      updated_at TEXT NOT NULL
    , _ordinal BIGINT NOT NULL UNIQUE);
ALTER TABLE futly.venue_settings ENABLE ROW LEVEL SECURITY;
CREATE TABLE futly.customer_sessions (
    id TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at BIGINT NOT NULL, _ordinal BIGINT NOT NULL UNIQUE);
ALTER TABLE futly.customer_sessions ENABLE ROW LEVEL SECURITY;
CREATE TABLE futly.customer_reservations (
    hold_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES futly.customer_sessions(id),
    request_key TEXT NOT NULL, request_json TEXT NOT NULL, booking_id TEXT REFERENCES futly.bookings(id),
    UNIQUE(session_id,request_key), _ordinal BIGINT NOT NULL UNIQUE);
ALTER TABLE futly.customer_reservations ENABLE ROW LEVEL SECURITY;
CREATE INDEX bookings_window_idx ON futly.bookings(date,pitch,"start","end",status);
CREATE INDEX holds_window_idx ON futly.holds(date,pitch,"start","end",expires_at);
CREATE INDEX blocks_window_idx ON futly.blocks(date,pitch,"start","end",active);
CREATE INDEX payments_booking_idx ON futly.payment_events(booking_id,created_at);
CREATE INDEX audit_created_idx ON futly.audit_events(created_at DESC);
CREATE UNIQUE INDEX payments_idempotency_idx ON futly.payment_events(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX sessions_user_id_fk ON futly.sessions (user_id);
CREATE INDEX bookings_created_by_fk ON futly.bookings (created_by);
CREATE INDEX holds_created_by_fk ON futly.holds (created_by);
CREATE INDEX blocks_released_by_fk ON futly.blocks (released_by);
CREATE INDEX blocks_created_by_fk ON futly.blocks (created_by);
CREATE INDEX payment_events_created_by_fk ON futly.payment_events (created_by);
CREATE INDEX audit_events_actor_id_fk ON futly.audit_events (actor_id);
CREATE INDEX venue_settings_updated_by_fk ON futly.venue_settings (updated_by);
CREATE INDEX customer_reservations_booking_id_fk ON futly.customer_reservations (booking_id);
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
  RETURN jsonb_build_object('schemaVersion',1,'revision',v_revision,'state',jsonb_build_object('users',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r._ordinal) FROM futly.users r),'[]'::jsonb),
'sessions',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r._ordinal) FROM futly.sessions r),'[]'::jsonb),
'bookings',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r._ordinal) FROM futly.bookings r),'[]'::jsonb),
'holds',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r._ordinal) FROM futly.holds r),'[]'::jsonb),
'blocks',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r._ordinal) FROM futly.blocks r),'[]'::jsonb),
'payment_events',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r._ordinal) FROM futly.payment_events r),'[]'::jsonb),
'audit_events',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r._ordinal) FROM futly.audit_events r),'[]'::jsonb),
'venue_settings',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r._ordinal) FROM futly.venue_settings r),'[]'::jsonb),
'customer_sessions',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r._ordinal) FROM futly.customer_sessions r),'[]'::jsonb),
'customer_reservations',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r._ordinal) FROM futly.customer_reservations r),'[]'::jsonb)));
END;$$;
REVOKE ALL ON FUNCTION public.futly_ledger_read(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.futly_ledger_read(text) TO service_role;

CREATE FUNCTION public.futly_ledger_commit(p_token text,p_revision bigint,p_operation_id uuid,p_changes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_revision bigint; v_prior futly.ledger_operations%ROWTYPE;
  v_hash text; v_table text; v_key text; v_columns text; v_updates text; v_entry jsonb;
  v_tables text[]=ARRAY['users','sessions','bookings','holds','blocks','payment_events','audit_events','venue_settings','customer_sessions','customer_reservations'];
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
