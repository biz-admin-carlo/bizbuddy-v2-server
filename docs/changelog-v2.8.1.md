# Changelog — v2.8.1

## Summary

Four fixes across the cutoff period system, plus one new feature. The auto-generation job now supports **company-wide (No Department) cutoff periods** by making `departmentId` nullable in `DepartmentCutoffSettings`. The generation strategy was revised from a 3-month batch buffer to a **one-period-at-a-time, carry-span approach** so each new period inherits its length from the previous one. A boundary fix ensures the **Sync Records button** includes shifts that clock in on the last day of a period. Two client-side fixes correct the **OT block display**: a date key timezone mismatch that prevented OT rows from injecting into the table, and a missing response-body read that caused approved/snapped times to not reflect without a full page reload. Finally, **`GET /api/timelogs` now includes OT blocks and `dailyOtThresholdHours`** in the response envelope for BNC companies, enabling punch log exports to include OT aggregate rows without a second API call.

---

## Ticket 1 — Cutoff Period Auto-Generation Fix

### Problem

The nightly auto-generation job only iterated over `DepartmentCutoffSettings` records, and `departmentId` was non-nullable (`String @unique`). This made it impossible to configure a company-wide setting, so "No Department" cutoff periods were never auto-generated.

Additionally, the job used a 3-month batch strategy: whenever a department dropped below 2 open future periods, it generated 3 months ahead using the original `startDate` anchor (Option B). This meant manually adjusted periods never carried their span forward.

### Changes

#### `src/prisma/schema.prisma`

- `DepartmentCutoffSettings.departmentId` changed from `String @unique` to `String?` — `null` represents a company-wide setting.
- Unique constraint changed from `@unique` on `departmentId` alone to `@@unique([companyId, departmentId])`.
- `department` relation changed to `Department?` with `onDelete: Cascade` (deleting a department still removes its settings; `null` departmentId rows are intentional and unaffected).
- `Department.cutoffSettings` back-relation changed from `DepartmentCutoffSettings?` to `DepartmentCutoffSettings[]` — required by Prisma once `departmentId` is no longer a single-field unique.

#### `src/jobs/autoGenerateCutoffPeriodsJob.js`

Full rewrite. Key behavioral changes:

- **One period at a time** — instead of generating 3 months in a batch, the job creates exactly one next period per department per run.
- **Option A (carry span)** — `newPeriodEnd` is calculated as `newPeriodStart + (latestPeriodEnd − latestPeriodStart)`, carrying the actual duration of the previous period forward. The original `startDate` anchor is no longer used.
- **Trigger condition** — generates only when the latest period's `periodEnd` is within `LOOKAHEAD_DAYS` (3) days of today, rather than when the open-period buffer drops below 2.
- **Existence check** — checks whether a period starting on `latestPeriodEnd + 1` already exists, and skips if so.
- **UTC-safe date arithmetic** — all date operations use `setUTCDate` / `setUTCHours` to avoid local-timezone day-boundary shifts (relevant for servers running in non-UTC timezones such as UTC+8).
- **Null department safety** — `settings.department?.name ?? "No Department"` used throughout so null-department settings don't throw.

#### `src/controllers/Cutoff/cutoffSettingsController.js`

- `saveDepartmentSettings` — `departmentId` is no longer required. If omitted, the setting is treated as company-wide (`departmentId = null`). Department existence check is skipped for null. Upsert `where` clause updated to use the compound key `{ companyId_departmentId: { companyId, departmentId } }`.
- `getDepartmentSetting`, `deactivateDepartmentSettings`, `previewDepartmentCutoffs` — all switched from `findUnique({ where: { departmentId } })` to `findFirst({ where: { companyId, departmentId: departmentId || null } })` since `departmentId` is no longer a standalone unique field.
- All `setting.department.name` and `setting.department.users.length` accesses guarded with optional chaining.

#### `src/services/Cutoff/cutoffGenerationService.js` and `src/controllers/Cutoff/cutoffGenerationService.js`

- `findUnique({ where: { departmentId } })` replaced with `findFirst({ where: { companyId, departmentId: departmentId ?? null } })` in both files.

