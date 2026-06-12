# Batch 5 — Discount / Bank Charge / Short Payment Handling Plan

**Date**: 2026-06-12 · Codex review applied 2026-06-12  
**Author**: Claude (GenAI-assisted development)  
**Status**: 🟢 Codex **Approved with changes** — corrections applied; ready for user approval to implement  
**Goal**: Handle short-payment cases (discount, bank charge, underpayment) logically and safely — never collapsing distinct accounting events into one. (Write-off / adjustment is out of scope — future batch.)  
**Plan type**: Documentation / implementation plan only. **No code changes in this document.**  
**Codex changes applied**: discount validation is mathematical-only — no config/migration/hard cap, large-discount flag is warning-only (§3.2); exact A/B/C row outcomes defined (§2.1); import discount is explicit-file-only, never inferred (§2.1-B, §6); bank charge is diagnostics-only with `bank_charge_review_reason` / `bank_charge_posting_required`, no JE (§2.1-C, §4); write-off removed from scope; smoke tests + acceptance criteria updated.

---

## 0. Critical Current-State Finding (Read First)

> [!IMPORTANT]
> **Discount is already implemented end-to-end (except import). Bank charge is NOT wired anywhere — only a GL account shell exists.** These two must be treated as **different accounting events**, exactly as the brief requires.

| Capability | State | Evidence |
|------------|-------|----------|
| `allocate_receipt` RPC accepts `discount_amount` | ✅ Implemented | `p_allocations` element `{invoice_id, amount, discount_amount}`; validates `amount + discount ≤ outstanding + 0.01`; posts **Discount JE** (Dr `6100-001` Sales Discount, Cr AR control). |
| `AllocationService.manualAllocate()` accepts `discount_amount` | ✅ Implemented | `ManualAllocationInput.allocations[].discount_amount`; passed straight to the RPC. |
| Frontend wizard exposes `discount_amount` | ✅ Implemented | `use-allocation-logic.ts` (`updateDiscount`, per-line validation `amount + discount ≤ outstanding`, `buildPayload`); `allocation-table.tsx` has a **Discount** input column. |
| Discount JE logic | ✅ Implemented | RPC discount-JE block + `AllocationService.createDiscountJE()`; `default_discount_acct` → `6100-001 Sales Discount` (config-seeded). |
| **Import** parses/passes `discount_amount` | ❌ **Not implemented** | `imports/service.ts` does **not** parse or pass any discount field. |
| Discount mathematical validation | ✅ Enforced | RPC checks `discount ≥ 0` (DB `chk_alloc_discount`) and `amount + discount ≤ outstanding`. |
| Discount **large-amount config cap** | ❌ Not present, and **not added in Batch 5** | There is **no config key and no migration** for a discount cap. Batch 5 adds **warning-only** large-discount diagnostics for import — never a hard financial block (§3.2). |
| **Bank charge** handling | ⚠️ **Account shell only** | `6300-001 Bank Charges (Expense)` exists in the seed COA, **but** there is **no config key, no RPC parameter, no service/import field, and no JE logic** referencing it. Effectively unwired. |
| Write-off / adjustment mechanism | ❌ **Not implemented** | No short-payment write-off path exists. |
| Short payment (underpayment, no discount) | ✅ **Already safe** | Partial allocation leaves the invoice `Partially Paid` with remaining `outstanding` (RPC status logic). No silent "Paid". |

**Consequence for Batch 5 scope.** The financial engine already settles invoices via discount safely; underpayment already leaves invoices partially paid. Batch 5 therefore focuses on:
1. **Receipt import support for an explicit `discount_amount`** — parse it *only when the CSV/XLSX provides it*, validate it mathematically, and pass it through the existing safe `manualAllocate()` / `allocate_receipt`. Discount is **never inferred** from a short-payment difference.
2. **Short-payment diagnostics** in `mapped_data` (`short_payment_detected`, `difference_amount`, `suggested_reason`, `review_required`).
3. **Bank-charge diagnostics only** — a distinct, review-required event with **no JE, no discount substitution, no auto-settlement**, because no GL plumbing exists yet.
4. **Frontend clarity** distinguishing discount from bank charge and surfacing the difference + review-required state.

