# Superadmin Cross-Company Access — Deferred Feature

**Session Date:** 2026-04-03  
**Status:** PARKED — deferred in favor of simpler approach (shared admin email per company)  
**Branch:** `feature/superadmin-cross-company-access`

---

## Why It Was Parked

The full implementation requires significant client-side changes across 47+ files (apiFetch utility rollout, login flow branching, sidebar restructure, company switcher). The scope was too large to absorb right now. The immediate need is handled by manually adding a uniform support email as `admin` to each company instead.

---

## Goal (Original)

Implement a platform-level support account that:
- Is not bound to any single company (`companyId: null`)
- Can view and manage all companies' data (employees, departments, etc.)
- Uses the existing `superadmin` role — no schema migration needed

---

## Approach (Designed)

Use the existing `superadmin` role with `companyId: null`. The client passes the selected company via `x-company-id` request header. Auth middleware overrides `req.user.companyId` centrally so all controllers work without per-controller changes.

`GET /api/company/all` already exists and is locked to `superadmin` — used to populate the company switcher on the client.

---

## Server Changes Applied (on this branch)

### 1. `src/controllers/Account/accountSigninController.js`

**`signIn`**
- Removed `companyId` from required fields validation
- Changed user lookup to `{ email, companyId: companyId || null }` — allows superadmin with no company to authenticate

**`getUserProfile`**
- Removed hard requirement for `companyId` in token
- Company subscription lookup skipped when `companyId` is null

### 2. `src/middlewares/authMiddleware.js`

- Added central `x-company-id` header override for superadmin
- When superadmin sends `x-company-id` header, `req.user.companyId` is set to that value
- All controllers automatically scope to the correct company — no per-controller changes needed

```js
if (user.role === "superadmin" && req.headers["x-company-id"]) {
  req.user.companyId = req.headers["x-company-id"];
}
```

---

## Remaining Client Work (if resumed)

1. **`useAuthStore`** — add `activeCompanyId` + `setActiveCompanyId` (persisted)
2. **`apiFetch` utility** — thin wrapper injecting `Authorization` and `x-company-id` headers on every request; replaces manual fetch calls across ~47 files
3. **Login flow** — skip company selection step for superadmin (`companyId: null` + `role: superadmin` from `getUserEmail`); go straight to password
4. **Sidebar** — superadmin with no `activeCompanyId`: hide Employee Panel, show company picker; once set: show both panels
5. **Company switcher** — dropdown calling `GET /api/company/all` (note: singular `/company`, not `/companies`)
6. **Plan locking** — bypass plan checks entirely for superadmin role

---

## Key API Details

| Detail | Value |
|---|---|
| Company list endpoint | `GET /api/company/all` |
| Auth required | Yes (`superadmin` role) |
| Response shape | `{ data: [{ id, name, ... }] }` |
| Company context header | `x-company-id: <companyId>` |
| Detect superadmin at login | `companyId: null` + `role: "superadmin"` in `getUserEmail` response |
