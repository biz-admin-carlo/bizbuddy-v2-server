# Changelog — v2.10.10

> DayCare exclusive. BNC unaffected.

---

## Bug Fixes

### BB-012 — DayCare DRIVER_AIDE raw approval clock-out bleeds into adjacent segments

**Files changed:**
- `src/services/Cutoff/daycareCutoffStrategy.js`

**Root cause:**  
In `approveSingle` and `approveBulk`, the `DRIVER_AIDE` approval block only used `segmentEnd` as `approvedClockOut` when `approvalMode === "schedule"`. For `approvalMode === "raw"`, it fell back to `timeLog.timeOut` — the full raw daily punch-out — causing the approved window to span the entire punch instead of stopping at the segment boundary (e.g. Driver AM showing 6:30 AM → 3:18 PM instead of 6:30 AM → 8:00 AM).

**Fix:**  
`approvedClockOut` now always uses `segmentEnd` for DRIVER_AIDE approvals regardless of `approvalMode`. Raw mode only controls `approvedClockIn` (use actual punch-in time instead of snapping to the window start). Hours are recalculated from the actual `approvedIn → approvedOut` span so raw approvals correctly reflect the extra minutes before the window start.

**Behaviour after fix:**

| Mode | approvedClockIn | approvedClockOut | Hours |
|---|---|---|---|
| Schedule | segmentStart (6:45 AM) | segmentEnd (8:00 AM) | 1.25h |
| Raw | timeLog.timeIn (6:30 AM) | segmentEnd (8:00 AM) | 1.50h |
