-- ============================================================================
-- TSH Synergy ERP — Accounts Receivable Module
-- Database Schema: 007_financial_rpcs.sql
-- Target: PostgreSQL 15+ (Supabase)
-- Version: 1.0
-- Date: 2026-05-13
-- ============================================================================
-- EXECUTION ORDER: Run AFTER 006_rls_policies.sql
-- ============================================================================
-- P1 Financial Transaction RPCs
--   6 SECURITY DEFINER stored procedures that replace multi-step Edge Function
--   mutations with atomic database transactions.
--
--   1. post_invoice        — Draft → Open + JE generation
--   2. post_receipt         — Draft → Posted + JE generation
--   3. allocate_receipt     — Receipt ↔ Invoice matching + forex/discount JEs
--   4. reverse_allocation   — Undo a single allocation + restore balances
--   5. reverse_journal_entry — Create mirror-image reversal JE
--   6. handle_bounced_cheque — Atomic cheque bounce (reverses all allocations + JEs)
--
-- All RPCs:
--   • SECURITY DEFINER + SET search_path = public
--   • Verify caller via user_roles (not JWT claims alone)
--   • Use SELECT ... FOR UPDATE for race-prone rows
--   • Generate balanced journal entries (enforced by chk_je_balanced)
--   • Return JSONB result
-- ============================================================================

-- ============================================================================
-- SECTION 0: SHARED AUTHORIZATION HELPER
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_check_role(
  p_user_id   UUID,
  p_company_id UUID,
  p_min_roles  TEXT[]  -- e.g. ARRAY['AR Clerk','AR Supervisor','Finance Manager']
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim_sub  TEXT := NULLIF(current_setting('request.jwt.claim.sub', TRUE), '');
  v_claim_role TEXT := current_setting('request.jwt.claim.role', TRUE);
BEGIN
  IF v_claim_role = 'authenticated' AND v_claim_sub IS NULL THEN
    RAISE EXCEPTION 'AUTH: Missing authenticated user context';
  END IF;

  IF v_claim_sub IS NOT NULL AND v_claim_sub::UUID != p_user_id THEN
    RAISE EXCEPTION 'AUTH: Caller cannot act as another user';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = p_user_id
      AND company_id = p_company_id
      AND is_active = TRUE
      AND role = ANY(p_min_roles)
  ) THEN
    RAISE EXCEPTION 'AUTH: User does not have required role in this company';
  END IF;
END;
$$;

COMMENT ON FUNCTION rpc_check_role(UUID, UUID, TEXT[]) IS
  'P1 helper: verify caller has an active operational role. Rejects Auditor and System Admin for mutations.';

