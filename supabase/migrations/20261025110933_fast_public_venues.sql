-- Return only public configuration, with the same trusted-proxy authentication.
CREATE OR REPLACE FUNCTION public.futly_public_venue_settings(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM futly.assert_backend(p_token);
  RETURN jsonb_build_object('depositAmount',COALESCE(
    (SELECT value_integer FROM futly.venue_settings WHERE key='deposit_amount'),500));
END;$$;
REVOKE ALL ON FUNCTION public.futly_public_venue_settings(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.futly_public_venue_settings(text) TO service_role;
