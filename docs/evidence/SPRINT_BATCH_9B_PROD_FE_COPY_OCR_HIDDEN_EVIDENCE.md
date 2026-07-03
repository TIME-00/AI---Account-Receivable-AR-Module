# Sprint Batch 9B-PROD-FE-COPY — Hide OCR Wording, Rebrand as PDF/Image Import

## Objective

Per user decision, the AR module will **not** proceed with a real OCR provider or a
self-hosted OCR worker for now. The user-facing UI must stop presenting the PDF/Image
invoice import feature as "OCR". Production should offer this simply as **PDF/Image
Import**, still **review/draft-only**. OCR may be reconsidered later once the rest of
the system is complete.

This is a **frontend user-facing copy/UI cleanup only**. No backend code, database
schema, migration, deployment, or data action is involved. Internal
symbols/routes/hooks are intentionally left unchanged to avoid backend/API risk.

- Baseline commit: `397aab858d4105e7203a5fba0bc099b17c9575c5` (origin/main)
- Scope: user-facing labels/copy/text in the browser UI only.

## Files changed

| File | Change |
| --- | --- |
| `frontend/src/app/(dashboard)/invoices/import/page.tsx` | Subtitle "PDF/Image OCR Invoice Intake…" → "PDF/Image Invoice Import — Review & Draft Only"; channel tab "PDF / Image (OCR)" → "PDF/Image Import"; CSV cross-reference copy updated to point to "PDF/Image Import". |
| `frontend/src/components/features/imports/ocr-import-flow.tsx` | Safety banner rewritten (no OCR/provider wording); manual-review notice reworded and "Re-check OCR status" → "Re-check status"; field-grid header "Raw (OCR) value" → "Imported value"; "No OCR value" → "No value"; status pill text "OCR failed/complete/disabled·manual" → "Processing failed / Fields imported / Manual entry". |
| `frontend/src/hooks/use-ocr-import.ts` | User-facing toasts reworded (no "OCR"); upload `batch_name` "OCR Invoice Intake…" → "PDF/Image Invoice Import…"; start-status toast/error text de-OCR'd. |
| `frontend/src/app/(dashboard)/settings/page.tsx` | Feature-list label "PDF/Image/OCR Import" → "PDF/Image Import". |
| `frontend/src/app/(dashboard)/receipts/import/page.tsx` | Stale line "PDF/Image/OCR are not part of this phase." → "PDF/Image import is not available for receipts." (receipts remain CSV/XLSX only; behavior unchanged). |
| `docs/evidence/SPRINT_BATCH_9B_PROD_FE_COPY_OCR_HIDDEN_EVIDENCE.md` | This evidence file (new). |

## Before / after wording intent

| Surface | Before | After |
| --- | --- | --- |
| Import channel tab | `PDF / Image (OCR)` | `PDF/Image Import` |
| Page subtitle (OCR mode) | `PDF/Image OCR Invoice Intake — Review & Draft Only` | `PDF/Image Invoice Import — Review & Draft Only` |
| Safety banner heading | `Extraction & review only — nothing is posted` | `PDF/Image import — review & draft only` |
| Safety banner bullets | mentioned "OCR/manual intake" and "production OCR provider is disabled" | "PDF/Image import creates reviewable draft data only. It does not post invoices, allocate receipts, or create final financial records." + supported/unsupported formats |
| Manual notice | "The production OCR provider is disabled, so no fields were auto-extracted…" | "Fields are not auto-filled. Open the document preview, then enter and review each invoice value…" |
| Re-check button | `Re-check OCR status` | `Re-check status` |
| Field header | `Raw (OCR) value` | `Imported value` |
| Empty value | `No OCR value` | `No value` |
| Status pill | `OCR failed` / `OCR complete` / `OCR disabled · manual` | `Processing failed` / `Fields imported` / `Manual entry` |
| Upload toast | "OCR is disabled — review the invoice fields manually…" | "Review the imported invoice fields manually before approving a draft." |
| Start-status toast | "Manual Review Required / OCR Started" + backend OCR message | "Manual Review" + "Fields are not auto-filled — enter each value from the document, then save." |
| Settings feature row | `PDF/Image/OCR Import` | `PDF/Image Import` |
| Receipts import note | `PDF/Image/OCR are not part of this phase.` | `PDF/Image import is not available for receipts.` |

## Confirmation: OCR wording removed from user-facing UI

A repository scan (`grep -rniE "ocr"` across `frontend/src`) confirms every remaining
`OCR`/`ocr` occurrence is **internal only**, none of which render as visible browser
text:

- Component/hook/function/const names: `OcrImportFlow`, `useOcrImport`, `checkOcrFile`,
  `OcrPill`, `OCR_INVOICE_FIELDS`, `rawOcrValue`, `reviewedOcrValue`, `OcrResult`,
  `OcrUploadResult`, `OcrReviewList`, `OcrStartResult`, `OcrImportStep`, `OcrFileType`,
  `OcrReviewFieldDef`.
- Internal route paths: `/imports/ocr/upload`, `/imports/:batchId/.../ocr/start`,
  `/imports/:batchId/ocr-review`.
- Internal state/mode key: `mode === "ocr"` / `setMode("ocr")` (channel switch value,
  never displayed).
- Data field names from the backend contract: `ocr_status`, `ocr_provider`,
  `ocr_result`, `ocr_fields`.
- Code comments (non-rendered), e.g. the file header comments and
  `frontend/src/components/layout/ar-help-panel.tsx:10`
  ("does NOT call any external AI/LLM/OCR provider").

No JSX text node, label, placeholder, toast, tooltip, or button caption shows "OCR".

## Confirmation: internal names not refactored

Per the task, internal implementation names, routes, and hooks from Batch 9B were left
unchanged (`useOcrImport`, `OcrImportFlow`, `/imports/ocr/upload`, `/ocr-review`, etc.)
to avoid unnecessary backend/API risk. Only user-facing copy was changed.

## Checks run

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS (exit 0) |
| `npm run build` | PASS (exit 0, 25 routes) |
| `git diff --check` | PASS (only benign LF→CRLF notices) |
| User-facing `OCR`/`ocr` scan | Only internal symbols/routes/data-fields/comments remain (see above) |
| `provider` word added to frontend text | NONE |
| `/allocations/auto` call added | NONE |
| `auto-post` / `auto allocate` / "invoice posted after" / "receipt allocated after" added | NONE |
| `NEXT_PUBLIC_*OCR` key | NONE |
| Secrets / JWTs | NONE |
| Mojibake / encoding | clean on all changed files |

## Safety confirmations

- Frontend user-facing copy only; no backend code, database schema, migration, or
  configuration changed.
- No production data action; no deployment performed.
- No OCR provider enabled; no OCR provider key added.
- No `/allocations/auto` call added (remains backend-disabled, HTTP 403
  `AUTO_ALLOCATION_DISABLED`).
- No auto-posting; no receipt allocation logic or wording.
- CSV/XLSX import remains accessible and unchanged (CSV/Excel channel).
- PDF/Image import remains **review/draft-only** — it does not post invoices, allocate
  receipts, or create final financial records; the approved screen still shows
  "Invoice posted: No / Receipt allocated: No".
- Receipt import flow behavior unchanged (receipts remain CSV/XLSX only).
- No `ar.*` schema referenced.

## Result

Batch 9B-PROD-FE-COPY result: PASS. Ready for Codex review.
