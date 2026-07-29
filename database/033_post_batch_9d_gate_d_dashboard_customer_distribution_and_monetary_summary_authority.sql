-- ============================================================================
-- Post-Batch-9D Gate D: dashboard customer rating drill-down and
-- provenance-aware Invoice/Receipt monetary summaries.
--
-- This migration performs no financial-row DML and no backfill. Existing
-- invoices, receipts, booked-rate snapshots, LEGACY_UNVERIFIED decisions,
-- LegacyBackfilled events, journals, allocations and import provenance remain
-- unchanged. Only collection-total authority eligibility changes.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_ar_dashboard_metrics(
  p_company_id UUID,
  p_user_id UUID,
  p_scope_mode TEXT,
  p_as_of_date DATE DEFAULT CURRENT_DATE,
  p_trend_months INTEGER DEFAULT 6
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_base_currency CHAR(3);
  v_as_of_date DATE := COALESCE(p_as_of_date, CURRENT_DATE);
  v_current_month_start DATE;
  v_result JSONB;
BEGIN
  IF p_company_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'BR-DASH-001: company_id and user_id are required';
  END IF;

  IF p_scope_mode IS NULL OR p_scope_mode NOT IN ('assigned', 'company') THEN
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

  IF p_scope_mode = 'company' AND NOT EXISTS (
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

  IF p_scope_mode = 'assigned' AND NOT EXISTS (
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

  -- Ratings outside the canonical six-row contract are never silently omitted.
  IF EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.company_id = p_company_id
      AND c.is_deleted = false
      AND c.is_hidden = false
      AND c.status IN ('Active', 'Inactive', 'Blocked', 'On Hold')
      AND (
        c.credit_rating IS NULL
        OR c.credit_rating NOT IN ('AAA', 'AA', 'A', 'B', 'C', 'D')
      )
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
  ) THEN
    RAISE EXCEPTION 'BR-DASH-002: invalid customer credit rating';
  END IF;

  v_current_month_start := date_trunc('month', v_as_of_date::timestamp)::date;

  WITH scoped_customers AS MATERIALIZED (
    SELECT
      c.id,
      c.customer_id AS customer_code,
      c.customer_name,
      c.credit_rating
    FROM public.customers c
    WHERE c.company_id = p_company_id
      AND c.is_deleted = false
      AND c.is_hidden = false
      AND c.status IN ('Active', 'Inactive', 'Blocked', 'On Hold')
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
      COALESCE(SUM(oi.outstanding_base), 0)::NUMERIC(18,2)
        AS total_outstanding_ar,
      COALESCE(
        SUM(oi.outstanding_base) FILTER (
          WHERE oi.due_date IS NOT NULL AND oi.due_date < v_as_of_date
        ),
        0
      )::NUMERIC(18,2) AS overdue_outstanding,
      COUNT(*) FILTER (
        WHERE oi.due_date IS NOT NULL AND oi.due_date < v_as_of_date
      )::INTEGER AS overdue_invoice_count
    FROM outstanding_invoices oi
  ),
  receipt_kpis AS (
    SELECT
      COALESCE(
        SUM(pr.unallocated_base) FILTER (WHERE pr.unallocated_amount > 0),
        0
      )::NUMERIC(18,2) AS unapplied_cash,
      COALESCE(
        SUM(pr.base_amount) FILTER (
          WHERE pr.receipt_date >= v_current_month_start
            AND pr.receipt_date
              < (v_current_month_start + INTERVAL '1 month')::date
        ),
        0
      )::NUMERIC(18,2) AS current_month_collections,
      COUNT(*)::INTEGER AS posted_receipt_count
    FROM posted_receipts pr
  ),
  invoice_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE d.status = 'Open')::INTEGER AS open,
      COUNT(*) FILTER (WHERE d.status = 'Partially Paid')::INTEGER
        AS partially_paid,
      COUNT(*) FILTER (WHERE d.status = 'Overdue')::INTEGER
        AS overdue_status,
      COUNT(*) FILTER (WHERE d.status = 'Paid')::INTEGER AS paid,
      COUNT(*) FILTER (
        WHERE d.status IN ('Open', 'Partially Paid', 'Overdue')
          AND d.outstanding > 0
      )::INTEGER AS unpaid_total,
      COUNT(*) FILTER (
        WHERE d.posted_at IS NOT NULL
          AND d.status <> 'Cancelled'
          AND d.invoice_date >= v_current_month_start
          AND d.invoice_date
            < (v_current_month_start + INTERVAL '1 month')::date
      )::INTEGER AS current_month_posted_invoices,
      COUNT(*) FILTER (
        WHERE d.status NOT IN ('Draft', 'Cancelled')
      )::INTEGER AS posted_invoice_count
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
        ('current'::TEXT, 'Current'::TEXT, 0),
        ('1_30'::TEXT, '1-30 Days'::TEXT, 1),
        ('31_60'::TEXT, '31-60 Days'::TEXT, 2),
        ('61_90'::TEXT, '61-90 Days'::TEXT, 3),
        ('over_90'::TEXT, 'Over 90 Days'::TEXT, 4)
    ) AS d(bucket_key, label, sort_order)
  ),
  aging_grouped AS (
    SELECT
      ac.bucket_key,
      COUNT(*)::INTEGER AS invoice_count,
      COALESCE(SUM(ac.outstanding_base), 0)::NUMERIC(18,2)
        AS outstanding_base
    FROM aging_classified ac
    GROUP BY ac.bucket_key
  ),
  aging_json AS (
    SELECT COALESCE(
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'key', ad.bucket_key,
          'label', ad.label,
          'invoice_count', COALESCE(ag.invoice_count, 0),
          'outstanding_base', COALESCE(ag.outstanding_base, 0),
          'percentage', CASE
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
      '[]'::JSONB
    ) AS value
    FROM aging_definitions ad
    LEFT JOIN aging_grouped ag ON ag.bucket_key = ad.bucket_key
    CROSS JOIN dashboard_kpis dk
    GROUP BY dk.total_outstanding_ar
  ),
  trend_month_definitions AS (
    SELECT (
      v_current_month_start - make_interval(months => gs.month_offset)
    )::date AS month_start
    FROM generate_series(0, p_trend_months - 1) AS gs(month_offset)
  ),
  collection_trend_grouped AS (
    SELECT
      tmd.month_start,
      COALESCE(SUM(pr.base_amount), 0)::NUMERIC(18,2) AS collected_base,
      COUNT(pr.id)::INTEGER AS receipt_count
    FROM trend_month_definitions tmd
    LEFT JOIN posted_receipts pr
      ON pr.receipt_date >= tmd.month_start
     AND pr.receipt_date < (tmd.month_start + INTERVAL '1 month')::date
    GROUP BY tmd.month_start
  ),
  collection_trend_json AS (
    SELECT COALESCE(
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'month', to_char(ctg.month_start, 'YYYY-MM'),
          'collected_base', ctg.collected_base,
          'receipt_count', ctg.receipt_count
        )
        ORDER BY ctg.month_start
      ),
      '[]'::JSONB
    ) AS value
    FROM collection_trend_grouped ctg
  ),
  customer_outstanding AS (
    SELECT
      sc.id AS customer_id,
      sc.customer_code,
      sc.customer_name,
      sc.credit_rating,
      COALESCE(SUM(oi.outstanding_base), 0)::NUMERIC(18,2)
        AS outstanding_base,
      COALESCE(
        SUM(oi.outstanding_base) FILTER (
          WHERE oi.due_date IS NOT NULL AND oi.due_date < v_as_of_date
        ),
        0
      )::NUMERIC(18,2) AS overdue_base,
      COUNT(oi.id) FILTER (
        WHERE oi.due_date IS NOT NULL AND oi.due_date < v_as_of_date
      )::INTEGER AS overdue_invoice_count
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
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'customer_id', ranked.customer_id,
          'customer_code', ranked.customer_code,
          'customer_name', ranked.customer_name,
          'outstanding_base', ranked.outstanding_base,
          'overdue_base', ranked.overdue_base,
          'overdue_invoice_count', ranked.overdue_invoice_count
        )
        ORDER BY ranked.outstanding_base DESC, ranked.customer_name
      ),
      '[]'::JSONB
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
        ('AAA'::TEXT, 0),
        ('AA'::TEXT, 1),
        ('A'::TEXT, 2),
        ('B'::TEXT, 3),
        ('C'::TEXT, 4),
        ('D'::TEXT, 5)
    ) AS r(rating, sort_order)
  ),
  rating_grouped AS (
    SELECT
      co.credit_rating AS rating,
      COUNT(*)::INTEGER AS customer_count,
      COALESCE(SUM(co.outstanding_base), 0)::NUMERIC(18,2)
        AS outstanding_base
    FROM customer_outstanding co
    WHERE co.outstanding_base > 0
    GROUP BY co.credit_rating
  ),
  credit_rating_json AS (
    SELECT COALESCE(
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'rating', rd.rating,
          'customer_count', COALESCE(rg.customer_count, 0),
          'outstanding_base', COALESCE(rg.outstanding_base, 0)
        )
        ORDER BY rd.sort_order
      ),
      '[]'::JSONB
    ) AS value
    FROM rating_definitions rd
    LEFT JOIN rating_grouped rg ON rg.rating = rd.rating
  ),
  visible_customer_rating_grouped AS (
    SELECT
      sc.credit_rating AS rating,
      COUNT(*)::INTEGER AS customer_count
    FROM scoped_customers sc
    GROUP BY sc.credit_rating
  ),
  visible_customer_rating_json AS (
    SELECT JSONB_BUILD_OBJECT(
      'population', 'VISIBLE_CUSTOMERS',
      'included_statuses',
        JSONB_BUILD_ARRAY('Active', 'Inactive', 'Blocked', 'On Hold'),
      'rows',
        JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'rating', rd.rating,
            'customer_count', COALESCE(vcrg.customer_count, 0)
          )
          ORDER BY rd.sort_order
        )
    ) AS value
    FROM rating_definitions rd
    LEFT JOIN visible_customer_rating_grouped vcrg
      ON vcrg.rating = rd.rating
  ),
  import_review AS (
    SELECT COUNT(*)::INTEGER AS import_rows_needing_review
    FROM public.import_rows ir
    JOIN public.import_batches ib ON ib.id = ir.batch_id
    WHERE ib.company_id = p_company_id
      AND ir.status IN ('Unmatched', 'Skipped', 'Error')
      AND ir.mapped_data @> '{"review_required": true}'::JSONB
      AND COALESCE(ir.mapped_data->>'review_result', '')
        NOT IN ('rejected', 'revalidated_valid')
      AND (p_scope_mode = 'company' OR ib.created_by = p_user_id)
  ),
  compatibility_aliases AS (
    SELECT
      (
        SELECT COUNT(*)::INTEGER
        FROM public.invoices i
        JOIN scoped_customers sc ON sc.id = i.customer_id
        WHERE i.company_id = p_company_id
          AND i.status NOT IN ('Draft', 'Cancelled')
      ) AS total_invoices,
      (
        SELECT COUNT(*)::INTEGER
        FROM public.invoices i
        JOIN scoped_customers sc ON sc.id = i.customer_id
        WHERE i.company_id = p_company_id
          AND i.status = 'Open'
      ) AS open_invoices,
      (
        SELECT COUNT(*)::INTEGER
        FROM public.invoices i
        JOIN scoped_customers sc ON sc.id = i.customer_id
        WHERE i.company_id = p_company_id
          AND i.status = 'Overdue'
      ) AS overdue_invoices,
      (
        SELECT COUNT(*)::INTEGER
        FROM public.receipts r
        JOIN scoped_customers sc ON sc.id = r.customer_id
        WHERE r.company_id = p_company_id
          AND r.status NOT IN ('Draft', 'Cancelled')
      ) AS total_receipts,
      (
        SELECT COALESCE(SUM(i.outstanding), 0)::NUMERIC(18,2)
        FROM public.invoices i
        JOIN scoped_customers sc ON sc.id = i.customer_id
        WHERE i.company_id = p_company_id
          AND i.doc_type IN ('Invoice', 'Debit Note')
          AND i.status IN ('Open', 'Partially Paid', 'Overdue')
      ) AS total_ar_balance,
      (
        SELECT COALESCE(SUM(i.outstanding), 0)::NUMERIC(18,2)
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
        + COALESCE((
          SELECT SUM(i.outstanding)
          FROM public.invoices i
          JOIN scoped_customers sc ON sc.id = i.customer_id
          WHERE i.company_id = p_company_id
            AND i.doc_type = 'Credit Note'
            AND i.status IN ('Open', 'Partially Paid')
            AND i.outstanding > 0
        ), 0)
      )::NUMERIC(18,2) AS total_credit_balance
  )
  SELECT JSONB_BUILD_OBJECT(
    'meta', JSONB_BUILD_OBJECT(
      'company_id', p_company_id,
      'base_currency', v_base_currency,
      'as_of_date', v_as_of_date,
      'calculated_at', CURRENT_TIMESTAMP,
      'scope', CASE
        WHEN p_scope_mode = 'assigned' THEN 'assigned_customers'
        ELSE 'company'
      END,
      'trend_months', p_trend_months
    ),
    'kpis', JSONB_BUILD_OBJECT(
      'total_outstanding_ar', dk.total_outstanding_ar,
      'overdue_outstanding', dk.overdue_outstanding,
      'overdue_invoice_count', dk.overdue_invoice_count,
      'unapplied_cash', rk.unapplied_cash,
      'current_month_collections', rk.current_month_collections,
      'current_month_posted_invoices', ic.current_month_posted_invoices,
      'import_rows_needing_review', ir.import_rows_needing_review
    ),
    'invoice_status_counts', JSONB_BUILD_OBJECT(
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
    'customer_credit_rating_distribution', vcrj.value,
    'total_invoices', ca.total_invoices,
    'open_invoices', ca.open_invoices,
    'overdue_invoices', ca.overdue_invoices,
    'total_receipts', ca.total_receipts,
    'total_ar_balance', ca.total_ar_balance,
    'total_overdue_balance', ca.total_overdue_balance,
    'total_credit_balance', ca.total_credit_balance,
    'overdue_percentage', CASE
      WHEN ca.total_ar_balance > 0
        THEN ROUND(ca.total_overdue_balance / ca.total_ar_balance * 100, 2)
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
  CROSS JOIN visible_customer_rating_json vcrj
  CROSS JOIN import_review ir
  CROSS JOIN compatibility_aliases ca;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.get_ar_dashboard_metrics(
  UUID,
  UUID,
  TEXT,
  DATE,
  INTEGER
) OWNER TO postgres;

COMMENT ON FUNCTION public.get_ar_dashboard_metrics(
  UUID,
  UUID,
  TEXT,
  DATE,
  INTEGER
) IS
  'Read-only AR dashboard aggregate. Gate D adds the all-visible-customer '
  'credit-rating population without changing the Gate B outstanding-only field.';

REVOKE ALL ON FUNCTION public.get_ar_dashboard_metrics(
  UUID,
  UUID,
  TEXT,
  DATE,
  INTEGER
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_ar_dashboard_metrics(
  UUID,
  UUID,
  TEXT,
  DATE,
  INTEGER
) TO service_role;

CREATE INDEX IF NOT EXISTS idx_customers_company_credit_rating_visible
  ON public.customers (company_id, credit_rating, customer_id)
  WHERE is_deleted = false AND is_hidden = false;

CREATE OR REPLACE FUNCTION public.ar_invoice_collection(
  p_company_id UUID,
  p_user_id UUID,
  p_scope_mode TEXT,
  p_doc_type TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_posting_period TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_base_currency CHAR(3);
  v_result JSONB;
BEGIN
  IF p_page IS NULL
    OR p_page < 1
    OR p_page_size IS NULL
    OR p_page_size < 1
    OR p_page_size > 200 THEN
    RAISE EXCEPTION 'BR-9DD-READ-002: invalid pagination';
  END IF;

  v_base_currency := public.ar_9dd_validate_read_scope(
    p_company_id,
    p_user_id,
    p_scope_mode
  );

  WITH scoped_customers AS MATERIALIZED (
    SELECT c.id
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
  filtered AS MATERIALIZED (
    SELECT
      i.*,
      UPPER(TRIM(i.currency::TEXT)) AS summary_currency,
      EXISTS (
        SELECT 1
        FROM public.fx_booking_rate_decisions d
        LEFT JOIN public.exchange_rates source_catalog
          ON source_catalog.id = d.exchange_rate_id
        LEFT JOIN public.fx_reference_rates source_reference
          ON source_reference.id = d.fx_reference_rate_id
        LEFT JOIN public.exchange_rates baseline_catalog
          ON baseline_catalog.id = d.baseline_exchange_rate_id
        LEFT JOIN public.fx_reference_rates baseline_reference
          ON baseline_reference.id = d.baseline_fx_reference_rate_id
        WHERE d.id = i.fx_decision_id
          AND d.company_id = i.company_id
          AND d.company_id = p_company_id
          AND d.invoice_id = i.id
          AND d.receipt_id IS NULL
          AND d.source_category = i.fx_source_category
          AND d.source_category IN (
            'BASE_PARITY',
            'CATALOG',
            'REFERENCE_SELECTED',
            'MANUAL_OVERRIDE'
          )
          AND d.from_currency = i.currency
          AND d.to_currency = i.base_currency
          AND d.transaction_date = i.invoice_date
          -- Both columns are fixed-precision NUMERIC snapshots. Equality is
          -- exact; no tolerance or plausibility heuristic participates.
          AND d.booked_rate = i.exchange_rate::NUMERIC
          AND i.base_total
            = ROUND(i.total_amount * d.booked_rate, 2)
          AND d.stale_reference = false
          AND d.approval_status IN ('NotRequired', 'Approved')
          AND (
            (i.status = 'Draft' AND (
              (d.approval_status = 'NotRequired'
                AND d.lifecycle_status = 'Draft'
                AND d.posted = false
                AND d.posted_at IS NULL)
              OR (d.approval_status = 'Approved'
                AND d.lifecycle_status = 'Approved'
                AND d.posted = false
                AND d.posted_at IS NULL)
            ))
            OR (
              i.status <> 'Draft'
              AND d.lifecycle_status = 'Posted'
              AND d.posted = true
              AND d.posted_at IS NOT NULL
            )
          )
          AND (
            d.approval_status = 'NotRequired'
            OR (
              d.checker_user_id IS NOT NULL
              AND d.checker_user_id IS DISTINCT FROM d.maker_user_id
              AND d.approved_by = d.checker_user_id
              AND d.approved_at IS NOT NULL
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.fx_booking_rate_decisions current_d
            WHERE current_d.invoice_id = i.id
              AND current_d.receipt_id IS NULL
              AND current_d.lifecycle_status <> 'Superseded'
              AND current_d.id <> d.id
          )
          AND CASE d.source_category
            WHEN 'BASE_PARITY' THEN
              i.currency = i.base_currency
              AND i.exchange_rate::NUMERIC = 1.00000000
              AND d.exchange_rate_id IS NULL
              AND d.fx_reference_rate_id IS NULL
              AND d.baseline_kind = 'BASE_PARITY'
              AND d.baseline_rate = 1.00000000
              AND d.baseline_exchange_rate_id IS NULL
              AND d.baseline_fx_reference_rate_id IS NULL
            WHEN 'CATALOG' THEN
              d.exchange_rate_id IS NOT NULL
              AND d.fx_reference_rate_id IS NULL
              AND source_catalog.id = d.exchange_rate_id
              AND source_catalog.company_id = d.company_id
              AND source_catalog.from_currency = d.from_currency
              AND source_catalog.to_currency = d.to_currency
              AND source_catalog.effective_date <= d.transaction_date
              AND source_catalog.rate::NUMERIC = d.booked_rate
              AND d.baseline_kind = 'CATALOG'
              AND d.baseline_exchange_rate_id = d.exchange_rate_id
              AND d.baseline_fx_reference_rate_id IS NULL
              AND d.baseline_rate = d.booked_rate
            WHEN 'REFERENCE_SELECTED' THEN
              d.exchange_rate_id IS NULL
              AND d.fx_reference_rate_id IS NOT NULL
              AND source_reference.id = d.fx_reference_rate_id
              AND source_reference.company_id = d.company_id
              AND source_reference.from_currency = d.from_currency
              AND source_reference.to_currency = d.to_currency
              AND source_reference.effective_date <= d.transaction_date
              AND source_reference.rate = d.booked_rate
              AND d.baseline_kind = 'REFERENCE'
              AND d.baseline_exchange_rate_id IS NULL
              AND d.baseline_fx_reference_rate_id = d.fx_reference_rate_id
              AND d.baseline_rate = d.booked_rate
            WHEN 'MANUAL_OVERRIDE' THEN
              d.exchange_rate_id IS NULL
              AND d.fx_reference_rate_id IS NULL
              AND LENGTH(TRIM(d.override_reason)) >= 5
              AND d.baseline_rate IS NOT NULL
              AND d.suggested_rate IS NOT NULL
              AND d.suggested_rate = d.baseline_rate
              AND (
                (
                  d.baseline_kind = 'CATALOG'
                  AND d.baseline_exchange_rate_id IS NOT NULL
                  AND d.baseline_fx_reference_rate_id IS NULL
                  AND baseline_catalog.id = d.baseline_exchange_rate_id
                  AND baseline_catalog.company_id = d.company_id
                  AND baseline_catalog.from_currency = d.from_currency
                  AND baseline_catalog.to_currency = d.to_currency
                  AND baseline_catalog.effective_date <= d.transaction_date
                  AND baseline_catalog.rate::NUMERIC = d.baseline_rate
                )
                OR (
                  d.baseline_kind = 'REFERENCE'
                  AND d.baseline_exchange_rate_id IS NULL
                  AND d.baseline_fx_reference_rate_id IS NOT NULL
                  AND baseline_reference.id = d.baseline_fx_reference_rate_id
                  AND baseline_reference.company_id = d.company_id
                  AND baseline_reference.from_currency = d.from_currency
                  AND baseline_reference.to_currency = d.to_currency
                  AND baseline_reference.effective_date <= d.transaction_date
                  AND baseline_reference.rate = d.baseline_rate
                )
              )
            ELSE false
          END
      ) AS is_authoritative
    FROM public.invoices i
    JOIN scoped_customers sc ON sc.id = i.customer_id
    WHERE i.company_id = p_company_id
      AND (p_doc_type IS NULL OR i.doc_type = p_doc_type)
      AND (p_status IS NULL OR i.status = p_status)
      AND (p_customer_id IS NULL OR i.customer_id = p_customer_id)
      AND (p_posting_period IS NULL OR i.posting_period = p_posting_period)
      AND (p_date_from IS NULL OR i.invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR i.invoice_date <= p_date_to)
      AND (
        p_search IS NULL
        OR p_search = ''
        OR i.invoice_no ILIKE '%' || p_search || '%'
        OR i.customer_name ILIKE '%' || p_search || '%'
        OR COALESCE(i.reference_no, '') ILIKE '%' || p_search || '%'
      )
  ),
  ranked AS MATERIALIZED (
    SELECT
      f.*,
      ROW_NUMBER() OVER (ORDER BY f.invoice_date DESC, f.id DESC) AS row_no
    FROM filtered f
  ),
  page_rows AS (
    SELECT r.*
    FROM ranked r
    WHERE r.row_no > ((p_page - 1) * p_page_size)
      AND r.row_no <= (p_page * p_page_size)
  ),
  grouped AS MATERIALIZED (
    SELECT
      f.summary_currency AS currency,
      COUNT(*)::BIGINT AS row_count,
      COUNT(*) FILTER (WHERE f.is_authoritative)::BIGINT
        AS authoritative_count,
      COUNT(*) FILTER (WHERE NOT f.is_authoritative)::BIGINT
        AS unavailable_count,
      SUM(f.outstanding)::NUMERIC AS current_amount,
      SUM(ROUND(f.outstanding * f.exchange_rate, 2))
        FILTER (WHERE f.is_authoritative)::NUMERIC AS current_base_amount,
      SUM(f.total_amount)::NUMERIC AS document_amount,
      SUM(f.base_total) FILTER (WHERE f.is_authoritative)::NUMERIC
        AS document_base_amount
    FROM filtered f
    GROUP BY f.summary_currency
  ),
  totals AS (
    SELECT
      COUNT(*)::BIGINT AS row_count,
      COUNT(*) FILTER (WHERE f.is_authoritative)::BIGINT
        AS authoritative_count,
      COUNT(*) FILTER (WHERE NOT f.is_authoritative)::BIGINT
        AS unavailable_count,
      SUM(ROUND(f.outstanding * f.exchange_rate, 2))
        FILTER (WHERE f.is_authoritative)::NUMERIC AS current_base_total,
      SUM(f.base_total) FILTER (WHERE f.is_authoritative)::NUMERIC
        AS document_base_total
    FROM filtered f
  ),
  grouped_json AS (
    SELECT
      COALESCE(
        JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'currency', g.currency,
            'count', g.row_count,
            'authoritative_document_count', g.authoritative_count,
            'unavailable_count', g.unavailable_count,
            'base_available', g.unavailable_count = 0,
            'current_amount',
              TO_CHAR(ROUND(g.current_amount, 2),
                'FM999999999999999999999999999999990.00'),
            'current_base_amount', CASE
              WHEN g.authoritative_count = 0 THEN NULL
              ELSE TO_CHAR(ROUND(g.current_base_amount, 2),
                'FM999999999999999999999999999999990.00')
            END,
            'document_amount',
              TO_CHAR(ROUND(g.document_amount, 2),
                'FM999999999999999999999999999999990.00'),
            'document_base_amount', CASE
              WHEN g.authoritative_count = 0 THEN NULL
              ELSE TO_CHAR(ROUND(g.document_base_amount, 2),
                'FM999999999999999999999999999999990.00')
            END
          )
          ORDER BY g.currency
        ),
        '[]'::JSONB
      ) AS value,
      COUNT(*)::INTEGER AS currency_count
    FROM grouped g
  ),
  unavailable_json AS (
    SELECT COALESCE(
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'currency', g.currency,
          'document_count', g.unavailable_count
        )
        ORDER BY g.currency
      ) FILTER (WHERE g.unavailable_count > 0),
      '[]'::JSONB
    ) AS value
    FROM grouped g
  )
  SELECT JSONB_BUILD_OBJECT(
    'rows', COALESCE((
      SELECT JSONB_AGG(
        TO_JSONB(pr)
          - 'row_no'
          - 'summary_currency'
          - 'is_authoritative'
        ORDER BY pr.row_no
      )
      FROM page_rows pr
    ), '[]'::JSONB),
    'total', t.row_count,
    'summary', JSONB_BUILD_OBJECT(
      'current_balance_summary', JSONB_BUILD_OBJECT(
        'row_count', t.row_count,
        'matching_document_count', t.row_count,
        'authoritative_document_count', t.authoritative_count,
        'unavailable_count', t.unavailable_count,
        'base_available', t.unavailable_count = 0,
        'amount_basis', 'current_outstanding',
        'base_currency', UPPER(TRIM(v_base_currency::TEXT)),
        'base_total', CASE
          WHEN t.row_count = 0 THEN '0.00'
          WHEN t.authoritative_count = 0 THEN NULL
          ELSE TO_CHAR(ROUND(t.current_base_total, 2),
            'FM999999999999999999999999999999990.00')
        END,
        'by_currency', COALESCE((
          SELECT JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'currency', item->>'currency',
              'amount', item->>'current_amount',
              'base_amount', item->'current_base_amount',
              'count', (item->>'count')::BIGINT,
              'authoritative_document_count',
                (item->>'authoritative_document_count')::BIGINT,
              'unavailable_count', (item->>'unavailable_count')::BIGINT,
              'base_available', (item->>'base_available')::BOOLEAN
            )
            ORDER BY item->>'currency'
          )
          FROM JSONB_ARRAY_ELEMENTS(gj.value) AS element(item)
        ), '[]'::JSONB),
        'unavailable_by_currency', uj.value,
        'meta', JSONB_BUILD_OBJECT(
          'contract_version', 2,
          'base_currency', UPPER(TRIM(v_base_currency::TEXT)),
          'multi_currency', gj.currency_count > 1,
          'normalization_basis', 'current_balance_x_booked_rate',
          'authority_basis', 'current_consistent_booked_fx_decision'
        )
      ),
      'document_total_summary', JSONB_BUILD_OBJECT(
        'row_count', t.row_count,
        'matching_document_count', t.row_count,
        'authoritative_document_count', t.authoritative_count,
        'unavailable_count', t.unavailable_count,
        'base_available', t.unavailable_count = 0,
        'amount_basis', 'original_document_total',
        'base_currency', UPPER(TRIM(v_base_currency::TEXT)),
        'base_total', CASE
          WHEN t.row_count = 0 THEN '0.00'
          WHEN t.authoritative_count = 0 THEN NULL
          ELSE TO_CHAR(ROUND(t.document_base_total, 2),
            'FM999999999999999999999999999999990.00')
        END,
        'by_currency', COALESCE((
          SELECT JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'currency', item->>'currency',
              'amount', item->>'document_amount',
              'base_amount', item->'document_base_amount',
              'count', (item->>'count')::BIGINT,
              'authoritative_document_count',
                (item->>'authoritative_document_count')::BIGINT,
              'unavailable_count', (item->>'unavailable_count')::BIGINT,
              'base_available', (item->>'base_available')::BOOLEAN
            )
            ORDER BY item->>'currency'
          )
          FROM JSONB_ARRAY_ELEMENTS(gj.value) AS element(item)
        ), '[]'::JSONB),
        'unavailable_by_currency', uj.value,
        'meta', JSONB_BUILD_OBJECT(
          'contract_version', 2,
          'base_currency', UPPER(TRIM(v_base_currency::TEXT)),
          'multi_currency', gj.currency_count > 1,
          'normalization_basis', 'original_booked_base_snapshot',
          'authority_basis', 'current_consistent_booked_fx_decision'
        )
      )
    )
  )
    INTO v_result
  FROM totals t
  CROSS JOIN grouped_json gj
  CROSS JOIN unavailable_json uj;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.ar_invoice_collection(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  DATE,
  DATE,
  TEXT,
  INTEGER,
  INTEGER
) OWNER TO postgres;

