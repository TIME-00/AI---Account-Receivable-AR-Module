# Sprint F4 Phase F — Allocation Details / Allocation History Frontend Display

**Date**: 2026-06-07  
**Author**: Claude (GenAI-assisted development)  
**Status**: 🟢 Codex-approved — Ready for implementation  
**Codex Review**: 2026-06-07 — Approved with corrections (applied)  
**Prerequisites**: Phase A ✅, Phase B ✅, Phase C ✅, Phase D ✅, Phase E ✅

---

## 1. Current State Summary

| Capability | Status |
|------------|--------|
| `allocation_details` table with RLS | ✅ Provisioned in 001 + 006 |
| `allocate_receipt` RPC (creates allocations) | ✅ P1 verified |
| `reverse_allocation` RPC | ✅ P1 verified |
| `GET /allocations` Edge Function endpoint | ⚠️ Implemented but **returns raw UUIDs only** — no receipt_no, invoice_no, customer_name |
| `GET /allocations` tenant isolation | ❌ **Broken** — `_auth` param unused, admin client bypasses RLS, no company_id filter |
| `vw_allocation_detail_full` database view | ❌ **Does not exist** — no pre-built denormalized view |
| RLS on `allocation_details` | ✅ Correctly defined — `rls_check_allocation()` checks both receipt + invoice company |
| Allocation Wizard (create allocations) | ✅ Working — manual allocation via `POST /allocations/manual` |
| Receipt import auto-allocation | ✅ Phase E verified |
| Allocation History display | ❌ **Placeholder text** — "Allocation history will be available in a future sprint." |
| Receipt detail → linked invoices | ❌ **Progress bar only** — no allocation detail rows |
| Invoice detail → linked receipts | ❌ **No allocation info at all** |
| `useAllocations()` hook | ❌ **Empty stub** — returns `{ allocations: [], loading: false, error: null }` |
| Allocation History component | ❌ **Does not exist** |
| Customer detail → allocation tab | ❌ **Not available** |

**The backend requires enhancement before Phase F frontend can proceed.** The `GET /allocations` endpoint returns raw `allocation_details` rows with UUIDs only — no `receipt_no`, `invoice_no`, or `customer_name`. Additionally, the service method bypasses RLS and does not filter by company_id, creating a tenant isolation vulnerability. Codex must fix these issues before the frontend can display allocation data.

---

## 2. Problem Statement

Users can create allocations via the Allocation Wizard and via receipt import auto-allocation, but they have **no way to view allocation history or details**:

1. **Allocation Wizard** shows a placeholder where history should appear.
2. **Receipt detail page** shows a progress bar but does not list which invoices the receipt was allocated to.
3. **Invoice detail page** has no allocation section at all — users cannot see which receipts paid for an invoice.
4. **Receipt import result** shows allocation status badges but does not link to the allocation detail record.

This means users must mentally track which receipts cover which invoices. For an enterprise AR module, this is a critical visibility gap — finance teams need full allocation traceability for reconciliation, audit, and dispute resolution.

---

## 3. Phase F Objective

Display allocation details and allocation history clearly across the frontend so that users can:

- See the **full allocation trace** for any receipt (which invoices it was applied to).
- See the **payment history** for any invoice (which receipts paid it).
- View **allocation history** in the Allocation Wizard page.
- Understand allocation **amounts, dates, methods, and statuses** at a glance.

### Key Principles

> Phase F is **read-only display only**. It does not create, modify, or reverse any allocations. All data is fetched via `GET /allocations`, which must first be fixed by Codex for tenant isolation, JOIN data, and access control (see §8).

> [!CAUTION]
> **Phase F must NOT enable `POST /allocations/auto`.** The auto-allocation endpoint remains disabled. Phase F adds no mutation controls, no auto-allocation triggers, and no reversal buttons. Only read-only display of existing allocation data.

---

## 4. User-Facing Workflow

### 4.1 Allocation Wizard — History Section

**Before (current):**
> "Allocation history will be available in a future sprint."

**After (Phase F):**
- A searchable/filterable allocation history table replaces the placeholder.
- Shows all allocations for the current company, most recent first.
- Filterable by status (Active / Reversed), method (Manual / Auto_FIFO / Auto_Amount).
- Each row shows: receipt_no, invoice_no, customer_name, allocated_amount, allocation_date, method, status.
- Clickable receipt_no → navigates to `/receipts/{receipt_id}`.
- Clickable invoice_no → navigates to `/invoices/{invoice_id}`.

### 4.2 Receipt Detail Page — Allocation Details Section

**Before (current):**
- Allocation Progress card: bar + percentage + applied/available amounts.
- No details about which invoices were allocated.

