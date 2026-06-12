# Batch 4 — Overpayment / Unapplied Cash Handling Plan

**Date**: 2026-06-12 · Codex review applied 2026-06-12  
**Author**: Claude (GenAI-assisted development)  
**Status**: 🟢 Codex **Approved with changes** — corrections applied; ready for user approval to implement  
**Goal**: Handle receipt overpayment logically and safely — allocate only valid amounts, keep the remainder as unapplied receipt balance, and surface it clearly.  
**Plan type**: Documentation / implementation plan only. **No code changes in this document.**  
**Codex changes applied**: dropped the proposed "Pending Review" status (use existing `Skipped` + `mapped_data` diagnostics, no migration §5); added an import **pre-post preflight** so explicit over-allocation fails before any financial mutation (§5.2); one consistent row outcome; smoke tests + acceptance criteria updated (§6, §7).

---

## 0. Critical Current-State Finding (Read First)

> [!IMPORTANT]
> **The core overpayment / unapplied-cash safety already exists in the data model and the `allocate_receipt` RPC.** A positive `receipts.unallocated_amount` is *already defined as unapplied/advance cash*. Batch 4 is therefore primarily **UX clarity + import row-level diagnostics**, not a financial-logic rebuild. No `allocate_receipt` RPC change is expected.

| Safety property | Already enforced? | Where |
|-----------------|-------------------|-------|
| Receipt models unapplied balance | ✅ | `receipts.unallocated_amount = receipt_amount − allocated_amount`; comment: *"未核销余额。> 0 时自动视为预收款 (BR-OP-001)"* (unallocated > 0 ⇒ advance/unapplied). Dedicated index `idx_receipts_unallocated`. |
| Invoice outstanding cannot go negative | ✅ | RPC: `v_new_os := GREATEST(ROUND(outstanding − amount − discount, 2), 0)` **and** raises `BR-REC-002` if `amount + discount > outstanding + 0.01`. |
| Receipt allocated cannot exceed receipt total | ✅ | DB `CHECK (unallocated_amount >= 0)` + `CHECK (allocated_amount >= 0)`; RPC validates `total_alloc > unallocated + 0.01 → BR-REC-002`. |
| Remainder stays as unapplied | ✅ | RPC only subtracts the actual allocated total; leftover remains in `unallocated_amount`; receipt stays `Posted` (not `Fully Allocated`). |
| Explicit over-allocation rejected (not capped) | ✅ | RPC raises `BR-REC-002`; frontend disables submit. |
| Auto-suggestion caps to valid amount | ✅ | Frontend `fillMax()` and FIFO preview cap to `min(invoice.outstanding, receipt available)`. |
| Import implicit allocation caps + leaves remainder | ✅ | `allocateReceiptImportRow`: `allocationAmount = explicit ?? Math.min(receipt.unallocated_amount, invoice.outstanding)`. |

**What is genuinely missing** (the Batch 4 work): clear **UI labelling/warnings** for unapplied/overpayment; **structured import-row diagnostics** written to `mapped_data` (`overpayment_detected`, `unapplied_amount`, etc.); and a **pre-post preflight** so an explicit import over-allocation fails **before** any receipt is created or posted.

> [!WARNING]
> Do **not** change the financial mutation logic to "implement" overpayment — it already works. Adding capping/clamping to the financial path would be a regression. Batch 4 adds **visibility and diagnostics around** the existing safe behavior. **No new `import_rows.status` value and no database migration are introduced.**

> [!CAUTION]
> **Import execution-order risk (confirmed in `imports/service.ts`).** The receipt import loop runs **create receipt → post receipt (if `auto_post`) → allocate**. So today, if an explicit `allocation_amount` exceeds the matched invoice outstanding, the receipt is **already created and posted (journal entry written)** before allocation fails as `Unmatched`. Batch 4 must add a **pre-post preflight** (§5.2) that detects explicit over-allocation **before** `createReceipt()`, so the row fails safely with **no financial mutation**.

### Batch 4 Definitive Implementation Scope (post-Codex review)

Batch 4 implementation is limited to exactly the following:

