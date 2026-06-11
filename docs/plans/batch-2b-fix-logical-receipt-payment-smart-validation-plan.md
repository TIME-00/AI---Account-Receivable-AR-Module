# Batch 2B-Fix — Logical Receipt Payment UI and Smart Input Validation Plan

**Date**: 2026-06-10 (revised) · 2026-06-12 (Codex wording corrections applied)  
**Author**: Claude (GenAI-assisted development)  
**Status**: 🟢 Batch 2B-Fix-1A completed · 2B-Fix-1B planned · 2B-Fix-2 future reviewed batch  
**Triggered by**: User testing of Batch 2A + 2B implementation  
**Codex Review**: Approved with minor changes — wording corrections applied (see §1 Codex Recommendation, §3, §6, §9). CASH/OFST no-bank-account classified as unsafe quick fix. **Codex recommends Batch 2C hidden/deleted mutation guards before Batch 2B-Fix-1B.**  
**Scope**: Receipt payment UI clarity, smart input validation, future CASH/OFST accounting design

---

## 1. Executive Summary

During testing of the Batch 2A/2B implementation (GET /bank-accounts + real bank account selector), the user identified four categories of logic and UX issues:

1. **Bank account dropdown is too verbose** — showing bank name + account number + currency + account name in a single line.
2. **Cash payment incorrectly requires bank account** — `CASH` payment method should not logically require a bank account, but the current schema enforces it.
3. **Company receiving bank vs. customer payer bank confusion** — the label does not distinguish company receiving accounts from customer paying banks.
4. **No smart input validation** — the system accepts nonsensical customer names (e.g., "12345") and does not detect common suffix typos (e.g., "SSn Bhd" instead of "Sdn Bhd").

### Codex Review Correction

> [!CAUTION]
> **Codex reviewed this plan and determined that CASH/OFST no-bank-account support is NOT safe as a quick UI fix.**
>
> **Why it cannot be a simple UI change:**
> - Current schema: `receipts.bank_account_id` is `UUID NOT NULL` — the database column does not accept null.
> - Current backend validator: `bank_account_id` is required via `requireString()`.
> - Current `post_receipt` RPC: expects a valid bank account to create the Dr. Bank journal entry line.
> - True CASH support requires: Cash-on-Hand GL account, database/schema decision, `post_receipt` RPC update, and staging smoke tests.
> - True OFST support requires: separate offset/contra accounting design.
>
> **These are full accounting design tasks, not UI tweaks.**

### Revised Batch Structure

| Sub-Batch | Scope | Status |
|-----------|-------|--------|
| **2B-Fix-1A** | UI-only bank selector clarity (label, dropdown, helper text) | ✅ **Completed** |
| **2B-Fix-1B** | Customer name smart validation (frontend + backend) | 🟡 **Planned** — awaiting Codex review + user approval |
| **2B-Fix-2** | CASH/OFST accounting support (schema, validator, RPC, GL) | 🔵 **Future reviewed batch** — requires full Codex review before implementation |

### Codex Recommendation — Sequencing

> [!IMPORTANT]
> **Codex recommends that the next implementation be Batch 2C — hidden/deleted mutation guards — *before* Batch 2B-Fix-1B (Customer Name Validation).**
>
> Mutation guards that prevent operations on hidden/deleted records protect data integrity at a more foundational layer than input-quality validation, so they should land first. Batch 2B-Fix-1B (Customer Name Validation) remains planned and should follow once the 2C guards are in place.

---

## 2. Current Problems Found

### Problem 1: Verbose Bank Account Dropdown

**Current display**: `Maybank — 5142-XXXX-XXXX ({currency}) · Operating Account`  
**Problem**: Too long for a dropdown. Shows internal details (account number) prominently.  
**Expected**: Short label like "Maybank" or "Maybank — Operating Account" if multiple accounts from same bank.  
**Status**: ✅ **Fixed in Batch 2B-Fix-1A** — dropdown shortened, label changed to "Deposit To".

### Problem 2: Cash Payment Requires Bank Account

**Current behavior**: `bank_account_id` is always required in both frontend schema (`frontend/src/lib/receipt-schema.ts` line 46) and backend validator (`backend/supabase/functions/receipts/validators.ts` line 65). The database column is `UUID NOT NULL`.  
**Problem**: Cash payment does not logically go through a bank account. But the entire receipt pipeline (schema, validator, service, RPC, JE creation) assumes `bank_account_id` is always present.  
**Status**: 🟡 **Deferred to Batch 2B-Fix-2** — requires full accounting design, not a UI toggle.

