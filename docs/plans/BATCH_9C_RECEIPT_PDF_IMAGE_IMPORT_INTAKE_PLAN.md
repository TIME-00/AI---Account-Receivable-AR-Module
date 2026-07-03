# Batch 9C — Receipt PDF/Image Import Intake — Implementation Plan

- **Status:** Amended plan (Gate 1 — Claude Planning) incorporating **Codex Gate 2 verdict
  `PASS WITH REQUIRED PLAN AMENDMENTS`**. Awaiting Codex amendment confirmation, then user
  approval (Gate 3). See §17 for the Gate 2 amendment changelog.
- **Author:** Claude Code (planning/frontend/docs).
- **Baseline commit:** `37356b1197d526509784e2a9bdb127c2d56160e5` (origin/main).
- **Predecessor:** Batch 9B (Invoice PDF/Image Import intake) — completed, closed, in production (`imports` Edge Function ACTIVE v21).
- **Nature:** Extend the existing, proven Batch 9B invoice OCR/manual intake pattern to **receipts**. This is a mirror/parametrization effort, not a new subsystem.

> **Planning only.** No code, no migrations, no deployment, no staging/production mutation is performed by this document.

---

## 0. Scheduling change (roadmap shift)

A new Batch 9C (Receipt PDF/Image Import) is being inserted ahead of the previously
planned **Daily FX Sync**. Therefore:

- **Daily FX Sync** moves from *Batch 9C* → **Batch 9D** (unless the user says otherwise).
- The Settings → Feature Status table currently shows `Daily FX Sync — Planned (Batch 9C)`;
  this label is now stale and must be updated to `Planned (Batch 9D)` as part of this batch's
  frontend copy work (see §4.3).

---

## 1. Objective

Add **Receipt PDF/Image Import intake** so the Receipt Import page supports uploading a
receipt as PDF/PNG/JPG/JPEG/WebP, in addition to the existing CSV/Excel channel. The
uploaded file is stored safely, a short-lived signed preview is available, the user
**manually reviews/enters** receipt fields, saves reviewed values, and approves a
**draft/intake-only** record.

This intentionally mirrors the Batch 9B invoice intake so the two channels behave
consistently and share the same safety guarantees. As in 9B, **no OCR provider is
enabled** — upload lands in a controlled manual-review fallback state.

### 1.1 Why this is low-risk (architecture already supports it)

Inspection of the current codebase shows the Batch 9B intake foundation was built in a
largely **import-type-agnostic** way. The receipt extension is therefore small and
concentrated:

| Layer | Receipt-ready today? | Notes |
| --- | --- | --- |
| `import_batches.import_type` CHECK | **Yes** | `chk_import_batches_type` already allows `('invoice','receipt')` (008_import_tables.sql:63). |
| `file_validation.ts` (MIME/magic/size/page/SVG reject) | **Yes** | Fully import-type-agnostic. No change. |
| `016_import_ocr_intake_extensions.sql` (file metadata, `ocr_review_decisions`, statuses, bucket MIME) | **Yes** | Import-type-agnostic. No new migration required. |
| `index.ts` `ocrUpload` route | **Yes** | Already reads `import_type` from the multipart form and forwards it. No change. |
| `service.ts` `createOcrPreviewUrl` / `startOcr` / `listOcrReviewItems` / `saveOcrReview` / `approveOcrDraft` | **Yes** | Import-type-agnostic. Only optional wording generalization. |
| `service.ts` `uploadOcrIntakeFile` | **No (invoice-hardcoded)** | Line 437 rejects non-invoice; lines 452/539 hardcode `import_type:'invoice'`; row `review_kind`/messages are invoice-specific. **This is the core backend change.** |
| Frontend `useOcrImport` / `OcrImportFlow` | **No (invoice-hardcoded)** | `import_type:"invoice"`, `OCR_INVOICE_FIELDS`, invoice wording. Needs parametrization. |
| Receipt import page | **No** | CSV-only today; needs a CSV / PDF-Image mode toggle. |

### 1.2 Critical safety finding (receipt-specific)

Receipts differ from invoices in one important way: the CSV/Excel receipt path has
**Auto-Post & Allocate** financial logic (`executeDraftCreation`, receipt posting +
allocation RPCs). The new receipt PDF/Image intake must **never** reach that path.

