# Batch 3 — Multi-Invoice Allocation Plan

**Date**: 2026-06-12 · Codex review applied 2026-06-12  
**Author**: Claude (GenAI-assisted development)  
**Status**: 🟢 Codex **Approved with changes** — corrections applied; ready for user approval to implement  
**Goal**: Support one receipt → multiple invoices in a single atomic allocation.  
**Plan type**: Documentation / implementation plan only. **No code changes in this document.**  
**Codex changes applied**: duplicate-`invoice_id` rejection promoted to **mandatory** (§2.5); definitive 2-backend-change scope (§0); acceptance criteria + smoke tests updated (§6, §8).

---

## 0. Critical Current-State Finding (Read First)

> [!IMPORTANT]
> **Multi-invoice allocation is already implemented end-to-end and atomically.** A code-level trace of the existing system shows one receipt can already be allocated to multiple invoices through a single `manualAllocate()` / `allocate_receipt` call — not a loop of independent commits.

| Layer | File | Evidence it already supports multi-invoice |
|-------|------|-------------------------------------------|
| **DB RPC** | `database/007_financial_rpcs.sql` (`allocate_receipt`) | Takes `p_allocations JSONB` array, locks receipt + each invoice `FOR UPDATE`, validates total + per-line, processes all rows in **one transaction**, returns `allocated_count`. |
| **Service** | `backend/supabase/functions/allocations/service.ts` (`manualAllocate`) | Accepts `allocations: Array<{invoice_id, amount, discount_amount?}>` and makes **one** `callRpc('allocate_receipt', { p_allocations: [...] })` call. |
| **API route** | `backend/supabase/functions/allocations/index.ts` (`POST /allocations/manual`) | Already requires `allocations` to be a **non-empty array** and maps every element into the single service call. |
| **Frontend hook** | `frontend/src/hooks/use-allocation-logic.ts` | Manages multiple `lines`, `addInvoice`/`removeInvoice`, per-line `updateAmount`, running totals (`totalAllocating`, `availableBalance`, `remainingBalance`), and `buildPayload()` returns one `allocations[]` array. |
| **Frontend UI** | `allocations/page.tsx`, `invoice-panel.tsx`, `allocation-table.tsx` | Split-screen wizard: add multiple invoices, per-invoice allocate/discount inputs, balance summary bar (Available − Allocating = Remaining), submit-disabled-on-invalid, single mutation call. |

**Consequence for Batch 3 scope.** Batch 3 is therefore **not** a "build multi-invoice from scratch" batch. It is a **verification + targeted hardening** batch. Two required backend changes were identified — the hidden/deleted customer guard parity (§2.4) and mandatory duplicate-`invoice_id` rejection (§2.5) — plus an optional small frontend wording change (§3). Everything else is regression confirmation and evidence.

> [!WARNING]
> The implementation must continue to use **one** `manualAllocate()` / `allocate_receipt` call with all allocation rows. Do **not** refactor the wizard into a per-invoice loop of independent commits — that would break atomicity and is explicitly out of scope.

### Batch 3 Definitive Implementation Scope (post-Codex review)

Batch 3 implementation is limited to exactly the following:

1. **Add `assertCustomerVisible()`** in `AllocationService.manualAllocate()`, immediately after the existing `requireCustomerAccess()` call (§2.4) — backend.
2. **Add backend duplicate `invoice_id` rejection** in `POST /allocations/manual`, before `manualAllocate()` is called (§2.5) — backend, **required**.
3. **Optional** small frontend wording improvement only if safe: relabel the "Remaining" figure as **"Remaining unapplied receipt balance"** (§3) — frontend, non-functional.

Nothing else is in scope. The `allocate_receipt` RPC, the database schema, and the route topology remain unchanged.

---

## 1. Business Goal

