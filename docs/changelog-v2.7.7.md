# Changelog — v2.7.7

## Summary

This release introduces a **company-type routing layer** that separates B&C (multi-shift) compute logic from the existing DayCare flow. The core compute service now dispatches B&C companies to a dedicated strategy, and the time log API endpoints surface a `companyType` field so clients can adapt their rendering accordingly.

---

## New Files

### `src/config/companyTypes.js`
Single source of truth for company-type classification. Exports `BNC_COMPANY_IDS` (a `Set`), which drives all B&C routing decisions across the server. Adding a new B&C client only requires updating this file.

### `src/services/timeLogComputeUtils.js`
Pure, side-effect-free utility helpers extracted and shared across all compute strategies:
- `resolveTimezone` — falls back to `America/Los_Angeles` for missing/invalid timezone strings
- `combineDateWithTimeTz` — combines a reference date with a DB time value under a given timezone
- `sumCoffeeBreakMinutes` — sums only deductible coffee breaks
- `lunchBreakMinutes` — computes lunch duration from break start/end
- `computeSegmentHours` — overlapping intersection of a punch window against a shift segment
- `matchShiftToWindow` — pins a punch to its specific shift when a user has multiple shifts on the same day (overlap-first, then proximity fallback)

### `src/services/strategies/bncStrategy.js`
Dedicated compute strategy for B&C companies. Key behaviors:
- Each `TimeLog` is computed independently against its own matched shift window
- `matchShiftToWindow` is used to select the correct shift when a user has both AM and PM shifts on the same day
- `ShiftSchedule` fallback is included (same priority logic as the main compute service: `individual > department > all`)
- Lunch deduction is conservative: only deducted when `autoLunchEntitled` **and** `autoBreakLunchDeductible` are both configured — no blind `minimumLunchMins` deduction
- `rawOtMinutes` is always `null` — OT for B&C is aggregated at the cutoff/period level, not per-punch
- Segment fields (`regularSegmentHours`, `driverAmSegmentHours`, `driverPmSegmentHours`) are not written — not applicable for this punch type

---

## Modified Files

### `src/services/timeLogComputeService.js`
`computeTimeLogSummary` now checks `BNC_COMPANY_IDS` early and delegates to `bncStrategy.computeBnC()` for matching companies. DayCare compute path is unchanged.

### `src/controllers/Features/timeLogController.js`

**`getUserTimeLogs`**
- Detects B&C via `BNC_COMPANY_IDS`
- Omits `regularSegmentHours`, `driverAmSegmentHours`, `driverPmSegmentHours`, and `overtime` from the response shape for B&C companies
- Adds `companyType: "BNC" | "DAYCARE"` to the response envelope

**`getCompanyTimeLogs`**
- Same `isBnC` detection and field suppression as above (`rawOtMinutes` also omitted for B&C)
- Adds `companyType: "BNC" | "DAYCARE"` to the response envelope
- **B&C shift resolution (new):** queries `UserShift` records by punch-date range (not today), then calls `matchShiftToWindow` per row so each punch shows its correct historical shift. `shiftToday` is now an array of shift name strings for B&C (was a comma-joined string).
- **DayCare shift resolution:** original today-based query behavior is fully preserved

---

## API Contract Changes

Both `GET /timelogs/user` and `GET /timelogs/company` now include:

```json
{
  "companyType": "BNC" | "DAYCARE"
}
```

For B&C responses, the following per-punch fields are absent (not `null` — omitted entirely):
- `regularSegmentHours`
- `driverAmSegmentHours`
- `driverPmSegmentHours`
- `rawOtMinutes`
- `overtime`

For B&C responses, `shiftToday` is an **array** (`string[]`) rather than a comma-joined string.

---

## No Breaking Changes for DayCare Clients

All DayCare response shapes, compute behavior, and shift resolution logic are identical to v2.7.6.