The existing architecture already enforces this by **two independent guards**, both of
which an OCR/manual intake batch fails (Batch 9C adds a **third**, mandatory route-level
`import_type` allowlist at the upload boundary — see §4.1):

1. **`file_type` guard** — `requireSupportedImportBatch(batch, stage)` (service.ts:295) is
   called at the top of `parseBatch`, `validateBatch`, and `executeDraftCreation`. It only
   accepts `file_type ∈ {csv, xlsx}`. An intake batch has `file_type ∈ {pdf, image}`, so it
   is rejected before any posting/allocation code runs.
2. **`status` guard** — `parse`/`validate`/`execute` require status `Uploaded`/`Parsed`/
   `Validated` (service.ts:780, 858, 936). An intake batch is `NeedsReview` → `ApprovedDraft`,
   which is never any of those.

**Conclusion:** a receipt PDF/Image intake batch is structurally incapable of entering the
receipt post/allocate pipeline. Batch 9C must preserve both guards and add regression tests
that assert them for `import_type='receipt'`. This is the single most important review item
for Codex (see §12).

---

## 2. Scope

### In scope
- Receipt Import page gains a **CSV/Excel** ↔ **PDF/Image Import** mode toggle (mirrors invoices page).
- Backend `uploadOcrIntakeFile` accepts `import_type='receipt'` (in addition to `'invoice'`).
- A receipt review field set (manual-entry) is presented in the intake flow.
- Signed preview, manual review, save reviewed fields, approve draft — all reused from 9B.
- Supported formats match 9B: PDF, PNG, JPG/JPEG, WebP. **SVG/SVGZ rejected.**
- User-facing wording is **PDF/Image Import** (never "OCR").
- Settings feature-status copy: add/adjust receipt intake status; shift Daily FX Sync to Batch 9D.

### Out of scope / explicitly NOT in Batch 9C — see §10
No OCR provider, no OCR worker, no OCR key, no auto-allocation, no auto-posting, no
financial receipt posting from the intake path, no direct protected-table mutation, no
bypass of financial RPCs, no `/allocations/auto` change, no `ar.*`.

---

## 3. Expected receipt PDF/Image flow (target behavior)

1. User opens **Receipt Import**.
2. User switches to **PDF/Image Import** mode (default remains CSV/Excel).
3. User uploads a supported receipt PDF/image. Client pre-check + authoritative backend
   validation (MIME/magic-number/extension/size/page-cap/encrypted/active-content/SVG).
4. Backend stores the file in the private `ar-imports` bucket; creates a
   `import_batches` (`import_type='receipt'`, `file_type` pdf/image, `status='NeedsReview'`),
   one `import_files` row (safety metadata, `ocr_status='disabled'`), and one `import_rows`
   review row (`status='NeedsReview'`, `low_confidence=true`).
5. User opens a short-lived **signed preview** (~120s) of the uploaded document.
6. User **manually reviews/enters** receipt fields (OCR is disabled — nothing is auto-filled).
7. User **saves** reviewed fields → append-only `ocr_review_decisions` audit rows; row
   `mapped_data.review_result='reviewed'`.
8. User **approves a draft** → row `status='ApprovedDraft'`, batch `status='ApprovedDraft'`,
   `financial_mutation:false`, `posting_status:'not_posted'`, `allocation_status:'not_allocated'`.
   Approval of a low-confidence row requires **AR Supervisor / Finance Manager** (reused 9B rule).
9. Flow ends at **intake/review draft only**. It does not create a posted receipt.
10. It does **not** allocate the receipt to any invoice.
11. It does **not** create a final financial receipt posting. Any future "promote draft →
    real receipt" step is **out of scope** for 9C and would be a separate, RPC-routed,
    separately-approved batch.

---

## 4. Files likely to change

### 4.1 Backend (Codex)

