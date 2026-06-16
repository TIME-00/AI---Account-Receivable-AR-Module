# Batch 6C — Frontend Review Queue Actions Plan

> **Status:** 🟡 Plan only — not yet implemented.
> **Type:** Documentation / implementation plan. **No code, no deploy.**
> **Depends on:** Batch 6A (read-only suggestion diagnostics) + Batch 6B (`POST /imports/:batchId/rows/:rowId/review`, commits `fa58d4a` + `1c89e0a`).
> **Scope:** Frontend UI + API hook integration **only**. The Batch 6B backend remains unchanged.

> [!CAUTION]
> **The frontend never mutates financial state.** Every review action calls the existing Batch 6B backend route and renders the backend's returned row. The frontend performs **no** direct Supabase writes, **no** allocation, **no** posting, and **no** financial-document creation. The backend remains the single source of truth; the UI only displays the backend result.

---

## 0. Goal

Batch 6A renders `review_required` rows read-only. Batch 6B added the backend review API. Batch 6C wires the **invoice import** and **receipt import** result pages to that API so a reviewer can approve / reject / edit a flagged row and then explicitly re-validate it — entirely through the existing backend route.

The user-facing contract mirrors the backend invariant (verified in Batch 6B):

> A correction (approve / edit) writes canonical `raw_data` server-side but **does not** make the row `Valid`. Only the explicit **Retry Validation** action re-runs validation and can flip the row to `Valid`. The UI must reflect this two-step model.

---

## 1. Existing Frontend Review Display (verified)

### 1.1 Import API hook — `frontend/src/hooks/use-import.ts`

| Aspect | Current state (verified) |
|--------|--------------------------|
| Hook | `useImport(importType: "invoice" \| "receipt")` built on `useApi()` |
| State | `step`, `batch: ImportBatch \| null`, `rows: ImportRow[]`, `isLoading: boolean` (single shared flag), `error: string \| null` |
| Actions | `uploadFile`, `parseBatch`, `validateBatch`, `executeBatch`, `refreshBatch`, `reset` |
| Response shape | `ImportBatchResponse = { batch: ImportBatch; rows: ImportRow[] }` for parse/validate/execute |
| Row shape | `ImportRow { id, batch_id, row_number, raw_data, mapped_data: Record<string,unknown> \| null, status, validation_errors, invoice_id, receipt_id, je_no, ... }` |
| Suggestion types | `ImportCustomerSuggestion { customer_id, customer_code, customer_name, confidence, reason }`; `ImportInvoiceSuggestion { invoice_id, invoice_no, confidence, reason, outstanding?, currency?, status?, allocatable? }` |
| Resolution type | `ImportCustomerResolution { action: "Matched Existing" \| "Create New" \| "Review Required"; customer_id; customer_code; customer_name; matched_by }` |
| **Gap** | **No** `reviewImportRow` action. **No** per-row/per-action loading state. `mapped_data` is untyped (`Record<string, unknown>`). |

`useApi()` exposes `post<T>(path, body?, opts?)`, `get<T>`, and `rawFetch`. Errors throw `ApiError { code: string; message: string; status: number; details?: Record<string,unknown> }`.

### 1.2 Invoice import page — `frontend/src/app/(dashboard)/invoices/import/page.tsx`

- Multi-step wizard (`Upload → Parse → Preview → Validate → Execute → Result`); `RowsTable` rendered at `validate`, `execute`, and `result` steps.
- `reviewRequired = row.mapped_data?.review_required === true` highlights the row amber.
- A local `SuggestionDiagnostics` component reads candidate arrays via `suggestionArray(mappedData, "suggested_customers", "customer_candidates")` and `(…, "suggested_invoices", "invoice_candidates")` and renders them **read-only**.

### 1.3 Receipt import page — `frontend/src/app/(dashboard)/receipts/import/page.tsx`

- Same wizard + `RowsTable`. Has a richer Allocation cell showing `allocation_status`, `invoice_no`, short-payment / discount / bank-charge diagnostics.
- Duplicates its own `SuggestionDiagnostics` (with a `compact` variant) and `suggestionArray` helper.
- `ROW_STATUS_COLORS` includes `Unmatched` (amber) and `Skipped` (gray).

> [!NOTE]
> `SuggestionDiagnostics` and `suggestionArray` are **duplicated** across both pages. Batch 6C should factor the new review controls into one shared component to avoid a third copy (see §6).

### 1.4 Backend contract consumed (Batch 6B, do not change)

`POST /imports/:batchId/rows/:rowId/review`, JSON body `{ action, ...payload, review_note? }`:

