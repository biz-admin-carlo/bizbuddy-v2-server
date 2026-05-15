# Client-Side Update — v2.8.0

**Server version:** v2.8.x  
**Audience:** Frontend developer implementing the Time Log page and Employee Cutoff Review UI

---

## What's New

- `companyType` field on all time log responses — gates column visibility and feature flags
- Strategy-pattern split: B&C (`bncStrategy`) and DayCare run separate compute paths
- Four-button approval model on the Cutoff Review page (B&C only)
- OT blocks — automatic daily overtime rows, approvable separately (B&C only)
- Per-punch Reset button — reverts an approved punch to pending (all company types)
- `availableShifts` on approval records for the B&C shift picker
- `isBNC` flag on the cutoff approvals response envelope
- `"TRAINING"` punch type for DayCare — flat credit using company's Default Shift Hours, no shift-snap

---

## Part 1 — Time Log API Contract

### Overview

Both time log endpoints now return a `companyType` field in the response envelope. Use it to drive all column visibility and feature flags. Do not hardcode company IDs on the client.

```
"companyType": "BNC"     → B&C Residential LLC (California, multi-shift)
"companyType": "DAYCARE" → DayCare / Driver-Aide companies (default)
```

### Affected Endpoints

| Method | Path | Used by |
|---|---|---|
| `GET` | `/api/timelogs/user` | Employee — own time logs |
| `GET` | `/api/timelogs` | Admin — company-wide time logs |

### Response Envelope

```jsonc
{
  "message": "Time logs retrieved.",
  "companyType": "BNC",          // "BNC" | "DAYCARE"
  "data": [ /* time log rows */ ],
  "pagination": { "total": 146, "page": 1, "limit": 20, "totalPages": 8 },
  "summary": { "total": 146, "active": 0, "completed": 146, "totalHours": 1168.5 }
}
```

---

### Field Reference — Per Row (`data[]`)

#### Fields present for ALL company types

| Field | Type | Description |
|---|---|---|
| `id` | string | TimeLog ID |
| `userId` | string | User ID (admin endpoint only) |
| `employeeName` | string | Full name (admin endpoint only) |
| `employeeRole` | string \| null | Job title (admin endpoint only) |
| `employeeCode` | string \| null | Employee ID code (admin endpoint only) |
| `email` | string | Email (admin endpoint only) |
| `department` | string | Department name (admin endpoint only) |
| `timeIn` | ISO 8601 string | Clock-in time (UTC) |
| `timeOut` | ISO 8601 string \| null | Clock-out time (UTC), null if still active |
| `status` | `"active"` \| `"completed"` | Whether the employee is still clocked in |
| `punchType` | `"REGULAR"` \| `"DRIVER_AIDE_AM"` \| `"DRIVER_AIDE_PM"` \| `"DRIVER_AIDE"` \| `"TRAINING"` | Punch type |
| `netWorkedHours` | float \| null | Actual payable hours (gross minus all deductions) |
| `grossHours` | float \| null | Raw clock-out minus clock-in, no deductions |
| `scheduledHours` | float \| null | Duration of the matched shift window. `null` if no shift assigned |
| `lateHours` | float \| null | Hours late. `0` if within grace. `null` if no shift assigned |
| `undertimeHours` | float \| null | Hours short of shift end. `0` if within grace or clocked out late |
| `lunchDeductionMinutes` | int \| null | Minutes deducted for lunch |
| `totalBreakMinutes` | int \| null | Deductible coffee break minutes |
| `coffeeBreaks` | array | Raw coffee break entries `[{ start, end, auto, deductible }]` |
| `lunchBreak` | object \| null | Raw lunch break entry `{ start, end }` |
| `coffeeCount` | int | Number of coffee breaks taken |
| `lunchTaken` | boolean | Whether a completed lunch break exists |
| `deviceIn` | object \| null | Device info at clock-in |
| `deviceOut` | object \| null | Device info at clock-out |
| `locIn` | object \| null | Location at clock-in |
| `locOut` | object \| null | Location at clock-out |
| `autoClockOut` | boolean | Whether clock-out was triggered automatically |
| `autoClockOutAt` | ISO 8601 string \| null | When the auto clock-out fired |
| `remarks` | array | Admin remarks attached to this log |
| `presence` | string | Real-time presence status |
| `cutoffApproval` | object \| null | Most recent TimeLogApproval record for this punch |
| `shiftName` | string \| null | Shift name for this log's date **(user endpoint only)** |

