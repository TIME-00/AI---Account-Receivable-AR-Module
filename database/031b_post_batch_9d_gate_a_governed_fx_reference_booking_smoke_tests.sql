-- Post-Batch-9D Gate A governed FX reference-booking smoke tests.
-- Run only after migration 031 on a disposable local database.
-- All fixtures and governed mutations are transaction-scoped and rolled back.

BEGIN;

CREATE FUNCTION pg_temp.gatea_assert(
  p_name TEXT,
  p_condition BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, FALSE) THEN
    RAISE EXCEPTION 'FAIL: %', p_name;
  END IF;
  RAISE NOTICE 'PASS: %', p_name;
END;
$$;

CREATE FUNCTION pg_temp.gatea_assert_error(
  p_name TEXT,
  p_sql TEXT,
  p_expected_fragment TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION
    WHEN OTHERS THEN
      IF position(p_expected_fragment IN SQLERRM) > 0 THEN
        RAISE NOTICE 'PASS: %', p_name;
        RETURN;
      END IF;
      RAISE EXCEPTION
        'FAIL: %, expected error containing %, got %',
        p_name,
        p_expected_fragment,
        SQLERRM;
  END;

  RAISE EXCEPTION 'FAIL: %, expected an error', p_name;
END;
$$;

-- Stable fixture ids.
-- company A/B       a031...001 / a031...002
-- maker/supervisor/manager/auditor a032...001-004
-- customer A        a033...001
-- bank account A    a034...001
-- active refs       a035...001-006

INSERT INTO public.companies (
  id, company_code, company_name, base_currency, country
)
VALUES
  ('a0310000-0000-4000-8000-000000000001', 'GATEA31A', 'Gate A Company A', 'MYR', 'MY'),
  ('a0310000-0000-4000-8000-000000000002', 'GATEA31B', 'Gate A Company B', 'MYR', 'MY');

INSERT INTO public.user_roles (
  id, user_id, company_id, role, is_active
)
VALUES
  ('a0321000-0000-4000-8000-000000000001', 'a0320000-0000-4000-8000-000000000001', 'a0310000-0000-4000-8000-000000000001', 'AR Clerk', TRUE),
  ('a0321000-0000-4000-8000-000000000002', 'a0320000-0000-4000-8000-000000000002', 'a0310000-0000-4000-8000-000000000001', 'AR Supervisor', TRUE),
  ('a0321000-0000-4000-8000-000000000003', 'a0320000-0000-4000-8000-000000000003', 'a0310000-0000-4000-8000-000000000001', 'Finance Manager', TRUE),
  ('a0321000-0000-4000-8000-000000000004', 'a0320000-0000-4000-8000-000000000004', 'a0310000-0000-4000-8000-000000000001', 'Auditor', TRUE);

INSERT INTO public.customers (
  id,
  company_id,
  customer_id,
  customer_name,
  customer_type,
  bill_addr_line1,
  bill_city,
  bill_state,
  bill_postal,
  bill_country,
  contact_name,
  contact_phone,
  contact_email
)
VALUES (
  'a0330000-0000-4000-8000-000000000001',
  'a0310000-0000-4000-8000-000000000001',
  'GATE-A-CUST',
  'Gate A Customer',
  'Corporate',
  '1 Local Test Road',
  'Kuala Lumpur',
  'WP Kuala Lumpur',
  '50000',
  'MY',
  'Gate A Contact',
  '60000001',
  'gate-a@example.test'
);

INSERT INTO public.user_customer_assignments (
  id, user_id, customer_id, company_id, is_active
)
VALUES (
  'a0331000-0000-4000-8000-000000000001',
  'a0320000-0000-4000-8000-000000000001',
  'a0330000-0000-4000-8000-000000000001',
  'a0310000-0000-4000-8000-000000000001',
  TRUE
);

INSERT INTO public.bank_accounts (
  id, company_id, bank_name, account_name, account_no, currency
)
VALUES (
  'a0340000-0000-4000-8000-000000000001',
  'a0310000-0000-4000-8000-000000000001',
  'Gate A Bank',
  'Gate A Current',
  'GATE-A-001',
  'MYR'
);

INSERT INTO public.exchange_rates (
  id, company_id, from_currency, to_currency, rate, effective_date
)
VALUES (
  'a0360000-0000-4000-8000-000000000001',
  'a0310000-0000-4000-8000-000000000001',
  'USD',
  'MYR',
  4.000000,
  DATE '2026-07-24'
);

INSERT INTO public.fx_reference_rates (
  id,
  company_id,
  from_currency,
  to_currency,
  rate,
  effective_date,
  provider,
  provider_rate_type,
  fetched_at,
  status
)
VALUES
  (
    'a0350000-0000-4000-8000-000000000001',
    'a0310000-0000-4000-8000-000000000001',
    'USD', 'MYR', 4.20000000, DATE '2026-07-21',
    'gate-a-provider', 'reference', TIMESTAMPTZ '2026-07-21 08:00:00+00', 'Active'
  ),
  (
    'a0350000-0000-4000-8000-000000000002',
    'a0310000-0000-4000-8000-000000000001',
    'USD', 'MYR', 4.25000000, DATE '2026-07-22',
    'gate-a-provider', 'reference', TIMESTAMPTZ '2026-07-22 08:00:00+00', 'Active'
  ),
  (
    'a0350000-0000-4000-8000-000000000003',
    'a0310000-0000-4000-8000-000000000002',
    'USD', 'MYR', 4.30000000, DATE '2026-07-22',
    'gate-a-provider', 'reference', TIMESTAMPTZ '2026-07-22 08:00:00+00', 'Active'
  ),
  (
    'a0350000-0000-4000-8000-000000000004',
    'a0310000-0000-4000-8000-000000000001',
    'MYR', 'USD', 0.23500000, DATE '2026-07-22',
    'gate-a-provider', 'reference', TIMESTAMPTZ '2026-07-22 08:00:00+00', 'Active'
  ),
  (
    'a0350000-0000-4000-8000-000000000005',
    'a0310000-0000-4000-8000-000000000001',
    'EUR', 'MYR', 5.00000000, DATE '2026-07-22',
    'gate-a-provider', 'reference', TIMESTAMPTZ '2026-07-22 08:00:00+00', 'Superseded'
  ),
  (
    'a0350000-0000-4000-8000-000000000006',
    'a0310000-0000-4000-8000-000000000001',
    'SGD', 'MYR', 3.40000000, DATE '2026-07-10',
    'gate-a-provider', 'reference', TIMESTAMPTZ '2026-07-10 08:00:00+00', 'Active'
  );

-- Signature, security, and privilege checks.
SELECT pg_temp.gatea_assert(
  'exactly three Invoice create overloads',
  (
    SELECT count(*) = 3
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fx_create_governed_invoice_draft'
  )
);

SELECT pg_temp.gatea_assert(
  'exactly three Receipt create overloads',
  (
    SELECT count(*) = 3
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fx_create_governed_receipt_draft'
  )
);

SELECT pg_temp.gatea_assert(
  'reference-aware functions remain service-only',
  has_function_privilege(
    'service_role',
    'public.fx_create_governed_invoice_draft(uuid,uuid,jsonb,jsonb,jsonb,boolean,text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.fx_create_governed_receipt_draft(uuid,uuid,jsonb,jsonb,boolean,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.fx_create_governed_invoice_draft(uuid,uuid,jsonb,jsonb,jsonb,boolean,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.fx_create_governed_receipt_draft(uuid,uuid,jsonb,jsonb,boolean,text,uuid)',
    'EXECUTE'
  )
);

SELECT pg_temp.gatea_assert(
  'governed wrapper owner/security/search_path preserved',
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'fx_create_governed_invoice_draft',
        'fx_create_governed_receipt_draft',
        'fx_update_governed_invoice_fx',
        'fx_update_governed_receipt_fx'
      )
      AND (
        r.rolname <> 'postgres'
        OR p.prosecdef IS DISTINCT FROM TRUE
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::TEXT[]
      )
  )
);

