# Changelog — v2.10.9

---

## Bug Fixes

### BB-020 — Request Punch Log: replace day-level block with time-range overlap check

**Files changed:**
- `src/controllers/Features/requestPunchLogController.js`
- `src/routes/Features/requestPunchLogRoutes.js`

**Root cause:**
`submitRequestPunchLog` blocked any submission where a `TimeLog` already existed on the same calendar day. For multi-shift companies (e.g. B&C), employees legitimately clock in more than once per day, so the day-level check was too aggressive — it prevented valid second-shift punch log requests entirely.

The same naive date-range check existed in `approveRequestedPunchLog` as the race-condition guard.

**Fix:**
Replaced both checks with a shared `findOverlappingLog(userId, clockIn, clockOut)` helper that uses a proper interval overlap query:

```
existingTimeIn < requestedClockOut AND existingTimeOut > requestedClockIn
```

A `TimeLog` with `timeOut: null` (employee currently clocked in) is always treated as a conflict.

This allows non-overlapping same-day requests to pass while still blocking actual time collisions.

**New endpoint — `POST /api/request-punch-log/check-conflict`:**
A pre-check endpoint for the frontend to validate before the user reaches the submit step. Accepts `{ requestedClockIn, requestedClockOut }` and returns:

```jsonc
{
  "hasConflict": true,
  "conflictingLogId": "clxxxxxxxxxxxxx",
  "conflictingTimeIn": "2026-06-01T01:00:00.000Z",
  "conflictingTimeOut": "2026-06-01T09:00:00.000Z"   // null if still clocked in
}
```

The `/submit` 409 response also includes `conflictingTimeIn` and `conflictingTimeOut` as a safety-net fallback.

---

### BB-013 — BNC Cutoff: "0h scheduled" and false "Left early" badges when shifts assigned after clock-out

> BNC exclusive. DayCare unaffected.

**Files changed:**
- `src/controllers/Features/cutoffPeriodController.js`

**Root cause:**
`computeBnC` runs at clock-out time. When a ShiftSchedule is configured after employees have already clocked out, the derived fields (`scheduledHours`, `lateHours`, `undertimeHours`) are stored with no shift context — `scheduledHours = null`. The cutoff page then displays "0h scheduled" and a false "Left early" badge (undertime was computed from the fallback `timeIn + defaultShiftHours` instead of the real shift end). The sync button did not address this because it only created missing `TimeLogApproval` records.

**Fix — `syncCutoffApprovals`:**
The sync endpoint (`POST /api/cutoff-periods/:id/sync`) now performs a second pass after creating approval records: it fetches all timelogs in the period where `scheduledHours IS NULL` (the exact stale-compute signal) and re-runs `computeTimeLogSummary` for each. For BNC companies this calls `computeBnC`, which now finds the properly configured shifts and writes fresh `scheduledHours`, `lateHours`, and `undertimeHours` back to the TimeLog.

Recompute is targeted — only timelogs with `scheduledHours = null` are touched. Timelogs where shifts were already assigned at clock-out time are skipped entirely.

**`computeTimeLogSummary` import** added to the controller (was only using `resolveDriverAideSegments` before).

**Response shape** updated to include recompute counts:
```json
{
  "message": "Sync complete. 18 time log(s) recomputed.",
  "data": {
    "created": 0,
    "total": 36,
    "recomputed": 18,
    "recomputeFailed": 0
  }
}
```

**Sync button now covers both admin scenarios:**
1. New timelogs added after cutoff creation → creates missing approval records
2. Shifts assigned after employees clocked out → heals stale computed fields
