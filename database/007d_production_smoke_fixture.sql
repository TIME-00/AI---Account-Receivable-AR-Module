-- ============================================================================
-- TSH Synergy ERP - AR Module - 007d_production_smoke_fixture.sql
-- P0/P1 Production Smoke Test Fixture
-- ============================================================================
-- PRODUCTION-SAFE MINIMAL FIXTURE.
--
-- Purpose:
--   Create only the minimum records needed to smoke test:
--     1. POST /invoices/:id/post
--     2. POST /receipts/:id/post
--
-- Safety rules:
--   - Do not use database/007c_api_staging_fixtures.sql in production.
--   - Do not create bulk staging data.
--   - Do not touch real customer balances.
--   - Do not modify existing real invoices, receipts, allocations, or JEs.
--   - Do not delete/update audit logs.
--   - Use public schema only.
--
-- Behavior:
--   - Reuses a dedicated smoke customer if it already exists.
--   - Creates a fresh draft invoice + line and fresh draft receipt on each run.
--   - Uses existing production GL accounts/config, payment terms, and bank account.
--   - Uses a very small amount: 1.00.
--
-- Run manually in Supabase production SQL Editor after P0/P1 deployment.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_company_id       UUID := '00000000-0000-0000-0000-000000000001';
  v_customer_id      UUID;
  v_invoice_id       UUID := gen_random_uuid();
  v_receipt_id       UUID := gen_random_uuid();
  v_invoice_line_id  UUID := gen_random_uuid();
  v_payment_term_id  UUID;
  v_ar_acct_id       UUID;
  v_revenue_acct_id  UUID;
  v_bank_account_id  UUID;
  v_bank_account     TEXT;
  v_base_currency    CHAR(3);
  v_invoice_no       VARCHAR(20);
  v_receipt_no       VARCHAR(20);
  v_suffix           TEXT;
