-- migrate-liveuser-autoclockout.sql
--
-- Adds auto clock-out configuration fields to Company and creates the LiveUser table.
--
-- Company fields:
--   autoClockOutWarningHours  — hours BEFORE scheduledEnd to send employee warning (default 0.5)
--   autoClockOutGraceHours    — hours AFTER scheduledEnd to auto-close the session (default 1.0)
--   autoClockOutNotifyEmails  — JSON array of supervisor email addresses to notify on auto-close
--
-- LiveUser table:
--   One row per actively-clocked-in employee. Created at clock-in, removed at
--   self clock-out or auto-close. warnAt / closeAt are pre-computed so cron
--   queries are simple indexed range scans.
--
-- Run: psql $DATABASE_URL -f scripts/migrate-liveuser-autoclockout.sql

-- ── Company: auto clock-out config ───────────────────────────────────────────
ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "autoClockOutWarningHours" NUMERIC(4, 2) DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS "autoClockOutGraceHours"   NUMERIC(4, 2) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS "autoClockOutNotifyEmails" JSONB         DEFAULT '[]'::jsonb;

-- ── LiveUser table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LiveUser" (
  "id"           TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "userId"       TEXT        NOT NULL,
  "companyId"    TEXT        NOT NULL,
  "timeLogId"    TEXT        NOT NULL,
  "scheduledEnd" TIMESTAMPTZ,
  "warnAt"       TIMESTAMPTZ,
  "closeAt"      TIMESTAMPTZ,
  "warningSent"  BOOLEAN     NOT NULL DEFAULT false,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "LiveUser_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "LiveUser_userId_key"    UNIQUE ("userId"),
  CONSTRAINT "LiveUser_timeLogId_key" UNIQUE ("timeLogId"),
  CONSTRAINT "LiveUser_userId_fkey"
    FOREIGN KEY ("userId")    REFERENCES "User"("id")    ON DELETE CASCADE,
  CONSTRAINT "LiveUser_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE,
  CONSTRAINT "LiveUser_timeLogId_fkey"
    FOREIGN KEY ("timeLogId") REFERENCES "TimeLog"("id") ON DELETE CASCADE
);

-- Indexes for fast cron queries
CREATE INDEX IF NOT EXISTS "LiveUser_companyId_idx" ON "LiveUser" ("companyId");
CREATE INDEX IF NOT EXISTS "LiveUser_warnAt_idx"    ON "LiveUser" ("warnAt");
CREATE INDEX IF NOT EXISTS "LiveUser_closeAt_idx"   ON "LiveUser" ("closeAt");
