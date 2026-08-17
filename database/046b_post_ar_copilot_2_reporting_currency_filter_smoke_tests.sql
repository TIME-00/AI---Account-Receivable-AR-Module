-- Rollback-only local smoke for Migration 046.
-- Applies no persistent data change and must not be ledger-registered.

BEGIN;

CREATE FUNCTION pg_temp.copilot46_assert(p_name TEXT, p_condition BOOLEAN)
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
) VALUES (
  'c0460000-0000-4000-8000-000000000001',
  'COP46', 'Copilot 46 Local', 'MYR', 'MY'
);

INSERT INTO public.user_roles (id, user_id, company_id, role, is_active)
VALUES
  (
    'c0460100-0000-4000-8000-000000000001',
    'c0460200-0000-4000-8000-000000000001',
    'c0460000-0000-4000-8000-000000000001',
    'Finance Manager', true
  ),
  (
    'c0460100-0000-4000-8000-000000000002',
    'c0460200-0000-4000-8000-000000000002',
    'c0460000-0000-4000-8000-000000000001',
    'AR Clerk', true
  );

INSERT INTO public.customers (
  id, company_id, customer_id, customer_name, customer_type, status,
  bill_addr_line1, bill_city, bill_state, bill_postal, bill_country,
  contact_name, contact_phone, contact_email,
  credit_rating, is_deleted, is_hidden
) VALUES
  (
    'c0461000-0000-4000-8000-000000000001',
    'c0460000-0000-4000-8000-000000000001',
    'COP46-A', 'Assigned Customer', 'Corporate', 'Active',
    '1 Test Road', 'KL', 'KL', '50000', 'MY',
    'Test Contact A', '600000001', 'cop46-a@example.test',
    'A', false, false
  ),
  (
    'c0461000-0000-4000-8000-000000000002',
    'c0460000-0000-4000-8000-000000000001',
    'COP46-B', 'Unassigned Customer', 'Corporate', 'Active',
    '2 Test Road', 'KL', 'KL', '50000', 'MY',
    'Test Contact B', '600000002', 'cop46-b@example.test',
    'A', false, false
  );

INSERT INTO public.user_customer_assignments (
  id, user_id, customer_id, company_id, assigned_by, is_active
) VALUES (
  'c0461100-0000-4000-8000-000000000001',
  'c0460200-0000-4000-8000-000000000002',
  'c0461000-0000-4000-8000-000000000001',
  'c0460000-0000-4000-8000-000000000001',
  'c0460200-0000-4000-8000-000000000001', true
);

INSERT INTO public.gl_accounts (
  id, company_id, account_code, account_name, account_type
) VALUES (
  'c0462000-0000-4000-8000-000000000001',
  'c0460000-0000-4000-8000-000000000001',
  '1000', 'Copilot 46 Bank', 'Asset'
);

INSERT INTO public.bank_accounts (
  id, company_id, bank_name, account_name, account_no,
  currency, gl_account_id
) VALUES (
  'c0462100-0000-4000-8000-000000000001',
  'c0460000-0000-4000-8000-000000000001',
  'Test Bank', 'Copilot 46 Account', 'COP46-001',
  'MYR', 'c0462000-0000-4000-8000-000000000001'
);

-- Synthetic read fixtures intentionally bypass governed lifecycle triggers.
-- The setting is transaction-local and restored before any RPC assertion.
SET LOCAL session_replication_role = replica;

INSERT INTO public.invoices (
  id, company_id, invoice_no, doc_type, invoice_date, due_date,
  customer_id, customer_name, currency, exchange_rate, base_currency,
  subtotal, tax_total, total_amount, base_total, outstanding, status
) VALUES
  (
    'c0463000-0000-4000-8000-000000000001',
    'c0460000-0000-4000-8000-000000000001',
    'INV-C46-MYR', 'Invoice', '2026-08-14', '2026-09-14',
    'c0461000-0000-4000-8000-000000000001', 'Assigned Customer',
    'MYR', 1, 'MYR', 9000, 0, 9000, 9000, 9000, 'Draft'
  ),
  (
    'c0463000-0000-4000-8000-000000000002',
    'c0460000-0000-4000-8000-000000000001',
    'INV-C46-SGD-1', 'Invoice', '2026-08-13', '2026-09-13',
    'c0461000-0000-4000-8000-000000000001', 'Assigned Customer',
    'SGD', 3, 'MYR', 1000, 0, 1000, 3000, 1000, 'Draft'
  ),
  (
    'c0463000-0000-4000-8000-000000000003',
    'c0460000-0000-4000-8000-000000000001',
    'INV-C46-SGD-7', 'Invoice', '2026-08-01', '2026-09-01',
    'c0461000-0000-4000-8000-000000000001', 'Assigned Customer',
    'SGD', 3, 'MYR', 7000, 0, 7000, 21000, 7000, 'Draft'
  ),
  (
    'c0463000-0000-4000-8000-000000000004',
    'c0460000-0000-4000-8000-000000000001',
    'INV-C46-UNASSIGNED', 'Invoice', '2026-08-15', '2026-09-15',
    'c0461000-0000-4000-8000-000000000002', 'Unassigned Customer',
    'SGD', 3, 'MYR', 10000, 0, 10000, 30000, 10000, 'Draft'
  );

