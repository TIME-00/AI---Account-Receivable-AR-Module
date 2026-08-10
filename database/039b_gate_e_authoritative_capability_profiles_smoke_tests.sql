-- ROLLBACK-ONLY Gate E capability-profile security smoke.
BEGIN;

DO $$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef('public.automation_apply_settings_profile()'::regprocedure)
  INTO v_definition;
  IF v_definition NOT LIKE '%SECURITY INVOKER%'
    OR NOT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE oid = 'public.automation_apply_settings_profile()'::regprocedure
        AND proconfig = ARRAY['search_path=""']::TEXT[]
    )
    OR has_function_privilege('anon', 'public.automation_apply_settings_profile()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.automation_apply_settings_profile()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.automation_apply_settings_profile()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY: capability profile helper privilege drift';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.automation_settings'::regclass
      AND tgname = 'trg_automation_settings_profile'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'CONFIG: capability profile trigger missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.automation_settings
    WHERE (operating_mode = 'disabled' AND (
      mailbox_sync_enabled OR document_intelligence_enabled OR
      invoice_automation_enabled OR receipt_automation_enabled OR
      auto_allocation_enabled))
      OR (operating_mode = 'observe_only' AND (
        NOT mailbox_sync_enabled OR NOT document_intelligence_enabled OR
        invoice_automation_enabled OR receipt_automation_enabled OR
        auto_allocation_enabled))
      OR (operating_mode = 'draft_only' AND (
        NOT mailbox_sync_enabled OR NOT document_intelligence_enabled OR
        NOT invoice_automation_enabled OR NOT receipt_automation_enabled OR
        auto_allocation_enabled))
      OR (operating_mode = 'straight_through' AND (
        NOT mailbox_sync_enabled OR NOT document_intelligence_enabled OR
        NOT invoice_automation_enabled OR NOT receipt_automation_enabled OR
        NOT auto_allocation_enabled))
  ) THEN
    RAISE EXCEPTION 'CONFIG: contradictory document capability profile';
  END IF;
END;
$$;

ROLLBACK;
