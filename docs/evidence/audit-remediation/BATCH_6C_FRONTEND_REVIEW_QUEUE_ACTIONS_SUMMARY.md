# Batch 6C — Frontend Review Queue Actions & UX Simplification — Evidence Summary

**Project:** Using GenAI to develop an Accounts Receivable (AR) module — TSH Synergy AR
**Batch:** 6C (Frontend Review Queue Actions) + 6C UX Fix (auto-retry, auto-post default, 4-step wizard)
**Status:** Implemented, reviewed, committed/pushed, production smoke-tested
**Document type:** Evidence (documentation only — no code change, no deploy)
**Date:** 2026-06-18

Relevant commits:

| Commit | Subject |
| --- | --- |
| `57bf641` | Add frontend import review queue actions |
| `e3ff7b0` | Fix import review layout and auto-reject fake invoice references |
| `db843fa` | Simplify import review flow |

Backend reference (already evidenced separately): `fa58d4a` (Add import review resolution API), `1c89e0a` (Preserve import review metadata on retry validation) — documented in `BATCH_6B_REVIEW_RESOLUTION_API_SUMMARY.md`.

---

## 1. Purpose

Batch 6C delivers the **frontend** that lets a user resolve import rows the backend flags with `mapped_data.review_required === true`, by calling the existing Batch 6B review-resolution route. It also applies a focused UX simplification (auto-retry after approve/edit, Auto-Post default for receipts, and a 4-step import wizard) so the operator workflow is shorter and less error-prone.

The frontend is strictly a thin client over the backend route. It performs **no direct Supabase writes** and **no financial mutation**. The backend remains the single source of truth for review validation and for any transition to `Valid`.

---

## 2. Scope

**In scope (implemented):**

1. Review queue UI for `review_required` import rows on both Invoice Import and Receipt Import pages.
2. All five Batch 6B actions wired through one route: `approve_suggestion`, `reject_suggestion`, `edit_customer`, `edit_invoice_reference`, `retry_validation`.
3. Approve Customer / Approve Invoice automatically chain `retry_validation` after `approve_suggestion` succeeds.
4. Edit Customer / Edit Invoice Reference automatically chain `retry_validation` after save.
5. Reject does **not** auto-retry; manual Retry Validation remains available.
6. Rejected rows render a correction-only state (no normal approve/retry flow).
7. Receipt Import "Auto-Post & Allocate" defaults to ON (frontend default only).
8. Import wizard simplified from 6 visible steps to 4 (Upload File → Validate → Create Drafts → Result).
9. Documentation of the backend fake-invoice auto-reject classification (`invoice_not_found` + zero candidates), which the frontend honors.

**Out of scope (explicitly not done):** financial RPC changes, DB migrations, automatic allocation route, enabling `POST /allocations/auto`, OCR/PDF/Image import, fully automatic posting, direct `allocation_details` insert, direct `invoices.outstanding` update, direct `receipts.allocated_amount` / `receipts.unallocated_amount` update, frontend direct Supabase writes.

---

## 3. Files changed

| File | Role |
| --- | --- |
| `frontend/src/hooks/use-import.ts` | Review types, `reviewImportRow()`, per-row/action loading map, `uploadAndValidate()` orchestrator, 4-step `ImportStep`/`IMPORT_STEPS` |
| `frontend/src/components/features/imports/review-actions.tsx` | Shared `ReviewActions` component — all five actions, approve/edit auto-retry, rejected state, inline error display |
| `frontend/src/app/(dashboard)/invoices/import/page.tsx` | 4-step wizard, `uploadAndValidate` on file drop, `ReviewActions` in Errors cell |
| `frontend/src/app/(dashboard)/receipts/import/page.tsx` | Same wizard + `ReviewActions`, `autoPost` default ON |
| `backend/supabase/functions/imports/service.ts` | Fake-invoice auto-reject classification (`invoiceSuggestionMappedData`) — **referenced** here; committed in `e3ff7b0`. No backend change is made by this evidence document. |

---

## 4. Frontend review action flow

The review UI is rendered only when the backend still flags the row:

- `review-actions.tsx` returns `null` unless `getReviewMeta(row).reviewRequired === true` (i.e. `mapped_data.review_required === true`).
- Every action is sent through one hook function, `reviewImportRow(batchId, rowId, payload)` (`use-import.ts`), which `POST`s to:

  ```
  POST /imports/:batchId/rows/:rowId/review
  ```

- The hook replaces **only the acted row** from the backend response (`setRows(prev => prev.map(r => r.id === result.row.id ? result.row : r))`), so other rows' in-progress review decisions are preserved (mirrors the backend's `refreshBatchCounters`, which never re-derives sibling rows).
- After `retry_validation`, the hook calls `refreshBatch(batchId)` so the batch-level valid/error counters are not stale.
- Loading is tracked per row **and** per action via a map keyed `` `${rowId}:${action}` ``, so one busy action never disables unrelated rows; `anyLoading` for a row disables that row's controls while a call is in flight.

