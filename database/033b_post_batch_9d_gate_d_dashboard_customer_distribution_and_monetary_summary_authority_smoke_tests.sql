-- Gate D rollback-only database smoke tests.
-- Run on a disposable local database after migrations through 033.

BEGIN;

CREATE FUNCTION pg_temp.gated_assert(p_name TEXT, p_condition BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION 'FAIL: %', p_name;
  END IF;
  RAISE NOTICE 'PASS: %', p_name;
END;
$$;

INSERT INTO public.companies (
  id, company_code, company_name, base_currency, country
)
VALUES
  ('d0330000-0000-4000-8000-000000000001', 'GATED33A',
   'Gate D Company A', 'MYR', 'MY'),
  ('d0330000-0000-4000-8000-000000000002', 'GATED33B',
   'Gate D Company B', 'MYR', 'MY');

INSERT INTO public.user_roles (
  id, user_id, company_id, role, is_active
)
VALUES
  ('d0330100-0000-4000-8000-000000000001',
   'd0330200-0000-4000-8000-000000000001',
   'd0330000-0000-4000-8000-000000000001', 'Finance Manager', true),
  ('d0330100-0000-4000-8000-000000000002',
   'd0330200-0000-4000-8000-000000000002',
   'd0330000-0000-4000-8000-000000000001', 'AR Clerk', true),
  ('d0330100-0000-4000-8000-000000000003',
   'd0330200-0000-4000-8000-000000000003',
   'd0330000-0000-4000-8000-000000000002', 'Finance Manager', true);

INSERT INTO public.gl_accounts (
  id, company_id, account_code, account_name, account_type
)
VALUES (
  'd0330300-0000-4000-8000-000000000001',
  'd0330000-0000-4000-8000-000000000001',
  '1000', 'Gate D Bank', 'Asset'
);

INSERT INTO public.bank_accounts (
  id, company_id, bank_name, account_name, account_no, currency, gl_account_id
)
VALUES (
  'd0330400-0000-4000-8000-000000000001',
  'd0330000-0000-4000-8000-000000000001',
  'Gate D Bank', 'Gate D Account', 'GATED-001', 'MYR',
  'd0330300-0000-4000-8000-000000000001'
);

INSERT INTO public.customers (
  id, company_id, customer_id, customer_name, customer_type, status,
  bill_addr_line1, bill_city, bill_state, bill_postal, bill_country,
  contact_name, contact_phone, contact_email, credit_rating,
  is_deleted, is_hidden
)
SELECT
  ('d0331' || LPAD(gs::TEXT, 3, '0') || '-0000-4000-8000-000000000001')::UUID,
  'd0330000-0000-4000-8000-000000000001',
  'GD-' || LPAD(gs::TEXT, 3, '0'),
  'Gate D Customer ' || gs::TEXT,
  'Corporate',
  (ARRAY['Active', 'Inactive', 'Blocked', 'On Hold'])[(gs % 4) + 1],
  gs::TEXT || ' Test Road', 'KL', 'KL', '50000', 'MY',
  'Contact ' || gs::TEXT, '60000' || gs::TEXT,
  'gate-d-' || gs::TEXT || '@example.test',
  (ARRAY['AAA', 'AA', 'A', 'B', 'C', 'D'])[gs],
  false, false
FROM generate_series(1, 6) gs;

INSERT INTO public.customers (
  id, company_id, customer_id, customer_name, customer_type, status,
  bill_addr_line1, bill_city, bill_state, bill_postal, bill_country,
  contact_name, contact_phone, contact_email, credit_rating,
  is_deleted, is_hidden
)
VALUES
  ('d0332000-0000-4000-8000-000000000001',
   'd0330000-0000-4000-8000-000000000001', 'GD-HID',
   'Gate D Hidden', 'Corporate', 'Active', '7 Test Road', 'KL', 'KL',
   '50000', 'MY', 'Hidden Contact', '600007', 'hidden@example.test',
   'AAA', false, true),
  ('d0332000-0000-4000-8000-000000000002',
   'd0330000-0000-4000-8000-000000000001', 'GD-DEL',
   'Gate D Deleted', 'Corporate', 'Active', '8 Test Road', 'KL', 'KL',
   '50000', 'MY', 'Deleted Contact', '600008', 'deleted@example.test',
   'AAA', true, false),
  ('d0332000-0000-4000-8000-000000000003',
   'd0330000-0000-4000-8000-000000000002', 'GD-OTHER',
   'Gate D Other Tenant', 'Corporate', 'Active', '9 Test Road', 'KL', 'KL',
   '50000', 'MY', 'Other Contact', '600009', 'other@example.test',
   'AAA', false, false);

INSERT INTO public.user_customer_assignments (
  id, user_id, customer_id, company_id, assigned_by, is_active
)
VALUES
  ('d0332100-0000-4000-8000-000000000001',
   'd0330200-0000-4000-8000-000000000002',
   'd0331001-0000-4000-8000-000000000001',
   'd0330000-0000-4000-8000-000000000001',
   'd0330200-0000-4000-8000-000000000001', true),
  ('d0332100-0000-4000-8000-000000000002',
   'd0330200-0000-4000-8000-000000000002',
   'd0331006-0000-4000-8000-000000000001',
   'd0330000-0000-4000-8000-000000000001',
   'd0330200-0000-4000-8000-000000000001', true);

WITH company_result AS (
  SELECT public.get_ar_dashboard_metrics(
    'd0330000-0000-4000-8000-000000000001',
    'd0330200-0000-4000-8000-000000000001',
    'company',
    '2026-01-31',
    6
  ) AS value
),
distribution AS (
  SELECT value->'customer_credit_rating_distribution' AS value
  FROM company_result
)
SELECT pg_temp.gated_assert(
  'Dashboard exact visible-customer population, statuses, ratings and order',
  value->>'population' = 'VISIBLE_CUSTOMERS'
    AND value->'included_statuses'
      = '["Active","Inactive","Blocked","On Hold"]'::JSONB
    AND JSONB_ARRAY_LENGTH(value->'rows') = 6
    AND (
      SELECT JSONB_AGG(row->>'rating' ORDER BY ordinal)
      FROM JSONB_ARRAY_ELEMENTS(value->'rows') WITH ORDINALITY AS r(row, ordinal)
    ) = '["AAA","AA","A","B","C","D"]'::JSONB
    AND (
      SELECT SUM((row->>'customer_count')::INTEGER)
      FROM JSONB_ARRAY_ELEMENTS(value->'rows') row
    ) = 6
)
FROM distribution;

WITH assigned_result AS (
  SELECT public.get_ar_dashboard_metrics(
    'd0330000-0000-4000-8000-000000000001',
    'd0330200-0000-4000-8000-000000000002',
    'assigned',
    '2026-01-31',
    6
  ) AS value
)
SELECT pg_temp.gated_assert(
  'Dashboard assignment population equals equivalent customer-list total',
  (
    SELECT SUM((row->>'customer_count')::INTEGER)
    FROM assigned_result,
      LATERAL JSONB_ARRAY_ELEMENTS(
        value->'customer_credit_rating_distribution'->'rows'
      ) row
  ) = (
    SELECT COUNT(*)
    FROM public.customers c
    WHERE c.company_id = 'd0330000-0000-4000-8000-000000000001'
      AND c.is_deleted = false
      AND c.is_hidden = false
      AND c.status IN ('Active', 'Inactive', 'Blocked', 'On Hold')
      AND EXISTS (
        SELECT 1
        FROM public.user_customer_assignments uca
        WHERE uca.company_id = c.company_id
          AND uca.customer_id = c.id
          AND uca.user_id = 'd0330200-0000-4000-8000-000000000002'
          AND uca.is_active = true
      )
  )
    AND (
      SELECT (row->>'customer_count')::INTEGER
      FROM assigned_result,
        LATERAL JSONB_ARRAY_ELEMENTS(
          value->'customer_credit_rating_distribution'->'rows'
        ) row
      WHERE row->>'rating' = 'AA'
    ) = 0
);

INSERT INTO public.exchange_rates (
  id, company_id, from_currency, to_currency, rate, effective_date
)
VALUES
  ('d0333000-0000-4000-8000-000000000001',
   'd0330000-0000-4000-8000-000000000001',
   'USD', 'MYR', 4.250000, '2026-01-01'),
  ('d0333000-0000-4000-8000-000000000002',
   'd0330000-0000-4000-8000-000000000001',
   'USD', 'MYR', 4.200000, '2026-01-02');

INSERT INTO public.fx_reference_rates (
  id, company_id, from_currency, to_currency, rate, effective_date,
  provider, fetched_at, status
)
VALUES (
  'd0333100-0000-4000-8000-000000000001',
  'd0330000-0000-4000-8000-000000000001',
  'USD', 'MYR', 4.25000000, '2026-01-01',
  'gate_d_provider', '2026-01-01 01:00:00+00', 'Active'
);

-- Rollback-only reporting fixtures bypass mutation triggers. The test restores
-- origin mode immediately; no fixture can survive the final ROLLBACK.
SET LOCAL session_replication_role = replica;

INSERT INTO public.invoices (
  id, company_id, invoice_no, doc_type, invoice_date, due_date,
  customer_id, customer_name, currency, exchange_rate, base_currency,
  subtotal, total_amount, base_total, outstanding, status
)
SELECT
  ('d0334' || LPAD(gs::TEXT, 3, '0') || '-0000-4000-8000-000000000001')::UUID,
  'd0330000-0000-4000-8000-000000000001',
  CASE
    WHEN gs = 2 THEN 'GD-CN-002'
    WHEN gs = 3 THEN 'GD-DN-003'
    ELSE 'GD-INV-' || LPAD(gs::TEXT, 3, '0')
  END,
  CASE WHEN gs = 2 THEN 'Credit Note'
       WHEN gs = 3 THEN 'Debit Note'
       ELSE 'Invoice' END,
  '2026-01-10', '2026-01-31',
  'd0331001-0000-4000-8000-000000000001',
  'Gate D Customer 1',
  CASE WHEN gs = 1 THEN 'MYR' ELSE 'USD' END,
  CASE WHEN gs IN (1, 6) THEN 1 ELSE 4.25 END,
  'MYR',
  CASE WHEN gs = 2 THEN -10 ELSE 10 END,
  CASE WHEN gs = 2 THEN -10 ELSE 10 END,
  CASE WHEN gs IN (1, 6) THEN 10
       WHEN gs = 2 THEN -42.50
       ELSE 42.50 END,
  5,
  'Open'
FROM generate_series(1, 12) gs;

INSERT INTO public.receipts (
  id, company_id, receipt_no, receipt_date, customer_id, customer_name,
  payment_method, currency, exchange_rate, base_currency,
  receipt_amount, base_amount, allocated_amount, unallocated_amount,
  bank_account_id, bank_account_name, status
)
SELECT
  ('d0335' || LPAD(gs::TEXT, 3, '0') || '-0000-4000-8000-000000000001')::UUID,
  'd0330000-0000-4000-8000-000000000001',
  'GD-RCT-' || LPAD(gs::TEXT, 3, '0'),
  '2026-01-10',
  'd0331001-0000-4000-8000-000000000001',
  'Gate D Customer 1', 'TT',
  CASE WHEN gs = 1 THEN 'MYR' ELSE 'USD' END,
  CASE WHEN gs IN (1, 6) THEN 1 ELSE 4.25 END,
  'MYR', 10,
  CASE WHEN gs IN (1, 6) THEN 10 ELSE 42.50 END,
  CASE WHEN gs = 2 THEN 10 ELSE 5 END,
  CASE WHEN gs = 2 THEN 0 ELSE 5 END,
  'd0330400-0000-4000-8000-000000000001',
  'Gate D Account',
  CASE WHEN gs = 11 THEN 'Cancelled'
       WHEN gs = 12 THEN 'Bounced'
       ELSE 'Posted' END
FROM generate_series(1, 12) gs;

INSERT INTO public.fx_booking_rate_decisions (
  id, company_id, invoice_id, receipt_id, root_decision_id,
  source_category, exchange_rate_id, fx_reference_rate_id,
  baseline_kind, baseline_rate, baseline_exchange_rate_id,
  baseline_fx_reference_rate_id, from_currency, to_currency,
  transaction_date, booked_rate, suggested_rate, stale_reference,
  approval_status, lifecycle_status, maker_user_id, checker_user_id,
  override_reason, approved_by, approved_at, posted, posted_at
)
SELECT
  ('d0336' || LPAD(gs::TEXT, 3, '0') || '-0000-4000-8000-000000000001')::UUID,
  'd0330000-0000-4000-8000-000000000001',
  ('d0334' || LPAD(gs::TEXT, 3, '0') || '-0000-4000-8000-000000000001')::UUID,
  NULL,
  ('d0336' || LPAD(gs::TEXT, 3, '0') || '-0000-4000-8000-000000000001')::UUID,
  CASE
    WHEN gs = 1 THEN 'BASE_PARITY'
    WHEN gs IN (2, 5, 7, 9, 10, 11, 12) THEN 'CATALOG'
    WHEN gs = 3 THEN 'REFERENCE_SELECTED'
    WHEN gs = 4 THEN 'MANUAL_OVERRIDE'
    ELSE 'LEGACY_UNVERIFIED'
  END,
  CASE WHEN gs IN (2, 5, 7, 9, 10, 11, 12)
    THEN 'd0333000-0000-4000-8000-000000000001'::UUID END,
  CASE WHEN gs = 3
    THEN 'd0333100-0000-4000-8000-000000000001'::UUID END,
  CASE WHEN gs = 1 THEN 'BASE_PARITY'
       WHEN gs IN (2, 4, 5, 7, 9, 10, 11, 12) THEN 'CATALOG'
       WHEN gs = 3 THEN 'REFERENCE'
       ELSE 'NONE' END,
  CASE WHEN gs = 1 THEN 1
       WHEN gs = 6 THEN 1
       WHEN gs IN (2, 3, 4, 5, 7, 9, 10, 11, 12) THEN 4.25 END,
  CASE WHEN gs IN (2, 4, 5, 7, 9, 10, 11, 12)
    THEN 'd0333000-0000-4000-8000-000000000001'::UUID END,
  CASE WHEN gs = 3
    THEN 'd0333100-0000-4000-8000-000000000001'::UUID END,
  CASE WHEN gs = 1 THEN 'MYR' ELSE 'USD' END,
  'MYR', '2026-01-10',
  CASE WHEN gs IN (1, 6) THEN 1 ELSE 4.25 END,
  CASE WHEN gs = 4 THEN 4.25 END,
  gs = 5,
  CASE WHEN gs = 4 THEN 'Approved'
       WHEN gs = 10 THEN 'Pending'
       WHEN gs = 11 THEN 'Rejected'
       ELSE 'NotRequired' END,
  CASE WHEN gs = 7 THEN 'Superseded'
       WHEN gs = 10 THEN 'Pending'
       WHEN gs = 11 THEN 'Rejected'
       ELSE 'Posted' END,
  CASE WHEN gs = 4
    THEN 'd0330200-0000-4000-8000-000000000002'::UUID END,
  CASE WHEN gs = 4
    THEN 'd0330200-0000-4000-8000-000000000001'::UUID END,
  CASE WHEN gs = 4 THEN 'Governed Gate D override' END,
  CASE WHEN gs = 4
    THEN 'd0330200-0000-4000-8000-000000000001'::UUID END,
  CASE WHEN gs = 4 THEN '2026-01-09 00:00:00+00'::TIMESTAMPTZ END,
  true, '2026-01-10 00:00:00+00'
FROM generate_series(1, 12) gs
WHERE gs <> 9;

INSERT INTO public.fx_booking_rate_decisions (
  id, company_id, receipt_id, root_decision_id,
  source_category, exchange_rate_id, fx_reference_rate_id,
  baseline_kind, baseline_rate, baseline_exchange_rate_id,
  baseline_fx_reference_rate_id, from_currency, to_currency,
  transaction_date, booked_rate, suggested_rate, stale_reference,
  approval_status, lifecycle_status, maker_user_id, checker_user_id,
  override_reason, approved_by, approved_at, posted, posted_at
)
SELECT
  ('d0337' || LPAD(gs::TEXT, 3, '0') || '-0000-4000-8000-000000000001')::UUID,
  'd0330000-0000-4000-8000-000000000001',
  ('d0335' || LPAD(gs::TEXT, 3, '0') || '-0000-4000-8000-000000000001')::UUID,
  ('d0337' || LPAD(gs::TEXT, 3, '0') || '-0000-4000-8000-000000000001')::UUID,
  CASE
    WHEN gs = 1 THEN 'BASE_PARITY'
    WHEN gs IN (2, 5, 7, 9, 10, 11, 12) THEN 'CATALOG'
    WHEN gs = 3 THEN 'REFERENCE_SELECTED'
    WHEN gs = 4 THEN 'MANUAL_OVERRIDE'
    ELSE 'LEGACY_UNVERIFIED'
  END,
  CASE WHEN gs IN (2, 5, 7, 9, 10, 11, 12)
    THEN 'd0333000-0000-4000-8000-000000000001'::UUID END,
  CASE WHEN gs = 3
    THEN 'd0333100-0000-4000-8000-000000000001'::UUID END,
  CASE WHEN gs = 1 THEN 'BASE_PARITY'
       WHEN gs IN (2, 4, 5, 7, 9, 10, 11, 12) THEN 'CATALOG'
       WHEN gs = 3 THEN 'REFERENCE'
       ELSE 'NONE' END,
  CASE WHEN gs = 1 THEN 1
       WHEN gs = 6 THEN 1
       WHEN gs IN (2, 3, 4, 5, 7, 9, 10, 11, 12) THEN 4.25 END,
  CASE WHEN gs IN (2, 4, 5, 7, 9, 10, 11, 12)
    THEN 'd0333000-0000-4000-8000-000000000001'::UUID END,
  CASE WHEN gs = 3
    THEN 'd0333100-0000-4000-8000-000000000001'::UUID END,
  CASE WHEN gs = 1 THEN 'MYR' ELSE 'USD' END,
  'MYR', '2026-01-10',
  CASE WHEN gs IN (1, 6) THEN 1 ELSE 4.25 END,
  CASE WHEN gs = 4 THEN 4.25 END,
  gs = 5,
  CASE WHEN gs = 4 THEN 'Approved'
       WHEN gs = 10 THEN 'Pending'
       WHEN gs = 11 THEN 'Rejected'
       ELSE 'NotRequired' END,
  CASE WHEN gs = 7 THEN 'Superseded'
       WHEN gs = 10 THEN 'Pending'
       WHEN gs = 11 THEN 'Rejected'
       ELSE 'Posted' END,
  CASE WHEN gs = 4
    THEN 'd0330200-0000-4000-8000-000000000002'::UUID END,
  CASE WHEN gs = 4
    THEN 'd0330200-0000-4000-8000-000000000001'::UUID END,
  CASE WHEN gs = 4 THEN 'Governed Gate D override' END,
  CASE WHEN gs = 4
    THEN 'd0330200-0000-4000-8000-000000000001'::UUID END,
  CASE WHEN gs = 4 THEN '2026-01-09 00:00:00+00'::TIMESTAMPTZ END,
  true, '2026-01-10 00:00:00+00'
FROM generate_series(1, 12) gs
WHERE gs <> 9;

UPDATE public.invoices i
SET
  fx_decision_id = CASE
    WHEN i.id = 'd0334009-0000-4000-8000-000000000001' THEN NULL
    ELSE (
      'd0336' || SUBSTRING(i.id::TEXT FROM 6 FOR 3)
        || '-0000-4000-8000-000000000001'
    )::UUID
  END,
  fx_source_category = CASE
    WHEN i.id = 'd0334009-0000-4000-8000-000000000001' THEN NULL
    WHEN i.id IN (
      'd0334006-0000-4000-8000-000000000001',
      'd0334008-0000-4000-8000-000000000001'
    ) THEN 'LEGACY_UNVERIFIED'
    WHEN i.id = 'd0334001-0000-4000-8000-000000000001'
      THEN 'BASE_PARITY'
    WHEN i.id = 'd0334003-0000-4000-8000-000000000001'
      THEN 'REFERENCE_SELECTED'
    WHEN i.id = 'd0334004-0000-4000-8000-000000000001'
      THEN 'MANUAL_OVERRIDE'
    WHEN i.id = 'd0334012-0000-4000-8000-000000000001'
      THEN 'MANUAL_OVERRIDE'
    ELSE 'CATALOG'
  END
WHERE i.company_id = 'd0330000-0000-4000-8000-000000000001';

UPDATE public.receipts r
SET
  fx_decision_id = CASE
    WHEN r.id = 'd0335009-0000-4000-8000-000000000001' THEN NULL
    ELSE (
      'd0337' || SUBSTRING(r.id::TEXT FROM 6 FOR 3)
        || '-0000-4000-8000-000000000001'
    )::UUID
  END,
  fx_source_category = CASE
    WHEN r.id = 'd0335009-0000-4000-8000-000000000001' THEN NULL
    WHEN r.id IN (
      'd0335006-0000-4000-8000-000000000001',
      'd0335008-0000-4000-8000-000000000001'
    ) THEN 'LEGACY_UNVERIFIED'
    WHEN r.id = 'd0335001-0000-4000-8000-000000000001'
      THEN 'BASE_PARITY'
    WHEN r.id = 'd0335003-0000-4000-8000-000000000001'
      THEN 'REFERENCE_SELECTED'
    WHEN r.id = 'd0335004-0000-4000-8000-000000000001'
      THEN 'MANUAL_OVERRIDE'
    WHEN r.id = 'd0335012-0000-4000-8000-000000000001'
      THEN 'MANUAL_OVERRIDE'
    ELSE 'CATALOG'
  END
WHERE r.company_id = 'd0330000-0000-4000-8000-000000000001';

SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  'd0330200-0000-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"d0330200-0000-4000-8000-000000000001"}',
  true
);

