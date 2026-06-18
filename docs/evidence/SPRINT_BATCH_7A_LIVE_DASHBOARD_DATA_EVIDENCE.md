# Sprint Batch 7A - Live Dashboard Data Evidence

**Date:** 2026-06-19
**Scope:** Backend implementation (Codex) + frontend live dashboard integration
**Status:** Backend staging and production verification passed; frontend
integrated against the verified contract; production release gate cleared; no
commit or push

## Staging application

**Staging project ref:** `gcdsdyegwjdcskpukqlq`
**Production project ref:** `kusseuycqgdilychphpq`
**Applied:** 2026-06-18

Authentication was verified with:

```text
supabase projects list
```

The CLI confirmed that staging was linked and that production was a separate
project. No production command was run.

Staging application completed in this order:

1. Set `BUSINESS_TIME_ZONE=Asia/Kuala_Lumpur` on staging.
2. Applied `database/014_live_dashboard_metrics.sql` to the linked staging
   database.
3. Verified the function is `STABLE`, `SECURITY INVOKER`, executable by
   `service_role`, and not executable by `PUBLIC`, `anon`, or `authenticated`.
4. Deployed only the `reports` Edge Function to staging.
5. Confirmed the staging `reports` deployment is active at version 4 after
   correcting the dashboard response UUID validator.
6. Ran read-only SQL contract, reconciliation, authorization, and query-plan
   smoke checks.
7. Created dedicated staging-only Auth users for the required role matrix.
8. Ran the authenticated HTTP role, response-contract, forbidden-parameter,
   and auto-allocation safety checks.

Staging SQL smoke result:

- existing AR Supervisor company scope succeeded;
- base currency: `SGD`;
- as-of date: `2026-06-18`;
- five aging buckets, six collection-trend rows, and six credit-rating rows
  were returned;
- aging total exactly matched total outstanding AR;
- null scope was rejected with `BR-DASH-001`;
- a user without an active dashboard role was rejected with SQLSTATE `42501`;
- current staging execution time was approximately 25 ms.

## Staging-only smoke users

The following dedicated Auth users were created on staging and linked only to
the active P1 API staging company:

| Role | Staging-only email | Result |
| --- | --- | --- |
| AR Clerk | `batch7a.arclerk+staging@example.com` | Created |
| AR Supervisor | `batch7a.supervisor+staging@example.com` | Created |
| Finance Manager | `batch7a.finance+staging@example.com` | Created |
| Auditor | `batch7a.auditor+staging@example.com` | Created |
| System Admin only | `batch7a.sysadmin+staging@example.com` | Created |

Temporary passwords were generated with a cryptographic random-number
generator, retained only in process memory long enough to authenticate the
tests, and never printed or written to disk. Access tokens and API keys were
also kept in process memory and were not printed or stored.

**Company ID:** `81000000-0000-0000-0000-000000000001`
**Company:** `P1 API Staging Test Company`
**AR Clerk assigned customer ID:** `85000000-0000-0000-0000-000000000001`
**Assigned customer:** `P1API-CUST-001` / `P1 API Assigned Customer`

The assigned customer was already active, visible, non-hidden, and non-deleted.
No customer, invoice, receipt, allocation, journal entry, or financial balance
fixture was created.

## Authenticated HTTP smoke results

Endpoint:

```text
GET https://gcdsdyegwjdcskpukqlq.supabase.co/functions/v1/reports/dashboard?trend_months=6
```

| Role | HTTP | Scope/result | Contract |
| --- | ---: | --- | --- |
| AR Clerk | 200 | `assigned_customers` | Passed |
| AR Supervisor | 200 | `company` | Passed |
| Finance Manager | 200 | `company` | Passed |
| Auditor | 200 | `company` | Passed |
| System Admin only | 403 | `AUTHORIZATION_ERROR` | Passed |

For every successful dashboard response:

