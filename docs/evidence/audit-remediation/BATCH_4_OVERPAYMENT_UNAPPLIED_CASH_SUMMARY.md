# Batch 4 — Overpayment / Unapplied Cash Handling Summary

**Date**: 2026-06-12  
**Batch**: 4 (Overpayment / Unapplied Cash Handling)  
**Status**: ✅ Implemented · ✅ `deno check` + `npm run build` verified · ✅ Smoke-tested · ✅ Committed & pushed  
**Commits**: `4919546` + `22fa05d` — "Handle overpayment and (unapplied receipt / receipt import) diagnostics"  
**Plan Reference**: `docs/plans/batch-4-overpayment-unapplied-cash-plan.md` (Codex **Approved with changes** — pre-post preflight; existing `Skipped` status + `mapped_data` diagnostics; no migration)

---

## 1. Purpose

Batch 4 makes receipt **overpayment / unapplied cash** safe and visible. The core financial safety (unapplied-cash modelling, RPC over-allocation rejection, implicit import capping) already existed; this batch closed the remaining gaps:

1. **Import execution-order risk** — previously a receipt with an explicit `allocation_amount` greater than the matched invoice outstanding was **created and posted (journal entry written) before** allocation failed. Batch 4 adds a **pre-post preflight** so this fails **before** any financial mutation.
2. **Diagnostics** — structured `mapped_data` fields now make overpayment and review-required rows traceable.
3. **UI clarity** — the remaining receipt balance is now labelled **"Unapplied receipt balance"** across the allocation and receipt screens, with an overpayment warning.

No new `import_rows.status` value, no database migration, and no `allocate_receipt` RPC change were introduced.

---

## 2. Existing Capability Used (Unchanged Foundations)

| Capability | Reused as-is |
|------------|--------------|
| Unapplied-cash model | `receipts.unallocated_amount` (`CHECK >= 0`); positive value = advance/unapplied (BR-OP-001). |
| Atomic allocation | `AllocationService.manualAllocate()` → single `allocate_receipt` RPC call. |
| Over-allocation rejection | RPC `BR-REC-002` (total > unallocated, or line > outstanding) — rejects, never caps. |
| Negative-outstanding guard | RPC `GREATEST(outstanding − amount − discount, 0)` + validation. |
| Implicit import capping | `allocateReceiptImportRow`: `allocation_amount = explicit ?? min(receipt.unallocated_amount, invoice.outstanding)`. |
| Batch 3 protections | Duplicate `invoice_id` rejection, hidden/deleted customer guard, `POST /allocations/auto` 403. |

Batch 4 **adds visibility and a preflight around** these — it does not alter the financial mutation path.

---

## 3. Scope Completed

| # | Item | Status |
|---|------|--------|
| 1 | Receipt-import **pre-post preflight** for explicit over-allocation | ✅ |
| 2 | Explicit `allocation_amount` > outstanding stopped **before** `createReceipt()`, `postReceipt()`, or allocation | ✅ |
| 3 | Explicit over-allocation row uses existing `status = "Skipped"` + `mapped_data.review_required = true` | ✅ |
| 4 | No new `import_rows.status` value added | ✅ |
| 5 | No database migration added | ✅ |
| 6 | Implicit overpayment keeps safe capped allocation via `manualAllocate()` / `allocate_receipt` | ✅ |
| 7 | Remaining amount stays as `receipts.unallocated_amount` | ✅ |
| 8 | `mapped_data` diagnostics: `overpayment_detected`, `unapplied_amount`, `allocation_suggestion`, `auto_post_eligible`, `auto_post_block_reason` (where applicable) | ✅ |
| 9 | Frontend wording shows **"Unapplied receipt balance"** | ✅ |
| 10 | Receipt import UI displays review-required diagnostics for skipped rows | ✅ |

---

## 4. Files Changed