1. **Frontend, display-only:** "Unapplied receipt balance" wording + overpayment warning + standardized over-allocation block messages (§3).
2. **Import diagnostics in `mapped_data`** (no new columns, no migration): `overpayment_detected`, `unapplied_amount`, `allocation_suggestion`, `auto_post_eligible`, `auto_post_block_reason`, `review_required` (§5).
3. **Import pre-post preflight** for explicit over-allocation: detect before `createReceipt()`; on over-allocation mark the row `status = "Skipped"` + `mapped_data` diagnostics, with **no receipt, no posting, no allocation, no `import_row_allocations` row** (§5.2).

**Explicitly NOT in scope:** no new `import_rows.status` value, **no database migration**, no financial RPC redesign.

---

## 1. Existing Capability Review

| Question | Finding |
|----------|---------|
| Does the receipt model already support `unallocated_amount`? | **Yes.** Stored column, `NOT NULL`, `CHECK (unallocated_amount >= 0)`, defined as advance/unapplied when > 0 (BR-OP-001). |
| Does the allocation flow already allow partial allocation, leaving a remaining receipt balance? | **Yes.** The RPC subtracts only the allocated total; the receipt stays `Posted` with positive `unallocated_amount`. |
| Does the UI already show receipt unallocated amount? | **Partially.** The receipt panel and allocation balance bar show the available/remaining figure, but it is labelled generically ("Receipt Available" / "Remaining"), not explicitly as **unapplied** cash. |
| Does the Allocation Wizard already show remaining balance? | **Yes.** `allocation-table.tsx` shows **Receipt Available − Allocating = Remaining** with a progress bar and % utilized. |
| What is missing for clear overpayment handling? | (a) Explicit **"Unapplied receipt balance"** labelling + an **overpayment warning** when remainder > 0 after a deliberate full-receipt intent; (b) **import row diagnostics in `mapped_data`** (`overpayment_detected`, `unapplied_amount`, `allocation_suggestion`, `auto_post_eligible`, `auto_post_block_reason`, `review_required`); (c) a **pre-post preflight** so explicit import over-allocation is caught **before** the receipt is created/posted, recorded with an **existing status (`Skipped`)** + `mapped_data` diagnostics (no new status, no migration). |

**Net**: the financial engine is ready; Batch 4 makes overpayment **visible, labelled, and diagnostically traceable**, especially for import.

---

## 2. Overpayment Scenarios — Expected Behavior

| # | Scenario | Expected behavior | Already correct? |
|---|----------|-------------------|------------------|
| 1 | Receipt amount **==** invoice outstanding | Full allocation; receipt → `Fully Allocated`; no unapplied. | ✅ |
| 2 | Receipt amount **>** one invoice outstanding (auto-suggest) | Suggest allocation capped at outstanding; remainder shown as **unapplied receipt balance**; receipt stays `Posted`. | ✅ (suggestion caps; needs clearer labelling) |
| 3 | Receipt amount **>** several selected invoices total | Allocate each ≤ its outstanding; sum of allocations < receipt; remainder stays unapplied. | ✅ |
| 4 | User **manually enters** allocation > invoice outstanding | **Blocked** — per-line error, submit disabled (frontend) and RPC `BR-REC-002` if forced. **Never silently capped.** | ✅ |
| 5 | User **manually enters** total allocation > receipt unallocated | **Blocked** — balance bar error + submit disabled; RPC `BR-REC-002` if forced. | ✅ |
| 6 | **Import row**: receipt amount > matched invoice outstanding, **no explicit** `allocation_amount` | Propose allocation up to outstanding; leave remainder unapplied; flag `overpayment_detected` + `unapplied_amount`. | ⚠️ Capping works; **diagnostics missing** |
| 7 | **Import row**: explicit `allocation_amount` > invoice outstanding | **Preflight rejects before any financial mutation.** Row → `status = "Skipped"` + `mapped_data.review_required = true` (+ block reason); **no receipt created, not posted, not allocated.** Never silently capped. | ⚠️ Currently the receipt is created **and posted** before allocation fails as `Unmatched` (financial mutation already done) — Batch 4 moves the check **before** create/post |

---

## 3. UI / UX Design

The wizard already renders the figures; Batch 4 mainly **relabels and adds warnings**.