- `meta`, `kpis`, and `invoice_status_counts` existed;
- `aging_buckets` existed with exactly 5 rows;
- `collection_trend` existed with exactly 6 rows;
- `top_outstanding_customers` existed;
- `credit_rating_distribution` existed with exactly 6 rows;
- all eight legacy aliases existed:
  `total_invoices`, `open_invoices`, `overdue_invoices`, `total_receipts`,
  `total_ar_balance`, `total_overdue_balance`, `total_credit_balance`, and
  `overdue_percentage`.

Forbidden dashboard query parameters were tested independently with an
authenticated AR Supervisor token:

| Query parameter | HTTP | Error code | Result |
| --- | ---: | --- | --- |
| `company_id` | 400 | `VALIDATION_ERROR` | Passed |
| `user_id` | 400 | `VALIDATION_ERROR` | Passed |
| `scope_mode` | 400 | `VALIDATION_ERROR` | Passed |
| `as_of_date` | 400 | `VALIDATION_ERROR` | Passed |

Safety regression:

```text
POST https://gcdsdyegwjdcskpukqlq.supabase.co/functions/v1/allocations/auto
```

Result: HTTP 403 with `AUTO_ALLOCATION_DISABLED`.

## Review correction

The backend implementation review identified that PostgreSQL null semantics
allowed a null `p_scope_mode` to bypass the original `NOT IN` validation.
Migration 014 now explicitly rejects null:

```sql
IF p_scope_mode IS NULL
   OR p_scope_mode NOT IN ('assigned', 'company') THEN
```

No other SQL implementation behavior was changed by that correction.

The authenticated staging smoke also identified that the new dashboard response
validator accepted only RFC UUID versions 1-5. Existing deterministic staging
company UUIDs are valid PostgreSQL UUID values but use a `0000` version segment,
causing successful RPC output to be rejected with HTTP 500 and:

```text
Dashboard metrics response has invalid meta.company_id.
```

`reports/dashboard-types.ts` was aligned with the existing shared backend UUID
validator so it accepts PostgreSQL's canonical `8-4-4-4-12` hexadecimal UUID
format. `deno check reports/index.ts` passed, and only the staging `reports`
function was redeployed. The final role matrix then passed.

## Backend changes

- Added the read-only dashboard aggregate migration:
  `database/014_live_dashboard_metrics.sql`.
- Updated `GET /reports/dashboard` to:
  - accept only optional `trend_months=1..12`;
  - reject browser-supplied `company_id`, `user_id`, `scope_mode`, and
    `as_of_date`;
  - derive the current business date inside the Edge Function;
  - call the dashboard RPC through the service-role Supabase client.
- Replaced the old multi-query dashboard implementation with one call to
  `public.get_ar_dashboard_metrics`.
- Added server-side validation for the nested dashboard response and deprecated
  compatibility aliases.
- No frontend dashboard implementation was performed.

## Migration and SQL function

Migration:

```text
database/014_live_dashboard_metrics.sql
```

Function:

```sql
public.get_ar_dashboard_metrics(
  p_company_id uuid,
  p_user_id uuid,
  p_scope_mode text,
  p_as_of_date date DEFAULT CURRENT_DATE,
  p_trend_months integer DEFAULT 6
) RETURNS jsonb
```

Function properties:

- `LANGUAGE plpgsql`
- `STABLE`
- `SECURITY INVOKER`
- empty `search_path`
- read-only aggregate only
- execution revoked from `PUBLIC`, `anon`, and `authenticated`
- execution granted only to `service_role`
- no indexes added

The implemented function body matches the approved SQL in
`docs/plans/BATCH_7A_BACKEND_SQL_API_DESIGN.md`.

## Metric formulas

- Gross outstanding AR: Invoice and Debit Note rows in Open, Partially Paid, or
  Overdue status with positive outstanding, converted per row using
  `ROUND(outstanding * exchange_rate, 2)`.
- Overdue outstanding and count: gross outstanding rows with non-null
  `due_date < as_of_date`.
- Unapplied cash: posted/Fully Allocated receipts with positive unallocated
  amount, converted per row using
  `ROUND(unallocated_amount * exchange_rate, 2)`.
