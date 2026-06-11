# Batch 2C — Hidden/Deleted Customer Mutation Guards Summary

**Date**: 2026-06-12  
**Batch**: 2C (mutation guards — split from the original Batch 2 scope)  
**Status**: ✅ Implemented · ✅ `deno check`-verified · ✅ Deployed (invoices + receipts Edge Functions) · 🟡 Partial smoke-tested (visible-customer regression passed; hidden-customer fixture tests pending)  
**Commit**: `de493bb` — "Add hidden customer mutation guards"  
**Plan Reference**: `docs/plans/ar-module-audit-remediation-plan.md` (Batch 2 — hidden/deleted mutation guards) and `docs/plans/batch-2b-fix-logical-receipt-payment-smart-validation-plan.md` (§1 Codex Recommendation — sequence Batch 2C before customer name validation)

---

## 1. Purpose

Batch 2C closes a state-transition gap: financial mutation endpoints on invoices and receipts previously verified company ownership of the target document, but did **not** consistently re-verify that the **customer** behind the document is still:

1. **Accessible to the caller** — AR Clerks must only mutate documents for customers assigned to them.
2. **Visible** — the customer must not be soft-deleted (`is_deleted = true`) or hidden (`is_hidden = true`).

Without these guards, a financially significant action (posting, cancelling, clearing a cheque, editing/deleting a draft) could be performed against a customer that has since been hidden or soft-deleted, or against a customer outside the AR Clerk's assignment scope. This batch adds a uniform access + visibility guard immediately after the document is loaded and before any state change or RPC call.

This sequencing follows the Codex recommendation recorded in the Batch 2B-Fix plan: **mutation guards should land before customer name validation (Batch 2B-Fix-1B)** because they protect data integrity at a more foundational layer than input-quality validation.

---

## 2. Scope

Customer access **and** hidden/deleted visibility guards were added before each of the following mutating operations:

| # | Operation | Service Method | Endpoint (conceptual) |
|---|-----------|----------------|------------------------|
| 1 | Receipt posting | `ReceiptService.postReceipt()` | `POST /receipts/:id/post` |
| 2 | Receipt cancellation | `ReceiptService.cancelReceipt()` | `POST /receipts/:id/cancel` |
| 3 | Cheque clearance | `ReceiptService.clearCheque()` | `POST /receipts/:id/clear` |
| 4 | Invoice cancellation | `InvoiceService.cancelInvoice()` | `POST /invoices/:id/cancel` |
| 5 | Draft invoice update | `InvoiceService.updateDraftInvoice()` | `PATCH /invoices/:id` |
| 6 | Draft invoice delete | `InvoiceService.deleteDraftInvoice()` | `DELETE /invoices/:id` |

**Out of scope (intentionally):** RPC internals, database migrations, import logic, frontend, customer name validation, and CASH/OFST accounting support. See §8 and §10.

---

## 3. Files Changed

| File | Change |
|------|--------|
| `backend/supabase/functions/receipts/service.ts` | Added visibility guard to `postReceipt()`; added access + visibility guards to `clearCheque()` and `cancelReceipt()` (5 lines added) |
| `backend/supabase/functions/invoices/service.ts` | Added access + visibility guards to `cancelInvoice()`, `updateDraftInvoice()`, and `deleteDraftInvoice()` (8 insertions, 1 deletion) |

**No new helper code was introduced** — both guards reuse existing shared helpers:

- `requireCustomerAccess(auth, customerId)` — `backend/supabase/functions/_shared/auth.ts`
- `assertCustomerVisible(client, companyId, customerId)` — `backend/supabase/functions/_shared/visibility.ts`

> [!NOTE]
> **Discrepancy note (accurate scope of change):**
> - `postReceipt()` **already called** `requireCustomerAccess()` before Batch 2C — the access guard there is pre-existing, not new.
> - Batch 2C added the previously-missing `assertCustomerVisible()` call to `postReceipt()`.
> - The **other five methods** (`cancelReceipt()`, `clearCheque()`, `cancelInvoice()`, `updateDraftInvoice()`, `deleteDraftInvoice()`) received **both** the access and visibility guards where they were missing.

---

## 4. Guard Logic Added

Each guarded method now performs the following sequence after loading the document and confirming `company_id` ownership, and **before** any mutation/RPC:

```ts
const receipt = await fetchById<Receipt>(this.client, 'receipts', receiptId);
if (receipt.company_id !== auth.companyId) throw new NotFoundError('Receipt', receiptId);
await requireCustomerAccess(auth, receipt.customer_id);          // access scope
await assertCustomerVisible(this.client, auth.companyId, receipt.customer_id); // visibility
// ...then state checks / RPC call
```

(The invoice methods follow the identical pattern using `invoice.customer_id`.)

### 4.1 `requireCustomerAccess(auth, customerId)`

