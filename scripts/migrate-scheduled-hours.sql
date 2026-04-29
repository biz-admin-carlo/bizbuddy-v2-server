-- Adds scheduledHours to TimeLog.
-- Sum of assigned shift durations for the day; null when no shift assigned.
-- Run: psql $DATABASE_URL -f scripts/migrate-scheduled-hours.sql
-- Then: npx prisma generate

ALTER TABLE "TimeLog"
  ADD COLUMN IF NOT EXISTS "scheduledHours" DECIMAL(6,2);
