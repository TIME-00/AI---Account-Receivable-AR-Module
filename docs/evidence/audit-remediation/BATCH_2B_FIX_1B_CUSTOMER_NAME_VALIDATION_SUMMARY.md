# Batch 2B-Fix-1B — Customer Name Validation Summary

**Date**: 2026-06-12  
**Batch**: 2B-Fix-1B (Customer Name Smart Validation)  
**Status**: ✅ Implemented · ✅ `deno check` + `npm run build` verified · ✅ Smoke-tested · ✅ Committed & pushed  
**Commit**: `bfc41ea` — "Strengthen customer name validation"  
**Plan Reference**: `docs/plans/batch-2b-fix-logical-receipt-payment-smart-validation-plan.md` (§5 Batch 2B-Fix-1B). Sequenced **after** Batch 2C hidden/deleted mutation guards per the Codex recommendation in that plan.

---

## 1. Purpose

Batch 2B-Fix-1B prevents low-quality customer master data from entering the system before the fuzzy-matching and import-automation layers are built on top of it. Previously the customer create path accepted nonsensical names (e.g., `12345`, `dedaed`, `qwerty`, `test`) with only minimal length/emptiness checks. This batch strengthens validation on **both** the frontend (immediate UX feedback) and backend (authoritative payload validation), while preserving the helpful "did you mean?" suffix suggestions and the similar-customer warning.

Better master data quality at creation time directly improves the reliability of later AR automation (matching receipts to customers, import auto-create, aging by customer), so this is a foundational data-hygiene batch.

---

## 2. Scope

| # | Item | Status |
|---|------|--------|
| 1 | Stricter **frontend** customer name validation | ✅ Done |
| 2 | Stricter **backend** customer create payload validation | ✅ Done |
| 3 | Block weak/random single-token names (`dedaed`, `dwadae`, `abcde`, `qwerty`, `asdfgh`, `test`, `demo`, `sample`, `unknown`, `customer`, …) | ✅ Done |
| 4 | Business-name quality rules (numeric-only, too-short, symbols-only, mostly-repeated chars) | ✅ Done |
| 5 | Allow proper business names carrying legal/business signals (`Sdn Bhd`, `Berhad`, `Trading`, `Services`, `Resources`, `Holdings`, …) | ✅ Done |
| 6 | Allow short/single-token real names **only when `registration_no` is provided** | ✅ Done |
| 7 | Keep suffix typo suggestions (e.g., `SSn Bhd` → `Sdn Bhd`) | ✅ Retained |
| 8 | Keep similar-visible-customer warning | ✅ Retained |
| 9 | Hidden customers remain excluded from duplicate/similar suggestions (matching uses the **visible** customer list only) | ✅ Confirmed |

---

## 3. Files Changed

| File | Layer | Change |
|------|-------|--------|
| `frontend/src/lib/customer-name-validation.ts` | Frontend | **New** shared module — quality validation, business-name signal detection, suffix-typo suggestions, and similar-visible-customer matching |
| `frontend/src/components/features/customers/customer-combobox-with-create.tsx` | Frontend | Wires the new validation into the inline "create customer" combobox: inline blocking error, disabled submit, and `CustomerNameHints` (suffix suggestion + similar-customer) |
| `backend/supabase/functions/_shared/validators.ts` | Backend | Strengthened `validateCustomerName()` base rules (min length, numeric-only on compacted string, must-include-letters, mostly-repeated-characters) |
| `backend/supabase/functions/customers/validators.ts` | Backend | Added `validateCreateCustomerNameQuality()` — weak single-token blocklist + business-name-signal requirement (bypassed by `registration_no`) |

---

## 4. Validation Rules Added

### 4.1 Base quality rules — `validateCustomerName()` (backend, both create & update) and `validateCustomerNameQuality()` (frontend)

| Rule | Reject condition | Message (gist) |
|------|------------------|----------------|
| Minimum length | normalized length `< 3` | "must be at least 3 characters" |
| Numeric-only | `/^\d+$/` on whitespace-compacted value | "cannot be numeric only" |
| Must include letters | no Latin **or CJK** letter present | "must include letters" |
| Mostly repeated characters | all alphanumeric chars identical (e.g., `@@@@`, `aaaa`) | "cannot be mostly repeated characters" |
| Allowed character set | contains special chars outside the allowed set | "contains disallowed special characters" |

> Names are normalized (`trim` + collapse internal whitespace) before checks, so the rules apply to the canonical form.

