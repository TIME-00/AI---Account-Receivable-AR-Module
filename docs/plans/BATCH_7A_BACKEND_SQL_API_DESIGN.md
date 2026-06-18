# Batch 7A - Backend SQL/API Design

**Project:** GenAI-assisted Accounts Receivable (AR) module
**Scope:** Live production dashboard read model
**Production Supabase ref:** `kusseuycqgdilychphpq`
**Status:** DESIGN ONLY - no migration, code, commit, or deployment
**Date:** 2026-06-18

> This document defines the proposed read-only SQL and API contract for Batch 7A. The SQL below is a design draft only. It must not be applied until migration `014_live_dashboard_metrics.sql` is separately reviewed and approved.

---

## 1. Final backend approach

### 1.1 API ownership

Keep the existing route:

```text
GET /reports/dashboard
```

Extend the existing reports Edge Function:

- `backend/supabase/functions/reports/index.ts`
- `backend/supabase/functions/reports/service.ts`

No separate dashboard Edge Function is needed. Dashboard analytics belong to the existing reports read boundary, which already handles:

- JWT authentication;
- `X-Company-Id`;
- company roles;
- structured API responses;
- read-only AR reporting.

### 1.2 Aggregation approach

Use one new read-only PostgreSQL aggregation function:

```text
public.get_ar_dashboard_metrics(...)
```

The SQL function remains justified because:

- PostgREST row limits can truncate raw invoice/receipt data before Deno aggregation;
- mixed transaction currencies must be converted consistently to company base currency;
- one SQL statement gives one coherent database snapshot;
- PostgreSQL is more efficient for filtering, grouping, summing, bucketing, and time-series generation;
- the Edge Function should return aggregate data, not transfer all financial rows into the Edge runtime.

### 1.3 Migration decision

The recommended production implementation requires migration:

```text
database/014_live_dashboard_metrics.sql
```

This design does not create that migration. User approval remains required after review of this document.

---

## 2. Exact SQL function contract

### 2.1 Signature

```sql
public.get_ar_dashboard_metrics(
  p_company_id uuid,
  p_user_id uuid,
  p_scope_mode text,
  p_as_of_date date DEFAULT CURRENT_DATE,
  p_trend_months integer DEFAULT 6
) RETURNS jsonb
```

Parameter rules:

| Parameter | Rule |
| --- | --- |
| `p_company_id` | Required company UUID from authenticated Edge Function context |
| `p_user_id` | Required authenticated Supabase user UUID |
| `p_scope_mode` | `assigned` for AR Clerk, `company` for AR Supervisor, Finance Manager, or Auditor |
| `p_as_of_date` | Trusted backend/staging test date; defaults to PostgreSQL `CURRENT_DATE`. Never accepted from the browser |
| `p_trend_months` | Number of monthly collection points; integer from 1 to 12, default 6 |

The browser must never choose `p_scope_mode`, `p_company_id`, `p_user_id`, or
`p_as_of_date`. The Edge Function derives the current business date internally.
Keeping `p_as_of_date` in the SQL signature makes staging reconciliation
deterministic; it does not make historical snapshot reporting available.

### 2.2 Return type

Return one `jsonb` object matching the TypeScript contract in Section 6:

- `meta`
- `kpis`
- `invoice_status_counts`
- `aging_buckets`
- `collection_trend`
- `top_outstanding_customers`
- `credit_rating_distribution`
- temporary compatibility aliases

### 2.3 Security mode

Use:

```sql
SECURITY INVOKER
SET search_path = ''
```

Justification:

- The reports Edge Function calls the RPC with the service-role client.
- The service role already has the required read privileges and bypasses RLS.
- `SECURITY INVOKER` avoids creating a new elevated definer context.
- Every table name is fully qualified with `public.`.
- Explicit company, user-role, assignment, visibility, and status filters remain mandatory because service role bypasses RLS.
- Execution is revoked from browser-facing roles and granted only to `service_role`.

`SECURITY DEFINER` is not required and would increase the privilege surface.

### 2.4 Role defense in depth

The Edge Function performs the primary authorization check. The SQL function also verifies:

- the user has an active role in `p_company_id`;
- allowed roles are AR Clerk, AR Supervisor, Finance Manager, or Auditor;
- `company` scope is permitted only for AR Supervisor, Finance Manager, or Auditor;
- `assigned` scope requires an active AR Clerk role;
- System Admin-only users cannot read operational dashboard metrics.

A user with multiple roles may receive company scope only if they hold an allowed company-wide read role.

---

## 3. Draft SQL function

The following SQL is the proposed migration body. It is included for review only.