### Problem 3: Company vs. Customer Bank Confusion

**Current behavior**: The "Bank Account" dropdown shows the company's receiving bank accounts.  
**Problem**: Users may confuse this with the customer's paying bank.  
**Status**: ✅ **Partially fixed in Batch 2B-Fix-1A** — label changed to "Deposit To". Payer bank field deferred as future enhancement.

### Problem 4: No Smart Input Validation for Customer Names

**Current behavior**: Backend `validateCustomerName()` exists but only checks length/emptiness. No quality validation.  
**Problem**: Users can create customers named "12345", "abc", or "SSn Bhd" without warning.  
**Status**: 🟡 **Planned for Batch 2B-Fix-1B**.

---

## 3. Correct Business Logic

### A. Payment Method → Bank Account Matrix (Logical Truth)

| Code | Label | Logically Requires Company Bank Account? | Current System Behavior | Notes |
|------|-------|------------------------------------------|------------------------|-------|
| `TT` | Telegraphic Transfer | **Yes** | ✅ Required — correct | Money arrives at company bank |
| `CHQ` | Cheque | **Yes** | ✅ Required — correct | Cheque deposited to company bank |
| `CASH` | Cash | **No** — cash-on-hand | ⚠️ Required — **logically incorrect** | Requires full accounting design to fix |
| `CC` | Credit Card | **Yes** | ✅ Required — correct | Settlement to merchant account |
| `GIRO` | Direct Debit / GIRO | **Yes** | ✅ Required — correct | Credited to company bank |
| `OFST` | Offset / Contra | **No** — no money movement | ⚠️ Required — **logically incorrect** | Requires separate offset accounting design |
| `ONLN` | Online Payment | **Yes** | ✅ Required — correct | Settled to company bank |

### B. Why CASH/OFST Cannot Be a Simple UI Fix

> [!WARNING]
> **The following constraints make `bank_account_id` optional support a multi-layer change:**
>
> 1. **Database schema**: `receipts.bank_account_id` is `UUID NOT NULL`. Making it nullable requires a migration.
> 2. **Backend validator**: `requireString(body.bank_account_id, 'bank_account_id')` — always enforced. Requires conditional logic.
> 3. **Receipt service**: `createReceipt()` calls `fetchById('bank_accounts', data.bank_account_id)` — will throw on null.
> 4. **`post_receipt` RPC**: Reads `bank_account_id` to determine the Dr. Bank GL account for the journal entry line. Null would cause an error or produce an incorrect JE.
> 5. **Accounting design**: CASH receipts need a Cash-on-Hand GL account. OFST receipts need an Offset/Contra GL account. These GL accounts may not exist in the current chart of accounts.
>
> **This is not a bug fix — it is an accounting feature.**

### C. Interim Approach (Current System)

Until Batch 2B-Fix-2 is implemented:
- All payment methods continue to require a bank account selection.
- The "Deposit To" label clarifies what the dropdown means.
- Users creating CASH receipts select the company's default bank account as a workaround.
- The JE debits the bank account regardless of payment method. For CASH this is an accounting correctness issue (wrong debit GL account), even though AR balances stay correct. This is acceptable only as a controlled prototype limitation and should not be used for real cash accounting.

### D. Company Receiving Bank vs. Customer/Payer Bank

| Concept | Current Schema | UI Label (after 2B-Fix-1A) |
|---------|---------------|---------------------------|
| **Company receiving bank** | `receipts.bank_account_id` → `bank_accounts` table | "Deposit To" |
| **Customer payer bank** | Not in schema | Future enhancement — optional free-text field |

---

## 4. Batch 2B-Fix-1A — UI-Only Bank Selector Clarity (✅ Completed)

**Status**: ✅ **Completed and safe — no backend/RPC/database changes.**

### Changes Made

| Change | Detail |
|--------|--------|
| Label changed to **"Deposit To"** | Clarifies this is the company's receiving account |
| Dropdown label shortened | Shows bank name only, or bank name + account name if multiple accounts from same bank |
| Selected account helper text shown | After selection, secondary text shows account number and currency |
| `bank_account_id` remains required | No schema, validator, or RPC changes |

