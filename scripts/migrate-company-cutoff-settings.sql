-- Migration: CompanyCutoffSettings
-- Run: psql $DATABASE_URL -f scripts/migrate-company-cutoff-settings.sql
-- Then: npx prisma generate

CREATE TABLE "CompanyCutoffSettings" (
  "id"                TEXT        NOT NULL,
  "companyId"         TEXT        NOT NULL,
  "seedStartDate"     DATE        NOT NULL,
  "durationDays"      INTEGER     NOT NULL,
  "paymentOffsetDays" INTEGER     NOT NULL DEFAULT 5,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("id"),
  UNIQUE ("companyId"),
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