CREATE OR REPLACE FUNCTION rpc_get_config_account(
  p_company_id  UUID,
  p_config_key  TEXT,
  p_fallback    TEXT,
  p_label       TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  v_id   UUID;
BEGIN
  SELECT config_value INTO v_code
  FROM ar_system_config
  WHERE company_id = p_company_id
    AND config_key = p_config_key;

  SELECT id INTO v_id
  FROM gl_accounts
  WHERE company_id = p_company_id
    AND account_code = COALESCE(v_code, p_fallback)
    AND is_active = TRUE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'CONFIG: Missing active GL account for % (config %, fallback %)',
      p_label, p_config_key, p_fallback;
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION rpc_get_config_account(UUID, TEXT, TEXT, TEXT) IS
  'P1 helper: resolve required company GL account from ar_system_config with active-account validation.';

CREATE OR REPLACE FUNCTION rpc_check_customer_access(
  p_user_id     UUID,
  p_company_id  UUID,
  p_customer_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = p_user_id
      AND company_id = p_company_id
      AND is_active = TRUE
      AND role IN ('AR Supervisor', 'Finance Manager')
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN user_customer_assignments uca
      ON uca.user_id = ur.user_id
     AND uca.company_id = ur.company_id
     AND uca.customer_id = p_customer_id
     AND uca.is_active = TRUE
    WHERE ur.user_id = p_user_id
      AND ur.company_id = p_company_id
      AND ur.is_active = TRUE
      AND ur.role = 'AR Clerk'
  ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'AUTH: User does not have access to this customer';
END;
$$;

COMMENT ON FUNCTION rpc_check_customer_access(UUID, UUID, UUID) IS
  'P1 helper: preserves AR Clerk customer assignment checks inside SECURITY DEFINER mutation RPCs.';

-- ============================================================================
-- SECTION 1: post_invoice
-- ============================================================================
-- Replaces InvoiceService.postInvoice() (service.ts L357-621)
-- Locks: invoices row FOR UPDATE
-- JE pattern: INV → Dr AR, Cr Revenue, Cr Tax
--             CN  → Dr Revenue, Dr Tax, Cr AR
--             DN  → Dr AR, Cr Revenue, Cr Tax
-- ============================================================================

CREATE OR REPLACE FUNCTION post_invoice(
  p_invoice_id  UUID,
  p_user_id     UUID,
  p_company_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv           RECORD;
  v_cust          RECORD;
  v_line          RECORD;
  v_term          RECORD;
  v_tc            RECORD;
  v_period        VARCHAR(7);
  v_due_date      DATE;
  v_je_id         UUID;
  v_je_no         VARCHAR(30);
  v_ar_acct_id    UUID;
  v_rev_acct_id   UUID;
  v_tax_acct_id   UUID;
  v_ar_acct_code  VARCHAR(20);
  v_source_type   VARCHAR(3);
  v_subtotal      NUMERIC(18,2) := 0;
  v_tax_total     NUMERIC(18,2) := 0;
  v_total_amount  NUMERIC(18,2) := 0;
  v_base_total    NUMERIC(18,2) := 0;
  v_line_count    INT := 0;
  v_line_no       INT := 0;
  v_total_debit   NUMERIC(18,2) := 0;
  v_total_credit  NUMERIC(18,2) := 0;
  v_failures      TEXT[] := '{}';
  v_future_limit  INT;
  v_inv_date      DATE;
  v_credit_util   NUMERIC(18,2);
  v_credit_limit  NUMERIC(18,2);
  v_config_val    TEXT;
  v_default_code  TEXT;
BEGIN
  -- ── Auth ──
  PERFORM rpc_check_role(p_user_id, p_company_id,
    ARRAY['AR Clerk','AR Supervisor','Finance Manager']);

  -- ── 1. Lock invoice ──
  SELECT * INTO v_inv FROM invoices
    WHERE id = p_invoice_id AND company_id = p_company_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Invoice not found';
  END IF;
  IF v_inv.status != 'Draft' THEN
    RAISE EXCEPTION 'BR-INV-STATUS: Only Draft invoices can be posted. Current: %', v_inv.status;
  END IF;

  -- ── 2. Must have lines ──
  SELECT COUNT(*) INTO v_line_count FROM invoice_lines WHERE invoice_id = p_invoice_id;
  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'BR-INV-002: Invoice must have at least 1 line item';
  END IF;

  -- ── 3. Customer validation ──
  SELECT * INTO v_cust FROM customers WHERE id = v_inv.customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Customer not found';
  END IF;
  IF v_cust.status = 'Blocked' THEN
    RAISE EXCEPTION 'BR-CUS-002: Customer "%" is Blocked', v_cust.customer_name;
  END IF;
  IF v_cust.status = 'Inactive' AND v_inv.doc_type != 'Credit Note' THEN
    RAISE EXCEPTION 'BR-CUS-001: Customer "%" is Inactive', v_cust.customer_name;
  END IF;
  PERFORM rpc_check_customer_access(p_user_id, p_company_id, v_inv.customer_id);

  -- ── 4. Recalculate totals from lines ──
  SELECT COALESCE(SUM(line_amount), 0),
         COALESCE(SUM(tax_amount), 0)
    INTO v_subtotal, v_tax_total
    FROM invoice_lines WHERE invoice_id = p_invoice_id;
  v_total_amount := v_subtotal + v_tax_total;
  v_base_total   := ROUND(v_total_amount * v_inv.exchange_rate, 2);

  UPDATE invoices SET
    subtotal = v_subtotal,
    tax_total = v_tax_total,
    total_amount = v_total_amount,
    base_total = v_base_total
  WHERE id = p_invoice_id;

  -- ── 5. Credit check (Invoice/DN only) ──
  IF v_inv.doc_type != 'Credit Note' THEN
    SELECT credit_limit, credit_utilization
      INTO v_credit_limit, v_credit_util
      FROM v_customer_credit_utilization
      WHERE id = v_inv.customer_id;
    IF FOUND AND v_credit_limit > 0 AND (v_credit_util + v_total_amount) > v_credit_limit THEN
      RAISE EXCEPTION 'BR-CM-001: Credit limit exceeded for "%". Utilization: %, Limit: %',
        v_cust.customer_name, v_credit_util + v_total_amount, v_credit_limit;
    END IF;
  END IF;

  -- ── 6. Fiscal period ──
  v_period := to_char(v_inv.invoice_date, 'YYYY-MM');
  IF NOT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE company_id = p_company_id AND period_code = v_period AND status = 'Open'
  ) THEN
    RAISE EXCEPTION 'BR-JE-007: Fiscal period % is not open', v_period;
  END IF;

  -- ── 7. Future date limit ──
  SELECT config_value INTO v_config_val FROM ar_system_config
    WHERE company_id = p_company_id AND config_key = 'invoice_future_days_limit';
  v_future_limit := COALESCE(v_config_val::INT, 7);
  IF (v_inv.invoice_date - CURRENT_DATE) > v_future_limit THEN
    RAISE EXCEPTION 'BR-INV-002: Invoice date exceeds allowed future days limit (% days)', v_future_limit;
  END IF;

  -- ── 8. Tax code effectiveness ──
  FOR v_line IN SELECT * FROM invoice_lines WHERE invoice_id = p_invoice_id ORDER BY line_no LOOP
    IF v_line.tax_code_id IS NOT NULL THEN
      SELECT is_active, effective_from, effective_to INTO v_tc
        FROM tax_codes WHERE id = v_line.tax_code_id;
      IF NOT FOUND OR NOT v_tc.is_active THEN
        v_failures := array_append(v_failures, format('Line %s: Tax code is inactive', v_line.line_no));
      ELSIF v_inv.invoice_date < v_tc.effective_from
         OR (v_tc.effective_to IS NOT NULL AND v_inv.invoice_date > v_tc.effective_to) THEN
        v_failures := array_append(v_failures,
          format('Line %s: Tax code not effective on %s', v_line.line_no, v_inv.invoice_date));
      END IF;
    END IF;
  END LOOP;
  IF array_length(v_failures, 1) > 0 THEN
    RAISE EXCEPTION 'BR-INV-002: Tax validation failed: %', array_to_string(v_failures, '; ');
  END IF;

  -- ── 9. Calculate due_date ──
  IF v_cust.payment_term_id IS NOT NULL THEN
    SELECT term_type, days INTO v_term FROM payment_terms WHERE id = v_cust.payment_term_id;
    IF FOUND THEN
      v_due_date := calculate_due_date(v_inv.invoice_date, v_term.term_type, v_term.days);
    END IF;
  END IF;
  IF v_due_date IS NULL AND v_inv.doc_type != 'Credit Note' THEN
    v_due_date := v_inv.invoice_date + 30;  -- NET30 fallback
  END IF;

  -- ── 10. Resolve GL accounts ──
  v_ar_acct_id := v_cust.ar_control_acct_id;
  IF v_ar_acct_id IS NULL THEN
    v_ar_acct_id := rpc_get_config_account(
      p_company_id, 'default_ar_control_acct', '1100-001', 'AR control');
  END IF;

  v_rev_acct_id := v_cust.revenue_acct_id;
  IF v_rev_acct_id IS NULL THEN
    v_rev_acct_id := rpc_get_config_account(
      p_company_id, 'default_revenue_acct', '4000-001', 'revenue');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id = v_ar_acct_id AND company_id = p_company_id AND is_active = TRUE) THEN
    RAISE EXCEPTION 'CONFIG: AR control account is missing or inactive for %', v_inv.invoice_no;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id = v_rev_acct_id AND company_id = p_company_id AND is_active = TRUE) THEN
    RAISE EXCEPTION 'CONFIG: Revenue account is missing or inactive for %', v_inv.invoice_no;
  END IF;

  -- Tax account from first line with tax
  SELECT tc.gl_account_id INTO v_tax_acct_id
    FROM invoice_lines il
    JOIN tax_codes tc ON tc.id = il.tax_code_id
    WHERE il.invoice_id = p_invoice_id AND il.tax_amount > 0 AND tc.gl_account_id IS NOT NULL
    LIMIT 1;

  IF v_tax_total > 0 AND v_tax_acct_id IS NULL THEN
    RAISE EXCEPTION 'CONFIG: Missing tax GL account for invoice % with tax amount %',
      v_inv.invoice_no, v_tax_total;
  END IF;

  -- AR account code snapshot
  SELECT account_code INTO v_ar_acct_code FROM gl_accounts WHERE id = v_ar_acct_id;

  -- ── 11. Determine source_type ──
  v_source_type := CASE v_inv.doc_type
    WHEN 'Invoice' THEN 'INV'
    WHEN 'Credit Note' THEN 'CN'
    WHEN 'Debit Note' THEN 'DN'
  END;

  -- ── 12. Generate JE ──
  IF TRUE THEN
    SELECT get_next_sequence(p_company_id, 'JE', v_source_type) INTO v_je_no;

    -- JE header
    INSERT INTO journal_entries (
      company_id, je_no, je_date, posting_period, source_type,
      source_doc_no, source_doc_id, description,
      currency, exchange_rate, base_currency,
      total_debit, total_credit, created_by
    ) VALUES (
      p_company_id, v_je_no, v_inv.invoice_date, v_period, v_source_type,
      v_inv.invoice_no, p_invoice_id,
      format('%s posting: %s — %s', v_inv.doc_type, v_inv.invoice_no, v_inv.customer_name),
      v_inv.currency, v_inv.exchange_rate, v_inv.base_currency,
      v_total_amount, v_total_amount, p_user_id
    ) RETURNING id INTO v_je_id;

    v_line_no := 0;

    IF v_inv.doc_type IN ('Invoice', 'Debit Note') THEN
      -- Dr AR Control
      v_line_no := v_line_no + 10;
      INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
        debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
      VALUES (v_je_id, v_line_no, v_ar_acct_id,
        format('AR: %s - %s', v_inv.invoice_no, v_inv.customer_name),
        v_total_amount, 0,
        ROUND(v_total_amount * v_inv.exchange_rate, 2), 0,
        v_inv.currency, v_total_amount);
      v_total_debit := v_total_amount;

      -- Cr Revenue per line
      FOR v_line IN
        SELECT il.gl_account_id AS line_gl, il.line_amount, il.line_no AS lno, il.description AS ldesc
        FROM invoice_lines il WHERE il.invoice_id = p_invoice_id AND il.line_amount > 0 ORDER BY il.line_no
      LOOP
        v_line_no := v_line_no + 10;
        INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
          debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
        VALUES (v_je_id, v_line_no, COALESCE(v_line.line_gl, v_rev_acct_id),
          format('Revenue L%s: %s', v_line.lno, v_line.ldesc),
          0, v_line.line_amount,
          0, ROUND(v_line.line_amount * v_inv.exchange_rate, 2),
          v_inv.currency, v_line.line_amount);
        v_total_credit := v_total_credit + v_line.line_amount;
      END LOOP;

      -- Cr Tax
      IF v_tax_total > 0 AND v_tax_acct_id IS NOT NULL THEN
        v_line_no := v_line_no + 10;
        INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
          debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
        VALUES (v_je_id, v_line_no, v_tax_acct_id,
          format('Tax: %s', v_inv.invoice_no),
          0, v_tax_total,
          0, ROUND(v_tax_total * v_inv.exchange_rate, 2),
          v_inv.currency, v_tax_total);
        v_total_credit := v_total_credit + v_tax_total;
      END IF;

    ELSE  -- Credit Note: reversed direction
      -- Dr Revenue
      v_line_no := v_line_no + 10;
      INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
        debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
      VALUES (v_je_id, v_line_no, v_rev_acct_id,
        format('CN Revenue reversal: %s', v_inv.invoice_no),
        v_subtotal, 0,
        ROUND(v_subtotal * v_inv.exchange_rate, 2), 0,
        v_inv.currency, v_subtotal);
      v_total_debit := v_subtotal;

      -- Dr Tax
      IF v_tax_total > 0 AND v_tax_acct_id IS NOT NULL THEN
        v_line_no := v_line_no + 10;
        INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
          debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
        VALUES (v_je_id, v_line_no, v_tax_acct_id,
          format('CN Tax reversal: %s', v_inv.invoice_no),
          v_tax_total, 0,
          ROUND(v_tax_total * v_inv.exchange_rate, 2), 0,
          v_inv.currency, v_tax_total);
        v_total_debit := v_total_debit + v_tax_total;
      END IF;

      -- Cr AR Control
      v_line_no := v_line_no + 10;
      INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
        debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
      VALUES (v_je_id, v_line_no, v_ar_acct_id,
        format('CN AR: %s - %s', v_inv.invoice_no, v_inv.customer_name),
        0, v_total_amount,
        0, ROUND(v_total_amount * v_inv.exchange_rate, 2),
        v_inv.currency, v_total_amount);
      v_total_credit := v_total_amount;
    END IF;

    -- Update JE totals (chk_je_balanced will enforce)
    UPDATE journal_entries SET total_debit = v_total_debit, total_credit = v_total_credit
      WHERE id = v_je_id;
  END IF;

  -- ── 13. Update invoice ──
  UPDATE invoices SET
    status = 'Open',
    outstanding = v_total_amount,
    due_date = v_due_date,
    posting_period = v_period,
    ar_acct = v_ar_acct_code,
    posted_by = p_user_id,
    posted_at = NOW(),
    version = v_inv.version + 1
  WHERE id = p_invoice_id AND version = v_inv.version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFLICT: Invoice was modified by another user during posting';
  END IF;

  -- ── 14. Linked CN auto-deduction (BR-CN-003) ──
  IF v_inv.doc_type = 'Credit Note' AND v_inv.cn_type = 'Linked' AND v_inv.ref_invoice_id IS NOT NULL THEN
    DECLARE
      v_ref    RECORD;
      v_new_os NUMERIC(18,2);
      v_cum_cn NUMERIC(18,2);
    BEGIN
      SELECT * INTO v_ref FROM invoices WHERE id = v_inv.ref_invoice_id FOR UPDATE;
      IF FOUND THEN
        -- BR-CN-001: CN amount cannot exceed outstanding
        IF v_total_amount > v_ref.outstanding THEN
          RAISE EXCEPTION 'BR-CN-001: CN amount (%) exceeds outstanding (%) of %',
            v_total_amount, v_ref.outstanding, v_ref.invoice_no;
        END IF;
        -- BR-CN-002: cumulative check
        SELECT COALESCE(SUM(total_amount), 0) INTO v_cum_cn
          FROM invoices
          WHERE ref_invoice_id = v_inv.ref_invoice_id
            AND doc_type = 'Credit Note' AND cn_type = 'Linked'
            AND status != 'Cancelled' AND id != p_invoice_id;
        IF (v_cum_cn + v_total_amount) > v_ref.total_amount THEN
          RAISE EXCEPTION 'BR-CN-002: Cumulative CN (%) exceeds original total (%) for %',
            v_cum_cn + v_total_amount, v_ref.total_amount, v_ref.invoice_no;
        END IF;

        v_new_os := ROUND(v_ref.outstanding - v_total_amount, 2);
        UPDATE invoices SET
          outstanding = v_new_os,
          status = CASE
            WHEN v_new_os <= 0 THEN 'Paid'
            WHEN v_new_os < v_ref.total_amount THEN 'Partially Paid'
            ELSE v_ref.status
          END,
          version = v_ref.version + 1
        WHERE id = v_inv.ref_invoice_id AND version = v_ref.version;

        INSERT INTO cn_allocations (cn_id, invoice_id, allocated_amount, allocated_by, status)
        VALUES (p_invoice_id, v_inv.ref_invoice_id, v_total_amount, p_user_id, 'Active');

        UPDATE invoices SET
          outstanding = 0,
          status = 'Paid',
          version = version + 1
        WHERE id = p_invoice_id;
      END IF;
    END;
  END IF;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'invoice_no', v_inv.invoice_no,
    'je_no', v_je_no,
    'status', CASE WHEN v_inv.doc_type = 'Credit Note' AND v_inv.cn_type = 'Linked' THEN 'Paid' ELSE 'Open' END,
    'due_date', v_due_date,
    'total_amount', v_total_amount
  );
