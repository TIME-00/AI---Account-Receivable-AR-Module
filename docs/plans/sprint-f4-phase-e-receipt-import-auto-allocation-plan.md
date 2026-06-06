# Sprint F4 Phase E — Receipt Import Auto Allocation: Implementation Plan

**Date**: 2026-06-05  
**Author**: Claude (GenAI-assisted development)  
**Status**: 🟢 Codex-approved — Ready for implementation  
**Codex Review**: 2026-06-05 — Approved with corrections (applied)  
**Prerequisites**: Phase A ✅, Phase B ✅, Phase C ✅, Phase D ✅

---

## 1. Current State Summary

| Capability | Status |
|------------|--------|
| CSV/Excel invoice import → Draft invoices | ✅ Phase A/B (production verified) |
| Invoice import with customer auto-creation | ✅ Phase C (production verified) |
| CSV/Excel receipt import → Draft receipts | ✅ Phase D (production verified) |
| Receipt import with customer auto-creation | ✅ Phase D (production verified) |
| Manual allocation via wizard (`POST /allocations/manual`) | ✅ P1 verified |
| `allocate_receipt` RPC (P1 financial RPC) | ✅ P1 verified — handles forex JE, discount JE, balance updates |
| Auto-allocation (FIFO/AmountMatch) via `AllocationService.autoAllocate()` | ✅ Implemented, calls `manualAllocate()` internally |
| Receipt import auto-allocation | ❌ Not implemented — Phase E scope |

**Current receipt import creates Draft receipts that remain unposted and unallocated.** Users must manually post each receipt, then use the Allocation Wizard to allocate against invoices. This is a significant manual step that Phase E aims to automate.

---

## 2. Problem Statement

After importing 50+ receipts via CSV/Excel, the user currently must:

1. Navigate to each receipt individually
2. Post each receipt manually
3. Open the Allocation Wizard
4. Select the receipt
5. Find matching invoices
6. Enter allocation amounts
7. Confirm allocation

This defeats the purpose of bulk import. The system has all the information needed to automate steps 2–7 when the import file includes invoice reference information.

---

## 3. Phase E Objective

Enable the receipt import flow to **optionally auto-allocate** imported receipts to matching invoices, using the existing verified `allocate_receipt` RPC. The allocation is performed **after** receipt creation and posting, following the same financial integrity rules as the manual Allocation Wizard.

### Key Principle

> Phase E adds **orchestration** on top of existing verified services. It does NOT introduce new financial logic, new RPCs, or new allocation algorithms. Every financial mutation flows through:
> - `ReceiptService.createReceipt()` → Draft receipt
> - `post_receipt` RPC → Posted receipt + receipt JE
> - `allocate_receipt` RPC → Allocation details + invoice balance update + forex/discount JEs

---

## 4. Critical Questions Answered

### Does allocation require posted invoices?

**Yes.** The `allocate_receipt` RPC requires invoice status to be `Open`, `Overdue`, or `Partially Paid`. These statuses only exist after an invoice has been posted via `post_invoice` RPC. **Draft invoices cannot be allocated.**

### Does allocation require posted receipts?

**Yes.** The `allocate_receipt` RPC explicitly checks:
```sql
IF v_rct.status NOT IN ('Posted', 'Fully Allocated') THEN
  RAISE EXCEPTION 'BR-REC-001: Receipt must be Posted';
END IF;
```
**Draft receipts cannot be allocated.**

### Should imported receipts be auto-posted before allocation?

**Yes, conditionally.** Phase E will add an **optional** "Auto-Post & Allocate" step to the import flow. The user must explicitly opt in. The flow is:

1. Create Draft receipt (existing `ReceiptService.createReceipt()`)
2. **If auto-post enabled**: Post receipt via `ReceiptService.postReceipt()` → calls `post_receipt` RPC
3. **If allocation data provided**: Allocate via `AllocationService.manualAllocate()` → calls `allocate_receipt` RPC

If auto-post is disabled, receipts remain Draft (current Phase D behavior).

### What happens if the invoice reference is missing?

The receipt is created and (optionally) posted, but **no allocation occurs**. The row status is set to `Posted` and allocation status is recorded in `import_rows.mapped_data` as `{ allocation_status: 'Skipped', allocation_error: 'No invoice reference provided' }`. No row is written to `import_row_allocations`. The receipt remains Posted with full unallocated balance — user can allocate later via the Allocation Wizard.

### What happens if allocation amount exceeds receipt amount?

The `allocate_receipt` RPC enforces: `total_allocation ≤ receipt.unallocated_amount`. If exceeded, the allocation step fails for that row. The receipt remains Posted but unallocated. The row status is set to `Unmatched` and the allocation error is recorded in `import_rows.mapped_data`. No row is written to `import_row_allocations`.

### What happens if allocation amount exceeds invoice outstanding?

The `allocate_receipt` RPC enforces: `allocation_amount + discount ≤ invoice.outstanding`. If exceeded, the allocation step fails for that row. The row status is set to `Unmatched` and the allocation error is recorded in `import_rows.mapped_data`. No row is written to `import_row_allocations`.

