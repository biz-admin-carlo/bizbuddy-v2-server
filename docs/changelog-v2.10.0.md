# Changelog — v2.10.0

## Summary

Two bug fixes.

- **BB-005** — Deleting an employee now completes cleanly by removing all non-cascading related records before the user row is dropped.
- **BB-006** — Punch log request clock times are now correctly interpreted in company timezone. Naive timestamps from older mobile clients are handled gracefully via a server-side fallback. Mobile client update required (see below).

---

## BB-005 — Employee Deletion FK Constraint Fix

### Problem

`DELETE /api/employee/:id` failed with a Prisma `P2003` foreign key constraint error:

```
Foreign key constraint violated: `LocationRestriction_userId_fkey (index)`
```

The deletion sequence only deleted `UserShift` records before calling `prisma.user.delete()`. Several other tables reference `User.id` without `onDelete: Cascade` in the schema, so Postgres blocked the delete.

Affected relations (no cascade defined):

| Table | Column | Nullable |
|---|---|---|
| `UserShift` | `userId` | No — already handled |
| `LocationRestriction` | `userId` | No |
| `UserActivity` | `userId` | No |
| `CutoffOtBlock` | `userId` | No |
| `CutoffOtBlock` | `approvedBy` | Yes |

### Changes

#### `src/controllers/Features/employeeController.js` — `deleteEmployee`

Added four cleanup steps before `prisma.user.delete()`:

```js
await prisma.userShift.deleteMany({ where: { userId: id } });
await prisma.locationRestriction.deleteMany({ where: { userId: id } });
await prisma.userActivity.deleteMany({ where: { userId: id } });
await prisma.cutoffOtBlock.updateMany({ where: { approvedBy: id }, data: { approvedBy: null } });
await prisma.cutoffOtBlock.deleteMany({ where: { userId: id } });
await prisma.user.delete({ where: { id } });
```

- `locationRestriction.deleteMany` — removes geo-fence restrictions tied to the user.
- `userActivity.deleteMany` — removes activity log entries tied to the user.
- `cutoffOtBlock.updateMany` — nulls out `approvedBy` for any OT blocks this user approved (field is nullable; preserves the block records for the employees they belong to).
- `cutoffOtBlock.deleteMany` — removes the user's own OT block records.

---

## BB-006 — Punch Log Request Timezone Fix

### Problem

`POST /request-punch-log/submit` stored `requestedClockIn` and `requestedClockOut` incorrectly when the mobile client sent naive ISO strings without a timezone offset (e.g. `"2026-05-01T08:00:00"`).

The production server runs in UTC, so `new Date("2026-05-01T08:00:00")` stored the literal hour as UTC. The web dashboard then applied the company's UTC offset on top, shifting the displayed time forward — e.g. 8:00 AM PHT submitted from mobile appeared as 4:00 PM on web.

The web client was unaffected because it runs in the same environment as the dev server (PHT), making the naive parsing coincidentally correct.

### Root cause

`requestedClockIn` and `requestedClockOut` are `TIMESTAMP(3)` columns (no timezone). Prisma stores whatever UTC value JavaScript's `Date` resolves to. On a UTC server, a naive string like `"2026-05-01T08:00:00"` resolves to `2026-05-01T08:00:00.000Z` instead of the intended `2026-05-01T00:00:00.000Z` (for a PHT company).

### Changes

#### `src/controllers/Features/requestPunchLogController.js` — `submitRequestPunchLog`

Added `parseClockTime()` helper at the top of the file:

```js
function parseClockTime(str, companyTimezone) {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(str)) {
    return new Date(str);
  }
  return moment.tz(str, companyTimezone).toDate();
}
```

- If the string carries a timezone offset (`Z` or `±HH:MM`), it is parsed as-is — no change for correctly formatted clients.
- If the string is naive (no offset), it is interpreted as local time in the company's configured timezone using `moment.tz()`.

Replaced the bare `new Date()` calls with `parseClockTime()`:

```js
const company = await prisma.company.findUnique({
  where: { id: req.user.companyId },
  select: { timeZone: true },
});
const companyTimezone = company?.timeZone || "UTC";

const clockIn  = parseClockTime(requestedClockIn,  companyTimezone);
const clockOut = parseClockTime(requestedClockOut, companyTimezone);
```

Also fixed the duplicate-log date-range check to anchor boundaries in company timezone instead of raw UTC midnight:

```js
const dayStart = moment.tz(requestedDate, companyTimezone).startOf("day").toDate();
const dayEnd   = moment.tz(requestedDate, companyTimezone).endOf("day").toDate();
```

### Mobile client update required

The server fix is a backward-compatible fallback. The mobile client must be updated to send timestamps as UTC:

- Use `company.timeZone` (IANA, e.g. `"Asia/Manila"`) to interpret the user's input as company local time, then convert to UTC before sending.
- **Do not use the device's local timezone.**

**Before (buggy):**
```json
"requestedClockIn":  "2026-05-01T08:00:00"
"requestedClockOut": "2026-05-01T17:00:00"
```

**After (correct):**
```json
"requestedClockIn":  "2026-05-01T00:00:00.000Z"
"requestedClockOut": "2026-05-01T09:00:00.000Z"
```

Once all mobile clients are on the fixed version the `parseClockTime` fallback branch can be removed.
