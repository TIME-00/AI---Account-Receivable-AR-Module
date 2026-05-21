-- ============================================================================
-- TSH Synergy ERP - AR Module - 006b_rls_tests.sql
-- RLS Policy Test Cases
-- Run AFTER 006_rls_policies.sql on a disposable staging/test database.
-- ============================================================================
-- This file is intentionally plain SQL/PLpgSQL, not pgTAP, so it can run in
-- Supabase SQL Editor or psql. It raises exceptions on failures.
--
-- The tests impersonate Supabase authenticated users with:
--   SET LOCAL ROLE authenticated;
--   set_config('request.jwt.claim.sub', '<user-uuid>', true);
--   set_config('request.jwt.claims', '{"sub":"<user-uuid>"}', true);
--
-- Run this file as a privileged database role such as postgres/supabase_admin.
-- ============================================================================

-- ============================================================================
-- SECTION 1: TEST HELPERS
-- ============================================================================

CREATE OR REPLACE FUNCTION rls_test_login(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', p_user_id::TEXT, TRUE);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', p_user_id)::TEXT, TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION rls_test_assert_eq(
  p_name TEXT,
  p_actual BIGINT,
  p_expected BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL: %, expected %, got %', p_name, p_expected, p_actual;
  END IF;
  RAISE NOTICE 'PASS: %', p_name;
END;
$$;

CREATE OR REPLACE FUNCTION rls_test_assert_error(
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
      RAISE NOTICE 'PASS: %', p_name;
      RETURN;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN
        RAISE NOTICE 'PASS: %', p_name;
        RETURN;
      END IF;
      RAISE;
  END;

  RAISE EXCEPTION 'FAIL: %, expected an RLS/privilege error', p_name;
END;
$$;

-- ============================================================================
-- SECTION 2: FIXTURES
-- ============================================================================

BEGIN;

-- Companies
INSERT INTO companies (id, company_code, company_name, base_currency, country)
VALUES
  ('10000000-0000-0000-0000-000000000001','TSTA','RLS Test Company A','SGD','SG'),
  ('10000000-0000-0000-0000-000000000002','TSTB','RLS Test Company B','SGD','SG')
ON CONFLICT (company_code) DO NOTHING;

-- GL and bank fixtures so tests do not depend on seed data.
INSERT INTO gl_accounts (id, company_id, account_code, account_name, account_type)
VALUES
  ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','RLS-AR-A','RLS AR A','Asset'),
  ('70000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','RLS-AR-B','RLS AR B','Asset')
ON CONFLICT (company_id, account_code) DO NOTHING;

INSERT INTO bank_accounts (id, company_id, bank_name, account_name, account_no, currency, gl_account_id)
VALUES
  ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','RLS Bank','RLS A','RLS-A-001','SGD','70000000-0000-0000-0000-000000000001'),
  ('80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','RLS Bank','RLS B','RLS-B-001','SGD','70000000-0000-0000-0000-000000000002')
ON CONFLICT (company_id, account_no) DO NOTHING;

-- Users:
-- 200...001 = AR Clerk A assigned to customer A1
-- 200...002 = AR Supervisor A
-- 200...003 = Auditor A
-- 200...004 = AR Clerk B assigned to customer B1
-- 200...005 = Finance Manager A
-- 200...006 = System Admin A
INSERT INTO user_roles (id, user_id, company_id, role, is_active)
VALUES
  ('21000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','AR Clerk',TRUE),
  ('21000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','AR Supervisor',TRUE),
  ('21000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Auditor',TRUE),
  ('21000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','AR Clerk',TRUE),
  ('21000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','Finance Manager',TRUE),
  ('21000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','System Admin',TRUE)
ON CONFLICT (user_id, company_id, role) DO UPDATE SET is_active = EXCLUDED.is_active;

-- Customers
INSERT INTO customers (
  id, company_id, customer_id, customer_name, customer_type,
  bill_addr_line1, bill_city, bill_state, bill_postal, bill_country,
  contact_name, contact_phone, contact_email
)
VALUES
  ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','RLS-CUST-A1','RLS Customer A1','Corporate','1 Test','Singapore','SG','100001','SG','Alice','60000001','a1@example.test'),
  ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','RLS-CUST-A2','RLS Customer A2','Corporate','2 Test','Singapore','SG','100002','SG','Amy','60000002','a2@example.test'),
  ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','RLS-CUST-B1','RLS Customer B1','Corporate','3 Test','Singapore','SG','100003','SG','Bob','60000003','b1@example.test')
ON CONFLICT (company_id, customer_id) DO NOTHING;

INSERT INTO user_customer_assignments (id, user_id, customer_id, company_id, is_active)
VALUES
  ('22000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',TRUE),
  ('22000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002',TRUE)
ON CONFLICT (user_id, customer_id) DO UPDATE SET is_active = EXCLUDED.is_active;

-- Invoices and lines
INSERT INTO invoices (
  id, company_id, invoice_no, doc_type, invoice_date, customer_id,
  customer_name, currency, base_currency, status, subtotal, total_amount, base_total, outstanding,
  cn_type, ref_invoice_id
)
VALUES
  ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','RLS-INV-A1','Invoice',CURRENT_DATE,'30000000-0000-0000-0000-000000000001','RLS Customer A1','SGD','SGD','Draft',100,100,100,100,NULL,NULL),
  ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','RLS-INV-A2','Invoice',CURRENT_DATE,'30000000-0000-0000-0000-000000000002','RLS Customer A2','SGD','SGD','Draft',150,150,150,150,NULL,NULL),
  ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','RLS-INV-B1','Invoice',CURRENT_DATE,'30000000-0000-0000-0000-000000000003','RLS Customer B1','SGD','SGD','Draft',200,200,200,200,NULL,NULL),
  ('40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','RLS-CN-A1','Credit Note',CURRENT_DATE,'30000000-0000-0000-0000-000000000001','RLS Customer A1','SGD','SGD','Draft',25,25,25,25,'Linked','40000000-0000-0000-0000-000000000001')
ON CONFLICT (company_id, invoice_no) DO NOTHING;

INSERT INTO invoice_lines (
  id, invoice_id, line_no, description, quantity, unit_price, line_amount, tax_amount, line_total
)
VALUES
  ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',10,'RLS Item A1',1,100,100,0,100),
  ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003',10,'RLS Item B1',1,200,200,0,200)
ON CONFLICT (invoice_id, line_no) DO NOTHING;

-- Receipts, allocations, CN allocations
INSERT INTO receipts (
  id, company_id, receipt_no, receipt_date, customer_id, customer_name,
  payment_method, currency, base_currency, receipt_amount, base_amount,
  allocated_amount, unallocated_amount, bank_account_id, bank_account_name, status
)
VALUES
  ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','RLS-RCT-A1',CURRENT_DATE,'30000000-0000-0000-0000-000000000001','RLS Customer A1','TT','SGD','SGD',100,100,0,100,'80000000-0000-0000-0000-000000000001','RLS Bank','Posted'),
  ('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','RLS-RCT-B1',CURRENT_DATE,'30000000-0000-0000-0000-000000000003','RLS Customer B1','TT','SGD','SGD',200,200,0,200,'80000000-0000-0000-0000-000000000002','RLS Bank','Posted')
ON CONFLICT (company_id, receipt_no) DO NOTHING;

INSERT INTO allocation_details (
  id, receipt_id, invoice_id, doc_type, allocated_amount, base_allocated,
  invoice_rate, receipt_rate, allocation_method
)
VALUES
  ('a4000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Invoice',50,50,1,1,'Manual')
ON CONFLICT DO NOTHING;

INSERT INTO cn_allocations (id, cn_id, invoice_id, allocated_amount)
VALUES
  ('a5000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001',25)
ON CONFLICT DO NOTHING;

-- Journal and child/audit fixtures
INSERT INTO journal_entries (id, company_id, je_no, je_date, posting_period, source_type, total_debit, total_credit)
VALUES
  ('90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','RLS-JE-A1',CURRENT_DATE,'2026-05','INV',100,100),
  ('90000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','RLS-JE-B1',CURRENT_DATE,'2026-05','INV',200,200)
ON CONFLICT (company_id, je_no) DO NOTHING;

INSERT INTO journal_entry_lines (id, je_id, line_no, gl_account_id, debit_amount, credit_amount, base_debit, base_credit)
VALUES
  ('a1000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001',10,'70000000-0000-0000-0000-000000000001',100,0,100,0),
  ('a1000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000002',10,'70000000-0000-0000-0000-000000000002',200,0,200,0)
ON CONFLICT (je_id, line_no) DO NOTHING;

INSERT INTO customer_bank_details (id, customer_id, bank_name, account_name, account_no)
VALUES
  ('a2000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','RLS Cust Bank','A1','RLS-CUST-A1')
ON CONFLICT DO NOTHING;

INSERT INTO customer_change_logs (id, customer_id, field_name, old_value, new_value)
VALUES
  ('a3000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','credit_limit','0','1000')
ON CONFLICT DO NOTHING;

COMMIT;

-- ============================================================================
-- SECTION 3: TESTS
-- ============================================================================

BEGIN;
SELECT rls_test_login('20000000-0000-0000-0000-000000000002');
SELECT rls_test_assert_eq('Supervisor A sees only Company A invoices', (SELECT count(*) FROM invoices), 3);
SELECT rls_test_assert_eq('Supervisor A cannot see Company B invoices', (SELECT count(*) FROM invoices WHERE company_id = '10000000-0000-0000-0000-000000000002'), 0);
SELECT rls_test_assert_eq('Supervisor A sees only Company A customers', (SELECT count(*) FROM customers), 2);
SELECT rls_test_assert_eq('Supervisor A sees only Company A company row', (SELECT count(*) FROM companies), 1);
ROLLBACK;

BEGIN;
SELECT rls_test_login('20000000-0000-0000-0000-000000000002');
SELECT rls_test_assert_error(
  'Supervisor A cannot insert Company B invoice',
  $$INSERT INTO invoices (company_id, invoice_no, doc_type, invoice_date, customer_id, customer_name, currency, base_currency, total_amount, base_total, outstanding)
    VALUES ('10000000-0000-0000-0000-000000000002','RLS-HACK-B','Invoice',CURRENT_DATE,'30000000-0000-0000-0000-000000000003','B','SGD','SGD',999,999,999)$$
);
ROLLBACK;

BEGIN;
SELECT rls_test_login('20000000-0000-0000-0000-000000000002');
UPDATE invoices SET internal_remarks = 'rls-hacked'
WHERE id = '40000000-0000-0000-0000-000000000003';
SELECT rls_test_assert_eq('Cross-company update affects zero visible rows', (SELECT count(*) FROM invoices WHERE internal_remarks = 'rls-hacked'), 0);
DELETE FROM invoices WHERE id = '40000000-0000-0000-0000-000000000003';
SELECT rls_test_assert_eq('Cross-company delete affects zero visible rows', (SELECT count(*) FROM invoices WHERE id = '40000000-0000-0000-0000-000000000003'), 0);
ROLLBACK;

BEGIN;
SELECT rls_test_login('20000000-0000-0000-0000-000000000001');
SELECT rls_test_assert_eq('Clerk A sees assigned customer', (SELECT count(*) FROM customers WHERE id = '30000000-0000-0000-0000-000000000001'), 1);
SELECT rls_test_assert_eq('Clerk A cannot see unassigned same-company customer', (SELECT count(*) FROM customers WHERE id = '30000000-0000-0000-0000-000000000002'), 0);
SELECT rls_test_assert_eq('Clerk A cannot see other-company customer', (SELECT count(*) FROM customers WHERE id = '30000000-0000-0000-0000-000000000003'), 0);
SELECT rls_test_assert_eq('Clerk A sees assigned invoice', (SELECT count(*) FROM invoices WHERE id = '40000000-0000-0000-0000-000000000001'), 1);
SELECT rls_test_assert_eq('Clerk A cannot see unassigned same-company invoice', (SELECT count(*) FROM invoices WHERE id = '40000000-0000-0000-0000-000000000002'), 0);
SELECT rls_test_assert_eq('Clerk A sees invoice_lines through assigned invoice', (SELECT count(*) FROM invoice_lines WHERE id = '50000000-0000-0000-0000-000000000001'), 1);
ROLLBACK;

BEGIN;
SELECT rls_test_login('20000000-0000-0000-0000-000000000003');
SELECT rls_test_assert_eq('Auditor A can read Company A invoices', (SELECT count(*) FROM invoices), 3);
SELECT rls_test_assert_error(
  'Auditor A cannot insert invoice',
  $$INSERT INTO invoices (company_id, invoice_no, doc_type, invoice_date, customer_id, customer_name, currency, base_currency, total_amount, base_total, outstanding)
    VALUES ('10000000-0000-0000-0000-000000000001','RLS-AUD-INSERT','Invoice',CURRENT_DATE,'30000000-0000-0000-0000-000000000001','A','SGD','SGD',50,50,50)$$
);
UPDATE invoices SET internal_remarks = 'auditor-edit'
WHERE id = '40000000-0000-0000-0000-000000000001';
SELECT rls_test_assert_eq('Auditor A update affects zero rows', (SELECT count(*) FROM invoices WHERE internal_remarks = 'auditor-edit'), 0);
DELETE FROM invoices WHERE id = '40000000-0000-0000-0000-000000000001';
SELECT rls_test_assert_eq('Auditor A delete affects zero rows', (SELECT count(*) FROM invoices WHERE id = '40000000-0000-0000-0000-000000000001'), 1);
ROLLBACK;

BEGIN;
SELECT rls_test_login('20000000-0000-0000-0000-000000000006');
SELECT rls_test_assert_eq('System Admin A can read config', (SELECT count(*) FROM ar_system_config WHERE company_id = '10000000-0000-0000-0000-000000000001'), 0);
SELECT rls_test_assert_error(
  'System Admin A cannot insert operational invoice',
  $$INSERT INTO invoices (company_id, invoice_no, doc_type, invoice_date, customer_id, customer_name, currency, base_currency, total_amount, base_total, outstanding)
    VALUES ('10000000-0000-0000-0000-000000000001','RLS-SYS-INV','Invoice',CURRENT_DATE,'30000000-0000-0000-0000-000000000001','A','SGD','SGD',50,50,50)$$
);
ROLLBACK;

BEGIN;
UPDATE user_roles SET is_active = FALSE
WHERE user_id = '20000000-0000-0000-0000-000000000002'
  AND company_id = '10000000-0000-0000-0000-000000000001';
SELECT rls_test_login('20000000-0000-0000-0000-000000000002');
SELECT rls_test_assert_eq('Deactivated role removes invoice access', (SELECT count(*) FROM invoices), 0);
SELECT rls_test_assert_eq('Deactivated role removes customer access', (SELECT count(*) FROM customers), 0);
SELECT rls_test_assert_eq('Deactivated role removes company access', (SELECT count(*) FROM companies), 0);
ROLLBACK;

BEGIN;
SELECT rls_test_login('20000000-0000-0000-0000-000000000004');
SELECT rls_test_assert_eq('Company B clerk cannot see Company A invoice_lines', (SELECT count(*) FROM invoice_lines WHERE id = '50000000-0000-0000-0000-000000000001'), 0);
SELECT rls_test_assert_eq('Company B clerk cannot see Company A journal_entry_lines', (SELECT count(*) FROM journal_entry_lines WHERE id = 'a1000000-0000-0000-0000-000000000001'), 0);
SELECT rls_test_assert_eq('Company B clerk cannot see Company A customer_bank_details', (SELECT count(*) FROM customer_bank_details WHERE id = 'a2000000-0000-0000-0000-000000000001'), 0);
SELECT rls_test_assert_eq('Company B clerk cannot see Company A customer_change_logs', (SELECT count(*) FROM customer_change_logs WHERE id = 'a3000000-0000-0000-0000-000000000001'), 0);
SELECT rls_test_assert_eq('Company B clerk cannot see Company A allocations', (SELECT count(*) FROM allocation_details WHERE id = 'a4000000-0000-0000-0000-000000000001'), 0);
SELECT rls_test_assert_eq('Company B clerk cannot see Company A CN allocations', (SELECT count(*) FROM cn_allocations WHERE id = 'a5000000-0000-0000-0000-000000000001'), 0);
ROLLBACK;

BEGIN;
SELECT rls_test_login('20000000-0000-0000-0000-000000000005');
SELECT rls_test_assert_eq('Finance Manager A can read view under RLS', (SELECT count(*) FROM v_customer_ar_summary WHERE company_id = '10000000-0000-0000-0000-000000000001'), 2);
SELECT rls_test_assert_eq('Finance Manager A cannot read Company B rows through view', (SELECT count(*) FROM v_customer_ar_summary WHERE company_id = '10000000-0000-0000-0000-000000000002'), 0);
ROLLBACK;

-- ============================================================================
-- SECTION 4: OPTIONAL CLEANUP
-- ============================================================================
-- Run as a privileged role if you want to remove fixtures after testing.
--
-- DELETE FROM cn_allocations WHERE id = 'a5000000-0000-0000-0000-000000000001';
-- DELETE FROM allocation_details WHERE id = 'a4000000-0000-0000-0000-000000000001';
-- DELETE FROM customer_change_logs WHERE id = 'a3000000-0000-0000-0000-000000000001';
-- DELETE FROM customer_bank_details WHERE id = 'a2000000-0000-0000-0000-000000000001';
-- DELETE FROM journal_entry_lines WHERE id IN ('a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000002');
-- DELETE FROM journal_entries WHERE id IN ('90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002');
-- DELETE FROM invoice_lines WHERE id IN ('50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002');
-- DELETE FROM cn_allocations WHERE cn_id = '40000000-0000-0000-0000-000000000004';
-- DELETE FROM invoices WHERE id IN ('40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000004');
-- DELETE FROM receipts WHERE id IN ('60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002');
-- DELETE FROM user_customer_assignments WHERE id IN ('22000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002');
-- DELETE FROM user_roles WHERE id BETWEEN '21000000-0000-0000-0000-000000000001' AND '21000000-0000-0000-0000-000000000006';
-- DELETE FROM customers WHERE id IN ('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003');
-- DELETE FROM bank_accounts WHERE id IN ('80000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002');
-- DELETE FROM gl_accounts WHERE id IN ('70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002');
-- DELETE FROM companies WHERE id IN ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
-- DROP FUNCTION IF EXISTS rls_test_assert_error(TEXT, TEXT);
-- DROP FUNCTION IF EXISTS rls_test_assert_eq(TEXT, BIGINT, BIGINT);
-- DROP FUNCTION IF EXISTS rls_test_login(UUID);
-- ============================================================================