END;
$$;

COMMENT ON FUNCTION post_invoice(UUID, UUID, UUID) IS
  'P1 RPC: Atomic invoice posting. Locks invoice row, validates all business rules, '
  'generates balanced JE, updates status. Handles INV/CN/DN and Linked CN auto-deduction.';

-- ============================================================================
-- SECTION 2: post_receipt
-- ============================================================================
-- Replaces ReceiptService.postReceipt() (service.ts L151-267)
-- Locks: receipts row FOR UPDATE
-- JE: Non-CHQ → Dr Bank, Cr AR  |  CHQ → Dr Cheques on Hand, Cr AR
-- ============================================================================

CREATE OR REPLACE FUNCTION post_receipt(
  p_receipt_id  UUID,
  p_user_id     UUID,
  p_company_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rct          RECORD;
  v_cust         RECORD;
  v_bank         RECORD;
  v_period       VARCHAR(7);
  v_je_id        UUID;
  v_je_no        VARCHAR(30);
  v_ar_acct_id   UUID;
  v_debit_acct   UUID;
  v_debit_desc   TEXT;
  v_config_val   TEXT;
  v_default_code TEXT;
BEGIN
  -- ── Auth ──
  PERFORM rpc_check_role(p_user_id, p_company_id,
    ARRAY['AR Clerk','AR Supervisor','Finance Manager']);

  -- ── 1. Lock receipt ──
  SELECT * INTO v_rct FROM receipts
    WHERE id = p_receipt_id AND company_id = p_company_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Receipt not found';
  END IF;
  IF v_rct.status != 'Draft' THEN
    RAISE EXCEPTION 'BR-RCT-STATUS: Only Draft receipts can be posted. Current: %', v_rct.status;
  END IF;

  -- ── 2. Amount ──
  IF v_rct.receipt_amount <= 0 THEN
    RAISE EXCEPTION 'BR-RCT-001: Receipt amount must be greater than 0';
  END IF;

  -- ── 3. Customer ──
  SELECT * INTO v_cust FROM customers WHERE id = v_rct.customer_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Customer not found';
  END IF;
  IF v_cust.status = 'Blocked' THEN
    RAISE EXCEPTION 'BR-CUS-002: Customer "%" is Blocked', v_cust.customer_name;
  END IF;
  PERFORM rpc_check_customer_access(p_user_id, p_company_id, v_rct.customer_id);

  -- ── 4. Bank account ──
  SELECT * INTO v_bank FROM bank_accounts WHERE id = v_rct.bank_account_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Bank account not found';
  END IF;
  IF NOT v_bank.is_active THEN
    RAISE EXCEPTION 'BR-RCT-001: Bank account is inactive';
  END IF;

  -- ── 5. Fiscal period ──
  v_period := to_char(v_rct.receipt_date, 'YYYY-MM');
  IF NOT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE company_id = p_company_id AND period_code = v_period AND status = 'Open'
  ) THEN
    RAISE EXCEPTION 'BR-JE-007: Fiscal period % is not open', v_period;
  END IF;

  -- ── 6. Resolve GL accounts ──
  v_ar_acct_id := v_cust.ar_control_acct_id;
  IF v_ar_acct_id IS NULL THEN
    v_ar_acct_id := rpc_get_config_account(
      p_company_id, 'default_ar_control_acct', '1100-001', 'AR control');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id = v_ar_acct_id AND company_id = p_company_id AND is_active = TRUE) THEN
    RAISE EXCEPTION 'CONFIG: AR control account is missing or inactive for %', v_rct.receipt_no;
  END IF;

  IF v_rct.payment_method = 'CHQ' THEN
    v_debit_acct := rpc_get_config_account(
      p_company_id, 'default_cheque_acct', '1050-001', 'cheques on hand');
    v_debit_desc := format('Cheques on Hand: %s', v_rct.receipt_no);
  ELSE
    v_debit_acct := v_bank.gl_account_id;
    IF v_debit_acct IS NULL OR NOT EXISTS (
      SELECT 1 FROM gl_accounts WHERE id = v_debit_acct AND company_id = p_company_id AND is_active = TRUE
    ) THEN
      RAISE EXCEPTION 'CONFIG: Bank GL account is missing or inactive for %', v_rct.receipt_no;
    END IF;
    v_debit_desc := format('Bank: %s (%s)', v_rct.receipt_no, v_rct.payment_method);
  END IF;

  -- ── 7. Generate JE ──
  IF TRUE THEN
    SELECT get_next_sequence(p_company_id, 'JE', 'RCT') INTO v_je_no;

    INSERT INTO journal_entries (
      company_id, je_no, je_date, posting_period, source_type,
      source_doc_no, source_doc_id, description,
      currency, exchange_rate, base_currency,
      total_debit, total_credit, created_by
    ) VALUES (
      p_company_id, v_je_no, v_rct.receipt_date, v_period, 'RCT',
      v_rct.receipt_no, p_receipt_id,
      format('Receipt posting: %s — %s (%s)', v_rct.receipt_no, v_rct.customer_name, v_rct.payment_method),
      v_rct.currency, v_rct.exchange_rate, v_rct.base_currency,
      v_rct.receipt_amount, v_rct.receipt_amount, p_user_id
    ) RETURNING id INTO v_je_id;

    -- Dr Bank/Cheques
    INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
      debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
    VALUES (v_je_id, 10, v_debit_acct, v_debit_desc,
      v_rct.receipt_amount, 0,
      ROUND(v_rct.receipt_amount * v_rct.exchange_rate, 2), 0,
      v_rct.currency, v_rct.receipt_amount);

    -- Cr AR Control
    INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
      debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
    VALUES (v_je_id, 20, v_ar_acct_id,
      format('AR receipt: %s - %s', v_rct.receipt_no, v_rct.customer_name),
      0, v_rct.receipt_amount,
      0, ROUND(v_rct.receipt_amount * v_rct.exchange_rate, 2),
      v_rct.currency, v_rct.receipt_amount);
  END IF;

  -- ── 8. Update receipt status (optimistic lock on status=Draft) ──
  UPDATE receipts SET
    status = 'Posted',
    posting_period = v_period,
    posted_by = p_user_id,
    posted_at = NOW()
  WHERE id = p_receipt_id AND status = 'Draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFLICT: Receipt has been posted by another user';
  END IF;

  RETURN jsonb_build_object(
    'receipt_id', p_receipt_id,
    'receipt_no', v_rct.receipt_no,
    'je_no', v_je_no,
    'status', 'Posted'
  );
