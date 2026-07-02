# Sprint Batch 9B-I1 PDF/Image/OCR Import Intake Staging Smoke Evidence

## Scope

This evidence records the staging-only migration, deployment, and synthetic-file smoke for Batch 9B-I1 backend/API/database implementation.

Approved staging scope:

- apply `database/016_import_ocr_intake_extensions.sql` to staging only;
- deploy changed imports Edge Function to staging only;
- use synthetic PDF/image files only;
- verify valid upload and rejection paths;
- verify OCR disabled/manual fallback mode;
- verify review/draft-only creation;
- verify `/allocations/auto` remains HTTP 403 `AUTO_ALLOCATION_DISABLED`;
- verify no direct protected financial DML.

## Baseline

- Baseline commit: `7333048b10961e2ab444f0af982dbf6de6fbd9ce`
- Staging project ref: `gcdsdyegwjdcskpukqlq`
- Production project ref: `kusseuycqgdilychphpq`
- Branch: `main`
- Local HEAD and `origin/main` matched the baseline before staging execution.

## Staging environment preflight

Preflight result: PASS.

- `SUPABASE_URL` exactly matched `https://gcdsdyegwjdcskpukqlq.supabase.co`.
- Active process environment did not contain production ref `kusseuycqgdilychphpq`.
- `SUPABASE_ACCESS_TOKEN` was present.
- Staging anon key was present.
- Staging `COMPANY_ID` was present.
- Staging Finance Manager / operational token was present.
- Local Batch 9B-I1 changes were present.

No secret values were printed or written.

## Local checks before staging

Commands:

```text
cd backend/supabase/functions
deno check auth/index.ts lookups/index.ts search/index.ts notifications/index.ts allocations/index.ts reports/index.ts imports/index.ts customers/index.ts invoices/index.ts receipts/index.ts
deno test --no-lock --config imports/deno.json imports/ocr_intake_test.ts imports/parser_security_test.ts
git diff --check
```

Results:

- Deno check: PASS.
- Deno tests: PASS, 14 passed, 0 failed.
- `git diff --check`: PASS.

## Staging migration

Applied to staging only:

```text
database/016_import_ocr_intake_extensions.sql
```

Command method:

```text
supabase db query --linked --file ../database/016_import_ocr_intake_extensions.sql --workdir backend --yes
```

Migration result: PASS.

Post-migration verification:

- `public.import_files` has all 12 new OCR/file-safety metadata columns.
- `public.ocr_review_decisions` exists.
- RLS is enabled on `public.ocr_review_decisions`.
- `ar-imports` bucket remains private.
- `ar-imports` allowed MIME types:
  - `text/csv`;
  - `application/csv`;
  - `text/plain`;
  - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;
  - `application/pdf`;
  - `image/png`;
  - `image/jpeg`;
  - `image/webp`.
- SVG MIME is not allowed.
- No `ar` schema exists.

## Staging Edge Function deployment

Deployed to staging only:

```text
supabase functions deploy imports --project-ref gcdsdyegwjdcskpukqlq --use-api --yes --workdir backend
```

Deployment result: PASS.

Post-deploy function inventory:

- `imports`: ACTIVE v8.

No unrelated function was deployed.

## Synthetic file smoke

All files were synthetic and generated locally for smoke testing only.

No real invoice, receipt, customer, or company-sensitive document was used.

Accepted upload checks:

| Case | Result |
| --- | --- |
| valid synthetic PDF | HTTP 201 |
| valid synthetic PNG | HTTP 201 |
| valid synthetic JPG/JPEG | HTTP 201 |
| valid synthetic WebP | HTTP 201 |

Rejected upload checks:

| Case | Result |
| --- | --- |
| SVG | HTTP 400 `VALIDATION_ERROR` |
| SVGZ | HTTP 400 `VALIDATION_ERROR` |
| double extension | HTTP 400 `VALIDATION_ERROR` |
| MIME spoof | HTTP 400 `VALIDATION_ERROR` |
| magic-number mismatch | HTTP 400 `VALIDATION_ERROR` |
| zero-byte file | HTTP 400 `VALIDATION_ERROR` |
| oversized image | HTTP 400 `VALIDATION_ERROR` |
| PDF page cap exceeded | HTTP 400 `VALIDATION_ERROR` |
| encrypted PDF marker | HTTP 400 `VALIDATION_ERROR` |
| active/script PDF marker | HTTP 400 `VALIDATION_ERROR` |

## Signed URL and tenant checks

Checks:

- Valid tenant/role preview URL request: HTTP 200.
- Response returned `signed_url`.
- Response did not expose a public bucket URL.
- Wrong-company preview URL request: HTTP 403.
- Wrong-company OCR review request: HTTP 403.

Result: PASS.

## OCR/manual fallback smoke

Checked:

- `POST /imports/:batchId/files/:fileId/ocr/start`

Result:

- HTTP 200.
- `manual_fallback=true`.
- No OCR provider secret required.
- No real OCR provider was called.
- Provider output remains untrusted suggestion data only.

## Review/draft-only smoke

Checked:

- `GET /imports/:batchId/ocr-review`: HTTP 200.
- `PATCH /imports/:batchId/rows/:rowId/ocr-review`: HTTP 200.
- `POST /imports/:batchId/rows/:rowId/approve-draft`: HTTP 200.

Result:

- Reviewed values were saved to import review metadata.
- Field-level review decisions were recorded.
- Row/batch were promoted to draft/review state only.
- No invoice was posted.
- No receipt was allocated.
- No protected financial balance was mutated.

## Metadata and financial-safety verification

Read-only staging verification for Batch 9B synthetic smoke prefix:

| Check | Count |
| --- | ---: |
| `import_batches` | 8 |
| `import_files` | 8 |
| `import_rows` | 8 |
| `ocr_review_decisions` | 6 |
| `invoices` | 0 |

The import metadata count includes synthetic records from the successful smoke run and an earlier transport-client retry. These are clearly prefixed `B9B-STAGING-SMOKE` and are retained as staging audit-safe deferred cleanup because no supported cleanup route exists for these metadata-only import records.

Protected financial DML catalog verification:

- authenticated direct INSERT/UPDATE/DELETE on `allocation_details`: denied.
- authenticated direct INSERT/UPDATE/DELETE on `invoices`: denied.
- authenticated direct INSERT/UPDATE/DELETE on `receipts`: denied.

Result: PASS.

## `/allocations/auto` safety check

Checked:

- `POST /allocations/auto`

Result:

- HTTP 403.
- Error code: `AUTO_ALLOCATION_DISABLED`.

Result: PASS.

## Safety confirmations

- No production migration was applied.
- No production Edge Function was deployed.
- No production data was touched.
- No real company-sensitive documents were used.
- No real customer financial data was used.
- No production fixtures/imports/create-record flows were run.
- No invoice posting was performed.
- No receipt allocation was performed.
- No direct insert into `allocation_details` occurred.
- No direct update to `invoices.outstanding` occurred.
- No direct update to `receipts.allocated_amount` occurred.
- No direct update to `receipts.unallocated_amount` occurred.
- No OCR provider key was configured.
- No OCR provider was called.
- No OCR provider secret was printed or written.
- `/allocations/auto` was not re-enabled.
- No `ar.*` schema was used.

## Staging verdict

Final staging verdict: PASS.

Batch 9B-I1 is ready for final review before commit/push.
