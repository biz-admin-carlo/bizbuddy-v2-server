# Changelog — v2.10.13

> DayCare exclusive. BNC and Regular punch types unaffected.

---

## Features

### BB-024 — Early Clock-Out Grace Period (DA/PM snap)

Introduces a new company-level setting, **Early Clock-Out Grace Period**, that automatically snaps a Driver/Aide or Driver PM clock-out to the scheduled PM shift end when the employee punches out within the configured window. For regular employees, early clock-out continues to count as undertime as before.

**Files changed:**
- `src/prisma/schema.prisma`
- `src/services/timeLogComputeService.js`
- `src/controllers/Account/companySettingsController.js`
- `scripts/migrate-early-clockout-grace.sql` *(run manually)*

---

#### Schema

New field on `Company`:

```prisma
earlyClockOutGraceMinutes  Int?  @default(20)
```

Migration:
```sql
ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "earlyClockOutGraceMinutes" INTEGER DEFAULT 20;
```

---

#### Snap Logic — `timeLogComputeService.js`

New **section 4b** runs after the shift catalog is resolved and before any computed fields are derived:

- Applies only when `punchType` is `DRIVER_AIDE` or `DRIVER_AIDE_PM`
- Resolves the PM shift end from the assigned `UserShift` or the company's catalog (`Driver/Aide PM Shift`)
- If `timeOut < pmEnd` and `(pmEnd − timeOut) ≤ earlyClockOutGraceMinutes`, `timeOut` is reassigned to `pmEnd`
- The snapped value is **persisted to the DB** (`TimeLog.timeOut`) so all views and downstream consumers reflect it
- Affects: `timeOut`, `grossHours`, `driverPmSegmentHours`, `undertimeHours`, `netWorkedHours`
- Does **not** affect `DRIVER_AIDE_AM`-only punches or `REGULAR` punches

**Examples (grace = 20 min, PM end = 14:45):**

| Raw clock-out | Early by | Result |
|---|---|---|
| 14:38 | 7 min | Snapped → 14:45 |
| 14:25 | 20 min | Snapped → 14:45 |
| 14:24 | 21 min | No snap — undertime as normal |

---

#### Company Settings API

**`GET /company-settings`** — new field in response:
```json
{ "earlyClockOutGraceMinutes": 20 }
```

**`PATCH /company-settings`** — new accepted field:

| Field | Type | Validation | Default |
|---|---|---|---|
| `earlyClockOutGraceMinutes` | `integer` | positive integer; `null` resets to `20` | `20` |

---

#### Client-Side Requirements

Add a numeric input for `earlyClockOutGraceMinutes` in the Company Settings page alongside the existing `earlyClockInGraceMinutes` field.

- **Label:** `Early Clock-Out Grace Period`
- **Input:** numeric, minutes, positive integer only
- **Helper text:** *"Driver/Aide and Driver PM employees who clock out within this window before their scheduled PM shift end will have their clock-out snapped to the shift end time. Does not apply to regular employees."*
- **Visibility:** DayCare companies only (same condition as `earlyClockInGraceMinutes` and `driverAideThresholdMinutes`)

---

#### Backfill — May 13–26 (company `cmnegwuxm0004rf7fzo6wjrw2`)

Estimate showed **52 affected logs** out of 182 DA/PM logs in the period. None were already approved.

Scripts (run in order):
1. `scripts/estimate-early-clockout-snap.sql` — read-only impact estimate
2. `scripts/pilot-early-clockout-snap.js` — dry-run on 5 logs to verify before/after
3. `scripts/backfill-early-clockout-snap.js` — full backfill; auto-generates `scripts/rollback-early-clockout-snap.sql` before making any changes

To revert:
```bash
psql <connection-string> -f scripts/rollback-early-clockout-snap.sql
```