Action → payload mapping (frontend never sends a raw customer UUID into `raw_data`):

| Action | Payload sent | Notes |
| --- | --- | --- |
| Approve customer | `{ action: "approve_suggestion", suggested_customer_id }` | one id per click |
| Approve invoice | `{ action: "approve_suggestion", suggested_invoice_id }` | disabled when `allocatable === false` |
| Edit customer | `{ action: "edit_customer", customer_code? \| customer_name? }` | code preferred; backend translates to canonical `raw_data.customer_code` |
| Edit invoice ref | `{ action: "edit_invoice_reference", invoice_reference }` | |
| Reject | `{ action: "reject_suggestion" }` | |
| Retry | `{ action: "retry_validation" }` | only this can move a row to `Valid`, server-side |

For `review_kind === "both"`, approve buttons render per suggestion and each sends exactly one id (customer-first is presented above invoice).

**Safety invariant (verified in code):** approve/edit write canonical `raw_data` fields server-side but never mark a row `Valid`. Only `retry_validation` re-runs `validateRow` from `raw_data` and can produce `Valid`. Approve/edit/reject/retry never create, post, or allocate.

---

## 5. Auto-retry behavior

Implemented in `review-actions.tsx` via a single helper `run(payload, options?: { thenRetry?: boolean })`:

```ts
await reviewImportRow(batchId, row.id, payload);
if (options?.thenRetry) {
  await reviewImportRow(batchId, row.id, { action: "retry_validation" });
}
```

- **Approve customer**, **Approve invoice**, **Edit customer (Save)**, **Edit invoice reference (Save)** all pass `{ thenRetry: true }` — so after the primary action succeeds, an explicit second `retry_validation` call fires automatically. The user does not have to click Retry.
- Loading text reflects the chained call: approve buttons show **"Approving & validating…"**, edit-save buttons show **"Saving & validating…"**, with `isLoading` = primary action **or** `retry_validation`.
- **Reject** is intentionally **not** chained (no auto-retry).
- The manual **Retry Validation** button is always present in the non-rejected branch, for `approved_pending_retry` / `edited_pending_retry` rows or any case where the auto-chained retry threw.
- If `retry_validation` fails, the row stays reviewable/editable: the hook toasts the `ApiError`, and `ReviewActions` also surfaces it inline (`localError`) so the row keeps its context. The backend contract is unchanged — approve/edit still never mark `Valid` on their own; the auto-retry is purely a client-side convenience that issues the same Batch 6B call the user would otherwise click.

---

## 6. 4-step import wizard behavior

`ImportStep` and `IMPORT_STEPS` in `use-import.ts` now expose four user-visible steps:

```
1. Upload File   (key: "upload")
2. Validate      (key: "validate")
3. Create Drafts (key: "execute")
4. Result        (key: "result")
```

The previous Parse and Preview & Edit screens are no longer user-visible; the underlying backend parse/validate logic is unchanged and still runs — just internally:

- New orchestrator `uploadAndValidate(file)` runs `uploadFile → parseBatch → validateBatch` in one user action and lands on the **Validate** step (Validation Complete) regardless of outcome.
- `uploadFile` no longer advances the step; `parseBatch` is internal (no separate Preview screen, no separate parse toast); `validateBatch` sets `step = "validate"` and toasts the valid/error counts.
- On a parse/validate failure, `uploadAndValidate` catches and forces `setStep("validate")`, and the failing call has already set the shared `error` state, so the error banner shows on the Validate step (validation table still renders; no crash).
- Both pages call `uploadAndValidate(file)` from their file-drop handler; both render the stepper from `IMPORT_STEPS`, the Validate screen, the Create Drafts execution, and the Result screen. The Create Drafts execution path (`executeBatch`) is unchanged.

---

## 7. Auto-Post default behavior (Receipt Import)

In `frontend/src/app/(dashboard)/receipts/import/page.tsx`:

```ts
// Batch 6C UX Fix: Auto-Post & Allocate defaults ON for receipts (frontend default only)
const [autoPost, setAutoPost] = useState(true);
```

- The "Auto-Post & Allocate" checkbox is checked by default; the user can uncheck it before clicking the execute button.
- This is a **frontend default only**. Execution still goes through the existing `executeBatch(batch.id, { autoPost })` → `POST /imports/:batchId/execute` with `auto_post`, which uses the verified backend posting/allocation RPCs.
- The execute button label/loading text switches between draft-only ("Creating Draft Receipts…") and post+allocate ("Posting & Allocating…") based on `autoPost`.
- `POST /allocations/auto` is **not** called anywhere in this flow.

