-- Gate E Receipt-reference authority rollback-only smoke. Never execute in Production.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_invoices_company_customer_reference'
      AND indexdef LIKE '%(company_id, customer_id, reference_no)%'
      AND indexdef LIKE '%WHERE (reference_no IS NOT NULL)%'
      AND indexdef NOT LIKE '%UNIQUE%'
  ) THEN
    RAISE EXCEPTION 'Bounded non-unique external-reference lookup index is missing';
  END IF;
END
$$;

DO $$
DECLARE
  v_function RECORD;
  v_resolver RECORD;
  v_definition TEXT;
  v_resolver_definition TEXT;
BEGIN
  SELECT p.prosecdef, p.provolatile, p.proconfig, r.rolname AS owner_name,
         pg_get_functiondef(p.oid) AS definition
    INTO v_function
  FROM pg_proc p
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = to_regprocedure(
    'public.automation_allocate_receipt(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text)'
  );

  IF NOT FOUND
    OR NOT v_function.prosecdef
    OR v_function.provolatile <> 'v'
    OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
    OR v_function.owner_name <> 'postgres' THEN
    RAISE EXCEPTION 'Unsafe automatic-allocation function catalog contract';
  END IF;
  IF has_function_privilege(
      'anon',
      'public.automation_allocate_receipt(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.automation_allocate_receipt(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.automation_allocate_receipt(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Unsafe automatic-allocation execute privileges';
  END IF;

  SELECT p.prosecdef, p.provolatile, p.proconfig, r.rolname AS owner_name,
         pg_get_functiondef(p.oid) AS definition
    INTO v_resolver
  FROM pg_proc p
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = to_regprocedure(
    'public.automation_resolve_receipt_invoice_references(uuid,uuid,text,jsonb)'
  );
  IF NOT FOUND
    OR v_resolver.prosecdef
    OR v_resolver.provolatile <> 's'
    OR v_resolver.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
    OR v_resolver.owner_name <> 'postgres'
    OR has_function_privilege(
      'anon',
      'public.automation_resolve_receipt_invoice_references(uuid,uuid,text,jsonb)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.automation_resolve_receipt_invoice_references(uuid,uuid,text,jsonb)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.automation_resolve_receipt_invoice_references(uuid,uuid,text,jsonb)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Unsafe private reference-resolver catalog contract';
  END IF;

  v_definition := regexp_replace(
    v_function.definition, '[[:space:]]+', ' ', 'g'
  );
  v_resolver_definition := regexp_replace(
    v_resolver.definition, '[[:space:]]+', ' ', 'g'
  );
  IF v_definition NOT LIKE
      '%public.automation_resolve_receipt_invoice_references(%'
    OR v_definition NOT LIKE '%count(DISTINCT resolved.invoice_id)%'
    OR v_definition NOT LIKE '%resolved.invoice_id = v_invoice.id%'
    OR v_definition NOT LIKE
      '%Invoice reference evidence is not uniquely resolvable%'
    OR v_definition NOT LIKE '%pg_advisory_xact_lock%'
    OR v_definition NOT LIKE '%automation_fx_is_authoritative%'
    OR v_definition NOT LIKE '%public.allocate_receipt(%' THEN
    RAISE EXCEPTION 'Automatic-allocation reference authority is incomplete';
  END IF;
  IF v_resolver_definition NOT LIKE '%count(DISTINCT matches.invoice_id)%'
    OR v_resolver_definition NOT LIKE '%i.company_id = p_company_id%'
    OR v_resolver_definition NOT LIKE '%i.customer_id = p_customer_id%'
    OR v_resolver_definition NOT LIKE '%i.currency = p_currency%'
    OR v_resolver_definition NOT LIKE
      '%i.status IN (''Open'', ''Overdue'', ''Partially Paid'')%'
    OR v_resolver_definition NOT LIKE '%i.outstanding > 0%'
    OR v_resolver_definition NOT LIKE '%i.invoice_no = requested.reference%'
    OR v_resolver_definition NOT LIKE '%i.reference_no = requested.reference%'
    OR v_resolver_definition NOT LIKE '%WHERE match_count = 1%' THEN
    RAISE EXCEPTION 'Private reference resolver is incomplete';
  END IF;
END
$$;

-- Exercise the private resolver with rollback-only financial-shaped fixtures.
-- User triggers are restored by ROLLBACK.
ALTER TABLE public.invoices DISABLE TRIGGER USER;

DO $$
DECLARE
  v_company_id UUID;
  v_customer_id UUID := gen_random_uuid();
  v_other_customer_id UUID := gen_random_uuid();
  v_external_invoice_id UUID := gen_random_uuid();
  v_internal_invoice_id UUID := gen_random_uuid();
  v_match_count INTEGER;
BEGIN
  SELECT id INTO v_company_id
  FROM public.companies
  ORDER BY id
  LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Migration 038b requires one existing local company fixture';
  END IF;

  INSERT INTO public.customers (
    id, company_id, customer_id, customer_name, bill_addr_line1, bill_city,
    bill_state, bill_postal, bill_country, contact_name, contact_phone,
    contact_email, default_currency
  ) VALUES
    (
      v_customer_id, v_company_id,
      'G38-' || left(replace(v_customer_id::TEXT, '-', ''), 8),
      'Gate E Reference Customer', '1 Test Street', 'Test City', 'Test State',
      '00000', 'MY', 'Test Contact', '+60123456789',
      'gate-e-038@example.test', 'MYR'
    ),
    (
      v_other_customer_id, v_company_id,
      'G38-' || left(replace(v_other_customer_id::TEXT, '-', ''), 8),
      'Gate E Other Customer', '2 Test Street', 'Test City', 'Test State',
      '00000', 'MY', 'Other Contact', '+60123456780',
      'gate-e-038-other@example.test', 'MYR'
    );

  INSERT INTO public.invoices (
    id, company_id, invoice_no, reference_no, doc_type, invoice_date, due_date,
    customer_id, customer_name, currency, exchange_rate, base_currency,
    subtotal, tax_total, total_amount, base_total, outstanding, status
  ) VALUES
    (
      v_external_invoice_id, v_company_id, 'INV-G38-INTERNAL-1',
      'SUPPLIER-INV-123', 'Invoice', CURRENT_DATE, CURRENT_DATE + 30,
      v_customer_id, 'Gate E Reference Customer', 'MYR', 1, 'MYR',
      100, 0, 100, 100, 100, 'Open'
    ),
    (
      v_internal_invoice_id, v_company_id, 'INV-G38-INTERNAL-2',
      'SUPPLIER-INV-456', 'Invoice', CURRENT_DATE, CURRENT_DATE + 30,
      v_customer_id, 'Gate E Reference Customer', 'MYR', 1, 'MYR',
      50, 0, 50, 50, 50, 'Open'
    ),
    (
      gen_random_uuid(), v_company_id, 'INV-G38-AMB-1', 'AMBIGUOUS-REF',
      'Invoice', CURRENT_DATE, CURRENT_DATE + 30, v_customer_id,
      'Gate E Reference Customer', 'MYR', 1, 'MYR',
      25, 0, 25, 25, 25, 'Open'
    ),
    (
      gen_random_uuid(), v_company_id, 'INV-G38-AMB-2', 'AMBIGUOUS-REF',
      'Invoice', CURRENT_DATE, CURRENT_DATE + 30, v_customer_id,
      'Gate E Reference Customer', 'MYR', 1, 'MYR',
      25, 0, 25, 25, 25, 'Open'
    ),
    (
      gen_random_uuid(), v_company_id, 'INV-G38-OTHER-CUSTOMER',
      'SUPPLIER-INV-123', 'Invoice', CURRENT_DATE, CURRENT_DATE + 30,
      v_other_customer_id, 'Gate E Other Customer', 'MYR', 1, 'MYR',
      100, 0, 100, 100, 100, 'Open'
    ),
    (
      gen_random_uuid(), v_company_id, 'INV-G38-OTHER-CURRENCY',
      'SUPPLIER-INV-123', 'Invoice', CURRENT_DATE, CURRENT_DATE + 30,
      v_customer_id, 'Gate E Reference Customer', 'SGD', 3.3, 'MYR',
      100, 0, 100, 330, 100, 'Open'
    ),
    (
      gen_random_uuid(), v_company_id, 'INV-G38-INELIGIBLE',
      'SUPPLIER-INV-123', 'Invoice', CURRENT_DATE, CURRENT_DATE + 30,
      v_customer_id, 'Gate E Reference Customer', 'MYR', 1, 'MYR',
      100, 0, 100, 100, 100, 'Draft'
    ),
    (
      gen_random_uuid(), v_company_id, 'INV-G38-ZERO',
      'SUPPLIER-INV-123', 'Invoice', CURRENT_DATE, CURRENT_DATE + 30,
      v_customer_id, 'Gate E Reference Customer', 'MYR', 1, 'MYR',
      100, 0, 100, 100, 0, 'Open'
    ),
    (
      gen_random_uuid(), v_company_id, 'INV-G38-GATE',
      'GATE-INV-DRAFT-20260810-001', 'Invoice', CURRENT_DATE,
      CURRENT_DATE + 30, v_customer_id, 'Gate E Reference Customer',
      'MYR', 1, 'MYR', 100, 0, 100, 100, 100, 'Open'
    );

  SELECT count(*) INTO v_match_count
  FROM public.automation_resolve_receipt_invoice_references(
    v_company_id, v_customer_id, 'MYR',
    jsonb_build_array('SUPPLIER-INV-123')
  ) resolved
  WHERE resolved.invoice_id = v_external_invoice_id;
  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'Unique external Invoice reference did not resolve';
  END IF;

  SELECT count(*) INTO v_match_count
  FROM public.automation_resolve_receipt_invoice_references(
    v_company_id, v_customer_id, 'MYR',
    jsonb_build_array('INV-G38-INTERNAL-2')
  ) resolved
  WHERE resolved.invoice_id = v_internal_invoice_id;
  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'Unique internal Invoice number did not resolve';
  END IF;

  SELECT count(*) INTO v_match_count
  FROM public.automation_resolve_receipt_invoice_references(
    v_company_id, v_customer_id, 'MYR',
    jsonb_build_array('AMBIGUOUS-REF')
  );
  IF v_match_count <> 0 THEN
    RAISE EXCEPTION 'Ambiguous external Invoice reference resolved';
  END IF;

  SELECT count(*) INTO v_match_count
  FROM public.automation_resolve_receipt_invoice_references(
    v_company_id, v_customer_id, 'MYR',
    jsonb_build_array('GATEE-INV-DRAFT-20260810-001')
  );
  IF v_match_count <> 0 THEN
    RAISE EXCEPTION 'Non-exact GATEE/GATE reference resolved';
  END IF;
END
$$;

ROLLBACK;