- Current-month collections: sum of stored `receipts.base_amount`.
- Aging: five due-date buckets calculated from the trusted business date.
- Collection trend: base-amount totals and receipt counts for 1-12 calendar
  months.
- Top customers: top 10 by gross base-currency outstanding.
- Credit-rating distribution: six stable rows (`AAA`, `AA`, `A`, `B`, `C`,
  `D`), including zero-valued rows for an empty scope.
- Credit notes and unapplied cash remain separate from gross outstanding AR.
- Future-dated invoices and receipts are excluded from the nested contract.
- Hidden/deleted customers are removed before financial aggregation.

## Role and scope behavior

- AR Clerk: `assigned` scope, enforced against active
  `user_customer_assignments`.
- AR Supervisor: company scope.
- Finance Manager: company scope.
- Auditor: company scope, read-only.
- System Admin-only: denied.
- A user with System Admin plus an allowed dashboard role is scoped by the
  allowed role.
- Company, user, and scope RPC parameters are constructed only from verified
  backend authentication context.

## Business timezone behavior

- The browser cannot provide the dashboard `as_of_date`.
- The Edge Function derives `YYYY-MM-DD` using `Intl.DateTimeFormat` and
  `formatToParts`.
- `BUSINESS_TIME_ZONE` controls the timezone.
- If the environment variable is unset or blank, the backend-controlled safe
  fallback is `Asia/Kuala_Lumpur`.
- An invalid configured IANA timezone returns a server configuration error
  rather than silently using server-local or UTC time.
- The SQL `p_as_of_date` parameter remains available for deterministic
  backend/staging tests.

## Compatibility aliases

The response preserves these deprecated top-level fields:

- `total_invoices`
- `open_invoices`
- `overdue_invoices`
- `total_receipts`
- `total_ar_balance`
- `total_overdue_balance`
- `total_credit_balance`
- `overdue_percentage`

Compatibility behavior remains aligned with the old endpoint:

- `total_receipts` counts all non-Draft/non-Cancelled receipts.
- `total_ar_balance` and `total_overdue_balance` preserve legacy
  transaction-currency formulas.
- `total_credit_balance` preserves unapplied receipt plus unused open credit
  note semantics.
- New production analytics must use the nested base-currency contract.

## Commands and results

```text
git status --short
```

Result: reports implementation files and migration are locally modified/new;
the pre-existing untracked plan files remain present.

```text
git diff --stat
```

Result: tracked reports files changed. New untracked files are not included by
Git in this statistic.

```text
cd backend/supabase/functions
deno check reports/index.ts
```

Result: PASS.

```text
supabase functions deploy reports --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
supabase functions list --project-ref gcdsdyegwjdcskpukqlq -o json
```

Result: staging `reports` version 4 is `ACTIVE`. No production deployment
command was run.

```text
Authenticated role/contract/forbidden-parameter/auto-allocation smoke
```

Result: PASS for all required checks.

```text
git diff --check
```

Result: PASS. Git emitted only Windows LF-to-CRLF working-copy warnings.

```text
git diff -U0 | rg "^\+.*allocations/auto"
```

Result: no introduced usage.

```text
git diff --name-only
git ls-files --others --exclude-standard
```

Result: no financial RPC, invoice posting, receipt posting, allocation,
reversal, cancellation, or bounced-cheque implementation files changed.

```text
git diff -U0 -- frontend | rg \
  "^\+.*(supabase\.from|\.from\(['\"](invoices|receipts|allocation_details)|createClient)"
```

Result: no introduced frontend Supabase financial-table access; no frontend
files changed.

```text
rg -n -i "^\s*(insert|update|delete|merge|truncate)\b|\bperform\b|nextval\s*\(" \
  database/014_live_dashboard_metrics.sql
```

Result: no mutation statements or sequence calls.

Approved-design comparison result:

```text
APPROVED_FUNCTION_BODY_MATCH=True
```

## Safety confirmations

