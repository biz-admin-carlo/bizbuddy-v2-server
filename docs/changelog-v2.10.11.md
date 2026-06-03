# Changelog — v2.10.11

> BB-022 — Sync performance + lunch start/end populated on re-run.

---

## Bug Fixes

### Sync re-run does not populate `lunchBreak` start/end

**Files changed:**
- `src/controllers/Features/cutoffPeriodController.js`

**Root cause:**  
`syncCutoffApprovals` called `computeTimeLogSummary` per timelog, which only *reads* `lunchBreak` to calculate `lunchDeductionMinutes`. It never called `applyAutoBreaks`, which is the function that actually *writes* `lunchBreak.start`/`end`. Any timelog that missed the auto-break step at clock-out (e.g. shift assigned after clock-out, or policy enabled retroactively) would have no lunch timestamps after a sync.

**Fix:**  
`applyAutoBreaks(tl.id, tl.userId)` is now called before `computeTimeLogSummary` in the sync loop. Order is intentional — auto-breaks set the `lunchBreak` field first, then the recompute reads it for `lunchDeductionMinutes`. Existing manual lunch breaks and already-applied auto-lunches (`autoLunchApplied: true`) are not overwritten — `applyAutoBreaks` already guards against this.

---

## Performance

### `POST /api/cutoff-periods/:id/sync` — sequential per-row recompute (was ~253s)

**Files changed:**
- `src/controllers/Features/cutoffPeriodController.js`

**Root cause:**  
The sync loop ran `applyAutoBreaks` + `computeTimeLogSummary` sequentially for every timelog — one at a time. Each pair fires 5–8 DB round-trips, so a period with 500 timelogs meant ~2,500–4,000 serial queries.

**Fix:**  
Loop now processes timelogs in batches of 20 using `Promise.allSettled`. 500 timelogs go from ~500 serial iterations to ~25 parallel rounds. Batch size kept at 20 to avoid saturating the connection pool.

---

### `GET /api/cutoff-periods/:id/approvals` — full OT recompute on every page load (was ~65s)

**Files changed:**
- `src/controllers/Features/cutoffPeriodController.js`

**Root cause:**  
`getCutoffApprovals` called `recomputeAllOtForCutoff` on every page open for B&C companies. That function queries all approved records in the cutoff then runs `computeOtForEmployeeDay` sequentially for every unique user-day pair — effectively re-running the entire OT computation for the period on each load, regardless of whether anything changed.

**Fix:**  
Removed `recomputeAllOtForCutoff` from the page load path. OT recompute continues to run after individual approval status changes (`recomputeOtForTimeLog` in `updateSingleApproval`) and during sync — the two moments where OT data can actually become stale. Page loads no longer trigger it.
