-- migrate-timelog-segment-hours.sql
--
-- Adds segment hour fields to TimeLog.
-- These are computed by computeTimeLogSummary() and must never be set manually.
--
-- regularSegmentHours  — Regular shift hours (schedule-bounded, pre-schedule time excluded).
--                        Populated for all Driver/Aide punch types. null for REGULAR.
-- driverAmSegmentHours — Driver AM segment hours (clamped to shift window).
--                        Populated for DRIVER_AIDE_AM and DRIVER_AIDE. null otherwise.
-- driverPmSegmentHours — Driver PM segment hours (clamped to shift window).
--                        Populated for DRIVER_AIDE_PM and DRIVER_AIDE. null otherwise.
--
-- Note: netWorkedHours semantics change for Driver/Aide logs after this migration.
--   REGULAR       → gross (timeOut − timeIn) minus breaks (unchanged)
--   DRIVER_AIDE_* → sum of segment hours (OT excluded)
--
-- Run: psql $DATABASE_URL -f scripts/migrate-timelog-segment-hours.sql

ALTER TABLE "TimeLog"
  ADD COLUMN IF NOT EXISTS "regularSegmentHours"  NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS "driverAmSegmentHours" NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS "driverPmSegmentHours" NUMERIC(6, 2);
