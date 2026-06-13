# Batch 5-Fix-A — Import Allocation Preflight Hardening Summary

**Date**: 2026-06-13  
**Batch**: 5-Fix-A (Receipt-import allocation preflight — reject blocking failures before document creation)  
**Status**: ✅ Implemented · ✅ `deno check` verified · ✅ Smoke-tested · ✅ Committed & pushed  
**Commit**: `d18b19f` — "Harden receipt import allocation preflight"  
**Plan Reference**: `docs/plans/batch-5-fix-import-preflight-idempotency-plan.md` (Codex **Approved with changes** — blocking vs non-blocking `review_required` split)

---

## 1. Purpose

Batch 5-Fix-A closes a financial-integrity hole in the receipt-import flow. Previously, when `invoice_reference` was present, the import could **create and post a receipt first and only then discover that allocation was impossible** (invoice Draft, Paid, currency mismatch, no outstanding, wrong customer, not found, or over-allocated). That left an **orphaned posted receipt** — cash posted with a failed allocation.

This batch moves all invoice-resolution and allocatability validation to run **before** `createReceipt()`, `postReceipt()`, and allocation. A row that hits a **Category 1 blocking condition** is now rejected with **no receipt created, none posted, and no allocation** — while **Category 2 non-blocking bank-charge diagnostics from Batch 5 continue to create/post/allocate unchanged.**

---

## 2. Existing Capability Reworked (Not a New Subsystem)

> [!NOTE]
> Batch 5-Fix-A **widened an existing guard**; it did not introduce a new control-flow path.

The Batch 4/5 method `preflightExplicitReceiptImportOverAllocation` already implemented the "preflight returns → update row → `continue`" pattern, but only for **explicit over-allocation**, only under `auto_post`, and it **swallowed** every invoice-resolution error. Batch 5-Fix-A generalised it into `preflightReceiptImportAllocation` (`service.ts:1039`) and made the call **unconditional** within the receipt branch.

---

## 3. Scope Completed

| # | Item | Status |
|---|------|--------|
| 1 | Allocation preflight now runs **before** `createReceipt()` / `postReceipt()` / allocation whenever `invoice_reference` is present | ✅ Done |
| 2 | **Draft** `invoice_reference` rejected before receipt creation | ✅ Done |
| 3 | **Paid / no-outstanding** `invoice_reference` rejected before receipt creation | ✅ Done |
| 4 | **Currency mismatch** rejected before receipt creation | ✅ Done |
| 5 | **Invalid / not-found** `invoice_reference` rejected before receipt creation | ✅ Done |
| 6 | **Explicit over-allocation** rejected before receipt creation | ✅ Done |
| 7 | `allocation_amount + discount_amount > outstanding` rejected before receipt creation | ✅ Done |
| 8 | Valid receipt import still works (no regression) | ✅ Confirmed |
| 9 | Batch 5 **bank-charge diagnostic** flow remains **non-blocking** and still works | ✅ Confirmed |
| 10 | **No new `import_rows.status` values** added | ✅ Confirmed |

---

## 4. Files Changed

| File | Change |
|------|--------|
| `backend/supabase/functions/imports/service.ts` | Renamed/generalised `preflightExplicitReceiptImportOverAllocation` → `preflightReceiptImportAllocation`; made the loop call unconditional within the receipt branch; resolve the invoice for every `invoice_reference`; map resolution `ValidationError.reason` → `Skipped`/`Unmatched` + diagnostics instead of swallowing; added `importAllocationPreflightStatus()` status-mapping helper. (1 file, +55 / −23) |

No other files were touched. **No frontend change, no migration, no RPC change.**

---

## 5. Logic Implemented

### 5.1 Preflight now runs unconditionally and before creation (`service.ts:540`–`556`)

```ts
const receiptInput = validateCreateReceipt(mappedData);
const preflight = await this.preflightReceiptImportAllocation(
  auth,
  resolved.customer.id,
  mappedData,
);

if (preflight) {
  await this.client.from('import_rows').update({
    status: preflight.status,
    invoice_id: null,
    receipt_id: null,
    mapped_data: preflight.mappedData,
    validation_errors: null,
  }).eq('id', row.id);
  continue;            // ← no createReceipt / postReceipt / allocate / import_row_allocations
}

created = await this.receiptService.createReceipt(auth, receiptInput);
```