| Element | Source value | Display requirement |
|---------|--------------|---------------------|
| Receipt total amount | `receipt.receipt_amount` | Show on receipt panel / header. |
| Allocated amount | `receipt.allocated_amount` (or live `totalAllocating`) | Show in balance bar (existing "Allocating"). |
| Unallocated / unapplied amount | `receipt.unallocated_amount` / live `remainingBalance` | **Relabel to "Unapplied receipt balance"** (currently "Remaining"). |
| Suggested allocation amount | `fillMax()` / FIFO preview (caps to `min(outstanding, available)`) | Keep; clarify it is a capped suggestion. |
| Remaining unapplied amount | live `remainingBalance` | Show prominently when > 0 after allocation intent. |
| Over-allocation validation error | per-line + balance checks | Keep red inline messages. |
| Overpayment warning | `remainingBalance > 0` | Show an informational banner when a receipt will retain unapplied cash. |

**Suggested wording (to standardize):**
- **"Unapplied receipt balance"** — the labelled remaining figure.
- **"This receipt has remaining unapplied amount."** — overpayment info banner.
- **"Allocation amount cannot exceed invoice outstanding."** — per-line block message.
- **"Total allocation cannot exceed receipt unallocated amount."** — balance-bar block message.

> These are **display/label changes** in the allocation wizard and receipt views. No change to how amounts are computed or persisted.

---

## 4. Backend / API Design

### 4.1 Reuse existing path (preferred)
- **Allocation** continues through `POST /allocations/manual` → `AllocationService.manualAllocate()` → `allocate_receipt` RPC. **No new route. No RPC change.**
- Over-allocation rejection (not capping) is already enforced by the RPC (`BR-REC-002`) and the API duplicate guard from Batch 3 remains in force.

### 4.2 Possible additive (non-breaking) response fields — for review
These are **optional read-only additions**, not mutation changes. Decide during Codex review:
- Allocation response / receipt read could surface `unallocated_amount` explicitly as `unapplied_amount` (alias) so the frontend does not re-derive it. (Low risk; may be unnecessary since `unallocated_amount` already returns.)
- An `overpayment` boolean (`unallocated_amount > 0` on a `Posted` receipt) could be returned for convenience. (Derivable client-side; optional.)

### 4.3 Explicit over-allocation must stay rejected, not capped
- Manual: unchanged — RPC rejects.
- **Import (the real change):** when an **explicit** `allocation_amount` exceeds the matched invoice outstanding, a **pre-post preflight** must catch it **before** `createReceipt()` and record the row as `status = "Skipped"` + `mapped_data` diagnostics (`review_required`, `auto_post_block_reason`), with **no receipt, no posting, no allocation, and no `import_row_allocations` row**. It is neither silently capped nor allowed to mutate financial data first. (See §5.)

### 4.4 Do not change financial mutation logic unless Codex confirms necessary
- The `allocate_receipt` RPC and the receipt/invoice balance updates are **out of scope** for change. Any proposal to touch them must be raised to Codex with explicit justification (§9 checklist).

---

## 5. Import Flow Boundary

> [!IMPORTANT]
> **No new `import_rows.status` value and no database migration.** The allowed statuses remain `Pending`, `Valid`, `Error`, `Skipped`, `Created`, `Posted`, `Allocated`, `Unmatched`. Review-required rows are represented with an **existing status (`Skipped`)** plus structured `mapped_data` diagnostics.

Current `allocateReceiptImportRow` behavior (confirmed in `imports/service.ts`):
- No `invoice_reference` → `Skipped` (no allocation).
- **Implicit amount** → `min(receipt.unallocated_amount, invoice.outstanding)` → safe cap, remainder unapplied. ✅ (keep)
- **Explicit amount** → currently passed to `manualAllocate()` **after the receipt is already created and posted**; if it exceeds outstanding the RPC throws and the row is caught as `Unmatched` — i.e. financial mutation already happened. ⚠️ (fix via preflight)

### 5.1 Implicit overpayment — keep current safe behavior

