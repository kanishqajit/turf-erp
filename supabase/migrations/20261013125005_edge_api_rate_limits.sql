CREATE TABLE futly.api_rate_windows (
  key_hash text NOT NULL,
  bucket bigint NOT NULL,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (key_hash,bucket)
);
CREATE INDEX api_rate_windows_expiry ON futly.api_rate_windows(expires_at);
ALTER TABLE futly.api_rate_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON futly.api_rate_windows FROM PUBLIC,anon,authenticated;
GRANT ALL ON futly.api_rate_windows TO service_role;

CREATE FUNCTION public.futly_api_rate_limit(p_token text,p_key text,p_limit integer,p_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_bucket bigint; v_attempts integer;
BEGIN
  PERFORM futly.assert_backend(p_token);
  IF p_limit NOT BETWEEN 1 AND 1000 OR p_seconds NOT BETWEEN 1 AND 3600 OR length(p_key)>500 THEN
    RAISE EXCEPTION 'Invalid rate limit';
  END IF;
  v_bucket:=floor(extract(epoch FROM now())/p_seconds);
  DELETE FROM futly.api_rate_windows WHERE expires_at<now()-interval '1 hour';
  INSERT INTO futly.api_rate_windows(key_hash,bucket,attempts,expires_at)
  VALUES(encode(sha256(convert_to(p_key,'UTF8')),'hex'),v_bucket,1,now()+make_interval(secs=>p_seconds))
  ON CONFLICT(key_hash,bucket) DO UPDATE SET attempts=futly.api_rate_windows.attempts+1
  RETURNING attempts INTO v_attempts;
  RETURN v_attempts<=p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.futly_api_rate_limit(text,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.futly_api_rate_limit(text,text,integer,integer) TO service_role;
