-- Post-Batch-9D System Remediation - Gate B
-- Credit-rating aging drill-down and per-user import-notification acknowledgements.
--
-- Forward-only properties:
--   * preserves the six-argument ar_aging_by_customer caller contract;
--   * adds one exact seven-argument, non-defaulted overload for credit rating;
--   * installs an additive acknowledgement store with RLS and no client DML;
--   * exposes notification RPCs only to service_role;
--   * contains no retained business-data rewrite and creates no cron.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE
  v_old_oid OID;
BEGIN
  v_old_oid := to_regprocedure(
    'public.ar_aging_by_customer(uuid,uuid,text,date,integer,integer)'
  );
  IF v_old_oid IS NULL THEN
    RAISE EXCEPTION 'GATE_B: six-argument aging RPC baseline is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
    WHERE p.oid = v_old_oid
      AND (
        n.nspname <> 'public'
        OR r.rolname <> 'postgres'
        OR p.prosecdef IS DISTINCT FROM false
        OR p.provolatile <> 's'
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      )
  ) THEN
    RAISE EXCEPTION 'GATE_B: aging RPC owner/security/search_path baseline drift';
  END IF;

  IF to_regprocedure(
    'public.ar_aging_by_customer(uuid,uuid,text,date,integer,integer,text)'
  ) IS NOT NULL
    OR to_regclass('public.notification_acknowledgements') IS NOT NULL THEN
    RAISE EXCEPTION 'GATE_B: migration already installed or catalog drifted';
  END IF;

  IF to_regclass('public.import_batches') IS NULL
    OR to_regprocedure('public.rls_has_operational_read_access(uuid)') IS NULL THEN
    RAISE EXCEPTION 'GATE_B: import or authorization dependency is missing';
  END IF;
END;
$guard$;

-- The new overload intentionally has no default on p_credit_rating. Old
-- six-argument calls resolve only to the existing function; the Edge service
-- always supplies the seventh argument (including NULL), so resolution is
-- deterministic in both directions.
CREATE FUNCTION public.ar_aging_by_customer(
  p_company_id UUID,
  p_user_id UUID,
  p_scope_mode TEXT,
  p_as_of_date DATE,
  p_page INTEGER,
  p_page_size INTEGER,
  p_credit_rating TEXT
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
  IF p_page IS NULL OR p_page < 1
    OR p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 200 THEN
    RAISE EXCEPTION 'BR-9DD-READ-002: invalid pagination';
  END IF;

  IF p_credit_rating IS NOT NULL
    AND p_credit_rating NOT IN ('AAA', 'AA', 'A', 'B', 'C', 'D') THEN
    RAISE EXCEPTION 'VALIDATION: invalid credit_rating';
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
      AND (p_credit_rating IS NULL OR c.credit_rating = p_credit_rating)
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
      AND i.invoice_date <= v_as_of_date
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
      ROW_NUMBER() OVER (
        ORDER BY cg.base_total DESC, cg.customer_name, cg.customer_id
      ) AS row_no
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
              SELECT COUNT(*)
              FROM currency_grouped cg
              WHERE cg.customer_id = pr.customer_id
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

ALTER FUNCTION public.ar_aging_by_customer(
  UUID, UUID, TEXT, DATE, INTEGER, INTEGER, TEXT
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.ar_aging_by_customer(
  UUID, UUID, TEXT, DATE, INTEGER, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ar_aging_by_customer(
  UUID, UUID, TEXT, DATE, INTEGER, INTEGER, TEXT
) TO authenticated;

CREATE TABLE public.notification_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id),
  -- Matches the repository's existing user_roles convention: Auth identities
  -- are referenced by UUID without coupling public migrations to auth schema
  -- internals. Endpoint authorization always binds this value to validated JWT.
  user_id UUID NOT NULL,
  notification_key TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'import_batch',
  source_entity_id UUID NOT NULL,
  notification_type TEXT NOT NULL,
  import_batch_id UUID NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  condition_type TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT notification_ack_unique
    UNIQUE (company_id, user_id, notification_key),
  CONSTRAINT notification_ack_source_type
    CHECK (source_type = 'import_batch'),
  CONSTRAINT notification_ack_type
    CHECK (
      notification_type IN ('import_error', 'import_review')
      AND condition_type = notification_type
    ),
  CONSTRAINT notification_ack_source_identity
    CHECK (source_entity_id = import_batch_id),
  CONSTRAINT notification_ack_key
    CHECK (
      notification_key =
        'import:' || import_batch_id::TEXT || ':' || condition_type
    ),
  CONSTRAINT notification_ack_dismissed_after_read
    CHECK (dismissed_at IS NULL OR dismissed_at >= read_at)
);

CREATE INDEX notification_ack_user_read_idx
  ON public.notification_acknowledgements (
    company_id, user_id, read_at DESC, notification_key DESC
  );
CREATE INDEX notification_ack_prune_idx
  ON public.notification_acknowledgements (
    company_id, user_id, updated_at, id
  );
CREATE INDEX notification_ack_batch_idx
  ON public.notification_acknowledgements (import_batch_id);

ALTER TABLE public.notification_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_ack_self_select
  ON public.notification_acknowledgements
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND public.rls_has_operational_read_access(company_id)
  );