-- Direct helper validation classes.
SELECT pg_temp.gatea_assert(
  'latest active effective reference resolves',
  public.fx_require_bookable_reference_rate(
    'a0310000-0000-4000-8000-000000000001',
    'USD',
    'MYR',
    DATE '2026-07-24',
    'a0350000-0000-4000-8000-000000000002'
  ) = 4.25000000
);

SELECT pg_temp.gatea_assert_error(
  'older active reference rejected',
  $sql$
    SELECT public.fx_require_bookable_reference_rate(
      'a0310000-0000-4000-8000-000000000001',
      'USD', 'MYR', DATE '2026-07-24',
      'a0350000-0000-4000-8000-000000000001'
    )
  $sql$,
  'not the latest active rate'
);

SELECT pg_temp.gatea_assert_error(
  'cross-company reference rejected',
  $sql$
    SELECT public.fx_require_bookable_reference_rate(
      'a0310000-0000-4000-8000-000000000001',
      'USD', 'MYR', DATE '2026-07-24',
      'a0350000-0000-4000-8000-000000000003'
    )
  $sql$,
  'invalid reference selection'
);

SELECT pg_temp.gatea_assert_error(
  'reversed direction rejected',
  $sql$
    SELECT public.fx_require_bookable_reference_rate(
      'a0310000-0000-4000-8000-000000000001',
      'MYR', 'USD', DATE '2026-07-24',
      'a0350000-0000-4000-8000-000000000004'
    )
  $sql$,
  'direction must target company base currency'
);