### Migration

`scripts/migrate-dept-cutoff-settings-nullable-dept.sql`

- Drops the `@unique` constraint on `departmentId`.
- Makes `departmentId` nullable (`DROP NOT NULL`).
- Recreates the FK with `ON DELETE CASCADE`.
- Adds compound unique index on `(companyId, departmentId)`.
- Adds partial unique index on `(companyId) WHERE departmentId IS NULL` — prevents duplicate company-wide settings since PostgreSQL unique constraints do not treat `NULL = NULL`.

---

## Ticket 2 — Sync Records Button Fix

### Problem

The Sync Records button (`syncApprovalRecords`) was not picking up time logs where `timeIn` fell on the last day of the cutoff period. `periodEnd` is stored as a `Timestamptz` at UTC midnight (e.g., `2026-05-03T00:00:00Z`), so the original query condition `timeIn <= periodEnd` excluded any shift that clocked in after midnight UTC on the final day.

Two separate boundary issues were identified:

**Issue A — UTC midnight boundary (original fix)**
Shifts whose `timeIn` falls between `T00:00:01Z` and `T23:59:59Z` on the `periodEnd` UTC date were excluded. Fixed by extending `periodEnd` to `T23:59:59.999Z` before the query.

**Issue B — Cross-timezone midnight (follow-up fix)**
The company operates in California (PDT, UTC−7). A shift starting at 10 PM PDT on the last local day has a UTC timestamp on the *following* UTC date (e.g., 10 PM PDT May 3 = `2026-05-04T05:00Z`). Extending `periodEnd` to UTC end-of-day (`2026-05-03T23:59:59Z`) still misses this shift. The only correct boundary is end-of-day in the **company's local timezone**.

### Changes

#### `src/controllers/Features/cutoffPeriodController.js` — `syncApprovalRecords`

`syncApprovalRecords` now accepts a `companyTimezone` parameter. `periodEndEOD` is computed as end-of-day on the `periodEnd` calendar date interpreted in the company's timezone using `moment.tz`. The stored `periodEnd` value in the database is not modified.

```js
// Before
timeIn: { gte: periodStart, lte: periodEnd }

// After
const endDateStr   = new Date(periodEnd).toISOString().slice(0, 10); // "2026-05-03"
const periodEndEOD = moment.tz(endDateStr, companyTimezone).endOf("day").toDate();
// e.g., for PDT (UTC−7): 2026-05-03T23:59:59.999−07:00 = 2026-05-04T06:59:59.999Z
timeIn: { gte: periodStart, lte: periodEndEOD }
```

**Why `moment.tz` and not `setUTCHours`:**
`setUTCHours(23,59,59,999)` stops at `2026-05-03T23:59:59Z` = 4:59 PM PDT — still 7 hours short of local midnight. `moment.tz(...).endOf("day")` correctly anchors to the end of May 3 in the company's local timezone regardless of the server's own timezone.

`companyTimezone` is now fetched before the auto-sync call in `getCutoffApprovals`, and fetched inside `syncCutoffApprovals` (the manual Sync button handler) before delegating to `syncApprovalRecords`.

#### Data fix — one affected record

One existing `TimeLogApproval` for `rmacatangay` had been auto-assigned to the May 4–17 period (because its `timeIn` UTC timestamp was `2026-05-04T05:00:18Z`), even though the shift started May 3 at 10 PM local. Its `cutoffPeriodId` was updated directly to the April 20–May 3 period.

---

## Ticket 3 — OT Block Display Fix (Client-Side)

### Problem

OT blocks were being created correctly in the database but never appeared in the cutoff review UI. Investigation confirmed two separate client-side bugs.

### Bug 1 — Date key timezone mismatch

**File:** `EmployeeCard` component, `otBlockByDate` memo

`block.date` comes from the API as a date-only string (e.g., `"2026-04-22"`). The client was parsing it with `new Date("2026-04-22")`, which JavaScript treats as UTC midnight (`2026-04-22T00:00:00.000Z`). For B&C companies in US timezones (UTC-4 to UTC-8), UTC midnight is the previous calendar day locally — so the formatted key became `"Apr 21"` instead of `"Apr 22"`.