**After (Phase F):**
- Keep existing Allocation Progress card.
- Add a new **"Allocation Details"** section below the progress card.
- Table listing all allocations for this receipt (filtered by `receipt_id`).
- Columns: Invoice No (clickable), Allocated Amount, Allocation Date, Method, Status.
- For each row: show invoice `total_amount` and `outstanding` as context.
- If no allocations exist, show a clean empty state: "No allocations yet."
- For Fully Allocated receipts, show a summary confirmation.

### 4.3 Invoice Detail Page — Payment Allocations Section

**Before (current):**
- No allocation information.

**After (Phase F):**
- Add a new **"Payment Allocations"** section (or tab).
- Table listing all allocations against this invoice (filtered by `invoice_id`).
- Columns: Receipt No (clickable), Allocated Amount, Allocation Date, Method, Status.
- For each row: show receipt `receipt_amount` as context.
- Shows how the invoice outstanding was reduced by each receipt.
- If no allocations exist, show empty state: "No payments allocated yet."

### 4.4 Receipt Import Result — Allocation Link (Optional Enhancement)

**Before (current):**
- Allocation status badge (Allocated/Skipped/Unmatched/Error) with invoice_no text.

**After (Phase F):**
- Allocated rows: make invoice_no clickable → navigates to `/invoices/{invoice_id}`.
- Allocated rows: show allocated_amount alongside the badge.
- No structural change needed — this is a minor polish.

---

## 5. Pages and Components to Update

### 5.1 New Shared Component: `AllocationHistoryTable`

**Path**: `frontend/src/components/allocation-history-table.tsx`

A reusable table component that renders allocation detail rows. Used by:
- Allocation Wizard page (full history, all filters)
- Receipt detail page (filtered by receipt_id)
- Invoice detail page (filtered by invoice_id)

**Props:**
```typescript
interface AllocationHistoryTableProps {
  receiptId?: string;     // Filter by receipt
  invoiceId?: string;     // Filter by invoice
  showReceiptColumn?: boolean;  // Hide receipt column on receipt detail page
  showInvoiceColumn?: boolean;  // Hide invoice column on invoice detail page
  showFilters?: boolean;        // Show status/method filter chips
  maxRows?: number;             // Limit visible rows (with "View all" link)
}
```

**Columns displayed:**

| Column | Shown When | Description |
|--------|-----------|-------------|
| Receipt No | `showReceiptColumn = true` | Clickable → `/receipts/{receipt_id}` |
| Invoice No | `showInvoiceColumn = true` | Clickable → `/invoices/{invoice_id}` |
| Customer | Always | `customer_name` from receipt join |
| Allocated Amount | Always | Formatted currency |
| Allocation Date | Always | Formatted date |
| Method | Always | Badge: Manual (blue), Auto_FIFO (purple), Auto_Amount (teal) |
| Status | Always | Badge: Active (green), Reversed (red/strikethrough) |

### 5.2 Updated Hook: `useAllocations`

**Path**: `frontend/src/hooks/use-allocations.ts`

Replace the empty stub with a real implementation.

> [!IMPORTANT]
> **`useApi()` returns `json.data` only — not `meta`.** If the hook needs pagination metadata (total count, total pages), it must use `rawFetch()` to get the full response envelope `{ data, meta }`. If pagination is not needed for the initial implementation, `api.get()` is sufficient. Design the hook to work correctly with the project's existing API utilities.

```typescript
interface UseAllocationsOptions {
  receiptId?: string;
  invoiceId?: string;
  status?: 'Active' | 'Reversed';
  method?: AllocationMethod;
  page?: number;
  limit?: number;
}

// If using api.get() (no pagination meta):
interface UseAllocationsResult {
  allocations: AllocationDetailFull[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// If using rawFetch() (with pagination meta):
interface UseAllocationsResultPaginated {
  allocations: AllocationDetailFull[];
  loading: boolean;
  error: string | null;
  meta: { page: number; page_size: number; total: number } | null;
  refetch: () => void;
}
```

Calls `GET /allocations?receipt_id=&invoice_id=&status=&method=&page=&page_size=`.

**Implementation choice**: For receipt detail and invoice detail pages (small result sets), `api.get()` is sufficient. For the Allocation Wizard full history (potentially large), use `rawFetch()` with pagination. The hook should support both modes.

### 5.3 Extended Type: `AllocationDetailFull`

**Path**: `frontend/src/types/index.ts`

The existing `AllocationDetail` type lacks joined fields. Add an extended type:

