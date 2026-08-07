-- Gate E activation prerequisite: tenant-bound OAuth token persistence in
-- Supabase Vault. This migration installs no provider credential, mailbox,
-- scheduler, automation setting, or financial/business data.
BEGIN;

DO $$
BEGIN
  IF to_regclass('vault.secrets') IS NULL
    OR to_regclass('vault.decrypted_secrets') IS NULL
    OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
    OR to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') IS NULL THEN
    RAISE EXCEPTION
      'GATE_E_SECURE_SECRET_BACKEND_UNAVAILABLE: Supabase Vault is required';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT reference
    FROM (
      SELECT id, ingestion_secret_ref AS reference
      FROM public.automation_mailboxes
      WHERE ingestion_secret_ref IS NOT NULL
      UNION ALL
      SELECT id, delivery_secret_ref AS reference
      FROM public.automation_mailboxes
      WHERE delivery_secret_ref IS NOT NULL
    ) AS assigned
    GROUP BY reference
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'OAUTH_SECRET_REFERENCE_CONFLICT: existing references are not globally unique';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.automation_guard_oauth_secret_references()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_first TEXT;
  v_second TEXT;
BEGIN
  IF NEW.ingestion_secret_ref IS NOT NULL
    AND NEW.ingestion_secret_ref = NEW.delivery_secret_ref THEN
    RAISE EXCEPTION
      'OAUTH_SECRET_REFERENCE_CONFLICT: ingestion and delivery references must differ';
  END IF;

  v_first := LEAST(NEW.ingestion_secret_ref, NEW.delivery_secret_ref);
  v_second := GREATEST(NEW.ingestion_secret_ref, NEW.delivery_secret_ref);
  IF v_first IS NULL THEN
    v_first := COALESCE(NEW.ingestion_secret_ref, NEW.delivery_secret_ref);
  END IF;
  IF v_first IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('gate-e-oauth:' || v_first, 0)
    );
  END IF;
  IF v_second IS NOT NULL AND v_second <> v_first THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('gate-e-oauth:' || v_second, 0)
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.automation_mailboxes AS mailbox
    WHERE mailbox.id <> NEW.id
      AND (
        mailbox.ingestion_secret_ref IN (
          NEW.ingestion_secret_ref,
          NEW.delivery_secret_ref
        )
        OR mailbox.delivery_secret_ref IN (
          NEW.ingestion_secret_ref,
          NEW.delivery_secret_ref
        )
      )
  ) THEN
    RAISE EXCEPTION
      'OAUTH_SECRET_REFERENCE_CONFLICT: reference is already assigned';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_automation_mailbox_oauth_secret_references
  BEFORE INSERT OR UPDATE OF ingestion_secret_ref, delivery_secret_ref
  ON public.automation_mailboxes
  FOR EACH ROW EXECUTE FUNCTION public.automation_guard_oauth_secret_references();

CREATE UNIQUE INDEX uq_automation_mailbox_ingestion_secret_ref
  ON public.automation_mailboxes(ingestion_secret_ref)
  WHERE ingestion_secret_ref IS NOT NULL;