SELECT pg_temp.gatea_assert_error(
  'superseded reference rejected',
  $sql$
    SELECT public.fx_require_bookable_reference_rate(
      'a0310000-0000-4000-8000-000000000001',
      'EUR', 'MYR', DATE '2026-07-24',
      'a0350000-0000-4000-8000-000000000005'
    )
  $sql$,
  'invalid reference selection'
);

SELECT pg_temp.gatea_assert_error(
  'stale reference rejected',
  $sql$
    SELECT public.fx_require_bookable_reference_rate(
      'a0310000-0000-4000-8000-000000000001',
      'SGD', 'MYR', DATE '2026-07-24',
      'a0350000-0000-4000-8000-000000000006'
    )
  $sql$,
  'reference rate is stale'
);

SELECT pg_temp.gatea_assert_error(
  'forged reference id rejected',
  $sql$
    SELECT public.fx_require_bookable_reference_rate(
      'a0310000-0000-4000-8000-000000000001',
      'USD', 'MYR', DATE '2026-07-24',
      'a035ffff-ffff-4fff-8fff-ffffffffffff'
    )
  $sql$,
  'invalid reference selection'
);

-- Reference-selected create paths. Deliberately forged base snapshots and
-- payload rates prove that the SQL wrapper owns the final booked snapshots.
DO $$
DECLARE
  v_invoice_id UUID;
  v_receipt_id UUID;
BEGIN
  v_invoice_id := public.fx_create_governed_invoice_draft(
    'a0310000-0000-4000-8000-000000000001',
    'a0320000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'invoice_no', 'GA-REF-INV-001',
      'doc_type', 'Invoice',
      'invoice_date', '2026-07-24',
      'customer_id', 'a0330000-0000-4000-8000-000000000001',
      'customer_name', 'Gate A Customer',
      'currency', 'USD',
      'exchange_rate', 999,
      'base_currency', 'MYR',
      'subtotal', 12.34,
      'tax_total', 0,
      'total_amount', 12.34,
      'base_total', 999999
    ),
    NULL,
    '[]'::JSONB,
    FALSE,
    NULL,
    'a0350000-0000-4000-8000-000000000002'
  );

  PERFORM pg_temp.gatea_assert(
    'reference-selected Invoice snapshot/classification',
    (
      SELECT i.exchange_rate = 4.250000
        AND i.base_total = 52.45
        AND d.source_category = 'REFERENCE_SELECTED'
        AND d.fx_reference_rate_id = 'a0350000-0000-4000-8000-000000000002'
      FROM public.invoices i
      JOIN public.fx_booking_rate_decisions d ON d.id = i.fx_decision_id
      WHERE i.id = v_invoice_id
    )
  );

  v_receipt_id := public.fx_create_governed_receipt_draft(
    'a0310000-0000-4000-8000-000000000001',
    'a0320000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'receipt_no', 'GA-REF-RCT-001',
      'receipt_date', '2026-07-24',
      'customer_id', 'a0330000-0000-4000-8000-000000000001',
      'customer_name', 'Gate A Customer',
      'payment_method', 'TT',
      'currency', 'USD',
      'exchange_rate', 999,
      'base_currency', 'MYR',
      'receipt_amount', 12.34,
      'base_amount', 999999,
      'bank_account_id', 'a0340000-0000-4000-8000-000000000001',
      'bank_account_name', 'Gate A Bank - GATE-A-001'
    ),
    NULL,
    FALSE,
    NULL,
    'a0350000-0000-4000-8000-000000000002'
  );

  PERFORM pg_temp.gatea_assert(
    'reference-selected Receipt snapshot/classification',
    (
      SELECT r.exchange_rate = 4.250000
        AND r.base_amount = 52.45
        AND d.source_category = 'REFERENCE_SELECTED'
        AND d.fx_reference_rate_id = 'a0350000-0000-4000-8000-000000000002'
      FROM public.receipts r
      JOIN public.fx_booking_rate_decisions d ON d.id = r.fx_decision_id
      WHERE r.id = v_receipt_id
    )
  );
