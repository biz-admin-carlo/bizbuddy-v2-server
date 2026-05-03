-- Drop dead auto-break fields that were never read by the service layer.
--
-- Department: autoLunchDurationMinutes, autoLunchAfterHours
--   Written by departmentController but superseded by autoBreakLunchMinutes /
--   autoBreakLunchAfterHours which the service actually reads. Frontend confirmed
--   to use the new field names exclusively.
--
-- Company: autoLunchMinutes, autoLunchAfterHours, autoLunchDeductible,
--          autoCoffeeMinutes, autoCoffeeCount, autoCoffeeDeductible
--   Present in schema but never read or written by any controller or service.
--   Break config at company level is fully delegated to department/shift records.

ALTER TABLE "Department"
  DROP COLUMN IF EXISTS "autoLunchDurationMinutes",
  DROP COLUMN IF EXISTS "autoLunchAfterHours";

ALTER TABLE "Company"
  DROP COLUMN IF EXISTS "autoLunchMinutes",
  DROP COLUMN IF EXISTS "autoLunchAfterHours",
  DROP COLUMN IF EXISTS "autoLunchDeductible",
  DROP COLUMN IF EXISTS "autoCoffeeMinutes",
  DROP COLUMN IF EXISTS "autoCoffeeCount",
  DROP COLUMN IF EXISTS "autoCoffeeDeductible";