- No financial RPC was modified.
- No invoice or receipt posting logic was modified.
- No allocation, manual allocation, reversal, cancellation, or bounced-cheque
  logic was modified.
- No insert into `allocation_details` was added.
- No update to invoice or receipt financial balance fields was added.
- `POST /allocations/auto` was not enabled or used.
- No OCR/PDF/Image import was added.
- No frontend direct financial-table access was added.
- No frontend file was changed *by the backend batch* (the frontend integration
  is documented separately in "Frontend integration (Batch 7A)" below and is
  read-only against the dashboard endpoint).
- During the staging verification phase, no production command, migration, or
  deployment was run. The later approved production backend-first deployment is
  recorded below.
- No commit or push was performed.

## Known limitations

- The current staging company-scope dataset returned zero outstanding AR, so
  non-zero financial reconciliation remains to be repeated with representative
  staging fixtures.
- This is live present-balance reporting, not historical snapshot reporting.
- Credit-rating distribution reflects maintained customer master ratings, not
  predictive or AI-generated risk.
- DSO remains intentionally deferred.

## Frontend integration (Batch 7A)

The dashboard frontend was switched from mock/illustrative/static data to the
verified live nested contract returned by:

```text
GET /reports/dashboard?trend_months=6
```

All requests go through the existing `useApi()` layer (Bearer JWT + `X-Company-Id`
header injection). No frontend direct Supabase table access was added.

### Frontend files changed

Modified:

- `frontend/src/types/index.ts` — added the nested live contract types
  (`DashboardMeta`, `DashboardKpis`, `DashboardInvoiceStatusCounts`,
  `DashboardAgingBucket`, `DashboardCollectionTrendPoint`, `DashboardTopCustomer`,
  `DashboardCreditRatingRow`, `LiveDashboardMetrics`, `DashboardScope`,
  `AgingBucketKey`) mirroring `reports/dashboard-types.ts`; marked the legacy flat
  `DashboardSummary` as `@deprecated`; preserved the eight deprecated top-level
  aliases on `LiveDashboardMetrics`.
- `frontend/src/hooks/use-dashboard.ts` — replaced `useDashboardSummary` with
  `useDashboardMetrics(trendMonths = 6)` calling `GET /reports/dashboard?trend_months=6`
  through `useApi().get`; React Query config: `staleTime` 30s, `refetchInterval`
  60s, `refetchIntervalInBackground: false`, `refetchOnWindowFocus: true`,
  `placeholderData: keepPreviousData`, `retry: false`; exposes
  `metrics`, `isLoading`, `isRefreshing`, `isError`, `error`, `refetch`. The
  call is `silent: true` so the page renders its own inline error/empty states.
  The `useAgingSummary` / `useAgingByCustomer` report hooks were left unchanged.
- `frontend/src/app/(dashboard)/page.tsx` — rewritten to consume the nested
  contract; removed `DSO_TREND_DATA`, `CREDIT_RISK_DATA`, the `RISK_COLORS` mock
  constant, the invalid collection-rate calculation, and the "Real-Time Data"
  subtitle; added live-data indicators (scope label, business as-of date,
  last-updated timestamp, manual refresh button, refreshing spinner) plus error
  and empty handling.
- `frontend/src/components/features/dashboard/credit-risk-chart.tsx` — relabeled
  to "Customer Credit Rating Distribution — maintained customer credit ratings,
  not a predictive/AI score"; added base-currency tooltip, loading and empty
  states.
- `frontend/src/components/features/dashboard/composition-chart.tsx` — added an
  empty state for zero balance; renamed from "Outstanding Composition" to
  "AR & Cash Position" with the subtitle "Gross outstanding AR, overdue AR, and
  unapplied cash are shown separately" (removing the duplicated title/subtitle
  wording); tooltip now uses the dashboard `meta.base_currency` passed from the
  page instead of a hardcoded `MYR`. Unapplied cash is kept as its own slice,
  visually separate from outstanding AR.