BEGIN
  -- Confirm company exists and capture base currency.
  SELECT base_currency
    INTO v_base_currency
    FROM companies
   WHERE id = v_company_id
     AND is_active = TRUE;

  IF v_base_currency IS NULL THEN
    RAISE EXCEPTION 'PROD_SMOKE: Active company % not found', v_company_id;
  END IF;

  -- Confirm current fiscal period is open for posting.
  IF NOT EXISTS (
    SELECT 1
      FROM fiscal_periods
     WHERE company_id = v_company_id
       AND period_code = to_char(CURRENT_DATE, 'YYYY-MM')
       AND status = 'Open'
  ) THEN
    RAISE EXCEPTION 'PROD_SMOKE: Current fiscal period % is not open for company %',
      to_char(CURRENT_DATE, 'YYYY-MM'), v_company_id;
  END IF;

  -- Resolve required GL accounts from production config, using seed fallbacks.
  SELECT ga.id
    INTO v_ar_acct_id
    FROM ar_system_config cfg
    JOIN gl_accounts ga
      ON ga.company_id = cfg.company_id
     AND ga.account_code = cfg.config_value
     AND ga.is_active = TRUE
   WHERE cfg.company_id = v_company_id
     AND cfg.config_key = 'default_ar_control_acct';

  IF v_ar_acct_id IS NULL THEN
    SELECT id INTO v_ar_acct_id
      FROM gl_accounts
     WHERE company_id = v_company_id
       AND account_code = '1100-001'
       AND is_active = TRUE;
  END IF;

  SELECT ga.id
    INTO v_revenue_acct_id
    FROM ar_system_config cfg
    JOIN gl_accounts ga
      ON ga.company_id = cfg.company_id
     AND ga.account_code = cfg.config_value
     AND ga.is_active = TRUE
   WHERE cfg.company_id = v_company_id
     AND cfg.config_key = 'default_revenue_acct';

  IF v_revenue_acct_id IS NULL THEN
    SELECT id INTO v_revenue_acct_id
      FROM gl_accounts
     WHERE company_id = v_company_id
       AND account_code = '4000-001'
       AND is_active = TRUE;
  END IF;

  IF v_ar_acct_id IS NULL OR v_revenue_acct_id IS NULL THEN
    RAISE EXCEPTION 'PROD_SMOKE: Missing active AR/revenue GL accounts for company %', v_company_id;
  END IF;

  -- Use an existing active payment term where possible.
  SELECT id
    INTO v_payment_term_id
    FROM payment_terms
   WHERE company_id = v_company_id
     AND is_active = TRUE
   ORDER BY CASE WHEN term_code = 'NET30' THEN 0 ELSE 1 END, term_code
   LIMIT 1;

  -- Use an existing active bank account with an active mapped GL account.
  SELECT ba.id, ba.account_name
    INTO v_bank_account_id, v_bank_account
    FROM bank_accounts ba
    JOIN gl_accounts ga
      ON ga.id = ba.gl_account_id
     AND ga.company_id = ba.company_id
     AND ga.is_active = TRUE
   WHERE ba.company_id = v_company_id
     AND ba.is_active = TRUE
   ORDER BY ba.created_at, ba.id
   LIMIT 1;

  IF v_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'PROD_SMOKE: No active bank account with active GL mapping found for company %', v_company_id;
  END IF;

  -- Dedicated smoke customer. Reused if already present.
  SELECT id
    INTO v_customer_id
    FROM customers
   WHERE company_id = v_company_id
     AND customer_id = 'PROD-SMOKE-CUST'
   LIMIT 1;

  IF v_customer_id IS NULL THEN
    v_customer_id := gen_random_uuid();

    INSERT INTO customers (
      id, company_id, customer_id, customer_name, short_name,
      customer_type, registration_no, status,
      bill_addr_line1, bill_city, bill_state, bill_postal, bill_country,
      contact_name, contact_phone, contact_email,
      default_currency, ar_control_acct_id, revenue_acct_id, payment_term_id,
      credit_limit, credit_rating, e_invoice_enabled
    )
    VALUES (
      v_customer_id,
      v_company_id,
      'PROD-SMOKE-CUST',
      'PROD SMOKE TEST CUSTOMER - DO NOT USE',
      'PROD SMOKE',
      'Corporate',
      'PROD-SMOKE',
      'Active',
      'Production smoke test address',
      'Kuala Lumpur',
      'Wilayah Persekutuan',
      '50000',
      'MY',
      'Production Smoke Tester',
      '+60000000000',
      'prod-smoke@example.test',
      v_base_currency,
      v_ar_acct_id,
      v_revenue_acct_id,
      v_payment_term_id,
      100.00,
      'A',
      FALSE
    );
  END IF;

  -- invoice_no/receipt_no are VARCHAR(20). Keep prefix short but obvious.
  v_suffix := upper(substr(replace(v_invoice_id::TEXT, '-', ''), 1, 6));
  v_invoice_no := ('PROD-SMOKE-I-' || v_suffix)::VARCHAR(20);
  v_receipt_no := ('PROD-SMOKE-R-' || v_suffix)::VARCHAR(20);

  INSERT INTO invoices (
    id, company_id, invoice_no, doc_type, invoice_date, due_date,
    customer_id, customer_name, currency, exchange_rate, base_currency,
    subtotal, tax_total, total_amount, base_total, outstanding,
    status, posting_period, reference_no, internal_remarks, invoice_remarks,
    ar_acct, version
  )
  VALUES (
    v_invoice_id,
    v_company_id,
    v_invoice_no,
    'Invoice',
    CURRENT_DATE,
    NULL,
    v_customer_id,
    'PROD SMOKE TEST CUSTOMER - DO NOT USE',
    v_base_currency,
    1.000000,
    v_base_currency,
    1.00,
    0.00,
    1.00,
    1.00,
    0.00,
    'Draft',
    NULL,
    'PROD-SMOKE',
    'Production smoke test invoice. Safe test data.',
    'Production smoke test invoice. Do not send to customer.',
    NULL,
    1
  );

  INSERT INTO invoice_lines (
    id, invoice_id, line_no, description, quantity, uom, unit_price,
    discount_pct, discount_amt, line_amount, tax_code_id, tax_rate,
    tax_amount, line_total, gl_account_id, line_remarks
  )
  VALUES (
    v_invoice_line_id,
    v_invoice_id,
    10,
    'PROD-SMOKE minimal invoice line',
    1,
    'EA',
    1.0000,
    0,
    0,
    1.00,
    NULL,
    0,
    0.00,
    1.00,
    v_revenue_acct_id,
    'Production smoke test line'
  );

  INSERT INTO receipts (
    id, company_id, receipt_no, receipt_date, value_date,
    customer_id, customer_name, payment_method, currency, exchange_rate,
    base_currency, receipt_amount, base_amount, allocated_amount,
    unallocated_amount, bank_account_id, bank_account_name, reference_no,
    cheque_date, status, posting_period, remarks
  )
  VALUES (
    v_receipt_id,
    v_company_id,
    v_receipt_no,
    CURRENT_DATE,
    CURRENT_DATE,
    v_customer_id,
    'PROD SMOKE TEST CUSTOMER - DO NOT USE',
    'TT',
    v_base_currency,
    1.000000,
    v_base_currency,
    1.00,
    1.00,
    0.00,
    1.00,
    v_bank_account_id,
    v_bank_account,
    'PROD-SMOKE',
    NULL,
    'Draft',
    NULL,
    'Production smoke test receipt. Safe test data.'
  );

  RAISE NOTICE 'PROD_SMOKE created customer %, draft invoice % (%), draft receipt % (%)',
    v_customer_id, v_invoice_id, v_invoice_no, v_receipt_id, v_receipt_no;
