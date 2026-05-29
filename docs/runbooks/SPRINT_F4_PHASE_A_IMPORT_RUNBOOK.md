# Sprint F4 Phase A Import Runbook

Scope: CSV invoice import, draft creation only.

This phase adds import batch tracking, CSV upload/parse/validate endpoints, and draft invoice creation through the existing invoice service. It does not post invoices and does not implement receipts, allocation, allocation history, Excel, PDF, image, or OCR.

## Files

- `database/008_import_tables.sql`
- `database/008b_import_rls_smoke_tests.sql`
- `backend/supabase/functions/imports/index.ts`
- `backend/supabase/functions/imports/service.ts`
- `backend/supabase/functions/imports/csv.ts`
- `tests/curl/import-phase-a-smoke.ps1`
- `tests/fixtures/import-phase-a-valid.csv`
- `tests/fixtures/import-phase-a-invalid.csv`

## Database

Run after P0/P1 migrations:

```sql
\i database/008_import_tables.sql
```

Tables added:

- `import_batches`: one row per uploaded CSV import batch.
- `import_rows`: one row per parsed CSV row with raw data, mapped data, validation errors, and created draft invoice ID.
- `import_row_allocations`: normalized allocation trace table reserved for later phases.
- `import_files`: file metadata for uploaded CSV files and future OCR phases.

Import evidence is audit-safe: no `ON DELETE CASCADE` is used and no DELETE RLS policies are created.

## RLS And Storage

RLS is enabled for all import tables.

Read access:

- `AR Clerk`
- `AR Supervisor`
- `Finance Manager`
- `Auditor`

Write access:

- `AR Clerk`
- `AR Supervisor`
- `Finance Manager`

`System Admin` is excluded from import operational data. Inactive roles are rejected. Policies use both `USING` and `WITH CHECK`.

Storage bucket:

- Bucket: `ar-imports`
- Public: `false`
- Path convention: `{company_id}/{batch_id}/{original_filename}`
- Authenticated users can access only files under company prefixes for which they have an active allowed role.

## API Routes

Base path:

```text
/functions/v1/imports
```

Routes:

- `POST /imports/upload`
- `POST /imports/:batch_id/parse`
- `POST /imports/:batch_id/validate`
- `POST /imports/:batch_id/execute`
- `GET /imports`
- `GET /imports/:batch_id`
- `GET /imports/:batch_id/rows`

Required headers:

```text
Authorization: Bearer <access_token>
X-Company-Id: <company_uuid>
```

Upload payload:

```text
multipart/form-data
file=@invoices.csv
import_type=invoice
file_type=csv
batch_name=May Invoice Import
```

## CSV Template

Required columns:

```csv
customer_code,customer_name,invoice_date,currency,description,quantity,unit_price,tax_rate,reference_no,invoice_remarks
```

Customer matching:

- Prefer `customer_id` if a real `customers.id` UUID is supplied.
- Else use `customer_code` matching `customers.customer_id`.
- Else use exact `customer_name`.

Tax handling:

- `tax_rate = 0` creates a non-taxed line.
- For non-zero `tax_rate`, an active output `tax_codes` row with the same rate must exist.
- Alternatively, provide a real `tax_code_id` UUID.

Each CSV row creates one draft invoice with one line item.

## Validation

Validation checks include:

- Customer exists in the selected company.
- AR Clerk customer assignment is respected by existing auth helpers.
- Invoice date is valid.
- Currency is a 3-letter ISO code.
- Quantity and unit price are numeric and valid.
- Tax code can be resolved if tax is non-zero.
- Duplicate `reference_no` for the same customer is rejected.

## Draft Creation

Draft invoice creation calls the existing `InvoiceService.createInvoice()` method using the existing invoice validators. The import service does not directly insert into:

- `invoices`
- `invoice_lines`
- `journal_entries`
- `journal_entry_lines`
- `allocation_details`

## Tests

SQL RLS smoke test:

```powershell
# Run in Supabase SQL editor or psql against staging
database/008b_import_rls_smoke_tests.sql
```

API smoke test:

```powershell
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:COMPANY_ID = "<company_uuid>"
$env:AR_TOKEN = "<access_token>"

# Replace CUST-REPLACE-001 in tests/fixtures/import-phase-a-valid.csv first.
powershell -ExecutionPolicy Bypass -File tests/curl/import-phase-a-smoke.ps1
```

## Known Limitations

- CSV only.
- Invoice imports only.
- Draft creation only.
- One invoice line per CSV row.
- No posting.
- No receipt import.
- No allocation.
- No allocation history.
- No Excel.
- No PDF/image/OCR/Gemini.
- No `GET /allocations`.
- No `/allocations/auto`.

## Evidence

Recommended evidence path:

```text
docs/evidence/import-phase-a/
```

Record:

- SQL migration success.
- SQL RLS smoke test output.
- Edge Function deploy command used for staging.
- API smoke test output.
- Sample CSV used.
- Created `import_batch.id`.
- Created draft invoice IDs.

