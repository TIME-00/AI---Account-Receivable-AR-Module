-- Gate E secure OAuth Vault rollback smoke. Never execute in Production.
BEGIN;

DO $$
DECLARE
  v_signature TEXT;
  v_function RECORD;
BEGIN
  IF to_regclass('vault.secrets') IS NULL
    OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'Supabase Vault is unavailable';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'automation_oauth_secret_write(uuid,uuid,text,text,text,text)',
    'automation_oauth_secret_resolve(uuid,uuid,text,text,text)',
    'automation_oauth_secret_delete(uuid,uuid,text,text,text)'
  ]
  LOOP
    IF to_regprocedure('public.' || v_signature) IS NULL
      OR has_function_privilege('anon', 'public.' || v_signature, 'EXECUTE')
      OR has_function_privilege(
        'authenticated', 'public.' || v_signature, 'EXECUTE'
      )
      OR NOT has_function_privilege(
        'service_role', 'public.' || v_signature, 'EXECUTE'
      ) THEN
      RAISE EXCEPTION 'Unsafe OAuth Vault RPC grant: %', v_signature;
    END IF;
    SELECT p.prosecdef, p.proconfig, owner_role.rolname AS owner_name
      INTO v_function
    FROM pg_proc AS p
    JOIN pg_roles AS owner_role ON owner_role.oid = p.proowner
    WHERE p.oid = to_regprocedure('public.' || v_signature);
    IF NOT v_function.prosecdef
      OR v_function.owner_name <> 'postgres'
      OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
      OR EXISTS (
        SELECT 1
        FROM pg_proc AS p
        CROSS JOIN LATERAL aclexplode(
          COALESCE(p.proacl, acldefault('f', p.proowner))
        ) AS privilege
        WHERE p.oid = to_regprocedure('public.' || v_signature)
          AND privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      ) THEN
      RAISE EXCEPTION 'Unsafe OAuth Vault RPC catalog contract: %', v_signature;
    END IF;
  END LOOP;

  IF to_regprocedure(
    'public.automation_guard_oauth_secret_references()'
  ) IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.automation_mailboxes'::regclass
      AND tgname = 'trg_automation_mailbox_oauth_secret_references'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'OAuth secret-reference guard is missing';
  END IF;
END
$$;

DO $$
DECLARE
  v_company_id UUID;
  v_mailbox_id UUID := gen_random_uuid();
  v_other_mailbox_id UUID := gen_random_uuid();
  v_wrong_company_id UUID := gen_random_uuid();
  v_reference TEXT := 'GATE_E_VAULT_SMOKE_035';
  v_collision_reference TEXT := 'GATE_E_VAULT_COLLISION_035';
  v_initial TEXT :=
    '{"schema_version":"gate-e-oauth.1","tokens":{"access_token":"fixture-access-one","refresh_token":"fixture-refresh-one","expires_at":"2026-08-08T00:00:00.000Z","scope":["https://www.googleapis.com/auth/gmail.readonly"],"token_type":"Bearer"}}';
  v_rotated TEXT :=
    '{"schema_version":"gate-e-oauth.1","tokens":{"access_token":"fixture-access-two","refresh_token":"fixture-refresh-two","expires_at":"2026-08-08T01:00:00.000Z","scope":["https://www.googleapis.com/auth/gmail.readonly"],"token_type":"Bearer"}}';
  v_resolved TEXT;
BEGIN
  SELECT id INTO v_company_id
  FROM public.companies
  ORDER BY id
  LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Gate E Vault smoke requires one local company fixture';
  END IF;

  INSERT INTO public.automation_mailboxes (
    id, company_id, provider_type, mailbox_address, ingestion_secret_ref
  ) VALUES (
    v_mailbox_id, v_company_id, 'gmail',
    'gate-e-vault-smoke@example.test', v_reference
  );

  PERFORM vault.create_secret(
    'unrelated-fixture-secret',
    v_collision_reference,
    'Unrelated local smoke secret'
  );
  INSERT INTO public.automation_mailboxes (
    id, company_id, provider_type, mailbox_address, delivery_secret_ref
  ) VALUES (
    v_other_mailbox_id, v_company_id, 'gmail',
    'gate-e-vault-collision@example.test', v_collision_reference
  );
  BEGIN
    PERFORM public.automation_oauth_secret_write(
      v_company_id, v_other_mailbox_id, 'gmail', 'delivery',
      v_collision_reference, v_initial
    );
    RAISE EXCEPTION 'Unrelated Vault secret collision was overwritten';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'OAUTH_SECRET_CONTEXT_INVALID' THEN RAISE; END IF;
  END;
  IF (
    SELECT decrypted_secret
    FROM vault.decrypted_secrets
    WHERE name = v_collision_reference
  ) IS DISTINCT FROM 'unrelated-fixture-secret' THEN
    RAISE EXCEPTION 'Unrelated Vault secret collision was mutated';
  END IF;

  PERFORM public.automation_oauth_secret_write(
    v_company_id, v_mailbox_id, 'gmail', 'ingestion', v_reference, v_initial
  );
  v_resolved := public.automation_oauth_secret_resolve(
    v_company_id, v_mailbox_id, 'gmail', 'ingestion', v_reference
  );
  IF v_resolved IS DISTINCT FROM v_initial THEN
    RAISE EXCEPTION 'Initial Vault OAuth credential did not resolve exactly';
  END IF;

  PERFORM public.automation_oauth_secret_write(
    v_company_id, v_mailbox_id, 'gmail', 'ingestion', v_reference, v_rotated
  );
  v_resolved := public.automation_oauth_secret_resolve(
    v_company_id, v_mailbox_id, 'gmail', 'ingestion', v_reference
  );
  IF v_resolved IS DISTINCT FROM v_rotated THEN
    RAISE EXCEPTION 'Rotated Vault OAuth credential did not replace exactly';
  END IF;

  BEGIN
    PERFORM public.automation_oauth_secret_resolve(
      v_wrong_company_id, v_mailbox_id, 'gmail', 'ingestion', v_reference
    );
    RAISE EXCEPTION 'Cross-tenant OAuth credential resolution was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'OAUTH_SECRET_CONTEXT_INVALID' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.automation_mailboxes (
      id, company_id, provider_type, mailbox_address, delivery_secret_ref
    ) VALUES (
      gen_random_uuid(), v_company_id, 'gmail',
      'gate-e-vault-smoke-two@example.test', v_reference
    );
    RAISE EXCEPTION 'Duplicate cross-capability secret reference was accepted';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'OAUTH_SECRET_REFERENCE_CONFLICT:%' THEN RAISE; END IF;
  END;

  IF EXISTS (
    SELECT 1
    FROM public.automation_mailboxes AS mailbox
    WHERE mailbox.id = v_mailbox_id
      AND pg_catalog.to_jsonb(mailbox)::TEXT LIKE '%fixture-access%'
  ) THEN
    RAISE EXCEPTION 'OAuth token leaked into application mailbox metadata';
  END IF;

  PERFORM public.automation_oauth_secret_delete(
    v_company_id, v_mailbox_id, 'gmail', 'ingestion', v_reference
  );
  IF public.automation_oauth_secret_resolve(
    v_company_id, v_mailbox_id, 'gmail', 'ingestion', v_reference
  ) IS NOT NULL OR EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = v_reference
  ) THEN
    RAISE EXCEPTION 'OAuth Vault credential was not revoked';
  END IF;
END
$$;

ROLLBACK;
