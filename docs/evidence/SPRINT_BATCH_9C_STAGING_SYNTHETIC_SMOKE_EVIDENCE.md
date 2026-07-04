# Sprint Batch 9C Staging Synthetic Smoke Evidence

## Scope

Batch 9C Gate S2 staging synthetic smoke for Receipt PDF/Image Import Intake.

This smoke used staging only and synthetic files only. It did not deploy, migrate, touch production, use real customer documents, enable OCR providers, auto-post receipts, auto-allocate receipts, or create journal entries from Receipt PDF/Image intake.

## Baseline

- Baseline commit before smoke: `c9cdea2ff9643f1a73c56c40d00eb49052a4480a`
- Staging Supabase project ref: `gcdsdyegwjdcskpukqlq`
- Production Supabase project ref explicitly not targeted: `kusseuycqgdilychphpq`
- Staging `imports` Edge Function: `ACTIVE`, version `9`
- Gate S1 evidence: `docs/evidence/SPRINT_BATCH_9C_STAGING_DEPLOYMENT_EVIDENCE.md`

## Authentication and authorization

- Staging authenticated role used: Finance Manager
- Auth sanity check: `GET /auth/me` returned HTTP `200`
- No access token, refresh token, password, service-role key, signed preview URL, or private credential is recorded in this evidence.
- Role was sufficient for:
  - upload;
  - signed preview request;
  - review list;
  - save review;
  - approve draft.

## Synthetic fixture generation

Synthetic fixtures were generated locally under a temporary OS directory and removed after the run.

Fixtures generated:

- `B9C-STAGING-SMOKE-receipt.pdf`
- `B9C-STAGING-SMOKE-receipt.png`
- `B9C-STAGING-SMOKE-receipt.jpg`
- `B9C-STAGING-SMOKE-receipt.webp`
- `B9C-STAGING-SMOKE-receipt.svg`
- `B9C-STAGING-SMOKE-receipt.svgz`
- `B9C-STAGING-SMOKE-receipt.csv`
- `B9C-STAGING-SMOKE-invoice.pdf`

No real company branding, customer document, bank detail, invoice, receipt, token, or secret was used.

Note: an initial local PDF fixture calibration attempt with a UTF-8 BOM was rejected by backend magic-number validation before the final smoke matrix. The accepted PDF fixture was regenerated as raw ASCII bytes beginning with `%PDF-`.

## Supported Receipt PDF/Image upload matrix

Run id: `20260704-190416`

| Format | HTTP status | Result | Batch ID | File ID | Row ID | Import type | Batch status | Row status | Review kind | Counts |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PDF | 201 | Accepted | `80d19439-99db-4cc0-9790-c6d1c2f2a1f1` | `12611345-e338-456e-ae6b-13dbe040a625` | `446241eb-ff34-41ba-9e2c-6928ddac1c71` | receipt | NeedsReview | NeedsReview | `ocr_receipt_manual_entry` | created/post/allocated = 0/0/0 |
| PNG | 201 | Accepted | `52638e8b-2b61-4a04-9deb-d3f850917dfd` | `53a7fe8c-fe63-4b48-a5a4-63b05fcc7606` | `c903a40c-bb46-4a06-a406-ac152cd6502d` | receipt | NeedsReview | NeedsReview | `ocr_receipt_manual_entry` | created/post/allocated = 0/0/0 |
| JPG | 201 | Accepted | `3e315552-6c48-4212-8337-c58ecef3a0e2` | `52a811e7-c442-4460-b517-51b711d59315` | `701c345c-37b8-4774-baef-9f22badf028d` | receipt | NeedsReview | NeedsReview | `ocr_receipt_manual_entry` | created/post/allocated = 0/0/0 |
| WebP | 201 | Accepted | `92ca8893-2a2a-451f-96a3-b333f40f0a66` | `13442bee-7a5a-48b0-b546-e01767d6e88b` | `db4d487c-f665-4544-88fc-ef0449576c3a` | receipt | NeedsReview | NeedsReview | `ocr_receipt_manual_entry` | created/post/allocated = 0/0/0 |

All accepted Receipt PDF/Image uploads returned manual fallback metadata and remained review/draft-only.

## Rejected format matrix

| Format | HTTP status | Error code | Result |
| --- | ---: | --- | --- |
| SVG | 400 | `VALIDATION_ERROR` | Rejected with message: SVG files are not supported for OCR intake v1. |
| SVGZ | 400 | `VALIDATION_ERROR` | Rejected with message: SVG files are not supported for OCR intake v1. |

No accepted intake batch was created for the SVG/SVGZ rejection cases.

## Signed preview and tenant check

Tested against accepted PDF receipt intake batch:

- Valid signed preview request: HTTP `200`
- Signed URL field present: yes
- Signed URL expiry: `120` seconds
- Full signed URL not recorded.
- Wrong-company preview check: HTTP `403`

