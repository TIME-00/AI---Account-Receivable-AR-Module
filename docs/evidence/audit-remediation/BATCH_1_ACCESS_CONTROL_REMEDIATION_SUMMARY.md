# Batch 1 — Access Control Remediation Summary

**Date**: 2026-06-10  
**Batch**: 1 of 6 (from AR Module Smart Automation Plan)  
**Status**: ✅ Implemented, smoke-tested, committed, and pushed  
**Plan Reference**: `docs/plans/ar-module-audit-remediation-plan.md` — Batch 1

---

## 1. Batch 1 Purpose

Batch 1 addresses the three P0 access control findings from the Codex technical audit:

| ID | Fix | Audit Finding |
|----|-----|---------------|
| REM-001 | AR Clerk `listInvoices()` must be scoped to assigned customers only | F-001 |
| REM-002 | AR Clerk `getAgingSummary()` and `getDashboardSummary()` must be scoped to assigned customers only | F-002 |
| REM-005 | `POST /allocations/auto` must be disabled — return 403 | F-005 |

**Additionally verified**: `POST /allocations/manual` (the verified manual allocation path) was confirmed to still work after the changes.

---

## 2. Files Changed

| File | Change |
|------|--------|
| `backend/supabase/functions/invoices/service.ts` | Added `getCustomerAccessFilter(auth)` intersection to `listInvoices()` for AR Clerk role |
| `backend/supabase/functions/reports/service.ts` | Added `getCustomerAccessFilter(auth)` to `getDashboardSummary()` and `getAgingSummary()` for AR Clerk role |
| `backend/supabase/functions/allocations/index.ts` | `POST /allocations/auto` handler now returns 403 with `AUTO_ALLOCATION_DISABLED` error |

**Files NOT changed**:
- `backend/supabase/functions/allocations/service.ts` — `manualAllocate()` was not modified.
- `backend/supabase/functions/imports/` — Import service was not modified.
- `allocate_receipt` RPC — Not modified.
- No frontend files were changed.
- No database migrations were created.

---

## 3. Implementation Summary

### REM-001: Invoice List AR Clerk Filtering

`InvoiceService.listInvoices()` now intersects visible customer IDs with AR Clerk assigned customer IDs using `getCustomerAccessFilter(auth)`. This matches the existing pattern in `ReceiptService.listReceipts()` and `CustomerService.listCustomers()`.

- AR Clerk users see only invoices belonging to their assigned customers.
- AR Supervisor, Finance Manager, and Auditor behavior is unchanged — they see all visible customers.

### REM-002: Report/Dashboard AR Clerk Filtering

`ReportService.getDashboardSummary()` and `ReportService.getAgingSummary()` now use readable visible customer scope that includes AR Clerk assignment filtering.

- AR Clerk users see aggregate data only for their assigned customers.
- Other roles see all visible customer data (unchanged).

### REM-005: Auto-Allocation Route Disabled

`POST /allocations/auto` now immediately returns HTTP 403 with error code `AUTO_ALLOCATION_DISABLED`.

- The route was not deleted — it remains declared for future use.
- The `autoAllocate()` service method was not modified.
- `POST /allocations/manual` was not changed and continues to work.
- Phase E import allocation (which uses `AllocationService.manualAllocate()` → `allocate_receipt` RPC) was not affected.

---

## 4. Checks Passed

| Check | Result |
|-------|--------|
| `deno check invoices/index.ts` | ✅ Passed |
| `deno check reports/index.ts` | ✅ Passed |
| `deno check allocations/index.ts` | ✅ Passed |
| `git diff --check` | ✅ Passed (CRLF warnings only — not errors) |
| `git commit` | ✅ Committed |
| `git push` | ✅ Pushed |

---

## 5. Staging Smoke Test Results

### 5.1 AR Clerk Invoice Scope

| Test | Result |
|------|--------|
| AR Clerk `GET /invoices` | ✅ Success — returned only assigned customer invoices |
| AR Clerk invoice list scoped correctly | ✅ Confirmed — unassigned customer invoices excluded |

### 5.2 AR Clerk Report/Dashboard Scope

| Test | Result |
|------|--------|
| AR Clerk `GET /reports/dashboard` | ✅ Success |
| AR Clerk `GET /reports/aging` | ✅ Success — `total_customers = 1` (assigned customer only) |

### 5.3 Finance Manager / Supervisor Scope (Unchanged)