### What happens if multiple invoices match the reference?

Phase E uses **exact match only** on `invoice_no`. If the reference doesn't match exactly one posted invoice for the same customer and currency, the allocation is skipped with a clear error message. The row status is set to `Unmatched`. No fuzzy matching.

### What happens if receipt customer ≠ invoice customer?

The `allocate_receipt` RPC enforces same-customer allocation:
```sql
IF v_inv.customer_id != v_rct.customer_id THEN
  RAISE EXCEPTION 'BR-REC-001: Invoice customer does not match receipt customer';
END IF;
```
Allocation is rejected. The row status is set to `Unmatched` and the RPC error is recorded in `import_rows.mapped_data`. No row is written to `import_row_allocations`.

---

## 5. User Workflow

### 5.1 Updated Receipt Import Flow

```
1. Upload CSV/Excel file           (unchanged from Phase D)
2. Parse rows                      (unchanged)
3. Preview & Edit                  (unchanged — now shows invoice_reference column)
4. Validate                        (enhanced — validates invoice_reference if present)
5. Execute                         (enhanced — 3-stage pipeline)
   ├── 5a. Create Draft receipt    (unchanged — ReceiptService.createReceipt)
   ├── 5b. Post receipt            (NEW — ReceiptService.postReceipt, optional)
   └── 5c. Allocate receipt        (NEW — AllocationService.manualAllocate, optional)
6. Result Summary                  (enhanced — shows allocation results)
```

### 5.2 Execute Step Detail

For each valid import row:

```
Row has auto_post = false?
  → Create Draft receipt only (Phase D behavior)
  → Row status = 'Created'
  → Skip posting and allocation

Row has auto_post = true, no invoice_reference?
  → Stage 1: Create Draft receipt via ReceiptService.createReceipt()
  → Stage 2: Post receipt via ReceiptService.postReceipt() → calls post_receipt RPC
  → Stage 3: Skip allocation (no target invoice)
  → Row status = 'Posted'
  → Record in import_rows.mapped_data: { allocation_status: 'Skipped' }
  → No import_row_allocations row created

Row has auto_post = true, has invoice_reference?
  → Stage 1: Create Draft receipt via ReceiptService.createReceipt()
  → Stage 2: Post receipt via ReceiptService.postReceipt() → calls post_receipt RPC
  → Stage 3: Resolve invoice_reference → invoice_id (exact match on invoice_no)
  → Determine allocation_amount:
      If CSV provides allocation_amount → use it
      If CSV omits allocation_amount → use min(receipt_amount, invoice.outstanding)
  → Call AllocationService.manualAllocate(receipt_id, [{invoice_id, amount}])
      → calls allocate_receipt RPC (creates allocation_details, forex/discount JEs)
  → On success: row status = 'Allocated', import_row_allocations row created
  → On failure: row status = 'Unmatched', error in import_rows.mapped_data
```

> [!IMPORTANT]
> **Phase E does NOT call `AllocationService.autoAllocate()`** (FIFO/AmountMatch). Phase E uses only `AllocationService.manualAllocate()` with exactly one `invoice_reference` per import row. FIFO auto-allocation without explicit invoice references is out of scope.

### 5.3 User Controls

| Control | Location | Default | Description |
|---------|----------|---------|-------------|
| Auto-Post toggle | Execute step, before "Create" button | OFF | When ON, created receipts are immediately posted |
| Allocation column | CSV/Excel template | Optional | `invoice_reference` and `allocation_amount` columns |

> [!IMPORTANT]
> **Auto-Post defaults to OFF.** Users must explicitly enable it. This preserves Phase D's draft-only behavior as the default and prevents accidental posting of imported receipts.

---

## 6. Required CSV/XLSX Receipt Import Fields

### Existing Required Fields (unchanged from Phase D)

| Column | Required | Description |
|--------|----------|-------------|
| `receipt_date` | ✅ Yes | Date format: YYYY-MM-DD |
| `payment_method` | ✅ Yes | CHQ, TT, CASH, CC, GIRO, OFST, or ONLN |
| `amount` | ✅ Yes | Positive receipt amount |

### Existing Optional Fields (unchanged from Phase D)

`customer_code`, `customer_name`, `registration_no`, `bill_addr_line1`, `bill_city`, `bill_state`, `bill_postal`, `bill_country`, `contact_name`, `contact_phone`, `contact_email`, `currency`, `receipt_reference`, `bank_account_code`, `bank_account_id`, `cheque_date`, `remarks`

### New Optional Allocation Fields (Phase E)

| Column | Required | Description |
|--------|----------|-------------|
| `invoice_reference` | Optional | Exact `invoice_no` to allocate against. Must be a posted invoice for the same customer and currency. |
| `allocation_amount` | Optional | Amount to allocate. If omitted and `invoice_reference` is provided, uses `min(receipt_amount, invoice.outstanding)`. Must be > 0 and ≤ both receipt amount and invoice outstanding. |

### Field Interaction Rules

