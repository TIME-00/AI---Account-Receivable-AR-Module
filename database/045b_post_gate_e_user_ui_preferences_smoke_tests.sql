-- ROLLBACK-ONLY smoke for Migration 045. Never register as a migration.
BEGIN;

DO $smoke$
DECLARE
  v_user_a UUID := gen_random_uuid();
  v_user_b UUID := gen_random_uuid();
  v_before_invoices BIGINT;
  v_before_receipts BIGINT;
  v_before_journals BIGINT;
  v_before_settings BIGINT;
BEGIN
  SELECT count(*) INTO v_before_invoices FROM public.invoices;
  SELECT count(*) INTO v_before_receipts FROM public.receipts;
  SELECT count(*) INTO v_before_journals FROM public.journal_entries;
  SELECT count(*) INTO v_before_settings FROM public.automation_settings;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_ui_preferences'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'user_ui_preferences'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'UIPREF045_SMOKE: table or RLS missing';
  END IF;

  IF pg_catalog.has_table_privilege('anon', 'public.user_ui_preferences', 'SELECT')
    OR pg_catalog.has_table_privilege('anon', 'public.user_ui_preferences', 'INSERT')
    OR pg_catalog.has_table_privilege('anon', 'public.user_ui_preferences', 'UPDATE')
    OR pg_catalog.has_table_privilege('anon', 'public.user_ui_preferences', 'DELETE')
    OR pg_catalog.has_table_privilege('authenticated', 'public.user_ui_preferences', 'SELECT')
    OR pg_catalog.has_table_privilege('authenticated', 'public.user_ui_preferences', 'INSERT')
    OR pg_catalog.has_table_privilege('authenticated', 'public.user_ui_preferences', 'UPDATE')
    OR pg_catalog.has_table_privilege('authenticated', 'public.user_ui_preferences', 'DELETE')
    OR NOT pg_catalog.has_table_privilege('service_role', 'public.user_ui_preferences', 'SELECT')
    OR NOT pg_catalog.has_table_privilege('service_role', 'public.user_ui_preferences', 'INSERT')
    OR NOT pg_catalog.has_table_privilege('service_role', 'public.user_ui_preferences', 'UPDATE')
    OR pg_catalog.has_table_privilege('service_role', 'public.user_ui_preferences', 'DELETE') THEN
    RAISE EXCEPTION 'UIPREF045_SMOKE: table privilege boundary drift';
  END IF;

  INSERT INTO public.user_ui_preferences(user_id) VALUES (v_user_a);
  IF (SELECT theme_preference FROM public.user_ui_preferences WHERE user_id = v_user_a) <> 'dark' THEN
    RAISE EXCEPTION 'UIPREF045_SMOKE: first-save default is not dark';
  END IF;

  INSERT INTO public.user_ui_preferences(user_id, theme_preference)
  VALUES (v_user_b, 'light');
  INSERT INTO public.user_ui_preferences(user_id, theme_preference)
  VALUES (v_user_b, 'light')
  ON CONFLICT (user_id) DO UPDATE SET theme_preference = EXCLUDED.theme_preference;
  IF (SELECT count(*) FROM public.user_ui_preferences WHERE user_id = v_user_b) <> 1
    OR (SELECT theme_preference FROM public.user_ui_preferences WHERE user_id = v_user_b) <> 'light' THEN
    RAISE EXCEPTION 'UIPREF045_SMOKE: saved light or idempotent upsert failed';
  END IF;

  UPDATE public.user_ui_preferences SET theme_preference = 'dark' WHERE user_id = v_user_b;
  IF (SELECT theme_preference FROM public.user_ui_preferences WHERE user_id = v_user_a) <> 'dark'
    OR (SELECT theme_preference FROM public.user_ui_preferences WHERE user_id = v_user_b) <> 'dark' THEN
    RAISE EXCEPTION 'UIPREF045_SMOKE: account isolation failed';
  END IF;

  BEGIN
    UPDATE public.user_ui_preferences SET theme_preference = 'system' WHERE user_id = v_user_a;
    RAISE EXCEPTION 'UIPREF045_SMOKE: invalid preference was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  IF (SELECT count(*) FROM public.invoices) <> v_before_invoices
    OR (SELECT count(*) FROM public.receipts) <> v_before_receipts
    OR (SELECT count(*) FROM public.journal_entries) <> v_before_journals
    OR (SELECT count(*) FROM public.automation_settings) <> v_before_settings THEN
    RAISE EXCEPTION 'UIPREF045_SMOKE: unrelated financial/settings rows changed';
  END IF;
END;
$smoke$;

ROLLBACK;