WITH first_page AS (
  SELECT public.ar_invoice_collection(
    'd0330000-0000-4000-8000-000000000001',
    'd0330200-0000-4000-8000-000000000001',
    'company', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1
  ) AS value
),
second_page AS (
  SELECT public.ar_invoice_collection(
    'd0330000-0000-4000-8000-000000000001',
    'd0330200-0000-4000-8000-000000000001',
    'company', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 2, 1
  ) AS value
)
SELECT pg_temp.gated_assert(
  'Invoice v2 authority, unavailable categories and pagination independence',
  first_page.value->'summary' = second_page.value->'summary'
    AND JSONB_ARRAY_LENGTH(first_page.value->'rows') = 1
    AND first_page.value->'summary'->'current_balance_summary'->'meta'
      ->>'contract_version' = '2'
    AND (first_page.value->'summary'->'current_balance_summary'
      ->>'matching_document_count')::INTEGER = 12
    AND (first_page.value->'summary'->'current_balance_summary'
      ->>'authoritative_document_count')::INTEGER = 4
    AND (first_page.value->'summary'->'current_balance_summary'
      ->>'unavailable_count')::INTEGER = 8
    AND NOT (first_page.value->'summary'->'current_balance_summary'
      ->>'base_available')::BOOLEAN
    AND first_page.value->'summary'->'current_balance_summary'
      ->>'amount_basis' = 'current_outstanding'
    AND first_page.value->'summary'->'document_total_summary'
      ->>'amount_basis' = 'original_document_total'
    AND JSONB_TYPEOF(first_page.value->'summary'->'current_balance_summary'
      ->'base_total') = 'string'
    AND first_page.value->'summary'->'current_balance_summary'
      ->'by_currency'->0->>'currency' = 'MYR'
    AND first_page.value->'summary'->'current_balance_summary'
      ->'by_currency'->1->>'currency' = 'USD'
    AND first_page.value->'summary'->'current_balance_summary'
      ->'by_currency'->0->>'amount' = '5.00'
    AND first_page.value->'summary'->'current_balance_summary'
      ->'by_currency'->1->>'amount' = '55.00'
    AND first_page.value->'summary'->'current_balance_summary'
      ->'by_currency'->1->>'base_amount' = '63.75'
    AND NOT (first_page.value->'summary'->'current_balance_summary'
      ->'by_currency'->1->>'base_available')::BOOLEAN
    AND first_page.value->'summary'->'current_balance_summary'
      ->>'base_total' = '68.75'
    AND first_page.value->'summary'->'document_total_summary'
      ->>'base_total' = '52.50'
    AND (first_page.value->'summary'->'current_balance_summary'
      ->'unavailable_by_currency'->0->>'document_count')::INTEGER = 8
)
FROM first_page CROSS JOIN second_page;

