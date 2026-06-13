# Batch 6 — Fuzzy Matching and Review Queue (Plan)

**Date**: 2026-06-13  
**Type**: Implementation plan / documentation only (no code changed in this document)  
**Depends on**: Batch 2C (visibility guards), Batch 3 (allocation hardening), Batch 4 (overpayment), Batch 5 (discount/bank charge), Batch 5-Fix-A (import preflight), Batch 5-Fix-B (submit lock)  
**Status**: 🟢 Codex-reviewed (round 2) — **Approved with changes** applied (exact-raw-vs-normalized-only invoice rule, execute-time re-validation of approved selections, read-only Batch 6A scope, full safety scope); ready for implementation approval

> [!IMPORTANT]
> This is a plan only. No backend code, frontend code, migration, or RPC is changed here. Implementation happens in later, separately-reviewed steps.

---

## 0. Goal & Guiding Principle

Improve import intelligence so that when **exact** matching fails (customer typos, missing registration numbers, invoice-reference spacing/dash differences, partial payment references), the system **suggests** the most likely customer/invoice and routes the row to **human review** — instead of either silently creating a wrong/duplicate customer or allocating to the wrong invoice.

> **Guiding principle: a fuzzy suggestion is never an automatic action.** Suggestion ≠ creation. Suggestion ≠ allocation. No financial mutation occurs until a human approves the corrected row, after which it flows through the **existing verified** create/post/allocate path (which still re-runs all Batch 5-Fix-A preflight checks).

---

## 1. Existing Capability Review (Verified Against Code)

### 1.1 Customer matching — invoice **and** receipt import

Both import types resolve customers through `CustomerService.classifyImportCustomer` (`backend/supabase/functions/customers/service.ts:216`). The algorithm is **exact-only**, visible-scoped:

1. **`customer_code` present** → `findVisibleCustomerByCode` (exact code, visible only). Not found → `ValidationError` → row `Error`.
2. **else `customer_name` present** → `findVisibleCustomerByNormalizedName` (exact **normalized** name match). Found → `Matched Existing` (`matchedBy: 'normalized_name'`).
3. **else (no exact name match)** → **`action: 'Create New'`** — a brand-new customer is created.
4. `registration_no` is used **only** for a consistency assertion (`assertImportCustomerDataConsistent`, `:943`), **not** as a primary matcher.

> [!WARNING]
> **Core gap:** step 3 means a **customer-name typo creates a new (wrong/duplicate) customer**, because the normalized-name lookup misses and the code falls through to `Create New`. This is the central problem Batch 6 must intercept.

Normalization helpers already exist: `normalizeCustomerName(...)` and `normalizeRegistrationNo(...)` (`customers/service.ts:1095`).

`matchedBy` is currently typed `'customer_code' | 'normalized_name' | null` (`:48`). The resolution outcome is surfaced to the row via `toCustomerResolutionDetails` (`imports/service.ts:966`) into `mapped_data.customer_resolution`.

### 1.2 Invoice-reference matching — receipt import

`resolveAllocationInvoice` (`imports/service.ts:1249`) matches on **exact `invoice_no`** equality, scoped by `company_id` + `customer_id`, then validates currency, status (`Open`/`Overdue`/`Partially Paid`), and `outstanding > 0`. Typed `reason`s: `invoice_not_found_for_customer`, `multiple_matches`, `currency_mismatch`, `invoice_not_open`, `no_outstanding`. **No fuzzy/normalized invoice matching exists.** A spacing/dash typo → `invoice_not_found_for_customer` → row `Unmatched` (Batch 5-Fix-A).

### 1.3 Unmatched / Skipped / review_required handling (current)

- `import_rows.status` enum values in use: `Valid`, `Error`, `Unmatched`, `Skipped`, `Created`, `Posted`, `Allocated`, `Pending`.
- Batch 4/5/5-Fix-A already write rich diagnostics into `mapped_data`: `review_required`, `auto_post_eligible`, `auto_post_block_reason`, `allocation_error_reason`, `allocation_suggestion`, `unapplied_amount`, `bank_charge_posting_required`, `bank_charge_review_reason`, etc.
- Blocking import rows are rejected **before** document creation (Batch 5-Fix-A preflight); non-blocking bank-charge diagnostics still create/post/allocate.

### 1.4 Import result UI (current)

`frontend/src/app/(dashboard)/receipts/import/page.tsx` already renders per-row diagnostics: status chips, `review_required` badge, `allocation_suggestion`, `unapplied_amount`, discount/short-payment/bank-charge lines, and `allocation_error` / `allocation_error_reason`. There is a `frontend/src/app/(dashboard)/invoices/import/page.tsx` for invoice imports. **Neither currently offers an interactive "accept this suggested match" control** — display is read-only diagnostics.

---

## 2. Fuzzy Matching Scope

Batch 6 introduces **suggestion-only** fuzzy matching. It changes the *no-exact-match* branches to produce a **review suggestion** instead of a blind action.