> [!IMPORTANT]
> The call is **no longer wrapped in `if (autoPost)`**. A blocking `invoice_reference` is now rejected even on non-auto-post rows, so a bad reference can never silently produce an unallocated draft receipt. This implements the plan's §A.5 default recommendation (**reject**).

### 5.2 Invoice is always resolved; resolution errors are no longer swallowed (`service.ts:1066`–`1097`)

The previous `try { … } catch { return null; }` (which let every resolution failure fall through to `createReceipt`) is replaced by:

```ts
try {
  invoice = await this.resolveAllocationInvoice(auth.companyId, customerId, currency, invoiceReference);
} catch (error) {
  if (!(error instanceof ValidationError)) throw error;   // unexpected → bubbles to loop catch → Error
  const reason = typeof error.details.reason === 'string' ? error.details.reason : 'allocation_preflight_failed';
  return {
    status: this.importAllocationPreflightStatus(reason),
    mappedData: {
      ...mappedData,
      allocation_status: (reason === 'invoice_not_found_for_customer' || reason === 'currency_mismatch' || reason === 'multiple_matches')
        ? 'Unmatched' : 'Review Required',
      review_required: true,
      auto_post_eligible: false,
      auto_post_block_reason: error.message,
      allocation_error: error.message,
      allocation_error_reason: reason,
      invoice_status: error.details.invoice_status,
      invoice_currency: error.details.invoice_currency,
      receipt_currency: error.details.receipt_currency,
      outstanding: error.details.outstanding,
    },
  };
}
```

`resolveAllocationInvoice` (`service.ts:1249`+) already emits the typed `reason`s (`invoice_not_found_for_customer`, `multiple_matches`, `currency_mismatch`, `invoice_not_open`, `no_outstanding`); the preflight now surfaces them **before** any mutation.

### 5.3 Status-mapping helper (`service.ts:1131`)

```ts
private importAllocationPreflightStatus(reason: string): ImportRowStatus {
  return ['invoice_not_open', 'no_outstanding'].includes(reason) ? 'Skipped' : 'Unmatched';
}
```

### 5.4 Over-settlement check preserved (`service.ts:1099`–`1128`)

After successful resolution, `settlement = allocationAmount + discountAmount` is checked against `outstanding`. If `settlement > outstanding + 0.01`, the row is returned as **`Skipped`** with `review_required: true`, `auto_post_block_reason`, `allocation_suggestion`, and `unapplied_amount` (Batch 4/5 behavior, now executed pre-create). For the discount path it also records `discount_validation_error` and `excess_settlement_amount`.

---

## 6. Category 1 (Blocking) Outcome Matrix — As Implemented

For every case below: **no receipt created, none posted, no allocation, no `import_row_allocations` row.** Existing statuses only.

| Case | `reason` | `import_rows.status` | `allocation_status` | Key `mapped_data` |
|------|----------|----------------------|---------------------|-------------------|
| Invoice not found for customer | `invoice_not_found_for_customer` | `Unmatched` | `Unmatched` | `review_required:true`, `auto_post_eligible:false`, `allocation_error_reason`, `auto_post_block_reason` |
| Multiple matches | `multiple_matches` | `Unmatched` | `Unmatched` | as above |
| Currency mismatch | `currency_mismatch` | `Unmatched` | `Unmatched` | + `invoice_currency`, `receipt_currency` |
| Invoice Draft (not allocatable) | `invoice_not_open` | `Skipped` | `Review Required` | + `invoice_status` |
| Invoice Paid / closed | `invoice_not_open` | `Skipped` | `Review Required` | + `invoice_status` |
| No outstanding (`≤ 0`) | `no_outstanding` | `Skipped` | `Review Required` | + `outstanding` |
| Explicit over-allocation | (over-settlement math) | `Skipped` | `Review Required` | `auto_post_block_reason`, `allocation_suggestion`, `unapplied_amount` |
| `allocation + discount > outstanding` | (over-settlement math) | `Skipped` | `Review Required` | `discount_validation_error`, `excess_settlement_amount` |