---

#### Shift fields — admin endpoint only (`GET /api/timelogs`)

These three fields exist on every admin row but behave differently per `companyType`.

**`userShift`** — the shift this specific punch belongs to

| companyType | Value | How it's resolved |
|---|---|---|
| **BNC** | The one shift window that overlaps this punch's timeIn/timeOut | `matchShiftToWindow` runs per punch |
| **DAYCARE** | First shift assigned for the punch date | No window matching |

Use this field for the per-punch "Shift" label: `row.userShift?.shift?.shiftName ?? "—"`

```jsonc
// BNC example — same employee, same day, two punches each get their own matched shift
"userShift": { "shift": { "shiftName": "Morning 1", "startTime": "05:00:00", "endTime": "08:00:00" } }
"userShift": { "shift": { "shiftName": "Afternoon 3", "startTime": "14:00:00", "endTime": "18:00:00" } }
```

**`userShifts`** — ALL shifts assigned on the punch date

Array of all UserShift records for that employee on the punch date. Use for schedule detail modals or full day view — same array on every punch row for that employee+date.

**`shiftToday`** — shift name(s) as a display string / array

| companyType | Type | Value |
|---|---|---|
| **BNC** | `string[]` | All shift names for the punch date e.g. `["Morning 1", "Afternoon 3"]` |
| **DAYCARE** | `string` | All shift names joined e.g. `"Regular Shift, Driver AM Shift"` or `"—"` |

> Do not use `shiftToday` for the per-punch shift label on BNC — it returns all shifts for the day, not the one that matches the punch.

#### Which shift field to use

| UI element | Field |
|---|---|
| Per-punch "Shift" label / Employee Details panel | `userShift?.shift?.shiftName ?? "—"` |
| Schedule detail modal / full day view | `userShifts` |
| Column header shift names (DAYCARE joined display) | `shiftToday` |
| All shift names as chips/badges (BNC) | `shiftToday` (already `string[]`) |

---

#### Fields present for DAYCARE only — absent on BNC

These keys will not appear when `companyType === "BNC"`. Guard with optional chaining before rendering.

| Field | Type | Description |
|---|---|---|
| `regularSegmentHours` | float \| null | Hours worked in the Regular shift window |
| `driverAmSegmentHours` | float \| null | Hours worked in the Driver/Aide AM window |
| `driverPmSegmentHours` | float \| null | Hours worked in the Driver/Aide PM window |
| `rawOtMinutes` | int \| null | Per-punch overtime minutes past shift end |
| `overtime` | array | OT request records linked to this punch |

B&C overtime is not per-punch — it is aggregated at the cutoff level as a separate OT block row.

---

### Column Visibility Guide

| Column | BNC | DAYCARE |
|---|---|---|
| Time In / Time Out | ✓ | ✓ |
| Status / Punch Type | ✓ | ✓ |
| Duration (`netWorkedHours`) | ✓ | ✓ |
| Gross Hours | ✓ | ✓ |
| Scheduled (`scheduledHours`) | ✓ | ✓ |
| Late / Undertime | ✓ | ✓ |
| Lunch / Coffee | ✓ | ✓ |
| Shift (per punch) — `userShift.shift.shiftName` | ✓ | ✓ |
| Regular Segment | ✗ | ✓ |
| Driver AM / PM Segment | ✗ | ✓ |
| Overtime (per punch) / OT Status | ✗ | ✓ |

---

### Implementation Snippets