| File | Layer | Change |
|------|-------|--------|
| `backend/supabase/functions/imports/service.ts` | Backend | Added `preflightExplicitReceiptImportOverAllocation()` (runs in the `auto_post` branch **before** `createReceipt()`); added `roundMoney()` helper; added implicit-overpayment diagnostics; reworked `resolveAllocationInvoice()` to return granular failure reasons; added `allocation_error_reason` to the `Unmatched` path; added `skipped_count` to the batch summary. |
| `frontend/src/components/features/allocations/allocation-table.tsx` | Frontend | Relabelled balance bar ("Receipt unallocated" / **"Unapplied receipt balance"**); standardized over-allocation message; added "This receipt will retain an unapplied balance" warning. |
| `frontend/src/components/features/allocations/receipt-panel.tsx` | Frontend | Receipt list label "Avail:" → **"Unapplied:"**. |
| `frontend/src/app/(dashboard)/receipts/[id]/page.tsx` | Frontend | Receipt detail card "Unallocated" → **"Unapplied Receipt Balance"** + retained-cash note; "Available:" → "Unapplied:". |
| `frontend/src/app/(dashboard)/receipts/import/page.tsx` | Frontend | Import results table shows review-required styling/badge, suggested allocation, unapplied balance, `auto_post_block_reason`, and `allocation_error_reason`. |

---

## 5. Import Preflight Logic

`preflightExplicitReceiptImportOverAllocation(auth, customerId, mappedData)` runs inside the receipt-import loop **only when `auto_post = true`**, and returns early (no-op) unless the row is an explicit over-allocation:

```ts
// Guard: only explicit allocation rows are preflighted
const invoiceReference = asString(mappedData, 'invoice_reference');
if (!invoiceReference || mappedData.allocation_amount === undefined) return null;
const explicitAmount = Number(mappedData.allocation_amount);
if (!Number.isFinite(explicitAmount) || explicitAmount <= 0) return null;

// Resolve the matched invoice from the already-resolved customer + currency (before any receipt exists)
let invoice: Invoice;
try { invoice = await this.resolveAllocationInvoice(auth.companyId, customerId, currency, invoiceReference); }
catch { return null; } // resolution problems fall through to the normal path

const invoiceOutstanding = Number(invoice.outstanding);
if (explicitAmount <= invoiceOutstanding + 0.01) return null; // not an over-allocation

const allocationSuggestion = roundMoney(Math.min(receiptAmount, invoiceOutstanding));
const unappliedAmount = roundMoney(Math.max(receiptAmount - allocationSuggestion, 0));
return { status: 'Skipped', mappedData: { ...diagnostics } };
```

When a preflight result is returned, the loop updates the row and **`continue`s** — so `createReceipt()`, `postReceipt()`, and `allocateReceiptImportRow()` are all skipped:

```ts
if (autoPost) {
  const preflight = await this.preflightExplicitReceiptImportOverAllocation(auth, resolved.customer.id, mappedData);
  if (preflight) {
    await this.client.from('import_rows').update({
      status: preflight.status,        // "Skipped"
      invoice_id: null,
      receipt_id: null,                // ← no receipt created
      mapped_data: preflight.mappedData,
      validation_errors: null,
    }).eq('id', row.id);
    continue;                          // ← no post, no allocation, no import_row_allocations row
  }
}
created = await this.receiptService.createReceipt(auth, receiptInput);
```

**Result for explicit over-allocation:** row `Skipped`; `receipt_id` column null; no `post_receipt`; no `manualAllocate()`; no `import_row_allocations` row — the row fails safely **before any financial mutation**.

> The preflight resolves the invoice independently (using the already-resolved customer + the mapped currency) precisely because the receipt does not yet exist — this is what lets the check run ahead of `createReceipt()`.

---

## 6. `mapped_data` Diagnostics

All diagnostics live in the existing `import_rows.mapped_data` JSON — **no new columns, no migration**.

### 6.1 Explicit over-allocation (Skipped / review-required)

