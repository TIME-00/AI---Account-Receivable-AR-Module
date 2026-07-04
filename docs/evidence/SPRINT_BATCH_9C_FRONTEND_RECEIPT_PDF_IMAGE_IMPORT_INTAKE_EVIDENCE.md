# Batch 9C — Receipt PDF/Image Import Intake — Frontend Evidence

- **Batch:** 9C — Receipt PDF/Image Import Intake (frontend implementation).
- **Author:** Claude Code (frontend/UI/UX, documentation, evidence).
- **Date:** 2026-07-04.
- **Baseline commit:** `6dcf743386953dfc69f571d52bcf2edfa298bc9f` (backend/API/tests for Batch 9C, already on `origin/main`).
- **Plan:** `docs/plans/BATCH_9C_RECEIPT_PDF_IMAGE_IMPORT_INTAKE_PLAN.md` (Gate 1 amended; Codex Gate 2 amendment confirmation = PASS).
- **Backend evidence:** `docs/evidence/SPRINT_BATCH_9C_BACKEND_RECEIPT_PDF_IMAGE_IMPORT_INTAKE_EVIDENCE.md`.

> Frontend implementation only. No deployment, no staging/production smoke, no staging/production
> mutation, no file upload, no record creation, no real customer documents were involved.

---

## 1. Objective

Add a **Receipt PDF/Image Import** channel to the Receipt Import page, mirroring the existing
Batch 9B Invoice PDF/Image intake. The channel is **intake / review-draft only** — it never posts
receipts, never allocates to invoices, and creates no final financial records. The existing Receipt
CSV/Excel wizard and the existing Invoice PDF/Image intake remain behaviorally unchanged.

The backend for this batch (route-level `import_type` allowlist on `POST /imports/ocr/upload`,
receipt-parametrized `uploadOcrIntakeFile`, `review_kind = ocr_receipt_manual_entry`, generalized
messages, guard/negative tests) was completed by Codex and is already live in the repo at the
baseline commit. This work is the frontend surface only.

---

## 2. Files changed

| File | Change |
| --- | --- |
| `frontend/src/hooks/use-ocr-import.ts` | Parametrized `useOcrImport(importType: "invoice" \| "receipt" = "invoice")`; multipart now sends `import_type` = the selected type and a type-aware `batch_name`; added `OcrImportType` type, `OCR_RECEIPT_FIELDS`, and `ocrFieldsFor(importType)`; generalized upload/approve toast copy to be type-aware (no "invoice fields" / "invoice was posted" leakage). Default invoice behavior unchanged. |
| `frontend/src/components/features/imports/ocr-import-flow.tsx` | Accepts `{ importType?: "invoice" \| "receipt" }` (default `"invoice"`); passes `importType` into `useOcrImport`; selects the field set via `ocrFieldsFor`; type-aware headings/labels/copy (drop zone, safety banner, manual-review note, review editor heading, approved summary, "View receipts/invoices" link). Invoice usage stays behaviorally identical. |
| `frontend/src/app/(dashboard)/receipts/import/page.tsx` | Added mutually-exclusive **CSV / Excel** vs **PDF/Image Import** mode toggle (mirrors invoice import page); renders `<OcrImportFlow importType="receipt" />` in PDF/Image mode and the existing CSV/Excel wizard in CSV mode; removed stale "PDF/Image import is not available for receipts" copy; added a truthful receipt-intake note (no posting, no allocation, no final financial records). |
| `frontend/src/app/(dashboard)/settings/page.tsx` | Feature Status: PDF/Image Import row relabeled **"PDF/Image Import (Invoice & Receipt)"** (still **Live**); **Daily FX Sync** moved from **Planned (Batch 9C)** → **Planned (Batch 9D)**; Auto-Allocation remains **Disabled**. |

Diffstat: `4 files changed, 136 insertions(+), 32 deletions(-)` (frontend source only).

---

## 3. Implementation summary

- **Shared flow reused, not forked.** The receipt channel reuses the same `OcrImportFlow` component
  and `useOcrImport` hook as invoices, parametrized by `importType`. This keeps the two channels
  behaviorally consistent and preserves the Batch 9B safety guarantees.
- **Receipt field set is intake-only.** `OCR_RECEIPT_FIELDS` = `customer_name`, `receipt_date`,
  `currency`, `receipt_reference`, `payment_method`, `amount`, `bank_account_code`, `remarks`. It
  **deliberately excludes** `invoice_reference` and `allocation_amount` so the intake channel carries
  **no allocation intent**. Reviewed values are stored as freeform review metadata only.