END;
$$;

COMMIT;

-- ============================================================================
-- REQUIRED AR CLERK CUSTOMER ASSIGNMENT
-- ============================================================================
-- Replace <AR_CLERK_USER_ID> with the production AR Clerk auth.users.id that
-- will call POST /invoices/:id/post and POST /receipts/:id/post.
--
-- Run this after reviewing the final SELECT output below:
--
-- INSERT INTO user_customer_assignments (
--   user_id, customer_id, company_id, is_active
-- )
-- VALUES (
--   '<AR_CLERK_USER_ID>',
--   (
--     SELECT id
--     FROM customers
--     WHERE company_id = '00000000-0000-0000-0000-000000000001'
--       AND customer_id = 'PROD-SMOKE-CUST'
--   ),
--   '00000000-0000-0000-0000-000000000001',
--   TRUE
-- )
-- ON CONFLICT (user_id, customer_id)
-- DO UPDATE SET is_active = TRUE;

-- ============================================================================
-- FINAL OUTPUT: COPY THESE VALUES INTO YOUR PRODUCTION SMOKE TEST VARIABLES
-- ============================================================================

SELECT key, value
FROM (
  SELECT 'COMPANY_ID' AS key, '00000000-0000-0000-0000-000000000001' AS value
  UNION ALL
  SELECT 'SMOKE_CUSTOMER_ID', id::TEXT
  FROM customers
  WHERE company_id = '00000000-0000-0000-0000-000000000001'
    AND customer_id = 'PROD-SMOKE-CUST'
  UNION ALL
  SELECT 'PROD_DRAFT_INVOICE_ID', id::TEXT
  FROM (
    SELECT id
    FROM invoices
    WHERE company_id = '00000000-0000-0000-0000-000000000001'
      AND reference_no = 'PROD-SMOKE'
      AND status = 'Draft'
      AND invoice_no LIKE 'PROD-SMOKE-I-%'
    ORDER BY created_at DESC, invoice_no DESC
    LIMIT 1
  ) latest_invoice
  UNION ALL
  SELECT 'PROD_DRAFT_RECEIPT_ID', id::TEXT
  FROM (
    SELECT id
    FROM receipts
    WHERE company_id = '00000000-0000-0000-0000-000000000001'
      AND reference_no = 'PROD-SMOKE'
      AND status = 'Draft'
      AND receipt_no LIKE 'PROD-SMOKE-R-%'
    ORDER BY created_at DESC, receipt_no DESC
    LIMIT 1
  ) latest_receipt
  UNION ALL
  SELECT 'PROD_DRAFT_INVOICE_NO', invoice_no
  FROM (
    SELECT invoice_no
    FROM invoices
    WHERE company_id = '00000000-0000-0000-0000-000000000001'
      AND reference_no = 'PROD-SMOKE'
      AND status = 'Draft'
      AND invoice_no LIKE 'PROD-SMOKE-I-%'
    ORDER BY created_at DESC, invoice_no DESC
    LIMIT 1
  ) latest_invoice_no
  UNION ALL
  SELECT 'PROD_DRAFT_RECEIPT_NO', receipt_no
  FROM (
    SELECT receipt_no
    FROM receipts
    WHERE company_id = '00000000-0000-0000-0000-000000000001'
      AND reference_no = 'PROD-SMOKE'
      AND status = 'Draft'
      AND receipt_no LIKE 'PROD-SMOKE-R-%'
    ORDER BY created_at DESC, receipt_no DESC
    LIMIT 1
  ) latest_receipt_no
) output
ORDER BY CASE key
  WHEN 'COMPANY_ID' THEN 1
  WHEN 'SMOKE_CUSTOMER_ID' THEN 2
  WHEN 'PROD_DRAFT_INVOICE_ID' THEN 3
  WHEN 'PROD_DRAFT_RECEIPT_ID' THEN 4
  WHEN 'PROD_DRAFT_INVOICE_NO' THEN 5
  WHEN 'PROD_DRAFT_RECEIPT_NO' THEN 6
  ELSE 99
END;
