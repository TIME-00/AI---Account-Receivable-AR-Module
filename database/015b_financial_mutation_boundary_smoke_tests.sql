-- ============================================================================
-- Batch 8B: Financial Mutation Boundary Smoke Tests
-- Run only on a disposable/staging database after migration 015.
-- ============================================================================
-- The entire test runs in one transaction and ends with ROLLBACK.
-- It creates no persistent records.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION batch8b_test_login(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::TEXT, TRUE);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_user_id)::TEXT,
    TRUE
  );
END;
$$;

CREATE OR REPLACE FUNCTION batch8b_assert(
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

CREATE OR REPLACE FUNCTION batch8b_assert_error(
  p_name TEXT,
  p_sql TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION
    WHEN insufficient_privilege OR check_violation OR with_check_option_violation THEN
      RAISE NOTICE 'PASS: % (%: %)', p_name, SQLSTATE, SQLERRM;
      RETURN;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN
        RAISE NOTICE 'PASS: % (%: %)', p_name, SQLSTATE, SQLERRM;
        RETURN;
      END IF;
      RAISE;
  END;

  RAISE EXCEPTION 'FAIL: %, expected a privilege/RLS error', p_name;
END;
$$;

-- Privilege boundary checks do not require fixtures.
SELECT batch8b_assert(
  format('authenticated has no direct DML on %s', protected_table),
  NOT has_table_privilege(
    'authenticated',
    format('public.%I', protected_table),
    'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    format('public.%I', protected_table),
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    format('public.%I', protected_table),
    'DELETE'
  )
)
FROM unnest(ARRAY[
  'invoices',
  'invoice_lines',
  'receipts',
  'allocation_details',
  'cn_allocations',
  'journal_entries',
  'journal_entry_lines',
  'credit_control_logs',
  'report_audit_logs',
  'import_row_allocations'
]) AS t(protected_table);

SELECT batch8b_assert(
  format('authenticated cannot execute %s directly', rpc_signature),
  NOT has_function_privilege(
    'authenticated',
    format('public.%s', rpc_signature),
    'EXECUTE'
  )
)
FROM unnest(ARRAY[
  'post_invoice(uuid,uuid,uuid)',
  'post_receipt(uuid,uuid,uuid)',
  'allocate_receipt(uuid,uuid,uuid,jsonb)',
  'reverse_allocation(uuid,uuid,uuid,text)',
  'reverse_journal_entry(uuid,uuid,uuid,text)',
  'handle_bounced_cheque(uuid,uuid,uuid,text,date)'
]) AS r(rpc_signature);

SELECT batch8b_assert(
  format('service_role retains %s execution', rpc_signature),
  has_function_privilege(
    'service_role',
    format('public.%s', rpc_signature),
    'EXECUTE'
  )
)
FROM unnest(ARRAY[
  'post_invoice(uuid,uuid,uuid)',
  'post_receipt(uuid,uuid,uuid)',
  'allocate_receipt(uuid,uuid,uuid,jsonb)',
  'reverse_allocation(uuid,uuid,uuid,text)',
  'reverse_journal_entry(uuid,uuid,uuid,text)',
  'handle_bounced_cheque(uuid,uuid,uuid,text,date)'
]) AS r(rpc_signature);

-- Transaction-scoped fixtures for role, tenant, assignment, and visibility.
INSERT INTO companies (
  id, company_code, company_name, base_currency, country
)
VALUES
  ('b8000000-0000-0000-0000-000000000001', 'B8BA', 'Batch 8B Company A', 'MYR', 'MY'),
  ('b8000000-0000-0000-0000-000000000002', 'B8BB', 'Batch 8B Company B', 'MYR', 'MY');

INSERT INTO user_roles (id, user_id, company_id, role, is_active)
VALUES
  ('b8100000-0000-0000-0000-000000000001', 'b8200000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001', 'AR Clerk', TRUE),
  ('b8100000-0000-0000-0000-000000000002', 'b8200000-0000-0000-0000-000000000002', 'b8000000-0000-0000-0000-000000000001', 'AR Supervisor', TRUE),
  ('b8100000-0000-0000-0000-000000000003', 'b8200000-0000-0000-0000-000000000003', 'b8000000-0000-0000-0000-000000000001', 'Finance Manager', TRUE),
  ('b8100000-0000-0000-0000-000000000004', 'b8200000-0000-0000-0000-000000000004', 'b8000000-0000-0000-0000-000000000001', 'Auditor', TRUE),
  ('b8100000-0000-0000-0000-000000000005', 'b8200000-0000-0000-0000-000000000005', 'b8000000-0000-0000-0000-000000000001', 'System Admin', TRUE),
  ('b8100000-0000-0000-0000-000000000006', 'b8200000-0000-0000-0000-000000000006', 'b8000000-0000-0000-0000-000000000002', 'AR Clerk', TRUE);

INSERT INTO customers (
  id, company_id, customer_id, customer_name, customer_type,
  bill_addr_line1, bill_city, bill_state, bill_postal, bill_country,
  contact_name, contact_phone, contact_email, is_deleted, is_hidden
)
VALUES
  ('b8300000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001', 'B8B-VISIBLE', 'Batch 8B Visible Customer', 'Corporate', '1 Test Road', 'Kuala Lumpur', 'WP Kuala Lumpur', '50000', 'MY', 'Visible', '60000001', 'visible@example.test', FALSE, FALSE),
  ('b8300000-0000-0000-0000-000000000002', 'b8000000-0000-0000-0000-000000000001', 'B8B-UNASSIGNED', 'Batch 8B Unassigned Customer', 'Corporate', '2 Test Road', 'Kuala Lumpur', 'WP Kuala Lumpur', '50000', 'MY', 'Unassigned', '60000002', 'unassigned@example.test', FALSE, FALSE),
  ('b8300000-0000-0000-0000-000000000003', 'b8000000-0000-0000-0000-000000000001', 'B8B-HIDDEN', 'Batch 8B Hidden Customer', 'Corporate', '3 Test Road', 'Kuala Lumpur', 'WP Kuala Lumpur', '50000', 'MY', 'Hidden', '60000003', 'hidden@example.test', FALSE, TRUE),
  ('b8300000-0000-0000-0000-000000000004', 'b8000000-0000-0000-0000-000000000001', 'B8B-DELETED', 'Batch 8B Deleted Customer', 'Corporate', '4 Test Road', 'Kuala Lumpur', 'WP Kuala Lumpur', '50000', 'MY', 'Deleted', '60000004', 'deleted@example.test', TRUE, FALSE),
  ('b8300000-0000-0000-0000-000000000005', 'b8000000-0000-0000-0000-000000000002', 'B8B-OTHER', 'Batch 8B Other Company', 'Corporate', '5 Test Road', 'Kuala Lumpur', 'WP Kuala Lumpur', '50000', 'MY', 'Other', '60000005', 'other@example.test', FALSE, FALSE);

INSERT INTO user_customer_assignments (
  id, user_id, customer_id, company_id, is_active
)
VALUES
  ('b8400000-0000-0000-0000-000000000001', 'b8200000-0000-0000-0000-000000000001', 'b8300000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001', TRUE),
  ('b8400000-0000-0000-0000-000000000002', 'b8200000-0000-0000-0000-000000000001', 'b8300000-0000-0000-0000-000000000003', 'b8000000-0000-0000-0000-000000000001', TRUE),
  ('b8400000-0000-0000-0000-000000000003', 'b8200000-0000-0000-0000-000000000006', 'b8300000-0000-0000-0000-000000000005', 'b8000000-0000-0000-0000-000000000002', TRUE);

INSERT INTO ar_system_config (
  company_id, config_key, config_value, description
)
VALUES
  (
    'b8000000-0000-0000-0000-000000000001',
    'batch8b_config_test',
    'before',
    'Transaction-scoped Batch 8B config access test'
  ),
  (
    'b8000000-0000-0000-0000-000000000001',
    'default_ar_control_acct',
    'B8B-AR',
    'Transaction-scoped Batch 8B posting test'
  ),
  (
    'b8000000-0000-0000-0000-000000000001',
    'default_revenue_acct',
    'B8B-REV',
    'Transaction-scoped Batch 8B posting test'
  );

INSERT INTO fiscal_periods (
  id, company_id, period_code, status, start_date, end_date
)
VALUES (
  'b8900000-0000-0000-0000-000000000001',
  'b8000000-0000-0000-0000-000000000001',
  TO_CHAR(CURRENT_DATE, 'YYYY-MM'),
  'Open',
  DATE_TRUNC('month', CURRENT_DATE)::DATE,
  (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE
);

INSERT INTO invoices (
  id, company_id, invoice_no, doc_type, invoice_date, customer_id,
  customer_name, currency, base_currency, status, subtotal, total_amount,
  base_total, outstanding
)
VALUES
  ('b8500000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001', 'B8B-INV-VISIBLE', 'Invoice', CURRENT_DATE, 'b8300000-0000-0000-0000-000000000001', 'Batch 8B Visible Customer', 'MYR', 'MYR', 'Draft', 100, 100, 100, 100),
  ('b8500000-0000-0000-0000-000000000002', 'b8000000-0000-0000-0000-000000000001', 'B8B-INV-UNASSIGNED', 'Invoice', CURRENT_DATE, 'b8300000-0000-0000-0000-000000000002', 'Batch 8B Unassigned Customer', 'MYR', 'MYR', 'Draft', 100, 100, 100, 100),
  ('b8500000-0000-0000-0000-000000000003', 'b8000000-0000-0000-0000-000000000001', 'B8B-INV-HIDDEN', 'Invoice', CURRENT_DATE, 'b8300000-0000-0000-0000-000000000003', 'Batch 8B Hidden Customer', 'MYR', 'MYR', 'Open', 100, 100, 100, 100),
  ('b8500000-0000-0000-0000-000000000004', 'b8000000-0000-0000-0000-000000000001', 'B8B-INV-DELETED', 'Invoice', CURRENT_DATE, 'b8300000-0000-0000-0000-000000000004', 'Batch 8B Deleted Customer', 'MYR', 'MYR', 'Open', 100, 100, 100, 100),
  ('b8500000-0000-0000-0000-000000000005', 'b8000000-0000-0000-0000-000000000002', 'B8B-INV-OTHER', 'Invoice', CURRENT_DATE, 'b8300000-0000-0000-0000-000000000005', 'Batch 8B Other Company', 'MYR', 'MYR', 'Draft', 100, 100, 100, 100);

INSERT INTO gl_accounts (
  id, company_id, account_code, account_name, account_type
)
VALUES
  (
    'b8600000-0000-0000-0000-000000000001',
    'b8000000-0000-0000-0000-000000000001',
    'B8B-AR',
    'Batch 8B Test AR Account',
    'Asset'
  ),
  (
    'b8600000-0000-0000-0000-000000000002',
    'b8000000-0000-0000-0000-000000000001',
    'B8B-REV',
    'Batch 8B Test Revenue Account',
    'Revenue'
  );

INSERT INTO invoice_lines (
  id, invoice_id, line_no, description, quantity, unit_price,
  line_amount, tax_amount, line_total, gl_account_id
)
VALUES (
  'b8a00000-0000-0000-0000-000000000001',
  'b8500000-0000-0000-0000-000000000001',
  10,
  'Transaction-scoped Batch 8B service RPC test',
  1,
  100,
  100,
  0,
  100,
  'b8600000-0000-0000-0000-000000000002'
);

INSERT INTO journal_entries (
  id, company_id, je_no, je_date, posting_period, source_type,
  description, currency, base_currency, total_debit, total_credit
)
VALUES (
  'b8700000-0000-0000-0000-000000000001',
  'b8000000-0000-0000-0000-000000000001',
  'B8B-JE-001',
  CURRENT_DATE,
  TO_CHAR(CURRENT_DATE, 'YYYY-MM'),
  'ADJ',
  'Transaction-scoped Batch 8B journal visibility test',
  'MYR',
  'MYR',
  0,
  0
);

INSERT INTO journal_entry_lines (
  id, je_id, line_no, gl_account_id, description,
  debit_amount, credit_amount, base_debit, base_credit, currency
)
VALUES (
  'b8800000-0000-0000-0000-000000000001',
  'b8700000-0000-0000-0000-000000000001',
  10,
  'b8600000-0000-0000-0000-000000000001',
  'Transaction-scoped Batch 8B journal line visibility test',
  0,
  0,
  0,
  0,
  'MYR'
);

-- The trusted backend role retains the existing verified financial RPC flow.
-- The mutation is transaction-scoped and is rolled back at the end.
SET LOCAL ROLE service_role;
SELECT public.post_invoice(
  'b8500000-0000-0000-0000-000000000001',
  'b8200000-0000-0000-0000-000000000001',
  'b8000000-0000-0000-0000-000000000001'
);
RESET ROLE;

SELECT batch8b_assert(
  'service_role post_invoice flow remains operational',
  (
    SELECT status = 'Open'
      AND outstanding = 100
      AND posted_by = 'b8200000-0000-0000-0000-000000000001'
    FROM invoices
    WHERE id = 'b8500000-0000-0000-0000-000000000001'
  )
);

-- AR Clerk: assigned visible only; assigned hidden remains filtered.
SELECT batch8b_test_login('b8200000-0000-0000-0000-000000000001');
SELECT batch8b_assert(
  'AR Clerk sees assigned visible customer',
  (SELECT COUNT(*) FROM customers WHERE id = 'b8300000-0000-0000-0000-000000000001') = 1
);
SELECT batch8b_assert(
  'AR Clerk cannot see unassigned customer',
  (SELECT COUNT(*) FROM customers WHERE id = 'b8300000-0000-0000-0000-000000000002') = 0
);
SELECT batch8b_assert(
  'AR Clerk cannot see assigned hidden customer',
  (SELECT COUNT(*) FROM customers WHERE id = 'b8300000-0000-0000-0000-000000000003') = 0
);
SELECT batch8b_assert(
  'AR Clerk cannot see hidden-customer invoice',
  (SELECT COUNT(*) FROM invoices WHERE id = 'b8500000-0000-0000-0000-000000000003') = 0
);
RESET ROLE;

-- Supervisor, Finance Manager, and Auditor retain visible operational reads.
SELECT batch8b_test_login('b8200000-0000-0000-0000-000000000002');
SELECT batch8b_assert(
  'Supervisor sees both visible Company A customers',
  (SELECT COUNT(*) FROM customers) = 2
);
SELECT batch8b_assert(
  'Supervisor cannot see hidden/deleted customers',
  (SELECT COUNT(*) FROM customers WHERE id IN (
    'b8300000-0000-0000-0000-000000000003',
    'b8300000-0000-0000-0000-000000000004'
  )) = 0
);
SELECT batch8b_assert(
  'Supervisor cannot see Company B invoice',
  (SELECT COUNT(*) FROM invoices WHERE id = 'b8500000-0000-0000-0000-000000000005') = 0
);
RESET ROLE;

SELECT batch8b_test_login('b8200000-0000-0000-0000-000000000003');
SELECT batch8b_assert(
  'Finance Manager retains visible operational read',
  (SELECT COUNT(*) FROM invoices) = 2
);
RESET ROLE;

SELECT batch8b_test_login('b8200000-0000-0000-0000-000000000004');
SELECT batch8b_assert(
  'Auditor retains visible operational read',
  (SELECT COUNT(*) FROM invoices) = 2
);
SELECT batch8b_assert_error(
  'Auditor remains unable to update invoices',
  $$UPDATE public.invoices
    SET internal_remarks = 'forbidden'
    WHERE id = 'b8500000-0000-0000-0000-000000000001'$$
);
RESET ROLE;

-- System Admin retains company/config access but no operational reads.
SELECT batch8b_test_login('b8200000-0000-0000-0000-000000000005');
SELECT batch8b_assert(
  'System Admin retains company configuration read',
  (SELECT COUNT(*) FROM companies WHERE id = 'b8000000-0000-0000-0000-000000000001') = 1
);
UPDATE ar_system_config
SET config_value = 'after'
WHERE company_id = 'b8000000-0000-0000-0000-000000000001'
  AND config_key = 'batch8b_config_test';
SELECT batch8b_assert(
  'System Admin retains configuration write',
  (SELECT config_value
   FROM ar_system_config
   WHERE company_id = 'b8000000-0000-0000-0000-000000000001'
     AND config_key = 'batch8b_config_test') = 'after'
);
SELECT batch8b_assert(
  'System Admin cannot read operational customers',
  (SELECT COUNT(*) FROM customers) = 0
);
SELECT batch8b_assert(
  'System Admin cannot read operational invoices',
  (SELECT COUNT(*) FROM invoices) = 0
);
SELECT batch8b_assert(
  'System Admin cannot read journal entry headers',
  (SELECT COUNT(*) FROM journal_entries) = 0
);
SELECT batch8b_assert(
  'System Admin cannot read journal entry lines',
  (SELECT COUNT(*) FROM journal_entry_lines) = 0
);
RESET ROLE;

-- Direct DML is rejected even for an operational role.
SELECT batch8b_test_login('b8200000-0000-0000-0000-000000000002');
SELECT batch8b_assert_error(
  'Supervisor cannot directly update invoice outstanding',
  $$UPDATE public.invoices
    SET outstanding = 0
    WHERE id = 'b8500000-0000-0000-0000-000000000001'$$
);
SELECT batch8b_assert_error(
  'Supervisor cannot directly insert invoice line',
  $$INSERT INTO public.invoice_lines (
      invoice_id, line_no, description, quantity, unit_price,
      line_amount, tax_amount, line_total
    ) VALUES (
      'b8500000-0000-0000-0000-000000000001', 10, 'Forbidden',
      1, 100, 100, 0, 100
    )$$
);
SELECT batch8b_assert_error(
  'Supervisor cannot execute post_invoice directly',
  $$SELECT public.post_invoice(
      'b8500000-0000-0000-0000-000000000001',
      'b8200000-0000-0000-0000-000000000002',
      'b8000000-0000-0000-0000-000000000001'
    )$$
);
RESET ROLE;

ROLLBACK;