**Write-off / adjustment is out of scope** for Batch 5 (future batch). No write-off fields or behavior are added.

> [!WARNING]
> **Do not auto-treat a short-payment difference as discount.** A difference may be discount, bank charge, write-off, or plain underpayment — each is a different accounting event. Bank charge must stay **review-required** until a GL-safe design is approved (§4). Discount is applied **only** when an explicit `discount_amount` is supplied — never inferred.

### Batch 5 Definitive Implementation Scope (post-Codex review)

Batch 5 implementation is limited to exactly the following:

**A. Receipt import support for explicit `discount_amount`** — parse `discount_amount` *only when the import file provides it*; validate (`discount_amount ≥ 0`, `allocation_amount ≥ 0`, `allocation_amount + discount_amount ≤ invoice outstanding`); pass it through `manualAllocate()` / `allocate_receipt`. No inference from short payment.

**B. Short-payment diagnostics (`mapped_data`)** — `short_payment_detected`, `difference_amount`, `suggested_reason`, `review_required` where appropriate.

**C. Bank-charge diagnostics only** — no bank-charge accounting, no discount substitution, no RPC/schema change.

**D. Frontend clarity** — show short payment / difference amount; clearly distinguish discount from bank charge; show review-required diagnostics in receipt import results.

**Explicitly NOT in scope:** new config keys, database migrations, bank-charge JE, write-off/adjustment fields, hard discount caps, RPC changes, OCR, fuzzy matching, fully automatic posting.

### Prohibitions (apply throughout Batch 5)

- ❌ Do not directly insert `allocation_details`.
- ❌ Do not directly update `invoices.outstanding`.
- ❌ Do not directly update `receipts.allocated_amount` or `receipts.unallocated_amount`.
- ❌ Do not treat bank charge as discount automatically.
- ❌ Do not create a bank-charge journal entry in Batch 5.
- ❌ Do not infer `discount_amount` from a short-payment difference.
- ❌ Do not change financial RPCs.
- ❌ Do not create migrations or new config keys.
- ❌ Do not implement OCR.
- ❌ Do not implement fuzzy matching.
- ❌ Do not implement fully automatic posting.

---

## 1. Existing Capability Review

| Question | Finding |
|----------|---------|
| Does `allocate_receipt` already support `discount_amount`? | **Yes** — per-allocation `discount_amount`; validates `amount + discount ≤ outstanding`; posts a Sales Discount JE. |
| Does `AllocationService.manualAllocate()` accept `discount_amount`? | **Yes** — `ManualAllocationInput.allocations[].discount_amount`, forwarded to the RPC. |
| Does import currently parse or pass `discount_amount`? | **No** — the receipt import path has no discount field. |
| Does the frontend Allocation Wizard expose `discount_amount`? | **Yes** — a Discount column per allocation line, with `amount + discount ≤ outstanding` validation. |
| Does current journal-entry logic support discount correctly? | **Yes** — Dr `6100-001 Sales Discount`, Cr AR control, posted as a separate JE by the RPC (and mirrored by `createDiscountJE`). |
| Is there any existing bank charge / adjustment mechanism? | **No. Bank charge is not currently wired as an accounting event.** A `6300-001 Bank Charges` expense account exists in the COA, but nothing maps or posts to it; there is no bank-charge or write-off field/RPC/JE. **Batch 5 must not create a bank-charge JE and must not change financial RPCs.** |

---

## 2. Short Payment Scenarios — Expected Behavior

