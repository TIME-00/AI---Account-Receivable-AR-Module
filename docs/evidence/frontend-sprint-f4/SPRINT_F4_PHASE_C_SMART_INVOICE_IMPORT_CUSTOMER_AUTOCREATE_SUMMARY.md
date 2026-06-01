# Sprint F4 Phase C - Smart Invoice Import with Customer Auto-Creation

## Purpose

The AR module is a client-facing self-service prototype. Client users work through the frontend and do not manually create Supabase records or supply internal database identifiers.

Phase C removes the requirement to pre-create every invoice-import customer. CSV/XLSX invoice rows can identify an existing visible customer by system-generated customer code, or provide customer master data so the backend can match or create the customer before creating a draft invoice.

## Scope

- CSV and XLSX invoice import only.
- Draft invoice creation only.
- No posting.
- No receipt import.
- No allocation.
- No journal entries.
- No PDF, image, or OCR behavior.
- Public schema only.

## Supported File Columns

Customer fields:

- `customer_code` - optional existing visible code
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

Invoice fields:

- `invoice_date`
- `currency`
- `reference_no`
- `description`
- `quantity`
- `unit_price`
- `tax_rate`

## Matching Rules

1. A supplied `customer_code` has priority and must match a visible, non-deleted customer in the authenticated company.
2. An unknown non-empty `customer_code` returns a row-level error. It does not create a new customer.
3. When `customer_code` is blank, normalized company-scoped customer-name matching is used.
4. Supplied registration numbers are checked as a stronger conflict signal.
5. Hidden historical customers are never matched or reused automatically.
6. Unmatched blank-code rows must provide the required customer master fields.

## Creation Rules

- Validation is read-only and classifies rows as `Matched Existing`, `Create New`, or `Error`.
- Customer creation happens during confirmed execution only.
- New customers are created through `CustomerService.createInlineCustomer()`.
- `CustomerService.createCustomer()` generates internal UUIDs, `CUST` codes, tenant ownership, visible/non-deleted state, account mappings, and AR Clerk creator assignment.
- Duplicate new-customer rows are cached during batch execution so the customer is created once and reused.
- Draft invoices continue through `validateCreateInvoice()`, `validateInvoiceLines()`, and `InvoiceService.createInvoice()`.

## Audit Evidence

- `database/012_import_customer_autocreate_counts.sql` adds:
  - `import_batches.matched_customers_count`
  - `import_batches.created_customers_count`
- Existing `import_rows.mapped_data` JSONB stores row-level `customer_resolution` details.
- Existing `created_count` remains the created draft-invoice count.
- Existing `error_rows` remains the failed-row count.

## Automated Checks

- [x] `npm.cmd run build`
- [x] `deno check --allow-import imports/index.ts`
- [x] `deno check customers/index.ts`
- [x] `deno check invoices/index.ts`
- [x] Phase C PowerShell smoke-script syntax check
- [x] Phase B/C XLSX fixture generation check
- [ ] Phase A CSV regression smoke test
- [ ] Phase B XLSX regression smoke test
- [ ] Phase C smart customer import smoke test

## Staging Smoke Checklist

- [ ] Existing visible `customer_code` classifies as `Matched Existing`.
- [ ] Blank-code new customer classifies as `Create New`.
- [ ] Execution creates one visible customer and one draft invoice.
- [ ] Repeated normalized new-customer name creates one customer and multiple draft invoices.
- [ ] Missing code and missing name returns row-level validation error.
- [ ] Unknown non-empty code returns row-level validation error.
- [ ] XLSX blank-code new customer creates a draft invoice.
- [ ] Created invoices remain `Draft` with `posted_at IS NULL`.
- [ ] `posted_count = 0`.
- [ ] `allocated_count = 0`.
- [ ] `receipt_id IS NULL`.
- [ ] No invoice journal entries are created.
- [ ] Hidden historical customers are not reused.

## Deployment Status

Implementation is local only. Apply migrations and run staging verification before any production deployment. API smoke scripts remain pending because the local shell does not contain staging credentials and the Phase C backend has not been deployed to staging.