```js
// Store companyType once per page load
const { companyType, data, pagination, summary } = await fetchTimeLogs(params);
setCompanyType(companyType);

const isBnC = companyType === "BNC";

// Conditional columns
const columns = [
  { key: "netWorkedHours", label: "Duration" },
  { key: "scheduledHours", label: "Scheduled" },
  { key: "lateHours",      label: "Late" },
  { key: "undertimeHours", label: "Undertime" },
  ...(!isBnC ? [
    { key: "regularSegmentHours",  label: "Regular" },
    { key: "driverAmSegmentHours", label: "Driver AM" },
    { key: "driverPmSegmentHours", label: "Driver PM" },
    { key: "rawOtMinutes",         label: "OT Minutes" },
  ] : []),
];

// Per-punch shift label
const shiftLabel = row.userShift?.shift?.shiftName ?? "—";

// All shifts for a day (schedule modal)
const allShifts = row.userShifts ?? [];

// OT requests — always guard (absent for BNC)
const otRequests = row.overtime ?? [];
```

---

### Scheduled Hours vs Duration

| Term | Field | Meaning |
|---|---|---|
| **Duration** | `netWorkedHours` | Actual payable hours = gross − deductible lunch − deductible coffee |
| **Scheduled** | `scheduledHours` | Duration of the matched shift window — `null` if no shift assigned |

`scheduledHours` can be `null` even when the employee worked — show `—` or `N/A`, never fall back to `netWorkedHours`.

---

### Grace Period Behavior

Late and undertime use a binary forgiveness threshold, not a deduction:

- Clock-in within grace → `lateHours = 0`
- Clock-in past grace → `lateHours = full raw minutes late` (not just the overage past grace)

| Clock-in | Shift Start | Grace | lateHours |
|---|---|---|---|
| 7:04 AM | 7:00 AM | 7 min | `0` (within grace) |
| 7:10 AM | 7:00 AM | 7 min | `0.167` (10 min — full amount, not 3 min over grace) |

`lateHours = 0` is displayed as `—` by convention.

---

### Null Safety Cheatsheet

```js
const duration  = row.netWorkedHours        ?? null;
const scheduled = row.scheduledHours        ?? null;   // null = no shift assigned
const late      = row.lateHours             ?? null;   // null = no shift; 0 = on time
const undertime = row.undertimeHours        ?? 0;
const lunch     = row.lunchDeductionMinutes ?? 0;
const coffee    = row.totalBreakMinutes     ?? 0;
const shiftName = row.userShift?.shift?.shiftName ?? "—";

// DayCare only — will be undefined on BNC rows
const regularSeg  = row.regularSegmentHours  ?? null;
const driverAmSeg = row.driverAmSegmentHours ?? null;
const driverPmSeg = row.driverPmSegmentHours ?? null;
const rawOt       = row.rawOtMinutes         ?? null;
const otRequests  = row.overtime             ?? [];
```

---

## Part 2 — Cutoff Period Approval Contract

### Overview

The approval action has been expanded from a single "Approve" button into a **four-button model**. The same endpoints are used — only the request body changes.

| UI Button | `action` | `approvalMode` | Extra params |
|---|---|---|---|
| Approve Schedule | `"approve"` | `"schedule"` | `shiftId` (B&C required) |
| Approve Raw Time | `"approve"` | `"raw"` | — |
| Edit | `"approve"` | `"edit"` | `editedClockIn`, `editedClockOut` |
| Reject | `"exclude"` | — | `reason` (optional) |
| **Reset** | — | — | No body — separate endpoint |

B&C companies also get **automatic OT blocks** — a separate approvable row that appears when an employee's total approved hours on a given day exceed the company's daily OT threshold.

Every approved punch row has a **Reset** button — available for all company types — that reverts the punch back to pending.

---

### Endpoints

#### 1. Get Approvals

```
GET /api/cutoff-periods/:id/approvals
```

**Response envelope:**