| Test | Result |
|------|--------|
| Finance Manager/Supervisor `GET /invoices` | ✅ Success — all visible customers returned |
| Finance Manager/Supervisor `GET /reports/dashboard` | ✅ Success |
| Finance Manager/Supervisor `GET /reports/aging` | ✅ Success — `total_customers = 2` (all visible customers) |

### 5.4 Auto-Allocation Route Disabled

| Test | Result |
|------|--------|
| `POST /allocations/auto` | ✅ HTTP 403 returned — `AUTO_ALLOCATION_DISABLED` |

### 5.5 Manual Allocation Regression

| Test | Result |
|------|--------|
| `POST /allocations/manual` | ✅ Success (after staging fiscal period setup — see §6) |
| Receipt `P1API-RCT-ALLOC` updated | ✅ `allocated_amount = 1`, `unallocated_amount = 119` |
| Invoice `P1API-INV-ALLOC` updated | ✅ `status = Partially Paid`, `outstanding = 119` |
| `allocate_receipt` RPC used | ✅ Confirmed — allocation went through verified RPC path |

---

## 6. Staging Fiscal Period Setup Note

> [!NOTE]
> **This is a staging smoke-test setup action, not a production instruction.**

During the manual allocation regression test, the initial allocation attempt was blocked by business rule **BR-JE-007** because fiscal period `2026-06` was not open on staging.

**Root cause**: The `public.fiscal_periods` table on staging did not have a row for:
- `company_id`: `81000000-0000-0000-0000-000000000001`
- `period_code`: `2026-06`

**Resolution**: A staging-only fiscal period row for `2026-06` was inserted and opened to unblock the smoke test. After the period was opened, the manual allocation succeeded.

**Production impact**: None. This was a staging data setup issue. Production fiscal periods are managed separately.

---

## 7. Phase E Import Allocation Regression Note

> [!WARNING]
> **Test gap recorded — not a failure.**

- No existing Phase E import allocation smoke test script was found under `tests/`.
- Phase E script-level regression was therefore not executed as part of Batch 1 verification.
- This is recorded as a **test gap**, not a test failure.

**Mitigating factors**:
- Batch 1 did **not** modify the imports service, `AllocationService.manualAllocate()`, or the `allocate_receipt` RPC.
- The manual allocation dependency (the same code path used by Phase E import allocation) was verified successfully in §5.5.
- Phase E import allocation calls `AllocationService.manualAllocate()` → `allocate_receipt` RPC — the same path confirmed working.

**Recommendation**: Add a dedicated Phase E import allocation regression script in a future testing/evidence batch (Batch 6 or earlier if resources allow).

---

## 8. Risks and Follow-Up

### Batch 1 Status

| Item | Status |
|------|--------|
| REM-001 (AR Clerk invoice filtering) | ✅ Implemented and verified |
| REM-002 (AR Clerk report/dashboard filtering) | ✅ Implemented and verified |
| REM-005 (Disable POST /allocations/auto) | ✅ Implemented and verified |
| REM-010 (Evidence reconciliation) | 🟡 Partially addressed — this document contributes; full Phase C/D/E/F reconciliation in progress |

### Remaining Batches

| Batch | Scope | Status |
|-------|-------|--------|
| **Batch 2** | Bank account API, GET /allocations/:id, hidden/deleted mutation guards, JE page | ⬜ Not started — requires Codex review + user approval |
| **Batch 3** | Multi-invoice allocation (one atomic `manualAllocate()` call with `allocations[]`) | ⬜ Not started |
| **Batch 4** | Overpayment/unapplied cash, discount via `p_discount_amount`, bank charge detection | ⬜ Not started |
| **Batch 5** | Fuzzy matching, controlled auto-post (exact match first), OCR import with review screen | ⬜ Not started |
| **Batch 6** | Testing, evidence, FYP documentation | ⬜ Not started |

### Key Follow-Up Items

| # | Item | Priority |
|---|------|----------|
| 1 | Codex must review the smart automation plan before Batch 2 begins | **Required** |
| 2 | User must approve Batch 2 scope before implementation | **Required** |
| 3 | Phase E import regression script should be created | Recommended |
| 4 | Production deployment of Batch 1 requires separate verification | When ready |

---

*Document created: 2026-06-10T00:35:50+08:00*  
*Batch 1 status: ✅ Complete (staging verified)*  
*Author: Claude (GenAI-assisted development)*
