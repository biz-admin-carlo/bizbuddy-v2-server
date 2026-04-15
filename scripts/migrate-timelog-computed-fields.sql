-- Phase 1: Add derived/computed fields to TimeLog.
-- These are populated by computeTimeLogSummary() at clock-out time.
-- Raw timeIn/timeOut are never modified — these fields are always recomputable.

ALTER TABLE "TimeLog"
  ADD COLUMN "undertimeHours"        DECIMAL(5,2),
  ADD COLUMN "netWorkedHours"        DECIMAL(6,2),
  ADD COLUMN "lunchDeductionMinutes" INTEGER,
  ADD COLUMN "totalBreakMinutes"     INTEGER,
  ADD COLUMN "calculatedAt"          TIMESTAMPTZ;
