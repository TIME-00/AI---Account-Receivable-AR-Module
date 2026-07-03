# Sprint Batch 9C Backend Receipt PDF/Image Import Intake Evidence

## Scope

Batch 9C adds backend/API/test support for Receipt PDF/Image Import Intake by extending the existing Batch 9B PDF/Image intake foundation.

This implementation is backend-only. It does not include frontend UI work, deployment, staging smoke, production smoke, OCR provider enablement, OCR worker setup, or any staging/production data action.

## Baseline

- Baseline branch: `main`
- Baseline commit before implementation: `0969a23dd624c09e3234ee12b87eaf1b6a686485`
- Planning document: `docs/plans/BATCH_9C_RECEIPT_PDF_IMAGE_IMPORT_INTAKE_PLAN.md`
- Codex Gate 2 amendment confirmation: `PASS`
- Remaining Gate 2 blockers: none

## Files changed

- `backend/supabase/functions/imports/index.ts`
- `backend/supabase/functions/imports/intake_validation.ts`
- `backend/supabase/functions/imports/service.ts`
- `backend/supabase/functions/imports/ocr_intake_test.ts`
- `docs/evidence/SPRINT_BATCH_9C_BACKEND_RECEIPT_PDF_IMAGE_IMPORT_INTAKE_EVIDENCE.md`

## Implementation summary

- Added a shared backend import-type validator for PDF/Image intake:
  - accepts only `invoice` and `receipt`;
  - rejects any other `import_type` before service-layer upload processing;
  - leaves service-layer validation in place as defense in depth.
- Updated `POST /imports/ocr/upload` route handling so route-level validation occurs before `service.uploadOcrIntakeFile`.
- Updated `uploadOcrIntakeFile` so it supports:
  - `import_type=invoice`, preserving existing invoice review/draft-only behavior;
  - `import_type=receipt`, creating receipt review/draft-only import metadata.
- Receipt PDF/Image intake now uses distinct review metadata:
  - `review_kind = ocr_receipt_manual_entry`.
- Generalized backend manual fallback messaging so receipt intake does not say invoice fields or imply invoice posting.
- Kept PDF/Image intake draft/review-only:
  - no invoice posting;
  - no receipt posting;
  - no allocation;
  - no journal entry creation;
  - no direct protected financial table mutation.

## Database and migration review

No migration was created.

Reason:

- Existing schema supports `import_batches.import_type IN ('invoice', 'receipt')`.
- Existing import file type constraints support `pdf` and `image`.
- Batch 9B migration `database/016_import_ocr_intake_extensions.sql` already added the PDF/Image file-safety metadata and `ocr_review_decisions` audit table.
- Batch 9C only generalizes existing backend intake behavior from invoice-only to invoice-or-receipt.

Public schema only was used. No `ar.*` schema was introduced.

## Security/RLS review

Batch 9C reuses the existing Batch 9B company-scoped import architecture:

- Auth context remains required.
- `POST /imports/ocr/upload` still requires an authenticated write-capable role.
- Signed preview, review list, review save, and approve-draft routes continue to load company-scoped import batches/files/rows.
- Service-role code continues to perform explicit company checks through existing batch and file lookup helpers.
- Storage remains under tenant-scoped `ar-imports` paths.
- No new RLS policy or table was added in this implementation.

## Financial correctness review

Receipt PDF/Image intake remains review/draft-only.

Confirmed safety boundaries:

- No direct insert into `allocation_details`.
- No direct update to `invoices.outstanding`.
- No direct update to `receipts.allocated_amount`.
- No direct update to `receipts.unallocated_amount`.
- No protected financial record delete.
- No financial RPC bypass.
- No auto-posting.
- No auto-allocation.
- No journal entry creation.
- No `/allocations/auto` call or route change.

Route-level negative tests verify receipt PDF/Image intake batches cannot enter the CSV/XLSX `parse`, `validate`, or `execute` paths and that zero protected financial mutations occur.

## OCR/provider review

No OCR provider was implemented or enabled.

Confirmed:

- No OCR provider key added.
- No `NEXT_PUBLIC_*` OCR key added.
- No self-hosted OCR worker added.
- Disabled/manual fallback provider behavior remains unchanged.
- Provider output remains untrusted suggestion/review data only.

## Tests and checks run

### Deno Edge Function check

Command:

```text
cd backend/supabase/functions
deno check auth/index.ts lookups/index.ts search/index.ts notifications/index.ts allocations/index.ts reports/index.ts imports/index.ts customers/index.ts invoices/index.ts receipts/index.ts
```

Result: PASS.

### Targeted import tests

Command:

```text
cd backend/supabase/functions
deno test --no-lock --config imports/deno.json imports/ocr_intake_test.ts imports/parser_security_test.ts
```

Result: PASS.

Summary:

- 20 tests passed.
- 0 tests failed.

Coverage added or preserved:

- receipt PDF upload accepted;
- receipt PNG/JPEG/WebP uploads accepted;
- receipt SVG/SVGZ rejected through existing file-safety validation;
- route-level `import_type` allowlist accepts only invoice/receipt;
- invoice PDF/Image intake path still works;
- existing receipt CSV upload path remains supported;
- receipt PDF/Image intake creates review-only metadata with `ocr_receipt_manual_entry`;
- receipt PDF/Image intake cannot enter `parse`, `validate`, or `execute`;
- protected financial table mutation count remains zero in negative path tests;
- disabled OCR provider remains manual-fallback only.

## Safety confirmations

- No deployment occurred.
- No staging data was touched.
- No production data was touched.
- No staging or production upload occurred.
- No real customer documents were used.
- No real invoices or receipts were created.
- No migration was created or applied.
- No OCR provider/key/worker was added.
- No auto-posting/allocation/journal-entry path was added.
- `/allocations/auto` remains disabled by source invariant and was not modified.
- Database remains public-schema only; no `ar.*` schema was introduced.

## Known limitations and follow-up

- Frontend UI for Receipt PDF/Image Import is not implemented in this backend batch.
- Claude Code should update the receipt import UI later to:
  - add CSV/Excel vs PDF/Image mode selection;
  - call the existing PDF/Image intake API with `import_type=receipt`;
  - use receipt-specific review fields;
  - avoid user-facing OCR wording;
  - state clearly that receipt PDF/Image intake does not post receipts, allocate receipts, or create final financial records.
- Staging migration/deploy/smoke is not part of this implementation step and requires separate user approval.

## Final implementation verdict

PASS for local backend/API/test implementation.