```sql
CREATE OR REPLACE FUNCTION public.get_ar_dashboard_metrics(
  p_company_id uuid,
  p_user_id uuid,
  p_scope_mode text,
  p_as_of_date date DEFAULT CURRENT_DATE,
  p_trend_months integer DEFAULT 6
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_base_currency char(3);
  v_as_of_date date := COALESCE(p_as_of_date, CURRENT_DATE);
  v_current_month_start date;
  v_result jsonb;
BEGIN
  IF p_company_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'BR-DASH-001: company_id and user_id are required';
  END IF;

  IF p_scope_mode NOT IN ('assigned', 'company') THEN
    RAISE EXCEPTION 'BR-DASH-001: scope_mode must be assigned or company';
  END IF;

  IF p_trend_months IS NULL OR p_trend_months < 1 OR p_trend_months > 12 THEN
    RAISE EXCEPTION 'BR-DASH-001: trend_months must be between 1 and 12';
  END IF;

  SELECT c.base_currency
  INTO v_base_currency
  FROM public.companies c
  WHERE c.id = p_company_id
    AND c.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Active company not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.company_id = p_company_id
      AND ur.is_active = true
      AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
  ) THEN
    RAISE EXCEPTION 'AUTH: User has no dashboard read role for this company'
      USING ERRCODE = '42501';
  END IF;

  IF p_scope_mode = 'company'
     AND NOT EXISTS (
       SELECT 1
       FROM public.user_roles ur
       WHERE ur.user_id = p_user_id
         AND ur.company_id = p_company_id
         AND ur.is_active = true
         AND ur.role IN ('AR Supervisor', 'Finance Manager', 'Auditor')
     ) THEN
    RAISE EXCEPTION 'AUTH: Company-wide dashboard scope is not permitted'
      USING ERRCODE = '42501';
  END IF;

  IF p_scope_mode = 'assigned'
     AND NOT EXISTS (
       SELECT 1
       FROM public.user_roles ur
       WHERE ur.user_id = p_user_id
         AND ur.company_id = p_company_id
         AND ur.is_active = true
         AND ur.role = 'AR Clerk'
     ) THEN
    RAISE EXCEPTION 'AUTH: Assigned-customer dashboard scope requires AR Clerk role'
      USING ERRCODE = '42501';
  END IF;

  v_current_month_start := date_trunc('month', v_as_of_date::timestamp)::date;

  WITH
  scoped_customers AS MATERIALIZED (
    SELECT
      c.id,
      c.customer_id AS customer_code,
      c.customer_name,
      c.credit_rating
    FROM public.customers c
    WHERE c.company_id = p_company_id
      AND c.is_deleted = false
      AND c.is_hidden = false
      AND (
        p_scope_mode = 'company'
        OR EXISTS (
          SELECT 1
          FROM public.user_customer_assignments uca
          WHERE uca.company_id = p_company_id
            AND uca.user_id = p_user_id
            AND uca.customer_id = c.id
            AND uca.is_active = true
        )
      )
  ),

  company_documents AS MATERIALIZED (
    SELECT
      i.id,
      i.customer_id,
      i.doc_type,
      i.invoice_date,
      i.due_date,
      i.status,
      i.posted_at,
      i.outstanding,
      i.exchange_rate,
      ROUND(i.outstanding * i.exchange_rate, 2) AS outstanding_base
    FROM public.invoices i
    JOIN scoped_customers sc ON sc.id = i.customer_id
    WHERE i.company_id = p_company_id
      AND i.invoice_date <= v_as_of_date
  ),

  invoice_documents AS MATERIALIZED (
    SELECT *
    FROM company_documents d
    WHERE d.doc_type IN ('Invoice', 'Debit Note')
  ),

  outstanding_invoices AS MATERIALIZED (
    SELECT *
    FROM invoice_documents d
    WHERE d.status IN ('Open', 'Partially Paid', 'Overdue')
      AND d.outstanding > 0
  ),

  posted_receipts AS MATERIALIZED (
    SELECT
      r.id,
      r.customer_id,
      r.receipt_date,
      r.status,
      r.posted_at,
      r.base_amount,
      r.unallocated_amount,
      r.exchange_rate,
      ROUND(r.unallocated_amount * r.exchange_rate, 2) AS unallocated_base
    FROM public.receipts r
    JOIN scoped_customers sc ON sc.id = r.customer_id
    WHERE r.company_id = p_company_id
      AND r.status IN ('Posted', 'Fully Allocated')
      AND r.posted_at IS NOT NULL
      AND r.receipt_date <= v_as_of_date
  ),

  dashboard_kpis AS (
    SELECT
      COALESCE(SUM(oi.outstanding_base), 0)::numeric(18,2)
        AS total_outstanding_ar,
      COALESCE(
        SUM(oi.outstanding_base)
          FILTER (
            WHERE oi.due_date IS NOT NULL
              AND oi.due_date < v_as_of_date
          ),
        0
      )::numeric(18,2) AS overdue_outstanding,
      COUNT(*) FILTER (
        WHERE oi.due_date IS NOT NULL
          AND oi.due_date < v_as_of_date
      )::integer AS overdue_invoice_count
    FROM outstanding_invoices oi
  ),

  receipt_kpis AS (
    SELECT
      COALESCE(
        SUM(pr.unallocated_base) FILTER (WHERE pr.unallocated_amount > 0),
        0
      )::numeric(18,2) AS unapplied_cash,
      COALESCE(
        SUM(pr.base_amount) FILTER (
          WHERE pr.receipt_date >= v_current_month_start
            AND pr.receipt_date < (v_current_month_start + INTERVAL '1 month')::date
        ),
        0
      )::numeric(18,2) AS current_month_collections,
      COUNT(*)::integer AS posted_receipt_count
    FROM posted_receipts pr
  ),

  invoice_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE d.status = 'Open')::integer AS open,
      COUNT(*) FILTER (WHERE d.status = 'Partially Paid')::integer AS partially_paid,
      COUNT(*) FILTER (WHERE d.status = 'Overdue')::integer AS overdue_status,
      COUNT(*) FILTER (WHERE d.status = 'Paid')::integer AS paid,
      COUNT(*) FILTER (
        WHERE d.status IN ('Open', 'Partially Paid', 'Overdue')
          AND d.outstanding > 0
      )::integer AS unpaid_total,
      COUNT(*) FILTER (
        WHERE d.posted_at IS NOT NULL
          AND d.status <> 'Cancelled'
          AND d.invoice_date >= v_current_month_start
          AND d.invoice_date < (v_current_month_start + INTERVAL '1 month')::date
      )::integer AS current_month_posted_invoices,
      COUNT(*) FILTER (
        WHERE d.status NOT IN ('Draft', 'Cancelled')
      )::integer AS posted_invoice_count
    FROM invoice_documents d
  ),

  aging_classified AS (
    SELECT
      oi.id,
      oi.outstanding_base,
      CASE
        WHEN oi.due_date IS NULL OR oi.due_date >= v_as_of_date THEN 'current'
        WHEN (v_as_of_date - oi.due_date) BETWEEN 1 AND 30 THEN '1_30'
        WHEN (v_as_of_date - oi.due_date) BETWEEN 31 AND 60 THEN '31_60'
        WHEN (v_as_of_date - oi.due_date) BETWEEN 61 AND 90 THEN '61_90'
        ELSE 'over_90'
      END AS bucket_key
    FROM outstanding_invoices oi
  ),

  aging_definitions AS (
    SELECT *
    FROM (
      VALUES
        ('current'::text, 'Current'::text, 0),
        ('1_30'::text, '1-30 Days'::text, 1),
        ('31_60'::text, '31-60 Days'::text, 2),
        ('61_90'::text, '61-90 Days'::text, 3),
        ('over_90'::text, 'Over 90 Days'::text, 4)
    ) AS d(bucket_key, label, sort_order)
  ),

  aging_grouped AS (
    SELECT
      ac.bucket_key,
      COUNT(*)::integer AS invoice_count,
      COALESCE(SUM(ac.outstanding_base), 0)::numeric(18,2)
        AS outstanding_base
    FROM aging_classified ac
    GROUP BY ac.bucket_key
  ),

  aging_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'key', ad.bucket_key,
          'label', ad.label,
          'invoice_count', COALESCE(ag.invoice_count, 0),
          'outstanding_base', COALESCE(ag.outstanding_base, 0),
          'percentage',
            CASE
              WHEN dk.total_outstanding_ar > 0
              THEN ROUND(
                COALESCE(ag.outstanding_base, 0)
                / dk.total_outstanding_ar * 100,
                2
              )
              ELSE 0
            END
        )
        ORDER BY ad.sort_order
      ),
      '[]'::jsonb
    ) AS value
    FROM aging_definitions ad
    LEFT JOIN aging_grouped ag ON ag.bucket_key = ad.bucket_key
    CROSS JOIN dashboard_kpis dk
    GROUP BY dk.total_outstanding_ar
  ),

  trend_month_definitions AS (
    SELECT
      (
        v_current_month_start
        - make_interval(months => gs.month_offset)
      )::date AS month_start
    FROM generate_series(0, p_trend_months - 1) AS gs(month_offset)
  ),

  collection_trend_grouped AS (
    SELECT
      tmd.month_start,
      COALESCE(SUM(pr.base_amount), 0)::numeric(18,2)
        AS collected_base,
      COUNT(pr.id)::integer AS receipt_count
    FROM trend_month_definitions tmd
    LEFT JOIN posted_receipts pr
      ON pr.receipt_date >= tmd.month_start
     AND pr.receipt_date < (tmd.month_start + INTERVAL '1 month')::date
    GROUP BY tmd.month_start
  ),

  collection_trend_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'month', to_char(ctg.month_start, 'YYYY-MM'),
          'collected_base', ctg.collected_base,
          'receipt_count', ctg.receipt_count
        )
        ORDER BY ctg.month_start
      ),
      '[]'::jsonb
    ) AS value
    FROM collection_trend_grouped ctg
  ),

  customer_outstanding AS (
    SELECT
      sc.id AS customer_id,
      sc.customer_code,
      sc.customer_name,
      sc.credit_rating,
      COALESCE(SUM(oi.outstanding_base), 0)::numeric(18,2)
        AS outstanding_base,
      COALESCE(
        SUM(oi.outstanding_base) FILTER (
          WHERE oi.due_date IS NOT NULL
            AND oi.due_date < v_as_of_date
        ),
        0
      )::numeric(18,2) AS overdue_base,
      COUNT(oi.id) FILTER (
        WHERE oi.due_date IS NOT NULL
          AND oi.due_date < v_as_of_date
      )::integer AS overdue_invoice_count
    FROM scoped_customers sc
    LEFT JOIN outstanding_invoices oi ON oi.customer_id = sc.id
    GROUP BY
      sc.id,
      sc.customer_code,
      sc.customer_name,
      sc.credit_rating
  ),

  top_customers_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'customer_id', ranked.customer_id,
          'customer_code', ranked.customer_code,
          'customer_name', ranked.customer_name,
          'outstanding_base', ranked.outstanding_base,
          'overdue_base', ranked.overdue_base,
          'overdue_invoice_count', ranked.overdue_invoice_count
        )
        ORDER BY ranked.outstanding_base DESC, ranked.customer_name
      ),
      '[]'::jsonb
    ) AS value
    FROM (
      SELECT *
      FROM customer_outstanding co
      WHERE co.outstanding_base > 0
      ORDER BY co.outstanding_base DESC, co.customer_name
      LIMIT 10
    ) ranked
  ),

  rating_definitions AS (
    SELECT *
    FROM (
      VALUES
        ('AAA'::text, 0),
        ('AA'::text, 1),
        ('A'::text, 2),
        ('B'::text, 3),
        ('C'::text, 4),
        ('D'::text, 5)
    ) AS r(rating, sort_order)
  ),

  rating_grouped AS (
    SELECT
      co.credit_rating AS rating,
      COUNT(*)::integer AS customer_count,
      COALESCE(SUM(co.outstanding_base), 0)::numeric(18,2)
        AS outstanding_base
    FROM customer_outstanding co
    WHERE co.outstanding_base > 0
    GROUP BY co.credit_rating
  ),

  credit_rating_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'rating', rd.rating,
          'customer_count', COALESCE(rg.customer_count, 0),
          'outstanding_base', COALESCE(rg.outstanding_base, 0)
        )
        ORDER BY rd.sort_order
      ),
      '[]'::jsonb
    ) AS value
    FROM rating_definitions rd
    LEFT JOIN rating_grouped rg ON rg.rating = rd.rating
  ),

  import_review AS (
    SELECT COUNT(*)::integer AS import_rows_needing_review
    FROM public.import_rows ir
    JOIN public.import_batches ib ON ib.id = ir.batch_id
    WHERE ib.company_id = p_company_id
      AND ir.status IN ('Unmatched', 'Skipped', 'Error')
      AND ir.mapped_data @> '{"review_required": true}'::jsonb
      AND COALESCE(ir.mapped_data->>'review_result', '')
          NOT IN ('rejected', 'revalidated_valid')
      AND (
        p_scope_mode = 'company'
        OR ib.created_by = p_user_id
      )
  ),

  compatibility_aliases AS (
    SELECT
      (
        SELECT COUNT(*)::integer
        FROM public.invoices i
        JOIN scoped_customers sc ON sc.id = i.customer_id
        WHERE i.company_id = p_company_id
          AND i.status NOT IN ('Draft', 'Cancelled')
      ) AS total_invoices,
      (
        SELECT COUNT(*)::integer
        FROM public.invoices i
        JOIN scoped_customers sc ON sc.id = i.customer_id
        WHERE i.company_id = p_company_id
          AND i.status = 'Open'
      ) AS open_invoices,
      (
        SELECT COUNT(*)::integer
        FROM public.invoices i
        JOIN scoped_customers sc ON sc.id = i.customer_id
        WHERE i.company_id = p_company_id
          AND i.status = 'Overdue'
      ) AS overdue_invoices,
      (
        SELECT COUNT(*)::integer
        FROM public.receipts r
        JOIN scoped_customers sc ON sc.id = r.customer_id
        WHERE r.company_id = p_company_id
          AND r.status NOT IN ('Draft', 'Cancelled')
      ) AS total_receipts,
      (
        SELECT COALESCE(SUM(i.outstanding), 0)::numeric(18,2)
        FROM public.invoices i
        JOIN scoped_customers sc ON sc.id = i.customer_id
        WHERE i.company_id = p_company_id
          AND i.doc_type IN ('Invoice', 'Debit Note')
          AND i.status IN ('Open', 'Partially Paid', 'Overdue')
      ) AS total_ar_balance,
      (
        SELECT COALESCE(SUM(i.outstanding), 0)::numeric(18,2)
        FROM public.invoices i
        JOIN scoped_customers sc ON sc.id = i.customer_id
        WHERE i.company_id = p_company_id
          AND i.doc_type IN ('Invoice', 'Debit Note')
          AND i.status = 'Overdue'
      ) AS total_overdue_balance,
      (
        COALESCE((
          SELECT SUM(r.unallocated_amount)
          FROM public.receipts r
          JOIN scoped_customers sc ON sc.id = r.customer_id
          WHERE r.company_id = p_company_id
            AND r.status IN ('Posted', 'Fully Allocated')
            AND r.unallocated_amount > 0
        ), 0)
        +
        COALESCE((
          SELECT SUM(i.outstanding)
          FROM public.invoices i
          JOIN scoped_customers sc ON sc.id = i.customer_id
          WHERE i.company_id = p_company_id
            AND i.doc_type = 'Credit Note'
            AND i.status IN ('Open', 'Partially Paid')
            AND i.outstanding > 0
        ), 0)
      )::numeric(18,2) AS total_credit_balance
  )

  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'company_id', p_company_id,
      'base_currency', v_base_currency,
      'as_of_date', v_as_of_date,
      'calculated_at', CURRENT_TIMESTAMP,
      'scope',
        CASE
          WHEN p_scope_mode = 'assigned'
          THEN 'assigned_customers'
          ELSE 'company'
        END,
      'trend_months', p_trend_months
    ),
    'kpis', jsonb_build_object(
      'total_outstanding_ar', dk.total_outstanding_ar,
      'overdue_outstanding', dk.overdue_outstanding,
      'overdue_invoice_count', dk.overdue_invoice_count,
      'unapplied_cash', rk.unapplied_cash,
      'current_month_collections', rk.current_month_collections,
      'current_month_posted_invoices', ic.current_month_posted_invoices,
      'import_rows_needing_review', ir.import_rows_needing_review
    ),
    'invoice_status_counts', jsonb_build_object(
      'open', ic.open,
      'partially_paid', ic.partially_paid,
      'overdue_status', ic.overdue_status,
      'paid', ic.paid,
      'unpaid_total', ic.unpaid_total
    ),
    'aging_buckets', aj.value,
    'collection_trend', ctj.value,
    'top_outstanding_customers', tcj.value,
    'credit_rating_distribution', crj.value,

    -- Deprecated compatibility aliases preserve the current endpoint's
    -- existing formulas and transaction-currency semantics exactly.
    -- New frontend code must use the nested base-currency contract.
    'total_invoices', ca.total_invoices,
    'open_invoices', ca.open_invoices,
    'overdue_invoices', ca.overdue_invoices,
    'total_receipts', ca.total_receipts,
    'total_ar_balance', ca.total_ar_balance,
    'total_overdue_balance', ca.total_overdue_balance,
    'total_credit_balance', ca.total_credit_balance,
    'overdue_percentage',
      CASE
        WHEN ca.total_ar_balance > 0
        THEN ROUND(
          ca.total_overdue_balance / ca.total_ar_balance * 100,
          2
        )
        ELSE 0
      END
  )
  INTO v_result
  FROM dashboard_kpis dk
  CROSS JOIN receipt_kpis rk
  CROSS JOIN invoice_counts ic
  CROSS JOIN aging_json aj
  CROSS JOIN collection_trend_json ctj
  CROSS JOIN top_customers_json tcj
  CROSS JOIN credit_rating_json crj
  CROSS JOIN import_review ir
  CROSS JOIN compatibility_aliases ca;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_ar_dashboard_metrics(
  uuid,
  uuid,
  text,
  date,
  integer
) IS
  'Read-only, service-role-only AR dashboard aggregate in company base currency. '
  'Uses present financial balances and is not historical snapshot reporting.';
```

