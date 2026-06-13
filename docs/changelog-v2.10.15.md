# Changelog — v2.10.15

---

## Features

### BB-027 — `requestedHours` field on leave API responses

**Files changed:**
- `src/utils/leaveUtils.js`
- `src/controllers/Features/leaveController.js`

**Context:**  
Leave records were displaying and deducting hours using a flat `leaveDays × company.defaultShiftHours` formula. This was inaccurate for employees whose scheduled shift hours differ from the company default (e.g. an employee on a 5.5h shift losing 8h of leave balance for a single sick day).

**Changes:**

`leaveUtils.js` — `calcRequestedHours`:  
Reworked to fetch the actual `Shift` duration (`startTime`, `endTime`, `crossesMidnight`) for each `UserShift` in the leave date range. Hours are now accumulated per qualifying calendar day using real shift duration instead of `defaultShiftHours`. The fallback for salaried/unassigned employees (no `UserShift` records in range) remains unchanged — those still use `company.defaultShiftHours`.

Because `_deductBalance` in `leaveController.js` calls `calcRequestedHours`, this also fixes the balance deduction — the deducted amount now matches the employee's actual scheduled hours.

`leaveController.js` — `_attachRequestedHours` (new helper):  
Runs `calcRequestedHours` in parallel across all leave records in a list response and attaches the result as `requestedHours` on each record. Errors per-record are caught and return `null` rather than failing the whole request.

`requestedHours` is now included in the response of all three leave listing endpoints.

---

## Client Contract

**Endpoints updated:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/leaves` | Management view — all statuses, paginated |
| `GET` | `/api/leaves/pending` | Management view — pending/pending_secondary only |
| `GET` | `/api/leaves/my` | Employee's own leave history |

**New field on each leave record in `data[]`:**

```json
{
  "id": "...",
  "userId": "...",
  "leaveType": "Sick Leave",
  "startDate": "2026-06-03",
  "endDate": "2026-06-03",
  "status": "approved",
  "requestedHours": 5.5,
  ...
}
```

`requestedHours` — `number | null`, 2 decimal places. Reflects the employee's actual scheduled shift hours for the leave date range. `null` only if the calculation fails (e.g. orphaned user record).

**Migration:** The client-side fallback (`leaveDaysInRange × defaultShiftHours`) can be replaced by reading `requestedHours` directly. No request changes needed — the field is always present in the response.

---

## Features

### BB-028 — DayCare cutoff-basis OT computation

**Files changed:**
- `src/services/Cutoff/cutoffOtService.js`
- `src/services/Cutoff/daycareCutoffStrategy.js`
- `src/controllers/Features/cutoffPeriodController.js`

**Context:**  
DayCare companies are configured with `otBasis = "cutoff"` and a `cutoffOtThresholdHours` value (e.g. 80h). Previously, the OT service hard-gated on `otBasis === "daily"` and silently skipped everything else — no `CutoffOtBlock` records were ever created for DayCare, and the DayCare strategy never called the OT service at all.

**Changes:**

`cutoffOtService.js` — added `computeOtForCutoffBasis`:  
Sums all approved `actualHours` for an employee across the entire cutoff period. Compares to `company.cutoffOtThresholdHours` (the admin-configured value — never hardcoded). If the total exceeds the threshold, upserts a single `CutoffOtBlock` keyed on the cutoff's `periodEnd` date. If hours fall back to/below the threshold (e.g. after an edit or exclusion), the block is deleted.

`cutoffOtService.js` — `recomputeOtForTimeLog` and `recomputeAllOtForCutoff`:  
Both functions now dispatch on `company.otBasis`. `"daily"` → existing B&C per-day logic (unchanged). `"cutoff"` → new `computeOtForCutoffBasis`. `"weekly"` remains a no-op.

`daycareCutoffStrategy.js`:  
Now imports and calls `recomputeOtForTimeLog` (fire-and-forget) after every single approval — TRAINING, DRIVER_AIDE segment, and REGULAR punches. Calls `recomputeAllOtForCutoff` after bulk approve. Also fires after conflict resolution (honor-punch path). Pattern is identical to B&C.

`cutoffPeriodController.js` — `getCutoffApprovals`:  
- `otBlocks` query was previously gated on `BNC_COMPANY_IDS`. Now also runs when `otBasis === "cutoff"`, so DayCare companies receive their computed OT blocks in the response.
- `cutoffOtThresholdHours` added to the company select and included in the response payload.
- Fixed an existing bug: timezone fallback was `"Asia/Manila"` — corrected to `"America/Los_Angeles"`.

---

## Client Contract

**Endpoint updated:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/cutoff-periods/:id/approvals` | Cutoff approvals + OT blocks |