| # | Scenario | Expected behavior | Already correct? |
|---|----------|-------------------|------------------|
| 1 | Receipt amount **==** invoice outstanding | Full settlement; invoice `Paid`. | ✅ |
| 2 | Receipt **<** outstanding, **no** discount/adjustment | Allocate received amount only; invoice stays **`Partially Paid`** with remaining outstanding; **never auto-"Paid"**. | ✅ |
| 3 | Receipt **<** outstanding, **explicit valid** `discount_amount` | Settle via existing RPC when `amount + discount ≤ outstanding`; invoice `Paid` when they sum to outstanding; Discount JE posted. Discount applies **only** when explicitly supplied — never inferred. | ✅ (manual) |
| 4 | Receipt **<** outstanding due to **bank charge** | **Do not treat as discount.** Allocate only the received amount; invoice stays `Partially Paid` for the difference; flag `short_payment_detected`, `suggested_reason = 'bank_charge'`, `review_required = true`, `bank_charge_posting_required = true`. **No JE.** | ⚠️ New (no bank-charge plumbing) |
| 5 | Import row: `invoice_reference` + `allocation_amount` **<** outstanding | Allocate only `allocation_amount`; invoice stays `Partially Paid`; record `short_payment_detected` + `difference_amount`. | ✅ allocation; ⚠️ diagnostics new |
| 6 | Import row: explicit `discount_amount` supplied in the file | Validate and pass through the existing safe discount flow (`manualAllocate()` / RPC). **Only** when the file provides it. | ⚠️ New (import discount, explicit-only) |
| 7 | User tries to force **Paid** without valid discount/adjustment | **Blocked** — invoice can only reach `Paid` through the RPC when `amount (+ valid discount) == outstanding`. No manual status override. | ✅ |

### 2.1 Exact Row Outcomes (definitive — use consistently)

These three cases are mutually exclusive and define the exact import-row outcome.

#### A. Plain short payment
**Trigger:** `allocation_amount < invoice outstanding`, **and** no `discount_amount`, **and** no `bank_charge_amount`, **and** `short_payment_reason ≠ "bank_charge"`.

- Create receipt if normal import validation passes.
- Post receipt if `auto_post = true`.
- Allocate **received amount only**.
- Invoice remains **`Partially Paid`** / retains outstanding balance — **do not** mark fully paid.
- `mapped_data.short_payment_detected = true`
- `mapped_data.difference_amount = invoice outstanding − allocation_amount`
- `mapped_data.suggested_reason = "underpayment"` (or `"unknown"`)
- `mapped_data.review_required = false` *unless another validation issue exists*.

#### B. Explicit discount
**Trigger:** `discount_amount` is explicitly supplied in the CSV/XLSX import data.

- Validate `discount_amount ≥ 0`.
- Validate `allocation_amount + discount_amount ≤ invoice outstanding`.
- Pass `discount_amount` to `AllocationService.manualAllocate()` / `allocate_receipt` **only**.
- Do **not** directly create journal entries; do **not** directly update invoice outstanding.
- Let `allocate_receipt` handle discount accounting (it does — Dr `6100-001`, Cr AR).
- Discount is **never inferred** from a short-payment difference.

#### C. Explicit bank charge
**Trigger:** `bank_charge_amount` is supplied, **or** `short_payment_reason = "bank_charge"`.

- **Do not** treat bank charge as discount.
- **Do not** create a bank-charge journal entry in Batch 5.
- **Do not** auto-settle the invoice difference.
- Create / post / allocate the **received amount only**, if the receipt is otherwise valid.
- Invoice remains **`Partially Paid`** for the difference.
- `mapped_data.short_payment_detected = true`
- `mapped_data.difference_amount = bank_charge_amount` (or the calculated difference)
- `mapped_data.suggested_reason = "bank_charge"`
- `mapped_data.review_required = true`
- `mapped_data.bank_charge_posting_required = true`
- `mapped_data.bank_charge_review_reason` — the bank-charge diagnostic. (Use `auto_post_block_reason` **only** if receipt *posting itself* is blocked; a bank charge does not block posting, so use `bank_charge_review_reason` instead.)
- **No bank-charge GL posting in Batch 5.**

---

## 3. Discount Handling Design

**Prefer the existing verified path.** Discount continues to flow through `AllocationService.manualAllocate()` → `allocate_receipt` RPC. **No direct DB writes.**

### 3.1 Hard prohibitions (unchanged)
- ❌ Do not directly update `invoices.outstanding`.
- ❌ Do not directly insert `allocation_details`.
- ❌ Do not directly update `receipts.allocated_amount` / `unallocated_amount`.
- ❌ Do not bypass `allocate_receipt`.

### 3.2 Validation rules

**Batch 5 uses mathematical validation only — no config key, no migration, no hard cap.**

