# Sprint Batch 9B — Final Closure Evidence

Status: **CLOSED (implementation + review complete; production deploy not yet approved).**
This is a documentation-only closure record for Batch 9B. No implementation,
migration, deployment, or staging/production data action was performed to produce it.

- Closure baseline commit: `56d11d84c5907157e45123d14b4ee0f3dd41c473` (origin/main)
- Supabase staging ref: `gcdsdyegwjdcskpukqlq`
- Supabase production ref: `kusseuycqgdilychphpq` (not touched by Batch 9B)
- Database schema target: `public` only (no `ar.*`)

---

## 1. Batch 9B objective

Batch 9B added a **secure PDF/Image/OCR import intake and review layer** in front of
the existing AR import-draft workflow:

- **Invoice-only** in v1.
- **PDF + raster images only:** PDF, PNG, JPG/JPEG, WebP.
- **SVG/SVGZ excluded** (separate security review required before any vector support).
- **OCR provider disabled / manual fallback by default** — no production provider is
  configured or called; extracted values are untrusted suggestion data only.
- **Review/draft-only flow:** upload creates import metadata + a review row; review
  and approval promote to an `ApprovedDraft` import state only.
- **No invoice posting** from the OCR path.
- **No receipt allocation** from the OCR path.
- **No direct financial mutation** — all posting/allocation continues to flow through
  the existing approved APIs/RPCs, unchanged by Batch 9B.

---

## 2. Gate history

### Gate 1 — Claude Planning
- Created `docs/plans/BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_PLAN.md`.
- Created `docs/evidence/SPRINT_BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_PLAN_REVIEW.md`.
- Planning docs committed and pushed.
- **Planning commit:** `7333048b10961e2ab444f0af982dbf6de6fbd9ce`.

### Gate 2 — Codex Review
- Codex verdict: **`PASS WITH CONDITIONS`**.
- Claude revised the plan with 8 locked conditions + testing additions (plan §18):
  SVG excluded from v1; production OCR disabled by default; staging synthetic
  documents only; reuse-first table disposition; signed-URL tenant/role check at
  request time; malware/file-scan gate before OCR; raw-OCR retention limit; v1
  abstraction + manual-fallback recommendation.
- Codex condition-confirmation review: **`CONDITIONS CONFIRMED`**.

### Gate 3 — User Approval
- User approved **backend/API/DB staging-first implementation scope only** (no
  production action), consistent with the locked Gate 2 conditions.

### Batch 9B-I1 — Backend / API / DB implementation
- **Commit:** `5923bfb039e3cae6fbebb4c14bccb41732d33f80`.
- Migration `database/016_import_ocr_intake_extensions.sql`:
  - extends `public.import_files` with 12 OCR/file-safety metadata columns
    (`content_mime_type`, `detected_mime_type`, `file_sha256`, `page_count`,
    `scan_status`, `scan_result`, `ocr_status`, `ocr_provider`, `ocr_started_at`,
    `ocr_completed_at`, `ocr_error`, `retention_expires_at`);
  - adds one append-only review-audit table `public.ocr_review_decisions` (RLS
    enabled; company-scoped read for Clerk/Supervisor/FM/Auditor; insert for
    Clerk/Supervisor/FM; no client UPDATE/DELETE policy);
  - reuses existing `import_batches` / `import_files` / `import_rows` and the existing
    `import_files.ocr_result JSONB`;
  - extends the private `ar-imports` MIME allowlist for `application/pdf`, `image/png`,
    `image/jpeg`, `image/webp`; SVG excluded; bucket stays private;
  - `public` schema only.
- imports Edge Function routes added (existing function extended — no parallel
  subsystem):
  - `POST /imports/ocr/upload`
  - `GET /imports/:batchId/files/:fileId/preview-url`
  - `POST /imports/:batchId/files/:fileId/ocr/start`
  - `GET /imports/:batchId/ocr-review`
  - `PATCH /imports/:batchId/rows/:rowId/ocr-review`
  - `POST /imports/:batchId/rows/:rowId/approve-draft`
- Provider abstraction with disabled/manual-fallback default (`ocr_provider.ts`);
  cloud OCR blocked until separate approval; no frontend-exposed keys.
- File validation (`file_validation.ts`): MIME + magic-number + extension checks,
  SVG/SVGZ rejection, double-extension rejection, zero-byte/oversized rejection, PDF
  page cap (3), encrypted-PDF and active/script-PDF marker rejection; conservative
  `scan_status='unavailable'` fallback (no external scanner in v1).
- Local `deno check` + `deno test` PASS; staging migration/deploy/smoke PASS (see §4).

### Batch 9B-FE — Frontend UI integration
- **Commit:** `379237a87d49bda630ec9f8030a14aadac9509cb`.
- Added a **PDF/Image (OCR)** invoice intake channel alongside the existing CSV/Excel
  wizard (`OcrImportFlow` + `useOcrImport`).