```typescript
interface AllocationDetailFull extends AllocationDetail {
  // Joined from receipts
  receipt_no: string;
  receipt_customer_name: string;
  receipt_amount: number;
  receipt_currency: string;
  receipt_allocated_amount: number;
  receipt_unallocated_amount: number;
  // Joined from invoices
  invoice_no: string;
  invoice_customer_name: string;
  invoice_total_amount: number;
  invoice_outstanding: number;
  invoice_due_date: string | null;
  // Joined from customers
  customer_id: string;
  customer_code: string;
}
```

### 5.4 Pages to Update

| Page | File | Change |
|------|------|--------|
| Allocation Wizard | `app/(dashboard)/allocations/page.tsx` | Replace placeholder with `<AllocationHistoryTable showFilters />` |
| Receipt Detail | `app/(dashboard)/receipts/[id]/page.tsx` | Add "Allocation Details" section with `<AllocationHistoryTable receiptId={id} showInvoiceColumn />` |
| Invoice Detail | `app/(dashboard)/invoices/[id]/page.tsx` | Add "Payment Allocations" section with `<AllocationHistoryTable invoiceId={id} showReceiptColumn />` |
| Receipt Import | `app/(dashboard)/receipts/import/page.tsx` | Optional: make invoice_no clickable in allocated result rows |

---

## 6. Data to Display

### 6.1 Allocation History Table Columns

| Data Field | Source | Display |
|------------|--------|---------|
| `id` | `allocation_details.id` | Hidden (used for key/linking) |
| `receipt_no` | Joined from `receipts` | Clickable link to `/receipts/{receipt_id}` |
| `invoice_no` | Joined from `invoices` | Clickable link to `/invoices/{invoice_id}` |
| `customer_name` | `receipt_customer_name` from join | Plain text |
| `allocated_amount` | `allocation_details.allocated_amount` | Formatted currency |
| `allocation_date` | `allocation_details.allocation_date` | Formatted date |
| `allocation_method` | `allocation_details.allocation_method` | Badge (Manual / Auto_FIFO / Auto_Amount) |
| `status` | `allocation_details.status` | Badge (Active / Reversed) |

### 6.2 Receipt Context (shown on invoice detail page)

| Data Field | Source | Display |
|------------|--------|---------|
| `receipt_amount` | Joined from `receipts` | Formatted currency |
| `receipt_allocated_amount` | Joined from `receipts` | Formatted currency |
| `receipt_unallocated_amount` | Joined from `receipts` | Formatted currency |

### 6.3 Invoice Context (shown on receipt detail page)

| Data Field | Source | Display |
|------------|--------|---------|
| `invoice_total_amount` | Joined from `invoices` | Formatted currency |
| `invoice_outstanding` | Joined from `invoices` | Formatted currency |
| `invoice_due_date` | Joined from `invoices` | Formatted date |

### 6.4 Allocation Source Display

The `allocation_method` field indicates the source:

| Method Value | Display Label | Badge Color | Meaning |
|-------------|--------------|-------------|---------|
| `Manual` | Manual | Blue | Allocated via Allocation Wizard or import auto-allocation |
| `Auto_FIFO` | FIFO | Purple | Allocated via auto-allocation FIFO |
| `Auto_Amount` | Amount Match | Teal | Allocated via auto-allocation amount match |

> [!NOTE]
> The current `allocate_receipt` RPC hardcodes `allocation_method = 'Manual'` for all allocations, including those from `autoAllocate()`. This means the method badge will show "Manual" for all existing allocations. This is a known limitation — correcting it requires a backend change to the auto-allocation flow, which is out of scope for Phase F.

---

## 7. UI Layout Proposal

### 7.1 Allocation History Table (Allocation Wizard Page)

```
┌─────────────────────────────────────────────────────────────────┐
│ 📋 Allocation History                                     [Filters] │
│                                                                 │
│ Status: [All] [Active] [Reversed]   Method: [All] [Manual] ... │
│                                                                 │
│ ┌──────────┬──────────┬──────────┬──────────┬────────┬────────┐│
│ │Receipt No│Invoice No│ Customer │ Amount   │  Date  │ Status ││
│ ├──────────┼──────────┼──────────┼──────────┼────────┼────────┤│
│ │RCT-00006 │DN-00001  │ ABC Sdn  │  1.00    │07 Jun  │ Active ││
│ │RCT-00005 │INV-00003 │ XYZ Ltd  │ 500.00   │05 Jun  │ Active ││
│ │RCT-00004 │INV-00002 │ DEF Corp │ 250.00   │03 Jun  │Reversed││
│ └──────────┴──────────┴──────────┴──────────┴────────┴────────┘│
│                                              Page 1 of 3  [>]  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Receipt Detail — Allocation Details Section

```
┌─────────────────────────────────────────────────────────────────┐
│ 📊 Allocation Progress                                         │
│ ████████████████████████████████████████ 100%                   │
│ Applied: $1.00          Available: $0.00                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 🔗 Allocation Details                                           │
│                                                                 │
│ ┌──────────┬──────────┬──────────┬────────┬────────────────────┐│
│ │Invoice No│ Amount   │  Date    │ Method │Invoice Outstanding ││
│ ├──────────┼──────────┼──────────┼────────┼────────────────────┤│
│ │DN-00001  │  1.00    │ 07 Jun   │ Manual │ 1,999.00           ││
│ └──────────┴──────────┴──────────┴────────┴────────────────────┘│
│                                                                 │
│ Total Allocated: $1.00 across 1 invoice                         │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Invoice Detail — Payment Allocations Section

