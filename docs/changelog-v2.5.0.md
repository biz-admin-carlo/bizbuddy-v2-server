# BizBuddy Server — v2.5.0 Client Change Log

> **Release Date:** 2026-03-28
> **Prepared for:** Web Client & iOS/Mobile Teams
> **Server Version:** v2.5.0 (from v2.4.0)

---

## Table of Contents

1. [Breaking Changes](#-breaking-changes--must-update)
2. [Existing Endpoints — Response Shape Changed](#-existing-endpoints--response-shape-changed)
3. [New Endpoints](#-new-endpoints)
4. [Socket Notifications — New Codes](#-socket-notifications--16-new-codes)
5. [Security — Rate Limiting](#-security--rate-limiting)
6. [Behavior Changes](#-behavior-changes)
7. [Summary Table](#-summary-table)

---

## 🟢 New Login Endpoint — Recommended Migration

### 1. New `POST /api/account/login`

> **Affects:** Web + iOS/Mobile
> **Priority:** Migrate when ready — old endpoint remains working
> **Why:** Credentials in GET query params get logged in server logs, browser history, and proxies. The new endpoint sends credentials in the request body.

**New endpoint (use this going forward):**
```
POST /api/account/login
Content-Type: application/json

{
  "email": "user@co.com",
  "password": "yourpassword",
  "companyId": "clxxx..."
}
```

**Old endpoint (still works — no rush):**
```
GET /api/account/sign-in?email=user@co.com&password=pass&companyId=xxx
```

**Response** (same for both):
```json
{
  "message": "Sign-in successful.",
  "data": {
    "token": "eyJ...",
    "lastLoginAt": "2026-03-26T10:30:00.000Z"
  }
}
```

> `lastLoginAt` is the timestamp of the user's **previous** session. Returns `null` on first login.

---

## 🔴 Breaking Changes — Must Update

### 2. `GET /api/request-punch-log/all` — `total` Field Moved

> **Affects:** Web + iOS/Mobile

**Before:**
```json
{ "message": "...", "total": 10, "data": [...] }
```

**After:**
```json
{
  "message": "...",
  "data": [...],
  "pagination": { "total": 10, "limit": 50, "offset": 0, "hasMore": false }
}
```

> `total` is now inside `pagination`. Update any code reading `response.total`.

---

### 3. `GET /api/usershifts/company-stats` — Fields Renamed

> **Affects:** Web + iOS/Mobile

**Before:**
```json
{
  "totalEmployees": 20,
  "employeesWithShifts": 15,
  "employeesWithoutShifts": 5,
  "coverageRate": "75.0%"
}
```

**After:**
```json
{
  "totalEmployees": 20,
  "withShifts": 15,
  "withoutShifts": 5,
  "coverage": 75.0,
  "totalShiftsThisMonth": 45,
  "month": "2026-03"
}
```

> `coverage` is now a **number** (not a string). `totalShiftsThisMonth` and `month` are new additions.

---

## 🟡 Existing Endpoints — Response Shape Changed

### 4. Pagination on 3 Endpoints

> **Affects:** Web + iOS/Mobile
> **Note:** Old calls with no params still work — defaults to first 50 records

All three endpoints now accept query params and return a `pagination` object:

```
GET /api/overtime?limit=50&offset=0&status=pending
GET /api/leaves?limit=50&offset=0&status=pending
GET /api/request-punch-log/all?limit=50&offset=0&status=PENDING
```

**Query Params:**

| Param | Type | Default | Max | Description |
|---|---|---|---|---|
| `limit` | number | 50 | 200 | Records per page |
| `offset` | number | 0 | — | Records to skip |
| `status` | string | — | — | Optional status filter |

**Response now includes:**
```json
{
  "data": [...],
  "pagination": {
    "total": 320,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

> Use `hasMore` to drive infinite scroll or pagination controls.

---

### 5. `GET /api/account/profile` — New Field on User Object

> **Affects:** Web + iOS/Mobile

`data.user` now includes `lastLoginAt`:

```json
{
  "data": {
    "user": {
      "lastLoginAt": "2026-03-26T10:30:00.000Z"
    }
  }
}
```

> Use this to show "Last active" on the profile screen. Returns `null` if user has never logged in before.

---

## 🟢 New Endpoints

### 6. `GET /api/dashboard/sidebar-stats`

> **Affects:** Web + iOS/Mobile
> **Purpose:** Replaces up to 6 parallel sidebar requests with a single call

```
GET /api/dashboard/sidebar-stats
Authorization: Bearer <token>
Roles allowed: admin, superadmin, supervisor
```

**Response:**
```json
{
  "data": {
    "unscheduledEmployees": 3,
    "pendingContestLogs": 2,
    "pendingOvertimeRequests": 5,
    "pendingLeaveRequests": 1,
    "pendingDeletionRequests": 0,
    "lockedCutoffPeriods": 1,
    "subscriptionEndDate": "2026-04-15T00:00:00.000Z"
  }
}
```

**Notes:**
- All counts are always integers — never `null`. Safe to render directly.
- `subscriptionEndDate` replaces the need to call `/api/account/profile` just for subscription expiry.
- On server error, endpoint still returns `200` with all zeroes — sidebar will never crash.

---

### 7. `POST /api/employee/bulk` — Bulk Employee Creation

> **Affects:** Web (admin feature)
> **Roles allowed:** admin, superadmin

```
POST /api/employee/bulk
Authorization: Bearer <token>
Content-Type: application/json

{
  "employees": [
    {
      "email": "juan@company.com",
      "password": "TempPass123",
      "firstName": "Juan",
      "lastName": "dela Cruz",
      "role": "employee",
      "departmentId": "...",
      "jobTitle": "..."
    }
  ]
}
```

**Response (HTTP 207 Multi-Status):**
```json
{
  "message": "Bulk creation complete. 5 created, 1 failed.",
  "data": {
    "created": [...],
    "failed": [
      { "index": 2, "email": "duplicate@co.com", "reason": "Email already exists" }
    ]
  }
}
```

**Notes:**
- Maximum **100 employees** per request.
- Partial success is supported — failed rows do not block successful ones.
- Each successfully created employee automatically receives a welcome email with credentials.
- Usernames are auto-generated if not provided (see [Username Format](#-behavior-changes)).

---

## 🔔 Socket Notifications — 16 New Codes

> **Affects:** Web + iOS/Mobile
> **Note:** Register handlers for each in your socket/notification layer

**Payload shape for all notification events:**
```json
{
  "id": "notification_id",
  "type": "LEAVE_REQUEST_APPROVED",
  "title": "Leave Request Approved",
  "message": "Your leave request from Mar 25 to Mar 27 has been approved.",
  "payload": { "leaveId": "...", "startDate": "...", "endDate": "..." },
  "createdAt": "2026-03-27T10:00:00.000Z",
  "seen": false
}
```

**New notification codes:**

| Code | Recipient | Trigger |
|---|---|---|
| `SCHEDULE_ASSIGNED` | Employee | Direct shift assigned |
| `SCHEDULE_UPDATED` | Employee | Recurring schedule assigned |
| `SCHEDULE_REPLACED` | Employee | Shift replaced |
| `LEAVE_REQUEST_SUBMITTED` | Management | Employee submits leave |
| `LEAVE_REQUEST_APPROVED` | Employee | Leave approved |
| `LEAVE_REQUEST_REJECTED` | Employee | Leave rejected |
| `OVERTIME_REQUEST_SUBMITTED` | Management | Employee submits OT request |
| `OVERTIME_REQUEST_APPROVED` | Employee | OT approved |
| `OVERTIME_REQUEST_REJECTED` | Employee | OT rejected |
| `CONTEST_REQUEST_SUBMITTED` | Management | Employee submits time correction |
| `CONTEST_REQUEST_APPROVED` | Employee | Time correction approved |
| `CONTEST_REQUEST_REJECTED` | Employee | Time correction rejected |
| `PAYSLIP_GENERATED` | Employee | Payslip generated |
| `CUTOFF_PERIOD_LOCKED` | Management | Cutoff period locked |
| `CUTOFF_PROCESSED` | All employees | Cutoff period processed |
| `DELETION_REQUEST_SUBMITTED` | Management | Employee requests account deletion |

**iOS/Mobile Recommended Actions per Code:**

| Code | Suggested Action |
|---|---|
| `SCHEDULE_ASSIGNED` / `SCHEDULE_UPDATED` | Deep link → Schedule screen |
| `LEAVE_REQUEST_APPROVED` / `REJECTED` | Deep link → Leave history |
| `OVERTIME_REQUEST_APPROVED` / `REJECTED` | Deep link → OT history |
| `CONTEST_REQUEST_APPROVED` / `REJECTED` | Deep link → Time correction history |
| `PAYSLIP_GENERATED` | Deep link → Payslips screen |
| `CUTOFF_PROCESSED` | Refresh payroll/payslip data |
| Management codes | Deep link → relevant approval screen |

---

## 🔒 Security — Rate Limiting

> **Affects:** Web + iOS/Mobile
> **Action required:** Handle `429` responses gracefully

| Endpoint | Limit |
|---|---|
| `POST /api/account/sign-in` | 20 attempts / 15 min per IP |
| `POST /api/account/sign-up` | 20 attempts / 15 min per IP |
| All `/api/*` routes | 500 requests / 15 min per IP |

**429 Response:**
```json
{ "message": "Too many login attempts, please try again in 15 minutes." }
```

**Recommended handling:**
- Show a user-friendly cooldown message on the login screen.
- **Do not auto-retry** on 429 — implement exponential backoff if retry is needed.
- Update badge/error UI to distinguish 429 from 401.

---

## 🔵 Behavior Changes

### Username Auto-Generation Format Changed

> **Affects:** Web + iOS/Mobile (display only)

Usernames are now auto-generated as **first initial + last name** (lowercased):

| Name | Generated Username |
|---|---|
| Carlo Corcuera | `ccorcuera` |
| Juan dela Cruz | `jdelacruz` |
| Maria Santos | `msantos` |

Duplicates auto-increment: `ccorcuera`, `ccorcuera1`, `ccorcuera2`

> If your app displays the username anywhere, update the expected format. Users can still override with a custom username.

---

## 📋 Summary Table

| # | Change | Endpoint | Affects | Breaking |
|---|---|---|---|---|
| 1 | Sign-in GET → POST | `POST /api/account/sign-in` | Web + Mobile | 🔴 Yes |
| 2 | `total` moved to `pagination` | `GET /api/request-punch-log/all` | Web + Mobile | 🔴 Yes |
| 3 | Company stats fields renamed | `GET /api/usershifts/company-stats` | Web + Mobile | 🔴 Yes |
| 4 | Pagination added | `GET /api/overtime` `GET /api/leaves` `GET /api/request-punch-log/all` | Web + Mobile | 🟡 Soft |
| 5 | `lastLoginAt` on profile | `GET /api/account/profile` | Web + Mobile | 🟢 No |
| 6 | Sidebar stats endpoint | `GET /api/dashboard/sidebar-stats` | Web + Mobile | 🟢 New |
| 7 | Bulk employee creation | `POST /api/employee/bulk` | Web | 🟢 New |
| 8 | 16 new socket notification codes | Socket events | Web + Mobile | 🟢 New |
| 9 | Rate limiting — 429 on auth | All `/api/*` routes | Web + Mobile | 🟡 Soft |
| 10 | Username format changed | Employee creation | Web + Mobile | 🟢 No |

---

*Generated by BizBuddy Backend Team — v2.5.0 — 2026-03-27*
