# BizBuddy Server — v2.7.4 Change Log

> **Release Date:** 2026-04-20
> **Prepared for:** Web Client & iOS/Mobile Teams
> **Server Version:** v2.7.4 (from v2.7.3)
> **Breaking changes:** See entry 2 — `POST /api/overtime/submit` now enforces a threshold gate.

---

## Table of Contents

**Bug Fixes**
1. [Date-Only Fields Serialized as Full ISO Timestamps](#1-date-only-fields-serialized-as-full-iso-timestamps)
2. [Punch Log Endpoints Missing Shift Info (`shiftName`, `userShifts`)](#2-punch-log-endpoints-missing-shift-info-shiftname-usershifts)
3. [Coffee Break Fields Silently Ignored on Department Update](#3-coffee-break-fields-silently-ignored-on-department-update)

**New Features**
4. [OT Threshold Enforcement — Daily / Weekly / Cutoff Basis](#4-ot-threshold-enforcement--daily--weekly--cutoff-basis)
5. [Auto-Break Policy — Auto-Lunch and Auto-Coffee Injection at Clock-Out](#5-auto-break-policy--auto-lunch-and-auto-coffee-injection-at-clock-out)

---

## Bug Fixes

### 1. Date-Only Fields Serialized as Full ISO Timestamps

> **Affects:** Web client, Mobile client (schedule views, leave views)
> **Breaking:** No — serialization-only change; stored data is unchanged

---

#### The Bug

Three calendar-date fields — `UserShift.assignedDate`, `Leave.startDate`, and `Leave.endDate` — are stored in the database as midnight UTC timestamps (e.g. `2025-01-11T00:00:00.000Z`). The API was returning them as full ISO 8601 strings. When the client parsed these strings using the browser or device local timezone, the date shifted backward by one day for any user in a UTC-behind timezone (EST, PST, etc.).

**How it propagates:**

```
API returns  →  "2025-01-11T00:00:00.000Z"
parseISO()   →  Jan 11 00:00 UTC
format()     →  uses browser local timezone

PHT (+8):  Jan 11 08:00 → "2025-01-11"  ✅
EST (-5):  Jan 10 19:00 → "2025-01-10"  ❌  Saturday becomes Friday
PST (-8):  Jan 10 16:00 → "2025-01-10"  ❌  Saturday becomes Friday
```

The bug was invisible to PH-based users (PHT = UTC+8) since their local time is ahead of UTC, but broke calendar placement for any company with a timezone behind UTC.

**Affected endpoints:**

| Endpoint | Field |
|---|---|
| `GET /api/usershifts` | `assignedDate` |
| `GET /api/usershifts/employee/:employeeId` | `assignedDate` |
| `GET /api/usershifts/company-employees` (bulk shifts) | `assignedDate` |
| `GET /api/leaves` | `startDate`, `endDate` |
| `GET /api/leaves/my` | `startDate`, `endDate` |
| `POST /api/leaves/submit` (response) | `startDate`, `endDate` |

> **Note:** `UserShift.shift.startTime` and `UserShift.shift.endTime` are intentionally kept as full ISO timestamps — they represent wall-clock times read via `.getUTCHours()` / `.getUTCMinutes()` and must remain as-is.

---

#### The Fix

Serialization-only change. `.toISOString()` on calendar-date fields is replaced with `.toISOString().slice(0, 10)` to produce plain `YYYY-MM-DD` strings.

| Field | Before | After |
|---|---|---|
| `UserShift.assignedDate` | `"2025-01-11T00:00:00.000Z"` | `"2025-01-11"` |
| `Leave.startDate` | `"2025-01-11T00:00:00.000Z"` | `"2025-01-11"` |
| `Leave.endDate` | `"2025-01-11T00:00:00.000Z"` | `"2025-01-11"` |

No stored data changes. No schema migration required. Existing records are unaffected — the fix changes only what the API sends back.

**`POST /api/leaves/submit` fix:** The submit response was returning the raw Prisma record, bypassing the shared `_format()` helper used by all other leave endpoints. It is now routed through `_format()` for consistent serialization.

---

#### Client-Side Changes Required

The server contract has changed. Both web and mobile clients must update how they consume these fields.

---

##### Schedule Views (`UserShift.assignedDate`)

**Web — `Schedule.jsx` and `employee-schedules/page.jsx`**

The calendar grouping key must be derived directly from the string rather than going through `parseISO → format`, which reintroduces the local-timezone offset:

```ts
// Before (broken for UTC-behind timezones)
const key = format(parseISO(shift.assignedDate), 'yyyy-MM-dd');

// After (safe — string is already YYYY-MM-DD)
const key = shift.assignedDate.slice(0, 10);
```

**Mobile**

Same pattern. If the date is passed through any date-parsing step before being used as a grouping key or displayed in a calendar cell, ensure it is treated as a local date, not a UTC timestamp. The safest approach is to use the string directly as the calendar key without parsing.

> `PunchLogs.jsx` (uses `toLocalDateStr(s.assignedDate, companyTimezone)`) is already resilient and requires no change.

---

##### Leave Views (`Leave.startDate`, `Leave.endDate`)

**Web — `LeaveLogs.jsx` and `EmployeesLeaveRequests.jsx`**

`new Date(dateStr)` treats a bare `YYYY-MM-DD` string as UTC midnight — the same offset issue applies. Replace all display usages with `toLocalDate(dateStr)` (the existing utility that uses `Intl.DateTimeFormat` with an explicit timezone):

```ts
// Before (still broken for UTC-behind timezones)
const display = new Date(leave.startDate).toLocaleDateString();

// After (safe)
const display = toLocalDate(leave.startDate); // uses company timezone
```

> The calendar grouping in `EmployeesLeaveRequests.jsx` already uses `toLocalDate()` correctly and requires no change.

**Mobile**

Apply the same rule: never pass `startDate` or `endDate` through the `Date` constructor for display. Parse with an explicit timezone or use the string directly for date-only display.

---

#### No Migration Required

The database stores these dates as midnight UTC and that has not changed. No migration scripts, no backfill, no schema update.

---

#### Files Changed

| File | Change |
|---|---|
| `src/controllers/Features/userShiftController.js` | `assignedDate.toISOString()` → `.toISOString().slice(0, 10)` in `getUserShifts`, `getEmployeeShifts`, `getBulkEmployeeShifts` |
| `src/controllers/Features/leaveController.js` | `_format()` helper: `startDate` and `endDate` → `.toISOString().slice(0, 10)`; `submitLeaveRequest` response now goes through `_format()` |

---

### 2. Punch Log Endpoints Missing Shift Info (`shiftName`, `userShifts`)

> **Affects:** Web client, Mobile client (Punch Logs view — employee and admin)
> **Breaking:** No — additive fields only; existing response shape is unchanged

---

#### The Bug

Two punch log endpoints returned no shift information alongside time log records, making it impossible for the client to determine whether an employee had a scheduled shift for that punch or to display schedule details in the log dialog.

- `GET /api/timelogs` (employee view) — no `shiftName` field at all; the client's `isScheduled` badge always evaluated to `false`
- `GET /api/timelogs/company` (admin view) — `shiftToday` was already present, but a second issue existed: when an employee had multiple shifts assigned on the same day (e.g. Regular + Driver PM), the server's `shiftMap` was keyed by `userId` with a plain assignment, causing the last-written shift to silently overwrite all others. Only "Regular Shift" ever appeared because it was consistently last.

A third bug compounded the multi-shift issue: the deduplication guard compared `UserShift.id` values, but the duplicates were **different UserShift records pointing to the same `Shift` definition**. The correct key is `shift.id`.

---

#### The Fix

**`GET /api/timelogs` (employee view)**

After the paginated `TimeLog` query resolves, a single batch `UserShift.findMany` covers the full date range of the page (one extra query regardless of page size). Each log is matched to its shift via a date key derived from `timeIn` in company timezone, matched against `assignedDate.toISOString().slice(0, 10)`.

New field added to each log in the response:

```json
"shiftName": "Regular Shift"
```

`null` when the employee has no schedule for that day.

**`GET /api/timelogs/company` (admin view)**

The existing batch `UserShift.findMany` already fetched the full `Shift` record via `include: { shift: true }` — it was just discarding everything except `shiftName`. Three fixes applied:

1. **Multi-shift support** — `shiftMap` now accumulates an array per `userId` instead of overwriting. `shiftToday` joins all shift names (e.g. `"Regular Shift, Driver Aide PM"`). Two new fields are added per row:

```json
"userShifts": [
  {
    "id": "<userShiftId>",
    "assignedDate": "2026-04-22",
    "shift": {
      "id": "<shiftId>",
      "shiftName": "Regular Shift",
      "startTime": "1970-01-01T08:00:00.000Z",
      "endTime":   "1970-01-01T17:00:00.000Z"
    }
  }
],
"userShift": { /* same as userShifts[0], kept for backwards compat */ }
```

`userShifts` is the authoritative field. Use it in the schedule details dialog — pick the entry whose `shift.shiftName` matches the log's `punchType` label for the richest label (e.g. `"Mon Apr 21 · 8:32 AM · Driver PM"`).

2. **Dedup keyed on `shift.id`** — The guard now skips a UserShift record if `shift.id` already appears in the array for that user. This correctly collapses duplicate UserShift rows that point to the same Shift definition.

3. **`shift.id` included in payload** — Added to the `shift` sub-object so client and server dedup logic key on the same value.

---

#### Performance Improvement (`GET /api/timelogs/company`)

The admin endpoint had two inefficiencies that became noticeable at larger record sets (500+ logs):

**Query round-trips reduced from 4 → 2:**

| Before | After |
|---|---|
| Round 1: `findMany` + `count` (parallel) | Round 1: `findMany` + `count` + summary (all parallel) |
| Round 2: `activeCount` + `completedCount` + `totalHours` (parallel) | Round 2: `userShift.findMany` |
| Round 3: `userShift.findMany` | — |

The three summary queries (`activeCount`, `completedCount`, `totalHours`) were independent of the `findMany` result but ran in a separate `Promise.all` after it. They are now merged into a single raw SQL query using `FILTER` aggregates and run in the same parallel batch as the main query.

**Data transfer reduced on user join:**

`include: { user: { include: { profile, department, presence, employmentDetail } } }` was replaced with a `select` that fetches only the 7 fields actually used (`id`, `email`, `employeeId`, `profile.firstName`, `profile.lastName`, `department.name`, `presence.presenceStatus`, `employmentDetail.jobTitle`). At 500+ rows this meaningfully reduces the payload returned from the DB.

---

#### Client-Side Changes Required

**Employee Punch Logs (`GET /api/timelogs`)**

`shiftName` is now populated server-side. The existing client fix `isScheduled: !!(t.shiftName)` will work automatically — no further changes needed.

**Admin Punch Logs (`GET /api/timelogs/company`)**

- Use `userShifts[]` (array) for the schedule details dialog. Pick the entry matching the log's `punchType`.
- `shiftToday` now returns a comma-joined string when multiple shifts exist (e.g. `"Regular Shift, Driver Aide PM"`) — update any display logic that assumed a single name.
- `userShift` (singular) is kept for backwards compat but equals `userShifts[0]` — prefer `userShifts`.
- Client-side dedup guard should key on `shift.id` (not `userShift.id`) — consistent with the server fix.

---

#### Files Changed

| File | Change |
|---|---|
| `src/controllers/Features/timeLogController.js` | `getUserTimeLogs`: batch UserShift lookup added, `shiftName` field added to response |
| `src/controllers/Features/timeLogController.js` | `getCompanyTimeLogs`: multi-shift `userShifts[]` support, `shift.id`-keyed dedup, `userShift` + `userShifts` fields added; `include` → `select` on user; summary queries collapsed into single raw SQL; all independent queries merged into one `Promise.all` |

---

### 3. Coffee Break Fields Silently Ignored on Department Update

> **Affects:** Web client (Company Configurations — Department Coffee Break Policy card)
> **Breaking:** No — additive fix; no response shape changes

---

#### The Bug

`PUT /api/departments/update/:id` only destructured and processed five fields from the request body: `name`, `supervisorId`, `paidBreak`, `autoLunchDurationMinutes`, and `autoLunchAfterHours`. The three coffee break policy fields — `coffeeBreakMaxCount`, `coffeeBreakMinutes`, and `coffeeBreakPaid` — were silently discarded. The client sent them but the server never wrote them to the database, making the Department Coffee Break Policy card appear to save while actually doing nothing.

---

#### The Fix

All three coffee break fields are now destructured, validated, and applied to `updateData`:

| Field | Validation |
|---|---|
| `coffeeBreakMaxCount` | Integer, 0–5 |
| `coffeeBreakMinutes` | Integer, 0–30 |
| `coffeeBreakPaid` | Boolean |

No schema migration required — the columns already existed on the `Department` table.

---

#### Client-Side Changes Required

None. The existing client payload is correct. The save will now persist as expected.

---

#### Files Changed

| File | Change |
|---|---|
| `src/controllers/Account/departmentController.js` | `coffeeBreakMaxCount`, `coffeeBreakMinutes`, `coffeeBreakPaid` added to destructure + `updateData` handling in `updateDepartment` |

---

## New Features

### 4. OT Threshold Enforcement — Daily / Weekly / Cutoff Basis

> **Affects:** Web client, Mobile client
> **Breaking:** Yes — `POST /api/overtime/submit` now rejects requests when accumulated hours have not reached the configured threshold

---

#### Background

Previously the OT submission endpoint accepted any request with `requestedHours > 0` regardless of how many hours the employee had actually worked. The company's `otBasis`, `dailyOtThresholdHours`, `weeklyOtThresholdHours`, and `cutoffOtThresholdHours` settings were stored but never enforced at submission time.

This change makes those settings authoritative: OT can only be submitted once the employee's accumulated worked hours for the period exceed the configured threshold.

---

#### How Each Basis Works

| Basis | Accumulation Window | Threshold Field |
|---|---|---|
| `daily` | Calendar day (company timezone) | `dailyOtThresholdHours` (default 8h) |
| `weekly` | Monday → Sunday (company timezone) | `weeklyOtThresholdHours` (default 40h) |
| `cutoff` | Active cutoff period derived from `CompanyCutoffSettings` | `cutoffOtThresholdHours` (default 80h) |

Hours are summed from `TimeLog.netWorkedHours` across all **completed** logs in the window. Already-submitted (pending or approved) OT within the same period is deducted from the eligible pool to prevent double-claiming.

---

#### New: `CompanyCutoffSettings`

A new company-level record that defines the cutoff cadence. Required when `otBasis = "cutoff"`.

Admin provides a start date and end date for the first period. The system derives `durationDays` and automatically computes which period today falls into — no manual creation of future periods needed.

```
First period:  Apr 1 → Apr 14   →  durationDays = 14  (bi-weekly)
Next period:   Apr 15 → Apr 28  (auto-derived)
Next period:   Apr 29 → May 12  (auto-derived)
```

The same `CompanyCutoffSettings` record also serves as the template for the Employee Cutoff Period module (report finalization) — one definition, shared across both features.

---

#### New Endpoint: `GET /api/overtime/threshold-status`

Call this before showing the OT submission form. Returns whether the employee is eligible and which logs they can choose from.

**Auth:** employee, admin, supervisor, superadmin

**Response (200):**
```json
{
  "data": {
    "basis": "weekly",
    "threshold": 40,
    "periodStart": "2026-04-14",
    "periodEnd": "2026-04-20",
    "accumulatedHours": 43.5,
    "alreadySubmittedHours": 1.0,
    "otEligibleHours": 2.5,
    "eligible": true,
    "logs": [
      {
        "timeLogId": "...",
        "date": "2026-04-14",
        "timeIn": "2026-04-14T15:00:00.000Z",
        "timeOut": "2026-04-14T23:30:00.000Z",
        "netWorkedHours": 8.5,
        "punchType": "REGULAR"
      }
    ]
  }
}
```

When `otBasis = "cutoff"` and no `CompanyCutoffSettings` exists, returns `400` with a message directing the admin to configure it first.

---

#### Updated: `POST /api/overtime/submit` — New Gate

Two new rejection cases (both return `400`):

**Not yet eligible:**
```json
{
  "message": "Accumulated hours (6.5h) have not reached the weekly OT threshold (40h).",
  "data": { "accumulatedHours": 6.5, "threshold": 40, "basis": "weekly" }
}
```

**Requested hours exceed available excess:**
```json
{
  "message": "Requested hours (5h) exceed the available OT excess (2.5h).",
  "data": { "otEligibleHours": 2.5 }
}
```

No change to the request body shape. Existing fields (`timeLogId`, `approverId`, `requestedHours`, `requesterReason`) are unchanged. The employee still selects which specific `timeLogId` to attach the OT request to — the system validates eligibility but leaves the log selection to the employee (relevant for multi-shift days and Driver PM vs Regular OT).

---

#### Updated: `GET /api/company-settings` and `PATCH /api/company-settings`

Both endpoints now include `cutoffSettings` in the response:

```json
{
  "cutoffSettings": {
    "seedStartDate": "2026-04-01",
    "durationDays": 14,
    "paymentOffsetDays": 5
  }
}
```

`null` when not yet configured.

**To configure via PATCH:**
```json
{
  "cutoffSettings": {
    "seedStartDate": "2026-04-01",
    "durationDays": 14,
    "paymentOffsetDays": 5
  }
}
```

Or derive `durationDays` client-side from two date pickers:
```ts
const durationDays = differenceInDays(endDate, startDate) + 1;
```

---

#### Client-Side Changes Required

**1. Call `GET /api/overtime/threshold-status` before rendering the OT form**

Use `eligible` to show or hide the OT submit button. Use `otEligibleHours` to cap the `requestedHours` input. Use `logs[]` to populate the timeLog picker so the employee can select which shift to attach the OT to.

```ts
const { eligible, otEligibleHours, logs, periodStart, periodEnd, accumulatedHours, threshold } = status.data;

if (!eligible) {
  // show: "You have worked X of Y hours needed for OT this period"
} else {
  // show OT form, pre-fill requestedHours = otEligibleHours, show log picker
}
```

**2. Company Settings page — add Cutoff Configuration section**

Show only when `otBasis = "cutoff"`. Two date pickers: first period start + first period end. Derive and send `durationDays`:

```ts
// When admin saves
const durationDays = differenceInDays(periodEnd, periodStart) + 1;
await patchCompanySettings({ cutoffSettings: { seedStartDate, durationDays } });
```

Display the derived cadence label for confirmation:
```ts
const label = durationDays === 7  ? "Weekly"
            : durationDays === 14 ? "Bi-weekly"
            : durationDays === 15 ? "Semi-monthly"
            : durationDays >= 28  ? "Monthly"
            : `Every ${durationDays} days`;
```

**3. Handle new 400 errors from `POST /api/overtime/submit`**

Previously this endpoint only failed for missing fields. Now it can also return threshold-related 400s — surface these to the employee with the message from `response.message`.

**Mobile:** Same changes apply. The `threshold-status` endpoint is the source of truth for whether the OT button is shown.

---

#### Migration

```bash
psql $DATABASE_URL -f scripts/migrate-company-cutoff-settings.sql
npx prisma generate
```

No data backfill required. Companies without a `CompanyCutoffSettings` record will simply have `cutoffSettings: null` in the settings response. The threshold gate only blocks submissions when `otBasis = "cutoff"` and the record is missing — daily and weekly basis are unaffected.

---

#### Files Changed

| File | Change |
|---|---|
| `src/prisma/schema.prisma` | New `CompanyCutoffSettings` model + relation on `Company` |
| `scripts/migrate-company-cutoff-settings.sql` | SQL migration *(new)* |
| `src/controllers/Account/companySettingsController.js` | GET includes `cutoffSettings`; PATCH upserts `CompanyCutoffSettings` |
| `src/controllers/Features/overtimeController.js` | `computeOtEligibility` helper + `getThresholdStatus` function + threshold gate in `submitOvertime` |
| `src/routes/Features/overtimeRoutes.js` | `GET /threshold-status` route added |

---

---

### 5. Auto-Break Policy — Auto-Lunch and Auto-Coffee Injection at Clock-Out

> **Affects:** Web client (Company Configurations — new Auto-Break Policy section, Department Break Policy, Shift Management, TimeLog detail views)
> **Breaking:** No — additive feature; existing break behavior is unchanged for companies that do not configure it

---

#### Background

Some companies are required to submit timekeeping records that include break entries for all employees — even when the employee did not manually log a break. This feature allows a company to configure automatic injection of lunch and/or coffee break records into the TimeLog at clock-out time, serving as a paper trail. Whether the injected break reduces payable hours is a separate, configurable flag per department or shift.

This feature coexists with the existing manual break policy (`paidBreak`, `coffeeBreakMaxCount`, etc.) — those fields continue to govern payable-hour deduction enforcement at cutoff processing time and are not replaced.

---

#### How It Works

The company enables auto-break at the company level and selects a **basis** — either `department` or `shift` (mutually exclusive). Individual departments or shifts are then configured with their own break settings and marked as entitled.

At clock-out, before the compute service runs:
1. The server checks whether the company has auto-break configured
2. Resolves the employee's department or assigned shift for the day
3. If entitled and no manual break was taken, injects the break record into `lunchBreak` / `coffeeBreaks` on the TimeLog with an `auto: true` marker
4. If the break is configured as deductible, sets `autoLunchDeductionMinutes` so the compute service deducts correctly
5. Non-deductible injected breaks are skipped entirely by the compute service — paper trail only, zero pay impact

---

#### Company-Level Config (3 fields only)

Saved via `PATCH /api/company-settings`. Returned by `GET /api/company-settings`.

| Field | Type | Description |
|---|---|---|
| `autoBreakBasis` | `"department"` \| `"shift"` \| `null` | Active basis. `null` = feature disabled |
| `autoLunchEnabled` | Boolean | Master toggle for auto-lunch injection |
| `autoCoffeeEnabled` | Boolean | Master toggle for auto-coffee injection |

---

#### Per-Department Config (when `autoBreakBasis = "department"`)

Saved via `PUT /api/departments/update/:id`. Returned by `GET /api/departments`.

| Field | Type | Description |
|---|---|---|
| `autoLunchEntitled` | Boolean | Whether this department gets auto-lunch injected |
| `autoBreakLunchMinutes` | Int | Injected lunch duration in minutes |
| `autoBreakLunchAfterHours` | Float | Hours after clock-in to place the lunch start |
| `autoBreakLunchDeductible` | Boolean | Whether the injected lunch reduces payable hours |
| `autoCoffeeEntitled` | Boolean | Whether this department gets auto-coffee injected |
| `autoBreakCoffeeMinutes` | Int | Duration per injected coffee break in minutes |
| `autoBreakCoffeeCount` | Int | Number of coffee breaks to inject (evenly spaced across shift) |
| `autoBreakCoffeeDeductible` | Boolean | Whether the injected coffee reduces payable hours |

---

#### Per-Shift Config (when `autoBreakBasis = "shift"`)

Same 8 fields as above, saved via `PUT /api/shifts/:id`. Returned by `GET /api/shifts`.

This allows Shift A to have 30-minute non-deductible lunch while Shift B has 60-minute deductible lunch — fully independent per shift.

---

#### TimeLog Changes

Two new audit fields on `TimeLog`:

| Field | Type | Description |
|---|---|---|
| `autoLunchApplied` | Boolean | `true` when lunch was system-injected at clock-out |
| `autoCoffeeApplied` | Boolean | `true` when coffee breaks were system-injected at clock-out |

Injected break entries in `lunchBreak` and `coffeeBreaks` JSON include:
```json
{ "start": "...", "end": "...", "auto": true, "deductible": false }
```

---

#### Compute Service Awareness

`timeLogComputeService.js` is updated to respect injected breaks:

- **Auto-lunch, deductible** — `autoLunchDeductionMinutes` is set at injection; compute uses it directly
- **Auto-lunch, non-deductible** — `autoLunchApplied = true` with no `autoLunchDeductionMinutes`; compute applies zero lunch deduction
- **Auto-coffee, deductible** — `deductible: true` on each injected entry; included in coffee sum
- **Auto-coffee, non-deductible** — `deductible: false` on each injected entry; excluded from coffee sum

---

#### Client-Side Changes Required

**Company Settings — new "Auto-Break Policy" card**

- Basis selector: `Department` / `Shift` (radio or segmented control), wired to `autoBreakBasis`
- `autoLunchEnabled` toggle and `autoCoffeeEnabled` toggle
- All three fields saved with the existing global Save Settings button (`PATCH /api/company-settings`)
- Hide/disable the card when both toggles are off

**Department Break Policy card — new entitlement section**

Only render when `autoBreakBasis === "department"`:
- Per department row: entitlement toggles + duration, after-hours, deductible, count inputs for each break type
- Each field fires `PUT /api/departments/update/:id` instantly on change
- Use namespaced loading keys: `departmentLoading["autolunch_${id}"]`, `departmentLoading["autocoffee_${id}"]`
- State map: `departmentAutoBreakEntitlement` keyed by `dept.id`, populated from existing `GET /api/departments` call

**Shift Management — new entitlement section**

Only render when `autoBreakBasis === "shift"`:
- Per shift: same 8 fields, saved via `PUT /api/shifts/:id` on change
- State map: `shiftAutoBreakEntitlement` keyed by `shift.id`, populated from `GET /api/shifts`

**TimeLog detail views**

When `autoLunchApplied` or `autoCoffeeApplied` is `true`, or a break entry contains `"auto": true`, display an "Auto-injected" label on the break entry to distinguish it from employee-recorded breaks.

**No changes required at clock-out** — injection is fully server-side. The clock-out response already includes the injected break data.

---

#### Migration

```bash
# Run both scripts in order, then regenerate the client
psql $DATABASE_URL -f scripts/migrate-auto-break-policies.sql
psql $DATABASE_URL -f scripts/migrate-auto-break-per-dept-shift.sql
npx prisma generate
```

---

#### Files Changed

| File | Change |
|---|---|
| `src/prisma/schema.prisma` | `Company`: 3 auto-break fields; `Department` + `Shift`: 8 auto-break fields each; `TimeLog`: `autoLunchApplied`, `autoCoffeeApplied` |
| `scripts/migrate-auto-break-policies.sql` | SQL migration for Company + TimeLog fields *(new)* |
| `scripts/migrate-auto-break-per-dept-shift.sql` | SQL migration for Department + Shift fields *(new)* |
| `src/services/autoBreakService.js` | New service — entitlement resolution + break injection logic |
| `src/services/timeLogComputeService.js` | `sumCoffeeBreakMinutes` respects `deductible` flag; lunch deduction skipped for non-deductible auto-lunch |
| `src/controllers/Features/timeLogController.js` | `applyAutoBreaks` wired at Phase 2.5 in `timeOut` (after persist, before compute) |
| `src/controllers/Account/companySettingsController.js` | GET + PATCH updated with 3 company-level auto-break fields |
| `src/controllers/Account/departmentController.js` | 8 auto-break entitlement + config fields added to `updateDepartment` |
| `src/controllers/Features/shiftController.js` | 8 auto-break entitlement + config fields added to `updateShift` |

---

*Generated by BizBuddy Backend Team — v2.7.4 — 2026-04-23*