- `frontend/src/components/features/dashboard/aging-chart.tsx` — added an
  explicit zero-data state (shown when all buckets have zero amount and count).
- `frontend/src/components/features/dashboard/quick-stats.tsx` — repurposed from
  the old (invalid) collection-rate strip to live operational counts: posted this
  month, overdue invoices, unpaid invoices, and import rows needing review.

Created:

- `frontend/src/components/features/dashboard/collection-trend-chart.tsx` — live
  collection trend (base currency) replacing the mock DSO chart.
- `frontend/src/components/features/dashboard/top-customers.tsx` — live top
  outstanding customers table.

Deleted:

- `frontend/src/components/features/dashboard/dso-trend-chart.tsx` — removed; DSO
  is intentionally deferred per the backend metric design, so the mock-only DSO
  component was dead code.

### Live contract fields used

- `meta.base_currency`, `meta.as_of_date`, `meta.calculated_at`, `meta.scope`.
- `kpis.total_outstanding_ar`, `kpis.overdue_outstanding`,
  `kpis.overdue_invoice_count`, `kpis.unapplied_cash`,
  `kpis.current_month_collections`, `kpis.current_month_posted_invoices`,
  `kpis.import_rows_needing_review`.
- `invoice_status_counts.open`, `.partially_paid`, `.overdue_status`, `.paid`,
  `.unpaid_total`.
- `aging_buckets[]` (`label`, `outstanding_base`, `invoice_count`).
- `collection_trend[]` (`month`, `collected_base`, `receipt_count`).
- `top_outstanding_customers[]` (`customer_name`, `customer_code`,
  `outstanding_base`, `overdue_base`, `overdue_invoice_count`).
- `credit_rating_distribution[]` (`rating`, `customer_count`, `outstanding_base`).

New dashboard visuals use the nested contract as the source of truth. The
deprecated top-level aliases are typed for compatibility but are not used to back
any visual.

### Mock / static dashboard data removed or replaced

- `DSO_TREND_DATA` — removed (mock DSO area chart). Replaced by the live
  collection-trend chart.
- `CREDIT_RISK_DATA` and the local `RISK_COLORS` mock — removed. Replaced by live
  `credit_rating_distribution`, relabeled as maintained customer ratings.
- Invalid collection-rate calculation (`100 - overdue_percentage`) — removed.
- "Accounts Receivable Overview · Real-Time Data" subtitle — removed; replaced by
  explicit scope, as-of date, and last-updated indicators driven by `meta`.

### Live data indicators and resilience

- Last-updated time from `meta.calculated_at`.
- Business as-of date from `meta.as_of_date`.
- Scope label: `assigned_customers` → "Assigned Customers", `company` →
  "Company".
- Manual refresh action and a subtle refreshing spinner (`isRefreshing`).
- Per-chart empty states for zero data (aging, composition, collection trend,
  credit rating, top customers).
- Error state renders an inline panel instead of crashing: 403 shows a
  role-access message (System Admin-only), other errors show a retry action.

### Access behavior

- AR Clerk → backend returns `assigned_customers` scope; the header reflects
  "Assigned Customers".
- AR Supervisor / Finance Manager / Auditor → `company` scope; header reflects
  "Company".
- System Admin-only → backend `403`; the page renders the graceful
  role-access panel (no crash, no duplicate toast because the request is
  `silent`).
- Validation/API errors → graceful inline error panel with retry.

### Build result

```text
cd frontend
npm.cmd run build
```

Result: PASS. `✓ Compiled successfully`, linting and type checks passed, all 23
routes generated. The dashboard route (`/`) built as static.

### Direct Supabase access check (frontend)

```text
rg "supabase\.from|\.from\(['\"](invoices|receipts|allocation_details)|createClient" frontend/src
```

Result: the only match is the pre-existing auth client in
`frontend/src/lib/supabase.ts` (`createClient(...)`), used solely for the Supabase
**auth session/JWT** consumed by `useApi()`. That file was not modified by this
task. No `supabase.from(...)` table read/write and no
`.from("invoices" | "receipts" | "allocation_details")` access exists anywhere in
`frontend/src`. No direct Supabase table access was added.

