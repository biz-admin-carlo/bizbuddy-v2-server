-- Migration: make DepartmentCutoffSettings.departmentId nullable
--
-- Allows a company-wide cutoff setting (departmentId = null) so the
-- auto-gen job can generate periods for "No Department" employees.
--
-- Changes:
--   1. Drop the old single-field unique constraint on departmentId
--   2. Drop + recreate the FK with ON DELETE SET NULL (was CASCADE)
--   3. Make the column nullable
--   4. Drop the old (companyId, departmentId) index
--   5. Add a compound unique index on (companyId, departmentId)
--   6. Add a partial unique index to enforce one company-wide row per company
--
-- Run BEFORE: npx prisma generate

BEGIN;

-- 1. Drop old unique constraint on departmentId alone
ALTER TABLE "DepartmentCutoffSettings"
  DROP CONSTRAINT IF EXISTS "DepartmentCutoffSettings_departmentId_key";

-- 2. Drop old FK (was ON DELETE CASCADE)
ALTER TABLE "DepartmentCutoffSettings"
  DROP CONSTRAINT IF EXISTS "DepartmentCutoffSettings_departmentId_fkey";

-- 3. Make departmentId nullable
ALTER TABLE "DepartmentCutoffSettings"
  ALTER COLUMN "departmentId" DROP NOT NULL;

-- 4. Recreate FK — keep ON DELETE CASCADE so deleting a department still removes its settings
ALTER TABLE "DepartmentCutoffSettings"
  DROP CONSTRAINT IF EXISTS "DepartmentCutoffSettings_departmentId_fkey";
ALTER TABLE "DepartmentCutoffSettings"
  ADD CONSTRAINT "DepartmentCutoffSettings_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Drop old plain index
DROP INDEX IF EXISTS "DepartmentCutoffSettings_companyId_departmentId_idx";

-- 6. Compound unique index for non-null departmentId rows
CREATE UNIQUE INDEX IF NOT EXISTS "DepartmentCutoffSettings_companyId_departmentId_key"
  ON "DepartmentCutoffSettings"("companyId", "departmentId");

-- 7. Partial unique index: only one company-wide (null) row per company
--    Standard UNIQUE on (companyId, departmentId) does NOT prevent duplicate
--    NULLs in Postgres (NULL != NULL), so this partial index is required.
CREATE UNIQUE INDEX IF NOT EXISTS "DepartmentCutoffSettings_companyId_null_dept_key"
  ON "DepartmentCutoffSettings"("companyId")
  WHERE "departmentId" IS NULL;

COMMIT;
