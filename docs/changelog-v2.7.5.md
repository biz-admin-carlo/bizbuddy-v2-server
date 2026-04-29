# BizBuddy Server — v2.7.5 Change Log

> **Release Date:** 2026-04-27
> **Prepared for:** Web Client & iOS/Mobile Teams
> **Server Version:** v2.7.5 (from v2.7.4)
> **Breaking changes:** DB migration required for `TimeLogApproval` schema change (section 6) — no API-level breaking changes for web/mobile clients

---

## Table of Contents

**Bug Fixes**
1. [Auto-Break Wrong Shift Resolved for Multi-Shift Employees (Shift Basis)](#1-auto-break-wrong-shift-resolved-for-multi-shift-employees-shift-basis)
2. [Grace Period Applied as Threshold, Not Deduction (lateHours / undertimeHours)](#2-grace-period-applied-as-threshold-not-deduction-latehours--undertimehours)
3. [B&C Multi-Shift: Computed Fields Scoped to Matched Shift](#3-bc-multi-shift-computed-fields-scoped-to-matched-shift)

**New Fields**
4. [New: `scheduledHours` — Sum of Assigned Shift Durations](#4-new-scheduledhours--sum-of-assigned-shift-durations)
5. [New: `grossHours` — Raw Clock Duration](#5-new-grosshours--raw-clock-duration)

**Schema Changes**
6. [TimeLogApproval: Per-Segment Records for DRIVER_AIDE](#6-timelogapproval-per-segment-records-for-driver_aide)

**Internal Refactors**
7. [cutoffPeriodController — enrichApprovals Reads Stored Computed Fields](#7-cutoffperiodcontroller--enrichapprovals-reads-stored-computed-fields)

---

## Bug Fixes

### 1. Auto-Break Wrong Shift Resolved for Multi-Shift Employees (Shift Basis)

> **Affects:** Clock-out (auto-break injection) for companies with `autoBreakBasis = "shift"` and employees assigned multiple shifts per day
> **Breaking:** No

---

#### The Bug

When `autoBreakBasis = "shift"`, `autoBreakService.js` called `Shift.findFirst` using a **UTC midnight boundary** to determine which shift the current punch belonged to. For multi-shift employees (e.g. Regular + Driver PM on the same day), this always resolved to whichever shift happened to come back first in the query — ignoring actual punch time. The wrong shift's break policy was applied at clock-out.

Root cause: the service had no concept of which shift window overlapped the employee's actual `[timeIn, timeOut]` range, and the midnight boundary was computed in UTC rather than company timezone.

---

#### The Fix

Replaced `findFirst` with a shared `resolveShiftForTimeLog(userId, timeIn, timeOut, companyTz)` utility now exported from `timeLogComputeService.js`.

**Resolution logic (Option B — max overlap):**

1. Fetch all UserShift records for the employee on the day (day boundaries derived in company timezone via `moment-timezone`)
2. Compute overlap duration between each shift window and the punch `[timeIn, timeOut]` window
3. Select the shift with the maximum overlap
4. Fallback: if no overlap is found (e.g. employee clocked in very early), pick the shift whose `startTime` is closest to `timeIn`

This same `resolveShiftForTimeLog` utility is also used by `computeTimeLogSummary` (Fix 4 covers both call sites).

---

#### Client-Side Changes Required

None. Auto-break injection is fully server-side. The corrected break data is returned in the clock-out response as before.

---

#### Files Changed

| File | Change |
|---|---|
| `src/services/autoBreakService.js` | `resolveBreakConfig` now calls `resolveShiftForTimeLog` instead of `findFirst`; `timeZone` added to company select; declaration order fixed |
| `src/services/timeLogComputeService.js` | New exported function `resolveShiftForTimeLog(userId, timeIn, timeOut, companyTz)` — Option B max-overlap shift matching with closest-start fallback |

---

### 2. Grace Period Applied as Threshold, Not Deduction (lateHours / undertimeHours)

> **Affects:** `lateHours` and `undertimeHours` on all TimeLog records; dayCare company employees most visibly affected
> **Breaking:** No — corrects previously wrong values; clients reading these fields will see accurate data

---

#### The Bug

`computeTimeLogSummary` was computing `lateHours` and `undertimeHours` by **subtracting** the grace period from the raw lateness/undertime before storing. This produced incorrect small values when the employee arrived just outside the grace window.

**Example (gracePeriodMinutes = 10):**

| Clock-in | Shift start | Raw late | Old behavior | Correct behavior |
|---|---|---|---|---|
| 08:11 | 08:00 | 11 min | `11 − 10 = 1 min late` | `11 min late` (exceeded grace → full raw lateness) |
| 08:09 | 08:00 | 9 min | `9 − 10 = 0` (clamped) | `0 min late` (within grace → not late) |

Grace period is a **threshold**: if the employee is within grace, they are not late at all. If they exceed grace, the full raw lateness is recorded — the grace minutes are not a deduction.

---

#### The Fix

Steps 8 and 9 in `computeTimeLogSummary`:

```js
// Before
lateHours = +((rawLateMs - graceMs) / 3600000).toFixed(2)  // ❌ deducts grace

// After
lateHours = rawLateMs > graceMs ? +(rawLateMs / 3600000).toFixed(2) : 0  // ✅ threshold
```

Same change applied to `undertimeHours`.

**Backfill:** Run against the dayCare company to correct existing records.

```bash
node scripts/backfill-timelog-compute.js --force --companyId=<companyId>
```

---

#### Client-Side Changes Required

None. `lateHours` and `undertimeHours` are server-computed fields — clients read them as-is. Display logic does not change.

---

#### Files Changed

| File | Change |
|---|---|
| `src/services/timeLogComputeService.js` | Steps 8 & 9: `rawLateMs > graceMs ? fullRaw : 0` (threshold) replaces `rawLateMs − graceMs` (deduction) |

---

### 3. B&C Multi-Shift: Computed Fields Scoped to Matched Shift

> **Affects:** `lateHours`, `undertimeHours`, `scheduledHours`, `rawOtMinutes` for multi-shift REGULAR employees (e.g. B&C employees with 2–3 shifts per day)
> **Breaking:** No — corrects previously wrong values; backfill required

---

#### The Bug

For employees with multiple shifts per day, each shift is clocked independently — one TimeLog per punch, not one per day. `computeTimeLogSummary` Step 5 resolved `shiftStart` as the earliest `startTime` and `shiftEnd` as the latest `endTime` **across all UserShifts on the day**. This aggregation is correct for dayCare employees (one punch spans the full day), but wrong for B&C employees where each punch belongs to a single specific shift.

**Example (Shift 1: 05:00–08:00 / Shift 2: 16:00–22:00):**

| Field | Before | After |
|---|---|---|
| Employee clocks in at 16:05 for Shift 2 | `shiftStart = 05:00` → `lateHours = 11.08h` ← wrong | `shiftStart = 16:00` → `lateHours = 0.08h` ✓ |
| Employee clocks out at 21:50 for Shift 2 | `shiftEnd = 22:00` → `undertimeHours = 0.17h` but against wrong anchor | scoped to Shift 2 only ✓ |
| `scheduledHours` | sum of all shifts on the day | duration of the matched shift only ✓ |

**Also affected:** employees assigned via a recurring `ShiftSchedule` (not a direct `UserShift` record) — previously no shift was resolved and late/undertime/scheduledHours were all skipped entirely.

---

#### The Fix

New sync helper `matchShiftToWindow(userShifts, timeIn, timeOut, tz)` — pure function, no DB call — selects the shift with the greatest overlap with the `[timeIn, timeOut]` punch window. Fallback: shift with the closest `startTime` to `timeIn` when no overlap exists.

Step 5 in `computeTimeLogSummary`:

```js
// B&C multi-shift: narrow to the shift this punch belongs to
const matchedUserShift = (!isDriverLog && userShifts.length > 1)
  ? matchShiftToWindow(userShifts, timeIn, timeOut, tz)
  : null;
const effectiveShifts = matchedUserShift ? [matchedUserShift] : userShifts;
```

`shiftStart`, `shiftEnd`, `scheduledHours`, and `rawOtMinutes` are all derived from `effectiveShifts`. The dayCare (Driver/Aide) path is unchanged — it still aggregates all shifts.

**ShiftSchedule fallback (Step 3b):** When no `UserShift` exists for the punch day (employee assigned via recurring schedule), a `ShiftSchedule` lookup now runs. A matching schedule is synthesised into a `UserShift`-shaped object so all downstream steps (late, undertime, scheduledHours) compute correctly.

---

#### Client-Side Changes Required

None. All affected fields are server-computed. Corrected values will be seen after backfill.

```bash
node scripts/backfill-timelog-compute.js --force --companyId=<companyId>
```

---

#### Files Changed

| File | Change |
|---|---|
| `src/services/timeLogComputeService.js` | New `matchShiftToWindow` sync helper; Step 3b `ShiftSchedule` fallback when `userShifts.length === 0`; Step 5 narrows `effectiveShifts` to matched shift for non-Driver multi-shift employees; `resolveShiftForTimeLog` refactored to call `matchShiftToWindow` internally |

---

## New Fields

### 4. New: `scheduledHours` — Sum of Assigned Shift Durations

> **Affects:** `GET /api/timelogs`, `GET /api/timelogs/company`
> **Breaking:** No — additive field

---

#### Background

The client previously computed "Period Hours" client-side as `netWorkedHours − unapproved OT minutes`. This is the **payable hours** figure — not the scheduled hours. These are two different concepts.

`scheduledHours` moves scheduled-hour computation to the server as a Single Source of Truth for both web and mobile clients.

---

#### What It Is

`scheduledHours` = sum of all assigned shift segment durations for the employee on the day of the punch.

**Examples:**

| Employee type | Shifts assigned | `scheduledHours` |
|---|---|---|
| Driver/Aide | Pre-trip (1.25h) + Regular (5.5h) + Post-trip (1.25h) | `8.00` |
| Regular | Regular Shift 08:00–13:30 (5.5h) | `5.50` |
| No schedule | — | `null` |

`null` is returned (not `0`) when the employee has no assigned shift for that day — there is no basis for computing scheduled hours.

---

#### How It Is Computed

In `computeTimeLogSummary`, after the shift lookup:

1. Fetch all UserShift records for the employee on the punch day (company-timezone day boundaries)
2. For each shift, compute segment duration using `combineDateWithTimeTz` to handle overnight shifts correctly
3. Sum all segment durations and store as `scheduledHours`

---

#### Action Required: Period Hours Display

**The client's current "Period Hours" formula should be replaced with `scheduledHours`.**

Current client formula:
```js
const periodHours = toHour(Math.max(0, netWorkedHours * 60 - unapprovedOtMins));
```

Correct formula going forward:
```js
const periodHours = log.scheduledHours != null
  ? parseFloat(log.scheduledHours)
  : 0;
```

`scheduledHours` is now returned from both `GET /api/timelogs` and `GET /api/timelogs/company`. No new endpoint needed.

> **Note on data type:** `scheduledHours` is `Decimal(6,2)`. Individual shift segments can have sub-hour values (e.g. `1.25h`, `5.5h`). The sum may be a whole number depending on shift configuration, but the field will carry `.00` or `.50` precision as needed.

---

#### Migration

```bash
psql $DATABASE_URL -f scripts/migrate-scheduled-hours.sql
npx prisma generate
node scripts/backfill-timelog-compute.js --force --companyId=<companyId>
```

---

#### Files Changed

| File | Change |
|---|---|
| `src/prisma/schema.prisma` | `TimeLog.scheduledHours Decimal? @db.Decimal(6,2)` added |
| `scripts/migrate-scheduled-hours.sql` | `ALTER TABLE "TimeLog" ADD COLUMN IF NOT EXISTS "scheduledHours" DECIMAL(6,2)` *(new)* |
| `src/services/timeLogComputeService.js` | Step 7: `scheduledHours` computed and written; `resolveShiftForTimeLog` reused for day-boundary shift lookup |
| `src/controllers/Features/timeLogController.js` | `getUserTimeLogs`: `scheduledHours` added to response; `getCompanyTimeLogs`: `scheduledHours: true` added to Prisma select + response |

---

### 5. New: `grossHours` — Raw Clock Duration

> **Affects:** `GET /api/timelogs`, `GET /api/timelogs/company`
> **Breaking:** No — additive field

---

#### Background

Previously no server field represented the raw elapsed time between clock-in and clock-out. Clients had to recompute this themselves, producing a second source of truth that could diverge from server-side values.

---

#### What It Is

`grossHours` = `(timeOut − timeIn)` in decimal hours, rounded to 2 decimal places.

```
timeIn:  08:02
timeOut: 17:05
grossHours = 9.05
```

This is the raw clock span **before any break deductions**. It is the counterpart to `netWorkedHours` (which is after deductions).

| Field | Meaning |
|---|---|
| `grossHours` | Raw timeOut − timeIn (no deductions) |
| `netWorkedHours` | grossHours minus break deductions |

`null` while the log is active (no `timeOut` yet).

---

#### Client-Side Usage

`grossHours` is the correct fallback when `netWorkedHours` is unavailable (active log):

```js
// Duration display priority chain
const duration =
  log.netWorkedHours   // completed log — net after breaks
  ?? log.grossHours    // completed log without compute (rare)
  ?? rawClientDiff;    // active log — real-time diff
```

---

#### Migration

```bash
psql $DATABASE_URL -f scripts/migrate-gross-hours.sql
npx prisma generate
node scripts/backfill-timelog-compute.js --force --companyId=<companyId>
```

---

#### Files Changed

| File | Change |
|---|---|
| `src/prisma/schema.prisma` | `TimeLog.grossHours Decimal? @db.Decimal(6,2)` added |
| `scripts/migrate-gross-hours.sql` | `ALTER TABLE "TimeLog" ADD COLUMN IF NOT EXISTS "grossHours" DECIMAL(6,2)` *(new)* |
| `src/services/timeLogComputeService.js` | Step 6: `grossHours = +((timeOut - timeIn) / 3600000).toFixed(2)` computed and written |
| `src/controllers/Features/timeLogController.js` | `getUserTimeLogs`: `grossHours` added to response; `getCompanyTimeLogs`: `grossHours: true` added to Prisma select + response |

---

## Schema Changes

### 6. TimeLogApproval: Per-Segment Records for DRIVER_AIDE

> **Affects:** Cutoff period approval records for DRIVER_AIDE punch types
> **Breaking:** DB migration required before deploy (`scripts/migrate-cutoff-segment-type.sql`)

---

#### Background

Previously, each TimeLog had exactly one `TimeLogApproval` record (enforced by `@unique` on `timeLogId`). DRIVER_AIDE TimeLogs carry three logical segments — Driver AM, Regular, Driver PM — each with independent hours and approval state. A single record couldn't represent all three independently.

---

#### The Change

`TimeLogApproval.timeLogId` is **no longer `@unique`**. DRIVER_AIDE TimeLogs now receive **three approval records** — one per segment — identified by the new `segmentType` field:

| `segmentType` | Segment | Source field |
|---|---|---|
| `null` | REGULAR punch | `netWorkedHours` |
| `"driver_am"` | Driver AM segment | `driverAmSegmentHours` |
| `"regular"` | Regular (mid) segment | `regularSegmentHours` |
| `"driver_pm"` | Driver PM segment | `driverPmSegmentHours` |

Uniqueness is now enforced by two **partial DB indexes scoped per cutoff period**:

- `(cutoffPeriodId, timeLogId) WHERE segmentType IS NULL` — one REGULAR record per timeLog per cutoff
- `(cutoffPeriodId, timeLogId, segmentType) WHERE segmentType IS NOT NULL` — one record per segment per timeLog per cutoff

Scoping to `cutoffPeriodId` (rather than globally) allows the same TimeLog to be reviewed in different non-overlapping cutoff periods without constraint violations.

The `status` enum gains `"excluded"` (used when a punch is excluded from a cutoff via conflict resolution — previously only "pending" / "approved" / "rejected" existed).

---

#### Migration

```bash
psql $DATABASE_URL -f scripts/migrate-cutoff-segment-type.sql
npx prisma generate
```

---

#### Files Changed

| File | Change |
|---|---|
| `src/prisma/schema.prisma` | `TimeLogApproval.timeLogId` no longer `@unique`; `segmentType String?` added; `TimeLog.approval TimeLogApproval?` → `approvals TimeLogApproval[]`; `@@index([timeLogId])` added |
| `scripts/migrate-cutoff-segment-type.sql` | Drops old `TimeLogApproval_timeLogId_key` unique constraint; adds `segmentType` column; drops stale global indexes; creates two partial indexes scoped per `cutoffPeriodId` |

---

## Internal Refactors

### 7. cutoffPeriodController — enrichApprovals Reads Stored Computed Fields

> **Affects:** Internal compute path for cutoff approval list endpoints
> **Breaking:** No — API response shape unchanged; clients see the same fields

---

#### What Changed

The old `enrichApprovals` independently re-fetched shifts from the DB and recomputed shift boundaries, break deductions, and payable hours for every approval on every call — duplicating `timeLogComputeService` logic. This caused divergence: the approval list could return different values than the stored TimeLog fields, depending on shift configuration at query time.

The new implementation reads stored computed fields directly from the TimeLog record:

| Old | New |
|---|---|
| DB fetch per approval to resolve shift | Reads `tl.lateHours`, `tl.undertimeHours` directly |
| Called `calculateBreakTimes`, `checkCoffeeBreakPolicy` | Reads `tl.lunchDeductionMinutes`, `tl.totalBreakMinutes` |
| Recomputed payable hours via clock-snap | Reads `tl.netWorkedHours` (REGULAR) or segment hours (DRIVER_AIDE) |
| Async — N DB calls for N approvals | Sync — zero DB calls |

For DRIVER_AIDE approvals, `enrichApprovals` dispatches on `segmentType` to return the correct segment hours, late/undertime attribution (AM segment bears `lateHours`, PM segment bears `undertimeHours` and `rawOtMinutes`), and `scheduledHours`.

`bulkUpdateApprovals` retains the snap-then-recompute path for REGULAR punches and adds a DRIVER_AIDE branch that trusts stored segment hours (populated by `computeTimeLogSummary`).

`resolveConflict` now fetches `timeZone` up front (single query) rather than mid-flow after the branch split.

---

#### Files Changed

| File | Change |
|---|---|
| `src/controllers/Features/cutoffPeriodController.js` | `enrichApprovals` rewritten as sync, reads stored fields; DRIVER_AIDE segment dispatch by `segmentType`; break helpers (`calculateBreakTimes`, `checkCoffeeBreakPolicy`, `getTotalBreakDeductions`) removed; `bulkUpdateApprovals` adds DRIVER_AIDE branch with stored-hours path; `resolveConflict` fetches `timeZone` up front |

---

*Generated by BizBuddy Backend Team — v2.7.5 — 2026-04-29*