REVOKE ALL ON TABLE public.notification_acknowledgements
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.notification_acknowledgements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.notification_acknowledgements TO service_role;

CREATE FUNCTION public.notification_import_alerts(
  p_company_id UUID
)
RETURNS TABLE (
  notification_key TEXT,
  notification_type TEXT,
  title TEXT,
  message TEXT,
  severity TEXT,
  created_at TIMESTAMPTZ,
  import_batch_id UUID,
  deep_link TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    'import:' || ib.id::TEXT || ':import_error',
    'import_error'::TEXT,
    'Import completed with errors'::TEXT,
    ib.batch_name || ' (' || ib.import_type || ') has '
      || ib.error_rows::TEXT || ' error rows.'::TEXT,
    'error'::TEXT,
    ib.created_at,
    ib.id,
    '/imports/' || ib.id::TEXT
  FROM public.import_batches ib
  WHERE ib.company_id = p_company_id
    AND ib.status IN ('Parsed', 'Validated', 'Completed')
    AND ib.error_rows > 0

  UNION ALL

  SELECT
    'import:' || ib.id::TEXT || ':import_review',
    'import_review'::TEXT,
    'Import rows need review'::TEXT,
    ib.batch_name || ' (' || ib.import_type || ') has '
      || ib.unmatched_count::TEXT || ' unmatched/review rows.'::TEXT,
    'warning'::TEXT,
    ib.created_at,
    ib.id,
    '/imports/' || ib.id::TEXT
  FROM public.import_batches ib
  WHERE ib.company_id = p_company_id
    AND ib.status IN ('Parsed', 'Validated', 'Completed')
    AND ib.unmatched_count > 0;
$function$;

ALTER FUNCTION public.notification_import_alerts(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.notification_import_alerts(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notification_import_alerts(UUID)
  TO service_role;

CREATE FUNCTION public.notification_list_import_alerts(
  p_company_id UUID,
  p_user_id UUID,
  p_limit INTEGER,
  p_cursor_created_at TIMESTAMPTZ,
  p_cursor_notification_key TEXT,
  p_read_state TEXT,
  p_notification_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 20 THEN
    RAISE EXCEPTION 'VALIDATION: limit must be an integer from 1 to 20';
  END IF;
  IF p_read_state NOT IN ('all', 'unread', 'read') THEN
    RAISE EXCEPTION 'VALIDATION: invalid read_state';
  END IF;
  IF p_notification_type IS NOT NULL
    AND p_notification_type NOT IN ('import_error', 'import_review') THEN
    RAISE EXCEPTION 'VALIDATION: unsupported notification type';
  END IF;
  IF (p_cursor_created_at IS NULL) <> (p_cursor_notification_key IS NULL) THEN
    RAISE EXCEPTION 'VALIDATION: incomplete notification cursor';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.company_id = p_company_id
      AND ur.user_id = p_user_id
      AND ur.is_active = true
      AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
  ) THEN
    RAISE EXCEPTION 'AUTH: notification access is not permitted';
  END IF;

  WITH filtered AS MATERIALIZED (
    SELECT
      a.notification_key,
      a.notification_type,
      a.title,
      a.message,
      a.severity,
      a.created_at,
      a.import_batch_id,
      a.deep_link,
      ack.read_at
    FROM public.notification_import_alerts(p_company_id) a
    LEFT JOIN public.notification_acknowledgements ack
      ON ack.company_id = p_company_id
     AND ack.user_id = p_user_id
     AND ack.notification_key = a.notification_key
    WHERE (p_notification_type IS NULL
      OR a.notification_type = p_notification_type)
      AND (
        p_read_state = 'all'
        OR (p_read_state = 'unread' AND ack.read_at IS NULL)
        OR (p_read_state = 'read' AND ack.read_at IS NOT NULL)
      )
      AND (
        p_cursor_created_at IS NULL
        OR a.created_at < p_cursor_created_at
        OR (
          a.created_at = p_cursor_created_at
          AND a.notification_key < p_cursor_notification_key
        )
      )
    ORDER BY a.created_at DESC, a.notification_key DESC
    LIMIT p_limit + 1
  ),
  page_rows AS (
    SELECT *
    FROM filtered
    ORDER BY created_at DESC, notification_key DESC
    LIMIT p_limit
  )
  SELECT JSONB_BUILD_OBJECT(
    'rows', COALESCE((
      SELECT JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'notification_key', p.notification_key,
          'type', p.notification_type,
          'title', p.title,
          'message', p.message,
          'severity', p.severity,
          'created_at', p.created_at,
          'source', JSONB_BUILD_OBJECT(
            'type', 'import_batch',
            'id', p.import_batch_id
          ),
          'deep_link', p.deep_link,
          'read_at', p.read_at
        )
        ORDER BY p.created_at DESC, p.notification_key DESC
      )
      FROM page_rows p
    ), '[]'::JSONB),
    'has_more', (SELECT COUNT(*) > p_limit FROM filtered)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE FUNCTION public.notification_unread_import_alert_count(
  p_company_id UUID,
  p_user_id UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.company_id = p_company_id
      AND ur.user_id = p_user_id
      AND ur.is_active = true
      AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
  ) THEN
    RAISE EXCEPTION 'AUTH: notification access is not permitted';
  END IF;

  SELECT COUNT(*)
  INTO v_count
  FROM public.notification_import_alerts(p_company_id) a
  LEFT JOIN public.notification_acknowledgements ack
    ON ack.company_id = p_company_id
   AND ack.user_id = p_user_id
   AND ack.notification_key = a.notification_key
  WHERE ack.id IS NULL;

  RETURN v_count;
END;
$function$;

CREATE FUNCTION public.notification_mark_import_read(
  p_company_id UUID,
  p_user_id UUID,
  p_notification_key TEXT,
  p_import_batch_id UUID,
  p_condition_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_read_at TIMESTAMPTZ;
BEGIN
  IF p_condition_type NOT IN ('import_error', 'import_review')
    OR p_notification_key <> (
      'import:' || p_import_batch_id::TEXT || ':' || p_condition_type
    ) THEN
    RAISE EXCEPTION 'VALIDATION: malformed notification key';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.company_id = p_company_id
      AND ur.user_id = p_user_id
      AND ur.is_active = true
      AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
  ) THEN
    RAISE EXCEPTION 'AUTH: notification access is not permitted';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.notification_import_alerts(p_company_id) a
    WHERE a.notification_key = p_notification_key
      AND a.import_batch_id = p_import_batch_id
      AND a.notification_type = p_condition_type
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND: notification is not actionable or accessible';
  END IF;

  INSERT INTO public.notification_acknowledgements (
    company_id,
    user_id,
    notification_key,
    source_type,
    source_entity_id,
    notification_type,
    import_batch_id,
    condition_type
  )
  VALUES (
    p_company_id,
    p_user_id,
    p_notification_key,
    'import_batch',
    p_import_batch_id,
    p_condition_type,
    p_import_batch_id,
    p_condition_type
  )
  ON CONFLICT (company_id, user_id, notification_key)
  DO UPDATE SET updated_at = clock_timestamp()
  RETURNING read_at INTO v_read_at;

  RETURN JSONB_BUILD_OBJECT(
    'notification_key', p_notification_key,
    'read_at', v_read_at
  );
END;
$function$;

CREATE FUNCTION public.notification_mark_all_import_read(
  p_company_id UUID,
  p_user_id UUID,
  p_notification_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_completed_at TIMESTAMPTZ := clock_timestamp();
  v_count INTEGER;
BEGIN
  IF p_notification_type IS NOT NULL
    AND p_notification_type NOT IN ('import_error', 'import_review') THEN
    RAISE EXCEPTION 'VALIDATION: unsupported notification type';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.company_id = p_company_id
      AND ur.user_id = p_user_id
      AND ur.is_active = true
      AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
  ) THEN
    RAISE EXCEPTION 'AUTH: notification access is not permitted';
  END IF;

  WITH actionable AS MATERIALIZED (
    SELECT a.*
    FROM public.notification_import_alerts(p_company_id) a
    WHERE p_notification_type IS NULL
      OR a.notification_type = p_notification_type
  ),
  upserted AS (
    INSERT INTO public.notification_acknowledgements (
      company_id,
      user_id,
      notification_key,
      source_type,
      source_entity_id,
      notification_type,
      import_batch_id,
      condition_type,
      read_at,
      updated_at
    )
    SELECT
      p_company_id,
      p_user_id,
      a.notification_key,
      'import_batch',
      a.import_batch_id,
      a.notification_type,
      a.import_batch_id,
      a.notification_type,
      v_completed_at,
      v_completed_at
    FROM actionable a
    ON CONFLICT (company_id, user_id, notification_key)
    DO UPDATE SET updated_at = EXCLUDED.updated_at
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_count FROM upserted;

  RETURN JSONB_BUILD_OBJECT(
    'acknowledged_count', v_count,
    'completed_at', v_completed_at
  );
END;
$function$;

CREATE FUNCTION public.notification_prune_import_acknowledgements(
  p_company_id UUID,
  p_user_id UUID,
  p_limit INTEGER DEFAULT 500
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'VALIDATION: prune limit must be from 1 to 500';
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT ack.id
    FROM public.notification_acknowledgements ack
    JOIN public.import_batches ib ON ib.id = ack.import_batch_id
    WHERE ack.company_id = p_company_id
      AND ack.user_id = p_user_id
      AND GREATEST(ack.read_at, ib.updated_at)
        < clock_timestamp() - INTERVAL '90 days'
      AND NOT EXISTS (
        SELECT 1
        FROM public.notification_import_alerts(p_company_id) active
        WHERE active.notification_key = ack.notification_key
      )
    ORDER BY
      GREATEST(ack.read_at, ib.updated_at),
      ack.notification_key,
      ack.id
    LIMIT p_limit
  )
  DELETE FROM public.notification_acknowledgements ack
  USING candidates c
  WHERE ack.id = c.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

ALTER FUNCTION public.notification_list_import_alerts(
  UUID, UUID, INTEGER, TIMESTAMPTZ, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.notification_unread_import_alert_count(UUID, UUID)
  OWNER TO postgres;
ALTER FUNCTION public.notification_mark_import_read(
  UUID, UUID, TEXT, UUID, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.notification_mark_all_import_read(UUID, UUID, TEXT)
  OWNER TO postgres;
ALTER FUNCTION public.notification_prune_import_acknowledgements(
  UUID, UUID, INTEGER
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.notification_list_import_alerts(
  UUID, UUID, INTEGER, TIMESTAMPTZ, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notification_unread_import_alert_count(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notification_mark_import_read(
  UUID, UUID, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notification_mark_all_import_read(
  UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notification_prune_import_acknowledgements(
  UUID, UUID, INTEGER
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.notification_list_import_alerts(
  UUID, UUID, INTEGER, TIMESTAMPTZ, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_unread_import_alert_count(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_mark_import_read(
  UUID, UUID, TEXT, UUID, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_mark_all_import_read(
  UUID, UUID, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_prune_import_acknowledgements(
  UUID, UUID, INTEGER
) TO service_role;

DO $postconditions$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO v_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'ar_aging_by_customer';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'GATE_B: expected exactly two unambiguous aging signatures';
  END IF;

  IF (
    SELECT p.pronargdefaults
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.ar_aging_by_customer(uuid,uuid,text,date,integer,integer,text)'::regprocedure
  ) <> 0 THEN
    RAISE EXCEPTION 'GATE_B: rating overload must not have defaults';
  END IF;

  IF NOT (
    SELECT c.relrowsecurity
    FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.notification_acknowledgements'::regclass
  ) THEN
    RAISE EXCEPTION 'GATE_B: acknowledgement RLS is not enabled';
  END IF;

  IF has_table_privilege(
    'anon',
    'public.notification_acknowledgements',
    'SELECT,INSERT,UPDATE,DELETE'
  )
    OR has_table_privilege(
      'authenticated',
      'public.notification_acknowledgements',
      'INSERT,UPDATE,DELETE'
    ) THEN
    RAISE EXCEPTION 'GATE_B: acknowledgement client DML boundary failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'notification_%'
      AND p.proname <> 'notification_import_alerts'
      AND (
        p.prosecdef IS DISTINCT FROM true
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      )
  ) THEN
    RAISE EXCEPTION 'GATE_B: notification RPC security/search_path failed';
  END IF;
END;
$postconditions$;

COMMENT ON FUNCTION public.ar_aging_by_customer(
  UUID, UUID, TEXT, DATE, INTEGER, INTEGER, TEXT
) IS
  'Gate B outstanding-only aging drill-down with exact optional Edge-supplied credit rating; old six-argument callers remain intact.';
COMMENT ON TABLE public.notification_acknowledgements IS
  'Gate B per-company/per-user read acknowledgement state for derived import alerts only.';
COMMENT ON FUNCTION public.notification_prune_import_acknowledgements(
  UUID, UUID, INTEGER
) IS
  'Gate B bounded maintenance: deletes at most 500 non-actionable per-user acknowledgements older than 90 days; never scheduled by cron.';

COMMIT;
