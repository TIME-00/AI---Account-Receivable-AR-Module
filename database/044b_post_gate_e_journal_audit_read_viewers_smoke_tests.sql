-- ROLLBACK-ONLY smoke for Migration 044. Never register as a migration.
BEGIN;

DO $smoke$
DECLARE
  v_before_journals BIGINT;
  v_before_lines BIGINT;
  v_before_invoices BIGINT;
  v_before_receipts BIGINT;
  v_before_allocations BIGINT;
  v_before_customer_logs BIGINT;
  v_before_automation_audit BIGINT;
  v_company_id UUID;
  v_actor_id UUID;
  v_admin_id UUID;
  v_other_company_id UUID;
  v_journal_id UUID;
  v_second_journal_id UUID;
  v_other_journal_id UUID;
  v_gl_account_id UUID;
  v_cursor_time TIMESTAMPTZ;
  v_cursor_uuid UUID;
  v_cursor_event_id TEXT;
  v_result JSONB;
  v_rejected BOOLEAN := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.journal_read_list(uuid,uuid,integer,timestamp with time zone,uuid,text,date,date,text,text,text)'::pg_catalog.regprocedure
      AND p.prosecdef AND p.provolatile = 's'
      AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.audit_read_list(uuid,uuid,integer,timestamp with time zone,text,date,date,text,text,text,uuid,text,text)'::pg_catalog.regprocedure
      AND p.prosecdef AND p.provolatile = 's'
      AND p.proconfig = ARRAY['search_path=""']::TEXT[]
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) THEN
    RAISE EXCEPTION 'READ044_SMOKE: owner/security/search_path/stability contract drift';
  END IF;

  IF pg_catalog.has_function_privilege('anon', 'public.journal_read_list(uuid,uuid,integer,timestamp with time zone,uuid,text,date,date,text,text,text)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', 'public.journal_read_list(uuid,uuid,integer,timestamp with time zone,uuid,text,date,date,text,text,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', 'public.journal_read_list(uuid,uuid,integer,timestamp with time zone,uuid,text,date,date,text,text,text)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', 'public.audit_read_list(uuid,uuid,integer,timestamp with time zone,text,date,date,text,text,text,uuid,text,text)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', 'public.audit_read_list(uuid,uuid,integer,timestamp with time zone,text,date,date,text,text,text,uuid,text,text)', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', 'public.audit_read_list(uuid,uuid,integer,timestamp with time zone,text,date,date,text,text,text,uuid,text,text)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', 'public.journal_read_source(uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', 'public.audit_read_source(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'READ044_SMOKE: read RPC privilege boundary drift';
  END IF;

  v_company_id := gen_random_uuid();
  v_other_company_id := gen_random_uuid();
  v_actor_id := gen_random_uuid();
  v_admin_id := gen_random_uuid();
  v_journal_id := gen_random_uuid();
  v_second_journal_id := gen_random_uuid();
  v_other_journal_id := gen_random_uuid();
  v_gl_account_id := gen_random_uuid();

  INSERT INTO auth.users(id) VALUES (v_actor_id), (v_admin_id);
  INSERT INTO public.companies(id, company_code, company_name)
  VALUES
    (v_company_id, 'SMK' || left(replace(v_company_id::TEXT, '-', ''), 7), 'Rollback smoke company'),
    (v_other_company_id, 'SMK' || left(replace(v_other_company_id::TEXT, '-', ''), 7), 'Rollback smoke other company');
  INSERT INTO public.user_roles(user_id, company_id, role)
  VALUES
    (v_actor_id, v_company_id, 'Finance Manager'),
    (v_admin_id, v_company_id, 'System Admin');
  INSERT INTO public.gl_accounts(id, company_id, account_code, account_name, account_type)
  VALUES (v_gl_account_id, v_company_id, 'SMOKE-AR', 'Rollback smoke AR', 'Asset');
  INSERT INTO public.journal_entries(
    id, company_id, je_no, je_date, posting_period, source_type,
    source_doc_no, source_doc_id, description, currency, base_currency,
    total_debit, total_credit, created_by, created_at
  ) VALUES
    (v_journal_id, v_company_id, 'JE-ADJ-SMOKE-00001', DATE '2026-08-11', '2026-08', 'ADJ',
      'SMOKE-DOC-00001', gen_random_uuid(), 'Rollback-only viewer smoke', 'MYR', 'MYR',
      12.34, 12.34, v_actor_id, TIMESTAMPTZ '2026-08-11 04:00:00+00'),
    (v_second_journal_id, v_company_id, 'JE-ADJ-SMOKE-00002', DATE '2026-08-11', '2026-08', 'ADJ',
      'SMOKE-DOC-00002', gen_random_uuid(), 'Rollback-only viewer smoke', 'MYR', 'MYR',
      56.78, 56.78, v_actor_id, TIMESTAMPTZ '2026-08-11 04:00:00+00'),
    (v_other_journal_id, v_other_company_id, 'JE-ADJ-SMOKE-OTHER', DATE '2026-08-11', '2026-08', 'ADJ',
      'OTHER-DOC', gen_random_uuid(), 'Other tenant rollback smoke', 'MYR', 'MYR',
      1.00, 1.00, NULL, TIMESTAMPTZ '2026-08-11 04:00:00+00');
  INSERT INTO public.journal_entry_lines(
    je_id, line_no, gl_account_id, debit_amount, credit_amount,
    base_debit, base_credit, currency, original_amount
  ) VALUES
    (v_journal_id, 1, v_gl_account_id, 12.34, 0, 12.34, 0, 'MYR', 12.34),
    (v_journal_id, 2, v_gl_account_id, 0, 12.34, 0, 12.34, 'MYR', 12.34),
    (v_second_journal_id, 1, v_gl_account_id, 56.78, 0, 56.78, 0, 'MYR', 56.78),
    (v_second_journal_id, 2, v_gl_account_id, 0, 56.78, 0, 56.78, 'MYR', 56.78);

  SELECT pg_catalog.count(*) INTO v_before_journals FROM public.journal_entries;
  SELECT pg_catalog.count(*) INTO v_before_lines FROM public.journal_entry_lines;
  SELECT pg_catalog.count(*) INTO v_before_invoices FROM public.invoices;
  SELECT pg_catalog.count(*) INTO v_before_receipts FROM public.receipts;
  SELECT pg_catalog.count(*) INTO v_before_allocations FROM public.allocation_details;
  SELECT pg_catalog.count(*) INTO v_before_customer_logs FROM public.customer_change_logs;
  SELECT pg_catalog.count(*) INTO v_before_automation_audit FROM public.automation_audit_events;

  v_result := public.journal_read_list(
    v_company_id, v_actor_id, 1, NULL, NULL, 'SMOKE-DOC', NULL, NULL, 'ADJ', 'MYR', 'SMOKE-AR'
  );
  IF jsonb_array_length(v_result->'rows') <> 1 OR (v_result->>'has_more')::BOOLEAN IS NOT true
    OR (v_result->'rows'->0->>'source') IS NOT NULL THEN
    RAISE EXCEPTION 'READ044_SMOKE: bounded journal list/filter/source contract failed';
  END IF;
  v_cursor_time := (v_result->'rows'->0->>'created_at')::TIMESTAMPTZ;
  v_cursor_uuid := (v_result->'rows'->0->>'id')::UUID;
  v_result := public.journal_read_list(
    v_company_id, v_actor_id, 1, v_cursor_time, v_cursor_uuid,
    'SMOKE-DOC', NULL, NULL, 'ADJ', 'MYR', 'SMOKE-AR'
  );
  IF jsonb_array_length(v_result->'rows') <> 1
    OR (v_result->'rows'->0->>'id')::UUID = v_cursor_uuid THEN
    RAISE EXCEPTION 'READ044_SMOKE: journal keyset cursor failed';
  END IF;
  IF jsonb_array_length(public.journal_read_detail(v_company_id, v_actor_id, v_journal_id)->'lines') <> 2 THEN
    RAISE EXCEPTION 'READ044_SMOKE: journal line detail failed';
  END IF;

  v_result := public.audit_read_list(
    v_company_id, v_actor_id, 10, NULL, NULL, DATE '2026-08-11', DATE '2026-08-11',
    'generated', 'journal_entry', 'user', v_actor_id, 'balanced', 'JE-ADJ-SMOKE'
  );
  IF jsonb_array_length(v_result->'rows') <> 2 THEN
    RAISE EXCEPTION 'READ044_SMOKE: audit source/filter/tenant contract failed';
  END IF;
  v_result := public.audit_read_list(
    v_company_id, v_actor_id, 1, NULL, NULL, DATE '2026-08-11', DATE '2026-08-11',
    'generated', 'journal_entry', 'user', v_actor_id, 'balanced', 'JE-ADJ-SMOKE'
  );
  v_cursor_time := (v_result->'rows'->0->>'occurred_at')::TIMESTAMPTZ;
  v_cursor_event_id := v_result->'rows'->0->>'event_id';
  v_result := public.audit_read_list(
    v_company_id, v_actor_id, 1, v_cursor_time, v_cursor_event_id,
    DATE '2026-08-11', DATE '2026-08-11', 'generated', 'journal_entry',
    'user', v_actor_id, 'balanced', 'JE-ADJ-SMOKE'
  );
  IF jsonb_array_length(v_result->'rows') <> 1
    OR v_result->'rows'->0->>'event_id' = v_cursor_event_id THEN
    RAISE EXCEPTION 'READ044_SMOKE: audit keyset cursor failed';
  END IF;
  IF public.audit_read_detail(v_company_id, v_actor_id, 'journal_created:' || v_other_journal_id) IS NOT NULL
    OR public.journal_read_detail(v_company_id, v_actor_id, v_other_journal_id) IS NOT NULL THEN
    RAISE EXCEPTION 'READ044_SMOKE: cross-company detail leaked';
  END IF;

  BEGIN
    PERFORM public.audit_read_list(
      v_company_id, v_admin_id, 1, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'READ044_SMOKE: System Admin audit access was not rejected';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM public.journal_entries) <> v_before_journals
    OR (SELECT pg_catalog.count(*) FROM public.journal_entry_lines) <> v_before_lines
    OR (SELECT pg_catalog.count(*) FROM public.invoices) <> v_before_invoices
    OR (SELECT pg_catalog.count(*) FROM public.receipts) <> v_before_receipts
    OR (SELECT pg_catalog.count(*) FROM public.allocation_details) <> v_before_allocations
    OR (SELECT pg_catalog.count(*) FROM public.customer_change_logs) <> v_before_customer_logs
    OR (SELECT pg_catalog.count(*) FROM public.automation_audit_events) <> v_before_automation_audit THEN
    RAISE EXCEPTION 'READ044_SMOKE: a source row count changed';
  END IF;
END;
$smoke$;

ROLLBACK;
