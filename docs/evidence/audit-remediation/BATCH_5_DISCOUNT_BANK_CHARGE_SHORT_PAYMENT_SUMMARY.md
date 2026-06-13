# Batch 5 — Discount / Bank Charge / Short Payment Handling Summary

**Date**: 2026-06-13  
**Batch**: 5 (Receipt-import discount, bank charge, and short payment diagnostics)  
**Status**: ✅ Implemented · ✅ `deno check` verified · ✅ `npm run build` verified · ✅ Smoke-tested · ✅ Committed & pushed  
**Commit**: `aacd034` — "Handle discount and short payment import diagnostics"  
**Plan Reference**: `docs/plans/batch-5-discount-bank-charge-short-payment-plan.md` (Codex **Approved with changes** — mathematical-only discount validation, explicit-only discount, write-off out of scope)

---

## 1. Purpose

Batch 5 extends the **receipt import** flow so that a payment which is not a clean 1:1 settlement can be processed safely and transparently. Three distinct real-world situations are now handled and clearly distinguished:

1. **Explicit early-payment discount** — the file supplies a `discount_amount` that, together with the cash allocation, settles the invoice. This is a real accounting event (Dr Sales Discount, Cr AR) and is posted **only** through the existing verified `allocate_receipt` RPC.
2. **Short payment (underpayment)** — the customer paid less than outstanding and no discount was provided. The cash received is allocated, the invoice stays partially paid, and the shortfall is recorded as a **diagnostic only** (no write-off, no inferred discount).
3. **Bank charge** — the customer's payment is short because a bank fee was deducted. This is flagged for review and **does not** create a journal entry in Batch 5; it is explicitly **not** treated as a discount.

The central accounting principle enforced throughout: **a discount and a bank charge are not the same accounting event, and a short payment is never silently converted into either.**

---

## 2. Existing Capability Used (Not Rebuilt)

> [!NOTE]
> Batch 5 did **not** add or modify any financial RPC. It reuses the discount support that already existed end-to-end.

| Layer | File | Pre-existing capability reused |
|-------|------|--------------------------------|
| DB RPC | `database/007_financial_rpcs.sql` (`allocate_receipt`) | Already accepts a per-line `discount_amount`; already validates `amount + discount ≤ outstanding`; already posts the Sales Discount JE (Dr `6100-001`, Cr AR) atomically. **Unchanged.** |
| Service | `backend/supabase/functions/allocations/service.ts` (`manualAllocate`) | Already forwards `discount_amount` per allocation line into the RPC. **Unchanged.** |
| Seed COA | `database/003_seed_data.sql` | `6100-001 Sales Discount` exists and is wired via config `default_discount_acct`. `6300-001 Bank Charges` exists **as an account shell only — no config key, no posting plumbing.** **Unchanged.** |

Batch 5's work was confined to the **receipt-import parsing and diagnostics layer** plus the **import results UI** — feeding the already-safe RPC with explicit, validated values and recording review diagnostics for everything that is not yet automated.

---

## 3. Scope Completed

| # | Item | Status |
|---|------|--------|
| 1 | Receipt import parses optional `discount_amount` | ✅ Done |
| 2 | Receipt import parses optional `bank_charge_amount` | ✅ Done |
| 3 | Receipt import parses optional `short_payment_reason` | ✅ Done |
| 4 | `discount_amount` is used **only** when explicitly supplied | ✅ Done |
| 5 | `discount_amount` validated as numeric and `≥ 0` | ✅ Done |
| 6 | `discount_amount` requires `invoice_reference` | ✅ Done |
| 7 | `allocation_amount + discount_amount` preflighted against invoice outstanding | ✅ Done |
| 8 | Explicit `discount_amount` passed **only** through `manualAllocate()` / `allocate_receipt` | ✅ Done |
| 9 | Discount is **never inferred** from a short-payment difference | ✅ Done |
| 10 | Bank charge is **not** treated as a discount | ✅ Done |
| 11 | Bank charge does **not** create a journal entry in Batch 5 | ✅ Done |
| 12 | Short-payment diagnostics stored in `mapped_data` | ✅ Done |
| 13 | Bank-charge review diagnostics stored in `mapped_data` | ✅ Done |
| 14 | Import UI displays discount, short-payment, and bank-charge review diagnostics | ✅ Done |

---

## 4. Files Changed

| File | Change |
|------|--------|
| `backend/supabase/functions/imports/service.ts` | Parse + validate `discount_amount`, `bank_charge_amount`, `short_payment_reason`; preflight `allocation + discount` over-settlement; pass explicit discount through `manualAllocate()`; compute and store short-payment / bank-charge diagnostics in `mapped_data`. (+93 / small deletions) |
| `frontend/src/app/(dashboard)/receipts/import/page.tsx` | Added the three new columns to the template + sample CSV; render explicit-discount, short-payment, and bank-charge-review lines in the results table; surface `bank_charge_review_reason` in the review note. (+31 lines) |