| Rule | Status today | Batch 5 action |
|------|--------------|----------------|
| `discount_amount >= 0` | ✅ Enforced (DB `chk_alloc_discount`, RPC) | Keep. |
| `allocation_amount >= 0` | ✅ Enforced | Keep. |
| `allocation_amount + discount_amount ≤ invoice outstanding` | ✅ Enforced (RPC `BR-REC-002`) | Keep. |
| Invoice status updates only through the RPC | ✅ Enforced | Keep — no manual "Paid". |

> [!IMPORTANT]
> **No discount tolerance / cap is enforced as a financial block in Batch 5.** There is no existing config key and no migration is planned, so Batch 5 does **not** invent an arbitrary backend hard limit. The only optional addition is a **warning-only** large-discount flag, limited to **import diagnostics** (e.g., surface `discount_unusually_large` in `mapped_data` for reviewer attention). If any constant is proposed, it must be documented as **warning-only** and must **not** block the allocation. Enforcement of mathematical validity stays exactly where it already is (DB constraint + RPC).

---

## 4. Bank Charge Handling Design

> [!CAUTION]
> **Bank charge is a different accounting event from discount and must NOT be auto-posted as discount.** No GL plumbing exists today (only the `6300-001` account shell). Batch 5's safe prototype behavior is **detect + review-required + diagnostics**, not auto-posting.

### 4.1 Safe prototype behavior (in scope for Batch 5) — diagnostics only
Bank charge is triggered explicitly (`bank_charge_amount` supplied, or `short_payment_reason = "bank_charge"`) per §2.1-C. Batch 5 behavior:
- **Allocate the received amount only** if the receipt is otherwise valid; the invoice stays `Partially Paid` for the difference.
- **Do not** auto-post the difference as discount or as a bank charge. **No JE.**
- **Mark `review_required`** unless/until an approved GL-safe bank-charge design exists.
- **Store diagnostics in `mapped_data`** (no migration — same pattern as Batch 4):
  - `short_payment_detected = true`
  - `difference_amount` (= `bank_charge_amount` or calculated difference)
  - `suggested_reason = "bank_charge"`
  - `review_required = true`
  - `bank_charge_posting_required = true`
  - `bank_charge_review_reason` — the bank-charge diagnostic message.
- **`auto_post_block_reason` is used only if receipt *posting itself* is blocked.** A bank charge does **not** block posting, so the bank-charge reason goes in `bank_charge_review_reason`, not `auto_post_block_reason`.

### 4.2 Future GL-safe bank-charge design (documented, NOT implemented in Batch 5)
If/when bank charge is formally supported, a separate reviewed batch must design:
- **Bank charge expense account** mapping — `6300-001 Bank Charges` exists, but needs a config key (e.g., `default_bank_charge_acct`) since none exists today.
- **Clearing account** treatment (if the charge is recovered/settled separately).
- **Journal entry treatment** — e.g., Dr Bank Charges (`6300-001`), Cr AR control, so the invoice can settle while the fee hits expense. This requires an RPC/service change and must be Codex-reviewed.
- **Reversal treatment** — how a bank-charge JE is reversed if the allocation is reversed (parity with discount/forex reversal in `reverse_allocation`).

> Until that design is approved, bank-charge differences remain **review-required diagnostics only** — no JE, no auto-settlement.

---

## 5. UI / UX Design

| Element | Source | Display requirement |
|---------|--------|---------------------|
| Invoice outstanding | `invoice.outstanding` | Per allocation line (existing). |
| Receipt amount | `receipt.receipt_amount` | Receipt header (existing). |
| Allocation amount | per-line `amount` | Existing input. |
| Discount amount | per-line `discount_amount` | Existing Discount column; optional **warning-only** hint for an unusually large discount (no block). |
| Difference amount | `outstanding − amount − valid discount` | **New** — show when a short payment remains unexplained. |
| Review-required state | `mapped_data.review_required` | **New** — amber row/badge (reuse Batch 4 import styling). |
| Short-paid warning | difference > 0 | **New** — banner when a receipt under-pays an invoice. |
| Discount vs bank charge distinction | classification | **New** — explicit, separate labels; never merge. Bank charge shown via `bank_charge_review_reason` / `bank_charge_posting_required`. |

