# Sprint F2 & F3 — Frontend Completion Plan

**Created**: 2026-05-27  
**Revised**: 2026-05-27 (Codex review corrections applied)  
**Status**: 📋 Planning — awaiting re-approval before implementation  
**Prerequisite**: Sprint F1 completed, committed, pushed, Codex smoke reviewed

---

## Table of Contents

1. [Current State Summary](#1-current-state-summary)
2. [Sprint F2 Scope — Reports & Customer Visibility](#2-sprint-f2-scope)
3. [Sprint F3 Scope — Enterprise-Grade Supporting Pages](#3-sprint-f3-scope)
4. [Implementation Sequence](#4-implementation-sequence)
5. [API Inventory & Rules](#5-api-inventory--rules)
6. [Codex Review Checklist](#6-codex-review-checklist)
7. [Client Demo Readiness Checklist](#7-client-demo-readiness-checklist)

---

## 1. Current State Summary

### Completed (Sprint F1)
| Page | Route | Status |
|------|-------|--------|
| Dashboard | `/` | ✅ Working |
| Invoice List | `/invoices` | ✅ Working |
| New Invoice | `/invoices/new` | ✅ Working |
| Invoice Detail | `/invoices/[id]` | ✅ Working |
| Receipt List | `/receipts` | ✅ Working |
| New Receipt | `/receipts/new` | ✅ Working |
| Receipt Detail | `/receipts/[id]` | ✅ Working |

### Existing Stubs (to be completed in F2/F3)
| Page | Route | Current State |
|------|-------|---------------|
| Customers | `/customers` | Basic list with search + cards — needs detail page |
| Reports | `/reports` | Simple stub with icon and placeholder text |
| Allocations | `/allocations` | Fully implemented wizard — needs polish |
| Credit Notes | `/credit-notes` | Stub placeholder — out of F2/F3 scope |
| Journal Entries | `/journal-entries` | Stub placeholder |
| Settings | `/settings` | Stub placeholder |

### Active API Allowlist (Sprint F2/F3)

> **IMPORTANT**: Only the following 6 endpoints are approved for active use in Sprint F2/F3.
> Everything else is placeholder-only unless separately verified and approved by Codex.

| Endpoint | Status | Usage |
|----------|--------|-------|
| `GET /customers` | ✅ Verified | Customer list + client-side lookup by ID |
| `GET /invoices` | ✅ Verified | Invoice list, customer-filtered, client-side aggregation |
| `GET /receipts` | ✅ Verified | Receipt list, customer-filtered, client-side aggregation |
| `GET /reports/aging` | ✅ Verified | Aging summary with bracket breakdown |
| `GET /reports/aging/by-customer` | ✅ Verified | Aging grouped by customer |
| `POST /allocations/manual` | ✅ Verified | Manual allocation mutation |

### ❌ NOT in Active Scope (Placeholder Only)
| Endpoint | Reason |
|----------|--------|
| `GET /customers/:id` | Not verified for F2/F3. Derive customer detail client-side from `GET /customers`. |
| `GET /journal-entries` | Not verified. Journal entries page is placeholder-only. |
| `GET /journal-entries/:id` | Not verified. No JE detail API calls. |
| `GET /allocations` | Not verified. Allocation history is placeholder-only. |
| `POST /allocations/auto` | Not verified. Keep disabled. |
| `GET /bank-accounts` | Does not exist. |
| `GET /reports/aging/customers` | Wrong route. Use `/by-customer` instead. |

### Existing Frontend Hooks
| Hook | File | Status |
|------|------|--------|
| `useAgingSummary()` | `use-reports.ts` | ✅ Active — calls `GET /reports/aging` |
| `useAgingByCustomer()` | `use-reports.ts` | ✅ Active — calls `GET /reports/aging/by-customer` |
| `useCustomers()` | `use-invoices.ts` / `use-receipts.ts` | ✅ Active — calls `GET /customers` |
| `usePostedReceipts()` | `use-allocations.ts` | ✅ Active |
| `useOutstandingInvoices()` | `use-allocations.ts` | ✅ Active |
| `useManualAllocate()` | `use-allocations.ts` | ✅ Active — calls `POST /allocations/manual` |
| `useAutoAllocate()` | `use-allocations.ts` | ❌ Disabled — throws error |

---

## 2. Sprint F2 Scope

### F2.1 — Customer List Page (Enhancement)

| Field | Detail |
|-------|--------|
| **Route** | `/customers` |
| **Purpose** | Show all customers with key metrics (outstanding balance, credit status) |
| **Existing state** | Basic list with search and customer cards already exists |

**Required UI Sections**:
1. Page header with title, subtitle count, and search bar
2. Filter chips: status (Active / Inactive / Blocked / On Hold), credit rating (A/B/C/D)
3. Data table with columns: Customer Code, Customer Name, Status, Credit Rating, Credit Limit, Outstanding Balance, Contact, Actions
4. Clickable rows → `/customers/[id]`
5. Loading / empty / error states

**Required Functions**:
- `useCustomerList(filters)` — new hook wrapping `GET /customers` with client-side filter/search
- Client-side search by customer name / code
- Client-side status and credit rating filtering

**Existing APIs Used**:
- `GET /customers` — returns `Customer[]` (via `useApi()` → raw array)
- `GET /reports/aging/by-customer` — to derive outstanding balance per customer

**Frontend-Derived Data**:
- Outstanding balance per customer: derived client-side from `GET /reports/aging/by-customer`
- All filtering and search is client-side

**Mock/Placeholder Data**: None — all data from real APIs

**Out of Scope**:
- Create / Edit / Delete customer (existing APIs exist but UI deferred)
- Customer import / export
- Customer merge
- Server-side filtering or pagination

**Acceptance Criteria**:
- [ ] All customers render in a sortable table
- [ ] Status filter works (client-side)
- [ ] Search by name/code works (client-side)
- [ ] Clickable rows navigate to `/customers/[id]`
- [ ] Loading, empty, error states are handled
- [ ] Role gating: all users can view (read-only page)

**Known Limitations**:
- No server-side pagination (client-side only, `useApi()` discards meta.total)
- Outstanding balance is derived client-side from aging report data

---

### F2.2 — Customer Detail Page

| Field | Detail |
|-------|--------|
| **Route** | `/customers/[id]` |
| **Purpose** | Show full customer profile with their invoices, receipts, and aging breakdown |

**Required UI Sections**:
1. Breadcrumb: Customers → Customer Name
2. Customer info card: name, code, status badge, credit rating badge, credit limit, contact info (email, phone, address), registration no, tax registration no
3. Credit summary card: credit limit, total outstanding, available credit, utilization % bar
4. Tab or section: **Invoices** — filtered list of this customer's invoices
5. Tab or section: **Receipts** — filtered list of this customer's receipts
6. Tab or section: **Aging** — this customer's aging breakdown
7. Loading skeleton / error / not-found states

**Required Functions**:
- Customer lookup: fetch all customers via `GET /customers`, then find the matching customer **client-side** by `id`. Do NOT call `GET /customers/:id`.
- Fetch all invoices via `GET /invoices` (no query params). Filter client-side by `customer_id`.
- Fetch all receipts via `GET /receipts` (no query params). Filter client-side by `customer_id`.
- Reuse `useAgingByCustomer()` — filter client-side by customer_id

> **IMPORTANT**: Do NOT send `customer_id` query params to `GET /invoices` or `GET /receipts`.
> Backend support for `customer_id` filter is not verified. Apply filtering client-side only.

**Existing APIs Used**:
- `GET /customers` — find selected customer client-side from the full array
- `GET /invoices` — filter client-side by customer_id
- `GET /receipts` — filter client-side by customer_id
- `GET /reports/aging/by-customer` — filter client-side by customer_id

> **NOTE**: `GET /customers/:id` is NOT used unless separately verified by Codex.
> Customer data is derived client-side from `GET /customers`.

**Frontend-Derived Data**:
- Available credit = credit_limit − total_outstanding
- Credit utilization % = (total_outstanding / credit_limit) × 100
- Invoice/receipt counts from array lengths
- All filtering by customer_id is client-side

**Mock/Placeholder Data**: None — all from real APIs

**Out of Scope**:
- Edit customer fields
- Customer credit limit change history
- Customer notes / documents

**Acceptance Criteria**:
- [ ] Customer info card renders all key fields
- [ ] Credit summary with utilization bar works
- [ ] Invoice tab shows filtered invoices with clickable rows → `/invoices/[id]`
- [ ] Receipt tab shows filtered receipts with clickable rows → `/receipts/[id]`
- [ ] Aging section shows bracket breakdown
- [ ] Not-found state for invalid customer ID
- [ ] Role gating: all users can view
- [ ] No `GET /customers/:id` API call

**Known Limitations**:
- Customer detail is derived from full customer list (client-side lookup by ID)
- All sub-data (invoices, receipts, aging) filtered client-side

---

### F2.3 — Report Center

| Field | Detail |
|-------|--------|
| **Route** | `/reports` |
| **Purpose** | Hub page with links/cards to all available reports |

**Required UI Sections**:
1. Page header: "Report Center" with subtitle
2. Report cards grid (2–3 columns):
   - AR Aging Report → `/reports/aging`
   - Invoice Summary → `/reports/invoices`
   - Receipt Summary → `/reports/receipts`
   - Customer Outstanding → `/reports/outstanding`
3. Each card: icon, title, description, "View Report" button
4. Optional: Quick summary stats (total AR outstanding, invoice count, overdue count) from dashboard data

**Required Functions**:
- No data fetching — this is a navigation hub
- Optional: reuse dashboard summary data for quick stats

**Existing APIs Used**: None directly (navigation page)

**Frontend-Derived Data**: Optional quick stats from cached dashboard queries

**Mock/Placeholder Data**: None

**Out of Scope**:
- PDF/Excel export buttons (show as disabled with "Coming Soon" tooltip)
- Custom date range report generation
- Scheduled reports

**Acceptance Criteria**:
- [ ] All 4 report cards render with correct links
- [ ] Cards navigate to correct sub-routes
- [ ] Export buttons are disabled with "Coming Soon" tooltip
- [ ] Responsive grid layout (2 cols on tablet, 1 on mobile)

**Known Limitations**: None — this is a static navigation page

---

### F2.4 — AR Aging Report

| Field | Detail |
|-------|--------|
| **Route** | `/reports/aging` |
| **Purpose** | Show aging analysis — summary totals and per-customer breakdown |

**Required UI Sections**:
1. Breadcrumb: Reports → AR Aging Report
2. ~~Date filter: "As of" date selector~~ — **DISABLED for Sprint F2**. Show current aging only. Display "As of: Today" as a static label.
3. Summary cards row: Total Outstanding, Current, 1–30 Days, 31–60 Days, 61–90 Days, 90+ Days
4. Aging by customer table: Customer Name, Current, 1–30, 31–60, 61–90, 90+, Total Outstanding
5. Clickable customer rows → `/customers/[id]`
6. Optional: Horizontal stacked bar chart showing aging distribution
7. Loading / empty / error states

**Required Functions**:
- `useAgingSummary()` — already exists in `use-reports.ts`
- `useAgingByCustomer()` — already exists in `use-reports.ts`

**Existing APIs Used**:
- `GET /reports/aging` — summary with bracket totals (NO `as_of` param sent)
- `GET /reports/aging/by-customer` — per-customer breakdown (NO `as_of` param sent)

> **IMPORTANT**: Do NOT send `as_of` parameter to backend. Backend support for `as_of` is not verified.
> Show current aging only. Keep date picker disabled/display-only until separately verified.

**Frontend-Derived Data**:
- Percentage distribution per bracket (for chart)
- Sorting by total outstanding or any bracket column

**Mock/Placeholder Data**: None — all from real APIs

**Out of Scope**:
- Export to PDF/Excel (show disabled button)
- Custom aging brackets
- Drill-down to individual invoices from aging (navigate to customer detail instead)
- `as_of` date filtering

**Acceptance Criteria**:
- [ ] Summary cards show correct bracket totals
- [ ] Customer table renders all customers with aging columns
- [ ] Clickable rows navigate to customer detail
- [ ] Loading and error states handled
- [ ] Numbers are formatted as currency
- [ ] No `as_of` param sent to backend
- [ ] Date is displayed as "As of: Today" (static label)

**Known Limitations**:
- "As of" date picker is **disabled** — shows current aging only
- Backend `as_of` support is unverified; do not use until approved by Codex

---

### F2.5 — Invoice Summary Report

| Field | Detail |
|-------|--------|
| **Route** | `/reports/invoices` |
| **Purpose** | Summary of all invoices with status breakdown and totals |

**Required UI Sections**:
1. Breadcrumb: Reports → Invoice Summary
2. Date range filter: From / To — **client-side only**. Fetch all invoices, then filter by `invoice_date` in frontend code.
3. Summary cards: Total Invoices, Total Amount, Paid Amount, Outstanding Amount, by status (Draft, Open, Overdue, Partially Paid, Paid, Cancelled)
4. Status breakdown table: Status, Count, Total Amount, % of Total
5. Optional: Donut/pie chart showing status distribution
6. Recent invoices mini-table (top 10 by date)

**Required Functions**:
- `useInvoiceList()` — existing hook, fetch all invoices (NO `date_from`/`date_to` params sent to backend)
- Client-side date filtering: filter the array by `invoice_date` within selected range
- Client-side aggregation: group by status, sum amounts

**Existing APIs Used**:
- `GET /invoices` — fetch all, NO date params sent to backend

> **IMPORTANT**: Do NOT send `date_from` or `date_to` query params to backend.
> Backend support for these filters is not verified. Apply date range filtering client-side only.

**Frontend-Derived Data**:
- All summary statistics computed client-side from the invoice array
- Status distribution, counts, percentages
- Date range filtering applied client-side

**Mock/Placeholder Data**: None

**Out of Scope**:
- Export to PDF/Excel
- Trend analysis (month-over-month)
- Custom grouping (by customer, by currency)
- Server-side date filtering

**Acceptance Criteria**:
- [ ] Summary cards show correct counts and amounts
- [ ] Status breakdown table is accurate
- [ ] Date range filter works (client-side)
- [ ] Currency formatting consistent
- [ ] No `date_from`/`date_to` params sent to backend

**Known Limitations**:
- Client-side aggregation from full invoice list — acceptable for prototype volumes
- `useApi()` discards meta.total, so total count is from array length
- Date filtering is client-side only

---

### F2.6 — Receipt Summary Report

| Field | Detail |
|-------|--------|
| **Route** | `/reports/receipts` |
| **Purpose** | Summary of all receipts with status and allocation breakdown |

**Required UI Sections**:
1. Breadcrumb: Reports → Receipt Summary
2. Date range filter: From / To — **client-side only**. Fetch all receipts, then filter by `receipt_date` in frontend code.
3. Summary cards: Total Receipts, Total Amount, Allocated Amount, Unallocated Amount
4. Payment method breakdown table: Method, Count, Total Amount
5. Status breakdown: Draft, Posted, Cancelled with counts and totals
6. Recent receipts mini-table (top 10)

**Required Functions**:
- `useReceipts()` — existing hook, fetch all receipts (NO date params sent to backend)
- Client-side date filtering by `receipt_date`
- Client-side aggregation

**Existing APIs Used**:
- `GET /receipts` — fetch all, NO date params sent to backend

> **IMPORTANT**: Do NOT send `date_from` or `date_to` query params to backend.
> Apply date range filtering client-side only.

**Frontend-Derived Data**:
- All summaries computed client-side from receipt array
- Payment method grouping, allocation summaries
- Date range filtering applied client-side

**Mock/Placeholder Data**: None

**Out of Scope**:
- Export to PDF/Excel
- Bank reconciliation view
- Cheque clearance tracking
- Server-side date filtering

**Acceptance Criteria**:
- [ ] Summary cards show correct totals
- [ ] Payment method breakdown is accurate
- [ ] Date filter works (client-side)
- [ ] Currency formatting consistent
- [ ] No date params sent to backend

**Known Limitations**:
- Client-side aggregation from receipt array
- Date filtering is client-side only

---

### F2.7 — Customer Outstanding Report

| Field | Detail |
|-------|--------|
| **Route** | `/reports/outstanding` |
| **Purpose** | List all customers with outstanding balances, ranked by amount |

**Required UI Sections**:
1. Breadcrumb: Reports → Customer Outstanding
2. Summary cards: Total Customers with Outstanding, Total Outstanding Amount, Overdue Amount
3. Customer outstanding table: Customer Name, Total Outstanding, Overdue Amount, Oldest Invoice Date, Invoice Count, % of Total AR
4. Clickable rows → `/customers/[id]`
5. Sort options: by outstanding amount (desc), by customer name, by overdue amount

**Required Functions**:
- `useAgingByCustomer()` — already exists
- Client-side: filter customers with outstanding > 0, sort, calculate percentages

**Existing APIs Used**:
- `GET /reports/aging/by-customer`

**Frontend-Derived Data**:
- Total AR outstanding, customer ranking, percentages
- Overdue amount = sum of 1-30 + 31-60 + 61-90 + 90+ buckets

**Mock/Placeholder Data**: None

**Out of Scope**:
- Export to PDF/Excel
- Statement generation
- Email overdue reminders

**Acceptance Criteria**:
- [ ] All customers with outstanding > 0 appear
- [ ] Sorted by outstanding desc by default
- [ ] Clickable rows → customer detail
- [ ] Percentages and totals are correct

**Known Limitations**:
- Derived entirely from aging by-customer data — may not include customers with zero outstanding

---

## 3. Sprint F3 Scope

### F3.1 — Allocation Page Polish

| Field | Detail |
|-------|--------|
| **Route** | `/allocations` |
| **Purpose** | Polish the existing allocation wizard — improve UX, add validation feedback |

**Existing State**: Fully implemented wizard with receipt selector, invoice grid, and manual allocation. `useAutoAllocate()` is disabled.

**Required UI Enhancements**:
1. Improve receipt selector with better search/filter
2. Add allocation success summary after manual allocation
3. Improve validation error display
4. Add "Reset" button to clear allocation amounts
5. Add confirmation dialog before submitting allocations

**Required Functions**:
- Keep `useManualAllocate()` — verified
- Keep `useAutoAllocate()` **disabled** — do NOT enable unless Codex confirms verification

**Existing APIs Used**:
- `POST /allocations/manual` — verified (ONLY active allocation mutation)
- `GET /receipts` — for receipt selector
- `GET /invoices` — for outstanding invoices

> **IMPORTANT**: Do NOT use `GET /allocations`. Allocation history is NOT in active scope.
> Do NOT use `POST /allocations/auto`. Keep disabled.

**Frontend-Derived Data**:
- Remaining unallocated balance after each allocation entry
- Allocation percentage per invoice

**Mock/Placeholder Data**:
- Auto-allocation button: show as disabled with tooltip "Auto-allocation coming soon"
- Allocation history section: **placeholder-only** with text "Allocation history will be available in a future sprint." Do NOT call `GET /allocations`.

**Out of Scope**:
- `POST /allocations/auto` activation
- `GET /allocations` API calls
- Allocation reversal UI
- Bulk allocation across multiple receipts
- Allocation history from live API

**Acceptance Criteria**:
- [ ] Manual allocation flow works end-to-end
- [ ] Validation prevents over-allocation
- [ ] Success feedback after allocation
- [ ] Auto-allocate button is disabled with tooltip
- [ ] No `POST /allocations/auto` calls
- [ ] No `GET /allocations` calls
- [ ] Allocation history section is placeholder text only

**Known Limitations**:
- No allocation history from API — placeholder only
- Auto-allocation remains disabled

---

### F3.2 — Journal Entries Page (Static Placeholder)

| Field | Detail |
|-------|--------|
| **Route** | `/journal-entries` |
| **Purpose** | **Static placeholder page** showing that journal entries are auto-generated by the system |
| **Page Type** | 🏷️ **STATIC PLACEHOLDER — No live API calls** |

> **IMPORTANT**: This page does NOT call any Journal Entries API.
> `GET /journal-entries` and `GET /journal-entries/:id` are NOT verified and NOT in active scope.
> No new JE hooks. No JE detail API calls. No JE drill-down.

**Required UI Sections**:
1. Page header: "Journal Entries" with subtitle "Auto-generated from AR transactions"
2. Info banner: "Journal entries are automatically created when invoices are posted, receipts are posted, or invoices are cancelled. This is handled entirely by the backend."
3. Feature explanation cards:
   - "Invoice Posting" — Creates Dr. Accounts Receivable / Cr. Revenue + Tax
   - "Receipt Posting" — Creates Dr. Cash/Bank / Cr. Accounts Receivable
   - "Invoice Cancellation" — Creates reversal JE
4. Reference note: "JE numbers are visible on Invoice Detail and Receipt Detail pages after posting."
5. Placeholder note: "Full journal entry listing and drill-down will be available in a future sprint when the API is verified."

**Required Functions**: None — static page only

**Existing APIs Used**: None

> JE numbers are already shown on Invoice Detail and Receipt Detail pages from the `je_no` field
> returned by verified `POST /invoices/:id/post` and `POST /receipts/:id/post` responses.
> No additional API calls are needed.

**Frontend-Derived Data**: None

**Mock/Placeholder Data**:
- Feature explanation cards with hardcoded accounting descriptions
- Clearly labeled as informational / placeholder

**Out of Scope**:
- `GET /journal-entries` calls
- `GET /journal-entries/:id` calls
- New JE hooks (`useJournalEntries`, `useJournalEntry`)
- JE list table with live data
- JE detail slide-over or modal
- Manual JE creation
- JE reversal UI
- JE export

**Acceptance Criteria**:
- [ ] Page renders with informative content about JE capabilities
- [ ] No API calls to `/journal-entries`
- [ ] No JE hooks created
- [ ] JE numbers referenced only from existing invoice/receipt post responses
- [ ] Professional appearance suitable for client demo
- [ ] Clearly labeled as placeholder

**Known Limitations**:
- Entirely static placeholder — no live journal entry data
- JE numbers are visible only on invoice/receipt detail pages (from post responses)

---

### F3.3 — Audit Log Page (Static Placeholder)

| Field | Detail |
|-------|--------|
| **Route** | `/settings/audit-log` or integrated into Settings |
| **Purpose** | **Static demo page** showing the system's audit trail capabilities |
| **Page Type** | 🏷️ **STATIC PLACEHOLDER — No live API calls** |

> **IMPORTANT**: No audit log API exists. This is a static demo/informational page only.
> No database queries. No real audit data. No mutation actions.

**Required UI Sections**:
1. Page header: "Audit Trail"
2. Info banner: "All financial transactions in the AR module are fully audited. Every create, post, cancel, and allocation action is recorded with user, timestamp, and details."
3. Feature highlight cards:
   - "Created By / Created At" — tracked on all records
   - "Posted By / Posted At" — tracked on posted invoices and receipts
   - "Cancelled By / Cancelled At" — tracked on cancelled invoices
   - "Optimistic Locking" — version field prevents concurrent modification
4. Example audit entries table (mock data) — **visibly labeled**: "⚠️ Example data — for demonstration purposes only"
5. Note: "Full audit log viewer will be available in a future sprint."

**Required Functions**: None — static page with mock example data

**Existing APIs Used**: None — no audit log API exists

**Frontend-Derived Data**: None

**Mock/Placeholder Data**:
- Example audit log entries showing post/cancel/create actions
- **Must be visibly labeled**: "⚠️ Example data — for demonstration purposes only"

**Out of Scope**:
- Real audit log API
- Audit log search/filter
- Audit log export
- Any database queries

**Acceptance Criteria**:
- [ ] Page renders with informative content about audit capabilities
- [ ] Mock data is **visibly labeled** as example data
- [ ] No API calls
- [ ] No database queries
- [ ] Professional appearance suitable for client demo

**Known Limitations**:
- Entirely static placeholder — no real audit log API

---

### F3.4 — Settings Page (Static Display-Only)

| Field | Detail |
|-------|--------|
| **Route** | `/settings` |
| **Purpose** | **Read-only display page** showing system configuration — no edits, no database writes |
| **Page Type** | 🏷️ **STATIC DISPLAY-ONLY — No mutations, no database updates** |

> **IMPORTANT**: This page does NOT update any database values.
> All displayed data comes from client-side state (Zustand store) and environment variables.
> No settings API calls. No POST/PATCH/PUT requests.

**Required UI Sections**:
1. Page header: "System Settings" with subtitle "Read-only configuration view"
2. Company Information card: company name, code, base currency, registration details (from `useCompanyStore`)
3. AR Configuration card (display-only — hardcoded reference values):
   - Default payment terms
   - Credit limit policy
   - Aging brackets (Current, 1–30, 31–60, 61–90, 90+)
   - Fiscal year settings
   - Label: "Default Configuration — read-only display for Sprint F3"
4. Environment card (Sprint demo info):
   - Current demo role: from `NEXT_PUBLIC_DEMO_USER_ROLE`
   - Demo bank account: from `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID`
   - API base URL (masked)
5. Feature Status table: which features are live vs placeholder

**Required Functions**:
- `useCompanyStore` — already exists (Zustand store)
- Read `process.env.NEXT_PUBLIC_*` values for display

**Existing APIs Used**: None — all from client-side state and env vars

**Frontend-Derived Data**: All from existing stores and env vars

**Mock/Placeholder Data**:
- AR configuration values (payment terms, aging brackets) — hardcoded display values
- Clearly labeled as "Default Configuration — read-only display for Sprint F3"

**Out of Scope**:
- Edit any settings (no edit buttons, no forms, no save actions)
- Tax code management
- Exchange rate management
- User management
- Any database write operations

**Acceptance Criteria**:
- [ ] Company info renders from store
- [ ] AR config shows sensible defaults
- [ ] Environment card shows demo role
- [ ] All cards are read-only with **no edit buttons**
- [ ] No API calls
- [ ] No database mutations

**Known Limitations**:
- No settings API — all display values are hardcoded or from env/store
- No edit capability — purely display-only

---

### F3.5 — User / Role Visibility Page (Static Reference)

| Field | Detail |
|-------|--------|
| **Route** | `/settings/roles` or tab within Settings |
| **Purpose** | **Static reference page** showing the RBAC model — what each role can do |
| **Page Type** | 🏷️ **STATIC REFERENCE — No live API calls, no role editing** |

> **IMPORTANT**: This page does NOT edit roles, assign roles, or query role tables.
> The permission matrix is hardcoded reference data matching the PRD.
> No `supabase.from("user_roles")` or similar queries.

**Required UI Sections**:
1. Page header: "Roles & Permissions"
2. Current user card: email, effective role (from `useUserRole()`), permissions summary
3. Role permission matrix table:
   | Permission | AR Clerk | AR Supervisor | Finance Manager | Auditor | System Admin |
   |------------|----------|---------------|-----------------|---------|--------------|
   | Create Invoice | ✅ | ✅ | ✅ | ❌ | ❌ |
   | Post Invoice | ✅ | ✅ | ✅ | ❌ | ❌ |
   | Cancel Invoice | ❌ | ✅ | ✅ | ❌ | ❌ |
   | Create Receipt | ✅ | ✅ | ✅ | ❌ | ❌ |
   | View Reports | ✅ | ✅ | ✅ | ✅ | ❌ |
   | View All Customers | ❌ | ✅ | ✅ | ✅ | ❌ |
   | System Config | ❌ | ❌ | ❌ | ❌ | ✅ |
4. Info banner: "Backend enforces all permissions via RLS and Edge Function auth. Frontend role gating is UX-only."
5. Note: "Role is currently sourced from NEXT_PUBLIC_DEMO_USER_ROLE (Sprint F1 demo fallback)."

**Required Functions**:
- `useUserRole()` — already exists (reads from env var, no table queries)
- Permission matrix: hardcoded display data matching PRD Part 1

**Existing APIs Used**: None — static reference page

**Frontend-Derived Data**: Current user role from `useUserRole()`

**Mock/Placeholder Data**:
- Permission matrix is static reference data — not from API
- Accurate representation of P0 RBAC model

**Out of Scope**:
- User management (create/edit/delete users)
- Role assignment UI
- Permission modification
- Any `supabase.from(...)` queries
- Any role editing API calls

**Acceptance Criteria**:
- [ ] Current user's role is displayed
- [ ] Permission matrix is accurate to PRD
- [ ] Info banner clarifies backend enforcement
- [ ] No API calls
- [ ] No database queries
- [ ] No role editing capability
- [ ] Professional appearance

**Known Limitations**:
- Role is from `NEXT_PUBLIC_DEMO_USER_ROLE` env var fallback, not real API

---

### F3.6 — Enterprise-Grade UI Polish

| Field | Detail |
|-------|--------|
| **Scope** | Cross-cutting UI improvements across all pages |
| **Purpose** | Make the prototype look production-ready for client demo |

**Required Enhancements**:
1. **Consistent loading states**: Ensure all pages use matching skeleton loaders
2. **Empty state illustrations**: Add meaningful empty state messages with icons for all list pages
3. **Breadcrumb consistency**: Ensure all sub-pages have proper breadcrumb navigation
4. **Responsive design**: Verify all pages work on tablet (1024px) and large screens (1440px+)
5. **Error boundary**: Add a global error boundary with "Something went wrong" fallback
6. **Toast consistency**: Ensure all mutations show success/error toasts
7. **Keyboard accessibility**: Tab order and Enter key for primary actions
8. **Print styles**: Basic print CSS for invoice detail page (optional)
9. **Favicon and page titles**: Set proper `<title>` tags and metadata for all pages

**Out of Scope**:
- Mobile (< 768px) responsive design
- Dark mode
- i18n / multi-language
- Accessibility audit (WCAG compliance)

**Acceptance Criteria**:
- [ ] No visual glitches on 1024px and 1440px viewports
- [ ] All list pages have consistent loading/empty/error states
- [ ] All sub-pages have breadcrumbs
- [ ] Global error boundary catches render errors

---

## 4. Implementation Sequence

### Recommended Order

```
Sprint F2 (Reports & Customer Visibility)
├── F2.1  Customer List Enhancement        (1 day)
├── F2.2  Customer Detail Page             (1.5 days)
├── F2.3  Report Center Hub               (0.5 day)
├── F2.4  AR Aging Report                 (1 day)
├── F2.5  Invoice Summary Report          (0.5 day)
├── F2.6  Receipt Summary Report          (0.5 day)
├── F2.7  Customer Outstanding Report     (0.5 day)
└── Build verification + Codex review     (0.5 day)
                                    Total: ~6 days

Sprint F3 (Enterprise-Grade Supporting Pages)
├── F3.1  Allocation Page Polish          (1 day)
├── F3.2  Journal Entries Placeholder     (0.5 day)
├── F3.3  Audit Log Placeholder           (0.5 day)
├── F3.4  Settings Page                   (0.5 day)
├── F3.5  User / Role Visibility          (0.5 day)
├── F3.6  UI Polish (cross-cutting)       (1 day)
└── Build verification + Codex review     (0.5 day)
                                    Total: ~4.5 days
```

### Dependencies

| Item | Depends On |
|------|-----------|
| F2.2 Customer Detail | F2.1 Customer List (for navigation + client-side lookup) |
| F2.4 Aging Report | F2.3 Report Center (for navigation) |
| F2.5–F2.7 Reports | F2.3 Report Center (for navigation) |
| F3.1 Allocation Polish | Sprint F1 allocations page (already done) |
| F3.2 Journal Entries | None (static placeholder) |
| F3.5 Roles Page | F3.4 Settings (for route nesting) |

---

## 5. API Inventory & Rules

### ✅ Active Allowlist — Safe to Use in F2/F3

| Endpoint | Hook | Usage |
|----------|------|-------|
| `GET /customers` | `useCustomerList()` / `useCustomers()` | Customer list + client-side ID lookup |
| `GET /invoices` | `useInvoiceList()` | Invoice list, client-side filtering |
| `GET /receipts` | `useReceipts()` | Receipt list, client-side filtering |
| `GET /reports/aging` | `useAgingSummary()` | Aging summary (NO `as_of` param) |
| `GET /reports/aging/by-customer` | `useAgingByCustomer()` | Aging by customer (NO `as_of` param) |
| `POST /allocations/manual` | `useManualAllocate()` | Manual allocation |

### Also Active (from Sprint F1 — no changes)

| Endpoint | Hook |
|----------|------|
| `POST /invoices` | `useCreateInvoice()` |
| `POST /invoices/:id/post` | `usePostInvoice()` |
| `POST /invoices/:id/cancel` | `useCancelInvoice()` |
| `POST /receipts` | `useCreateReceipt()` |
| `POST /receipts/:id/post` | `usePostReceipt()` |
| `GET /invoices/:id` | `useInvoice(id)` |
| `GET /receipts/:id` | `useReceipt(id)` |

### 🏷️ Placeholder Only — NOT in Active Scope

| Endpoint | Reason | Page |
|----------|--------|------|
| `GET /journal-entries` | Not verified. Static placeholder page only. | F3.2 |
| `GET /journal-entries/:id` | Not verified. No JE drill-down. | F3.2 |
| `GET /allocations` | Not verified. Allocation history is placeholder text. | F3.1 |
| `GET /customers/:id` | Not verified for F2/F3. Client-side lookup instead. | F2.2 |

### ❌ Forbidden — Do NOT Use

| Endpoint / Pattern | Reason |
|--------------------|--------|
| `POST /allocations/auto` | Not verified. Keep disabled. |
| `GET /reports/aging/customers` | Wrong route. Use `/by-customer` instead. |
| `GET /bank-accounts` | Does not exist. |
| `supabase.from(...)` in hooks | No frontend direct table queries. |
| Service role key in frontend | Security violation. |
| `date_from`/`date_to` params to backend | Not verified. Use client-side filtering. |
| `as_of` param to aging endpoints | Not verified. Show current aging only. |

### Hard Rules (Preserved from F1)

- ❌ No `/reports/aging/customers` — use `/by-customer`
- ❌ No `GET /bank-accounts`
- ❌ No `supabase.from(...)` in frontend hooks
- ❌ No service role key in frontend
- ❌ `/allocations/auto` disabled
- ❌ No backend code changes
- ❌ No SQL migration changes
- ❌ No Edge Function changes
- ❌ No new Edge Functions created
- ❌ No P2–P5 work
- ❌ Public schema only — no `ar.*`

---

## 6. Codex Review Checklist

After implementing Sprint F2 and F3, submit for Codex review with these checks:

### Active API Compliance
- [ ] Only 6 active endpoints used: `GET /customers`, `GET /invoices`, `GET /receipts`, `GET /reports/aging`, `GET /reports/aging/by-customer`, `POST /allocations/manual`
- [ ] No `GET /customers/:id` calls (client-side lookup from `GET /customers`)
- [ ] No `GET /journal-entries` or `GET /journal-entries/:id` calls
- [ ] No `GET /allocations` calls
- [ ] No `date_from`/`date_to` params sent to backend
- [ ] No `as_of` param sent to aging endpoints
- [ ] All list endpoints treated as raw arrays (no `{ data, total }` wrapping)

### Forbidden Patterns
- [ ] No `supabase.from(...)` direct table queries in hooks
- [ ] No service role key usage in frontend
- [ ] No calls to `/reports/aging/customers` (wrong route)
- [ ] No calls to `GET /bank-accounts`
- [ ] No calls to `POST /allocations/auto`
- [ ] `POST /allocations/manual` is the only allocation mutation
- [ ] `bank_account_id` only from `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID`
- [ ] `tax_code_id` not sent in create invoice payloads

### Placeholder Pages
- [ ] Journal Entries page is static placeholder — no API calls
- [ ] Audit Log page is static placeholder — mock data labeled as examples
- [ ] Settings page is read-only display — no edit buttons, no database writes
- [ ] Role Visibility page is static reference — no role editing, no table queries

### Role Gating
- [ ] `useUserRole()` reads from `NEXT_PUBLIC_DEMO_USER_ROLE` only
- [ ] No unsupported Supabase table queries for role data
- [ ] Mutation buttons hidden for non-operational roles
- [ ] Report pages accessible to all authenticated users

### Build & Scope
- [ ] `npm run build` passes with zero errors
- [ ] No backend, SQL migration, or Edge Function modifications
- [ ] No P2–P5 features implemented
- [ ] No new Edge Functions created
- [ ] All new pages have loading, empty, and error states
- [ ] Public schema only — no `ar.*`

### Data Integrity
- [ ] Financial mutations only via verified P0/P1 endpoints
- [ ] No frontend-side financial calculations that bypass backend
- [ ] Currency formatting consistent across all pages
- [ ] Date filtering is client-side only

---

## 7. Client Demo Readiness Checklist

After F2 + F3 are complete, the client demo should cover:

### Full Demo Flow
- [ ] Login → Dashboard
- [ ] Dashboard → Report Center → AR Aging Report
- [ ] Customer List → Customer Detail (with invoices/receipts/aging tabs)
- [ ] Invoice List → New Invoice → Create & Post → Invoice Detail
- [ ] Receipt List → New Receipt → Create & Post → Receipt Detail
- [ ] Allocations → Manual allocation wizard
- [ ] Invoice Detail → Cancel Invoice
- [ ] Settings → Company info, AR config, role matrix
- [ ] Journal Entries → static placeholder (explains JE auto-generation)

### Demo Environment
- [ ] `NEXT_PUBLIC_DEMO_USER_ROLE=Finance Manager`
- [ ] `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID` configured with real UUID
- [ ] Test customer(s) with invoices and receipts in system
- [ ] `npm run build` passes
- [ ] `npm run dev` starts without errors

### Client-Facing Messages
- [ ] "Core AR workflow is production-ready"
- [ ] "Reports provide real-time visibility into AR position"
- [ ] "All business rules enforced by backend"
- [ ] "Export and advanced analytics coming in next phase"

---

*Document created: 2026-05-27T20:06:00+08:00*  
*Revised: 2026-05-27T20:12:00+08:00 (Codex review corrections applied)*  
*Sprint F2 & F3 — Frontend completion plan — awaiting re-approval*
