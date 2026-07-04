# Batch 9C — Receipt PDF/Image Import Intake — Final Closure Evidence

- **Batch:** 9C — Receipt PDF/Image Import Intake.
- **Type:** Final closure / consolidation evidence (documentation only).
- **Author:** Claude Code (documentation, evidence).
- **Date:** 2026-07-04.
- **Final git baseline:** `28c899319f08fc8bc3c69ee31fd766eaed6fd2e8`.

> This document is documentation/evidence closure only. No backend code, frontend code, migration,
> deployment, upload, record creation, staging mutation, production mutation, or smoke run was
> performed while producing it. It consolidates the previously approved Batch 9C evidence chain.

---

## 0. Evidence chain consolidated

| # | Artifact | Path | Commit |
| --- | --- | --- | --- |
| 1 | Plan | `docs/plans/BATCH_9C_RECEIPT_PDF_IMAGE_IMPORT_INTAKE_PLAN.md` | `0969a23` |
| 2 | Backend evidence | `docs/evidence/SPRINT_BATCH_9C_BACKEND_RECEIPT_PDF_IMAGE_IMPORT_INTAKE_EVIDENCE.md` | `6dcf743` |
| 3 | Frontend evidence | `docs/evidence/SPRINT_BATCH_9C_FRONTEND_RECEIPT_PDF_IMAGE_IMPORT_INTAKE_EVIDENCE.md` | `363ce13` |
| 4 | Copy fix | (frontend approval copy) | `4c334ce` |
| 5 | Staging deployment evidence | `docs/evidence/SPRINT_BATCH_9C_STAGING_DEPLOYMENT_EVIDENCE.md` | `c9cdea2` |
| 6 | Staging synthetic smoke evidence | `docs/evidence/SPRINT_BATCH_9C_STAGING_SYNTHETIC_SMOKE_EVIDENCE.md` | `e0b9153` |
| 7 | Production backend deployment evidence | `docs/evidence/SPRINT_BATCH_9C_PRODUCTION_BACKEND_DEPLOYMENT_EVIDENCE.md` | `4685f48` |
| 8 | Production frontend verification evidence | `docs/evidence/SPRINT_BATCH_9C_PRODUCTION_FRONTEND_VERIFICATION_EVIDENCE.md` | `c18c7e4` |
| 9 | Production read-only verification evidence | `docs/evidence/SPRINT_BATCH_9C_PRODUCTION_READ_ONLY_VERIFICATION_EVIDENCE.md` | `0c19294` |
| 10 | Production allocation invariant recheck evidence | `docs/evidence/SPRINT_BATCH_9C_PRODUCTION_AUTO_ALLOCATION_DISABLED_RECHECK_EVIDENCE.md` | `28c8993` |

---

## 1. Batch objective

Batch 9C added **Receipt PDF/Image Import Intake** support alongside the existing Receipt CSV/Excel
import.

**Supported file types**

- PDF
- PNG
- JPG / JPEG
- WebP

**Rejected file types**

- SVG
- SVGZ

**In scope**

- Intake (upload)
- Signed preview
- Manual review
- Save reviewed fields
- Approve draft

**Explicitly out of scope**

- OCR provider / key / worker
- Automatic extraction
- Automatic posting
- Automatic allocation
- Journal entry creation
- Direct financial mutation

---

## 2. Backend completion

- Route-level `import_type` validation on `POST /imports/ocr/upload`.
- Only `invoice` and `receipt` accepted.
- Invalid `import_type` rejected **before** the service layer runs.
- Service-level validation retained (defence in depth).
- Receipt `review_kind = ocr_receipt_manual_entry`.
- Invoice `review_kind` (`ocr_invoice_manual_entry`) preserved.
- PDF/Image receipt batches are blocked from the CSV parse/validate/execute paths.
- No migration required (`import_type = 'receipt'` already permitted by the DB constraint).
- No protected financial DML.
- No financial RPC bypass.

Reference: `SPRINT_BATCH_9C_BACKEND_RECEIPT_PDF_IMAGE_IMPORT_INTAKE_EVIDENCE.md` (`6dcf743`).

---

## 3. Frontend completion

- Receipt Import page exposes **CSV / Excel** and **PDF/Image** modes.
- The two modes are mutually exclusive.
- Receipt PDF/Image intake uses `importType="receipt"`.
- Invoice PDF/Image intake (Batch 9B) remains intact.
- Receipt review field set **excludes**:
  - `invoice_reference`
  - `allocation_amount`
- No user-facing "OCR" wording (UI says "PDF/Image Import").
- Stale "PDF/Image import is not available for receipts" copy removed.
- Receipt-mode invoice copy leak fixed (`4c334ce`): approval warning is now type-aware.
- Settings → Feature Status:
  - **PDF/Image Import (Invoice & Receipt)** = **Live**
  - **Daily FX Sync** = **Planned (Batch 9D)**
  - **Auto-Allocation** = **Disabled**

Reference: `SPRINT_BATCH_9C_FRONTEND_RECEIPT_PDF_IMAGE_IMPORT_INTAKE_EVIDENCE.md` (`363ce13`, `4c334ce`).

---

## 4. Staging deployment

- Staging project ref: `gcdsdyegwjdcskpukqlq`.
- `imports` Edge Function: **v8 → v9**.
- Only the `imports` function was deployed.
- No migration.
- No production action.

Reference: `SPRINT_BATCH_9C_STAGING_DEPLOYMENT_EVIDENCE.md` (`c9cdea2`).

---

## 5. Staging synthetic smoke

**Supported/rejected matrix**

| File type | Result |
| --- | --- |
| PDF | HTTP 201 |
| PNG | HTTP 201 |
| JPG | HTTP 201 |
| WebP | HTTP 201 |
| SVG | HTTP 400 `VALIDATION_ERROR` |
| SVGZ | HTTP 400 `VALIDATION_ERROR` |

