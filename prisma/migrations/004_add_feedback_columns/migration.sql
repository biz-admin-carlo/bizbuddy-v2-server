-- Migration: add missing columns to Feedback table

ALTER TABLE "Feedback"
  ADD COLUMN IF NOT EXISTS "submittedAt"   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "userAgent"     TEXT,
  ADD COLUMN IF NOT EXISTS "screenshotUrl" TEXT;

-- Remove old userRole column if it exists from the initial version
ALTER TABLE "Feedback" DROP COLUMN IF EXISTS "userRole";