WITH authority_cases(search_text, expected_authoritative) AS (
  VALUES
    ('GD-INV-001'::TEXT, true),
    ('GD-CN-002', true),
    ('GD-DN-003', true),
    ('GD-INV-004', true),
    ('GD-INV-005', false), -- stale
    ('GD-INV-006', false), -- LEGACY_UNVERIFIED rate 1
    ('GD-INV-007', false), -- superseded
    ('GD-INV-008', false), -- LEGACY_UNVERIFIED plausible non-1
    ('GD-INV-009', false), -- no decision
    ('GD-INV-010', false), -- pending
    ('GD-INV-011', false), -- rejected
    ('GD-INV-012', false)  -- inconsistent transaction source snapshot
),
evaluated AS (
  SELECT
    ac.expected_authoritative,
    public.ar_invoice_collection(
      'd0330000-0000-4000-8000-000000000001',
      'd0330200-0000-4000-8000-000000000001',
      'company', NULL, NULL, NULL, NULL, NULL, NULL, ac.search_text, 1, 50
    ) AS value
  FROM authority_cases ac
)
SELECT pg_temp.gated_assert(
  'Invoice each governed and unavailable authority category',
  BOOL_AND(
    (value->'summary'->'current_balance_summary'
      ->>'matching_document_count')::INTEGER = 1
    AND (value->'summary'->'current_balance_summary'
      ->>'authoritative_document_count')::INTEGER
        = CASE WHEN expected_authoritative THEN 1 ELSE 0 END
    AND (value->'summary'->'current_balance_summary'
      ->>'unavailable_count')::INTEGER
        = CASE WHEN expected_authoritative THEN 0 ELSE 1 END
  )
)
FROM evaluated;

