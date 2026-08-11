-- ROLLBACK-ONLY catalog/security smoke for Migration 042.
BEGIN;

DO $$
DECLARE
  v_definition TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'automation_oauth_states'
      AND column_name = 'oauth_intent'
      AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'automation_oauth_states'
      AND column_name = 'completed_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'automation_mailboxes'
      AND column_name = 'delivery_reconnect_required'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'MIGRATION_042_COLUMNS_MISSING';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(proc.oid) INTO v_definition
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS ns ON ns.oid = proc.pronamespace
  WHERE ns.nspname = 'public'
    AND proc.proname = 'automation_oauth_delivery_finalize'
    AND pg_catalog.pg_get_function_identity_arguments(proc.oid) =
      'p_state_id uuid, p_company_id uuid, p_mailbox_id uuid, p_provider_type text, p_actor_user_id uuid, p_oauth_intent text, p_secret_reference text, p_secret_payload text, p_token_expires_at timestamp with time zone';
  IF v_definition IS NULL
    OR v_definition NOT LIKE '%SECURITY DEFINER%'
    OR v_definition NOT LIKE '%SET search_path TO %''''%'
    OR v_definition NOT LIKE '%vault.create_secret%'
    OR v_definition NOT LIKE '%vault.update_secret%'
    OR v_definition NOT LIKE '%delivery_enabled = true%'
    OR v_definition NOT LIKE '%completed_at = pg_catalog.clock_timestamp()%'
    OR v_definition LIKE '%ingestion_secret_ref =%'
    OR v_definition LIKE '%incremental_cursor =%'
    OR v_definition LIKE '%history_id%' THEN
    RAISE EXCEPTION 'MIGRATION_042_FINALIZER_INVALID';
  END IF;

  IF pg_catalog.has_function_privilege(
      'anon',
      'public.automation_oauth_delivery_finalize(uuid,uuid,uuid,text,uuid,text,text,text,timestamptz)',
      'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'authenticated',
      'public.automation_oauth_delivery_finalize(uuid,uuid,uuid,text,uuid,text,text,text,timestamptz)',
      'EXECUTE'
    ) OR NOT pg_catalog.has_function_privilege(
      'service_role',
      'public.automation_oauth_delivery_finalize(uuid,uuid,uuid,text,uuid,text,text,text,timestamptz)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'MIGRATION_042_FINALIZER_PRIVILEGES_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc proc
    JOIN pg_catalog.pg_namespace ns ON ns.oid = proc.pronamespace
    JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = proc.proowner
    WHERE ns.nspname = 'public'
      AND proc.proname = 'automation_oauth_delivery_finalize'
      AND owner_role.rolname = 'postgres'
      AND proc.prosecdef
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(proc.proconfig) AS setting(value)
        WHERE setting.value IN ('search_path=', 'search_path=""')
      )
  ) THEN
    RAISE EXCEPTION 'MIGRATION_042_FINALIZER_CATALOG_INVALID';
  END IF;
END
$$;

ROLLBACK;