| File | Change | Risk |
| --- | --- | --- |
| `backend/supabase/functions/imports/service.ts` | Parametrize `uploadOcrIntakeFile` to accept `import_type ∈ {invoice, receipt}`: replace the invoice-only guard (line ~437) with an allowlist; make `import_batches.import_type` and the `import_rows.raw_data.import_type` dynamic (lines ~452, ~539); default `batch_name` fallback to a type-aware label. **REQUIRED (Codex Gate 2):** (a) set a distinct `review_kind` per type — `ocr_invoice_manual_entry` for invoices and **`ocr_receipt_manual_entry`** for receipts — for audit clarity in `import_rows.mapped_data` and `ocr_review_decisions`; (b) generalize all user-facing/manual-fallback **messages** so a receipt intake never says "invoice fields" or "invoice was posted" (e.g. row message "Enter and review the fields manually before creating a draft import" and `approveOcrDraft` success message "…approved as draft-only review data. No financial records were created — nothing was posted and no allocation was performed."). `service.ts` must retain its own `import_type` validation independent of the route-level allowlist. | Medium — the one behavior-changing backend edit. Must keep invoice path behavior identical. |
| `backend/supabase/functions/imports/index.ts` | **REQUIRED (Codex Gate 2, mandatory).** Add a route-level `import_type` allowlist on the `ocrUpload` route (`POST /imports/ocr/upload`): validate `import_type` at the API boundary and accept **only** `invoice` or `receipt`; **reject any other value with a `ValidationError` before `service.uploadOcrIntakeFile` is called.** This is mandatory defense-in-depth (mirroring the existing CSV `ALLOWED_IMPORT_TYPES` check on the `upload` route). `service.ts` must **also** keep its own validation — the two layers are independent, not a substitute for each other. | Low |
| `backend/supabase/functions/imports/file_validation.ts` | **No change** (import-type-agnostic). | None |
| `backend/supabase/functions/imports/ocr_intake_test.ts` | Add receipt-intake test cases mirroring invoice cases (upload, SVG reject, wrong-mime reject, review, approve-draft) + **mandatory route-level negative/guard tests (§7.1a)** proving a receipt PDF/Image intake batch cannot enter the CSV/Excel `parse`/`validate`/`execute` paths, and that **zero** financial records/mutations result. Also test the route-level `import_type` allowlist (reject `import_type` other than invoice/receipt at the boundary). | Low (tests) |

### 4.2 Database (Codex verification; no migration expected)

- **No new migration is expected.** `import_batches.import_type` already permits `receipt`;
  `import_files`, `import_rows`, and `ocr_review_decisions` are import-type-agnostic;
  `ocr_review_decisions` RLS keys on `company_id`/roles, not on import type.
- Codex to **verify** (read-only) in staging that: (a) inserting a receipt intake batch does
  not violate any constraint; (b) `ocr_review_decisions` RLS admits receipt rows for the same
  roles; (c) no trigger/constraint treats `import_type='receipt'` intake batches as postable.
- If Codex finds a genuine gap, a small additive migration (e.g. a comment or a defensive
  `CHECK`) may be proposed — but the default plan assumes **zero schema change**.

### 4.3 Frontend (Claude)

| File | Change |
| --- | --- |
| `frontend/src/hooks/use-ocr-import.ts` | Parametrize the hook: `useOcrImport(importType: "invoice" \| "receipt" = "invoice")`. Send `import_type` and a type-aware `batch_name` in the multipart upload. Generalize toast copy so it is not invoice-specific ("Review the imported fields…"). Add `OCR_RECEIPT_FIELDS` alongside `OCR_INVOICE_FIELDS`. Keep all routes/behavior identical; default arg keeps invoice callers unchanged. **Recommended (Codex Gate 2):** where practical, update the file's leading comments so they read as generic "PDF/Image import intake" rather than invoice-only, to reduce future confusion. **Do not rename routes/tables/exported symbols.** |
| `frontend/src/components/features/imports/ocr-import-flow.tsx` | Accept props `{ importType?: "invoice" \| "receipt" }` (default `"invoice"`); select field set (`OCR_INVOICE_FIELDS` vs `OCR_RECEIPT_FIELDS`) and heading/label copy by type; pass `importType` into `useOcrImport`. No OCR wording. Invoice usage stays behaviorally identical. **Recommended:** generalize internal comments where practical (no forced symbol/route/table renames). |
| `frontend/src/app/(dashboard)/receipts/import/page.tsx` | Add a CSV/Excel ↔ PDF/Image mode toggle (mirror invoices page pattern). Render `<OcrImportFlow importType="receipt" />` in PDF/Image mode; wrap the existing CSV/Excel wizard so the two modes are **mutually exclusive**. Replace the stale banner line "PDF/Image import is not available for receipts." with copy that clearly states receipt PDF/Image import is **intake/review-draft-only** and **does not post receipts, does not allocate to invoices, and does not create final financial records**. Keep CSV/Excel behavior 100% intact. |
| `frontend/src/app/(dashboard)/settings/page.tsx` | Feature Status: add a **"Receipt PDF/Image Import"** row (or generalize the existing "PDF/Image Import" row wording to cover invoice + receipt) with an accurate status; shift **"Daily FX Sync"** from `Planned (Batch 9C)` → `Planned (Batch 9D)`. |

