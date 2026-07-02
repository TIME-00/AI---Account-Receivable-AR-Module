# Sprint Batch 9B-I1 PDF/Image/OCR Import Intake Implementation Evidence

## Scope

Batch 9B-I1 implements the backend/API/database foundation for invoice OCR/manual import intake.

This batch is intentionally backend-first and staging-first:

- invoice intake only;
- PDF plus raster image intake only;
- SVG/SVGZ excluded;
- OCR provider disabled/manual fallback by default;
- OCR/manual extraction creates review/draft data only;
- no posting;
- no receipt allocation;
- no direct protected financial mutation;
- no production deployment or production data action.

## Baseline

- Baseline commit: `7333048b10961e2ab444f0af982dbf6de6fbd9ce`
- Branch: `main`
- Local HEAD matched `origin/main` before implementation.
- Database schema target: `public` only.
- `/allocations/auto` remains required to return HTTP 403 `AUTO_ALLOCATION_DISABLED`.

## Files changed

- `database/016_import_ocr_intake_extensions.sql`
- `backend/supabase/functions/imports/index.ts`
- `backend/supabase/functions/imports/service.ts`
- `backend/supabase/functions/imports/file_validation.ts`
- `backend/supabase/functions/imports/ocr_provider.ts`
- `backend/supabase/functions/imports/ocr_intake_test.ts`
- `docs/evidence/SPRINT_BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_IMPLEMENTATION_EVIDENCE.md`
- `docs/evidence/SPRINT_BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_STAGING_SMOKE_EVIDENCE.md`

## Migration created

Created:

- `database/016_import_ocr_intake_extensions.sql`

Migration design:

- extends `public.import_files` with OCR/file-safety metadata;
- reuses existing `public.import_batches`, `public.import_files`, and `public.import_rows`;
- uses existing `import_files.ocr_result JSONB`;
- adds only one small append-only review audit table: `public.ocr_review_decisions`;
- updates existing import batch/row status constraints to support OCR/manual review states;
- extends private `ar-imports` bucket MIME allowlist for:
  - `application/pdf`;
  - `image/png`;
  - `image/jpeg`;
  - `image/webp`;
- explicitly excludes SVG/SVGZ;
- uses `public` schema only.

New `import_files` metadata columns:

- `content_mime_type`
- `detected_mime_type`
- `file_sha256`
- `page_count`
- `scan_status`
- `scan_result`
- `ocr_status`
- `ocr_provider`
- `ocr_started_at`
- `ocr_completed_at`
- `ocr_error`
- `retention_expires_at`

New append-only table:

- `public.ocr_review_decisions`

RLS posture:

- RLS enabled on `public.ocr_review_decisions`;
- AR Clerk, AR Supervisor, Finance Manager, and Auditor can read company-scoped rows;
- AR Clerk, AR Supervisor, and Finance Manager can insert company-scoped review decisions;
- no client UPDATE or DELETE policy is created;
- service-role use remains internal to Edge Functions and must still apply explicit tenant checks.

## Edge Function/API changes

Changed existing imports Edge Function only. No parallel import subsystem was created.

Added routes:

- `POST /imports/ocr/upload`
- `GET /imports/:batchId/files/:fileId/preview-url`
- `POST /imports/:batchId/files/:fileId/ocr/start`
- `GET /imports/:batchId/ocr-review`
- `PATCH /imports/:batchId/rows/:rowId/ocr-review`
- `POST /imports/:batchId/rows/:rowId/approve-draft`

Route behavior:

- `POST /imports/ocr/upload`
  - requires authenticated user;
  - requires import write role/capability;
  - accepts `import_type=invoice` only;
  - accepts `file_type=pdf|image` only;
  - validates file size, extension, MIME, magic number, SVG/SVGZ, double extensions, PDF page count, encrypted PDFs, and active/script PDF markers;
  - stores file in private tenant-scoped `ar-imports` path;
  - creates import batch/file metadata and one review row;
  - sets OCR disabled/manual fallback status;
  - does not post invoices, allocate receipts, or mutate protected financial balances.

- `GET /imports/:batchId/files/:fileId/preview-url`
  - requires authenticated user;
  - checks tenant/company and read role before issuing a short-lived signed URL;
  - does not expose public URLs.

- `POST /imports/:batchId/files/:fileId/ocr/start`
  - requires authenticated user and write capability;
  - refuses rejected/quarantined files;
  - currently returns controlled OCR-disabled/manual-fallback result unless a provider is separately enabled and implemented.

- `GET /imports/:batchId/ocr-review`
  - returns tenant-scoped review rows/files.

- `PATCH /imports/:batchId/rows/:rowId/ocr-review`
  - saves reviewed field values;
  - preserves raw-vs-reviewed values in row metadata;
  - records field-level audit rows.

