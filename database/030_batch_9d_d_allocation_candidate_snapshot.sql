-- ============================================================================
-- TSH Synergy ERP - Accounts Receivable Module
-- Migration 030: governed allocation-candidate snapshot contract
--
-- Adds one read-only service-role RPC for the allocation workbench. The RPC
-- returns the complete eligible candidate set for one governed Receipt from a
-- single PostgreSQL statement snapshot. It does not create allocations or
-- mutate any financial, sequence, audit, or FX record.
-- ============================================================================

BEGIN;

-- Fail before creating the contract if its Batch 9D-D prerequisites are not
-- installed. This migration is additive and does not modify historical objects.
DO $$
BEGIN
  IF pg_catalog.to_regclass('public.companies') IS NULL
    OR pg_catalog.to_regclass('public.user_roles') IS NULL
    OR pg_catalog.to_regclass('public.user_customer_assignments') IS NULL
    OR pg_catalog.to_regclass('public.customers') IS NULL
    OR pg_catalog.to_regclass('public.receipts') IS NULL
    OR pg_catalog.to_regclass('public.invoices') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CONFIG: Migration 030 requires the Batch 9D-D financial and authorization tables';
  END IF;

  IF pg_catalog.to_regprocedure(
    'public.allocate_receipt(uuid,uuid,uuid,jsonb)'
  ) IS NULL OR pg_catalog.to_regprocedure(
    'public.rpc_check_customer_access(uuid,uuid,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CONFIG: Migration 030 requires the governed Batch 9D-D allocation boundary';
  END IF;
END;
$$;

CREATE FUNCTION public.get_allocation_candidates(
  p_receipt_id pg_catalog.uuid,
  p_user_id pg_catalog.uuid,
  p_company_id pg_catalog.uuid
)
RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt public.receipts%ROWTYPE;
  v_total pg_catalog.int8;
  v_candidates pg_catalog.jsonb;
  v_max_candidates CONSTANT pg_catalog.int4 := 5000;
BEGIN
  IF p_receipt_id IS NULL OR p_user_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: receipt_id and governed caller context are required';
  END IF;

  -- The service-role caller supplies only AuthContext values. Independently
  -- require an active company and one active operational AR membership.
  IF NOT EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id = p_company_id
      AND c.is_active = TRUE
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.company_id = p_company_id
      AND ur.is_active = TRUE
      AND ur.role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'AUTH: User does not have an active operational role in this company';
  END IF;

  -- Bind company, customer, currency, status, and balance to the governed
  -- Receipt. Hidden, deleted, cross-company, and nonexistent scope is one
  -- authorization-safe NOT_FOUND result.
  SELECT r.*
  INTO v_receipt
  FROM public.receipts r
  JOIN public.customers c
    ON c.id = r.customer_id
   AND c.company_id = r.company_id
   AND c.is_deleted = FALSE
   AND c.is_hidden = FALSE
  WHERE r.id = p_receipt_id
    AND r.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Receipt not found';
  END IF;

  -- Supervisors and Finance Managers see all visible customers. An AR Clerk
  -- must have an active assignment to this exact company/customer pair.
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.company_id = p_company_id
      AND ur.is_active = TRUE
      AND ur.role IN ('AR Supervisor', 'Finance Manager')
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.user_customer_assignments uca
      ON uca.user_id = ur.user_id
     AND uca.company_id = ur.company_id
     AND uca.customer_id = v_receipt.customer_id
     AND uca.is_active = TRUE
    WHERE ur.user_id = p_user_id
      AND ur.company_id = p_company_id
      AND ur.is_active = TRUE
      AND ur.role = 'AR Clerk'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Receipt not found';
  END IF;

  -- Migration 028 makes Fully Allocated synonymous with zero unallocated
  -- balance. Only an active Posted Receipt with positive authoritative balance
  -- is eligible to enter the manual allocation workflow.
  IF v_receipt.status <> 'Posted' OR v_receipt.unallocated_amount <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-ALLOC-CANDIDATES: Receipt is not eligible for allocation';
  END IF;

  SELECT pg_catalog.count(*)
  INTO v_total
  FROM public.invoices i
  WHERE i.company_id = p_company_id
    AND i.customer_id = v_receipt.customer_id
    AND i.currency = v_receipt.currency
    AND i.doc_type IN ('Invoice', 'Debit Note')
    AND i.status IN ('Open', 'Overdue', 'Partially Paid')
    AND i.outstanding > 0;

  IF v_total > v_max_candidates THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BR-ALLOC-CANDIDATE-LIMIT: Eligible document count exceeds the supported allocation workbench limit';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', i.id,
        'invoice_no', i.invoice_no,
        'doc_type', i.doc_type,
        'invoice_date', i.invoice_date,
        'due_date', i.due_date,
        'currency', i.currency,
        'exchange_rate', i.exchange_rate,
        'total_amount', i.total_amount,
        'outstanding', i.outstanding,
        'status', i.status,
        'version', i.version
      )
      ORDER BY i.due_date ASC NULLS LAST, i.invoice_no ASC, i.id ASC
    ),
    '[]'::pg_catalog.jsonb
  )
  INTO v_candidates
  FROM public.invoices i
  WHERE i.company_id = p_company_id
    AND i.customer_id = v_receipt.customer_id
    AND i.currency = v_receipt.currency
    AND i.doc_type IN ('Invoice', 'Debit Note')
    AND i.status IN ('Open', 'Overdue', 'Partially Paid')
    AND i.outstanding > 0;

  RETURN pg_catalog.jsonb_build_object(
    'contract_version', 'allocation_candidates.v1',
    'complete', TRUE,
    'max_candidates', v_max_candidates,
    'ordering', pg_catalog.jsonb_build_array(
      'due_date ASC NULLS LAST',
      'invoice_no ASC',
      'id ASC'
    ),
    'receipt', pg_catalog.jsonb_build_object(
      'id', v_receipt.id,
      'receipt_no', v_receipt.receipt_no,
      'receipt_date', v_receipt.receipt_date,
      'customer_id', v_receipt.customer_id,
      'customer_name', v_receipt.customer_name,
      'currency', v_receipt.currency,
      'exchange_rate', v_receipt.exchange_rate,
      'receipt_amount', v_receipt.receipt_amount,
      'allocated_amount', v_receipt.allocated_amount,
      'unallocated_amount', v_receipt.unallocated_amount,
      'payment_method', v_receipt.payment_method,
      'status', v_receipt.status,
      'version', v_receipt.version
    ),
    'customer_id', v_receipt.customer_id,
    'currency', v_receipt.currency,
    'total', v_total,
    'candidates', v_candidates
  );
END;
$$;

-- CREATE FUNCTION ownership remains with the controlled Supabase migration
-- executor, matching existing governed RPC ownership. SECURITY DEFINER is
-- necessary only for this exact explicitly-scoped read; the empty search path,
-- fully qualified objects, independent role/customer checks, and ACL below
-- prevent it from becoming a general privileged read surface.
REVOKE ALL ON FUNCTION public.get_allocation_candidates(
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_allocation_candidates(
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.uuid
) FROM anon;
REVOKE ALL ON FUNCTION public.get_allocation_candidates(
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.uuid
) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_allocation_candidates(
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.uuid
) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_allocation_candidates(
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.uuid
) TO service_role;

COMMENT ON FUNCTION public.get_allocation_candidates(
  pg_catalog.uuid,
  pg_catalog.uuid,
  pg_catalog.uuid
) IS
  'Migration 030 service-role-only read contract. STABLE execution keeps Receipt authorization, exact count, and the complete JSON candidate array on the invoking statement snapshot; it fails without partial data above 5000 candidates and performs no financial mutation.';

COMMIT;
