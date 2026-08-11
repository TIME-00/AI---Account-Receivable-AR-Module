-- Post-Gate-E: governed one-action mailbox Delivery onboarding.
-- This migration records the server-side OAuth intent, separates Delivery
-- reconnect health from ingestion health, and atomically persists a validated
-- Delivery token and enables Delivery. It does not change automation settings,
-- mailbox ingestion, cursors, reminder records, or financial data.

BEGIN;

ALTER TABLE public.automation_mailboxes
  ADD COLUMN delivery_reconnect_required BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.automation_oauth_states
  ADD COLUMN oauth_intent TEXT NOT NULL DEFAULT 'connect_capability',
  ADD COLUMN completed_at TIMESTAMPTZ NULL,
  ADD CONSTRAINT chk_automation_oauth_intent CHECK (
    oauth_intent IN (
      'connect_capability', 'enable_delivery', 'reconnect_delivery'
    )
  ),
  ADD CONSTRAINT chk_automation_oauth_completion CHECK (
    completed_at IS NULL OR (
      consumed_at IS NOT NULL
      AND completed_at >= consumed_at
    )
  );

ALTER TABLE public.automation_mailboxes
  DROP CONSTRAINT chk_automation_mailbox_capability_ready,
  ADD CONSTRAINT chk_automation_mailbox_capability_ready CHECK (
    (NOT ingestion_enabled OR (
      connection_status = 'connected'
      AND ingestion_secret_ref IS NOT NULL
      AND ingestion_token_expires_at IS NOT NULL
      AND NOT reconnect_required
    ))
    AND (NOT delivery_enabled OR (
      delivery_secret_ref IS NOT NULL
      AND delivery_token_expires_at IS NOT NULL
      AND NOT delivery_reconnect_required
    ))
  );

