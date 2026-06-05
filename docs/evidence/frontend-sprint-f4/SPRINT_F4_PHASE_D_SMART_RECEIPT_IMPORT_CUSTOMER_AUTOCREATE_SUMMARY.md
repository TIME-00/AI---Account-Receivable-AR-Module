# Sprint F4 Phase D - Smart Receipt Import With Customer Auto-Creation

## Scope

Sprint F4 Phase D adds client-facing CSV/XLSX receipt import for the AR prototype.

The client uses the frontend only. They do not access Supabase or manually create database records. Receipt import therefore supports customer matching and customer creation from business-facing file data.

## Supported File Types

- CSV
- Excel `.xlsx`

PDF, image, OCR, Gemini/OCR, receipt allocation, invoice matching, and posting are outside Phase D.

## Supported Receipt Columns

Customer fields:

- `customer_code`
- `customer_name`
- `registration_no`
- `bill_addr_line1`
- `bill_city`
- `bill_state`
- `bill_postal`
- `bill_country`
- `contact_name`
- `contact_phone`
- `contact_email`

Receipt fields:

- `receipt_date`
- `currency`
- `receipt_reference`
- `payment_method`
- `bank_account_code`
- `bank_account_id`
- `amount`
- `cheque_date`
- `remarks`

`cheque_date` is required when `payment_method = CHQ`.

## Customer Matching Rules

- `customer_code` has priority.
- Unknown non-empty `customer_code` returns a row-level validation error.
- Hidden customers are ignored and are not reused.
- When `customer_code` is blank, the import matches by normalized visible customer name within the authenticated company.
- If no visible match exists, the import creates a new customer through `CustomerService`.
- Duplicate new-customer rows in the same batch create one customer and reuse it for later rows.

## Bank Account Rules

- `bank_account_id` is accepted when it is a valid active bank account in the authenticated company.
- `bank_account_code` resolves against `bank_accounts.account_no`.
- No frontend `GET /bank-accounts` API was added.
- No default bank account is silently selected.

## Draft-Only Guarantee

Phase D uses `ReceiptService.createReceipt()`.

Imported receipts:

- remain `Draft`
- have `allocated_amount = 0`
- have `unallocated_amount = receipt_amount`
- have `posted_at = null`
- do not create allocation rows
- do not perform invoice matching
- do not post
- do not create journal entries

Batch counters:

- `created_count` is the created receipt count for receipt batches.
- `matched_customers_count` records distinct visible customers matched.
- `created_customers_count` records distinct customers created.
- `posted_count` remains `0`.
- `allocated_count` remains `0`.

## Pages Updated

- `/receipts` now has an Import CSV/Excel entry point.
- `/receipts/import` provides the Phase D import wizard.
- The shared import hook supports `importType: "invoice" | "receipt"`.

## Smoke Test Checklist

- Upload receipt CSV with existing customer code.
- Validate Customer Action = Matched Existing.
- Execute creates Draft receipt.
- Upload receipt CSV with new customer data.
- Validate Customer Action = Create New.
- Execute creates new customer and Draft receipt.
- Duplicate new-customer rows create one customer and multiple receipts.
- Unknown non-empty customer code returns row-level error.
- Missing customer identity returns row-level error.
- CHQ row requires and accepts `cheque_date`.
- XLSX new-customer receipt import works.
- XLSX invalid missing-customer receipt import returns row-level errors.
- Imported receipts remain Draft.
- `posted_count = 0`.
- `allocated_count = 0`.
- No allocation records are created.
- No journal entries are created.

## Confirmation

No financial records are deleted.

No financial RPCs are changed.

No direct frontend Supabase table inserts are used.

No receipt posting, automatic allocation, invoice matching, PDF/Image/OCR, or `/allocations/auto` behavior is implemented in Phase D.
