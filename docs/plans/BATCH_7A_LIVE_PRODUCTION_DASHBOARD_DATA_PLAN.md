# Batch 7A - Live Production Dashboard Data - Implementation Plan

**Project:** GenAI-assisted Accounts Receivable (AR) module
**Company context:** TSH Synergy Sdn Bhd
**Production Supabase ref:** `kusseuycqgdilychphpq`
**Status:** PLAN ONLY - not implemented, not committed, not deployed
**Date:** 2026-06-18

> Batch 7A replaces hardcoded dashboard analytics with authenticated, company-scoped, read-only production data. It does not change financial mutation logic, enable automatic allocation, or add OCR/PDF/Image import.

---

## 1. Scope and hard rules

### 1.1 In scope

- Audit and remove all hardcoded dashboard datasets.
- Provide one authenticated read-only dashboard response in company base currency.
- Extend the existing reports Edge Function and dashboard frontend.
- Add automatic polling, focus refetch, manual refresh, last-updated display, and robust loading/error/empty states.
- Preserve AR Clerk assigned-customer scope.
- Exclude hidden and deleted customers and all related financial records.
- Add backend, frontend, security, and financial-correctness smoke tests.
- Produce implementation evidence.

### 1.2 Out of scope

- No financial RPC changes.
- No direct writes to `allocation_details`.
- No direct updates to `invoices.outstanding`.
- No direct updates to `receipts.allocated_amount` or `receipts.unallocated_amount`.
- No `POST /allocations/auto` enablement or usage.
- No OCR/PDF/Image import.
- No new automatic posting or allocation behavior.
- No frontend direct reads or writes to Supabase financial tables.
- No Supabase Realtime subscription in Batch 7A.
- No predictive AI credit scoring.
- No database migration without separate user approval after this plan is reviewed.

---

## 2. Current dashboard audit

### 2.1 Current frontend files

- `frontend/src/app/(dashboard)/page.tsx`
- `frontend/src/hooks/use-dashboard.ts`
- `frontend/src/components/features/dashboard/aging-chart.tsx`
- `frontend/src/components/features/dashboard/composition-chart.tsx`
- `frontend/src/components/features/dashboard/dso-trend-chart.tsx`
- `frontend/src/components/features/dashboard/credit-risk-chart.tsx`
- `frontend/src/components/features/dashboard/quick-stats.tsx`
- `frontend/src/components/features/dashboard/chart-tooltip.tsx`
- `frontend/src/components/ui/kpi-card.tsx`
- `frontend/src/types/index.ts`

### 2.2 Hardcoded or misleading values

`frontend/src/app/(dashboard)/page.tsx` currently contains:

- `DSO_TREND_DATA`: six hardcoded monthly DSO values.
- `CREDIT_RISK_DATA`: hardcoded customer counts and outstanding amounts by rating.
- A page subtitle claiming `Real-Time Data`, even though two major charts are static.
- A displayed `Collection Rate` calculated as `100 - overdue_percentage`. This is not a valid collection-rate formula and must be removed.
- A Quick Stats label `Unapplied Receipts` that currently receives `total_receipts`, which is a receipt count rather than an unapplied amount or unapplied receipt count.

### 2.3 Existing live frontend data

`frontend/src/hooks/use-dashboard.ts` already calls:

- `GET /reports/dashboard`
- `GET /reports/aging`
- `GET /reports/aging/by-customer`

The dashboard currently combines `/reports/dashboard` and `/reports/aging`, so the cards and charts may represent separate query times.

Global React Query configuration currently has:

- `staleTime: 30 seconds`
- `refetchOnWindowFocus: false`
- no dashboard polling interval

### 2.4 Existing backend support

The existing Edge Function is:

- `backend/supabase/functions/reports/index.ts`
- `backend/supabase/functions/reports/service.ts`

Existing route:

- `GET /reports/dashboard`

Current dashboard response provides:

- total invoice count
- open invoice count
- overdue invoice count
- total receipt count
- total AR balance
- total overdue balance
- total credit balance
- overdue percentage

Existing report protections:

- authenticated company context from `X-Company-Id`
- explicit `auth.companyId` filters
- AR Clerk customer-assignment filtering through `getCustomerAccessFilter()`
- hidden/deleted filtering through `getVisibleCustomerIds()`
- System Admin operational access is denied by the current role helper