**New / changed fields in the response:**

```json
{
  "otBasis": "cutoff",
  "dailyOtThresholdHours": 8,
  "cutoffOtThresholdHours": 80,
  "isBNC": false,
  "otBlocks": [
    {
      "id": "...",
      "cutoffPeriodId": "...",
      "userId": "...",
      "date": "2026-06-30T00:00:00Z",
      "otHours": 4.50,
      "status": "pending",
      "approvedBy": null,
      "approvedAt": null,
      "notes": null,
      "user": {
        "id": "...",
        "username": "...",
        "profile": { ... }
      }
    }
  ]
}
```

`cutoffOtThresholdHours` — new field. The company-configured per-period OT threshold. Use this (not `dailyOtThresholdHours`) when rendering DayCare OT context.

`otBlocks` — previously only populated for B&C (`isBNC === true`). Now also populated for DayCare when `otBasis === "cutoff"`. For DayCare there is **one block per employee** per cutoff (not one per day like B&C) — `date` will always equal the cutoff `periodEnd`.

**Required client-side changes:**

1. **Show the OT block section for DayCare**  
   Change the render condition from `isBNC === true` to `isBNC || otBasis === "cutoff"`.

2. **Label the OT block correctly**  
   For B&C (`isBNC`): label per date as today — e.g. "Jun 3 — 2.5h OT".  
   For DayCare (`otBasis === "cutoff"`): label per employee for the period — e.g. "Cutoff OT — 4.5h".  
   The `date` field is the period end date, not a meaningful work date for DayCare.

3. **Use the correct threshold in display copy**  
   B&C: use `dailyOtThresholdHours` (e.g. "Exceeded 8h/day").  
   DayCare: use `cutoffOtThresholdHours` (e.g. "Exceeded 80h this period").

---

## Features

### Company settings — `isBNC` flag and full OT config

**Files changed:**
- `src/controllers/Account/companySettingsController.js`

**Context:**  
`GET /api/company-settings` already returns all OT threshold fields (`otBasis`, `dailyOtThresholdHours`, `cutoffOtThresholdHours`, etc.) but was missing the company type flag. The client needs this to decide which approval flow and UI to show — without having to derive it from the cutoff approvals response.

**Change:**  
`isBNC` is now included in the `GET /api/company-settings` response. `true` for B&C companies, `false` for DayCare and all others.

---

## Client Contract

