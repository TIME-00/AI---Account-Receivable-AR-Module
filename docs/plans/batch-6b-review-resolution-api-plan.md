# Batch 6B — Backend Review-Resolution API Plan

**Status**: 🟢 Codex-reviewed (round 1) — Approved with changes (applied)
**Date**: 2026-06-14
**Depends on**: Batch 6A (commit `389cded` — fuzzy suggestion diagnostics + read-only display)
**Scope**: Backend-only. Adds one review-resolution route to the existing `imports` Edge Function so a human reviewer's decision on a `review_required` row can be recorded and safely re-validated server-side. **No frontend buttons (Batch 6C), no automatic allocation, no OCR, no fully automatic posting, no backend idempotency.**

> [!IMPORTANT]
> Batch 6B records and re-validates a reviewer's decision; it does **not** create, post, or allocate. Execution still happens only through the existing `execute` route (`executeDraftCreation`) after a row legitimately returns to `Valid` via re-validation. Approval is never blindly trusted — every selection is recomputed from live data at consumption time (§4).

> [!CAUTION]
> **`raw_data` is the canonical source of truth for re-validation; `mapped_data` is evidence/diagnostics only.** The existing `validateRow` re-validates a row from `raw_data` (`service.ts:421, 724`). Therefore any decision that should change a re-validation outcome — `approve_suggestion`, `edit_customer`, `edit_invoice_reference` — **must write the canonical import field(s) into `raw_data`** (e.g. `raw_data.customer_code`, `raw_data.invoice_reference`). Writing only `approved_*` markers into `mapped_data` would leave the original typo in `raw_data`, and `retry_validation` would re-derive the same `Unmatched` result. Review metadata (`approved_*`, `user_action`, `review_result`, `approved_by`, `approved_at`) is still recorded in `mapped_data` as the audit trail — but it never substitutes for the `raw_data` correction.

---

## 0. Goal

After Batch 6A, a customer-typo or invoice-reference near-miss becomes an `Unmatched`/`Skipped` row carrying suggestion diagnostics in `import_rows.mapped_data`. Today there is no server-side way to act on that suggestion — the reviewer can only see it. Batch 6B adds a **single backend route** that lets an authorized reviewer:

- **approve** a suggested customer/invoice,
- **reject** a suggestion,
- **edit** the customer or invoice reference,
- **retry validation**,

with the result recorded in `mapped_data` and the row's status moved **only among the existing `import_rows.status` values**. The route performs full server-side re-validation; it never mutates financial tables and never bypasses the verified import/preflight paths.

---

## 1. Verified current behavior (grounding)

All paths below were read from the committed code and are the foundation this plan builds on.

| Fact | Location |
|------|----------|
| Edge Function uses a regex `ROUTES` map; `matchRoute` extracts a single `{ id }` UUID param | `imports/index.ts:13-42` |
| Existing routes: `upload`, `parse`, `validate`, `execute`, `rows` (GET), `single` (GET), `collection` (GET) | `imports/index.ts:17-25, 54-138` |
| `extractCompanyId` (UUID-validated) + `getAuthContext` run before any route | `imports/index.ts:50-51` |
| `requireImportWrite` → `WRITE_ROLES = ['AR Clerk','AR Supervisor','Finance Manager']` | `imports/service.ts:47-48, 143-147` |
| `requireImportRead` → `READ_ROLES = [...WRITE_ROLES, 'Auditor']` | `imports/service.ts:47, 137-141` |
| `getWritableBatch` enforces company scope, AR-Clerk-owns-own-batch, not-Cancelled | `imports/service.ts:712-722` |
| Role hierarchy: Finance Manager 1, AR Supervisor 2, AR Clerk 3, System Admin 4 (config-only), Auditor 5 (read-only) | `_shared/constants.ts:18-22`; `requireRole` `_shared/auth.ts:102-129` |
| `requireCustomerAccess` (AR Clerk → assigned customers only) and `getCustomerAccessFilter` | `_shared/auth.ts:161-216` |
| `ImportRowStatus = 'Pending' \| 'Valid' \| 'Error' \| 'Skipped' \| 'Created' \| 'Posted' \| 'Allocated' \| 'Unmatched'` | `imports/service.ts:67` |
| `ImportRow` model: `{ id, batch_id, row_number, raw_data, mapped_data, status, validation_errors, invoice_id, receipt_id }` | `imports/service.ts:83-93` |
| `validateRow` → `validateReceiptRow` / `validateInvoiceRow`, returns `{ mappedData, errors, status? }` | `imports/service.ts:724-727` |
| `validateBatch` re-validates every row from `raw_data` and rewrites `status`/`mapped_data` | `imports/service.ts:399-463` |
| Batch 6A suggestion writers: `customerSuggestionDiagnostics`, `invoiceReferenceSuggestionDiagnostics`, `invoiceSuggestionMappedData`, `isAllocatableInvoice` | `imports/service.ts:1093-1340` |
| Batch 5-Fix-A allocation preflight: `preflightReceiptImportAllocation`, `importAllocationPreflightStatus` | `imports/service.ts:1436-` |
| Customer suggestion query already excludes hidden/deleted & out-of-scope | `customers/service.ts:findVisibleCustomerSuggestions` |

