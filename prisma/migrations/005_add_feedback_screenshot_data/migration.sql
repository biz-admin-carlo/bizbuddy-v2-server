-- Migration: add screenshotData column to Feedback table

ALTER TABLE "Feedback"
  ADD COLUMN IF NOT EXISTS "screenshotData" TEXT;