### Backend untouched statement (frontend task)

This frontend task modified only files under `frontend/src` (plus this evidence
document). It did not modify any backend Edge Function, database migration,
financial RPC, or invoice/receipt/allocation mutation logic. The
`backend/supabase/functions/reports/*` and `database/014_live_dashboard_metrics.sql`
entries shown in `git status` are the prior Codex backend batch and were not
altered here.

```text
git status --short
```

Confirms the only frontend additions/changes are the dashboard files listed
above; the deleted `dso-trend-chart.tsx`; and the new `collection-trend-chart.tsx`
and `top-customers.tsx`.

### Production / commit statements (frontend task)

- `POST /allocations/auto` was not enabled or called from the frontend.
- No production deployment was performed.
- No commit or push was performed.

### Known limitations (frontend)

- The dashboard was integrated against the verified **staging** contract; it has
  not been exercised against production data because production was intentionally
  not modified.
- The current staging company-scope dataset returns zero outstanding AR, so the
  charts were validated structurally and via empty states rather than with
  non-zero figures.
- Credit rating distribution reflects maintained customer master ratings, not
  predictive/AI risk.
- DSO is intentionally not shown (deferred at the backend metric layer).

### Codex correction round (frontend)

Codex returned PASS WITH CHANGES on the first frontend submission. The following
corrections were applied (frontend/evidence only):

- Composition chart tooltip no longer hardcodes `MYR`; it now uses
  `meta.base_currency` passed from the page.
- The chart was renamed to "AR & Cash Position" and its subtitle clarified so it
  no longer implies unapplied cash is part of outstanding AR; unapplied cash
  remains a separate slice. Duplicated title/subtitle wording was removed.
- `AgingChart` now has an explicit zero-data state, making the earlier evidence
  claim about an aging empty state accurate.

## Production deployment requirement (frontend/backend compatibility)

**Warning:** the new frontend dashboard consumes the nested live contract and is
**not** compatible with the old production flat dashboard response. The frontend
must not be committed, pushed, or released before the production backend is
upgraded. The production backend must be deployed **before or together with** the
frontend.

Required production sequence:

1. Apply migration `database/014_live_dashboard_metrics.sql` to production
   (`kusseuycqgdilychphpq`).
2. Configure `BUSINESS_TIME_ZONE=Asia/Kuala_Lumpur` on production.
3. Deploy the reviewed `reports` Edge Function to production.
4. Run production read-only backend smoke tests (role/scope, response contract,
   forbidden parameters, `POST /allocations/auto` → 403).
5. Release the frontend.
6. Run frontend production smoke tests.

Until step 1–4 are complete on production, releasing this frontend would break the
dashboard, because the old production endpoint does not return `meta`, `kpis`,
`invoice_status_counts`, `aging_buckets`, `collection_trend`,
`top_outstanding_customers`, or `credit_rating_distribution`.

## Production backend-first deployment

**Production project ref:** `kusseuycqgdilychphpq`
**Staging project ref:** `gcdsdyegwjdcskpukqlq`
**Deployment date:** 2026-06-19

All production commands used the explicit production project ref. No staging
command was run during this production deployment step.

### Production business timezone

`BUSINESS_TIME_ZONE=Asia/Kuala_Lumpur` was set on production and verified by
secret name/presence without printing its value.

### Migration 014 production result

`database/014_live_dashboard_metrics.sql` was applied through the Supabase
Management API endpoint for production project `kusseuycqgdilychphpq`.

Post-application function verification:

- `public.get_ar_dashboard_metrics(uuid, uuid, text, date, integer)` exists;
- volatility is `STABLE`;
- security mode is `SECURITY INVOKER`;
- the function comment exists;
- `service_role` has `EXECUTE`;
- `PUBLIC`, `anon`, and `authenticated` do not have `EXECUTE`;
- explicit ACL: owner `postgres` and `service_role` only.