### 2.5 Existing backend gaps

The current endpoint is not sufficient for a production dashboard:

1. It does not provide collection trends, top outstanding customers, status distribution, import-review counts, current-month collections, or live credit-rating distribution.
2. `v_customer_ar_summary` sums `outstanding` and `unallocated_amount` in transaction currency. It is unsafe to combine MYR, SGD, or other currencies as one company total.
3. `getAgingSummary()` also sums transaction-currency `outstanding` values rather than base-currency outstanding values.
4. `open_invoices` currently counts only status `Open`, excluding `Partially Paid` and `Overdue`.
5. Persisted status `Overdue` should not be the only overdue test. Production reporting must also use `due_date < as_of_date`, `outstanding > 0`, and an allocatable/open status.
6. The Edge Function currently performs several independent queries, so the result is not one database snapshot.
7. Fetching raw rows and aggregating only in Deno is unsafe at production volume because PostgREST result limits can truncate datasets and produce incorrect totals.
8. The current `requireRole(auth, 'AR Clerk')` pattern rejects Auditor even though Auditor should have read-only report access. Batch 7A must use an explicit dashboard-read role whitelist.

---

## 3. Production dashboard data contract

### 3.1 Common metric rules

Every financial amount returned by the dashboard must:

- be expressed in `companies.base_currency`;
- return the currency code in response metadata;
- convert invoice outstanding using `ROUND(invoices.outstanding * invoices.exchange_rate, 2)`;
- use `receipts.base_amount` for posted receipt totals;
- convert unapplied cash using `ROUND(receipts.unallocated_amount * receipts.exchange_rate, 2)`;
- exclude hidden and deleted customers before aggregation;
- filter all source records to `auth.companyId`;
- apply AR Clerk active customer assignments;
- use a single `as_of_date`, defaulting to the current company-facing date;
- return `calculated_at` from the backend.

Financial amounts must never sum transaction currencies directly.

### 3.2 Recommended response shape

Extend `GET /reports/dashboard` additively so existing consumers are not broken during transition:

```ts
interface LiveDashboardMetrics {
  meta: {
    company_id: string;
    base_currency: string;
    as_of_date: string;
    calculated_at: string;
    scope: "assigned_customers" | "company";
    trend_months: number;
  };
  kpis: {
    total_outstanding_ar: number;
    overdue_outstanding: number;
    overdue_invoice_count: number;
    unapplied_cash: number;
    current_month_collections: number;
    current_month_posted_invoices: number;
    import_rows_needing_review: number;
  };
  invoice_status_counts: {
    open: number;
    partially_paid: number;
    overdue_status: number;
    paid: number;
    unpaid_total: number;
  };
  aging_buckets: Array<{
    key: "current" | "1_30" | "31_60" | "61_90" | "over_90";
    label: string;
    invoice_count: number;
    outstanding_base: number;
    percentage: number;
  }>;
  collection_trend: Array<{
    month: string;
    collected_base: number;
    receipt_count: number;
  }>;
  top_outstanding_customers: Array<{
    customer_id: string;
    customer_code: string;
    customer_name: string;
    outstanding_base: number;
    overdue_base: number;
    overdue_invoice_count: number;
  }>;
  credit_rating_distribution: Array<{
    rating: "AAA" | "AA" | "A" | "B" | "C" | "D";
    customer_count: number;
    outstanding_base: number;
  }>;
}
```

The old top-level dashboard fields may remain temporarily as compatibility aliases, but the frontend should migrate to the typed nested response.

---

## 4. Metric definitions

### 4.1 Total outstanding AR

**Source:** `public.invoices`, joined to `public.customers`
**Document filter:** `doc_type IN ('Invoice', 'Debit Note')`
**Status filter:** `status IN ('Open', 'Partially Paid', 'Overdue')`
**Amount filter:** `outstanding > 0`
**Formula:** `SUM(ROUND(outstanding * exchange_rate, 2))`
**Visibility:** customer `is_deleted = false`, `is_hidden = false`
**Scope:** company and AR Clerk assignment filters
**Accuracy:** safe with current schema because invoice exchange rate is stored at posting.