No other files were touched. **No RPC, no migration, no seed change, no config change.**

---

## 5. Explicit Discount Handling

Discount is **explicit-file-only** and is processed at two points:

### 5.1 Parse / validation stage (`buildReceiptRow`, around `service.ts:817`)
- `discount_amount` is read only when the column carries a value (`hasImportValue`), so a blank column yields `undefined` — never `0` inferred from a short payment.
- Validation enforced before mapping: `discount_amount requires invoice_reference` and `discount_amount cannot be negative`.
- The value is stored in `mapped_data.discount_amount`.

### 5.2 Preflight stage (`preflightExplicitReceiptImportOverAllocation`, `service.ts:1041`)
- When an explicit `allocation_amount` and/or `discount_amount` is present, the resolved invoice's `outstanding` is fetched and `settlementAmount = allocation + discount` is checked.
- If `settlement > outstanding + 0.01`, the row is **Skipped** with `review_required: true`, `discount_validation_error`, `excess_settlement_amount`, and a suggested non-over allocation — **before any receipt is created or posted** (no financial mutation occurs on the failing row).

### 5.3 Allocation stage (`allocateReceiptImportRow`, `service.ts:1103`)
- A valid explicit discount is forwarded as `{ invoice_id, amount, discount_amount }` into **one** `manualAllocate()` call → `allocate_receipt` RPC, which performs the `amount + discount ≤ outstanding` check and posts the Sales Discount JE atomically.
- On success the row records `discount_amount` and `discount_applied: true` in `mapped_data`.

> [!IMPORTANT]
> All discount validation is **mathematical only** (`discount ≥ 0`, `allocation > 0`, `amount + discount ≤ outstanding`). **No arbitrary discount cap, percentage limit, config key, or server-side tolerance gate was introduced.** A "large discount" is, at most, a warning-only UI/import diagnostic — never a hard block.

---

## 6. Short Payment Diagnostics

When a settlement leaves a positive shortfall (`outstanding − (allocation + discount) > 0`) and the row is **not** an over-allocation:

- The **cash received is allocated as-is**; the invoice remains **Partially Paid**. No write-off, no balancing adjustment, no inferred discount.
- `mapped_data` is annotated with:
  - `short_payment_detected: true`
  - `difference_amount` (the rounded shortfall, or the bank-charge amount when that drives the difference)
  - `suggested_reason` — `'underpayment'` for a plain short payment, `'bank_charge'` when a bank charge is indicated.
- A plain underpayment sets `review_required: false` (it is informational); only a bank-charge case escalates to review (see §7).

---

## 7. Bank Charge Diagnostics

A bank charge is detected when `bank_charge_amount` is supplied **or** `short_payment_reason === 'bank_charge'` (`service.ts:1146`). When detected:

- The **received amount is allocated only.** The bank charge is **not** added to the allocation, **not** treated as a discount, and **no journal entry is created.**
- `mapped_data` records:
  - `bank_charge_amount`
  - `bank_charge_posting_required: true`
  - `bank_charge_review_reason`: *"Bank charge accounting is not automated in Batch 5. The received amount was allocated only; classify and post bank charges through a future GL-safe flow."*
  - `review_required: true` and `suggested_reason: 'bank_charge'`.

> [!NOTE]
> Bank-charge review uses its **own** `bank_charge_review_reason` key, kept separate from `auto_post_block_reason` (which is reserved for genuine posting blocks). This keeps the bank-charge diagnostic cleanly distinguishable from posting failures in the import UI.

---

## 8. Frontend Display Changes

In `receipts/import/page.tsx`:

- **Template + sample CSV**: added `discount_amount`, `bank_charge_amount`, and `short_payment_reason` columns, each with descriptive help text emphasising "never inferred" / "not posted as discount" / "require review".
- **Results table** now renders, per row:
  - `Explicit discount: <amount>` (purple) when a positive discount was applied.
  - `Short payment: <difference> (<reason>)` (amber) when `short_payment_detected`.
  - `Bank charge review required` (amber, bold) when `bank_charge_posting_required`.
  - The review note now prefers `bank_charge_review_reason` over the generic `auto_post_block_reason` text.
- The review badge wording was tightened to "Review required".

---

## 9. Commands / Checks Run

| Check | Result |
|-------|--------|
| `deno check --allow-import backend/supabase/functions/imports/index.ts` | ✅ Passed |
| `deno check backend/supabase/functions/allocations/index.ts` | ✅ Passed |
| `npm.cmd run build` (frontend) | ✅ Passed |
| `git diff --check` | ✅ Passed (Windows CRLF warnings only — not errors) |
| `git commit` | ✅ Committed as `aacd034` |
| `git push` | ✅ Pushed |

---

## 10. Smoke Test Checklist and Results