Read-only negative SQL checks:

| Check | Result |
| --- | --- |
| `p_scope_mode = NULL` | Rejected with `BR-DASH-001` |
| invalid `p_scope_mode` | Rejected with `BR-DASH-001` |
| `p_trend_months = 0` | Rejected with `BR-DASH-001` |
| `p_trend_months = 13` | Rejected with `BR-DASH-001` |
| unauthorized user/company | Rejected with `AUTH:` |

Migration 014 contains only the read-only aggregate function, function comment,
revokes, and service-role grant. It does not alter tables, financial balances,
financial RPCs, or invoice/receipt/allocation mutation logic.

### Production SQL smoke result

A suitable existing active production AR Supervisor and company were used for a
read-only company-scope RPC call. No user, customer, invoice, receipt,
allocation, journal entry, or other fixture was created.

Result:

- `meta` exists;
- `kpis` exists;
- `invoice_status_counts` exists;
- `aging_buckets` has 5 rows;
- `collection_trend` has 6 rows;
- `top_outstanding_customers` exists;
- `credit_rating_distribution` has 6 rows;
- all 8 legacy aliases exist;
- total outstanding AR was `441254.00`;
- aging-bucket total was `441254.00`;
- aging reconciliation passed exactly.

### Production reports deployment

Only the `reports` Edge Function was deployed:

```text
supabase functions deploy reports \
  --project-ref kusseuycqgdilychphpq \
  --use-api --yes
```

Post-deployment result:

- function: `reports`;
- status: `ACTIVE`;
- production version: `11`.

No invoice, receipt, allocation, import, or other Edge Function was deployed.

### Production authenticated HTTP release gate

An existing production Finance Manager was authenticated through Supabase Auth
password grant solely for this smoke test.

**Role tested:** Finance Manager
**Company ID:** `00000000-0000-0000-0000-000000000001`

The password, access token, refresh token, anon key, and other secret values
were retained only in process memory. They were not printed, logged to evidence,
or written to disk.

Dashboard request:

```text
GET https://kusseuycqgdilychphpq.supabase.co/functions/v1/reports/dashboard?trend_months=6
```

Result:

- HTTP 200;
- `meta.scope = company`;
- `meta`, `kpis`, and `invoice_status_counts` exist;
- `aging_buckets` has 5 rows;
- `collection_trend` has 6 rows;
- `top_outstanding_customers` exists;
- `credit_rating_distribution` has 6 rows;
- all 8 legacy aliases exist.

Forbidden query-parameter results:

| Query parameter | HTTP | Error code | Result |
| --- | ---: | --- | --- |
| `company_id` | 400 | `VALIDATION_ERROR` | Passed |
| `user_id` | 400 | `VALIDATION_ERROR` | Passed |
| `scope_mode` | 400 | `VALIDATION_ERROR` | Passed |
| `as_of_date` | 400 | `VALIDATION_ERROR` | Passed |

Auto-allocation safety regression:

```text
POST https://kusseuycqgdilychphpq.supabase.co/functions/v1/allocations/auto
```

Result: HTTP 403 with `AUTO_ALLOCATION_DISABLED`.

No production user was created, no password was reset, and no customer,
invoice, receipt, allocation, journal entry, or other financial fixture was
created. The production authenticated HTTP release gate is cleared.

### Production deployment safety

- Production target was only `kusseuycqgdilychphpq`.
- Staging `gcdsdyegwjdcskpukqlq` was untouched.
- No frontend file was modified during the production backend deployment step.
- No financial RPC file was modified.
- No invoice/receipt/allocation mutation logic was modified.
- `POST /allocations/auto` was not enabled.
- No deployment or migration was run during the authenticated HTTP release-gate
  step.
- No commit or push was performed.

## Deployment statement

Migration 014 and the `reports` Edge Function are now deployed to production
project `kusseuycqgdilychphpq`; production `reports` is ACTIVE at version 11.
Staging project `gcdsdyegwjdcskpukqlq` was not modified during the production
step. No commit or push was performed.

