# Batch 3 — Multi-Invoice Allocation Hardening Summary

**Date**: 2026-06-12  
**Batch**: 3 (Multi-Invoice Allocation — verification + hardening)  
**Status**: ✅ Implemented · ✅ `deno check` verified · ✅ Smoke-tested · ✅ Committed & pushed  
**Commit**: `822a148` — "Harden multi-invoice allocation validation"  
**Plan Reference**: `docs/plans/batch-3-multi-invoice-allocation-plan.md` (Codex **Approved with changes** — duplicate-`invoice_id` rejection mandated)

---

## 1. Purpose

Batch 3 delivers verified, hardened support for allocating **one receipt to multiple invoices** in a single atomic operation. A code-level trace established that the multi-invoice capability already existed end-to-end; this batch therefore focused on **closing two required gaps** identified during planning and Codex review, then confirming the whole flow by smoke test:

1. The allocation path lacked the Batch 2C hidden/deleted **customer visibility guard**.
2. The manual allocation API did not reject **duplicate `invoice_id`** rows submitted directly by an API caller.

No new feature scaffolding was needed — the work was targeted hardening plus regression confirmation.

---

## 2. Existing Capability Found (Pre-Batch-3 State)

> [!NOTE]
> Multi-invoice allocation was **already implemented and atomic** before Batch 3. This was confirmed by reading every layer:

| Layer | File | Evidence |
|-------|------|----------|
| DB RPC | `database/007_financial_rpcs.sql` (`allocate_receipt`) | Accepts `p_allocations JSONB` array; locks receipt + each invoice `FOR UPDATE`; validates total + per-line; processes all rows in **one transaction**. |
| Service | `backend/supabase/functions/allocations/service.ts` (`manualAllocate`) | Accepts `allocations: Array<{invoice_id, amount, discount_amount?}>` and makes **one** `callRpc('allocate_receipt', { p_allocations })` call. |
| API route | `backend/supabase/functions/allocations/index.ts` (`POST /allocations/manual`) | Already required `allocations` to be a non-empty array. |
| Frontend | `allocations/page.tsx`, `use-allocation-logic.ts`, `allocation-table.tsx` | Wizard already supports multiple invoice rows, per-line amounts, running totals (Available − Allocating = Remaining), and a single `buildPayload()` → one mutation. |

**Conclusion**: Batch 3 was **not** a build-from-scratch feature. It is verification + two required backend hardening changes.

---

## 3. Scope Completed

| # | Item | Status |
|---|------|--------|
| 1 | Added hidden/deleted **customer visibility guard** to `AllocationService.manualAllocate()` | ✅ Done |
| 2 | Added backend **duplicate `invoice_id` rejection** in `POST /allocations/manual` | ✅ Done |
| 3 | Confirmed multi-invoice allocation uses **one atomic** `manualAllocate()` / `allocate_receipt` RPC call with multiple rows | ✅ Confirmed |
| 4 | Confirmed **no new route** was added | ✅ Confirmed |
| 5 | Confirmed `allocate_receipt` RPC was **not changed** | ✅ Confirmed |
| 6 | Confirmed `POST /allocations/auto` remains **disabled** (403) | ✅ Confirmed |

---

## 4. Files Changed

| File | Change |
|------|--------|
| `backend/supabase/functions/allocations/service.ts` | Imported `assertCustomerVisible` from `_shared/visibility.ts`; called it in `manualAllocate()` immediately after `requireCustomerAccess()` |
| `backend/supabase/functions/allocations/index.ts` | In `POST /allocations/manual`: parse + `validateUUID()` each `invoice_id`, then reject duplicate `invoice_id` values with a `ValidationError` **before** calling `manualAllocate()` |

No other files were touched. No new helper modules were introduced — `assertCustomerVisible()` was reused as-is.

---

## 5. Guard and Validation Logic Added

### 5.1 Hidden/deleted customer visibility guard (`service.ts`)

```ts
const receipt = await fetchById<Receipt>(this.client, 'receipts', input.receipt_id);
if (receipt.company_id !== auth.companyId) throw new NotFoundError('Receipt', input.receipt_id);
await requireCustomerAccess(auth, receipt.customer_id);
await assertCustomerVisible(this.client, auth.companyId, receipt.customer_id); // Batch 3 — parity with Batch 2C
```

- `assertCustomerVisible()` queries `customers` for a row matching `id`, `company_id`, `is_deleted = false`, **and** `is_hidden = false`; if none exists it throws `NotFoundError('Customer')`.
- This brings the allocation path to **parity with the Batch 2C mutation guards** (receipt post/cancel/clear, invoice cancel/update/delete). An allocation against a hidden or soft-deleted customer's receipt is now rejected **before** the `allocate_receipt` RPC runs — so no journal entry or balance change can occur.
- The guard runs after the existing `requireCustomerAccess()` (AR Clerk assignment scope) and the company-ownership check, so all three protections apply in sequence.

### 5.2 Duplicate `invoice_id` rejection (`index.ts`)