| `action` | Required payload | Server effect | `review_result` |
|----------|------------------|---------------|-----------------|
| `approve_suggestion` | `suggested_customer_id` and/or `suggested_invoice_id` (both only if `mapped_data.review_kind === 'both'`) | writes `raw_data.customer_code`/`customer_name` and/or `raw_data.invoice_reference`; status **unchanged** | `approved_pending_retry` |
| `reject_suggestion` | — | clears `approved_*` markers; status unchanged | `rejected` |
| `edit_customer` | one of `customer_id` \| `customer_code` \| `customer_name` | resolves visible in-scope customer; writes `raw_data.customer_code`(+`customer_name`); status unchanged | `edited_pending_retry` |
| `edit_invoice_reference` | `invoice_reference` | pre-checks allocatability; writes `raw_data.invoice_reference`; status unchanged | `edited_pending_retry` |
| `retry_validation` | — | re-validates from corrected `raw_data` | `revalidated_valid` / `revalidation_failed` |

Response: `ReviewRowResult { row: ImportRow; action; review_result; revalidated: boolean; messages: string[] }`. `mapped_data.review_kind` is one of `customer_suggestion`, `invoice_suggestion`, `both`.

---

## 2. UI Actions

### 2.1 Visibility rule

> [!IMPORTANT]
> Review controls render **only** when `row.mapped_data?.review_required === true`. Rows that are `Valid`, `Created`, `Posted`, `Allocated`, or plain `Error` (no suggestion) show **no** review controls — matching the backend, which rejects `approve_suggestion` unless `review_required === true` and blocks review of `Created`/`Posted`/`Allocated` rows.

### 2.2 Controls per `review_kind`

| `review_kind` | Buttons shown |
|---------------|---------------|
| `customer_suggestion` | **Approve customer** (per suggested customer) · **Edit customer** · **Reject** · **Retry validation** |
| `invoice_suggestion` | **Approve invoice** (per suggested invoice, disabled when `allocatable === false`) · **Edit invoice reference** · **Reject** · **Retry validation** |
| `both` | Approve customer + Approve invoice (may approve both) · Edit customer · Edit invoice reference · Reject · Retry validation |

- **Approve customer**: `POST … { action: "approve_suggestion", suggested_customer_id }`.
- **Approve invoice**: `POST … { action: "approve_suggestion", suggested_invoice_id }`. Disable the button when the suggestion's `allocatable === false` (backend will reject it anyway — disabling avoids a guaranteed error).
- **Reject**: `POST … { action: "reject_suggestion" }`.
- **Edit customer**: small inline form/popover capturing `customer_id` **or** `customer_code` **or** `customer_name` → `POST … { action: "edit_customer", … }`.
- **Edit invoice reference**: inline text input capturing `invoice_reference` → `POST … { action: "edit_invoice_reference", invoice_reference }`.
- **Retry validation**: `POST … { action: "retry_validation" }`.
- Optional `review_note` (≤500 chars) field may accompany any action.

### 2.3 Two-step model and the optional "Approve & Retry"

> [!IMPORTANT]
> Approve/edit alone never makes a row `Valid`. After a successful approve/edit, the UI shows an **"Approve & Retry"** affordance **only** as a convenience that fires the **same backend route twice in sequence** (`approve_suggestion`/`edit_*` → then `retry_validation`). It introduces **no** new endpoint and **no** client-side validation. If either call fails, the UI stops and shows the backend error; it does not fabricate a `Valid` state.

### 2.4 Hard prohibitions (UI level)

- No direct Supabase client calls from the page/hook — only `api.post` to the review route.
- No financial mutation, allocation, or posting triggered by approve/reject/edit/retry.
- No button that calls `POST /allocations/auto` (remains disabled / 403).
- No client-side "mark valid" — status comes only from the backend response row.

---

## 3. UX Behavior / User Flow

1. User uploads file → parse → validate (existing flow unchanged).
2. At the **Validate** (and **Result**) step, `review_required` rows render amber with the existing read-only diagnostics **plus** the new action controls (§2).
3. User clicks **Approve** / **Reject** / **Edit** on a specific row.
4. That row enters a **per-row loading state** (spinner on the acted control; other rows stay interactive).
5. On success, the hook **replaces that row** in `rows` from the response `ReviewRowResult.row` and shows `messages[]` via toast. Row status, `mapped_data.review_result`, and the amber highlight update accordingly.
   - After approve/edit, the row shows a clear "Approved/Edited — click **Retry Validation**" hint (`review_result` ends with `_pending_retry`).
6. User clicks **Retry Validation** → on `revalidated_valid` the row flips to `Valid` (green) and review controls disappear; on `revalidation_failed` the row stays in review with refreshed diagnostics/errors.
7. Only **after** a row is `Valid` can it be included in the **existing** create/post/allocate flow via the **existing** `executeBatch` button. Batch 6C adds no new execution path.