### What Was NOT Changed

- No backend changes.
- No database schema changes.
- No `post_receipt` RPC changes.
- No validation rule changes.
- `bank_account_id` is still `UUID NOT NULL` in the database.
- `bank_account_id` is still required in the frontend Zod schema and backend validator.

---

## 5. Batch 2B-Fix-1B — Customer Name Smart Validation (🟡 Planned)

**Status**: 🟡 Awaiting Codex review + user approval  
**Category**: Should Fix Before Smart Automation  
**Goal**: Prevent bad master data before fuzzy matching and import automation layers are built.

### Frontend Validation (Immediate Feedback)

| Rule | Type | UX Response |
|------|------|-------------|
| Name is numeric-only (e.g., "12345") | **Block** | Error: "Company name cannot be numeric only" |
| Name is too short (< 3 characters) | **Block** | Error: "Company name must be at least 3 characters" |
| Name is symbols-only (e.g., "###") | **Block** | Error: "Company name must contain letters" |
| Name contains common suffix typo | **Warn + suggest** | Warning: "Did you mean 'Sdn Bhd'?" with correction button |
| Name is suspiciously short for a company | **Warn** | Warning: "Company name seems unusually short" |

### Common Suffix Typo Detection

| Typed | Suggestion | Region |
|-------|-----------|--------|
| `SSn Bhd`, `Sdn bhd`, `SDN BHD`, `Sdnbhd`, `Sdn. Bhd` | `Sdn Bhd` | Malaysia |
| `Pte. Ltd`, `PTE LTD`, `Ptd Ltd`, `Pty Ltd` (if MY context) | `Pte Ltd` | Singapore |
| `Berhard`, `Berhd` | `Berhad` | Malaysia |
| `Sdn. Bhd.` (with periods) | `Sdn Bhd` (standardized) | Malaysia |

**Implementation**: Rule-based string matching — not ML. Lightweight and deterministic.

### Fuzzy Customer Duplicate Detection

When creating a new customer (inline or via customer management):

1. After user types ≥ 3 characters of customer name, search existing customers with normalized name comparison.
2. If a similar customer exists (e.g., "ABC Sdn Bhd" vs. "ABC SDN BHD"), show **"Did you mean?"** suggestion.
3. User can: select existing customer, or confirm creating a new one.
4. This prevents accidental duplicate master data creation.
5. Uses existing `normalized_customer_name` column for matching.

**Not a hard block** — the user can always confirm and proceed with a new customer. The system warns, not forces.

### Implementation Items

| Item | Owner | Files |
|------|-------|-------|
| Frontend: numeric-only, too short, symbols-only validation | Claude | Inline customer creation forms |
| Frontend: suffix typo detection with suggestions | Claude | New utility function + form integration |
| Frontend: "Did you mean?" existing customer suggestion | Claude | Inline customer creation + existing `normalized_customer_name` search |
| Backend: add name quality rules to `validateCustomerName()` | Codex | `backend/supabase/functions/customers/validators.ts` |

### Acceptance Criteria

| # | Test | Expected | Status |
|---|------|----------|--------|
| 1 | Enter "12345" as customer name | Error: "Company name cannot be numeric only" | ⬜ |
| 2 | Enter "AB" as customer name | Error: "Company name must be at least 3 characters" | ⬜ |
| 3 | Enter "###" as customer name | Error: "Company name must contain letters" | ⬜ |
| 4 | Enter "ABC SSn Bhd" as customer name | Warning: "Did you mean 'ABC Sdn Bhd'?" | ⬜ |
| 5 | Enter "ABC Sdn Bhd" when similar customer exists | "Did you mean?" suggestion shown | ⬜ |
| 6 | Confirm new customer despite "Did you mean?" | Customer created successfully | ⬜ |
| 7 | Select existing customer from "Did you mean?" | Existing customer selected, no duplicate | ⬜ |
| 8 | Import with customer auto-create still works | No regression | ⬜ |
| 9 | `npm.cmd run build` passes | No TypeScript errors | ⬜ |

---

## 6. Batch 2B-Fix-2 — CASH/OFST Accounting Support (🟡 Requires Codex Design)

**Status**: 🟡 Requires full Codex review and accounting design before implementation  
**Category**: Should Fix Before Smart Automation (if CASH receipts are part of demo)  
**Goal**: Allow CASH and OFST receipts without requiring a bank account.

