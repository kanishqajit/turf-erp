-- Separate actual playing time from the agreed booking window and charge.
-- Existing sessions retain the full booked duration through the NULL fallback.
ALTER TABLE futly.bookings ADD COLUMN play_duration bigint
  CHECK (play_duration IS NULL OR play_duration BETWEEN 1 AND 1440);
