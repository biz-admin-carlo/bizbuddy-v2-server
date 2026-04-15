-- migrate-leave-status-enum.sql
--
-- Adds missing leaveStatus enum values and converts Leave.status
-- from plain VARCHAR to the typed leaveStatus enum.
--
-- Run BEFORE deploying the updated server code:
--   psql $DATABASE_URL -f scripts/migrate-leave-status-enum.sql
--   npx prisma generate
--
-- Note: ADD VALUE cannot run inside a transaction block in PostgreSQL.
-- Run this script in autocommit mode (default for psql -f).

ALTER TYPE "leaveStatus" ADD VALUE IF NOT EXISTS 'pending_secondary';
ALTER TYPE "leaveStatus" ADD VALUE IF NOT EXISTS 'cancelled';

-- Cast the existing varchar column to the enum type.
-- Any row with an unrecognized status value will error here —
-- verify no invalid status values exist before running:
--   SELECT DISTINCT status FROM "Leave";
ALTER TABLE "Leave"
  ALTER COLUMN "status" TYPE "leaveStatus"
  USING "status"::"leaveStatus";