This is gross outstanding AR. Open credit notes and unapplied receipts must be shown separately rather than silently netted into this KPI.

### 4.2 Overdue outstanding amount

**Source:** `public.invoices`, `public.customers`
**Document/status/visibility filters:** same as total outstanding AR
**Additional filter:** `due_date IS NOT NULL AND due_date < as_of_date`
**Formula:** `SUM(ROUND(outstanding * exchange_rate, 2))`
**Accuracy:** safe. Use due date rather than relying only on status `Overdue`.

### 4.3 Overdue invoice count

**Source and filters:** same as overdue outstanding
**Formula:** count invoice rows with positive outstanding and past due date
**Accuracy:** safe.

### 4.4 Unapplied cash

**Source:** `public.receipts`, `public.customers`
**Status filter:** `status IN ('Posted', 'Fully Allocated')`
**Amount filter:** `unallocated_amount > 0`
**Formula:** `SUM(ROUND(unallocated_amount * exchange_rate, 2))`
**Excluded:** Draft, Cancelled, and Bounced receipts
**Accuracy:** safe with current schema.

The UI must call this `Unapplied Cash`, not total receipts and not automatically `Overpayment`.

### 4.5 Current-month collections

**Source:** `public.receipts`, `public.customers`
**Status filter:** `status IN ('Posted', 'Fully Allocated')` and `posted_at IS NOT NULL`
**Date filter:** `receipt_date` within the current calendar month
**Formula:** `SUM(base_amount)`
**Excluded:** Draft, Cancelled, and Bounced receipts
**Accuracy:** safe. `receipt_date` represents the business collection date; `posted_at` confirms posting.

### 4.6 Current-month posted invoice count

**Source:** `public.invoices`, `public.customers`
**Document filter:** `doc_type IN ('Invoice', 'Debit Note')`
**Filter:** `posted_at IS NOT NULL`, `status <> 'Cancelled'`, and `posted_at` within the current calendar month
**Formula:** count
**Accuracy:** safe.

### 4.7 Invoice status counts

**Source:** `public.invoices`, `public.customers`
**Document filter:** `doc_type IN ('Invoice', 'Debit Note')`
**Visibility/scope:** standard dashboard filters
**Counts:**

- `open`: persisted status `Open`
- `partially_paid`: persisted status `Partially Paid`
- `overdue_status`: persisted status `Overdue`
- `paid`: persisted status `Paid`
- `unpaid_total`: statuses `Open`, `Partially Paid`, and `Overdue` with `outstanding > 0`

The separate overdue KPI remains due-date based. The `overdue_status` count is included only as an operational status diagnostic.

### 4.8 Import rows needing review

**Source:** `public.import_rows`, joined to `public.import_batches`
**Company filter:** `import_batches.company_id = auth.companyId`
**Active review rule:**

- row status in `('Unmatched', 'Skipped', 'Error')`;
- `mapped_data.review_required = true`;
- not already revalidated to `Valid`, `Created`, `Posted`, or `Allocated`.

**Role behavior:**

- AR Supervisor, Finance Manager, and Auditor: company-wide import review count.
- AR Clerk: only batches where `import_batches.created_by = auth.userId`. Unresolved rows cannot always be safely mapped to a customer assignment, so the UI label must be `My Import Rows Needing Review`.
- System Admin: denied.

**Accuracy:** safe if the label reflects the role-specific scope. This is a workflow count, not a financial amount.

### 4.9 AR aging buckets

**Source:** `public.invoices`, `public.customers`
**Filters:** positive outstanding Invoice/Debit Note rows in Open, Partially Paid, or Overdue status
**Base amount:** `ROUND(outstanding * exchange_rate, 2)`
**Buckets using `as_of_date - due_date`:**

- Current: `due_date IS NULL OR due_date >= as_of_date`
- 1-30
- 31-60
- 61-90
- Over 90

**Accuracy:** safe. The dashboard must use the new base-currency aggregate, not the current transaction-currency `getAgingSummary()` totals.

### 4.10 Outstanding by customer

**Source:** `public.invoices`, `public.customers`
**Formula:** group total and overdue base outstanding by visible, in-scope customer
**Limit:** top 10 by total base outstanding
**Accuracy:** safe.

### 4.11 Collection trend