- **Full-access roles** — `AR Supervisor`, `Finance Manager`, `System Admin`, `Auditor` — return immediately (unrestricted).
- **AR Clerk** — looks up `user_customer_assignments` for an **active** assignment matching `user_id`, `customer_id`, and `company_id`. If none exists, throws `AuthorizationError`: *"You do not have access to this customer. AR Clerk can only access assigned customers."*

### 4.2 `assertCustomerVisible(client, companyId, customerId)`

- Queries `customers` for a row matching `id`, `company_id`, `is_deleted = false`, **and** `is_hidden = false`.
- If no such row exists (customer is hidden, soft-deleted, or belongs to another company), throws `NotFoundError('Customer', customerId)`.

### 4.3 Ordering rationale

The guards run **after** the `company_id` ownership check and **before** any state transition or RPC invocation. This ensures the mutation is rejected before any financial side effect (journal entry, balance update, allocation change) can occur.

---

## 5. Why This Improves Security / Visibility / Financial Safety

| Dimension | Improvement |
|-----------|-------------|
| **Security (authorization)** | AR Clerks can no longer post/cancel/clear/edit/delete documents for customers outside their assignment scope, even if they obtain a valid document ID. Closes a horizontal privilege-escalation gap on mutating endpoints. |
| **Visibility (data hygiene)** | A customer that has been hidden or soft-deleted can no longer have new financial actions taken against its documents. Hidden/deleted state is now enforced at the point of mutation, not just in list/read views. |
| **Financial safety** | Guards run **before** the `post_receipt` RPC and before any cancellation/clearance/draft mutation, so no journal entry, balance change, or allocation can be created for an inaccessible or invisible customer. Consistent guard placement across all six operations removes the previous asymmetry. |
| **Consistency** | All six mutation paths now share the same two-step guard, matching the existing read-path scoping introduced in Batch 1. |

---

## 6. Commands / Checks Run

| Check | Result |
|-------|--------|
| `deno check backend/supabase/functions/invoices/index.ts` | ✅ Passed |
| `deno check backend/supabase/functions/receipts/index.ts` | ✅ Passed |
| `git diff --check` | ✅ Passed (Windows CRLF warnings only — not errors) |
| `git commit` | ✅ Committed as `de493bb` |

### 6.1 Deployment Status (post-Batch 2C)

| Edge Function | Deployment Status |
|---------------|-------------------|
| `invoices` | ✅ Deployed after Batch 2C |
| `receipts` | ✅ Deployed after Batch 2C |

Both Edge Functions carrying the new guards are live, so the smoke tests in §7 exercise the deployed Batch 2C code.

---

## 7. Smoke Test Checklist and Results

### 7.0 Smoke Test Results Summary (2026-06-12)

| Scenario | Result |
|----------|--------|
| Visible active customer — receipt draft/create flow | ✅ **PASSED** |
| Visible active customer — receipt post flow | ✅ **PASSED** |
| Visible active customer — invoice cancel flow | ✅ **PASSED** |
| AR Clerk assigned customer regression | ✅ **PASSED** |
| AR Clerk unassigned customer rejection | ⬜ **NOT TESTED** |
| Hidden customer negative-path tests | ⬜ **NOT TESTED — fixture required** |

> [!IMPORTANT]
> **Hidden-customer negative-path tests require prepared fixture data. Current evidence is deno-check verified and visible-customer regression verified. Fixture-based negative-path smoke is listed as follow-up.**

The detailed checklist below (§7.1–§7.3) records the per-operation cases. Cells marked ⬜ remain pending execution.

### 7.1 AR Clerk — Access Scope Enforcement (negative cases)

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1 | AR Clerk posts a receipt for an **unassigned** customer | 403 `AuthorizationError` | ⬜ |
| 2 | AR Clerk cancels a receipt for an **unassigned** customer | 403 `AuthorizationError` | ⬜ |
| 3 | AR Clerk clears a cheque for an **unassigned** customer | 403 `AuthorizationError` | ⬜ |
| 4 | AR Clerk cancels an invoice for an **unassigned** customer | 403 `AuthorizationError` | ⬜ |
| 5 | AR Clerk updates a draft invoice for an **unassigned** customer | 403 `AuthorizationError` | ⬜ |
| 6 | AR Clerk deletes a draft invoice for an **unassigned** customer | 403 `AuthorizationError` | ⬜ |

### 7.2 Hidden / Deleted Customer Enforcement (negative cases, full-access role)

> [!NOTE]
> All cases in this subsection are **NOT TESTED — fixture required**. They need prepared `is_hidden = true` / `is_deleted = true` customer fixtures with associated draft/posted documents, which do not exist in the current staging data set.