### 3.1 SQL review notes

- `scoped_customers` is the only customer population used by invoice and receipt CTEs.
- Every transaction source also filters `company_id`, even though customer IDs are UUIDs, for explicit tenant defense.
- Live invoice metrics exclude `invoice_date > p_as_of_date`.
- Live receipt metrics and trends exclude `receipt_date > p_as_of_date`.
- Gross AR excludes credit notes and unapplied receipts rather than silently netting them.
- `outstanding * exchange_rate` is used because outstanding remains transaction currency while the posting exchange rate is stored on the invoice.
- `base_amount` is used for collections because it is the posted receipt amount in company base currency.
- Unapplied cash uses `unallocated_amount * exchange_rate`.
- Overdue calculations use `due_date < p_as_of_date`, not persisted `Overdue` status alone.
- Collection trend includes zero-valued months.
- Credit rating is the maintained customer master rating, not predictive risk.
- `current_month_posted_invoices` counts posted Invoice/Debit Note documents whose
  accounting `invoice_date` falls in the month containing `p_as_of_date`; it is
  not a count of API posting events by `posted_at` timestamp.
- DSO is intentionally absent.
- Empty customer scope returns zero KPIs, five zero aging buckets, the requested
  number of zero-valued collection months, an empty top-customer array, and six
  zero-valued credit-rating entries (`AAA`, `AA`, `A`, `B`, `C`, `D`).