```ts
const parsedAllocations = allocations.map((a) => {
  const invoice_id = requireString(a.invoice_id, 'invoice_id');
  validateUUID(invoice_id, 'invoice_id');
  return { invoice_id, amount: Number(a.amount), discount_amount: a.discount_amount ? Number(a.discount_amount) : undefined };
});

const invoiceIds = parsedAllocations.map((allocation) => allocation.invoice_id.toLowerCase());
if (new Set(invoiceIds).size !== invoiceIds.length) {
  throw new ValidationError(
    'Duplicate invoice allocation rows are not allowed. Submit each invoice_id only once.',
    { field: 'allocations', reason: 'duplicate_invoice_id' },
  );
}

const result = await service.manualAllocate(auth, { receipt_id, allocations: parsedAllocations });
```

- Each `invoice_id` is also `validateUUID()`-checked during parsing.
- Duplicate detection is **case-insensitive** (`.toLowerCase()` before set comparison), so the same invoice UUID in differing letter-case cannot slip through.
- Rejection happens in the API layer **before** `manualAllocate()` / the RPC is called, preventing ambiguous allocation payloads. The frontend wizard already prevents duplicate selection; this closes the direct-API-caller gap.

---

## 6. Commands / Checks Run

| Check | Result |
|-------|--------|
| `deno check backend/supabase/functions/allocations/index.ts` | ✅ Passed |
| `git diff --check` | ✅ Passed (Windows CRLF warnings only — not errors) |
| `git commit` | ✅ Committed as `822a148` |
| `git push` | ✅ Pushed |

---

## 7. Smoke Test Checklist and Results

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1 | `POST /allocations/auto` | 403 `AUTO_ALLOCATION_DISABLED` | ✅ PASSED |
| 2 | Duplicate `invoice_id` payload (direct API) | Rejected with `ValidationError` **before** RPC | ✅ PASSED |
| 3 | Existing single-invoice manual allocation | Works (no regression) | ✅ PASSED |
| 4 | Multi-invoice allocation (one receipt → multiple invoices, single atomic call) | Works | ✅ PASSED |
| 5 | Hidden/deleted customer allocation (negative path) | Rejected (`assertCustomerVisible`) | ✅ PASSED |
| 6 | AR Clerk allocates to **unassigned** customer invoice | Rejected (`requireCustomerAccess` / RPC access check) | ✅ PASSED |
| 7 | System Admin / Auditor allocation | Denied (`requireRole` — config-only / read-only) | ✅ PASSED |

**All smoke tests passed.**

> Note: per the Batch 3 plan, the hidden-customer test (#5) is the proof case for §5.1 — it would have failed before this batch (the guard was absent on the allocation path) and passes after.

---

## 8. What Was Intentionally NOT Changed

- ❌ **No new route** — reused `POST /allocations/manual`.
- ❌ **No change to the `allocate_receipt` RPC** and **no database migration**.
- ❌ **No direct `allocation_details` inserts**.
- ❌ **No direct `invoices.outstanding` updates**.
- ❌ **No direct `receipts.allocated_amount` / `unallocated_amount` updates** — all balance/JE mutation continues to flow through the `allocate_receipt` RPC.
- ❌ **`POST /allocations/auto` not enabled** — still returns 403 `AUTO_ALLOCATION_DISABLED`.
- ❌ **No change to `assertCustomerVisible()` / `requireCustomerAccess()`** themselves — reused as-is.
- ❌ **No per-invoice loop** — multi-invoice allocation remains one atomic `manualAllocate()` / RPC call.

---

## 9. Risks and Follow-Up Items

| # | Item | Notes | Priority |
|---|------|-------|----------|
| 1 | Over-allocation remains blocked (not capped) | Confirmed behavior at frontend (disabled submit) and RPC (`BR-REC-002`). No auto-capping introduced | Informational |
| 2 | Hidden-after-allocation policy | Consistent with Batch 2C §9.1: a customer hidden/deleted after documents exist freezes further operational mutations (including allocation) until restored | Informational |
| 3 | Automated regression tests | Validation is currently smoke-tested manually; consider unit/integration tests for the allocation guard + duplicate rejection in the testing/evidence batch | Recommended |
| 4 | Reverse-allocation path | `reverseAllocation()` was out of scope for Batch 3; if hidden-customer parity is also wanted there, evaluate in a future batch | Review |

---

## 10. Relationship to Future Batches

> [!IMPORTANT]
> The following remain **separate future batches** and are explicitly **not** part of Batch 3:
>
> - **Overpayment / unapplied cash** → Batch 4.
> - **Early-payment discount automation & bank-charge detection** → Batch 4.
> - **Fuzzy matching** → Batch 5.
> - **OCR import (with review screen)** → Batch 5.
> - **Fully automatic posting / controlled auto-post** → Batch 5 (and `POST /allocations/auto` stays disabled until then).
>
> Batch 3 delivers verified, hardened **multi-invoice manual allocation** only.

---

*Document created: 2026-06-12*  
*Batch 3 status: ✅ Implemented · ✅ deno-check verified · ✅ Smoke tests passed · ✅ Committed & pushed (`822a148`)*  
*Author: Claude (GenAI-assisted development)*
