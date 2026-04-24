-- Migration: auto-break detail fields moved to Department and Shift
-- Run this, then: npx prisma generate

-- Department: per-department auto-break configuration
ALTER TABLE "Department"
  ADD COLUMN IF NOT EXISTS "autoBreakLunchMinutes"    INTEGER,
  ADD COLUMN IF NOT EXISTS "autoBreakLunchAfterHours" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "autoBreakLunchDeductible" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "autoBreakCoffeeMinutes"   INTEGER,
  ADD COLUMN IF NOT EXISTS "autoBreakCoffeeCount"     INTEGER,
  ADD COLUMN IF NOT EXISTS "autoBreakCoffeeDeductible" BOOLEAN NOT NULL DEFAULT FALSE;

-- Shift: per-shift auto-break configuration
ALTER TABLE "Shift"
  ADD COLUMN IF NOT EXISTS "autoBreakLunchMinutes"    INTEGER,
  ADD COLUMN IF NOT EXISTS "autoBreakLunchAfterHours" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "autoBreakLunchDeductible" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "autoBreakCoffeeMinutes"   INTEGER,
  ADD COLUMN IF NOT EXISTS "autoBreakCoffeeCount"     INTEGER,
  ADD COLUMN IF NOT EXISTS "autoBreakCoffeeDeductible" BOOLEAN NOT NULL DEFAULT FALSE;