Batch counters (`valid_rows`/`error_rows`/…) come from the backend's `refreshBatchCounters`; the UI should refresh the batch summary after a `retry_validation` (see §5).

---

## 4. Safety Rules (UI must honor)

| Rule | How the UI honors it |
|------|----------------------|
| Approve/retry must not create/post/allocate | UI only calls the review route; never `execute`/allocation routes |
| Cannot approve hidden/deleted customer | Backend `resolveVisibleCustomer*` rejects; UI surfaces the 400/404 and keeps the row in review |
| Cannot approve paid / no-outstanding invoice | Suggestions with `allocatable === false` render the Approve button **disabled**; backend rejects otherwise |
| Cannot approve currency-mismatch as allocatable | Backend `resolveReviewInvoice` rejects `currency_mismatch`; UI surfaces the error |
| Backend is source of truth | UI renders only the returned `ReviewRowResult.row`; never infers status locally |
| No frontend financial mutation | No Supabase writes; no allocation/posting calls |

---

## 5. API Hook Design — `use-import.ts`

Add to `useImport`:

```ts
// Types
export interface ReviewRowPayload {
  action: "approve_suggestion" | "reject_suggestion"
        | "edit_customer" | "edit_invoice_reference" | "retry_validation";
  suggested_customer_id?: string;
  suggested_invoice_id?: string;
  customer_id?: string;
  customer_code?: string;
  customer_name?: string;
  invoice_reference?: string;
  review_note?: string;
}

export interface ReviewRowResult {
  row: ImportRow;
  action: ReviewRowPayload["action"];
  review_result:
    | "approved_pending_retry" | "rejected" | "edited_pending_retry"
    | "revalidated_valid" | "revalidation_failed" | "rejected_invalid_selection";
  revalidated: boolean;
  messages: string[];
}

// Per-row/action loading key, e.g. `${rowId}:${action}`
const [reviewLoading, setReviewLoading] = useState<Record<string, boolean>>({});
```

```ts
const reviewImportRow = useCallback(
  async (batchId: string, rowId: string, payload: ReviewRowPayload) => {
    const key = `${rowId}:${payload.action}`;
    setReviewLoading((m) => ({ ...m, [key]: true }));
    try {
      const result = await api.post<ReviewRowResult>(
        `/imports/${batchId}/rows/${rowId}/review`,
        payload,
      );
      // Replace the single row in local state from the backend response
      setRows((prev) => prev.map((r) => (r.id === result.row.id ? result.row : r)));
      // After retry, batch counters changed → refresh the batch summary
      if (payload.action === "retry_validation") await refreshBatch(batchId);
      if (result.messages?.length) toast.success("Review updated", { description: result.messages[0] });
      return result;
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Review action failed";
      toast.error("Review Failed", { description: msg });
      throw err;
    } finally {
      setReviewLoading((m) => ({ ...m, [key]: false }));
    }
  },
  [api, refreshBatch],
);
```

Design notes:
- **Local row replacement** (not a full refetch) keeps other rows' in-progress review state intact — mirrors the backend's `refreshBatchCounters` (which preserves sibling rows). A full `GET /imports/:id/rows` refetch is optional and only needed if pagination is added.
- **`refreshBatch`** after `retry_validation` re-reads `valid_rows`/`error_rows`/`skipped_count`/`unmatched_count` so the execute step's summary and the "Create N Draft" button count stay correct.
- **Error handling** maps `ApiError.status`: `400` (validation, e.g. invalid selection / not allocatable), `403` (Auditor/System Admin or out-of-scope), `404` (row/customer/invoice not found / not visible), `409` (if backend returns conflict). Show `err.message`; keep the row in review; never optimistically mark `Valid`.
- Expose `reviewImportRow` and `reviewLoading` from the hook return object.

> [!NOTE]
> `mapped_data` stays `Record<string, unknown>` to avoid coupling the hook to backend evidence fields, but a small typed reader (`getReviewMeta(row)` returning `{ review_required, review_kind, review_result, suggestions }`) is recommended in the shared component to centralize the casts currently duplicated in both pages.

---

## 6. Files Likely Affected

| File | Planned change |
|------|----------------|
| `frontend/src/hooks/use-import.ts` | Add `ReviewRowPayload` / `ReviewRowResult` types, `reviewImportRow`, `reviewLoading` state; export both |
| `frontend/src/app/(dashboard)/invoices/import/page.tsx` | Render review controls for `review_required` rows; wire to `reviewImportRow` |
| `frontend/src/app/(dashboard)/receipts/import/page.tsx` | Same wiring; keep existing allocation diagnostics |
| `frontend/src/components/import/review-actions.tsx` *(new, recommended)* | Shared `ReviewActions` component + `getReviewMeta` reader; replaces the duplicated `SuggestionDiagnostics`/`suggestionArray` logic so invoice + receipt pages share one implementation |