### 3.2 Date behavior

- If `p_as_of_date` is null or omitted, use database `CURRENT_DATE`.
- The public API does not accept `as_of_date`.
- The Edge Function derives `p_as_of_date` from the configured business timezone.
- `p_as_of_date` remains callable only through the service-role RPC path for
  deterministic staging tests and reconciliation.
- Current-month KPIs use the calendar month containing `p_as_of_date`.
- Collection trend ends in that same calendar month.
- Future-dated invoices and receipts are excluded from all live nested metrics.
- The response echoes the effective date in `meta.as_of_date`.
- The current schema has no company timezone column. Batch 7A uses backend
  environment variable `BUSINESS_TIME_ZONE`, currently expected to be
  `Asia/Kuala_Lumpur`. A future tenant-specific timezone column is separate scope.
- This function reports current balances classified using a trusted effective
  date. It is not historical snapshot reporting and must not be presented as such.

---

## 4. Grants and revokes

The intended migration privileges are:

```sql
REVOKE ALL ON FUNCTION public.get_ar_dashboard_metrics(
  uuid,
  uuid,
  text,
  date,
  integer
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_ar_dashboard_metrics(
  uuid,
  uuid,
  text,
  date,
  integer
) FROM anon;

REVOKE ALL ON FUNCTION public.get_ar_dashboard_metrics(
  uuid,
  uuid,
  text,
  date,
  integer
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.get_ar_dashboard_metrics(
  uuid,
  uuid,
  text,
  date,
  integer
) TO service_role;
```

Browser roles must not execute the function directly because:

- the browser must not choose company, user, or scope parameters;
- the Edge Function must verify JWT roles before database access;
- service-role execution bypasses RLS and therefore requires trusted parameter construction;
- exposing the RPC to `authenticated` would create an avoidable tenant-scope attack surface;
- the frontend must continue using the Edge Function/API layer.

No table grants are added by migration `014`.

---

## 5. Edge Function integration

### 5.1 Route

No route change:

```text
GET /reports/dashboard
```

Optional query parameters:

```text
trend_months=1..12
```

Do not accept:

- `company_id` as a dashboard-specific body parameter;
- `user_id`;
- `scope_mode`;
- `as_of_date`;
- role overrides.

The existing global company extraction may continue accepting `X-Company-Id`. The service must pass only `auth.companyId`.
The current business date must be derived by the Edge Function using
`BUSINESS_TIME_ZONE`, defaulting only through an explicitly documented deployment
configuration. The expected current value is `Asia/Kuala_Lumpur`.

### 5.2 `reports/index.ts`

Proposed route flow:

```ts
const companyId = extractCompanyId(req);
const auth = await getAuthContext(req, companyId);

if (route === "dashboard" && req.method === "GET") {
  const trendMonthsText = url.searchParams.get("trend_months");
  const trendMonths = trendMonthsText === null
    ? 6
    : Number(trendMonthsText);

  if (!Number.isInteger(trendMonths) || trendMonths < 1 || trendMonths > 12) {
    throw new ValidationError("trend_months must be an integer from 1 to 12.");
  }

  const businessTimeZone = Deno.env.get("BUSINESS_TIME_ZONE");
  if (!businessTimeZone) {
    throw new Error("Missing BUSINESS_TIME_ZONE environment variable.");
  }
  const businessDate = formatDateInTimeZone(new Date(), businessTimeZone);

  const result = await service.getDashboardMetrics(
    auth,
    businessDate,
    trendMonths,
  );
  return jsonResponse(successResponse(result));
}
```