- **Multipart contract.** Upload sends `import_type = "receipt"` (or `"invoice"`), which the backend
  validates at the route boundary against its allowlist; the frontend never bypasses that.
- **Copy is truthful and type-aware.** Every draft/approve surface states no posting, no allocation,
  and no final financial records. No user-facing "OCR" wording anywhere; the UI says "PDF/Image
  Import".
- **No regression to CSV.** The receipt CSV/Excel wizard is unchanged and rendered only in CSV mode.
  Auto-Post & Allocate default (ON, CSV only) is untouched.

---

## 4. Frontend checks run

| Check | Command | Result |
| --- | --- | --- |
| TypeScript typecheck | `npx tsc --noEmit` | **PASS** (`TSC_EXIT=0`) |
| Production build (runs lint) | `npm run build` | **PASS** (`BUILD_EXIT=0`, 25 routes) |
| Whitespace / conflict markers | `git diff --check` | **PASS** (only benign LF→CRLF warnings) |

### 4.1 Source / wording scans

| Scan | Result |
| --- | --- |
| User-facing "OCR" wording in `app/` + shared flow (visible text, toasts, labels) | **NONE** — only internal identifiers (`OcrImportFlow`, `"ocr"` mode key, hook import) remain, which are permitted architecture names |
| Stale `"PDF/Image import is not available for receipts"` | **NONE FOUND** (removed) |
| `"Planned (Batch 9C)"` remaining in `app/` | **NONE FOUND** (FX Sync moved to 9D) |
| Auto-Allocation status in Settings | **Disabled** (unchanged) |
| `/allocations/auto` references introduced | **NONE** — only pre-existing DISABLED-state comments in `hooks/use-allocations.ts` (untouched) |
| Invoice Import renders PDF/Image Import mode | **YES** (`invoices/import/page.tsx`) |
| Receipt Import renders PDF/Image Import mode | **YES** (`receipts/import/page.tsx`) |
| Receipt CSV/Excel mode still exists | **YES** (`CSV / Excel` toggle present) |

---

## 5. User-facing wording confirmations

- Receipt PDF/Image copy states, verbatim: "It **does not post receipts**", "It **does not allocate
  to invoices**", "It **creates no final financial records**", and "To post and allocate receipts,
  use the **CSV / Excel** channel."
- The shared safety banner and approved-draft summary are type-aware, so the receipt path never says
  "invoice fields" or "invoice was posted".
- No user-facing "OCR" wording in the Invoice Import page, Receipt Import page, shared PDF/Image flow,
  or Settings. Internal file/symbol names (e.g. `ocr-import-flow.tsx`, `useOcrImport`) are unchanged
  per plan (no forced route/table/symbol renames).

---

## 6. Roadmap / feature-status confirmations

- **Daily FX Sync** moved from **Planned (Batch 9C)** → **Planned (Batch 9D)** in Settings → Feature
  Status.
- **PDF/Image Import** row relabeled to reflect both Invoice & Receipt; remains **Live**.
- **Auto-Allocation** remains **Disabled**.

---

## 7. Safety / scope confirmations

- **No backend deployment** was performed.
- **No staging or production mutation** was performed.
- **No file upload** and **no record creation** were performed.
- **No real customer documents** were used.
- **No migration** was created (none required; `import_type='receipt'` already permitted by the DB
  constraint, and the backend for this batch was already committed at the baseline).
- **No auto-posting, no auto-allocation, no journal entry** paths were added.
- **`/allocations/auto`** was not called, referenced, or re-enabled; it remains disabled
  (HTTP 403 `AUTO_ALLOCATION_DISABLED` on the backend).
- **No OCR provider / key / worker** was added; upload continues to land in the manual-review
  fallback state.
- **`public` schema only**; no `ar.*` schema usage.

---

## 8. Known limitations

- **No screenshots.** Browser automation was not run in this environment; verification is via
  typecheck, production build, and source scans. Visual confirmation can be captured manually by
  opening `/receipts/import` and toggling to **PDF/Image Import**.
- **Manual entry only.** As in Batch 9B, no OCR provider is enabled, so receipt fields are entered
  manually during review (the "imported value" column shows "No value" when no raw extraction exists).
- **One document per intake batch** (matches the Batch 9B flow); multi-file receipt intake is out of
  scope for this batch.
- **Approval still requires elevated role** for low-confidence rows (AR Supervisor / Finance Manager),
  enforced by the backend; the frontend mirrors this gating only for UX.

---

## 9. Next step

Codex post-implementation review (Gate 2 for the frontend), then user approval (Gate 3) before any
staging/production activity. No deployment or smoke has been performed.