```jsonc
{
  "message": "Approvals retrieved successfully.",
  "data": [ /* punch approval records */ ],
  "leaves": [ /* standalone leave records */ ],
  "otBlocks": [ /* OT block records — B&C only */ ],
  "gracePeriodMinutes": 15,
  "companyTimezone": "America/Los_Angeles",
  "otBasis": "daily",
  "dailyOtThresholdHours": 8,
  "isBNC": true,
  "synced": true
}
```

| Field | Type | Notes |
|---|---|---|
| `isBNC` | `boolean` | Gate for four-button model and OT block UI — do not read `companyType` from any other endpoint |
| `otBlocks` | `array` | OT block records for B&C — empty `[]` for DayCare |
| `otBasis` | `string` | `"daily"` — only daily OT is implemented currently |
| `dailyOtThresholdHours` | `number` | Threshold in hours (default `8`) |
| `companyTimezone` | `string` | IANA timezone string for display formatting |
| `gracePeriodMinutes` | `number` | Company grace period for late/undertime display |

**Punch approval record shape (B&C):**

```jsonc
{
  "id": "approval_id",
  "status": "pending",
  "timeLog": {
    "id": "timelog_id",
    "timeIn": "2025-01-15T08:03:00.000Z",
    "timeOut": "2025-01-15T16:10:00.000Z"
  },
  "availableShifts": [
    { "id": "shift_cuid", "shiftName": "Morning Shift", "startTime": "08:00", "endTime": "16:00" },
    { "id": "shift_cuid_pm", "shiftName": "Afternoon Shift", "startTime": "12:00", "endTime": "20:00" }
  ]
}
```

`availableShifts` — shifts assigned to this employee on the punch date. May be `[]`. Not present for DayCare.

**OT block record shape (B&C only):**

```jsonc
{
  "id": "ot_block_cuid",
  "cutoffPeriodId": "cutoff_id",
  "userId": "user_id",
  "date": "2025-04-21T00:00:00.000Z",
  "otHours": 1.0,
  "status": "pending",
  "approvedBy": null,
  "approvedAt": null,
  "notes": null,
  "user": { "id": "user_id", "username": "jdelacruz", "profile": { "firstName": "Juan", "lastName": "dela Cruz" } }
}
```

OT block rules:
- Computed automatically from approved punch hours — appears as soon as the daily total exceeds the threshold
- When a punch is edited (reducing hours), the OT block is automatically recomputed — may shrink, reset to `pending`, or disappear
- An already-`approved` OT block resets to `pending` if underlying punch hours change
- `otBlocks` is always `[]` for DayCare

---

#### 2. Single Approval Action

```
PATCH /api/cutoff-periods/:id/approvals/:approvalId
```

**Request body:**

```jsonc
{
  "action": "approve" | "exclude" | "reject",
  "approvalMode": "schedule" | "raw" | "edit",
  "shiftId": "shift_cuid_here",
  "editedClockIn": "2025-01-15T08:00:00.000Z",
  "editedClockOut": "2025-01-15T16:00:00.000Z",
  "notes": "optional audit note",
  "reason": "optional reason for reject/exclude"
}
```

**Approve Schedule (B&C)**
```jsonc
{ "action": "approve", "approvalMode": "schedule", "shiftId": "shift_cuid_here" }
```
Snaps clock-in to shift start (within grace) and caps clock-out at shift end, then recomputes hours. OT block recomputed.

**Approve Raw Time**
```jsonc
{ "action": "approve", "approvalMode": "raw" }
```
No time modification. Recomputes hours on raw punch times. OT block recomputed.

**Edit**
```jsonc
{ "action": "approve", "approvalMode": "edit", "editedClockIn": "...", "editedClockOut": "...", "notes": "..." }
```
Overwrites punch times, recomputes hours. OT block recomputed — may disappear if edit reduces hours to/below threshold.

**Reject / Exclude**
```jsonc
{ "action": "exclude", "reason": "No show" }
```