`extractCompanyId()` validates the header as a UUID. `getAuthContext()` then loads active roles specifically for that company. A forged company header therefore does not create an authorized context unless the user has an active allowed role in that company.

`formatDateInTimeZone()` must use `Intl.DateTimeFormat(...).formatToParts()` and
return `YYYY-MM-DD`. It must reject an invalid IANA timezone configuration rather
than silently falling back to browser, server-local, or UTC date.

### 5.3 `reports/service.ts`

Proposed service flow:

```ts
const DASHBOARD_READ_ROLES = [
  "AR Clerk",
  "AR Supervisor",
  "Finance Manager",
  "Auditor",
] as const;

async getDashboardMetrics(
  auth: AuthContext,
  businessDate: string,
  trendMonths = 6,
): Promise<LiveDashboardMetrics> {
  requireAnyRole(auth, [...DASHBOARD_READ_ROLES]);
  validateDate(businessDate, "business_date");

  const hasCompanyScope = auth.roles.some((role) =>
    ["AR Supervisor", "Finance Manager", "Auditor"].includes(role)
  );

  const scopeMode = hasCompanyScope ? "company" : "assigned";

  const { data, error } = await this.client.rpc(
    "get_ar_dashboard_metrics",
    {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_scope_mode: scopeMode,
      p_as_of_date: businessDate,
      p_trend_months: trendMonths,
    },
  );

  if (error) {
    // Map AUTH / NOT_FOUND / BR-DASH-* to the existing structured error model.
    throw mapDashboardRpcError(error);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Dashboard metrics RPC returned an invalid response.");
  }

  return validateDashboardMetricsResponse(data);
}
```

The implementation may reuse `callRpc()` if it cleanly maps `AUTH`, `NOT_FOUND`, and `BR-DASH-*`. Otherwise add a small report-specific error mapper. Do not return raw PostgreSQL error details to the browser.

### 5.4 Role behavior

| Role | Scope |
| --- | --- |
| AR Clerk | Assigned visible customers only |
| AR Supervisor | Company-wide visible customers |
| Finance Manager | Company-wide visible customers |
| Auditor | Company-wide visible customers, read-only |
| System Admin only | 403 |

If a user has System Admin plus an allowed operational/read role, the allowed role governs. A System Admin-only user remains denied.

### 5.5 Compatibility

The SQL response includes temporary deprecated aliases expected by the current
frontend:

- `total_invoices`
- `open_invoices`
- `overdue_invoices`
- `total_receipts`
- `total_ar_balance`
- `total_overdue_balance`
- `total_credit_balance`
- `overdue_percentage`

These aliases preserve the existing endpoint formulas exactly, including the
legacy transaction-currency semantics of the old amount fields:

- `total_receipts` remains all non-Draft/non-Cancelled receipts;
- `total_credit_balance` remains unapplied receipts plus unused open credit notes;
- `total_ar_balance` and `total_overdue_balance` retain the old transaction-currency formulas.

This makes backend-first deployment safe for the existing frontend. The new
frontend must use only the nested base-currency contract. Compatibility aliases
must be marked deprecated and removed only in a later approved cleanup. They
must not be used for new production analytics.

---

## 6. TypeScript contract

Recommended shared backend/frontend contract:

```ts
export type DashboardScope = "assigned_customers" | "company";
export type AgingBucketKey =
  | "current"
  | "1_30"
  | "31_60"
  | "61_90"
  | "over_90";

export interface DashboardMeta {
  company_id: string;
  base_currency: string;
  as_of_date: string;
  calculated_at: string;
  scope: DashboardScope;
  trend_months: number;
}

export interface DashboardKpis {
  total_outstanding_ar: number;
  overdue_outstanding: number;
  overdue_invoice_count: number;
  unapplied_cash: number;
  current_month_collections: number;
  current_month_posted_invoices: number;
  import_rows_needing_review: number;
}

export interface DashboardInvoiceStatusCounts {
  open: number;
  partially_paid: number;
  overdue_status: number;
  paid: number;
  unpaid_total: number;
}

export interface DashboardAgingBucket {
  key: AgingBucketKey;
  label: string;
  invoice_count: number;
  outstanding_base: number;
  percentage: number;
}

export interface DashboardCollectionTrendPoint {
  month: string; // YYYY-MM
  collected_base: number;
  receipt_count: number;
}

export interface DashboardTopCustomer {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  outstanding_base: number;
  overdue_base: number;
  overdue_invoice_count: number;
}

export interface DashboardCreditRatingRow {
  rating: "AAA" | "AA" | "A" | "B" | "C" | "D";
  customer_count: number;
  outstanding_base: number;
}

export interface LiveDashboardMetrics {
  meta: DashboardMeta;
  kpis: DashboardKpis;
  invoice_status_counts: DashboardInvoiceStatusCounts;
  aging_buckets: DashboardAgingBucket[];
  collection_trend: DashboardCollectionTrendPoint[];
  top_outstanding_customers: DashboardTopCustomer[];
  credit_rating_distribution: DashboardCreditRatingRow[];

  /** @deprecated Temporary compatibility aliases. */
  total_invoices: number;
  /** @deprecated */
  open_invoices: number;
  /** @deprecated */
  overdue_invoices: number;
  /** @deprecated */
  total_receipts: number;
  /** @deprecated Preserves legacy transaction-currency semantics. */
  total_ar_balance: number;
  /** @deprecated Preserves legacy transaction-currency semantics. */
  total_overdue_balance: number;
  /** @deprecated Preserves legacy unapplied-receipt plus unused-credit-note semantics. */
  total_credit_balance: number;
  /** @deprecated */
  overdue_percentage: number;
}
```

Backend response validation should verify:

- required objects exist;
- arrays are arrays;
- amounts and counts are finite non-negative numbers;
- `base_currency` is three characters;
- `scope` is allowed;
- `as_of_date` and `month` strings have expected formats.

---

## 7. Security review

The proposed design:

- changes no financial RPC;
- changes no invoice posting logic;
- changes no receipt posting logic;
- changes no allocation, reversal, cancellation, or bounced-cheque logic;
- inserts nothing into `allocation_details`;
- updates no `invoices.outstanding`;
- updates no `receipts.allocated_amount`;
- updates no `receipts.unallocated_amount`;
- does not call or enable `POST /allocations/auto`;
- adds no OCR/PDF/Image import;
- adds no frontend Supabase financial-table access;
- uses `public` schema only;
- returns read-only aggregates;
- explicitly filters every source by company;
- limits AR Clerk to active assigned customers;
- excludes hidden/deleted customers before financial joins;
- prevents browser execution of the SQL function;
- denies System Admin-only operational access.