| `invoice_reference` | `allocation_amount` | Behavior |
|---------------------|---------------------|----------|
| Empty | Empty | Receipt-only row. No allocation attempted. |
| Provided | Empty | Auto-allocate using `min(receipt_amount, invoice.outstanding)`. |
| Provided | Provided | Allocate exact amount specified. |
| Empty | Provided | Validation error: "allocation_amount requires invoice_reference". |

---

## 7. Matching Logic

### 7.1 Invoice Resolution

```
1. Take invoice_reference from import row
2. Query: SELECT * FROM invoices
   WHERE company_id = auth.companyId
     AND invoice_no = invoice_reference
     AND status IN ('Open', 'Overdue', 'Partially Paid')
     AND customer_id = receipt.customer_id
     AND currency = receipt.currency
3. Expect exactly 1 result
4. If 0 results → allocation_status = 'Error', message: "No matching open invoice found"
5. If >1 results → allocation_status = 'Error', message: "Multiple invoices match reference"
```

### 7.2 Matching Constraints (enforced by `allocate_receipt` RPC)

| Constraint | Source | Behavior on Violation |
|------------|--------|----------------------|
| Same company | RPC parameter `p_company_id` | NOT_FOUND exception |
| Same customer | RPC line 825: `v_inv.customer_id != v_rct.customer_id` | BR-REC-001 exception |
| Same currency | RPC line 833: `v_inv.currency != v_rct.currency` | BR-REC-003 exception |
| Invoice is open | RPC line 829: `status IN ('Open', 'Overdue', 'Partially Paid')` | BR-REC-001 exception |
| Amount ≤ outstanding | RPC line 837: `(alloc + discount) > outstanding` | BR-REC-002 exception |
| Amount ≤ receipt unallocated | RPC line 762: `total > unallocated` | BR-REC-002 exception |
| Receipt is Posted | RPC line 751: `status NOT IN ('Posted', 'Fully Allocated')` | BR-REC-001 exception |

### 7.3 What Phase E Does NOT Do

| Feature | Status | Reason |
|---------|--------|--------|
| Fuzzy matching on invoice reference | ❌ Not implemented | Risk of incorrect allocation on financial data |
| One receipt → multiple invoices | ❌ Not in Phase E | Requires multi-row grouping logic; deferred |
| Partial match tolerance | ❌ Not implemented | Exact `invoice_no` match only |
| Overpayment handling | ❌ Not automated | If amount > outstanding, allocation fails — user allocates manually |
| Cross-currency allocation | ❌ Not allowed | Same currency enforced by RPC |

---

## 8. Validation Behavior

### 8.1 Receipt-Only Row (no allocation fields)

| Field | Validation | Status if Passed |
|-------|-----------|------------------|
| All existing Phase D fields | Same as Phase D | `Valid` |
| `invoice_reference` | Empty — no allocation | Row marked as receipt-only |
| `allocation_amount` | Empty — no allocation | Row marked as receipt-only |

**Execution**: Create Draft receipt. If auto-post ON, post receipt. No allocation.

### 8.2 Receipt + Allocation Row

| Field | Validation | Error if Failed |
|-------|-----------|-----------------|
| All existing Phase D fields | Same as Phase D | Same as Phase D |
| `invoice_reference` | Must be non-empty string | "invoice_reference is required for allocation" |
| `allocation_amount` | If provided: must be positive number | "allocation_amount must be positive" |
| `allocation_amount` without `invoice_reference` | Not allowed | "allocation_amount requires invoice_reference" |

**Validation-time invoice check** (soft check):
- Query invoices matching `invoice_reference` + resolved customer + currency
- If 0 matches → warning (not hard error at validation; could be a timing issue)
- If match found → record `invoice_id` in `mapped_data` for execute step

**Execution**: Create Draft receipt → Post receipt → Allocate against resolved invoice.

### 8.3 Error Row

Any row that fails existing Phase D validation remains an Error row. Allocation fields are not processed for Error rows.

---

## 9. Execution Behavior

### 9.1 Three-Stage Pipeline

> [!IMPORTANT]
> **Phase E cannot allocate Draft receipts directly.** The `allocate_receipt` RPC requires receipt status = `Posted`. The correct execution order is strictly sequential: create → post → allocate. Skipping the post step and attempting allocation will fail with `BR-REC-001`.

