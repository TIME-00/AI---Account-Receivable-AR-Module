# Frontend Prototype Completion Plan — TSH Synergy AR Module

> **Document**: Frontend Prototype Completion Plan  
> **Version**: 1.2 (Codex Final Cleanup)  
> **Created**: 2026-05-26  
> **Last Updated**: 2026-05-26 — Codex Final Cleanup Applied  
> **Status**: Draft — Awaiting Final Approval  
> **Author**: AI Assistant (GenAI-assisted planning)

---

## Table of Contents

1. [Project Context](#1-project-context)
2. [Frontend Prototype Objective](#2-frontend-prototype-objective)
3. [Key Findings from Frontend Inspection](#3-key-findings-from-frontend-inspection)
4. [Current Functional Pages](#4-current-functional-pages)
5. [Partial and Empty Stub Pages](#5-partial-and-empty-stub-pages)
6. [Missing Frontend Pages](#6-missing-frontend-pages)
7. [Pages to Complete First (Priority Order)](#7-pages-to-complete-first-priority-order)
8. [Recommended Route Structure](#8-recommended-route-structure)
9. [Shared UI Components Needed](#9-shared-ui-components-needed)
10. [Existing P0/P1 API Reuse Points](#10-existing-p0p1-api-reuse-points)
11. [Mock / Placeholder Scope](#11-mock--placeholder-scope)
12. [Form Fields Specification](#12-form-fields-specification)
13. [Report Page Structure](#13-report-page-structure)
14. [Customer Demo Flow](#14-customer-demo-flow)
15. [8 Implementation Sprints](#15-8-implementation-sprints)
16. [Open Questions](#16-open-questions)
17. [Non-Scope Items](#17-non-scope-items)
18. [Verification Plan](#18-verification-plan)
19. [Implementation Safety Warnings](#19-implementation-safety-warnings)
20. [Codex Review Changelog](#20-codex-review-changelog)

---

## 1. Project Context

### P0/P1 Completed Status

| Phase | Scope | Status |
|---|---|---|
| **P0** | RLS, tenant isolation, role-based access control, AR Clerk customer assignment, Auditor read-only, System Admin config-only | ✅ **Completed & Production Verified** |
| **P1** | Financial RPCs, atomic financial mutation flows (invoices, receipts, allocations, journal entries) | ✅ **Completed & Production Verified** |

**Production smoke tests passed for:**
1. Post invoice
2. Post receipt
3. Manual allocation
4. Reverse allocation
5. Cancel invoice / reverse journal entry
6. Handle bounced cheque
7. Duplicate bounced cheque rejected correctly
8. Journal entries balanced at header and line level

**Evidence**: `docs/evidence/production-smoke/P1_PRODUCTION_SMOKE_TEST_SUMMARY.md`

### Decision to Pause P2–P5

P2 through P5 (Transactional Outbox, Reliable Event Logging, AI Assistant, advanced features) are **paused indefinitely**. The immediate priority is completing a usable frontend prototype that the client can interact with to record invoices, receipts, and related AR transactions.

---

## 2. Frontend Prototype Objective

> Deliver a usable, enterprise-grade frontend prototype that lets the client **create invoices, record receipts, allocate payments, and view reports** — all backed by the existing P0/P1 production APIs.

**Principles:**
- Prioritize a working prototype experience over advanced backend features.
- Every page should have loading state, empty state, error state, and basic validation.
- Use existing API hooks where available.
- If backend support is missing, use clearly labelled mock or placeholder data.
- Do not break existing P0/P1 verified backend flows.
- Do not introduce new backend scope.
- **Never call an API endpoint that does not have a deployed Edge Function** (see Section 19).
- **Never send mock/fake IDs to the backend** — mock data is display-only.
- **Never use frontend direct Supabase table queries** to work around missing Edge Functions — use hardcoded mock/placeholder data instead.

---

## 3. Key Findings from Frontend Inspection

### Technology Stack (Confirmed)
- **Framework**: Next.js 15.1 (App Router) + React 19
- **Language**: TypeScript
- **Styling**: Tailwind CSS 3.4 with custom design tokens (brand palette, sidebar theme, status colors)
- **Typography**: Inter (sans) + JetBrains Mono (mono) via Google Fonts
- **State Management**: Zustand (company store) + TanStack React Query v5 (server state)
- **Forms**: react-hook-form + Zod validation
- **UI Primitives**: Radix UI (dialog, dropdown, select, popover, tabs, tooltip, scroll-area, avatar, label, separator, slot)
- **Charts**: Recharts
- **Icons**: Lucide React
- **Toasts**: Sonner
- **Auth**: Supabase Auth (email/password)

### Architecture Patterns
- **API Layer**: Custom `useApi()` hook wraps `fetch()` with automatic JWT injection, `X-Company-Id` header, API response envelope parsing, and `BR-xxx` error code toast notifications.
- **Route Groups**: `(dashboard)` route group wraps all authenticated pages with sidebar + header layout.
- **Auth Guard**: Dashboard layout redirects to `/login` if no user session detected.
- **Company Context**: Zustand store with localStorage persistence; injected into every API call.

### API Response Shape — Definitive Rule

The backend returns responses using `successResponse(data, meta)` which produces:
```json
{ "success": true, "data": [...], "meta": { "total": 42, "page": 1, "page_size": 20, "has_next": true } }
```

The `useApi()` hook (`hooks/use-api.ts`) extracts `json.data` and returns it directly. **It does NOT return `meta`.**

**Definitive rules for all frontend hooks:**

1. **List hooks must expect arrays.** The `useApi()` hook returns `json.data` which is the raw data array for list endpoints (`GET /invoices`, `GET /receipts`, `GET /customers`). New or updated hooks must type their return as an array (e.g., `Invoice[]`), NOT as `{ invoices: Invoice[], total: number }`.
2. **Do NOT destructure `{ invoices, total }`, `{ receipts, total }`, or `{ customers, total }`.** If existing hooks use this pattern, they must be updated in Sprint 1 to align with the actual `useApi()` return shape.
3. **Pagination metadata (`total`, `has_next`, `page`) is NOT available** to frontend hooks via the current `useApi()` implementation. For the prototype, implement client-side pagination on the returned array. Do NOT extend `useApi()` to expose `meta` unless explicitly approved.
4. **Do NOT assume any response shape** that has not been verified against the actual Edge Function code.

### File Structure
```
frontend/src/
├── app/
│   ├── globals.css                    # Tailwind base + glass-card utilities
│   ├── layout.tsx                     # Root layout with providers
│   ├── login/page.tsx                 # Login page
│   └── (dashboard)/
│       ├── layout.tsx                 # Sidebar + Header + Auth guard
│       ├── page.tsx                   # Dashboard
│       ├── invoices/
│       │   ├── page.tsx              # Invoice List (stub)
│       │   └── new/page.tsx          # New Invoice (3-step wizard)
│       ├── receipts/
│       │   ├── page.tsx              # Receipt List (full)
│       │   └── new/page.tsx          # New Receipt (full)
│       ├── allocations/page.tsx       # Allocation Wizard (full)
│       ├── customers/page.tsx         # Customer List (stub)
│       ├── credit-notes/page.tsx      # Credit Notes (stub)
│       ├── reports/page.tsx           # Report Center (stub)
│       ├── journal-entries/page.tsx   # Journal Entries (stub)
│       └── settings/page.tsx          # Settings (stub)
├── components/
│   ├── features/
│   │   ├── allocations/              # 3 components (table, receipt panel, invoice panel)
│   │   ├── dashboard/                # 6 chart components
│   │   ├── invoices/                 # 4 components (header form, line table, review, customer search)
│   │   └── receipts/                 # 6 components (filters, table, form sections, summary bar)
│   ├── layout/
│   │   ├── header.tsx                # Top header (search, company switcher, user menu)
│   │   └── sidebar.tsx               # Side navigation
│   └── ui/
│       ├── kpi-card.tsx              # Dashboard metric card
│       ├── loading-button.tsx        # Button with spinner
│       ├── status-badge.tsx          # Colored status pill
│       ├── step-indicator.tsx        # Multi-step wizard progress
│       └── summary-row.tsx           # Label-value pair
├── hooks/
│   ├── use-api.ts                    # Global API client hook
│   ├── use-allocation-logic.ts       # Allocation wizard state machine
│   ├── use-allocations.ts            # Allocation API hooks
│   ├── use-dashboard.ts              # Dashboard + aging API hooks
│   ├── use-invoice-calculator.ts     # Real-time tax calculation engine
│   ├── use-invoice-form.ts           # Invoice form orchestration
│   ├── use-invoices.ts               # Invoice CRUD API hooks
│   └── use-receipts.ts               # Receipt CRUD API hooks
├── lib/
│   ├── error-messages.ts             # BR-xxx error code mappings
│   ├── invoice-calculator.ts         # Tax + discount calculation logic
│   ├── invoice-schema.ts             # Zod schema for invoice form
│   ├── receipt-schema.ts             # Zod schema for receipt form
│   ├── supabase.ts                   # Supabase client singleton
│   └── utils.ts                      # cn(), formatCurrency(), formatDate(), formatAmount(), pct()
├── providers/
│   ├── auth-provider.tsx             # Supabase auth context
│   ├── query-provider.tsx            # TanStack Query provider
│   └── toast-provider.tsx            # Sonner toast provider
├── stores/
│   └── company-store.ts              # Zustand company context store
└── types/
    └── index.ts                      # All TypeScript interfaces (327 lines)
```

---

## 4. Current Functional Pages

| Route | Page | Status | Details |
|---|---|---|---|
| `/login` | Login | ✅ **Complete** | Supabase email/password auth, error handling, loading spinner, gradient background with glassmorphism card |
| `/` | AR Dashboard | ✅ **Complete** | 4 KPI cards (live data), Aging bar chart (live), Composition donut (live), DSO trend (mock), Credit Risk (mock), Quick Stats row (live) |
| `/invoices/new` | New Invoice | ✅ **Complete** | 3-step wizard (Header → Lines → Review), full Zod validation, customer search overlay, live tax calculation engine, Create Draft + Create & Post mutations via P1 API |
| `/receipts` | Receipt List | ✅ **Complete** | Multi-dimensional filters (status, customer, search), paginated table with receipt data, inline Post action, receipt count badge. Fully wired to `GET /receipts` API |
| `/receipts/new` | New Receipt | ✅ **Complete** | Customer selector with outstanding preview, payment method (CHQ conditional fields), bank account selector, amount + currency + exchange rate, remarks, Save Draft / Create & Post. Fully wired to P1 API |
| `/allocations` | Allocation Wizard | ✅ **Complete** | Split-screen (receipt panel + invoice panel), FIFO auto-preview, manual allocation table with real-time validation (over-allocation guard, zero-amount guard), submit mutation. Fully wired to `POST /allocations/manual` |

---

## 5. Partial and Empty Stub Pages

### Partial

| Route | Page | What Exists | What is Missing |
|---|---|---|---|
| `/invoices` | Invoice List | Page header + "New Invoice" button + "coming soon" placeholder | Data table, status filters, customer dropdown, search, pagination, clickable rows |

### Empty Stubs (Header + "coming soon" placeholder only)

| Route | Page | Placeholder Text |
|---|---|---|
| `/customers` | Customer Management | "Customer management module coming soon" |
| `/credit-notes` | Credit Notes | "Credit Notes module coming soon" |
| `/reports` | Report Center | "Report Center coming soon" |
| `/journal-entries` | Journal Entries | "Journal Entries module coming soon" |
| `/settings` | System Settings | "System Settings module coming soon" |

---

## 6. Missing Frontend Pages

| Priority | Page | Route | Why Needed |
|---|---|---|---|
| 🔴 **Critical** | Invoice List (with data table) | `/invoices` | Client must see invoices they created |
| 🔴 **Critical** | Invoice Detail / View | `/invoices/[id]` | Click into any invoice to see header + lines + status + JE link |
| 🔴 **Critical** | Receipt Detail / View | `/receipts/[id]` | Click into any receipt to see full details + allocation history |
| 🔴 **Critical** | AR Aging Report | `/reports/aging` | Core AR report for client demo |
| 🟡 **High** | Report Center Hub | `/reports` | Navigation page to all reports |
| 🟡 **High** | Invoice Summary Report | `/reports/invoices` | Aggregate view of all invoices |
| 🟡 **High** | Receipt Summary Report | `/reports/receipts` | Aggregate view of all receipts |
| 🟡 **High** | Customer Outstanding Report | `/reports/outstanding` | Per-customer outstanding balances |
| 🟡 **High** | Customer List (with data table) | `/customers` | View customers in the system |
| 🟠 **Nice-to-have** | Customer Detail / View | `/customers/[id]` | Click into customer to see credit info + transactions |
| 🟠 **Nice-to-have** | Credit Notes List | `/credit-notes` | Visible but can use invoice API filtered by doc_type |
| ⚪ **Deferred** | Journal Entries List | `/journal-entries` | **Placeholder only** — no Edge Function route exists. Show `je_no` inline on invoice/receipt detail pages. No API hook, no data table, no detail page. |
| ⚪ **Deferred** | Journal Entry Detail | `/journal-entries/[id]` | **NOT IMPLEMENTED** — no Edge Function route. Not needed for prototype. |
| ⚪ **Deferred** | Settings (GL Accounts, Tax Codes) | `/settings` | System Admin only, not needed for demo |

---

## 7. Pages to Complete First (Priority Order)

> **Minimum Viable Demo (MVD)** — complete these 4 items before anything else:

1. **Invoice List** — wire up the existing `/invoices` API to a full data table with status filtering
2. **Invoice Detail** — view invoice header, line items, posting status, JE reference
3. **Receipt Detail** — view receipt details, allocation progress bar, linked invoices
4. **AR Aging Report** — the most critical report for any AR module demo

**After MVD:**

5. Customer List (wire to existing `/customers` API)
6. Invoice Summary Report
7. Receipt Summary Report
8. Customer Outstanding Report
9. Customer Detail view
10. Journal Entries List — **placeholder only** (no API available)

---

## 8. Recommended Route Structure

```
/login                          → Login page
/                               → Dashboard (landing)
├── /customers                  → Customer List
│   └── /customers/[id]         → Customer Detail (view-only)
├── /invoices                   → Invoice List (filterable table)
│   ├── /invoices/new           → New Invoice (3-step wizard) ✅ EXISTS
│   └── /invoices/[id]          → Invoice Detail (read-only view)
├── /credit-notes               → Credit Note List (lower priority)
├── /receipts                   → Receipt List ✅ EXISTS
│   ├── /receipts/new           → New Receipt ✅ EXISTS
│   └── /receipts/[id]          → Receipt Detail (read-only view)
├── /allocations                → Allocation Wizard ✅ EXISTS
├── /reports                    → Report Center Hub
│   ├── /reports/aging          → AR Aging Report
│   ├── /reports/invoices       → Invoice Summary Report
│   ├── /reports/receipts       → Receipt Summary Report
│   └── /reports/outstanding    → Customer Outstanding Report
├── /journal-entries            → Journal Entry List ⚠️ PLACEHOLDER ONLY (no Edge Function route)
└── /settings                   → System Settings (deferred)
```

> The `(dashboard)` route group already wraps all authenticated pages with the sidebar + header layout. All new pages go inside `src/app/(dashboard)/`.

---

## 9. Shared UI Components Needed

### Already Available ✅

| Component | File | Purpose |
|---|---|---|
| `KpiCard` | `components/ui/kpi-card.tsx` | Dashboard metric cards with icon, value, subtitle, trend |
| `LoadingButton` | `components/ui/loading-button.tsx` | Button with loading spinner state |
| `StatusBadge` | `components/ui/status-badge.tsx` | Colored status pills (Draft, Open, Paid, etc.) |
| `StepIndicator` | `components/ui/step-indicator.tsx` | Multi-step wizard progress indicator |
| `SummaryRow` | `components/ui/summary-row.tsx` | Label-value pair display row |

### New Components to Build 🔧

| Component | Purpose | Reuse Across |
|---|---|---|
| `DataTable` | Sortable, paginated table with column definitions | Invoice List, Receipt List, Customer List, all Reports |
| `EmptyState` | Standardized empty state with icon + message + optional CTA button | All list pages when no data |
| `ErrorState` | Standardized error state with retry button | All data-fetching pages |
| `LoadingSkeleton` | Shimmer loading skeleton for tables and cards | All list/detail pages |
| `PageHeader` | Consistent page header with title, subtitle, and action buttons | All pages (extract from current repeating pattern) |
| `DetailField` | Label + value pair for detail/view pages | Invoice Detail, Receipt Detail, Customer Detail |
| `FilterBar` | Reusable filter strip (date range, status, customer dropdown, search) | Invoice List, Reports |
| `DateRangePicker` | Date range selector for reports | All report pages |
| `ExportButton` | CSV/PDF export action button (placeholder initially) | All report pages |
| `ConfirmDialog` | Modal confirmation for destructive actions | Cancel invoice, reverse allocation |
| `SectionCard` | Titled card section with border header (similar to glass-card) | Detail pages, report sections |
| `Breadcrumb` | Navigation breadcrumb trail | Detail pages (e.g., `Invoices > INV-2026-0001`) |

---

## 10. Existing P0/P1 API Reuse Points

### Endpoints Available and Their Frontend Mapping

| Page | API Endpoint | Existing Hook | Hook Status |
|---|---|---|---|
| Dashboard | `GET /reports/dashboard` | `useDashboardSummary()` | ✅ Live — working |
| Dashboard | `GET /reports/aging` | `useAgingSummary()` | ✅ Live — working |
| Dashboard | `GET /reports/aging/by-customer` | `useAgingByCustomer()` | ✅ Live — working |
| Invoice List | `GET /invoices` | — | 🔧 Need new `useInvoices(filters)` hook (endpoint exists) |
| Invoice Detail | `GET /invoices/:id` | — | 🔧 Need new `useInvoice(id)` hook (endpoint exists) |
| New Invoice | `POST /invoices` | `useCreateInvoice()` | ✅ Live — working |
| Post Invoice | `POST /invoices/:id/post` | `usePostInvoice()` | ✅ Live — working |
| Receipt List | `GET /receipts` | `useReceipts(filters)` | ✅ Live — working |
| Receipt Detail | `GET /receipts/:id` | `useReceipt(id)` | ✅ Hook exists |
| New Receipt | `POST /receipts` | `useCreateReceipt()` | ✅ Live — working |
| Post Receipt | `POST /receipts/:id/post` | `usePostReceipt()` | ✅ Live — working |
| Cancel Receipt | `POST /receipts/:id/cancel` | `useCancelReceipt()` | ✅ Hook exists |
| Allocation Wizard | `POST /allocations/manual` | `useManualAllocate()` | ✅ Live — working |
| Auto Allocation | `POST /allocations/auto` | `useAutoAllocate()` | ✅ Hook exists |
| Customer List | `GET /customers` | `useCustomers()` | ✅ Hook exists (basic) |
| Customer Outstanding | `GET /invoices` (filtered) | `useCustomerOutstanding()` | ✅ Hook exists |
| AR Aging Report | `GET /reports/aging` + `/aging/by-customer` | Both hooks exist | ✅ Ready |
| Journal Entry List | — | — | ⛔ **NO Edge Function route** — `journal-entries/index.ts` does not exist. Placeholder only. |
| Bank Accounts | — | — | ⛔ **NO Edge Function** — `GET /bank-accounts` is not backed by an Edge Function. Mock only. |

### Edge Functions Deployed to Production

| Function | Routes Handled | Has `index.ts`? |
|---|---|---|
| `invoices` | CRUD + post + cancel | ✅ Yes |
| `receipts` | CRUD + post + cancel + bounced cheque | ✅ Yes |
| `allocations` | Manual + auto + reverse | ✅ Yes |
| `customers` | List + detail | ✅ Yes |
| `reports` | Dashboard summary + aging + aging/by-customer | ✅ Yes |
| `journal-entries` | ⚠️ `service.ts` exists but **NO `index.ts`** — not routable | ⛔ No |
| `credit-notes` | List (via invoices filtered by doc_type) | ✅ Yes |
| `debit-notes` | List (via invoices filtered by doc_type) | ✅ Yes |
| `daily-overdue` | Scheduled overdue status updater | ✅ Yes |

> **⚠️ CRITICAL**: Only functions with `index.ts` are callable via Edge Function URL. `journal-entries` has a `service.ts` but no routable `index.ts`. Do NOT create a frontend hook that calls `GET /journal-entries` — it will 404.

---

## 11. Mock / Placeholder Scope

| Page / Feature | What is Mocked | Reason | Label Strategy |
|---|---|---|---|
| Dashboard — DSO Trend Chart | `DSO_TREND_DATA` hardcoded array | No DSO calculation RPC exists | `[DEMO]` badge on chart |
| Dashboard — Credit Risk Chart | `CREDIT_RISK_DATA` hardcoded array | No credit risk aggregation RPC exists | `[DEMO]` badge on chart |
| Invoice Form — Tax Codes | Mock `TaxCodeOption[]` in `useTaxCodes()` — **DISPLAY-ONLY** | No config lookup Edge Function deployed. **⚠️ Do NOT send mock `tax_code_id` (e.g., `tc-sr6`) to the backend — it will fail FK validation.** | Comment in code: `// MOCK DATA — display only, do NOT send to backend` |
| Invoice Form — Payment Terms | Mock `PaymentTermOption[]` in `usePaymentTerms()` | No config lookup Edge Function deployed | Comment in code: `// MOCK DATA — replace with API` |
| Receipt Form — Bank Accounts | Mock `BankAccount[]` in `useBankAccounts()` — **hardcoded placeholder only** | **⚠️ `GET /bank-accounts` is NOT backed by an Edge Function.** The existing hook calls this endpoint but it will fail. Must be replaced with hardcoded frontend placeholder data. **Do NOT use Supabase direct table queries.** | Comment in code: `// MOCK DATA — no Edge Function exists for /bank-accounts` |
| Journal Entries — Entire Module | Placeholder page only. Show `je_no` from invoice/receipt post responses inline. | **⚠️ `journal-entries/index.ts` does NOT exist.** The `service.ts` exists but is not routable. Do NOT create an API hook for journal entries. | "Coming soon" placeholder retained |
| Credit Notes List | Entire page content | Can filter from invoices API by `doc_type` but lower priority | "Coming soon" or basic list |
| Settings Page | All content | Deferred entirely — System Admin only | "Coming soon" placeholder retained |
| Export CSV/PDF buttons | Button visible but non-functional | Export logic not in scope for prototype | Tooltip: "Export coming soon" |
| Global Search (header) | Input visible but non-functional | Search infrastructure not built | Placeholder text only |
| Notification Bell (header) | Badge shows "3" but no dropdown | Notification system not built | Static badge |

> **Rule**: All mock data in code must be labelled with `// MOCK DATA — replace with API` comments, and mock sections visible in the UI should display a `[DEMO]` badge.

> **⚠️ CRITICAL SAFETY RULES (Codex Review):**
> 1. **Tax Code IDs**: The mock tax codes (e.g., `tc-sr6`, `tc-st10`) are **fake UUIDs**. The backend will reject them on FK validation. When submitting an invoice to the backend, **omit `tax_code_id` from the payload** if no real ID is available. Tax calculation should remain frontend-only for the prototype — show computed tax amounts in the UI but send `tax_code_id: undefined` (or omit the field) to the backend.
> 2. **Bank Account IDs**: The `useBankAccounts()` hook calls `GET /bank-accounts` which has **no Edge Function**. Replace this hook with hardcoded frontend placeholder data. **Do NOT use Supabase direct table queries** to bypass missing Edge Functions.
> 3. **Journal Entries**: Do NOT call `GET /journal-entries` — there is no routable Edge Function. Only display `je_no` values returned inline from `POST /invoices/:id/post` and `POST /receipts/:id/post` responses.
> 4. **No frontend direct table queries**: Do NOT use the Supabase client to query database tables directly (e.g., `supabase.from('bank_accounts').select(...)`) to work around missing Edge Functions. All data access must go through deployed Edge Functions or use hardcoded mock/placeholder data.

---

## 12. Form Fields Specification

### 12A. New Invoice Page ✅ (Already Implemented)

**Step 1 — Header:**

| Field | Type | Required | Data Source |
|---|---|---|---|
| Document Type | Select: Invoice / Credit Note / Debit Note | ✅ | Static enum |
| Customer | Searchable dropdown with overlay | ✅ | `GET /customers` API |
| Invoice Date | Date input (YYYY-MM-DD) | ✅ | User input, default today |
| Currency | Select (MYR, SGD, USD) | ✅ | Customer default currency |
| Exchange Rate | Number input | ✅ (default 1.0) | User input |
| Reference No | Text input (max 50 chars) | Optional | User input |
| CN Type | Select: Linked / Standalone | Conditional (CN only) | Static enum |
| Ref Invoice | Searchable dropdown | Conditional (Linked CN) | `GET /invoices` API |
| Reason Code | Select: Return / Discount / Price Adjustment / Error Correction / Other | Conditional (CN only) | Static enum |

**Step 2 — Line Items (repeating rows, min 1):**

| Field | Type | Required | Validation |
|---|---|---|---|
| Description | Text (max 200 chars) | ✅ | Min 1 char |
| Item Code | Text (max 30 chars) | Optional | — |
| Quantity | Number | ✅ | Must be > 0 |
| UOM | Text (max 10 chars) | Optional | Default "pcs" |
| Unit Price | Number | ✅ | Must be ≥ 0 |
| Discount % | Number | Optional | 0–100, mutually exclusive with Discount Amt |
| Discount Amt | Number | Optional | Must be ≥ 0, mutually exclusive with Discount % |
| Tax Code | Select dropdown | Optional | Mock data (9 tax codes) — **DISPLAY-ONLY, do NOT send mock IDs to backend** |
| GL Account | Text | Optional | — |
| Cost Center | Text (max 20 chars) | Optional | — |
| Line Remarks | Text (max 200 chars) | Optional | — |

**Calculated fields**: Line Amount, Tax Amount, Line Total (per line), Subtotal, Total Tax, Grand Total, Base Total (footer).

**Step 3 — Review & Submit:**

| Field | Type | Required |
|---|---|---|
| Internal Remarks | Textarea | Optional |
| Invoice Remarks | Textarea | Optional |
| Actions | "Save as Draft" button + "Create & Post" button | — |

---

### 12B. New Receipt Page ✅ (Already Implemented)

| Field | Type | Required | Data Source | Notes |
|---|---|---|---|---|
| Receipt Date | Date input (YYYY-MM-DD) | ✅ | Default today | — |
| Customer | Searchable dropdown | ✅ | `GET /customers` API | Shows outstanding preview when selected |
| Payment Method | Select (CHQ/TT/CASH/CC/GIRO/OFST/ONLN) | ✅ | Static enum | CHQ triggers conditional fields |
| Currency | Select | ✅ | Customer default | — |
| Receipt Amount | Number input | ✅ | User input | Must be > 0 |
| Exchange Rate | Number input | Optional | Default 1.0 | Visible when currency ≠ base currency |
| Bank Account | Select dropdown | ✅ | **⚠️ MOCK — no Edge Function exists.** Use hardcoded frontend placeholder data only. Do NOT call `GET /bank-accounts`. Do NOT use Supabase direct table queries. | Hardcoded mock data only |
| Reference No / Cheque No | Text input (max 50 chars) | Required if CHQ | User input | — |
| Cheque Date | Date input | Required if CHQ | User input | — |
| Value Date | Date input | Optional | User input | — |
| Remarks | Textarea | Optional | User input | — |

**Actions**: Toggle between "Save as Draft" and "Create & Post" + Submit button.

---

## 13. Report Page Structure

### 13A. Report Center Hub (`/reports`)

Navigation page with 4 report cards:

| Card | Title | Description | Route |
|---|---|---|---|
| 📊 | AR Aging Report | Outstanding balances by aging bucket | `/reports/aging` |
| 📄 | Invoice Summary | All invoice statistics and listing | `/reports/invoices` |
| 💰 | Receipt Summary | Collection statistics and listing | `/reports/receipts` |
| 👥 | Customer Outstanding | Per-customer balance breakdown | `/reports/outstanding` |

---

### 13B. AR Aging Report (`/reports/aging`)

**Data Source**: `GET /reports/aging` + `GET /reports/aging/by-customer` (both hooks exist)

| Section | Content |
|---|---|
| **Filters** | As-of Date picker, Customer search, Export button |
| **KPI Strip** | Total Outstanding · Total Overdue · Overdue % · Total Customers |
| **Aging Bucket Chart** | Bar chart: Current / 1-30 / 31-60 / 61-90 / 90+ days (reuse existing `AgingChart` component) |
| **Customer Aging Table** | Paginated `DataTable` — Customer Name, Customer Code, Credit Limit, Credit Rating, Total Outstanding, Current, 1-30, 31-60, 61-90, 90+, Action (view customer) |

---

### 13C. Invoice Summary Report (`/reports/invoices`)

**Data Source**: `GET /invoices` with server-side filtering (endpoint exists)

| Section | Content |
|---|---|
| **Filters** | Date range, Status filter, Customer filter, Export |
| **KPI Strip** | Total Invoices · Total Amount · Average Invoice Value · Outstanding Balance |
| **Status Breakdown** | Donut chart — Draft / Open / Overdue / Partially Paid / Paid / Cancelled |
| **Invoice Table** | Paginated `DataTable` — Invoice No, Date, Customer, Doc Type, Currency, Total Amount, Outstanding, Status, Posted Date |

---

### 13D. Receipt Summary Report (`/reports/receipts`)

**Data Source**: `GET /receipts` with server-side filtering (endpoint exists)

| Section | Content |
|---|---|
| **Filters** | Date range, Status filter, Payment method filter, Customer, Export |
| **KPI Strip** | Total Receipts · Total Collected · Fully Allocated % · Unallocated Balance |
| **Payment Method Breakdown** | Bar chart — CHQ / TT / CASH / CC / GIRO / ONLN counts and amounts |
| **Receipt Table** | Paginated `DataTable` — Receipt No, Date, Customer, Payment Method, Currency, Amount, Allocated, Unallocated, Status |

---

### 13E. Customer Outstanding Report (`/reports/outstanding`)

**Data Source**: `GET /reports/aging/by-customer` (hook exists)

| Section | Content |
|---|---|
| **Filters** | As-of Date, Credit Rating filter, Search, Export |
| **KPI Strip** | Total Customers · Total Outstanding · Avg Outstanding per Customer · Over-limit Count |
| **Outstanding Table** | Paginated `DataTable` — Customer Name, Customer Code, Credit Limit, Credit Rating, Total Outstanding, Credit Utilization %, Available Credit, Overdue Amount, Action (view customer) |

---

## 14. Customer Demo Flow

> This is the guided walkthrough for the client demo. The frontend must support this end-to-end flow without any backend modifications.

### Step 1: Login
1. Navigate to `/login`
2. Enter credentials → authenticate via Supabase
3. Redirect to Dashboard

### Step 2: View Dashboard
1. See real-time KPI cards (Total AR Balance, Overdue, Open Invoices, etc.)
2. See Aging bar chart and Composition donut with live data
3. Note: DSO and Credit Risk charts show demo data (labelled `[DEMO]`)

### Step 3: Create Invoice
1. Navigate to **Invoices** → Click **"New Invoice"**
2. **Step 1**: Select customer, set invoice date, confirm currency
3. **Step 2**: Add line items (description, qty, unit price, tax code), see live totals
4. **Step 3**: Review summary → Click **"Create & Post"**
5. ✅ Invoice is created + posted → JE auto-generated by P1 backend
6. Toast notification confirms: `INV-2026-XXXX · JE: JE-2026-XXXX`

### Step 4: View Invoice
1. Return to **Invoice List** → See newly created invoice in table
2. Click invoice row → View Invoice Detail page
3. Confirm header, line items, status = "Open", JE reference linked

### Step 5: Record Receipt
1. Navigate to **Receipts** → Click **"New Receipt"**
2. Select same customer, enter receipt amount, select bank account (from seeded mock data)
3. Choose payment method (e.g., TT — Telegraphic Transfer)
4. Click **"Create & Post"**
5. ✅ Receipt is created + posted → JE auto-generated by P1 backend
6. Toast notification confirms: `RCT-2026-XXXX · JE: JE-2026-XXXX`

### Step 6: Allocate Receipt to Invoice
1. Navigate to **Allocation Wizard**
2. In left panel, select the posted receipt → right panel shows outstanding invoices for that customer
3. Click the invoice to add to allocation table
4. System auto-fills allocation amount (or click "FIFO" for auto-fill)
5. Click **"Submit Allocation"**
6. ✅ Allocation recorded, invoice status changes to "Paid" (if fully allocated)
7. Toast: `Allocated 1 invoice(s), total MYR X,XXX.XX`

### Step 7: View Reports
1. Navigate to **Report Center** → Click **"AR Aging Report"**
2. See aging bucket chart with updated data reflecting the allocation
3. See customer aging table — the allocated invoice shows reduced outstanding
4. Navigate back → Click **"Invoice Summary"** → See the invoice with "Paid" status
5. Navigate to **"Customer Outstanding"** → Confirm the customer's balance is reduced

### Demo Complete ✅
> The client has experienced the full AR lifecycle: **Invoice → Receipt → Allocation → Report verification.**

---

## 15. 8 Implementation Sprints

### Sprint 1: Shared Components Foundation
> **Goal**: Build reusable components that all subsequent pages depend on.

| # | Task | Target File |
|---|---|---|
| 1.1 | Create `DataTable` component with sorting, pagination, column definitions | `components/ui/data-table.tsx` |
| 1.2 | Create `EmptyState` component | `components/ui/empty-state.tsx` |
| 1.3 | Create `ErrorState` component with retry button | `components/ui/error-state.tsx` |
| 1.4 | Create `LoadingSkeleton` for tables | `components/ui/loading-skeleton.tsx` |
| 1.5 | Create `PageHeader` component (title, subtitle, action buttons) | `components/ui/page-header.tsx` |
| 1.6 | Create `DetailField` (label + value pair) | `components/ui/detail-field.tsx` |
| 1.7 | Create `SectionCard` (titled card section) | `components/ui/section-card.tsx` |
| 1.8 | Create `Breadcrumb` navigation component | `components/ui/breadcrumb.tsx` |
| 1.9 | Create `FilterBar` shell | `components/ui/filter-bar.tsx` |
| 1.10 | Create `ConfirmDialog` modal | `components/ui/confirm-dialog.tsx` |

---

### Sprint 2: Invoice List + Invoice Detail
> **Goal**: Complete the invoice lifecycle view — list → detail.

| # | Task | Target File |
|---|---|---|
| 2.1 | Create `useInvoices(filters)` hook — `GET /invoices` with status, customer, date range, search, pagination | `hooks/use-invoices.ts` (extend) |
| 2.2 | Create `useInvoice(id)` hook — `GET /invoices/:id` | `hooks/use-invoices.ts` (extend) |
| 2.3 | Build Invoice List page — replace stub with `DataTable`, status filter chips, customer dropdown, search, pagination | `app/(dashboard)/invoices/page.tsx` |
| 2.4 | Create `[id]` route folder + page | `app/(dashboard)/invoices/[id]/page.tsx` |
| 2.5 | Build Invoice Detail page — header section, line items table, totals, JE reference, remarks, audit trail | `app/(dashboard)/invoices/[id]/page.tsx` |
| 2.6 | Add "Cancel Invoice" action button with `ConfirmDialog` | Invoice Detail page |
| 2.7 | Add clickable rows in Invoice List → navigate to `/invoices/[id]` | |

---

### Sprint 3: Receipt Detail
> **Goal**: Complete the receipt lifecycle view — list already exists, add detail.

| # | Task | Target File |
|---|---|---|
| 3.1 | Create `[id]` route folder + page | `app/(dashboard)/receipts/[id]/page.tsx` |
| 3.2 | Build Receipt Detail page — receipt info, payment details, allocation progress bar, status | `app/(dashboard)/receipts/[id]/page.tsx` |
| 3.3 | Add allocation history section — linked invoices table | Receipt Detail page |
| 3.4 | Add "Cancel Receipt" action with `ConfirmDialog` | Uses existing `useCancelReceipt()` hook |
| 3.5 | Add clickable rows in Receipt List → navigate to `/receipts/[id]` | Modify `receipt-table.tsx` |

---

### Sprint 4: AR Aging Report (Critical Report)
> **Goal**: The most important report for the client demo.

| # | Task | Target File |
|---|---|---|
| 4.1 | Rebuild `/reports` as Report Center Hub with navigation cards | `app/(dashboard)/reports/page.tsx` |
| 4.2 | Create `/reports/aging` route | `app/(dashboard)/reports/aging/page.tsx` |
| 4.3 | Build AR Aging Report — date picker, KPI strip, aging chart, customer aging table | `app/(dashboard)/reports/aging/page.tsx` |
| 4.4 | Wire to existing `useAgingSummary()` and `useAgingByCustomer()` hooks. **Confirm `useAgingByCustomer()` calls `/reports/aging/by-customer` (not `/aging/customers`).** | `hooks/use-dashboard.ts` — verify/fix route |
| 4.5 | Add "Export CSV" placeholder button | — |

---

### Sprint 5: Customer List
> **Goal**: Show customers in the system.

| # | Task | Target File |
|---|---|---|
| 5.1 | Create `useCustomerList(filters)` hook | `hooks/use-customers.ts` (new) |
| 5.2 | Build Customer List — replace stub with `DataTable`, search, status filter, credit rating badges | `app/(dashboard)/customers/page.tsx` |
| 5.3 | Create Customer Detail route + page | `app/(dashboard)/customers/[id]/page.tsx` |
| 5.4 | Build Customer Detail — info card, credit info, recent invoices, recent receipts | `app/(dashboard)/customers/[id]/page.tsx` |

---

### Sprint 6: Remaining Reports
> **Goal**: Complete the report suite.

| # | Task | Target File |
|---|---|---|
| 6.1 | Create `useInvoiceSummary()` hook | `hooks/use-reports.ts` (new) |
| 6.2 | Build Invoice Summary Report — KPI strip, status donut, invoice table | `app/(dashboard)/reports/invoices/page.tsx` |
| 6.3 | Create `useReceiptSummary()` hook | `hooks/use-reports.ts` |
| 6.4 | Build Receipt Summary Report — KPI strip, payment method chart, receipt table | `app/(dashboard)/reports/receipts/page.tsx` |
| 6.5 | Build Customer Outstanding Report — KPI strip, outstanding table | `app/(dashboard)/reports/outstanding/page.tsx` |

---

### Sprint 7: JE Display (Inline Only) + Credit Notes + Bank Account Fix
> **Goal**: Show JE numbers inline, build credit notes list, fix bank account mock.
>
> **⚠️ IMPORTANT**: There is NO journal-entries Edge Function route (`index.ts` missing). Do NOT create API hooks for journal entries.

| # | Task | Target File |
|---|---|---|
| 7.1 | ~~Create `useJournalEntries(filters)` hook~~ — **REMOVED** (no Edge Function route) | — |
| 7.2 | Keep Journal Entry List page as enhanced placeholder — display helpful message: "Journal entries are auto-generated when invoices and receipts are posted. JE numbers appear on Invoice and Receipt detail pages." | `app/(dashboard)/journal-entries/page.tsx` |
| 7.3 | ~~Create JE Detail route~~ — **REMOVED** (no Edge Function route) | — |
| 7.4 | Show `je_no` inline on Invoice Detail and Receipt Detail pages (from post mutation response data already stored) | Invoice/Receipt detail pages |
| 7.5 | Build Credit Notes list — filter invoices by `doc_type = "Credit Note"` | `app/(dashboard)/credit-notes/page.tsx` |
| 7.6 | Fix `useBankAccounts()` hook — replace `GET /bank-accounts` call with hardcoded frontend placeholder data. **Do NOT use Supabase direct table queries.** | `hooks/use-receipts.ts` |
| 7.7 | Fix `useTaxCodes()` — ensure mock tax code IDs are **never sent to the backend**. Strip `tax_code_id` from invoice payload when submitting if the ID is a mock/fake ID. | `hooks/use-invoices.ts` + `hooks/use-invoice-form.ts` |

---

### Sprint 8: UX Polish + Demo Readiness
> **Goal**: Enterprise-grade polish across all pages.

| # | Task | Details |
|---|---|---|
| 8.1 | Add loading skeletons to all list pages | Replace default spinners with `LoadingSkeleton` |
| 8.2 | Add empty states to all list pages | `EmptyState` component with context-appropriate CTA |
| 8.3 | Add error states to all list pages | `ErrorState` with retry button |
| 8.4 | Add breadcrumb navigation to all detail pages | e.g., `Dashboard > Invoices > INV-2026-0001` |
| 8.5 | Add keyboard shortcuts (optional) | Ctrl+N for new invoice from invoice list |
| 8.6 | Responsive review at 1280px, 1440px, 1920px | Ensure grid layouts adapt correctly |
| 8.7 | Add `[DEMO]` badges on mock data sections | DSO trend chart, Credit Risk chart |
| 8.8 | Full end-to-end demo flow test | Login → Invoice → Receipt → Allocate → Reports |
| 8.9 | Visual consistency audit | Padding, font sizes, colour usage across all pages |
| 8.10 | Sidebar badge counts (optional) | Show open invoice count, unallocated receipt count |

---

## 16. Open Questions

> These questions should be resolved before implementation begins.

**Q1: Credit Notes via Invoice API**  
The existing `/invoices` GET endpoint — does it support filtering by `doc_type`? If so, the Credit Notes page can simply filter `doc_type = "Credit Note"` from the same endpoint instead of needing a separate page. _Needs confirmation._

**Q2: Cancel Invoice in Prototype UI**  
For the Invoice Detail page, should we show a "Cancel Invoice" button for posted invoices? The P1 smoke tests confirm cancel/reverse works. Should we expose this in the prototype UI, or hide it for the demo to keep things simple?

**Q3: Brand Assets**  
Are there any specific brand colours, logos, or company-specific visual assets (e.g., TSH Synergy logo) that should replace the current `Zap` icon placeholder in the sidebar?

**Q4: AI Assistant Button**  
The sidebar currently shows an "AI Assistant" button (Phase 5 placeholder). Should we hide this for the prototype demo, or leave it visible as a teaser?

**Q5: Bank Account Placeholder Data**  
The `useBankAccounts()` hook currently calls `GET /bank-accounts` which has no Edge Function. For the prototype, this will be replaced with hardcoded placeholder data. Are there specific bank account names/labels the client expects to see in the dropdown (e.g., "Maybank Current Account", "CIMB Savings")? Otherwise, generic labels will be used.

**Q6: Real Tax Code UUIDs**  
The `useTaxCodes()` hook uses mock IDs like `tc-sr6`. Are real tax code UUIDs available from the `003_seed_data.sql` migration? If so, the mock data should use real IDs. If not, `tax_code_id` will be omitted from invoice payloads sent to the backend (tax calculation remains frontend-only display).

---

## 17. Non-Scope Items

The following items are explicitly **out of scope** for this frontend prototype:

| Item | Reason |
|---|---|
| ❌ Backend code changes | P0/P1 backend is production-verified and frozen |
| ❌ Database migration changes | Schema is stable and deployed to production |
| ❌ Supabase Edge Function modifications | All functions are deployed and smoke-tested |
| ❌ New Edge Function creation (bank-accounts, journal-entries) | No new backend endpoints for prototype |
| ❌ P2 — Transactional Outbox | Deferred per decision |
| ❌ P3 — Reliable Event Logging | Deferred per decision |
| ❌ P4 — AI Assistant integration | Deferred per decision |
| ❌ P5 — Advanced features | Deferred per decision |
| ❌ PDF generation / email sending | Not in prototype scope |
| ❌ Real CSV/PDF export implementation | Placeholder buttons only |
| ❌ Global search implementation | Input field exists but non-functional |
| ❌ Notification system | Bell icon exists but non-functional |
| ❌ Dark mode | Light mode only for prototype |
| ❌ Mobile responsive (< 1024px) | Desktop-first prototype |
| ❌ Automated E2E testing | Manual testing only |
| ❌ Calling `GET /bank-accounts` | No Edge Function exists for this route |
| ❌ Calling `GET /journal-entries` | No `index.ts` route — `service.ts` only |
| ❌ Sending mock `tax_code_id` to backend | Fake IDs will fail FK validation |
| ❌ Frontend direct Supabase table queries | Do not bypass missing Edge Functions with `supabase.from(...).select(...)` |
| ❌ Journal Entry detail page (`/journal-entries/[id]`) | No Edge Function route exists — not implementable |
| ❌ i18n / multi-language | English only |

---

## 18. Verification Plan

### Build Verification
- `npm run build` must complete without errors after each sprint
- `npm run lint` must pass after each sprint

### Manual Verification
- Execute the full 7-step customer demo flow (Section 14) end-to-end
- Verify all loading states render correctly (add network throttling in DevTools)
- Verify all empty states render correctly (test with a new company with no data)
- Verify all error states render correctly (disconnect network in DevTools)
- Test on Chrome and Edge at 1440px viewport

### Acceptance Criteria
- [ ] Client can log in and see the AR Dashboard with live data
- [ ] Client can create a new invoice and see it in the Invoice List
- [ ] Client can view invoice details by clicking a row
- [ ] Client can create a new receipt and see it in the Receipt List
- [ ] Client can allocate a receipt to an invoice
- [ ] Client can view the AR Aging Report with updated data
- [ ] All pages have loading, empty, and error states
- [ ] No backend code has been modified
- [ ] No database migrations have been modified

---

## 19. Implementation Safety Warnings

> **These warnings are for any developer or AI agent implementing this plan. Violating these rules will cause runtime errors against the production backend.**

### ⛔ DO NOT Call These Endpoints

| Endpoint | Why |
|---|---|
| `GET /bank-accounts` | No Edge Function exists. Will return 404 or relay error. |
| `GET /journal-entries` | No `index.ts` route file. `service.ts` exists but is not routable. Will return 404. |
| `GET /reports/aging/customers` | **WRONG ROUTE**. The correct route is `GET /reports/aging/by-customer`. |

### ⛔ DO NOT Send These Values to Backend

| Field | Why |
|---|---|
| `tax_code_id: "tc-sr6"` (or any mock ID) | These are fake UUIDs not present in the database. Backend will reject with FK constraint violation. Omit `tax_code_id` from the payload if no real UUID is available. |
| `gl_account_id: "..."` (mock) | Same risk — only send if real UUID is available. |

### ✅ Safe Patterns

| Pattern | How |
|---|---|
| Tax calculation | Compute tax amounts **frontend-only** using the mock tax rate. Display in UI. When submitting to backend, send `tax_code_id: undefined` (omit field). The backend will accept invoices without `tax_code_id`. |
| Bank account selector | Use **hardcoded frontend placeholder data** only. Do NOT query Supabase tables directly. Use generic labels like "Maybank Current A/C" or "CIMB Savings A/C" unless real labels are provided. |
| Journal entry display | Show `je_no` from the **response** of `POST /invoices/:id/post` and `POST /receipts/:id/post`. Do NOT make a separate GET request. |
| Aging by-customer report | Call `GET /reports/aging/by-customer` — NOT `/aging/customers`. |
| List pagination | `useApi()` returns `json.data` only (the array). Hooks must expect arrays, NOT `{ items, total }`. Use client-side pagination for the prototype. Do NOT extend `useApi()` to expose `meta` without approval. |

---

## 20. Codex Review Changelog

### v1.1 — Codex Review (2026-05-26)

**Reviewer**: Codex  
**Plan Version**: 1.0 → 1.1

| # | Issue Found | Severity | Change Applied |
|---|---|---|---|
| CR-1 | Wrong API route: `/reports/aging/customers` should be `/reports/aging/by-customer` | 🔴 Critical | Fixed in Sections 10, 13B, 13E, Sprint 4, and Section 19 |
| CR-2 | API response shape mismatch: `useApi()` returns `json.data` only, but hooks expect `{ items, total }` | 🟡 Warning | Added "API Response Shape" subsection in Section 3, added Q7 in Open Questions |
| CR-3 | `GET /bank-accounts` has no Edge Function | 🔴 Critical | Marked as mock in Sections 10, 11, 12B; added Sprint 7.6 fix task; added to Section 19 blocklist |
| CR-4 | `journal-entries/index.ts` does not exist — no routable endpoint | 🔴 Critical | Removed Sprint 7.1/7.3 API hook tasks; Journal Entries demoted to placeholder-only; added to Section 19 blocklist |
| CR-5 | Mock tax code IDs (e.g., `tc-sr6`) will fail FK validation if sent to backend | 🟡 Warning | Updated Sections 11, 12A; added Sprint 7.7 fix task; added to Section 19 blocklist; added Q6 in Open Questions |

### v1.2 — Codex Final Cleanup (2026-05-26)

**Reviewer**: Codex  
**Plan Version**: 1.1 → 1.2

| # | Issue Found | Severity | Change Applied |
|---|---|---|---|
| CL-1 | API response shape guidance was left as open question (Q7) | 🟡 Warning | Made definitive: hooks must expect arrays; removed Q7; added "use client-side pagination" directive |
| CL-2 | Bank account selector mentioned "Supabase direct query" as fallback | 🟡 Warning | Removed all "Supabase direct query" references; bank account is now hardcoded placeholder only |
| CL-3 | `/journal-entries/[id]` route still listed as active in route structure | 🟡 Warning | Removed from active routes; marked as placeholder-only throughout Sections 6, 7, 8; added to Non-Scope |
| CL-4 | Priority labels P2-High / P3-Nice / P4-Defer conflict with project phases P2–P5 | 🟡 Warning | Renamed to Critical / High / Nice-to-have / Deferred across Sections 6, 7 |
| CL-5 | Missing explicit "no frontend direct table queries" rule | 🟡 Warning | Added to Principles (Section 2), Safety Rules (Section 11), Non-Scope (Section 17), Safety Warnings (Section 19) |

---

*End of Frontend Prototype Completion Plan*