| # | Test | Expected | Result |
|---|------|----------|--------|
| 7 | Post receipt where customer `is_hidden = true` | 404 `NotFoundError('Customer')` | ⬜ |
| 8 | Post receipt where customer `is_deleted = true` | 404 `NotFoundError('Customer')` | ⬜ |
| 9 | Cancel receipt for hidden/deleted customer | 404 `NotFoundError('Customer')` | ⬜ |
| 10 | Clear cheque for hidden/deleted customer | 404 `NotFoundError('Customer')` | ⬜ |
| 11 | Cancel invoice for hidden/deleted customer | 404 `NotFoundError('Customer')` | ⬜ |
| 12 | Update draft invoice for hidden/deleted customer | 404 `NotFoundError('Customer')` | ⬜ |
| 13 | Delete draft invoice for hidden/deleted customer | 404 `NotFoundError('Customer')` | ⬜ |

### 7.3 Happy-Path Regression (must still succeed)

| # | Test | Expected | Result |
|---|------|----------|--------|
| 14 | Full-access role posts a receipt for a **visible, accessible** customer | ✅ Success — JE created via `post_receipt` | ✅ PASSED |
| 15 | AR Clerk posts a receipt for an **assigned, visible** customer | ✅ Success | ✅ PASSED |
| 16 | Cancel a Posted receipt for a visible customer | ✅ Success | ⬜ |
| 17 | Clear a CHQ Posted receipt for a visible customer | ✅ Success | ⬜ |
| 18 | Cancel an Open invoice for a visible customer | ✅ Success | ✅ PASSED |
| 19 | Update a Draft invoice for a visible customer | ✅ Success | ⬜ |
| 20 | Delete a Draft invoice for a visible customer | ✅ Success | ⬜ |
| 21 | Receipt import auto-create / posting flow | ✅ No regression | ⬜ |

---

## 8. What Was Intentionally NOT Changed

- ❌ **No financial RPC files** were changed (`post_receipt`, `allocate_receipt`, JE-producing functions untouched).
- ❌ **No database migrations** were created or modified.
- ❌ **No import logic** was changed.
- ❌ **No frontend files** were changed.
- ❌ **No direct `allocation_details` inserts** were added.
- ❌ **No manual invoice/receipt balance updates** were added — all balance/JE mutation continues to flow through the existing RPC/service paths.
- ❌ **No changes to `requireCustomerAccess()` or `assertCustomerVisible()`** themselves — they were reused as-is.

---

## 9. Policy Decision and Risks / Follow-Up Items

### 9.1 Policy Decision — Frozen Mutations for Hidden/Deleted Customers

> [!IMPORTANT]
> **Hidden/deleted customer records are frozen from operational financial mutations. If correction is required, the customer must be explicitly restored/unhidden by an authorized role before mutation.**

This makes the guard behaviour an intentional policy rather than an edge-case side effect: once a customer is hidden or soft-deleted, its documents can no longer be posted, cancelled, cleared, or edited/deleted until the customer is restored. This resolves the open question previously logged as follow-up item #4.

### 9.2 Risks / Follow-Up Items

| # | Item | Notes | Priority |
|---|------|-------|----------|
| 1 | Hidden-customer negative-path smoke not yet executed | Requires prepared `is_hidden`/`is_deleted` fixtures (see §7.2). Visible-customer regression and `deno check` are verified | **Required before full sign-off** |
| 2 | Extra DB round-trip per mutation | `assertCustomerVisible()` adds one `customers` lookup per guarded call — negligible, single-row indexed query | Low |
| 3 | Import path not re-verified for hidden/deleted customers | Import logic was out of scope; if imports can target hidden customers, evaluate in a future batch | Recommended |
| 4 | Behavior when a Posted document's customer is later hidden | ✅ **Resolved** — confirmed as intended policy (see §9.1). Cancellation/clearance is intentionally blocked until the customer is restored/unhidden | Resolved |
| 5 | Automated regression tests | No automated test script covers these guards yet; consider adding one in the testing/evidence batch | Recommended |

---

## 10. Relationship to Future Batches

> [!IMPORTANT]
> The following are **separate future batches** and are explicitly **not** part of Batch 2C:
>
> - **Customer Name Validation (Batch 2B-Fix-1B)** — numeric-only / too-short / symbols-only blocking, suffix typo detection, and "Did you mean?" duplicate detection. **Planned**, to follow Batch 2C per the Codex sequencing recommendation.
> - **CASH/OFST Accounting Support (Batch 2B-Fix-2)** — making `bank_account_id` optional and posting against Cash-on-Hand / Offset-Contra GL accounts. **Future reviewed batch** — requires full Codex accounting design and user approval before implementation.
>
> See `docs/plans/batch-2b-fix-logical-receipt-payment-smart-validation-plan.md` for both.

---

*Document created: 2026-06-12*  
*Smoke test status update: 2026-06-12*  
*Batch 2C status: ✅ Implemented · ✅ deno-check verified · ✅ Deployed (invoices + receipts) · 🟡 Partial smoke-tested — visible-customer regression passed, hidden-customer fixture tests pending*  
*Author: Claude (GenAI-assisted development)*