COMMENT ON FUNCTION public.ar_invoice_collection(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  DATE,
  DATE,
  TEXT,
  INTEGER,
  INTEGER
) IS
  'Caller-context Invoice collection with Gate D v2 provenance-aware totals. '
  'No transaction snapshot or financial row is changed.';

REVOKE ALL ON FUNCTION public.ar_invoice_collection(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  DATE,
  DATE,
  TEXT,
  INTEGER,
  INTEGER
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.ar_invoice_collection(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  DATE,
  DATE,
  TEXT,
  INTEGER,
  INTEGER
) TO authenticated;

CREATE OR REPLACE FUNCTION public.ar_receipt_collection(
  p_company_id UUID,
  p_user_id UUID,
  p_scope_mode TEXT,
  p_status TEXT DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_posting_period TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_base_currency CHAR(3);
  v_result JSONB;
BEGIN
  IF p_page IS NULL
    OR p_page < 1
    OR p_page_size IS NULL
    OR p_page_size < 1
    OR p_page_size > 200 THEN
    RAISE EXCEPTION 'BR-9DD-READ-002: invalid pagination';
  END IF;

  v_base_currency := public.ar_9dd_validate_read_scope(
    p_company_id,
    p_user_id,
    p_scope_mode
  );

  WITH scoped_customers AS MATERIALIZED (
    SELECT c.id
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
  filtered AS MATERIALIZED (
    SELECT
      r.*,
      UPPER(TRIM(r.currency::TEXT)) AS summary_currency,
      EXISTS (
        SELECT 1
        FROM public.fx_booking_rate_decisions d
        LEFT JOIN public.exchange_rates source_catalog
          ON source_catalog.id = d.exchange_rate_id
        LEFT JOIN public.fx_reference_rates source_reference
          ON source_reference.id = d.fx_reference_rate_id
        LEFT JOIN public.exchange_rates baseline_catalog
          ON baseline_catalog.id = d.baseline_exchange_rate_id
        LEFT JOIN public.fx_reference_rates baseline_reference
          ON baseline_reference.id = d.baseline_fx_reference_rate_id
        WHERE d.id = r.fx_decision_id
          AND d.company_id = r.company_id
          AND d.company_id = p_company_id
          AND d.receipt_id = r.id
          AND d.invoice_id IS NULL
          AND d.source_category = r.fx_source_category
          AND d.source_category IN (
            'BASE_PARITY',
            'CATALOG',
            'REFERENCE_SELECTED',
            'MANUAL_OVERRIDE'
          )
          AND d.from_currency = r.currency
          AND d.to_currency = r.base_currency
          AND d.transaction_date = r.receipt_date
          -- Both columns are fixed-precision NUMERIC snapshots. Equality is
          -- exact; no tolerance or plausibility heuristic participates.
          AND d.booked_rate = r.exchange_rate::NUMERIC
          AND r.base_amount
            = ROUND(r.receipt_amount * d.booked_rate, 2)
          AND d.stale_reference = false
          AND d.approval_status IN ('NotRequired', 'Approved')
          AND (
            (r.status = 'Draft' AND (
              (d.approval_status = 'NotRequired'
                AND d.lifecycle_status = 'Draft'
                AND d.posted = false
                AND d.posted_at IS NULL)
              OR (d.approval_status = 'Approved'
                AND d.lifecycle_status = 'Approved'
                AND d.posted = false
                AND d.posted_at IS NULL)
            ))
            OR (
              r.status <> 'Draft'
              AND d.lifecycle_status = 'Posted'
              AND d.posted = true
              AND d.posted_at IS NOT NULL
            )
          )
          AND (
            d.approval_status = 'NotRequired'
            OR (
              d.checker_user_id IS NOT NULL
              AND d.checker_user_id IS DISTINCT FROM d.maker_user_id
              AND d.approved_by = d.checker_user_id
              AND d.approved_at IS NOT NULL
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.fx_booking_rate_decisions current_d
            WHERE current_d.receipt_id = r.id
              AND current_d.invoice_id IS NULL
              AND current_d.lifecycle_status <> 'Superseded'
              AND current_d.id <> d.id
          )
          AND CASE d.source_category
            WHEN 'BASE_PARITY' THEN
              r.currency = r.base_currency
              AND r.exchange_rate::NUMERIC = 1.00000000
              AND d.exchange_rate_id IS NULL
              AND d.fx_reference_rate_id IS NULL
              AND d.baseline_kind = 'BASE_PARITY'
              AND d.baseline_rate = 1.00000000
              AND d.baseline_exchange_rate_id IS NULL
              AND d.baseline_fx_reference_rate_id IS NULL
            WHEN 'CATALOG' THEN
              d.exchange_rate_id IS NOT NULL
              AND d.fx_reference_rate_id IS NULL
              AND source_catalog.id = d.exchange_rate_id
              AND source_catalog.company_id = d.company_id
              AND source_catalog.from_currency = d.from_currency
              AND source_catalog.to_currency = d.to_currency
              AND source_catalog.effective_date <= d.transaction_date
              AND source_catalog.rate::NUMERIC = d.booked_rate
              AND d.baseline_kind = 'CATALOG'
              AND d.baseline_exchange_rate_id = d.exchange_rate_id
              AND d.baseline_fx_reference_rate_id IS NULL
              AND d.baseline_rate = d.booked_rate
            WHEN 'REFERENCE_SELECTED' THEN
              d.exchange_rate_id IS NULL
              AND d.fx_reference_rate_id IS NOT NULL
              AND source_reference.id = d.fx_reference_rate_id
              AND source_reference.company_id = d.company_id
              AND source_reference.from_currency = d.from_currency
              AND source_reference.to_currency = d.to_currency
              AND source_reference.effective_date <= d.transaction_date
              AND source_reference.rate = d.booked_rate
              AND d.baseline_kind = 'REFERENCE'
              AND d.baseline_exchange_rate_id IS NULL
              AND d.baseline_fx_reference_rate_id = d.fx_reference_rate_id
              AND d.baseline_rate = d.booked_rate
            WHEN 'MANUAL_OVERRIDE' THEN
              d.exchange_rate_id IS NULL
              AND d.fx_reference_rate_id IS NULL
              AND LENGTH(TRIM(d.override_reason)) >= 5
              AND d.baseline_rate IS NOT NULL
              AND d.suggested_rate IS NOT NULL
              AND d.suggested_rate = d.baseline_rate
              AND (
                (
                  d.baseline_kind = 'CATALOG'
                  AND d.baseline_exchange_rate_id IS NOT NULL
                  AND d.baseline_fx_reference_rate_id IS NULL
                  AND baseline_catalog.id = d.baseline_exchange_rate_id
                  AND baseline_catalog.company_id = d.company_id
                  AND baseline_catalog.from_currency = d.from_currency
                  AND baseline_catalog.to_currency = d.to_currency
                  AND baseline_catalog.effective_date <= d.transaction_date
                  AND baseline_catalog.rate::NUMERIC = d.baseline_rate
                )
                OR (
                  d.baseline_kind = 'REFERENCE'
                  AND d.baseline_exchange_rate_id IS NULL
                  AND d.baseline_fx_reference_rate_id IS NOT NULL
                  AND baseline_reference.id = d.baseline_fx_reference_rate_id
                  AND baseline_reference.company_id = d.company_id
                  AND baseline_reference.from_currency = d.from_currency
                  AND baseline_reference.to_currency = d.to_currency
                  AND baseline_reference.effective_date <= d.transaction_date
                  AND baseline_reference.rate = d.baseline_rate
                )
              )
            ELSE false
          END
      ) AS is_authoritative
    FROM public.receipts r
    JOIN scoped_customers sc ON sc.id = r.customer_id
    WHERE r.company_id = p_company_id
      AND (p_status IS NULL OR r.status = p_status)
      AND (p_customer_id IS NULL OR r.customer_id = p_customer_id)
      AND (p_payment_method IS NULL OR r.payment_method = p_payment_method)
      AND (p_posting_period IS NULL OR r.posting_period = p_posting_period)
      AND (p_date_from IS NULL OR r.receipt_date >= p_date_from)
      AND (p_date_to IS NULL OR r.receipt_date <= p_date_to)
      AND (
        p_search IS NULL
        OR p_search = ''
        OR r.receipt_no ILIKE '%' || p_search || '%'
        OR r.customer_name ILIKE '%' || p_search || '%'
        OR COALESCE(r.reference_no, '') ILIKE '%' || p_search || '%'
      )
  ),
  ranked AS MATERIALIZED (
    SELECT
      f.*,
      ROW_NUMBER() OVER (ORDER BY f.receipt_date DESC, f.id DESC) AS row_no
    FROM filtered f
  ),
  page_rows AS (
    SELECT r.*
    FROM ranked r
    WHERE r.row_no > ((p_page - 1) * p_page_size)
      AND r.row_no <= (p_page * p_page_size)
  ),
  grouped AS MATERIALIZED (
    SELECT
      f.summary_currency AS currency,
      COUNT(*)::BIGINT AS row_count,
      COUNT(*) FILTER (WHERE f.is_authoritative)::BIGINT
        AS authoritative_count,
      COUNT(*) FILTER (WHERE NOT f.is_authoritative)::BIGINT
        AS unavailable_count,
      SUM(f.unallocated_amount)::NUMERIC AS current_amount,
      SUM(ROUND(f.unallocated_amount * f.exchange_rate, 2))
        FILTER (WHERE f.is_authoritative)::NUMERIC AS current_base_amount,
      SUM(f.receipt_amount)::NUMERIC AS document_amount,
      SUM(f.base_amount) FILTER (WHERE f.is_authoritative)::NUMERIC
        AS document_base_amount
    FROM filtered f
    GROUP BY f.summary_currency
  ),
  totals AS (
    SELECT
      COUNT(*)::BIGINT AS row_count,
      COUNT(*) FILTER (WHERE f.is_authoritative)::BIGINT
        AS authoritative_count,
      COUNT(*) FILTER (WHERE NOT f.is_authoritative)::BIGINT
        AS unavailable_count,
      SUM(ROUND(f.unallocated_amount * f.exchange_rate, 2))
        FILTER (WHERE f.is_authoritative)::NUMERIC AS current_base_total,
      SUM(f.base_amount) FILTER (WHERE f.is_authoritative)::NUMERIC
        AS document_base_total
    FROM filtered f
  ),
  grouped_json AS (
    SELECT
      COALESCE(
        JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'currency', g.currency,
            'count', g.row_count,
            'authoritative_document_count', g.authoritative_count,
            'unavailable_count', g.unavailable_count,
            'base_available', g.unavailable_count = 0,
            'current_amount',
              TO_CHAR(ROUND(g.current_amount, 2),
                'FM999999999999999999999999999999990.00'),
            'current_base_amount', CASE
              WHEN g.authoritative_count = 0 THEN NULL
              ELSE TO_CHAR(ROUND(g.current_base_amount, 2),
                'FM999999999999999999999999999999990.00')
            END,
            'document_amount',
              TO_CHAR(ROUND(g.document_amount, 2),
                'FM999999999999999999999999999999990.00'),
            'document_base_amount', CASE
              WHEN g.authoritative_count = 0 THEN NULL
              ELSE TO_CHAR(ROUND(g.document_base_amount, 2),
                'FM999999999999999999999999999999990.00')
            END
          )
          ORDER BY g.currency
        ),
        '[]'::JSONB
      ) AS value,
      COUNT(*)::INTEGER AS currency_count
    FROM grouped g
  ),
  unavailable_json AS (
    SELECT COALESCE(
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'currency', g.currency,
          'document_count', g.unavailable_count
        )
        ORDER BY g.currency
      ) FILTER (WHERE g.unavailable_count > 0),
      '[]'::JSONB
    ) AS value
    FROM grouped g
  )
  SELECT JSONB_BUILD_OBJECT(
    'rows', COALESCE((
      SELECT JSONB_AGG(
        TO_JSONB(pr)
          - 'row_no'
          - 'summary_currency'
          - 'is_authoritative'
        ORDER BY pr.row_no
      )
      FROM page_rows pr
    ), '[]'::JSONB),
    'total', t.row_count,
    'summary', JSONB_BUILD_OBJECT(
      'current_balance_summary', JSONB_BUILD_OBJECT(
        'row_count', t.row_count,
        'matching_document_count', t.row_count,
        'authoritative_document_count', t.authoritative_count,
        'unavailable_count', t.unavailable_count,
        'base_available', t.unavailable_count = 0,
        'amount_basis', 'current_unallocated',
        'base_currency', UPPER(TRIM(v_base_currency::TEXT)),
        'base_total', CASE
          WHEN t.row_count = 0 THEN '0.00'
          WHEN t.authoritative_count = 0 THEN NULL
          ELSE TO_CHAR(ROUND(t.current_base_total, 2),
            'FM999999999999999999999999999999990.00')
        END,
        'by_currency', COALESCE((
          SELECT JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'currency', item->>'currency',
              'amount', item->>'current_amount',
              'base_amount', item->'current_base_amount',
              'count', (item->>'count')::BIGINT,
              'authoritative_document_count',
                (item->>'authoritative_document_count')::BIGINT,
              'unavailable_count', (item->>'unavailable_count')::BIGINT,
              'base_available', (item->>'base_available')::BOOLEAN
            )
            ORDER BY item->>'currency'
          )
          FROM JSONB_ARRAY_ELEMENTS(gj.value) AS element(item)
        ), '[]'::JSONB),
        'unavailable_by_currency', uj.value,
        'meta', JSONB_BUILD_OBJECT(
          'contract_version', 2,
          'base_currency', UPPER(TRIM(v_base_currency::TEXT)),
          'multi_currency', gj.currency_count > 1,
          'normalization_basis', 'current_balance_x_booked_rate',
          'authority_basis', 'current_consistent_booked_fx_decision'
        )
      ),
      'document_total_summary', JSONB_BUILD_OBJECT(
        'row_count', t.row_count,
        'matching_document_count', t.row_count,
        'authoritative_document_count', t.authoritative_count,
        'unavailable_count', t.unavailable_count,
        'base_available', t.unavailable_count = 0,
        'amount_basis', 'original_document_total',
        'base_currency', UPPER(TRIM(v_base_currency::TEXT)),
        'base_total', CASE
          WHEN t.row_count = 0 THEN '0.00'
          WHEN t.authoritative_count = 0 THEN NULL
          ELSE TO_CHAR(ROUND(t.document_base_total, 2),
            'FM999999999999999999999999999999990.00')
        END,
        'by_currency', COALESCE((
          SELECT JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'currency', item->>'currency',
              'amount', item->>'document_amount',
              'base_amount', item->'document_base_amount',
              'count', (item->>'count')::BIGINT,
              'authoritative_document_count',
                (item->>'authoritative_document_count')::BIGINT,
              'unavailable_count', (item->>'unavailable_count')::BIGINT,
              'base_available', (item->>'base_available')::BOOLEAN
            )
            ORDER BY item->>'currency'
          )
          FROM JSONB_ARRAY_ELEMENTS(gj.value) AS element(item)
        ), '[]'::JSONB),
        'unavailable_by_currency', uj.value,
        'meta', JSONB_BUILD_OBJECT(
          'contract_version', 2,
          'base_currency', UPPER(TRIM(v_base_currency::TEXT)),
          'multi_currency', gj.currency_count > 1,
          'normalization_basis', 'original_booked_base_snapshot',
          'authority_basis', 'current_consistent_booked_fx_decision'
        )
      )
    )
  )
    INTO v_result
  FROM totals t
  CROSS JOIN grouped_json gj
  CROSS JOIN unavailable_json uj;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.ar_receipt_collection(
  UUID,
  UUID,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TEXT,
  DATE,
  DATE,
  TEXT,
  INTEGER,
  INTEGER
) OWNER TO postgres;

COMMENT ON FUNCTION public.ar_receipt_collection(
  UUID,
  UUID,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TEXT,
  DATE,
  DATE,
  TEXT,
  INTEGER,
  INTEGER
) IS
  'Caller-context Receipt collection with Gate D v2 provenance-aware totals. '
  'No transaction snapshot or financial row is changed.';

REVOKE ALL ON FUNCTION public.ar_receipt_collection(
  UUID,
  UUID,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TEXT,
  DATE,
  DATE,
  TEXT,
  INTEGER,
  INTEGER
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.ar_receipt_collection(
  UUID,
  UUID,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TEXT,
  DATE,
  DATE,
  TEXT,
  INTEGER,
  INTEGER
) TO authenticated;

COMMIT;