| Target | Input | Behavior |
|--------|-------|----------|
| **customer_name → existing visible customer** | `customer_name` with no exact normalized match | Generate ranked suggestions from **visible, in-scope, company** customers; route row to review **instead of `Create New`** when confidence is in the review band. |
| **registration_no → high-confidence match** | `registration_no` present | Treat a normalized registration-number equality as a **high-confidence** customer match candidate (stronger signal than name). |
| **invoice_reference → invoice_no normalization** | `invoice_reference` with no **exact raw** match | Compare against candidate `invoice_no`s using normalization (strip spaces/dashes/case/punctuation). A normalized-only match is a **suggestion** (`review_required`, status `Unmatched`) — **never** an automatic allocation (see §3.1.1-B). |
| **invoice_reference typo suggestion** | normalized still no match | Offer the closest invoice_no(s) for the **same customer** as a suggestion (review), not an allocation. |
| **receipt reference / remarks → invoice suggestion** | no `invoice_reference`, but `reference_no`/`remarks` resemble an invoice_no | **Optional, low-priority.** Offer a *suggestion only* if it is safe and unambiguous; otherwise leave as unallocated cash (Batch 4 behavior). Never auto-allocate from remarks. |

> [!NOTE]
> Fuzzy matching **adds a suggestion layer**; it does not weaken any existing exact-match path. Exact `customer_code`, exact normalized customer **name**, and **exact raw `invoice_no`** continue to behave exactly as today. **Normalized-only `invoice_no` matches are suggestions, not exact matches** (§3.1.1).

---

## 3. Matching Rules & Scoring

### 3.1 Confidence tiers (conservative **code constants** — not database config)

> [!IMPORTANT]
> All thresholds and the candidate cap are **conservative constants defined in code** (e.g. `_shared/fuzzy.ts`). **No database config key, no migration, no runtime tuning surface.** Conservative defaults are preferred so the system errs toward "route to review" rather than over-suggesting. **Fuzzy matching never auto-mutates** at any tier.