> [!NOTE]
> The existing import model validates rows **from `raw_data`**, not from `mapped_data`. Re-validation in Batch 6B must respect this: approve/edit must update the canonical `raw_data` fields `validateRow` actually reads (resolved in §3.A/§3.C/§3.D and §11 decision 1).

---

## 2. Route definition

| Property | Value |
|----------|-------|
| **Path** | `POST /imports/:batchId/rows/:rowId/review` |
| **Method** | `POST` |
| **Edge Function** | existing `imports` function (no new function) |
| **Auth** | `getAuthContext` + `extractCompanyId` (already global in `index.ts`) |

### 2.1 Routing change (`imports/index.ts`)

`matchRoute` currently captures only a single UUID. The review route needs **two** captures (`batchId`, `rowId`). Plan:

- Add a `review` entry to `ROUTES` with two UUID groups:
  ```
  review: new RegExp(`^\\/${UUID}\\/rows\\/${UUID}\\/review\\/?$`, 'i')
  ```
- Extend `matchRoute` so that when the matched route has two groups it returns `{ batchId: match[1], rowId: match[2] }` (keep the existing single-`id` behavior for all current routes — e.g. return both `id` and the named params, or special-case `review`). This is the **only** change to `matchRoute`.
- Add a handler block: `if (route === 'review' && req.method === 'POST') { ... validateUUID(batchId); validateUUID(rowId); parse JSON body; const result = await service.reviewRow(auth, batchId, rowId, body); return jsonResponse(successResponse(result)); }`.

> [!CAUTION]
> The `review` pattern must be registered **before** `single`/`rows` in iteration so the more specific path wins. Verify ordering, since `ROUTES` is matched in insertion order by `Object.entries`.

### 2.2 Request payload

```jsonc
{
  "action": "approve_suggestion | reject_suggestion | edit_customer | edit_invoice_reference | retry_validation",

  // approve_suggestion (one of, depending on row's review_kind):
  "suggested_customer_id": "<uuid, must be present in mapped_data candidates>",
  "suggested_invoice_id":  "<uuid, must be present in mapped_data candidates>",

  // edit_customer (any one; the backend translates all of them to canonical raw_data.customer_code):
  "customer_id":   "<uuid>",          // existing customer — backend RESOLVES to customer.customer_id (see §3.C)
  "customer_code": "<string>",        // canonical import field the importer actually reads
  "customer_name": "<string>",        // optional corrected name (also written to raw_data.customer_name)

  // edit_invoice_reference:
  "invoice_reference": "<string>",

  // reject_suggestion / retry_validation: no extra fields required
  "review_note": "<optional string>"  // recorded only; no behavior (full remarks = Batch 6D)
}
```

> [!IMPORTANT]
> **`customer_id` is never written to `raw_data`.** The importer reads `customer_code`, `customer_name`, and `registration_no` — it does **not** read `raw_data.customer_id` (verified: `classifyImportCustomer` / `findVisibleCustomerByCode` / `findVisibleCustomerByNormalizedName`). When the payload supplies `customer_id`, the backend resolves it to a visible, in-scope customer and writes **`raw_data.customer_code = customer.customer_id`** (the human-facing code) plus optional `raw_data.customer_name`. See §3.C.

