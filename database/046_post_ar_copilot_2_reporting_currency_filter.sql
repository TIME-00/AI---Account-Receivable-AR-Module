-- AR Copilot 2 Gate 1: bounded, caller-authorized report row authority.
-- Currency/minimum filters and allow-listed sorting execute before LIMIT.
-- No financial or business row is mutated.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_invoices_company_currency_outstanding_report
  ON public.invoices (
    company_id,
    currency,
    outstanding DESC,
    invoice_date DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS idx_receipts_company_currency_unallocated_report
  ON public.receipts (
    company_id,
    currency,
    unallocated_amount DESC,
    receipt_date DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION public.ar_copilot_validate_report_scope(
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
BEGIN
  IF CURRENT_USER <> 'service_role' THEN
    RAISE EXCEPTION 'AUTH: AR Copilot report authority is Edge-only'
      USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: company and user are required';
  END IF;
  IF p_scope_mode IS NULL OR p_scope_mode NOT IN ('assigned', 'company') THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: invalid scope mode';
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
    RAISE EXCEPTION 'AUTH: company-wide report scope is not permitted'
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
    RAISE EXCEPTION 'AUTH: assigned report scope requires AR Clerk role'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_base_currency;
END;
$function$;

ALTER FUNCTION public.ar_copilot_validate_report_scope(UUID, UUID, TEXT)
  OWNER TO postgres;

COMMENT ON FUNCTION public.ar_copilot_validate_report_scope(UUID, UUID, TEXT) IS
  'Edge-only AR Copilot tenant, role, and report-scope validation.';

REVOKE ALL ON FUNCTION public.ar_copilot_validate_report_scope(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ar_copilot_validate_report_scope(UUID, UUID, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.ar_copilot_invoice_report_rows(
  p_company_id UUID,
  p_user_id UUID,
  p_scope_mode TEXT,
  p_status TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_minimum_amount NUMERIC DEFAULT NULL,
  p_sort_metric TEXT DEFAULT NULL,
  p_sort_direction TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
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
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: limit must be between 1 and 50';
  END IF;
  IF p_currency IS NOT NULL
    AND p_currency NOT IN ('MYR', 'SGD', 'USD', 'EUR', 'GBP', 'CNY') THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: unsupported currency';
  END IF;
  IF p_status IS NOT NULL
    AND p_status NOT IN (
      'Draft', 'Open', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled',
      'Written Off'
    ) THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: unsupported Invoice status';
  END IF;
  IF p_minimum_amount IS NOT NULL AND p_minimum_amount < 0 THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: minimum_amount must be non-negative';
  END IF;
  IF p_minimum_amount IS NOT NULL AND p_currency IS NULL THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: minimum_amount requires currency';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL
    AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: invalid date range';
  END IF;
  IF p_sort_metric IS NOT NULL
    AND p_sort_metric NOT IN ('total_amount', 'outstanding_amount') THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: unsupported Invoice sort';
  END IF;
  IF (p_sort_metric IS NULL AND p_sort_direction IS NOT NULL)
    OR (p_sort_metric IS NOT NULL AND p_sort_direction NOT IN ('asc', 'desc')) THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: invalid sort direction';
  END IF;

  v_base_currency := public.ar_copilot_validate_report_scope(
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
      i.id,
      i.invoice_no,
      i.invoice_date,
      i.status,
      i.customer_id,
      UPPER(TRIM(i.currency::TEXT)) AS currency,
      i.total_amount,
      i.outstanding
    FROM public.invoices i
    JOIN scoped_customers sc ON sc.id = i.customer_id
    WHERE i.company_id = p_company_id
      AND (p_status IS NULL OR i.status = p_status)
      AND (
        p_currency IS NULL
        OR i.currency = p_currency::CHAR(3)
      )
      AND (p_date_from IS NULL OR i.invoice_date >= p_date_from)
      AND (p_date_to IS NULL OR i.invoice_date <= p_date_to)
      AND (p_minimum_amount IS NULL OR i.outstanding >= p_minimum_amount)
  ),
  ranked AS MATERIALIZED (
    SELECT
      f.*,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN p_sort_metric = 'total_amount'
              AND p_sort_direction = 'asc' THEN f.total_amount END ASC NULLS LAST,
          CASE WHEN p_sort_metric = 'total_amount'
              AND p_sort_direction = 'desc' THEN f.total_amount END DESC NULLS LAST,
          CASE WHEN p_sort_metric = 'outstanding_amount'
              AND p_sort_direction = 'asc' THEN f.outstanding END ASC NULLS LAST,
          CASE WHEN p_sort_metric = 'outstanding_amount'
              AND p_sort_direction = 'desc' THEN f.outstanding END DESC NULLS LAST,
          f.invoice_date DESC,
          f.id DESC
      ) AS row_no
    FROM filtered f
  )
  SELECT JSONB_BUILD_OBJECT(
    'rows', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'id', r.id,
          'document', r.invoice_no,
          'document_date', r.invoice_date,
          'status', r.status,
          'customer_id', r.customer_id,
          'currency', r.currency,
          'total_amount', TO_CHAR(
            ROUND(r.total_amount, 2),
            'FM999999999999999999999999999999990.00'
          ),
          'outstanding_amount', TO_CHAR(
            ROUND(r.outstanding, 2),
            'FM999999999999999999999999999999990.00'
          )
        ) ORDER BY r.row_no
      )
      FROM ranked r
      WHERE r.row_no <= p_limit
    ), '[]'::JSONB),
    'total', (SELECT COUNT(*) FROM filtered),
    'base_currency', UPPER(TRIM(v_base_currency::TEXT)),
    'filter_currency', p_currency,
    'sort_metric', p_sort_metric,
    'sort_direction', p_sort_direction
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.ar_copilot_invoice_report_rows(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, NUMERIC, TEXT, TEXT, INTEGER
) OWNER TO postgres;

COMMENT ON FUNCTION public.ar_copilot_invoice_report_rows(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, NUMERIC, TEXT, TEXT, INTEGER
) IS
  'JWT-bound, tenant/customer-scoped AR Copilot Invoice report rows. '
  'Filters and deterministic sort execute before the bounded result limit.';

REVOKE ALL ON FUNCTION public.ar_copilot_invoice_report_rows(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, NUMERIC, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.ar_copilot_invoice_report_rows(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, NUMERIC, TEXT, TEXT, INTEGER
) TO service_role;

CREATE OR REPLACE FUNCTION public.ar_copilot_receipt_report_rows(
  p_company_id UUID,
  p_user_id UUID,
  p_scope_mode TEXT,
  p_status TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_minimum_amount NUMERIC DEFAULT NULL,
  p_sort_metric TEXT DEFAULT NULL,
  p_sort_direction TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
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
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: limit must be between 1 and 50';
  END IF;
  IF p_currency IS NOT NULL
    AND p_currency NOT IN ('MYR', 'SGD', 'USD', 'EUR', 'GBP', 'CNY') THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: unsupported currency';
  END IF;
  IF p_status IS NOT NULL
    AND p_status NOT IN ('Draft', 'Posted', 'Fully Allocated', 'Cancelled', 'Bounced') THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: unsupported Receipt status';
  END IF;
  IF p_minimum_amount IS NOT NULL AND p_minimum_amount < 0 THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: minimum_amount must be non-negative';
  END IF;
  IF p_minimum_amount IS NOT NULL AND p_currency IS NULL THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: minimum_amount requires currency';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL
    AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: invalid date range';
  END IF;
  IF p_sort_metric IS NOT NULL
    AND p_sort_metric NOT IN ('total_amount', 'unapplied_amount') THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: unsupported Receipt sort';
  END IF;
  IF (p_sort_metric IS NULL AND p_sort_direction IS NOT NULL)
    OR (p_sort_metric IS NOT NULL AND p_sort_direction NOT IN ('asc', 'desc')) THEN
    RAISE EXCEPTION 'AR_COPILOT_REPORT_INVALID: invalid sort direction';
  END IF;

  v_base_currency := public.ar_copilot_validate_report_scope(
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
      r.id,
      r.receipt_no,
      r.receipt_date,
      r.status,
      r.customer_id,
      UPPER(TRIM(r.currency::TEXT)) AS currency,
      r.receipt_amount,
      r.unallocated_amount
    FROM public.receipts r
    JOIN scoped_customers sc ON sc.id = r.customer_id
    WHERE r.company_id = p_company_id
      AND (p_status IS NULL OR r.status = p_status)
      AND (
        p_currency IS NULL
        OR r.currency = p_currency::CHAR(3)
      )
      AND (p_date_from IS NULL OR r.receipt_date >= p_date_from)
      AND (p_date_to IS NULL OR r.receipt_date <= p_date_to)
      AND (p_minimum_amount IS NULL OR r.unallocated_amount >= p_minimum_amount)
  ),
  ranked AS MATERIALIZED (
    SELECT
      f.*,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN p_sort_metric = 'total_amount'
              AND p_sort_direction = 'asc' THEN f.receipt_amount END ASC NULLS LAST,
          CASE WHEN p_sort_metric = 'total_amount'
              AND p_sort_direction = 'desc' THEN f.receipt_amount END DESC NULLS LAST,
          CASE WHEN p_sort_metric = 'unapplied_amount'
              AND p_sort_direction = 'asc' THEN f.unallocated_amount END ASC NULLS LAST,
          CASE WHEN p_sort_metric = 'unapplied_amount'
              AND p_sort_direction = 'desc' THEN f.unallocated_amount END DESC NULLS LAST,
          f.receipt_date DESC,
          f.id DESC
      ) AS row_no
    FROM filtered f
  )
  SELECT JSONB_BUILD_OBJECT(
    'rows', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'id', r.id,
          'document', r.receipt_no,
          'document_date', r.receipt_date,
          'status', r.status,
          'customer_id', r.customer_id,
          'currency', r.currency,
          'total_amount', TO_CHAR(
            ROUND(r.receipt_amount, 2),
            'FM999999999999999999999999999999990.00'
          ),
          'unapplied_amount', TO_CHAR(
            ROUND(r.unallocated_amount, 2),
            'FM999999999999999999999999999999990.00'
          )
        ) ORDER BY r.row_no
      )
      FROM ranked r
      WHERE r.row_no <= p_limit
    ), '[]'::JSONB),
    'total', (SELECT COUNT(*) FROM filtered),
    'base_currency', UPPER(TRIM(v_base_currency::TEXT)),
    'filter_currency', p_currency,
    'sort_metric', p_sort_metric,
    'sort_direction', p_sort_direction
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.ar_copilot_receipt_report_rows(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, NUMERIC, TEXT, TEXT, INTEGER
) OWNER TO postgres;

COMMENT ON FUNCTION public.ar_copilot_receipt_report_rows(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, NUMERIC, TEXT, TEXT, INTEGER
) IS
  'JWT-bound, tenant/customer-scoped AR Copilot Receipt report rows. '
  'Filters and deterministic sort execute before the bounded result limit.';

REVOKE ALL ON FUNCTION public.ar_copilot_receipt_report_rows(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, NUMERIC, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.ar_copilot_receipt_report_rows(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, NUMERIC, TEXT, TEXT, INTEGER
) TO service_role;

COMMIT;
