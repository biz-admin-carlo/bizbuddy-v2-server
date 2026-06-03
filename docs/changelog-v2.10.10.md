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

---

### BB-021 — Missed clock-out notification shows wrong shift end time (UTC instead of company timezone)

**Files changed:**
- `src/services/notificationService.js`
- `src/jobs/checkMissedClockOuts.js`

**Root cause:**  
Two separate issues combined to produce an incorrect notification:

1. **Wrong time display (`notificationService.js`):** `toLocaleTimeString("en-US")` was called without a `timeZone` option, so the server formatted the Date in its own local timezone (UTC). A shift ending at 17:00 Manila (UTC+8) is stored as 09:00 UTC, so the notification read "Your shift ended at 9:00:00 AM" instead of "5:00:00 PM".

2. **Wrong shift matched for negative-offset timezones (`checkMissedClockOuts.js`):** The `UserShift` query used `clockInTime.startOf('day').toDate()` in the company timezone, which produces a UTC-offset midnight (e.g. midnight PDT = `2026-06-03T07:00:00Z`). Since `assignedDate` is stored as UTC midnight (`2026-06-03T00:00:00Z`), this range misses the current day and matches the next calendar day's assignment instead — causing the notification to reference tomorrow's shift. Affects all companies in negative UTC-offset timezones (e.g. US California).

**Fix:**  
- `notificationService.js`: Pass `{ timeZone: company.timeZone }` to all `toLocaleTimeString` calls in `notifyMissedClockOut` so times are formatted in the company's local timezone.  
- `checkMissedClockOuts.js`: Derive the local calendar date string from the timezone-aware `clockInTime`, then build the `assignedDate` range from UTC midnight of that date. Also adds `status: { not: 'cancelled' }` to exclude cancelled shift assignments.
