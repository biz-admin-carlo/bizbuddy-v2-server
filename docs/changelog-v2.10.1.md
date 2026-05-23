# Changelog — v2.10.1

## Summary

One bug fix and two new endpoints under BB-004. Grace period alignment fix under BB-014.

- **BB-004** — `POST /api/shiftschedules/create` was throwing a `ReferenceError: scheduleResults is not defined` for individual assignment type due to a missing destructure from the transaction result. Fixed. Additionally, `PUT /api/usershifts/:id` and `DELETE /api/usershifts/:id` were missing — both are now implemented to support the calendar view's edit and remove shift actions.
- **BB-014** — `daycareCutoffStrategy.js` was comparing grace period using integer minutes (`lateMinutes <= gracePeriodMinutes`) while `timeLogComputeService.js` and `bncCutoffStrategy.js` both use a millisecond ceiling of `(gracePeriodMinutes * 60 + 59) * 1000`. A punch 15m30s late would not be snapped back during DayCare approval but would compute `lateHours = 0` on the subsequent `computeTimeLogSummary` call — inconsistent `approvedClockIn` vs `lateHours`. Aligned all three grace period comparisons in `daycareCutoffStrategy.js` to the millisecond formula.

---

## BB-004 — Schedule Create 500 Fix + UserShift PUT/DELETE Endpoints

### Problem 1 — `scheduleResults is not defined` on individual schedule creation

`POST /api/shiftschedules/create` returned a 500 error when `assignmentType` was `individual`. The transaction block built and returned a `scheduleResults` array alongside `createdSchedules` and `totalShifts`, but the outer destructure only captured `createdSchedules` and `totalShifts`. When the response handler at line 379 referenced `scheduleResults`, it was not in scope — Node threw a `ReferenceError`.

```
ReferenceError: scheduleResults is not defined
    at createShiftSchedule (shiftScheduleController.js:379:23)
```

### Changes — Problem 1

#### `src/controllers/Features/shiftScheduleController.js` — `createShiftSchedule`

Added `scheduleResults` to the transaction destructure:

```js
// Before
const { createdSchedules, totalShifts } = await prisma.$transaction(async (tx) => {

// After
const { createdSchedules, totalShifts, scheduleResults } = await prisma.$transaction(async (tx) => {
```

The transaction already returned `scheduleResults` for individual assignments on line 312 — it was simply never destructured.

---

### Problem 2 — Missing `PUT` and `DELETE` endpoints for UserShift records

The calendar view requires two endpoints to support editing and removing individual shift assignments:

- `PUT /api/usershifts/:id` — reassign a different shift to an existing `UserShift` record
- `DELETE /api/usershifts/:id` — remove a single shift assignment for a specific calendar day

Neither existed. `PUT` would fall through to Express's default 404, and `DELETE` was confirmed returning 404 in server logs.

### Changes — Problem 2

#### `src/controllers/Features/userShiftController.js`

Added two new handlers: `updateUserShift` and `deleteUserShift`.

**`updateUserShift`** — validates `shiftId` from the request body, verifies the `UserShift` record exists and belongs to an employee in the requester's company, verifies the target shift also belongs to the same company, then updates `shiftId` only. All other fields (`assignedDate`, `status`, `scheduleId`) are left untouched.

```js
const updateUserShift = async (req, res) => {
  const { id } = req.params;
  const { companyId } = req.user;
  const { shiftId } = req.body;
  // 400 if shiftId missing
  // 404 if UserShift not found
  // 403 if UserShift.user.companyId !== requester's companyId
  // 400 if target shift not found in same company
  // 200 with updated record (same shape as getEmployeeShifts)
};
```

**`deleteUserShift`** — verifies the record exists and belongs to an employee in the requester's company, then deletes the single `UserShift` row. The parent `ShiftSchedule` rule is not affected. No cascade risk — `TimeLog` and `TimeLogApproval` do not FK into `UserShift`.

```js
const deleteUserShift = async (req, res) => {
  const { id } = req.params;
  const { companyId } = req.user;
  // 404 if UserShift not found
  // 403 if UserShift.user.companyId !== requester's companyId
  // 200 with { id }
};
```

#### `src/routes/Features/userShiftRoutes.js`

Added two routes with the same auth guards as existing admin-scoped routes:

```js
router.put("/:id", authenticate, authorizeRoles('admin', 'supervisor', 'superadmin'), updateUserShift);
router.delete("/:id", authenticate, authorizeRoles('admin', 'supervisor', 'superadmin'), deleteUserShift);
```

Routes are placed after the named GET routes (`/employee/:employeeId`, `/company-stats`) to avoid shadowing.

---

### Notes

- Updating a `UserShift` for a past date does not automatically recompute any associated `TimeLog`. If the punch has already been approved inside an open cutoff, the admin must re-approve for new shift boundaries to take effect. Finalized cutoff periods are unaffected.
- New `UserShift` records created via `POST /api/shiftschedules/create` are always assigned `status: 'upcoming'` regardless of the assigned date. This is pre-existing behavior and is not changed here.

---

## BB-014 — DayCare Grace Period Threshold Alignment

### Problem

`daycareCutoffStrategy.js` computed the grace period window using integer minutes:

```js
const lateMinutes = (finalClockIn - scheduledClockIn) / 60000;
finalClockIn = lateMinutes <= gracePeriodMinutes ? scheduledClockIn : finalClockIn;
```

`timeLogComputeService.js` and `bncCutoffStrategy.js` both use a millisecond ceiling formula:

```js
const graceMs = (gracePeriodMinutes * 60 + 59) * 1000;
```

For a punch that is between 15m01s and 15m59s late (with a 15-minute grace setting):
- The strategy would NOT snap the clock-in back — `15.x <= 15` is false
- `computeTimeLogSummary`, called immediately after approval, would compute `lateHours = 0` — `rawLateMs <= graceMs` is true

This left `TimeLogApproval.approvedClockIn` reflecting the actual late time while `TimeLog.lateHours` was 0 — inconsistent within the same approval operation.

### Changes

#### `src/services/Cutoff/daycareCutoffStrategy.js`

Replaced the minutes-based comparison with the millisecond ceiling formula in all three approval paths (`approveOne`, `approveBulk`, and the schedule-based approval path):

```js
// Before
const lateMinutes = (finalClockIn - scheduledClockIn) / 60000;
finalClockIn = lateMinutes <= gracePeriodMinutes ? scheduledClockIn : finalClockIn;

// After
const graceMs   = (gracePeriodMinutes * 60 + 59) * 1000;
const rawLateMs = finalClockIn - scheduledClockIn;
finalClockIn = rawLateMs <= graceMs ? scheduledClockIn : finalClockIn;
```

`bncCutoffStrategy.js` already used the millisecond formula and is unchanged.