END;
$$;

-- Legacy no-reference callers and exact BASE_PARITY remain valid.
DO $$
DECLARE
  v_invoice_id UUID;
  v_receipt_id UUID;
BEGIN
  v_invoice_id := public.fx_create_governed_invoice_draft(
    'a0310000-0000-4000-8000-000000000001',
    'a0320000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'invoice_no', 'GA-PAR-INV-001',
      'doc_type', 'Invoice',
      'invoice_date', '2026-07-24',
      'customer_id', 'a0330000-0000-4000-8000-000000000001',
      'customer_name', 'Gate A Customer',
      'currency', 'MYR',
      'exchange_rate', 1,
      'base_currency', 'MYR',
      'subtotal', 10,
      'tax_total', 0,
      'total_amount', 10,
      'base_total', 10
    )
  );

  v_receipt_id := public.fx_create_governed_receipt_draft(
    'a0310000-0000-4000-8000-000000000001',
    'a0320000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'receipt_no', 'GA-PAR-RCT-001',
      'receipt_date', '2026-07-24',
      'customer_id', 'a0330000-0000-4000-8000-000000000001',
      'customer_name', 'Gate A Customer',
      'payment_method', 'TT',
      'currency', 'MYR',
      'exchange_rate', 1,
      'base_currency', 'MYR',
      'receipt_amount', 10,
      'base_amount', 10,
      'bank_account_id', 'a0340000-0000-4000-8000-000000000001',
      'bank_account_name', 'Gate A Bank - GATE-A-001'
    )
  );

  PERFORM pg_temp.gatea_assert(
    'old Invoice caller remains BASE_PARITY',
    (
      SELECT d.source_category = 'BASE_PARITY'
      FROM public.invoices i
      JOIN public.fx_booking_rate_decisions d ON d.id = i.fx_decision_id
      WHERE i.id = v_invoice_id
    )
  );
  PERFORM pg_temp.gatea_assert(
    'old Receipt caller remains BASE_PARITY',
    (
      SELECT d.source_category = 'BASE_PARITY'
      FROM public.receipts r
      JOIN public.fx_booking_rate_decisions d ON d.id = r.fx_decision_id
      WHERE r.id = v_receipt_id
    )
  );
END;
$$;

SELECT pg_temp.gatea_assert_error(
  'base parity rejects a foreign reference id',
  $sql$
    SELECT public.fx_create_governed_invoice_draft(
      'a0310000-0000-4000-8000-000000000001',
      'a0320000-0000-4000-8000-000000000001',
      jsonb_build_object(
        'invoice_no', 'GA-PAR-BAD-001',
        'doc_type', 'Invoice',
        'invoice_date', '2026-07-24',
        'customer_id', 'a0330000-0000-4000-8000-000000000001',
        'customer_name', 'Gate A Customer',
        'currency', 'MYR',
        'exchange_rate', 1,
        'base_currency', 'MYR',
        'total_amount', 10
      ),
      NULL,
      '[]'::jsonb,
      FALSE,
      NULL,
      'a0350000-0000-4000-8000-000000000002'
    )
  $sql$,
  'BASE_PARITY must not use an FX reference'
);

