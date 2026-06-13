# Batch 6B — Backend Review-Resolution API Plan

**Status**: 🟡 Plan — documentation only (no code, no migration, no deploy)
**Date**: 2026-06-14
**Depends on**: Batch 6A (commit `389cded` — fuzzy suggestion diagnostics + read-only display)
**Scope**: Backend-only. Adds one review-resolution route to the existing `imports` Edge Function so a human reviewer's decision on a `review_required` row can be recorded and safely re-validated server-side. **No frontend buttons (Batch 6C), no automatic allocation, no OCR, no fully automatic posting, no backend idempotency.**

> [!IMPORTANT]
> Batch 6B records and re-validates a reviewer's decision; it does **not** create, post, or allocate. Execution still happens only through the existing `execute` route (`executeDraftCreation`) after a row legitimately returns to `Valid` via re-validation. Approval is never blindly trusted — every selection is recomputed from live data at consumption time (§4, §6.3).

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
> The existing import model validates rows **from `raw_data`**, not from `mapped_data`. Re-validation in Batch 6B must respect this: an edit must update the data that `validateRow` actually reads (see §3.C/§3.D and the Open Question in §11).

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

  // edit_customer (model-dependent — see §3.C / §11):
  "customer_id":   "<uuid>",          // pick an existing customer, OR
  "customer_code": "<string>",        // resolve by code, OR
  "customer_name": "<string>",        // corrected name for re-classification

  // edit_invoice_reference:
  "invoice_reference": "<string>",

  // reject_suggestion / retry_validation: no extra fields required
  "review_note": "<optional string>"  // recorded only; no behavior (full remarks = Batch 6D)
}
```

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

- The approved `suggested_customer_id` / `suggested_invoice_id` **must exist** in the row's `mapped_data` candidate arrays (`suggested_customers`/`customer_candidates` or `suggested_invoices`/`invoice_candidates`). If not present → `rejected_invalid_selection` (no write to the selection).
- Re-validate the selected entity from **live data** per §4 (not from the stored candidate snapshot).
- On pass: write `mapped_data.user_action = 'approved'`, `review_result = 'approved_pending_retry'`, record `approved_customer_id` / `approved_invoice_id`, and set status per §5 (**pending retry**, not executed). **Do not** create/post/allocate inside this action.
- No direct financial mutation. (Whether a successful approval may immediately re-run validation in the same call is an Open Question — §11 — defaulting to "approval records intent; a separate `retry_validation`/`execute` step performs the move".)

### B. `reject_suggestion`
- Write `mapped_data.user_action = 'rejected'`, `review_result = 'rejected'`, clear `approved_*` fields.
- Keep the row unresolved using existing statuses (`Unmatched`, or `Skipped` if it was Skipped).
- No financial mutation, no receipt/invoice creation.

### C. `edit_customer`
- Record the corrected customer reference. Because `validateRow` reads `raw_data`, the edit must write the corrected `customer_code` / `customer_id` / `customer_name` into the row's `raw_data` (the field set the importer maps) so a subsequent re-validation re-runs `classifyImportCustomer` against the correction. (Exact field mapping = Open Question §11.)
- Server validates: company scope, `requireCustomerAccess` for AR Clerk, **hidden/deleted exclusion** (reject if the chosen customer is `is_hidden` or `is_deleted`).
- No frontend/direct Supabase write — the edit flows only through this service method.
- No blind auto-create from an edited free-text name; a corrected name still passes through the existing `classifyImportCustomer` deterministic-match → suggestion → create path on the next validation (it does not bypass that logic).
- Set status per §5 (`edited_pending_retry`).

### D. `edit_invoice_reference`
- Record the corrected `invoice_reference` into `raw_data` so re-validation re-applies the Batch 6A rule via `invoiceReferenceSuggestionDiagnostics`:
  - **Exact raw `invoice_no`** match that is same-currency and allocatable → may become eligible for later retry (the existing flow returns `null` and the row can reach `Valid`).
  - **Normalized-only / fuzzy** match → remains a `review_required` suggestion; **not** auto-approved by the edit alone.
  - **Paid / no-outstanding / currency mismatch / not-open** → stays blocked (`Skipped`/`Unmatched` exactly as Batch 6A computes).
- Set status per §5 (`edited_pending_retry`).

### E. `retry_validation`
- Re-run the row through the **existing** `validateRow(auth, batch.import_type, row.raw_data)` path (the same code `validateBatch` uses). **Do not** bypass the Batch 5-Fix-A preflight or any Batch 6A rule.
- Persist the returned `status`/`mappedData`/`errors` exactly as `validateBatch` does for a single row, and recompute the batch's `valid/error/unmatched/skipped` counters for that row's delta (or call the existing per-row update + a counter refresh).
- Outcome:
  - validation clean & `status` resolves to `Valid` → row becomes `Valid` (`revalidated_valid`); it is now eligible for the normal `execute` route.
  - validation produces `Unmatched`/`Skipped` → row stays in review (`revalidation_failed`) with refreshed diagnostics.
  - validation errors → row becomes `Error` with `validation_errors` (`revalidation_failed`).

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

---

## 5. Status mapping (existing `import_rows.status` values only)

> [!IMPORTANT]
> No new status value is introduced. Allowed values remain `Pending | Valid | Error | Skipped | Created | Posted | Allocated | Unmatched`. Review state (`user_action`, `review_result`) is recorded in `mapped_data`, not as a status.

| Outcome | `status` | `mapped_data` markers |
|---------|----------|------------------------|
| Approved suggestion, pending retry | unchanged (`Unmatched`/`Skipped`) until retry; becomes `Valid` only after `retry_validation` passes | `user_action='approved'`, `review_result='approved_pending_retry'`, `approved_customer_id`/`approved_invoice_id` |
| Rejected suggestion | unchanged (`Unmatched`, or `Skipped`) | `user_action='rejected'`, `review_result='rejected'` |
| Edited customer, pending retry | unchanged until retry | `user_action='edited'`, `review_result='edited_pending_retry'` |
| Edited invoice_reference, pending retry | unchanged until retry | `user_action='edited'`, `review_result='edited_pending_retry'` |
| Retry validation success | `Valid` | diagnostics cleared / `review_result='revalidated_valid'` |
| Retry validation failure | `Unmatched` / `Skipped` / `Error` (per `validateRow`) | refreshed diagnostics, `review_result='revalidation_failed'` |
| Invalid approval attempt (selection not in candidates, or fails §4) | unchanged (`Unmatched`/`Skipped`) | `review_result='rejected_invalid_selection'`, reason recorded |

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
| `backend/supabase/functions/imports/service.ts` | Add `reviewRow(auth, batchId, rowId, payload)` + private helpers (`fetchReviewableRow`, `applyApprove/Reject/EditCustomer/EditInvoiceRef`, `revalidateRow`, `revalidateApprovedSelection`). Reuse `getWritableBatch`, `validateRow`, `invoiceReferenceSuggestionDiagnostics`, `isAllocatableInvoice`, `preflightReceiptImportAllocation`, `requireCustomerAccess`. |
| `backend/supabase/functions/customers/service.ts` | Possibly a small read helper to load a single visible (non-hidden/non-deleted, in-scope) customer by id/code for edit/approve validation — only if no existing helper fits. |
| `_shared/types.ts` | Optional: a `ReviewAction` union + payload/response interfaces if shared typing is wanted. No status enum change. |

**No frontend file changes in Batch 6B** (the existing Batch 6A `ImportRow`/suggestion types already cover read display; Batch 6C will add the action UI).

---

## 8. Acceptance criteria

| # | Criterion |
|---|-----------|
| AC-1 | `approve_suggestion` records server-side approval in `mapped_data` and does **not** mutate any financial table. |
| AC-2 | `reject_suggestion` records rejection; row stays `Unmatched`/`Skipped`; no creation/mutation. |
| AC-3 | `edit_customer` validates company scope, AR-Clerk access, and hidden/deleted exclusion before recording the correction. |
| AC-4 | `edit_invoice_reference` re-applies the exact-raw vs normalized/fuzzy rule and keeps paid/no-outstanding/currency-mismatch/not-open blocked. |
| AC-5 | `retry_validation` re-runs the existing `validateRow` path (incl. Batch 5-Fix-A preflight) and moves the row only among existing statuses. |
| AC-6 | Approving a hidden/deleted customer is rejected (`rejected_invalid_selection`). |
| AC-7 | Approving a paid / no-outstanding / currency-mismatch invoice is rejected. |
| AC-8 | AR Clerk cannot approve/edit toward a customer they are not assigned to. |
| AC-9 | Auditor and System Admin receive 403 on the review route. |
| AC-10 | No frontend direct Supabase write is introduced; all changes flow through `service.reviewRow`. |
| AC-11 | Existing exact-match imports (`upload`→`parse`→`validate`→`execute`) still work unchanged. |
| AC-12 | Batch 6A read-only suggestion display still renders (no regression). |
| AC-13 | `POST /allocations/auto` still returns 403. |
| AC-14 | No new `import_rows.status` value and no migration are introduced. |
| AC-15 | A stale approval that fails §4 re-validation at execute time produces no mutation and returns the row to review. |

---

## 9. Testing plan (PowerShell / curl — no frontend, Batch 6C not built)

Because Batch 6C UI does not exist yet, all tests hit the route directly. Use a captured bearer token + `X-Company-Id` header.

```powershell
$base    = "https://<project>.supabase.co/functions/v1/imports"
$headers = @{ Authorization = "Bearer $TOKEN"; "X-Company-Id" = $COMPANY_ID; "Content-Type" = "application/json" }
```

| # | Test | Request | Expected |
|---|------|---------|----------|
| T1 | Reject suggestion | `action=reject_suggestion` | 200; `review_result=rejected`; status unchanged; `mapped_data.user_action=rejected` |
| T2 | Approve valid customer suggestion | `action=approve_suggestion`, `suggested_customer_id=<candidate>` | 200; `approved_pending_retry`; no financial table touched |
| T3 | Approve hidden/deleted customer | `suggested_customer_id=<hidden>` | 4xx / `rejected_invalid_selection`; no approval written |
| T4 | Approve invoice w/ outstanding=0 | `suggested_invoice_id=<paid>` | rejected (no-outstanding) |
| T5 | Approve invoice currency mismatch | `suggested_invoice_id=<SGD vs MYR>` | rejected (currency mismatch) |
| T6 | Edit invoice_reference → exact raw valid | `action=edit_invoice_reference`, `invoice_reference=<exact>` then `retry_validation` | T6b → `revalidated_valid` |
| T7 | Edit invoice_reference → normalized-only | normalized variant then retry | stays `Unmatched`/review_required (not auto-approved) |
| T8 | Edit customer to inaccessible (AR Clerk) | `action=edit_customer` toward unassigned customer, AR Clerk token | 403 |
| T9 | Retry validation pass | `action=retry_validation` on a now-fixed row | `Valid`; eligible for `execute` |
| T10 | Retry validation fail | `action=retry_validation` on still-broken row | `Unmatched`/`Skipped`/`Error` w/ diagnostics |
| T11 | Auditor token | any write action | 403 |
| T12 | System Admin token | any write action | 403 |
| T13 | Wrong-company batch/row | valid action, mismatched `X-Company-Id` | 404 (company scope) |
| T14 | Row in another batch | `rowId` not in `batchId` | 404 |
| T15 | `allocate auto` still off | `POST /allocations/auto` | 403 (regression guard) |
| T16 | Stale approval at execute | approve, then externally pay the invoice, then `execute` | no mutation; row returns to review (AC-15) |

---

## 10. Sub-batch boundary

| Sub-batch | Scope | This plan |
|-----------|-------|-----------|
| 6A | Suggestion diagnostics + read-only display | ✅ Done (`389cded`) |
| **6B** | **Backend review-resolution API (this plan)** | 🟡 Planned |
| 6C | Frontend approve/reject/edit/retry UI wired to 6B | Future |
| 6D | Optional reviewer remarks / audit note | Future |

---

## 11. Open questions for Codex review

1. **Edit target — `raw_data` vs `mapped_data`.** Since `validateRow` reads `raw_data`, an edit (`edit_customer`/`edit_invoice_reference`) should write the correction into the row's `raw_data` fields the importer maps. Confirm the exact field keys the importer reads (e.g. `customer_code`, `customer_id`, `customer_name`, `invoice_reference`) so edits round-trip correctly through re-validation. Alternatively, define an explicit override layer — but that adds surface area; prefer reusing `raw_data`.
2. **Approve then auto-retry in the same call?** Default: approval only records intent (`approved_pending_retry`); a separate `retry_validation` (or `execute`) performs the actual move. Confirm whether a single round-trip (approve → immediate re-validate) is acceptable, given it still performs zero financial mutation.
3. **Batch counter refresh on single-row change.** `validateBatch` recomputes counters across all rows. For a single-row review, confirm whether to (a) recompute that row's delta against `valid/error/unmatched/skipped`, or (b) re-run the full `validateBatch` for simplicity. (b) is simpler and already verified; (a) is cheaper.
4. **`matchRoute` two-param return.** Confirm the preferred shape for returning `{ batchId, rowId }` without breaking the existing single-`id` consumers.

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