```
┌─────────────────────────────────────────────────────────────────┐
│ 💰 Payment Allocations                                          │
│                                                                 │
│ Invoice Total: $2,000.00    Outstanding: $1,999.00              │
│                                                                 │
│ ┌──────────┬──────────┬──────────┬────────┬────────┐           │
│ │Receipt No│ Amount   │  Date    │ Method │ Status │           │
│ ├──────────┼──────────┼──────────┼────────┼────────┤           │
│ │RCT-00006 │  1.00    │ 07 Jun   │ Manual │ Active │           │
│ └──────────┴──────────┴──────────┴────────┴────────┘           │
│                                                                 │
│ Total Received: $1.00 from 1 receipt                            │
└─────────────────────────────────────────────────────────────────┘
```

### 7.4 Badge / Status Display Design

| Element | Style | Color |
|---------|-------|-------|
| Status: Active | Solid badge | Green (`bg-emerald-500/20 text-emerald-400`) |
| Status: Reversed | Solid badge + strikethrough on amount | Red (`bg-red-500/20 text-red-400`) |
| Method: Manual | Outline badge | Blue (`border-blue-500/30 text-blue-400`) |
| Method: Auto_FIFO | Outline badge | Purple (`border-purple-500/30 text-purple-400`) |
| Method: Auto_Amount | Outline badge | Teal (`border-teal-500/30 text-teal-400`) |
| Receipt No link | Text link | Blue (`text-blue-400 hover:text-blue-300`) |
| Invoice No link | Text link | Blue (`text-blue-400 hover:text-blue-300`) |

---

## 8. Backend / API Tasks for Codex

### 8.1 GET /allocations Endpoint — Current State

| Check | Result |
|-------|--------|
| Endpoint exists? | ✅ `GET /allocations/` in `allocations/index.ts` |
| Supports `receipt_id` filter? | ✅ Query parameter |
| Supports `invoice_id` filter? | ✅ Query parameter |
| Supports `status` filter? | ✅ 'Active' / 'Reversed' |
| Supports `method` filter? | ✅ 'Manual' / 'Auto_FIFO' / 'Auto_Amount' |
| Supports pagination? | ✅ `page`, `page_size` |
| **Joins receipt + invoice data?** | ❌ **No** — returns raw `allocation_details` rows with UUIDs only |
| **Returns receipt_no, invoice_no?** | ❌ **No** — only `receipt_id`, `invoice_id` UUIDs |
| **Company_id filtering?** | ❌ **No** — `_auth` parameter is unused (prefixed with `_`) |
| **Uses admin client?** | ⚠️ **Yes** — `getAdminClient()` bypasses RLS entirely |
| **AR Clerk customer assignment?** | ❌ **No** — no customer access filtering |
| **Hidden customer exclusion?** | ❌ **No** — no `is_hidden` filter |
| **System Admin blocked?** | ❌ **No** — no role exclusion check |

### 8.2 Access Control and Tenant Isolation

> [!CAUTION]
> **The `listAllocations()` service method has multiple access control gaps:**
>
> 1. **Tenant isolation gap**: The `_auth` parameter is unused (underscore prefix). The service uses `getAdminClient()` (service_role key) which bypasses RLS. No `company_id` filter is applied. A user could potentially see allocations from other companies.
> 2. **AR Clerk customer assignment not enforced**: AR Clerks should only see allocations for their assigned customers. The current query does not filter by customer assignment.
> 3. **System Admin not excluded**: System Admin is an administrative role and must NOT be allowed to read operational allocation data from this client-facing API.
> 4. **Hidden customers not excluded**: Allocations linked to `customers.is_hidden = true` are returned without filtering.
>
> The RLS policies on `allocation_details` are correctly defined via `rls_check_allocation()`, but they are **never enforced** because the service uses the admin client.

**Codex must fix `listAllocations()` to enforce all of the following:**

