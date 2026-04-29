-- Adds grossHours to TimeLog.
-- Raw timeOut − timeIn in hours before any deductions. Counterpart to netWorkedHours.
-- Run: psql $DATABASE_URL -f scripts/migrate-gross-hours.sql
-- Then: npx prisma generate

ALTER TABLE "TimeLog"
  ADD COLUMN IF NOT EXISTS "grossHours" DECIMAL(6,2);
