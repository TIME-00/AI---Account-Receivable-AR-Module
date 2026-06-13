# Batch 5-Fix — Import Preflight, Reject Invalid Import Rows, and Manual Submit Idempotency (Plan)

**Date**: 2026-06-13  
**Type**: Corrective batch — **implementation plan / documentation only** (no code changed in this document)  
**Depends on**: Batch 3 (multi-invoice allocation hardening), Batch 4 (overpayment/unapplied cash), Batch 5 (discount / bank charge / short payment)  
**Status**: 🟢 Codex-reviewed — **Approved with changes** (blocking vs non-blocking `review_required` split applied); ready for implementation approval

> [!IMPORTANT]
> This document is a plan only. No backend code, frontend code, migration, or RPC is changed here. Implementation happens in later, separately-reviewed steps (Batch 5-Fix-A / -B / -C).

---

## 0. Problems Being Fixed

Three defects were found after Batch 5:

| # | Defect | Severity |
|---|--------|----------|
| 1 | **Receipt import creates and posts a receipt *before* allocation is validated.** When `auto_post = true` and `invoice_reference` exists, an unallocatable invoice (Draft, Paid, currency mismatch, no outstanding, wrong customer, not found) leaves an **orphaned posted receipt** (cash posted, allocation failed). | High (financial integrity) |
| 2 | **Rows with a *blocking* problem can still produce documents.** Rows that fail a blocking preflight check should be rejected/skipped — never converted into draft or posted documents. (Note: `review_required` alone is **not** blocking — see §B.0.) | High |
| 3 | **Manual "Create & Post" produces duplicate invoices on rapid clicks.** Clicking 6× quickly creates 6 invoices. | High (data integrity) |

---

## 1. Current Behavior (Verified Against Code)

### 1.1 Receipt import execution order — `backend/supabase/functions/imports/service.ts`

The per-row loop (`service.ts:493`–`612`) for `import_type = 'receipt'` runs in this order:

1. Resolve/create customer (`resolveOrCreateImportCustomer`).
2. Resolve bank account; build `mappedData`; `validateCreateReceipt(mappedData)` (`:540`).
3. **If `autoPost`:** call `preflightExplicitReceiptImportOverAllocation(...)` (`:542`). If it returns a result, update the row to that status and `continue` (no receipt created).
4. `createReceipt(...)` (`:560`) — **receipt row created**.
5. **If `autoPost`:** `postReceipt(...)` (`:565`) — **receipt posted (JE created)**.
6. **If posted:** `allocateReceiptImportRow(...)` (`:582`) — resolves the invoice and calls `manualAllocate()`.

### 1.2 Why the current preflight is insufficient

`preflightExplicitReceiptImportOverAllocation` (`service.ts:1041`) only protects against **explicit over-allocation**, and only narrowly:

- It returns `null` (i.e. "no problem, proceed to create") when **no explicit `allocation_amount` and no positive `discount_amount`** is present (`:1055`). Implicit allocations are never preflighted.
- It wraps `resolveAllocationInvoice` in a `try { } catch { return null; }` (`:1060`–`1069`) — so **every invoice-resolution failure is swallowed** and treated as "proceed to create."
- It only flags the row when `settlement > outstanding` (`:1074`).

**Consequence:** the following all bypass the preflight, create + post the receipt, and *then* fail inside `allocateReceiptImportRow` (`:1234` catch → status `Unmatched`, `allocation_error_reason`):

- invoice not found for customer (`reason: invoice_not_found_for_customer`)
- multiple invoice matches (`multiple_matches`)
- currency mismatch (`currency_mismatch`)
- invoice status not allocatable — includes **Draft** and **Paid** (`invoice_not_open`)
- no outstanding (`no_outstanding`)
- customer mismatch (resolved invoice not owned by the receipt customer → not found)

