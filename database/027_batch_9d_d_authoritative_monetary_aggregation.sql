-- ============================================================================
-- Batch 9D-D: authoritative monetary aggregation and statement snapshots
--
-- Read-only, authenticated caller-context RPCs. Each function binds the Edge
-- supplied user identifier to auth.uid(), verifies company membership and role,
-- and runs as SECURITY INVOKER so existing RLS remains authoritative. Aggregation
-- happens inside PostgreSQL and is not subject to the PostgREST max_rows cap.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.ar_9dd_validate_read_scope(
  p_company_id UUID,
  p_user_id UUID,
  p_scope_mode TEXT
)
RETURNS CHAR(3)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_base_currency CHAR(3);
  v_authenticated_user_id UUID := (SELECT auth.uid());
BEGIN
  IF p_company_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'BR-9DD-READ-001: company_id and user_id are required';
  END IF;

  IF v_authenticated_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH: authenticated caller is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS DISTINCT FROM v_authenticated_user_id THEN
    RAISE EXCEPTION 'AUTH: user context does not match authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF p_scope_mode IS NULL OR p_scope_mode NOT IN ('assigned', 'company') THEN
    RAISE EXCEPTION 'BR-9DD-READ-001: scope_mode must be assigned or company';
  END IF;

  SELECT c.base_currency
    INTO v_base_currency
  FROM public.companies c
  WHERE c.id = p_company_id
    AND c.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: active company not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.company_id = p_company_id
      AND ur.is_active = true
      AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
  ) THEN
    RAISE EXCEPTION 'AUTH: operational read role is required'
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
    RAISE EXCEPTION 'AUTH: company-wide read scope is not permitted'
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
    RAISE EXCEPTION 'AUTH: assigned-customer scope requires AR Clerk role'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_base_currency;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ar_aging_summary(
  p_company_id UUID,
  p_user_id UUID,
  p_scope_mode TEXT,
  p_as_of_date DATE DEFAULT CURRENT_DATE
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
  v_result JSONB;
BEGIN
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
  classified AS MATERIALIZED (
    SELECT
      i.id,
      i.customer_id,
      i.currency,
      i.outstanding,
      ROUND(i.outstanding * i.exchange_rate, 2) AS outstanding_base,
      CASE
        WHEN i.due_date IS NULL OR i.due_date >= v_as_of_date THEN 'current'
        WHEN (v_as_of_date - i.due_date) BETWEEN 1 AND 30 THEN '1_30'
        WHEN (v_as_of_date - i.due_date) BETWEEN 31 AND 60 THEN '31_60'
        WHEN (v_as_of_date - i.due_date) BETWEEN 61 AND 90 THEN '61_90'
        ELSE 'over_90'
      END AS bucket_key
    FROM public.invoices i
    JOIN scoped_customers sc ON sc.id = i.customer_id
    WHERE i.company_id = p_company_id
      AND i.status IN ('Open', 'Overdue', 'Partially Paid')
      AND i.doc_type IN ('Invoice', 'Debit Note')
      AND i.outstanding > 0
  ),
  currency_grouped AS (
    SELECT
      c.currency,
      COUNT(*)::BIGINT AS row_count,
      SUM(c.outstanding)::NUMERIC AS amount,
      SUM(c.outstanding_base)::NUMERIC AS base_amount
    FROM classified c
    GROUP BY c.currency
  ),
  bucket_definitions AS (
    SELECT *
    FROM (
      VALUES
        ('current'::TEXT, 'Current'::TEXT, 0, 0, 0),
        ('1_30'::TEXT, '1-30'::TEXT, 1, 30, 1),
        ('31_60'::TEXT, '31-60'::TEXT, 31, 60, 2),
        ('61_90'::TEXT, '61-90'::TEXT, 61, 90, 3),
        ('over_90'::TEXT, 'Over 90'::TEXT, 91, NULL::INTEGER, 4)
    ) d(bucket_key, bucket_name, from_days, to_days, sort_order)
  ),
  bucket_grouped AS (
    SELECT
      c.bucket_key,
      COUNT(*)::BIGINT AS invoice_count,
      SUM(c.outstanding_base)::NUMERIC AS base_total
    FROM classified c
    GROUP BY c.bucket_key
  ),
  bucket_currency_grouped AS (
    SELECT
      c.bucket_key,
      c.currency,
      COUNT(*)::BIGINT AS row_count,
      SUM(c.outstanding)::NUMERIC AS amount,
      SUM(c.outstanding_base)::NUMERIC AS base_amount
    FROM classified c
    GROUP BY c.bucket_key, c.currency
  ),
  totals AS (
    SELECT
      COUNT(DISTINCT c.customer_id)::BIGINT AS total_customers,
      COALESCE(SUM(c.outstanding_base), 0)::NUMERIC AS total_outstanding,
      COALESCE(SUM(c.outstanding_base) FILTER (WHERE c.bucket_key <> 'current'), 0)::NUMERIC AS total_overdue,
      COUNT(*)::BIGINT AS row_count
    FROM classified c
  )
  SELECT JSONB_BUILD_OBJECT(
    'total_customers', t.total_customers,
    'total_outstanding', t.total_outstanding,
    'total_overdue', t.total_overdue,
    'overdue_percentage', CASE
      WHEN t.total_outstanding > 0 THEN ROUND(t.total_overdue / t.total_outstanding * 100, 2)
      ELSE 0
    END,
    'base_total', t.total_outstanding,
    'base_currency', v_base_currency,
    'by_currency', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'currency', cg.currency,
          'amount', cg.amount,
          'base_amount', cg.base_amount,
          'count', cg.row_count
        )
        ORDER BY cg.currency
      )
      FROM currency_grouped cg
    ), '[]'::JSONB),
    'meta', JSONB_BUILD_OBJECT(
      'base_currency', v_base_currency,
      'multi_currency', (SELECT COUNT(*) FROM currency_grouped) > 1,
      'normalization_basis', 'current_balance_x_booked_rate'
    ),
    'aging_summary', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'bucket_name', bd.bucket_name,
          'from_days', bd.from_days,
          'to_days', bd.to_days,
          'invoice_count', COALESCE(bg.invoice_count, 0),
          'total_outstanding', COALESCE(bg.base_total, 0),
          'base_total', COALESCE(bg.base_total, 0),
          'base_currency', v_base_currency,
          'by_currency', COALESCE((
            SELECT JSONB_AGG(
              JSONB_BUILD_OBJECT(
                'currency', bcg.currency,
                'amount', bcg.amount,
                'base_amount', bcg.base_amount,
                'count', bcg.row_count
              )
              ORDER BY bcg.currency
            )
            FROM bucket_currency_grouped bcg
            WHERE bcg.bucket_key = bd.bucket_key
          ), '[]'::JSONB),
          'normalization_basis', 'current_balance_x_booked_rate',
          'percentage', CASE
            WHEN t.total_outstanding > 0
              THEN ROUND(COALESCE(bg.base_total, 0) / t.total_outstanding * 100, 2)
            ELSE 0
          END
        )
        ORDER BY bd.sort_order
      )
      FROM bucket_definitions bd
      LEFT JOIN bucket_grouped bg ON bg.bucket_key = bd.bucket_key
    ), '[]'::JSONB)
  )
  INTO v_result
  FROM totals t;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ar_aging_by_customer(
  p_company_id UUID,
  p_user_id UUID,
  p_scope_mode TEXT,
  p_as_of_date DATE DEFAULT CURRENT_DATE,
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
  v_as_of_date DATE := COALESCE(p_as_of_date, CURRENT_DATE);
  v_result JSONB;
BEGIN
  IF p_page IS NULL OR p_page < 1 OR p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 200 THEN
    RAISE EXCEPTION 'BR-9DD-READ-002: invalid pagination';
  END IF;

  v_base_currency := public.ar_9dd_validate_read_scope(
    p_company_id,
    p_user_id,
    p_scope_mode
  );

  WITH scoped_customers AS MATERIALIZED (
    SELECT
      c.id,
      c.customer_id AS customer_code,
      c.customer_name,
      c.credit_limit,
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
  classified AS MATERIALIZED (
    SELECT
      sc.id AS customer_id,
      sc.customer_code,
      sc.customer_name,
      sc.credit_limit,
      sc.credit_rating,
      i.currency,
      i.outstanding,
      ROUND(i.outstanding * i.exchange_rate, 2) AS outstanding_base,
      CASE
        WHEN i.due_date IS NULL OR i.due_date >= v_as_of_date THEN 'current'
        WHEN (v_as_of_date - i.due_date) BETWEEN 1 AND 30 THEN '1_30'
        WHEN (v_as_of_date - i.due_date) BETWEEN 31 AND 60 THEN '31_60'
        WHEN (v_as_of_date - i.due_date) BETWEEN 61 AND 90 THEN '61_90'
        ELSE 'over_90'
      END AS bucket_key
    FROM scoped_customers sc
    JOIN public.invoices i ON i.customer_id = sc.id
    WHERE i.company_id = p_company_id
      AND i.status IN ('Open', 'Overdue', 'Partially Paid')
      AND i.doc_type IN ('Invoice', 'Debit Note')
      AND i.outstanding > 0
  ),
  customer_grouped AS MATERIALIZED (
    SELECT
      c.customer_id,
      c.customer_code,
      c.customer_name,
      c.credit_limit,
      c.credit_rating,
      SUM(c.outstanding_base)::NUMERIC AS base_total,
      COALESCE(SUM(c.outstanding_base) FILTER (WHERE c.bucket_key = 'current'), 0)::NUMERIC AS current_amount,
      COALESCE(SUM(c.outstanding_base) FILTER (WHERE c.bucket_key = '1_30'), 0)::NUMERIC AS bucket_1_30,
      COALESCE(SUM(c.outstanding_base) FILTER (WHERE c.bucket_key = '31_60'), 0)::NUMERIC AS bucket_31_60,
      COALESCE(SUM(c.outstanding_base) FILTER (WHERE c.bucket_key = '61_90'), 0)::NUMERIC AS bucket_61_90,
      COALESCE(SUM(c.outstanding_base) FILTER (WHERE c.bucket_key = 'over_90'), 0)::NUMERIC AS bucket_over_90
    FROM classified c
    GROUP BY c.customer_id, c.customer_code, c.customer_name, c.credit_limit, c.credit_rating
  ),
  currency_grouped AS MATERIALIZED (
    SELECT
      c.customer_id,
      c.currency,
      COUNT(*)::BIGINT AS row_count,
      SUM(c.outstanding)::NUMERIC AS amount,
      SUM(c.outstanding_base)::NUMERIC AS base_amount
    FROM classified c
    GROUP BY c.customer_id, c.currency
  ),
  ranked AS MATERIALIZED (
    SELECT
      cg.*,
      ROW_NUMBER() OVER (ORDER BY cg.base_total DESC, cg.customer_name, cg.customer_id) AS row_no
    FROM customer_grouped cg
    WHERE cg.base_total > 0
  ),
  total_rows AS (
    SELECT COUNT(*)::BIGINT AS total
    FROM ranked
  ),
  page_rows AS (
    SELECT r.*
    FROM ranked r
    WHERE r.row_no > ((p_page - 1) * p_page_size)
      AND r.row_no <= (p_page * p_page_size)
  )
  SELECT JSONB_BUILD_OBJECT(
    'rows', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'customer_id', pr.customer_id,
          'customer_name', pr.customer_name,
          'customer_code', pr.customer_code,
          'credit_limit', pr.credit_limit,
          'credit_rating', pr.credit_rating,
          'total_outstanding', pr.base_total,
          'base_total', pr.base_total,
          'base_currency', v_base_currency,
          'by_currency', COALESCE((
            SELECT JSONB_AGG(
              JSONB_BUILD_OBJECT(
                'currency', cg.currency,
                'amount', cg.amount,
                'base_amount', cg.base_amount,
                'count', cg.row_count
              )
              ORDER BY cg.currency
            )
            FROM currency_grouped cg
            WHERE cg.customer_id = pr.customer_id
          ), '[]'::JSONB),
          'meta', JSONB_BUILD_OBJECT(
            'base_currency', v_base_currency,
            'multi_currency', (
              SELECT COUNT(*) FROM currency_grouped cg WHERE cg.customer_id = pr.customer_id
            ) > 1,
            'normalization_basis', 'current_balance_x_booked_rate'
          ),
          'current_amount', pr.current_amount,
          'bucket_1_30', pr.bucket_1_30,
          'bucket_31_60', pr.bucket_31_60,
          'bucket_61_90', pr.bucket_61_90,
          'bucket_over_90', pr.bucket_over_90
        )
        ORDER BY pr.row_no
      )
      FROM page_rows pr
    ), '[]'::JSONB),
    'total', tr.total
  )
  INTO v_result
  FROM total_rows tr;

  RETURN v_result;