**Endpoint updated:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/company-settings` | Company configuration |

**New field:**

```json
{
  "isBNC": false,
  "otBasis": "cutoff",
  "cutoffOtThresholdHours": 80,
  "dailyOtThresholdHours": 8,
  "weeklyOtThresholdHours": 40,
  "defaultShiftHours": 8,
  "gracePeriodMinutes": 15,
  "multiApprovalEnabled": false,
  ...
}
```

**Recommendation for client:**  
Fetch `GET /api/company-settings` once on app init or session start and store in global state. Use `isBNC` and `otBasis` from this response — not from the cutoff approvals endpoint — to drive all company-type-conditional UI (approval flow, OT section rendering, threshold labels). The cutoff approvals endpoint carries these fields too for convenience, but company settings is the authoritative source.

---

## BB-028 — Client-side changes required

4. **Approve / exclude flow — no changes needed**  
   Same endpoint, same payload:
   ```
   PATCH /api/cutoff-periods/:id/ot-blocks/:otBlockId
   Body: { "action": "approve" | "exclude", "notes": "..." }
   ```
   `status` transitions: `pending → approved` or `pending → excluded`. Identical for both company types.

---

## Features

### BB-029 — DayCare training punch designation + accurate training hours

**Files changed:**
- `src/services/Cutoff/daycareCutoffStrategy.js`
- `src/controllers/Features/cutoffPeriodController.js`
- `src/routes/Features/cutoffPeriodRoutes.js`

**Context:**  
Two related gaps in DayCare cutoff handling:

1. Admins had no way to designate a punch as Training during cutoff review. Training punches must be submitted with the correct `punchType` at clock-out time — there was no correction path from the cutoff page.

2. TRAINING approval always credited `defaultShiftHours` flat (e.g. 8h) regardless of how long the employee actually punched. A 6h training day still got 8h credited.

**Changes:**

`cutoffPeriodController.js` — `setPunchType` (new endpoint handler):  
Changes `TimeLog.punchType` between `"REGULAR"` and `"TRAINING"` for a pending approval record. Scoped to DayCare companies (`!BNC`). Guards: cutoff must be open, record must be pending, current type must be REGULAR or TRAINING (DRIVER_AIDE and others are untouched).

`daycareCutoffStrategy.js` — TRAINING approval logic (both `approveSingle` and `approveBulk`):  
Replaced flat `defaultShiftHours` credit with `min(punchDuration, defaultShiftHours)`:
- Punch ≤ `defaultShiftHours` → credit actual punch hours (e.g. 6h punch = 6h)
- Punch > `defaultShiftHours` → cap at `defaultShiftHours` (e.g. 10h punch = 8h)

---

## Client Contract

**New endpoint:**

| Method | Path | Description |
|---|---|---|
| `PATCH` | `/api/cutoff-periods/:id/approvals/:approvalId/set-punch-type` | DayCare only — designate a punch as Training or revert to Regular |

**Request body:**
```json
{ "punchType": "TRAINING" }
```
or to undo:
```json
{ "punchType": "REGULAR" }
```

**Response:**
```json
{
  "message": "Punch type updated to TRAINING.",
  "data": {
    "approvalId": "...",
    "previousPunchType": "REGULAR",
    "punchType": "TRAINING"
  }
}
```

**Error cases:**

| Condition | Status | Message |
|---|---|---|
| BNC company | 400 | Punch type designation is not available for this company type. |
| Invalid `punchType` value | 400 | punchType must be one of: TRAINING, REGULAR. |
| Cutoff locked or processed | 400 | Cannot modify a locked/processed cutoff period. |
| Record already approved/excluded | 400 | Cannot change punch type on an already approved record. |
| Current type is DRIVER_AIDE etc. | 400 | Punch type DRIVER_AIDE cannot be changed via this endpoint. |
| Already the requested type | 400 | Punch type is already TRAINING. |

**Required client-side changes:**

1. **Add "Mark as Training" action to DayCare REGULAR punch rows**  
   Show a "Mark as Training" button/option on pending REGULAR rows when `!isBNC`. On click, call `PATCH .../set-punch-type` with `{ punchType: "TRAINING" }`. Refresh the row — `punchType` on the record will now read `"TRAINING"` and the approve flow will use the capped training hours logic.

2. **Add "Revert to Regular" action on TRAINING rows**  
   When a pending row has `punchType === "TRAINING"` and `!isBNC`, show a "Revert to Regular" option that calls the same endpoint with `{ punchType: "REGULAR" }`. Allows the admin to undo a mistaken designation.

3. **Training hours preview (optional but recommended)**  
   After marking as Training, the approve action will credit `min(punchDuration, defaultShiftHours)` hours — not a flat 8h. If the UI previews hours before approval, update the preview logic to match: `Math.min(rawPunchHours, defaultShiftHours)`.

---

## Bug Fix

### BB-029 (addendum) — REGULAR `actualHours` now excludes early clock-in time

**File changed:**
- `src/services/Cutoff/daycareCutoffStrategy.js`

**Context:**  
When approving a REGULAR punch in schedule mode, `finalClockIn` is snapped to the scheduled shift start (early clock-in time is discarded). However, `actualHours` stored on `TimeLogApproval` was computed from the raw `timeLog.timeIn → timeLog.timeOut`, not from the snapped window — so early clock-in minutes were silently inflating the per-record `actualHours`. Since `computeOtForCutoffBasis` sums `actualHours` across all approved records to determine whether an employee exceeded the cutoff OT threshold, this caused the period total to be overstated for any employee who clocked in early.

**Fix:**  
`actualHours` in both `approveSingle` and `approveBulk` (REGULAR path) now uses `finalClockIn`/`finalClockOut` — the same times written to `approvedClockIn`/`approvedClockOut` — instead of the original raw punch times.

- Schedule mode: early clock-in excluded (consistent with `netWorkedHours` and approved window)
- Raw mode: full punch window preserved (intentional — raw means no snapping)

**No client-side changes required.** `actualHours` is a server-computed field.