### 4.4 Receipt manual-review field set (proposed)

Mirror the CSV receipt columns but **intake-only** — deliberately **exclude** allocation
fields (`invoice_reference`, `allocation_amount`) so the intake channel carries no
allocation intent:

| key | label | type | hint |
| --- | --- | --- | --- |
| `customer_name` | Customer Name | text | Existing or new visible customer |
| `receipt_date` | Receipt Date | date | YYYY-MM-DD |
| `currency` | Currency | text | 3-letter ISO (e.g. SGD, MYR) |
| `receipt_reference` | Receipt Reference | text | Bank/cheque reference |
| `payment_method` | Payment Method | text | CHQ, TT, CASH, CC, GIRO, OFST, ONLN |
| `amount` | Amount | number | Positive receipt amount |
| `bank_account_code` | Bank Account No. | text | From bank_accounts.account_no |
| `remarks` | Remarks | text | Optional internal note |

Codex may refine this set; it drives display/manual-entry only and is stored as freeform
`reviewed_fields` (no financial effect).

---

## 5. Database / API / Frontend impact summary

- **Database:** No schema change expected (verification only). New rows land in existing
  `import_batches` / `import_files` / `import_rows` / `ocr_review_decisions` with
  `import_type='receipt'`.
- **API:** No new routes. The six existing Batch 9B intake routes are reused for receipts:
  `POST /imports/ocr/upload` (now accepts `import_type=receipt`), `GET …/preview-url`,
  `POST …/ocr/start`, `GET …/ocr-review`, `PATCH …/rows/:rowId/ocr-review`,
  `POST …/rows/:rowId/approve-draft`. Response envelopes unchanged.
- **Frontend:** Receipt Import page gains a second channel; a shared intake flow is
  parametrized by import type. CSV/Excel receipt import and invoice PDF/Image import are
  untouched in behavior.

---

## 6. Security / RLS implications

- **Tenant isolation:** all reuse the authenticated, company-scoped service client and
  existing RLS. `ocr_review_decisions` RLS (SELECT for AR roles + Auditor; INSERT for
  AR Clerk/Supervisor/Finance Manager; no UPDATE/DELETE) applies unchanged to receipt rows.
- **Capability gating:** upload/start/save require import-write; approve of a low-confidence
  row requires AR Supervisor / Finance Manager (`requireSupervisorOrFinanceManager`). Reused as-is.
- **No financial mutation:** intake never calls receipt post/allocate RPCs; both the
  `file_type` and `status` guards (§1.2) keep intake batches out of `executeDraftCreation`.
- **Storage:** private `ar-imports` bucket only; access via short-lived signed URLs; no public URLs.
- **File safety:** magic-number MIME detection, extension/MIME cross-check, size caps
  (PDF 10 MB / image 8 MB), PDF page cap (3), encrypted/active-content PDF rejection,
  double-extension + SVG rejection — all reused unchanged.
- **`/allocations/auto`:** untouched; remains HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- **No `ar.*`:** `public` schema only.

---

## 7. Test plan