END;
$function$;

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
  IF p_page IS NULL OR p_page < 1 OR p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 200 THEN
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
      ROUND(i.outstanding * i.exchange_rate, 2) AS outstanding_base
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
  grouped AS (
    SELECT
      f.currency,
      COUNT(*)::BIGINT AS row_count,
      COALESCE(SUM(f.outstanding), 0)::NUMERIC AS current_amount,
      COALESCE(SUM(f.outstanding_base), 0)::NUMERIC AS current_base_amount,
      COALESCE(SUM(f.total_amount), 0)::NUMERIC AS document_amount,
      COALESCE(SUM(f.base_total), 0)::NUMERIC AS document_base_amount
    FROM filtered f
    GROUP BY f.currency
  ),
  totals AS (
    SELECT
      COUNT(*)::BIGINT AS row_count,
      COALESCE(SUM(f.outstanding_base), 0)::NUMERIC AS current_base_total,
      COALESCE(SUM(f.base_total), 0)::NUMERIC AS document_base_total
    FROM filtered f
  ),
  grouped_json AS (
    SELECT
      COALESCE(
        JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'currency', g.currency,
            'count', g.row_count,
            'current_amount', g.current_amount,
            'current_base_amount', g.current_base_amount,
            'document_amount', g.document_amount,
            'document_base_amount', g.document_base_amount
          )
          ORDER BY g.currency
        ),
        '[]'::JSONB
      ) AS value,
      COUNT(*)::INTEGER AS currency_count
    FROM grouped g
  )
  SELECT JSONB_BUILD_OBJECT(
    'rows', COALESCE((
      SELECT JSONB_AGG(TO_JSONB(pr) - 'row_no' - 'outstanding_base' ORDER BY pr.row_no)
      FROM page_rows pr
    ), '[]'::JSONB),
    'total', t.row_count,
    'summary', JSONB_BUILD_OBJECT(
      'current_balance_summary', JSONB_BUILD_OBJECT(
        'row_count', t.row_count,
        'amount_basis', 'current_outstanding',
        'base_total', t.current_base_total,
        'base_currency', v_base_currency,
        'by_currency', COALESCE((
          SELECT JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'currency', item->>'currency',
              'amount', (item->>'current_amount')::NUMERIC,
              'base_amount', (item->>'current_base_amount')::NUMERIC,
              'count', (item->>'count')::BIGINT
            )
            ORDER BY item->>'currency'
          )
          FROM JSONB_ARRAY_ELEMENTS(gj.value) AS element(item)
        ), '[]'::JSONB),
        'meta', JSONB_BUILD_OBJECT(
          'base_currency', v_base_currency,
          'multi_currency', gj.currency_count > 1,
          'normalization_basis', 'current_balance_x_booked_rate'
        )
      ),
      'document_total_summary', JSONB_BUILD_OBJECT(
        'row_count', t.row_count,
        'amount_basis', 'original_document_total',
        'base_total', t.document_base_total,
        'base_currency', v_base_currency,
        'by_currency', COALESCE((
          SELECT JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'currency', item->>'currency',
              'amount', (item->>'document_amount')::NUMERIC,
              'base_amount', (item->>'document_base_amount')::NUMERIC,
              'count', (item->>'count')::BIGINT
            )
            ORDER BY item->>'currency'
          )
          FROM JSONB_ARRAY_ELEMENTS(gj.value) AS element(item)
        ), '[]'::JSONB),
        'meta', JSONB_BUILD_OBJECT(
          'base_currency', v_base_currency,
          'multi_currency', gj.currency_count > 1,
          'normalization_basis', 'original_booked_base_snapshot'
        )
      )
    )
  )
  INTO v_result
  FROM totals t
  CROSS JOIN grouped_json gj;

  RETURN v_result;