> [!IMPORTANT]
> **Batch 6A is conservative: an exact raw match can proceed; normalized-only or fuzzy matches are suggestions only.**
> - The only **no-review** paths are: exact `customer_code`, exact normalized customer **name** (today's existing behavior), and **exact raw `invoice_no`** match.
> - A **normalized-only** `invoice_no` match (differs only by spacing / dashes / case / punctuation) is **NOT** treated as a deterministic exact match in Batch 6A. It is a **suggestion** requiring review — never an automatic allocation. (See §3.1.1.)

| Category | Meaning | Action |
|----------|---------|--------|
| **Exact match** | exact `customer_code`, exact normalized customer **name**, or **exact raw `invoice_no`** | Proceed through the existing flow — **no fuzzy review**. |
| **High-confidence suggestion** | normalized registration-number equality; **normalized-only `invoice_no` match** (spacing/dash/case/punctuation) | **Suggestion only** → `review_required = true`; requires explicit user confirm in Batch 6B/6C before any mutation. **No automatic allocation.** |
| **Review-required suggestion** | token/prefix similarity ≥ minimum threshold | **Suggest, require explicit user selection** — no default action. |
| **Low confidence (ignored)** | similarity below the minimum threshold | **No suggestion** → treated as today (`Unmatched` for receipts; invoice-import `Create New` only per §4.1.1). |

### 3.1.1 Exact raw vs. normalized-only invoice_no (explicit rule)

> [!IMPORTANT]
> **A. Exact raw `invoice_no` match** — if `invoice_reference` exactly equals `invoice.invoice_no` under the **current** exact-matching behavior, **and** the invoice passes the existing company / customer / currency / status / outstanding checks (`resolveAllocationInvoice`), it **may proceed through the existing flow without fuzzy review**. This is unchanged from today.
>
> **B. Normalized-only `invoice_no` match** — when `invoice_reference` matches an `invoice_no` **only after normalization** (spacing, dash, case, or punctuation-only differences):
> - ❌ Do **not** treat it as a deterministic exact match in Batch 6A.
> - ✅ Treat it as a **suggestion**.
> - ✅ Set `mapped_data.review_required = true`.
> - ✅ Use an existing status — **`Unmatched`** (the raw reference did not exactly resolve).
> - ✅ Store `suggested_invoice_id` / `suggested_invoice_no` / `match_confidence` / reason (`normalized_invoice_no`) in `mapped_data`.
> - ❌ **No** automatic allocation or financial mutation from a normalized-only match.
> - ✅ User review (approve in Batch 6B / via the 6C UI) is required before the corrected reference re-enters the verified flow.

### 3.2 Signals (combined into a score)

- **Exact match** (code / normalized name / invoice_no) → top score.
- **Normalized match** (case-folded, punctuation/space/dash-stripped).
- **Registration-number match** (`normalizeRegistrationNo`) → strong customer signal.
- **Token similarity** (e.g. token set / Jaccard on normalized name tokens).
- **Prefix / suffix similarity** (e.g. shared prefix length; bounded edit distance such as Levenshtein/Damerau).
- **Invoice number normalized comparison** (strip non-alphanumerics, compare; optional bounded edit distance for single-character typos).
- **Minimum confidence threshold** — a single tunable constant in code (no DB config, no migration). Below it → no suggestion.
- **Multiple candidate handling** — if ≥2 candidates land in/above the review band, present the **top N (e.g. 3)** and **force review** (never auto-pick).

> [!IMPORTANT]
> Thresholds and the candidate cap are **code constants** (e.g. in a `_shared/fuzzy.ts` helper). **No new DB config key, no migration.** Codex to confirm the exact threshold values during review.

### 3.3 Hard safety filters on candidate generation (non-negotiable)

Applied **before** any candidate is scored or shown:

- ❌ **Hidden customers excluded** (`is_hidden = false`) — reuse Batch 2C visibility semantics.
- ❌ **Deleted customers excluded** (`is_deleted = false`).
- ✅ **AR Clerk assignment restriction respected** — a clerk only sees suggestions for customers in their assignment scope (`requireCustomerAccess` semantics).
- ✅ **Company-scoped** (`company_id = auth.companyId`).
- ❌ **Currency-mismatched invoices** are never suggested as *allocatable* (may be shown as informational "currency mismatch", but flagged blocking).
- ❌ **Paid / no-outstanding invoices** never suggested as *allocatable*.

---

## 4. Review Queue Design (status + `mapped_data`)

> [!IMPORTANT]
> **Prefer existing `import_rows.status` + `mapped_data` first.** No new database table unless Codex confirms it is required. The "review queue" is a **filtered view of existing import rows** whose `mapped_data.review_required = true` and which carry suggestion fields.

### 4.1 Exact status mapping (existing `import_rows.status` enum only — no new values)

Every case below maps to an **existing** status value. No new status is introduced.

| Case | `import_rows.status` | `review_required` | Notes |
|------|----------------------|-------------------|-------|
| **Exact match success** (exact code / exact normalized name / **exact raw `invoice_no`**) | `Valid` → `Created` → `Posted` → `Allocated` per the existing flow | `false` (unless a Category-2 diagnostic applies) | Unchanged from today. No fuzzy review. |
| **Normalized-only `invoice_no` match** (spacing/dash/case/punctuation differences) | `Unmatched` | `true` | **Suggestion only** (§3.1.1-B). Carries `suggested_invoice_*`, reason `normalized_invoice_no`. **No auto-allocation.** |
| **Customer suggestion needed** (name typo, candidate(s) in review band) | `Unmatched` | `true` | Must **not** auto-create. Carries `customer_candidates`. |
| **Invoice suggestion needed** (invoice_reference typo, candidate(s)) | `Unmatched` | `true` | Must **not** auto-allocate. Carries `invoice_candidates`. |
| **Multiple candidate matches** (≥2 in/above review band) | `Unmatched` | `true` | Never auto-pick; top-N listed. |
| **Non-allocatable invoice** (resolved but not allocatable) | `Skipped` | `true` | Batch 5-Fix-A precedent. |
| **Paid / no-outstanding invoice** | `Skipped` | `true` | Resolved-but-closed; not selectable as allocatable. |
| **Currency mismatch** | `Unmatched` | `true` | **Chosen: `Unmatched`** (see rationale below). |
| **Hard validation failure** (invalid required fields, name-validation failure, registration/business-field invalid) | `Error` | n/a | Existing validation behavior; no document created. |
| **Below-threshold customer, no candidate** (receipt) | `Unmatched` | `true` if any near-candidate, else `false` | As today; no blind allocation. |
| **Below-threshold customer, no candidate** (invoice) | `Created`/etc. via `Create New` **only if** §4.1.1 conditions hold; otherwise `Unmatched` | per §4.1.1 | See create-new rule. |

> [!IMPORTANT]
> **Currency mismatch → `Unmatched` (decision & rationale).** The invoice *row* technically resolves, which argues for `Skipped`; but a currency mismatch usually signals the **wrong invoice reference was supplied** (a resolution/identity problem), and the user's corrective action is to fix the reference — the same workflow as not-found. Mapping it to `Unmatched` keeps "fix the reference" cases together and distinguishes them from `Skipped` (= correct invoice, just not allocatable right now, e.g. Paid). This also aligns with Batch 5-Fix-A, where `currency_mismatch` already maps to `Unmatched` (`imports/service.ts:1131`).

### 4.1.1 Invoice-import customer auto-create rule (explicit)

> [!IMPORTANT]
> On **invoice import**, the existing `Create New` behavior is **preserved only** when **all** of the following hold:
> 1. **No** visible candidate is **above the fuzzy review threshold** (no near-match to suggest);
> 2. required customer fields are valid;
> 3. **customer name validation passes** (Batch 2B-Fix-1B rules);
> 4. registration / business fields are valid where required;
> 5. hidden/deleted customers are excluded from the candidate check;
> 6. the row passes existing validation.
>
> **If a near candidate exists above the review threshold:**
> - ❌ do **not** auto-create a new customer blindly;
> - ✅ set `import_rows.status = Unmatched`;
> - ✅ set `mapped_data.review_required = true`;
> - ✅ include `customer_candidates` (suggested customers) in `mapped_data`.
>
> This resolves the prior open question definitively: **auto-create survives only as the "genuinely new, no near-match" path; any plausible near-match routes to review.**

### 4.2 Proposed `mapped_data` suggestion fields (additive JSON — no migration)

```jsonc
{
  "review_required": true,
  "review_kind": "customer_suggestion" | "invoice_suggestion" | "both",
  "match_confidence": 0.0,                  // top candidate score, 0–1
  "match_reason_codes": ["name_typo", "normalized_invoice_no", "registration_match", "multiple_candidates"],

  // Customer suggestion(s)
  "suggested_customer_id": "uuid|null",
  "suggested_customer_code": "string|null",
  "suggested_customer_name": "string|null",
  "customer_candidates": [
    { "customer_id": "uuid", "customer_code": "...", "customer_name": "...", "confidence": 0.0, "reason": "..." }
  ],

  // Invoice suggestion(s)
  "suggested_invoice_id": "uuid|null",
  "suggested_invoice_no": "string|null",
  "invoice_candidates": [
    { "invoice_id": "uuid", "invoice_no": "...", "confidence": 0.0, "outstanding": 0.0, "currency": "...", "allocatable": true, "reason": "..." }
  ],

  // Action tracking
  "user_action": "pending" | "approved" | "rejected" | "edited",
  "reviewed_by": "uuid|null",
  "reviewed_at": "iso|null",
  "review_resolution": "string|null"
}
```

- **Reason codes** (indicative): `name_typo`, `name_token_similar`, `registration_match`, `normalized_invoice_no`, `invoice_no_typo`, `multiple_candidates`, `below_threshold`, `currency_mismatch`, `invoice_not_open`, `no_outstanding`, `customer_mismatch`.
- `allocatable: false` candidates (Paid/no-outstanding/currency-mismatch) may be shown for context but **cannot** be selected for allocation.

### 4.3 Approve / reject / edit flow (conceptual)

1. **Pending** — row imported with suggestions, `user_action: "pending"`.
2. **Approve** — user selects a suggested customer/invoice → mapped_data updated with the chosen `customer_id`/`invoice_id`, `user_action: "approved"`.
3. **Edit** — user corrects `customer_code` / `invoice_reference` manually → re-validate.
4. **Reject** — user dismisses suggestions → row stays `Unmatched`/`Skipped`, no action.
5. **Re-run** — approved/edited rows are re-validated and pushed through the **existing verified** create/post/allocate path (Batch 5-Fix-A preflight re-runs). **No mutation before this step.**

---

## 5. Frontend UX Design

Enhance the existing import result tables (no new pages required initially).

> [!IMPORTANT]
> **Batch 6A ships only the read-only display items below** (Suggested Match block, confidence, reason, Review Required badge, non-allocatable marking). The **interactive** items (selection control, inline edit/re-check, reject, confirm) are **Batch 6C** and are wired to the Batch 6B review-resolution API — never to a direct Supabase write.

**Read-only display (Batch 6A):**
- **"Suggested Match" block** per review row: suggested customer (`code — name`) and/or suggested invoice (`invoice_no`, outstanding, currency).
- **Confidence + reason**: show `match_confidence` (e.g. as %) and human-readable reason ("Closest name match", "Invoice number differs only by spacing").
- **"Review Required" badge** (reuse existing amber styling).
- **Non-allocatable candidates** are visually marked (greyed, "cannot allocate: Paid / currency mismatch") and unselectable.

**Interactive review actions (Batch 6C — after the 6B API exists):**
- **Selection control**: radio/select to pick among `customer_candidates` / `invoice_candidates`.
- **Correct reference**: inline edit of `invoice_reference` / `customer_code`, then "re-check".
- **Reject** suggestion button.
- **Explicit confirm** required to proceed — **no auto-create / auto-allocate**. Submit reuses the Batch 5-Fix-B submit-lock pattern to prevent double-submit.

---

## 6. Backend / API Design

> [!IMPORTANT]
> Goal: reuse existing import endpoints/services where possible; add **suggestion generation** and **a review-resolution step**, but **never** mutate finances directly.

### 6.1 Suggestion generation
- A `_shared/fuzzy.ts` helper (normalization + scoring) used by `CustomerService` (customer candidates) and `ImportService.resolveAllocationInvoice` callers (invoice candidates).
- Extend `classifyImportCustomer` to return, on no-exact-match, a **`Suggest` outcome** with ranked candidates (extends the `matchedBy` union / classification type — a TS type change, not a DB change).
- Candidate queries apply the §3.3 hard filters (visible, scoped, company, allocatable).

### 6.2 Review-resolution route (concrete design — backend only)

A new route is added to the **existing `imports` Edge Function**, consistent with its regex-router style (`imports/index.ts:17`–`25`, which already uses `/{batchId}/parse`, `/{batchId}/validate`, `/{batchId}/execute`, `/{batchId}/rows`).

**Route:**
```
POST /imports/:batchId/rows/:rowId/review
```
Router entry (indicative), capturing both UUIDs:
```ts
review: new RegExp(`^\\/${UUID}\\/rows\\/${UUID}\\/review\\/?$`, 'i'),
// matchRoute returns params: { batchId: match[1], rowId: match[2] }
```

**Request payload:**
```jsonc
{
  "action": "approve_suggestion" | "reject_suggestion" | "edit_customer" | "edit_invoice_reference" | "retry_validation",

  // action = approve_suggestion
  "selected_customer_id": "uuid|null",        // must be one of mapped_data.customer_candidates[].customer_id
  "selected_invoice_id":  "uuid|null",        // must be one of mapped_data.invoice_candidates[].invoice_id (and allocatable=true)

  // action = edit_customer
  "customer_code": "string|null",             // re-resolved via classifyImportCustomer (exact path)

  // action = edit_invoice_reference
  "invoice_reference": "string|null"          // re-resolved via resolveAllocationInvoice
  // action = reject_suggestion / retry_validation → no extra fields
}
```

**Allowed actions & behavior:**

| Action | Behavior | Mutates finance? |
|--------|----------|------------------|
| `approve_suggestion` | Validate the selected candidate is present in `mapped_data.*_candidates`, still **visible/in-scope/allocatable**; write chosen `customer_id`/`invoice_id` + `user_action: "approved"` into `mapped_data`; then **re-validate** (§6.3). | No — re-validation only; mutation only if §6.3 re-run is explicitly invoked and passes. |
| `reject_suggestion` | Set `user_action: "rejected"`, clear suggestion selection; row stays `Unmatched`/`Skipped`. | No |
| `edit_customer` | Re-resolve the supplied `customer_code` through `classifyImportCustomer` (exact path); update `mapped_data` + status accordingly. | No |
| `edit_invoice_reference` | Re-resolve the supplied `invoice_reference` through `resolveAllocationInvoice`; update `mapped_data` + status (incl. all Batch 5-Fix-A reasons). | No |
| `retry_validation` | Re-run row validation (and, where the batch is auto-post, the preflight) on the **current** `mapped_data`; recompute status. | No (preflight only; create/post/allocate still gated) |

**Authorization & scoping (all enforced server-side):**
- **Role checks**: reuse the existing import-write authorization (`requireImportWrite` / equivalent) — System Admin (config-only) and Auditor (read-only) are blocked from review mutations, consistent with the rest of the module.
- **`companyId` enforcement**: the batch and row are loaded with `company_id = auth.companyId`; a row from another company → `NotFoundError`.
- **AR Clerk assignment restriction**: any `selected_customer_id` / re-resolved customer passes `requireCustomerAccess(auth, customerId)`; a clerk cannot approve a suggestion for an unassigned customer.
- **Hidden/deleted exclusion**: the selected/edited customer is re-checked for `is_hidden = false` AND `is_deleted = false` (Batch 2C `assertCustomerVisible`) **at approval time**, not just at suggestion time — so a customer hidden between import and review cannot be approved.

**Re-validation before any create/post/allocation:**
- The review route itself **never** creates/posts/allocates. It only updates `mapped_data` + `import_rows.status` and re-runs validation/preflight.
- Actual document creation happens **only** when the corrected, approved row is run through the **existing** `execute` path (`POST /imports/:batchId/execute`) or an equivalent existing service entry — which re-applies `validateCreateInvoice` / `validateCreateReceipt`, the Batch 5-Fix-A `preflightReceiptImportAllocation`, and the `allocate_receipt` / `post_receipt` RPCs unchanged.
- No row that still has an unresolved blocking condition can produce a document (Batch 5-Fix-A guarantee preserved).

**No frontend direct Supabase writes:** the frontend calls **only** this Edge Function route; it must not update `import_rows` / `mapped_data` directly via the Supabase client. All review mutations are server-mediated and authorization-checked.

### 6.3 Approved-selection consumption at execute time (re-validation is mandatory)

> [!CAUTION]
> **Approved `mapped_data` selections must never be blindly trusted.** A selection written during review can become stale (customer hidden/deleted afterward, invoice paid/closed by another action, assignment changed, currency edited). The `execute` path must **re-validate from source** before it uses any approved `customer_id` / `invoice_id` — it must not treat the stored selection as authoritative.

Before `execute` uses an approved customer/invoice selection to create / post / allocate, the backend **must re-validate, server-side, from current data**:

1. **`company_id` scope** — batch, row, customer, and invoice all belong to `auth.companyId`.
2. **Authenticated user role** — caller is permitted to execute imports (System Admin config-only / Auditor read-only blocked).
3. **AR Clerk customer assignment** — `requireCustomerAccess(auth, customerId)` on the approved customer.
4. **Customer not hidden** — `is_hidden = false` (re-checked now, not at suggestion time).
5. **Customer not deleted** — `is_deleted = false`.
6. **Invoice belongs to the same company** — `invoice.company_id = auth.companyId`.
7. **Invoice belongs to the approved customer context** — `invoice.customer_id` equals the approved/resolved customer.
8. **Invoice status is allocatable** — `Open` / `Overdue` / `Partially Paid`.
9. **Invoice currency matches** the receipt / import-row currency.
10. **Invoice `outstanding > 0`.**
11. **`allocation_amount` / `discount_amount` rules** — `amount > 0`, `discount ≥ 0`, `amount + discount ≤ outstanding`.
12. **Batch 5-Fix-A import allocation preflight** (`preflightReceiptImportAllocation`) re-runs in full.

**On re-validation failure (any check above):**
- ❌ Do **not** create / post / allocate.
- ✅ Mark the row **back to review** using the **existing status mapping** (§4.1): `Unmatched` / `Skipped` / `Error` as appropriate, with `review_required = true` and the relevant `allocation_error_reason` / `auto_post_block_reason`.
- ✅ Clear or supersede the stale selection so it cannot be reused without a fresh approval.

**Guarantees:**
- ❌ Do **not** trust stale `mapped_data` selections — every check is recomputed from live data at execute time.
- ❌ Do **not** allow a frontend direct Supabase update to substitute for this server-side re-validation.
- ✅ Approval **re-enters the existing verified import service paths** (`validateCreateInvoice` / `validateCreateReceipt` → Batch 5-Fix-A preflight → `post_receipt` / `allocate_receipt` RPCs) — **never** direct financial-table mutation.

### 6.4 Human approval before mutation
- No create/post/allocate occurs from suggestion generation **or** from the review route. Financial mutation happens **only** when an approved/edited row re-enters the existing verified `execute` create→post→allocate path **and passes the §6.3 re-validation**.

### 6.5 Hard prohibitions (unchanged)
- ❌ No direct `allocation_details` insert.
- ❌ No direct `invoices.outstanding` update.
- ❌ No direct `receipts.allocated_amount` / `unallocated_amount` update.
- ❌ No bypass of `post_receipt` / `allocate_receipt` RPCs.
- ❌ No frontend-issued direct Supabase mutation of import rows.

---

## 7. Financial Safety Rules

- ✅ A fuzzy suggestion **must not** equal automatic allocation or automatic customer creation.
- ✅ Low-confidence matches **require review**.
- ✅ Multiple candidate matches **require review** (never auto-pick).
- ✅ Currency mismatch **blocks allocation** (may be shown, not selectable).
- ✅ Paid / no-outstanding invoice **blocks allocation**.
- ✅ Customer mismatch **blocks allocation** unless the user explicitly corrects/confirms the customer.
- ✅ Hidden / deleted customers are **never** suggested.
- ✅ AR Clerk scope and company scope always enforced on candidates.
- ✅ **No financial mutation before review approval**; approval re-runs the verified path (incl. Batch 5-Fix-A preflight).
- ✅ No direct `allocation_details` insert; no direct `invoices.outstanding` update; no direct `receipts.allocated_amount` / `unallocated_amount` update.
- ✅ `POST /allocations/auto` remains **disabled (403)**.
- ✅ **No OCR**, **no fully automatic posting**, **no backend idempotency** in Batch 6 (idempotency stays future hardening — Batch 5-Fix-C).

---

## 8. Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC-1 | Customer-name **typo** → produces a suggestion; **does not auto-create** a wrong/duplicate customer (row `Unmatched` + `suggested_customer_*`). |
| AC-2 | Invoice-reference **typo** → produces a suggestion; **does not auto-allocate** (row `Unmatched` + `suggested_invoice_*`). |
| AC-3 | **Multiple** candidate matches → row requires review; no auto-pick; top-N candidates listed. |
| AC-4 | **Hidden** customer is **never** suggested. |
| AC-5 | **Deleted** customer is **never** suggested. |
| AC-6 | **Paid / no-outstanding** invoice is **not** suggested as allocatable. |
| AC-7 | **Currency mismatch** is blocked (not selectable as allocatable). |
| AC-8 | **AR Clerk** sees suggestions only within assignment scope; company-scoped for all. |
| AC-9 | A **user-approved** correction proceeds through the **existing verified** import/create/post/allocate flow (Batch 5-Fix-A preflight re-runs). |
| AC-10 | Existing **exact raw** matches (code, normalized name, exact raw invoice_no) still work unchanged with **no review**. |
| AC-11 | A **normalized-only `invoice_no`** match (spacing/dash/case/punctuation) → `Unmatched` + `review_required` + `suggested_invoice_*`; **does not auto-allocate** (§3.1.1-B). |
| AC-12 | An **approved selection that has gone stale** (customer later hidden/deleted, invoice later paid/closed, currency changed, assignment removed) → re-validation **fails** at execute time; **no create/post/allocate**; row returned to review per §6.3. |
| AC-13 | **Batch 5-Fix-A preflight** still rejects blocking rows before document creation. |
| AC-14 | Batch 5 bank-charge **non-blocking** diagnostics still create/post/allocate. |
| AC-15 | **No financial mutation** occurs from suggestion generation **or** from the review route. |
| AC-16 | `POST /allocations/auto` still returns **403 `AUTO_ALLOCATION_DISABLED`**. |
| AC-17 | No new DB table / no new `import_rows.status` value / no migration (unless Codex approves); no OCR; no fully automatic posting; no backend idempotency. |

---

## 9. Testing / Evidence Plan (CSV smoke tests)

Prepare import CSVs exercising:

1. **Customer-name typo** (e.g. "Acme Trdaing" vs "Acme Trading") → suggestion, no auto-create.
2. **Invoice-reference typo** (e.g. `INV 202606 00013` vs `INV-202606-00013`) → normalized/typo suggestion, no auto-allocate.
3. **Multiple similar customers** (two near-identical names) → review, top-N candidates, no auto-pick.
4. **Hidden customer** present → not suggested.
5. **Deleted customer** present → not suggested.
6. **Paid invoice** reference → not suggested as allocatable.
7. **Currency mismatch** → still rejected/blocked (Batch 5-Fix-A).
8. **Exact-match regression** → clean code/name/invoice still imports normally.
9. **AR Clerk scope** → suggestions limited to assigned customers.
10. **User approval/retry flow** (if implemented) → approve suggestion → row completes via verified path; reject → stays unmatched.

Evidence document (later): `docs/evidence/audit-remediation/BATCH_6_FUZZY_MATCHING_REVIEW_QUEUE_SUMMARY.md`.

---

## 10. Files Likely Affected (do not edit in this plan)

| File | Expected role |
|------|---------------|
| `backend/supabase/functions/_shared/fuzzy.ts` *(new helper)* | Normalization + scoring (token/prefix/edit-distance), threshold constants. |
| `backend/supabase/functions/customers/service.ts` | Extend `classifyImportCustomer` to return ranked candidates / `Suggest` outcome; candidate query with §3.3 filters. |
| `backend/supabase/functions/imports/service.ts` | Use customer candidates; add invoice-candidate suggestion around `resolveAllocationInvoice`; write suggestion fields to `mapped_data`; **review-resolution service method** (approve/reject/edit/retry) + re-validation. |
| `backend/supabase/functions/imports/index.ts` | **Add the `review` route** `POST /:batchId/rows/:rowId/review` (regex entry per `index.ts:17`–`25`); dispatch to the review-resolution service method (Batch 6-B). |
| `frontend/src/app/(dashboard)/receipts/import/page.tsx` | 6-A: **read-only** suggested-match display. 6-C: selection / confirm / reject / re-check wired to the review API. |
| `frontend/src/app/(dashboard)/invoices/import/page.tsx` | Same split for invoice-import customer suggestions. |
| `frontend/src/hooks/use-imports.*` *(or equivalent)* | 6-C: mutations calling the review-resolution route; reuse Batch 5-Fix-B submit-lock pattern. |

> No migration file is anticipated. If Codex determines a dedicated `import_review` table or a new status is required, it will be raised as a separate, migration-gated decision.

---

## 11. Codex Review Checklist (safety before implementation)

- [ ] Confirms **suggestion ≠ mutation**: no create/post/allocate from suggestion generation.
- [ ] Confirms **hidden + deleted customers excluded** from candidates.
- [ ] Confirms **AR Clerk assignment scope** + **company scope** enforced on all candidate queries.
- [ ] Confirms **currency mismatch** and **Paid/no-outstanding** invoices are never selectable as allocatable.
- [ ] Confirms approved rows re-run the **existing verified** create/post/allocate path and **Batch 5-Fix-A preflight**.
- [ ] Confirms **no direct** `allocation_details` / `invoices.outstanding` / receipt-balance writes; **no RPC bypass**.
- [ ] Confirms **existing `import_rows.status` + `mapped_data`** are used first; approves/denies any new table or status (migration-gated).
- [ ] Confirms threshold/candidate-cap as **code constants** (no DB config).
- [ ] Confirms exact-match behavior is **unchanged** (no regression).
- [ ] Confirms the **invoice-import create-new rule** (§4.1.1): create-new only when no above-threshold candidate **and** all validation/name/registration/visibility conditions hold; otherwise `Unmatched` + suggestions.
- [ ] Confirms the **review-resolution route** design (§6.2): route shape, payload, the five actions, role checks, `companyId` enforcement, AR Clerk scope, hidden/deleted re-check at approval time, and that the route performs **no** financial mutation (only re-validation; mutation stays behind the existing `execute` path).
- [ ] Confirms the **exact status mapping** (§4.1), including **currency mismatch → `Unmatched`** and **normalized-only `invoice_no` → `Unmatched` suggestion**.
- [ ] Confirms the **exact-raw-vs-normalized-only invoice rule** (§3.1.1): exact raw may proceed; normalized-only is suggestion-only with `review_required`.
- [ ] Confirms **approved-selection re-validation at execute time** (§6.3): stale selections are never trusted; all 12 checks recomputed from live data; failure returns the row to review with no mutation.
- [ ] Confirms **thresholds are conservative code constants** (no DB config) and fuzzy matching **never auto-mutates**.
- [ ] Confirms the **backend-first sub-batch order** (§12): 6-A diagnostics + read-only display, 6-B review API, 6-C UI actions, 6-D optional.
- [ ] Confirms **no OCR**, **no fully automatic posting**, **no backend idempotency** in Batch 6.
- [ ] Confirms `POST /allocations/auto` stays **403**.
- [ ] Approves the proposed reason-code vocabulary (§4.2).

---

## 12. Recommended Implementation Sub-Batches

> [!IMPORTANT]
> **Ordering principle (per Codex):** backend suggestion generation and the review-resolution API must land **before** any interactive UI. The frontend only ever gets approve/reject/edit controls **after** the server-side route that mediates them exists. No sub-batch produces a financial mutation from a suggestion.

### Batch 6-A — Backend suggestion diagnostics + read-only display
- Backend **fuzzy helper** (`_shared/fuzzy.ts`): normalization + conservative scoring constants.
- **Customer suggestion diagnostics**: intercept the blind `Create New` path; write `customer_candidates` + review fields to `mapped_data` (§4.1.1).
- **Invoice suggestion diagnostics where safe**: normalized/typo `invoice_candidates` around `resolveAllocationInvoice`.
- Frontend: **read-only display only** of suggestions/confidence/reasons.
- ❌ **No** approve/reject buttons yet. ❌ **No** mutation from suggestions.

### Batch 6-B — Review-resolution API (backend only)
- New route `POST /imports/:batchId/rows/:rowId/review` (§6.2).
- Actions: `approve_suggestion` / `reject_suggestion` / `edit_customer` / `edit_invoice_reference` / `retry_validation`.
- Re-runs validation through the **existing** import service logic; updates `mapped_data` + status only.
- ❌ **Still no direct financial mutations** — create/post/allocate remains gated behind the existing `execute` verified path.

### Batch 6-C — Frontend review-queue actions
- Approve / reject / edit / retry UI on the import result tables.
- Wire UI **to the Batch 6-B review-resolution API** (never direct Supabase writes).
- Reuse the Batch 5-Fix-B submit-lock pattern to prevent double-submit.

### Batch 6-D — Optional receipt remarks/reference fuzzy suggestions
- Suggestion-only inference of a likely invoice from `reference_no` / `remarks`.
- **Lower priority** — higher false-positive risk; never auto-allocate; review-gated.

Recommended order: **6-A → 6-B → 6-C**, with **6-D** optional/last.

---

## 13. Prohibitions (Implementation Guardrails)

- ❌ Do not auto-create a customer when a fuzzy candidate exists in the review band — require confirmation.
- ❌ Do not auto-allocate from a fuzzy invoice suggestion — require confirmation.
- ❌ Do not suggest hidden or deleted customers.
- ❌ Do not show out-of-scope (unassigned) or cross-company candidates.
- ❌ Do not present Paid/no-outstanding/currency-mismatch invoices as allocatable.
- ❌ Do not insert `allocation_details` / update `invoices.outstanding` / update receipt balances directly.
- ❌ Do not bypass `post_receipt` / `allocate_receipt` RPCs.
- ❌ Do not create a new DB table or new `import_rows.status` value unless Codex approves a migration.
- ❌ Do not enable `POST /allocations/auto`.
- ❌ Do not implement **OCR** in Batch 6.
- ❌ Do not implement **fully automatic posting** in Batch 6.
- ❌ Do not implement **backend idempotency** in Batch 6 (remains future hardening — Batch 5-Fix-C).
- ❌ Do not allow the frontend to write `import_rows` / `mapped_data` directly via Supabase — all review mutations go through the Batch 6-B Edge Function route.

---

*Document created: 2026-06-13 · Updated 2026-06-13 (Codex round 1 — concrete review API, sub-batch reorder, create-new rule, status mapping, threshold constants, safety scope) · Updated 2026-06-13 (Codex round 2 — exact-raw-vs-normalized-only invoice rule, execute-time re-validation of approved selections, read-only 6A scope)*  
*Status: 🟢 Codex-reviewed (round 2) — Approved with changes; ready for implementation approval*  
*Author: Claude (GenAI-assisted development)*
