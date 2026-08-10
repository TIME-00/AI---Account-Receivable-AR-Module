-- Gate E: backend-authoritative document and reminder capability profiles.
-- This migration preserves the current effective state. It does not activate
-- Straight-Through, Auto-Allocation, reminder evaluation, or delivery.

BEGIN;

ALTER TABLE public.automation_settings
  ADD COLUMN reminder_mode TEXT;

UPDATE public.automation_settings
SET reminder_mode = CASE
  WHEN reminder_delivery_enabled THEN 'automatic_delivery'
  WHEN reminder_evaluation_enabled THEN 'evaluate_only'
  ELSE 'off'
END;

ALTER TABLE public.automation_settings
  ALTER COLUMN reminder_mode SET DEFAULT 'off',
  ALTER COLUMN reminder_mode SET NOT NULL,
  ADD CONSTRAINT chk_automation_reminder_mode CHECK (
    reminder_mode IN ('off', 'evaluate_only', 'automatic_delivery')
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
      AND mailbox.is_enabled
      AND mailbox.delivery_enabled
      AND mailbox.connection_status = 'connected'
      AND NOT mailbox.reconnect_required
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

DROP TRIGGER IF EXISTS trg_automation_settings_profile
  ON public.automation_settings;
CREATE TRIGGER trg_automation_settings_profile
  BEFORE INSERT OR UPDATE ON public.automation_settings
  FOR EACH ROW EXECUTE FUNCTION public.automation_apply_settings_profile();

-- Normalize existing rows through the canonical trigger without changing
-- their selected operating/reminder modes.
UPDATE public.automation_settings
SET operating_mode = operating_mode,
    reminder_mode = reminder_mode;

ALTER TABLE public.automation_settings
  DROP CONSTRAINT chk_straight_through_explicit_switches,
  DROP CONSTRAINT chk_enabled_mode_has_actor,
  DROP CONSTRAINT chk_observe_only_no_delivery,
  ADD CONSTRAINT chk_automation_document_profile CHECK (
    (operating_mode = 'disabled'
      AND NOT mailbox_sync_enabled
      AND NOT document_intelligence_enabled
      AND NOT invoice_automation_enabled
      AND NOT receipt_automation_enabled
      AND NOT auto_allocation_enabled)
    OR
    (operating_mode = 'observe_only'
      AND mailbox_sync_enabled
      AND document_intelligence_enabled
      AND NOT invoice_automation_enabled
      AND NOT receipt_automation_enabled
      AND NOT auto_allocation_enabled)
    OR
    (operating_mode = 'draft_only'
      AND mailbox_sync_enabled
      AND document_intelligence_enabled
      AND invoice_automation_enabled
      AND receipt_automation_enabled
      AND NOT auto_allocation_enabled)
    OR
    (operating_mode = 'straight_through'
      AND mailbox_sync_enabled
      AND document_intelligence_enabled
      AND invoice_automation_enabled
      AND receipt_automation_enabled
      AND auto_allocation_enabled)
  ),
  ADD CONSTRAINT chk_automation_reminder_profile CHECK (
    (reminder_mode = 'off'
      AND NOT reminder_evaluation_enabled
      AND NOT reminder_delivery_enabled)
    OR
    (reminder_mode = 'evaluate_only'
      AND reminder_evaluation_enabled
      AND NOT reminder_delivery_enabled)
    OR
    (reminder_mode = 'automatic_delivery'
      AND reminder_evaluation_enabled
      AND reminder_delivery_enabled)
  ),
  ADD CONSTRAINT chk_enabled_automation_has_actor CHECK (
    (operating_mode = 'disabled' AND reminder_mode = 'off')
    OR automation_actor_user_id IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.automation_evaluate_invoice_reminders(
  p_company_id UUID,
  p_evaluation_date DATE,
  p_actor_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_created INTEGER := 0;
  v_exceptions INTEGER := 0;
  v_row RECORD;
  v_rep RECORD;
BEGIN
  PERFORM public.rpc_check_role(
    p_actor_user_id, p_company_id,
    ARRAY['AR Supervisor', 'Finance Manager']
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.automation_settings s
    WHERE s.company_id = p_company_id
      AND s.reminder_mode IN ('evaluate_only', 'automatic_delivery')
      AND s.reminder_evaluation_enabled
  ) THEN
    RETURN jsonb_build_object('created', 0, 'exceptions', 0, 'disabled', true);
  END IF;

  FOR v_row IN
    SELECT i.*, c.customer_name, stage.stage_offset_days
    FROM public.invoices i
    CROSS JOIN LATERAL (
      SELECT unnest(s.reminder_stage_offsets) AS stage_offset_days
      FROM public.automation_settings s
      WHERE s.company_id = p_company_id
    ) stage
    JOIN public.customers c ON c.id = i.customer_id
    WHERE i.company_id = p_company_id
      AND i.doc_type = 'Invoice'
      AND i.status IN ('Open', 'Overdue', 'Partially Paid')
      AND i.outstanding > 0
      AND i.due_date + stage.stage_offset_days = p_evaluation_date
      AND NOT c.is_deleted AND NOT c.is_hidden
    ORDER BY i.id, stage.stage_offset_days
  LOOP
    SELECT a.sales_representative_id, s.name, s.email, s.phone
      INTO v_rep
    FROM public.customer_sales_representative_assignments a
    JOIN public.sales_representatives s ON s.id = a.sales_representative_id
    WHERE a.company_id = p_company_id
      AND a.customer_id = v_row.customer_id
      AND a.superseded_at IS NULL
      AND s.is_active;

    IF NOT FOUND OR v_rep.email IS NULL THEN
      INSERT INTO public.automation_exceptions (
        company_id, invoice_id, reason_code, idempotency_key,
        lifecycle_status, safe_details
      ) VALUES (
        p_company_id, v_row.id,
        CASE WHEN NOT FOUND THEN 'missing_salesman' ELSE 'invalid_salesman_email' END,
        encode(digest(
          p_company_id::TEXT || ':' || v_row.id::TEXT || ':' ||
          v_row.stage_offset_days::TEXT || ':' ||
          CASE WHEN NOT FOUND THEN 'missing_salesman' ELSE 'invalid_salesman_email' END,
          'sha256'
        ), 'hex'),
        'open', jsonb_build_object('stage_offset_days', v_row.stage_offset_days)
      ) ON CONFLICT (company_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL DO NOTHING;
      IF FOUND THEN v_exceptions := v_exceptions + 1; END IF;
      CONTINUE;
    END IF;

    INSERT INTO public.invoice_reminders (
      company_id, invoice_id, customer_id, sales_representative_id,
      stage_offset_days, scheduled_for, recipient_name_snapshot,
      recipient_email_snapshot, recipient_phone_snapshot,
      customer_name_snapshot, invoice_no_snapshot, due_date_snapshot,
      outstanding_snapshot, currency_snapshot
    ) VALUES (
      p_company_id, v_row.id, v_row.customer_id, v_rep.sales_representative_id,
      v_row.stage_offset_days, p_evaluation_date, v_rep.name, v_rep.email,
      v_rep.phone, v_row.customer_name, v_row.invoice_no, v_row.due_date,
      v_row.outstanding, v_row.currency
    ) ON CONFLICT (company_id, invoice_id, stage_offset_days) DO NOTHING;
    IF FOUND THEN v_created := v_created + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'created', v_created, 'exceptions', v_exceptions, 'disabled', false
  );
END;
$$;

ALTER FUNCTION public.automation_evaluate_invoice_reminders(UUID, DATE, UUID)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.automation_evaluate_invoice_reminders(UUID, DATE, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_evaluate_invoice_reminders(UUID, DATE, UUID)
  TO service_role;

COMMENT ON COLUMN public.automation_settings.reminder_mode IS
  'Backend-authoritative reminder profile: off, evaluate_only, or automatic_delivery. Runtime booleans are derived.';
COMMENT ON FUNCTION public.automation_apply_settings_profile() IS
  'Derives every document/reminder capability atomically from operating_mode and reminder_mode, and refuses unavailable automatic delivery.';

COMMIT;
