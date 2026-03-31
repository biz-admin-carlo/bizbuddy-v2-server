# BizBuddy Server — v2.6.0 Client Change Log

> **Release Date:** 2026-03-31
> **Prepared for:** Web Client & iOS/Mobile Teams
> **Server Version:** v2.6.0 (from v2.5.0)

---

## Table of Contents

1. [Existing Endpoints — Response Shape Changed](#-existing-endpoints--response-shape-changed)
2. [New Endpoints](#-new-endpoints)
3. [Behavior Changes](#-behavior-changes)
4. [Bug Fixes](#-bug-fixes)
5. [Summary Table](#-summary-table)

---

## 🟡 Existing Endpoints — Response Shape Changed

### 1. `GET /api/company-settings` — New Fields

> **Affects:** Web + iOS/Mobile
> **Breaking:** No — all new fields are additive

Three new fields are now returned:

```json
{
  "data": {
    "timezone": "America/Los_Angeles",
    "defaultShiftHours": 8,
    "gracePeriodMinutes": 15,
    "otBasis": "daily",
    "dailyOtThresholdHours": 8,
    "weeklyOtThresholdHours": 40,
    "cutoffOtThresholdHours": 80,
    "driverAideThresholdMinutes": 45
  }
}
```

**New fields:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `weeklyOtThresholdHours` | `number` | `40` | Weekly cumulative OT threshold |
| `cutoffOtThresholdHours` | `number` | `80` | Cutoff-period cumulative OT threshold |
| `driverAideThresholdMinutes` | `number` | `45` | DayCare only — minutes early/late that triggers Driver-Aide modal |

> **DayCare note:** `driverAideThresholdMinutes` is configurable per company via **Company Configurations → DayCare Settings**. Only DayCare companies will configure it. Non-DayCare clients can safely ignore it. Client should fall back to `45` if absent or `null`.

---

### 2. `PATCH /api/company-settings` — New Accepted Field

> **Affects:** Web (DayCare companies only)
> **Breaking:** No

Now accepts `driverAideThresholdMinutes` in the request body:

```json
{ "driverAideThresholdMinutes": 45 }
```

**Validation:** Must be a positive integer > 0. If omitted or `null`, the existing stored value is preserved.

---

### 3. `GET /api/departments` — New Fields Per Department

> **Affects:** Web + iOS/Mobile
> **Breaking:** No

Each department object now includes auto-lunch configuration:

```json
{
  "id": "dept-uuid",
  "name": "Teachers",
  "paidBreak": true,
  "autoLunchDurationMinutes": 60,
  "autoLunchAfterHours": 4
}
```

**New fields:**

| Field | Type | Default | Notes |
|---|---|---|---|
| `autoLunchDurationMinutes` | `number` | `60` | Minutes deducted for auto-lunch |
| `autoLunchAfterHours` | `number` | `4.0` | Hours worked before auto-lunch triggers |

> Only meaningful when `paidBreak: true`. If `paidBreak: false`, ignore these fields.

---

### 4. `PUT /api/departments/update/:id` — New Accepted Fields

> **Affects:** Web (admin feature)
> **Breaking:** No

Now accepts `autoLunchDurationMinutes` and `autoLunchAfterHours` individually (sent on field blur):

```json
{ "autoLunchDurationMinutes": 60 }
```
```json
{ "autoLunchAfterHours": 4 }
```

**Validation:**
- `autoLunchDurationMinutes`: integer >= 1
- `autoLunchAfterHours`: float >= 0.5
- If omitted or `null`, the existing value is preserved

---

### 5. `GET /api/employment-details/me` — Department Auto-Lunch Fields Included

> **Affects:** Web + iOS/Mobile (Punch screen)
> **Breaking:** No

The `department` object in the response now includes auto-lunch config:

```json
{
  "data": {
    "jobTitle": "Teacher",
    "departmentId": "dept-uuid",
    "department": {
      "id": "dept-uuid",
      "name": "Teachers",
      "paidBreak": true,
      "autoLunchDurationMinutes": 60,
      "autoLunchAfterHours": 4
    }
  }
}
```

> Read these on mount in `Punch.jsx`. Show the auto-lunch warning banner when `paidBreak: true` and the employee has been clocked in for longer than `autoLunchAfterHours` without taking a manual lunch break.

---

### 6. `POST /api/timelogs/time-out` — New Optional Body Fields

> **Affects:** Web + iOS/Mobile (Punch screen)
> **Breaking:** No — fields are optional

When the auto-lunch threshold is crossed and the employee never took a manual lunch, include:

```json
{
  "autoLunchApplied": true,
  "autoLunchMinutes": 60
}
```

**Server behavior:**
- `autoLunchApplied: true` + `autoLunchMinutes` present → deducts minutes from the session and records `autoLunchDeductionMinutes` on the timelog for payroll audit
- Fields absent or `autoLunchApplied: false` → no deduction

> **Rule:** If `lunchElapsed > 0` (employee took a manual lunch), never send `autoLunchApplied`. Manual break takes precedence.

---

### 7. `GET /api/overtime/smart-detect` — OT-Config-Aware Filtering

> **Affects:** Web (Punch Logs / OT admin)
> **Breaking:** No — old behavior preserved when `otBasis` is absent

Now accepts query parameters to filter based on the company's configured OT basis:

| Param | Type | When sent |
|---|---|---|
| `otBasis` | `"daily"` \| `"weekly"` \| `"cutoff"` | Always |
| `threshold` | `number` | Always |
| `periodStart` | ISO date | Only when `otBasis=cutoff` |
| `periodEnd` | ISO date | Only when `otBasis=cutoff` |

**Example requests:**
```
GET /api/overtime/smart-detect?otBasis=daily&threshold=8
GET /api/overtime/smart-detect?otBasis=weekly&threshold=40
GET /api/overtime/smart-detect?otBasis=cutoff&threshold=80&periodStart=2026-03-16&periodEnd=2026-03-31
```

**Per-basis behavior:**
- `daily` — each session evaluated independently vs threshold
- `weekly` — cumulative per employee within the current Mon–Sun week
- `cutoff` — cumulative per employee within `periodStart`/`periodEnd`
- No `otBasis` — falls back to legacy scheduled-vs-actual detection (unchanged)

The `overtimeHours` field on each returned record reflects hours contributed above the threshold.

---

### 8. `GET /api/shiftschedules` — New Query Params

> **Affects:** Web (Employees page)
> **Breaking:** No — existing calls with no params unchanged

Now supports filtering by department and status:

```
GET /api/shiftschedules?departmentId=dept-uuid&status=active
```

| Param | Type | Description |
|---|---|---|
| `departmentId` | `string` | Returns schedules where `assignmentType="department"` and `targetId=departmentId` |
| `status` | `"active"` | Returns only `isActive=true` schedules with `endDate` in the future |

---

## 🟢 New Endpoints

### 9. `POST /api/shiftschedules/:scheduleId/apply-to-employee`

> **Affects:** Web (Employees page — Schedule Inherit Modal)
> **Roles:** admin, supervisor, superadmin

Applies an existing recurring schedule to a single employee by generating their `UserShift` records.

**Request body:**
```json
{ "employeeId": "user-uuid" }
```

**Server behavior:**
- Generates `UserShift` records for every date in `startDate`–`endDate` that falls on the schedule's `daysOfWeek`
- **Always skip-on-conflict** — never overwrites existing `UserShift` records
- Returns a created/skipped summary

**Response:**
```json
{
  "message": "Schedule applied successfully",
  "data": {
    "created": 52,
    "skipped": 3
  }
}
```

**Validation errors:**
- `404` — schedule not found or doesn't belong to this company
- `404` — employee not found or doesn't belong to this company
- `400` — schedule is inactive or expired

> The client calls this once per selected schedule. For multiple selected schedules, call sequentially.

---

### 10. `POST /api/feedback`

> **Affects:** Web (all roles — Feedback Widget)
> **Auth:** Required (any authenticated role)

Submits in-app feedback. Saves to DB and forwards to Google Sheets via webhook.

**Request body:**
```json
{
  "category": "bug",
  "title": "Clock-out button not responding",
  "description": "Steps to reproduce: 1. Clock in. 2. Wait 30 min. 3. Click clock-out.",
  "page": "/dashboard/employee/timekeeping/punch",
  "submittedAt": "2026-03-31T10:23:00.000Z",
  "submittedBy": {
    "name": "Jane Doe",
    "email": "jane@company.com",
    "role": "employee"
  },
  "userAgent": "Mozilla/5.0 ...",
  "screenResolution": "1920x1080"
}
```

**Field reference:**

| Field | Required | Notes |
|---|---|---|
| `category` | Yes | `"bug"` \| `"suggestion"` \| `"question"` \| `"other"` — **lowercase** |
| `title` | Yes | Min 3 characters |
| `description` | Yes | |
| `page` | No | Current route/pathname |
| `submittedAt` | No | ISO timestamp from client; falls back to server time |
| `submittedBy` | No | Falls back to auth token data if absent |
| `userAgent` | No | `navigator.userAgent` — server parses browser/OS/device for webhook only (not stored in DB) |
| `screenResolution` | No | `window.screen.width + 'x' + window.screen.height` |

**Response:**
```json
{
  "message": "Feedback submitted successfully.",
  "data": {
    "id": "feedback-uuid",
    "logNumber": 1000
  }
}
```

> Show `logNumber` in the thank-you state — e.g. *"Your feedback has been logged as #1000."*

**Validation errors:**
- `400` — missing `category`, `title`, or `description`
- `400` — invalid `category` value
- `400` — `title` shorter than 3 characters

---

## 🔵 Behavior Changes

### Welcome Email — Single Employee Creation

> **Affects:** Web (Employee management)

`POST /api/employee` (single employee creation) now sends a welcome email with login credentials, matching the behavior of `POST /api/employee/bulk`. Previously only bulk creation sent the email.

---

## 🐛 Bug Fixes

| # | Endpoint | Issue | Fix |
|---|---|---|---|
| 1 | `PATCH /api/company-settings` | `ReferenceError: otBasis is not defined` — field was used but never destructured from `req.body` | Added `otBasis` to destructure |
| 2 | `DELETE /api/employee/:id` | `Foreign key constraint violated: UserShift_userId_fkey` when deleting an employee with assigned shifts | Now deletes `UserShift` records before deleting the user |
| 3 | `GET /api/company/me/schedule-stats` | `OR: [{ endDate: { equals: null } }]` caused Prisma validation error — `endDate` is non-nullable | Replaced `OR` with `isActive: true, endDate: { gte: now }` |
| 4 | Morning report cron job | `ReferenceError: Cannot access 'timezone' before initialization` — variable used before declaration | Moved `const timezone = ...` before the `console.log` that referenced it |

---

## 📋 Summary Table

| # | Change | Endpoint | Affects | Breaking |
|---|---|---|---|---|
| 1 | OT thresholds + driver-aide threshold in response | `GET /api/company-settings` | Web + Mobile | 🟢 No |
| 2 | `driverAideThresholdMinutes` accepted | `PATCH /api/company-settings` | Web (DayCare) | 🟢 No |
| 3 | Auto-lunch fields on departments | `GET /api/departments` | Web + Mobile | 🟢 No |
| 4 | Auto-lunch fields accepted | `PUT /api/departments/update/:id` | Web | 🟢 No |
| 5 | Department auto-lunch in employment details | `GET /api/employment-details/me` | Web + Mobile | 🟢 No |
| 6 | Auto-lunch deduction on time-out | `POST /api/timelogs/time-out` | Web + Mobile | 🟢 No |
| 7 | OT-config-aware filtering | `GET /api/overtime/smart-detect` | Web | 🟢 No |
| 8 | Department + status filter | `GET /api/shiftschedules` | Web | 🟢 No |
| 9 | Apply schedule to employee | `POST /api/shiftschedules/:id/apply-to-employee` | Web | 🟢 New |
| 10 | Feedback submission | `POST /api/feedback` | Web | 🟢 New |
| 11 | Welcome email on single employee create | `POST /api/employee` | Web | 🟢 New |
| 12 | Bug fix: `otBasis` undefined | `PATCH /api/company-settings` | Web | 🐛 Fix |
| 13 | Bug fix: delete employee FK constraint | `DELETE /api/employee/:id` | Web | 🐛 Fix |
| 14 | Bug fix: schedule stats query | `GET /api/company/me/schedule-stats` | Web | 🐛 Fix |
| 15 | Bug fix: morning report crash | Cron job | Server | 🐛 Fix |

---

*Generated by BizBuddy Backend Team — v2.6.0 — 2026-03-31*