```typescript
// Stage 1: Create Draft receipt (existing Phase D logic)
// Uses ReceiptService.createReceipt() — NOT a direct table insert
const receipt = await receiptService.createReceipt(auth, receiptInput);
// receipt.status = 'Draft'

// Stage 2: Post receipt (Phase E — conditional)
// Uses ReceiptService.postReceipt() → calls post_receipt RPC
// Generates receipt JE (Dr Bank/Cheques, Cr AR Control)
if (batch.auto_post) {
  const postResult = await receiptService.postReceipt(auth, receipt.id);
  // receipt.status = 'Posted'
}

// Stage 3: Allocate receipt (Phase E — conditional)
// Uses AllocationService.manualAllocate() → calls allocate_receipt RPC
// NOT AllocationService.autoAllocate() — Phase E is explicit match only
if (batch.auto_post && row.invoice_reference && resolvedInvoiceId) {
  const allocationAmount = row.allocation_amount
    ?? Math.min(receipt.receipt_amount, invoice.outstanding);

  try {
    const result = await allocationService.manualAllocate(auth, {
      receipt_id: receipt.id,
      allocations: [{ invoice_id: resolvedInvoiceId, amount: allocationAmount }],
    });

    // SUCCESS: Record in import_row_allocations (allocation_id NOT NULL satisfied)
    await recordAllocationResult(row.id, result.allocation_id, resolvedInvoiceId, allocationAmount);
    // Row status → 'Allocated'
  } catch (err) {
    // FAILURE: Record in import_rows.mapped_data (NOT in import_row_allocations)
    await recordAllocationError(row.id, err.message);
    // Row status → 'Unmatched'
  }
}
```

### 9.2 Row Status Definitions

| Status | Meaning | Receipt State | Allocation State |
|--------|---------|---------------|------------------|
| `Error` | Validation failed before any financial mutation | No receipt created | N/A |
| `Created` | Receipt created but posting failed or auto_post=false | Draft receipt exists | N/A |
| `Posted` | Receipt created and posted, no allocation attempted | Posted receipt, full unallocated balance | Skipped (no `invoice_reference`) |
| `Allocated` | Receipt created, posted, and successfully allocated | Posted or Fully Allocated receipt | `import_row_allocations` row exists |
| `Unmatched` | Receipt created and posted, but allocation target missing or failed | Posted receipt, full unallocated balance | Error recorded in `import_rows.mapped_data` |

### 9.3 Error Handling Per Stage

| Stage | Error | Row Status | Error Storage | Behavior |
|-------|-------|------------|---------------|----------|
| Stage 1: Create Draft | Service error | `Error` | `import_rows.validation_errors` | Skip stages 2–3. No receipt created. |
| Stage 2: Post | RPC error (e.g., blocked customer, no fiscal period) | `Created` | `import_rows.mapped_data` | Draft receipt exists. Skip stage 3. |
| Stage 3: Allocate | RPC error (e.g., invoice not found, over-allocation) | `Unmatched` | `import_rows.mapped_data` | Receipt is Posted. No `import_row_allocations` row. |
| Stage 3: Allocate | Success | `Allocated` | `import_row_allocations` | Receipt allocated. Real `allocation_details.id` referenced. |

### 9.4 Batch Counters

| Counter | Meaning |
|---------|---------|
| `created_count` | Receipts successfully created (Draft) |
| `posted_count` | Receipts successfully posted |
| `allocated_count` | Receipts successfully allocated to at least one invoice |
| `error_rows` | Rows that failed at any stage |

---

## 10. Safety Rules

| Rule | Enforcement |
|------|-------------|
| No direct insert into `allocation_details` | All allocation goes through `AllocationService.manualAllocate()` → `allocate_receipt` RPC |
| No direct insert into `journal_entries` or `journal_entry_lines` | JEs created by `post_receipt` and `allocate_receipt` RPCs only |
| No direct update to `invoices.outstanding` or `invoices.status` | Updated by `allocate_receipt` RPC only |
| No direct update to `receipts.allocated_amount` or `receipts.status` | Updated by `allocate_receipt` RPC only |
| No bypassing `post_receipt` RPC | Receipt posting always goes through the verified P1 RPC |
| No fuzzy matching | Exact `invoice_no` match only |
| No overpayment automation | If `allocation_amount > invoice.outstanding`, allocation fails — user resolves manually |
| No one-receipt-to-many-invoices in import | Phase E supports exactly one `invoice_reference` per import row |
| Auto-post defaults to OFF | User must explicitly opt in; Phase D draft-only behavior is preserved as default |
| Allocation is optional | Rows without `invoice_reference` are not allocated |
| All RPC business rules enforced | Same customer, same currency, posted receipt, open invoice, amount checks |
| Optimistic concurrency on invoices | `allocate_receipt` RPC uses `version` column for conflict detection |

---

## 11. Frontend UI Flow

### 11.1 `/receipts/import` Page Changes

#### Template Guide Updates
- Add `invoice_reference` and `allocation_amount` to column guide
- Add note: "Allocation is optional. Leave `invoice_reference` blank for receipt-only rows."
- Add note: "Allocation requires Auto-Post to be enabled."
- Update sample CSV to include allocation columns

#### Preview Step (Step 3)
- Add `invoice_reference` column to preview table
- Add `allocation_amount` column to preview table (show "—" if empty)

#### Validate Step (Step 4)
- Show allocation validation warnings (e.g., "Invoice INV-001 not found" as soft warning)
- Differentiate receipt-only rows vs. receipt+allocation rows with visual indicator

