-- Batch 9D-E1 B9DE-E1-005: exact Production user_roles RLS remediation.
--
-- Mode A only. The source-backed ur_select policy remains in place; this
-- operator removes only the tenant-unbound legacy policy when (and only when)
-- its complete catalog signature matches the reviewed Production baseline.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('batch_9d_e1_b9de_e1_005'),
  pg_catalog.hashtext('public.user_roles.Temp Allow All')
);

DO $operator$
DECLARE
  v_table_oid oid;
  v_target_count bigint;
  v_other_policy_before text;
  v_all_policy_before text;
  v_grant_before text;
  v_helper_before text;
  v_other_policy_after text;
  v_all_policy_after text;
  v_grant_after text;
  v_helper_after text;
  v_unconditional_select bigint;
  v_unconditional_write bigint;
BEGIN
  SELECT c.oid
  INTO v_table_oid
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'user_roles'
    AND c.relkind IN ('r', 'p');

  IF v_table_oid IS NULL THEN
    RAISE EXCEPTION 'B9DE-E1-005 drift: public.user_roles is absent';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    WHERE c.oid = v_table_oid
      AND c.relrowsecurity
      AND NOT c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'B9DE-E1-005 drift: expected enabled, non-forced RLS';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
    'authenticated', v_table_oid, 'SELECT'
  ) THEN
    RAISE EXCEPTION 'B9DE-E1-005 drift: authenticated SELECT grant absent';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy p
    WHERE p.polrelid = v_table_oid
      AND p.polname = 'ur_select'
      AND p.polcmd = 'r'
      AND p.polpermissive
      AND p.polroles = ARRAY[0::oid]
      AND pg_catalog.pg_get_expr(p.polqual, p.polrelid)
        = '((user_id = auth.uid()) OR rls_has_company_access(company_id))'
      AND p.polwithcheck IS NULL
  ) THEN
    RAISE EXCEPTION 'B9DE-E1-005 drift: source-backed ur_select is absent or changed';
  END IF;

  SELECT encode(extensions.digest(coalesce(string_agg(
    concat_ws('|', p.polname, p.polcmd, p.polpermissive::text,
      array_to_string(p.polroles, ','),
      coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), ''),
      coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')),
    E'\n' ORDER BY p.polname), ''), 'sha256'), 'hex')
  INTO v_other_policy_before
  FROM pg_catalog.pg_policy p
  WHERE p.polrelid = v_table_oid
    AND p.polname <> 'Temp Allow All';

  SELECT encode(extensions.digest(coalesce(string_agg(
    concat_ws('|', n.nspname, c.relname, p.polname, p.polcmd,
      p.polpermissive::text, array_to_string(p.polroles, ','),
      coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), ''),
      coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')),
    E'\n' ORDER BY n.nspname, c.relname, p.polname), ''), 'sha256'), 'hex')
  INTO v_all_policy_before
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND NOT (
      p.polrelid = v_table_oid
      AND p.polname = 'Temp Allow All'
    );

  SELECT encode(extensions.digest(coalesce(string_agg(
    concat_ws('|', grantee, privilege_type, is_grantable),
    E'\n' ORDER BY grantee, privilege_type), ''), 'sha256'), 'hex')
  INTO v_grant_before
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'user_roles';

  SELECT encode(extensions.digest(coalesce(string_agg(
    concat_ws('|', p.oid::text, p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid),
      pg_catalog.pg_get_functiondef(p.oid)),
    E'\n' ORDER BY p.proname, p.oid), ''), 'sha256'), 'hex')
  INTO v_helper_before
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'rls_has_company_access',
      'rls_has_config_write_access',
      'rls_has_operational_read_access'
    );

  SELECT count(*)
  INTO v_target_count
  FROM pg_catalog.pg_policy p
  WHERE p.polrelid = v_table_oid
    AND p.polname = 'Temp Allow All';

  IF v_target_count = 1 THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_roles r ON r.oid = ANY (p.polroles)
      WHERE p.polrelid = v_table_oid
        AND p.polname = 'Temp Allow All'
        AND p.polcmd = 'r'
        AND p.polpermissive
        AND p.polroles = ARRAY[r.oid]
        AND r.rolname = 'authenticated'
        AND lower(regexp_replace(
          pg_catalog.pg_get_expr(p.polqual, p.polrelid),
          '[()[:space:]]', '', 'g'
        )) = 'true'
        AND p.polwithcheck IS NULL
    ) THEN
      RAISE EXCEPTION 'B9DE-E1-005 drift: legacy policy signature mismatch';
    END IF;

    EXECUTE 'DROP POLICY "Temp Allow All" ON public.user_roles';
  ELSIF v_target_count <> 0 THEN
    RAISE EXCEPTION 'B9DE-E1-005 drift: duplicate legacy policy name';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
    WHERE p.polrelid = v_table_oid
      AND p.polname = 'Temp Allow All'
  ) THEN
    RAISE EXCEPTION 'B9DE-E1-005 postcondition: legacy policy remains';
  END IF;

  SELECT count(*) FILTER (WHERE p.polcmd IN ('r', '*')),
         count(*) FILTER (WHERE p.polcmd IN ('a', 'w', 'd', '*'))
  INTO v_unconditional_select, v_unconditional_write
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND EXISTS (
      SELECT 1
      FROM unnest(p.polroles) AS role_oid
      WHERE role_oid = 0
         OR role_oid IN (
           SELECT oid FROM pg_catalog.pg_roles
           WHERE rolname IN ('anon', 'authenticated')
         )
    )
    AND (
      lower(regexp_replace(coalesce(
        pg_catalog.pg_get_expr(p.polqual, p.polrelid), ''
      ), '[()[:space:]]', '', 'g')) = 'true'
      OR lower(regexp_replace(coalesce(
        pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), ''
      ), '[()[:space:]]', '', 'g')) = 'true'
    );

  IF v_unconditional_select <> 0 OR v_unconditional_write <> 0 THEN
    RAISE EXCEPTION
      'B9DE-E1-005 postcondition: exposed unconditional policies remain (% SELECT, % write)',
      v_unconditional_select, v_unconditional_write;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy p
    WHERE p.polrelid = v_table_oid
      AND p.polname = 'ur_select'
      AND p.polcmd = 'r'
      AND p.polpermissive
      AND p.polroles = ARRAY[0::oid]
      AND pg_catalog.pg_get_expr(p.polqual, p.polrelid)
        = '((user_id = auth.uid()) OR rls_has_company_access(company_id))'
      AND p.polwithcheck IS NULL
  ) THEN
    RAISE EXCEPTION 'B9DE-E1-005 postcondition: ur_select changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = v_table_oid
      AND c.relrowsecurity
      AND NOT c.relforcerowsecurity
  ) OR NOT pg_catalog.has_table_privilege(
    'authenticated', v_table_oid, 'SELECT'
  ) THEN
    RAISE EXCEPTION 'B9DE-E1-005 postcondition: RLS or SELECT grant changed';
  END IF;

  SELECT encode(extensions.digest(coalesce(string_agg(
    concat_ws('|', p.polname, p.polcmd, p.polpermissive::text,
      array_to_string(p.polroles, ','),
      coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), ''),
      coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')),
    E'\n' ORDER BY p.polname), ''), 'sha256'), 'hex')
  INTO v_other_policy_after
  FROM pg_catalog.pg_policy p
  WHERE p.polrelid = v_table_oid;

  SELECT encode(extensions.digest(coalesce(string_agg(
    concat_ws('|', n.nspname, c.relname, p.polname, p.polcmd,
      p.polpermissive::text, array_to_string(p.polroles, ','),
      coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), ''),
      coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')),
    E'\n' ORDER BY n.nspname, c.relname, p.polname), ''), 'sha256'), 'hex')
  INTO v_all_policy_after
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public';

  SELECT encode(extensions.digest(coalesce(string_agg(
    concat_ws('|', grantee, privilege_type, is_grantable),
    E'\n' ORDER BY grantee, privilege_type), ''), 'sha256'), 'hex')
  INTO v_grant_after
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'user_roles';

  SELECT encode(extensions.digest(coalesce(string_agg(
    concat_ws('|', p.oid::text, p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid),
      pg_catalog.pg_get_functiondef(p.oid)),
    E'\n' ORDER BY p.proname, p.oid), ''), 'sha256'), 'hex')
  INTO v_helper_after
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'rls_has_company_access',
      'rls_has_config_write_access',
      'rls_has_operational_read_access'
    );

  IF v_other_policy_after IS DISTINCT FROM v_other_policy_before
    OR v_all_policy_after IS DISTINCT FROM v_all_policy_before
    OR v_grant_after IS DISTINCT FROM v_grant_before
    OR v_helper_after IS DISTINCT FROM v_helper_before
  THEN
    RAISE EXCEPTION 'B9DE-E1-005 postcondition: unrelated catalog drift';
  END IF;
END
$operator$;

COMMIT;