**Source:** `public.receipts`, `public.customers`
**Status filter:** Posted or Fully Allocated, with non-null `posted_at`
**Date:** `receipt_date`
**Range:** six complete/current calendar months
**Formula:** monthly `SUM(base_amount)` and receipt count
**Accuracy:** safe.

This replaces the hardcoded DSO chart.

### 4.12 Credit-rating distribution

**Source:** `public.customers.credit_rating` plus current invoice outstanding
**Formula:** group visible, in-scope customers by stored credit rating and sum base outstanding
**Accuracy:** mathematically safe with the current schema.

Limitation: this represents maintained customer master ratings, not an AI-predicted default risk. The chart title must be `Outstanding by Customer Credit Rating`. If production customer ratings are not maintained meaningfully, replace this chart with `Top Outstanding Customers` and defer the rating chart.

### 4.13 DSO trend - deferred

Do not display DSO in Batch 7A.

A defensible monthly DSO trend needs a consistently defined credit-sales denominator and historical month-end or average AR balances. The current schema stores current outstanding and transaction history, but it does not provide a verified month-end AR snapshot or a previously approved DSO calculation policy. Reconstructing historical DSO from current rows risks incorrect results after allocations, reversals, cancellations, write-offs, and credit notes.

DSO requires a separately reviewed accounting definition and historical-balance implementation before it is shown as production data.

---

## 5. Recommended backend design

### 5.1 Route

Keep the established read API:

- `GET /reports/dashboard`

Do not create a separate dashboard Edge Function. The reports function already owns read-only AR analytics, authentication, error handling, and company routing.

### 5.2 Edge Function changes

Expected files:

- `backend/supabase/functions/reports/index.ts`
- `backend/supabase/functions/reports/service.ts`
- optionally `backend/supabase/functions/reports/types.ts`

Required route behavior:

- authenticated request required;
- `auth.companyId` required;
- allowed roles: AR Clerk, AR Supervisor, Finance Manager, Auditor;
- System Admin denied from operational dashboard data;
- AR Clerk scope set to assigned customers;
- hidden/deleted customers excluded;
- only read-only database calls;
- structured error response;
- return `calculated_at` and scope metadata.

Use `requireAnyRole()` with the explicit dashboard read roles. Do not use the current mutation-oriented `requireRole(auth, 'AR Clerk')` behavior because it rejects Auditor.

### 5.3 Why Edge Function aggregation alone is insufficient

Using the Supabase client to download all invoices and receipts and aggregate them in Deno is not production-safe because:

- PostgREST row limits can truncate source rows;
- large tenants would transfer unnecessary financial rows to the Edge runtime;
- multiple queries can produce internally inconsistent timestamps;
- grouping and summing is more efficient in PostgreSQL;
- mixed-currency conversion rules must be applied uniformly.

### 5.4 Recommended read-only SQL function

A database-side aggregate is justified for production-standard correctness and performance.

Proposed migration, subject to separate approval:

- `database/014_live_dashboard_metrics.sql`

Proposed function:

- `public.get_ar_dashboard_metrics(...)`

Recommended parameters:

- `p_company_id uuid`
- `p_user_id uuid`
- `p_scope_mode text` with allowed values `assigned` or `company`
- `p_as_of_date date`
- `p_trend_months integer default 6`

Recommended characteristics:

- `SECURITY INVOKER`;
- stable/read-only SQL or PL/pgSQL;
- fully qualified `public.*` object references;
- explicit company filter in every CTE;
- customer visibility CTE enforcing `is_deleted = false` and `is_hidden = false`;
- assignment CTE enforcing active `user_customer_assignments` when scope is `assigned`;
- one JSON result containing all dashboard sections;
- no inserts, updates, deletes, sequence calls, or financial RPC calls;
- revoke execution from `PUBLIC`, `anon`, and `authenticated`;
- grant execution only to `service_role`, because only the authenticated reports Edge Function should call it;
- validate `p_trend_months` within a small range such as 1-12;
- return zero-valued sections for an empty customer scope.

The Edge Function, not the browser, determines `p_scope_mode` from verified auth context. The frontend must never send or override its own data scope.

### 5.5 Migration approval gate

No migration is created under this planning task.