#### Execute Step (Step 5)
- Add "Auto-Post & Allocate" toggle above the "Create" button
- When toggle is OFF: button reads "Create Draft Receipts" (Phase D behavior)
- When toggle is ON: button reads "Create, Post & Allocate Receipts"
- Warning text when toggle ON: "Receipts will be posted immediately. Posted receipts with invoice references will be allocated. This cannot be undone."

#### Result Step (Step 6)
- Show enhanced batch summary:
  - Created: N
  - Posted: N
  - Allocated: N
  - Errors: N
- Show per-row allocation result in the rows table:
  - Column: "Allocation" with status badge (Allocated / Skipped / Error)
  - Allocated rows show invoice_no and allocated_amount
  - Error rows show allocation error message
- Link allocated invoices to their detail pages

### 11.2 Row Status Colors (additions)

| Status | Color | Meaning |
|--------|-------|---------|
| `Posted` | Purple badge | Receipt created and posted, but not allocated |
| `Allocated` | Green badge | Receipt created, posted, and allocated |
| `Unmatched` | Amber badge | Receipt created/posted, but allocation failed (invoice not found, etc.) |

---

## 12. Backend Implementation Tasks (Codex)

### 12.1 Import Service Changes

| Task | File | Description |
|------|------|-------------|
| 1 | `imports/service.ts` | Add `auto_post` flag to `ImportBatch` — read from batch metadata during execute |
| 2 | `imports/service.ts` | Add `invoice_reference` and `allocation_amount` to receipt row validation (`validateReceiptRow`) |
| 3 | `imports/service.ts` | Add invoice resolution logic: query `invoices` by `invoice_no` + customer + currency + open status |
| 4 | `imports/service.ts` | In `executeDraftCreation()`, after creating receipt: optionally post via `ReceiptService.postReceipt()` |
| 5 | `imports/service.ts` | In `executeDraftCreation()`, after posting: optionally allocate via `AllocationService.manualAllocate()` |
| 6 | `imports/service.ts` | Record successful allocation results only in `import_row_allocations` table |
| 7 | `imports/service.ts` | Update batch counters: `posted_count`, `allocated_count` |
| 8 | `imports/service.ts` | Update row status to `Posted` or `Allocated` based on execution result |

### 12.2 Import Index Changes

| Task | File | Description |
|------|------|-------------|
| 9 | `imports/index.ts` | Accept `auto_post` boolean in execute request body (default: false) |

### 12.3 New Import Row Status Values

| Task | File | Description |
|------|------|-------------|
| 10 | `imports/service.ts` | Add `Posted` and `Allocated` to `ImportRowStatus` type |

### 12.4 Smoke Tests

| Task | File | Description |
|------|------|-------------|
| 11 | `tests/curl/import-phase-e-receipt-allocate.ps1` | Full flow: upload CSV with invoice_reference → parse → validate → execute with auto_post=true → verify allocation |
| 12 | `tests/curl/import-phase-e-receipt-no-alloc.ps1` | Receipt-only rows: auto_post=true, no invoice_reference → posted but not allocated |
| 13 | `tests/curl/import-phase-e-receipt-draft-only.ps1` | auto_post=false → receipts remain Draft, no allocation |
| 14 | `tests/curl/import-phase-e-bad-invoice-ref.ps1` | Invalid invoice reference → allocation fails, receipt remains Posted |
| 15 | `tests/curl/import-phase-e-csv-regression.ps1` | Phase D CSV receipt import still works (auto_post=false default) |

---

## 13. Database Migration Needs

### 13.1 Required Migration: `013_import_enable_auto_post.sql`

> [!CAUTION]
> **Database migration IS required.** The `import_batches` table has a hard CHECK constraint that prevents `auto_post = TRUE`:
> ```sql
> CONSTRAINT chk_import_batches_phase_a_no_auto CHECK (
>     auto_post = FALSE AND auto_allocate = FALSE
> )
> ```
> This was intentionally added in Phase A to prevent premature auto-posting. Phase E must relax this constraint to allow `auto_post = TRUE` while keeping `auto_allocate = FALSE` (auto_allocate is for FIFO auto-allocation without invoice references, which is out of scope for Phase E).

**Required migration:**
```sql
-- 013_import_enable_auto_post.sql
-- Sprint F4 Phase E: Enable auto_post for receipt import allocation
-- Drops the Phase A constraint and replaces with a Phase E constraint
-- that allows auto_post=TRUE for receipt imports only.
-- Invoice imports remain blocked from auto_post.
-- auto_allocate (FIFO without invoice reference) remains disabled.

ALTER TABLE public.import_batches
  DROP CONSTRAINT IF EXISTS chk_import_batches_phase_a_no_auto;

ALTER TABLE public.import_batches
  ADD CONSTRAINT chk_import_batches_phase_e_auto_controls CHECK (
    auto_allocate = FALSE
    AND (auto_post = FALSE OR import_type = 'receipt')
  );

COMMENT ON CONSTRAINT chk_import_batches_phase_e_auto_controls ON import_batches IS
  'Phase E: auto_post is allowed only for receipt imports (post+allocate flow). '
  'Invoice imports remain blocked from auto_post. '
  'auto_allocate (FIFO without invoice reference) remains disabled until a future phase.';
```