### 7.1 Backend (Codex, Deno tests + staging)
- Upload receipt PDF → 201; batch `import_type='receipt'`, `status='NeedsReview'`, one file + one review row.
- Upload receipt PNG / JPG / JPEG / WebP → 201 each.
- Reject SVG and SVGZ → validation error (no batch/file persisted or batch marked failed).
- Reject wrong MIME / magic-number mismatch / double extension / empty / oversized / encrypted / active-content PDF.
- Signed preview returns a working short-lived URL for a receipt intake file.
- `ocr/start` (provider disabled) → controlled manual-fallback, no provider call.
- Save review → `ocr_review_decisions` rows recorded; `reviewed_fields` persisted.
- Approve draft → `ApprovedDraft`, `financial_mutation:false`, `posting_status:'not_posted'`,
  `allocation_status:'not_allocated'`; low-confidence approval requires Supervisor/Finance Manager.
- **Negative/guard tests (critical):** attempt `parse`/`validate`/`execute` on a receipt
  intake batch → rejected by `requireSupportedImportBatch` and status guard; assert **no**
  receipt row, journal entry, allocation, or balance mutation is created.
- **Regression:** invoice PDF/Image intake still passes byte-for-byte behavior; CSV/Excel
  receipt import (parse/validate/execute/post/allocate) unchanged.

### 7.1a Route-level negative/guard tests for receipt PDF/Image intake (MANDATORY — Codex Gate 2)

These are **blocking** tests. They must prove a receipt PDF/Image intake batch
(`import_type='receipt'`, `file_type ∈ {pdf,image}`, `status ∈ {NeedsReview, ApprovedDraft}`)
**cannot** enter the CSV/Excel processing pipeline via any route or status:

- `POST /imports/:batchId/parse` on a receipt PDF/Image intake batch → **rejected**
  (by `requireSupportedImportBatch` file_type guard and/or the `status !== 'Uploaded'` gate).
- `POST /imports/:batchId/validate` on a receipt PDF/Image intake batch → **rejected**
  (file_type guard and/or `status ∉ {Parsed, Validated}` gate).
- `POST /imports/:batchId/execute` on a receipt PDF/Image intake batch → **rejected**
  (file_type guard and/or `status ∉ {Parsed, Validated}` gate), including when a caller
  supplies `auto_post: true`.
- **Failure must occur BEFORE any financial side effect.** Each test must assert that at the
  point of rejection there is **zero**:
  - receipt creation (`receipts` insert),
  - receipt posting,
  - allocation (`allocation_details` insert),
  - invoice `outstanding` update,
  - receipt `allocated_amount` / `unallocated_amount` update,
  - journal entry creation.
- After the rejected calls, re-query the tenant and assert **no** new financial rows/mutations
  exist that are attributable to the intake batch (post-condition snapshot: financial tables
  unchanged).
- **Route-level allowlist test:** `POST /imports/ocr/upload` with an `import_type` other than
  `invoice`/`receipt` (e.g. `journal`, empty, arbitrary) → **rejected at the route boundary**
  with a `ValidationError` and `uploadOcrIntakeFile` is never reached.
- Confirm `/allocations/auto` continues to return HTTP 403 `AUTO_ALLOCATION_DISABLED`
  throughout (unchanged; not invoked by any intake path).

### 7.2 Frontend (Claude)
- `npx tsc --noEmit` clean; `npm run build` clean (route count unchanged unless a route is added).
- Receipt Import: toggling CSV ↔ PDF/Image shows exactly one channel; CSV wizard unchanged.
- PDF/Image mode: upload → review → save → approve draft happy path renders review/draft-only messaging.
- SVG rejected client-side with friendly copy; unsupported/oversized rejected.
- Role-aware controls from real `/auth/me` (no demo/env role); approve hidden/blocked without Supervisor/Finance Manager.
- **No user-facing "OCR" wording check across BOTH import pages (Codex Gate 2):** grep/scan
  the rendered copy of the receipt import page **and** the invoice import page (plus the shared
  intake flow and hook) and assert no visible "OCR", "OCR provider", "AI OCR", or
  "automatic extraction" strings. Remaining "OCR" occurrences must be internal only
  (symbol/route/data-field names, comments).
- **Receipt PDF/Image draft-only copy check:** the receipt PDF/Image UI must clearly state it
  creates review/draft data only and **does not post receipts, does not allocate to invoices,
  and does not create final financial records** (upload notice, approve confirmation, and the
  approved-state screen).