CREATE OR REPLACE FUNCTION public.automation_apply_settings_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.mailbox_sync_enabled := NEW.operating_mode <> 'disabled';
  NEW.document_intelligence_enabled := NEW.operating_mode <> 'disabled';
  NEW.invoice_automation_enabled :=
    NEW.operating_mode IN ('draft_only', 'straight_through');
  NEW.receipt_automation_enabled :=
    NEW.operating_mode IN ('draft_only', 'straight_through');
  NEW.auto_allocation_enabled := NEW.operating_mode = 'straight_through';

  NEW.reminder_evaluation_enabled := NEW.reminder_mode <> 'off';
  NEW.reminder_delivery_enabled :=
    NEW.reminder_mode = 'automatic_delivery';

  IF NEW.reminder_mode = 'automatic_delivery' AND NOT EXISTS (
    SELECT 1
    FROM public.automation_mailboxes AS mailbox
    WHERE mailbox.company_id = NEW.company_id
      AND mailbox.delivery_enabled
      AND NOT mailbox.delivery_reconnect_required
      AND mailbox.delivery_secret_ref IS NOT NULL
      AND mailbox.delivery_token_expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-AUTO-DELIVERY-NOT-READY: Reminder delivery provider is not ready.';
  END IF;

  IF NEW.operating_mode <> 'disabled' OR NEW.reminder_mode <> 'off' THEN
    IF NEW.automation_actor_user_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'AUTH: Active automation requires an authorized actor.';
    END IF;
  ELSE
    NEW.automation_actor_user_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.automation_apply_settings_profile()
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.automation_apply_settings_profile() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.automation_oauth_delivery_finalize(
  p_state_id UUID,
  p_company_id UUID,
  p_mailbox_id UUID,
  p_provider_type TEXT,
  p_actor_user_id UUID,
  p_oauth_intent TEXT,
  p_secret_reference TEXT,
  p_secret_payload TEXT,
  p_token_expires_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state RECORD;
  v_mailbox RECORD;
  v_secret_id UUID;
  v_existing_description TEXT;
  v_description TEXT;
BEGIN
  PERFORM public.rpc_check_role(
    p_actor_user_id,
    p_company_id,
    ARRAY['Finance Manager', 'System Admin']
  );
  IF p_provider_type NOT IN ('gmail', 'microsoft')
    OR p_oauth_intent NOT IN ('enable_delivery', 'reconnect_delivery')
    OR p_secret_reference !~ '^[A-Z][A-Z0-9_]{2,127}$'
    OR p_secret_payload IS NULL
    OR pg_catalog.octet_length(p_secret_payload) < 16
    OR pg_catalog.octet_length(p_secret_payload) > 65536
    OR p_token_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'OAUTH_DELIVERY_FINALIZE_INVALID';
  END IF;

  SELECT state.* INTO v_state
  FROM public.automation_oauth_states AS state
  WHERE state.id = p_state_id
    AND state.company_id = p_company_id
    AND state.mailbox_id = p_mailbox_id
    AND state.provider_type = p_provider_type
    AND state.created_by = p_actor_user_id
    AND state.oauth_intent = p_oauth_intent
  FOR UPDATE;
  IF NOT FOUND
    OR v_state.consumed_at IS NULL
    OR v_state.completed_at IS NOT NULL
    OR v_state.consumed_at > v_state.expires_at
    OR NOT (
      (p_provider_type = 'gmail'
        AND pg_catalog.cardinality(v_state.requested_scopes) = 1
        AND v_state.requested_scopes @>
          ARRAY['https://www.googleapis.com/auth/gmail.send']::TEXT[])
      OR
      (p_provider_type = 'microsoft'
        AND pg_catalog.cardinality(v_state.requested_scopes) = 2
        AND v_state.requested_scopes @>
          ARRAY['offline_access', 'Mail.Send']::TEXT[])
    ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'OAUTH_DELIVERY_STATE_INVALID';
  END IF;

  SELECT mailbox.* INTO v_mailbox
  FROM public.automation_mailboxes AS mailbox
  WHERE mailbox.id = p_mailbox_id
    AND mailbox.company_id = p_company_id
    AND mailbox.provider_type = p_provider_type
    AND mailbox.delivery_secret_ref = p_secret_reference
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'OAUTH_SECRET_CONTEXT_INVALID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gate-e-oauth:' || p_secret_reference, 0)
  );
  v_description := 'Gate E OAuth ' || p_provider_type ||
    ' delivery token for mailbox ' || p_mailbox_id::TEXT;
  SELECT secret.id, secret.description
    INTO v_secret_id, v_existing_description
  FROM vault.secrets AS secret
  WHERE secret.name = p_secret_reference;
  IF v_secret_id IS NOT NULL
    AND v_existing_description IS DISTINCT FROM v_description THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'OAUTH_SECRET_CONTEXT_INVALID';
  END IF;
  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(
      p_secret_payload, p_secret_reference, v_description
    );
  ELSE
    PERFORM vault.update_secret(
      v_secret_id, p_secret_payload, p_secret_reference, v_description
    );
  END IF;

  UPDATE public.automation_mailboxes
  SET delivery_enabled = true,
      delivery_reconnect_required = false,
      delivery_token_expires_at = p_token_expires_at,
      redacted_error_code = CASE
        WHEN reconnect_required THEN redacted_error_code
        ELSE NULL
      END,
      updated_by = p_actor_user_id,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_mailbox_id AND company_id = p_company_id;

  UPDATE public.automation_oauth_states
  SET completed_at = pg_catalog.clock_timestamp()
  WHERE id = p_state_id AND completed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'OAUTH_DELIVERY_STATE_ALREADY_COMPLETED';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.automation_oauth_delivery_finalize(
  UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_oauth_delivery_finalize(
  UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;
ALTER FUNCTION public.automation_oauth_delivery_finalize(
  UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ
) OWNER TO postgres;

COMMENT ON FUNCTION public.automation_oauth_delivery_finalize(
  UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ
) IS 'Atomically persists a validated Delivery OAuth token and enables Delivery for a single-use, actor-bound server OAuth intent.';

COMMIT;