**Key points:**
- `auto_post = TRUE` is now allowed **for receipt imports only** (`import_type = 'receipt'`)
- Invoice imports remain blocked from auto-posting (`auto_post = FALSE` enforced when `import_type = 'invoice'`)
- `auto_allocate = FALSE` remains enforced for all import types (no FIFO without explicit invoice reference in Phase E)
- The old constraint name `chk_import_batches_phase_a_no_auto` clearly indicates it was a Phase A restriction
- The new constraint name `chk_import_batches_phase_e_auto_controls` clearly indicates it is a Phase E restriction

### 13.2 `import_row_allocations` Table — Already Exists, Special Constraint

The `import_row_allocations` table was created in `008_import_tables.sql` and is currently unused:

```sql
CREATE TABLE import_row_allocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_row_id     UUID          NOT NULL REFERENCES import_rows(id),
  allocation_id     UUID          NOT NULL REFERENCES allocation_details(id),
  invoice_id        UUID          NOT NULL REFERENCES invoices(id),
  allocated_amount  DECIMAL(18,2) NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ira_amount_positive CHECK (allocated_amount > 0),
  CONSTRAINT uq_ira_import_row_allocation UNIQUE (import_row_id, allocation_id)
);
```

> [!IMPORTANT]
> **`allocation_id` is NOT NULL.** This means `import_row_allocations` can ONLY be populated for **successful** allocations (where a real `allocation_details.id` exists). Failed/skipped allocations should NOT be recorded in this table.
>
> **Allocation error tracking** for failed/skipped rows should be stored in the `import_rows.mapped_data` JSONB field as `allocation_error` and `allocation_status`, alongside the existing `import_rows.status` column (which supports `Posted`, `Allocated`, `Unmatched` values).

**No schema migration needed for this table.** Phase E will populate it for successful allocations only.

### 13.3 `import_rows` Status Values

The `import_rows.status` column CHECK constraint already includes `Posted`, `Allocated`, and `Unmatched` values (provisioned in `008_import_tables.sql`). The `ImportRowStatus` TypeScript type in the import service needs to be updated to use these existing DB values.

**No schema migration needed.**

### 13.4 `import_batches` — `auto_post` Column

The `import_batches` table already has `auto_post BOOLEAN DEFAULT FALSE` and `auto_allocate BOOLEAN DEFAULT FALSE` columns. After migration `013` drops the Phase A constraint, `auto_post = TRUE` will be allowed.

**No additional column migration needed.**

### 13.5 Summary

> [!IMPORTANT]
> **One migration file required: `database/013_import_enable_auto_post.sql`**
> - Drops `chk_import_batches_phase_a_no_auto` constraint
> - Adds `chk_import_batches_phase_e_auto_controls` constraint:
>   - Allows `auto_post = TRUE` for receipt imports only
>   - Blocks `auto_post = TRUE` for invoice imports
>   - Blocks `auto_allocate = TRUE` for all import types
> - All other schema (tables, columns, RLS, indexes) was pre-provisioned in `008_import_tables.sql`

---

## 14. Test Plan

### 14.1 Backend Smoke Tests (Codex)

| # | Test | Expected |
|---|------|----------|
| 1 | CSV receipt import, auto_post=false (default) | Receipts created as Draft. `posted_count = 0`, `allocated_count = 0`. Phase D behavior preserved. |
| 2 | CSV receipt import, auto_post=true, no invoice_reference | Receipts created and posted. `posted_count = N`, `allocated_count = 0`. Row status = `Posted`. |
| 3 | CSV receipt import, auto_post=true, valid invoice_reference | Receipts created, posted, and allocated. `allocated_count = N`. `import_row_allocations` populated with real `allocation_details.id`. Row status = `Allocated`. |
| 4 | CSV receipt import, auto_post=true, invalid invoice_reference | Receipts created and posted. Allocation fails. Row status = `Unmatched`. `allocation_status` / `allocation_error` recorded in `import_rows.mapped_data`. **No `import_row_allocations` row created.** |
| 5 | CSV receipt import, auto_post=true, invoice_reference for wrong customer | Allocation fails with BR-REC-001. Receipt remains Posted. Row status = `Unmatched`. Error in `mapped_data`. |
| 6 | CSV receipt import, auto_post=true, allocation_amount > invoice outstanding | Allocation fails with BR-REC-002. Receipt remains Posted. Row status = `Unmatched`. Error in `mapped_data`. |
| 7 | CSV receipt import, allocation_amount without invoice_reference | Validation error at validate step. Row status = `Error`. |
| 8 | Verify no direct inserts into `allocation_details` | All allocations go through `AllocationService.manualAllocate()` → `allocate_receipt` RPC. |
| 9 | Verify forex JE created when currencies have different exchange rates | JE created by `allocate_receipt` RPC. |
| 10 | Verify invoice outstanding updated after allocation | `outstanding` decreased, `status` changed to `Partially Paid` or `Paid`. |
| 11 | Phase D regression: receipt import without Phase E fields still works | No errors, no allocation columns cause issues. |
| 12 | Phase A/B regression: invoice import still works | CSV/Excel invoice import unaffected. Invoice auto_post blocked by constraint. |