WITH credit_note AS (
  SELECT public.ar_invoice_collection(
    'd0330000-0000-4000-8000-000000000001',
    'd0330200-0000-4000-8000-000000000001',
    'company', 'Credit Note', NULL, NULL, NULL, NULL, NULL, NULL, 1, 50
  ) AS value
),
debit_note AS (
  SELECT public.ar_invoice_collection(
    'd0330000-0000-4000-8000-000000000001',
    'd0330200-0000-4000-8000-000000000001',
    'company', 'Debit Note', NULL, NULL, NULL, NULL, NULL, NULL, 1, 50
  ) AS value
)
SELECT pg_temp.gated_assert(
  'Invoice Credit Note negative and Debit Note sign semantics',
  credit_note.value->'summary'->'document_total_summary'
    ->'by_currency'->0->>'amount' = '-10.00'
    AND debit_note.value->'summary'->'document_total_summary'
      ->'by_currency'->0->>'amount' = '10.00'
)
FROM credit_note CROSS JOIN debit_note;

WITH empty_result AS (
  SELECT public.ar_invoice_collection(
    'd0330000-0000-4000-8000-000000000001',
    'd0330200-0000-4000-8000-000000000001',
    'company', NULL, NULL, NULL, NULL, '2099-01-01', NULL, NULL, 1, 50
  ) AS value
),
unavailable_result AS (
  SELECT public.ar_invoice_collection(
    'd0330000-0000-4000-8000-000000000001',
    'd0330200-0000-4000-8000-000000000001',
    'company', NULL, NULL, NULL, NULL, NULL, NULL, 'GD-INV-006', 1, 50
  ) AS value
)
SELECT pg_temp.gated_assert(
  'Invoice empty and all-unavailable semantics',
  empty_result.value->'summary'->'current_balance_summary'
    ->>'base_total' = '0.00'
    AND (empty_result.value->'summary'->'current_balance_summary'
      ->>'base_available')::BOOLEAN
    AND empty_result.value->'summary'->'current_balance_summary'
      ->>'matching_document_count' = '0'
    AND empty_result.value->'summary'->'current_balance_summary'
      ->'by_currency' = '[]'::JSONB
    AND empty_result.value->'summary'->'current_balance_summary'
      ->'unavailable_by_currency' = '[]'::JSONB
    AND unavailable_result.value->'summary'->'current_balance_summary'
      ->'base_total' = 'null'::JSONB
    AND NOT (unavailable_result.value->'summary'->'current_balance_summary'
      ->>'base_available')::BOOLEAN
)
FROM empty_result CROSS JOIN unavailable_result;