END;
$$;

COMMENT ON FUNCTION post_receipt(UUID, UUID, UUID) IS
  'P1 RPC: Atomic receipt posting. Locks receipt row, validates business rules, '
  'generates JE (CHQ→Cheques on Hand, others→Bank), prevents double-posting.';

-- ============================================================================
-- SECTION 3: allocate_receipt
-- ============================================================================
-- Replaces AllocationService.manualAllocate() (service.ts L92-226)
-- Locks: receipt FOR UPDATE, each invoice FOR UPDATE
-- p_allocations: JSONB array [{invoice_id, amount, discount_amount}]
-- Generates: allocation_details rows + optional forex JE + optional discount JE
-- ============================================================================

CREATE OR REPLACE FUNCTION allocate_receipt(
  p_receipt_id   UUID,
  p_user_id      UUID,
  p_company_id   UUID,
  p_allocations  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rct           RECORD;
  v_inv           RECORD;
  v_cust          RECORD;
  v_elem          JSONB;
  v_alloc_amt     NUMERIC(18,2);
  v_disc_amt      NUMERIC(18,2);
  v_total_alloc   NUMERIC(18,2) := 0;
  v_forex         NUMERIC(18,2);
  v_new_os        NUMERIC(18,2);
  v_new_status    VARCHAR(20);
  v_alloc_count   INT := 0;
  v_je_id         UUID;
  v_je_no         VARCHAR(30);
  v_ar_acct_id    UUID;
  v_forex_gain_id UUID;
  v_forex_loss_id UUID;
  v_disc_acct_id  UUID;
  v_config_val    TEXT;
  v_period        VARCHAR(7);
  v_inv_id        UUID;
  v_alloc_id      UUID;
BEGIN
  -- ── Auth ──
  PERFORM rpc_check_role(p_user_id, p_company_id,
    ARRAY['AR Clerk','AR Supervisor','Finance Manager']);

  -- ── 1. Lock receipt ──
  SELECT * INTO v_rct FROM receipts
    WHERE id = p_receipt_id AND company_id = p_company_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Receipt not found';
  END IF;
  IF v_rct.status NOT IN ('Posted', 'Fully Allocated') THEN
    RAISE EXCEPTION 'BR-REC-001: Receipt % must be Posted. Current: %', v_rct.receipt_no, v_rct.status;
  END IF;
  IF v_rct.unallocated_amount <= 0 THEN
    RAISE EXCEPTION 'BR-REC-001: Receipt % has no unallocated balance', v_rct.receipt_no;
  END IF;
  PERFORM rpc_check_customer_access(p_user_id, p_company_id, v_rct.customer_id);

  -- ── 2. Validate total ──
  SELECT COALESCE(SUM((e->>'amount')::NUMERIC), 0) INTO v_total_alloc
    FROM jsonb_array_elements(p_allocations) e;
  IF v_total_alloc > v_rct.unallocated_amount + 0.01 THEN
    RAISE EXCEPTION 'BR-REC-002: Total allocation (%) exceeds available balance (%)',
      v_total_alloc, v_rct.unallocated_amount;
  END IF;

  v_period := to_char(CURRENT_DATE, 'YYYY-MM');
  IF NOT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE company_id = p_company_id AND period_code = v_period AND status = 'Open'
  ) THEN
    RAISE EXCEPTION 'BR-JE-007: Fiscal period % is not open', v_period;
  END IF;

  -- Pre-lock target invoices in deterministic order before processing JSON order.
  FOR v_inv IN
    SELECT i.id
    FROM invoices i
    JOIN (
      SELECT DISTINCT (e->>'invoice_id')::UUID AS invoice_id
      FROM jsonb_array_elements(p_allocations) e
    ) req ON req.invoice_id = i.id
    WHERE i.company_id = p_company_id
    ORDER BY i.id
    FOR UPDATE OF i
  LOOP
    NULL;
  END LOOP;

  -- Resolve GL accounts for forex/discount JEs
  SELECT c.ar_control_acct_id INTO v_ar_acct_id FROM customers c WHERE c.id = v_rct.customer_id;
  IF v_ar_acct_id IS NULL THEN
    v_ar_acct_id := rpc_get_config_account(
      p_company_id, 'default_ar_control_acct', '1100-001', 'AR control');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM gl_accounts WHERE id = v_ar_acct_id AND company_id = p_company_id AND is_active = TRUE) THEN
    RAISE EXCEPTION 'CONFIG: AR control account is missing or inactive for %', v_rct.receipt_no;
  END IF;

  v_forex_gain_id := rpc_get_config_account(
    p_company_id, 'default_forex_gain_acct', '7000-001', 'forex gain');
  v_forex_loss_id := rpc_get_config_account(
    p_company_id, 'default_forex_loss_acct', '7100-001', 'forex loss');
  v_disc_acct_id := rpc_get_config_account(
    p_company_id, 'default_discount_acct', '6100-001', 'sales discount');

  -- ── 3. Process each allocation ──
  v_total_alloc := 0;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    v_inv_id   := (v_elem->>'invoice_id')::UUID;
    v_alloc_amt := (v_elem->>'amount')::NUMERIC;
    v_disc_amt  := COALESCE((v_elem->>'discount_amount')::NUMERIC, 0);

    IF v_alloc_amt <= 0 THEN
      RAISE EXCEPTION 'BR-REC-002: Allocation amount must be greater than 0';
    END IF;

    -- Lock invoice
    SELECT * INTO v_inv FROM invoices WHERE id = v_inv_id AND company_id = p_company_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: Invoice % not found', v_inv_id;
    END IF;

    -- Same customer
    IF v_inv.customer_id != v_rct.customer_id THEN
      RAISE EXCEPTION 'BR-REC-001: Invoice % customer does not match receipt customer', v_inv.invoice_no;
    END IF;
    -- Status
    IF v_inv.status NOT IN ('Open', 'Overdue', 'Partially Paid') THEN
      RAISE EXCEPTION 'BR-REC-001: Invoice % status (%) does not allow allocation', v_inv.invoice_no, v_inv.status;
    END IF;
    -- Currency
    IF v_inv.currency != v_rct.currency THEN
      RAISE EXCEPTION 'BR-REC-003: Currency mismatch. Receipt: %, Invoice: %', v_rct.currency, v_inv.currency;
    END IF;
    -- Amount
    IF (v_alloc_amt + v_disc_amt) > v_inv.outstanding + 0.01 THEN
      RAISE EXCEPTION 'BR-REC-002: Allocation plus discount (%) exceeds outstanding (%) for %',
        v_alloc_amt + v_disc_amt, v_inv.outstanding, v_inv.invoice_no;
    END IF;

    -- Forex gain/loss
    v_forex := ROUND(v_alloc_amt * (v_rct.exchange_rate - v_inv.exchange_rate), 2);

    -- Insert allocation record
    INSERT INTO allocation_details (
      receipt_id, invoice_id, doc_type,
      allocated_amount, base_allocated, invoice_rate, receipt_rate,
      forex_gain_loss, discount_amount, allocation_date,
      allocated_by, allocation_method, status
    ) VALUES (
      p_receipt_id, v_inv_id, v_inv.doc_type,
      v_alloc_amt, ROUND(v_alloc_amt * v_rct.exchange_rate, 2),
      v_inv.exchange_rate, v_rct.exchange_rate,
      v_forex, v_disc_amt, CURRENT_DATE,
      p_user_id, 'Manual', 'Active'
    )
    RETURNING id INTO v_alloc_id;

    -- Update invoice outstanding
    v_new_os := GREATEST(ROUND(v_inv.outstanding - v_alloc_amt - v_disc_amt, 2), 0);
    IF v_new_os <= 0.005 THEN
      v_new_status := 'Paid';
    ELSIF v_inv.due_date IS NOT NULL AND v_inv.due_date < CURRENT_DATE THEN
      v_new_status := 'Overdue';
    ELSE
      v_new_status := 'Partially Paid';
    END IF;

    UPDATE invoices SET
      outstanding = v_new_os,
      status = v_new_status,
      version = v_inv.version + 1
    WHERE id = v_inv_id AND version = v_inv.version;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONFLICT: Invoice % modified by another user', v_inv.invoice_no;
    END IF;

    -- ── Forex JE (separate, per decision) ──
    IF ABS(v_forex) > 0.01 AND v_ar_acct_id IS NOT NULL THEN
      SELECT get_next_sequence(p_company_id, 'JE', 'ADJ') INTO v_je_no;
      INSERT INTO journal_entries (
        company_id, je_no, je_date, posting_period, source_type,
        source_doc_no, source_doc_id, description,
        currency, exchange_rate, base_currency,
        total_debit, total_credit, created_by
      ) VALUES (
        p_company_id, v_je_no, CURRENT_DATE, v_period, 'ADJ',
        v_rct.receipt_no, v_alloc_id,
        format('Forex G/L: %s → %s', v_rct.receipt_no, v_inv.invoice_no),
        v_rct.currency, v_rct.exchange_rate, v_rct.base_currency,
        ABS(v_forex), ABS(v_forex), p_user_id
      ) RETURNING id INTO v_je_id;

      IF v_forex > 0 THEN  -- Gain: Dr AR, Cr Forex Gain
        INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
          debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
        VALUES
          (v_je_id, 10, v_ar_acct_id, format('Forex adj: %s', v_inv.invoice_no),
           v_forex, 0, v_forex, 0, v_rct.currency, v_forex),
          (v_je_id, 20, v_forex_gain_id, 'Forex Gain',
           0, v_forex, 0, v_forex, v_rct.currency, v_forex);
      ELSE  -- Loss: Dr Forex Loss, Cr AR
        INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
          debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
        VALUES
          (v_je_id, 10, v_forex_loss_id, 'Forex Loss',
           ABS(v_forex), 0, ABS(v_forex), 0, v_rct.currency, ABS(v_forex)),
          (v_je_id, 20, v_ar_acct_id, format('Forex adj: %s', v_inv.invoice_no),
           0, ABS(v_forex), 0, ABS(v_forex), v_rct.currency, ABS(v_forex));
      END IF;
    END IF;

    -- ── Discount JE (separate, per decision) ──
    IF v_disc_amt > 0 AND v_ar_acct_id IS NOT NULL AND v_disc_acct_id IS NOT NULL THEN
      SELECT get_next_sequence(p_company_id, 'JE', 'ADJ') INTO v_je_no;
      INSERT INTO journal_entries (
        company_id, je_no, je_date, posting_period, source_type,
        source_doc_no, source_doc_id, description,
        currency, exchange_rate, base_currency,
        total_debit, total_credit, created_by
      ) VALUES (
        p_company_id, v_je_no, CURRENT_DATE, v_period, 'ADJ',
        v_rct.receipt_no, v_alloc_id,
        format('Discount: %s → %s', v_rct.receipt_no, v_inv.invoice_no),
        v_rct.currency, v_rct.exchange_rate, v_rct.base_currency,
        v_disc_amt, v_disc_amt, p_user_id
      ) RETURNING id INTO v_je_id;

      INSERT INTO journal_entry_lines (je_id, line_no, gl_account_id, description,
        debit_amount, credit_amount, base_debit, base_credit, currency, original_amount)
      VALUES
        (v_je_id, 10, v_disc_acct_id, format('Discount: %s', v_inv.invoice_no),
         v_disc_amt, 0, ROUND(v_disc_amt * v_rct.exchange_rate, 2), 0, v_rct.currency, v_disc_amt),
        (v_je_id, 20, v_ar_acct_id, format('AR discount: %s', v_inv.invoice_no),
         0, v_disc_amt, 0, ROUND(v_disc_amt * v_rct.exchange_rate, 2), v_rct.currency, v_disc_amt);
    END IF;

    v_total_alloc := v_total_alloc + v_alloc_amt;
    v_alloc_count := v_alloc_count + 1;
  END LOOP;

  -- ── 4. Update receipt totals ──
  UPDATE receipts SET
    allocated_amount = allocated_amount + v_total_alloc,
    unallocated_amount = GREATEST(unallocated_amount - v_total_alloc, 0),
    status = CASE
      WHEN (unallocated_amount - v_total_alloc) <= 0.005 THEN 'Fully Allocated'
      ELSE status
    END
  WHERE id = p_receipt_id;

  RETURN jsonb_build_object(
    'receipt_id', p_receipt_id,
    'allocated_count', v_alloc_count,
    'total_allocated', v_total_alloc,
    'receipt_status', (SELECT status FROM receipts WHERE id = p_receipt_id)
  );