The service-role client bypasses RLS. Correctness therefore depends on both:

1. Edge authorization and trusted parameter construction.
2. SQL defense-in-depth role, company, assignment, and visibility checks.

---

## 8. Performance and index review

### 8.1 Existing useful indexes

Existing schema indexes include:

- `customers(company_id)`
- partial customer status/visibility-related indexes
- `invoices(company_id)`
- `invoices(customer_id)`
- `invoices(company_id, status)`
- partial invoice due-date indexes for outstanding statuses
- `receipts(company_id)`
- `receipts(customer_id)`
- `receipts(company_id, status)`
- `receipts(receipt_date)`
- partial receipt unallocated index
- `user_customer_assignments` indexes on user, customer, and company
- `import_batches(company_id, status)`
- `import_batches(company_id, created_at)`
- `import_rows(batch_id, status)`

These are sufficient for initial staging implementation and correctness testing.

### 8.2 Required performance review

Before proposing an index:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT public.get_ar_dashboard_metrics(
  '<COMPANY_UUID>'::uuid,
  '<USER_UUID>'::uuid,
  'company',
  CURRENT_DATE,
  6
);
```

Review:

- sequential scans on high-volume invoice/receipt tables;
- join cost for scoped customers;
- import review JSONB filtering;
- total execution time;
- buffer reads;
- effect of AR Clerk assignment scope.

### 8.3 Optional indexes requiring separate approval

Only if staging query plans demonstrate a need:

```sql
-- Possible outstanding invoice aggregate index.
CREATE INDEX CONCURRENTLY ...
ON public.invoices(company_id, customer_id, due_date)
INCLUDE (status, doc_type, outstanding, exchange_rate)
WHERE status IN ('Open', 'Partially Paid', 'Overdue')
  AND doc_type IN ('Invoice', 'Debit Note')
  AND outstanding > 0;

-- Possible posted receipt trend index.
CREATE INDEX CONCURRENTLY ...
ON public.receipts(company_id, customer_id, receipt_date)
INCLUDE (status, posted_at, base_amount, unallocated_amount, exchange_rate)
WHERE status IN ('Posted', 'Fully Allocated')
  AND posted_at IS NOT NULL;

-- Possible active assignment lookup index.
CREATE INDEX CONCURRENTLY ...
ON public.user_customer_assignments(company_id, user_id, customer_id)
WHERE is_active = true;
```

These are not part of approved migration `014` unless separately justified. Do not add speculative indexes.

---

## 9. Staging smoke test plan

### 9.1 API role/scope matrix

Call:

```text
GET /reports/dashboard?trend_months=6
```

with valid bearer token and `X-Company-Id`.

| Test | Expected |
| --- | --- |
| AR Clerk | 200; `meta.scope=assigned_customers`; only assigned visible customers contribute |
| AR Supervisor | 200; `meta.scope=company`; all visible company customers contribute |
| Finance Manager | 200; `meta.scope=company` |
| Auditor | 200 read-only; `meta.scope=company` |
| System Admin only | 403 |
| Wrong company header without role | 403 |
| Invalid company UUID | 400 validation error |
| Empty assigned scope | 200 with zero metrics and stable empty arrays |
| Company with no visible activity | 200 with zero metrics |
| Future-dated posted invoice | excluded until its `invoice_date` is reached |
| Future-dated posted receipt | excluded until its `receipt_date` is reached |
| Missing/invalid `BUSINESS_TIME_ZONE` | structured server configuration error; no silent fallback |

### 9.2 SQL parameter and authorization tests

Call the function through an authorized service-role staging session and verify:

| Test | Expected |
| --- | --- |
| `p_trend_months = 0` | `BR-DASH-001` validation error |
| `p_trend_months = 13` | `BR-DASH-001` validation error |
| `p_scope_mode = 'invalid'` | `BR-DASH-001` validation error |
| inactive/nonexistent company | `NOT_FOUND` |
| user without active role in company | `AUTH` / SQLSTATE `42501` |
| AR Clerk requests `company` scope | `AUTH` / SQLSTATE `42501` |
| Supervisor/Manager/Auditor requests `company` scope | succeeds |
| deterministic staging `p_as_of_date` | accepted only through service-role test path |

### 9.3 Hidden/deleted exclusion

For a hidden or deleted customer with financial records:

- customer does not appear in top customers;
- invoice balances contribute zero;
- receipt balances contribute zero;
- aging and credit-rating totals exclude the customer;
- AR Clerk cannot gain visibility through assignment alone.

### 9.4 Multi-currency base-currency reconciliation

Create staging fixtures through verified application flows:

- one MYR invoice with exchange rate `1.000000`;
- one SGD invoice with a maintained SGD-to-company-base exchange rate;
- one MYR posted receipt;
- one SGD posted receipt;
- all records belong to visible, in-scope customers.

Verify:

- MYR invoice base outstanding equals transaction outstanding;
- SGD invoice base outstanding equals
  `ROUND(outstanding * exchange_rate, 2)`;
- total outstanding is the sum of the two base amounts, not the sum of MYR and
  SGD transaction amounts;
- unapplied cash converts both receipts to company base currency;
- current-month collections equals the sum of stored `base_amount`;
- aging and top-customer amounts reconcile to the same base-currency values.

Do not insert or update financial balances directly to create this fixture.

### 9.5 Mutation-driven refresh

Use existing verified UI/API flows:

1. Record dashboard baseline.
2. Create and post one invoice for a visible customer.
3. Refetch dashboard.
4. Confirm:
   - outstanding AR increases by invoice base amount;
   - current-month posted invoice count increases;
   - unpaid/status count changes;
   - aging/top-customer values update.
5. Create and post a receipt with no allocation.
6. Refetch and confirm:
   - current-month collections increases by receipt `base_amount`;
   - unapplied cash increases by receipt unallocated base amount.
7. Allocate through `POST /allocations/manual`.
8. Refetch and confirm:
   - invoice outstanding decreases;
   - unapplied cash decreases;
   - aging/top-customer values change consistently.

No direct financial field update is permitted during smoke testing.

### 9.6 Safety regression

Verify:

```text
POST /allocations/auto
```

returns:

```text
403 AUTO_ALLOCATION_DISABLED
```

Also run:

```powershell
cd backend/supabase/functions
deno check reports/index.ts

cd ../../../frontend
npm.cmd run build