WITH first_page AS (
  SELECT public.ar_receipt_collection(
    'd0330000-0000-4000-8000-000000000001',
    'd0330200-0000-4000-8000-000000000001',
    'company', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1
  ) AS value
),
second_page AS (
  SELECT public.ar_receipt_collection(
    'd0330000-0000-4000-8000-000000000001',
    'd0330200-0000-4000-8000-000000000001',
    'company', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 2, 1
  ) AS value
)
SELECT pg_temp.gated_assert(
  'Receipt v2 authority, current-unallocated basis and pagination independence',
  first_page.value->'summary' = second_page.value->'summary'
    AND (first_page.value->'summary'->'current_balance_summary'
      ->>'matching_document_count')::INTEGER = 12
    AND (first_page.value->'summary'->'current_balance_summary'
      ->>'authoritative_document_count')::INTEGER = 4
    AND (first_page.value->'summary'->'current_balance_summary'
      ->>'unavailable_count')::INTEGER = 8
    AND first_page.value->'summary'->'current_balance_summary'
      ->>'amount_basis' = 'current_unallocated'
    AND first_page.value->'summary'->'document_total_summary'
      ->>'amount_basis' = 'original_document_total'
    AND first_page.value->'summary'->'current_balance_summary'
      ->'by_currency'->0->>'currency' = 'MYR'
    AND first_page.value->'summary'->'current_balance_summary'
      ->'by_currency'->1->>'currency' = 'USD'
    AND first_page.value->'summary'->'current_balance_summary'
      ->'by_currency'->0->>'amount' = '5.00'
    AND first_page.value->'summary'->'current_balance_summary'
      ->'by_currency'->1->>'amount' = '50.00'
    AND first_page.value->'summary'->'current_balance_summary'
      ->'by_currency'->1->>'base_amount' = '42.50'
    AND NOT (first_page.value->'summary'->'current_balance_summary'
      ->'by_currency'->1->>'base_available')::BOOLEAN
    AND first_page.value->'summary'->'current_balance_summary'
      ->>'base_total' = '47.50'
    AND first_page.value->'summary'->'document_total_summary'
      ->>'base_total' = '137.50'
)
FROM first_page CROSS JOIN second_page;