`resolveAllocationInvoice` (`service.ts:1249`–`1309`) already produces each of those typed `ValidationError`s with a `reason` — but only **after** the receipt exists. The fix is to run those same checks **before** `createReceipt`.

### 1.3 Invoice import (comparatively safe today)

For `import_type = 'invoice'` (`service.ts:520`–`530`): `assertNoDuplicateReference`, `validateCreateInvoice`, and `validateInvoiceLines` all run **before** `createInvoice`, inside the row `try`. A failure throws → caught at `:603` → row set to `Error`, **no draft created**. Rows are processed only when `row.status === 'Valid'` (`:494`); rows that failed the earlier validate phase are already `Error`/`Unmatched`. This batch will **codify** that "no document on problem rows" rule and confirm there is no path that creates a draft after a blocking condition.

### 1.4 Manual invoice "Create & Post" — duplicate root cause

- `frontend/src/components/features/invoices/invoice-review.tsx` wires the buttons:
  - Save Draft: `isLoading={isCreating && !isPosting}` (`:127`)
  - **Create & Post: `isLoading={isCreating && isPosting}` (`:137`)**
- `isCreating = createMutation.isPending`, `isPosting = postMutation.isPending` (`use-invoice-form.ts:108`–`109`).
- `handleCreateAndPost` (`use-invoice-form.ts:204`) runs **create first**, then post. During the create window, `isCreating = true` but `isPosting = false`, so the Create & Post button's `isLoading` evaluates to `true && false = false` → **the button is NOT disabled while the create request is in flight.**
- `LoadingButton` disables only when `isLoading || disabled` is true (`loading-button.tsx:48`). With `isLoading = false` during the create window, **rapid repeat clicks each call `createMutation.mutateAsync` → multiple invoices created.**

> [!NOTE]
> **Root cause:** the Create & Post button requires **both** mutations pending simultaneously, which never happens during the vulnerable create phase. The correct lock is a single "submission in progress" flag that disables both buttons whenever **either** mutation is pending.

---

## 2. Financial Safety Rules (Preserved — Non-Negotiable)

The plan must preserve, in every option below:

- ❌ No direct `allocation_details` insert.
- ❌ No direct `invoices.outstanding` update.
- ❌ No direct `receipts.allocated_amount` / `unallocated_amount` update.
- ❌ No financial RPC redesign.
- ❌ No `post_receipt` / `allocate_receipt` RPC change unless Codex later confirms it is required.
- ❌ No new `import_rows.status` value unless Codex later approves a migration.
- ❌ No new migration in this batch unless absolutely required (none is anticipated — see §C).
- ✅ All balance/JE mutation continues to flow only through the existing verified RPCs.

---

## A. Import Preflight Design (Receipt Import)

### A.1 Goal

Move **all** invoice-resolution and allocatability validation to run **before** `createReceipt()`, `postReceipt()`, and allocation. If the invoice reference hits a **Category 1 blocking condition** (§B.0 / §A.3), the row must be rejected **without creating or posting any receipt**.

> [!IMPORTANT]
> The preflight rejects **only Category 1 blocking failures**. It must **not** reject a row merely because it carries **Category 2 non-blocking bank-charge diagnostics** (`bank_charge_amount` / `short_payment_reason = 'bank_charge'`). A bank-charge row whose invoice is valid and allocatable proceeds to create/post/allocate the received amount exactly as Batch 5 implements today.

### A.2 Proposed approach (no RPC change)

Generalise the existing `preflightExplicitReceiptImportOverAllocation` into a broader `preflightReceiptImportAllocation` (name indicative) that runs whenever `invoice_reference` is present — **for both explicit and implicit allocations**, regardless of `autoPost`. Key differences from today:

