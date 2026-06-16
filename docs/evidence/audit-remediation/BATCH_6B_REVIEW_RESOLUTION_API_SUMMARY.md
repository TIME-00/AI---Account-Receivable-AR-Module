# Batch 6B — Backend Review-Resolution API Summary

> **Status:** ✅ Implemented, deployed, smoke-tested, committed, and pushed.
> **Implementation commit:** `fa58d4a` — *Add import review resolution API*
> **Follow-up fix commit:** `1c89e0a` — *Preserve import review metadata on retry validation* (Batch 6B-Fix)
> **Plan reference:** [`docs/plans/batch-6b-review-resolution-api-plan.md`](../../plans/batch-6b-review-resolution-api-plan.md)
> **Scope:** Backend-only. No frontend UI, no automatic allocation, no financial RPC / schema changes.

---

## 1. Purpose

Batch 6A added **read-only** fuzzy-match suggestion diagnostics (stored in `import_rows.mapped_data`) but provided no way to *act* on those suggestions server-side. Batch 6B adds a safe backend **review-resolution API** so a reviewer can approve, reject, or edit a flagged row, and then explicitly re-validate it — without any direct financial mutation.

The design rests on one verified invariant from the import pipeline:

> [!CAUTION]
> **`validateRow` re-validates from `raw_data`, not `mapped_data`.** Therefore every review *correction* is written to `raw_data` (the canonical re-validation source). `mapped_data` only carries evidence / audit markers. A correction round-trips into a `Valid` row **only** when the explicit `retry_validation` action re-runs validation against the updated `raw_data`.

---

## 2. Scope Completed

| # | Item | Status |
|---|------|--------|
| 1 | Backend review route `POST /imports/:batchId/rows/:rowId/review` | ✅ Done |
| 2 | `ImportService.reviewRow()` dispatcher | ✅ Done |
| 3 | Action `approve_suggestion` | ✅ Done |
| 4 | Action `reject_suggestion` | ✅ Done |
| 5 | Action `edit_customer` | ✅ Done |
| 6 | Action `edit_invoice_reference` | ✅ Done |
| 7 | Action `retry_validation` | ✅ Done |
| 8 | `approve_suggestion` writes canonical `raw_data` (`customer_code` / `customer_name` / `invoice_reference`) | ✅ Done |
| 9 | Only `retry_validation` can move a corrected row to `Valid` | ✅ Done (verified) |
| 10 | `approve_suggestion` does **not** directly mark the row `Valid` | ✅ Done (verified) |
| 11 | No review action creates / posts / allocates | ✅ Done (verified) |
| 12 | `refreshBatchCounters` used instead of full `validateBatch` | ✅ Done |
| 13 | Batch 6B-Fix preserves review audit metadata across `retry_validation` | ✅ Done |
| 14 | **No** frontend approve / reject / edit UI added | ✅ Done (verified) |
| 15 | **No** automatic allocation enabled | ✅ Done (verified) |
| 16 | **No** financial RPC / database / schema changes | ✅ Done (verified) |

---

## 3. Files Changed

| File | Change | Lines |
|------|--------|-------|
| `backend/supabase/functions/imports/index.ts` | Added `review` route to `ROUTES` (two-UUID regex matched **before** the single-UUID `rows`/`single` patterns); `matchRoute` returns `{ id, batchId, rowId }` for the review route; `POST` handler validates both UUIDs, parses optional JSON body, and dispatches to `service.reviewRow()` | +23 / −6 |
| `backend/supabase/functions/imports/service.ts` (commit `fa58d4a`) | `ReviewAction` / `ReviewRowResult` types; `reviewRow` dispatcher + `refreshBatchCounters`; per-action handlers `applyApproveSuggestion`, `applyRejectSuggestion`, `applyEditCustomer`, `applyEditInvoiceReference`, `revalidateReviewRow`; helpers `fetchReviewableRow`, `parseReviewAction`, `reviewNote`, `updateReviewRow`, `optionalUUID`, `findCandidateById`, `resolveVisibleCustomerById`, `resolveVisibleCustomerByCode`, `resolveReviewCustomerFromRaw`, `resolveReviewInvoice`, `inspectEditedInvoiceReference` | +640 |
| `backend/supabase/functions/imports/service.ts` (commit `1c89e0a`, Batch 6B-Fix) | `REVIEW_AUDIT_FIELDS` constant + `preserveReviewAuditFields()` helper; `revalidateReviewRow` now merges preserved audit markers over fresh validation `mapped_data` | +35 / −1 |