cd ..
git diff --check
git status --short
rg -n "\.from\(|supabase\.from|createClient" frontend/src
```

Frontend search results must not include financial-table reads or writes.

---

## 10. Read-only SQL reconciliation queries

Replace placeholders before running:

- `<COMPANY_UUID>`
- `<USER_UUID>`
- scope mode `company` or `assigned`

The following common CTE is repeated so each query is independently executable.

### 10.1 Total outstanding AR

```sql
WITH params AS (
  SELECT
    '<COMPANY_UUID>'::uuid AS company_id,
    '<USER_UUID>'::uuid AS user_id,
    'company'::text AS scope_mode,
    CURRENT_DATE AS as_of_date
),
scoped_customers AS (
  SELECT c.id
  FROM public.customers c
  CROSS JOIN params p
  WHERE c.company_id = p.company_id
    AND c.is_deleted = false
    AND c.is_hidden = false
    AND (
      p.scope_mode = 'company'
      OR EXISTS (
        SELECT 1
        FROM public.user_customer_assignments uca
        WHERE uca.company_id = p.company_id
          AND uca.user_id = p.user_id
          AND uca.customer_id = c.id
          AND uca.is_active = true
      )
    )
)
SELECT COALESCE(SUM(ROUND(i.outstanding * i.exchange_rate, 2)), 0)
  AS total_outstanding_ar
FROM public.invoices i
JOIN scoped_customers sc ON sc.id = i.customer_id
JOIN params p ON p.company_id = i.company_id
WHERE i.doc_type IN ('Invoice', 'Debit Note')
  AND i.status IN ('Open', 'Partially Paid', 'Overdue')
  AND i.invoice_date <= p.as_of_date
  AND i.outstanding > 0;
```

### 10.2 Overdue outstanding and invoice count

```sql
WITH params AS (
  SELECT
    '<COMPANY_UUID>'::uuid AS company_id,
    '<USER_UUID>'::uuid AS user_id,
    'company'::text AS scope_mode,
    CURRENT_DATE AS as_of_date
),
scoped_customers AS (
  SELECT c.id
  FROM public.customers c
  CROSS JOIN params p
  WHERE c.company_id = p.company_id
    AND c.is_deleted = false
    AND c.is_hidden = false
    AND (
      p.scope_mode = 'company'
      OR EXISTS (
        SELECT 1
        FROM public.user_customer_assignments uca
        WHERE uca.company_id = p.company_id
          AND uca.user_id = p.user_id
          AND uca.customer_id = c.id
          AND uca.is_active = true
      )
    )
)
SELECT
  COALESCE(SUM(ROUND(i.outstanding * i.exchange_rate, 2)), 0)
    AS overdue_outstanding,
  COUNT(*)::integer AS overdue_invoice_count
FROM public.invoices i
JOIN scoped_customers sc ON sc.id = i.customer_id
JOIN params p ON p.company_id = i.company_id
WHERE i.doc_type IN ('Invoice', 'Debit Note')
  AND i.status IN ('Open', 'Partially Paid', 'Overdue')
  AND i.invoice_date <= p.as_of_date
  AND i.outstanding > 0
  AND i.due_date IS NOT NULL
  AND i.due_date < p.as_of_date;
```

### 10.3 Unapplied cash

```sql
WITH params AS (
  SELECT
    '<COMPANY_UUID>'::uuid AS company_id,
    '<USER_UUID>'::uuid AS user_id,
    'company'::text AS scope_mode,
    CURRENT_DATE AS as_of_date
),
scoped_customers AS (
  SELECT c.id
  FROM public.customers c
  CROSS JOIN params p
  WHERE c.company_id = p.company_id
    AND c.is_deleted = false
    AND c.is_hidden = false
    AND (
      p.scope_mode = 'company'
      OR EXISTS (
        SELECT 1
        FROM public.user_customer_assignments uca
        WHERE uca.company_id = p.company_id
          AND uca.user_id = p.user_id
          AND uca.customer_id = c.id
          AND uca.is_active = true
      )
    )
)
SELECT COALESCE(
  SUM(ROUND(r.unallocated_amount * r.exchange_rate, 2)),
  0
) AS unapplied_cash
FROM public.receipts r
JOIN scoped_customers sc ON sc.id = r.customer_id
JOIN params p ON p.company_id = r.company_id
WHERE r.status IN ('Posted', 'Fully Allocated')
  AND r.posted_at IS NOT NULL
  AND r.receipt_date <= p.as_of_date
  AND r.unallocated_amount > 0;
```

### 10.4 Current-month collections

```sql
WITH params AS (
  SELECT
    '<COMPANY_UUID>'::uuid AS company_id,
    '<USER_UUID>'::uuid AS user_id,
    'company'::text AS scope_mode,
    CURRENT_DATE AS as_of_date
),
scoped_customers AS (
  SELECT c.id
  FROM public.customers c
  CROSS JOIN params p
  WHERE c.company_id = p.company_id
    AND c.is_deleted = false
    AND c.is_hidden = false
    AND (
      p.scope_mode = 'company'
      OR EXISTS (
        SELECT 1
        FROM public.user_customer_assignments uca
        WHERE uca.company_id = p.company_id
          AND uca.user_id = p.user_id
          AND uca.customer_id = c.id
          AND uca.is_active = true
      )
    )
)
SELECT COALESCE(SUM(r.base_amount), 0) AS current_month_collections
FROM public.receipts r
JOIN scoped_customers sc ON sc.id = r.customer_id
JOIN params p ON p.company_id = r.company_id
WHERE r.status IN ('Posted', 'Fully Allocated')
  AND r.posted_at IS NOT NULL
  AND r.receipt_date <= p.as_of_date
  AND r.receipt_date >= date_trunc('month', p.as_of_date::timestamp)::date
  AND r.receipt_date
      < (
        date_trunc('month', p.as_of_date::timestamp)
        + INTERVAL '1 month'
      )::date;
```

### 10.5 Aging buckets and reconciliation to total outstanding

```sql
WITH params AS (
  SELECT
    '<COMPANY_UUID>'::uuid AS company_id,
    '<USER_UUID>'::uuid AS user_id,
    'company'::text AS scope_mode,
    CURRENT_DATE AS as_of_date
),
scoped_customers AS (
  SELECT c.id
  FROM public.customers c
  CROSS JOIN params p
  WHERE c.company_id = p.company_id
    AND c.is_deleted = false
    AND c.is_hidden = false
    AND (
      p.scope_mode = 'company'
      OR EXISTS (
        SELECT 1
        FROM public.user_customer_assignments uca
        WHERE uca.company_id = p.company_id
          AND uca.user_id = p.user_id
          AND uca.customer_id = c.id
          AND uca.is_active = true
      )
    )
),
classified AS (
  SELECT
    CASE
      WHEN i.due_date IS NULL OR i.due_date >= p.as_of_date THEN 'current'
      WHEN (p.as_of_date - i.due_date) BETWEEN 1 AND 30 THEN '1_30'
      WHEN (p.as_of_date - i.due_date) BETWEEN 31 AND 60 THEN '31_60'
      WHEN (p.as_of_date - i.due_date) BETWEEN 61 AND 90 THEN '61_90'
      ELSE 'over_90'
    END AS bucket,
    ROUND(i.outstanding * i.exchange_rate, 2) AS outstanding_base
  FROM public.invoices i
  JOIN scoped_customers sc ON sc.id = i.customer_id
  JOIN params p ON p.company_id = i.company_id
  WHERE i.doc_type IN ('Invoice', 'Debit Note')
    AND i.status IN ('Open', 'Partially Paid', 'Overdue')
    AND i.invoice_date <= p.as_of_date
    AND i.outstanding > 0
),
bucketed AS (
  SELECT
    bucket,
    COUNT(*)::integer AS invoice_count,
    SUM(outstanding_base)::numeric(18,2) AS outstanding_base
  FROM classified
  GROUP BY bucket
)
SELECT
  bucket,
  invoice_count,
  outstanding_base,
  SUM(outstanding_base) OVER () AS all_bucket_total
