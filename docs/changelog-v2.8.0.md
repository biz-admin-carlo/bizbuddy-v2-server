# Changelog — v2.8.0

## Summary

This release completes the cutoff approval refactor started in v2.7.7. The controller is now a thin dispatcher that routes each company to its own strategy. B&C gets a **four-button approval model** (Approve Schedule, Approve Raw, Edit, Reject), **automatic daily OT blocks**, and a **per-punch Reset** button. DayCare approval logic is extracted into its own strategy file and gains a new **Training punch type** — when tagged, the system credits the employee a flat `Company.defaultShiftHours` for both scheduled and actual hours, bypassing all shift-snap logic. A nightly cron job now auto-generates cutoff periods so departments never run out. A separate serialization fix ensures `ShiftSchedule` dates come back as `"YYYY-MM-DD"` strings instead of full ISO timestamps.

---

## New Files

### `src/services/Cutoff/bncCutoffStrategy.js`

Cutoff approval strategy for B&C companies. Handles all three approval paths:

- **`schedule`** — snaps clock-in to shift start within grace period, caps clock-out at shift end, recomputes hours. `shiftId` required.
- **`raw`** — no time modification; recomputes hours on actual punch times.
- **`edit`** — overwrites punch times with admin-supplied `editedClockIn` / `editedClockOut`, recomputes hours.
- **`exclude` / `reject`** — marks record as excluded.

All three approve paths fire a fire-and-forget OT recompute (`recomputeOtForTimeLog`) after each commit. Conflict resolution (honor punch) uses raw approval and cancels the overlapping leave with credit return. `rawOtMinutes` is always `null` — OT is a day-level aggregate, not per-punch.

### `src/services/Cutoff/daycareCutoffStrategy.js`

DayCare cutoff approval logic extracted from the controller — unchanged behavior, now isolated. Exports `approveSingle`, `approveBulk`, `resolveConflict`, and `StrategyError`. Frozen: changes here affect DayCare only; new company types get their own strategy file.

### `src/services/Cutoff/cutoffOtService.js`

Computes and persists `CutoffOtBlock` records for B&C. Three exports:

- **`computeOtForEmployeeDay(cutoffPeriodId, userId, dateStr, companyId)`** — sums `actualHours` from all approved punches for a user on a calendar day; upserts a block if total exceeds `dailyOtThresholdHours`, deletes it if the total drops to/below threshold.
- **`recomputeOtForTimeLog(timeLogId, cutoffPeriodId, companyId)`** — derives the employee and date from a single `TimeLog`, then calls `computeOtForEmployeeDay`. Called after single-punch approval or reset.
- **`recomputeAllOtForCutoff(cutoffPeriodId, companyId)`** — scans all approved punches in a cutoff, deduplicates to unique `userId + date` pairs, and recomputes each. Called after bulk approve.

Block status resets to `"pending"` whenever `otHours` changes — the admin must re-approve if a punch edit alters the OT amount. Only `"daily"` OT basis is implemented; other bases are no-ops.

### `src/jobs/autoGenerateCutoffPeriodsJob.js`

Nightly cron job (2:00 AM) that ensures each active `DepartmentCutoffSettings` always has at least **2 open future cutoff periods**. For any department below that floor, generates 3 months ahead using the existing `generatePeriodDates` helper. Deduplicates against existing periods by `periodStart`. Uses the company's first admin as `createdBy` (non-nullable schema field). Errors on individual departments are caught and logged without aborting the rest of the run.

---

## Modified Files

### `src/prisma/schema.prisma`

**`TRAINING` added to `PunchType` enum** (DayCare only):

```prisma
enum PunchType {
  REGULAR
  DRIVER_AIDE_AM
  DRIVER_AIDE_PM
  DRIVER_AIDE
  TRAINING
}
```

Applied via `ALTER TYPE "PunchType" ADD VALUE 'TRAINING'` directly on the DB + `prisma generate`.

---

New **`CutoffOtBlock`** model:

```prisma
model CutoffOtBlock {
  id             String    @id @default(cuid())
  cutoffPeriodId String
  userId         String
  date           DateTime  @db.Date
  otHours        Decimal   @db.Decimal(6, 2)
  status         String    @default("pending") // "pending" | "approved" | "excluded"
  approvedBy     String?
  approvedAt     DateTime? @db.Timestamptz(6)
  notes          String?

  cutoffPeriod   CutoffPeriod @relation(...)
  user           User         @relation("OtBlockUser", ...)
  approver       User?        @relation("OtBlockApprover", ...)

  @@unique([cutoffPeriodId, userId, date])
  @@index([cutoffPeriodId])
  @@index([userId])
}
```

Back-relations added to `User` (`otBlocks`, `approvedOtBlocks`) and `CutoffPeriod` (`otBlocks`). Schema pushed to DB.

---

### `src/controllers/Features/cutoffPeriodController.js`

Refactored from a monolithic approval handler to a **thin dispatcher**.

**`getApprovalStrategy(companyId)`** — returns `bncCutoffStrategy` for B&C companies, `daycareCutoffStrategy` for everything else. All approval handlers call this once and delegate.

**`getCutoffApprovals`** — response envelope extended:
- `isBNC: boolean` — client gate for four-button model and OT block UI
- `otBlocks: CutoffOtBlock[]` — always present; empty `[]` for DayCare
- `otBasis: string` — company OT basis (currently `"daily"`)
- `dailyOtThresholdHours: number` — threshold used to label OT block rows