1. **Always resolve the invoice** when `invoice_reference` is present (do not early-return on "no explicit amount").
2. **Do not swallow resolution errors.** Map each `resolveAllocationInvoice` `ValidationError.reason` to a Skipped/review outcome instead of `return null`.
3. Keep the existing over-settlement math check (`allocation_amount + discount_amount ≤ outstanding`).
4. The main loop calls this **before `createReceipt` (`service.ts:560`)**; on a returned outcome it updates the row and `continue`s — exactly as it already does at `:548`–`556`. So **no receipt is created, none posted, no allocation, no `import_row_allocations` insert.**

> [!NOTE]
> Because the existing loop already supports the "preflight returns → update row → continue" pattern, this is a **widening of an existing guard**, not a new control-flow path. It does not require an RPC or migration.

### A.3 Exact outcome per case (when `invoice_reference` is present)

For all rejection cases below: **no receipt created, no receipt posted, no allocation, no `import_row_allocations` row.** Use existing statuses only.

| Case | Detected by | `import_rows.status` | `mapped_data` outcome |
|------|-------------|----------------------|------------------------|
| Invoice **not found** for customer | `resolveAllocationInvoice` → `invoice_not_found_for_customer` | `Unmatched` | `allocation_status: 'Unmatched'`, `review_required: true`, `auto_post_eligible: false`, `auto_post_block_reason` = message, `allocation_error_reason: 'invoice_not_found_for_customer'` |
| **Multiple** invoice matches | `multiple_matches` | `Unmatched` | as above, `allocation_error_reason: 'multiple_matches'` |
| Invoice **Draft** (not allocatable) | `invoice_not_open` (status `Draft`) | `Skipped` | `review_required: true`, `auto_post_eligible: false`, `auto_post_block_reason: 'Invoice is Draft; cannot allocate'`, `allocation_error_reason: 'invoice_not_open'`, `invoice_status` recorded |
| Invoice **Paid** (no outstanding / closed) | `invoice_not_open` or `no_outstanding` | `Skipped` | `review_required: true`, `auto_post_eligible: false`, reason `invoice_not_open` / `no_outstanding` |
| **Currency mismatch** | `currency_mismatch` | `Unmatched` | `review_required: true`, `auto_post_eligible: false`, `allocation_error_reason: 'currency_mismatch'`, `invoice_currency` + `receipt_currency` recorded |
| **No outstanding** (`outstanding ≤ 0`) | `no_outstanding` | `Skipped` | `review_required: true`, `auto_post_eligible: false`, `allocation_error_reason: 'no_outstanding'` |
| **Customer mismatch** (invoice not owned by receipt customer) | resolve filters on `customer_id` → not found | `Unmatched` | treated as `invoice_not_found_for_customer` |
| **Explicit over-allocation** (`allocation_amount > outstanding`) | existing over-settlement math | `Skipped` | `review_required: true`, `auto_post_eligible: false`, `auto_post_block_reason: 'allocation_amount exceeds invoice outstanding'`, plus `allocation_suggestion`, `unapplied_amount` (existing Batch 4/5 behavior preserved) |
| **`allocation_amount + discount_amount > outstanding`** | existing over-settlement math (discount path) | `Skipped` | `review_required: true`, `discount_validation_error`, `excess_settlement_amount`, `auto_post_block_reason: 'allocation_amount plus discount_amount exceeds invoice outstanding'` |

> [!IMPORTANT]
> **Status mapping rule:** use only existing enum values. Convention proposed for consistency:
> - `Unmatched` → the invoice reference could not be uniquely/validly resolved (not found, multiple, currency mismatch, wrong customer).
> - `Skipped` → the invoice resolved fine but is **not in an allocatable state or amount** (Draft, Paid, no outstanding, over-allocation). This matches the Batch 4/5 over-allocation precedent (`Skipped`).
> - Final reconciliation in the loop already counts `Skipped` (`finalSkippedRows`, `:626`) and `Unmatched` (`finalErrorRows`, `:621`–`625`).
>
> **Scope of the table above = Category 1 (blocking) only.** Every row in §A.3 stops before `createReceipt`. **Category 2 non-blocking bank-charge diagnostics (§B.0) are explicitly out of this table** — they are *not* preflight rejections and must still create/post/allocate the received amount. The preflight must reject a bank-charge row only if it independently meets a Category 1 condition.

