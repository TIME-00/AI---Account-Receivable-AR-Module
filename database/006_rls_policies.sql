-- ============================================================================
-- TSH Synergy ERP - Accounts Receivable Module
-- Database Schema: 006_rls_policies.sql
-- Target: PostgreSQL 15+ (Supabase)
-- Version: 1.1
-- Date: 2026-05-12
-- ============================================================================
-- EXECUTION ORDER: Run AFTER 005_audit_triggers.sql
-- ============================================================================
-- P0 RLS Foundation
--   - Tenant isolation via auth.uid() + user_roles, not JWT company claims.
--   - Customer-level isolation for AR Clerks via user_customer_assignments.
--   - Auditor is read-only.
--   - System Admin is config/system administration only, matching auth.ts.
--   - Child tables are isolated through SECURITY DEFINER parent checks.
--   - Existing service_role Edge Functions continue to bypass RLS during P0.
-- ============================================================================

-- ============================================================================
-- SECTION 1: HELPER FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION rls_has_company_access(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = auth.uid()
      AND company_id = p_company_id
      AND is_active = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION rls_has_operational_write_access(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = auth.uid()
      AND company_id = p_company_id
      AND is_active = TRUE
      AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
  );
$$;

CREATE OR REPLACE FUNCTION rls_has_config_write_access(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = auth.uid()
      AND company_id = p_company_id
      AND is_active = TRUE
      AND role IN ('Finance Manager', 'System Admin')
  );
$$;

CREATE OR REPLACE FUNCTION rls_can_access_customer(
  p_customer_id UUID,
  p_company_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM customers c
    WHERE c.id = p_customer_id
      AND c.company_id = p_company_id
  )
  AND (
    EXISTS (
      SELECT 1
      FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.company_id = p_company_id
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Supervisor', 'Finance Manager', 'System Admin', 'Auditor')
    )
    OR EXISTS (
      SELECT 1
      FROM user_customer_assignments uca
      JOIN user_roles ur
        ON ur.user_id = uca.user_id
       AND ur.company_id = uca.company_id
      WHERE uca.user_id = auth.uid()
        AND uca.customer_id = p_customer_id
        AND uca.company_id = p_company_id
        AND uca.is_active = TRUE
        AND ur.is_active = TRUE
        AND ur.role = 'AR Clerk'
    )
  );
$$;

CREATE OR REPLACE FUNCTION rls_check_customer_child(
  p_customer_id UUID,
  p_write BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM customers c
    WHERE c.id = p_customer_id
      AND rls_has_company_access(c.company_id)
      AND rls_can_access_customer(c.id, c.company_id)
      AND (NOT p_write OR rls_has_operational_write_access(c.company_id))
  );
$$;

CREATE OR REPLACE FUNCTION rls_check_invoice(
  p_invoice_id UUID,
  p_write BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM invoices i
    WHERE i.id = p_invoice_id
      AND rls_has_company_access(i.company_id)
      AND rls_can_access_customer(i.customer_id, i.company_id)
      AND (NOT p_write OR rls_has_operational_write_access(i.company_id))
  );
$$;

CREATE OR REPLACE FUNCTION rls_check_receipt(
  p_receipt_id UUID,
  p_write BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM receipts r
    WHERE r.id = p_receipt_id
      AND rls_has_company_access(r.company_id)
      AND rls_can_access_customer(r.customer_id, r.company_id)
      AND (NOT p_write OR rls_has_operational_write_access(r.company_id))
  );
$$;

CREATE OR REPLACE FUNCTION rls_check_je(
  p_je_id UUID,
  p_write BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM journal_entries je
    WHERE je.id = p_je_id
      AND rls_has_company_access(je.company_id)
      AND (NOT p_write OR rls_has_operational_write_access(je.company_id))
  );
$$;

CREATE OR REPLACE FUNCTION rls_check_allocation(
  p_receipt_id UUID,
  p_invoice_id UUID,
  p_write BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rls_check_receipt(p_receipt_id, p_write)
     AND rls_check_invoice(p_invoice_id, p_write)
     AND EXISTS (
       SELECT 1
       FROM receipts r
       JOIN invoices i ON i.id = p_invoice_id
       WHERE r.id = p_receipt_id
         AND r.company_id = i.company_id
         AND r.customer_id = i.customer_id
     );
$$;

CREATE OR REPLACE FUNCTION rls_check_cn_allocation(
  p_cn_id UUID,
  p_invoice_id UUID,
  p_write BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rls_check_invoice(p_cn_id, p_write)
     AND rls_check_invoice(p_invoice_id, p_write)
     AND EXISTS (
       SELECT 1
       FROM invoices cn
       JOIN invoices inv ON inv.id = p_invoice_id
       WHERE cn.id = p_cn_id
         AND cn.company_id = inv.company_id
         AND cn.customer_id = inv.customer_id
         AND cn.doc_type = 'Credit Note'
     );
$$;

-- ============================================================================
-- SECTION 2: ENABLE RLS ON ALL CURRENT TABLES
-- ============================================================================

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE aging_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar_system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_bank_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE cn_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_change_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_control_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_customer_assignments ENABLE ROW LEVEL SECURITY;

-- Existing views should execute with caller privileges so underlying table RLS
-- applies when they are accessed directly through PostgREST.
ALTER VIEW v_customer_credit_utilization SET (security_invoker = true);
ALTER VIEW v_invoice_aging SET (security_invoker = true);
ALTER VIEW v_customer_aging_summary SET (security_invoker = true);
ALTER VIEW v_customer_ar_summary SET (security_invoker = true);
ALTER VIEW v_receipt_summary SET (security_invoker = true);

-- ============================================================================
-- SECTION 3: CONFIGURATION TABLE POLICIES
-- ============================================================================

CREATE POLICY cfg_select ON gl_accounts FOR SELECT USING (rls_has_company_access(company_id));
CREATE POLICY cfg_insert ON gl_accounts FOR INSERT WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_update ON gl_accounts FOR UPDATE USING (rls_has_config_write_access(company_id)) WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_delete ON gl_accounts FOR DELETE USING (rls_has_config_write_access(company_id));

CREATE POLICY cfg_select ON bank_accounts FOR SELECT USING (rls_has_company_access(company_id));
CREATE POLICY cfg_insert ON bank_accounts FOR INSERT WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_update ON bank_accounts FOR UPDATE USING (rls_has_config_write_access(company_id)) WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_delete ON bank_accounts FOR DELETE USING (rls_has_config_write_access(company_id));

CREATE POLICY cfg_select ON fiscal_periods FOR SELECT USING (rls_has_company_access(company_id));
CREATE POLICY cfg_insert ON fiscal_periods FOR INSERT WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_update ON fiscal_periods FOR UPDATE USING (rls_has_config_write_access(company_id)) WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_delete ON fiscal_periods FOR DELETE USING (rls_has_config_write_access(company_id));

CREATE POLICY cfg_select ON payment_terms FOR SELECT USING (rls_has_company_access(company_id));
CREATE POLICY cfg_insert ON payment_terms FOR INSERT WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_update ON payment_terms FOR UPDATE USING (rls_has_config_write_access(company_id)) WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_delete ON payment_terms FOR DELETE USING (rls_has_config_write_access(company_id));

CREATE POLICY cfg_select ON tax_codes FOR SELECT USING (rls_has_company_access(company_id));
CREATE POLICY cfg_insert ON tax_codes FOR INSERT WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_update ON tax_codes FOR UPDATE USING (rls_has_config_write_access(company_id)) WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_delete ON tax_codes FOR DELETE USING (rls_has_config_write_access(company_id));

CREATE POLICY cfg_select ON customer_groups FOR SELECT USING (rls_has_company_access(company_id));
CREATE POLICY cfg_insert ON customer_groups FOR INSERT WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_update ON customer_groups FOR UPDATE USING (rls_has_config_write_access(company_id)) WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_delete ON customer_groups FOR DELETE USING (rls_has_config_write_access(company_id));

CREATE POLICY cfg_select ON exchange_rates FOR SELECT USING (rls_has_company_access(company_id));
CREATE POLICY cfg_insert ON exchange_rates FOR INSERT WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_update ON exchange_rates FOR UPDATE USING (rls_has_config_write_access(company_id)) WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_delete ON exchange_rates FOR DELETE USING (rls_has_config_write_access(company_id));

CREATE POLICY cfg_select ON aging_buckets FOR SELECT USING (rls_has_company_access(company_id));
CREATE POLICY cfg_insert ON aging_buckets FOR INSERT WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_update ON aging_buckets FOR UPDATE USING (rls_has_config_write_access(company_id)) WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_delete ON aging_buckets FOR DELETE USING (rls_has_config_write_access(company_id));

CREATE POLICY cfg_select ON ar_system_config FOR SELECT USING (rls_has_company_access(company_id));
CREATE POLICY cfg_insert ON ar_system_config FOR INSERT WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_update ON ar_system_config FOR UPDATE USING (rls_has_config_write_access(company_id)) WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_delete ON ar_system_config FOR DELETE USING (rls_has_config_write_access(company_id));

CREATE POLICY cfg_select ON products FOR SELECT USING (rls_has_company_access(company_id));
CREATE POLICY cfg_insert ON products FOR INSERT WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_update ON products FOR UPDATE USING (rls_has_config_write_access(company_id)) WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_delete ON products FOR DELETE USING (rls_has_config_write_access(company_id));

CREATE POLICY cfg_select ON document_sequences FOR SELECT USING (rls_has_company_access(company_id));
CREATE POLICY cfg_insert ON document_sequences FOR INSERT WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_update ON document_sequences FOR UPDATE USING (rls_has_config_write_access(company_id)) WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY cfg_delete ON document_sequences FOR DELETE USING (rls_has_config_write_access(company_id));

-- ============================================================================
-- SECTION 4: COMPANY AND CUSTOMER-SCOPED PARENT POLICIES
-- ============================================================================

CREATE POLICY co_select ON companies FOR SELECT USING (rls_has_company_access(id));
CREATE POLICY co_insert ON companies FOR INSERT WITH CHECK (rls_has_config_write_access(id));
CREATE POLICY co_update ON companies FOR UPDATE USING (rls_has_config_write_access(id)) WITH CHECK (rls_has_config_write_access(id));
CREATE POLICY co_delete ON companies FOR DELETE USING (rls_has_config_write_access(id));

CREATE POLICY cust_select ON customers FOR SELECT
  USING (rls_has_company_access(company_id) AND rls_can_access_customer(id, company_id));
CREATE POLICY cust_insert ON customers FOR INSERT
  WITH CHECK (rls_has_operational_write_access(company_id));
CREATE POLICY cust_update ON customers FOR UPDATE
  USING (rls_has_operational_write_access(company_id) AND rls_can_access_customer(id, company_id))
  WITH CHECK (rls_has_operational_write_access(company_id) AND rls_can_access_customer(id, company_id));
CREATE POLICY cust_delete ON customers FOR DELETE
  USING (rls_has_operational_write_access(company_id) AND rls_can_access_customer(id, company_id));

CREATE POLICY inv_select ON invoices FOR SELECT
  USING (rls_has_company_access(company_id) AND rls_can_access_customer(customer_id, company_id));
CREATE POLICY inv_insert ON invoices FOR INSERT
  WITH CHECK (rls_has_operational_write_access(company_id) AND rls_can_access_customer(customer_id, company_id));
CREATE POLICY inv_update ON invoices FOR UPDATE
  USING (rls_has_operational_write_access(company_id) AND rls_can_access_customer(customer_id, company_id))
  WITH CHECK (rls_has_operational_write_access(company_id) AND rls_can_access_customer(customer_id, company_id));
CREATE POLICY inv_delete ON invoices FOR DELETE
  USING (rls_has_operational_write_access(company_id) AND rls_can_access_customer(customer_id, company_id));

CREATE POLICY rct_select ON receipts FOR SELECT
  USING (rls_has_company_access(company_id) AND rls_can_access_customer(customer_id, company_id));
CREATE POLICY rct_insert ON receipts FOR INSERT
  WITH CHECK (rls_has_operational_write_access(company_id) AND rls_can_access_customer(customer_id, company_id));
CREATE POLICY rct_update ON receipts FOR UPDATE
  USING (rls_has_operational_write_access(company_id) AND rls_can_access_customer(customer_id, company_id))
  WITH CHECK (rls_has_operational_write_access(company_id) AND rls_can_access_customer(customer_id, company_id));
CREATE POLICY rct_delete ON receipts FOR DELETE
  USING (rls_has_operational_write_access(company_id) AND rls_can_access_customer(customer_id, company_id));

CREATE POLICY ccl_select ON credit_control_logs FOR SELECT
  USING (rls_has_company_access(company_id) AND rls_can_access_customer(customer_id, company_id));
CREATE POLICY ccl_insert ON credit_control_logs FOR INSERT
  WITH CHECK (rls_has_operational_write_access(company_id) AND rls_can_access_customer(customer_id, company_id));
CREATE POLICY ccl_update ON credit_control_logs FOR UPDATE
  USING (rls_has_operational_write_access(company_id) AND rls_can_access_customer(customer_id, company_id))
  WITH CHECK (rls_has_operational_write_access(company_id) AND rls_can_access_customer(customer_id, company_id));

-- ============================================================================
-- SECTION 5: JOURNAL AND CHILD TABLE POLICIES
-- ============================================================================

CREATE POLICY je_select ON journal_entries FOR SELECT USING (rls_has_company_access(company_id));
CREATE POLICY je_insert ON journal_entries FOR INSERT WITH CHECK (rls_has_operational_write_access(company_id));
CREATE POLICY je_update ON journal_entries FOR UPDATE
  USING (rls_has_operational_write_access(company_id))
  WITH CHECK (rls_has_operational_write_access(company_id));

CREATE POLICY il_select ON invoice_lines FOR SELECT USING (rls_check_invoice(invoice_id));
CREATE POLICY il_insert ON invoice_lines FOR INSERT WITH CHECK (rls_check_invoice(invoice_id, TRUE));
CREATE POLICY il_update ON invoice_lines FOR UPDATE USING (rls_check_invoice(invoice_id, TRUE)) WITH CHECK (rls_check_invoice(invoice_id, TRUE));
CREATE POLICY il_delete ON invoice_lines FOR DELETE USING (rls_check_invoice(invoice_id, TRUE));

CREATE POLICY ad_select ON allocation_details FOR SELECT USING (rls_check_allocation(receipt_id, invoice_id));
CREATE POLICY ad_insert ON allocation_details FOR INSERT WITH CHECK (rls_check_allocation(receipt_id, invoice_id, TRUE));
CREATE POLICY ad_update ON allocation_details FOR UPDATE
  USING (rls_check_allocation(receipt_id, invoice_id, TRUE))
  WITH CHECK (rls_check_allocation(receipt_id, invoice_id, TRUE));

CREATE POLICY cna_select ON cn_allocations FOR SELECT USING (rls_check_cn_allocation(cn_id, invoice_id));
CREATE POLICY cna_insert ON cn_allocations FOR INSERT WITH CHECK (rls_check_cn_allocation(cn_id, invoice_id, TRUE));
CREATE POLICY cna_update ON cn_allocations FOR UPDATE
  USING (rls_check_cn_allocation(cn_id, invoice_id, TRUE))
  WITH CHECK (rls_check_cn_allocation(cn_id, invoice_id, TRUE));

CREATE POLICY jel_select ON journal_entry_lines FOR SELECT USING (rls_check_je(je_id));
CREATE POLICY jel_insert ON journal_entry_lines FOR INSERT WITH CHECK (rls_check_je(je_id, TRUE));
CREATE POLICY jel_update ON journal_entry_lines FOR UPDATE USING (rls_check_je(je_id, TRUE)) WITH CHECK (rls_check_je(je_id, TRUE));

CREATE POLICY cbd_select ON customer_bank_details FOR SELECT USING (rls_check_customer_child(customer_id));
CREATE POLICY cbd_insert ON customer_bank_details FOR INSERT WITH CHECK (rls_check_customer_child(customer_id, TRUE));
CREATE POLICY cbd_update ON customer_bank_details FOR UPDATE
  USING (rls_check_customer_child(customer_id, TRUE))
  WITH CHECK (rls_check_customer_child(customer_id, TRUE));
CREATE POLICY cbd_delete ON customer_bank_details FOR DELETE USING (rls_check_customer_child(customer_id, TRUE));

CREATE POLICY cclog_select ON customer_change_logs FOR SELECT USING (rls_check_customer_child(customer_id));
CREATE POLICY cclog_insert ON customer_change_logs FOR INSERT WITH CHECK (rls_check_customer_child(customer_id, TRUE));

CREATE POLICY ral_select ON report_audit_logs FOR SELECT USING (rls_has_company_access(company_id));
CREATE POLICY ral_insert ON report_audit_logs FOR INSERT WITH CHECK (rls_has_operational_write_access(company_id));

-- ============================================================================
-- SECTION 6: AUTH MAPPING TABLE POLICIES
-- ============================================================================

CREATE POLICY ur_select ON user_roles FOR SELECT
  USING (user_id = auth.uid() OR rls_has_company_access(company_id));
CREATE POLICY ur_insert ON user_roles FOR INSERT WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY ur_update ON user_roles FOR UPDATE
  USING (rls_has_config_write_access(company_id))
  WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY ur_delete ON user_roles FOR DELETE USING (rls_has_config_write_access(company_id));

CREATE POLICY uca_select ON user_customer_assignments FOR SELECT
  USING (user_id = auth.uid() OR rls_has_company_access(company_id));
CREATE POLICY uca_insert ON user_customer_assignments FOR INSERT WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY uca_update ON user_customer_assignments FOR UPDATE
  USING (rls_has_config_write_access(company_id))
  WITH CHECK (rls_has_config_write_access(company_id));
CREATE POLICY uca_delete ON user_customer_assignments FOR DELETE USING (rls_has_config_write_access(company_id));

-- ============================================================================
-- SECTION 7: GRANT / REVOKE HARDENING
-- ============================================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'companies','gl_accounts','bank_accounts','fiscal_periods',
      'payment_terms','tax_codes','customer_groups','exchange_rates',
      'aging_buckets','ar_system_config','products','document_sequences',
      'customers','customer_bank_details','invoices','invoice_lines',
      'receipts','allocation_details','cn_allocations',
      'journal_entries','journal_entry_lines',
      'customer_change_logs','credit_control_logs','report_audit_logs',
      'user_roles','user_customer_assignments'
    ])
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO authenticated', t);
  END LOOP;
END
$$;

REVOKE EXECUTE ON FUNCTION rls_has_company_access(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rls_has_operational_write_access(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rls_has_config_write_access(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rls_can_access_customer(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rls_check_customer_child(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rls_check_invoice(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rls_check_receipt(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rls_check_je(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rls_check_allocation(UUID, UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rls_check_cn_allocation(UUID, UUID, BOOLEAN) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION rls_has_company_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rls_has_operational_write_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rls_has_config_write_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rls_can_access_customer(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION rls_check_customer_child(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION rls_check_invoice(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION rls_check_receipt(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION rls_check_je(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION rls_check_allocation(UUID, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION rls_check_cn_allocation(UUID, UUID, BOOLEAN) TO authenticated;

REVOKE ALL ON v_customer_credit_utilization FROM anon;
REVOKE ALL ON v_invoice_aging FROM anon;
REVOKE ALL ON v_customer_aging_summary FROM anon;
REVOKE ALL ON v_customer_ar_summary FROM anon;
REVOKE ALL ON v_receipt_summary FROM anon;

GRANT SELECT ON v_customer_credit_utilization TO authenticated;
GRANT SELECT ON v_invoice_aging TO authenticated;
GRANT SELECT ON v_customer_aging_summary TO authenticated;
GRANT SELECT ON v_customer_ar_summary TO authenticated;
GRANT SELECT ON v_receipt_summary TO authenticated;

-- ============================================================================
-- P1 must next move financial mutations into SECURITY DEFINER RPCs:
-- post_invoice, post_receipt, allocate_receipt, reverse_allocation,
-- reverse_journal_entry. Do not implement those in P0.
-- ============================================================================