| Field | Value |
|-------|-------|
| `allocation_status` | `"Review Required"` |
| `review_required` | `true` |
| `auto_post_eligible` | `false` |
| `auto_post_block_reason` | `"allocation_amount exceeds invoice outstanding"` |
| `overpayment_detected` | `true` |
| `unapplied_amount` | `roundMoney(receiptAmount − allocationSuggestion)` |
| `allocation_suggestion` | `roundMoney(min(receiptAmount, invoiceOutstanding))` |
| `invoice_id` / `invoice_no` | resolved invoice (review context only) |

> [!NOTE]
> On a `Skipped` row, `unapplied_amount` and `allocation_suggestion` are **advisory projections** — what a *corrected* allocation would yield. They are **not** realized balances, because `receipt_id` is null and no receipt/allocation exists. They guide the reviewer; they do not represent cash held anywhere.

### 6.2 Implicit overpayment (Allocated)

Computed only when there is **no explicit amount** and `receipt.unallocated_amount > invoice.outstanding`. After the safe capped allocation, the receipt is re-fetched and the row records:

| Field | Value |
|-------|-------|
| `overpayment_detected` | `true` |
| `unapplied_amount` | **actual** `receipts.unallocated_amount` after allocation |
| `allocation_suggestion` | the capped amount applied |

### 6.3 Allocation failure reasons

`resolveAllocationInvoice()` now raises granular `ValidationError` reasons surfaced via `allocation_error_reason`: `invoice_not_found_for_customer`, `multiple_matches`, `currency_mismatch`, `invoice_not_open`, `no_outstanding`. (This is what produced `invoice_not_open` in the repeat-allocation smoke test once the invoice became `Paid`.)

---

## 7. Frontend Display Changes (Display-Only)

| Screen | Change |
|--------|--------|
| Allocation wizard (`allocation-table.tsx`) | Balance bar: "Receipt Available" → **"Receipt unallocated"**, "Remaining" → **"Unapplied receipt balance"**. Over-allocation message → **"Total allocation cannot exceed receipt unallocated amount"**. New amber banner: **"This receipt will retain an unapplied balance"** when allocation is valid and a remainder exists. |
| Allocation receipt list (`receipt-panel.tsx`) | Per-receipt label "Avail:" → **"Unapplied:"**. |
| Receipt detail (`receipts/[id]/page.tsx`) | Summary card "Unallocated" → **"Unapplied Receipt Balance"** with note *"Remaining amount is retained as unapplied cash."*; progress footer "Available:" → "Unapplied:". |
| Receipt import results (`receipts/import/page.tsx`) | Review-required rows highlighted amber with a **"Review required before receipt creation"** badge; show suggested allocation, unapplied balance, `auto_post_block_reason`; `Unmatched` rows show `allocation_error_reason`. |

No computed or persisted amounts are changed by any frontend edit — these are labels, warnings, and diagnostics display only.

---

## 8. Commands / Checks Run

| Check | Result |
|-------|--------|
| `deno check --allow-import backend/supabase/functions/imports/index.ts` | ✅ Passed |
| `deno check backend/supabase/functions/allocations/index.ts` | ✅ Passed |
| `npm.cmd run build` (frontend) | ✅ Passed |
| `git diff --check` | ✅ Passed (Windows CRLF warnings only — not errors) |
| `git commit` / `git push` | ✅ Committed (`4919546`, `22fa05d`) & pushed |

---

## 9. Smoke Test Checklist and Results

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1 | `POST /allocations/auto` | 403 `AUTO_ALLOCATION_DISABLED` | ✅ PASSED |
| 2 | Manual explicit over-allocation | Rejected, **not capped** | ✅ PASSED |
| 3 | Partial allocation | Leaves unapplied receipt balance | ✅ PASSED |
| 4 | Multi-invoice allocation | Still works (one atomic call) | ✅ PASSED |
| 5 | Duplicate `invoice_id` payload | Still rejected (Batch 3) | ✅ PASSED |
| 6 | Import **implicit** overpayment | Allocates capped amount; records `overpayment_detected` + `unapplied_amount` + `allocation_suggestion` | ✅ PASSED |
| 7 | Import **explicit** over-allocation | `Skipped` + `review_required` **before** receipt creation/posting/allocation | ✅ PASSED |
| 8 | Explicit over-allocation — no receipt | `receipt_id` null for the review-required row | ✅ PASSED |
| 9 | Explicit over-allocation — no allocation evidence | No `import_row_allocations` row for the review-required row | ✅ PASSED |