### A.4 Behavior when there is **no `invoice_reference`**

Unchanged: a receipt with no invoice reference is created (and, if `autoPost`, posted) as **unallocated cash** — this is legitimate (Batch 4 unapplied-cash behavior). The preflight does nothing in this case.

### A.5 `autoPost = false` (manual allocation later)

When `autoPost = false`, no posting/allocation happens during import regardless. The preflight still **should not create a receipt for a clearly invalid `invoice_reference`** if the row also carries explicit allocation intent — but at minimum it must not change today's safe behavior. Recommended: when `invoice_reference` is present and resolves to an invalid/closed invoice, mark the row `Skipped`/`Unmatched` per A.3 and do not create the receipt, so a non-allocatable reference never silently produces an unallocated draft receipt. (Codex to confirm whether `autoPost = false` rows with bad references should still create an unallocated receipt or be rejected; default recommendation: **reject**, to satisfy Issue 2.)

---

## B. Reject Invalid Import Rows (Invoice + Receipt Import)

### B.0 Two categories of `review_required` (critical distinction)

> [!IMPORTANT]
> **`review_required = true` alone does NOT block document creation.** `review_required` is a diagnostic flag used by both blocking and non-blocking situations. Whether a document is created depends on **why** review is required, not on the flag itself. There are two distinct categories:

#### Category 1 — Blocking review / blocking preflight failure (MUST stop before document creation)

These conditions mean the row **cannot** be safely turned into a receipt. They are caught by the §A preflight **before** `createReceipt`:

- invalid `invoice_reference`
- invoice not found
- invoice belongs to the wrong customer
- invoice is **Draft**
- invoice is **Paid**
- invoice not allocatable (status not `Open` / `Overdue` / `Partially Paid`)
- currency mismatch
- no outstanding (`outstanding ≤ 0`)
- explicit over-allocation (`allocation_amount > outstanding`)
- `allocation_amount + discount_amount > invoice outstanding`

**Required outcome (Category 1):**
- ❌ do **not** create receipt
- ❌ do **not** post receipt
- ❌ do **not** allocate
- ❌ **no** `import_row_allocations` row
- ✅ existing `import_rows.status` only: `Skipped` / `Unmatched` / `Error`
- ✅ `mapped_data.review_required = true`
- ✅ `mapped_data.auto_post_eligible = false` where applicable
- ✅ `mapped_data.allocation_error_reason` **or** `mapped_data.auto_post_block_reason` clearly explains the issue

(Per-case status/`mapped_data` detail is in §A.3.)

#### Category 2 — Non-blocking review diagnostics (MAY still create / post / allocate)

These are **Batch 5 explicit bank-charge diagnostics**. They flag a row for human attention **without** preventing a valid settlement. They occur when the row is otherwise valid and:

- an explicit `bank_charge_amount` is supplied, **or**
- `short_payment_reason = 'bank_charge'`

**Required behavior (Category 2) — Batch 5 behavior preserved unchanged:**
- ✅ create / post the receipt if the row is otherwise valid
- ✅ allocate the **received amount only** (through `manualAllocate()` / `allocate_receipt`)
- ✅ invoice remains **Partially Paid** for the bank-charge difference
- ✅ `mapped_data.review_required = true`
- ✅ `mapped_data.bank_charge_posting_required = true`
- ❌ **no** bank-charge journal entry in Batch 5
- ❌ do **not** treat the bank charge as a discount

> [!NOTE]
> The Batch 5-Fix preflight (§A) must **not** reject a row solely because it carries bank-charge diagnostics. A bank-charge row is rejected **only** if it independently hits a Category 1 condition (e.g. the referenced invoice is Paid). Otherwise it proceeds exactly as Batch 5 already implements (`allocateReceiptImportRow` → `bank_charge_posting_required: true`, `bank_charge_review_reason`).