-- Permitted Draft update paths record a fresh REFERENCE_SELECTED decision and
-- recalculate the base snapshot.
DO $$
DECLARE
  v_invoice_id UUID;
  v_receipt_id UUID;
BEGIN
  SELECT i.id INTO v_invoice_id
  FROM public.invoices i
  WHERE i.invoice_no = 'GA-PAR-INV-001';

  PERFORM public.fx_update_governed_invoice_fx(
    'a0310000-0000-4000-8000-000000000001',
    v_invoice_id,
    'a0320000-0000-4000-8000-000000000001',
    'USD',
    DATE '2026-07-24',
    1,
    FALSE,
    NULL,
    'a0350000-0000-4000-8000-000000000002'
  );

  PERFORM pg_temp.gatea_assert(
    'Draft Invoice reference update',
    (
      SELECT i.currency = 'USD'
        AND i.exchange_rate = 4.250000
        AND i.base_total = 42.50
        AND d.source_category = 'REFERENCE_SELECTED'
      FROM public.invoices i
      JOIN public.fx_booking_rate_decisions d ON d.id = i.fx_decision_id
      WHERE i.id = v_invoice_id
    )
  );

  SELECT r.id INTO v_receipt_id
  FROM public.receipts r
  WHERE r.receipt_no = 'GA-PAR-RCT-001';

  PERFORM public.fx_update_governed_receipt_fx(
    'a0310000-0000-4000-8000-000000000001',
    v_receipt_id,
    'a0320000-0000-4000-8000-000000000001',
    'USD',
    DATE '2026-07-24',
    1,
    FALSE,
    NULL,
    'a0350000-0000-4000-8000-000000000002'
  );

  PERFORM pg_temp.gatea_assert(
    'Draft Receipt reference update',
    (
      SELECT r.currency = 'USD'
        AND r.exchange_rate = 4.250000
        AND r.base_amount = 42.50
        AND d.source_category = 'REFERENCE_SELECTED'
      FROM public.receipts r
      JOIN public.fx_booking_rate_decisions d ON d.id = r.fx_decision_id
      WHERE r.id = v_receipt_id
    )
  );
END;
$$;

-- The accepted manual-override threshold and maker-checker contract remains
-- unchanged. These direct pure-function boundaries are exact NUMERIC checks.
SELECT pg_temp.gatea_assert(
  'manual deviation 0.50 percent is NotRequired',
  public.fx_booking_approval_status_for_deviation(0.50, 'MANUAL_OVERRIDE') = 'NotRequired'
);
SELECT pg_temp.gatea_assert(
  'manual deviation above 0.50 through 5 percent is Pending',
  public.fx_booking_approval_status_for_deviation(0.50000001, 'MANUAL_OVERRIDE') = 'Pending'
  AND public.fx_booking_approval_status_for_deviation(2.00, 'MANUAL_OVERRIDE') = 'Pending'
  AND public.fx_booking_approval_status_for_deviation(5.00, 'MANUAL_OVERRIDE') = 'Pending'
);
SELECT pg_temp.gatea_assert(
  'manual deviation above 5 percent is Rejected',
  public.fx_booking_approval_status_for_deviation(5.00000001, 'MANUAL_OVERRIDE') = 'Rejected'
);

DO $$
DECLARE
  v_invoice_2 UUID;
  v_invoice_3 UUID;
  v_decision_2 UUID;
  v_decision_3 UUID;