Batch 7A backend staging verification is fully passed for the requested SQL,
role/scope, response-contract, forbidden-parameter, and safety checks. The
frontend live dashboard integration has now been completed against that verified
contract. Production SQL/deployment verification and authenticated dashboard,
forbidden-parameter, and `/allocations/auto` smoke all passed. The production
backend is fully cleared for frontend release.

## Vercel production frontend smoke

**Production frontend URL:** `https://account-receivable-module.vercel.app/`
**Smoke date:** 2026-06-19
**Role tested:** Finance Manager

Local `HEAD`, local `origin/main`, and the remote `main` branch all resolved to:

```text
4b0e638 feat(dashboard): integrate live AR dashboard metrics
```

The production URL returned HTTP 200 from Vercel and loaded the Next.js
application rather than a 404, deployment-not-found, or Vercel build-error page.
Public Vercel response headers and repository metadata did not expose the exact
deployment Git SHA, so commit attribution could not be verified directly from
Vercel metadata. Runtime inspection confirmed that the deployed application
contains and executes the Batch 7A dashboard implementation introduced by
commit `4b0e638`.

### Login and dashboard render

An existing production Finance Manager authenticated successfully through the
production login page. The password, access token, refresh token, browser
session data, cookies, and Supabase keys were not printed or copied into this
evidence. The isolated incognito browser session and temporary profile were
removed after testing.

The dashboard loaded at the production root route without a runtime crash. No
old flat-contract error, missing nested-field error, or `.map()` exception was
observed.

Network inspection confirmed:

```text
GET /functions/v1/reports/dashboard?trend_months=6
```

The request completed with the expected CORS preflight HTTP 204 followed by the
dashboard HTTP 200 response.

### Live dashboard UI verification

The rendered production dashboard displayed:

- Total Outstanding AR;
- Overdue Outstanding and overdue invoice count;
- Unapplied Cash;
- Current Month Collections;
- Current Month Posted Invoices;
- Import Rows Needing Review;
- Open, Partially Paid, Overdue, and Paid invoice status counts;
- five aging buckets;
- six-month Collection Trend;
- Top Outstanding Customers;
- Customer Credit Rating Distribution.

Production runtime values included non-zero outstanding AR, unapplied cash,
collections, invoice counts, and top-customer rows. Zero overdue values rendered
cleanly as `MYR 0.00` and `0 overdue invoice(s)`.

UI detail verification:

- scope label displayed `Company scope`, as expected for Finance Manager;
- business date displayed from `meta.as_of_date`;
- last-updated timestamp displayed from `meta.calculated_at`;
- manual Refresh was clickable;
- the visible `Refreshing…` state appeared during a throttled refresh;
- refresh completed with dashboard HTTP 200 and the page remained rendered;
- credit-rating text states that ratings are maintained customer ratings and
  not a predictive/AI score;
- `AR & Cash Position` states that gross outstanding AR, overdue AR, and
  unapplied cash are shown separately;
- the mock DSO chart was absent.

The fully empty aging/composition/trend/customer states were not triggered
because production contains non-zero data. Their deployed labels/components were
present, and zero overdue values rendered without error.

### Browser console and network safety

- no JavaScript runtime exception was observed;
- no dashboard API failure was observed;
- the only browser console error was a non-functional missing
  `https://account-receivable-module.vercel.app/favicon.ico` HTTP 404;
- no frontend request to `POST /allocations/auto` was observed;
- no direct browser request to Supabase REST financial tables
  `invoices`, `receipts`, or `allocation_details` was observed;
- dashboard financial data was loaded through the backend `reports` endpoint.

No production user was created or reset. No customer or financial fixture was
created. No code file was changed during this smoke test other than this
evidence document. No migration or Supabase deployment was run. No commit or
push was performed.

Batch 7A is fully complete: backend staging and production verification,
production authenticated backend release gate, frontend integration review,
commit/push, and Vercel production frontend runtime smoke have all passed.