### B.1 Rule

> A row **must not create a draft or posted document** when it has a validation error, an unmatched customer, an invalid/missing required field, or any **Category 1 blocking preflight failure** (§B.0). Such rows are marked `Error` / `Unmatched` / `Skipped` only.
>
> A row **may** create/post/allocate when its only review flag is a **Category 2 non-blocking diagnostic** (§B.0) — e.g. an explicit bank charge — and it is otherwise valid. `review_required = true` by itself never blocks document creation.

### B.2 Current state vs. needed correction

| Path | Current behavior | Correction needed |
|------|------------------|-------------------|
| **Invoice import** | Validation (`validateCreateInvoice`, `validateInvoiceLines`, `assertNoDuplicateReference`) runs **before** `createInvoice`; failure → `Error`, no draft. Rows processed only when `status='Valid'`. | **Mostly compliant.** Action: add an explicit assertion/test that no blocking condition path reaches `createInvoice`; document the invariant. No behavior change expected unless a gap is found during implementation. |
| **Receipt import** | `createReceipt`/`postReceipt` can run before allocation validation (see §1.2). | **Fix via §A preflight** — invalid invoice references reject the row before `createReceipt`. |

### B.3 Status / `mapped_data` outcome (consolidated)

- Validation error during the validate phase → `Error` + `validation_errors` (existing).
- Customer cannot be resolved → `Unmatched` (existing).
- **Category 1** blocking: invalid/closed/unmatched `invoice_reference` on a receipt row → `Skipped`/`Unmatched` per §A.3 (new, via widened preflight); **no document created**.
- **Category 2** non-blocking: bank-charge diagnostics on an otherwise-valid row → document created/posted, received amount allocated, `review_required: true` + `bank_charge_posting_required: true` (Batch 5 behavior preserved).
- **No new status values introduced.** If a future need arises, it requires Codex-approved migration (out of scope here).

---

## C. Manual Invoice Submit Idempotency / Double-Click Prevention

### C.1 Frontend protection (Batch 5-Fix-B — primary fix)

Introduce a **single submission lock** so both Save Draft and Create & Post are disabled whenever any submission is in progress.

Proposed (indicative) changes in `use-invoice-form.ts` + `invoice-review.tsx`:

1. Derive a single flag: `const isSubmitting = createMutation.isPending || postMutation.isPending;` (and/or a local `useRef`/`useState` guard set at the top of each handler).
2. **Guard re-entry** at the start of `handleCreateDraft` / `handleCreateAndPost`: if `isSubmitting` is already true, return immediately (one-submit guard) — protects against the brief window before React re-renders the disabled state.
3. Pass `isSubmitting` to `InvoiceReview` and disable **both** buttons on it:
   - Save Draft: `disabled={isSubmitting}`, `isLoading={createMutation.isPending && !postMutation.isPending}` (loading label unchanged).
   - Create & Post: `disabled={isSubmitting}`, `isLoading={isSubmitting}` with loading text covering both phases (e.g. "Processing…" / "Posting…").
4. `LoadingButton` already disables on `isLoading || disabled` and sets `pointer-events-none` (`loading-button.tsx:48`,`51`) — so once `disabled={isSubmitting}` is passed, repeated clicks and the Enter-key default are both blocked. No `LoadingButton` change required.
5. Reset is automatic: `isSubmitting` returns to false when both mutations settle (success or error). On error, existing `handleApiError` already runs and the user can retry once.

> [!NOTE]
> The decisive change vs. today is replacing the **AND** condition (`isCreating && isPosting`) on Create & Post with a **single OR-based lock** (`isSubmitting`). This closes the create-phase window that currently allows duplicates.

### C.2 Enter-key / accidental submit