No backend, migration, or financial-RPC files are touched.

---

## 7. Acceptance Criteria

- **AC-1** Approve-customer button appears for `review_kind = customer_suggestion` rows (and `both`).
- **AC-2** Approve-invoice button appears for `review_kind = invoice_suggestion` rows (and `both`); disabled when `allocatable === false`.
- **AC-3** Reject works: row's `review_result` becomes `rejected`; `approved_*` markers cleared.
- **AC-4** Edit customer works (by `customer_id`, `customer_code`, or `customer_name`); `review_result` becomes `edited_pending_retry`.
- **AC-5** Edit invoice_reference works; `review_result` becomes `edited_pending_retry`.
- **AC-6** Retry validation works; on `revalidated_valid` the row status becomes `Valid` and controls disappear.
- **AC-7** Approve/edit alone never shows the row as `Valid` (status reflects backend `*_pending_retry`).
- **AC-8** No financial document (`invoice_id`/`receipt_id`) is created by approve/reject/edit/retry — those fields stay `null` until the existing execute flow runs.
- **AC-9** Existing exact-match import flow (upload→parse→validate→execute) still works unchanged.
- **AC-10** Existing Batch 6A read-only suggestion display still works for any row not yet acted on.
- **AC-11** Batch 6B backend remains unchanged (no edits under `backend/`).
- **AC-12** `POST /allocations/auto` remains disabled (no UI calls it).
- **AC-13** Per-row loading state: acting on one row does not block others; failures surface `ApiError.message` and leave the row in review.
- **AC-14** Auditor / System Admin receive `403` and see no successful review (button may be hidden or the error surfaced).

---

## 8. Testing Plan (manual production smoke from the UI)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| T1 | Customer suggestion approve + retry | Approve suggested customer → Retry | `approved_pending_retry` → `revalidated_valid`; row `Valid`; no invoice/receipt created |
| T2 | Invoice suggestion approve + retry | Approve suggested invoice → Retry | row `Valid`; `raw_data.invoice_reference` shows approved `invoice_no`; `receipt_id` stays null until execute |
| T3 | Fake invoice reject | Reject on a not-found suggestion | `review_result = rejected`; row stays `Unmatched`; no document created |
| T4 | Edit invoice_reference then retry | Enter a valid `invoice_no` → Retry | edit accepted; retry → `Valid` (or clear error if not allocatable) |
| T5 | Edit customer then retry | Enter valid `customer_code` → Retry | edit accepted; retry → `Valid` |
| T6 | Not-allocatable invoice | Try approve on suggestion with `allocatable === false` | button disabled; if forced, backend `400` surfaced, row stays in review |
| T7 | No financial mutation during review | Watch `invoice_id`/`receipt_id` across all review actions | both remain `null` until existing execute flow |
| T8 | Existing execute flow | After making rows `Valid`, run existing Create Draft / Auto-Post | works through existing `executeBatch` only; counts correct |
| T9 | Per-row loading | Trigger two rows' actions in quick succession | each row shows its own spinner; no cross-row blocking |
| T10 | Auto-allocation still disabled | Confirm no UI path posts to `/allocations/auto` | endpoint untouched / 403 |

---

## 9. Codex Pre-Implementation Safety Checklist

- [ ] Review controls render **only** when `mapped_data.review_required === true`.
- [ ] Every action calls **only** `POST /imports/:batchId/rows/:rowId/review` via `api.post`.
- [ ] No `@supabase/*` client import or direct table write in the page/hook.
- [ ] No call to allocation/post/execute endpoints from any review control.
- [ ] `POST /allocations/auto` is never called by the UI.
- [ ] Approve/edit do **not** locally set status to `Valid`; status comes only from the response row.
- [ ] Only `retry_validation` can transition a row to `Valid`, and only via the backend.
- [ ] Approve-invoice button disabled when `allocatable === false`.
- [ ] `ApiError` 400/403/404/409 surfaced; row remains in review on failure.
- [ ] Per-row loading state; no global lock that blocks other rows.
- [ ] No backend file, migration, or financial-RPC change in the diff.
- [ ] Local row replacement preserves other rows' in-progress review decisions.
- [ ] `refreshBatch` called after `retry_validation` so summary counts stay correct.
- [ ] No new `import_rows.status` values introduced or assumed.
- [ ] Existing Batch 6A read-only display and exact-match flow remain intact.

---

## 10. Out of Scope (explicit)

Backend changes · migrations · automatic allocation · enabling `POST /allocations/auto` · OCR/PDF/Image import · fully automatic posting · backend idempotency · direct `allocation_details` insert · direct `invoices.outstanding` update · direct `receipts.allocated_amount`/`unallocated_amount` update · any financial RPC change.