For an implicit overpayment (receipt amount > invoice outstanding, **no explicit** `allocation_amount`):
- The system **may suggest** allocation capped to the invoice outstanding.
- It allocates **only the safe capped amount** through `manualAllocate()` / `allocate_receipt` (existing behavior — unchanged).
- The remaining amount stays as `receipts.unallocated_amount` (unapplied).
- Write diagnostics into `mapped_data`:
  - `overpayment_detected = true`
  - `unapplied_amount` = remaining receipt balance after allocation
  - `allocation_suggestion` = the capped amount applied

This path keeps allocating through the RPC and is **separate** from the explicit-over-allocation path below.

### 5.2 Explicit over-allocation — pre-post preflight (the fix)

**Add a pre-post allocation preflight for a receipt import row when all of:**
- `auto_post = true`, **and**
- `invoice_reference` exists, **and**
- an explicit `allocation_amount` exists.

The preflight resolves the matched invoice (from the already-resolved customer + mapped currency + `invoice_reference`) and compares the explicit `allocation_amount` against `invoice.outstanding`, **before `createReceipt()` is called**.

**If explicit `allocation_amount` > invoice outstanding, the single defined outcome is:**

| Field | Value |
|-------|-------|
| `import_rows.status` | **`"Skipped"`** (existing status — no new value) |
| `mapped_data.review_required` | `true` |
| `mapped_data.auto_post_eligible` | `false` |
| `mapped_data.auto_post_block_reason` | `"allocation_amount exceeds invoice outstanding"` |
| `mapped_data.overpayment_detected` | `true` |
| `mapped_data.unapplied_amount` | calculated amount if applicable |
| `mapped_data.allocation_suggestion` | safe suggested allocation (capped to outstanding) if applicable |
| `receipt_id` | **none** — no receipt created |
| Journal entry | **none** — not posted |
| Allocation | **none** — `manualAllocate()` not called |
| `import_row_allocations` row | **none** |

The row **fails safely before any financial mutation**. This is the one outcome used consistently throughout this plan (no "Pending Review", no new status, no migration).

### 5.3 Row-level diagnostics (written to `mapped_data` only — no columns, no migration)

| Field | Meaning |
|-------|---------|
| `overpayment_detected` | `true` when receipt amount exceeds matched invoice outstanding. |
| `unapplied_amount` | Remaining receipt balance after the proposed/applied allocation. |
| `allocation_suggestion` | The safe capped allocation amount (≤ outstanding). |
| `auto_post_eligible` | Whether the row qualifies for auto-post under current rules. |
| `auto_post_block_reason` | Human-readable reason auto-post/allocation was withheld (e.g., explicit over-allocation). |
| `review_required` | `true` when the row needs manual review before posting/allocation. |

> All diagnostics live in the existing `import_rows.mapped_data` JSON. They make overpayment traceable in the import review screen **without** a new status value or schema change.

---

## 6. Acceptance Criteria

| # | Criterion | Pass condition |
|---|-----------|----------------|
| AC-1 | No negative invoice outstanding | Overpayment never drives any invoice outstanding below 0. |
| AC-2 | Overpayment leaves unapplied balance | Receipt retains positive `unallocated_amount`; stays `Posted` (not `Fully Allocated`). |
| AC-3 | Explicit over-allocation blocked | Manual entry > outstanding (or > receipt unallocated) is rejected, never capped. |
| AC-4 | Partial allocation works | A partial allocation succeeds and leaves a correctly-labelled unapplied balance. |
| AC-5 | Multi-invoice allocation works | One receipt → multiple invoices still atomic via one `manualAllocate()` / RPC call. |
| AC-6 | Single-invoice allocation works | No regression. |
| AC-7 | Batch 3 duplicate `invoice_id` validation still works | Duplicate rows still rejected before RPC. |
| AC-8 | Auto-allocation still disabled | `POST /allocations/auto` returns 403 `AUTO_ALLOCATION_DISABLED`. |
| AC-9 | Import implicit overpayment safe | Import row with receipt > outstanding and no explicit amount allocates the cap and records `overpayment_detected` + `unapplied_amount`. |
| AC-10 | Import explicit over-allocation caught by preflight | Explicit `allocation_amount` > outstanding → preflight marks row `status = "Skipped"` + `mapped_data.review_required = true` + `auto_post_block_reason`; **no receipt created, not posted, not allocated, no `import_row_allocations` row.** Never silently capped. |
| AC-11 | No direct financial mutations | No direct writes to `allocation_details`, `invoices.outstanding`, or receipt allocated/unallocated; `allocate_receipt` RPC unchanged. |
| AC-12 | UI clarity | Unapplied balance is labelled "Unapplied receipt balance"; overpayment warning shown when remainder > 0; standardized block messages present. |