Before implementation, Codex must review and the user must approve:

- the exact SQL function signature;
- grants/revokes;
- query plan and index usage;
- the resulting response contract;
- production rollout and rollback SQL.

If a no-migration implementation is demanded, it must be explicitly accepted as a scalability limitation and must paginate every source query. It is not the recommended production approach.

### 5.6 Index review

Existing indexes cover many base filters, including company/status, due date, receipt date, and import batch status. Before adding any index:

1. run `EXPLAIN (ANALYZE, BUFFERS)` in staging with representative data;
2. verify the new function uses existing indexes;
3. add a composite or partial index only if the plan demonstrates a real scan problem.

Possible candidates, not approved by this plan:

- invoices by company, customer, status, due date;
- receipts by company, customer, status, receipt date;
- active import review rows by batch and status.

Do not add speculative indexes.

---

## 6. Recommended frontend behavior

### 6.1 Data hook

Update `frontend/src/hooks/use-dashboard.ts` to use the expanded `GET /reports/dashboard` response as the dashboard source of truth.

Recommended React Query behavior:

- `staleTime: 30_000`;
- `refetchInterval: 60_000`;
- `refetchIntervalInBackground: false`;
- `refetchOnWindowFocus: true`;
- retain previous successful data while a background refresh is running;
- expose `refetch`, `isFetching`, `isError`, `error`, and `dataUpdatedAt`.

Do not use Supabase Realtime in Batch 7A. Realtime would add subscription lifecycle, RLS, event-volume, reconnection, and cross-tab consistency risks without improving financial correctness over a 60-second read refresh.

### 6.2 User-visible behavior

- Manual refresh icon button with tooltip `Refresh dashboard`.
- Disable the refresh button while a request is active.
- Show `Last updated <local timestamp>` using backend `calculated_at`.
- Show a subtle `Refreshing...` state without blanking existing data.
- Initial load uses skeletons with stable dimensions.
- Error state preserves stale data when available and offers Retry.
- Empty state says no visible AR activity exists for the current company/access scope.
- AR Clerk scope should be visible as `Assigned customers`.
- Auditor gets read-only dashboard access.
- System Admin receives a clear operational-access denial.

### 6.3 Types

Expected type changes:

- add `LiveDashboardMetrics` and child interfaces to `frontend/src/types/index.ts`;
- do not overload transaction-domain types;
- keep base-currency metadata mandatory.

---

## 7. Dashboard visualization plan

### 7.1 KPI cards

Replace the current cards/quick stats with real values:

1. Total Outstanding AR
2. Overdue Outstanding
3. Overdue Invoices
4. Unapplied Cash
5. Collections This Month
6. Import Rows Needing Review

Secondary operational values may show:

- current-month posted invoice count;
- unpaid invoice count;
- partially paid invoice count.

All financial cards display the company base currency.

### 7.2 Aging chart

Keep and feed from `aging_buckets` in the consolidated response. Add:

- base-currency tooltip;
- invoice count;
- accurate empty state;
- as-of date from response metadata.

### 7.3 Outstanding composition

Replace the current composition that mixes AR and unapplied receipts.

Recommended chart:

- Current outstanding
- Overdue outstanding

Unapplied cash is displayed separately as its own KPI because it is a credit/unapplied balance, not part of gross outstanding AR.

### 7.4 DSO chart

Remove the DSO chart from Batch 7A and replace it with `Collections - Last 6 Months`.

Do not calculate or display DSO until its accounting policy and historical balance method are separately approved.

### 7.5 Credit risk chart

Use real `credit_rating_distribution` only if customer ratings are maintained. Label it:

- `Outstanding by Customer Credit Rating`

Do not label it predictive risk or AI risk.

If ratings are not maintained, replace it with:

- `Top Outstanding Customers`

The endpoint may return both datasets so the frontend can choose the honest visualization.

### 7.6 Top outstanding customers

Add a compact ranked table or horizontal bar chart showing:

- customer name/code;
- outstanding base amount;
- overdue base amount;
- overdue invoice count.

Do not expose hidden/deleted customers.

### 7.7 Invoice status distribution

Use a compact status summary rather than the current invalid collection-rate calculation:

- Open
- Partially Paid
- Overdue status
- Paid