- One receipt can be allocated to multiple open invoices of the **same customer and currency**.
- The user can split the receipt amount across those invoices.
- Total allocation must **not exceed** the receipt's unallocated amount.
- No invoice outstanding may go negative (each line ≤ that invoice's outstanding).
- Receipt and invoice statuses must update **only** through the existing verified `allocate_receipt` RPC:
  - Receipt → `Fully Allocated` when unallocated reaches ~0; otherwise unchanged (`Posted`).
  - Invoice → `Paid` / `Partially Paid` / `Overdue` per the RPC's `determine`-status logic.

All five points are **already enforced** by `allocate_receipt` (BR-REC-001/002/003) and mirrored in the frontend validation. Batch 3 confirms them under multi-invoice conditions and closes the gaps below.

---

## 2. Backend / API Design

### 2.1 Reuse the existing route (preferred)

`POST /allocations/manual` **already accepts multiple allocations** and is the correct entry point. No new route is needed.

- Request body shape (already supported):
  ```json
  {
    "receipt_id": "<uuid>",
    "allocations": [
      { "invoice_id": "<uuid>", "amount": 100.00 },
      { "invoice_id": "<uuid>", "amount": 250.00, "discount_amount": 5.00 }
    ]
  }
  ```
- The route rejects a missing/empty `allocations` array with a `ValidationError`.
- It maps every element into a **single** `service.manualAllocate(auth, { receipt_id, allocations })` call.

**Decision: reuse `POST /allocations/manual`. Do not add a new route.**

### 2.2 Atomicity contract (must be preserved)

`manualAllocate()` → one `callRpc('allocate_receipt', { p_allocations })`. The RPC:
- Locks the receipt `FOR UPDATE`, pre-locks all distinct target invoices `FOR UPDATE OF i`, then processes each row.
- Validates total ≤ receipt unallocated (BR-REC-002) **before** processing.
- Per row: amount > 0, invoice exists, same customer, allocatable status, currency match, `amount + discount ≤ outstanding`.
- Updates each invoice with an optimistic `version` lock; updates receipt totals/status once at the end.
- All within a single transaction → all-or-nothing.

### 2.3 Hard prohibitions (unchanged from prior batches)

- ❌ Do **not** add a new route — reuse `POST /allocations/manual`.
- ❌ Do **not** change the `allocate_receipt` RPC (or create any migration).
- ❌ Do **not** directly insert into `allocation_details`.
- ❌ Do **not** directly update `invoices.outstanding`.
- ❌ Do **not** directly update `receipts.allocated_amount` / `unallocated_amount`.
- ❌ Do **not** bypass the `allocate_receipt` RPC.
- ❌ Do **not** loop per-invoice with independent commits.
- ❌ Do **not** enable `POST /allocations/auto` — it must keep returning 403 `AUTO_ALLOCATION_DISABLED`.
- ❌ Do **not** implement overpayment, discount automation, bank-charge detection, fuzzy matching, OCR, or auto-posting (separate future batches — see §10).

### 2.4 Gap to close — hidden/deleted customer guard parity (the one real backend change)

> [!CAUTION]
> **`manualAllocate()` currently calls `requireCustomerAccess()` but does NOT call `assertCustomerVisible()`.** The Batch 2C visibility guards were added to receipt post/cancel/clear and invoice cancel/update/delete, but the **allocation path was not included**. This means an allocation against a hidden/soft-deleted customer's receipt is not currently blocked at the service layer.

**Proposed (for implementation, not done here):** add the Batch 2C guard to `manualAllocate()` immediately after the existing `requireCustomerAccess(auth, receipt.customer_id)`:

```ts
await requireCustomerAccess(auth, receipt.customer_id);
await assertCustomerVisible(this.client, auth.companyId, receipt.customer_id); // Batch 3 — parity with Batch 2C
```

This is the minimal, consistent change that satisfies the "hidden customer allocation not allowed" requirement, and matches the existing guard pattern. No RPC or schema change required.

### 2.5 Required — reject duplicate `invoice_id` rows (mandatory)

> [!CAUTION]
> **Codex review: duplicate `invoice_id` rejection is a REQUIRED Batch 3 item, not optional hardening.**

- The frontend already prevents duplicate invoice selection (`addInvoice` dedupes by `invoice_id`).
- **However, API callers can still submit duplicate `invoice_id` rows directly** (the route does not currently dedupe; the RPC pre-locks `DISTINCT` ids but then processes each array element sequentially, producing an ambiguous payload).
- **Therefore `POST /allocations/manual` must reject duplicate `invoice_id` values before calling `AllocationService.manualAllocate()`.**
- This prevents ambiguous allocation payloads and strengthens API correctness.
- **The duplicate-invoice rejection must be implemented in `backend/supabase/functions/allocations/index.ts`, before `manualAllocate()` is called** — return a `ValidationError` when any `invoice_id` appears more than once in `allocations[]`.

---

## 3. Frontend UX Design

The wizard (`allocations/page.tsx` + `allocation-table.tsx`) **already** delivers the required UX. Batch 3 verifies it and adds only small clarity touches if Codex requests them.

| Requirement | Current state |
|-------------|---------------|
| Select multiple invoices | ✅ `InvoicePanel.onAddInvoice` adds a line per invoice; already-added invoices are tracked via `allocatedInvoiceIds`. |
| Show selected invoice list | ✅ `AllocationTable` renders one row per selected invoice. |
| Enter allocation amount per invoice | ✅ Per-line numeric input + "Fill Max". |
| Running totals: receipt unallocated / total selected / remaining | ✅ Balance summary bar: **Receipt Available − Allocating = Remaining** + progress bar + % utilized. |
| Disable submit if total > receipt unallocated | ✅ `validation.isBalanceValid` gates `canSubmit`; submit button disabled. |
| Disable submit if any line > invoice outstanding | ✅ Per-line error + `allLinesValid` gates `canSubmit`. |
| Clear validation messages | ✅ Per-line error text + "Allocation total exceeds receipt balance" banner + "Validation Passed" chip. |

**Minor clarity enhancement (optional, in scope only if safe):**
- Relabel the "Remaining" figure explicitly as **"Remaining unapplied receipt balance"** to align with §5. This is the only frontend change in Batch 3, is purely cosmetic, and should be applied only if it carries no functional risk.

> The backend duplicate-`invoice_id` rejection (§2.5) is mandatory and lives in the API layer; no frontend change is required for it because the wizard already prevents duplicate selection.

---

## 4. Validation Rules

| # | Rule | Enforced today? | Where |
|---|------|------------------|-------|
| 1 | Each allocation amount > 0 | ✅ | RPC (`BR-REC-002`) + frontend min 0 / active-line filter |
| 2 | Each invoice in same customer/company scope | ✅ | RPC (same-customer check) + `requireCustomerAccess` + company guard |
| 3 | No duplicate invoice rows | ⚠️ **Gap — required fix** | Frontend dedupes; **API does not reject duplicates** → close via **mandatory** backend check in `POST /allocations/manual` (§2.5) |
| 4 | Total allocation ≤ receipt unallocated | ✅ | RPC (`BR-REC-002`) + frontend `isBalanceValid` |
| 5 | Allocation ≤ invoice outstanding | ✅ | RPC (`amount + discount ≤ outstanding`) + frontend per-line |
| 6 | Hidden/deleted customers excluded | ⚠️ **Gap** | **Missing on allocation path** → close via §2.4 `assertCustomerVisible` |
| 7 | AR Clerk assignment rules preserved | ✅ | `requireCustomerAccess` (service) + `rpc_check_customer_access` (RPC) |
| 8 | System Admin operational restriction preserved | ✅ | `requireRole(auth, 'AR Clerk')` rejects System Admin (config-only) and Auditor (read-only); RPC `rpc_check_role` excludes System Admin |

**Net: rules 3 and 6 are the only gaps, and both are required Batch 3 fixes (§2.5 and §2.4 respectively); everything else is already enforced.**

---

## 5. Overpayment Boundary

- Full overpayment / unapplied-cash handling is **out of scope** for Batch 3 (remains a Batch 4 item).
- The wizard already shows the **remaining unapplied receipt balance** when total allocation < receipt unallocated (the "Remaining" figure in the balance bar). Batch 3 keeps this; optionally relabel it "Remaining unapplied receipt balance" for clarity.
- **Explicit over-allocation is blocked, not silently capped:** the RPC raises `BR-REC-002` and the frontend disables submit + shows the red "exceeds receipt balance" banner. No auto-capping occurs. This behavior must be preserved.

---

## 6. Testing / Evidence — Planned Smoke Tests

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1 | One receipt → **2 invoices** (single submit) | One atomic allocation; both invoices updated | ⬜ |
| 2 | One receipt → **3 invoices** (single submit) | One atomic allocation; all three updated | ⬜ |
| 3 | Over-allocation (total > receipt unallocated) | **Blocked** (frontend submit disabled; RPC `BR-REC-002` if forced) — not capped | ⬜ |
| 4a | Duplicate invoice selection in wizard | Frontend prevents adding the same invoice twice | ⬜ |
| 4b | **Duplicate `invoice_id` payload sent directly to API** | **Rejected by `POST /allocations/manual` with `ValidationError` — before `manualAllocate()` / RPC is called** (§2.5) | ⬜ |
| 5 | Partial allocation (total < receipt unallocated) | Succeeds; receipt stays `Posted`; "Remaining" shown | ⬜ |
| 6 | Allocation total == receipt unallocated | Receipt → **`Fully Allocated`** | ⬜ |
| 7 | Allocation total < receipt unallocated | Receipt remains partially/unallocated (`Posted`) | ⬜ |
| 8 | Invoice status transitions | `Paid` when outstanding→0; else `Partially Paid`/`Overdue` | ⬜ |
| 9 | AR Clerk allocates to **unassigned** customer invoice | Rejected (`requireCustomerAccess` / RPC access check) | ⬜ |
| 10 | Allocation to **hidden** customer | Rejected — **requires §2.4 guard** (currently a gap) | ⬜ |
| 11 | `POST /allocations/auto` | Still returns **403 `AUTO_ALLOCATION_DISABLED`** | ⬜ |
| 12 | Existing single-invoice manual allocation | Still works (no regression) | ⬜ |

> Test 10 is expected to **fail until §2.4 is implemented** — it is the proof case for the hidden-customer guard. Record it as a gap-confirming test before the fix and a passing test after.

---

## 7. Files Likely Affected (do not edit in this plan)

### Backend
| File | Expected role in Batch 3 |
|------|--------------------------|
| `backend/supabase/functions/allocations/service.ts` | Add `assertCustomerVisible()` guard in `manualAllocate()` (§2.4). Import from `_shared/visibility.ts`. |
| `backend/supabase/functions/allocations/index.ts` | **Required (§2.5):** reject duplicate `invoice_id` values in `allocations[]` with a `ValidationError` **before** calling `manualAllocate()`. |
| `backend/supabase/functions/_shared/visibility.ts` | Reused as-is (no change) — provides `assertCustomerVisible()`. |
| `database/007_financial_rpcs.sql` (`allocate_receipt`) | **No change expected.** Already atomic and multi-row. Listed for reviewer reference only. |

### Frontend
| File | Expected role in Batch 3 |
|------|--------------------------|
| `frontend/src/hooks/use-allocation-logic.ts` | Likely no change; optionally surface a duplicate-guard message. |
| `frontend/src/components/features/allocations/allocation-table.tsx` | Optional clarity label ("Remaining unapplied receipt balance"). |
| `frontend/src/components/features/allocations/invoice-panel.tsx` | No change expected (already supports multi-add). |
| `frontend/src/app/(dashboard)/allocations/page.tsx` | No change expected. |

> Minimum required Batch 3 implementation is the **two backend changes** (§2.4 hidden-customer guard + §2.5 duplicate-`invoice_id` rejection) plus evidence. The frontend relabel (§3) is optional and cosmetic.

---

## 8. Acceptance Criteria

| # | Criterion | Pass condition |
|---|-----------|----------------|
| AC-1 | Atomic multi-invoice allocation | A 2- and 3-invoice allocation each complete via **one** `allocate_receipt` call; no per-invoice loop of separate commits. |
| AC-2 | Total cap enforced | Over-allocation is blocked (not capped) at both frontend and RPC. |
| AC-3 | Per-invoice cap enforced | No invoice outstanding goes negative; each line ≤ outstanding. |
| AC-4 | Status correctness | Receipt → `Fully Allocated` only when fully allocated; invoices reach `Paid`/`Partially Paid`/`Overdue` correctly. |
| AC-5 | Hidden/deleted customer blocked | Allocation to a hidden/deleted customer is rejected (`assertCustomerVisible` added — Test 10 passes after fix). |
| AC-6 | Duplicate invoice rejection | A payload with a repeated `invoice_id` is **rejected by `POST /allocations/manual` with a `ValidationError` before `manualAllocate()` / the RPC is called**. Frontend also still prevents duplicate selection. |
| AC-7 | Access control preserved | AR Clerk limited to assigned customers; System Admin (config-only) and Auditor (read-only) blocked from allocating. |
| AC-8 | Auto-allocation still disabled | `POST /allocations/auto` returns 403 `AUTO_ALLOCATION_DISABLED`. |
| AC-9 | No regression | Single-invoice manual allocation still works; no direct table mutations introduced. |
| AC-10 | Checks pass | `deno check allocations/index.ts` and `npm.cmd run build` pass; `git diff --check` clean (CRLF warnings only). |

**Fail** = any of the above not met, OR any direct mutation of `allocation_details` / invoice outstanding / receipt totals introduced, OR atomicity broken into multiple commits.

---

## 9. Codex Review Checklist (before implementation)

- [ ] Confirm Batch 3 reuses `POST /allocations/manual` and does **not** add a new route.
- [ ] Confirm the implementation makes **one** `manualAllocate()` / `allocate_receipt` call per submission (no per-invoice loop).
- [x] **Approved:** add `assertCustomerVisible()` to `manualAllocate()` (§2.4) for Batch 2C parity. **(Required)**
- [x] **Approved:** duplicate-`invoice_id` rejection is **mandatory** and implemented in `POST /allocations/manual` before `manualAllocate()` (§2.5). **(Required — Codex)**
- [ ] Confirm no direct writes to `allocation_details`, `invoices.outstanding`, or receipt allocated/unallocated.
- [ ] Confirm the `allocate_receipt` RPC and DB schema remain **unchanged**.
- [ ] Confirm overpayment remains deferred to Batch 4; only the "remaining unapplied balance" display is in scope.
- [ ] Confirm over-allocation is blocked (not capped) at both layers.
- [ ] Confirm AR Clerk assignment + System Admin/Auditor restrictions are preserved.
- [ ] Approve the smoke-test matrix (§6), including Test 10 as the hidden-customer proof case.
- [ ] Confirm acceptance criteria (§8) and that the regression test for single-invoice allocation is included.
- [ ] Confirm evidence document will be produced under `docs/evidence/audit-remediation/` after implementation.

---

## 10. Relationship to Other Batches

> [!IMPORTANT]
> Out of scope for Batch 3 (separate future batches):
> - **Overpayment / unapplied cash, early-payment discount automation, bank-charge detection** → Batch 4.
> - **Fuzzy matching, controlled auto-post, OCR import with review** → Batch 5.
> - **CASH/OFST accounting support** → Batch 2B-Fix-2 (future reviewed batch).
>
> Batch 3 delivers verified, hardened **multi-invoice manual allocation** only.

---

*Plan created: 2026-06-12*  
*Codex review applied: 2026-06-12 — Approved with changes (duplicate-`invoice_id` rejection made mandatory)*  
*Status: 🟢 Approved with changes — awaiting user approval to implement*  
*Key finding: multi-invoice allocation already implemented end-to-end; Batch 3 = two required backend changes (hidden-customer guard parity §2.4 + mandatory duplicate-`invoice_id` rejection §2.5) + optional frontend relabel §3 + verification/evidence*  
*Author: Claude (GenAI-assisted development)*