1. **Company isolation** — Filter by `auth.companyId` via JOIN to `receipts` table (since `allocation_details` has no `company_id` column).
2. **Role whitelist** — Allow only: `AR Clerk`, `AR Supervisor`, `Finance Manager`, `Auditor`. Reject `System Admin` and any other role.
3. **AR Clerk customer assignment** — If the user's role is `AR Clerk`, additionally filter allocations to only those involving customers assigned to the clerk.
4. **Hidden customer exclusion** — Exclude allocations where the linked customer has `customers.is_hidden = true` or is deleted.
5. **Use `auth` parameter** — Remove `_` prefix from `_auth` and use the auth context for all filtering.

### 8.3 Missing JOIN Data

The current `listAllocations()` returns:
```json
{
  "data": [{
    "id": "uuid",
    "receipt_id": "uuid",
    "invoice_id": "uuid",
    "allocated_amount": 1.00,
    "allocation_method": "Manual",
    "status": "Active"
  }]
}
```

The frontend needs:
```json
{
  "data": [{
    "id": "uuid",
    "receipt_id": "uuid",
    "invoice_id": "uuid",
    "allocated_amount": 1.00,
    "allocation_method": "Manual",
    "status": "Active",
    "receipt_no": "RCT-202606-00006",
    "receipt_customer_name": "ABC Sdn Bhd",
    "receipt_amount": 1.00,
    "receipt_currency": "MYR",
    "receipt_allocated_amount": 1.00,
    "receipt_unallocated_amount": 0.00,
    "invoice_no": "DN-202606-00001",
    "invoice_total_amount": 2000.00,
    "invoice_outstanding": 1999.00,
    "invoice_due_date": "2026-07-07",
    "customer_id": "uuid",
    "customer_code": "C-001"
  }]
}
```

**Codex must enhance `listAllocations()`** to JOIN `allocation_details` with `receipts`, `invoices`, and `customers` tables and return the full denormalized row.

### 8.4 Required Denormalized Response Fields

| Field | Source | Required |
|-------|--------|----------|
| `id` | `allocation_details.id` | ✅ |
| `receipt_id` | `allocation_details.receipt_id` | ✅ |
| `receipt_no` | `receipts.receipt_no` | ✅ |
| `invoice_id` | `allocation_details.invoice_id` | ✅ |
| `invoice_no` | `invoices.invoice_no` | ✅ |
| `customer_id` | `receipts.customer_id` | ✅ |
| `customer_code` | `customers.customer_id` (the business code) | ✅ |
| `customer_name` | `receipts.customer_name` | ✅ |
| `allocated_amount` | `allocation_details.allocated_amount` | ✅ |
| `allocation_date` | `allocation_details.allocation_date` | ✅ |
| `allocation_method` | `allocation_details.allocation_method` | ✅ |
| `status` | `allocation_details.status` | ✅ |
| `receipt_amount` | `receipts.receipt_amount` | ✅ |
| `receipt_allocated_amount` | `receipts.allocated_amount` | ✅ |
| `receipt_unallocated_amount` | `receipts.unallocated_amount` | ✅ |
| `invoice_total_amount` | `invoices.total_amount` | ✅ |
| `invoice_outstanding` | `invoices.outstanding` | ✅ |
| `receipt_currency` | `receipts.currency` | ✅ |
| `invoice_due_date` | `invoices.due_date` | ✅ |

### 8.5 RLS on `allocation_details` (correctly defined)

| Check | Result |
|-------|--------|
| RLS enabled on `allocation_details`? | ✅ via `rls_check_allocation()` |
| `rls_check_allocation()` checks receipt company? | ✅ via `rls_check_receipt()` |
| `rls_check_allocation()` checks invoice company? | ✅ via `rls_check_invoice()` |
| Cross-document integrity? | ✅ Verifies `receipt.company_id = invoice.company_id AND receipt.customer_id = invoice.customer_id` |

RLS is correctly defined but currently bypassed by the admin client. Once Codex fixes the access control (§8.2), these policies provide an additional safety layer.

### 8.6 Hidden Customer Filtering (Codex-mandated)

> [!WARNING]
> **Hidden customer allocations must be excluded from the Phase F UI.** This is a Codex-mandated requirement, not optional.
>
> The backend `listAllocations()` query must JOIN to `customers` and exclude rows where `customers.is_hidden = true`.
>
> Additionally, the frontend may apply a defensive filter to exclude any allocation rows where customer visibility fields indicate hidden status, as a secondary safeguard.

### 8.7 Missing Single Allocation Endpoint

| Check | Result |
|-------|--------|
| `GET /allocations/:id` route defined? | ✅ Route exists in `index.ts` |
| Handler implemented? | ❌ **Route has no handler** — falls through without response |

