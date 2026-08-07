-- Gate E rollback-only database smoke. Never execute in Production.
BEGIN;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'sales_representatives',
    'customer_sales_representative_assignments',
    'automation_settings',
    'automation_mailboxes',
    'automation_oauth_states',
    'mailbox_sync_runs',
    'automation_source_messages',
    'automation_source_attachments',
    'automation_document_classifications',
    'automation_extraction_results',
    'automation_commands',
    'automation_exceptions',
    'automation_allocation_decisions',
    'invoice_reminders',
    'reminder_delivery_attempts',
    'automation_audit_events'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'Missing Gate E table: %', v_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_table AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS not enabled: %', v_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'public' AND c.relname = v_table
        AND r.rolname = 'postgres'
    ) THEN
      RAISE EXCEPTION 'Unexpected Gate E table owner: %', v_table;
    END IF;
    IF has_table_privilege('anon', 'public.' || v_table, 'SELECT')
      OR has_table_privilege('anon', 'public.' || v_table, 'INSERT')
      OR has_table_privilege('anon', 'public.' || v_table, 'UPDATE')
      OR has_table_privilege('anon', 'public.' || v_table, 'DELETE')
      OR has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
      OR has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
      OR has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
      OR has_table_privilege('authenticated', 'public.' || v_table, 'DELETE') THEN
      RAISE EXCEPTION 'Unsafe browser table privilege: %', v_table;
    END IF;
    IF NOT has_table_privilege(
      'service_role',
      'public.' || v_table,
      'SELECT, INSERT, UPDATE, DELETE'
    ) THEN
      RAISE EXCEPTION 'Missing service_role table privileges: %', v_table;
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  v_signature TEXT;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'automation_assert_tenant_links()',
    'automation_guard_assignment_history()',
    'automation_guard_extraction_history()',
    'automation_update_sync_run_counters()',
    'automation_attribute_allocation_method()',
    'automation_record_lifecycle_audit()',
    'automation_prevent_immutable_mutation()'
  ]
  LOOP
    IF to_regprocedure('public.' || v_signature) IS NULL
      OR has_function_privilege(
        'anon', 'public.' || v_signature, 'EXECUTE'
      )
      OR has_function_privilege(
        'authenticated', 'public.' || v_signature, 'EXECUTE'
      )
      OR has_function_privilege(
        'service_role', 'public.' || v_signature, 'EXECUTE'
      )
      OR EXISTS (
        SELECT 1
        FROM pg_proc p
        CROSS JOIN LATERAL aclexplode(
          COALESCE(p.proacl, acldefault('f', p.proowner))
        ) privilege
        WHERE p.oid = to_regprocedure('public.' || v_signature)
          AND privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
      OR EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_roles owner_role ON owner_role.oid = p.proowner
        WHERE p.oid = to_regprocedure('public.' || v_signature)
          AND (
            owner_role.rolname <> 'postgres'
            OR (
              v_signature = 'automation_record_lifecycle_audit()'
              AND NOT p.prosecdef
            )
            OR (
              v_signature <> 'automation_record_lifecycle_audit()'
              AND p.prosecdef
            )
            OR p.provolatile <> 'v'
            OR p.proconfig IS DISTINCT FROM
              ARRAY['search_path=""']::TEXT[]
          )
      ) THEN
      RAISE EXCEPTION 'Unsafe Gate E trigger-helper grant: %', v_signature;
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  v_signature TEXT;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'automation_assign_sales_representative(uuid,uuid,uuid,uuid,text,text)',
    'automation_fx_is_authoritative(uuid,uuid,uuid)',
    'automation_execute_invoice_command(uuid,uuid,uuid,jsonb,jsonb,jsonb,boolean,text,uuid,boolean)',
    'automation_execute_receipt_command(uuid,uuid,uuid,jsonb,jsonb,boolean,text,uuid,boolean)',
    'automation_allocate_receipt(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text)',
    'automation_evaluate_invoice_reminders(uuid,date,uuid)',
    'automation_valid_reminder_offsets(integer[])'
  ]
  LOOP
    IF to_regprocedure('public.' || v_signature) IS NULL THEN
      RAISE EXCEPTION 'Missing Gate E function: %', v_signature;
    END IF;
    IF has_function_privilege('anon', 'public.' || v_signature, 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.' || v_signature, 'EXECUTE')
      OR EXISTS (
        SELECT 1
        FROM pg_proc p
        CROSS JOIN LATERAL aclexplode(
          COALESCE(p.proacl, acldefault('f', p.proowner))
        ) privilege
        WHERE p.oid = to_regprocedure('public.' || v_signature)
          AND privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      ) THEN
      RAISE EXCEPTION 'Unsafe Gate E execute grant: %', v_signature;
    END IF;
    IF NOT has_function_privilege('service_role', 'public.' || v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'Missing service_role grant: %', v_signature;
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  v_signature TEXT;
  v_function RECORD;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'automation_assign_sales_representative(uuid,uuid,uuid,uuid,text,text)',
    'automation_fx_is_authoritative(uuid,uuid,uuid)',
    'automation_execute_invoice_command(uuid,uuid,uuid,jsonb,jsonb,jsonb,boolean,text,uuid,boolean)',
    'automation_execute_receipt_command(uuid,uuid,uuid,jsonb,jsonb,boolean,text,uuid,boolean)',
    'automation_allocate_receipt(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text)',
    'automation_evaluate_invoice_reminders(uuid,date,uuid)'
  ]
  LOOP
    SELECT p.prosecdef, p.provolatile, r.rolname AS owner_name,
           p.proconfig
      INTO v_function
    FROM pg_proc p
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.oid = to_regprocedure('public.' || v_signature);
    IF v_function.owner_name <> 'postgres'
      OR (
        v_signature LIKE 'automation_fx_is_authoritative%'
        AND v_function.prosecdef
      )
      OR (
        v_signature NOT LIKE 'automation_fx_is_authoritative%'
        AND NOT v_function.prosecdef
      )
      OR (
        v_signature LIKE 'automation_fx_is_authoritative%'
        AND v_function.provolatile <> 's'
      )
      OR (
        v_signature NOT LIKE 'automation_fx_is_authoritative%'
        AND v_function.provolatile <> 'v'
      )
      OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
      RAISE EXCEPTION 'Unsafe Gate E function catalog contract: %', v_signature;
    END IF;
  END LOOP;

  SELECT p.prosecdef, p.provolatile, r.rolname AS owner_name,
         p.proconfig
    INTO v_function
  FROM pg_proc p
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = to_regprocedure(
    'public.automation_valid_reminder_offsets(integer[])'
  );
  IF v_function.owner_name <> 'postgres'
    OR v_function.prosecdef
    OR v_function.provolatile <> 'i'
    OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
    RAISE EXCEPTION
      'Unsafe Gate E function catalog contract: automation_valid_reminder_offsets(integer[])';
  END IF;

  SELECT p.prosecdef, p.provolatile, r.rolname AS owner_name,
         p.proconfig
    INTO v_function
  FROM pg_proc p
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = to_regprocedure(
    'public.automation_record_lifecycle_audit()'
  );
  IF v_function.owner_name <> 'postgres'
    OR NOT v_function.prosecdef
    OR v_function.provolatile <> 'v'
    OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
    OR has_function_privilege(
      'anon', 'public.automation_record_lifecycle_audit()', 'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated', 'public.automation_record_lifecycle_audit()', 'EXECUTE'
    )
    OR has_function_privilege(
      'service_role', 'public.automation_record_lifecycle_audit()', 'EXECUTE'
    )
    OR EXISTS (
      SELECT 1
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(
        COALESCE(p.proacl, acldefault('f', p.proowner))
      ) privilege
      WHERE p.oid = to_regprocedure(
        'public.automation_record_lifecycle_audit()'
      )
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
    RAISE EXCEPTION
      'Unsafe Gate E lifecycle audit function catalog contract';
  END IF;

  SELECT p.prosecdef, p.provolatile, r.rolname AS owner_name,
         p.proconfig
    INTO v_function
  FROM pg_proc p
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = to_regprocedure(
    'public.automation_attribute_allocation_method()'
  );
  IF v_function.owner_name <> 'postgres'
    OR v_function.prosecdef
    OR v_function.provolatile <> 'v'
    OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
    OR has_function_privilege(
      'anon', 'public.automation_attribute_allocation_method()', 'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.automation_attribute_allocation_method()',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.automation_attribute_allocation_method()',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION
      'Unsafe Gate E allocation attribution function catalog contract';
  END IF;
END
$$;

DO $$
DECLARE
  v_has_gate_e_cron BOOLEAN := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_customer_sales_assignment_current'
      AND indexdef LIKE '%WHERE (superseded_at IS NULL)%'
  ) THEN
    RAISE EXCEPTION 'Current-sales-representative uniqueness is missing';
  END IF;
  IF to_regprocedure(
    'public.automation_guard_assignment_history()'
  ) IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid =
      'public.customer_sales_representative_assignments'::regclass
      AND tgname = 'trg_customer_sales_assignment_history_immutable'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Immutable sales-assignment history guard is missing';
  END IF;
  IF to_regprocedure(
    'public.automation_guard_extraction_history()'
  ) IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.automation_extraction_results'::regclass
      AND tgname = 'trg_automation_extraction_immutable'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Immutable extraction history guard is missing';
  END IF;
  IF to_regprocedure(
    'public.automation_record_lifecycle_audit()'
  ) IS NULL OR (
    SELECT count(*)
    FROM pg_trigger
    WHERE tgname LIKE 'trg_%_audit'
      AND tgfoid = 'public.automation_record_lifecycle_audit()'::regprocedure
      AND NOT tgisinternal
  ) <> 14 THEN
    RAISE EXCEPTION 'Gate E lifecycle audit trigger coverage is incomplete';
  END IF;
  IF to_regprocedure(
    'public.automation_attribute_allocation_method()'
  ) IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.allocation_details'::regclass
      AND tgname = 'trg_automation_attribute_allocation_method'
      AND tgfoid =
        'public.automation_attribute_allocation_method()'::regprocedure
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Gate E allocation attribution trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_invoice_reminder_stage'
  ) THEN
    RAISE EXCEPTION 'Reminder idempotency index is missing';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mailbox_sync_runs'
      AND column_name IN (
        'attachments_processed', 'commands_processed',
        'allocations_completed', 'failures'
      )
      AND data_type = 'integer'
      AND is_nullable = 'NO'
  ) <> 4 OR (
    SELECT count(*)
    FROM pg_trigger
    WHERE tgfoid =
      'public.automation_update_sync_run_counters()'::regprocedure
      AND NOT tgisinternal
  ) <> 5 THEN
    RAISE EXCEPTION 'Measured sync-run counters or attribution triggers are incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_invoice_reminder_invoice_list'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_reminder_delivery_attempt_list'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_automation_audit_entity_timeline'
  ) THEN
    RAISE EXCEPTION 'Gate E entity-filter indexes are incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'automation_source_attachments'
      AND column_name = 'content_purged_at'
      AND data_type = 'timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'Attachment purge metadata is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_automation_source_attachment_retention'
      AND indexdef LIKE '%WHERE (content_purged_at IS NULL)%'
  ) THEN
    RAISE EXCEPTION 'Bounded attachment-retention index is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'automation_source_attachments'
      AND column_name = 'processing_status'
      AND column_default = '''pending''::text'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.automation_source_attachments'::regclass
      AND conname = 'chk_automation_attachment_processing'
      AND pg_get_constraintdef(oid) LIKE '%retryable%'
      AND pg_get_constraintdef(oid) LIKE '%processed%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_automation_source_attachment_processing'
      AND indexdef LIKE '%processing_status%'
      AND indexdef LIKE '%content_purged_at IS NULL%'
  ) THEN
    RAISE EXCEPTION 'Crash-safe attachment processing lifecycle is incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.automation_mailboxes'::regclass
      AND conname = 'chk_automation_mailbox_enabled_ready'
      AND pg_get_constraintdef(oid) LIKE '%ingestion_token_expires_at IS NOT NULL%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.automation_mailboxes'::regclass
      AND conname = 'chk_automation_mailbox_capability_ready'
      AND pg_get_constraintdef(oid) LIKE '%delivery_token_expires_at IS NOT NULL%'
  ) THEN
    RAISE EXCEPTION 'Mailbox token-expiry readiness constraints are incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.automation_settings'::regclass
      AND conname = 'chk_observe_only_no_delivery'
      AND pg_get_constraintdef(oid) LIKE '%reminder_delivery_enabled%'
  ) THEN
    RAISE EXCEPTION 'Observe-only email-delivery prohibition is missing';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1 FROM cron.job
        WHERE jobname LIKE '%automation%'
           OR jobname LIKE '%reminder%'
           OR jobname LIKE '%mailbox%'
      )
    $query$ INTO v_has_gate_e_cron;
    IF v_has_gate_e_cron THEN
      RAISE EXCEPTION 'Gate E must not install scheduler jobs';
    END IF;
  END IF;
END
$$;

-- The reminder runtime fixture is a pre-existing Posted/Open invoice model.
-- Disable only user triggers inside this rollback-only transaction so the
-- smoke does not need to invoke unrelated posting/journal infrastructure.
-- The final ROLLBACK restores the trigger state.
ALTER TABLE public.invoices DISABLE TRIGGER USER;
ALTER TABLE public.receipts DISABLE TRIGGER USER;

-- Exercise tenant consistency, contact constraints, explicit reassignment, and
-- default-off posture with synthetic rows that are removed by the final
-- ROLLBACK.
DO $$
DECLARE
  v_company_id UUID;
  v_other_company_id UUID := gen_random_uuid();
  v_actor_id UUID := gen_random_uuid();
  v_customer_id UUID := gen_random_uuid();
  v_first_representative_id UUID := gen_random_uuid();
  v_second_representative_id UUID := gen_random_uuid();
  v_cross_tenant_representative_id UUID := gen_random_uuid();
  v_invoice_id UUID := gen_random_uuid();
  v_first_assignment_id UUID;
  v_mailbox_id UUID := gen_random_uuid();
  v_sync_run_id UUID := gen_random_uuid();
  v_message_id UUID := gen_random_uuid();
  v_invoice_attachment_id UUID := gen_random_uuid();
  v_receipt_attachment_id UUID := gen_random_uuid();
  v_invoice_classification_id UUID := gen_random_uuid();
  v_receipt_classification_id UUID := gen_random_uuid();
  v_invoice_extraction_id UUID := gen_random_uuid();
  v_receipt_extraction_id UUID := gen_random_uuid();
  v_invoice_command_id UUID := gen_random_uuid();
  v_receipt_command_id UUID := gen_random_uuid();
  v_allocation_invoice_id UUID := gen_random_uuid();
  v_cross_currency_invoice_id UUID := gen_random_uuid();
  v_allocation_receipt_id UUID := gen_random_uuid();
  v_invoice_fx_decision_id UUID := gen_random_uuid();
  v_receipt_fx_decision_id UUID := gen_random_uuid();
  v_bank_account_id UUID;
  v_bank_account_name TEXT;
  v_result JSONB;
BEGIN
  SELECT id INTO v_company_id
  FROM public.companies
  ORDER BY id
  LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Gate E smoke requires one existing local company fixture';
  END IF;

  INSERT INTO public.companies (
    id, company_code, company_name, base_currency, country
  ) VALUES (
    v_other_company_id,
    'GTE-' || left(replace(v_other_company_id::TEXT, '-', ''), 6),
    'Gate E Rollback Tenant',
    'MYR',
    'MY'
  );
  INSERT INTO public.user_roles (user_id, company_id, role, is_active)
  VALUES (v_actor_id, v_company_id, 'Finance Manager', true);
  INSERT INTO public.customers (
    id, company_id, customer_id, customer_name, bill_addr_line1, bill_city,
    bill_state, bill_postal, bill_country, contact_name, contact_phone,
    contact_email, default_currency
  ) VALUES (
    v_customer_id, v_company_id,
    'GATEE-' || left(replace(v_customer_id::TEXT, '-', ''), 8),
    'Gate E Rollback Customer', '1 Test Street', 'Test City', 'Test State',
    '00000', 'MY', 'Test Contact', '+60123456789',
    'gate-e-customer@example.test', 'MYR'
  );
  INSERT INTO public.sales_representatives (
    id, company_id, name, email, phone, created_by
  ) VALUES
    (
      v_first_representative_id, v_company_id, 'Société 測試',
      'first.sales@example.test', '+60123456789', v_actor_id
    ),
    (
      v_second_representative_id, v_company_id, 'Second Representative',
      'second.sales@example.test', '+60123456780', v_actor_id
    ),
    (
      v_cross_tenant_representative_id, v_other_company_id,
      'Other Tenant Representative', 'other.sales@example.test',
      '+60123456781', v_actor_id
    );

  BEGIN
    INSERT INTO public.sales_representatives (
      company_id, name, email, is_active
    ) VALUES (v_company_id, 'Invalid Active Representative', NULL, true);
    RAISE EXCEPTION 'Active representative without email was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  v_result := public.automation_assign_sales_representative(
    v_company_id, v_actor_id, v_customer_id, v_first_representative_id,
    'customer_acquisition', 'Initial responsible representative'
  );
  IF NOT COALESCE((v_result ->> 'changed')::BOOLEAN, false) THEN
    RAISE EXCEPTION 'Initial representative assignment was not recorded';
  END IF;
  v_first_assignment_id := (v_result ->> 'assignment_id')::UUID;

  v_result := public.automation_assign_sales_representative(
    v_company_id, v_actor_id, v_customer_id, v_second_representative_id,
    'manual_assignment', 'Customer ownership formally transferred'
  );
  IF NOT COALESCE((v_result ->> 'changed')::BOOLEAN, false)
    OR (
      SELECT count(*)
      FROM public.customer_sales_representative_assignments
      WHERE company_id = v_company_id AND customer_id = v_customer_id
    ) <> 2
    OR (
      SELECT count(*)
      FROM public.customer_sales_representative_assignments
      WHERE company_id = v_company_id AND customer_id = v_customer_id
        AND superseded_at IS NULL
        AND sales_representative_id = v_second_representative_id
    ) <> 1 THEN
    RAISE EXCEPTION 'Explicit reassignment history/current-owner invariant failed';
  END IF;

  BEGIN
    UPDATE public.customer_sales_representative_assignments
    SET assignment_reason = 'Silent historical rewrite'
    WHERE id = v_first_assignment_id;
    RAISE EXCEPTION 'Historical assignment was mutable';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'IMMUTABLE_SALES_ASSIGNMENT_HISTORY' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.automation_assign_sales_representative(
      v_company_id, v_actor_id, v_customer_id, v_first_representative_id,
      'manual_assignment', ''
    );
    RAISE EXCEPTION 'Reassignment without reason was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'VALIDATION:%' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.customer_sales_representative_assignments (
      company_id, customer_id, sales_representative_id, assignment_source,
      assigned_by, assignment_reason
    ) VALUES (
      v_company_id, v_customer_id, v_cross_tenant_representative_id,
      'manual_assignment', v_actor_id, 'Must fail tenant consistency'
    );
    RAISE EXCEPTION 'Cross-tenant representative assignment was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'TENANT_MISMATCH%' THEN RAISE; END IF;
  END;

  INSERT INTO public.automation_settings (company_id)
  VALUES (v_company_id);
  IF EXISTS (
    SELECT 1
    FROM public.automation_settings
    WHERE company_id = v_company_id
      AND (
        operating_mode <> 'disabled'
        OR mailbox_sync_enabled
        OR document_intelligence_enabled
        OR invoice_automation_enabled
        OR receipt_automation_enabled
        OR auto_allocation_enabled
        OR reminder_evaluation_enabled
        OR reminder_delivery_enabled
        OR reminder_stage_offsets <> ARRAY[-3, 0]::INTEGER[]
      )
  ) THEN
    RAISE EXCEPTION 'Default automation posture is not disabled';
  END IF;

  -- Build a complete synthetic trace chain, then force both atomic command
  -- wrappers to fail during posting with a deliberately closed historical
  -- fiscal period. The caught statement exception must leave no financial,
  -- journal, audit, or command-completion residue.
  SELECT id, bank_name || ' - ' || account_no
    INTO v_bank_account_id, v_bank_account_name
  FROM public.bank_accounts
  WHERE company_id = v_company_id
  ORDER BY id
  LIMIT 1;
  IF v_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'Gate E atomic receipt smoke requires a local bank account';
  END IF;

  INSERT INTO public.automation_mailboxes (
    id, company_id, provider_type, mailbox_address
  ) VALUES (
    v_mailbox_id, v_company_id, 'gmail', 'gate-e-atomic@example.test'
  );
  INSERT INTO public.mailbox_sync_runs (
    id, company_id, mailbox_id, provider_type, status, started_at,
    attempt_count
  ) VALUES (
    v_sync_run_id, v_company_id, v_mailbox_id, 'gmail', 'completed', now(), 1
  );
  INSERT INTO public.automation_source_messages (
    id, company_id, mailbox_id, sync_run_id, provider_type, provider_message_id,
    received_at, processing_status
  ) VALUES (
    v_message_id, v_company_id, v_mailbox_id, v_sync_run_id, 'gmail',
    'gate-e-atomic-message', now(), 'validated'
  );
  INSERT INTO public.automation_source_attachments (
    id, company_id, mailbox_id, message_id, provider_attachment_id,
    original_file_name, safe_storage_path, declared_mime_type,
    detected_mime_type, extension, sha256, size_bytes, page_count,
    safety_status, retention_expires_at
  ) VALUES
    (
      v_invoice_attachment_id, v_company_id, v_mailbox_id, v_message_id,
      'gate-e-atomic-invoice', 'invoice.pdf',
      v_company_id::TEXT || '/automation/' || v_mailbox_id::TEXT || '/' ||
        repeat('a', 64) || '.pdf',
      'application/pdf', 'application/pdf', 'pdf', repeat('a', 64), 100, 1,
      'accepted', now() + interval '30 days'
    ),
    (
      v_receipt_attachment_id, v_company_id, v_mailbox_id, v_message_id,
      'gate-e-atomic-receipt', 'receipt.pdf',
      v_company_id::TEXT || '/automation/' || v_mailbox_id::TEXT || '/' ||
        repeat('b', 64) || '.pdf',
      'application/pdf', 'application/pdf', 'pdf', repeat('b', 64), 100, 1,
      'accepted', now() + interval '30 days'
    );
  INSERT INTO public.automation_document_classifications (
    id, company_id, attachment_id, schema_version, provider_name,
    provider_model, provider_version, document_type, confidence,
    critical_confidence, status, trace_id
  ) VALUES
    (
      v_invoice_classification_id, v_company_id, v_invoice_attachment_id, 1,
      'fixture', 'fixture-v1', '1', 'invoice', 1, 1, 'accepted',
      'gate-e-atomic-invoice'
    ),
    (
      v_receipt_classification_id, v_company_id, v_receipt_attachment_id, 1,
      'fixture', 'fixture-v1', '1', 'receipt', 1, 1, 'accepted',
      'gate-e-atomic-receipt'
    );
  INSERT INTO public.automation_extraction_results (
    id, company_id, classification_id, schema_version, provider_name,
    provider_model, provider_version, extracted_fields, field_confidence,
    validation_status, customer_id, customer_resolution_method, trace_id,
    validated_at
  ) VALUES
    (
      v_invoice_extraction_id, v_company_id, v_invoice_classification_id, 1,
      'fixture', 'fixture-v1', '1', '{}'::JSONB, '{}'::JSONB, 'valid',
      v_customer_id, 'customer_code', 'gate-e-atomic-invoice', now()
    ),
    (
      v_receipt_extraction_id, v_company_id, v_receipt_classification_id, 1,
      'fixture', 'fixture-v1', '1',
      jsonb_build_object(
        'document_type', 'receipt',
        'invoice_references', jsonb_build_array()
      ),
      '{}'::JSONB, 'valid',
      v_customer_id, 'customer_code', 'gate-e-atomic-receipt', now()
    );
  INSERT INTO public.automation_commands (
    id, company_id, mailbox_id, message_id, attachment_id, extraction_id,
    command_type, schema_version, operating_mode, idempotency_key,
    command_payload, status, created_by, started_at
  ) VALUES
    (
      v_invoice_command_id, v_company_id, v_mailbox_id, v_message_id,
      v_invoice_attachment_id, v_invoice_extraction_id, 'create_invoice', 1,
      'straight_through', repeat('c', 64), '{}'::JSONB, 'running',
      v_actor_id, now()
    ),
    (
      v_receipt_command_id, v_company_id, v_mailbox_id, v_message_id,
      v_receipt_attachment_id, v_receipt_extraction_id, 'create_receipt', 1,
      'straight_through', repeat('d', 64), '{}'::JSONB, 'running',
      v_actor_id, now()
    );
  UPDATE public.automation_settings
  SET operating_mode = 'straight_through',
      automation_actor_user_id = v_actor_id,
      document_intelligence_enabled = true,
      invoice_automation_enabled = true,
      receipt_automation_enabled = true
  WHERE company_id = v_company_id;

  BEGIN
    PERFORM public.automation_execute_invoice_command(
      v_company_id, v_actor_id, v_invoice_command_id,
      jsonb_build_object(
        'invoice_no', 'GTE-ATOMIC-INV', 'doc_type', 'Invoice',
        'invoice_date', '1900-01-01', 'customer_id', v_customer_id,
        'customer_name', 'Gate E Rollback Customer', 'currency', 'MYR',
        'exchange_rate', 1, 'base_currency', 'MYR', 'subtotal', 100,
        'tax_total', 0, 'total_amount', 100, 'base_total', 100
      ),
      jsonb_build_object(
        'source', 'gate_e_automation',
        'automation_command_id', v_invoice_command_id
      ),
      jsonb_build_array(jsonb_build_object(
        'line_no', 10, 'description', 'Atomic rollback fixture',
        'quantity', 1, 'unit_price', 100, 'discount_pct', 0,
        'discount_amt', 0, 'line_amount', 100, 'tax_rate', 0,
        'tax_amount', 0, 'line_total', 100
      )),
      false, NULL, NULL, true
    );
    RAISE EXCEPTION 'Atomic invoice wrapper unexpectedly posted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Atomic invoice wrapper unexpectedly posted' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE 'BR-JE-007:%' THEN
        RAISE EXCEPTION 'Unexpected atomic invoice failure: %', SQLERRM;
      END IF;
  END;
  BEGIN
    PERFORM public.automation_execute_receipt_command(
      v_company_id, v_actor_id, v_receipt_command_id,
      jsonb_build_object(
        'receipt_no', 'GTE-ATOMIC-RCT', 'receipt_date', '1900-01-01',
        'value_date', '1900-01-01', 'customer_id', v_customer_id,
        'customer_name', 'Gate E Rollback Customer', 'payment_method', 'TT',
        'currency', 'MYR', 'exchange_rate', 1, 'base_currency', 'MYR',
        'receipt_amount', 100, 'base_amount', 100, 'bank_account_id',
        v_bank_account_id, 'bank_account_name', v_bank_account_name
      ),
      jsonb_build_object(
        'source', 'gate_e_automation',
        'automation_command_id', v_receipt_command_id
      ),
      false, NULL, NULL, true
    );
    RAISE EXCEPTION 'Atomic receipt wrapper unexpectedly posted';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'Atomic receipt wrapper unexpectedly posted' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE 'BR-JE-007:%' THEN
        RAISE EXCEPTION 'Unexpected atomic receipt failure: %', SQLERRM;
      END IF;
  END;
  IF EXISTS (
    SELECT 1 FROM public.invoices WHERE invoice_no = 'GTE-ATOMIC-INV'
  ) OR EXISTS (
    SELECT 1 FROM public.receipts WHERE receipt_no = 'GTE-ATOMIC-RCT'
  ) OR EXISTS (
    SELECT 1
    FROM public.automation_commands
    WHERE id IN (v_invoice_command_id, v_receipt_command_id)
      AND (status <> 'running' OR completed_at IS NOT NULL
        OR resulting_invoice_id IS NOT NULL OR resulting_receipt_id IS NOT NULL)
  ) OR EXISTS (
    SELECT 1
    FROM public.automation_audit_events
    WHERE entity_id IN (v_invoice_command_id, v_receipt_command_id)
      AND event_type = 'automation_commands_update'
      AND safe_metadata ->> 'status' = 'completed'
  ) THEN
    RAISE EXCEPTION 'Atomic financial-command failure left partial residue';
  END IF;

  -- Exercise the DB-authoritative allocation boundary with authoritative
  -- base-parity decisions. The rejected cross-currency statement and the
  -- accepted/idempotent statement are all removed by the final ROLLBACK.
  INSERT INTO public.fiscal_periods (
    company_id, period_code, status, start_date, end_date
  ) VALUES (
    v_company_id, to_char(CURRENT_DATE, 'YYYY-MM'), 'Open',
    date_trunc('month', CURRENT_DATE)::DATE,
    (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::DATE
  )
  ON CONFLICT (company_id, period_code)
  DO UPDATE SET status = 'Open';

  INSERT INTO public.invoices (
    id, company_id, invoice_no, doc_type, invoice_date, due_date,
    customer_id, customer_name, currency, exchange_rate, base_currency,
    subtotal, tax_total, total_amount, base_total, outstanding, status,
    posted_by, posted_at
  ) VALUES
    (
      v_allocation_invoice_id, v_company_id, 'GTE-ALLOC-INV', 'Invoice',
      CURRENT_DATE, CURRENT_DATE + 30, v_customer_id,
      'Gate E Rollback Customer', 'MYR', 1, 'MYR',
      100, 0, 100, 100, 100, 'Open', v_actor_id, now()
    ),
    (
      v_cross_currency_invoice_id, v_company_id, 'GTE-ALLOC-SGD', 'Invoice',
      CURRENT_DATE, CURRENT_DATE + 30, v_customer_id,
      'Gate E Rollback Customer', 'SGD', 3.3, 'MYR',
      100, 0, 100, 330, 100, 'Open', v_actor_id, now()
    );
  INSERT INTO public.receipts (
    id, company_id, receipt_no, receipt_date, value_date, customer_id,
    customer_name, payment_method, currency, exchange_rate, base_currency,
    receipt_amount, base_amount, allocated_amount, unallocated_amount,
    bank_account_id, bank_account_name, status, posted_by, posted_at
  ) VALUES (
    v_allocation_receipt_id, v_company_id, 'GTE-ALLOC-RCT', CURRENT_DATE,
    CURRENT_DATE, v_customer_id, 'Gate E Rollback Customer', 'TT', 'MYR', 1,
    'MYR', 100, 100, 0, 100, v_bank_account_id, v_bank_account_name,
    'Posted', v_actor_id, now()
  );
  INSERT INTO public.fx_booking_rate_decisions (
    id, company_id, invoice_id, root_decision_id, source_category,
    baseline_kind, baseline_rate, from_currency, to_currency,
    transaction_date, booked_rate, approval_status, lifecycle_status,
    maker_user_id, posted, posted_at
  ) VALUES (
    v_invoice_fx_decision_id, v_company_id, v_allocation_invoice_id,
    v_invoice_fx_decision_id, 'BASE_PARITY', 'BASE_PARITY', 1,
    'MYR', 'MYR', CURRENT_DATE, 1, 'NotRequired', 'Posted',
    v_actor_id, true, now()
  );
  INSERT INTO public.fx_booking_rate_decisions (
    id, company_id, receipt_id, root_decision_id, source_category,
    baseline_kind, baseline_rate, from_currency, to_currency,
    transaction_date, booked_rate, approval_status, lifecycle_status,
    maker_user_id, posted, posted_at
  ) VALUES (
    v_receipt_fx_decision_id, v_company_id, v_allocation_receipt_id,
    v_receipt_fx_decision_id, 'BASE_PARITY', 'BASE_PARITY', 1,
    'MYR', 'MYR', CURRENT_DATE, 1, 'NotRequired', 'Posted',
    v_actor_id, true, now()
  );
  UPDATE public.invoices
  SET fx_decision_id = v_invoice_fx_decision_id,
      fx_source_category = 'BASE_PARITY'
  WHERE id = v_allocation_invoice_id;
  UPDATE public.receipts
  SET fx_decision_id = v_receipt_fx_decision_id,
      fx_source_category = 'BASE_PARITY'
  WHERE id = v_allocation_receipt_id;
  UPDATE public.automation_commands
  SET status = 'completed',
      resulting_receipt_id = v_allocation_receipt_id,
      completed_at = now()
  WHERE id = v_receipt_command_id;
  UPDATE public.automation_settings
  SET auto_allocation_enabled = true
  WHERE company_id = v_company_id;

  BEGIN
    PERFORM public.automation_allocate_receipt(
      v_company_id, v_actor_id, v_receipt_command_id,
      v_allocation_receipt_id, 'exact_amount_single_invoice',
      jsonb_build_object(
        'invoice_references', jsonb_build_array('GTE-ALLOC-INV'),
        'payment_reference', NULL,
        'source', 'client_claim'
      ),
      jsonb_build_array(jsonb_build_object(
        'invoice_id', v_allocation_invoice_id,
        'amount', '100.00', 'discount_amount', '0.00'
      )),
      repeat('a', 64)
    );
    RAISE EXCEPTION 'Client-authored automatic allocation evidence was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'BR-AUTO-ALLOC-EVIDENCE:%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.automation_allocate_receipt(
      v_company_id, v_actor_id, v_receipt_command_id,
      v_allocation_receipt_id, 'exact_amount_single_invoice',
      jsonb_build_object(
        'invoice_references', jsonb_build_array('GTE-ALLOC-SGD'),
        'payment_reference', NULL,
        'source', 'document_extraction_v1'
      ),
      jsonb_build_array(jsonb_build_object(
        'invoice_id', v_cross_currency_invoice_id,
        'amount', '100.00', 'discount_amount', '0.00'
      )),
      repeat('e', 64)
    );
    RAISE EXCEPTION 'Cross-currency automatic allocation was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'BR-AUTO-ALLOC-MISMATCH:%' THEN RAISE; END IF;
  END;

  v_result := public.automation_allocate_receipt(
    v_company_id, v_actor_id, v_receipt_command_id,
    v_allocation_receipt_id, 'exact_amount_single_invoice',
    jsonb_build_object(
      'invoice_references', jsonb_build_array('GTE-ALLOC-INV'),
      'payment_reference', NULL,
      'source', 'document_extraction_v1'
    ),
    jsonb_build_array(jsonb_build_object(
      'invoice_id', v_allocation_invoice_id,
      'amount', '100.00', 'discount_amount', '0.00'
    )),
    repeat('f', 64)
  );
  IF (v_result ->> 'allocated_count')::INTEGER <> 1
    OR (
      SELECT count(*) FROM public.allocation_details
      WHERE receipt_id = v_allocation_receipt_id
        AND invoice_id = v_allocation_invoice_id
        AND allocation_method = 'Auto_Amount'
        AND status = 'Active'
    ) <> 1
    OR (
      SELECT count(*) FROM public.automation_allocation_decisions
      WHERE command_id = v_receipt_command_id
        AND idempotency_key = repeat('f', 64)
        AND status = 'completed'
    ) <> 1
    OR (
      SELECT outstanding FROM public.invoices
      WHERE id = v_allocation_invoice_id
    ) <> 0
    OR (
      SELECT unallocated_amount FROM public.receipts
      WHERE id = v_allocation_receipt_id
    ) <> 0 THEN
    RAISE EXCEPTION
      'DB-authoritative automatic allocation did not reconcile: result=%, details=%, decisions=%, outstanding=%, unallocated=%',
      v_result,
      (
        SELECT count(*) FROM public.allocation_details
        WHERE receipt_id = v_allocation_receipt_id
          AND invoice_id = v_allocation_invoice_id
          AND allocation_method = 'Auto_Amount'
          AND status = 'Active'
      ),
      (
        SELECT count(*) FROM public.automation_allocation_decisions
        WHERE command_id = v_receipt_command_id
          AND idempotency_key = repeat('f', 64)
          AND status = 'completed'
      ),
      (
        SELECT outstanding FROM public.invoices
        WHERE id = v_allocation_invoice_id
      ),
      (
        SELECT unallocated_amount FROM public.receipts
        WHERE id = v_allocation_receipt_id
      );
  END IF;

  UPDATE public.automation_source_attachments
  SET processing_status = 'processed'
  WHERE id IN (v_invoice_attachment_id, v_receipt_attachment_id);
  INSERT INTO public.automation_exceptions (
    company_id, mailbox_id, sync_run_id, message_id, reason_code,
    lifecycle_status, safe_details, actor_user_id
  ) VALUES (
    v_company_id, v_mailbox_id, v_sync_run_id, v_message_id,
    'internal_processing_failure', 'open',
    jsonb_build_object('error_code', 'FIXTURE_FAILURE'), v_actor_id
  );
  IF NOT EXISTS (
    SELECT 1
    FROM public.mailbox_sync_runs
    WHERE id = v_sync_run_id
      AND attachments_processed = 2
      AND commands_processed = 1
      AND allocations_completed = 1
      AND failures = 1
  ) THEN
    RAISE EXCEPTION 'Sync-run measured counter attribution did not reconcile';
  END IF;

  v_result := public.automation_allocate_receipt(
    v_company_id, v_actor_id, v_receipt_command_id,
    v_allocation_receipt_id, 'exact_amount_single_invoice',
    jsonb_build_object(
      'invoice_references', jsonb_build_array('GTE-ALLOC-INV'),
      'payment_reference', NULL,
      'source', 'document_extraction_v1'
    ),
    jsonb_build_array(jsonb_build_object(
      'invoice_id', v_allocation_invoice_id,
      'amount', '100.00', 'discount_amount', '0.00'
    )),
    repeat('f', 64)
  );
  IF (v_result ->> 'allocated_count')::INTEGER <> 1
    OR (
      SELECT count(*) FROM public.allocation_details
      WHERE receipt_id = v_allocation_receipt_id
        AND invoice_id = v_allocation_invoice_id
    ) <> 1 THEN
    RAISE EXCEPTION 'Automatic allocation idempotency replay duplicated data';
  END IF;

  UPDATE public.automation_settings
  SET operating_mode = 'observe_only',
      automation_actor_user_id = v_actor_id,
      reminder_evaluation_enabled = true
  WHERE company_id = v_company_id;
  BEGIN
    UPDATE public.automation_settings
    SET reminder_delivery_enabled = true
    WHERE company_id = v_company_id;
    RAISE EXCEPTION 'Observe-only mode allowed real reminder delivery';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.invoices (
    id, company_id, invoice_no, doc_type, invoice_date, due_date,
    customer_id, customer_name, currency, exchange_rate, base_currency,
    subtotal, tax_total, total_amount, base_total, outstanding, status,
    posted_by, posted_at
  ) VALUES (
    v_invoice_id, v_company_id,
    'GTE-' || left(replace(v_invoice_id::TEXT, '-', ''), 12),
    'Invoice', DATE '2026-07-01', DATE '2026-07-31',
    v_customer_id, 'Gate E Rollback Customer', 'MYR', 1, 'MYR',
    100, 0, 100, 100, 100, 'Open', v_actor_id, now()
  );
  v_result := public.automation_evaluate_invoice_reminders(
    v_company_id, DATE '2026-07-28', v_actor_id
  );
  IF (v_result ->> 'created')::INTEGER <> 1
    OR (
      SELECT count(*)
      FROM public.invoice_reminders
      WHERE company_id = v_company_id
        AND invoice_id = v_invoice_id
        AND stage_offset_days = -3
        AND recipient_email_snapshot = 'second.sales@example.test'
        AND outstanding_snapshot = 100
        AND currency_snapshot = 'MYR'
    ) <> 1 THEN
    RAISE EXCEPTION 'T-3 reminder evaluation/snapshot contract failed';
  END IF;
  v_result := public.automation_evaluate_invoice_reminders(
    v_company_id, DATE '2026-07-28', v_actor_id
  );
  IF (v_result ->> 'created')::INTEGER <> 0 THEN
    RAISE EXCEPTION 'Reminder evaluation was not idempotent';
  END IF;
  UPDATE public.automation_settings
  SET operating_mode = 'disabled',
      automation_actor_user_id = NULL,
      document_intelligence_enabled = false,
      invoice_automation_enabled = false,
      receipt_automation_enabled = false,
      auto_allocation_enabled = false,
      reminder_evaluation_enabled = false
  WHERE company_id = v_company_id;
END
$$;

-- Default posture is fail closed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.automation_settings
    WHERE operating_mode = 'straight_through'
      OR mailbox_sync_enabled
      OR document_intelligence_enabled
      OR invoice_automation_enabled
      OR receipt_automation_enabled
      OR auto_allocation_enabled
      OR reminder_evaluation_enabled
      OR reminder_delivery_enabled
  ) THEN
    RAISE EXCEPTION 'Gate E migration activated automation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.automation_mailboxes WHERE is_enabled OR delivery_enabled
  ) THEN
    RAISE EXCEPTION 'Gate E migration activated a mailbox';
  END IF;
END
$$;

ROLLBACK;