**Suggested wording (to standardize):**
- **"Short payment detected"**
- **"Difference requires classification"**
- **"Do not treat bank charge as discount unless confirmed"**
- **"Discount amount must be reviewed before settlement"**

> All UI items are display/labels/warnings + a confirmation gate. No computed/persisted amount is changed by the frontend.

---

## 6. Import Flow Boundary

For receipt import (`imports/service.ts`):

Behavior is governed by the three exact outcomes in **§2.1 (A/B/C)**. Summary:

| Case | Required behavior |
|------|-------------------|
| **A — plain short payment** (`allocation_amount < outstanding`, no `discount_amount`, no `bank_charge_amount`, `short_payment_reason ≠ "bank_charge"`) | Allocate only the received amount (existing safe capping); **invoice stays `Partially Paid`** (never auto-"Paid"); record `short_payment_detected = true`, `difference_amount`, `suggested_reason = "underpayment"`/`"unknown"`, `review_required = false` unless another validation issue exists. **Discount is never inferred.** |
| **B — explicit discount** (`discount_amount` supplied in the file) | Validate (`discount_amount ≥ 0`, `allocation_amount ≥ 0`, `amount + discount ≤ outstanding`); pass `discount_amount` through `manualAllocate()` / `allocate_receipt` only. No direct JE/outstanding writes. Applies **only** when the file explicitly provides it. |
| **C — explicit bank charge** (`bank_charge_amount` supplied, or `short_payment_reason = "bank_charge"`) | Allocate received amount only (invoice stays `Partially Paid`); **never** treat as discount; **no bank-charge JE**; set `short_payment_detected = true`, `difference_amount`, `suggested_reason = "bank_charge"`, `review_required = true`, `bank_charge_posting_required = true`, `bank_charge_review_reason`. |

**Import prohibitions (carried from Batch 4):**
- ❌ Do not **infer** `discount_amount` from a short-payment difference, and do not auto-convert `difference_amount` into `discount_amount`. If no `discount_amount` is provided, allocate only the received/allocation amount and leave the invoice partially paid.
- ❌ Do not create a bank-charge JE / do not auto-post bank-charge accounting (no GL design in Batch 5).
- ❌ Do not silently mark an underpaid invoice as `Paid`.
- ❌ No write-off / adjustment fields or behavior (future scope).
- ❌ Diagnostics live in `mapped_data` JSON — **no new `import_rows.status` value, no migration**.

---

## 7. Acceptance Criteria

| # | Criterion | Pass condition |
|---|-----------|----------------|
| AC-1 | Normal allocation works | Single + multi-invoice allocation unaffected. |
| AC-2 | Partial payment leaves invoice partially paid | Receipt < outstanding (no discount) → invoice `Partially Paid`, remaining outstanding correct, never auto-"Paid". |
| AC-3 | Valid **explicit** discount works only through verified logic | Discount settles the invoice only via `manualAllocate()` / `allocate_receipt`; Discount JE posted to `6100-001`; no direct writes. Applies only when `discount_amount` is explicitly supplied. |
| AC-4 | Short payment does **not** infer discount | A short-payment difference is never auto-converted into `discount_amount`; with no explicit discount the invoice stays `Partially Paid`. |
| AC-5 | Bank charge not silently treated as discount | An explicit/suspected bank-charge difference is `review_required` with `bank_charge_*` diagnostics; **no JE created**; not auto-discounted. |
| AC-6 | Import short payment records diagnostics | Import underpayment allocates received amount only and records `short_payment_detected` + `difference_amount`. |
| AC-7 | No financial RPC redesign | `allocate_receipt` unchanged; no bank-charge JE; no migration, no new config key. |
| AC-8 | Batch 4 overpayment behavior still works | Overpayment leaves unapplied balance; import preflight + diagnostics intact. |
| AC-9 | Batch 3 multi-invoice behavior still works | One receipt → multiple invoices atomic; duplicate `invoice_id` still rejected. |
| AC-10 | `POST /allocations/auto` remains 403 | `AUTO_ALLOCATION_DISABLED`. |
| AC-11 | Discount validation is mathematical-only | Only `discount_amount ≥ 0`, `allocation_amount ≥ 0`, `amount + discount ≤ outstanding` enforced; any large-discount flag is **warning-only**, never a block. |
| AC-12 | No manual "Paid" override | Invoices reach `Paid` only via the RPC when amount (+ valid discount) == outstanding. |

