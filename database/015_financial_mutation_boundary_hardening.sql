-- ============================================================================
-- Batch 8B: Financial Mutation Boundary and Role/Visibility Hardening
-- Target: PostgreSQL 15+ / Supabase
-- Run after: 014_live_dashboard_metrics.sql
-- ============================================================================
-- This migration:
--   1. Separates operational financial reads from company/config access.
--   2. Excludes System Admin from operational customer/financial reads.
--   3. Excludes hidden/deleted customers from authenticated operational reads.
--   4. Removes direct authenticated DML on protected financial tables.
--   5. Makes the existing financial mutation RPCs service_role-only.
--
-- Existing financial RPC definitions and business logic are intentionally
-- unchanged. Edge Functions use the service_role-backed admin client and remain
-- responsible for authenticating the user and passing the verified user/company
-- context to those RPCs.
-- ============================================================================

BEGIN;

-- Operational financial reads are intentionally separate from company/config
-- access. System Admin retains configuration access through
-- rls_has_company_access()/rls_has_config_write_access(), but is not an
-- operational AR reader.
CREATE OR REPLACE FUNCTION public.rls_has_operational_read_access(
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
    FROM public.user_roles
    WHERE user_id = (SELECT auth.uid())
      AND company_id = p_company_id
      AND is_active = TRUE
      AND role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'Auditor')
  );
$$;

COMMENT ON FUNCTION public.rls_has_operational_read_access(UUID) IS
  'Batch 8B: operational AR read roles only. Excludes System Admin, which remains configuration-only.';

-- Customer access now requires a visible, non-deleted customer and an
-- operational read role. AR Clerks remain assignment-scoped.
CREATE OR REPLACE FUNCTION public.rls_can_access_customer(
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
    FROM public.customers c
    WHERE c.id = p_customer_id
      AND c.company_id = p_company_id
      AND c.is_deleted = FALSE
      AND c.is_hidden = FALSE
  )
  AND public.rls_has_operational_read_access(p_company_id)
  AND (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid())
        AND ur.company_id = p_company_id
        AND ur.is_active = TRUE
        AND ur.role IN ('AR Supervisor', 'Finance Manager', 'Auditor')
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_customer_assignments uca
      JOIN public.user_roles ur
        ON ur.user_id = uca.user_id
       AND ur.company_id = uca.company_id
      WHERE uca.user_id = (SELECT auth.uid())
        AND uca.customer_id = p_customer_id
        AND uca.company_id = p_company_id
        AND uca.is_active = TRUE
        AND ur.is_active = TRUE
        AND ur.role = 'AR Clerk'
    )
  );
$$;

COMMENT ON FUNCTION public.rls_can_access_customer(UUID, UUID) IS
  'Batch 8B: visible/non-deleted operational customer access. AR Clerk is assignment-scoped; System Admin is excluded.';

-- Journal-entry child rows must use the same operational-read boundary as
-- their parent headers. The legacy helper used broad company access, which
-- included System Admin.
CREATE OR REPLACE FUNCTION public.rls_check_je(
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
    FROM public.journal_entries je
    WHERE je.id = p_je_id
      AND public.rls_has_operational_read_access(je.company_id)
      AND (
        NOT p_write
        OR public.rls_has_operational_write_access(je.company_id)
      )
  );
$$;

COMMENT ON FUNCTION public.rls_check_je(UUID, BOOLEAN) IS
  'Batch 8B: journal entry child access requires operational AR access; System Admin is excluded.';

REVOKE EXECUTE ON FUNCTION public.rls_has_operational_read_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_has_operational_read_access(UUID) TO authenticated;

-- Recreate operational read policies so System Admin cannot read financial
-- records merely because it has company/config access.
DROP POLICY IF EXISTS cust_select ON public.customers;
CREATE POLICY cust_select ON public.customers FOR SELECT
  USING (
    public.rls_has_operational_read_access(company_id)
    AND public.rls_can_access_customer(id, company_id)
  );

DROP POLICY IF EXISTS inv_select ON public.invoices;
CREATE POLICY inv_select ON public.invoices FOR SELECT
  USING (
    public.rls_has_operational_read_access(company_id)
    AND public.rls_can_access_customer(customer_id, company_id)
  );

DROP POLICY IF EXISTS rct_select ON public.receipts;
CREATE POLICY rct_select ON public.receipts FOR SELECT
  USING (
    public.rls_has_operational_read_access(company_id)
    AND public.rls_can_access_customer(customer_id, company_id)
  );