- Invoice PDF/Image import page visually/behaviorally unchanged.

---

## 8. Staging smoke plan (Gate 5)

- Deploy `imports` Edge Function to **staging** only.
- Synthetic (non-real) receipt documents: upload PDF/PNG/JPG/JPEG/WebP → expect HTTP 201.
- Rejection cases (SVG, wrong-MIME, oversized, encrypted PDF) → expect controlled failures.
- Signed preview reachable; review → save → approve-draft completes as draft-only.
- Verify DB post-conditions: batch/row `ApprovedDraft`; **zero** receipts, allocations,
  journal entries created; `ocr_review_decisions` populated.
- Confirm `/allocations/auto` still returns HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- Confirm invoice intake + CSV/Excel receipt import still work in staging.
- Record staging evidence before any production consideration.

---

## 9. Production rollout gates

1. **Gate 1 — Claude Planning:** this document.
2. **Gate 2 — Codex Review:** backend/RLS/financial-safety review of the parametrization,
   especially the §1.2 guards and the "no migration" assertion. Codex PASS required.
3. **Gate 3 — User Approval:** explicit approval to implement.
4. **Gate 4 — Staging Implementation:** Codex backend change + Claude frontend; staged only.
5. **Gate 5 — Staging Smoke:** §8; evidence recorded.
6. **Gate 6 — Production Readiness:** review evidence, confirm non-goals held, rollback ready.
7. **Gate 7 — Production Deploy:** deploy `imports` function; production synthetic smoke;
   flip Settings status to reflect live receipt intake. Explicit approval required.

No production action occurs without explicit user approval at Gates 3, 6, and 7.

---

## 10. What is explicitly NOT in Batch 9C

- No real OCR provider, no OCR API key, no self-hosted OCR worker (Tesseract/Paddle/etc.).
- No automatic field extraction — manual entry only.
- No auto-allocation of receipts to invoices.
- No auto-posting / financial receipt posting from the PDF/Image intake path.
- No promotion of an intake draft into a real posted `receipts` record (future, separate,
  RPC-routed, separately-approved batch).
- No journal entries produced by the intake/smoke flow.
- No direct mutation of protected financial tables; no bypass of financial RPCs.
- No `/allocations/auto` change (stays HTTP 403 `AUTO_ALLOCATION_DISABLED`).
- No `ar.*` schema usage.
- No change to Invoice PDF/Image (9B) behavior or CSV/Excel receipt/invoice import behavior.
- No user-facing "OCR" wording.

---

## 11. Rollback plan

- **Frontend:** revert the receipt page toggle + hook/flow parametrization + settings copy
  commits; invoice/CSV behavior is unaffected because parametrization is additive with
  invoice defaults.
- **Backend:** revert the `uploadOcrIntakeFile` parametrization (restore the invoice-only
  guard) and redeploy the prior `imports` function version; receipt intake uploads then
  return the previous "invoice only" validation error. No data migration to unwind.
- **Data:** any receipt intake rows created are draft-only (`import_type='receipt'`,
  `status='NeedsReview'/'ApprovedDraft'`) and carry no financial effect; they can be left in
  place or cleaned up administratively without touching financial tables.
- **Edge Function versioning:** keep the pre-9C function version noted so staging/production
  can be pinned back if smoke fails.

---

## 12. Risks and non-goals

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Receipt intake batch accidentally reaches post/allocate pipeline | Low | §1.2 double guard (`file_type` + `status`); explicit negative tests (§7.1). **Top Codex review item.** |
| Parametrizing `uploadOcrIntakeFile` regresses the invoice path | Low–Med | Keep invoice as default; snapshot invoice-path behavior in tests before/after. |
| Reviewers assume "draft receipt" means a real posted receipt | Med | Clear review/draft-only UI copy + approve message; no `receipts` row is created. |
| Scope creep into allocation/posting | Med | Exclude allocation fields from the receipt field set (§4.4); non-goals in §10. |
| Stale "not available for receipts" / "Planned (Batch 9C)" copy left behind | Med | Explicit copy tasks in §4.3. |
| Hidden schema constraint blocks receipt intake insert | Low | Codex read-only staging verification (§4.2) before implementation. |