### 14.2 Frontend Tests (Claude)

| # | Test | Expected |
|---|------|----------|
| 1 | Upload CSV with `invoice_reference` and `allocation_amount` columns | Columns shown in preview |
| 2 | Upload CSV without allocation columns | Preview and flow identical to Phase D |
| 3 | Auto-Post toggle OFF → "Create Draft Receipts" button | Receipts created as Draft, no posting/allocation |
| 4 | Auto-Post toggle ON → "Create, Post & Allocate Receipts" button | Receipts posted and allocated |
| 5 | Result summary shows Posted/Allocated/Error counts | Counts match actual results |
| 6 | Row-level allocation status badges displayed | Allocated (green), Skipped (gray), Error (red) |
| 7 | Template guide shows allocation columns | Column descriptions accurate |
| 8 | Warning text appears when Auto-Post is ON | Warning is visible and accurate |

---

## 15. Evidence Document Plan

After Phase E is completed and production-verified, create:

**`docs/evidence/frontend-sprint-f4/SPRINT_F4_PHASE_E_RECEIPT_ALLOCATION_VERIFICATION_SUMMARY.md`**

Contents:
1. Phase E scope completed
2. Files changed (backend + frontend)
3. Three-stage pipeline description
4. Financial safety confirmations (RPC usage, no direct inserts)
5. Production smoke test results
6. Frontend UI test results
7. Batch counter verification (`posted_count`, `allocated_count`)
8. `import_row_allocations` table populated correctly
9. Phase D regression verification
10. Known limitations and next phase recommendation

---

## 16. Risks and Controls

| Risk | Likelihood | Impact | Control |
|------|-----------|--------|---------|
| Auto-post creates irreversible financial entries | Medium | High | Auto-post defaults to OFF. Warning text shown. User must explicitly opt in. |
| Invoice reference mismatch allocates to wrong invoice | Low | High | Exact `invoice_no` match only. Same customer + currency enforced by RPC. |
| Allocation fails mid-batch leaving partially allocated state | Medium | Medium | Each row is independent. Failed allocations don't affect other rows. Receipts remain Posted. |
| Concurrent allocation by another user on same invoice | Low | Medium | `allocate_receipt` RPC uses `FOR UPDATE` locks + version column for optimistic concurrency. |
| Fiscal period not open — posting fails | Low | Medium | `post_receipt` RPC checks fiscal period. Error recorded per-row. |
| Blocked customer — posting fails | Low | Low | `post_receipt` RPC validates customer status. Error recorded per-row. |
| Phase D regression — existing receipt import breaks | Low | High | `auto_post` defaults to false. Existing flow unchanged when toggle is off. Regression test required. |

---

## 17. Out-of-Scope Items

| Feature | Status | Reason |
|---------|--------|--------|
| One receipt → multiple invoices in a single import row | ❌ Out of scope | Requires multi-row grouping; too complex for Phase E |
| Fuzzy matching on invoice reference | ❌ Out of scope | Risk of incorrect financial allocation |
| Overpayment handling (allocation amount > invoice outstanding) | ❌ Out of scope | Allocation fails — user resolves manually via Allocation Wizard |
| Discount automation in import | ❌ Out of scope | `discount_amount` not included in import fields for Phase E |
| FIFO / AmountMatch auto-allocation (`AllocationService.autoAllocate()`) | ❌ Out of scope | Phase E uses `manualAllocate()` with explicit `invoice_reference` only |
| `GET /allocations` for live allocation history | ❌ Out of scope | Blocked until tenant isolation is fixed (Phase F) |
| PDF/Image/OCR import | ❌ Out of scope | Phase G |
| Receipt cancellation/reversal from import | ❌ Out of scope | Manual process only |
| Allocation reversal from import | ❌ Out of scope | Manual process via Allocation Wizard |
| Cross-currency allocation | ❌ Out of scope | Same currency enforced by `allocate_receipt` RPC |
| Direct inserts into financial tables | ❌ Prohibited | All mutations through verified RPCs/services |
| New RPCs or financial functions | ❌ Not needed | Existing `post_receipt` + `allocate_receipt` RPCs are sufficient |
| Invoice import auto-posting | ❌ Blocked by constraint | `chk_import_batches_phase_e_auto_controls` enforces `auto_post = FALSE` for invoice imports |

### 17.1 Phase E Scope Confirmation

| Scope Item | Included? |
|------------|----------|
| Receipt import only | ✅ Yes |
| CSV/XLSX only | ✅ Yes |
| Optional `auto_post` for receipt imports | ✅ Yes |
| Optional one-receipt-to-one-invoice allocation by exact `invoice_reference` | ✅ Yes |
| Uses `AllocationService.manualAllocate()` only | ✅ Yes |
| Uses existing `post_receipt` + `allocate_receipt` RPCs | ✅ Yes |
| Database migration: `013_import_enable_auto_post.sql` | ✅ Yes — required |
| Fuzzy matching | ❌ No |
| Overpayment automation | ❌ No |
| One receipt → many invoices | ❌ No |
| Discounts in import | ❌ No |
| FIFO / AmountMatch auto-allocation | ❌ No |
| PDF/Image/OCR | ❌ No |
| New financial RPCs | ❌ No |