### 2.3 Response shape

```jsonc
{
  "success": true,
  "data": {
    "row": {
      "id": "...", "row_number": 7,
      "status": "Valid | Unmatched | Skipped | Error",   // existing enum only
      "mapped_data": { /* updated diagnostics incl. user_action, review_result */ },
      "validation_errors": null | [ ... ]
    },
    "action": "approve_suggestion",
    "review_result": "approved_pending_retry | rejected | edited_pending_retry | revalidated_valid | revalidation_failed | rejected_invalid_selection",
    "revalidated": true,
    "messages": [ "human-readable explanation" ]
  }
}
```

On authz/validation failure, the existing `errorResponse(error)` envelope is reused (`AuthorizationError` → 403, `ValidationError` → 400, `NotFoundError` → 404). No new error infrastructure.

### 2.4 Allowed actions

`approve_suggestion`, `reject_suggestion`, `edit_customer`, `edit_invoice_reference`, `retry_validation`. Any other value → `ValidationError('Unsupported review action')`.

---

## 3. Review action behavior

All actions share a common preamble in `service.reviewRow`:

1. `requireImportWrite(auth)` (rejects Auditor + System Admin; allows AR Clerk / AR Supervisor / Finance Manager).
2. `getWritableBatch(auth, batchId)` (company scope + AR-Clerk-owns-own-batch + not-Cancelled).
3. Fetch the row by `rowId`; assert `row.batch_id === batchId` else `NotFoundError`.
4. Reject if the row is already terminal (`Created`/`Posted`/`Allocated`) — a consumed row cannot be re-reviewed.

### A. `approve_suggestion`
Used when `mapped_data.review_required === true` and candidates exist.

- The approved `suggested_customer_id` / `suggested_invoice_id` **must exist** in the row's `mapped_data` candidate arrays (`suggested_customers`/`customer_candidates` or `suggested_invoices`/`invoice_candidates`). If not present → `rejected_invalid_selection` (no write).
- Re-validate the selected entity from **live data** per §4 (not from the stored candidate snapshot). On failure → `rejected_invalid_selection`, no write.
- **On pass, write the canonical correction into `raw_data` (this is what makes a later `retry_validation` succeed):**

  **Customer approval** (`suggested_customer_id`):
  - `raw_data.customer_code = selected.customer_code`
  - optionally `raw_data.customer_name = selected.customer_name`
  - record in `mapped_data`: `approved_customer_id`, `approved_customer_code`, `approved_customer_name`, `approved_at`, `approved_by` (= `auth.userId`), `user_action = 'approved'`, `review_result = 'approved_pending_retry'`.

  **Invoice approval** (`suggested_invoice_id`):
  - `raw_data.invoice_reference = selected.invoice_no`
  - record in `mapped_data`: `approved_invoice_id`, `approved_invoice_no`, `approved_at`, `approved_by`, `user_action = 'approved'`, `review_result = 'approved_pending_retry'`.

- **Status is NOT changed to `Valid` here.** Approval records intent and corrects `raw_data` only; the row stays at its current `Unmatched`/`Skipped` status until the **separate** `retry_validation` action re-derives it (§3.E, §5). **No** create/post/allocate inside this action; **no** direct financial mutation.
- `mapped_data` stays evidence/diagnostics; `raw_data` is the canonical input `retry_validation` reads. The approval markers in `mapped_data` never substitute for the `raw_data.*` correction.

### B. `reject_suggestion`
- Write `mapped_data.user_action = 'rejected'`, `review_result = 'rejected'`, clear `approved_*` fields.
- Keep the row unresolved using existing statuses (`Unmatched`, or `Skipped` if it was Skipped).
- No financial mutation, no receipt/invoice creation.

### C. `edit_customer`
The importer reads **`customer_code`**, **`customer_name`**, and **`registration_no`** from `raw_data` — it does **not** read `raw_data.customer_id`. So the edit must translate whatever the payload supplies into those canonical fields:

- **If the payload supplies `customer_id`** (pick an existing customer): the backend **resolves** that id to a live customer and validates it before writing anything:
  - company scope (`customers.company_id === auth.companyId`),
  - role (`requireImportWrite`),
  - AR Clerk customer assignment (`requireCustomerAccess(auth, customer.id)`),
  - **not hidden** (`is_hidden === false`),
  - **not deleted** (`is_deleted === false`).
  - On pass, write **`raw_data.customer_code = customer.customer_id`** (the human-facing code) and optionally `raw_data.customer_name = customer.customer_name`. **Do not** write or rely on `raw_data.customer_id`.
- **If the payload supplies `customer_code`** (and/or `customer_name`): write them directly into `raw_data.customer_code` / `raw_data.customer_name`. Re-validation's `classifyImportCustomer` will resolve/validate the code on the next `retry_validation`.
- **No frontend/direct Supabase write** — the edit flows only through `service.reviewRow`.
- **No blind auto-create** from an edited free-text name; a corrected name still passes through the existing `classifyImportCustomer` deterministic-match → suggestion → create path on the next validation (it does not bypass that logic).
- Record in `mapped_data`: `user_action = 'edited'`, `review_result = 'edited_pending_retry'`, the edited fields, `edited_by`, `edited_at`. **Status is NOT changed to `Valid`** — only `retry_validation` can do that (§3.E, §5).

### D. `edit_invoice_reference`
- Write the corrected value into **`raw_data.invoice_reference`** so the next `retry_validation` re-applies the Batch 6A rule via `invoiceReferenceSuggestionDiagnostics`:
  - **Exact raw `invoice_no`** match that is same-currency and allocatable → may become eligible for `Valid` on retry (the existing flow returns `null`).
  - **Normalized-only / fuzzy** match → remains a `review_required` suggestion; **not** auto-approved by the edit alone.
  - **Paid / no-outstanding / currency mismatch / not-open** → stays blocked (`Skipped`/`Unmatched` exactly as Batch 6A computes).
- Record in `mapped_data`: `user_action = 'edited'`, `review_result = 'edited_pending_retry'`, the edited reference, `edited_by`, `edited_at`. **Status is NOT changed to `Valid`** — only `retry_validation` re-derives it (§3.E, §5).