---

## 13. Acceptance criteria

- [ ] Receipt Import page clearly supports **PDF/Image Import** (mode toggle, CSV default preserved).
- [ ] Receipt PDF/Image accepts **PDF, PNG, JPG/JPEG, WebP**.
- [ ] Receipt PDF/Image **rejects SVG/SVGZ** (and double-extension/wrong-MIME/oversized/encrypted).
- [ ] Signed preview works for receipt intake files.
- [ ] Manual review / save / approve-draft flow works for receipts (draft-only).
- [ ] **No user-facing "OCR" wording** anywhere in **both** the receipt and invoice import flows (scanned).
- [ ] Receipt PDF/Image UI copy clearly states **no posting, no allocation, no final financial records**.
- [ ] No OCR provider / worker / key added.
- [ ] **Route-level `import_type` allowlist enforced** on `POST /imports/ocr/upload`: only
      `invoice`/`receipt` accepted; any other value rejected **before** `uploadOcrIntakeFile` runs.
- [ ] **`POST /imports/:batchId/parse` rejects a receipt PDF/Image intake batch** (before any financial side effect).
- [ ] **`POST /imports/:batchId/validate` rejects a receipt PDF/Image intake batch** (before any financial side effect).
- [ ] **`POST /imports/:batchId/execute` rejects a receipt PDF/Image intake batch** (before any financial side effect, including with `auto_post:true`).
- [ ] Receipt PDF/Image intake creates **zero** financial records/mutations: no receipt creation,
      no receipt posting, no `allocation_details` insert, no invoice `outstanding` update, no
      receipt `allocated_amount`/`unallocated_amount` update, no journal entry.
- [ ] Existing Receipt **CSV/Excel** import still works (parse/validate/execute/post/allocate).
- [ ] Existing Invoice **PDF/Image** import (9B) still works.
- [ ] `/allocations/auto` still returns **HTTP 403 `AUTO_ALLOCATION_DISABLED`**.
- [ ] No automatic allocation from receipt PDF/Image.
- [ ] No automatic financial posting from receipt PDF/Image.
- [ ] No direct protected financial-table mutation; no financial-RPC bypass.
- [ ] No `ar.*` schema usage.
- [ ] Evidence file(s) created (plan, staging smoke, prod smoke as gates progress), and evidence
      **explicitly records the Daily FX Sync label shift from Batch 9C → Batch 9D**.

---

## 14. Evidence files to create (as gates progress)

- `docs/evidence/SPRINT_BATCH_9C_RECEIPT_PDF_IMAGE_PLAN_EVIDENCE.md` — plan + Codex Gate 2 review outcome
  (`PASS WITH REQUIRED PLAN AMENDMENTS`) and the applied amendments. **Must explicitly record the
  Daily FX Sync roadmap label shift from Batch 9C → Batch 9D.**
- `docs/evidence/SPRINT_BATCH_9C_RECEIPT_PDF_IMAGE_STAGING_SMOKE_EVIDENCE.md` — Gate 5 staging smoke,
  including the §7.1a route-level negative/guard results and the zero-financial-mutation post-conditions.
- `docs/evidence/SPRINT_BATCH_9C_RECEIPT_PDF_IMAGE_FRONTEND_EVIDENCE.md` — Claude frontend implementation,
  including the no-user-facing-OCR scan across both import pages.
- `docs/evidence/SPRINT_BATCH_9C_RECEIPT_PDF_IMAGE_PROD_ROLLOUT_EVIDENCE.md` — Gate 7 production rollout/smoke.

---

## 15. Questions for Codex — Gate 2 resolutions

Codex Gate 2 verdict: **PASS WITH REQUIRED PLAN AMENDMENTS.** Resolutions below; all are now
folded into the body of this plan.

1. **No-migration assertion** — **Confirmed.** `import_type='receipt'` is already supported
   (`chk_import_batches_type`), 016 is import-type-agnostic; **no migration is likely needed**
   (Codex read-only staging verification still performed at Gate 4/5).
2. **Guard sufficiency** — **Confirmed** the `file_type` guard + status gate keep receipt intake
   batches out of post/allocate. Codex additionally **requires** explicit route-level negative
   tests to prove it (§7.1a) rather than relying on the guards implicitly.