---

## 18. Implementation Order

### Step 1: Codex Backend

| # | Task |
|---|------|
| 1.0 | Create `database/013_import_enable_auto_post.sql` and apply on staging |
| 1.1 | Add `invoice_reference` and `allocation_amount` handling to `validateReceiptRow()` |
| 1.2 | Add invoice resolution query (exact match by `invoice_no` + customer + currency + open status) |
| 1.3 | Add `AllocationService` import to `ImportService` (use `manualAllocate()` only, NOT `autoAllocate()`) |
| 1.4 | In `executeDraftCreation()`: after receipt creation, if `batch.auto_post`, call `ReceiptService.postReceipt()` → `post_receipt` RPC |
| 1.5 | In `executeDraftCreation()`: after posting, if `invoice_reference` resolved, call `AllocationService.manualAllocate()` → `allocate_receipt` RPC |
| 1.6 | Record successful allocations in `import_row_allocations` table (requires real `allocation_details.id` — NOT NULL constraint) |
| 1.7 | Record failed/skipped allocations in `import_rows.mapped_data` JSONB (NOT in `import_row_allocations`) |
| 1.8 | Update batch counters (`posted_count`, `allocated_count`) |
| 1.9 | Add `Posted`, `Allocated`, `Unmatched` to `ImportRowStatus` type in service code |
| 1.10 | Accept `auto_post` boolean in execute endpoint (default: false) |
| 1.11 | Create smoke test scripts |
| 1.12 | Run Phase D regression |
| 1.13 | Deploy `imports` Edge Function to staging and test |

### Step 2: Claude Frontend (after backend passes staging)

| # | Task |
|---|------|
| 2.1 | Add `invoice_reference` and `allocation_amount` to receipt import template guide |
| 2.2 | Add allocation columns to preview table |
| 2.3 | Add Auto-Post toggle to execute step |
| 2.4 | Update execute button text based on toggle state |
| 2.5 | Add allocation warning text |
| 2.6 | Update result summary to show posted/allocated counts |
| 2.7 | Add allocation status column to result rows table |
| 2.8 | Add `Posted`, `Allocated`, `Unmatched` row status badge colors |
| 2.9 | Send `auto_post` parameter in execute request |
| 2.10 | Build verification (`npm run build`) |
| 2.11 | Frontend UI smoke test |

### Step 3: Production Deployment

| # | Task | Owner |
|---|------|-------|
| 3.1 | Production backup | Shared |
| 3.2 | Apply `013_import_enable_auto_post.sql` on production | Codex |
| 3.3 | Deploy updated `imports` Edge Function to production | Codex |
| 3.4 | Run Phase D regression on production | Codex |
| 3.5 | Run Phase E smoke tests on production | Codex |
| 3.6 | Deploy frontend to production (Vercel) | Shared |
| 3.7 | Frontend UI walkthrough on production | Claude |
| 3.8 | Create production verification summary | Claude |

---

## 19. Rollback Notes

| Layer | Rollback Method | Notes |
|-------|----------------|-------|
| **Edge Function** | Redeploy previous `imports` Edge Function version | Reverts backend to Phase D behavior. No data loss. |
| **Frontend** | Redeploy previous Vercel deployment | Reverts UI to Phase D. No data loss. |
| **SQL migration (013)** | Only safe if no production `import_batches` rows have `auto_post = TRUE` | If `auto_post = TRUE` rows exist, review before rollback. Re-add the Phase A constraint: `ALTER TABLE public.import_batches ADD CONSTRAINT chk_import_batches_phase_a_no_auto CHECK (auto_post = FALSE AND auto_allocate = FALSE);` |
| **Posted receipts** | Do NOT delete or manually mutate posted receipts | Use verified `post_receipt` reversal/correction procedures if needed. |
| **Allocated receipts** | Do NOT delete or manually mutate allocations or journal entries | Use verified `reverse_allocation` RPC to reverse individual allocations. This restores invoice outstanding and creates reversal JEs. |

> [!WARNING]
> **If receipts have been posted or allocated during import, do not manually DELETE rows from `receipts`, `allocation_details`, `journal_entries`, or `journal_entry_lines`.** Always use the verified reversal procedures (`reverse_allocation` RPC for allocations, receipt correction procedures for posted receipts). Manual table mutations bypass business rules and audit controls.

---

*Plan created: 2026-06-05T20:54:52+08:00*  
*Codex review: 2026-06-05 — Approved with corrections*  
*Corrections applied: 2026-06-05T21:06:26+08:00*  
*Status: Codex-approved — Ready for implementation*  
*Author: Claude (GenAI-assisted development)*