END;
$function$;

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
  IF p_page IS NULL OR p_page < 1 OR p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 200 THEN
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
      ROUND(r.unallocated_amount * r.exchange_rate, 2) AS unallocated_base
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
  grouped AS (
    SELECT
      f.currency,
      COUNT(*)::BIGINT AS row_count,
      COALESCE(SUM(f.unallocated_amount), 0)::NUMERIC AS current_amount,
      COALESCE(SUM(f.unallocated_base), 0)::NUMERIC AS current_base_amount,
      COALESCE(SUM(f.receipt_amount), 0)::NUMERIC AS document_amount,
      COALESCE(SUM(f.base_amount), 0)::NUMERIC AS document_base_amount
    FROM filtered f
    GROUP BY f.currency
  ),
  totals AS (
    SELECT
      COUNT(*)::BIGINT AS row_count,
      COALESCE(SUM(f.unallocated_base), 0)::NUMERIC AS current_base_total,
      COALESCE(SUM(f.base_amount), 0)::NUMERIC AS document_base_total
    FROM filtered f
  ),
  grouped_json AS (
    SELECT
      COALESCE(
        JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'currency', g.currency,
            'count', g.row_count,
            'current_amount', g.current_amount,
            'current_base_amount', g.current_base_amount,
            'document_amount', g.document_amount,
            'document_base_amount', g.document_base_amount
          )
          ORDER BY g.currency
        ),
        '[]'::JSONB
      ) AS value,
      COUNT(*)::INTEGER AS currency_count
    FROM grouped g
  )
  SELECT JSONB_BUILD_OBJECT(
    'rows', COALESCE((
      SELECT JSONB_AGG(TO_JSONB(pr) - 'row_no' - 'unallocated_base' ORDER BY pr.row_no)
      FROM page_rows pr
    ), '[]'::JSONB),
    'total', t.row_count,
    'summary', JSONB_BUILD_OBJECT(
      'current_balance_summary', JSONB_BUILD_OBJECT(
        'row_count', t.row_count,
        'amount_basis', 'current_unallocated',
        'base_total', t.current_base_total,
        'base_currency', v_base_currency,
        'by_currency', COALESCE((
          SELECT JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'currency', item->>'currency',
              'amount', (item->>'current_amount')::NUMERIC,
              'base_amount', (item->>'current_base_amount')::NUMERIC,
              'count', (item->>'count')::BIGINT
            )
            ORDER BY item->>'currency'
          )
          FROM JSONB_ARRAY_ELEMENTS(gj.value) AS element(item)
        ), '[]'::JSONB),
        'meta', JSONB_BUILD_OBJECT(
          'base_currency', v_base_currency,
          'multi_currency', gj.currency_count > 1,
          'normalization_basis', 'current_balance_x_booked_rate'
        )
      ),
      'document_total_summary', JSONB_BUILD_OBJECT(
        'row_count', t.row_count,
        'amount_basis', 'original_document_total',
        'base_total', t.document_base_total,
        'base_currency', v_base_currency,
        'by_currency', COALESCE((
          SELECT JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'currency', item->>'currency',
              'amount', (item->>'document_amount')::NUMERIC,
              'base_amount', (item->>'document_base_amount')::NUMERIC,
              'count', (item->>'count')::BIGINT
            )
            ORDER BY item->>'currency'
          )
          FROM JSONB_ARRAY_ELEMENTS(gj.value) AS element(item)
        ), '[]'::JSONB),
        'meta', JSONB_BUILD_OBJECT(
          'base_currency', v_base_currency,
          'multi_currency', gj.currency_count > 1,
          'normalization_basis', 'original_booked_base_snapshot'
        )
      )
    )
  )
  INTO v_result
  FROM totals t
  CROSS JOIN grouped_json gj;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ar_customer_statement(
  p_company_id UUID,
  p_user_id UUID,
  p_scope_mode TEXT,
  p_customer_id UUID,
  p_period_from DATE,
  p_period_to DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_base_currency CHAR(3);
  v_customer_name TEXT;
  v_customer_code TEXT;
  v_customer_address TEXT;
  v_result JSONB;
BEGIN
  IF p_customer_id IS NULL OR p_period_from IS NULL OR p_period_to IS NULL THEN
    RAISE EXCEPTION 'BR-9DD-READ-003: customer and statement period are required';
  END IF;
  IF p_period_to < p_period_from THEN
    RAISE EXCEPTION 'BR-9DD-READ-003: period_to must not precede period_from';
  END IF;

  v_base_currency := public.ar_9dd_validate_read_scope(
    p_company_id,
    p_user_id,
    p_scope_mode
  );

  SELECT
    c.customer_name,
    c.customer_id,
    CONCAT_WS(', ',
      NULLIF(c.bill_addr_line1, ''),
      NULLIF(c.bill_addr_line2, ''),
      NULLIF(c.bill_city, ''),
      NULLIF(c.bill_state, ''),
      NULLIF(c.bill_postal, ''),
      NULLIF(c.bill_country, '')
    )
  INTO v_customer_name, v_customer_code, v_customer_address
  FROM public.customers c
  WHERE c.id = p_customer_id
    AND c.company_id = p_company_id
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
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: customer not found';
  END IF;

  WITH opening_movements AS MATERIALIZED (
    SELECT
      i.currency,
      CASE WHEN i.doc_type = 'Credit Note' THEN 0::NUMERIC ELSE i.total_amount END AS debit,
      CASE WHEN i.doc_type = 'Credit Note' THEN i.total_amount ELSE 0::NUMERIC END AS credit,
      CASE WHEN i.doc_type = 'Credit Note' THEN 0::NUMERIC ELSE i.base_total END AS base_debit,
      CASE WHEN i.doc_type = 'Credit Note' THEN i.base_total ELSE 0::NUMERIC END AS base_credit
    FROM public.invoices i
    WHERE i.company_id = p_company_id
      AND i.customer_id = p_customer_id
      AND i.status NOT IN ('Draft', 'Cancelled')
      AND i.invoice_date < p_period_from

    UNION ALL

    SELECT
      r.currency,
      0::NUMERIC AS debit,
      r.receipt_amount AS credit,
      0::NUMERIC AS base_debit,
      r.base_amount AS base_credit
    FROM public.receipts r
    WHERE r.company_id = p_company_id
      AND r.customer_id = p_customer_id
      AND r.status NOT IN ('Draft', 'Cancelled', 'Bounced')
      AND r.receipt_date < p_period_from
  ),
  period_movements AS MATERIALIZED (
    SELECT
      i.id AS sort_id,
      i.invoice_date AS movement_date,
      i.doc_type,
      i.invoice_no AS doc_no,
      i.doc_type || ': ' || i.invoice_no AS description,
      i.currency,
      i.exchange_rate,
      CASE WHEN i.doc_type = 'Credit Note' THEN 0::NUMERIC ELSE i.total_amount END AS debit,
      CASE WHEN i.doc_type = 'Credit Note' THEN i.total_amount ELSE 0::NUMERIC END AS credit,
      CASE WHEN i.doc_type = 'Credit Note' THEN 0::NUMERIC ELSE i.base_total END AS base_debit,
      CASE WHEN i.doc_type = 'Credit Note' THEN i.base_total ELSE 0::NUMERIC END AS base_credit
    FROM public.invoices i
    WHERE i.company_id = p_company_id
      AND i.customer_id = p_customer_id
      AND i.status NOT IN ('Draft', 'Cancelled')
      AND i.invoice_date >= p_period_from
      AND i.invoice_date <= p_period_to

    UNION ALL

    SELECT
      r.id AS sort_id,
      r.receipt_date AS movement_date,
      'Receipt'::TEXT AS doc_type,
      r.receipt_no AS doc_no,
      'Receipt: ' || r.receipt_no || ' (' || r.payment_method || ')' AS description,
      r.currency,
      r.exchange_rate,
      0::NUMERIC AS debit,
      r.receipt_amount AS credit,
      0::NUMERIC AS base_debit,
      r.base_amount AS base_credit
    FROM public.receipts r
    WHERE r.company_id = p_company_id
      AND r.customer_id = p_customer_id
      AND r.status NOT IN ('Draft', 'Cancelled', 'Bounced')
      AND r.receipt_date >= p_period_from
      AND r.receipt_date <= p_period_to
  ),
  all_currency_movements AS (
    SELECT om.currency, om.debit, om.credit, true AS is_opening
    FROM opening_movements om
    UNION ALL
    SELECT pm.currency, pm.debit, pm.credit, false AS is_opening
    FROM period_movements pm
  ),
  currency_grouped AS (
    SELECT
      acm.currency,
      COALESCE(SUM(acm.debit - acm.credit) FILTER (WHERE acm.is_opening), 0)::NUMERIC AS opening_balance,
      COALESCE(SUM(acm.debit) FILTER (WHERE NOT acm.is_opening), 0)::NUMERIC AS total_debit,
      COALESCE(SUM(acm.credit) FILTER (WHERE NOT acm.is_opening), 0)::NUMERIC AS total_credit,
      COALESCE(SUM(acm.debit - acm.credit), 0)::NUMERIC AS closing_balance
    FROM all_currency_movements acm
    GROUP BY acm.currency
  ),
  stats AS (
    SELECT
      COALESCE((SELECT SUM(om.debit - om.credit) FROM opening_movements om), 0)::NUMERIC AS opening_balance,
      COALESCE((SELECT SUM(om.base_debit - om.base_credit) FROM opening_movements om), 0)::NUMERIC AS opening_balance_base,
      COALESCE((SELECT SUM(pm.debit) FROM period_movements pm), 0)::NUMERIC AS total_debit,
      COALESCE((SELECT SUM(pm.credit) FROM period_movements pm), 0)::NUMERIC AS total_credit,
      COALESCE((SELECT SUM(pm.base_debit) FROM period_movements pm), 0)::NUMERIC AS total_debit_base,
      COALESCE((SELECT SUM(pm.base_credit) FROM period_movements pm), 0)::NUMERIC AS total_credit_base,
      (SELECT COUNT(*)::INTEGER FROM currency_grouped) AS currency_count
  ),
  ordered_lines AS (
    SELECT
      pm.*,
      s.opening_balance
        + SUM(pm.debit - pm.credit) OVER (
            ORDER BY pm.movement_date, pm.doc_no, pm.sort_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS transaction_running_balance,
      s.opening_balance_base
        + SUM(pm.base_debit - pm.base_credit) OVER (
            ORDER BY pm.movement_date, pm.doc_no, pm.sort_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS base_running_balance,
      s.currency_count
    FROM period_movements pm
    CROSS JOIN stats s
  )
  SELECT JSONB_BUILD_OBJECT(
    'customer_id', p_customer_id,
    'customer_name', v_customer_name,
    'customer_code', v_customer_code,
    'address', v_customer_address,
    'period_from', p_period_from,
    'period_to', p_period_to,
    'opening_balance', CASE WHEN s.currency_count <= 1 THEN s.opening_balance ELSE NULL END,
    'lines', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'date', ol.movement_date,
          'doc_type', ol.doc_type,
          'doc_no', ol.doc_no,
          'description', ol.description,
          'currency', ol.currency,
          'exchange_rate', ol.exchange_rate,
          'transaction_debit', ol.debit,
          'transaction_credit', ol.credit,
          'transaction_balance', CASE WHEN ol.currency_count <= 1 THEN ol.transaction_running_balance ELSE NULL END,
          'debit', ol.debit,
          'credit', ol.credit,
          'balance', CASE WHEN ol.currency_count <= 1 THEN ol.transaction_running_balance ELSE NULL END,
          'base_currency', v_base_currency,
          'base_debit', ol.base_debit,
          'base_credit', ol.base_credit,
          'base_balance', ol.base_running_balance,
          'amount_basis', 'stored_booked_base_snapshot'
        )
        ORDER BY ol.movement_date, ol.doc_no, ol.sort_id
      )
      FROM ordered_lines ol
    ), '[]'::JSONB),
    'closing_balance', CASE
      WHEN s.currency_count <= 1 THEN s.opening_balance + s.total_debit - s.total_credit
      ELSE NULL
    END,
    'total_debit', CASE WHEN s.currency_count <= 1 THEN s.total_debit ELSE NULL END,
    'total_credit', CASE WHEN s.currency_count <= 1 THEN s.total_credit ELSE NULL END,
    'base_currency', v_base_currency,
    'opening_balance_base', s.opening_balance_base,
    'closing_balance_base', s.opening_balance_base + s.total_debit_base - s.total_credit_base,
    'total_debit_base', s.total_debit_base,
    'total_credit_base', s.total_credit_base,
    'by_currency', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'currency', cg.currency,
          'opening_balance', cg.opening_balance,
          'total_debit', cg.total_debit,
          'total_credit', cg.total_credit,
          'closing_balance', cg.closing_balance
        )
        ORDER BY cg.currency
      )
      FROM currency_grouped cg
    ), '[]'::JSONB),
    'meta', JSONB_BUILD_OBJECT(
      'base_currency', v_base_currency,
      'multi_currency', s.currency_count > 1,
      'normalization_basis', 'stored_booked_base_snapshot'
    ),
    'legacy_amount_basis', 'transaction_currency_legacy',
    'legacy_transaction_fields_valid', s.currency_count <= 1,
    'legacy_transaction_currency', CASE
      WHEN s.currency_count <= 1 THEN (SELECT cg.currency FROM currency_grouped cg LIMIT 1)
      ELSE NULL
    END
  )
  INTO v_result
  FROM stats s;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.ar_9dd_validate_read_scope(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_9dd_validate_read_scope(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.ar_9dd_validate_read_scope(UUID, UUID, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_9dd_validate_read_scope(UUID, UUID, TEXT) FROM service_role;
GRANT EXECUTE ON FUNCTION public.ar_9dd_validate_read_scope(UUID, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.ar_invoice_collection(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_invoice_collection(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.ar_invoice_collection(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_invoice_collection(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) FROM service_role;
GRANT EXECUTE ON FUNCTION public.ar_invoice_collection(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.ar_receipt_collection(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_receipt_collection(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.ar_receipt_collection(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_receipt_collection(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) FROM service_role;
GRANT EXECUTE ON FUNCTION public.ar_receipt_collection(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.ar_aging_summary(UUID, UUID, TEXT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_aging_summary(UUID, UUID, TEXT, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.ar_aging_summary(UUID, UUID, TEXT, DATE) FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_aging_summary(UUID, UUID, TEXT, DATE) FROM service_role;
GRANT EXECUTE ON FUNCTION public.ar_aging_summary(UUID, UUID, TEXT, DATE) TO authenticated;

REVOKE ALL ON FUNCTION public.ar_aging_by_customer(UUID, UUID, TEXT, DATE, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_aging_by_customer(UUID, UUID, TEXT, DATE, INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.ar_aging_by_customer(UUID, UUID, TEXT, DATE, INTEGER, INTEGER) FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_aging_by_customer(UUID, UUID, TEXT, DATE, INTEGER, INTEGER) FROM service_role;
GRANT EXECUTE ON FUNCTION public.ar_aging_by_customer(UUID, UUID, TEXT, DATE, INTEGER, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.ar_customer_statement(UUID, UUID, TEXT, UUID, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ar_customer_statement(UUID, UUID, TEXT, UUID, DATE, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.ar_customer_statement(UUID, UUID, TEXT, UUID, DATE, DATE) FROM authenticated;
REVOKE ALL ON FUNCTION public.ar_customer_statement(UUID, UUID, TEXT, UUID, DATE, DATE) FROM service_role;
GRANT EXECUTE ON FUNCTION public.ar_customer_statement(UUID, UUID, TEXT, UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.ar_9dd_validate_read_scope(UUID, UUID, TEXT) IS
  'Batch 9D-D authenticated caller scope validator; binds p_user_id to auth.uid() and verifies company/role scope.';
COMMENT ON FUNCTION public.ar_invoice_collection(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) IS
  'Batch 9D-D authenticated caller-context invoice page, total, and complete-set summaries from one SQL invocation and snapshot.';
COMMENT ON FUNCTION public.ar_receipt_collection(UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT, DATE, DATE, TEXT, INTEGER, INTEGER) IS
  'Batch 9D-D authenticated caller-context receipt page, total, and complete-set summaries from one SQL invocation and snapshot.';
COMMENT ON FUNCTION public.ar_aging_summary(UUID, UUID, TEXT, DATE) IS
  'Batch 9D-D read-only complete-set aging summary in company base currency with per-currency grouping.';
COMMENT ON FUNCTION public.ar_aging_by_customer(UUID, UUID, TEXT, DATE, INTEGER, INTEGER) IS
  'Batch 9D-D read-only paginated customer aging contract; all aggregation occurs before pagination.';
COMMENT ON FUNCTION public.ar_customer_statement(UUID, UUID, TEXT, UUID, DATE, DATE) IS
  'Batch 9D-D read-only customer statement using immutable stored base_total/base_amount snapshots.';

COMMIT;