Phase F does not need this endpoint. All display is via the filtered list endpoint.

### 8.8 Required Codex Backend Work

| # | Task | Priority | Description |
|---|------|----------|-------------|
| 1 | **Fix `listAllocations()` — use `auth` parameter** | **P0 — Blocker** | Remove `_` prefix from `_auth`, use `auth.companyId` and `auth.role` for filtering |
| 2 | **Add company isolation** | **P0 — Blocker** | Filter by `auth.companyId` via JOIN to `receipts` table |
| 3 | **Add role whitelist** | **P0 — Blocker** | Allow only: AR Clerk, AR Supervisor, Finance Manager, Auditor. Deny System Admin. |
| 4 | **Add AR Clerk customer assignment filter** | **P0 — Blocker** | If role is AR Clerk, filter to assigned customers only |
| 5 | **Add hidden customer exclusion** | **P0 — Blocker** | JOIN to `customers`, exclude `is_hidden = true` |
| 6 | **Add JOINs for denormalized response** | **P0 — Blocker** | JOIN `receipts`, `invoices`, `customers` — return all fields in §8.4 |
| 7 | Verify response shape matches `AllocationDetailFull` type | P1 | Field names must match frontend type |
| 8 | Smoke test endpoint with all filters | P1 | `receipt_id`, `invoice_id`, `status`, `method` |
| 9 | Deploy fixed `allocations` Edge Function to staging | P1 | Stage before production |
| 10 | Run tenant isolation + access control verification | P1 | Cross-company, System Admin, AR Clerk assignment tests |
| 11 | Deploy to production after verification | P1 | After staging passes |
| 12 | Optional: Implement `GET /allocations/:id` | P2 | Nice-to-have single allocation endpoint |

> [!WARNING]
> **Frontend implementation cannot begin until Codex completes tasks 1–6.** The current endpoint is not safe to call from the frontend due to tenant isolation, access control, and hidden customer gaps.

---

## 9. Database Migration Needs

> [!IMPORTANT]
> **No database migration is needed for Phase F.** All required tables, RLS policies, and indexes are already provisioned:
> - `allocation_details` table (001)
> - `v_receipt_summary` view with `allocation_count` (002) — provides receipt-level aggregation
> - RLS policies + `rls_check_allocation()` (006)
> - `allocate_receipt` and `reverse_allocation` RPCs (007)
>
> Note: No dedicated allocation details view exists (no `vw_allocation_detail_full`). The `listAllocations()` service method will perform the JOINs directly in the query. This is acceptable — a dedicated view is not required.

---

## 10. Security Rules

| Rule | Enforcement |
|------|-------------|
| **Read-only display only** | Phase F only calls `GET /allocations`. No POST/PUT/DELETE. |
| **No financial mutation** | No allocation creation, reversal, or modification from Phase F code. |
| **No auto-allocation controls** | `POST /allocations/auto` remains disabled. No UI controls added for auto-allocation. |
| **No direct Supabase client queries** | Frontend calls the Edge Function API, not Supabase client directly. |
| **Company isolation** | `GET /allocations` filters by `auth.companyId` via JOIN to `receipts`. |
| **Allowed read roles only** | AR Clerk, AR Supervisor, Finance Manager, Auditor. |
| **System Admin excluded** | System Admin cannot read allocation operational data from this API. |
| **AR Clerk customer assignment** | AR Clerk sees only allocations for assigned customers. |
| **Hidden customer exclusion** | Allocations linked to `customers.is_hidden = true` are excluded by backend. Frontend applies defensive filter as secondary safeguard. |
| **RLS double-check** | `rls_check_allocation()` verifies company access on both receipt AND invoice. |
| **No secrets or tokens in frontend** | API calls use existing auth session token. |

---

## 11. Testing Plan

### 11.1 Backend Tests (Codex)

| # | Test | Expected |
|---|------|----------|
| 1 | `deno check allocations/index.ts` | No type errors |
| 2 | `GET /allocations` (no filters) | Returns denormalized allocation rows for current company |
| 3 | `GET /allocations?receipt_id={id}` | Returns only allocations for that receipt |
| 4 | `GET /allocations?invoice_id={id}` | Returns only allocations for that invoice |
| 5 | `GET /allocations?status=Active` | Returns only Active allocations |
| 6 | `GET /allocations?status=Reversed` | Returns only Reversed allocations |
| 7 | `GET /allocations?method=Manual` | Returns only Manual allocations |
| 8 | Auditor role can read allocation history | 200 OK with data |
| 9 | System Admin denied | 403 Forbidden |
| 10 | AR Clerk sees only assigned customer allocations | Filtered by customer assignment |
| 11 | Cross-company request denied | Returns empty or 403, no data leakage |
| 12 | Hidden customer allocations excluded | Allocations for `is_hidden = true` customers not in response |
| 13 | Response includes all denormalized fields | `receipt_no`, `invoice_no`, `customer_id`, `customer_code`, `customer_name`, amounts, outstanding |
| 14 | Pagination works correctly | `meta.total` and `meta.page` returned |

