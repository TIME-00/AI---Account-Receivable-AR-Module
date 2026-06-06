# Sprint F4 Phase E - Receipt Import Auto Allocation

## Scope

Sprint F4 Phase E adds optional auto-post and one-invoice allocation orchestration to CSV/XLSX receipt import.

The default behavior remains Phase D draft-only receipt import. Auto-post must be explicitly enabled during execute.

## Financial Flow

Phase E uses only existing verified backend services and P1 RPCs:

1. `ReceiptService.createReceipt()` creates a Draft receipt.
2. `ReceiptService.postReceipt()` calls `post_receipt` to post the receipt and create the receipt journal entry.
3. `AllocationService.manualAllocate()` calls `allocate_receipt` to allocate one posted receipt to one exact invoice reference.

Draft receipts are never allocated directly.

## Allocation Rules

- `invoice_reference` must match an exact `invoices.invoice_no`.
- The invoice must belong to the same company, customer, and currency.
- The invoice must be `Open`, `Overdue`, or `Partially Paid`.
- One receipt import row can allocate to one invoice only.
- `allocation_amount` is optional when `invoice_reference` is present.
- `allocation_amount` without `invoice_reference` is a row-level validation error.
- Fuzzy matching, FIFO, AmountMatch, overpayment automation, discounts, and one-receipt-to-many-invoice allocation are out of scope.

## Audit Evidence

Successful allocations are recorded in `import_row_allocations` with a real `allocation_details.id`.

Failed, skipped, or unmatched allocation results are stored in `import_rows.mapped_data` using:

- `allocation_status`
- `allocation_error`
- resolved invoice/allocation details when available

No failed or skipped allocation row is inserted into `import_row_allocations`.

## Database Constraint

`database/013_import_enable_auto_post.sql` relaxes the Phase A no-auto constraint safely:

- `auto_post = TRUE` is allowed only for `import_type = 'receipt'`.
- invoice import auto-post remains blocked.
- `auto_allocate = TRUE` remains blocked for all import batches.

## Frontend Updates

`/receipts/import` now exposes:

- `invoice_reference` and `allocation_amount` template fields.
- an explicit Auto-Post & Allocate checkbox.
- warning text before financial posting/allocation.
- posted and allocated result counters.
- allocation status visibility per row.

## Smoke Test Checklist

- [x] `auto_post=false` keeps imported receipts Draft.
- [x] `auto_post=true` with no `invoice_reference` posts receipts only.
- [x] `auto_post=true` with valid `invoice_reference` posts and allocates.
- [x] invalid invoice references become `Unmatched`.
- [x] wrong-customer invoice references do not allocate.
- [x] allocation amount without invoice reference is rejected before financial mutation.
- [x] allocation amount greater than invoice outstanding is rejected by validation/RPC.
- [x] successful allocations create `import_row_allocations` rows.
- [x] invoice import `auto_post=true` is blocked.

## Production Smoke Test Result

**Date**: 2026-06-07  
**Status**: ✅ Passed  
**Environment**: Production

### Batch Result

| Counter | Value |
|---------|-------|
| Draft Receipts Created | 1 |
| Errors | 0 |
| Posted | 1 |
| Allocated | 1 |
| Matched Customers | 1 |
| Created Customers | 0 |

### Imported Receipt

| Field | Value |
|-------|-------|
| `receipt_no` | RCT-202606-00006 |
| `status` | Fully Allocated |
| `receipt_amount` | 1.00 |
| `allocated_amount` | 1.00 |
| `unallocated_amount` | 0.00 |
| `posted_at` | Not null (posted successfully) |

### Allocation Details

| Field | Value |
|-------|-------|
| `allocation_details` row | Exists |
| `allocated_amount` | 1.00 |
| `receipt_no` | RCT-202606-00006 |
| `invoice_no` | DN-202606-00001 |

### Invoice After Allocation

| Field | Value |
|-------|-------|
| `invoice_no` | DN-202606-00001 |
| `status` | Partially Paid |
| `total_amount` | 2000.00 |
| `outstanding` | 1999.00 |

The invoice outstanding decreased by the allocation amount (2000.00 − 1.00 = 1999.00), confirming that `allocate_receipt` RPC correctly updated the invoice balance.

### Frontend Verification

| Check | Result |
|-------|--------|
| Receipt page shows RCT-202606-00006 | ✅ Visible as Fully Allocated |
| Allocation progress bar | ✅ Shows 100% |
| Applied amount | 1.00 |
| Available (unallocated) amount | 0.00 |

### Allocation Wizard Behavior

The Allocation Wizard correctly excludes RCT-202606-00006 from manual allocation because its `unallocated_amount = 0.00`. Fully allocated receipts are no longer eligible for further allocation, consistent with the `allocate_receipt` RPC precondition check (`unallocated_amount > 0`).

## Safety Confirmation

Phase E does not add new financial RPCs.

Phase E does not use `AllocationService.autoAllocate()`.

Phase E does not implement FIFO, AmountMatch, fuzzy matching, discounts, one receipt to many invoices, PDF/Image/OCR, or direct financial table mutation.

## Production Status

✅ **Phase E production smoke test passed.** The receipt import auto-allocation feature is deployed, verified, and ready for use.

All financial mutations flowed through verified services and P1 RPCs:
- `ReceiptService.createReceipt()` → Draft receipt
- `ReceiptService.postReceipt()` → `post_receipt` RPC → Posted receipt + receipt JE
- `AllocationService.manualAllocate()` → `allocate_receipt` RPC → Allocation details + invoice balance update