**Fail** = any direct financial mutation introduced, any silent capping of explicit amounts, any RPC/schema change made without Codex sign-off, or any negative outstanding / over-total receipt produced.

---

## 7. Testing / Evidence — Planned Smoke Tests

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1 | Receipt RM1000 → invoice outstanding RM800 (allocate cap) | RM800 allocated, **RM200 unapplied**; receipt `Posted`; invoice `Paid` | ⬜ |
| 2 | User tries to allocate RM1000 to invoice outstanding RM800 | **Blocked** (per-line error; submit disabled; RPC `BR-REC-002` if forced) — not capped | ⬜ |
| 3 | Receipt RM1000 → two invoices RM400 + RM300 | RM700 allocated, **RM300 unapplied**; receipt `Posted` | ⬜ |
| 4 | Receipt RM1000 → invoices RM400 + RM600 | RM1000 allocated; receipt **`Fully Allocated`**; both invoices `Paid` | ⬜ |
| 5 | **Manual over-allocation** (amount > invoice outstanding) | **Rejected, not capped** (per-line error; submit disabled; RPC `BR-REC-002` if forced) | ⬜ |
| 6 | **Import implicit overpayment** (receipt > outstanding, no explicit amount) | Allocates **safe capped** amount via RPC; remainder stays `unallocated_amount`; `overpayment_detected = true`, `unapplied_amount` + `allocation_suggestion` set | ⬜ |
| 7 | **Import explicit over-allocation** (`allocation_amount` > outstanding) | Row marked `status = "Skipped"` with `mapped_data.review_required = true`, `auto_post_eligible = false`, `auto_post_block_reason` set | ⬜ |
| 8 | **Import explicit over-allocation — no financial mutation** | **No receipt created, not posted (no JE), not allocated** for the review-required row | ⬜ |
| 9 | **Import explicit over-allocation — no allocation evidence** | **No `import_row_allocations` row** created for the review-required row | ⬜ |
| 10 | Existing normal allocation regression | Single + multi-invoice allocation unaffected | ⬜ |
| 11 | Batch 3 duplicate `invoice_id` payload | Still **rejected before RPC** | ⬜ |
| 12 | `POST /allocations/auto` | Still **403 `AUTO_ALLOCATION_DISABLED`** | ⬜ |

---

## 8. Files Likely Affected (do not edit in this plan)

### Backend
| File | Expected role in Batch 4 |
|------|--------------------------|
| `backend/supabase/functions/imports/service.ts` | Add a **pre-post preflight** that checks explicit `allocation_amount` vs invoice outstanding **before `createReceipt()`**; on over-allocation set `status = "Skipped"` + `mapped_data` diagnostics (`review_required`, `auto_post_eligible=false`, `auto_post_block_reason`, `overpayment_detected`, `unapplied_amount`, `allocation_suggestion`) with **no receipt/post/allocate/`import_row_allocations`**. Add the same diagnostics to the **implicit** overpayment path (capping logic stays as-is). |
| `backend/supabase/functions/imports/index.ts` | Possibly surface the new diagnostics in the import result response. |
| `backend/supabase/functions/allocations/service.ts` | (Optional, §4.2) expose `unapplied_amount` alias / `overpayment` flag in response. No mutation change. |
| `backend/supabase/functions/allocations/index.ts` | No change expected (Batch 3 duplicate guard retained). |
| `database/007_financial_rpcs.sql` (`allocate_receipt`) | **No change expected.** Listed for reviewer reference only. |
| `database/008_import_tables.sql` | **No change.** Diagnostics live in the existing `import_rows.mapped_data` JSON; Batch 4 requires **no migration** and **no new `import_rows.status` value**. |