> [!CAUTION]
> **Do NOT implement this batch without Codex review and user approval.**
> This is a multi-layer change affecting schema, validator, service, RPC, and JE creation.

### What Needs to Be Designed

| Layer | Current State | Required Change | Risk |
|-------|-------------- |----------------|------|
| **Database schema** | `receipts.bank_account_id UUID NOT NULL` | Make nullable: `ALTER TABLE receipts ALTER COLUMN bank_account_id DROP NOT NULL` | Low (migration) |
| **Backend validator** | `requireString(body.bank_account_id)` always | Conditional: required for TT/CHQ/CC/GIRO/ONLN, optional for CASH/OFST | Medium |
| **Receipt service** | `fetchById('bank_accounts', data.bank_account_id)` always | Skip lookup when null | Medium |
| **`post_receipt` RPC** | Reads bank account for Dr. Bank JE line | CASH: use Cash-on-Hand GL account. OFST: use Offset/Contra GL account | **High** |
| **GL account setup** | May not have Cash-on-Hand or Offset accounts | Require seeding or configuration | Medium |
| **Frontend schema** | `bank_account_id` required in Zod | Conditional based on `payment_method` | Low |
| **Frontend UI** | Bank dropdown always visible | Hide for CASH/OFST | Low |

### Codex Design Questions (Must Be Answered Before Implementation)

| # | Question | Notes |
|---|----------|-------|
| 1 | Does the current chart of accounts have a Cash-on-Hand GL account? | If not, what account code should be used? |
| 2 | Does the current chart of accounts have an Offset/Contra GL account? | If not, what account code should be used? |
| 3 | How does `post_receipt` RPC determine the debit GL account? | Currently from `bank_accounts.gl_account_id`? Or hardcoded? |
| 4 | Can the RPC accept a GL account override for CASH/OFST? | Or should it look up a system default by payment method? |
| 5 | Should CASH/OFST receipts use a system-configured default account? | e.g., company settings table with `cash_on_hand_gl_account_id` |
| 6 | What migration number is next? | Confirm sequence after 013. |
| 7 | Does the import pipeline need CASH/OFST support? | If receipts can be imported with CASH payment method |

### Interim Workaround (Current)

Until this batch is implemented, CASH receipts select the company's default bank account. This posts the JE against the bank GL account (Dr. Bank) instead of Dr. Cash-on-Hand. **This is an accounting correctness issue**: even though the receipt amount, allocation, and customer (AR) balance all remain correct, the debit GL account is wrong, so the cash position and bank reconciliation would be misstated. **This is acceptable only as a controlled prototype limitation and should not be used for real cash accounting.**

---

## 7. Scope Classification (Revised)

| Item | Classification | Status |
|------|---------------|--------|
| Bank dropdown shorter label | ✅ **Completed** (2B-Fix-1A) | Done |
| Bank dropdown label rename ("Deposit To") | ✅ **Completed** (2B-Fix-1A) | Done |
| Selected account helper text | ✅ **Completed** (2B-Fix-1A) | Done |
| `bank_account_id` remains required (no backend change) | ✅ **Completed** (2B-Fix-1A) | Done |
| Numeric/short/symbol customer name validation | **Should Fix Before Smart Automation** (2B-Fix-1B) | Planned |
| Suffix typo detection + suggestions | **Should Fix Before Smart Automation** (2B-Fix-1B) | Planned |
| "Did you mean?" duplicate customer detection | **Should Fix Before Smart Automation** (2B-Fix-1B) | Planned |
| CASH no-bank-account support (schema + validator + RPC + GL) | **Should Fix Before Smart Automation** (2B-Fix-2) | Requires Codex design |
| OFST no-bank-account support (schema + accounting design) | **Should Fix Before Smart Automation** (2B-Fix-2) | Requires Codex design |
| Payer bank free-text field | **Future Enhancement** | Deferred |

---

## 8. Backend/API Impact Summary (Revised)

| Area | 2B-Fix-1A | 2B-Fix-1B | 2B-Fix-2 |
|------|-----------|-----------|----------|
| Receipt validator | No change | No change | Conditional `bank_account_id` |
| Receipt service | No change | No change | Skip bank lookup for CASH/OFST |
| `post_receipt` RPC | No change | No change | Handle null `bank_account_id` — **high risk** |
| Database schema | No change | No change | `ALTER COLUMN bank_account_id DROP NOT NULL` |
| Customer validator | No change | Add name quality rules | No change |
| Bank-accounts API | No change | No change | No change |
| Receipt import | No change | No change | May need CASH/OFST handling |

