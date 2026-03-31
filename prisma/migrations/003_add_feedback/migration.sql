-- Migration: add Feedback table

CREATE TABLE IF NOT EXISTS "Feedback" (
  "id"            TEXT        NOT NULL PRIMARY KEY,
  "companyId"     TEXT        NOT NULL,
  "userId"        TEXT,
  "category"      TEXT        NOT NULL,
  "title"         TEXT        NOT NULL,
  "description"   TEXT        NOT NULL,
  "page"          TEXT,
  "submittedAt"   TIMESTAMPTZ,
  "status"        TEXT        NOT NULL DEFAULT 'open',
  "userAgent"     TEXT,
  "screenshotUrl" TEXT,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "Feedback"
  ADD CONSTRAINT "Feedback_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE;

ALTER TABLE "Feedback"
  ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "Feedback_companyId_idx" ON "Feedback"("companyId");
CREATE INDEX IF NOT EXISTS "Feedback_userId_idx"    ON "Feedback"("userId");