---

## 8. Fake invoice auto-reject behavior

Backend classification (committed in `e3ff7b0`, `imports/service.ts` → `invoiceSuggestionMappedData`): when an invoice reference resolves to **zero candidates** with reason `invoice_not_found`, the row is auto-rejected at validation time:

```ts
const autoRejected = candidates.length === 0 && reason === 'invoice_not_found';
// ...
user_action: autoRejected ? 'auto_rejected' : 'pending',
...(autoRejected ? {
  review_result: 'rejected',
  rejected_at: new Date().toISOString(),
  auto_rejected: true,
  auto_reject_reason: reason,
} : {}),
```

Frontend honoring of this state (`review-actions.tsx`): `isRejected = meta.reviewResult === "rejected"` drives the rejected branch, which:

- shows a "Suggestion rejected" badge,
- hides the normal approve/retry flow,
- offers correction via Edit only (edit the invoice reference / customer, then retry validation).

So a fabricated invoice reference with no real candidate never presents an approve button — it lands directly in the correction-only state.

---

## 9. Production smoke test results

All passed:

1. Invoice Import shows only 4 steps. ✅
2. Receipt Import shows only 4 steps. ✅
3. Upload file automatically parses and validates (lands on Validation Complete). ✅
4. Customer suggestion → Approve → auto Retry Validation → row becomes Valid. ✅
5. Invoice suggestion → Approve → auto Retry Validation → row becomes Valid. ✅
6. Edit customer → auto Retry Validation works. ✅
7. Edit invoice_reference → auto Retry Validation works. ✅
8. Fake invoice_reference is auto-rejected (no approve button shown). ✅
9. Rejected row does not show normal approve flow (correction-only). ✅
10. Receipt Import Auto-Post & Allocate is checked by default. ✅
11. Approve/edit/reject/retry actions do not create an invoice. ✅
12. Approve/edit/reject/retry actions do not create a receipt. ✅
13. Approve/edit/reject/retry actions do not post or allocate. ✅
14. Only the existing Create Draft / Create, Post & Allocate execution flow creates financial documents. ✅
15. `/allocations/auto` remains disabled / not used. ✅

---

## 10. Commands / checks

| Check | Result |
| --- | --- |
| `cd frontend && npm.cmd run build` | Passed — compiled successfully, lint + types passed, all routes generated |
| `deno check --allow-import imports/index.ts` | Passed |
| `deno check customers/index.ts` | Passed |
| `deno check receipts/index.ts` | Passed |
| `deno check allocations/index.ts` | Passed |
| `git diff --check` | Passed (CRLF warnings only) |
| Codex second review | Approved, no blocking issues |

---

## 11. Safety confirmations

- No financial RPC changes.
- No database migration.
- No automatic allocation route.
- `POST /allocations/auto` was not enabled.
- No OCR/PDF/Image import.
- No fully automatic posting.
- No direct `allocation_details` insert.
- No direct `invoices.outstanding` update.
- No direct `receipts.allocated_amount` / `receipts.unallocated_amount` update.
- No frontend direct Supabase writes (review actions call only the Batch 6B route; execution calls only the existing `/imports/:batchId/execute`).
- Backend remains the source of truth for review validation; approve/edit never mark a row `Valid` — only server-side `retry_validation` can.

---

## 12. Risks / follow-ups

- **Double round-trip on approve/edit:** auto-retry issues two sequential calls (action + `retry_validation`). This is intentional and keeps the backend contract unchanged; if latency becomes a concern, a future server-side "approve-and-revalidate" variant could collapse it into one call (not in scope here).
- **Partial-failure transparency:** if the chained `retry_validation` fails after a successful approve/edit, the row is left in `approved_pending_retry` / `edited_pending_retry` with the error surfaced; the user resolves via the still-present manual Retry. Acceptable, but worth a short operator note.
- **Auto-Post default ON (receipts):** lowers friction but increases the chance a user posts/allocates without intending to. Mitigated by the visible checkbox, the explicit button label change, and the on-screen "Draft by Default, Optional Auto-Post" guidance; behavior is unchanged server-side and still gated by verified RPCs.
- **Concurrent review on the same batch:** single-row replacement preserves sibling state for one client, but two simultaneous reviewers could see stale sibling rows until the next refresh. Out of scope for this batch.

---

## 13. Final status

**Complete.** Frontend review queue actions, approve/edit auto-retry, receipt Auto-Post default, and the 4-step import wizard are implemented, build-verified, Codex-reviewed, committed/pushed, and production smoke-tested. No backend behavior, financial RPC, migration, or allocation route was changed; the frontend remains a thin client over the existing Batch 6B review route and the existing execution endpoint, with the backend retained as the source of truth for validation.