The action buttons are `type="button"` (not `type="submit"`) and live outside a `<form onSubmit>` submit flow, so Enter does not auto-submit today. The one-submit guard (C.1 step 2) plus `disabled` covers any residual accidental repeat. No additional change anticipated; confirm during implementation.

### C.3 Backend idempotency review (Batch 5-Fix-C — review / future hardening)

| Question | Assessment |
|----------|------------|
| Is frontend-only submit lock enough for an FYP prototype? | **Yes — recommended scope for now.** The duplicate bug is a UI double-submit; the single-lock + re-entry guard eliminates the realistic cause. |
| Should the backend use an idempotency key / `client_request_id`? | **Stronger, but larger.** A true server guard would require the client to send a stable key and the backend to dedupe on it. |
| Would backend idempotency require a migration / new table or column? | **Yes.** It needs either a new `client_request_id` column on `invoices` (+ unique index) or a dedicated idempotency-keys table. That is a schema change → **out of scope for this batch** (no migration unless absolutely required). |
| Safest scope now | **Frontend lock now (Batch 5-Fix-B). Document backend idempotency key as future hardening (Batch 5-Fix-C), pending Codex approval for any migration.** |

> [!IMPORTANT]
> Backend idempotency is **documented as future hardening only**. No migration, no `invoices` column, no new table is created in this batch.

---

## D. Financial Safety Rules

(Restated for the implementer — identical to §2.) No direct `allocation_details` insert; no direct `invoices.outstanding` update; no direct receipt balance update; no RPC redesign; no `post_receipt`/`allocate_receipt` change unless Codex confirms; no new import status; no migration unless absolutely required.

---

## E. Files Likely Affected

| File | Expected change | Batch |
|------|-----------------|-------|
| `backend/supabase/functions/imports/service.ts` | Widen `preflightExplicitReceiptImportOverAllocation` → general `preflightReceiptImportAllocation`; resolve+validate invoice before `createReceipt`; map resolution `reason`s to `Skipped`/`Unmatched` + `mapped_data`. Codify "no document on blocking rows" for invoice path. | 5-Fix-A |
| `frontend/src/hooks/use-invoice-form.ts` | Add `isSubmitting` single lock + re-entry guard; expose to review component. | 5-Fix-B |
| `frontend/src/components/features/invoices/invoice-review.tsx` | Disable both buttons on `isSubmitting`; fix Create & Post `isLoading` condition. | 5-Fix-B |
| `frontend/src/app/(dashboard)/receipts/import/page.tsx` | (If needed) display new reject/skip reasons consistently — likely already covered by Batch 5 diagnostics rendering. | 5-Fix-A |
| `frontend/src/app/(dashboard)/invoices/import/page.tsx` | (If needed) confirm invalid-row rejection messaging. | 5-Fix-A |
| `frontend/src/components/ui/loading-button.tsx` | **No change expected** (already disables on `isLoading || disabled`). | — |
| `backend/supabase/functions/invoices/service.ts` | **Only if** Batch 5-Fix-C idempotency review concludes a backend guard is in scope — **not anticipated** this batch. | 5-Fix-C (future) |

---

## F. Acceptance Criteria