WITH authority_cases(search_text, expected_authoritative) AS (
  VALUES
    ('GD-RCT-001'::TEXT, true),
    ('GD-RCT-002', true),
    ('GD-RCT-003', true),
    ('GD-RCT-004', true),
    ('GD-RCT-005', false), -- stale
    ('GD-RCT-006', false), -- LEGACY_UNVERIFIED rate 1
    ('GD-RCT-007', false), -- superseded
    ('GD-RCT-008', false), -- LEGACY_UNVERIFIED plausible non-1
    ('GD-RCT-009', false), -- no decision
    ('GD-RCT-010', false), -- pending
    ('GD-RCT-011', false), -- rejected / cancelled
    ('GD-RCT-012', false)  -- inconsistent source / bounced
),
evaluated AS (
  SELECT
    ac.expected_authoritative,
    public.ar_receipt_collection(
      'd0330000-0000-4000-8000-000000000001',
      'd0330200-0000-4000-8000-000000000001',
      'company', NULL, NULL, NULL, NULL, NULL, NULL, ac.search_text, 1, 50
    ) AS value
  FROM authority_cases ac
)
SELECT pg_temp.gated_assert(
  'Receipt each governed and unavailable authority category',
  BOOL_AND(
    (value->'summary'->'current_balance_summary'
      ->>'matching_document_count')::INTEGER = 1
    AND (value->'summary'->'current_balance_summary'
      ->>'authoritative_document_count')::INTEGER
        = CASE WHEN expected_authoritative THEN 1 ELSE 0 END
    AND (value->'summary'->'current_balance_summary'
      ->>'unavailable_count')::INTEGER
        = CASE WHEN expected_authoritative THEN 0 ELSE 1 END
  )
)
FROM evaluated;

