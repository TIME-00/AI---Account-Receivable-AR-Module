-- ============================================================================
-- Batch 7A: Live production dashboard metrics
-- Read-only, company-scoped aggregate for the reports Edge Function.
-- ============================================================================

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

  IF p_scope_mode IS NULL
     OR p_scope_mode NOT IN ('assigned', 'company') THEN
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
