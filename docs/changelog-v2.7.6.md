# BizBuddy Server — v2.7.6 Change Log

> **Release Date:** 2026-05-03
> **Prepared for:** Web Client & iOS/Mobile Teams
> **Server Version:** v2.7.6 (from v2.7.5)
> **Breaking changes:** Two schema migrations required — (1) dead auto-lunch/coffee fields removed from `Department` and `Company` models (section 9); (2) `segmentStart`/`segmentEnd` added to `TimeLogApproval` (section 10). No API-level breaking changes for web/mobile clients.

---

## Table of Contents

**New Endpoints**
1. [`DELETE /api/timelogs/:id/auto-breaks` — Admin: Clear Auto-Injected Breaks](#1-delete-apitimelogsidauto-breaks--admin-clear-auto-injected-breaks)
2. [`PATCH /api/timelogs/:id/punch-type` — Admin: Correct Punch Type](#2-patch-apitimelogsidpunch-type--admin-correct-punch-type)
3. [`DELETE /api/timelogs/:id` — Admin: Hard-Delete a Punch Log](#3-delete-apitimelogsid--admin-hard-delete-a-punch-log)
4. [`POST /api/shiftschedules/create` — Multi-Employee Batch Assignment via `targetIds[]`](#4-post-apishiftschedulescreate--multi-employee-batch-assignment-via-targetids)

**Bug Fixes**
5. [Shift Matching: Midnight-Crossing Shifts Now Resolved Correctly](#5-shift-matching-midnight-crossing-shifts-now-resolved-correctly)
6. [Auto-Break ShiftSchedule Fallback for Recurring-Schedule Employees](#6-auto-break-shiftschedule-fallback-for-recurring-schedule-employees)
7. [Grace Period Threshold Extended by 59 Seconds](#7-grace-period-threshold-extended-by-59-seconds)
8. [Driver/Aide `scheduledHours` Double-Count Fixed](#8-driveraide-scheduledhours-double-count-fixed)

**Schema Changes**
9. [Dead Auto-Lunch / Coffee Fields Removed from Department & Company](#9-dead-auto-lunch--coffee-fields-removed-from-department--company)
10. [TimeLogApproval — `segmentStart` / `segmentEnd` for Driver/Aide Cutoff Review](#10-timelogapproval--segmentstart--segmentend-for-driveraide-cutoff-review)

**Internal**
11. [Backfill Script — Elapsed Timer & Orphan-User Guard](#11-backfill-script--elapsed-timer--orphan-user-guard)

---

## New Endpoints

### 1. `DELETE /api/timelogs/:id/auto-breaks` — Admin: Clear Auto-Injected Breaks

> **Auth:** `admin`, `superadmin` only — company-scoped
> **Breaking:** No

---

#### What It Does

Admins can now clear wrongly auto-injected lunch and/or coffee breaks directly from the Company Panel punch log edit dialog without needing direct DB access. The endpoint accepts a granular body so only the specified break type(s) are cleared:

```json
{ "lunch": true }
{ "coffee": true }
{ "lunch": true, "coffee": true }
```

**Lunch clear:** Nulls `lunchBreak` and `autoLunchDeductionMinutes`, sets `autoLunchApplied = false`.

**Coffee clear:** Strips only `auto: true` entries from `coffeeBreaks` (manual breaks taken by the employee are preserved), sets `autoCoffeeApplied = false`.

After clearing, `computeTimeLogSummary` runs immediately so `netWorkedHours`, deductions, and OT update in the same request. A `timeLogUpdated` socket event (`type: "autoBreakCleared"`) is emitted to the employee's room so the client panel refreshes live.

---

#### Response

```json
{ "message": "Auto-breaks cleared.", "data": { ...updatedTimeLog } }
```

If neither `autoLunchApplied` nor `autoCoffeeApplied` was set on the log, returns `200` with:

```json
{ "message": "No auto-breaks were applied — nothing to clear." }
```

---

#### Client-Side Notes

**Admin punch log edit dialog (`EmployeesPunchLogs.jsx`):** Show "Clear Auto-Breaks & Reset Flags" button only when `autoLunchApplied || autoCoffeeApplied`. Send `{ lunch: autoLunchApplied, coffee: autoCoffeeApplied }` in body. Re-fetch logs on success.

---

#### Files Changed

| File | Change |
|---|---|
| `src/controllers/Features/timeLogController.js` | `clearAutoBreaks` handler added; exported |
| `src/routes/Features/timeLogRoutes.js` | `DELETE /:id/auto-breaks` registered |

---

### 2. `PATCH /api/timelogs/:id/punch-type` — Admin: Correct Punch Type

> **Auth:** `admin`, `superadmin`, `hr`, `supervisor` — company-scoped
> **Breaking:** No

---

#### What It Does

Company admins can correct the punch type on an existing time log (e.g. change `REGULAR` → `DRIVER_AIDE` when an employee was mis-tagged at clock-in). Relevant primarily for DayCare companies but has no company-type restriction server-side — client gating is sufficient.

After updating `TimeLog.punchType`, `computeTimeLogSummary` runs immediately so all derived fields (`driverAmSegmentHours`, `regularSegmentHours`, `driverPmSegmentHours`, `netWorkedHours`, etc.) reflect the new punch type before the response is returned.

---

#### Request Body

```json
{ "punchType": "REGULAR" | "DRIVER_AIDE" | "DRIVER_AIDE_AM" | "DRIVER_AIDE_PM" }
```

Invalid values return `400`:

```json
{ "message": "Invalid punchType. Allowed: REGULAR, DRIVER_AIDE, DRIVER_AIDE_AM, DRIVER_AIDE_PM" }
```

---

#### Cutoff Guard

Returns `409` if the log is part of a **locked or processed** cutoff period — those records are payroll-finalized and cannot be altered:

```json
{ "message": "Cannot update a log that is part of a locked or processed cutoff period." }
```

For logs in **open** cutoffs, the update is allowed. The cutoff admin should re-sync the open cutoff (`POST /api/cutoff-periods/:id/sync`) afterward to rebuild the `TimeLogApproval` segment records.

---

#### Response

```json
{ "message": "Punch type updated.", "data": { ...updatedTimeLog } }
```

A `timeLogUpdated` socket event (`type: "punchTypeUpdated"`) is emitted to the log owner's room.

---

#### Files Changed

| File | Change |
|---|---|
| `src/controllers/Features/timeLogController.js` | `updatePunchType` handler added; `ADMIN_ROLES` set and `getLockedCutoffForLog` helper introduced (shared with Change 3) |
| `src/routes/Features/timeLogRoutes.js` | `PATCH /:id/punch-type` registered |

---

### 3. `DELETE /api/timelogs/:id` — Admin: Hard-Delete a Punch Log

> **Auth:** `admin`, `superadmin`, `hr`, `supervisor` — company-scoped
> **Breaking:** No

---

#### What It Does

Permanently removes a single punch log record. Intended for the Company Panel punch log admin view where the admin has confirmed deletion. This is a hard delete — there is no recovery path.

All related records cascade automatically via the Prisma schema `onDelete: Cascade` relationships:

| Related Model | Behaviour |
|---|---|
| `TimeLogApproval` | Cascade-deleted |
| `ContestTimeLog` | Cascade-deleted |
| `Overtime` | Cascade-deleted |
| `RequestedTimeLog` | Cascade-deleted |
| `LiveUser` | Cascade-deleted |

---

#### Cutoff Guard

Returns `409` if the log is part of a **locked or processed** cutoff period:

```json
{ "message": "Cannot delete a log that is part of a locked or processed cutoff period." }
```

For logs in **open** cutoffs, deletion proceeds and the cascade removes the associated `TimeLogApproval` records. The open cutoff's totals will be stale until re-synced.

> Note: The client already hides the Delete action when payroll status is locked/final, so the 409 is a belt-and-suspenders server guard.

---

#### Response

```json
{ "message": "Deleted successfully." }
```

A `timeLogUpdated` socket event (`type: "delete", data: { id }`) is emitted to the log owner's room so the employee's client panel clears the row live.

---

#### How It Differs from the Existing Employee Delete

| | Old `DELETE /timelogs/delete/:id` | New `DELETE /timelogs/:id` |
|---|---|---|
| Who can call it | Employee (own log only) | Admin / HR / Supervisor |
| Company scope | N/A — own log | Enforced (`companyId` check) |
| Cutoff guard | None | Blocks on locked/processed |
| Socket emit | To admin's own room | To log **owner's** room |

---

#### Files Changed

| File | Change |
|---|---|
| `src/controllers/Features/timeLogController.js` | `adminDeleteTimeLog` handler added; reuses `ADMIN_ROLES` and `getLockedCutoffForLog` from Change 2 |
| `src/routes/Features/timeLogRoutes.js` | `DELETE /:id` registered (two-segment paths `/:id/auto-breaks` and `/delete/:id` are unambiguous — no shadowing) |

---

### 4. `POST /api/shiftschedules/create` — Multi-Employee Batch Assignment via `targetIds[]`

> **Auth:** `admin`, `superadmin`, `supervisor`
> **Breaking:** No — `targetId: string` (old form) is still accepted for `individual` type and coerced to `targetIds: [targetId]`

---

#### What It Does

`POST /api/shiftschedules/create` with `assignmentType: "individual"` now accepts a `targetIds` array so admins can assign a recurring schedule to multiple employees in a single request. The server creates one `ShiftSchedule` row per employee — each independently editable and deletable.

---

#### Updated Request Body (individual type)

```json
{
  "shiftId": "string",
  "daysOfWeek": [1, 2, 3, 4, 5],
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "assignmentType": "individual",
  "targetIds": ["uuid-emp-1", "uuid-emp-2"],
  "replaceConflicts": false,
  "skipConflicts": false
}
```

`department` and `all` assignment types are unchanged — they still use `targetId`.

---

#### Conflict Detection

When no resolution flag is set, conflicts from **all** employees are aggregated into a single `409` response:

```json
{
  "message": "Scheduling conflicts detected",
  "totalConflicts": 7,
  "conflicts": [
    { "userId": "uuid-emp-1", "userName": "Juan dela Cruz", "userEmail": "juan@biz.com", "conflictCount": 3 },
    { "userId": "uuid-emp-2", "userName": "Maria Santos",   "userEmail": "maria@biz.com", "conflictCount": 4 }
  ]
}
```

Conflict detection is **time-aware**: sequential shifts (e.g. Driver/Aide AM ending at 08:00, Regular starting at 08:00) do not trigger a false conflict. Only genuine time-window overlaps are flagged.

---

#### Resolution Flags

| Flag | Behaviour |
|---|---|
| _(neither)_ | Return `409` with conflict summary |
| `skipConflicts: true` | Create records only for non-conflicting dates per employee; employees with zero available dates are silently skipped |
| `replaceConflicts: true` | Delete only the overlapping `UserShift` records (by ID, not by date) before creating all dates — non-overlapping shifts on the same date are untouched |

---

#### Response on Success

```json
{
  "message": "Schedule created successfully",
  "data": {
    "schedules": [ ...createdShiftScheduleObjects ],
    "assignedUsers": 3,
    "totalShifts": 28,
    "dates": 10,
    "skipped": 0
  }
}
```

---

#### Files Changed

| File | Change |
|---|---|
| `src/controllers/Features/shiftScheduleController.js` | `createShiftSchedule` refactored to accept `targetIds[]`; per-employee conflict aggregation; time-aware conflict check; individual-type creates one `ShiftSchedule` per employee inside a single transaction; backward-compat coercion of legacy `targetId` |

---

## Bug Fixes

### 5. Shift Matching: Midnight-Crossing Shifts Now Resolved Correctly

> **Affects:** `computeTimeLogSummary` and `resolveShiftForTimeLog` for employees on shifts that start one calendar day and end the next (e.g. 10 PM–2 AM)
> **Breaking:** No — corrects wrong derived hours for midnight-crossing shift employees

---

#### The Bug

`resolveShiftForTimeLog` (introduced in v2.7.5) computed each shift window using the clock-in date as the sole anchor. For midnight-crossing shifts, an employee clocking in at 00:30 AM should be matched to a shift that started at 10 PM the previous evening. Anchoring only to the clock-in date produced a window of `[10 PM today → 2 AM tomorrow]` instead of the correct `[10 PM yesterday → 2 AM today]` — zero overlap with the punch, causing the shift to be missed and derived hours to be wrong.

---

#### The Fix

`matchShiftToWindow` now tests each shift against **two date anchors**: the clock-in date and the previous calendar day. The best overlap and closest-start distance are computed across both anchors per shift, then the globally best match is selected.

```
For each shift:
  Compute window anchored to clock-in date     → overlap_today,  dist_today
  Compute window anchored to clock-in date − 1 → overlap_yesterday, dist_yesterday
  best_overlap = max(overlap_today, overlap_yesterday)
  closest_dist = min(dist_today, dist_yesterday)

Pick shift with greatest best_overlap.
Fallback (no overlap): pick shift with smallest closest_dist.
```

This is a pure logic change inside `matchShiftToWindow` — no schema changes, no API changes.

---

#### Files Changed

| File | Change |
|---|---|
| `src/services/timeLogComputeService.js` | `matchShiftToWindow` rewrites per-anchor loop; `windows` map replaces manual best-tracking; two-anchor comparison for both overlap and closest-start distance |

---

### 6. Auto-Break ShiftSchedule Fallback for Recurring-Schedule Employees

> **Affects:** Auto-break injection at clock-out for employees assigned via `ShiftSchedule` (recurring) rather than daily `UserShift` records
> **Breaking:** No — previously these employees received no auto-breaks at all; now they receive the correct breaks

---

#### The Bug

`resolveShiftForTimeLog` in `timeLogComputeService.js` only looked up `UserShift` records for shift resolution. Employees on **recurring schedules** (`ShiftSchedule`) have no individual `UserShift` rows until the `generateUpcomingUserShifts` job runs. If that job hasn't run yet, the resolver returned `null`, the auto-break service found no shift config, and no breaks were injected — even though the employee was clearly on a scheduled shift.

---

#### The Fix

When `UserShift` lookup returns zero rows, the resolver now falls back to `ShiftSchedule` — querying for active schedules matching the employee's `userId`, `departmentId`, or `all` assignment type, with a `daysOfWeek` filter against the punch date. The resolved `Shift` object is synthesised into the same shape as a `UserShift` so the rest of the compute pipeline is unchanged.

This mirrors the same ShiftSchedule fallback already present in `computeTimeLogSummary`, ensuring the auto-break service and the compute service always resolve the same shift.

---

#### Files Changed

| File | Change |
|---|---|
| `src/services/timeLogComputeService.js` | `resolveShiftForTimeLog` — ShiftSchedule fallback block added after `UserShift` lookup; `orConditions` built from `userId`, `departmentId`, and `all` |

---

### 7. Grace Period Threshold Extended by 59 Seconds

> **Affects:** `computeTimeLogSummary` — `lateHours`, `undertimeHours`, and `rawOtMinutes` for all employees
> **Breaking:** No — corrects edge-case over-charging within the last 59 seconds of the defined grace window

---

#### The Bug

Grace period was computed as `gracePeriodMinutes * 60 * 1000` ms exactly. An employee clocking in 7 minutes and 30 seconds late with a 7-minute grace would fail the `rawLateMs > graceMs` check and be charged the full 7:30 as `lateHours`. The intent of a "7-minute grace period" is that the entire 7th minute is forgiven — i.e. up to 7:59.

The same threshold applies to `undertimeHours` (leaving early) and the OT start point (`rawOtMinutes`).

---

#### The Fix

```js
// Before
const graceMs = gracePeriodMinutes * 60 * 1000;

// After
const graceMs = (gracePeriodMinutes * 60 + 59) * 1000;
```

The threshold now covers the full grace minute. An employee is only penalised once they are a full minute beyond the defined grace window (e.g. 8:00+ late for a 7-minute grace).

| Scenario (7-min grace) | Before | After |
|---|---|---|
| 6:59 late | 0h charged | 0h charged |
| 7:00 late | 7:00 charged | 0h charged |
| 7:59 late | 7:59 charged | 0h charged |
| 8:00 late | 8:00 charged | 8:00 charged |

---

#### Files Changed

| File | Change |
|---|---|
| `src/services/timeLogComputeService.js` | `graceMs` formula updated |
| `scripts/backfill-grace-period-fix.js` | New targeted backfill — recomputes only logs where `lateHours > 0 OR undertimeHours > 0 OR rawOtMinutes > 0` |
| `scripts/estimate-grace-period-fix.js` | New read-only estimate script |

---

### 8. Driver/Aide `scheduledHours` Double-Count Fixed

> **Affects:** `computeTimeLogSummary` — `scheduledHours` for `DRIVER_AIDE` punch types only
> **Breaking:** No — corrects `scheduledHours` from 16h → 8h for affected records

---

#### The Bug

Two separate issues combined to produce `scheduledHours = 16h` for Driver/Aide employees:

**Root cause — `@db.Date` timezone range overlap:**
`UserShift.assignedDate` is `@db.Date` (plain calendar date, stored as midnight UTC). The `userShifts` query used timezone-adjusted timestamps for `dayStart`/`dayEnd`:

```js
// Before — LA timezone end-of-day = 06:59 UTC next day
const dayStart = moment(timeIn).tz(tz).startOf("day").toDate(); // 07:00Z Apr 23
const dayEnd   = moment(timeIn).tz(tz).endOf("day").toDate();   // 06:59Z Apr 24
```

When Prisma compares these against a `@db.Date` column, the UTC date portion of `dayEnd` (`2026-04-24`) caused April 24's 3 UserShift records to also be included — fetching 6 records across two days instead of 3 for the correct day.

**Defence — missing de-duplication in `scheduledHours` loop:**
The `scheduledHours` calculation summed all records in `effectiveShifts` without de-duplicating by `shiftId`, so any duplicate fetches directly doubled the result.

---

#### The Fix

**Fix 1 — Correct date range for `@db.Date`:**
```js
// After — both boundaries stay on the same UTC calendar date
const localDateStr = moment(timeIn).tz(tz).format("YYYY-MM-DD");
const dayStart     = new Date(`${localDateStr}T00:00:00.000Z`);
const dayEnd       = new Date(`${localDateStr}T23:59:59.999Z`);
```

**Fix 2 — De-duplicate by `shiftId` in `scheduledHours` loop:**
```js
const seenShiftIds = new Set();
for (const us of effectiveShifts) {
  if (us.shift?.id) {
    if (seenShiftIds.has(us.shift.id)) continue;
    seenShiftIds.add(us.shift.id);
  }
  // ... sum duration
}
```

---

#### Files Changed

| File | Change |
|---|---|
| `src/services/timeLogComputeService.js` | `dayStart`/`dayEnd` use UTC calendar-date boundaries; `scheduledHours` loop de-duplicates by `shiftId`; `localDateStr` hoisted and reused in ShiftSchedule fallback |

---

## Schema Changes

### 9. Dead Auto-Lunch / Coffee Fields Removed from Department & Company

> **Breaking:** DB migration required — run `prisma db push` before deploying. No API-level breaking changes.

---

#### What Was Removed

The following fields were added in an earlier auto-break iteration but were superseded by the current `autoBreakBasis` / `autoLunchEnabled` / `autoCoffeeEnabled` architecture. They have been unused by any live API path since that refactor and are now dropped.

**`Department` model — removed:**

| Field | Type | Was Default |
|---|---|---|
| `autoLunchMinutes` | `Int?` | — |
| `autoLunchAfterHours` | `Float?` | — |
| `autoLunchDeductible` | `Boolean` | `false` |
| `autoCoffeeMinutes` | `Int?` | — |
| `autoCoffeeCount` | `Int?` | — |
| `autoCoffeeDeductible` | `Boolean` | `false` |
| `autoLunchDurationMinutes` | `Int?` | `60` |
| `autoLunchAfterHours` (duplicate) | `Float?` | `4.0` |

**`Company` model — removed:**

| Field | Type | Was Default |
|---|---|---|
| `autoLunchDurationMinutes` | `Int?` | — |
| `autoLunchAfterHours` | `Float?` | — |

---

#### Client-Side Impact

None. None of these fields were being returned to clients in any active API response. The active auto-break configuration fields (`autoLunchEnabled`, `autoCoffeeEnabled`, `autoBreakBasis`, `autoLunchEntitled` on User/Department) are unaffected.

---

#### Files Changed

| File | Change |
|---|---|
| `src/prisma/schema.prisma` | Fields removed from `Department` and `Company` models |
| `src/controllers/Account/departmentController.js` | `autoLunchDurationMinutes` and `autoLunchAfterHours` removed from update handler input destructuring and `updateData` path |

---

### 10. TimeLogApproval — `segmentStart` / `segmentEnd` for Driver/Aide Cutoff Review

> **Affects:** `GET /api/cutoff-periods/:id/approvals` — Driver/Aide approval rows
> **Breaking:** Schema migration required — `migrate-timelog-approval-segment-bounds.sql`

---

#### What Changed

The Cutoff Review page groups Driver/Aide punches into three segment sub-rows (Driver AM, Regular, Driver PM). Previously all three sub-rows displayed the raw punch span (`timeLog.timeIn` / `timeLog.timeOut`) because no per-segment time window was stored.

`TimeLogApproval` now has two new nullable fields:

| Field | Type | Description |
|---|---|---|
| `segmentStart` | `DateTime? @db.Timestamptz(6)` | Scheduled start of this segment window |
| `segmentEnd` | `DateTime? @db.Timestamptz(6)` | Scheduled end of this segment window |

These are populated at approval-record creation time (sync) and returned as ISO 8601 UTC timestamps — same format as `timeLog.timeIn` / `timeLog.timeOut`. Regular (non-DA) approval rows always have both as `null`.

---

#### Contract

```
approval.segmentStart  — non-null when segmentType is "driver_am" | "regular" | "driver_pm"
approval.segmentEnd    — non-null when segmentType is "driver_am" | "regular" | "driver_pm"
approval.segmentStart  — null when segmentType is null (regular punch)
```

---

#### Client-Side Change (for reference)

Only change needed in `buildDetails()`:

```js
if (approval.segmentType !== null) {
  inTime  = formatDateTime(approval.segmentStart, tz)
  outTime = formatDateTime(approval.segmentEnd,   tz)
} else {
  inTime  = formatDateTime(tl.timeIn,  tz)
  outTime = formatDateTime(tl.timeOut, tz)
}
```

---

#### Files Changed

| File | Change |
|---|---|
| `src/prisma/schema.prisma` | `segmentStart`, `segmentEnd` added to `TimeLogApproval` |
| `src/services/timeLogComputeService.js` | `resolveDriverAideSegments(driverLogs, companyId)` — new batched export; added to `module.exports` |
| `src/controllers/Features/cutoffPeriodController.js` | `syncApprovalRecords` — fetches `timeIn`/`userId`, calls `resolveDriverAideSegments`, writes boundaries on create |
| `scripts/migrate-timelog-approval-segment-bounds.sql` | Migration — `ALTER TABLE "TimeLogApproval" ADD COLUMN IF NOT EXISTS "segmentStart" TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS "segmentEnd" TIMESTAMPTZ` |
| `scripts/backfill-approval-segment-bounds.js` | Backfill for existing approval rows |
| `scripts/estimate-approval-segment-bounds.js` | Read-only estimate script |

---

## Internal

### 11. Backfill Script — Elapsed Timer & Orphan-User Guard

> **Affects:** `scripts/backfill-timelog-compute.js` (dev/ops tooling only)
> **Breaking:** No

Two improvements to the admin backfill script used to recompute derived TimeLog fields across historical records:

- **Elapsed timer:** Each progress log line and the final summary now include total wall-clock time (e.g. `[2m 14s] Progress: 1500/3200 (47%) — ✓ 1480 ✗ 12 ~ 8`). Useful for estimating completion on large datasets.
- **Orphan-user guard:** The `where` clause now always includes `user: { companyId: { not: null } }` when no specific `companyId` filter is passed. Previously, orphaned `TimeLog` rows (users without a `companyId`) would enter the compute loop and spin forever since `computeTimeLogSummary` early-exits with `null` for those records.

---

#### Files Changed

| File | Change |
|---|---|
| `scripts/backfill-timelog-compute.js` | `startedAt` / `elapsed()` added; `where.user` always set; progress and completion logs include elapsed time |
