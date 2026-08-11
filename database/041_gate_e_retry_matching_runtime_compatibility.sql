-- Gate E: Production retry-matching runtime compatibility and least privilege.
--
-- Migration 040 correctly pinned recovery functions to an empty search_path,
-- but its retry idempotency key referenced pgcrypto.digest without the
-- extension schema. Production therefore failed before any financial DML.
-- This migration qualifies that dependency, applies the same protection to
-- the reminder exception branch, and removes a legacy direct anon EXECUTE
-- grant from the underlying allocation RPC. It does not activate settings or
-- mutate financial/business rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.automation_retry_exception_matching(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_exception_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exception RECORD;
  v_recovery public.automation_exception_recoveries%ROWTYPE;
  v_receipt public.receipts%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_decision public.automation_allocation_decisions%ROWTYPE;
  v_key TEXT;
  v_amount NUMERIC(18,2);
  v_result JSONB;
  v_previous_setting TEXT;
  v_resolved_count INTEGER;
  v_resolved_invoice_id UUID;
BEGIN
  PERFORM public.rpc_check_role(
    p_actor_user_id, p_company_id, ARRAY['Finance Manager']
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(p_exception_id::TEXT, 0));

  SELECT e.* INTO v_exception
  FROM public.automation_exceptions e
  WHERE e.id = p_exception_id AND e.company_id = p_company_id
    AND e.reason_code = 'critical_identifier_unverified'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Recoverable automation exception not found.';
  END IF;

  SELECT r.* INTO v_recovery
  FROM public.automation_exception_recoveries r
  WHERE r.company_id = p_company_id AND r.exception_id = p_exception_id
  ORDER BY r.created_at DESC, r.id DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-AUTO-ALLOC-EVIDENCE: Governed recovery authority is required.';
  END IF;

  v_key := encode(extensions.digest(
    p_company_id::TEXT || ':' || p_exception_id::TEXT || ':' ||
    v_recovery.id::TEXT || ':retry_matching_v1', 'sha256'
  ), 'hex');
  SELECT * INTO v_decision FROM public.automation_allocation_decisions
  WHERE company_id = p_company_id AND idempotency_key = v_key;
  IF FOUND AND v_decision.status = 'completed' THEN
    RETURN v_decision.allocation_result ||
      jsonb_build_object('command_id', v_recovery.command_id);
  ELSIF FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'CONFLICT: Matching recovery is already running.';
  END IF;
  IF v_exception.lifecycle_status NOT IN ('open', 'retryable') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'CONFLICT: Matching recovery is no longer actionable.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.automation_settings s
    WHERE s.company_id = p_company_id
      AND s.operating_mode = 'straight_through'
      AND s.auto_allocation_enabled
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-AUTO-ALLOC-DISABLED: Automatic allocation is disabled.';
  END IF;

  SELECT * INTO v_receipt FROM public.receipts
  WHERE id = v_recovery.receipt_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-AUTO-ALLOC-EVIDENCE: Recovered Receipt is unavailable.';
  END IF;
  PERFORM public.rpc_check_customer_access(
    p_actor_user_id, p_company_id, v_receipt.customer_id
  );
  SELECT * INTO v_invoice FROM public.invoices
  WHERE id = v_recovery.invoice_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-AUTO-ALLOC-EVIDENCE: Recovered Invoice is unavailable.';
  END IF;
  IF v_receipt.status <> 'Posted' OR v_receipt.unallocated_amount <= 0
    OR v_invoice.customer_id <> v_receipt.customer_id
    OR v_invoice.currency <> v_receipt.currency
    OR v_invoice.status NOT IN ('Open', 'Overdue', 'Partially Paid')
    OR v_invoice.outstanding <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-AUTO-ALLOC-EVIDENCE: Recovered financial state is no longer eligible.';
  END IF;
  IF v_recovery.action_type = 'correct_invoice_external_reference'
    AND v_invoice.reference_no IS DISTINCT FROM v_recovery.corrected_invoice_reference THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-AUTO-ALLOC-EVIDENCE: Corrected Invoice reference changed after review.';
  END IF;
  IF v_recovery.action_type = 'correct_invoice_external_reference' THEN
    SELECT count(*), (array_agg(resolved.invoice_id))[1]
      INTO v_resolved_count, v_resolved_invoice_id
    FROM public.automation_resolve_receipt_invoice_references(
      p_company_id,
      v_receipt.customer_id,
      v_receipt.currency,
      v_recovery.original_receipt_references
    ) resolved;
    IF v_resolved_count <> 1 OR v_resolved_invoice_id <> v_invoice.id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-AUTO-ALLOC-EVIDENCE: Corrected reference is not uniquely resolvable.';
    END IF;
  END IF;

  v_amount := LEAST(v_receipt.unallocated_amount, v_invoice.outstanding);
  INSERT INTO public.automation_allocation_decisions (
    company_id, command_id, receipt_id, evidence_type, evidence,
    idempotency_key, status
  ) VALUES (
    p_company_id, v_recovery.command_id, v_receipt.id,
    'human_confirmed_invoice',
    jsonb_build_object(
      'source', 'finance_manager_exception_recovery_v1',
      'exception_id', p_exception_id,
      'recovery_id', v_recovery.id
    ),
    v_key, 'pending'
  ) RETURNING * INTO v_decision;

  v_previous_setting := current_setting(
    'app.automation_allocation_decision_id', true
  );
  PERFORM set_config(
    'app.automation_allocation_decision_id', v_decision.id::TEXT, true
  );
  BEGIN
    v_result := public.allocate_receipt(
      v_receipt.id, p_actor_user_id, p_company_id,
      jsonb_build_array(jsonb_build_object(
        'invoice_id', v_invoice.id,
        'amount', v_amount,
        'discount_amount', 0
      ))
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config(
      'app.automation_allocation_decision_id',
      COALESCE(v_previous_setting, ''), true
    );
    RAISE;
  END;
  PERFORM set_config(
    'app.automation_allocation_decision_id',
    COALESCE(v_previous_setting, ''), true
  );

  UPDATE public.automation_allocation_decisions
  SET status = 'completed', allocation_result = v_result,
      completed_at = clock_timestamp()
  WHERE id = v_decision.id;
  UPDATE public.automation_exceptions
  SET lifecycle_status = 'resolved', actor_user_id = p_actor_user_id,
      resolved_at = clock_timestamp(),
      resolution_note = 'Governed matching recovery completed successfully.'
  WHERE id = p_exception_id AND company_id = p_company_id;

  INSERT INTO public.automation_audit_events (
    company_id, event_type, entity_type, entity_id, actor_type,
    actor_user_id, trace_id, safe_metadata
  ) VALUES (
    p_company_id, 'automation_exception_matching_completed',
    'automation_exception_recovery', v_recovery.id, 'user',
    p_actor_user_id, v_recovery.id::TEXT,
    jsonb_build_object(
      'action', 'retry_matching',
      'exception_id', p_exception_id,
      'receipt_id', v_receipt.id,
      'invoice_id', v_invoice.id
    )
  );
  RETURN v_result || jsonb_build_object('command_id', v_recovery.command_id);
END;
$$;

REVOKE ALL ON FUNCTION public.automation_retry_exception_matching(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_retry_exception_matching(UUID, UUID, UUID)
  TO service_role;
ALTER FUNCTION public.automation_retry_exception_matching(UUID, UUID, UUID)
  OWNER TO postgres;

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
        encode(extensions.digest(
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

REVOKE ALL ON FUNCTION public.automation_evaluate_invoice_reminders(UUID, DATE, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_evaluate_invoice_reminders(UUID, DATE, UUID)
  TO service_role;
ALTER FUNCTION public.automation_evaluate_invoice_reminders(UUID, DATE, UUID)
  OWNER TO postgres;

-- Migration 015 intended the foundational financial RPC to be service-only.
-- The original Migration 007 direct anon grant survived later PUBLIC and
-- authenticated revokes; remove that legacy capability explicitly.
REVOKE ALL ON FUNCTION public.allocate_receipt(UUID, UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_receipt(UUID, UUID, UUID, JSONB)
  TO service_role;

COMMENT ON FUNCTION public.automation_retry_exception_matching(UUID, UUID, UUID) IS
  'Service-role-only deterministic Retry Matching. Uses schema-qualified pgcrypto under an empty search_path and preserves transactional financial authority.';

COMMIT;