| # | Criterion | Verifies |
|---|-----------|----------|
| AC-1 | Receipt import row with a **Draft** `invoice_reference` → row `Skipped`/review, **no receipt created, none posted, no allocation** | §A, §B |
| AC-2 | Receipt import row with a **Paid** `invoice_reference` → row `Skipped`/review, no receipt created | §A |
| AC-3 | Receipt import row with **currency mismatch** → row `Unmatched`/review, no receipt created | §A |
| AC-4 | Receipt import row with **explicit over-allocation** → row `Skipped`/review, no receipt created (Batch 4/5 behavior preserved, now pre-create) | §A |
| AC-5 | Receipt import row with **invoice not found / multiple matches / customer mismatch / no outstanding** → row `Unmatched`/`Skipped`, no receipt created | §A |
| AC-6 | **Invoice import** row with validation error → **no draft invoice created** (`Error`) | §B |
| AC-7 | **Receipt import** row with validation error → **no draft receipt created** | §B |
| AC-8 | Manual invoice **Create & Post** clicked rapidly (e.g. 6×) → **exactly one** invoice created and posted | §C |
| AC-9 | Existing **successful invoice import** still works | regression |
| AC-10 | Existing **successful receipt import** still works | regression |
| AC-11 | Batch 5 **discount** diagnostics still work | regression |
| AC-12 | **Non-blocking bank-charge row (otherwise valid)** → receipt **created/posted**, received amount allocated, invoice **Partially Paid**, `review_required = true` + `bank_charge_posting_required = true`, **no bank-charge JE**, not treated as discount (Category 2 — §B.0) | §B.0 |
| AC-13 | Bank-charge row whose invoice **independently** hits a Category 1 condition (e.g. Paid) → **rejected**, no receipt created (bank-charge flag does not override blocking) | §A, §B.0 |
| AC-14 | `review_required = true` **alone** (no Category 1 failure) does **not** block document creation | §B.0 |
| AC-15 | Batch 4 **overpayment / unapplied cash** behavior still works | regression |
| AC-16 | `POST /allocations/auto` still returns **403 `AUTO_ALLOCATION_DISABLED`** | regression |
| AC-17 | No new migration, no new `import_rows.status` value, no RPC change | safety |

---

## G. Recommended Implementation Batches

| Sub-batch | Scope | Risk | Notes |
|-----------|-------|------|-------|
| **Batch 5-Fix-A** | Import allocation **preflight** for **Category 1 blocking failures** (resolve + validate invoice before `createReceipt`/`postReceipt`) + **reject blocking import rows** (receipt & invoice), while **preserving Category 2 non-blocking bank-charge diagnostics** (§B.0) | Medium (touches financial import flow) | Reuses existing "preflight returns → continue" pattern; no RPC/migration. Highest value — closes the orphaned-posted-receipt hole. Must not regress Batch 5 bank-charge behavior. |
| **Batch 5-Fix-B** | Manual invoice **submit double-click prevention** (frontend single lock + re-entry guard + button disable) | Low | Frontend-only; no backend change. |
| **Batch 5-Fix-C** | Backend **idempotency review / future hardening** (client_request_id design) | Documented only | No code/migration this batch; requires Codex approval before any schema change. |

Recommended order: **5-Fix-A → 5-Fix-B**, with **5-Fix-C** documented as future hardening.

---

## H. Prohibitions (Implementation Guardrails)

- ❌ Do not create or post a receipt before invoice allocatability is validated (Category 1, §B.0).
- ❌ Do not block document creation on `review_required` alone — only Category 1 blocking failures stop creation.
- ❌ Do not reject or alter a row solely because it carries Category 2 bank-charge diagnostics (preserve Batch 5 behavior).
- ❌ Do not create a bank-charge journal entry in this batch; do not treat a bank charge as a discount.
- ❌ Do not insert `import_row_allocations` for a rejected/skipped (Category 1) row.
- ❌ Do not introduce a new `import_rows.status` value.
- ❌ Do not create a migration, new table, or new column.
- ❌ Do not change `post_receipt` / `allocate_receipt` / any financial RPC.
- ❌ Do not directly mutate `allocation_details`, `invoices.outstanding`, or receipt balance columns.
- ❌ Do not treat backend idempotency as in-scope coding work (review/document only).
- ❌ Do not enable `POST /allocations/auto`.

---

*Document created: 2026-06-13 · Updated 2026-06-13 (Codex review — `review_required` blocking/non-blocking split)*  
*Status: 🟢 Codex-reviewed — Approved with changes; ready for implementation approval*  
*Author: Claude (GenAI-assisted development)*