FROM bucketed
ORDER BY CASE bucket
  WHEN 'current' THEN 0
  WHEN '1_30' THEN 1
  WHEN '31_60' THEN 2
  WHEN '61_90' THEN 3
  ELSE 4
END;
```

`all_bucket_total` must equal the total outstanding query.

### 10.6 Top outstanding customers

```sql
WITH params AS (
  SELECT
    '<COMPANY_UUID>'::uuid AS company_id,
    '<USER_UUID>'::uuid AS user_id,
    'company'::text AS scope_mode,
    CURRENT_DATE AS as_of_date
),
scoped_customers AS (
  SELECT c.id, c.customer_id, c.customer_name
  FROM public.customers c
  CROSS JOIN params p
  WHERE c.company_id = p.company_id
    AND c.is_deleted = false
    AND c.is_hidden = false
    AND (
      p.scope_mode = 'company'
      OR EXISTS (
        SELECT 1
        FROM public.user_customer_assignments uca
        WHERE uca.company_id = p.company_id
          AND uca.user_id = p.user_id
          AND uca.customer_id = c.id
          AND uca.is_active = true
      )
    )
)
SELECT
  sc.id AS customer_id,
  sc.customer_id AS customer_code,
  sc.customer_name,
  SUM(ROUND(i.outstanding * i.exchange_rate, 2))::numeric(18,2)
    AS outstanding_base,
  COALESCE(
    SUM(ROUND(i.outstanding * i.exchange_rate, 2))
      FILTER (
        WHERE i.due_date IS NOT NULL
          AND i.due_date < p.as_of_date
      ),
    0
  )::numeric(18,2) AS overdue_base,
  COUNT(*) FILTER (
    WHERE i.due_date IS NOT NULL
      AND i.due_date < p.as_of_date
  )::integer AS overdue_invoice_count
FROM scoped_customers sc
JOIN public.invoices i ON i.customer_id = sc.id
JOIN params p ON p.company_id = i.company_id
WHERE i.doc_type IN ('Invoice', 'Debit Note')
  AND i.status IN ('Open', 'Partially Paid', 'Overdue')
  AND i.invoice_date <= p.as_of_date
  AND i.outstanding > 0
GROUP BY sc.id, sc.customer_id, sc.customer_name
ORDER BY outstanding_base DESC, sc.customer_name
LIMIT 10;
```

### 10.7 Import rows needing review

```sql
WITH params AS (
  SELECT
    '<COMPANY_UUID>'::uuid AS company_id,
    '<USER_UUID>'::uuid AS user_id,
    'company'::text AS scope_mode
)
SELECT COUNT(*)::integer AS import_rows_needing_review
FROM public.import_rows ir
JOIN public.import_batches ib ON ib.id = ir.batch_id
CROSS JOIN params p
WHERE ib.company_id = p.company_id
  AND ir.status IN ('Unmatched', 'Skipped', 'Error')
  AND ir.mapped_data @> '{"review_required": true}'::jsonb
  AND COALESCE(ir.mapped_data->>'review_result', '')
      NOT IN ('rejected', 'revalidated_valid')
  AND (
    p.scope_mode = 'company'
    OR ib.created_by = p.user_id
  );
```

### 10.8 Full RPC comparison

After migration approval and staging application:

```sql
SELECT public.get_ar_dashboard_metrics(
  '<COMPANY_UUID>'::uuid,
  '<USER_UUID>'::uuid,
  'company',
  CURRENT_DATE,
  6
);
```

Compare each JSON field against the standalone queries above.

---

## 11. Rollback and deployment

### 11.1 Staging deployment order

1. Approve migration `014`.
2. Configure and verify staging `BUSINESS_TIME_ZONE=Asia/Kuala_Lumpur`.
3. Apply migration `014` to staging.
4. Verify function privileges.
5. Run SQL reconciliation and `EXPLAIN`.
6. Deploy only the `reports` Edge Function to staging.
7. Run role/scope API smoke tests.
8. Implement/build frontend against the verified response.
9. Run mutation-driven refresh smoke.
10. Capture evidence.

### 11.2 Production deployment order

1. Back up current reports function code and deployment metadata.
2. Record current frontend deployment commit.
3. Configure and verify production `BUSINESS_TIME_ZONE=Asia/Kuala_Lumpur`.
4. Apply approved migration `014` to production.
5. Verify grants/revokes and call the RPC through service role only.
6. Deploy only the `reports` Edge Function.
7. Run production read-only API reconciliation.
8. Deploy frontend.
9. Run dashboard refresh and visibility smoke.
10. Verify `/allocations/auto` remains disabled.

### 11.3 Edge Function rollback

- Redeploy the previous `reports` Edge Function commit.
- The compatibility aliases allow the previous frontend to continue during rollback.

### 11.4 SQL rollback

After the previous reports function/frontend is restored:

```sql
REVOKE ALL ON FUNCTION public.get_ar_dashboard_metrics(
  uuid,
  uuid,
  text,
  date,
  integer
) FROM service_role;

DROP FUNCTION IF EXISTS public.get_ar_dashboard_metrics(
  uuid,
  uuid,
  text,
  date,
  integer
);
```

Rollback changes no financial table, balance, journal, allocation, or financial RPC.

---

## 12. Final recommendation

Migration `014_live_dashboard_metrics.sql` is required for the recommended production-safe implementation. A no-migration Edge-only aggregation is technically possible but is not recommended because of PostgREST row limits, larger data transfer, mixed-currency aggregation risk, and inconsistent multi-query snapshots.

Final proposed function:

```text
public.get_ar_dashboard_metrics(
  p_company_id uuid,
  p_user_id uuid,
  p_scope_mode text,
  p_as_of_date date DEFAULT CURRENT_DATE,
  p_trend_months integer DEFAULT 6
) RETURNS jsonb
```

The design is safe to implement after:

1. Codex reviews the exact SQL in this document.
2. The user explicitly approves creation of migration `014`.
3. Staging query plans and reconciliation tests pass.

No existing financial RPC will be modified or called by the dashboard function.

Claude should wait for the backend contract, migration, and staging response to be implemented and verified before integrating the live dashboard frontend. Claude may prepare visual layout concepts separately, but must not build data assumptions that differ from this contract.