> [!NOTE]
> Invalid file values (`allocation_amount ≤ 0`, negative `discount_amount`) **throw** a `ValidationError` from the preflight (`service.ts:1053`–`1064`), which propagates to the loop's row-level catch → row marked **`Error`**, no receipt created.

---

## 7. Category 2 (Non-Blocking) — Batch 5 Bank-Charge Flow Preserved

> [!IMPORTANT]
> The preflight does **not** reject a row for carrying bank-charge diagnostics. A bank-charge row whose invoice is valid and allocatable passes the over-settlement check (received amount ≤ outstanding → `return null`) and proceeds to `createReceipt` → `postReceipt` → `allocateReceiptImportRow`.

Confirmed behavior (`service.ts:1169`–`1231`, unchanged):
- received amount only is allocated through `manualAllocate()` / `allocate_receipt`;
- invoice remains **Partially Paid** for the bank-charge difference;
- `review_required: true` and `bank_charge_posting_required: true` are set;
- `bank_charge_review_reason` documents that bank-charge accounting is not automated;
- **no bank-charge journal entry** is created; the charge is **not** treated as a discount.

A bank-charge row is rejected **only** if it independently meets a Category 1 condition (e.g. the referenced invoice is Paid).

---

## 8. Commands / Checks Run

| Check | Result |
|-------|--------|
| `deno check --allow-import backend/supabase/functions/imports/index.ts` | ✅ Passed |
| `deno check backend/supabase/functions/allocations/index.ts` | ✅ Passed |
| `git diff --check` | ✅ Passed (Windows CRLF warnings only — not errors) |
| `git commit` | ✅ Committed as `d18b19f` |
| `git push` | ✅ Pushed |

---

## 9. Smoke Test Checklist and Results

Executed against live data on 2026-06-13 with a single 7-row import batch.

**Batch tally (as observed):**

| Metric | Count |
|--------|-------|
| Total rows | 7 |
| Allocated | 2 |
| Posted | 2 |
| Receipts created | 2 |
| Unmatched | 2 |
| Skipped | 3 |

`2 (Allocated) + 2 (Unmatched) + 3 (Skipped) = 7`. The **5 blocking rows created no receipt** (`receipt_id` null); only the **2 valid rows** produced a receipt (created → posted → allocated).

| # | Row | Expected | Result |
|---|-----|----------|--------|
| 1 | **Invalid / not-found** `invoice_reference` `INV-209999-99999` | `Unmatched`, `review_required`, **no `receipt_id`** | ✅ PASSED |
| 2 | **Currency mismatch** `INV-202606-00005` (SGD) vs receipt MYR | `Unmatched`, `review_required`, no `receipt_id` | ✅ PASSED |
| 3 | **Paid / no-outstanding** `INV-202606-00014` | `Skipped`, `review_required`, no `receipt_id` | ✅ PASSED |
| 4 | **Explicit over-allocation** (`allocation_amount > outstanding`) on `INV-202606-00016` | `Skipped`, `review_required`, no `receipt_id` | ✅ PASSED |
| 5 | **`allocation_amount + discount_amount > outstanding`** on `INV-202606-00016` | `Skipped`, `review_required`, no `receipt_id` | ✅ PASSED |
| 6 | **Valid** allocation row | `Allocated` — receipt created / posted / allocated | ✅ PASSED |
| 7 | **Valid bank-charge diagnostic** row (Category 2) | `Allocated` — receipt created / posted; **received amount only** allocated; `review_required` + `bank_charge_posting_required` diagnostics preserved; **no JE** | ✅ PASSED |

**All smoke tests passed.**