WITH cancelled AS (
  SELECT public.ar_receipt_collection(
    'd0330000-0000-4000-8000-000000000001',
    'd0330200-0000-4000-8000-000000000001',
    'company', 'Cancelled', NULL, NULL, NULL, NULL, NULL, NULL, 1, 50
  ) AS value
),
bounced AS (
  SELECT public.ar_receipt_collection(
    'd0330000-0000-4000-8000-000000000001',
    'd0330200-0000-4000-8000-000000000001',
    'company', 'Bounced', NULL, NULL, NULL, NULL, NULL, NULL, 1, 50
  ) AS value
)
SELECT pg_temp.gated_assert(
  'Receipt existing cancelled and bounced filtering semantics',
  (cancelled.value->>'total')::INTEGER = 1
    AND (bounced.value->>'total')::INTEGER = 1
)
FROM cancelled CROSS JOIN bounced;

WITH empty_result AS (
  SELECT public.ar_receipt_collection(
    'd0330000-0000-4000-8000-000000000001',
    'd0330200-0000-4000-8000-000000000001',
    'company', NULL, NULL, NULL, NULL, '2099-01-01', NULL, NULL, 1, 50
  ) AS value
),
unavailable_result AS (
  SELECT public.ar_receipt_collection(
    'd0330000-0000-4000-8000-000000000001',
    'd0330200-0000-4000-8000-000000000001',
    'company', NULL, NULL, NULL, NULL, NULL, NULL, 'GD-RCT-006', 1, 50
  ) AS value
)
SELECT pg_temp.gated_assert(
  'Receipt empty and all-unavailable semantics',
  empty_result.value->'summary'->'current_balance_summary'
    ->>'base_total' = '0.00'
    AND empty_result.value->'summary'->'current_balance_summary'
      ->>'matching_document_count' = '0'
    AND empty_result.value->'summary'->'current_balance_summary'
      ->'by_currency' = '[]'::JSONB
    AND unavailable_result.value->'summary'->'current_balance_summary'
      ->'base_total' = 'null'::JSONB
)
FROM empty_result CROSS JOIN unavailable_result;

RESET ROLE;
SET LOCAL session_replication_role = replica;

UPDATE public.invoices
SET status = 'Draft'
WHERE id = 'd0334002-0000-4000-8000-000000000001';

UPDATE public.fx_booking_rate_decisions
SET
  lifecycle_status = 'Draft',
  posted = false,
  posted_at = NULL
WHERE id = 'd0336002-0000-4000-8000-000000000001';

UPDATE public.receipts
SET status = 'Draft'
WHERE id = 'd0335002-0000-4000-8000-000000000001';

UPDATE public.fx_booking_rate_decisions
SET
  lifecycle_status = 'Draft',
  posted = false,
  posted_at = NULL
WHERE id = 'd0337002-0000-4000-8000-000000000001';

SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;