Executed against live data on 2026-06-13. Concrete receipt/invoice identifiers are recorded below as evidence.

| # | Test | Expected | Result | Evidence |
|---|------|----------|--------|----------|
| 1 | Short payment, **no** discount | Cash allocated; invoice stays **Partially Paid**; difference recorded as diagnostic; no inferred discount | ✅ PASSED | Receipt `RCT-202606-00030` (MYR 90) → allocated MYR 90 to `INV-202606-00013`; invoice outstanding MYR 10 remaining; discount **not** inferred |
| 2 | Explicit valid discount | Settles via `manualAllocate()` / `allocate_receipt`; Sales Discount JE posted by RPC; `discount_applied=true` | ✅ PASSED | Receipt `RCT-202606-00031` (MYR 90) → allocated MYR 90 + `discount_amount` MYR 10 through the allocation flow; `INV-202606-00014` outstanding MYR 0 (fully settled) |
| 3 | Short payment does **not** infer discount | No `discount_amount` written; difference recorded as diagnostic only | ✅ PASSED | Confirmed in test #1 — no discount written for the MYR 10 shortfall |
| 4 | Explicit bank charge | Received amount allocated only; **not** treated as discount; bank-charge review flagged; **no journal entry created** | ✅ PASSED | Receipt `RCT-202606-00032` (MYR 95) → allocated MYR 95 to `INV-202606-00015`; outstanding MYR 5 remaining; bank charge **not** treated as discount |
| 5 | `allocation + discount` over-settlement (negative) | Row **Skipped** at preflight / `review_required`; **no receipt created**; no posting or allocation | ✅ PASSED | Excessive-discount row skipped with `review_required`; no receipt created; no posting/allocation occurred |
| 6 | Batch 3 multi-invoice allocation | Still works (no regression) | ✅ PASSED | — |
| 7 | Batch 4 overpayment / unapplied cash | Still works (no regression) | ✅ PASSED | — |
| 8 | `POST /allocations/auto` | 403 `AUTO_ALLOCATION_DISABLED` | ✅ PASSED | — |

**All smoke tests passed**, including the over-settlement negative test (#5), which confirmed the preflight skips the row with **no financial mutation**.

---

## 11. What Was Intentionally NOT Changed

- ❌ **No financial RPC change** — `allocate_receipt` unchanged; discount JE logic untouched.
- ❌ **No migration / no seed change / no config key added** (no discount cap, no `default_bank_charge_acct`).
- ❌ **No bank-charge journal entry** — bank charges are diagnostics-only in Batch 5.
- ❌ **No inferred discount** — a short-payment difference is never auto-converted into a discount.
- ❌ **No direct `allocation_details` inserts.**
- ❌ **No direct `invoices.outstanding` updates.**
- ❌ **No direct `receipts.allocated_amount` / `unallocated_amount` updates** — all balance/JE mutation flows through the RPC.
- ❌ **No write-off / adjustment posting** — explicitly out of scope (future batch).
- ❌ **No server-side tolerance / discount-cap gate** — validation is mathematical only.
- ❌ **No OCR, no fuzzy matching, no fully automatic posting.**
- ❌ **`POST /allocations/auto` not enabled** — still 403.

---

## 12. Risks and Follow-Up Items

| # | Item | Notes | Priority |
|---|------|-------|----------|
| 1 | Bank-charge GL posting not automated | `6300-001` is an account shell with no config plumbing; bank charges are flagged for manual review only. Needs a GL-safe posting flow + config key in a future batch | Recommended |
| 2 | Short-payment resolution | Underpayments are recorded as diagnostics; deciding write-off vs. follow-up collection is a separate (future) workflow | Review |
| 3 | Large-discount signalling | Currently warning-only / none; if a soft threshold is wanted, it must remain a non-blocking diagnostic (no hard cap) per Codex direction | Informational |
| 4 | Automated regression tests | Discount/short-payment/bank-charge paths are smoke-tested manually; consider unit/integration coverage in the testing batch | Recommended |

---

## 13. Relationship to Future Batches

> [!IMPORTANT]
> The following remain **separate future batches** and are explicitly **not** part of Batch 5:
>
> - **Bank charge GL posting** (Dr Bank Charges expense, Cr AR/bank) — requires wiring `6300-001` and a config key.
> - **Write-off / short-payment adjustment posting.**
> - **OCR import.**
> - **Fuzzy matching.**
> - **Fully automatic posting / controlled auto-post** (`POST /allocations/auto` stays disabled until then).
>
> Batch 5 delivers **explicit-only discount processing through the verified RPC** plus **diagnostics-only handling of short payments and bank charges.**

---

*Document created: 2026-06-13*  
*Batch 5 status: ✅ Implemented · ✅ deno-check & build verified · ✅ Smoke tests passed · ✅ Committed & pushed (`aacd034`)*  
*Author: Claude (GenAI-assisted development)*
