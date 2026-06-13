# Batch 6A — Fuzzy Matching Suggestion Diagnostics + Read-Only Display Summary

**Date**: 2026-06-14  
**Batch**: 6A (Conservative fuzzy-match suggestion diagnostics + read-only review display for customer/invoice import)  
**Status**: ✅ Implemented · ✅ `deno check` + `npm run build` verified · ✅ Local + Vercel production tested · ✅ Committed & pushed  
**Commit**: `389cded` — "Add fuzzy import suggestion diagnostics"  
**Plan Reference**: `docs/plans/batch-6-fuzzy-matching-review-queue-plan.md` (Batch 6A read-only slice of §6.1 suggestion generation + §5 read-only display)

---

## 1. Purpose

Batch 6A closes the customer/invoice **silent-mismatch gap** identified in the Batch 6 plan: previously a customer-name typo fell straight through `classifyImportCustomer` to **Create New** (creating a wrong duplicate customer), and an invoice reference that differed only by spacing/case/punctuation — or that did not exist at all — could not be surfaced for human attention.

Batch 6A adds a **conservative fuzzy scoring layer** that turns these near-misses into **suggestions** carried in `import_rows.mapped_data`, and renders them **read-only** in the import review UI. It is deliberately the *diagnostics-and-display* half of Batch 6:

- It **detects** and **records** suggested customer/invoice matches with a confidence score and reason code.
- It **never** auto-applies a suggestion, never auto-allocates, and exposes **no approve/reject/edit controls** and **no review-resolution API**. Those are Batch 6B (review API) and Batch 6C (interactive actions).

This keeps Batch 6A aligned with the plan's stated stance: *"Batch 6A is conservative — an exact raw match can proceed; normalized-only or fuzzy matches are suggestions only."*

---

## 2. Scope Completed

| # | Item | Status |
|---|------|--------|
| 1 | Conservative fuzzy helper + scoring constants (`_shared/fuzzy.ts`) | ✅ Done |
| 2 | Customer fuzzy suggestion diagnostics (`customers/service.ts`) | ✅ Done |
| 3 | `invoice_reference` suggestion diagnostics for receipt import (`imports/service.ts`) | ✅ Done |
| 4 | Exact **raw** `invoice_no` matches continue through the existing create/post/allocate flow | ✅ Done |
| 5 | Normalized-only `invoice_reference` → `Unmatched` + `review_required` suggestion | ✅ Done |
| 6 | Fake / non-existent `invoice_reference` → `Unmatched` + `review_required` + `invoice_not_found` | ✅ Done |
| 7 | Suggestion fields stored in `mapped_data` (no schema change) | ✅ Done |
| 8 | Invoice-import UI shows **read-only** customer suggestion diagnostics | ✅ Done |
| 9 | Receipt-import UI shows **read-only** invoice suggestion diagnostics | ✅ Done |
| 10 | **No** approve / reject / edit buttons added | ✅ Done (verified) |
| 11 | **No** review-resolution API added | ✅ Done (verified) |
| 12 | **No** automatic allocation added | ✅ Done (verified) |
| 13 | **No** financial RPC / database / schema changes | ✅ Done (verified) |

---

## 3. Files Changed

| File | Change | Lines |
|------|--------|-------|
| `backend/supabase/functions/_shared/fuzzy.ts` | **New** shared module: scoring constants, `normalizeForFuzzy`, `normalizeIdentifier`, `scoreFuzzyText`, `topFuzzyCandidates`, plus internal Jaccard / Levenshtein / prefix helpers | +131 |
| `backend/supabase/functions/customers/service.ts` | `classifyImportCustomer` adds a `'Review Required'` branch; new `findVisibleCustomerSuggestions` (company-scoped, visible-only, registration-no exact + fuzzy-name fallback); extended `ImportCustomerClassification` + new `ImportCustomerSuggestion` type | +89 / −5 |
| `backend/supabase/functions/imports/service.ts` | `Review Required` handling in invoice + receipt validation paths; new `invoiceReferenceSuggestionDiagnostics`, `customerSuggestionDiagnostics`, `invoiceCandidate`, `invoiceSuggestionMappedData`, `isAllocatableInvoice`; validate-phase `Unmatched`/`Skipped` counting; execute-time guard blocking `Review Required` from auto-creating a customer | +345 / −25 |
| `frontend/src/hooks/use-import.ts` | New `ImportCustomerSuggestion` / `ImportInvoiceSuggestion` types; `ImportCustomerResolution` extended with `Review Required` / `fuzzy_suggestion` | +23 / −2 |
| `frontend/src/app/(dashboard)/invoices/import/page.tsx` | Read-only `SuggestionDiagnostics` component; amber row highlight when `review_required` | +52 |
| `frontend/src/app/(dashboard)/receipts/import/page.tsx` | Read-only `SuggestionDiagnostics` component (with `compact` variant) for invoice suggestions; wired into the review/result cells | +59 |

