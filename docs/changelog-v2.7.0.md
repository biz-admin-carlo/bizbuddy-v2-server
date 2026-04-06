# BizBuddy Server — v2.7.0 Change Log

> **Release Date:** 2026-04-06
> **Prepared for:** Web Client & iOS/Mobile Teams
> **Server Version:** v2.7.0 (from v2.6.0)
> **No breaking changes.** Everything in this release is additive — existing screens and integrations will continue to work without modification.

---

## Table of Contents

1. [Existing Endpoints — Response Shape Changed](#-existing-endpoints--response-shape-changed)
2. [New Fields — Leave Submission](#-new-fields--leave-submission)
3. [Behavior Changes](#-behavior-changes)
4. [Client Implementation Guide](#-client-implementation-guide)
5. [Summary Table](#-summary-table)

---

## 🟡 Existing Endpoints — Response Shape Changed

### 1. `GET /api/company-settings` — New Leave Accrual + Multi-Approval Fields

> **Affects:** Web (Company Settings)
> **Breaking:** No — all new fields are additive

Five new fields are now returned:

```json
{
  "data": {
    "accrualEnabled": false,
    "leaveYearStartMonth": 1,
    "newEmployeeCatchUp": false,
    "multiApprovalEnabled": false,
    "secondaryApproverId": null
  }
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `accrualEnabled` | `boolean` | `false` | Master on/off for leave accrual |
| `leaveYearStartMonth` | `number` (1–12) | `1` | Month the company's leave year begins. `1` = January, `4` = April, etc. |
| `newEmployeeCatchUp` | `boolean` | `false` | When `true`, new employees are credited for all months already elapsed in the current leave year instead of starting from zero |
| `multiApprovalEnabled` | `boolean` | `false` | Enables two-step leave approval for this company |
| `secondaryApproverId` | `string \| null` | `null` | User ID of the fixed company-wide final approver |

---

### 2. `PATCH /api/company-settings` — New Accepted Fields

> **Affects:** Web (Company Settings)
> **Breaking:** No

Now accepts all five fields above. Fields can be sent individually; omitted fields are preserved.

```json
{ "multiApprovalEnabled": true, "secondaryApproverId": "user-uuid" }
```

```json
{ "accrualEnabled": true, "leaveYearStartMonth": 4, "newEmployeeCatchUp": true }
```

**Validation:**
- `leaveYearStartMonth`: integer 1–12
- `secondaryApproverId`: must be a valid user ID in the company with role `admin`, `supervisor`, or `superadmin`
- All boolean fields: strict boolean

---

### 3. `GET /api/leaves/my` · `GET /api/leaves/pending` · `GET /api/leaves/` — New Fields on Leave Object

> **Affects:** Web + iOS/Mobile
> **Breaking:** No — new fields are additive

All leave read endpoints now return these additional fields per leave record:

| Field | Type | Notes |
|---|---|---|
| `isPaid` | `boolean` | `true` = paid leave, `false` = unpaid leave. Existing records default to `true` |
| `secondaryApproverId` | `string \| null` | ID of the secondary approver if multi-approval is on, otherwise `null` |
| `secondaryApproverComments` | `string \| null` | Comments left by the secondary approver on final approval or rejection |

The `status` field now has one additional possible value:

| Status | Meaning |
|---|---|
| `"pending"` | Awaiting first approver — unchanged |
| `"pending_secondary"` | **New** — first approver approved, awaiting final approver |
| `"approved"` | Fully approved — unchanged |
| `"rejected"` | Rejected by either approver — unchanged |
| `"cancelled"` | Cancelled — unchanged |

> **Action required:** Any UI that switches on `status` must add a case for `"pending_secondary"`. Suggested label: **"Pending Final Approval"**.

---

### 4. `GET /api/leaves/pending` — Now Includes Secondary Approver Queue

> **Affects:** Web + iOS/Mobile (Approver inbox)
> **Breaking:** No

Previously returned only leaves where the caller was the first approver (`status = "pending"`). Now also returns leaves where the caller is the **secondary approver** (`status = "pending_secondary"`).

Use the `status` field on each record to show the correct label and context to the approver.

---

### 5. `GET /api/leaves/` — Updated Status Filter + Secondary Approver Scope

> **Affects:** Web (Admin / Approver leave list)
> **Breaking:** No

Two changes:
1. `status` query param now accepts `"pending_secondary"` as a valid value (previously returned `400`)
2. Results now include leaves where the caller is the secondary approver, not just the first approver

---

## 🟢 New Fields — Leave Submission

### 6. `POST /api/leaves/submit` — `isPaid` Field

> **Affects:** Web + iOS/Mobile (Leave Request Form)
> **Breaking:** No — optional, defaults to `true`

Leave submissions now accept `isPaid` to distinguish paid from unpaid leave:

```json
{
  "type": "Sick Leave",
  "approverId": "user-uuid",
  "fromDate": "2026-04-10",
  "toDate": "2026-04-12",
  "leaveReason": "Feeling unwell.",
  "isPaid": false
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `isPaid` | `boolean` | No | `true` | `true` = paid, `false` = unpaid |

> Do **not** send `secondaryApproverId` — the server assigns it automatically from company settings.

---

## 🔵 Behavior Changes

### 7. Leave Approval — Two-Step Flow (Multi-Approval)

> **Affects:** Web + iOS/Mobile (Approver screens)
> **Breaking:** No — single-approval companies are completely unaffected

When `multiApprovalEnabled = true`, the existing `PUT /api/leaves/:id/approve` and `PUT /api/leaves/:id/reject` endpoints handle both stages automatically. Same endpoint, same request body — the server determines which stage the caller is acting on based on the leave's current status and the caller's identity.

**First approver (SV) approves a `"pending"` leave:**
- Status moves to `"pending_secondary"`
- No balance deduction yet
- Secondary approver receives `LEAVE_PENDING_SECONDARY_APPROVAL` notification
- Employee receives `LEAVE_REQUEST_FIRST_APPROVED` notification

**Secondary (final) approver approves a `"pending_secondary"` leave:**
- Status moves to `"approved"`
- Balance is deducted at this point
- Employee receives `LEAVE_REQUEST_APPROVED` notification

**Either approver rejects:**
- Status moves to `"rejected"` regardless of stage
- No balance deduction at any point on rejection
- Employee receives `LEAVE_REQUEST_REJECTED` notification

**Notification codes summary:**

| Code | Sent to | Trigger |
|---|---|---|
| `LEAVE_REQUEST_SUBMITTED` | All management | Employee submits |
| `LEAVE_REQUEST_FIRST_APPROVED` | Employee | SV approves (multi-approval only) |
| `LEAVE_PENDING_SECONDARY_APPROVAL` | Secondary approver | SV approves (multi-approval only) |
| `LEAVE_REQUEST_APPROVED` | Employee | Final approval (or single-approver approval) |
| `LEAVE_REQUEST_REJECTED` | Employee | Rejected by either approver |

**Single-approval companies (`multiApprovalEnabled = false`):**
Behaviour is completely unchanged — approve → `"approved"`, balance deducted immediately.

---

### 8. Auto Clock-Out Safeguard — Threshold Reduced to 5 Hours

> **Affects:** Web + iOS/Mobile
> **Breaking:** No

The auto clock-out safeguard now triggers after **5 hours** of an open session, down from 20 hours.

**What stays the same:**
- `timeOut` is still set to the employee's **scheduled shift end time** — not the trigger time
- `autoClockOut: true` flag still set for mandatory supervisor review

**Updated notification text:**

| Channel | Old | New |
|---|---|---|
| In-app message | "…13-hour limit reached" | "…5-hour limit reached" |
| Socket.IO `autoClockOut` message | "…after 13 hours of work" | "…after 5 hours of work" |
| Email subject | "13 Hour Limit Reached" | "5 Hour Limit Reached" |
| Email body | "maximum work limit of 13 hours" | "maximum work limit of 5 hours" |

No changes to the `autoClockOut` socket event shape or field names.

---

### 9. Leave Accrual — Full Rewrite

> **Affects:** Server only (background worker)
> **Breaking:** No — no API or response changes

The leave accrual worker has been fully rewritten.

**What changed:**

| Behaviour | Before | After |
|---|---|---|
| Company opt-in | All companies processed unconditionally | Only companies where `accrualEnabled = true` |
| Monthly cap | No cap — balance grew indefinitely | Hard-capped at `annualAllocation` per year |
| Yearly accrual | Not implemented | Grants full `annualAllocation` upfront on `leaveYearStartMonth` |
| New employee catch-up | First-time balance = 1 month only | Controlled by `newEmployeeCatchUp` — pro-rates all elapsed months if enabled |
| Carry-over | Not implemented | `carryOverAllowed` / `carryOverLimit` enforced at year reset |

**Pro-rating formula (monthly + new employee catch-up):**
```
monthsIntoYear   = ((currentMonth − leaveYearStartMonth + 12) % 12) + 1
initialBalance   = min(monthlyIncrement × monthsIntoYear, annualAllocation)
```

Example — leave year starts January, accrual enabled in April, `newEmployeeCatchUp = true`, 120h annual:
`(120 / 12) × 4 = 40 hours` credited on first accrual run.

**Carry-over at year reset:**
```
carryOverAllowed = false  →  balance resets to 0 before new allocation
carryOverAllowed = true   →  carry = min(currentBalance, carryOverLimit)
                              new balance = carry + annualAllocation
```

---

## 🛠 Client Implementation Guide

All changes are additive. The items below describe what each client team needs to build or update.

---

### A. Leave Request Form — Paid / Unpaid Toggle

**Screens:** Leave Request Form (Web + Mobile)

Add a toggle so employees can choose between Paid and Unpaid leave.

- **UI:** Segmented control or toggle row labelled **"Leave Type"**
- **Paid Leave** → send `isPaid: true`
- **Unpaid Leave** → send `isPaid: false`
- **Default:** Paid (`isPaid: true`) — pre-select to preserve existing behaviour

---

### B. Leave Record Display — Paid / Unpaid Badge + New Status

**Screens:** Leave History (employee), Approver Inbox, Admin Leave Table (Web + Mobile)

**Paid / Unpaid badge** — show on every leave record:
- `isPaid: true` → **Paid** label (green or neutral)
- `isPaid: false` → **Unpaid** label (orange or yellow)

**`pending_secondary` status** — update every place that switches on `status`:

| Status value | Display label |
|---|---|
| `pending` | Pending Approval |
| `pending_secondary` | Pending Final Approval |
| `approved` | Approved |
| `rejected` | Rejected |
| `cancelled` | Cancelled |

On the employee's leave history, `pending_secondary` means the SV approved but the final approver hasn't acted yet — show it clearly so the employee knows the request is still in progress.

---

### C. Approver Inbox — Secondary Approver Queue

**Screens:** Approver Inbox / Pending Leaves (Web + Mobile)

`GET /api/leaves/pending` now returns both first-approver and secondary-approver items. Use the `status` field to show the correct label per card:

| `status` | Label |
|---|---|
| `"pending"` | Awaiting your approval |
| `"pending_secondary"` | Awaiting your **final** approval |

The approve and reject buttons call the **same endpoints** as before — no changes needed to those actions.

---

### D. Company Settings — Leave Accrual Section

**Screen:** Company Settings / Configurations (Web — Admin only)

Add a **Leave Accrual** section. All fields are read from `GET /api/company-settings` and saved via `PATCH /api/company-settings`.

| Field | UI | Label | Show condition |
|---|---|---|---|
| `accrualEnabled` | Toggle | Enable Leave Accrual | Always |
| `leaveYearStartMonth` | Dropdown (Jan–Dec) | Leave Year Start Month | When `accrualEnabled = true` |
| `newEmployeeCatchUp` | Toggle | Credit New Employees for Elapsed Months | When `accrualEnabled = true` |

**`newEmployeeCatchUp` description:** "When on, new employees are credited for all months already passed in the current leave year instead of starting from zero."

---

### E. Company Settings — Leave Approval Section

**Screen:** Company Settings / Configurations (Web — Admin only)

Add a **Leave Approval** section (or fold into existing Leave Settings).

| Field | UI | Label | Show condition |
|---|---|---|---|
| `multiApprovalEnabled` | Toggle | Enable Two-Step Leave Approval | Always |
| `secondaryApproverId` | User picker (admin/sv/superadmin only) | Final Approver | When `multiApprovalEnabled = true` |

**`multiApprovalEnabled` description:** "When enabled, leave requests are first approved by the employee's selected supervisor, then by a company-wide final approver."

**`secondaryApproverId` is required when `multiApprovalEnabled = true`** — validate before saving.

> When `multiApprovalEnabled` is turned off, `secondaryApproverId` can remain as-is on the server — it will be ignored.

---

### F. Auto Clock-Out Copy

**Screens:** Any screen with hardcoded clock-out copy (Web + Mobile)

Update any hardcoded references from "13 hours" or "20 hours" → **5 hours**.

The `autoClockOut` socket event shape is unchanged — only the message string is different.

---

### G. Leave Policy Settings — No UI Changes Needed

The existing Leave Policy UI (`accrualFrequency`, `annualAllocation`, `carryOverAllowed`, etc.) requires no changes. Be aware that balances are now correctly bounded:
- Balance will no longer grow past `annualAllocation`
- `carryOverAllowed` / `carryOverLimit` are now enforced at year reset
- `accrualFrequency = "yearly"` is now supported

---

## 📋 Summary Table

| # | Change | Endpoint / Component | Affects | Breaking |
|---|---|---|---|---|
| 1 | Accrual + multi-approval fields in response | `GET /api/company-settings` | Web | 🟢 No |
| 2 | Accrual + multi-approval fields accepted | `PATCH /api/company-settings` | Web | 🟢 No |
| 3 | `isPaid`, `secondaryApproverId`, `secondaryApproverComments` on leave objects | All leave read endpoints | Web + Mobile | 🟢 No |
| 4 | `pending_secondary` status value added | All leave read endpoints | Web + Mobile | 🟢 No |
| 5 | Secondary approver queue included | `GET /api/leaves/pending` | Web + Mobile | 🟢 No |
| 6 | Status filter + secondary scope | `GET /api/leaves/` | Web | 🟢 No |
| 7 | `isPaid` field on leave submission | `POST /api/leaves/submit` | Web + Mobile | 🟢 No |
| 8 | Two-step approval flow | `PUT /api/leaves/:id/approve` + `reject` | Web + Mobile | 🟢 No |
| 9 | Auto clock-out threshold 20h → 5h | Cron + notifications | Web + Mobile | 🟢 No |
| 10 | Leave accrual worker rewrite | Background worker | Server only | 🟢 No |

---

*Generated by BizBuddy Backend Team — v2.7.0 — 2026-04-06*