> **After any single approval action, re-fetch `GET .../approvals` to get the updated `otBlocks` array.** The OT recompute runs server-side after the approval commits — the PATCH response does not include the updated OT block.

---

#### 3. Bulk Approve

```
PATCH /api/cutoff-periods/:id/approvals/bulk
```

```jsonc
{
  "action": "approve" | "exclude",
  "approvalMode": "raw",
  "timeLogIds": ["timelog_id_1", "timelog_id_2"],
  "notes": "optional"
}
```

B&C: bulk approve always uses raw mode — shift picker cannot be applied per-record. OT blocks for all affected employee-days are recomputed automatically. Re-fetch approvals to get updated `otBlocks`.

```jsonc
{ "message": "5 time log(s) approved successfully.", "data": { "approved": 5, "failed": 0 } }
```

---

#### 4. OT Block Approval (B&C only)

```
PATCH /api/cutoff-periods/:id/ot-blocks/:otBlockId
```

```jsonc
{ "action": "approve" | "exclude", "notes": "optional" }
```

- Only `pending` blocks can be acted on — attempting to modify an already `approved` or `excluded` block returns 400.

```jsonc
{ "message": "OT block approved.", "data": { /* updated CutoffOtBlock */ } }
```

---

#### 5. Reset Approval (per punch)

```
PATCH /api/cutoff-periods/:id/approvals/:approvalId/reset
```

No request body required.

**What gets cleared:**
- `status` → `"pending"`, `actualHours` → `null`
- `approvedClockIn` / `approvedClockOut` → `null`
- `approvedBy` / `approvedAt` → `null`

**What is NOT touched:**
- Raw `timeIn` / `timeOut` on the TimeLog — original punch is always preserved
- `notes` — kept as audit trail

After reset, the OT block for that employee-day is recomputed automatically. Re-fetch `GET .../approvals` to update `otBlocks` and all punch statuses.

Constraints: only `approved` records can be reset. Cannot reset records in a `locked` or `processed` cutoff period.

```jsonc
{ "message": "Approval reset to pending.", "data": { /* updated TimeLogApproval */ } }
```

---

#### 6. Resolve Conflict (punch vs. leave)

```
PATCH /api/cutoff-periods/:id/approvals/:approvalId/conflict
```

```jsonc
{ "choice": "punch" | "leave" }
```

- `"punch"` — approves the punch (raw), cancels the conflicting leave, returns leave credit
- `"leave"` — excludes the punch, leave record is kept

No `approvalMode`, `shiftId`, or OT involvement.

---

### OT Block UI Pattern (B&C only)

1. Group `otBlocks` by `userId` and `date` (use the date portion of `block.date`)
2. After rendering all punch rows for a given employee-day, check if an OT block exists for that `userId + date`
3. If it exists, render an OT row:
   - Label: `"Overtime"` or `"OT"`
   - Hours: `block.otHours` (e.g. `1.0h`)
   - Status badge: `pending` / `approved` / `excluded`
   - Action buttons: **Approve OT** / **Exclude OT** (only shown when `status === "pending"`)
