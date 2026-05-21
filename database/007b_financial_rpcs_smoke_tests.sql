-- ============================================================================
-- TSH Synergy ERP - AR Module - 007b_financial_rpcs_smoke_tests.sql
-- P1 Financial RPC Staging Smoke Tests
-- Run AFTER database/007_financial_rpcs.sql on Supabase staging.
-- ============================================================================
-- Plain SQL/PLpgSQL smoke tests for:
--   1. post_invoice
--   2. post_receipt
--   3. allocate_receipt
--   4. reverse_allocation
--   5. reverse_journal_entry
--   6. handle_bounced_cheque
--
-- Run as a privileged database role such as postgres/supabase_admin.
-- The whole file runs inside one transaction and ends with ROLLBACK.
-- It raises exceptions on failures and leaves no test data behind on success.
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: TEST HELPERS
-- ============================================================================

CREATE OR REPLACE FUNCTION p1_smoke_login(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::TEXT, TRUE);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated',
    'sub', p_user_id
  )::TEXT, TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION p1_smoke_assert(
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

CREATE OR REPLACE FUNCTION p1_smoke_assert_error(
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
    WHEN OTHERS THEN
      RAISE NOTICE 'PASS: % (%: %)', p_name, SQLSTATE, SQLERRM;
      RETURN;
  END;

  RAISE EXCEPTION 'FAIL: %, expected an error', p_name;
END;
$$;

CREATE OR REPLACE FUNCTION p1_smoke_assert_balanced(
  p_name TEXT,
  p_company_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_bad_count INT;
BEGIN
  SELECT COUNT(*) INTO v_bad_count
  FROM journal_entries je
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(jel.debit_amount), 0)::NUMERIC(18,2) AS line_debit,
      COALESCE(SUM(jel.credit_amount), 0)::NUMERIC(18,2) AS line_credit,
      COALESCE(SUM(jel.base_debit), 0)::NUMERIC(18,2) AS line_base_debit,
      COALESCE(SUM(jel.base_credit), 0)::NUMERIC(18,2) AS line_base_credit
    FROM journal_entry_lines jel
    WHERE jel.je_id = je.id
  ) lines ON TRUE
  WHERE je.company_id = p_company_id
    AND (
      je.total_debit <> je.total_credit
      OR lines.line_debit <> lines.line_credit
      OR je.total_debit <> lines.line_debit
      OR lines.line_base_debit <> lines.line_base_credit
    );

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'FAIL: %, found % unbalanced JE(s)', p_name, v_bad_count;
  END IF;

  RAISE NOTICE 'PASS: %', p_name;
END;
$$;

-- ============================================================================
-- SECTION 2: FIXTURES
-- ============================================================================

INSERT INTO companies (
  id, company_code, company_name, base_currency, country
) VALUES (
  '71000000-0000-0000-0000-000000000001',
  'P1SMOKE',
  'P1 Smoke Test Company',
  'SGD',
  'SG'
);

INSERT INTO gl_accounts (id, company_id, account_code, account_name, account_type)
VALUES
  ('73000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','P1-1000','P1 Bank','Asset'),
  ('73000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','P1-1050','P1 Cheques on Hand','Asset'),
  ('73000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','P1-1100','P1 Trade Receivable','Asset'),
  ('73000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000001','P1-2200','P1 Output Tax','Liability'),
  ('73000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000001','P1-4000','P1 Revenue','Revenue'),
  ('73000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000001','P1-6100','P1 Sales Discount','Expense'),
  ('73000000-0000-0000-0000-000000000007','71000000-0000-0000-0000-000000000001','P1-7000','P1 Forex Gain','Revenue'),
  ('73000000-0000-0000-0000-000000000008','71000000-0000-0000-0000-000000000001','P1-7100','P1 Forex Loss','Expense');

INSERT INTO ar_system_config (company_id, config_key, config_value, description)
VALUES
  ('71000000-0000-0000-0000-000000000001','invoice_future_days_limit','7','P1 smoke future date limit'),
  ('71000000-0000-0000-0000-000000000001','default_ar_control_acct','P1-1100','P1 smoke AR control'),
  ('71000000-0000-0000-0000-000000000001','default_revenue_acct','P1-4000','P1 smoke revenue'),
  ('71000000-0000-0000-0000-000000000001','default_cheque_acct','P1-1050','P1 smoke cheques'),
  ('71000000-0000-0000-0000-000000000001','default_discount_acct','P1-6100','P1 smoke discount'),
  ('71000000-0000-0000-0000-000000000001','default_forex_gain_acct','P1-7000','P1 smoke forex gain'),
  ('71000000-0000-0000-0000-000000000001','default_forex_loss_acct','P1-7100','P1 smoke forex loss');

INSERT INTO fiscal_periods (
  id, company_id, period_code, status, start_date, end_date
) VALUES (
  '71000000-0000-0000-0000-000000000002',
  '71000000-0000-0000-0000-000000000001',
  to_char(CURRENT_DATE, 'YYYY-MM'),
  'Open',
  date_trunc('month', CURRENT_DATE)::DATE,
  (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE
);

INSERT INTO payment_terms (
  id, company_id, term_code, term_name, term_type, days
) VALUES (
  '71000000-0000-0000-0000-000000000003',
  '71000000-0000-0000-0000-000000000001',
  'P1-N30',
  'P1 Net 30',
  'Fixed Days',
  30
);

INSERT INTO bank_accounts (
  id, company_id, bank_name, account_name, account_no, currency, gl_account_id
) VALUES (
  '74000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  'P1 Smoke Bank',
  'P1 Operating Bank',
  'P1-SMOKE-001',
  'SGD',
  '73000000-0000-0000-0000-000000000001'
);

INSERT INTO customers (
  id, company_id, customer_id, customer_name, customer_type, status,
  bill_addr_line1, bill_city, bill_state, bill_postal, bill_country,
  contact_name, contact_phone, contact_email,
  ar_control_acct_id, revenue_acct_id, tax_output_acct_id,
  discount_acct_id, forex_gain_acct_id, forex_loss_acct_id, payment_term_id
)
VALUES
  (
    '75000000-0000-0000-0000-000000000001',
    '71000000-0000-0000-0000-000000000001',
    'P1-CUST-001',
    'P1 Assigned Customer',
    'Corporate',
    'Active',
    '1 Smoke Street',
    'Singapore',
    'SG',
    '100001',
    'SG',
    'Assigned Contact',
    '60000001',
    'assigned@example.test',
    '73000000-0000-0000-0000-000000000003',
    '73000000-0000-0000-0000-000000000005',
    '73000000-0000-0000-0000-000000000004',
    '73000000-0000-0000-0000-000000000006',
    '73000000-0000-0000-0000-000000000007',
    '73000000-0000-0000-0000-000000000008',
    '71000000-0000-0000-0000-000000000003'
  ),
  (
    '75000000-0000-0000-0000-000000000002',
    '71000000-0000-0000-0000-000000000001',
    'P1-CUST-002',
    'P1 Unassigned Customer',
    'Corporate',
    'Active',
    '2 Smoke Street',
    'Singapore',
    'SG',
    '100002',
    'SG',
    'Unassigned Contact',
    '60000002',
    'unassigned@example.test',
    '73000000-0000-0000-0000-000000000003',
    '73000000-0000-0000-0000-000000000005',
    '73000000-0000-0000-0000-000000000004',
    '73000000-0000-0000-0000-000000000006',
    '73000000-0000-0000-0000-000000000007',
    '73000000-0000-0000-0000-000000000008',
    '71000000-0000-0000-0000-000000000003'
  );

INSERT INTO user_roles (id, user_id, company_id, role, is_active)
VALUES
  ('72000000-0000-0000-0000-000000000101','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','AR Clerk',TRUE),
  ('72000000-0000-0000-0000-000000000102','72000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','AR Supervisor',TRUE),
  ('72000000-0000-0000-0000-000000000103','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','Finance Manager',TRUE),
  ('72000000-0000-0000-0000-000000000104','72000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000001','Auditor',TRUE),
  ('72000000-0000-0000-0000-000000000105','72000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000001','System Admin',TRUE);

INSERT INTO user_customer_assignments (
  id, user_id, customer_id, company_id, is_active
) VALUES (
  '72000000-0000-0000-0000-000000000201',
  '72000000-0000-0000-0000-000000000001',
  '75000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  TRUE
);

-- ============================================================================
-- SECTION 3: DOCUMENT FIXTURES
-- ============================================================================

INSERT INTO invoices (
  id, company_id, invoice_no, doc_type, invoice_date, customer_id, customer_name,
  currency, exchange_rate, base_currency, status
)
VALUES
  ('76000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','P1-INV-POST-01','Invoice',CURRENT_DATE,'75000000-0000-0000-0000-000000000001','P1 Assigned Customer','SGD',1,'SGD','Draft'),
  ('76000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','P1-INV-NOLINE','Invoice',CURRENT_DATE,'75000000-0000-0000-0000-000000000001','P1 Assigned Customer','SGD',1,'SGD','Draft'),
  ('76000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','P1-INV-ALLOC-1','Invoice',CURRENT_DATE,'75000000-0000-0000-0000-000000000001','P1 Assigned Customer','SGD',1,'SGD','Draft'),
  ('76000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000001','P1-INV-ALLOC-2','Invoice',CURRENT_DATE,'75000000-0000-0000-0000-000000000001','P1 Assigned Customer','SGD',1,'SGD','Draft'),
  ('76000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000001','P1-INV-BOUNCE','Invoice',CURRENT_DATE,'75000000-0000-0000-0000-000000000001','P1 Assigned Customer','SGD',1,'SGD','Draft'),
  ('76000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000001','P1-INV-UNASSGN','Invoice',CURRENT_DATE,'75000000-0000-0000-0000-000000000002','P1 Unassigned Customer','SGD',1,'SGD','Draft');

INSERT INTO invoice_lines (
  id, invoice_id, line_no, description, quantity, unit_price,
  line_amount, tax_amount, line_total, gl_account_id
)
VALUES
  ('77000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000001',10,'Smoke post invoice line',1,100,100,0,100,'73000000-0000-0000-0000-000000000005'),
  ('77000000-0000-0000-0000-000000000003','76000000-0000-0000-0000-000000000003',10,'Smoke allocate invoice line',1,100,100,0,100,'73000000-0000-0000-0000-000000000005'),
  ('77000000-0000-0000-0000-000000000004','76000000-0000-0000-0000-000000000004',10,'Smoke reverse allocation line',1,80,80,0,80,'73000000-0000-0000-0000-000000000005'),
  ('77000000-0000-0000-0000-000000000005','76000000-0000-0000-0000-000000000005',10,'Smoke bounce invoice line',1,70,70,0,70,'73000000-0000-0000-0000-000000000005'),
  ('77000000-0000-0000-0000-000000000006','76000000-0000-0000-0000-000000000006',10,'Smoke unassigned invoice line',1,60,60,0,60,'73000000-0000-0000-0000-000000000005');

INSERT INTO receipts (
  id, company_id, receipt_no, receipt_date, customer_id, customer_name,
  payment_method, currency, exchange_rate, base_currency, receipt_amount, base_amount,
  allocated_amount, unallocated_amount, bank_account_id, bank_account_name, status
)
VALUES
  ('78000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','P1-RCT-POST-01',CURRENT_DATE,'75000000-0000-0000-0000-000000000001','P1 Assigned Customer','TT','SGD',1,'SGD',100,100,0,100,'74000000-0000-0000-0000-000000000001','P1 Operating Bank','Draft'),
  ('78000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','P1-RCT-ALLOC-1',CURRENT_DATE,'75000000-0000-0000-0000-000000000001','P1 Assigned Customer','TT','SGD',1,'SGD',100,100,0,100,'74000000-0000-0000-0000-000000000001','P1 Operating Bank','Draft'),
  ('78000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','P1-RCT-REV-1',CURRENT_DATE,'75000000-0000-0000-0000-000000000001','P1 Assigned Customer','TT','SGD',1,'SGD',80,80,0,80,'74000000-0000-0000-0000-000000000001','P1 Operating Bank','Draft'),
  ('78000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000001','P1-RCT-BOUNCE',CURRENT_DATE,'75000000-0000-0000-0000-000000000001','P1 Assigned Customer','CHQ','SGD',1,'SGD',70,70,0,70,'74000000-0000-0000-0000-000000000001','P1 Operating Bank','Draft'),
  ('78000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000001','P1-RCT-NONCHQ',CURRENT_DATE,'75000000-0000-0000-0000-000000000001','P1 Assigned Customer','TT','SGD',1,'SGD',30,30,0,30,'74000000-0000-0000-0000-000000000001','P1 Operating Bank','Draft'),
  ('78000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000001','P1-RCT-UNASSGN',CURRENT_DATE,'75000000-0000-0000-0000-000000000002','P1 Unassigned Customer','TT','SGD',1,'SGD',60,60,0,60,'74000000-0000-0000-0000-000000000001','P1 Operating Bank','Draft');

-- ============================================================================
-- SECTION 4: AUTHORIZATION FAILURE SMOKE TESTS
-- ============================================================================

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000004');
SELECT p1_smoke_assert_error(
  'Auditor cannot post_invoice',
  $$SELECT post_invoice('76000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000001')$$
);
RESET ROLE;

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000005');
SELECT p1_smoke_assert_error(
  'System Admin cannot post_invoice',
  $$SELECT post_invoice('76000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000001')$$
);
RESET ROLE;

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000001');
SELECT p1_smoke_assert_error(
  'Authenticated caller cannot spoof another user id',
  $$SELECT post_invoice('76000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001')$$
);
RESET ROLE;

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000006');
SELECT p1_smoke_assert_error(
  'No-role authenticated user cannot post_invoice',
  $$SELECT post_invoice('76000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000001')$$
);
RESET ROLE;

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000001');
SELECT p1_smoke_assert_error(
  'AR Clerk cannot post unassigned customer invoice',
  $$SELECT post_invoice('76000000-0000-0000-0000-000000000006','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001')$$
);
RESET ROLE;

SELECT p1_smoke_assert(
  'Unauthorized post_invoice attempts rolled back',
  (SELECT status = 'Draft' FROM invoices WHERE id = '76000000-0000-0000-0000-000000000001')
);

-- ============================================================================
-- SECTION 5: post_invoice
-- ============================================================================

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000001');
SELECT post_invoice(
  '76000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001'
);
RESET ROLE;

SELECT p1_smoke_assert(
  'post_invoice happy path opens invoice',
  (SELECT status = 'Open' AND outstanding = 100 AND posted_by = '72000000-0000-0000-0000-000000000001'
   FROM invoices WHERE id = '76000000-0000-0000-0000-000000000001')
);
SELECT p1_smoke_assert(
  'post_invoice created one INV JE',
  (SELECT COUNT(*) = 1 FROM journal_entries WHERE source_type = 'INV' AND source_doc_id = '76000000-0000-0000-0000-000000000001')
);
SELECT p1_smoke_assert_balanced('post_invoice JEs are balanced', '71000000-0000-0000-0000-000000000001');

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000001');
SELECT p1_smoke_assert_error(
  'post_invoice failure path rejects invoice with no lines',
  $$SELECT post_invoice('76000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001')$$
);
RESET ROLE;
SELECT p1_smoke_assert(
  'post_invoice no-line failure rolls back invoice state',
  (SELECT status = 'Draft' AND posted_at IS NULL FROM invoices WHERE id = '76000000-0000-0000-0000-000000000002')
);

-- ============================================================================
-- SECTION 6: post_receipt
-- ============================================================================

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000001');
SELECT post_receipt(
  '78000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001'
);
RESET ROLE;

SELECT p1_smoke_assert(
  'post_receipt happy path posts receipt',
  (SELECT status = 'Posted' AND unallocated_amount = 100 AND posted_by = '72000000-0000-0000-0000-000000000001'
   FROM receipts WHERE id = '78000000-0000-0000-0000-000000000001')
);
SELECT p1_smoke_assert(
  'post_receipt created one RCT JE',
  (SELECT COUNT(*) = 1 FROM journal_entries WHERE source_type = 'RCT' AND source_doc_id = '78000000-0000-0000-0000-000000000001')
);
SELECT p1_smoke_assert_balanced('post_receipt JEs are balanced', '71000000-0000-0000-0000-000000000001');

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000001');
SELECT p1_smoke_assert_error(
  'post_receipt failure path rejects already posted receipt',
  $$SELECT post_receipt('78000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001')$$
);
SELECT p1_smoke_assert_error(
  'AR Clerk cannot post unassigned customer receipt',
  $$SELECT post_receipt('78000000-0000-0000-0000-000000000006','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001')$$
);
RESET ROLE;
SELECT p1_smoke_assert(
  'post_receipt failure did not create duplicate RCT JE',
  (SELECT COUNT(*) = 1 FROM journal_entries WHERE source_type = 'RCT' AND source_doc_id = '78000000-0000-0000-0000-000000000001')
);

-- ============================================================================
-- SECTION 7: allocate_receipt
-- ============================================================================

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000001');
SELECT post_invoice('76000000-0000-0000-0000-000000000003','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001');
SELECT post_receipt('78000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001');
SELECT allocate_receipt(
  '78000000-0000-0000-0000-000000000002',
  '72000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  '[{"invoice_id":"76000000-0000-0000-0000-000000000003","amount":100}]'::JSONB
);
RESET ROLE;

SELECT p1_smoke_assert(
  'allocate_receipt happy path creates active allocation',
  (SELECT COUNT(*) = 1 FROM allocation_details
   WHERE receipt_id = '78000000-0000-0000-0000-000000000002'
     AND invoice_id = '76000000-0000-0000-0000-000000000003'
     AND status = 'Active')
);
SELECT p1_smoke_assert(
  'allocate_receipt updates invoice and receipt balances',
  (SELECT i.status = 'Paid' AND i.outstanding = 0 AND r.status = 'Fully Allocated' AND r.unallocated_amount = 0
   FROM invoices i CROSS JOIN receipts r
   WHERE i.id = '76000000-0000-0000-0000-000000000003'
     AND r.id = '78000000-0000-0000-0000-000000000002')
);
SELECT p1_smoke_assert(
  'allocate_receipt did not create extra normal receipt JE',
  (SELECT COUNT(*) = 1 FROM journal_entries WHERE source_type = 'RCT' AND source_doc_id = '78000000-0000-0000-0000-000000000002')
);
SELECT p1_smoke_assert_balanced('allocate_receipt JEs are balanced', '71000000-0000-0000-0000-000000000001');

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000001');
SELECT p1_smoke_assert_error(
  'allocate_receipt failure path rejects over-allocation',
  $$SELECT allocate_receipt('78000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','[{"invoice_id":"76000000-0000-0000-0000-000000000003","amount":1}]'::JSONB)$$
);
RESET ROLE;
SELECT p1_smoke_assert(
  'allocate_receipt over-allocation failure did not add allocation',
  (SELECT COUNT(*) = 1 FROM allocation_details
   WHERE receipt_id = '78000000-0000-0000-0000-000000000002'
     AND invoice_id = '76000000-0000-0000-0000-000000000003')
);

-- ============================================================================
-- SECTION 8: reverse_allocation
-- ============================================================================

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000001');
SELECT post_invoice('76000000-0000-0000-0000-000000000004','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001');
SELECT post_receipt('78000000-0000-0000-0000-000000000003','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001');
SELECT allocate_receipt(
  '78000000-0000-0000-0000-000000000003',
  '72000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  '[{"invoice_id":"76000000-0000-0000-0000-000000000004","amount":70,"discount_amount":10}]'::JSONB
);
SELECT p1_smoke_assert_error(
  'reverse_allocation failure path rejects AR Clerk',
  $$SELECT reverse_allocation((SELECT id FROM allocation_details WHERE receipt_id = '78000000-0000-0000-0000-000000000003' AND status = 'Active'),'72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','clerk cannot reverse this allocation')$$
);
RESET ROLE;

SELECT p1_smoke_assert(
  'reverse_allocation clerk failure leaves allocation active',
  (SELECT COUNT(*) = 1 FROM allocation_details WHERE receipt_id = '78000000-0000-0000-0000-000000000003' AND status = 'Active')
);

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000002');
SELECT reverse_allocation(
  (SELECT id FROM allocation_details WHERE receipt_id = '78000000-0000-0000-0000-000000000003' AND status = 'Active'),
  '72000000-0000-0000-0000-000000000002',
  '71000000-0000-0000-0000-000000000001',
  'supervisor smoke test reversal'
);
RESET ROLE;

SELECT p1_smoke_assert(
  'reverse_allocation happy path reverses allocation',
  (SELECT COUNT(*) = 1 FROM allocation_details WHERE receipt_id = '78000000-0000-0000-0000-000000000003' AND status = 'Reversed')
);
SELECT p1_smoke_assert(
  'reverse_allocation restores invoice and receipt balances',
  (SELECT i.status = 'Open' AND i.outstanding = 80 AND r.status = 'Posted' AND r.unallocated_amount = 80
   FROM invoices i CROSS JOIN receipts r
   WHERE i.id = '76000000-0000-0000-0000-000000000004'
     AND r.id = '78000000-0000-0000-0000-000000000003')
);
SELECT p1_smoke_assert_balanced('reverse_allocation JEs are balanced', '71000000-0000-0000-0000-000000000001');

-- ============================================================================
-- SECTION 9: reverse_journal_entry
-- ============================================================================

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000002');
SELECT reverse_journal_entry(
  (SELECT id FROM journal_entries WHERE source_type = 'INV' AND source_doc_id = '76000000-0000-0000-0000-000000000001'),
  '72000000-0000-0000-0000-000000000002',
  '71000000-0000-0000-0000-000000000001',
  'supervisor smoke test JE reversal'
);
RESET ROLE;

SELECT p1_smoke_assert(
  'reverse_journal_entry happy path marks original reversed',
  (SELECT is_reversed = TRUE AND reversal_je_id IS NOT NULL
   FROM journal_entries
   WHERE source_type = 'INV' AND source_doc_id = '76000000-0000-0000-0000-000000000001')
);
SELECT p1_smoke_assert(
  'reverse_journal_entry created REV JE',
  (SELECT COUNT(*) = 1 FROM journal_entries
   WHERE source_type = 'REV'
     AND original_je_id = (SELECT id FROM journal_entries WHERE source_type = 'INV' AND source_doc_id = '76000000-0000-0000-0000-000000000001'))
);
SELECT p1_smoke_assert_balanced('reverse_journal_entry JEs are balanced', '71000000-0000-0000-0000-000000000001');

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000002');
SELECT p1_smoke_assert_error(
  'reverse_journal_entry failure path rejects double reversal',
  $$SELECT reverse_journal_entry((SELECT id FROM journal_entries WHERE source_type = 'INV' AND source_doc_id = '76000000-0000-0000-0000-000000000001'),'72000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','double reversal should fail')$$
);
RESET ROLE;

-- ============================================================================
-- SECTION 10: handle_bounced_cheque
-- ============================================================================

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000001');
SELECT post_invoice('76000000-0000-0000-0000-000000000005','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001');
SELECT post_receipt('78000000-0000-0000-0000-000000000004','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001');
SELECT post_receipt('78000000-0000-0000-0000-000000000005','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001');
SELECT allocate_receipt(
  '78000000-0000-0000-0000-000000000004',
  '72000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  '[{"invoice_id":"76000000-0000-0000-0000-000000000005","amount":70}]'::JSONB
);
SELECT p1_smoke_assert_error(
  'handle_bounced_cheque failure path rejects AR Clerk',
  $$SELECT handle_bounced_cheque('78000000-0000-0000-0000-000000000004','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','clerk cannot bounce cheque')$$
);
RESET ROLE;

SELECT p1_smoke_assert(
  'handle_bounced_cheque clerk failure leaves receipt allocated',
  (SELECT status = 'Fully Allocated' AND allocated_amount = 70 FROM receipts WHERE id = '78000000-0000-0000-0000-000000000004')
);

SELECT p1_smoke_login('72000000-0000-0000-0000-000000000003');
SELECT handle_bounced_cheque(
  '78000000-0000-0000-0000-000000000004',
  '72000000-0000-0000-0000-000000000003',
  '71000000-0000-0000-0000-000000000001',
  'finance manager smoke test bounced cheque',
  CURRENT_DATE
);
SELECT p1_smoke_assert_error(
  'handle_bounced_cheque failure path rejects non-CHQ receipt',
  $$SELECT handle_bounced_cheque('78000000-0000-0000-0000-000000000005','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','non cheque should not bounce',CURRENT_DATE)$$
);
RESET ROLE;

SELECT p1_smoke_assert(
  'handle_bounced_cheque happy path marks receipt bounced',
  (SELECT status = 'Bounced' AND allocated_amount = 0 AND unallocated_amount = 0
   FROM receipts WHERE id = '78000000-0000-0000-0000-000000000004')
);
SELECT p1_smoke_assert(
  'handle_bounced_cheque reverses active allocations',
  (SELECT COUNT(*) = 1 FROM allocation_details WHERE receipt_id = '78000000-0000-0000-0000-000000000004' AND status = 'Reversed')
);
SELECT p1_smoke_assert(
  'handle_bounced_cheque restores invoice outstanding',
  (SELECT status = 'Open' AND outstanding = 70 FROM invoices WHERE id = '76000000-0000-0000-0000-000000000005')
);
SELECT p1_smoke_assert(
  'handle_bounced_cheque reverses receipt RCT JE once',
  (SELECT COUNT(*) = 1
   FROM journal_entries rev
   WHERE rev.source_type = 'REV'
     AND rev.original_je_id = (
       SELECT id FROM journal_entries
       WHERE source_type = 'RCT'
         AND source_doc_id = '78000000-0000-0000-0000-000000000004'
     ))
);
SELECT p1_smoke_assert(
  'handle_bounced_cheque non-CHQ failure leaves receipt posted',
  (SELECT status = 'Posted' FROM receipts WHERE id = '78000000-0000-0000-0000-000000000005')
);
SELECT p1_smoke_assert_balanced('handle_bounced_cheque JEs are balanced', '71000000-0000-0000-0000-000000000001');

-- ============================================================================
-- SECTION 11: FINAL ROLLBACK
-- ============================================================================

SELECT p1_smoke_assert('P1 financial RPC staging smoke tests completed; rolling back fixtures', TRUE);
ROLLBACK;
