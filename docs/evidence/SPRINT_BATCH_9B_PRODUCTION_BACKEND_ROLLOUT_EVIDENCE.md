# Batch 9B Production Backend Rollout Evidence

## Verdict

**PASS WITH SYNTHETIC METADATA RETAINED**

The approved production backend rollout completed:

- Production migration `database/016_import_ocr_intake_extensions.sql` was applied successfully.
- Production `imports` Edge Function was deployed successfully.
- The first controlled production synthetic smoke attempt was blocked by an invalid production token: HTTP 401 `UNAUTHORIZED_ASYMMETRIC_JWT`.
- A continuation run with a refreshed valid production operational token completed successfully.
- PDF/Image import intake now supports production synthetic upload, validation, signed preview URL, OCR-disabled/manual fallback, review update, and approve-draft-only flow.

Synthetic `B9B-PROD-SMOKE-*` import metadata was intentionally retained as audit-safe production smoke evidence. No financial records were created.

## Scope

Approved production actions:

- Apply production migration `database/016_import_ocr_intake_extensions.sql`.
- Deploy production Edge Function `imports`.
- Run controlled production synthetic PDF/Image import smoke using synthetic files only.

Explicitly out of scope:

- Real OCR provider enablement.
- Self-hosted OCR worker.
- OCR provider secrets or `NEXT_PUBLIC_*OCR` keys.
- Real company documents.
- Real invoice/receipt uploads.
- Invoice posting.
- Receipt allocation.
- Import execution into financial records.
- Direct protected financial-table mutation.
- `/allocations/auto` enablement.
- `ar.*` schema usage.

## User approval

User approved Batch 9B-PROD-BE production backend rollout execution for PDF/Image import intake only.

## Production/staging target confirmation

- Production project ref: `kusseuycqgdilychphpq`.
- Staging project ref: `gcdsdyegwjdcskpukqlq`.
- `SUPABASE_URL` was confirmed as `https://kusseuycqgdilychphpq.supabase.co`.
- Active process environment did not contain the staging ref.
- Supabase CLI was relinked from staging to production before migration because `supabase db push/query` cannot target by `--project-ref`.
- Production linked project was confirmed before migration.

## Preflight result

- Branch: `main`.
- Local HEAD and `origin/main`: `537de4ffc9bbfa7b53ff4b59fc3b5e953e5b7839`.
- Worktree clean before rollout.
- Migration file existed.
- Batch 9B evidence files existed.
- No real PDF/image smoke files were tracked in git.

## Production read-only pre-migration checks

Read-only production catalog/storage checks showed:

- `public.import_files` Batch 9B OCR/file-safety metadata columns: absent before migration.
- `public.ocr_review_decisions`: absent before migration.
- `storage.buckets` entry `ar-imports`: present and private.
- `ar-imports` MIME allowlist: CSV/XLSX/plain-text oriented before migration.
- `ar` schema: absent.

## Migration applied

Applied only:

```text
database/016_import_ocr_intake_extensions.sql
```

Applied to production only through the production-linked Supabase project.

## Post-migration verification

Production post-migration verification passed:

- All 12 `public.import_files` OCR/file-safety metadata columns exist:
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
- `public.ocr_review_decisions` exists.
- RLS is enabled on `public.ocr_review_decisions`.
- `ocr_review_decisions` has SELECT and INSERT policies only.
- No client UPDATE or DELETE policy exists for `ocr_review_decisions`.
- `ar-imports` remains private.
- `ar-imports` allowed MIME types now include:
  - existing CSV/XLSX/plain-text types;
  - `application/pdf`;
  - `image/png`;
  - `image/jpeg`;
  - `image/webp`.
- SVG/SVGZ is not allowed by the bucket MIME allowlist.
- `ar` schema remains absent.

## Production Edge Function deployment

Deployed only:

```text
imports
```

Production deployment result:

- `imports` was ACTIVE before deployment at v20.
- `imports` deployed successfully.
- `imports` is ACTIVE after deployment at v21.
- No unrelated Edge Function was deployed.
- Shared files were packaged as dependencies of the `imports` function only.

## Continuation preflight after token refresh

Continuation preflight passed:

- Branch: `main`.
- Local HEAD and `origin/main`: `537de4ffc9bbfa7b53ff4b59fc3b5e953e5b7839`.
- Worktree contained only this evidence file as uncommitted evidence.
- `SUPABASE_URL` was production: `https://kusseuycqgdilychphpq.supabase.co`.
- Active process environment did not contain staging ref `gcdsdyegwjdcskpukqlq`.
- Production token/session was present; token value was not printed or written.
- No real PDF/image files were staged or tracked.

Completed rollout actions were not repeated:

- Migration `database/016_import_ocr_intake_extensions.sql` was not reapplied.
- `imports` was not redeployed.
- No code or migration file was modified.