3. **`uploadOcrIntakeFile` parametrization shape** — **Resolved: do both.** The `index.ts`
   route-level `import_type` allowlist is now **mandatory** (not optional) *and* `service.ts`
   keeps its own validation (§4.1).
4. **Receipt review field set** — **Confirmed:** keep the intake-only set **excluding**
   `invoice_reference` and `allocation_amount` for Batch 9C (§4.4).
5. **Approve-draft wording/state** — **Resolved:** add a distinct `review_kind`
   (`ocr_receipt_manual_entry`) **and** generalize the manual-fallback/approve messages so a
   receipt never says "invoice fields" / "invoice was posted" (§4.1).
6. **Retention/audit** — No receipt-specific retention change; shared 30-day retention and
   append-only `ocr_review_decisions` apply, now carrying the receipt `review_kind`.
7. **Roadmap** — **Confirmed:** Daily FX Sync is relabeled **Batch 9D**; the shift must be
   recorded in evidence (§13, §14).

---

## 16. Readiness

This plan has been **amended per Codex Gate 2 (`PASS WITH REQUIRED PLAN AMENDMENTS`)** and is
**ready for Codex amendment confirmation.** Implementation must not begin until Codex confirms
the amendments and the user grants approval (Gate 3). No code, migration, deployment, or
staging/production mutation has been performed.

---

## 17. Codex Gate 2 amendment changelog

**Required (blocking) amendments — applied:**

- **A1 — Mandatory route-level intake allowlist:** `POST /imports/ocr/upload` must validate
  `import_type` at the API boundary and accept only `invoice`/`receipt`, rejecting any other
  value **before** `uploadOcrIntakeFile` is called; `service.ts` keeps its own validation as
  independent defense-in-depth. Now a **required** backend item (§1.2, §4.1) with a route-level
  allowlist test (§7.1a) and acceptance criterion (§13).
- **A2 — Explicit route-level negative tests for receipt PDF/Image batches:** new §7.1a makes
  it **blocking** that `parse`/`validate`/`execute` reject a receipt PDF/Image intake batch,
  with failure occurring **before** any receipt creation, receipt posting, allocation,
  invoice `outstanding` update, receipt `allocated_amount`/`unallocated_amount` update,
  `allocation_details` insert, or journal entry — and that **zero** financial records/mutations
  result. Mirrored into acceptance criteria (§13) and staging/evidence (§8, §14).

**Recommended amendments — applied:**

- **R1 — Generalized backend messages:** receipt intake must not say "invoice fields" or
  "invoice was posted"; manual-fallback and approve-draft messages generalized (§4.1).
- **R2 — Distinct `review_kind`:** `ocr_receipt_manual_entry` for receipts vs
  `ocr_invoice_manual_entry` for invoices, for audit clarity (§4.1).
- **R3 — Receipt field set:** keep excluding `invoice_reference`/`allocation_amount` in 9C (§4.4).
- **R4 — Comment renames only:** generalize frontend/internal comments where practical; **no**
  forced route/table/symbol renames (§4.3).
- **R5 — Daily FX Sync label shift recorded:** evidence must state the Batch 9C → Batch 9D move
  (§0, §13, §14).
- **R6 — No user-facing OCR wording across both pages:** scan receipt **and** invoice import
  pages/flow/hook (§7.2, §13).
- **R7 — Receipt draft-only copy:** UI must clearly state no posting, no allocation, and no
  final financial records (§4.3, §7.2, §13).

**Retained Codex-verified findings (unchanged):**

- `import_type='receipt'` is already supported; no migration is likely needed.
- `uploadOcrIntakeFile` currently hard-rejects non-invoice and hardcodes invoice values.
- Signed preview / save / approve routes are mostly import-type-agnostic.
- Receipt PDF/Image intake is currently blocked from post/allocate by (1) the `file_type`
  guard accepting only CSV/XLSX for parse/validate/execute and (2) the status gate expecting
  Uploaded/Parsed/Validated while intake uses NeedsReview/ApprovedDraft.
- `/allocations/auto` remains HTTP 403 `AUTO_ALLOCATION_DISABLED`.