**Total: 6 files, +674 / −25.** No migration, no RPC, no schema change, no new `import_rows.status` value.

---

## 4. Logic Implemented

### 4.1 Conservative scoring layer (`_shared/fuzzy.ts`)

Constants deliberately favour human review over aggressive auto-matching:

```ts
export const FUZZY_CUSTOMER_REVIEW_THRESHOLD = 0.72;
export const FUZZY_INVOICE_REVIEW_THRESHOLD  = 0.78;
export const FUZZY_CANDIDATE_LIMIT           = 3;
```

- `normalizeForFuzzy` — lower-cases, strips diacritics (NFKD), collapses non-alphanumerics to single spaces (token-friendly).
- `normalizeIdentifier` — same, but removes **all** separators (used for "differs only by spacing/case/punctuation" detection).
- `scoreFuzzyText` — returns `confidence` + `reason`:
  - identical normalized text → `1.0` / `normalized_exact`
  - identical compacted identifier → `0.96` / `punctuation_spacing_match`
  - otherwise the max of token-Jaccard, normalized-edit (Levenshtein), and a blended prefix score, tagged `token_similarity` / `prefix_similarity` / `edit_similarity`.
- `topFuzzyCandidates` — scores all candidates, keeps those `≥ threshold`, sorts by confidence (tie-break by label), caps at `FUZZY_CANDIDATE_LIMIT`.

### 4.2 Customer suggestion diagnostics (`customers/service.ts`)

`classifyImportCustomer` keeps its existing deterministic order — **exact code** → **exact normalized name** → … — but **before** falling through to `Create New` it now calls `findVisibleCustomerSuggestions`:

- Pulls candidate customers **scoped to `company_id`**, **`is_deleted = false`**, **`is_hidden = false`**, and (when the caller is access-restricted) limited to `getCustomerAccessFilter` allowed IDs — i.e. **hidden/deleted customers and out-of-scope customers are never suggested**.
- If the row carries a registration number that matches a visible customer's normalized registration number → returns that as a high-confidence (`0.98`, `registration_match`) suggestion.
- Otherwise runs `topFuzzyCandidates` on `customer_name` at the `0.72` threshold, filtering out anything whose normalized identifier equals the input (those would already have matched deterministically).
- When suggestions exist, returns `action: 'Review Required'`, `matchedBy: 'fuzzy_suggestion'`, the suggestion list, a `suggestionReason` (`multiple_customer_candidates` when >1), and the top `confidence`. With no suggestions it still returns `Create New` exactly as before.

### 4.3 Invoice reference suggestion diagnostics (`imports/service.ts`)

For receipt rows that resolved to a real customer and carry an `invoice_reference`, `invoiceReferenceSuggestionDiagnostics` inspects that customer's invoices (company + customer scoped) and applies the plan's **exact-raw vs normalized-only** rule:

1. **Exact raw `invoice_no` match**
   - currency matches **and** invoice is allocatable (`Open`/`Overdue`/`Partially Paid` and `outstanding > 0`) → returns `null`, meaning **the row continues through the existing create/post/allocate flow unchanged** (no review injected).
   - currency mismatch → `Unmatched`, reason `currency_mismatch`.
   - not allocatable → `Skipped`, reason `no_outstanding` or `invoice_not_open`.
