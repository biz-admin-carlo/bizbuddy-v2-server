-- Migration: add auto-lunch config fields to Department and TimeLog

ALTER TABLE "Department"
  ADD COLUMN IF NOT EXISTS "autoLunchDurationMinutes" INTEGER DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "autoLunchAfterHours"      DOUBLE PRECISION DEFAULT 4.0;

ALTER TABLE "TimeLog"
  ADD COLUMN IF NOT EXISTS "autoLunchDeductionMinutes" INTEGER;