### 4.2 Create-only quality rules — `validateCreateCustomerNameQuality()` (backend) / `enforceBusinessName` (frontend modal)

| Rule | Behavior |
|------|----------|
| **Weak single-token blocklist** | A name reducing to a single token in `WEAK_SINGLE_TOKEN_NAMES` (`abcde`, `asdfgh`, `customer`, `dedaed`, `demo`, `dwadae`, `lkjhg`, `qweasd`, `qwerty`, `random`, `sample`, `test`, `testing`, `unknown`) is **always blocked** — even if `registration_no` is supplied. |
| **Business-name signal requirement** | If no `registration_no` is provided, the name must show a business signal: **≥ 2 meaningful words**, *or* a single word that is a recognised business keyword (`sdn`, `bhd`, `berhad`, `trading`, `services`, `resources`, `holdings`, `enterprise`, `pte`, `ltd`, …). |
| **`registration_no` override** | When `registration_no` is present, the business-signal requirement is skipped, allowing legitimate short/single-token real names (the weak blocklist still applies). |

Both blocking conditions raise the same message: *"Customer name looks incomplete or invalid. Please enter a proper company name such as ABC Trading Sdn Bhd, or provide a registration number."*

### 4.3 Suffix typo suggestions (frontend, non-blocking)

Pattern-based suggestions (e.g., `SSn Bhd`, `Sdnbhd`, `Sdn. Bhd.` → `Sdn Bhd`; `Pty Ltd`, `Ptd Ltd` → `Pte Ltd`). Surfaced as a "Did you mean …?" hint with a one-click apply button — never a hard block.

---

## 5. Frontend UX Behavior

- **Inline combobox query**: as the user types a new customer name, base quality rules run on the query. If the name is blocking, the "create new customer" action is suppressed and a small red inline error is shown. (Business-name enforcement is **not** applied at the free-type query stage — only base quality gates the create affordance.)
- **Quick-create modal**: the Customer Name field runs the full check with `enforceBusinessName: true`, passing the entered `registration_no`. A blocking error:
  - renders a red field error and red border,
  - disables the **Create** submit button,
  - short-circuits `submitQuickCreate()` before any API call.
- **`CustomerNameHints`** (below the name field) renders:
  - an amber **"Did you mean `<suggestion>`?"** chip (suffix typo) with one-click apply, and
  - a sky-blue **"Similar visible customer found: `<name>` (`<id>`)"** chip that selects the existing customer instead of creating a duplicate.
- **Hidden customers excluded**: similar-customer matching runs over `visibleCustomers` only, so hidden/soft-deleted customers never appear as suggestions or as duplicate warnings.

---

## 6. Backend Validation Behavior

- `validateCustomerName()` (in `_shared/validators.ts`) enforces the **base quality rules** (§4.1) and is called on **both** `validateCreateCustomer()` and `validateUpdateCustomer()`.
- `validateCreateCustomerNameQuality()` (in `customers/validators.ts`) enforces the **create-only** rules (§4.2 — weak-token blocklist + business-name signal) and is invoked **only on create**, after `registration_no` is parsed.
- The backend is the **authoritative gate**: even if a frontend check is bypassed, the API rejects a non-conforming `customer_name` with a `ValidationError` (field: `customer_name`).
- **Prototype scoping note**: the rule-set is explicitly tuned for MY/SG English-language company names (in-code comment). The letter check accepts CJK ranges, but the business-keyword list and blocklist are English-oriented — documented as a known prototype limitation, consistent with the Batch 2B-Fix plan.

> **Scope detail (accurate):** the create-only business-signal / weak-token rules apply to **customer create**. `validateUpdateCustomer()` runs the strengthened base rules but does **not** re-run the business-signal requirement, so an existing customer rename is held to the base quality bar, not the full create-time bar.

---

## 7. Commands / Checks Run

| Check | Result |
|-------|--------|
| `deno check backend/supabase/functions/customers/index.ts` | ✅ Passed |
| `npm.cmd run build` (frontend) | ✅ Passed — no TypeScript errors |
| `git diff --check` | ✅ Passed (Windows CRLF warnings only — not errors) |
| `git commit` | ✅ Committed as `bfc41ea` |
| `git push` | ✅ Pushed |

---

## 8. Smoke Test Checklist and Results

### 8.1 Blocking (rejected) cases