BEGIN
  v_invoice_2 := public.fx_create_governed_invoice_draft(
    'a0310000-0000-4000-8000-000000000001',
    'a0320000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'invoice_no', 'GA-MAN-INV-002',
      'doc_type', 'Invoice',
      'invoice_date', '2026-07-24',
      'customer_id', 'a0330000-0000-4000-8000-000000000001',
      'customer_name', 'Gate A Customer',
      'currency', 'USD',
      'exchange_rate', 4.08,
      'base_currency', 'MYR',
      'subtotal', 10,
      'tax_total', 0,
      'total_amount', 10
    ),
    '[]'::JSONB,
    TRUE,
    'Gate A two percent override'
  );
  SELECT fx_decision_id INTO v_decision_2
  FROM public.invoices WHERE id = v_invoice_2;

  PERFORM pg_temp.gatea_assert_error(
    'maker cannot approve own decision',
    format(
      'SELECT public.fx_approve_booking_decision(%L,%L,%L,%L)',
      v_decision_2,
      'a0320000-0000-4000-8000-000000000001',
      'a0310000-0000-4000-8000-000000000001',
      'AR Clerk'
    ),
    'maker cannot approve own decision'
  );

  PERFORM public.fx_approve_booking_decision(
    v_decision_2,
    'a0320000-0000-4000-8000-000000000002',
    'a0310000-0000-4000-8000-000000000001',
    'AR Supervisor'
  );

  v_invoice_3 := public.fx_create_governed_invoice_draft(
    'a0310000-0000-4000-8000-000000000001',
    'a0320000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'invoice_no', 'GA-MAN-INV-003',
      'doc_type', 'Invoice',
      'invoice_date', '2026-07-24',
      'customer_id', 'a0330000-0000-4000-8000-000000000001',
      'customer_name', 'Gate A Customer',
      'currency', 'USD',
      'exchange_rate', 4.12,
      'base_currency', 'MYR',
      'subtotal', 10,
      'tax_total', 0,
      'total_amount', 10
    ),
    '[]'::JSONB,
    TRUE,
    'Gate A three percent override'
  );
  SELECT fx_decision_id INTO v_decision_3
  FROM public.invoices WHERE id = v_invoice_3;

  PERFORM pg_temp.gatea_assert_error(
    'above two percent rejects Supervisor',
    format(
      'SELECT public.fx_approve_booking_decision(%L,%L,%L,%L)',
      v_decision_3,
      'a0320000-0000-4000-8000-000000000002',
      'a0310000-0000-4000-8000-000000000001',
      'AR Supervisor'
    ),
    'Finance Manager approval required'
  );

  PERFORM pg_temp.gatea_assert_error(
    'Auditor alone cannot approve',
    format(
      'SELECT public.fx_approve_booking_decision(%L,%L,%L,%L)',
      v_decision_3,
      'a0320000-0000-4000-8000-000000000004',
      'a0310000-0000-4000-8000-000000000001',
      'Auditor'
    ),
    'Finance Manager approval required'
  );

  PERFORM public.fx_approve_booking_decision(
    v_decision_3,
    'a0320000-0000-4000-8000-000000000003',
    'a0310000-0000-4000-8000-000000000001',
    'Finance Manager'
  );

  PERFORM pg_temp.gatea_assert(
    'two and three percent maker-checker approvals preserve roles',
    (
      SELECT count(*) = 2
      FROM public.fx_booking_rate_decisions
      WHERE id IN (v_decision_2, v_decision_3)
        AND approval_status = 'Approved'
    )
  );
END;
$$;

SELECT pg_temp.gatea_assert_error(
  'manual override reason shorter than five rejected',
  $sql$
    SELECT public.fx_create_governed_invoice_draft(
      'a0310000-0000-4000-8000-000000000001',
      'a0320000-0000-4000-8000-000000000001',
      jsonb_build_object(
        'invoice_no', 'GA-MAN-BAD-001',
        'doc_type', 'Invoice',
        'invoice_date', '2026-07-24',
        'customer_id', 'a0330000-0000-4000-8000-000000000001',
        'customer_name', 'Gate A Customer',
        'currency', 'USD',
        'exchange_rate', 4.08,
        'base_currency', 'MYR',
        'subtotal', 10,
        'tax_total', 0,
        'total_amount', 10
      ),
      '[]'::jsonb,
      TRUE,
      'bad'
    )
  $sql$,
  'manual override reason is required'
);

-- No fixture or mutation survives this test.
ROLLBACK;
