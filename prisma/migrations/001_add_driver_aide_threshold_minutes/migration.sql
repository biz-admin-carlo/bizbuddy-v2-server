-- Migration: add driverAideThresholdMinutes to Company
ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "driverAideThresholdMinutes" INTEGER DEFAULT 45;
