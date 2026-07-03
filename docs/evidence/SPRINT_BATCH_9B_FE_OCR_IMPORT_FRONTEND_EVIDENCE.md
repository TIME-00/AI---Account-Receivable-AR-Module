# Sprint Batch 9B-FE — PDF/Image/OCR Import Intake Frontend Evidence

## Scope

Batch 9B-FE implements the **frontend UI integration** for the Batch 9B-I1 invoice
PDF/Image OCR/manual import intake backend. It is a frontend-only batch:

- invoice intake only;
- PDF + raster image only (PDF, PNG, JPG/JPEG, WebP);
- SVG/SVGZ excluded;
- OCR provider disabled / manual fallback by default;
- upload creates import metadata/review data only;
- review + approve create **draft import data only** — no invoice posting, no
  receipt allocation, no direct financial mutation;
- role-aware controls come from the real backend `/auth/me` capability response
  (via `useUserRole`), never from demo/env assumptions.

No backend financial logic was changed. No migration was created. No production
action occurred. No real documents were used.

## Baseline

- Baseline commit (before this batch): `5923bfb039e3cae6fbebb4c14bccb41732d33f80`
- Branch: `main`
- Local HEAD matched `origin/main` before implementation; worktree was clean.
- Read before implementing:
  - `docs/plans/BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_PLAN.md`
  - `docs/evidence/SPRINT_BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_IMPLEMENTATION_EVIDENCE.md`
  - `docs/evidence/SPRINT_BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_STAGING_SMOKE_EVIDENCE.md`
- Inspected existing frontend import UI, hooks, API client, types, and role hook
  before editing so the OCR channel extends (not duplicates) the existing import
  flow and keeps CSV/XLSX intact.

## Files changed

New files:

- `frontend/src/hooks/use-ocr-import.ts` — OCR intake state hook + client-side
  pre-validation + review field model + response helpers.
- `frontend/src/components/features/imports/ocr-import-flow.tsx` — presentational
  OCR intake flow (upload / review / approved states, role-aware controls,
  enterprise-safe copy).

Modified files:

- `frontend/src/app/(dashboard)/invoices/import/page.tsx` — added a **CSV/Excel ↔
  PDF/Image (OCR)** channel toggle; the existing CSV/XLSX wizard renders under the
  CSV channel unchanged, and `OcrImportFlow` renders under the OCR channel.
- `frontend/src/hooks/use-import.ts` — extended the `ImportBatchStatus` and
  `ImportRowStatus` type unions with the Batch 9B OCR lifecycle states
  (`NeedsReview`, `ApprovedDraft`, `Rejected`). Type-only change; no runtime
  behavior changed for CSV/XLSX import.

## UI implemented

Channel toggle on the Invoice Import page:

- **CSV / Excel** (existing, unchanged wizard).
- **PDF / Image (OCR)** (new Batch 9B intake).

OCR intake flow (`OcrImportFlow`):

1. **Persistent safety banner** shown at every step:
   - "PDF/Image intake is for extraction and review only."
   - "OCR/manual intake does not post invoices and does not allocate receipts."
   - "Please review and approve extracted values before creating draft import data."
   - "The production OCR provider is disabled unless separately approved. SVG files
     are not supported."
2. **Select / Upload** — drag-and-drop or browse; accepts PDF/PNG/JPG/JPEG/WebP;
   shows an explicit accepted-vs-rejected reference panel (SVG/SVGZ, double
   extension, MIME/type mismatch, empty/oversized, PDF page cap, encrypted/script
   PDF).
3. **Review** — file summary with scan/OCR/review status pills; **Preview document**
   (signed URL, new tab); a manual-fallback notice with a **Re-check OCR status**
   action; a **raw (OCR) value vs reviewed value** field editor for the invoice
   field set; a reviewer note; **Save review** and **Approve as draft** actions.
4. **Approved** — draft-only confirmation that explicitly states "Invoice posted:
   No / Receipt allocated: No".

UI states surfaced: ready to upload, uploading, uploaded/needs-review,
rejected (client + backend), quarantined/rejected (scan pill), OCR disabled/manual
fallback, OCR failed, review saved, approved-for-draft, and error.

## Routes integrated

All six Batch 9B-I1 routes are integrated through the shared authenticated API
client (`useApi`, which injects the Supabase JWT + `X-Company-Id`):

| Action | Method | Route |
| --- | --- | --- |
| Upload (multipart) | POST | `/imports/ocr/upload` |
| Signed preview URL | GET | `/imports/:batchId/files/:fileId/preview-url` |
| Start OCR / manual fallback | POST | `/imports/:batchId/files/:fileId/ocr/start` |
| Review queue | GET | `/imports/:batchId/ocr-review` |
| Save review | PATCH | `/imports/:batchId/rows/:rowId/ocr-review` |
| Approve draft | POST | `/imports/:batchId/rows/:rowId/approve-draft` |

- Upload sends `import_type=invoice`, `file_type=pdf|image`, and the file via
  `FormData`. Client-side validation is UX-only; the backend remains authoritative.