For B&C, each approval record in `data[]` now includes `availableShifts` — shifts assigned to that employee on the punch date, formatted as `{ id, shiftName, startTime: "HH:mm", endTime: "HH:mm" }`.

**`approveOtBlock`** (new) — `PATCH /:id/ot-blocks/:otBlockId`. Accepts `{ action: "approve" | "exclude", notes? }`. Only acts on `"pending"` blocks; returns 400 if already approved or excluded.

**`resetApproval`** (new) — `PATCH /:id/approvals/:approvalId/reset`. Reverts a single approved punch to `"pending"`. Clears `actualHours`, `approvedClockIn`, `approvedClockOut`, `approvedBy`, `approvedAt`. Raw `timeIn` / `timeOut` on the `TimeLog` are never touched. Fires a fire-and-forget OT recompute so the day's OT block adjusts automatically. Only `"approved"` records can be reset; `"pending"` and `"excluded"` return 400. Blocked on `"locked"` and `"processed"` cutoff periods.

---

### `src/routes/Features/cutoffPeriodRoutes.js`

Two new routes registered (both before `/:id/approvals/:approvalId` to avoid route collision):

```
PATCH /api/cutoff-periods/:id/ot-blocks/:otBlockId
PATCH /api/cutoff-periods/:id/approvals/:approvalId/reset
```

Both require `admin | supervisor | superadmin`.

---

### `src/utils/cronScheduler.js`

Registered `autoGenerateCutoffPeriodsJob` as Job 6:

```js
cron.schedule('0 2 * * *', async () => {
  await autoGenerateCutoffPeriodsJob();
});
```

---

### `src/controllers/Features/timeLogController.js`

`"TRAINING"` added to both `VALID_PUNCH_TYPES` (array) and `VALID_PUNCH_TYPES_SET` (Set). The existing `PATCH /api/timelogs/:id/punch-type` endpoint now accepts `"TRAINING"` as a valid value.

`updatePunchType` now branches on punch type after saving:

- **`TRAINING`** — skips `computeTimeLogSummary`. Instead fetches `company.defaultShiftHours` and writes it directly to `netWorkedHours` (Duration) and `scheduledHours` (Period Hours) on the `TimeLog`. This ensures the punch list immediately reflects the flat credit rather than showing time-based computed values.
- **All other types** — runs `computeTimeLogSummary` as before to restore actual time-based values. This also handles the case where a punch is changed *from* Training back to Regular.

---

### `src/services/Cutoff/daycareCutoffStrategy.js`

**Training punch type support** added to both `approveSingle` and `approveBulk`.

When `punchType === "TRAINING"`, the strategy skips all shift resolution and snap logic and applies a flat credit:

- `scheduledHours` and `actualHours` are both set to `Company.defaultShiftHours` (falls back to `8` if unset)
- `approvedClockIn` / `approvedClockOut` are set from the raw punch times — the `TimeLog` record is never modified
- Company query expanded to include `defaultShiftHours`

Training is DayCare-only. The branch runs before `DRIVER_AIDE` in both functions, following the same early-return/continue pattern.

---

### `src/controllers/Features/shiftScheduleController.js`

**Bug fix:** `startDate` and `endDate` on `ShiftSchedule` records were being serialized as full ISO datetime strings (e.g. `"2025-01-15T00:00:00.000Z"`) instead of date-only strings.

Added `formatScheduleDates` helper using the already-imported `date-fns/format`. Applied at all four response points:

| Endpoint | Fix |
|---|---|
| `GET /api/shiftschedules` | `schedules.map(formatScheduleDates)` |
| `GET /api/shiftschedules/:id` | `...formatScheduleDates(schedule)` |
| `POST /api/shiftschedules/create` | `createdSchedules.map(formatScheduleDates)` |
| `PUT /api/shiftschedules/:id` | `formatScheduleDates(updatedSchedule)` (all 4 return paths) |

`startDate` and `endDate` now always come back as `"YYYY-MM-DD"` strings on all four endpoints.

---

## New API Endpoints

| Method | Path | Description |
|---|---|---|
| `PATCH` | `/api/cutoff-periods/:id/ot-blocks/:otBlockId` | Approve or exclude a B&C OT block |
| `PATCH` | `/api/cutoff-periods/:id/approvals/:approvalId/reset` | Reset an approved punch back to pending |

---

## API Contract Changes

See `docs/client-side-update-v2.8.0.md` for the full client-side contract. Key points:

- `GET /api/cutoff-periods/:id/approvals` now returns `isBNC`, `otBlocks`, `otBasis`, `dailyOtThresholdHours` in the envelope, and `availableShifts` per approval record for B&C companies.
- All four `ShiftSchedule` endpoints now return `startDate` / `endDate` as `"YYYY-MM-DD"` instead of full ISO timestamps.

---

## No Breaking Changes for DayCare Clients

DayCare approval behavior, response shapes, and compute logic are identical to v2.7.7 for existing punch types. The strategy extraction is a pure refactor — `daycareCutoffStrategy.js` is frozen code lifted from the controller, not rewritten logic.

The `TRAINING` punch type is additive only. Existing `REGULAR` and `DRIVER_AIDE` punches are unaffected. The new enum value is inert unless an admin explicitly tags a punch as Training.