- CSV/XLSX import preserved and unchanged.
- Review/draft-only UI with persistent safety copy ("extraction & review only — does
  not post invoices or allocate receipts").
- Signed preview URL UI (opens backend-issued short-lived URL; no public URL built).
- Raw (OCR) value vs reviewed value editor for the invoice field set.
- Review save + approve-draft flow (approve labelled draft-only).
- Role-aware controls from the real `/auth/me` capabilities (via `useUserRole`),
  never demo/env: upload/review gated on import capabilities; approve requires AR
  Supervisor / Finance Manager; Auditor/read-only disabled.

### Batch 9B-FE-Fix1 — Frontend mode isolation fix
- **Commit:** `56d11d84c5907157e45123d14b4ee0f3dd41c473`.
- OCR and CSV/XLSX modes made **mutually exclusive** (entire CSV wizard wrapped in
  `mode === "csv"`; OCR mode renders only the OCR flow).
- Stale CSV warning ("PDF/Image import is not part of this phase") rewritten so it no
  longer contradicts Batch 9B-FE.
- `GET /imports/:batchId/ocr-review` integrated via a **Refresh** action
  (`refreshReview`) through the shared authenticated, tenant-scoped API client.
- Codex re-review verdict: **`PASS`**.

---

## 3. Final safety confirmations

- `/allocations/auto` remains **HTTP 403 `AUTO_ALLOCATION_DISABLED`** (verified in the
  Batch 9B-I1 staging smoke; not changed by Batch 9B).
- No unsafe auto-allocation was enabled.
- No direct insert into `allocation_details`.
- No direct update to `invoices.outstanding`.
- No direct update to `receipts.allocated_amount`.
- No direct update to `receipts.unallocated_amount`.
- No protected financial record deletion path.
- No OCR-to-posting path (approval promotes to `ApprovedDraft` only).
- No OCR-to-receipt-allocation path.
- No production OCR provider key configured.
- No `NEXT_PUBLIC_*` OCR key added.
- No dashboard mock data.
- No `ar.*` schema (public schema only).
- No real documents committed.
- No real customer financial data committed.

---

## 4. Staging result (Batch 9B-I1)

- Staging project ref: `gcdsdyegwjdcskpukqlq`.
- Staging migration `database/016_import_ocr_intake_extensions.sql` applied (staging
  only); all 12 new `import_files` columns present; `ocr_review_decisions` exists with
  RLS enabled; `ar-imports` bucket remains private; MIME allowlist includes
  CSV/XLSX/plain-text + PDF/PNG/JPEG/WebP; SVG not allowed; no `ar` schema exists.
- imports Edge Function deployed to staging only; status **ACTIVE v8**.
- Synthetic-file smoke: **PASS** (all files synthetic; no real documents).
  - Accepted: synthetic PDF, PNG, JPG/JPEG, WebP (HTTP 201).
  - Rejected (HTTP 400 `VALIDATION_ERROR`): SVG, SVGZ, double-extension, MIME spoof,
    magic-number mismatch, zero-byte, oversized, PDF page-cap exceeded, encrypted-PDF
    marker, active/script-PDF marker.
  - Signed preview URL returned (no public URL); wrong-company preview and wrong-company
    OCR review both denied (HTTP 403).
  - OCR start → HTTP 200 with `manual_fallback=true`; no provider secret required; no
    real provider called.
  - Review list / review save / approve-draft → HTTP 200; reviewed values saved; row/
    batch promoted to draft/review state only.
  - **Zero `public.invoices` rows** created by the staging smoke; authenticated direct
    INSERT/UPDATE/DELETE on `allocation_details` / `invoices` / `receipts` denied.
  - `/allocations/auto` → HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- No production migration, deployment, or data action occurred.

---

## 5. Frontend result (Batch 9B-FE + Fix1)

- `npm run build` PASS (25 routes); `npx tsc --noEmit` PASS.
- CSV/XLSX import remains accessible (CSV/Excel channel, unchanged wizard).
- OCR mode no longer renders the CSV/XLSX wizard (mutually exclusive modes).
- All six backend OCR intake routes are integrated (upload, preview-url, ocr/start,
  ocr-review list via Refresh, ocr-review save, approve-draft).
- No `/allocations/auto` frontend call added.
- No production OCR provider key added.
- No direct financial-mutation UI added (approve creates draft data only; approved
  screen explicitly shows "Invoice posted: No / Receipt allocated: No").
- Receipt import flow unchanged.
- No production action.

---

## 6. Evidence files

- `docs/plans/BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_PLAN.md` (Gate 1 plan + §18 locked conditions)
- `docs/evidence/SPRINT_BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_PLAN_REVIEW.md` (Gate 2 review)
- `docs/evidence/SPRINT_BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_IMPLEMENTATION_EVIDENCE.md` (Batch 9B-I1 implementation)
- `docs/evidence/SPRINT_BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_STAGING_SMOKE_EVIDENCE.md` (Batch 9B-I1 staging smoke)
- `docs/evidence/SPRINT_BATCH_9B_FE_OCR_IMPORT_FRONTEND_EVIDENCE.md` (Batch 9B-FE + Fix1)
- `docs/evidence/SPRINT_BATCH_9B_FINAL_CLOSURE_EVIDENCE.md` (this file)

---

## 7. Remaining risks / follow-up

- Production frontend smoke is **not yet done** (planned separately if required).
- Production backend migration/deploy for Batch 9B has **not been approved** and has
  not occurred.
- Production OCR remains **disabled**.
- OCR provider selection (local/cloud/hybrid + data-residency/legal approval) remains
  future work.
- Receipts OCR intake remains **out of scope** (invoice-only v1).
- Real OCR provider integration remains **out of scope** (abstraction + manual fallback
  only).
- Staging synthetic import metadata (prefixed `B9B-STAGING-SMOKE`) remains as deferred
  cleanup because no supported cleanup route exists for metadata-only import records;
  it carries no real financial data.
- Draft promotion of an approved OCR row into the existing invoice draft-creation flow
  is deferred to a future batch.
- GitHub Dependabot still reports moderate vulnerabilities unrelated to the Batch 9B
  implementation.

---

## 8. Closure verdict

Batch 9B (planning → Gate 2 conditions → Batch 9B-I1 backend/API/DB staging →
Batch 9B-FE frontend → Batch 9B-FE-Fix1) is **complete from the implementation and
Codex-review perspective**, staging-verified, and safe. Production deployment and
production smoke are intentionally deferred and remain unapproved.
