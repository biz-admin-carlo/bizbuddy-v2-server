-- migrate-cutoff-segment-type.sql
--
-- Adds segmentType to TimeLogApproval and restructures the unique constraint
-- so that DRIVER_AIDE TimeLogs can have 3 segment approval records per period.
--
-- Run:
--   psql $DATABASE_URL -f scripts/migrate-cutoff-segment-type.sql
-- Then:
--   npx prisma generate

BEGIN;

-- 1. Add segmentType column (nullable — null = REGULAR punch)
ALTER TABLE "TimeLogApproval"
  ADD COLUMN IF NOT EXISTS "segmentType" TEXT;

-- 2. Drop the old single-column unique constraint on timeLogId
ALTER TABLE "TimeLogApproval"
  DROP CONSTRAINT IF EXISTS "TimeLogApproval_timeLogId_key";

-- 3. Drop old global indexes if they exist (missing cutoffPeriodId — caused
--    regular/driver_pm segments to be silently skipped when a second cutoff
--    covered the same TimeLogs, because (timeLogId, segmentType) was globally
--    unique across all cutoff periods instead of per-cutoff).
DROP INDEX IF EXISTS "TimeLogApproval_timeLogId_null_segment_key";
DROP INDEX IF EXISTS "TimeLogApproval_timeLogId_segmentType_key";

-- 4. Unique index for REGULAR punches (segmentType IS NULL) — scoped per cutoff
--    Prevents duplicate null-segment records for the same TimeLog in the same period.
CREATE UNIQUE INDEX IF NOT EXISTS "TimeLogApproval_cutoff_timeLogId_null_key"
  ON "TimeLogApproval" ("cutoffPeriodId", "timeLogId")
  WHERE "segmentType" IS NULL;

-- 5. Unique index for DRIVER_AIDE segment records (segmentType NOT NULL) — scoped per cutoff
--    Prevents duplicate segment records of the same type for the same TimeLog in the same period.
--    cutoffPeriodId is intentionally included so the same TimeLog can be reviewed
--    independently in different non-overlapping cutoff periods.
CREATE UNIQUE INDEX IF NOT EXISTS "TimeLogApproval_cutoff_timeLogId_segmentType_key"
  ON "TimeLogApproval" ("cutoffPeriodId", "timeLogId", "segmentType")
  WHERE "segmentType" IS NOT NULL;

COMMIT;