### 11.2 Frontend Tests (Claude)

| # | Test | Expected |
|---|------|----------|
| 15 | `npm.cmd run build` | No TypeScript errors |
| 16 | Allocation Wizard → History section renders | Placeholder removed, real allocation history table appears |
| 17 | Receipt detail → "Allocation Details" section renders | Shows linked invoices for allocated receipt |
| 18 | Invoice detail → "Payment Allocations" section renders | Shows linked receipts for paid invoice |
| 19 | No mutation controls added | No "Create", "Reverse", "Auto-Allocate" buttons in Phase F components |
| 20 | Empty state displays correctly | Receipt/invoice with no allocations shows clean empty text |
| 21 | Clickable receipt_no navigates to receipt detail | Link works |
| 22 | Clickable invoice_no navigates to invoice detail | Link works |

### 11.3 Regression Tests

| # | Test | Expected |
|---|------|----------|
| 23 | Allocation Wizard still works (create allocation) | Wizard flow unchanged |
| 24 | Receipt import auto-allocation still works | Phase E behavior preserved |
| 25 | Receipt list page unchanged | Allocation progress columns still display |
| 26 | `POST /allocations/auto` remains disabled | No change to existing disabled behavior |

---

## 12. Evidence Document Plan

After Phase F is completed and verified, create:

**`docs/evidence/frontend-sprint-f4/SPRINT_F4_PHASE_F_ALLOCATION_DISPLAY_VERIFICATION_SUMMARY.md`**

Contents:
1. Phase F scope completed
2. Files changed (frontend only unless Codex backend changes needed)
3. Allocation Wizard history section description
4. Receipt detail allocation section description
5. Invoice detail payment allocation section description
6. Screenshot evidence or UI walkthrough notes
7. Security confirmation (read-only, no mutations)
8. Tenant isolation verification
9. Regression test results
10. Known limitations

---

## 13. Out-of-Scope Items

| Feature | Status | Reason |
|---------|--------|--------|
| Create new allocations | ❌ Out of scope | Existing Allocation Wizard handles this |
| Reverse allocations | ❌ Out of scope | Existing reversal RPC handles this |
| Cancel allocations | ❌ Out of scope | Not an AR module concept |
| **Enable `POST /allocations/auto`** | ❌ **Explicitly blocked** | Phase F is read-only. Auto-allocation endpoint remains disabled. No mutation controls added. |
| New financial RPCs | ❌ Not needed | Existing `GET /allocations` is sufficient |
| New database migrations | ❌ Not needed | All schema exists (confirmed §9) |
| Auto-allocation UI controls | ❌ Out of scope | No auto-allocation triggers or buttons added |
| PDF/Image/OCR | ❌ Out of scope | Future phase |
| Allocation editing/modification | ❌ Out of scope | Financial records are immutable |
| Customer detail allocation tab | ❌ Deferred | Nice-to-have; receipt/invoice detail pages cover the need |
| Export allocation data | ❌ Deferred | Reports module handles export |
| Fix `allocation_method` for auto-allocations | ❌ Backend change needed | RPC hardcodes 'Manual' — requires separate fix |
| Direct Supabase frontend queries | ❌ Prohibited | All data via Edge Function API |

---

## 14. Implementation Order

### Step 1: Codex Backend Fixes (Blockers)

| # | Task | Priority |
|---|------|----------|
| 1.1 | Update and test `listAllocations()` locally: use `auth` parameter, add company_id filter, add role whitelist, add AR Clerk customer assignment, add hidden customer exclusion, add JOINs | **P0** |
| 1.2 | `deno check allocations/index.ts` — verify no type errors | **P0** |
| 1.3 | Deploy fixed `allocations` Edge Function to staging | **P0** |
| 1.4 | Run API smoke tests on staging (§11.1 tests 1–14) | **P0** |

### Step 2: Claude Frontend Implementation (after backend staging verified)