This confirms backend-generated short-lived preview and tenant/role verification behavior.

## Review/save smoke

Tested against accepted PDF receipt intake row:

- `GET /imports/:batchId/ocr-review`: HTTP `200`
- Review list returned: `1` file and `1` row
- `PATCH /imports/:batchId/rows/:rowId/ocr-review`: HTTP `200`
- Decisions recorded: `8`
- Row status after save: `NeedsReview`

Reviewed field set used:

- `customer_name = SYNTHETIC CUSTOMER`
- `receipt_date = 2026-07-04`
- `currency = SGD`
- `receipt_reference = SYN-B9C-RECEIPT-001`
- `payment_method = TT`
- `amount = 10.00`
- `bank_account_code = SYNTHETIC`
- `remarks = Batch 9C staging synthetic smoke`

Fields intentionally not used:

- `invoice_reference`
- `allocation_amount`

## Approve-draft smoke

Tested against accepted PDF receipt intake row:

- `POST /imports/:batchId/rows/:rowId/approve-draft`: HTTP `200`
- Batch status after approval: `ApprovedDraft`
- Row status after approval: `ApprovedDraft`
- Batch counters after approval:
  - `created_count = 0`
  - `posted_count = 0`
  - `allocated_count = 0`
- Response message confirmed draft-only behavior: no financial records were created, nothing was posted, and no allocation was performed.

## Financial zero-mutation verification

Read-only staging verification was scoped to `B9C-STAGING-SMOKE` identifiers and Batch 9C smoke batch IDs.

Results:

- Final posted receipts from Receipt PDF/Image smoke: `0`
- Invoices from smoke prefix: `0`
- Journal entries from smoke prefix: `0`
- Allocation rows from smoke: `0`
- Invoice outstanding updates from Receipt PDF/Image smoke: `0`
- Receipt allocated/unallocated amount updates from Receipt PDF/Image smoke: `0`

Verification basis:

- Approved-draft response counters remained zero.
- Prefix-scoped read-only REST checks returned zero receipts, invoices, and journal entries.
- Because no smoke receipt record was created, no `allocation_details` row can be linked to a smoke receipt.
- No execute/post/allocate route was called for Receipt PDF/Image intake.

## Receipt CSV/Excel regression

Synthetic receipt CSV regression used only the existing CSV upload and parse path.

Results:

- Receipt CSV upload: HTTP `201`
- Receipt CSV batch ID: `67206916-0264-45aa-8163-1c7e891197b9`
- Parse: HTTP `200`
- Parsed rows: `1`
- Execute: not run
- Auto-post/allocation: not run
- Financial records created: none

## Invoice PDF/Image regression

Synthetic invoice PDF regression verified existing Batch 9B invoice intake still accepts PDF/Image intake.

Results:

- Invoice PDF upload: HTTP `201`
- Invoice PDF batch ID: `cd3b4434-cf07-47a0-88c8-391e6fd3f8c6`
- Row status: `NeedsReview`
- Review kind: `ocr_invoice_manual_entry`
- Invoice posting: not run
- Journal entry creation: none

## `/allocations/auto` runtime invariant

Staging check:

- `POST /allocations/auto`
- HTTP status: `403`
- Error code: `AUTO_ALLOCATION_DISABLED`

No allocation workaround was attempted.

## Cleanup and residual synthetic artifacts

Local temporary synthetic files were removed after the smoke run.

No supported cleanup route exists for import metadata/storage artifacts. To avoid direct table or storage mutation, synthetic staging import metadata/storage artifacts were retained with clear `B9C-STAGING-SMOKE` names.

Residual synthetic batch IDs:

- `80d19439-99db-4cc0-9790-c6d1c2f2a1f1`
- `52638e8b-2b61-4a04-9deb-d3f850917dfd`
- `3e315552-6c48-4212-8337-c58ecef3a0e2`
- `92ca8893-2a2a-451f-96a3-b333f40f0a66`
- `67206916-0264-45aa-8163-1c7e891197b9`
- `cd3b4434-cf07-47a0-88c8-391e6fd3f8c6`

No protected financial table was directly edited or cleaned.

## Safety confirmations

- Production was not targeted.
- No production data was touched.
- No migration was created or applied.
- No real customer documents were used.
- No real invoice or receipt documents were used.
- No OCR provider/key/worker was added or enabled.
- No auto-extraction was enabled.
- No Receipt PDF/Image auto-posting occurred.
- No Receipt PDF/Image auto-allocation occurred.
- No journal entry was created from Receipt PDF/Image intake.
- No direct protected financial table mutation was performed.
- No `ar.*` schema was used.
- No token, password, service-role key, or signed preview token is recorded.

## Final Gate S2 verdict

PASS WITH SYNTHETIC METADATA RETAINED
