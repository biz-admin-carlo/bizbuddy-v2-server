-- migrate-timelog-approval-segment-bounds.sql
--
-- Adds segmentStart / segmentEnd to TimeLogApproval.
-- These fields store the scheduled segment window (start/end) for each
-- DRIVER_AIDE approval row so the Cutoff Review page can show the correct
-- clock-in/clock-out per segment sub-row instead of the raw punch span.
--
-- SAFE TO RUN multiple times (IF NOT EXISTS / IF NOT EXISTS guards).
-- After running: npx prisma generate

ALTER TABLE "TimeLogApproval"
  ADD COLUMN IF NOT EXISTS "segmentStart" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "segmentEnd"   TIMESTAMPTZ;

-- Optional: add an index if you plan to query by these fields later.
-- Not required for the initial release.
-- CREATE INDEX IF NOT EXISTS "TimeLogApproval_segmentStart_idx"
--   ON "TimeLogApproval" ("segmentStart");
