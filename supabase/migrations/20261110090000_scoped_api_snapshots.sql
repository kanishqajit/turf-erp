-- Backend-only, request-scoped snapshots. Domain rules and revision-checked
-- commits remain authoritative; omitted rows are never interpreted as deletes.
CREATE OR REPLACE FUNCTION public.futly_api_snapshot(p_token text,p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_kind text:=p_scope->>'kind'; v_method text:=p_scope->>'method';
  v_revision bigint; v_table text; v_rows jsonb; v_state jsonb:='{}';
  v_ordinals jsonb:='{}'; v_max bigint; v_audit_id bigint;
  v_dates text[]; v_booking_ids text[]; v_limit integer; v_rate jsonb;
  v_now bigint:=floor(extract(epoch FROM now())*1000);
  v_day text:=to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD');
  v_session futly.sessions%ROWTYPE; v_role text;
BEGIN
  PERFORM futly.assert_backend(p_token);
  IF v_kind IS NULL OR v_kind NOT IN ('empty','auth','audit','staff','availability','customer') THEN RAISE EXCEPTION 'Invalid snapshot scope'; END IF;
  FOR v_rate IN SELECT value FROM jsonb_array_elements(COALESCE(p_scope->'rate','[]')) LOOP
    IF NOT public.futly_api_rate_limit(p_token,v_rate->>'key',(v_rate->>'limit')::integer,(v_rate->>'seconds')::integer) THEN
      RETURN jsonb_build_object('rateLimited',true);
    END IF;
  END LOOP;
  -- Same snapshot/revision lock as the original ledger reader. No cross-request
  -- cache: every availability or mutation sees fresh committed database rows.
  SELECT revision INTO v_revision FROM futly.ledger_meta WHERE id=1 FOR SHARE;
  IF v_kind='empty' THEN RETURN jsonb_build_object('schemaVersion',1,'revision',v_revision); END IF;
  SELECT s.* INTO v_session FROM futly.sessions s JOIN futly.users u ON u.id=s.user_id
    WHERE s.token_hash=p_scope->>'sessionHash' AND s.expires_at>v_now
      AND s.last_seen_at>v_now-1800000 AND u.active=1;
  IF FOUND THEN SELECT role INTO v_role FROM futly.users WHERE id=v_session.user_id; END IF;
  v_limit:=CASE WHEN v_role IN ('owner','manager') THEN LEAST(500,GREATEST(0,COALESCE((p_scope->>'auditLimit')::integer,0))) ELSE 0 END;
  SELECT COALESCE(array_agg(value),'{}'::text[]) INTO v_dates FROM jsonb_array_elements_text(COALESCE(p_scope->'dates','[]'));
  IF p_scope->>'targetTable'='bookings' THEN
    SELECT array_append(v_dates,date) INTO v_dates FROM futly.bookings WHERE id=p_scope->>'targetId';
  ELSIF p_scope->>'targetTable'='holds' THEN
    SELECT array_append(v_dates,date) INTO v_dates FROM futly.holds WHERE id=p_scope->>'targetId';
  ELSIF p_scope->>'targetTable'='blocks' THEN
    SELECT array_append(v_dates,date) INTO v_dates FROM futly.blocks WHERE id=p_scope->>'targetId';
  END IF;
  v_dates:=COALESCE(v_dates,'{}'::text[]);
  -- Include parent bookings for every included payment, including today's till
  -- on bookings outside the displayed calendar, and global idempotency checks.
  SELECT COALESCE(array_agg(b.id),'{}'::text[]) INTO v_booking_ids FROM futly.bookings b WHERE
    v_kind='customer' OR (v_kind='availability' AND b.date=p_scope->>'date') OR
    (v_kind='staff' AND v_role IS NOT NULL AND (
      ((v_method='GET' OR COALESCE((p_scope->>'refresh')::boolean,false)) AND (b.date BETWEEN p_scope->>'from' AND p_scope->>'to' OR b.date=v_day OR
        (COALESCE((p_scope->>'accounts')::boolean,false) AND b.date BETWEEN p_scope->>'accountsFrom' AND p_scope->>'accountsTo'))) OR
      (v_method<>'GET' AND b.date=ANY(v_dates)) OR
      EXISTS(SELECT 1 FROM futly.payment_events p WHERE p.booking_id=b.id AND
        (((v_method='GET' OR COALESCE((p_scope->>'refresh')::boolean,false)) AND p.created_at>=(v_day::date-1)::text AND p.created_at<(v_day::date+2)::text) OR
         (v_method<>'GET' AND p.idempotency_key=p_scope->>'paymentKey')))
    ));
  FOREACH v_table IN ARRAY ARRAY['users','sessions','bookings','holds','blocks','payment_events','audit_events','venue_settings','customer_sessions','customer_reservations'] LOOP
    EXECUTE format('SELECT COALESCE(max(_ordinal),0) FROM futly.%I',v_table) INTO v_max;
    v_ordinals:=v_ordinals||jsonb_build_object(v_table,v_max);
    IF v_table='users' THEN SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r._ordinal),'[]') INTO v_rows FROM futly.users r;
    ELSIF v_table='venue_settings' THEN SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r._ordinal),'[]') INTO v_rows FROM futly.venue_settings r;
    ELSIF v_table='sessions' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r._ordinal),'[]') INTO v_rows FROM futly.sessions r
        WHERE (v_kind='auth' AND v_method<>'GET') OR COALESCE((p_scope->>'fullSessions')::boolean,false) OR r.id=v_session.id;
    ELSIF v_table='bookings' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r._ordinal),'[]') INTO v_rows FROM futly.bookings r WHERE r.id=ANY(v_booking_ids);
    ELSIF v_table='payment_events' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r._ordinal),'[]') INTO v_rows FROM futly.payment_events r WHERE r.booking_id=ANY(v_booking_ids);
    ELSIF v_table='holds' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r._ordinal),'[]') INTO v_rows FROM futly.holds r WHERE
        v_kind='customer' OR (v_kind='availability' AND r.date=p_scope->>'date' AND r.expires_at>v_now) OR
        (v_kind='staff' AND v_role IS NOT NULL AND (((v_method='GET' OR COALESCE((p_scope->>'refresh')::boolean,false)) AND r.date BETWEEN p_scope->>'from' AND p_scope->>'to' AND r.expires_at>v_now) OR
          ((v_method='GET' OR COALESCE((p_scope->>'refresh')::boolean,false)) AND r.date=v_day AND r.expires_at>v_now) OR (v_method<>'GET' AND r.date=ANY(v_dates))));
    ELSIF v_table='blocks' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r._ordinal),'[]') INTO v_rows FROM futly.blocks r WHERE
        v_kind='customer' OR (v_kind='availability' AND r.date=p_scope->>'date' AND r.active=1) OR
        (v_kind='staff' AND v_role IS NOT NULL AND (((v_method='GET' OR COALESCE((p_scope->>'refresh')::boolean,false)) AND (r.date BETWEEN p_scope->>'from' AND p_scope->>'to' OR r.date=v_day) AND r.active=1) OR
          (v_method<>'GET' AND r.date=ANY(v_dates))));
    ELSIF v_table='audit_events' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r._ordinal),'[]') INTO v_rows FROM
        (SELECT * FROM futly.audit_events ORDER BY id DESC LIMIT v_limit) r;
    ELSIF v_table='customer_sessions' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r._ordinal),'[]') INTO v_rows FROM futly.customer_sessions r WHERE v_kind='customer';
    ELSIF v_table='customer_reservations' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r._ordinal),'[]') INTO v_rows FROM futly.customer_reservations r WHERE v_kind='customer';
    END IF;
    v_state:=v_state||jsonb_build_object(v_table,v_rows);
  END LOOP;
  SELECT COALESCE(max(id),0) INTO v_audit_id FROM futly.audit_events;
  RETURN jsonb_build_object('schemaVersion',1,'revision',v_revision,'state',v_state,'ordinals',v_ordinals,'auditSequence',v_audit_id);
END;$$;
REVOKE ALL ON FUNCTION public.futly_api_snapshot(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.futly_api_snapshot(text,jsonb) TO service_role;