**Fail** = any direct financial mutation; any bank charge auto-posted/treated as discount; any inferred discount from short payment; any bank-charge JE; any silent "Paid" on underpayment; any RPC/schema/migration/config change.

---

## 8. Testing / Evidence — Planned Smoke Tests

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1 | Short payment **without discount** — invoice RM1000, receipt RM900 | Invoice **`Partially Paid`**, RM100 outstanding remains; received amount allocated only | ⬜ |
| 2 | Explicit **valid discount** — invoice RM1000, receipt RM900, `discount_amount` RM100 | Invoice settles (`Paid`) **only through** `manualAllocate()` / `allocate_receipt`; Discount JE (Dr `6100-001`, Cr AR) | ⬜ |
| 3 | Short payment **does not infer discount** — invoice RM1000, receipt RM900, no `discount_amount` | RM100 difference is **not** converted to discount; invoice stays `Partially Paid`; no Discount JE | ⬜ |
| 4 | Explicit **bank charge** — invoice RM1000, receipt RM995, `bank_charge_amount` RM5 (or `short_payment_reason = "bank_charge"`) | `review_required = true`, `bank_charge_posting_required = true`, `suggested_reason = "bank_charge"`; **not** treated as discount | ⬜ |
| 5 | **No bank-charge JE created** | Verify no journal entry is created for the bank-charge difference in Batch 5 | ⬜ |
| 6 | Import short payment (no discount) | Receipt created/posted/allocated **received amount only**; invoice `Partially Paid`; `short_payment_detected` recorded | ⬜ |
| 7 | Import **explicit discount** row (file provides `discount_amount`) | Validated and routed through `manualAllocate()` / RPC; no inference, no direct writes | ⬜ |
| 8 | Import **explicit bank charge** row | `review_required` diagnostics; `suggested_reason = "bank_charge"`; **no JE**; not auto-discounted | ⬜ |
| 9 | Batch 4 overpayment test | Still passes (capped allocation + unapplied balance + import preflight) | ⬜ |
| 10 | Batch 3 duplicate `invoice_id` + multi-invoice | Still pass | ⬜ |
| 11 | `POST /allocations/auto` | Still 403 `AUTO_ALLOCATION_DISABLED` | ⬜ |

---

## 9. Files Likely Affected (do not edit in this plan)

### Backend
| File | Expected role in Batch 5 |
|------|--------------------------|
| `backend/supabase/functions/imports/service.ts` | (A) parse explicit `discount_amount` when the file provides it, validate (`≥ 0`, `amount + discount ≤ outstanding`), pass through `manualAllocate()`; (B) short-payment detection + `mapped_data` diagnostics (`short_payment_detected`, `difference_amount`, `suggested_reason`, `review_required`); (C) explicit bank-charge diagnostics (`bank_charge_posting_required`, `bank_charge_review_reason`) — **no JE**. Optional **warning-only** large-discount flag. |
| `backend/supabase/functions/allocations/service.ts` | **No change expected.** Mathematical discount validation already lives in the RPC/DB. No server-side tolerance gate is added. |
| `backend/supabase/functions/allocations/index.ts` | No change expected (Batch 3 guards retained). |
| `backend/supabase/functions/_shared/constants.ts` | **No change in Batch 5.** A `default_bank_charge_acct` config key belongs to the **future** GL-safe bank-charge batch (§4.2), not here. |
| `database/007_financial_rpcs.sql` (`allocate_receipt`) | **No change.** Discount already supported; any bank-charge JE support is a **future** Codex-reviewed change, not Batch 5. |