2. **Normalized-only match** (`normalizeIdentifier` equal — differs only by spacing/case/punctuation) → **suggestion**, reason `normalized_invoice_no`, status `Unmatched` (or `Skipped` if the only normalized matches are non-allocatable). **Never auto-allocates.**
3. **Fuzzy match** among allocatable, same-currency invoices at the `0.78` threshold → `Unmatched` suggestion (`multiple_invoice_candidates` when >1).
4. **No match at all** → `Unmatched`, reason `invoice_not_found`.

`invoiceSuggestionMappedData` writes the suggestion fields and sets `allocation_status: 'Review Required'` (merging `review_kind` to `both` if a customer suggestion is also present).

### 4.4 `mapped_data` fields written (no schema change)

Customer (`customerSuggestionDiagnostics`): `review_required: true`, `review_kind: 'customer_suggestion'`, `confidence`, `suggestion_reason`, `match_confidence`, `match_reason_codes`, `suggested_customer_id/_code/_name`, `suggested_customers[]`, `customer_candidates[]`, `user_action: 'pending'`.

Invoice (`invoiceSuggestionMappedData`): `review_required: true`, `review_kind` (`invoice_suggestion` / `both`), `allocation_status: 'Review Required'`, `allocation_error`, `allocation_error_reason`, `confidence`, `suggestion_reason`, `match_confidence`, `match_reason_codes`, `suggested_invoice_id/_no`, `suggested_invoices[]`, `invoice_candidates[]`, `user_action: 'pending'`.

Each invoice candidate records `invoice_id`, `invoice_no`, `confidence`, `reason`, `outstanding`, `currency`, `status`, and a computed `allocatable` flag so the UI can grey out non-allocatable suggestions.

### 4.5 Status + counting behaviour

- Validate phase now honours a per-row `status` returned from validation: `Valid` rows count as valid; `Unmatched` / `Skipped` rows count as **error rows** and increment the new `unmatched_count` / `skipped_count` batch fields. **No new `import_rows.status` enum value was introduced** — only existing `Unmatched` / `Skipped` values are used.
- Execute phase: a `Review Required` customer classification **throws** `customer_suggestion_review_required` rather than silently creating a customer, so an unreviewed fuzzy customer row can never create/post/allocate.

### 4.6 Read-only display (frontend)

Both import pages render a `SuggestionDiagnostics` component that reads suggestion arrays from `row.mapped_data` and shows reason, confidence %, and the suggested customer/invoice candidate(s). Rows with `review_required` get an amber highlight. The receipt page additionally greys non-allocatable invoice candidates and shows outstanding/currency. **No buttons, inputs, mutations, or Supabase calls** are present in these components — display only.

---

## 5. Commands / Checks Run

| Check | Result |
|-------|--------|
| `deno check --allow-import imports/index.ts` | ✅ Passed |
| `deno check customers/index.ts` | ✅ Passed |
| `deno check receipts/index.ts` | ✅ Passed |
| `deno check allocations/index.ts` | ✅ Passed |
| `npm.cmd run build` (frontend) | ✅ Passed |
| `git diff --check` | ✅ Passed (Windows CRLF warnings only — not errors) |
| `git commit` | ✅ Committed as `389cded` |
| `git push` | ✅ Pushed |
| Vercel production deploy | ✅ Deployed |

---

## 6. Smoke Test Checklist and Results

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1 | **Exact raw** `invoice_reference` | Row stays `Valid`; existing create/post/allocate flow remains available | ✅ PASSED |
| 2 | **Normalized-only** `invoice_reference` (spacing/case/punctuation) | Row → `Unmatched` + `review_required`; suggested invoice, confidence, and `normalized_invoice_no` reason displayed; **not** counted valid; **no** create/post/allocate | ✅ PASSED |
| 3 | **Fake / non-existent** `invoice_reference` | Row → `Unmatched` + `review_required`; `invoice_not_found` diagnostic displayed; **not** counted valid; **no** create/post/allocate | ✅ PASSED |
| 4 | **Vercel production** run | Same results in production build | ✅ PASSED |

### 6.1 Production run figures (as reported)