---

## 9. Codex Handoff Notes

> [!WARNING]
> **Codex must read these notes before implementing any sub-batch.**

### Batch 2B-Fix-1A (✅ Completed — No Codex Action Needed)

UI-only changes. No backend, RPC, schema, or migration changes. Safe.

### Batch 2B-Fix-1B (Customer Name Validation)

**Backend change**: Extend `validateCustomerName()` in `customers/validators.ts`:
- Reject numeric-only strings (`/^\d+$/`).
- Reject strings shorter than 3 characters.
- Reject symbol-only strings (`/^[^a-zA-Z]+$/`).
- This is validation-only — no service logic, RPC, or schema change.
- **Must not break import customer auto-create** — import sends real customer names, not "12345".

> [!NOTE]
> **Prototype limitation (symbol-only check)**: The `/^[^a-zA-Z]+$/` style check only accepts names containing at least one A–Z Latin letter. This is acceptable for this MY/SG English-language prototype, but it may reject valid non-English business names (e.g., names written in CJK, Tamil, or other non-Latin scripts). This is documented as a known prototype limitation, not a production-ready internationalised validator.

**What NOT to do**:
- Do NOT change `normalizeCustomerName()` behavior.
- Do NOT change the customer service create/update logic.
- Do NOT add suffix correction in the backend — that is a frontend UX feature (warn + suggest, not block).

### Batch 2B-Fix-2 (CASH/OFST Accounting)

**This batch requires Codex to design the solution first.** Claude cannot plan the GL account mapping or RPC changes.

**What NOT to do**:
- Do NOT simply remove the `NOT NULL` constraint without updating the RPC.
- Do NOT skip the bank JE line for CASH — use a Cash-on-Hand GL account instead.
- Do NOT break TT/CHQ/CC/GIRO/ONLN receipt posting — these must remain unchanged.
- Do NOT break receipt import.
- Do NOT break Create & Post receipt.
- Do NOT directly mutate financial fields outside approved RPC/service logic.

**Payment method logic must be tested after 2B-Fix-2**:

| Code | Create Receipt | Post Receipt | Expected |
|------|---------------|-------------|----------|
| `TT` | With bank_account_id | Normal bank JE | Unchanged |
| `CHQ` | With bank_account_id + cheque_date + reference_no | Cheques-on-Hand JE | Unchanged |
| `CASH` | Without bank_account_id | Cash-on-Hand JE | **New behavior** |
| `CC` | With bank_account_id | Normal bank JE | Unchanged |
| `GIRO` | With bank_account_id | Normal bank JE | Unchanged |
| `OFST` | Without bank_account_id | Offset/Contra JE | **New behavior** |
| `ONLN` | With bank_account_id | Normal bank JE | Unchanged |

---

## 10. Approval Gate

| Gate | Status |
|------|--------|
| **2B-Fix-1A**: Claude UI changes completed | ✅ Done |
| **2B-Fix-1A**: No backend changes needed | ✅ Confirmed |
| **2B-Fix-1B**: Codex reviews customer name validation plan | ⬜ Pending |
| **2B-Fix-1B**: User approves implementation | ⬜ Pending |
| **2B-Fix-2**: Codex designs CASH/OFST accounting approach | ⬜ Pending |
| **2B-Fix-2**: Codex reviews schema + RPC changes | ⬜ Pending |
| **2B-Fix-2**: User approves implementation | ⬜ Pending |

> **No implementation should start for 2B-Fix-1B or 2B-Fix-2 without Codex review and user approval.**

---

*Plan created: 2026-06-10T01:51:44+08:00*  
*Codex review: 2026-06-10 — CASH/OFST classified as unsafe quick fix*  
*Revised: 2026-06-10T20:19:59+08:00*  
*Codex re-review: 2026-06-12 — approved with minor changes; wording corrections applied (CASH/OFST prototype limitation, repo-relative paths, symbol-only validation note, Batch 2C sequencing recommendation)*  
*Status: 2B-Fix-1A ✅ completed · 2B-Fix-1B planned · 2B-Fix-2 future reviewed batch*  
*Author: Claude (GenAI-assisted development)*
