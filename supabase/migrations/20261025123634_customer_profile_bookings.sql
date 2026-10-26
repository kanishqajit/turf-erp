-- Account IDs are assigned only by the trusted API after Supabase Auth verification.
-- Existing reservations remain private browser-owned records until explicitly claimed.
ALTER TABLE futly.customer_reservations ADD COLUMN profile_id text;
CREATE INDEX customer_reservations_profile ON futly.customer_reservations(profile_id);
-- This private table retains its existing RLS and service-role-only privileges.