> [!NOTE]
> The **Draft** `invoice_reference` case (plan AC-1) was not a separate row in this run; it is rejected via the **same `invoice_not_open` reason path** as the Paid/no-outstanding case (#3), which was exercised and confirms the `invoice_not_open` / `no_outstanding` → `Skipped` mapping (`service.ts:1131`). Both Draft and Paid resolve to `invoice_not_open` in `resolveAllocationInvoice` (`service.ts:1290`).

---

## 10. What Was Intentionally NOT Changed

- ❌ **No frontend change** — receipt-import UI already renders `review_required` / skip diagnostics (Batch 4/5).
- ❌ **No migration** — no new `import_rows.status` value; existing enum reused.
- ❌ **No financial RPC change** — `allocate_receipt` / `post_receipt` untouched.
- ❌ **No direct `allocation_details` inserts.**
- ❌ **No direct `invoices.outstanding` updates.**
- ❌ **No direct `receipts.allocated_amount` / `unallocated_amount` updates.**
- ❌ **Implicit overpayment not rejected** — an implicit allocation (no explicit amount) capped at `min(receipt, outstanding)` never exceeds outstanding, so it flows through as Batch 4 unapplied cash; only **explicit** over-allocation is a Category 1 block.
- ❌ **`POST /allocations/auto` not enabled** — still 403.

---

## 11. Risks and Follow-Up Items

| # | Item | Notes | Priority |
|---|------|-------|----------|
| 1 | Invoice-import blocking-row invariant | Invoice import already validates before `createInvoice`; Batch 5-Fix-A focused on the receipt path. A confirming test/assertion for the invoice path remains a documentation/test follow-up | Recommended |
| 2 | Manual invoice double-click duplicates | Addressed separately in **Batch 5-Fix-B** (frontend submit lock) | Planned |
| 3 | Backend idempotency (`client_request_id`) | **Batch 5-Fix-C** — future hardening only; would require a migration; out of scope | Future |
| 4 | Automated regression tests | Preflight paths are smoke-tested manually; consider unit/integration coverage in the testing batch | Recommended |

---

## 12. Relationship to Sibling / Future Batches

> [!IMPORTANT]
> Batch 5-Fix-A delivers the **receipt-import allocation preflight** only. Remaining Batch 5-Fix scope:
>
> - **Batch 5-Fix-B** — manual invoice "Create & Post" double-click prevention (frontend single submit lock).
> - **Batch 5-Fix-C** — backend idempotency review / `client_request_id` (future hardening; migration-gated; documented only).
>
> Bank-charge GL posting, OCR, fuzzy matching, and fully automatic posting remain separate future batches (unchanged).

---

## 13. Acceptance Criteria Mapping (from Plan §F)

| Plan AC | Description | Status |
|---------|-------------|--------|
| AC-1 | Draft reference → no receipt | ✅ (via shared `invoice_not_open` path; Paid row #3 exercised it — see §9 note) |
| AC-2 | Paid reference → no receipt | ✅ (row #3) |
| AC-3 | Currency mismatch → no receipt | ✅ |
| AC-4 | Explicit over-allocation → no receipt | ✅ |
| AC-5 | Not found / multiple / customer mismatch / no outstanding → no receipt | ✅ |
| AC-7 | Receipt validation error → no draft receipt | ✅ |
| AC-10 | Valid receipt import still works | ✅ |
| AC-12 | Non-blocking bank-charge row still creates/posts/allocates | ✅ |
| AC-13 | Bank-charge row that independently hits Category 1 is rejected | ✅ |
| AC-14 | `review_required` alone does not block creation | ✅ |
| AC-16 | `POST /allocations/auto` still 403 | ✅ |
| AC-17 | No migration / no new status / no RPC change | ✅ |

> AC-6 (invoice-import path), AC-8/AC-9 (manual double-click), AC-11 (discount), AC-15 (overpayment regression) are owned by other batches / unchanged flows and are not re-verified here.

---

*Document created: 2026-06-13*  
*Batch 5-Fix-A status: ✅ Implemented · ✅ deno-check verified · ✅ Smoke tests passed · ✅ Committed & pushed (`d18b19f`)*  
*Author: Claude (GenAI-assisted development)*
