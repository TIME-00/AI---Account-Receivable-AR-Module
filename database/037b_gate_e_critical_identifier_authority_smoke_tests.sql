-- Rollback-only catalog/security smoke for Migration 037.

BEGIN;

DO $$
DECLARE
  v_definition TEXT;
  v_rls_enabled BOOLEAN;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO v_definition
  FROM pg_constraint c
  WHERE c.conrelid = 'public.automation_exceptions'::regclass
    AND c.conname = 'chk_automation_exception_reason'
    AND c.contype = 'c';

  IF v_definition IS NULL
    OR position('critical_identifier_unverified' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Migration 037 critical-identifier reason is missing.';
  END IF;

  SELECT c.relrowsecurity
    INTO v_rls_enabled
  FROM pg_class c
  WHERE c.oid = 'public.automation_exceptions'::regclass;

  IF v_rls_enabled IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 037 changed the automation_exceptions RLS boundary.';
  END IF;

  IF has_table_privilege('anon', 'public.automation_exceptions', 'SELECT')
    OR has_table_privilege('anon', 'public.automation_exceptions', 'INSERT')
    OR has_table_privilege('authenticated', 'public.automation_exceptions', 'INSERT')
  THEN
    RAISE EXCEPTION 'Migration 037 broadened browser-role table privileges.';
  END IF;
END
$$;

ROLLBACK;