> No frontend files were touched. No migration / schema file was added.

---

## 4. Logic Implemented

### 4.1 Route and dispatch (`imports/index.ts`)

```ts
review: new RegExp(`^\\/${UUID}\\/rows\\/${UUID}\\/review\\/?$`, 'i'),
```

- The `review` entry is inserted **before** `rows` / `single` in the ordered `ROUTES` map so the two-UUID path is matched first (`Object.entries` preserves insertion order).
- `matchRoute` special-cases the review route to return both captured UUIDs: `{ id: match[1], batchId: match[1], rowId: match[2] }`.
- The `POST` handler calls `validateUUID` on both `batch_id` and `row_id`, parses the JSON body only when `Content-Type: application/json`, and calls `service.reviewRow(auth, batchId, rowId, body)`.

### 4.2 `reviewRow` dispatcher (`imports/service.ts`)

```text
reviewRow(auth, batchId, rowId, payload):
  batch = getWritableBatch(auth, batchId)      // requireImportWrite + company scope + AR-Clerk-owns-batch + not-Cancelled
  row   = fetchReviewableRow(batch.id, rowId)   // blocks Created / Posted / Allocated rows
  action = parseReviewAction(payload.action)    // whitelist of 5 actions
  switch(action) → applyApproveSuggestion | applyRejectSuggestion |
                   applyEditCustomer | applyEditInvoiceReference | revalidateReviewRow
  refreshBatchCounters(batch.id)                // recompute, never full re-validate
```

- **Authorization:** `getWritableBatch` → `requireImportWrite` rejects **Auditor** (read-only) and **System Admin** (config-only); enforces company scope and the AR-Clerk-owns-batch rule.
- **Row guard:** `fetchReviewableRow` throws `ValidationError` if the row status is `Created`, `Posted`, or `Allocated` — already-materialised rows cannot be reviewed.

### 4.3 `approve_suggestion` — writes canonical `raw_data`

- Requires `mapped_data.review_required === true`; otherwise rejected.
- Requires `suggested_customer_id` and/or `suggested_invoice_id`; approving both is allowed only when `review_kind === 'both'`.
- Each selection must exist in the row's stored candidate arrays (`findCandidateById` checks `suggested_customers`/`customer_candidates` and `suggested_invoices`/`invoice_candidates`) — otherwise `rejected_invalid_selection`.
- **Customer approval:** resolves the suggestion through `resolveVisibleCustomerById` (company-scoped, `is_deleted=false`, `is_hidden=false`, then `requireCustomerAccess`) and writes:
  - `raw_data.customer_code = customer.customer_id`
  - `raw_data.customer_name = customer.customer_name`
  - `mapped_data.approved_customer_id / _code / _name`
- **Invoice approval:** resolves through `resolveReviewInvoice` (receipt batches only; re-derives the exact customer from `raw_data`, enforces company + customer match, currency match, `isAllocatableInvoice`, and the Batch 5-Fix-A `preflightReceiptImportAllocation`) and writes:
  - `raw_data.invoice_reference = invoice.invoice_no`
  - `mapped_data.approved_invoice_id / _no`
- Records `user_action='approved'`, `review_result='approved_pending_retry'`, `approved_by=auth.userId`, `approved_at`.
- **Returns `review_result: 'approved_pending_retry'` with `revalidated: false` — the row status is NOT changed to `Valid`.**

### 4.4 `reject_suggestion`

- Deletes any prior `approved_*` markers, sets `user_action='rejected'`, `review_result='rejected'`, `rejected_at`.
- Does not touch `raw_data` or row status.

### 4.5 `edit_customer` — `customer_id` is translated, never trusted raw

- Accepts `customer_id`, `customer_code`, or free-text `customer_name` (at least one required).
- A supplied **`customer_id` is resolved** via `resolveVisibleCustomerById` (company scope + visible-only + `requireCustomerAccess`) and translated to `raw_data.customer_code = customer.customer_id`; **`raw_data.customer_id` is never written** because the importer reads `customer_code`/`customer_name`/`registration_no`.
- `customer_code` is resolved via `resolveVisibleCustomerByCode`; free-text name writes `raw_data.customer_name` with an emptied `customer_code`.
- Records `edited_*` markers + `review_result='edited_pending_retry'`. Status unchanged.