WITH draft_results AS (
  SELECT
    public.ar_invoice_collection(
      'd0330000-0000-4000-8000-000000000001',
      'd0330200-0000-4000-8000-000000000001',
      'company', NULL, NULL, NULL, NULL, NULL, NULL, 'GD-CN-002', 1, 50
    ) AS invoice_value,
    public.ar_receipt_collection(
      'd0330000-0000-4000-8000-000000000001',
      'd0330200-0000-4000-8000-000000000001',
      'company', NULL, NULL, NULL, NULL, NULL, NULL, 'GD-RCT-002', 1, 50
    ) AS receipt_value
)
SELECT pg_temp.gated_assert(
  'Draft transactions require a current unposted Draft decision lifecycle',
  (invoice_value->'summary'->'current_balance_summary'
    ->>'authoritative_document_count')::INTEGER = 1
    AND (receipt_value->'summary'->'current_balance_summary'
      ->>'authoritative_document_count')::INTEGER = 1
)
FROM draft_results;

RESET ROLE;
SET LOCAL session_replication_role = replica;

UPDATE public.invoices
SET status = 'Open'
WHERE id = 'd0334002-0000-4000-8000-000000000001';

UPDATE public.receipts
SET status = 'Posted'
WHERE id = 'd0335002-0000-4000-8000-000000000001';

SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;

WITH non_draft_results AS (
  SELECT
    public.ar_invoice_collection(
      'd0330000-0000-4000-8000-000000000001',
      'd0330200-0000-4000-8000-000000000001',
      'company', NULL, NULL, NULL, NULL, NULL, NULL, 'GD-CN-002', 1, 50
    ) AS invoice_value,
    public.ar_receipt_collection(
      'd0330000-0000-4000-8000-000000000001',
      'd0330200-0000-4000-8000-000000000001',
      'company', NULL, NULL, NULL, NULL, NULL, NULL, 'GD-RCT-002', 1, 50
    ) AS receipt_value
)
SELECT pg_temp.gated_assert(
  'Non-Draft transactions reject a non-Posted decision lifecycle',
  (invoice_value->'summary'->'current_balance_summary'
    ->>'unavailable_count')::INTEGER = 1
    AND (receipt_value->'summary'->'current_balance_summary'
      ->>'unavailable_count')::INTEGER = 1
)
FROM non_draft_results;

RESET ROLE;

SELECT pg_temp.gated_assert(
  'Gate D exact function catalog properties',
  (
    SELECT COUNT(*)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles owner_role ON owner_role.oid = p.proowner
    WHERE n.nspname = 'public'
      AND (
        (
          p.proname = 'get_ar_dashboard_metrics'
          AND pg_get_function_identity_arguments(p.oid)
            = 'p_company_id uuid, p_user_id uuid, p_scope_mode text, p_as_of_date date, p_trend_months integer'
          AND p.pronargdefaults = 2
        )
        OR (
          p.proname = 'ar_invoice_collection'
          AND pg_get_function_identity_arguments(p.oid)
            = 'p_company_id uuid, p_user_id uuid, p_scope_mode text, p_doc_type text, p_status text, p_customer_id uuid, p_posting_period text, p_date_from date, p_date_to date, p_search text, p_page integer, p_page_size integer'
          AND p.pronargdefaults = 9
        )
        OR (
          p.proname = 'ar_receipt_collection'
          AND pg_get_function_identity_arguments(p.oid)
            = 'p_company_id uuid, p_user_id uuid, p_scope_mode text, p_status text, p_customer_id uuid, p_payment_method text, p_posting_period text, p_date_from date, p_date_to date, p_search text, p_page integer, p_page_size integer'
          AND p.pronargdefaults = 9
        )
      )
      AND owner_role.rolname = 'postgres'
      AND p.prosecdef = false
      AND p.provolatile = 's'
      AND p.proconfig = ARRAY['search_path=""']
  ) = 3
);

SELECT pg_temp.gated_assert(
  'Gate D grants and partial customer index',
  has_function_privilege(
    'service_role',
    'public.get_ar_dashboard_metrics(uuid,uuid,text,date,integer)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'authenticated',
      'public.get_ar_dashboard_metrics(uuid,uuid,text,date,integer)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.ar_invoice_collection(uuid,uuid,text,text,text,uuid,text,date,date,text,integer,integer)',
      'EXECUTE'
    )
    AND has_function_privilege(
      'authenticated',
      'public.ar_receipt_collection(uuid,uuid,text,text,uuid,text,text,date,date,text,integer,integer)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.ar_invoice_collection(uuid,uuid,text,text,text,uuid,text,date,date,text,integer,integer)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.ar_receipt_collection(uuid,uuid,text,text,uuid,text,text,date,date,text,integer,integer)',
      'EXECUTE'
    )
    AND (
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'idx_customers_company_credit_rating_visible'
    ) LIKE '%(company_id, credit_rating, customer_id)%WHERE ((is_deleted = false) AND (is_hidden = false))%'
);

SELECT pg_temp.gated_assert(
  'Posted immutability triggers remain enabled',
  (
    SELECT COUNT(*) = 2 AND BOOL_AND(t.tgenabled = 'O')
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('invoices', 'receipts')
      AND t.tgname IN (
        'trg_fx_prevent_invoice_booked_fx_mutation',
        'trg_fx_prevent_receipt_booked_fx_mutation'
      )
  )
);

ROLLBACK;