INSERT INTO public.receipts (
  id, company_id, receipt_no, receipt_date, customer_id, customer_name,
  payment_method, currency, exchange_rate, base_currency,
  receipt_amount, base_amount, allocated_amount, unallocated_amount,
  bank_account_id, bank_account_name, status
) VALUES
  (
    'c0464000-0000-4000-8000-000000000001',
    'c0460000-0000-4000-8000-000000000001',
    'RCT-C46-MYR', '2026-08-14',
    'c0461000-0000-4000-8000-000000000001', 'Assigned Customer',
    'TT', 'MYR', 1, 'MYR', 8000, 8000, 0, 8000,
    'c0462100-0000-4000-8000-000000000001', 'Copilot 46 Account', 'Draft'
  ),
  (
    'c0464000-0000-4000-8000-000000000002',
    'c0460000-0000-4000-8000-000000000001',
    'RCT-C46-SGD', '2026-08-01',
    'c0461000-0000-4000-8000-000000000001', 'Assigned Customer',
    'TT', 'SGD', 3, 'MYR', 6000, 18000, 0, 6000,
    'c0462100-0000-4000-8000-000000000001', 'Copilot 46 Account', 'Draft'
  );

SET LOCAL session_replication_role = origin;

SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_result JSONB;
BEGIN
  v_result := public.ar_copilot_invoice_report_rows(
    'c0460000-0000-4000-8000-000000000001',
    'c0460200-0000-4000-8000-000000000001',
    'company',
    NULL, 'SGD', NULL, NULL, 5000,
    'outstanding_amount', 'desc', 1
  );
  PERFORM pg_temp.copilot46_assert(
    'Invoice currency/minimum execute before limit',
    v_result->>'total' = '2'
      AND v_result->'rows'->0->>'document' = 'INV-C46-UNASSIGNED'
      AND v_result->'rows'->0->>'currency' = 'SGD'
  );
  PERFORM pg_temp.copilot46_assert(
    'Invoice result retains authoritative base currency',
    v_result->>'base_currency' = 'MYR'
  );

  v_result := public.ar_copilot_receipt_report_rows(
    'c0460000-0000-4000-8000-000000000001',
    'c0460200-0000-4000-8000-000000000001',
    'company',
    NULL, 'SGD', NULL, NULL, 5000,
    'unapplied_amount', 'desc', 5
  );
  PERFORM pg_temp.copilot46_assert(
    'Receipt currency/minimum excludes MYR',
    v_result->>'total' = '1'
      AND v_result->'rows'->0->>'document' = 'RCT-C46-SGD'
      AND v_result->'rows'->0->>'unapplied_amount' = '6000.00'
  );
END;
$$;

DO $$
DECLARE
  v_result JSONB;
BEGIN
  v_result := public.ar_copilot_invoice_report_rows(
    'c0460000-0000-4000-8000-000000000001',
    'c0460200-0000-4000-8000-000000000002',
    'assigned',
    NULL, 'SGD', NULL, NULL, NULL,
    'outstanding_amount', 'desc', 10
  );
  PERFORM pg_temp.copilot46_assert(
    'AR Clerk report independently enforces assigned customers',
    v_result->>'total' = '2'
      AND NOT (v_result->'rows' @> '[{"document":"INV-C46-UNASSIGNED"}]')
  );
END;
$$;

RESET ROLE;

SELECT pg_temp.copilot46_assert(
  'Invoice RPC is SECURITY INVOKER',
  NOT COALESCE((
    SELECT p.prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'ar_copilot_invoice_report_rows'
  ), true)
);

SELECT pg_temp.copilot46_assert(
  'Only service_role receives Invoice execute',
  has_function_privilege(
    'service_role',
    'public.ar_copilot_invoice_report_rows(uuid,uuid,text,text,text,date,date,numeric,text,text,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.ar_copilot_invoice_report_rows(uuid,uuid,text,text,text,date,date,numeric,text,text,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.ar_copilot_invoice_report_rows(uuid,uuid,text,text,text,date,date,numeric,text,text,integer)',
    'EXECUTE'
  )
);

SELECT pg_temp.copilot46_assert(
  'Smoke fixtures exist only inside this rollback transaction',
  (SELECT COUNT(*) FROM public.invoices
    WHERE company_id = 'c0460000-0000-4000-8000-000000000001') = 4
  AND (SELECT COUNT(*) FROM public.receipts
    WHERE company_id = 'c0460000-0000-4000-8000-000000000001') = 2
);

ROLLBACK;
