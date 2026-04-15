-- migrate-rawot-minutes.sql
--
-- Adds rawOtMinutes to TimeLog.
--
-- rawOtMinutes — eligible OT minutes past the Driver PM shift end.
--   Only populated for DRIVER_AIDE_PM and DRIVER_AIDE punch types.
--   NULL for REGULAR logs (OT threshold logic is handled client-side for those).
--   Computed by computeTimeLogSummary(); never set manually.
--
-- Run: psql $DATABASE_URL -f scripts/migrate-rawot-minutes.sql

ALTER TABLE "TimeLog"
  ADD COLUMN IF NOT EXISTS "rawOtMinutes" INTEGER;