This chart is count-based and does not replace the due-date-based overdue KPI.

---

## 8. Security and tenant controls

Implementation must prove:

- all requests are authenticated;
- every SQL branch filters by `p_company_id`;
- Edge auth company and requested company cannot diverge;
- AR Clerk sees assigned visible customers only;
- AR Supervisor and Finance Manager see company-wide visible customers;
- Auditor can read company-wide visible data;
- System Admin is denied operational dashboard access;
- hidden or deleted customers never contribute to any metric;
- import review counts cannot cross company boundaries;
- the browser cannot select a wider scope;
- no frontend financial-table query is introduced;
- the read-only SQL function cannot be executed by browser roles.

The reports Edge Function uses a service-role client, so explicit company, role, assignment, and visibility filters are mandatory even if RLS exists.

---

## 9. Safety verification

Required repository checks:

- no changes to `database/007_financial_rpcs.sql`;
- no changes to posting/allocation/reversal/bounced-cheque RPC behavior;
- no direct `allocation_details` insert;
- no direct update of invoice outstanding;
- no direct update of receipt allocated/unallocated amounts;
- no call to `POST /allocations/auto`;
- no OCR/PDF/Image functionality;
- no frontend `.from(` financial-table access;
- no frontend Supabase mutation;
- `git diff --check`;
- `git status --short` contains only approved Batch 7A files.

---

## 10. Testing and smoke plan

### 10.1 Static checks

Backend:

```powershell
cd backend/supabase/functions
deno check reports/index.ts
```

Frontend:

```powershell
cd frontend
npm.cmd run build
```

Repository:

```powershell
git diff --check
git status --short
rg -n "\.from\(|supabase\.from|createClient" frontend/src
```

Inspect each frontend search result and confirm there is no financial table read/write.

### 10.2 Backend API checks

Test `GET /reports/dashboard` for:

- AR Clerk with one assigned customer;
- AR Supervisor;
- Finance Manager;
- Auditor;
- System Admin;
- wrong company header;
- company with no visible data.

Expected:

- Clerk metrics equal assigned visible customers only;
- Supervisor/Manager/Auditor metrics equal company-wide visible customers;
- System Admin receives 403;
- cross-company access is rejected or returns no accessible resource;
- empty scope returns valid zero-valued data;
- response includes base currency, scope, as-of date, and calculated timestamp.

### 10.3 Metric reconciliation

In staging, compare API values with read-only SQL for:

- gross outstanding base amount;
- overdue base amount and count;
- unapplied cash base amount;
- current-month collections;
- aging bucket totals;
- top outstanding customers;
- credit-rating distribution;
- import rows needing review.

The sum of aging bucket amounts must equal total outstanding AR, within currency rounding tolerance.

### 10.4 Mutation-driven dashboard smoke

Use existing verified flows only:

1. Load dashboard and record baseline metrics.
2. Create and post an invoice for a visible customer.
3. Refresh or wait for the 60-second refetch.
4. Confirm total outstanding, invoice counts, aging, and customer ranking change correctly.
5. Create and post a receipt.
6. Refresh and confirm current-month collections and unapplied cash change correctly.
7. Allocate the receipt through `POST /allocations/manual`.
8. Refresh and confirm invoice outstanding and unapplied cash reduce correctly.
9. Do not modify financial fields directly during verification.

### 10.5 Visibility smoke

- Create or identify financial data belonging to a hidden customer.
- Confirm it contributes zero to all dashboard sections.
- Confirm deleted customers contribute zero.
- Confirm AR Clerk unassigned customer activity contributes zero.

### 10.6 Refresh and UX smoke

- initial skeleton renders without layout shift;
- successful refresh updates `Last updated`;
- manual refresh works;
- window focus triggers refetch;
- background refresh does not blank existing data;
- API error shows a retryable error state;
- empty scope renders a clear empty state;
- mobile and desktop charts do not overlap or truncate labels.

### 10.7 Safety regression

- `POST /allocations/auto` returns 403 `AUTO_ALLOCATION_DISABLED`;
- no frontend direct Supabase financial-table access;
- no posting/allocation RPC behavior changed;
- invoice, receipt, allocation, and import smoke flows remain unchanged.

---

## 11. Evidence plan

Create after implementation:

- `docs/evidence/SPRINT_BATCH_7A_LIVE_DASHBOARD_DATA_EVIDENCE.md`

Required sections:

1. Purpose and approved scope
2. Previous hardcoded dashboard audit
3. Endpoint and SQL aggregate used
4. Authentication, company, role, assignment, and visibility controls
5. Exact metric formulas and base-currency rules
6. API response example with sensitive values redacted
7. Dashboard screenshots before and after
8. AR Clerk versus manager scope evidence
9. Hidden/deleted customer exclusion evidence
10. Invoice post, receipt post, and allocation refresh results
11. Build, Deno check, SQL reconciliation, and Git check results
12. `/allocations/auto` 403 evidence
13. Confirmation of no financial mutation changes
14. Known limitations
15. Deployment and rollback evidence

Known limitations must include:

- DSO deferred pending an approved accounting definition and historical-balance method;
- credit-rating chart quality depends on maintained customer master ratings;
- data refresh is polling-based, not event-stream based;
- dashboard amounts are company base currency, not transaction-currency totals.

---

## 12. Expected implementation files

Subject to approval:

Backend:

- `backend/supabase/functions/reports/index.ts`
- `backend/supabase/functions/reports/service.ts`
- optional `backend/supabase/functions/reports/types.ts`

Database, only after separate approval:

- `database/014_live_dashboard_metrics.sql`

Frontend:

- `frontend/src/app/(dashboard)/page.tsx`
- `frontend/src/hooks/use-dashboard.ts`
- `frontend/src/types/index.ts`
- `frontend/src/components/features/dashboard/aging-chart.tsx`
- `frontend/src/components/features/dashboard/composition-chart.tsx`
- `frontend/src/components/features/dashboard/dso-trend-chart.tsx` renamed or replaced by a collection-trend component
- `frontend/src/components/features/dashboard/credit-risk-chart.tsx`
- `frontend/src/components/features/dashboard/quick-stats.tsx`
- optional new `top-outstanding-customers.tsx`
- optional new dashboard error/empty-state component

Evidence:

- `docs/evidence/SPRINT_BATCH_7A_LIVE_DASHBOARD_DATA_EVIDENCE.md`

No invoice, receipt, allocation, import, or financial RPC mutation files should require changes.

---

## 13. Deployment order

After implementation and staging approval:

1. Apply approved read-only dashboard SQL migration to staging, if approved.
2. Deploy `reports` Edge Function to staging.
3. Run SQL reconciliation and role/visibility API smoke tests.
4. Build and deploy frontend to staging/preview.
5. Run mutation-driven refresh smoke using verified existing flows.
6. Capture staging evidence.
7. Back up the production function definition and current reports deployment metadata.
8. Apply the approved read-only SQL migration to production.
9. Deploy only the `reports` Edge Function.
10. Run production read-only API smoke.
11. Deploy frontend.
12. Run production dashboard smoke and capture evidence.

Do not deploy any financial mutation function for Batch 7A.

---

## 14. Rollback plan

Frontend rollback:

- redeploy the previous Vercel commit.

Reports function rollback:

- redeploy the previous `reports` Edge Function commit.

Database rollback:

- the proposed function is read-only and independent of financial RPCs;
- rollback drops only the new dashboard function after the previous frontend/backend are restored;
- do not drop or modify financial tables, views, or RPCs;
- preserve the migration/evidence record even if the function is removed.

If dashboard values fail reconciliation, stop deployment and retain the existing dashboard endpoint until formulas are corrected. Never compensate by editing financial balances.

---

## 15. Readiness conclusion

The current `/reports/dashboard` route is the correct API ownership boundary but its existing implementation and response are not enough for a real production dashboard.

Batch 7A needs:

- read-only backend work in the existing `reports` Edge Function;
- a consolidated base-currency dashboard contract;
- a database-side read-only aggregation function for production correctness and scale;
- frontend polling, focus refetch, manual refresh, last-updated state, and honest visualizations;
- no financial mutation changes.

Because the recommended implementation introduces a new read-only SQL function, the exact migration requires another Codex backend/SQL review and explicit user approval before implementation. Claude may plan the frontend against the response contract in this document, but backend contract and SQL should be approved first so the UI is not built against unstable formulas.
