# BizBuddy Server — v2.7.3 Change Log

> **Release Date:** 2026-04-12
> **Prepared for:** Web Client & iOS/Mobile Teams
> **Server Version:** v2.7.3 (from v2.7.2)
> **Breaking changes:** See entries 4 and 11 below.

---

## Table of Contents

**Bug Fixes**
1. [Auto Clock-Out Safeguard — Shift End Time Timezone Mismatch](#1-auto-clock-out-safeguard--shift-end-time-timezone-mismatch)
2. [`calculateLateHoursForUser` — Timezone Mismatch](#2-calculatelatehoursforuser--timezone-mismatch)
13. [Auto Clock-Out — Missing `NotificationCode` Enum Values](#13-auto-clock-out--missing-notificationcode-enum-values)
14. [Auto Clock-Out Supervisor Email — Scheduled End Always Matched Auto Clock-Out Time](#14-auto-clock-out-supervisor-email--scheduled-end-always-matched-auto-clock-out-time)
15. [Auto Clock-Out — Missing Real-Time Socket Event to Employee](#15-auto-clock-out--missing-real-time-socket-event-to-employee)
16. [`GET /api/timelogs/user` — Date Filter Excludes Records for UTC+ Companies](#16-get-apitimelogsuser--date-filter-excludes-records-for-utc-companies)
17. [`GET /api/timelogs` — Employer Punch Logs Five-Part Fix](#17-get-apitimelogs--employer-punch-logs-five-part-fix)
18. [Leave Module — Management View-Only Access & `canAct` Flag](#18-leave-module--management-view-only-access--canact-flag)
19. [`checkMissedClockIns` — Leave-Aware (Skip Employees on Approved Leave)](#19-checkmissedclockins--leave-aware-skip-employees-on-approved-leave)
20. [`leaveStatus` Enum — Wired to `Leave.status`](#20-leavestatus-enum--wired-to-leavestatus)
26. [Company Settings — `multiApprovalEnabled` & `secondaryApproverId` Not Saved](#26-company-settings--multiapprovalenabled--secondaryapproverid-not-saved)

**New Features**
3. [One-Time Active Clock-In Cleanup](#3-one-time-active-clock-in-cleanup)
21. [`rawOtMinutes` — Now Computed for REGULAR Punch Types](#21-rawotminutes--now-computed-for-regular-punch-types)
22. [`calcRequestedHours` — Weekend, Holiday & Shift-Aware Leave Deduction](#22-calcrequesthours--weekend-holiday--shift-aware-leave-deduction)
23. [Leave — Two-Step Approval Redesign (Per-Request Escalation)](#23-leave--two-step-approval-redesign-per-request-escalation)
24. [Leave — Real-Time Balance Update Socket Event](#24-leave--real-time-balance-update-socket-event)
25. [`GET /api/timelogs` — `employeeRole` & `employeeCode` Fields](#25-get-apitimelogs--employeerole--employeecode-fields)
4. [`GET /api/timelogs/user` — Server-Side Filtering, Pagination & Summary](#4-get-apitimelogsuser--server-side-filtering-pagination--summary)
5. [`shiftAssignmentWindowMinutes` — New Company Setting](#5-shiftassignmentwindowminutes--new-company-setting)
6. [`isDriver` — New Employee Field](#6-isdriver--new-employee-field)
7. [`localTimestamp` — Clock-In/Out Honors Client Timestamp](#7-localtimestamp--clock-inout-honors-client-timestamp)
8. [TimeLog Computation Layer — Server-Side Derived Fields](#8-timelog-computation-layer--server-side-derived-fields)
9. [Driver/Aide Segment Hours & OT Boundary — Server-Computed](#9-driveraide-segment-hours--ot-boundary--server-computed)
10. [Punch Log Display Fixes — Client Integration Guide](#10-punch-log-display-fixes--client-integration-guide)
11. [Auto Clock-Out Module Redesign](#11-auto-clock-out-module-redesign)
12. [Email Template Redesign](#12-email-template-redesign)

**Known Issues & Deferred**
- [Grace Period — Server-Side Enforcement Not Yet Applied](#grace-period--server-side-enforcement-not-yet-applied)
- [Employee Cutoff Module — Needs Revisit](#employee-cutoff-module--needs-revisit)
- [OT Request Withdrawal — No Employee-Facing Endpoint](#ot-request-withdrawal--no-employee-facing-endpoint)
- [`paidBreak` — Not Applied in Client Lunch Deduction](#paidbreak--not-applied-in-client-lunch-deduction)

---

## Bug Fixes

### 1. Auto Clock-Out Safeguard — Shift End Time Timezone Mismatch

> **Affects:** Server only (background cron)
> **Breaking:** No

**The bug:** Shift `endTime` is stored in the database as a PostgreSQL `TIME` value (no timezone). Prisma returns these as a `Date` object anchored to the UTC epoch (`1970-01-01THH:mm:ssZ`). The safeguard was calling `getUTCHours()` / `getUTCMinutes()` to extract the time components — correct for reading the stored value — but then passed those hours directly to `setHours()` on the resolved `timeOut` date, treating the stored clock time as UTC. For companies where shift times are entered in local time (e.g. PDT, UTC−7), this produced a `timeOut` 7 hours later than the intended shift end.

**Example (Fremont, CA / PDT):**
- Shift ends at `14:45` (stored in DB as PDT clock time)
- Bug: `setHours(14, 45)` on UTC server → `14:45 UTC` = **9:45 PM PDT** (~7h too late)
- Fix: `combineDateWithTimeTz("14:45", "America/Los_Angeles")` → `14:45 PDT` = **2:45 PM PDT** ✅

**The fix:** Adopted the `combineDateWithTimeTz` pattern already used in `clockInReminderWorker.js`. The stored clock-time string is combined with the calendar date of the clock-in and parsed in the correct IANA timezone:

```
shift.timeZone → company.timeZone → "America/Los_Angeles"
```

| | Before | After |
|---|---|---|
| Timezone used | Server local (UTC) | `shift.timeZone` → `company.timeZone` → `America/Los_Angeles` |
| `timeOut` for 14:45 PDT shift | 9:45 PM PDT (7h late) | 2:45 PM PDT ✅ |

> **Note:** The original safeguard job (`autoClockOutSafeguard.js`) has since been fully replaced by the new Auto Clock-Out Module (see entry 11). This fix was the trigger for that redesign.

---

### 2. `calculateLateHoursForUser` — Timezone Mismatch

> **Affects:** Clock-in late hours computation
> **Breaking:** No
> **Status:** Fixed as part of the TimeLog Computation Layer (entry 8)

**The bug:** The inline `calculateLateHoursForUser` in `timeLogController.js` had the same UTC/local inconsistency. Shift `startTime` stored as PDT was treated as UTC, producing incorrect `lateHours` for PDT employees. A secondary issue: `findFirst` on UserShift had no ordering, picking an arbitrary shift when multiple existed for the same day.

**The fix:** `calculateLateHoursForUser` is no longer called at clock-out. It is replaced by `computeTimeLogSummary` (entry 8), which resolves all shift times in the correct company timezone and filters UserShift by `punchType` to avoid wrong-shift selection.

Raw `timeIn` data is unaffected — actual punch timestamps are always stored correctly. Historical records can be recomputed with `scripts/backfill-timelog-compute.js`.

---

## New Features

### 3. One-Time Active Clock-In Cleanup

> **Affects:** Server data only
> **Breaking:** No

A one-time SQL script was run to force-close 11 time log records stuck in an active state (`status = true` with no `timeOut`). All affected records were set to `timeOut = NOW()`, flagged with `autoClockOut = true`, and are available for admin review.

**Script:** `scripts/cleanup-active-clockins.sql`

---

### 4. `GET /api/timelogs/user` — Server-Side Filtering, Pagination & Summary

> **Affects:** Web client, Mobile client
> **Breaking:** Yes — response shape has changed

Previously this endpoint returned a flat array of all logs with no filtering or pagination. It now supports server-side filtering and pagination, and returns a structured response with a summary block for stats cards.

#### Query Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `from` | ISO date string | — | Filter logs where `timeIn >= from` |
| `to` | ISO date string | — | Filter logs where `timeIn <= to` |
| `status` | `"active"` \| `"completed"` | all | Filter by clock-in status |
| `punchType` | `"REGULAR"` \| `"DRIVER_AIDE_AM"` \| `"DRIVER_AIDE_PM"` \| `"DRIVER_AIDE"` | all | Filter by punch type |
| `page` | integer | `1` | Page number (1-based) |
| `limit` | integer | `10` | Records per page (max `10000` for export) |

#### Response Shape

```json
{
  "message": "Time logs retrieved.",
  "data": [],
  "pagination": {
    "total": 500,
    "page": 1,
    "limit": 10,
    "totalPages": 50
  },
  "summary": {
    "total": 500,
    "active": 3,
    "completed": 497,
    "totalHours": 4000.5
  }
}
```

**Notes:**
- `summary` always reflects the full filtered dataset (date range + punchType), not just the current page. It is not affected by the `status` filter.
- `summary.totalHours` counts only completed logs with a recorded `timeOut`.

#### Client-Side Changes Required

**1. Pass query params on every fetch**
```
GET /api/timelogs/user?from=2026-04-01T00:00:00.000Z&to=2026-04-30T23:59:59.999Z&page=1&limit=10
```

**2. Default date range on load** — first day of current month → today (end of day).

**3. Read the new response keys**
```ts
const { data, pagination, summary } = response;
```

**4. Stats cards — read from `summary`, not derived from `data[]`**
```ts
setTotalLogs(summary.total);
setActive(summary.active);
setCompleted(summary.completed);
setTotalHours(summary.totalHours);
```

**5. Filter triggers**

| Filter | Trigger |
|---|---|
| Date `from` / `to` | Apply button only |
| `status` dropdown | Auto-fetch on change, reset page to 1 |
| `punchType` dropdown | Auto-fetch on change, reset page to 1 |
| Page change | Auto-fetch |

**6. Client-side filtering — remove all filter logic, sort only**
```ts
const sorted = [...data].sort(/* your sort logic */);
```

**7. Export — fresh fetch with `limit=10000`**
```ts
const { data } = await fetchLogs({ ...currentFilters, limit: 10000, page: 1 });
```

**File changed:** `src/controllers/Features/timeLogController.js`

---

### 5. `shiftAssignmentWindowMinutes` — New Company Setting

> **Affects:** Web client, Mobile client
> **Breaking:** No

A new configurable field to support client-side auto-assignment of punch type without prompting the employee. When a punch time falls within the window around a shift boundary, the punch type is auto-determined and the confirmation modal is skipped. All window logic runs on the client — the server stores and exposes the value only.

**Default:** `30` minutes.

**`GET /api/company-settings`** — new field in response:
```json
{ "shiftAssignmentWindowMinutes": 30 }
```

**`PATCH /api/company-settings`** — accepts the new field:
```json
{ "shiftAssignmentWindowMinutes": 15 }
```

**DB migration:** `scripts/migrate-shift-assignment-window.sql`
**Files changed:** `src/controllers/Account/companySettingsController.js`, `src/prisma/schema.prisma`

---

### 6. `isDriver` — New Employee Field

> **Affects:** Web client, Mobile client
> **Breaking:** No

A new boolean field `isDriver` has been added to `EmploymentDetail` to flag driver employees. Defaults to `false`.

**`GET /api/employees`** — `isDriver` is now included in each employee's `employmentDetail` object.

**`GET /api/employment-details/me`** — `isDriver` is returned automatically as part of the full `EmploymentDetail` record.

**`PUT /api/employee/:id`** — accepts `isDriver` in the request body:
```json
{ "isDriver": true }
```

**DB migration:** `scripts/migrate-is-driver.sql`
**Files changed:** `src/controllers/Features/employeeController.js`, `src/prisma/schema.prisma`

---

### 7. `localTimestamp` — Clock-In/Out Honors Client Timestamp

> **Affects:** Mobile client (snap-to-schedule)
> **Breaking:** No

Confirmed: both `POST /api/timelogs/time-in` and `POST /api/timelogs/time-out` honor a `localTimestamp` field in the request body. When present, it is used as the recorded punch time instead of `Date.now()`.

```js
const actualTimeIn  = localTimestamp ? new Date(localTimestamp) : new Date();
const actualTimeOut = localTimestamp ? new Date(localTimestamp) : new Date();
```

This is the server-side prerequisite for the client's snap-to-schedule feature. No server-side changes were required.

---

### 8. TimeLog Computation Layer — Server-Side Derived Fields

> **Affects:** Server only (all clients benefit from pre-computed values)
> **Breaking:** No — new fields added to `TimeLog`; existing fields unchanged

A dedicated computation service (`timeLogComputeService.js`) was introduced as the single source of truth for all derived timekeeping fields. Previously, `lateHours` was computed inline at clock-out with a timezone bug. All other derived values were computed client-side inconsistently between web and mobile.

#### Computed Fields

| Field | Type | Description |
|---|---|---|
| `lateHours` | `Decimal(5,2)` | Minutes late past shift start (grace-adjusted). `null` if no shift. |
| `undertimeHours` | `Decimal(5,2)` | Hours clocked out before shift end (grace-adjusted). |
| `netWorkedHours` | `Decimal(6,2)` | REGULAR: gross − breaks. DA: sum of segment hours. |
| `lunchDeductionMinutes` | `Int` | Lunch deduction applied (auto-lunch or minimum, whichever is greater). |
| `totalBreakMinutes` | `Int` | Sum of all coffee break durations (lunch tracked separately). |
| `calculatedAt` | `DateTime` | Timestamp of last compute run — used as idempotency marker. |

#### Compute Triggers

| Phase | Trigger | Location |
|---|---|---|
| Phase 1 | Clock-out (`POST /api/timelogs/time-out`) | `timeLogController.js` |
| Phase 4a | Single cutoff approval | `cutoffPeriodController.js` |
| Phase 4b | Bulk cutoff approval | `cutoffPeriodController.js` |
| Phase 4c | Conflict resolution | `cutoffPeriodController.js` |
| Phase 4d | Contest approval | `contestPolicyController.js` |
| Phase 5 | Historical backfill | `scripts/backfill-timelog-compute.js` |

**Non-fatal pattern:** Compute always runs in a `try/catch` after the primary DB write. Failure is logged but never blocks the response.

#### Timezone Handling

All shift times are stored as PostgreSQL `TIME` (no timezone). Prisma returns them as UTC epoch dates. The service extracts hours/minutes with `getUTCHours()` / `getUTCMinutes()`, then interprets them in the company's IANA timezone:

```
shift.timeZone → company.timeZone → "America/Los_Angeles"
```

#### Fallback — No Shift Assigned

| Field | Fallback value |
|---|---|
| `lateHours` | `null` |
| `undertimeHours` | `null` |
| `netWorkedHours` | `timeOut − timeIn` minus breaks |
| Shift end reference | `timeIn + company.defaultShiftHours` |

#### Backfill Script

```bash
node scripts/backfill-timelog-compute.js                           # incremental
node scripts/backfill-timelog-compute.js --force                   # recompute all
node scripts/backfill-timelog-compute.js --companyId=<id>          # scope to one company
node scripts/backfill-timelog-compute.js --from=2026-04-01         # scope by date
node scripts/backfill-timelog-compute.js --companyId=<id> --from=2026-04-01 --force
```

Safe to re-run. Incremental mode uses `calculatedAt: null` as the skip condition. Per-record errors are logged and skipped. 14 orphaned records (users with `companyId: null`) are expected to fail and can be ignored.

**DB migration:** `scripts/migrate-timelog-computed-fields.sql`
**Files changed:**
- `src/services/timeLogComputeService.js` *(new)*
- `src/controllers/Features/timeLogController.js`
- `src/controllers/Features/cutoffPeriodController.js`
- `src/controllers/Features/contestPolicyController.js`
- `src/prisma/schema.prisma`
- `scripts/backfill-timelog-compute.js` *(new)*

---

### 9. Driver/Aide Segment Hours & OT Boundary — Server-Computed

> **Affects:** Server only (clients benefit from pre-computed values)
> **Breaking:** No — new nullable fields added to `TimeLog`

#### Background

Driver/Aide employees work three contiguous segments per day:

| Segment | Time | Hours |
|---|---|---|
| Driver/Aide AM | 6:30 AM → 8:00 AM | 1.25h |
| Regular | 8:00 AM → 1:30 PM | 5.50h |
| Driver/Aide PM | 1:30 PM → 2:45 PM | 1.25h |
| **Total** | | **8.00h** |

OT can only occur at the tail end of the day — after Driver PM ends at 2:45 PM. Driver AM can never produce OT because it ends exactly when Regular begins.

#### New Computed Fields

| Field | Type | Description |
|---|---|---|
| `regularSegmentHours` | `Decimal(6,2)?` | Regular shift hours (schedule-bounded, pre-schedule time excluded). `null` for REGULAR logs. |
| `driverAmSegmentHours` | `Decimal(6,2)?` | Driver AM segment hours (6:30–8:00, clamped to actual clock times). `null` for REGULAR / DA_PM. |
| `driverPmSegmentHours` | `Decimal(6,2)?` | Driver PM segment hours (1:30–2:45, clamped to actual clock times). `null` for REGULAR / DA_AM. |
| `rawOtMinutes` | `Int?` | Minutes past Driver PM shift end (2:45 PM), grace-adjusted. `null` for REGULAR logs. |

For DA logs: `netWorkedHours = regularSegmentHours + driverAmSegmentHours + driverPmSegmentHours`

Segment hours are clamped to actual clock times. If an employee clocks out before a segment ends, that segment reflects only the time they were actually present in that window.

#### Pre-Schedule Time Exclusion

A clock-in before the scheduled start (e.g. 7:31 AM on a Regular/DA day starting at 8:00 AM) is excluded from all segment calculations via `max(timeIn, segStart)` clamping. The 29 minutes before 8:00 AM contribute zero hours to any segment. Raw `timeIn` is preserved.

#### Shift Catalog Name Dependency

For unassigned employees (no UserShift assigned, selected Driver PM at punch), the service falls back to a shift catalog lookup to resolve the correct 2:45 PM boundary. This fallback depends on a `Shift` record named exactly **`"Driver/Aide PM Shift"`** existing in the company catalog.

If this name is renamed or deleted, the fallback silently produces `rawOtMinutes = null` for unassigned DA_PM logs and writes a warning to the server log:

```
[computeTimeLogSummary] "Driver/Aide PM Shift" not found in catalog for companyId=...
```

The assigned driver path (employees with UserShifts assigned) is not affected by any rename.

The canonical shift names this service depends on:

| Role | Required catalog name |
|---|---|
| Driver/Aide AM | `Driver/Aide AM Shift` |
| Regular | `Regular Shift` |
| Driver/Aide PM | `Driver/Aide PM Shift` |

These names must be preserved in the admin shift catalog.

**DB migrations:**
- `scripts/migrate-timelog-segment-hours.sql`
- `scripts/migrate-rawot-minutes.sql`

**Files changed:**
- `src/services/timeLogComputeService.js`
- `src/prisma/schema.prisma`

---

### 10. Punch Log Display Fixes — Client Integration Guide

> **Affects:** Web client, Mobile client
> **Breaking:** Yes — `lateHours`, `undertimeHours`, `netWorkedHours` type changed from string to number

This entry documents the server changes that unblock correct display of Duration, Hours Breakdown, and OT in the Employee Punch Logs screen.

---

#### Fix A — Decimal fields now return plain numbers

Prisma `Decimal` fields were serializing to JSON as strings (e.g. `"8.25"`). All six affected fields are now coerced with `parseFloat()` before the response is sent.

| Field | Before | After |
|---|---|---|
| `lateHours` | `"0.50"` (string) or `null` | `0.5` (float) or `null` |
| `undertimeHours` | `"0.25"` (string) or `null` | `0.25` (float) or `null` |
| `netWorkedHours` | `"8.25"` (string) or `null` | `8.25` (float) or `null` |
| `regularSegmentHours` | `"5.50"` (string) or `null` | `5.5` (float) or `null` |
| `driverAmSegmentHours` | `"1.25"` (string) or `null` | `1.25` (float) or `null` |
| `driverPmSegmentHours` | `"1.25"` (string) or `null` | `1.25` (float) or `null` |

`lunchDeductionMinutes`, `totalBreakMinutes`, and `rawOtMinutes` are `Int` — they were already plain numbers.

---

#### Fix B — Duration column: read `netWorkedHours`, not `log.duration`

`log.duration` has never existed on the server response. Code reading it always received `undefined` and fell back to gross clock-to-clock time with no break deductions.

```ts
// Before (always fell back to gross time)
const duration = log.duration || rawDuration(log.timeIn, log.timeOut);

// After
const duration = log.netWorkedHours != null
  ? log.netWorkedHours.toFixed(2)      // server-computed, breaks deducted
  : rawDuration(log.timeIn, log.timeOut); // fallback for pre-backfill records only
```

---

#### Fix C — OT Request button: drop `pastSchedule` from eligibility

`otEligible = pastSchedule || rawOtMins > 0` caused the OT button to appear even when computed OT was `0.00h`. An employee clocking out one minute past their scheduled end set `pastSchedule = true`, showing the button with no OT to request.

```ts
// Before
const otEligible = pastSchedule || rawOtMins > 0;

// After
const otEligible = rawOtMins > 0;
```

The `pastSchedule` variable has no other references and can be removed.

---

#### Fix D — Driver PM hours breakdown: read server fields directly

For `DRIVER_AIDE_PM` and `DRIVER_AIDE` punch types, read the three segment fields and `rawOtMinutes` directly. No client-side math required.

```ts
const regularHours  = log.regularSegmentHours  ?? 0;
const driverAmHours = log.driverAmSegmentHours ?? 0;
const driverPmHours = log.driverPmSegmentHours ?? 0;
const otHours       = log.rawOtMinutes != null ? (log.rawOtMinutes / 60) : 0;
```

---

#### Complete field reference

| Field | Type | Regular | DA_AM | DA_PM | DA | Description |
|---|---|---|---|---|---|---|
| `netWorkedHours` | `float\|null` | ✓ | ✓ | ✓ | ✓ | REGULAR: gross−breaks. DA: sum of segments. |
| `lateHours` | `float\|null` | ✓ | ✓ | ✓ | ✓ | Minutes late past shift start (grace-adjusted). |
| `undertimeHours` | `float\|null` | ✓ | ✓ | ✓ | ✓ | Hours short of scheduled day end. |
| `lunchDeductionMinutes` | `int\|null` | ✓ | ✓ | ✓ | ✓ | Lunch deduction applied in minutes. |
| `totalBreakMinutes` | `int\|null` | ✓ | ✓ | ✓ | ✓ | Coffee break total in minutes. |
| `regularSegmentHours` | `float\|null` | — | ✓ | ✓ | ✓ | Regular shift hours (schedule-bounded). |
| `driverAmSegmentHours` | `float\|null` | — | ✓ | — | ✓ | Driver AM hours (clamped to 6:30–8:00). |
| `driverPmSegmentHours` | `float\|null` | — | — | ✓ | ✓ | Driver PM hours (clamped to 1:30–2:45). |
| `rawOtMinutes` | `int\|null` | — | — | ✓ | ✓ | OT minutes past 2:45 PM (grace-adjusted). |

---

#### Worked example — Unassigned employee covering Driver PM

```
Schedule:   Regular only — 8:00 AM → 1:30 PM
Clock-in:   7:31 AM
Clock-out:  3:25 PM
Punch type: DRIVER_AIDE_PM
```

| Field | Value | Calculation |
|---|---|---|
| `regularSegmentHours` | `5.50` | max(7:31, 8:00) → min(3:25, 1:30) = 8:00–1:30 |
| `driverAmSegmentHours` | `null` | Not a DA_AM punch type |
| `driverPmSegmentHours` | `1.25` | 1:30 → min(3:25, 2:45) = 1:30–2:45 |
| `netWorkedHours` | `6.75` | 5.50 + 1.25 |
| `rawOtMinutes` | `40` | 3:25 − 2:45 = 40 min |

The 29 minutes before 8:00 AM are excluded. The 40 OT minutes require a separate OT request tagged to the Driver PM role.

---

**Files changed (server):**
- `src/controllers/Features/timeLogController.js` — Decimal coercion + segment field exposure
- `src/services/timeLogComputeService.js` — segment computation + `rawOtMinutes`
- `src/prisma/schema.prisma`

---

### 11. Auto Clock-Out Module Redesign

> **Affects:** Server cron, company settings, clock-in/out endpoints
> **Breaking:** No (additive only)
> **Replaces:** `autoClockOutSafeguard.js` entirely

#### What Was Wrong with the Old Safeguard

- Hardcoded 5-hour limit with no company-level configuration
- Scanned every open session on every cron tick (O(all active sessions))
- No employee warning before the forced close
- No targeted supervisor notification — only generic FCM push
- `computeTimeLogSummary` was not called, leaving derived fields stale after auto-close
- Temporarily disabled in v2.7.2 due to the timezone bug described in entry 1

#### New Design: Two-Stage Warn + Close

**Stage 1 — Warn:** Send push notification + email to the employee before their shift ends.
**Stage 2 — Close:** Auto-close the session after a grace window, run `computeTimeLogSummary`, email configured supervisor addresses.

#### LiveUser Table

A new `LiveUser` table acts as the live presence index. One row is created per employee at clock-in and removed at self clock-out (or auto-close). Timestamp fields are pre-computed at clock-in so cron queries are simple indexed range scans.

| Column | Type | Description |
|---|---|---|
| `userId` | `String @unique` | FK → User (one active row per employee) |
| `companyId` | `String` | FK → Company |
| `timeLogId` | `String @unique` | FK → TimeLog (the open session) |
| `scheduledEnd` | `DateTime?` | Resolved shift end (`null` = fallback used) |
| `warnAt` | `DateTime?` | `scheduledEnd − autoClockOutWarningHours` |
| `closeAt` | `DateTime?` | `scheduledEnd + autoClockOutGraceHours` |
| `warningSent` | `Boolean` | Prevents duplicate warnings |
| `createdAt` | `DateTime` | Row creation timestamp |

#### New Company Configuration Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `autoClockOutWarningHours` | `Decimal(4,2)` | `0.5` | Hours BEFORE `scheduledEnd` to warn the employee |
| `autoClockOutGraceHours` | `Decimal(4,2)` | `1.0` | Hours AFTER `scheduledEnd` before auto-close |
| `autoClockOutNotifyEmails` | `Json` | `[]` | `string[]` of supervisor email addresses to notify on auto-close |

All three are returned by `GET /api/company-settings` and accepted by `PATCH /api/company-settings`.

#### Scheduled End Resolution

At clock-in, `liveUserService.createLiveUser` resolves `scheduledEnd`:

1. Fetch all UserShifts for the clock-in date in the company timezone
2. Pick the shift with the latest `endTime` (Driver PM wins over Regular)
3. Resolve that `endTime` in the company timezone via `combineDateWithTimeTz`
4. Fallback: `timeIn + company.defaultShiftHours` when no shift is assigned

#### How the Cron Job Works (`autoClockOutJob.js`, every 5 min)

**Pass 1 — Warn:**
- Queries `LiveUser WHERE warnAt <= now AND warningSent = false`
- Sends push + email to employee (`CLOCK_OUT_WARNING` notification)
- Sets `warningSent = true`

**Pass 2 — Close:**
- Queries `LiveUser WHERE closeAt <= now AND timeLog.status = true`
- Sets `timeLog.timeOut = scheduledEnd`, `autoClockOut = true`, `autoClockOutAt = cronFiredAt`
- Closes any open coffee/lunch breaks at cron fire time
- Runs `computeTimeLogSummary` (non-fatal)
- Emails `autoClockOutNotifyEmails` recipients
- Deletes the `LiveUser` row

All per-record errors are caught and skipped — the job never aborts mid-run.

#### Migration

```bash
psql $DATABASE_URL -f scripts/migrate-liveuser-autoclockout.sql
npx prisma generate
```

#### Client-Side Notes

- No change to clock-in/clock-out request or response shape
- `autoClockOut: true` badge on TimeLog records continues to work unchanged
- `CLOCK_OUT_WARNING` in-app notifications can be rendered as a persistent prompt (time-sensitive)
- Configure thresholds via `PATCH /api/company-settings`

#### Files Changed

| File | Change |
|---|---|
| `src/prisma/schema.prisma` | `LiveUser` model + 3 Company fields + relations on User/TimeLog |
| `scripts/migrate-liveuser-autoclockout.sql` | SQL migration *(new)* |
| `src/services/liveUserService.js` | `createLiveUser` / `removeLiveUser` *(new)* |
| `src/services/notificationService.js` | `notifyClockOutWarning` + `notifyAutoClockOutSupervisors` added |
| `src/controllers/Features/timeLogController.js` | `timeIn` → `createLiveUser`; `timeOut` → `removeLiveUser` |
| `src/controllers/Account/companySettingsController.js` | 3 new fields in `getSettings` / `updateSettings` |
| `src/jobs/autoClockOutJob.js` | New job *(new)* |
| `src/utils/cronScheduler.js` | Replaced safeguard import with `autoClockOutJob`, re-enabled at `*/5 * * * *` |

---

### 12. Email Template Redesign

> **Affects:** All outbound notification emails
> **Breaking:** No

All eight email templates have been redesigned. The previous templates used gradient orange/red headers, colored background cards, inline emoji characters, and mixed layout styles. All have been replaced with a consistent, professional design:

- Dark header (`#1a1a2e`) with white title and muted subtitle
- White body with clean key/value tables (`<table>` with `border-bottom: 1px solid #eee`)
- Subtle notice boxes (left border accent, light background) for action callouts
- Single dark CTA button
- Plain gray footer with copyright line
- No emoji anywhere
- Max width 560px for transactional emails; 680px for report emails with data tables

#### Templates Updated

| Template | Purpose |
|---|---|
| `missedClockIn.hbs` | Employee reminder to clock in |
| `missedClockOut.hbs` | Employee reminder to clock out |
| `autoClockOut.hbs` | Employee notification of auto clock-out |
| `autoClockOutCorrected.hbs` | Employee notification of time log correction |
| `morningReport.hbs` | Daily morning attendance digest for management |
| `eveningReport.hbs` | Daily evening attendance digest for management |
| `clockOutWarning.hbs` | Employee warning that shift is ending soon *(new)* |
| `autoClockOutSv.hbs` | Supervisor alert on auto clock-out *(new)* |

#### Test Routes

Test endpoints are available to preview any template on demand. All default to `webdev@bizsolutions.us` if no `to` body field is provided.

| Route | Template |
|---|---|
| `POST /api/test/missed-clock-in-email` | `missedClockIn` |
| `POST /api/test/missed-clock-out-email` | `missedClockOut` |
| `POST /api/test/auto-clock-out-email` | `autoClockOut` |
| `POST /api/test/auto-clock-out-corrected-email` | `autoClockOutCorrected` |
| `POST /api/test/morning-report-email` | `morningReport` |
| `POST /api/test/evening-report-email` | `eveningReport` |
| `POST /api/test/clock-out-warning-email` | `clockOutWarning` |
| `POST /api/test/auto-clock-out-sv-email` | `autoClockOutSv` |

```bash
curl -s -X POST http://localhost:5001/api/test/morning-report-email \
  -H "Content-Type: application/json" \
  -d '{"to":"you@example.com"}'
```

**Files changed:** All files in `src/templates/`, `src/routes/testRoutes.js`

---

---

### 13. Auto Clock-Out — Missing `NotificationCode` Enum Values

> **Affects:** Server only
> **Breaking:** No

**The bug:** `notifyClockOutWarning` used `notificationCode: "CLOCK_OUT_WARNING"` and `notifyAutoClockOutSupervisors` used `notificationType: "AUTO_CLOCK_OUT_SV"` when writing to `NotificationLog` and `EmailNotificationLog`. Neither value existed in the `NotificationCode` enum in `schema.prisma`. This caused a `PrismaClientValidationError` on every auto clock-out warn and close cycle, silently swallowing both the in-app notification and the email log entry. The email itself still sent (the error occurred after the send), but no log record was created.

**The fix:** Added both values to the `NotificationCode` enum:

```prisma
enum NotificationCode {
  // Attendance
  AUTO_CLOCK_OUT
  AUTO_CLOCK_OUT_SV    // ← new
  CLOCK_OUT_WARNING    // ← new
  ...
}
```

**DB migration:** `scripts/migrate-notification-codes.sql`
**Files changed:** `src/prisma/schema.prisma`

---

### 14. Auto Clock-Out Supervisor Email — Scheduled End Always Matched Auto Clock-Out Time

> **Affects:** Supervisor notification emails
> **Breaking:** No

**The bug:** In `notifyAutoClockOutSupervisors`, the `scheduledEndTime` field in the supervisor email was computed as:

```js
const scheduledStr = timeLog.timeOut ? fmt(timeLog.timeOut) : "—";
```

Since `timeLog.timeOut` is always set to `scheduledEnd` by the auto clock-out job, both the "Scheduled End" and "Auto Clock-Out Time" columns in the email always showed identical values. Supervisors could not tell if the employee was clocked out exactly on time or later.

**The fix:** `notifyAutoClockOutSupervisors` now accepts a `scheduledEnd` parameter passed from the `LiveUser` row, which is the pre-computed shift end resolved at clock-in time. `autoClockOutJob.js` passes `lu.scheduledEnd` at the call site.

```js
// notificationService.js
async function notifyAutoClockOutSupervisors({ user, timeLog, scheduledEnd, notifyEmails })
const scheduledStr = scheduledEnd ? fmt(scheduledEnd) : fmt(timeLog.timeOut);

// autoClockOutJob.js
await notifyAutoClockOutSupervisors({
  user, timeLog, scheduledEnd: lu.scheduledEnd, notifyEmails
});
```

**Files changed:**
- `src/services/notificationService.js`
- `src/jobs/autoClockOutJob.js`

---

### 15. Auto Clock-Out — Missing Real-Time Socket Event to Employee

> **Affects:** Mobile client, Web client
> **Breaking:** No — additive only

**The bug:** When the auto clock-out job closed a session, it updated the `TimeLog` in the DB but never emitted a socket event to the employee's room. The employee's punch screen would only reflect the auto clock-out after a manual page refresh or the next background poll. The manual clock-out path (`POST /api/timelogs/time-out`) correctly emits `timeLogUpdated` — auto clock-out was the only path missing this.

**The fix:** `autoClockOutJob.js` now emits a socket event immediately after the `timeLog.update` persists:

```js
getIO().to(lu.userId).emit("timeLogUpdated", { type: "autoClockOut", data: closedTimeLog });
```

The `type` is `"autoClockOut"` (distinct from the manual `"timeOut"`) so clients can differentiate and show an appropriate message (e.g. "You were automatically clocked out").

#### Mobile / Web Client Action Required

Listen for the new `type` value on the existing `timeLogUpdated` socket event:

```js
socket.on("timeLogUpdated", ({ type, data }) => {
  if (type === "timeOut") {
    // existing manual clock-out handler
  }
  if (type === "autoClockOut") {
    // new — treat same as timeOut but optionally show auto clock-out banner/alert
    handleClockOut(data);
    showAutoClockOutBanner(); // optional UX
  }
});
```

No new socket event name — same `"timeLogUpdated"` event, new `type` discriminator.

**Files changed:** `src/jobs/autoClockOutJob.js`

---

### 16. `GET /api/timelogs/user` — Date Filter Excludes Records for UTC+ Companies

> **Affects:** Web client, Mobile client
> **Breaking:** No — fix makes filtering more correct; no response shape change

**The bug:** The `from` and `to` query params were interpreted as bare UTC midnight timestamps:

```js
const from = req.query.from ? new Date(req.query.from) : null; // "2026-04-13" → 2026-04-13T00:00:00.000Z
const to   = req.query.to   ? new Date(req.query.to)   : null; // "2026-04-13" → 2026-04-13T00:00:00.000Z
```

For companies in `America/Los_Angeles` (PDT = UTC−7), the entire working day on any given date is stored in UTC as `T07:00:00Z` through `T31:59:59Z` (next UTC day). Using `timeIn <= 2026-04-13T00:00:00Z` as the upper bound excludes every clock-in record from that calendar day. The result: the last selected date always returns zero records for all California clients.

The same issue affects `from` at the boundary — a cross-midnight clock-in (e.g. 10:30 PM PDT) is stored as the next UTC date and could fall outside the `from` bound if queried for the PDT calendar date it belongs to.

**The fix:** The endpoint now fetches `company.timeZone` for the requesting user and interprets `from`/`to` as start/end of day in that timezone before building the Prisma `where` clause:

```js
// Fetch company timezone
const userRecord = await prisma.user.findUnique({
  where:  { id: userId },
  select: { company: { select: { timeZone: true } } },
});
const tz = userRecord?.company?.timeZone || "UTC";

// Parse dates as start/end of day in company timezone
const from = req.query.from ? moment.tz(req.query.from, "YYYY-MM-DD", tz).startOf("day").toDate() : null;
const to   = req.query.to   ? moment.tz(req.query.to,   "YYYY-MM-DD", tz).endOf("day").toDate()   : null;
```

**Effect on cross-midnight shifts:** A clock-in at 10:30 PM PDT April 1 is stored as `2026-04-02T05:30:00Z`. With the fix, an April 1 PDT query resolves `to = 2026-04-02T06:59:59Z` — this record is correctly included under April 1 (the date the shift started in local time).

#### Client-Side Notes

- **No request change required.** Continue sending `from`/`to` as `YYYY-MM-DD` strings (e.g. `?from=2026-04-01&to=2026-04-13`). The server now handles timezone interpretation correctly.
- **Do not send ISO timestamps** (`T00:00:00.000Z`) for these params — send date-only strings. The server owns the timezone conversion.
- The default date range on load (first of month → today) should continue using the company timezone to generate the `YYYY-MM-DD` string, which is already the case on the employee side (`getDefaultTo` uses `toLocaleDateString("en-CA", { timeZone: tz })`).

**Files changed:** `src/controllers/Features/timeLogController.js`

---

---

### 17. `GET /api/timelogs` — Employer Punch Logs Five-Part Fix

> **Affects:** Web client, Mobile client (employer/admin view)
> **Breaking:** Yes — response shape changed (`meta` → `pagination`, new `summary` block, new fields)

Five issues fixed in one pass on `getCompanyTimeLogs`.

---

#### Fix A — Timezone-aware date bounds

Same root cause as entry 16. The previous implementation hardcoded UTC offsets:

```js
// Before
where.timeIn.gte = new Date(`${req.query.from}T00:00:00Z`);  // UTC midnight
where.timeIn.lte = new Date(`${req.query.to}T23:59:59Z`);    // UTC 11:59 PM = 4:59 PM PDT
```

`to` at UTC 23:59 = 4:59 PM PDT — anything clocked in after 4:59 PM PDT was excluded. The fix uses the same pattern as the employee endpoint: fetch `company.timeZone`, parse `from`/`to` as start/end of day in that timezone via `moment-timezone`.

Client sends `YYYY-MM-DD` — no change required on the frontend.

---

#### Fix B — `shiftToday` uses company timezone

The day boundaries for today's shift lookup previously used `setHours(0,0,0,0)` in server local time (PHT). Now uses:

```js
const dayStart = moment().tz(tz).startOf("day").toDate();
const dayEnd   = moment().tz(tz).endOf("day").toDate();
```

---

#### Fix C — Missing computed fields in response

All fields computed by `timeLogComputeService` (entry 8/9) are now exposed in the employer response, matching the employee side:

| Field | Type | Previously |
|---|---|---|
| `netWorkedHours` | `float\|null` | ❌ missing |
| `undertimeHours` | `float\|null` | ❌ missing |
| `lunchDeductionMinutes` | `int\|null` | ❌ missing |
| `totalBreakMinutes` | `int\|null` | ❌ missing |
| `regularSegmentHours` | `float\|null` | ❌ missing |
| `driverAmSegmentHours` | `float\|null` | ❌ missing |
| `driverPmSegmentHours` | `float\|null` | ❌ missing |
| `rawOtMinutes` | `int\|null` | ❌ missing |
| `lateHours` | `float\|null` | ⚠️ present but not `parseFloat`-coerced |

All Decimal fields are coerced with `parseFloat` before the response is sent, consistent with the employee endpoint.

---

#### Fix D — Response shape aligned with employee side

| | Before | After |
|---|---|---|
| Pagination key | `meta` | `pagination` |
| Pagination fields | `page, perPage, total, totalPages` | `page, limit, total, totalPages` |
| Summary block | ❌ none | ✅ `{ total, active, completed, totalHours }` |
| `timeIn` / `timeOut` | raw Date object | ISO string (`.toISOString()`) |

`summary.totalHours` is computed via raw SQL joining `TimeLog` → `User` on `companyId`, scoped to the same filters (date range, employeeId, departmentId, punchType).

#### Client-Side Changes Required

```ts
// Before
const { data, meta } = response;
setTotalPages(meta.totalPages);

// After
const { data, pagination, summary } = response;
setTotalPages(pagination.totalPages);
setTotalHours(summary.totalHours);
setActive(summary.active);
setCompleted(summary.completed);
```

---

#### Fix E — `punchType` filter added

```
GET /api/timelogs?punchType=DRIVER_AIDE_PM
```

Accepts the same values as the employee endpoint: `REGULAR`, `DRIVER_AIDE_AM`, `DRIVER_AIDE_PM`, `DRIVER_AIDE`. Invalid values are ignored (no filter applied).

---

#### Fix F — OT requests bundled into each punch log row

Previously the employer punch log page fetched `GET /api/overtime` separately and joined overtime records to timelogs on the client using `timeLogId`. Issues with this approach:

- Fetched **all** company OT records on every page load with no date scoping — grows unbounded over time
- Fragile client-side join logic
- Stale if an OT request was approved after initial load

The fix adds `overtime` to the `include` in `getCompanyTimeLogs`. The `Overtime` model has `@@index([timeLogId])` so the join is an indexed lookup — fast at any scale. Only the fields the punch log view needs are selected (no nested user relations), keeping the per-row payload lean.

Each row now includes:

```json
"overtime": [
  {
    "id": "...",
    "status": "pending",
    "requestedHours": 1.5,
    "requesterReason": "Stayed to finish deployment",
    "approverComments": null,
    "createdAt": "2026-04-13T...",
    "updatedAt": "2026-04-13T..."
  }
]
```

- Array is **pre-sorted by `updatedAt` desc** — `overtime[0]` is always the most recently touched record. No client-side reduce needed.
- `requestedHours` coerced to `float` (was Prisma `Decimal` string).
- `createdAt` / `updatedAt` serialized as ISO strings.
- Nested `requester`, `approver`, and `timeLog` relations are intentionally excluded — the parent punch log row already carries employee identity. If the OT detail dialog needs approver/requester info, it should call `GET /api/overtime/:id` on demand rather than pre-loading it for every row.

#### Client-Side Changes Required

- **Stop fetching `GET /api/overtime` from the punch log page** — the data is now in each `log.overtime[]`
- Read OT status directly: `log.overtime[0]?.status` (most logs will have 0 or 1 OT request)
- `GET /api/overtime` remains available for the standalone OT management/approvals page — do not remove it there

**Files changed:** `src/controllers/Features/timeLogController.js`

---

### 18. Leave Module — Management View-Only Access & `canAct` Flag

> **Affects:** Web client, Mobile client
> **Breaking:** No — additive (new `canAct` field in response; result set is broader for all management roles)

#### The Bug

`GET /api/leaves` and `GET /api/leaves/pending` only returned leave records where the logged-in user was the explicitly named `approverId` or `secondaryApproverId`. Meanwhile, the leave submission flow sends a `LEAVE_REQUEST_SUBMITTED` notification to **all** `admin`, `superadmin`, and `supervisor` users in the company. This caused every management user who was not the named approver to receive a notification, tap through to the leave list, and see an empty list.

#### The Fix

All management roles (`admin`, `superadmin`, `supervisor`) now receive company-wide visibility over all leave requests regardless of who the named approver is. Each leave record includes a `canAct` boolean that gates approve/reject authority.

#### New `canAct` Field

```json
{
  "id": "...",
  "status": "pending",
  "canAct": true,
  ...
}
```

| `canAct` | Condition |
|---|---|
| `true` | Viewer is the named `approverId` (status: `pending`) or `secondaryApproverId` (status: `pending_secondary`) |
| `false` | View-only — visible but no action authority |

#### Scope Change

| Role | Before | After |
|---|---|---|
| `admin` | Only leaves directed at them | All company leaves |
| `superadmin` | Only leaves directed at them | All company leaves |
| `supervisor` | Only leaves directed at them | All company leaves |

The approve/reject endpoints (`PUT /api/leaves/:id/approve`, `PUT /api/leaves/:id/reject`) are **unchanged** — the server-side guard still returns `404` if the caller is not the named approver. `canAct` is the client-side signal, not the enforcement layer.

#### Mobile / Web Client Action Required

1. **Gate approve/reject buttons on `canAct`**

```ts
// Show action buttons only when directed at this user
if (leave.canAct) {
  renderApproveRejectButtons(leave);
} else {
  renderReadOnlyRow(leave);
}
```

2. **No change to how you call the endpoints** — same URL, same params, same pagination.

3. `canAct` is always present in the response for all management roles — safe to check unconditionally.

**Files changed:** `src/controllers/Features/leaveController.js`

---

### 19. `checkMissedClockIns` — Leave-Aware (Skip Employees on Approved Leave)

> **Affects:** Server only (background cron)
> **Breaking:** No

**The bug:** The missed clock-in cron job (`checkMissedClockIns.js`) had no awareness of the leave system. If an employee was on approved leave but had a `UserShift` assigned for that day, the job would fire a `MISSED_CLOCK_IN` push notification and email to them anyway.

**The fix:** Before sending the notification, the job now checks if the employee has an approved `Leave` record covering the current date. If they do, the notification is skipped silently.

```js
const onLeave = await prisma.leave.findFirst({
  where: {
    userId:    userShift.userId,
    status:    "approved",
    startDate: { lte: now.toDate() },
    endDate:   { gte: now.toDate() },
  },
});
if (onLeave) continue;
```

**Files changed:** `src/jobs/checkMissedClockIns.js`

---

### 20. `leaveStatus` Enum — Wired to `Leave.status`

> **Affects:** Server only
> **Breaking:** No — existing valid status values are preserved

**The bug:** The `leaveStatus` enum existed in `schema.prisma` but was never used. `Leave.status` was a plain `String` with no DB-level validation. Invalid status values (typos, rogue writes) could be silently persisted. Additionally, the enum was missing `pending_secondary` and `cancelled` — both values used in controller logic.

**The fix:**
- Added `pending_secondary` and `cancelled` to the `leaveStatus` enum
- Changed `Leave.status` from `String` to `leaveStatus` — DB-level type enforcement now active

```prisma
enum leaveStatus {
  pending
  pending_secondary  // ← new
  approved
  rejected
  cancelled          // ← new
}

model Leave {
  status leaveStatus @default(pending)  // was: String @default("pending")
}
```

**DB migration required:**
```bash
psql $DATABASE_URL -f scripts/migrate-leave-status-enum.sql
npx prisma generate
```

> Before running, verify no invalid status values exist:
> `SELECT DISTINCT status FROM "Leave";`

**Files changed:** `src/prisma/schema.prisma`, `scripts/migrate-leave-status-enum.sql` *(new)*

---

### 21. `rawOtMinutes` — Now Computed for REGULAR Punch Types

> **Affects:** Web client, Mobile client (employee and employer punch logs)
> **Breaking:** No — previously `null` for REGULAR logs; now a number

`rawOtMinutes` was previously only computed for Driver/Aide punch types (`DRIVER_AIDE_PM`, `DRIVER_AIDE`). For `REGULAR` logs it was always `null`, forcing the client to maintain its own OT math pipeline for regular employees.

**The fix:** `computeTimeLogSummary` now computes `rawOtMinutes` for REGULAR logs using the same grace-adjusted formula as the DA path, applied against the employee's assigned shift end:

- **Has assigned shift** — measures minutes past the latest `endTime` across all UserShifts for the day
- **No assigned shift** (SV/Manager) — measures minutes past `timeIn + defaultShiftHours`

```
rawOtMinutes = max(0, timeOut − shiftEnd − gracePeriod)
```

Mutual exclusivity with `undertimeHours` is preserved — both are computed against the same `shiftEnd` boundary, so they can never both be non-zero.

#### Post-Deploy Backfill Required

All existing REGULAR records have `rawOtMinutes = null` in the DB. Run with `--force` to recompute everything (incremental mode would skip already-computed records):

```bash
node scripts/backfill-timelog-compute.js --force
```

#### Mobile / Web Client Action Required

The client can now drop all client-side `rawOtMins` math for REGULAR employees. Read `log.rawOtMinutes` directly for all punch types — no branching needed:

```ts
// Before — branched on punch type
const rawOtMins = isDriverType ? log.rawOtMinutes : computeClientSideOt(log);

// After — unified for all punch types
const rawOtMins = log.rawOtMinutes ?? 0;
```

**Files changed:** `src/services/timeLogComputeService.js`

---

### 22. `calcRequestedHours` — Weekend, Holiday & Shift-Aware Leave Deduction

> **Affects:** Server only (leave balance deduction on approval)
> **Breaking:** No — deduction amounts may decrease for multi-day leave requests spanning weekends or holidays

**The bug:** Leave duration was computed as raw calendar days × `defaultShiftHours` with no exclusions. A Friday–Monday request deducted 4 days including Saturday and Sunday. Any multi-day request spanning a company holiday also over-deducted.

**The fix:** `calcRequestedHours` now walks each calendar day in the leave range and counts only deductible days:

| Day type | Counted? |
|---|---|
| Saturday / Sunday | No — always excluded |
| Company holiday (`Holiday` table, scoped to `companyId`) | No |
| Weekday with assigned `UserShift` (shift-tracked employee) | Yes |
| Weekday with no `UserShift` but employee has shifts in range | No (only shift days count) |
| Weekday — no `UserShift` at all in range (SV/Manager/salaried) | Yes |

**Detection is automatic** — no flag required. If the employee has `UserShift` records in the requested date range, only shift-assigned days count. If no shifts exist (salaried staff), all non-weekend non-holiday weekdays count.

All date comparisons use `company.timeZone` (`America/Los_Angeles` for California clients).

**Example — Friday Apr 17 → Monday Apr 20:**

| Employee type | Days counted | Hours deducted |
|---|---|---|
| Regular (shift on Fri only) | 1 | 8h |
| SV/Manager (no shifts) | 2 (Fri + Mon) | 16h |
| Either — if Apr 17 is a configured holiday | 1 (Mon only) | 8h |

**Files changed:** `src/utils/leaveUtils.js`

---

### 23. Leave — Two-Step Approval Redesign (Per-Request Escalation)

> **Affects:** Web client, Mobile client (company side — approve dialog)
> **Breaking:** No — existing single-step approvals are unchanged

**Previous design:** `company.secondaryApproverId` was a single company-wide field. Every leave request was pre-assigned to the same secondary approver at submission time if `multiApprovalEnabled = true`. This created a single bottleneck for all employees and all leave types.

**New design:** The first approver decides per-request whether to escalate. At submission, `secondaryApproverId` is always `null`. When approving, the first approver optionally includes `escalateTo` in the request body.

#### Updated Request Body — `PUT /api/leaves/:id/approve`

```json
// Single-step (no change)
{ "approverComments": "Approved." }

// Two-step (new)
{
  "approverComments": "Approved, escalating for final sign-off.",
  "escalateTo": "<userId>"
}
```

**Rules:**
- `escalateTo` is only accepted if `company.multiApprovalEnabled = true`
- Target must be an active `admin`, `supervisor`, or `superadmin` in the company
- Cannot escalate to yourself or to the leave requester
- If `multiApprovalEnabled = false`, passing `escalateTo` returns `400`

#### Mobile / Web Client Action Required

On the approve dialog, when `company.multiApprovalEnabled === true`:

```
[ Approver Comments textarea ]

[ ] Require second approval
    [ Select approver — GET /api/leaves/approvers ]

[ Approve ]  [ Reject ]
```

When the checkbox is checked and a second approver is selected, include `escalateTo` in the body. Otherwise omit it entirely.

`company.multiApprovalEnabled` is available in `GET /api/company-settings` — no new fetch required if company settings are already loaded on bootstrap.

**Files changed:** `src/controllers/Features/leaveController.js`

---

### 24. Leave — Real-Time Balance Update Socket Event

> **Affects:** Web client, Mobile client (employee side)
> **Breaking:** No — additive only

When a leave request is fully approved (single-step or final secondary approval), the server now emits a socket event to the employee immediately after the balance deduction:

```js
socket.on("leaveBalanceUpdated", ({ leaveId, policyId }) => {
  fetchLeaveBalances(); // re-fetch GET /api/leaves/balances
});
```

Previously the employee's balance display only updated on page load or manual refresh. With this event, the balance card reflects the deduction in real time as soon as the approver acts.

#### Mobile / Web Client Action Required

Add the `leaveBalanceUpdated` listener in the same file/component where leave balances are displayed. On receipt, trigger a re-fetch of `GET /api/leaves/balances`. No additional data is needed from the payload — `leaveId` and `policyId` are provided for reference only.

**Files changed:** `src/controllers/Features/leaveController.js`

---

### 25. `GET /api/timelogs` — `employeeRole` & `employeeCode` Fields

> **Affects:** Web client, Mobile client (employer/company punch logs)
> **Breaking:** No — additive only

Two new fields added to every row in the employer punch log response:

| Field | Source | Null when |
|---|---|---|
| `employeeRole` | `EmploymentDetail.jobTitle` | Job title not set — display `—` |
| `employeeCode` | `User.employeeId` | Employee ID not assigned — fall back to `userId` |

```json
{
  "employeeName": "Jane Doe",
  "employeeRole": "Teacher",
  "employeeCode": "EMP-042",
  ...
}
```

No new endpoint or query param required. Both fields are always present in the response (`null` if not set).

**Files changed:** `src/controllers/Features/timeLogController.js`

---

### 26. Company Settings — `multiApprovalEnabled` & `secondaryApproverId` Not Saved

> **Affects:** Web client, Mobile client (company settings page)
> **Breaking:** No

**The bug:** Both `multiApprovalEnabled` and `secondaryApproverId` existed on the `Company` model and were part of the company settings UI, but neither was wired into the settings controller:

- `GET /api/company-settings` — neither field was in the Prisma `select`, so the response never included them
- `PATCH /api/company-settings` — neither field was destructured from `req.body` or included in the Prisma `update`, so saves were silently ignored and the DB values remained unchanged

The client was doing everything correctly — toggling the flag and sending it in the PATCH body — but the server discarded it every time.

**The fix:** Both fields added in all three required places in `companySettingsController.js`:

| Location | Change |
|---|---|
| `getSettings` select | Added `multiApprovalEnabled`, `secondaryApproverId` |
| `updateSettings` destructure | Added both from `req.body` |
| `updateSettings` Prisma data | Added with correct type coercion (`Boolean` / nullable string) |
| `updateSettings` response select | Added so PATCH response reflects saved values immediately |

**No client changes needed.** The client was already sending both fields correctly.

**Note on `secondaryApproverId`:** With the per-request escalation redesign (entry 23), this field now serves as a **default suggestion** for the escalate-to dropdown when the approver checks "Require second approval." The client can pre-populate the picker with this value but the approver is free to select any other management user.

**Files changed:** `src/controllers/Account/companySettingsController.js`

---

## Known Issues & Deferred to v2.7.4

### Grace Period — Server-Side Enforcement Not Yet Applied

> **Status:** Identified, deferred

`gracePeriodMinutes` exists in company settings but is not yet consistently applied server-side:
- `lateHours` should produce `0` if punch-in is within the grace window
- Early clock-out within the grace window should not produce `undertimeHours`

**Current behavior:** Client handles grace period for display only. Server-side `lateHours` and `undertimeHours` do not account for the grace window.

Raw `timeIn` / `timeOut` are always stored as actual punch timestamps — never grace-adjusted. All historical records can be recomputed accurately once server-side enforcement is added.

---

### Employee Cutoff Module — Needs Revisit

> **Status:** Deferred — revisit when cutoff module is next worked on

The cutoff module (`cutoffPeriodController.js`) handles finalization and locking of pay periods. A **Phase 6 cutoff recompute** was planned but deferred:

Before a cutoff period is locked, a final sweep of `computeTimeLogSummary` across all `TimeLog` records in the cutoff date range should be triggered as a safety net to ensure derived fields are consistent with any last-minute admin edits or approvals.

**When revisiting, implement:**
1. A `recomputeCutoffPeriod(cutoffPeriodId)` function in `timeLogComputeService.js` that fetches all `TimeLog` records within the cutoff date range and runs `computeTimeLogSummary` on each.
2. Call it as a background job before `finalizeCutoffPeriod` locks the period.

---

### OT Request Withdrawal — No Employee-Facing Endpoint

> **Status:** Identified, deferred

`DELETE /api/overtime/:id` is restricted to `admin / supervisor / superadmin`. Employees cannot withdraw a pending OT request once submitted. A `PATCH /:id/cancel` endpoint scoped to the original requester (`requesterId === req.user.id`, status must be `"pending"`) is needed.

---

### `paidBreak` — Not Applied in Client Lunch Deduction

> **Status:** Identified, deferred

`paidBreak` (on `Department` model) is used correctly server-side in payroll and cutoff processing, but the client's `netMins` formula always deducts lunch regardless of `paidBreak`. The field is already available in the profile response (`employmentDetail.department.paidBreak`) — no extra fetch required. Fix is a one-line change client-side.

---

## Migration Checklist

Run these in order on the target database before deploying v2.7.3:

```bash
psql $DATABASE_URL -f scripts/migrate-is-driver.sql
psql $DATABASE_URL -f scripts/migrate-shift-assignment-window.sql
psql $DATABASE_URL -f scripts/migrate-timelog-computed-fields.sql
psql $DATABASE_URL -f scripts/migrate-timelog-segment-hours.sql
psql $DATABASE_URL -f scripts/migrate-rawot-minutes.sql
psql $DATABASE_URL -f scripts/migrate-liveuser-autoclockout.sql
psql $DATABASE_URL -f scripts/migrate-notification-codes.sql
psql $DATABASE_URL -f scripts/migrate-leave-status-enum.sql
npx prisma generate
```

After deploy, run the backfill for any company that has existing time log data:

```bash
node scripts/backfill-timelog-compute.js --companyId=<id> --from=<start-date>
```

---

*Generated by BizBuddy Backend Team — v2.7.3 — 2026-04-12*
