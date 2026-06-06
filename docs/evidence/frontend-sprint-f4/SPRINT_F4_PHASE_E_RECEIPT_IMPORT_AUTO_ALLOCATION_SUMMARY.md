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

- `auto_post=false` keeps imported receipts Draft.
- `auto_post=true` with no `invoice_reference` posts receipts only.
- `auto_post=true` with valid `invoice_reference` posts and allocates.
- invalid invoice references become `Unmatched`.
- wrong-customer invoice references do not allocate.
- allocation amount without invoice reference is rejected before financial mutation.
- allocation amount greater than invoice outstanding is rejected by validation/RPC.
- successful allocations create `import_row_allocations` rows.
- invoice import `auto_post=true` is blocked.

## Safety Confirmation

Phase E does not add new financial RPCs.

Phase E does not use `AllocationService.autoAllocate()`.

Phase E does not implement FIFO, AmountMatch, fuzzy matching, discounts, one receipt to many invoices, PDF/Image/OCR, or direct financial table mutation.

No production deployment has been performed as part of local implementation.