| # | Task |
|---|------|
| 2.1 | Add `AllocationDetailFull` type to `types/index.ts` |
| 2.2 | Implement `useAllocations()` hook — replace empty stub with real API call using verified Edge Function |
| 2.3 | Create reusable `AllocationHistoryTable` component |
| 2.4 | Update Allocation Wizard page — replace placeholder with `AllocationHistoryTable` |
| 2.5 | Update Receipt detail page — add "Allocation Details" section |
| 2.6 | Update Invoice detail page — add "Payment Allocations" section |
| 2.7 | Optional: Update Receipt import result — make invoice_no clickable |
| 2.8 | Build verification (`npm.cmd run build`) |
| 2.9 | Frontend UI smoke test (§11.2 tests 15–22) |
| 2.10 | Verify no mutation controls added — no direct Supabase queries |

### Step 3: Frontend Preview Deployment

| # | Task | Owner |
|---|------|-------|
| 3.1 | Deploy frontend preview (Vercel) | Shared |
| 3.2 | Verify preview renders correctly | Claude |

### Step 4: Production Deployment

| # | Task | Owner |
|---|------|-------|
| 4.1 | Production backup | Shared |
| 4.2 | Deploy fixed `allocations` Edge Function to production | Codex |
| 4.3 | Run production API smoke tests (§11.1 tests 1–14) | Codex |
| 4.4 | Deploy frontend to production (Vercel) | Shared |
| 4.5 | Frontend UI walkthrough on production | Claude |
| 4.6 | Create production verification summary | Claude |

---

## 15. Recommended Codex Scope

Phase F requires **backend fixes before frontend can proceed**. Codex's scope:

### P0 Blockers (must complete before frontend starts)

1. **Fix `AllocationService.listAllocations()`** — this is the core backend task:
   - Remove `_` prefix from `_auth` parameter. Use `auth.companyId` and `auth.role`.
   - Add company isolation via JOIN to `receipts` where `r.company_id = auth.companyId`.
   - Add role whitelist: allow only AR Clerk, AR Supervisor, Finance Manager, Auditor. **Deny System Admin.**
   - Add AR Clerk customer assignment filter: if role is AR Clerk, filter to assigned customers only.
   - Add hidden customer exclusion: JOIN to `customers`, exclude `is_hidden = true`.
   - Add JOINs to `receipts`, `invoices`, `customers` for denormalized response (all fields in §8.4).
2. **Keep endpoint read-only** — no financial mutations. Do not enable `POST /allocations/auto`.
3. **Deploy and test** — staging first, then production.

### Denormalized Response Fields Required

`allocation_id`, `receipt_id`, `receipt_no`, `invoice_id`, `invoice_no`, `customer_id`, `customer_code`, `customer_name`, `allocated_amount`, `allocation_date`, `status`, `allocation_method`, `receipt_amount`, `receipt_allocated_amount`, `receipt_unallocated_amount`, `invoice_total_amount`, `invoice_outstanding`, `receipt_currency`, `invoice_due_date`.

### Access Control Requirements

| Rule | Enforcement |
|------|-------------|
| Active auth role required | ✅ |
| Allowed roles: AR Clerk, AR Supervisor, Finance Manager, Auditor | ✅ |
| System Admin denied | ✅ |
| Company isolation via `auth.companyId` | ✅ |
| AR Clerk customer assignment | ✅ |
| Hidden/deleted customer exclusion | ✅ |
| Read-only (no mutations) | ✅ |

### Not Needed

- No new RPCs or financial functions.
- No new database migrations.
- No new Edge Functions (fix existing `allocations` function only).
- No schema changes.
- No new tables or views.

> [!WARNING]
> **The GET /allocations endpoint currently has tenant isolation and access control vulnerabilities.** Codex must fix `listAllocations()` before the frontend calls this endpoint. Do not expose the unfixed endpoint to the frontend.

---

## 16. Rollback Plan

| Layer | Rollback Method | Notes |
|-------|----------------|-------|
| **Frontend** | Redeploy previous Vercel deployment | Reverts UI to pre-Phase F (placeholders). No data loss. Roll back first if UI display breaks. |
| **Edge Function** | Redeploy previous `allocations` Edge Function version | Reverts API to pre-Phase F behavior (raw UUIDs, no access control). No data loss. |
| **SQL migration** | None needed | Phase F has no database migration. |
| **Financial data** | Unaffected | Phase F is read-only. No financial mutations. No receipts, invoices, allocations, or journal entries were created or modified by Phase F. |

> [!NOTE]
> **Rollback order**: Frontend first, then Edge Function if needed. Since Phase F is purely read-only display, rollback is low-risk — it simply reverts the UI to showing placeholders instead of allocation history.

---

*Plan created: 2026-06-07T04:56:07+08:00*  
*Codex review: 2026-06-07 — Approved with corrections*  
*Corrections applied: 2026-06-07T05:11:42+08:00*  
*Status: Codex-approved — Ready for implementation*  
*Author: Claude (GenAI-assisted development)*