### Frontend
| File | Expected role in Batch 5 |
|------|--------------------------|
| `frontend/src/hooks/use-allocation-logic.ts` | Optional: surface `differenceAmount` / short-payment flag (display only). |
| `frontend/src/components/features/allocations/allocation-table.tsx` | Short-payment warning; optional warning-only large-discount hint; explicit discount-vs-bank-charge labelling. |
| `frontend/src/app/(dashboard)/receipts/import/page.tsx` | Show short-payment / review-required / bank-charge diagnostics (reuse Batch 4 styling). |

### Database
| File | Expected role |
|------|---------------|
| Migrations | **None in Batch 5.** Diagnostics live in `import_rows.mapped_data` JSON. A bank-charge config key / RPC change would be a separate, later, Codex-approved batch. |

---

## 10. Codex Review Checklist (financial safety before implementation)

- [ ] Confirm discount continues to flow only through `AllocationService.manualAllocate()` / `allocate_receipt` (no direct writes) and is applied **only when an explicit `discount_amount` is supplied** — never inferred from short payment.
- [ ] Confirm **no** direct writes to `allocation_details`, `invoices.outstanding`, `receipts.allocated_amount`, or `receipts.unallocated_amount`.
- [ ] Confirm discount validation is **mathematical only** (`discount_amount ≥ 0`, `allocation_amount ≥ 0`, `amount + discount ≤ outstanding`) — **no new config key, no migration, no arbitrary hard cap**; any large-discount flag is **warning-only** (import diagnostics).
- [ ] Confirm **bank charge is never treated/posted as discount**, no bank-charge JE is created, and bank-charge rows are `review_required` with `bank_charge_*` diagnostics only.
- [ ] Confirm underpayment never auto-marks an invoice `Paid`; partial payment leaves it `Partially Paid` via the RPC.
- [ ] Confirm **import discount** parsing is **explicit-file-only** and reuses the existing safe RPC path (no inference, no `difference_amount → discount_amount` conversion).
- [ ] Confirm bank-charge GL design (config key `default_bank_charge_acct` → `6300-001`, JE + reversal treatment) is **deferred** to a separate reviewed batch and **not** implemented here.
- [ ] Confirm **write-off / adjustment** is out of scope (no fields, no behavior).
- [ ] Confirm diagnostics live in `import_rows.mapped_data` JSON — **no new `import_rows.status` value, no migration**.
- [ ] Confirm Batch 3 (multi-invoice, duplicate `invoice_id`, hidden/deleted guard) and Batch 4 (overpayment preflight + diagnostics) behavior remain intact.
- [ ] Confirm `POST /allocations/auto` stays 403.
- [ ] Confirm out-of-scope items (OCR, fuzzy matching, fully automatic posting) are **not** introduced.
- [ ] Confirm an evidence document will be produced under `docs/evidence/audit-remediation/` after implementation.

---

## 11. Relationship to Other Batches

> [!IMPORTANT]
> Out of scope for Batch 5 (separate future batches):
> - **GL-safe bank-charge posting** (config key + JE + reversal) → separate reviewed batch (§4.2).
> - **Fuzzy matching** → future batch.
> - **OCR import (with review screen)** → future batch.
> - **Fully automatic posting / controlled auto-post** → future batch (`POST /allocations/auto` stays disabled until then).
> - **CASH/OFST accounting support** → Batch 2B-Fix-2 (future reviewed batch).
>
> Batch 5 delivers **explicit-only import discount (through the verified RPC), short-payment diagnostics, and bank-charge-as-review-required (diagnostics only, no JE)** — built on the existing, already-safe allocation + discount engine. Bank-charge *accounting* and write-off/adjustment are documented for later batches, not posted here.

---

*Plan created: 2026-06-12*  
*Codex review applied: 2026-06-12 — Approved with changes (mathematical-only discount validation; exact A/B/C row outcomes; explicit-only import discount; bank charge diagnostics-only, no JE; write-off out of scope)*  
*Status: 🟢 Approved with changes — awaiting user approval to implement*  
*Key finding: discount is already implemented end-to-end except import (RPC + service + wizard + Sales Discount JE to 6100-001); bank charge is unwired (only the 6300-001 account shell exists). Batch 5 = explicit-only import discount + short-payment & bank-charge diagnostics (review-required, no JE). No financial RPC change, no new status, no migration, no config key, no write-off.*  
*Author: Claude (GenAI-assisted development)*