### 4.6 `edit_invoice_reference`

- Requires a non-empty `invoice_reference`.
- `inspectEditedInvoiceReference` pre-checks allocatability for receipt batches and **blocks** the edit on `currency_mismatch`, `no_outstanding`, or `invoice_not_open` (reusing Batch 6A `invoiceReferenceSuggestionDiagnostics`).
- On success writes `raw_data.invoice_reference` + `edited_invoice_reference` marker; `review_result='edited_pending_retry'`. Status unchanged.

### 4.7 `retry_validation` — the only path to `Valid`

- Re-runs `validateRow(auth, batch.import_type, row.raw_data)` against the **corrected `raw_data`**.
- Status becomes `Error` if validation errors exist, else the validator's status (default `Valid`).
- `review_result` is `revalidated_valid` or `revalidation_failed`.
- **Batch 6B-Fix:** `mapped_data` is rebuilt as `preserveReviewAuditFields(row.mapped_data, freshValidationMappedData)` so audit markers (`user_action`, `approved_*`, `edited_*`, `approved_by/at`, `edited_by/at`, `rejected_at`, `review_note`) survive the validator overwriting `mapped_data`. Then sets `revalidated_at` / `revalidated_by`.

### 4.8 `refreshBatchCounters` (instead of full `validateBatch`)

```text
total_rows      = all rows
valid_rows      = Valid | Created | Posted | Allocated
error_rows      = Error | Unmatched | Skipped
skipped_count   = Skipped
unmatched_count = Unmatched
```

> [!IMPORTANT]
> A single review action touches one row. Re-running `validateBatch` would re-derive **every** row from `raw_data` and overwrite other rows' in-progress review decisions. `refreshBatchCounters` only recomputes the batch tallies from current `import_rows.status`, preserving sibling rows' review state.

---

## 5. Status / Result Mapping

| Action | `raw_data` write | `import_rows.status` | `review_result` | `revalidated` |
|--------|------------------|----------------------|-----------------|---------------|
| `approve_suggestion` | `customer_code`+`customer_name` and/or `invoice_reference` | unchanged — never auto-`Valid` | `approved_pending_retry` | `false` |
| `reject_suggestion` | none | unchanged | `rejected` | `false` |
| `edit_customer` | `customer_code`(+`customer_name`) | unchanged — never auto-`Valid` | `edited_pending_retry` | `false` |
| `edit_invoice_reference` | `invoice_reference` | unchanged — never auto-`Valid` | `edited_pending_retry` | `false` |
| `retry_validation` | none | `Valid` **or** `Error` (from validator) | `revalidated_valid` / `revalidation_failed` | `true` |

No new `import_rows.status` enum value was introduced.

---

## 6. Commands / Checks Run

| Check | Result |
|-------|--------|
| `deno check --allow-import imports/index.ts` | ✅ Passed |
| `deno check customers/index.ts` | ✅ Passed |
| `deno check receipts/index.ts` | ✅ Passed |
| `deno check allocations/index.ts` | ✅ Passed |
| `git diff --check` | ✅ Passed (Windows CRLF warnings only — not errors) |
| `imports` Edge Function deploy to production | ✅ Deployed |
| `git commit` / `git push` | ✅ `fa58d4a` (API) + `1c89e0a` (metadata-preservation fix) |

---

## 7. Smoke Test Results

### 7.1 Receipt-side production smoke — batch `86314067-bb31-414e-b3e0-b01719f60284`

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | Normalized invoice row (`23bc47e4-b154-4bed-a9a0-5e16398f4084`) | `approve_suggestion` → `retry_validation` | Approve passes; retry passes; row → `Valid`; `raw_data.invoice_reference` = `INV-202606-00063`; `receipt_id` & `invoice_id` remain `null` | ✅ PASSED |
| 2 | Fake invoice row (`399cac79-a1fb-41e4-8828-8c7164c0eae8`) | `reject_suggestion` | Reject passes; row remains `Unmatched`/rejected; `receipt_id` & `invoice_id` remain `null` | ✅ PASSED |
| 3 | No financial side effects | — | No receipts/invoices created for review-only rows | ✅ PASSED |
| 4 | Auto-allocation still disabled | `POST /allocations/auto` | `403 AUTO_ALLOCATION_DISABLED` | ✅ PASSED |