| # | Input | Expected | Result |
|---|-------|----------|--------|
| 1 | `dedaed` | Blocked (weak single-token) | ✅ PASSED |
| 2 | `dwadae` | Blocked (weak single-token) | ✅ PASSED |
| 3 | `12345` | Blocked (numeric-only) | ✅ PASSED |
| 4 | `@@@@` | Blocked (no letters / mostly repeated) | ✅ PASSED |
| 5 | `A` | Blocked (too short) | ✅ PASSED |

### 8.2 Allowed (accepted) cases

| # | Input | Expected | Result |
|---|-------|----------|--------|
| 6 | `ABC Trading Sdn Bhd` | Allowed (business signal) | ✅ PASSED |
| 7 | `TSH Synergy Sdn Bhd` | Allowed (business signal) | ✅ PASSED |

### 8.3 Suggestion / warning (non-blocking) cases

| # | Input | Expected | Result |
|---|-------|----------|--------|
| 8 | `ABC Trading SSn Bhd` | Shows "Did you mean `… Sdn Bhd`?" suggestion | ✅ PASSED |
| 9 | Name matching an existing **visible** customer | Similar-visible-customer warning shown | ✅ PASSED |

### 8.4 Regression (must still work)

| # | Flow | Expected | Result |
|---|------|----------|--------|
| 10 | New Invoice → quick customer create | Works | ✅ PASSED |
| 11 | New Receipt → quick customer create | Works | ✅ PASSED |
| 12 | Existing customer selection | Works | ✅ PASSED |

**All 12 smoke tests passed.**

---

## 9. What Was Intentionally NOT Changed

- ❌ **No financial RPC files** were changed (`post_receipt`, `allocate_receipt`, JE-producing functions untouched).
- ❌ **No database migrations** were created or modified.
- ❌ **No import auto-post / allocation logic** was changed.
- ❌ **No changes to `normalizeCustomerName()` semantics** beyond consolidating the frontend helper into `normalizeCustomerDisplayName()` (same trim + whitespace-collapse behavior).
- ❌ **No backend suffix auto-correction** — suffix suggestion remains a frontend, opt-in UX feature (warn + suggest, never auto-rewrite).
- ❌ **No changes to customer service create/update business logic** — validation only.
- ❌ **No changes to the hidden/deleted visibility model** — similar-customer matching continues to read the visible list only.

---

## 10. Risks and Follow-Up Items

| # | Item | Notes | Priority |
|---|------|-------|----------|
| 1 | English-oriented keyword/blocklist | Tuned for MY/SG English names; may not recognise business signals in other languages/scripts. Documented prototype limitation | Recommended |
| 2 | Static blocklist maintenance | `WEAK_SINGLE_TOKEN_NAMES` is a fixed list; novel gibberish single tokens (not in the list, no business signal) are caught by the business-signal rule only when no `registration_no` is supplied | Low |
| 3 | Update path is held to base rules only | Renaming an existing customer does not re-run the create-time business-signal check (§6). Confirm this is acceptable, or extend to update if needed | Review |
| 4 | Duplicate matching is heuristic | `findSimilarVisibleCustomer()` is substring/canonical-key based, not full fuzzy matching; false negatives possible. Full fuzzy matching is a separate future batch | Recommended |
| 5 | Automated tests | Validation is currently smoke-tested manually; consider unit tests for the rule matrix in the testing/evidence batch | Recommended |

---

## 11. Relationship to Future Batches

> [!IMPORTANT]
> The following remain **separate future batches** and are explicitly **not** part of Batch 2B-Fix-1B:
>
> - **CASH/OFST Accounting Support (Batch 2B-Fix-2)** — making `bank_account_id` optional and posting against Cash-on-Hand / Offset-Contra GL accounts. Future reviewed batch; requires full Codex accounting design and user approval.
> - **Full fuzzy matching** — robust similarity scoring for customer deduplication and receipt-to-customer matching, beyond the current substring/canonical heuristic.
> - **OCR import** — document/image ingestion with a review screen.
> - **Fully automatic posting** — controlled auto-post of matched receipts/invoices.
>
> This batch delivers only the customer name **validation + lightweight suggestion** layer that those future batches will build upon.

---

*Document created: 2026-06-12*  
*Batch 2B-Fix-1B status: ✅ Implemented · ✅ Build/type verified · ✅ 12/12 smoke tests passed · ✅ Committed & pushed (`bfc41ea`)*  
*Author: Claude (GenAI-assisted development)*