### 9.1 Worked examples (from staging)

| Case | Import row id | Key outcome |
|------|---------------|-------------|
| **Explicit over-allocation** | `6827c1ec-e73e-42ff-8570-02c7b7790eb8` | `status = Skipped`, `receipt_id = null`, `review_required = true`, `overpayment_detected = true`, `unapplied_amount = 1`, `allocation_suggestion = 99` — caught by preflight; **no receipt, no post, no allocation, no import_row_allocations**. |
| **Implicit overpayment** | `688e58d4-53d9-4f14-a0dc-2446b3cd2412` | `status = Allocated`, `receipt_id = a00aef3a-1768-464c-aa02-3dd8c11bc1c5`, `overpayment_detected = true`, `unapplied_amount = 1`, `allocation_suggestion = 99` — capped allocation applied; RM1 retained as receipt `unallocated_amount`. |
| **Repeat allocation after Paid** | (combined retry) | Correctly rejected: `allocation_error_reason = invoice_not_open` — invoice already `Paid`; no double-allocation. |

> In the explicit case, `unapplied_amount = 1` / `allocation_suggestion = 99` are advisory projections (see §6.1) — `receipt_id` is null, so no cash is actually held.

---

## 10. What Was Intentionally NOT Changed

- ❌ No new `import_rows.status` value (used existing `Skipped`).
- ❌ No database migration.
- ❌ No change to the `allocate_receipt` RPC or receipt/invoice balance-update logic.
- ❌ No direct inserts into `allocation_details`.
- ❌ No direct updates to `invoices.outstanding`.
- ❌ No direct updates to `receipts.allocated_amount` / `receipts.unallocated_amount`.
- ❌ No new allocation route; `POST /allocations/auto` stays disabled (403).
- ❌ Implicit allocation capping logic unchanged (only diagnostics added).
- ❌ No silent capping of explicit user/import amounts — explicit over-allocation is blocked/review-required.

---

## 11. Risks and Follow-Up Items

| # | Item | Notes | Priority |
|---|------|-------|----------|
| 1 | Preflight scoped to `auto_post = true` | Matches the plan. A non-auto-post import never allocates, so no over-allocation mutation occurs; but an explicit-over-allocation row in a draft-only import will still create a Draft receipt (unposted, unallocated). Confirm this is acceptable | Review |
| 2 | `resolveAllocationInvoice()` behavior change | Now fetches by `invoice_no` + customer and validates status/currency/outstanding explicitly (granular reasons) rather than pre-filtering the query. Verify no regression for normal matched imports | Recommended |
| 3 | Advisory diagnostics on Skipped rows | `unapplied_amount` / `allocation_suggestion` are projections, not realized balances (§6.1). UI labels them under a review-required row; ensure reviewers are not misled | Informational |
| 4 | Automated tests | Overpayment paths are smoke-tested manually; consider unit/integration tests for preflight + diagnostics in the testing/evidence batch | Recommended |

---

## 12. Relationship to Future Batches

> [!IMPORTANT]
> The following remain **separate future batches** and are explicitly **not** part of Batch 4:
>
> - **Early-payment discount automation & bank-charge detection** → future batch.
> - **Fuzzy matching** → Batch 5.
> - **OCR import (with review screen)** → Batch 5.
> - **Fully automatic posting / controlled auto-post** → Batch 5 (`POST /allocations/auto` stays disabled until then).
>
> Batch 4 delivers **overpayment / unapplied-cash safety, the import pre-post preflight, diagnostics, and UI clarity** only.

---

*Document created: 2026-06-12*  
*Batch 4 status: ✅ Implemented · ✅ deno-check + build verified · ✅ Smoke tests passed · ✅ Committed & pushed (`4919546`, `22fa05d`)*  
*Author: Claude (GenAI-assisted development)*