Read-only production verification before continuation smoke confirmed:

- All 12 `public.import_files` OCR/file-safety metadata columns still exist.
- `public.ocr_review_decisions` still exists.
- RLS is still enabled on `public.ocr_review_decisions`.
- No client UPDATE/DELETE policy exists for `ocr_review_decisions`.
- `ar-imports` remains private.
- `ar-imports` still allows CSV/XLSX/plain-text plus `application/pdf`, `image/png`, `image/jpeg`, and `image/webp`.
- SVG/SVGZ remains disallowed.
- `imports` remains ACTIVE v21.
- `ar` schema remains absent.

Token sanity check:

- Existing read-only production dashboard endpoint returned HTTP 200 with the refreshed production token.
- No business-sensitive dashboard values were recorded.

## Controlled synthetic smoke result

Synthetic files were generated in the local system temp directory only.

No synthetic file was committed to the repository.

Synthetic file hashes:

| File | SHA-256 |
| --- | --- |
| `B9B-PROD-SMOKE-valid.pdf` | `ac15e3c49ae267db0305b7216210989d92d1676aa10c99bae17e6a368921d972` |
| `B9B-PROD-SMOKE-valid.png` | `843ac23b1736b4487ec81cf7c07ddd9bb46ae5b7818c2c3843d99d62fa75f3c9` |
| `B9B-PROD-SMOKE-valid.jpg` | `45ae705277879f7f01d778f7c95a065bb0c06ab9936cf24307f375211fee13d1` |
| `B9B-PROD-SMOKE-valid.webp` | `d2136a1d2b91a7482aeb2f67cc2276724cd3c22a99296cedec2d68476b0d73b8` |
| `B9B-PROD-SMOKE-reject.svg` | `b12e0d83ce2357d80b89c57694814d0a3abdaf8c40724f2049af8b7f01b7812b` |
| `B9B-PROD-SMOKE-reject.svgz` | `63c043b641238f64f320aa5f28593585a2d8d400e2ac1b3fa93ca60a5d8c3d7a` |
| `B9B-PROD-SMOKE-invoice.pdf.exe.pdf` | `ac15e3c49ae267db0305b7216210989d92d1676aa10c99bae17e6a368921d972` |
| `B9B-PROD-SMOKE-spoof.png` | `ac15e3c49ae267db0305b7216210989d92d1676aa10c99bae17e6a368921d972` |
| `B9B-PROD-SMOKE-magic.pdf` | `c9ecf5e54c7b3f2640ecca21f96d4c3625a2b7935104f41c5ede29935a9e52c9` |
| `B9B-PROD-SMOKE-zero.pdf` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `B9B-PROD-SMOKE-oversized.pdf` | `0acf644af1f4638e1da3ef721b513caaa22f209add0dc1d4106074a48c1ddb43` |
| `B9B-PROD-SMOKE-pagecap.pdf` | `283fa7bb966a6f821c0bc2ae70827dd5121bea0a89cef3214277de2aa69fab5d` |
| `B9B-PROD-SMOKE-encrypted.pdf` | `ae97b3f29b062614fefdfe9606815fcfc921aeeadbaf0b7fe61958bd05fbee4f` |
| `B9B-PROD-SMOKE-active.pdf` | `3cbe68c17bb0ef3a4ac6624dd87f0eaf9b3e7c8b637f96f562c6d32e3d9d7b87` |

### First smoke attempt: token blocker

The first controlled smoke attempt used an invalid production token.

| Case | Result |
| --- | --- |
| valid synthetic PDF upload | HTTP 401 |
| valid synthetic PNG upload | HTTP 401 |
| valid synthetic JPG/JPEG upload | HTTP 401 |
| valid synthetic WebP upload | HTTP 401 |

Existing read-only dashboard token check also returned:

```text
HTTP 401 UNAUTHORIZED_ASYMMETRIC_JWT
```

Conclusion: active production role token was not valid for production. Rejection cases and review/draft-only flow were not run after the token blocker was confirmed.

Read-only production verification after the blocked attempt confirmed zero `B9B-PROD-SMOKE-*` import metadata and zero financial records.

### Continuation smoke: accepted upload cases

After token refresh, accepted upload cases passed:

| Case | HTTP status | Result |
| --- | ---: | --- |
| valid synthetic PDF upload | 201 | Created review-only import metadata, batch status `NeedsReview`, row status `NeedsReview` |
| valid synthetic PNG upload | 201 | Created review-only import metadata, batch status `NeedsReview`, row status `NeedsReview` |
| valid synthetic JPG/JPEG upload | 201 | Created review-only import metadata, batch status `NeedsReview`, row status `NeedsReview` |
| valid synthetic WebP upload | 201 | Created review-only import metadata, batch status `NeedsReview`, row status `NeedsReview` |