**Intake → review → draft flow**

- Upload accepted.
- `import_type = receipt`.
- `review_kind = ocr_receipt_manual_entry`.
- Status `NeedsReview`.
- Signed preview HTTP 200.
- Signed URL expiry 120 seconds.
- Wrong-company preview HTTP 403.
- Review list HTTP 200.
- Review save HTTP 200.
- 8 review decisions recorded.
- Approve draft HTTP 200.
- Status `ApprovedDraft`.
- `created_count = 0`.
- `posted_count = 0`.
- `allocated_count = 0`.

**Financial zero-mutation**

- Receipt records = 0.
- Invoice records from smoke prefix = 0.
- Allocation rows = 0.
- Journal entries = 0.
- Invoice outstanding updates = 0.
- Receipt allocated/unallocated updates = 0.

**Regression checks**

- Receipt CSV upload HTTP 201.
- Receipt CSV parse HTTP 200.
- One row parsed.
- Execute not run.
- Invoice PDF upload HTTP 201.
- Status `NeedsReview`.
- `review_kind = ocr_invoice_manual_entry`.
- No posting / no journal.

**Staging `/allocations/auto`**

- HTTP 403.
- `AUTO_ALLOCATION_DISABLED`.

**Staging limitation (non-blocking)**

- Six synthetic import metadata/storage artifacts remain because no supported cleanup route exists.
- Clearly synthetic.
- Staging only.
- No protected financial records.
- Not a production blocker.
- Unsafe direct deletion intentionally avoided.

Reference: `SPRINT_BATCH_9C_STAGING_SYNTHETIC_SMOKE_EVIDENCE.md` (`e0b9153`).

---

## 6. Production rollout

- Production project ref: `kusseuycqgdilychphpq`.
- `imports` function: **ACTIVE v21 → ACTIVE v22**.
- Only the `imports` function was deployed.
- Unrelated functions unchanged.
- No migration.
- No production smoke.
- No upload.
- No production record creation.
- No financial mutation.

Reference: `SPRINT_BATCH_9C_PRODUCTION_BACKEND_DEPLOYMENT_EVIDENCE.md` (`4685f48`).

---

## 7. Production frontend verification

**Routes**

- `/` HTTP 200.
- `/receipts/import` HTTP 200.
- `/invoices/import` HTTP 200.
- `/settings` HTTP 200.

**Assets verified live**

- Receipt PDF/Image Import live.
- Review / draft-only wording live.
- "No final financial records" wording live.
- "No allocation" wording live.
- Stale "unavailable" copy absent.
- Receipt invoice-copy leaks absent.
- Invoice PDF/Image channel preserved.
- Settings Batch 9D wording live.

No manual Vercel deployment was required.

Reference: `SPRINT_BATCH_9C_PRODUCTION_FRONTEND_VERIFICATION_EVIDENCE.md` (`c18c7e4`).

---

## 8. Production read-only verification

- `imports` ACTIVE v22.
- Production frontend routes healthy.
- Production assets verified.
- Backend/source consistency verified.
- Schema readiness based on approved Batch 9B production rollout evidence.
- Local checks passed:
  - Deno checks.
  - Targeted tests: **20 passed / 0 failed**.
  - TypeScript `noEmit`.
  - Frontend build: 25 routes.
- No production upload.
- No production metadata artifact created.
- No production financial mutation.
- No migration/deployment during P2.

Reference: `SPRINT_BATCH_9C_PRODUCTION_READ_ONLY_VERIFICATION_EVIDENCE.md` (`0c19294`).

---

## 9. Production `/allocations/auto` recheck

- Production `GET /auth/me` HTTP 200.
- Safe role: Finance Manager.
- Production `POST /allocations/auto` HTTP 403.
- Error code `AUTO_ALLOCATION_DISABLED`.
- Route returned **before** any allocation service logic.
- No allocation created.
- No financial mutation.
- Prior P2 runtime limitation resolved.

Reference: `SPRINT_BATCH_9C_PRODUCTION_AUTO_ALLOCATION_DISABLED_RECHECK_EVIDENCE.md` (`28c8993`).

---

## 10. Final security and financial invariants

- `public` schema only.
- No `ar.*` schema.
- Tenant / company-scoped access preserved.
- Signed preview is backend-generated.
- Signed preview is short-lived (120 seconds).
- Wrong-company preview rejected (HTTP 403).
- No OCR provider / key / worker.
- No automatic extraction.
- No Receipt PDF/Image posting.
- No Receipt PDF/Image allocation.
- No journal entry from Receipt PDF/Image.
- No direct protected financial table mutation.
- No financial RPC bypass.
- `/allocations/auto` remains disabled at production runtime (HTTP 403 `AUTO_ALLOCATION_DISABLED`).

---

## 11. Final deployment state

- `imports` function: **ACTIVE v22** (production).
- Batch 9C frontend visibly live in production.
- Production `/allocations/auto` runtime-disabled invariant confirmed.
- Final git baseline: `28c899319f08fc8bc3c69ee31fd766eaed6fd2e8`.

---

## 12. Final verdict

**BATCH 9C COMPLETE**

- Implementation complete.
- Staging verification complete.
- Production backend rollout complete.
- Production frontend verification complete.
- Production read-only verification complete.
- Production disabled invariant confirmed.
- No unresolved blocker remains.

---

## 13. Next batch note

- **Daily FX Sync** is **Batch 9D**.
- Batch 9C closure does **not** imply OCR extraction or financial automation.
- Future cleanup of the staging synthetic import metadata/storage artifacts should use a supported
  cleanup capability if one is implemented later.