### 7.2 Customer-side production smoke — batch `6da3402c-8c59-4a67-b2bf-cd4916e92ad1`

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 5 | Customer suggestion row (`6cf3e996-5006-408b-abe4-df2f387b17ae`, suggested customer `e0b2655a-6d77-47cf-976f-0f1ad3641f59`) | `approve_suggestion` | `success: true`, `review_result: approved_pending_retry` | ✅ PASSED |
| 6 | Same row | `retry_validation` | `success: true`, `review_result: revalidated_valid` | ✅ PASSED |
| 7 | No financial side effects | — | No invoice created during review/retry | ✅ PASSED |

**Confirmed behaviour:** suggestion approval succeeds without mutating row status; the explicit `retry_validation` step is what produces `revalidated_valid`; no receipts/invoices/allocations are created by any review action.

---

## 8. Safety Confirmations

| # | Guarantee | Evidence |
|---|-----------|----------|
| 1 | No Batch 6C frontend approve/reject/edit UI | No frontend files in `fa58d4a` / `1c89e0a` |
| 2 | No automatic allocation enabled | No call to allocation RPCs in `reviewRow`; smoke test 4 |
| 3 | `POST /allocations/auto` remains disabled | Smoke test 4 — `403 AUTO_ALLOCATION_DISABLED` |
| 4 | No OCR / PDF / Image import | Upload still restricted to `csv` / `xlsx` |
| 5 | No backend idempotency layer added | `reviewRow` has no idempotency-key handling |
| 6 | No database migration / schema change | All review state in existing `raw_data` / `mapped_data` JSON |
| 7 | No new `import_rows.status` enum value | Status mapping table §5 |
| 8 | No financial RPC changes | `post_receipt` / `allocate_receipt` untouched |
| 9 | No direct `allocation_details` insert | `reviewRow` writes only `import_rows` |
| 10 | No direct `invoices.outstanding` update | `reviewRow` writes only `import_rows` |
| 11 | No direct `receipts.allocated_amount` / `unallocated_amount` update | `reviewRow` writes only `import_rows` |
| 12 | Hidden / deleted customers cannot be approved or selected | `resolveVisibleCustomerById` / `resolveVisibleCustomerByCode` filter `is_hidden=false`, `is_deleted=false` + `requireCustomerAccess` |
| 13 | Company scope + AR-Clerk ownership enforced | `getWritableBatch` → `requireImportWrite` |
| 14 | Auditor (read-only) and System Admin (config-only) blocked from review writes | `requireImportWrite` rejects both |
| 15 | Already-materialised rows cannot be reviewed | `fetchReviewableRow` blocks `Created`/`Posted`/`Allocated` |
| 16 | Review audit metadata survives retry validation | Batch 6B-Fix `preserveReviewAuditFields` (`1c89e0a`); smoke tests 1 & 5–6 |

---

## 9. What Was NOT Changed

- **No** frontend review/approve/reject/edit controls (deferred to Batch 6C).
- **No** automatic allocation, automatic posting, or OCR/PDF/Image ingestion.
- **No** changes to `executeDraftCreation`, financial RPCs, or any balance/journal-entry path.
- **No** new database objects, columns, or status enum values.
- **No** backend idempotency keys.

---

## 10. Relationship to Sibling Batches

- **Batch 6A** produced the read-only suggestion diagnostics in `mapped_data` that Batch 6B now consumes (`review_required`, `review_kind`, candidate arrays).
- **Batch 5-Fix-A** allocation preflight (`preflightReceiptImportAllocation`) and Batch 6A `invoiceReferenceSuggestionDiagnostics` / `isAllocatableInvoice` are **reused** by `resolveReviewInvoice` and `inspectEditedInvoiceReference` — not re-implemented or bypassed.
- **Batch 6C** (future) will add the frontend UI that calls this API. It is explicitly out of scope here.

---

## 11. Risks / Notes

- The review API mutates only `import_rows`; correctness of the eventual financial result still depends entirely on the unchanged `executeDraftCreation` + RPC path that runs later.
- Because corrections live in `raw_data` and only `retry_validation` re-validates, a reviewer who approves/edits but never retries leaves the row in a `*_pending_retry` state (still counted as an error row) — intended, conservative behaviour.
- `refreshBatchCounters` derives tallies from current row statuses; it relies on review actions persisting status changes only through `retry_validation`, which is the case in this implementation.