END;
$$;

COMMENT ON FUNCTION allocate_receipt(UUID, UUID, UUID, JSONB) IS
  'P1 RPC: Atomic receipt-to-invoice allocation. Locks receipt + each invoice, '
  'validates business rules, generates forex and discount JEs as separate entries.';

-- ============================================================================
-- SECTION 4: reverse_allocation
-- ============================================================================
-- Replaces AllocationService.reverseAllocation() (service.ts L328-420)
-- Locks: allocation_details, invoice, receipt FOR UPDATE
-- Reverses forex/discount JEs linked to this allocation
-- ============================================================================

CREATE OR REPLACE FUNCTION reverse_allocation(
  p_allocation_id UUID,
  p_user_id       UUID,
  p_company_id    UUID,
  p_reason        TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alloc    RECORD;
  v_inv      RECORD;
  v_rct      RECORD;
  v_je       RECORD;
  v_period   VARCHAR(7);
  v_new_os   NUMERIC(18,2);
  v_new_stat VARCHAR(20);
BEGIN
  -- ── Auth (Supervisor+) ──
  PERFORM rpc_check_role(p_user_id, p_company_id,
    ARRAY['AR Supervisor','Finance Manager']);

  IF length(COALESCE(p_reason, '')) < 10 THEN
    RAISE EXCEPTION 'BR-REC-005: Reversal reason must be at least 10 characters';
  END IF;

  -- ── 1. Lock allocation ──
  SELECT * INTO v_alloc FROM allocation_details
    WHERE id = p_allocation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Allocation not found';
  END IF;
  IF v_alloc.status != 'Active' THEN
    RAISE EXCEPTION 'BR-REC-REV: Only Active allocations can be reversed';
  END IF;

  -- ── 2. Lock invoice + receipt ──
  SELECT * INTO v_rct FROM receipts WHERE id = v_alloc.receipt_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Allocation not found in this company';
  END IF;
  SELECT * INTO v_inv FROM invoices WHERE id = v_alloc.invoice_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Invoice not found in this company';
  END IF;

  -- Verify company ownership
  IF v_rct.company_id != p_company_id THEN
    RAISE EXCEPTION 'NOT_FOUND: Allocation not found in this company';
  END IF;
  PERFORM rpc_check_customer_access(p_user_id, p_company_id, v_rct.customer_id);

  v_period := to_char(CURRENT_DATE, 'YYYY-MM');

  -- ── 3. Mark allocation reversed ──
  UPDATE allocation_details SET
    status = 'Reversed',
    reversed_by = p_user_id,
    reversed_at = NOW(),
    reverse_reason = p_reason
  WHERE id = p_allocation_id;

  -- ── 4. Restore invoice outstanding ──
  v_new_os := ROUND(v_inv.outstanding + v_alloc.allocated_amount + v_alloc.discount_amount, 2);
  IF v_new_os >= v_inv.total_amount THEN
    IF v_inv.due_date IS NOT NULL AND v_inv.due_date < CURRENT_DATE THEN
      v_new_stat := 'Overdue';
    ELSE
      v_new_stat := 'Open';
    END IF;
  ELSE
    v_new_stat := 'Partially Paid';
  END IF;

  UPDATE invoices SET
    outstanding = v_new_os,
    status = v_new_stat,
    version = v_inv.version + 1
  WHERE id = v_alloc.invoice_id AND version = v_inv.version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONFLICT: Invoice % modified by another user', v_inv.invoice_no;
  END IF;

  -- ── 5. Update receipt totals ──
  UPDATE receipts SET
    allocated_amount = GREATEST(allocated_amount - v_alloc.allocated_amount, 0),
    unallocated_amount = unallocated_amount + v_alloc.allocated_amount,
    status = CASE
      WHEN status = 'Fully Allocated' THEN 'Posted'
      ELSE status
    END
  WHERE id = v_alloc.receipt_id;

  -- ── 6. Reverse related JEs (forex + discount) ──
  FOR v_je IN
    SELECT je.id, je.je_no, je.company_id, je.currency, je.exchange_rate, je.base_currency
    FROM journal_entries je
    WHERE je.source_doc_id = p_allocation_id
      AND je.source_type = 'ADJ'
      AND je.is_reversed = FALSE
    ORDER BY je.created_at, je.id
    FOR UPDATE
  LOOP
    PERFORM reverse_journal_entry(v_je.id, p_user_id, p_company_id,
      format('Allocation reversal: %s', p_reason));
  END LOOP;

  RETURN jsonb_build_object(
    'reversed', TRUE,
    'allocation_id', p_allocation_id,
    'invoice_no', v_inv.invoice_no,
    'receipt_no', v_rct.receipt_no,
    'restored_outstanding', v_new_os
  );
END;
$$;

COMMENT ON FUNCTION reverse_allocation(UUID, UUID, UUID, TEXT) IS
  'P1 RPC: Atomic allocation reversal. Locks alloc+invoice+receipt, restores balances, '
  'reverses all linked forex/discount JEs. Requires AR Supervisor+.';

-- ============================================================================
-- SECTION 5: reverse_journal_entry
-- ============================================================================
-- Replaces JournalEntryService.createReversalJE() (service.ts L385-454)
-- Locks: journal_entries row FOR UPDATE
-- Creates mirror-image JE (debit↔credit swap) + bidirectional link
-- ============================================================================

CREATE OR REPLACE FUNCTION reverse_journal_entry(
  p_je_id      UUID,
  p_user_id    UUID,
  p_company_id UUID,
  p_reason     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_je       RECORD;
  v_line     RECORD;
  v_rev_id   UUID;
  v_rev_no   VARCHAR(30);
  v_period   VARCHAR(7);
  v_line_no  INT := 0;
BEGIN
  -- ── Auth (Supervisor+) ──
  PERFORM rpc_check_role(p_user_id, p_company_id,
    ARRAY['AR Supervisor','Finance Manager']);

  -- ── 1. Lock original JE ──
  SELECT * INTO v_je FROM journal_entries
    WHERE id = p_je_id AND company_id = p_company_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Journal entry not found';
  END IF;
  IF v_je.is_reversed THEN
    RAISE EXCEPTION 'BR-JE-008: Journal entry % has already been reversed', v_je.je_no;
  END IF;

  -- ── 2. Fiscal period ──
  v_period := to_char(CURRENT_DATE, 'YYYY-MM');
  IF NOT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE company_id = p_company_id AND period_code = v_period AND status = 'Open'
  ) THEN
    RAISE EXCEPTION 'BR-JE-007: Fiscal period % is not open', v_period;
  END IF;

  -- ── 3. Generate reversal JE ──
  SELECT get_next_sequence(p_company_id, 'JE', 'REV') INTO v_rev_no;

  INSERT INTO journal_entries (
    company_id, je_no, je_date, posting_period, source_type,
    source_doc_no, source_doc_id, description,
    currency, exchange_rate, base_currency,
    total_debit, total_credit,
    is_reversal, original_je_id, created_by
  ) VALUES (
    p_company_id, v_rev_no, CURRENT_DATE, v_period, 'REV',
    v_je.source_doc_no, v_je.source_doc_id,
    format('Reversal of %s: %s', v_je.je_no, p_reason),
    v_je.currency, v_je.exchange_rate, v_je.base_currency,
    v_je.total_debit, v_je.total_credit,
    TRUE, p_je_id, p_user_id
  ) RETURNING id INTO v_rev_id;

  -- ── 4. Insert reversed lines (swap debit↔credit) ──
  FOR v_line IN
    SELECT * FROM journal_entry_lines WHERE je_id = p_je_id ORDER BY line_no
  LOOP
    v_line_no := v_line_no + 10;
    INSERT INTO journal_entry_lines (
      je_id, line_no, gl_account_id, description,
      debit_amount, credit_amount, base_debit, base_credit,
      currency, original_amount
    ) VALUES (
      v_rev_id, v_line_no, v_line.gl_account_id,
      format('[Reversal] %s', COALESCE(v_line.description, '')),
      v_line.credit_amount, v_line.debit_amount,   -- SWAP
      v_line.base_credit, v_line.base_debit,       -- SWAP
      v_line.currency, v_line.original_amount
    );
  END LOOP;

  -- ── 5. Cross-reference (BR-JE-004) ──
  UPDATE journal_entries SET
    is_reversed = TRUE,
    reversal_je_id = v_rev_id
  WHERE id = p_je_id;

  RETURN jsonb_build_object(
    'original_je_no', v_je.je_no,
    'reversal_je_no', v_rev_no,
    'reversal_je_id', v_rev_id
  );
END;
$$;

COMMENT ON FUNCTION reverse_journal_entry(UUID, UUID, UUID, TEXT) IS
  'P1 RPC: Atomic JE reversal. Locks original JE, creates mirror-image reversal, '
  'links bidirectionally (BR-JE-004). Cannot reverse twice (BR-JE-008).';

-- ============================================================================
-- SECTION 6: handle_bounced_cheque
-- ============================================================================
-- Replaces ReceiptService.handleBouncedCheque() (service.ts L439-569)
-- Locks: receipt FOR UPDATE, all active allocations + their invoices
-- Atomic: reverses all allocations, all JEs, marks receipt Bounced, logs event
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_bounced_cheque(
  p_receipt_id   UUID,
  p_user_id      UUID,
  p_company_id   UUID,
  p_bounce_reason TEXT,
  p_bounce_date  DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rct       RECORD;
  v_alloc     RECORD;
  v_inv       RECORD;
  v_je        RECORD;
  v_bdate     DATE;
  v_period    VARCHAR(7);
  v_new_os    NUMERIC(18,2);
  v_new_stat  VARCHAR(20);
  v_rev_count INT := 0;
BEGIN
  -- ── Auth (Finance Manager only) ──
  PERFORM rpc_check_role(p_user_id, p_company_id,
    ARRAY['Finance Manager']);

  -- ── 1. Lock receipt ──
  SELECT * INTO v_rct FROM receipts
    WHERE id = p_receipt_id AND company_id = p_company_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Receipt not found';
  END IF;
  IF v_rct.payment_method != 'CHQ' THEN
    RAISE EXCEPTION 'BR-RCT-BOUNCE: Bounce only applies to CHQ payment method';
  END IF;
  IF v_rct.status NOT IN ('Posted', 'Fully Allocated') THEN
    RAISE EXCEPTION 'BR-RCT-BOUNCE: Bounce requires Posted or Fully Allocated. Current: %', v_rct.status;
  END IF;
  PERFORM rpc_check_customer_access(p_user_id, p_company_id, v_rct.customer_id);

  v_bdate  := COALESCE(p_bounce_date, CURRENT_DATE);
  v_period := to_char(v_bdate, 'YYYY-MM');

  IF NOT EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE company_id = p_company_id AND period_code = v_period AND status = 'Open'
  ) THEN
    RAISE EXCEPTION 'BR-JE-007: Fiscal period % is not open', v_period;
  END IF;

  -- ── 2. Reverse ALL active allocations ──
  FOR v_alloc IN
    SELECT * FROM allocation_details
    WHERE receipt_id = p_receipt_id AND status = 'Active'
    ORDER BY id
    FOR UPDATE
  LOOP
    -- Lock and restore invoice
    SELECT * INTO v_inv FROM invoices WHERE id = v_alloc.invoice_id FOR UPDATE;
    IF FOUND THEN
      v_new_os := ROUND(v_inv.outstanding + v_alloc.allocated_amount + v_alloc.discount_amount, 2);
      IF v_new_os >= v_inv.total_amount THEN
        IF v_inv.due_date IS NOT NULL AND v_inv.due_date < CURRENT_DATE THEN
          v_new_stat := 'Overdue';
        ELSE
          v_new_stat := 'Open';
        END IF;
      ELSE
        v_new_stat := 'Partially Paid';
      END IF;

      UPDATE invoices SET
        outstanding = v_new_os,
        status = v_new_stat,
        version = v_inv.version + 1
      WHERE id = v_alloc.invoice_id;
    END IF;

    -- Mark allocation reversed
    UPDATE allocation_details SET
      status = 'Reversed',
      reversed_by = p_user_id,
      reversed_at = NOW(),
      reverse_reason = format('Cheque bounced: %s', p_bounce_reason)
    WHERE id = v_alloc.id;

    FOR v_je IN
      SELECT id FROM journal_entries
      WHERE source_doc_id = v_alloc.id
        AND source_type = 'ADJ'
        AND is_reversed = FALSE
      ORDER BY created_at, id
      FOR UPDATE
    LOOP
      PERFORM reverse_journal_entry(v_je.id, p_user_id, p_company_id,
        format('Bounced cheque allocation reversal: %s', p_bounce_reason));
    END LOOP;

    v_rev_count := v_rev_count + 1;
  END LOOP;

  -- ── 3. Reverse ALL JEs linked to this receipt ──
  FOR v_je IN
    SELECT id FROM journal_entries
    WHERE source_doc_id = p_receipt_id
      AND source_type = 'RCT'
      AND is_reversed = FALSE
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    PERFORM reverse_journal_entry(v_je.id, p_user_id, p_company_id,
      format('Bounced cheque: %s', p_bounce_reason));
  END LOOP;

  -- ── 4. Update receipt status ──
  UPDATE receipts SET
    status = 'Bounced',
    allocated_amount = 0,
    unallocated_amount = 0
  WHERE id = p_receipt_id;

  -- ── 5. Log credit control event ──
  INSERT INTO credit_control_logs (
    company_id, customer_id, action, details, amount, created_by
  ) VALUES (
    p_company_id, v_rct.customer_id, 'Cheque Bounced',
    format('Receipt %s, Amount: %s %s. Reason: %s',
      v_rct.receipt_no, v_rct.receipt_amount, v_rct.currency, p_bounce_reason),
    v_rct.receipt_amount, p_user_id
  );

  RETURN jsonb_build_object(
    'receipt_id', p_receipt_id,
    'receipt_no', v_rct.receipt_no,
    'status', 'Bounced',
    'allocations_reversed', v_rev_count
  );
END;
$$;

COMMENT ON FUNCTION handle_bounced_cheque(UUID, UUID, UUID, TEXT, DATE) IS
  'P1 RPC: Atomic bounced cheque handling. Reverses all allocations, all JEs, '
  'marks receipt Bounced, logs credit control event. Finance Manager only.';

-- ============================================================================
-- SECTION 7: GRANT / REVOKE HARDENING
-- ============================================================================

REVOKE ALL ON FUNCTION rpc_check_role(UUID, UUID, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION rpc_check_role(UUID, UUID, TEXT[]) FROM authenticated;

REVOKE ALL ON FUNCTION rpc_get_config_account(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION rpc_get_config_account(UUID, TEXT, TEXT, TEXT) FROM authenticated;

REVOKE ALL ON FUNCTION rpc_check_customer_access(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION rpc_check_customer_access(UUID, UUID, UUID) FROM authenticated;

REVOKE ALL ON FUNCTION post_invoice(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_invoice(UUID, UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION post_receipt(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION post_receipt(UUID, UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION allocate_receipt(UUID, UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION allocate_receipt(UUID, UUID, UUID, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION reverse_allocation(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reverse_allocation(UUID, UUID, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION reverse_journal_entry(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reverse_journal_entry(UUID, UUID, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION handle_bounced_cheque(UUID, UUID, UUID, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION handle_bounced_cheque(UUID, UUID, UUID, TEXT, DATE) TO authenticated;

-- ============================================================================
-- END OF P1 FINANCIAL RPCS
-- ============================================================================
-- Next steps:
--   • 008_financial_constraints.sql — Unique indexes for idempotency
--   • Edge Function refactoring — Replace service methods with RPC calls
--   • P2 — domain_events outbox table + uncomment event emission in RPCs
-- ============================================================================
