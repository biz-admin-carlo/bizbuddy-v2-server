-- One-time cleanup: clock out all sessions still marked as active.
-- Sets timeOut to NOW(), closes any open breaks, and flags autoClockOut for SV review.

UPDATE "TimeLog"
SET
  "timeOut"        = NOW(),
  "status"         = false,
  "autoClockOut"   = true,
  "autoClockOutAt" = NOW(),
  "updatedAt"      = NOW()
WHERE "status" = true;
