-- Migration: replace screenshot fields with device info + add logNumber

-- Drop screenshot columns if they exist
ALTER TABLE "Feedback" DROP COLUMN IF EXISTS "screenshotUrl";
ALTER TABLE "Feedback" DROP COLUMN IF EXISTS "screenshotData";

-- Ensure base columns exist (in case migrations 004/005 were not run)
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMPTZ;
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "userAgent"   TEXT;

-- Add device info columns
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "browser"          TEXT;
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "os"               TEXT;
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "device"           TEXT;
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "screenResolution" TEXT;

-- Add logNumber starting at 1000
CREATE SEQUENCE IF NOT EXISTS "Feedback_logNumber_seq" START WITH 1000 INCREMENT BY 1;
ALTER TABLE "Feedback"
  ADD COLUMN IF NOT EXISTS "logNumber" INTEGER NOT NULL DEFAULT nextval('"Feedback_logNumber_seq"');
ALTER SEQUENCE "Feedback_logNumber_seq" OWNED BY "Feedback"."logNumber";
CREATE UNIQUE INDEX IF NOT EXISTS "Feedback_logNumber_key" ON "Feedback"("logNumber");