CREATE UNIQUE INDEX uq_automation_mailbox_delivery_secret_ref
  ON public.automation_mailboxes(delivery_secret_ref)
  WHERE delivery_secret_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.automation_oauth_secret_write(
  p_company_id UUID,
  p_mailbox_id UUID,
  p_provider_type TEXT,
  p_capability TEXT,
  p_secret_reference TEXT,
  p_secret_payload TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_id UUID;
  v_existing_description TEXT;
  v_description TEXT;
BEGIN
  IF p_provider_type NOT IN ('gmail', 'microsoft')
    OR p_capability NOT IN ('ingestion', 'delivery')
    OR p_secret_reference !~ '^[A-Z][A-Z0-9_]{2,127}$'
    OR p_secret_payload IS NULL
    OR pg_catalog.octet_length(p_secret_payload) < 16
    OR pg_catalog.octet_length(p_secret_payload) > 65536 THEN
    RAISE EXCEPTION 'OAUTH_SECRET_CONTEXT_INVALID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gate-e-oauth:' || p_secret_reference, 0)
  );
  IF NOT EXISTS (
    SELECT 1
    FROM public.automation_mailboxes AS mailbox
    WHERE mailbox.id = p_mailbox_id
      AND mailbox.company_id = p_company_id
      AND mailbox.provider_type = p_provider_type
      AND CASE p_capability
        WHEN 'ingestion' THEN mailbox.ingestion_secret_ref = p_secret_reference
        ELSE mailbox.delivery_secret_ref = p_secret_reference
      END
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'OAUTH_SECRET_CONTEXT_INVALID';
  END IF;

  v_description := 'Gate E OAuth ' || p_provider_type || ' ' || p_capability ||
    ' token for mailbox ' || p_mailbox_id::TEXT;
  SELECT secret.id, secret.description
    INTO v_secret_id, v_existing_description
  FROM vault.secrets AS secret
  WHERE secret.name = p_secret_reference;

  IF v_secret_id IS NOT NULL
    AND v_existing_description IS DISTINCT FROM v_description THEN
    RAISE EXCEPTION 'OAUTH_SECRET_CONTEXT_INVALID';
  END IF;
  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(
      p_secret_payload,
      p_secret_reference,
      v_description
    );
  ELSE
    PERFORM vault.update_secret(
      v_secret_id,
      p_secret_payload,
      p_secret_reference,
      v_description
    );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.automation_oauth_secret_resolve(
  p_company_id UUID,
  p_mailbox_id UUID,
  p_provider_type TEXT,
  p_capability TEXT,
  p_secret_reference TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_secret TEXT;
  v_description TEXT;
BEGIN
  IF p_provider_type NOT IN ('gmail', 'microsoft')
    OR p_capability NOT IN ('ingestion', 'delivery')
    OR p_secret_reference !~ '^[A-Z][A-Z0-9_]{2,127}$' THEN
    RAISE EXCEPTION 'OAUTH_SECRET_CONTEXT_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.automation_mailboxes AS mailbox
    WHERE mailbox.id = p_mailbox_id
      AND mailbox.company_id = p_company_id
      AND mailbox.provider_type = p_provider_type
      AND CASE p_capability
        WHEN 'ingestion' THEN mailbox.ingestion_secret_ref = p_secret_reference
        ELSE mailbox.delivery_secret_ref = p_secret_reference
      END
  ) THEN
    RAISE EXCEPTION 'OAUTH_SECRET_CONTEXT_INVALID';
  END IF;

  v_description := 'Gate E OAuth ' || p_provider_type || ' ' || p_capability ||
    ' token for mailbox ' || p_mailbox_id::TEXT;
  SELECT secret.decrypted_secret
    INTO v_secret
  FROM vault.decrypted_secrets AS secret
  WHERE secret.name = p_secret_reference
    AND secret.description = v_description;
  RETURN v_secret;
END
$$;

CREATE OR REPLACE FUNCTION public.automation_oauth_secret_delete(
  p_company_id UUID,
  p_mailbox_id UUID,
  p_provider_type TEXT,
  p_capability TEXT,
  p_secret_reference TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_description TEXT;
BEGIN
  IF p_provider_type NOT IN ('gmail', 'microsoft')
    OR p_capability NOT IN ('ingestion', 'delivery')
    OR p_secret_reference !~ '^[A-Z][A-Z0-9_]{2,127}$' THEN
    RAISE EXCEPTION 'OAUTH_SECRET_CONTEXT_INVALID';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gate-e-oauth:' || p_secret_reference, 0)
  );
  IF NOT EXISTS (
    SELECT 1
    FROM public.automation_mailboxes AS mailbox
    WHERE mailbox.id = p_mailbox_id
      AND mailbox.company_id = p_company_id
      AND mailbox.provider_type = p_provider_type
      AND CASE p_capability
        WHEN 'ingestion' THEN mailbox.ingestion_secret_ref = p_secret_reference
        ELSE mailbox.delivery_secret_ref = p_secret_reference
      END
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'OAUTH_SECRET_CONTEXT_INVALID';
  END IF;

  v_description := 'Gate E OAuth ' || p_provider_type || ' ' || p_capability ||
    ' token for mailbox ' || p_mailbox_id::TEXT;
  DELETE FROM vault.secrets AS secret
  WHERE secret.name = p_secret_reference
    AND secret.description = v_description;
END
$$;

REVOKE ALL ON FUNCTION public.automation_guard_oauth_secret_references()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.automation_oauth_secret_write(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_oauth_secret_resolve(
  UUID, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_oauth_secret_delete(
  UUID, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.automation_oauth_secret_write(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_oauth_secret_resolve(
  UUID, UUID, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_oauth_secret_delete(
  UUID, UUID, TEXT, TEXT, TEXT
) TO service_role;

REVOKE ALL ON TABLE vault.secrets FROM anon, authenticated;
REVOKE ALL ON TABLE vault.decrypted_secrets FROM anon, authenticated;

ALTER FUNCTION public.automation_guard_oauth_secret_references()
  OWNER TO postgres;
ALTER FUNCTION public.automation_oauth_secret_write(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.automation_oauth_secret_resolve(
  UUID, UUID, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.automation_oauth_secret_delete(
  UUID, UUID, TEXT, TEXT, TEXT
) OWNER TO postgres;

COMMENT ON FUNCTION public.automation_oauth_secret_write(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT
) IS 'Service-role-only Gate E OAuth token rotation boundary backed by Supabase Vault.';
COMMENT ON FUNCTION public.automation_oauth_secret_resolve(
  UUID, UUID, TEXT, TEXT, TEXT
) IS 'Service-role-only tenant/mailbox/capability-bound Gate E OAuth token resolver.';
COMMENT ON FUNCTION public.automation_oauth_secret_delete(
  UUID, UUID, TEXT, TEXT, TEXT
) IS 'Service-role-only Gate E OAuth local credential revocation boundary.';

COMMIT;