- **Valid Rows:** 1
- **Error Rows:** 2
- **Total Rows:** 3
- "Create, Post & Allocate" counted **only 1** valid receipt — the two review-required rows were excluded from execution.

**All smoke tests passed (local + Vercel production).**

---

## 7. Safety Confirmations (verified against commit `389cded`)

| Guarantee | Confirmed |
|-----------|-----------|
| No approve / reject / edit UI | ✅ Display-only `SuggestionDiagnostics`; no buttons/inputs |
| No review-resolution API | ✅ No new route added in this batch |
| No automatic allocation from suggestions | ✅ Suggestions set `review_required`; rows excluded from execution |
| `POST /allocations/auto` remains disabled | ✅ Untouched (still 403) |
| No direct `allocation_details` insert | ✅ None |
| No direct `invoices.outstanding` update | ✅ None |
| No direct `receipts.allocated_amount` / `unallocated_amount` update | ✅ None |
| No financial RPC change | ✅ `allocate_receipt` / `post_receipt` untouched |
| No database migration / schema change | ✅ Diagnostics stored in `mapped_data` JSON |
| No new `import_rows.status` value | ✅ Only existing `Unmatched` / `Skipped` used |
| Hidden / deleted / out-of-scope customers not suggested | ✅ Query filters `is_hidden=false`, `is_deleted=false`, access filter |
| Company scope enforced | ✅ All suggestion queries `eq('company_id', …)` |
| Currency mismatch / non-allocatable not auto-allocated | ✅ Forced to `Unmatched` / `Skipped` suggestion |
| No OCR / PDF / image import | ✅ None |
| No fully automatic posting | ✅ None |

---

## 8. What Was Intentionally NOT Changed

- ❌ **No review-resolution API** — `POST /imports/:batchId/rows/:rowId/review` is **Batch 6B**.
- ❌ **No interactive review actions** — approve / reject / pick-different-customer / pick-different-invoice / edit are **Batch 6C**.
- ❌ **No backend idempotency** — remains future hardening (Batch 5-Fix-C).
- ❌ **No automatic allocation, posting, or customer creation** from a suggestion.
- ❌ **No migration / RPC / schema change.**

---

## 9. Relationship to Sibling / Future Batches

> [!IMPORTANT]
> Batch 6A delivers **conservative fuzzy-match suggestion diagnostics and read-only display only**.
>
> - **Batch 6A** (this) — suggestion generation + read-only display (✅ completed, commit `389cded`).
> - **Batch 6B** — review-resolution API (`POST /imports/:batchId/rows/:rowId/review`) with full execute-time re-validation (company / role / AR-Clerk / hidden / deleted / invoice context / currency / outstanding / preflight). Documented in the plan; not yet implemented.
> - **Batch 6C** — interactive review actions (approve / reject / pick alternate / edit) wired to the 6B API.
> - **Batch 6D** — optional reviewer remarks.
>
> Exact-raw matches continue through the existing verified flow; normalized-only and fuzzy matches stay **suggestions only** until a human resolves them via 6B/6C.

---

## 10. Risks and Follow-Up Items

| # | Item | Notes | Priority |
|---|------|-------|----------|
| 1 | Suggestions are advisory until 6B/6C | Until the review API ships, a reviewer can see the suggestion but must still correct the source row (or fix the underlying customer/invoice) before re-import | Expected |
| 2 | `mapped_data`-based selection must be re-validated at execute time | Plan §6.3 mandates recomputing all safety checks from live data when 6B consumes an approved selection — **no stale trust** | Future (6B) |
| 3 | Threshold tuning | `0.72` / `0.78` are conservative starting constants; revisit with real import data | Recommended |
| 4 | Automated regression tests | Suggestion classification + read-only rendering verified manually; consider unit tests for `scoreFuzzyText` / `invoiceReferenceSuggestionDiagnostics` in the testing batch | Recommended |

---

*Document created: 2026-06-14*  
*Batch 6A status: ✅ Implemented · ✅ checks verified · ✅ Local + Vercel production tested · ✅ Committed & pushed (`389cded`)*  
*Author: Claude (GenAI-assisted development)*