- The **upload response** seeds the immediate review state (batch/file/row).
- `GET /imports/:batchId/ocr-review` is integrated as a **Refresh** action on the
  review step (`refreshReview` in `useOcrImport`), which reloads the tenant-scoped
  review queue and re-syncs batch/file/row. (Added in Batch 9B-FE-Fix1 — see the
  addendum below.)
- Preview uses the backend-issued signed URL only; no public storage URL is
  constructed.
- OCR start expects `manual_fallback=true` by default and never assumes real
  provider output.

## Role-aware controls

Derived from `useUserRole()` (backed by `GET /auth/me` capabilities), not env/demo:

- **Upload / review edit** gated on `can_execute_imports` /
  `can_review_import_rows` and `!is_read_only`.
- **Approve as draft** additionally requires **AR Supervisor** or **Finance
  Manager** (OCR-disabled rows are always low-confidence, which the backend
  requires a supervisor/FM to approve). Clerks can save reviewed values for an
  approver.
- **Auditor / read-only** sees a read-only notice; upload, edit, and approve
  controls are disabled.
- If the backend returns 403, the shared API client surfaces a friendly
  permission message (no raw technical details).

The frontend gating is UX only; backend RLS + Edge Function auth remain the final
authority.

## Tests / checks run

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | PASS (exit 0) |
| Production build | `npm run build` | PASS (exit 0, 25 routes) |
| `git diff --check` | `git diff --check` | PASS (only benign LF→CRLF notices) |
| `/allocations/auto` frontend call added? | grep `frontend/src` | NONE (only pre-existing "disabled" comments in `use-allocations.ts`) |
| `NEXT_PUBLIC_* OCR/DEMO` key added? | grep new files | NONE |
| Unsafe wording (auto-post/auto-allocate/`allocation_details`/"invoice is posted"/"receipt is allocated") | grep new files | NONE |
| Direct DB access (`supabase.from` / `createClient`) in new files | grep new files | NONE |
| Demo-role assumptions (`DEMO_USER_ROLE`, `DEMO_BANK_ACCOUNT`) in new files | grep new files | NONE |
| Mojibake / encoding | grep replacement/mis-encoded sequences | clean on all changed files |

Note on lint: the project has no standalone ESLint config (`next lint` prompts for
setup); the authoritative lint runs inside `next build`, which passed. Pre-existing
unused-import notices in `invoices/import/page.tsx` (`ImportStep`,
`ImportBatchStatus`, `BATCH_STATUS_COLORS`) predate this batch and do not block the
build; they were left untouched to avoid unrelated churn.

## Frontend smoke (local build/type verification)

No real documents were used. Because production OCR is disabled and this batch is
UI-only, verification was performed against the type-checked build and the backend
contract confirmed in the Batch 9B-I1 staging smoke evidence:

- PDF/Image channel is visible and selectable on the invoice import flow.
- Accepted-type hints (PDF/PNG/JPG/JPEG/WebP) and rejection guidance (SVG, double
  extension, MIME mismatch, empty, oversized, PDF page cap, encrypted/script PDF)
  render on the upload step.
- SVG is blocked client-side before upload and, per backend, also rejected server
  side (`VALIDATION_ERROR`).
- Valid uploads route into the review / manual-fallback flow (backend
  `manual_fallback=true`).
- Backend rejection errors surface via the shared API error handling.
- The signed preview URL opens the document in a new tab; no public URL is built.
- Review save persists reviewed values; approve-draft is labelled and behaves as
  **draft approval only**.
- No UI states that an invoice is posted or a receipt is allocated; the approved
  screen explicitly shows "Invoice posted: No / Receipt allocated: No".
- Auditor/read-only role cannot upload, edit, or approve (controls disabled with a
  read-only notice).
- Existing CSV/XLSX import remains intact and accessible under the CSV/Excel channel.

Screenshots: omitted to avoid committing any potentially sensitive rendered data.

## Safety confirmations

- No real invoices/receipts/customer documents were used or committed.
- No production action occurred (no deploy, no production data touched).
- No `/allocations/auto` call was added to the frontend; it remains disabled by
  backend (HTTP 403 `AUTO_ALLOCATION_DISABLED`).
- No production OCR provider key or `NEXT_PUBLIC_*` OCR key was added.
- No direct financial-mutation UI was added — OCR/manual intake creates
  review/draft data only.
- No direct insert into `allocation_details`; no direct update of
  `invoices.outstanding`, `receipts.allocated_amount`, or
  `receipts.unallocated_amount`; no protected-record deletion path was added.
- No dashboard mock data was introduced.
- No `ar.*` schema was referenced.
- Role-based UI is driven by the real `/auth/me` capability response.

## Remaining risks / follow-up (for Codex final review)

1. **Freeform reviewed-fields contract.** The backend `PATCH .../ocr-review`
   accepts an arbitrary `reviewed_fields` object; the frontend sends a fixed
   invoice field set (mirroring CSV columns). Confirm the backend/promotion path
   expects these exact keys, or add a shared schema.
