-- Migration: add browser, os, device columns to Feedback table
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "browser" TEXT;
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "os"      TEXT;
ALTER TABLE "Feedback" ADD COLUMN IF NOT EXISTS "device"  TEXT;