DROP POLICY IF EXISTS ccl_select ON public.credit_control_logs;
CREATE POLICY ccl_select ON public.credit_control_logs FOR SELECT
  USING (
    public.rls_has_operational_read_access(company_id)
    AND public.rls_can_access_customer(customer_id, company_id)
  );

DROP POLICY IF EXISTS je_select ON public.journal_entries;
CREATE POLICY je_select ON public.journal_entries FOR SELECT
  USING (public.rls_has_operational_read_access(company_id));

DROP POLICY IF EXISTS ral_select ON public.report_audit_logs;
CREATE POLICY ral_select ON public.report_audit_logs FOR SELECT
  USING (public.rls_has_operational_read_access(company_id));

-- Protected financial tables are read-only to authenticated clients. All
-- writes must pass through an approved Edge Function/service flow using the
-- service_role-backed client. Dropping write policies is defense in depth;
-- privilege revocation is the primary DML boundary.
DROP POLICY IF EXISTS inv_insert ON public.invoices;
DROP POLICY IF EXISTS inv_update ON public.invoices;
DROP POLICY IF EXISTS inv_delete ON public.invoices;

DROP POLICY IF EXISTS il_insert ON public.invoice_lines;
DROP POLICY IF EXISTS il_update ON public.invoice_lines;
DROP POLICY IF EXISTS il_delete ON public.invoice_lines;

DROP POLICY IF EXISTS rct_insert ON public.receipts;
DROP POLICY IF EXISTS rct_update ON public.receipts;
DROP POLICY IF EXISTS rct_delete ON public.receipts;

DROP POLICY IF EXISTS ad_insert ON public.allocation_details;
DROP POLICY IF EXISTS ad_update ON public.allocation_details;

DROP POLICY IF EXISTS cna_insert ON public.cn_allocations;
DROP POLICY IF EXISTS cna_update ON public.cn_allocations;

DROP POLICY IF EXISTS je_insert ON public.journal_entries;
DROP POLICY IF EXISTS je_update ON public.journal_entries;

DROP POLICY IF EXISTS jel_insert ON public.journal_entry_lines;
DROP POLICY IF EXISTS jel_update ON public.journal_entry_lines;

DROP POLICY IF EXISTS ccl_insert ON public.credit_control_logs;
DROP POLICY IF EXISTS ccl_update ON public.credit_control_logs;

DROP POLICY IF EXISTS ral_insert ON public.report_audit_logs;

DROP POLICY IF EXISTS ira_insert ON public.import_row_allocations;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.invoices FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.invoice_lines FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.receipts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.allocation_details FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.cn_allocations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.journal_entries FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.journal_entry_lines FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.credit_control_logs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.report_audit_logs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.import_row_allocations FROM authenticated;

GRANT SELECT ON TABLE public.invoices TO authenticated;
GRANT SELECT ON TABLE public.invoice_lines TO authenticated;
GRANT SELECT ON TABLE public.receipts TO authenticated;
GRANT SELECT ON TABLE public.allocation_details TO authenticated;
GRANT SELECT ON TABLE public.cn_allocations TO authenticated;
GRANT SELECT ON TABLE public.journal_entries TO authenticated;
GRANT SELECT ON TABLE public.journal_entry_lines TO authenticated;
GRANT SELECT ON TABLE public.credit_control_logs TO authenticated;
GRANT SELECT ON TABLE public.report_audit_logs TO authenticated;
GRANT SELECT ON TABLE public.import_row_allocations TO authenticated;

-- Financial mutation RPCs are callable only by the trusted backend role.
-- Their definitions and business rules are not changed by this migration.
REVOKE ALL ON FUNCTION public.post_invoice(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_invoice(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.post_invoice(UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.post_receipt(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_receipt(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.post_receipt(UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.allocate_receipt(UUID, UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_receipt(UUID, UUID, UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_receipt(UUID, UUID, UUID, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.reverse_allocation(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_allocation(UUID, UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_allocation(UUID, UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.reverse_journal_entry(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_journal_entry(UUID, UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(UUID, UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.handle_bounced_cheque(UUID, UUID, UUID, TEXT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_bounced_cheque(UUID, UUID, UUID, TEXT, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.handle_bounced_cheque(UUID, UUID, UUID, TEXT, DATE) TO service_role;

COMMIT;