4. On admin action: `PATCH .../ot-blocks/:otBlockId` with `{ action: "approve" | "exclude" }`
5. Re-fetch approvals (or optimistically update the block's status)

```
Apr 21   2 shifts                                          9h total
─────────────────────────────────────────────────────────────────────
  Punch   3h scheduled   In: 5:00 AM → Out: 8:00 AM   3h   ✓ Approved
  Punch   4h scheduled   In: 2:00 PM → Out: 8:00 PM   6h   ✓ Approved
  OT      Overtime                                     1h   [ Approve OT ]  [ Exclude ]
```

Reactivity rules:
- OT block appears automatically — do not compute client-side, always read from `otBlocks`
- Always re-fetch after any approval action — an `approved` OT block that gets its hours changed server-side will reset to `pending`

---

### Reset Button UI Pattern

Show the Reset button only when `approval.status === "approved"`. Available for all company types (B&C and DayCare).

Do not show on `pending`, `excluded`, or OT block rows. Do not show when the cutoff period `status` is `"locked"` or `"processed"`.

```
[ Date ]  [ Type ]  [ Details ]  [ Hours ]  [ ✓ Approved ]  [ ↺ Reset ]
```

After reset, re-fetch approvals — the OT block for that employee-day may shrink or disappear. Remove the OT row from the UI if it disappears; do not leave a ghost row.

```
Before:
  Apr 20   Punch   6h scheduled   In: 4:00 PM → Out: 10:00 PM   6h   ✓ Approved   [ ↺ Reset ]

After:
  Apr 20   Punch   6h scheduled   In: 4:00 PM → Out: 10:00 PM   –    [ Approve Schedule ]  [ Raw ]  [ Edit ]  [ Exclude ]
```

---

### Shift Picker UI Pattern (B&C only)

1. Read `availableShifts` from the approval record — no extra API call needed
2. If empty → show warning: "No shift assigned for this date — use Approve Raw Time instead"
3. If one entry → may auto-select or show picker (UX decision)
4. If multiple entries → show picker; shifts already used by a sibling approved punch on the same date can be grayed out with an "Already used" badge (computed client-side)
5. On confirm → `PATCH .../approvals/:approvalId` with `approvalMode: "schedule"` and `shiftId`

---

### Notes Field — Audit Trail

Wire any reason/notes input to the `notes` field on edit and exclude actions:

```jsonc
{
  "action": "approve",
  "approvalMode": "edit",
  "editedClockIn": "...",
  "editedClockOut": "...",
  "notes": "Employee reported incorrect punch — corrected per supervisor"
}
```

---

### Driver/Aide Segments (B&C)

`punchType === "DRIVER_AIDE"` employees have three segments per day (`driver_am`, `regular`, `driver_pm`), each with its own `TimeLogApproval` record and `segmentType` field.

- Do not show the shift picker for records where `segmentType !== null` — fall back to Approve Raw or Edit
- OT blocks for Driver/Aide employees are computed the same way — sum of all approved segment `netWorkedHours` for the day vs threshold (not yet fully tested)

---

### Training Punch Type (DayCare only)

Admins can tag any existing DayCare punch as `"TRAINING"` via the Edit Punch Type modal on the Employer Punch Logs page.

**Endpoint:**
```
PATCH /api/timelogs/:id/punch-type
```
```jsonc
{ "punchType": "TRAINING" }
```

The dropdown options map to:

| Label | `punchType` value |
|---|---|
| Regular | `REGULAR` |
| Driver/Aide (Full) | `DRIVER_AIDE` |
| Driver AM only | `DRIVER_AIDE_AM` |
| Driver PM only | `DRIVER_AIDE_PM` |
| Training | `TRAINING` ← new |

**Cutoff approval behavior:**

When a DayCare punch has `punchType === "TRAINING"`, the cutoff approval skips all shift-snap logic and applies a flat credit:

- `scheduledHours` = company's **Default Shift Hours** (e.g. `8.0`)
- `actualHours` = same value
- `approvedClockIn` / `approvedClockOut` = raw punch times (unchanged)
- No shift picker, no schedule resolution

The hours value comes from `Company.defaultShiftHours` (default `8.00`). This is the same field the admin configures under **Company Settings → Default Shift Hours**.

**UI notes:**
- Show a `Training` badge on the punch type column when `punchType === "TRAINING"`
- Do not show the shift picker for Training punches in the cutoff review — it is not applicable
- `scheduledHours` and `actualHours` will always be equal and non-null after approval
- This punch type is DayCare only — it will never appear on B&C punch rows

---

### B&C vs DayCare Differences

| Feature | B&C | DayCare |
|---|---|---|
| Four-button model | Yes | No — single approve only |
| Shift picker on Approve Schedule | Yes — `shiftId` required | No — snap is automatic |
| `availableShifts` in GET response | Yes | No |
| OT blocks | Yes — automatic, approvable | No |
| `otBlocks` in GET response | Yes (may be `[]`) | Always `[]` |
| Bulk approve mode | Always raw | Uses DayCare snap logic |
| Per-punch OT (`rawOtMinutes`) | Always `null` | Computed per punch |
| `withOT` param | Ignored | Supported on single approve |
| Reset button on approved punches | Yes | Yes |

---

### Error Responses

| Status | Meaning |
|---|---|
| 400 | Validation error (missing shiftId, invalid action, already approved, etc.) |
| 400 | Cutoff period is locked or processed |
| 404 | Approval, OT block, or cutoff period not found |
| 500 | Unexpected server error |

---

## Part 3 — Compute Architecture (Internal Reference)

### Why the Strategy Split

`timeLogComputeService.js` handled two fundamentally different business types in one function via deep `isDriverLog` branching. The refactor extracts B&C compute into `bncStrategy.js` — each business type now lives in its own file. Adding a new client = adding a new strategy file, touching nothing else.

### Routing (companyId → strategy)

| companyId | Strategy | Notes |
|---|---|---|
| `cmo5xr1nm0qyvsq4tdeejn5bj` | `bncStrategy` | B&C Residential LLC |
| everything else | existing service | DayCare / Driver-Aide (frozen) |

### bncStrategy.js — Key Decisions

**Timezone:** Uses `company.timeZone` first, falls back to `America/Los_Angeles`. Server Asia/Manila timezone is never used.

**Shift resolution fix:** Old code used `.find()` (1 result) for ShiftSchedule fallback. Fixed to `.filter()` for all day-matching schedules, keeping only the highest-priority tier (individual > department > all). This ensures B&C employees with two recurring ShiftSchedules on the same day both land in `userShifts` so `matchShiftToWindow` picks correctly per punch.

**Lunch deduction logic:**
```
autoLunchDeductionMinutes set     → use exact injected value
autoLunchApplied (non-deductible) → 0
manual lunch taken                → max(actual, minimumLunchMins)
no lunch at all                   → breakConfig.autoLunchEntitled && autoBreakLunchDeductible
                                     ? breakConfig.autoBreakLunchMinutes
                                     : 0   ← no blind minimum deduction
```

**Late hours:** `graceMs = (gracePeriodMinutes * 60 + 59) * 1000` — within grace → `0`, past grace → full raw minutes.

**`rawOtMinutes`:** Always `null` for B&C punches. OT is aggregated at the cutoff level as an OT block, not attached to any individual punch.

### Fields Written by bncStrategy.js

| Field | Notes |
|---|---|
| `netWorkedHours` | Payable hours |
| `grossHours` | Raw timeOut − timeIn |
| `scheduledHours` | Matched shift duration, null if no shift |
| `lateHours` | Grace-adjusted, null if no shiftStart |
| `undertimeHours` | Grace-adjusted |
| `lunchDeductionMinutes` | Final applied deduction |
| `totalBreakMinutes` | Deductible coffee minutes |
| `rawOtMinutes` | Always null |
| `calculatedAt` | Timestamp of last compute |

Not touched: `regularSegmentHours`, `driverAmSegmentHours`, `driverPmSegmentHours` (DayCare only).

### What Is Frozen (DayCare — do not touch)

- All `isDriverLog` / `isDriverAm` / `isDriverPm` branching in `timeLogComputeService.js`
- `resolveSegmentBoundary`, `resolveDriverAideSegments`, `resolveShiftForTimeLog` exports
- Catalog shift lookup (`Driver/Aide AM Shift`, `Driver/Aide PM Shift`, `Regular Shift`)

### Phase 2 — Future

- Formalize `dayCareStrategy.js` from the frozen code; `timeLogComputeService.js` becomes pure dispatcher
- Add `companyType` field to `Company` schema to replace hardcoded ID set
- OT aggregate logic for `"weekly"` and `"cutoff"` OT basis (only `"daily"` is live)
- OT block row on EmployeeCutoff page (UI side)