### Frontend
| File | Expected role in Batch 4 |
|------|--------------------------|
| `frontend/src/components/features/allocations/allocation-table.tsx` | Relabel "Remaining" → **"Unapplied receipt balance"**; add overpayment warning banner; standardize block messages. |
| `frontend/src/hooks/use-allocation-logic.ts` | Optionally expose `isOverpayment` / `unappliedBalance` + standardized messages (display only). |
| `frontend/src/components/features/allocations/receipt-panel.tsx` | Label receipt unapplied balance clearly. |
| Receipt detail / list views (e.g. `frontend/src/app/(dashboard)/receipts/...`) | Show "Unapplied receipt balance" where receipts are displayed. |
| Import review UI (import results screen) | Display the new row diagnostics (overpayment, unapplied, review-required, block reason). |

> If Codex confirms the existing `unallocated_amount` field + frontend derivation are sufficient, the backend allocation response (§4.2) may need no change, reducing Batch 4 to import diagnostics + UI labelling.

---

## 9. Codex Review Checklist (financial safety before implementation)

- [ ] Confirm Batch 4 makes **no change** to `allocate_receipt` RPC or receipt/invoice balance-update logic (or explicitly justify any necessary change).
- [ ] Confirm **no** direct writes to `allocation_details`, `invoices.outstanding`, `receipts.allocated_amount`, or `receipts.unallocated_amount`.
- [ ] Confirm explicit over-allocation (manual **and** import explicit `allocation_amount`) is **rejected/reviewable, never silently capped**.
- [ ] Confirm implicit import allocation continues to cap to `min(unallocated, outstanding)` and leaves the remainder unapplied, with `overpayment_detected` / `unapplied_amount` / `allocation_suggestion` written to `mapped_data`.
- [ ] Confirm the **import pre-post preflight** detects explicit over-allocation **before `createReceipt()`** so the row fails with **no receipt, no posting (no JE), no allocation, and no `import_row_allocations` row**.
- [ ] Confirm the explicit-over-allocation row uses **existing status `"Skipped"`** + `mapped_data` diagnostics — **no new `import_rows.status` value and no database migration**.
- [ ] Confirm the six row diagnostics live in **`import_rows.mapped_data` JSON only** (no dedicated columns in Batch 4).
- [ ] Confirm receipt never reaches `allocated_amount > receipt_amount` and invoice outstanding never goes negative (DB constraints + RPC already enforce; verify tests cover it).
- [ ] Confirm `Fully Allocated` vs `Posted` status transitions remain driven solely by the RPC.
- [ ] Confirm Batch 3 protections remain intact (duplicate `invoice_id` rejection, hidden/deleted customer guard, `auto` route 403).
- [ ] Confirm overpayment UI is **display-only** and does not alter computed/persisted amounts.
- [ ] Confirm out-of-scope items (discount, bank charge, fuzzy matching, OCR, fully automatic posting) are **not** introduced.
- [ ] Confirm an evidence document will be produced under `docs/evidence/audit-remediation/` after implementation.

---

## 10. Relationship to Other Batches

> [!IMPORTANT]
> Out of scope for Batch 4 (separate future batches):
> - **Early-payment discount automation & bank-charge detection** → later Batch 4-adjacent / Batch 5 work (explicitly excluded here).
> - **Fuzzy matching** → Batch 5.
> - **OCR import (with review screen)** → Batch 5.
> - **Fully automatic posting / controlled auto-post** → Batch 5 (`POST /allocations/auto` stays disabled until then).
> - **CASH/OFST accounting support** → Batch 2B-Fix-2 (future reviewed batch).
>
> Batch 4 delivers **overpayment / unapplied-cash visibility, safe import handling, and diagnostics** only — built on the existing, already-safe allocation engine.

---

*Plan created: 2026-06-12*  
*Codex review applied: 2026-06-12 — Approved with changes (no "Pending Review" status; existing `Skipped` + `mapped_data` diagnostics; import pre-post preflight; no migration)*  
*Status: 🟢 Approved with changes — awaiting user approval to implement*  
*Key finding: overpayment safety + unapplied-cash modeling already exist (BR-OP-001, DB constraints, RPC validation, import implicit capping); Batch 4 = frontend display-only clarity + `mapped_data` import diagnostics + import pre-post preflight for explicit over-allocation. No financial RPC change, no new status, no migration.*  
*Author: Claude (GenAI-assisted development)*
