-- Migration: add_auto_break_policies
-- Run this against your database, then run: npx prisma generate

-- Company: auto-break configuration fields
ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "autoBreakBasis"      TEXT,
  ADD COLUMN IF NOT EXISTS "autoLunchEnabled"    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "autoLunchMinutes"    INTEGER,
  ADD COLUMN IF NOT EXISTS "autoLunchAfterHours" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "autoLunchDeductible" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "autoCoffeeEnabled"   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "autoCoffeeMinutes"   INTEGER,
  ADD COLUMN IF NOT EXISTS "autoCoffeeCount"     INTEGER,
  ADD COLUMN IF NOT EXISTS "autoCoffeeDeductible" BOOLEAN NOT NULL DEFAULT FALSE;

-- Department: auto-break entitlement flags
ALTER TABLE "Department"
  ADD COLUMN IF NOT EXISTS "autoLunchEntitled"  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "autoCoffeeEntitled" BOOLEAN NOT NULL DEFAULT FALSE;

-- Shift: auto-break entitlement flags
ALTER TABLE "Shift"
  ADD COLUMN IF NOT EXISTS "autoLunchEntitled"  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "autoCoffeeEntitled" BOOLEAN NOT NULL DEFAULT FALSE;

-- TimeLog: audit flags for injected breaks
ALTER TABLE "TimeLog"
  ADD COLUMN IF NOT EXISTS "autoLunchApplied"  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "autoCoffeeApplied" BOOLEAN NOT NULL DEFAULT FALSE;