Meanwhile `recDate` (the key used to look up the block per row) is derived from the actual `timeIn` ISO timestamp formatted in `companyTimezone` — correctly `"Apr 22"`. The keys never matched, so `otBlockByDate[recDate]` always returned `undefined` and the OT row was never injected.

**Fix:** Parse `block.date` using UTC noon to avoid the midnight boundary shift in any timezone.

```js
// Before
const formatted = new Date(block.date).toLocaleDateString("en-US", {
  month: "short", day: "numeric", timeZone: companyTimezone || "UTC"
});

// After
const [y, m, d] = block.date.slice(0, 10).split("-").map(Number);
const safeDate  = new Date(Date.UTC(y, m - 1, d, 12)); // noon UTC — won't cross midnight in any timezone
const formatted = safeDate.toLocaleDateString("en-US", {
  month: "short", day: "numeric", timeZone: companyTimezone
});
```

### Bug 2 — Approved times not reflected after Schedule approval

**File:** `doApprove` handler in the cutoff review page

`doApprove` fired the `PATCH /api/cutoff-periods/:id/approvals/:approvalId` request, received a 200, showed an "Approved" toast, and discarded the response body entirely. The displayed `timeIn`/`timeOut` on the row were whatever was baked in from the initial page load via `buildDetails`.

When "Approve Schedule" snapped the clock-in to the shift start, the snapped times were never reflected in the UI without a full page reload.

**Fix:** Read `approvedClockIn` and `approvedClockOut` from the PATCH response body (`response.data`) and patch the local approval state so the row re-renders immediately with the correct times. No backend changes required — the server already returns the full updated approval record including both fields.

---

## Ticket 4 — OT Blocks in GET /api/timelogs (BNC)

### Problem

OT blocks for BNC companies were only available from `GET /api/cutoff-periods/:cutoffId/approvals`, which is scoped to a specific cutoff period. The punch logs page (`GET /api/timelogs`) has no cutoff period context — it is date-range filtered. This meant punch log exports for BNC companies had no way to include OT aggregate rows without a second, separately-scoped API call.

### Changes

#### `src/controllers/Features/timeLogController.js` — `getCompanyTimeLogs`

Two additions, both gated behind `isBnC` so non-BNC companies are completely unaffected:

**1. `dailyOtThresholdHours` added to the company select**

The company record was already fetched for `timeZone`. `dailyOtThresholdHours` is now fetched in the same query and included in the response envelope for BNC companies. The field is company-wide (stored on the `Company` model) — not per-employee.

**2. OT block query scoped to the queried date range**

After the main parallel query block, a `cutoffOtBlock.findMany` runs for BNC companies. It filters by:
- `cutoffPeriod: { companyId }` — tenant isolation via the period relation
- `date` range matching the same `from`/`to` params already in use
- `userId` and `departmentId` filters, if provided as query params

`date` (a `@db.Date` column) is serialized as `"YYYY-MM-DD"` via `.toISOString().slice(0, 10)`. `otHours` is passed through `parseFloat()`. All statuses (`"pending"`, `"approved"`, `"excluded"`) are returned — the client filters to `"approved"` for export purposes.

**Response envelope for BNC companies:**

```json
{
  "companyType": "BNC",
  "dailyOtThresholdHours": 8,
  "otBlocks": [
    {
      "id": "...",
      "userId": "...",
      "date": "2026-04-24",
      "otHours": 4,
      "status": "approved",
      "approvedAt": "2026-04-25T10:00:00.000Z",
      "notes": null
    }
  ],
  "data": [ ...punch records... ],
  "pagination": { ... },
  "summary": { ... }
}
```

`dailyOtThresholdHours` and `otBlocks` are absent from the response entirely for non-BNC companies — not `null`, not `[]`, just not present.

### Not yet implemented

`GET /api/timelogs/user` (employee self-view) does not yet include OT blocks. It follows the same structural pattern and can be updated once the admin endpoint is validated.