### E. `retry_validation` — the only action that may move a row to `Valid`
- Re-run the row through the **existing** `validateRow(auth, batch.import_type, row.raw_data)` path (the same code `validateBatch` uses), reading the now-corrected `raw_data`. **Do not** bypass the Batch 5-Fix-A preflight or any Batch 6A rule.
- Persist the returned `status`/`mappedData`/`errors` for **this row only** (same per-row update `validateBatch` performs), then refresh the batch counters via the dedicated helper in §4.1 — **never** by re-running the full `validateBatch` (which would overwrite unrelated rows' review decisions; see §4.1 CAUTION).
- Outcome:
  - validation clean & `status` resolves to `Valid` → row becomes `Valid` (`revalidated_valid`); now eligible for the normal `execute` route.
  - validation produces `Unmatched`/`Skipped` → row stays in review (`revalidation_failed`) with refreshed diagnostics.
  - validation errors → row becomes `Error` with `validation_errors` (`revalidation_failed`).

> [!IMPORTANT]
> **Review decision and execution are strictly separate.** `approve_suggestion`, `reject_suggestion`, `edit_customer`, and `edit_invoice_reference` only record the decision and (for approve/edit) correct `raw_data`; **none of them marks the row `Valid` and none of them create/post/allocate.** `retry_validation` is the explicit, separate action that re-derives status and is the only review action that can produce `Valid`. Actual money movement still happens only later, via the existing `execute` route. This separation keeps review safe to smoke-test without triggering side effects.

---

## 4. Approved-selection consumption — re-validation is mandatory

> [!CAUTION]
> Stored `mapped_data` selections (candidate snapshots, `approved_customer_id`, `approved_invoice_id`) are **never blindly trusted**. Before any approval is honored — and again before the existing `execute`/preflight path consumes it — the backend MUST recompute all of the following from **live** data. Any failure → no create/post/allocate; record the failure and return the row to review.

| # | Re-validation check | Source of truth |
|---|---------------------|-----------------|
| 1 | `company_id` scope | `getWritableBatch` / `eq('company_id', auth.companyId)` |
| 2 | User role allowed to write review | `requireImportWrite` |
| 3 | AR Clerk customer assignment | `requireCustomerAccess(auth, customerId)` |
| 4 | Customer visible (not `is_hidden`) | live `customers` row |
| 5 | Customer not `is_deleted` | live `customers` row |
| 6 | Invoice belongs to the company | live `invoices.company_id === auth.companyId` |
| 7 | Invoice belongs to the row's customer context | `invoices.customer_id === resolved customer.id` |
| 8 | Invoice status allocatable (`Open`/`Overdue`/`Partially Paid`) | `isAllocatableInvoice` |
| 9 | Invoice currency matches the row currency | live `invoices.currency` vs row currency |
| 10 | Invoice `outstanding > 0` | live `invoices.outstanding` |
| 11 | `allocation_amount` / `discount_amount` rules | existing receipt validators |
| 12 | Batch 5-Fix-A preflight rules | `preflightReceiptImportAllocation` |

If a previously-approved selection now fails any check (e.g. the invoice was paid or the customer was hidden between review and execution), the approval is invalidated, no mutation occurs, and the row returns to `Unmatched`/`Skipped`/`Error` with refreshed diagnostics. **No stale trust.**

### 4.1 Batch counter refresh helper (do NOT re-run full `validateBatch`)

> [!CAUTION]
> A single review action changes **one** row. Re-running the full `validateBatch` to refresh batch totals would re-validate **every** row from `raw_data` and overwrite unrelated rows' review decisions (a previously-rejected or edited-but-not-yet-retried row would be reset). **Never** call `validateBatch` from a review action.

Plan a small, **read-only-then-aggregate** helper — e.g. `private async refreshBatchCounters(batchId): Promise<void>` — that, after `reviewRow` updates one row:

1. Reads the current `import_rows` for the batch (status column only).
2. Recomputes batch totals from those live statuses:
   - `valid_rows` = count(`Valid`)
   - `error_rows` = count(`Error`) + count(`Unmatched`) + count(`Skipped`) (mirrors the convention `validateBatch` already uses, where `Unmatched`/`Skipped` count toward `error_rows`)
   - `skipped_count` = count(`Skipped`)
   - `unmatched_count` = count(`Unmatched`)
   - `total_rows` = count(*) — only if the batch field needs reconciliation
3. Writes those aggregates to `import_batches` via the existing `updateBatch`.

This recomputes counters from the **actual current row statuses** without re-deriving any row's status, so other rows' review state is preserved. `retry_validation` (and any review action that changes a row's `status`) calls this helper once after its single-row update.

---

## 5. Status mapping (existing `import_rows.status` values only)

> [!IMPORTANT]
> No new status value is introduced. Allowed values remain `Pending | Valid | Error | Skipped | Created | Posted | Allocated | Unmatched`. Review state (`user_action`, `review_result`) is recorded in `mapped_data`, not as a status.

| Outcome | `status` | `raw_data` write | `mapped_data` markers |
|---------|----------|------------------|------------------------|
| Approved suggestion, pending retry | **unchanged** (`Unmatched`/`Skipped`) — never auto-`Valid` | `customer_code` (+opt. `customer_name`) **or** `invoice_reference` | `user_action='approved'`, `review_result='approved_pending_retry'`, `approved_customer_id`/`approved_customer_code`/`approved_customer_name` **or** `approved_invoice_id`/`approved_invoice_no`, `approved_by`, `approved_at` |
| Rejected suggestion | **unchanged** (`Unmatched`/`Skipped`) | none | `user_action='rejected'`, `review_result='rejected'`, `approved_*` cleared |
| Edited customer, pending retry | **unchanged** — never auto-`Valid` | `customer_code` (+opt. `customer_name`); `customer_id` resolved → code, never stored | `user_action='edited'`, `review_result='edited_pending_retry'`, `edited_by`, `edited_at` |
| Edited invoice_reference, pending retry | **unchanged** — never auto-`Valid` | `invoice_reference` | `user_action='edited'`, `review_result='edited_pending_retry'`, `edited_by`, `edited_at` |
| Retry validation success | `Valid` | none (reads corrected `raw_data`) | diagnostics cleared / `review_result='revalidated_valid'` |
| Retry validation failure | `Unmatched` / `Skipped` / `Error` (per `validateRow`) | none | refreshed diagnostics, `review_result='revalidation_failed'` |
| Invalid approval attempt (selection not in candidates, or fails §4 live re-validation) | **unchanged** (`Unmatched`/`Skipped`) — no `raw_data` write | none | `review_result='rejected_invalid_selection'`, reason recorded |

> [!NOTE]
> Only `retry_validation` produces `Valid`. Approve/reject/edit never change `status` to `Valid` and never create/post/allocate. After any review action that changes a row's `status`, call the §4.1 counter-refresh helper — not `validateBatch`.

---

## 6. Financial safety (preserved)

- ❌ No direct `allocation_details` insert.
- ❌ No direct `invoices.outstanding` update.
- ❌ No direct `receipts.allocated_amount` / `receipts.unallocated_amount` update.
- ❌ No financial RPC redesign; `post_receipt` / `allocate_receipt` untouched.
- ❌ No database migration / schema change (review state lives in `mapped_data`).
- ❌ `POST /allocations/auto` stays disabled (403).
- ❌ No fully automatic posting, no OCR, no backend idempotency.
- ✅ All money movement remains exclusively via the existing `execute`/RPC paths, reachable only after a row legitimately reaches `Valid`.

---

## 7. Files likely affected

| File | Change |
|------|--------|
| `backend/supabase/functions/imports/index.ts` | Add `review` route regex (two UUIDs); extend `matchRoute` to return `{ batchId, rowId }`; add `POST review` handler delegating to `service.reviewRow`. |
| `backend/supabase/functions/imports/service.ts` | Add `reviewRow(auth, batchId, rowId, payload)` + private helpers: `fetchReviewableRow`, `applyApprove`/`applyReject`/`applyEditCustomer`/`applyEditInvoiceRef` (each writes canonical `raw_data` + `mapped_data` markers), `revalidateRow`, `revalidateApprovedSelection`, and **`refreshBatchCounters(batchId)`** (§4.1 — counter aggregate, **not** full `validateBatch`). Reuse `getWritableBatch`, `validateRow`, `invoiceReferenceSuggestionDiagnostics`, `isAllocatableInvoice`, `preflightReceiptImportAllocation`, `requireCustomerAccess`, `updateBatch`, `listRowsInternal`. |
| `backend/supabase/functions/customers/service.ts` | A small read helper to resolve a single **visible** (non-hidden/non-deleted, in-scope) customer by `id` (for `customer_id` → `customer_code` translation in `edit_customer`/`approve_suggestion`) — only if no existing helper fits. |
| `_shared/types.ts` | Optional: a `ReviewAction` union + payload/response interfaces if shared typing is wanted. No status enum change. |

**No frontend file changes in Batch 6B** (the existing Batch 6A `ImportRow`/suggestion types already cover read display; Batch 6C will add the action UI).

---

## 8. Acceptance criteria

| # | Criterion |
|---|-----------|
| AC-1 | `approve_suggestion` writes the canonical correction into **`raw_data`** (`customer_code`(+name) or `invoice_reference`), records approval markers in `mapped_data`, and does **not** mutate any financial table. |
| AC-2 | `reject_suggestion` records rejection; row stays `Unmatched`/`Skipped`; no `raw_data` write; no creation/mutation. |
| AC-3 | `edit_customer` validates company scope, AR-Clerk access, and hidden/deleted exclusion; translates a supplied `customer_id` to `raw_data.customer_code` (never stores `raw_data.customer_id`). |
| AC-4 | `edit_invoice_reference` writes `raw_data.invoice_reference`; re-applies the exact-raw vs normalized/fuzzy rule and keeps paid/no-outstanding/currency-mismatch/not-open blocked. |
| AC-5 | **Approve/reject/edit never set `status=Valid` and never create/post/allocate**; only `retry_validation` can move a row to `Valid`. |
| AC-6 | `retry_validation` re-runs the existing `validateRow` path against the corrected `raw_data` (incl. Batch 5-Fix-A preflight) and moves the row only among existing statuses. |
| AC-7 | After a review action changes a row's status, batch counters are refreshed by the §4.1 helper — **not** by re-running full `validateBatch` (other rows' review decisions preserved). |
| AC-8 | Approving a hidden/deleted customer is rejected (`rejected_invalid_selection`); no `raw_data` write. |
| AC-9 | Approving a paid / no-outstanding / currency-mismatch invoice is rejected. |
| AC-10 | AR Clerk cannot approve/edit toward a customer they are not assigned to. |
| AC-11 | Auditor and System Admin receive 403 on the review route. |
| AC-12 | No frontend direct Supabase write is introduced; all changes flow through `service.reviewRow`. |
| AC-13 | Existing exact-match imports (`upload`→`parse`→`validate`→`execute`) still work unchanged. |
| AC-14 | Batch 6A read-only suggestion display still renders (no regression). |
| AC-15 | `POST /allocations/auto` still returns 403. |
| AC-16 | No new `import_rows.status` value and no migration are introduced. |
| AC-17 | A stale approval that fails §4 re-validation at execute time produces no mutation and returns the row to review. |

---

## 9. Testing plan (PowerShell / curl — no frontend, Batch 6C not built)

Because Batch 6C UI does not exist yet, all tests hit the route directly. Use a captured bearer token + `X-Company-Id` header.

```powershell
$base    = "https://<project>.supabase.co/functions/v1/imports"
$headers = @{ Authorization = "Bearer $TOKEN"; "X-Company-Id" = $COMPANY_ID; "Content-Type" = "application/json" }
```

| # | Test | Request | Expected |
|---|------|---------|----------|
| T1 | Reject suggestion | `action=reject_suggestion` | 200; `review_result=rejected`; status unchanged; `mapped_data.user_action=rejected`; **`raw_data` unchanged** |
| T2 | Approve valid customer suggestion | `action=approve_suggestion`, `suggested_customer_id=<candidate>` | 200; `approved_pending_retry`; status **still** `Unmatched`/`Skipped` (not `Valid`); **`raw_data.customer_code` == selected code**; `mapped_data.approved_customer_id/_code/_by/_at` set; no financial table touched |
| T2b | **Approve → retry round-trip** | T2, then `action=retry_validation` | `revalidated_valid`; status `Valid`; eligible for `execute` (proves `raw_data` correction took effect) |
| T3 | Approve invoice suggestion | `action=approve_suggestion`, `suggested_invoice_id=<candidate>` | `approved_pending_retry`; **`raw_data.invoice_reference` == selected `invoice_no`**; status not `Valid` |
| T4 | Approve hidden/deleted customer | `suggested_customer_id=<hidden>` | 4xx / `rejected_invalid_selection`; **no `raw_data` write**; no approval markers |
| T5 | Approve invoice w/ outstanding=0 | `suggested_invoice_id=<paid>` | rejected (no-outstanding); no `raw_data` write |
| T6 | Approve invoice currency mismatch | `suggested_invoice_id=<SGD vs MYR>` | rejected (currency mismatch); no `raw_data` write |
| T7 | Edit customer by `customer_id` | `action=edit_customer`, `customer_id=<visible in-scope>` | 200; **`raw_data.customer_code` == customer.customer_id**; **`raw_data.customer_id` absent/unused**; status not `Valid` |
| T8 | Edit invoice_reference → exact raw valid | `action=edit_invoice_reference`, `invoice_reference=<exact>`, then `retry_validation` | T8b → `revalidated_valid`; `Valid` |
| T9 | Edit invoice_reference → normalized-only | normalized variant, then retry | stays `Unmatched`/review_required (not auto-approved) |
| T10 | Edit customer to inaccessible (AR Clerk) | `action=edit_customer` toward unassigned customer, AR Clerk token | 403; no `raw_data` write |
| T11 | Retry validation pass | `action=retry_validation` on a now-fixed row | `Valid`; eligible for `execute` |
| T12 | Retry validation fail | `action=retry_validation` on still-broken row | `Unmatched`/`Skipped`/`Error` w/ diagnostics |
| T13 | **Counter preservation** | In a multi-row batch: reject row A, then `retry_validation` on row B | Row A stays `rejected`/`Unmatched` (decision **not** reset); batch counters (`valid/error/skipped/unmatched`) consistent with live row statuses (proves §4.1 helper, not full `validateBatch`) |
| T14 | Auditor token | any write action | 403 |
| T15 | System Admin token | any write action | 403 |
| T16 | Wrong-company batch/row | valid action, mismatched `X-Company-Id` | 404 (company scope) |
| T17 | Row in another batch | `rowId` not in `batchId` | 404 |
| T18 | `allocate auto` still off | `POST /allocations/auto` | 403 (regression guard) |
| T19 | Stale approval at execute | approve, then externally pay the invoice, then `execute` | no mutation; row returns to review (AC-17) |

---

## 10. Sub-batch boundary

| Sub-batch | Scope | This plan |
|-----------|-------|-----------|
| 6A | Suggestion diagnostics + read-only display | ✅ Done (`389cded`) |
| **6B** | **Backend review-resolution API (this plan)** | 🟡 Planned |
| 6C | Frontend approve/reject/edit/retry UI wired to 6B | Future |
| 6D | Optional reviewer remarks / audit note | Future |

---

## 11. Codex review — resolved decisions (round 1)

1. **Edit/approve target — write canonical `raw_data`.** ✅ Resolved. `validateRow` reads `raw_data`, so approve/edit must write the canonical import fields there: `raw_data.customer_code` (+optional `customer_name`) for customer, `raw_data.invoice_reference` for invoice. `mapped_data` holds approval markers/diagnostics only and never substitutes for the `raw_data` correction. (§2.2, §3.A, §3.C, §3.D, top CAUTION.)
2. **`customer_id` is translated, never stored.** ✅ Resolved. The importer reads `customer_code`/`customer_name`/`registration_no`, not `customer_id`. A supplied `customer_id` is resolved to a live, visible, in-scope customer and written as `raw_data.customer_code = customer.customer_id`. (§2.2 IMPORTANT, §3.C.)
3. **Approval and retry are separate.** ✅ Resolved. Approve/reject/edit only record the decision (+correct `raw_data`); none sets `Valid` or creates/posts/allocates. `retry_validation` is the explicit, separate action that may move a row to `Valid`. (§3.A/E IMPORTANT, §5.)
4. **Counter refresh helper, not full `validateBatch`.** ✅ Resolved. A `refreshBatchCounters(batchId)` helper recomputes batch totals from the **current** row statuses without re-deriving any row, preserving other rows' review decisions. (§4.1.)
5. **`matchRoute` two-param return.** Confirmed approach: register the `review` regex (two UUID groups) before `single`/`rows`; return `{ batchId, rowId }` for the `review` route while preserving the existing single-`id` shape for current routes. (§2.1.)

---

## 12. Hard prohibitions (restated)

- Do **not** add frontend approve/reject/edit buttons (that is Batch 6C).
- Do **not** implement automatic allocation or enable `POST /allocations/auto`.
- Do **not** implement OCR/PDF/image import.
- Do **not** implement fully automatic posting.
- Do **not** implement backend idempotency.
- Do **not** create migrations or change the `import_rows.status` enum.
- Do **not** mutate `allocation_details`, `invoices.outstanding`, or receipt balance columns directly.
- Do **not** redesign or alter `post_receipt` / `allocate_receipt` RPCs.

---

*Plan authored: 2026-06-14 · Documentation only · Author: Claude (GenAI-assisted development)*
*Updated 2026-06-14 (Codex round 1 — Approved with changes): canonical `raw_data` writes for approve/edit; `customer_id`→`customer_code` translation; explicit approve/retry separation; `refreshBatchCounters` helper instead of full `validateBatch`; payload/status/smoke-test/AC updates; all Batch 6B scope prohibitions preserved.*