Synthetic review-only IDs for the PDF case used in the review/draft flow:

- Batch ID: `a2111cab-bf64-4423-ba0f-06b88c9b5334`.
- File ID: `3194cb0f-0d3e-497c-9795-be9a9a252049`.
- Row ID: `b09c22b3-4fbb-49e6-bb88-accaf4a1d136`.

### Continuation smoke: rejection cases

All rejection cases returned HTTP 400 `VALIDATION_ERROR` as expected:

| Case | Result |
| --- | --- |
| SVG | Rejected: SVG files are not supported |
| SVGZ | Rejected: SVG files are not supported |
| double extension | Rejected: double-extension filenames are rejected |
| MIME spoof | Rejected: requested `file_type` does not match detected content |
| magic mismatch | Rejected: file magic number is not supported |
| zero-byte file | Rejected: file is empty |
| oversized PDF | Rejected: exceeds 10 MB limit |
| PDF page cap | Rejected: exceeds 3-page limit |
| encrypted PDF marker | Rejected: encrypted PDFs unsupported |
| active/script PDF marker | Rejected: PDF active content unsupported |

### Continuation smoke: review/draft-only flow

Review/draft-only flow passed using the valid synthetic PDF batch:

| Check | Result |
| --- | --- |
| signed preview URL for valid tenant/role | HTTP 200; signed URL present |
| wrong-company preview request | HTTP 403 `AUTHORIZATION_ERROR` |
| OCR/manual fallback start | HTTP 200; `status=disabled`, `provider=disabled_manual_fallback`, `manual_fallback=true` |
| OCR/manual review list | HTTP 200; one review row returned |
| review update | HTTP 200; five field decisions recorded; row remained `NeedsReview` |
| approve draft | HTTP 200; row status `ApprovedDraft`; batch status `ApprovedDraft` |

Approve-draft response explicitly stated:

```text
OCR/manual intake approved as draft-only review data. No invoice was posted and no allocation was performed.
```

No import execution route was called.

## `/allocations/auto` verification

Live `/allocations/auto` verification passed:

```text
HTTP 403 AUTO_ALLOCATION_DISABLED
```

The rollout did not deploy or modify the `allocations` Edge Function, did not change `/allocations/auto`, and did not enable auto-allocation.

## Financial mutation verification

Read-only production verification after continuation smoke confirmed:

- `B9B-PROD-SMOKE-*` import batches: `4`.
- `B9B-PROD-SMOKE-*` import files: `4`.
- `B9B-PROD-SMOKE-*` import rows: `4`.
- `B9B-PROD-SMOKE-*` OCR review decisions: `10`.
- `B9B-PROD-SMOKE-*` invoices / `B9B-PROD-SMOKE-INV-001`: `0`.
- `B9B-PROD-SMOKE-*` receipts: `0`.
- `B9B-PROD-SMOKE-*` journal entries: `0`.

No production invoice, receipt, allocation, or journal entry was created by the smoke.

## Safety confirmations

- No real company documents were used.
- No real invoice/receipt files were uploaded.
- No real customer financial data was used.
- Production uploads used synthetic files only.
- Production import metadata was created only for synthetic `B9B-PROD-SMOKE-*` review/draft smoke.
- No production invoice was created.
- No production receipt was created.
- No invoice was posted.
- No receipt was allocated.
- No import was executed into financial records.
- No direct protected financial-table mutation was performed.
- No direct insert into `allocation_details` was performed.
- No direct update to `invoices.outstanding` was performed.
- No direct update to `receipts.allocated_amount` or `receipts.unallocated_amount` was performed.
- No protected financial records were deleted.
- No OCR provider was enabled.
- No OCR provider key was added.
- No `NEXT_PUBLIC_*OCR` key was added.
- No unrelated Edge Function was deployed.
- No `ar.*` schema was created or used.
- No tokens, JWTs, cookies, passwords, production secrets, real customer data, real invoice/receipt details, or real documents are recorded in this evidence.

## Synthetic metadata retention note

Synthetic `B9B-PROD-SMOKE-*` import metadata was intentionally retained as audit-safe evidence:

- 4 import batches.
- 4 import files.
- 4 import rows.
- 10 OCR/manual review decisions.

No supported cleanup route was used. No direct deletion was performed.

## Final status

**PASS WITH SYNTHETIC METADATA RETAINED**

Production backend schema, `imports` function rollout, validation controls, signed preview, OCR-disabled/manual fallback, review update, approve-draft-only flow, `/allocations/auto` negative check, and no-financial-mutation verification completed successfully.

## Recommended next step

Proceed to a frontend production verification/update if needed, or begin the next planned FYP batch. Real OCR provider enablement remains out of scope and should require a separate reviewed approval gate.