- `POST /imports/:batchId/rows/:rowId/approve-draft`
  - promotes reviewed values to `ApprovedDraft` import state only;
  - does not create or post invoices;
  - does not allocate receipts;
  - requires AR Supervisor or Finance Manager when low-confidence review is still present.

## File validation controls

Implemented in `backend/supabase/functions/imports/file_validation.ts`.

Initial limits:

- PDF max size: 10 MB
- Image max size: 8 MB
- PDF page cap: 3 pages
- Batch file count target remains intentionally small for future UI/staging rollout.

Accepted types:

- PDF: `%PDF-`
- PNG: `89 50 4E 47 0D 0A 1A 0A`
- JPEG/JPG: `FF D8 FF`
- WebP: `RIFF....WEBP`

Rejected:

- SVG and SVGZ;
- unsupported extensions;
- double extensions;
- MIME/extension mismatch;
- missing browser MIME;
- magic-number mismatch;
- zero-byte files;
- oversized files;
- PDF above page cap;
- encrypted PDFs where detectable;
- PDF active/script markers where detectable.

Malware scanning:

- No malware scanning service is configured in v1.
- The implementation uses conservative validation fallback and records `scan_status='unavailable'` with a structured residual-risk scan result.
- OCR/manual review is not started for files in rejected or quarantined states.
- Staging must use synthetic files only.

## OCR provider abstraction

Implemented in `backend/supabase/functions/imports/ocr_provider.ts`.

Provider posture:

- OCR disabled/manual fallback by default.
- No production provider is configured.
- No provider keys are exposed to frontend.
- No `NEXT_PUBLIC_*` OCR provider keys are used.
- Cloud OCR remains blocked until separate approval.
- Provider output is normalized as untrusted suggestion data only.
- Disabled provider returns:
  - `status='disabled'`;
  - no raw OCR text;
  - no extracted fields;
  - manual fallback metadata.

## Tests/checks run

Local backend checks:

```text
cd backend/supabase/functions
deno check auth/index.ts lookups/index.ts search/index.ts notifications/index.ts allocations/index.ts reports/index.ts imports/index.ts customers/index.ts invoices/index.ts receipts/index.ts
```

Result: PASS.

Local Deno tests:

```text
cd backend/supabase/functions
deno test --no-lock --config imports/deno.json imports/ocr_intake_test.ts imports/parser_security_test.ts
```

Result: PASS.

Test coverage summary:

- valid PDF accepted;
- valid PNG accepted;
- valid JPEG/JPG accepted;
- valid WebP accepted;
- SVG rejected;
- SVGZ rejected;
- double-extension rejected;
- MIME spoof / magic mismatch rejected;
- zero-byte rejected;
- oversized rejected;
- PDF page cap rejected;
- encrypted PDF rejected;
- PDF active/script marker rejected;
- OCR disabled provider returns controlled manual-fallback result;
- existing XLSX parser security tests still pass.

Repository validation:

```text
git diff --check
```

Result: PASS.

## Safety boundary confirmation

- `/allocations/auto` was not modified or re-enabled.
- `AUTO_ALLOCATION_DISABLED` remains present in source.
- No direct insert into `allocation_details` was introduced.
- No direct update to `invoices.outstanding` was introduced.
- No direct update to `receipts.allocated_amount` was introduced.
- No direct update to `receipts.unallocated_amount` was introduced.
- No protected financial record deletion path was introduced.
- No invoice posting was added to OCR/manual intake.
- No receipt allocation was added to OCR/manual intake.
- No dashboard mock data was introduced.
- No frontend UI pages/components were implemented in this batch.
- No OCR provider secrets were added.
- No real documents were committed.
- No production action occurred.
- No `ar.*` schema was used.

## Staging execution summary

Staging project ref:

- `gcdsdyegwjdcskpukqlq`

Staging actions performed:

- applied `database/016_import_ocr_intake_extensions.sql` to staging only;
- deployed only the `imports` Edge Function to staging;
- verified deployed `imports` function status: ACTIVE v8;
- ran synthetic-file API smoke only;
- used no real company documents and no real customer financial data.

Staging verification summary:

- new `import_files` OCR/file-safety metadata columns present: 12 of 12;
- `public.ocr_review_decisions` exists;
- RLS enabled on `public.ocr_review_decisions`;
- `ar-imports` bucket remains private;
- `ar-imports` MIME allowlist includes CSV/XLSX/plain-text plus PDF/PNG/JPEG/WebP;
- SVG is not allowed;
- no `ar` schema exists;
- synthetic upload/review smoke created import metadata/review audit rows only;
- zero `public.invoices` rows were created with the Batch 9B staging smoke prefix;
- authenticated direct INSERT/UPDATE/DELETE remains denied on protected financial tables checked.

## Implementation result

Local implementation result: PASS.

Staging implementation result: PASS.

Batch 9B-I1 is ready for final review before commit/push.