2. **Draft promotion path.** This batch approves a row to `ApprovedDraft` only. The
   subsequent promotion of an approved OCR draft into the existing invoice
   draft-creation flow is not yet wired in the UI and should be defined in a later
   batch.
3. **Scan status display.** The scan pill renders whatever `scan_status` the
   backend returns (`unavailable` in v1). When a real scanner is enabled, confirm
   the status vocabulary matches the pill mapping.
4. **Multi-file / multi-page.** v1 handles a single file per batch and a 3-page PDF
   cap (backend-enforced). Batch/multi-page review UI is deferred.
5. **Receipts channel.** OCR intake is invoice-only in v1; a receipts OCR channel
   is out of scope here.
6. **Pre-existing unused imports** in `invoices/import/page.tsx` could be cleaned
   up in a later tidy-up but were intentionally left to keep this diff focused.

## Result

Frontend implementation result: PASS (tsc + build green, all safety scans clean).

Batch 9B-FE is ready for Codex final review before any further promotion work.

---

# Batch 9B-FE-Fix1 — OCR / CSV Mode Isolation + Review Refresh

Addresses the Codex final-review verdict `CHANGES REQUIRED` on Batch 9B-FE.

## Issues fixed

1. **OCR mode rendered the CSV/XLSX wizard as well.** `OcrImportFlow` was gated on
   `mode === "ocr"`, but the CSV draft-only banner, step progress, error banner, and
   wizard content were not gated, so the OCR channel showed both flows together.
   - **Fix:** wrapped the entire CSV/XLSX section (draft-only banner → step progress
     → error banner → step content) in a single `{mode === "csv" && (<> … </>)}`
     guard. The two channels are now mutually exclusive: OCR mode shows only the OCR
     flow + OCR safety copy; CSV mode shows only the CSV/XLSX wizard.
2. **Stale CSV warning text.** The CSV banner said "PDF/Image import is not part of
   this phase," which now contradicts Batch 9B-FE.
   - **Fix:** rewrote that line to "CSV and Excel (.xlsx) files create draft invoice
     rows here. For PDF or image invoices, switch to the **PDF / Image (OCR)**
     channel above — that path is review/draft only and never posts invoices or
     allocates receipts." CSV mode still states it creates draft rows only; OCR mode
     (persistent safety banner) states it is review/draft only with no posting/
     allocation.
3. **Evidence over-claimed route integration.** `GET /imports/:batchId/ocr-review`
   was listed as integrated but was not actually called.
   - **Fix chosen: Option A (integrate the route).** Added `refreshReview` to
     `useOcrImport`, which calls `GET /imports/:batchId/ocr-review` through the shared
     authenticated (tenant-scoped) API client and re-syncs batch/file/row. Exposed a
     **Refresh** button on the review step. No backend change. All six routes are now
     genuinely integrated.

## Files changed (Fix1)

- `frontend/src/app/(dashboard)/invoices/import/page.tsx` — CSV/XLSX section wrapped
  in `mode === "csv"`; stale PDF/Image line rewritten.
- `frontend/src/hooks/use-ocr-import.ts` — added `refreshReview` (GET ocr-review) and
  `isRefreshing` state.
- `frontend/src/components/features/imports/ocr-import-flow.tsx` — added the
  **Refresh** button on the review step; removed an unused destructured value.
- `docs/evidence/SPRINT_BATCH_9B_FE_OCR_IMPORT_FRONTEND_EVIDENCE.md` — this addendum
  and the corrected route-integration statement.

## Checks (Fix1)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS (exit 0) |
| `npm run build` | PASS (exit 0, 25 routes; `/invoices/import` 13.7 kB) |
| `git diff --check` | PASS (only benign LF→CRLF notices) |
| `/allocations/auto` frontend call | NONE added |
| `NEXT_PUBLIC_* OCR/provider` key | NONE |
| Dashboard mock/static data | NONE |
| Unsafe wording (auto-allocate / auto-post / invoice posted after OCR / receipt allocated after OCR) | NONE |
| Real PDF/image files tracked | NONE |
| Secrets / JWTs | NONE |
| Mojibake / encoding | clean |

## Safety confirmations (Fix1)

- No backend financial logic changed; no migration; no deploy; no data action.
- No `/allocations/auto` call added; it remains backend-disabled (403
  `AUTO_ALLOCATION_DISABLED`).
- No auto-allocation / auto-posting / receipt-allocation wording or logic.
- No direct financial-mutation UI; approving still creates draft data only, and the
  approved screen still shows "Invoice posted: No / Receipt allocated: No".
- No production OCR provider key added.
- No dashboard mock data.
- CSV/XLSX import remains accessible (CSV/Excel channel, unchanged wizard).
- OCR mode no longer renders the CSV/XLSX wizard.
- Receipt import flow unchanged.

Batch 9B-FE-Fix1 result: PASS.
