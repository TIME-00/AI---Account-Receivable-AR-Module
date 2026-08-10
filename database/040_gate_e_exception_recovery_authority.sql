-- Gate E: governed critical-reference exception recovery.
-- Original AI extraction rows remain immutable. Finance Manager review may
-- correct only posted Invoice external metadata or confirm one eligible match;
-- allocation amount and execution remain PostgreSQL-authoritative.

BEGIN;

CREATE OR REPLACE FUNCTION public.automation_valid_reference_array(value JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) <> 'array' THEN false
    ELSE jsonb_array_length(value) BETWEEN 1 AND 100
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(value) item
        WHERE jsonb_typeof(item) <> 'string'
          OR length(btrim(item #>> '{}')) NOT BETWEEN 1 AND 100
          OR (item #>> '{}') ~ '[[:cntrl:]]'
      )
  END
$$;

REVOKE ALL ON FUNCTION public.automation_valid_reference_array(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.automation_valid_reference_array(JSONB) OWNER TO postgres;

CREATE TABLE public.automation_exception_recoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  exception_id UUID NOT NULL REFERENCES public.automation_exceptions(id) ON DELETE RESTRICT,
  command_id UUID NOT NULL REFERENCES public.automation_commands(id) ON DELETE RESTRICT,
  receipt_id UUID NOT NULL REFERENCES public.receipts(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL,
  original_invoice_reference TEXT NULL,
  corrected_invoice_reference TEXT NULL,
  original_receipt_references JSONB NOT NULL,
  resolution_note TEXT NOT NULL,
  actor_user_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_automation_recovery_action CHECK (
    action_type IN (
      'correct_invoice_external_reference',
      'confirm_receipt_invoice_match'
    )
  ),
  CONSTRAINT chk_automation_recovery_reference_shape CHECK (
    (action_type = 'correct_invoice_external_reference'
      AND original_invoice_reference IS DISTINCT FROM corrected_invoice_reference
      AND corrected_invoice_reference IS NOT NULL
      AND length(btrim(corrected_invoice_reference)) BETWEEN 1 AND 50
      AND corrected_invoice_reference !~ '[[:cntrl:]]')
    OR
    (action_type = 'confirm_receipt_invoice_match'
      AND corrected_invoice_reference IS NULL)
  ),
  CONSTRAINT chk_automation_recovery_candidates CHECK (
    public.automation_valid_reference_array(original_receipt_references)
  ),
  CONSTRAINT chk_automation_recovery_note CHECK (
    length(btrim(resolution_note)) BETWEEN 1 AND 500
  ),
  CONSTRAINT chk_automation_recovery_key CHECK (
    idempotency_key ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT uq_automation_exception_recovery_key
    UNIQUE (company_id, idempotency_key)
);

CREATE INDEX idx_automation_recovery_exception
  ON public.automation_exception_recoveries(company_id, exception_id, created_at DESC);
CREATE INDEX idx_automation_recovery_receipt
  ON public.automation_exception_recoveries(company_id, receipt_id, created_at DESC);
CREATE INDEX idx_automation_recovery_invoice
  ON public.automation_exception_recoveries(company_id, invoice_id, created_at DESC);

ALTER TABLE public.automation_exception_recoveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.automation_exception_recoveries
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.automation_exception_recoveries TO service_role;

CREATE OR REPLACE FUNCTION public.automation_exception_recovery_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'AUDIT_IMMUTABLE: Exception recovery evidence is append-only.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.automation_exceptions e
    JOIN public.automation_commands c
      ON c.id = NEW.command_id AND c.company_id = NEW.company_id
    JOIN public.receipts r
      ON r.id = NEW.receipt_id AND r.company_id = NEW.company_id
    JOIN public.invoices i
      ON i.id = NEW.invoice_id AND i.company_id = NEW.company_id
    WHERE e.id = NEW.exception_id
      AND e.company_id = NEW.company_id
      AND e.command_id = NEW.command_id
      AND e.receipt_id = NEW.receipt_id
      AND c.resulting_receipt_id = r.id
      AND r.customer_id = i.customer_id
      AND r.currency = i.currency
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'TENANT_MISMATCH: Recovery links are inconsistent.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_automation_exception_recovery_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.automation_exception_recoveries
  FOR EACH ROW EXECUTE FUNCTION public.automation_exception_recovery_guard();

REVOKE ALL ON FUNCTION public.automation_exception_recovery_guard()
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.automation_exception_recovery_guard() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.automation_recovery_context(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_exception_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exception RECORD;
  v_receipt RECORD;
  v_extraction JSONB;
  v_recovery JSONB;
  v_options JSONB;
BEGIN
  PERFORM public.rpc_check_role(
    p_actor_user_id, p_company_id,
    ARRAY['AR Supervisor', 'Finance Manager']
  );
  SELECT e.*, c.extraction_id INTO v_exception
  FROM public.automation_exceptions e
  JOIN public.automation_commands c
    ON c.id = e.command_id AND c.company_id = e.company_id
  WHERE e.id = p_exception_id
    AND e.company_id = p_company_id
    AND e.reason_code = 'critical_identifier_unverified'
    AND e.receipt_id IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Recoverable automation exception not found.';
  END IF;

  SELECT r.* INTO v_receipt
  FROM public.receipts r
  WHERE r.id = v_exception.receipt_id AND r.company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Recoverable Receipt not found.';
  END IF;
  PERFORM public.rpc_check_customer_access(
    p_actor_user_id, p_company_id, v_receipt.customer_id
  );
  SELECT er.extracted_fields INTO v_extraction
  FROM public.automation_extraction_results er
  WHERE er.id = v_exception.extraction_id AND er.company_id = p_company_id;

  SELECT jsonb_build_object(
    'id', rec.id,
    'action_type', rec.action_type,
    'invoice_id', rec.invoice_id,
    'created_at', rec.created_at
  ) INTO v_recovery
  FROM public.automation_exception_recoveries rec
  WHERE rec.company_id = p_company_id AND rec.exception_id = p_exception_id
  ORDER BY rec.created_at DESC, rec.id DESC LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'invoice_id', i.id,
    'invoice_no', i.invoice_no,
    'reference_no', i.reference_no,
    'status', i.status,
    'currency', i.currency,
    'outstanding', i.outstanding
  ) ORDER BY i.invoice_no, i.id), '[]'::jsonb) INTO v_options
  FROM (
    SELECT candidate.* FROM public.invoices candidate
    WHERE candidate.company_id = p_company_id
      AND candidate.customer_id = v_receipt.customer_id
      AND candidate.currency = v_receipt.currency
      AND candidate.status IN ('Open', 'Overdue', 'Partially Paid')
      AND candidate.outstanding > 0
    ORDER BY candidate.invoice_no, candidate.id
    LIMIT 100
  ) i;

  RETURN jsonb_build_object(
    'exception_id', v_exception.id,
    'lifecycle_status', v_exception.lifecycle_status,
    'reason_code', v_exception.reason_code,
    'receipt', jsonb_build_object(
      'id', v_receipt.id,
      'receipt_no', v_receipt.receipt_no,
      'status', v_receipt.status,
      'currency', v_receipt.currency,
      'unallocated_amount', v_receipt.unallocated_amount,
      'attachment_id', v_exception.attachment_id
    ),
    'original_invoice_references',
      COALESCE(v_extraction->'invoice_references', '[]'::jsonb),
    'eligible_invoices', v_options,
    'latest_recovery', v_recovery
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.automation_record_exception_recovery(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_exception_id UUID,
  p_invoice_id UUID,
  p_action_type TEXT,
  p_corrected_reference TEXT,
  p_resolution_note TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exception RECORD;
  v_receipt RECORD;
  v_invoice RECORD;
  v_references JSONB;
  v_recovery public.automation_exception_recoveries%ROWTYPE;
  v_existing public.automation_exception_recoveries%ROWTYPE;
BEGIN
  PERFORM public.rpc_check_role(
    p_actor_user_id, p_company_id, ARRAY['Finance Manager']
  );
  IF p_action_type NOT IN (
    'correct_invoice_external_reference', 'confirm_receipt_invoice_match'
  ) OR length(btrim(p_resolution_note)) NOT BETWEEN 1 AND 500
    OR p_idempotency_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: Exception recovery request is invalid.';
  END IF;

  SELECT e.*, c.extraction_id INTO v_exception
  FROM public.automation_exceptions e
  JOIN public.automation_commands c
    ON c.id = e.command_id AND c.company_id = e.company_id
  WHERE e.id = p_exception_id AND e.company_id = p_company_id
    AND e.reason_code = 'critical_identifier_unverified'
    AND e.lifecycle_status IN ('open', 'retryable')
  FOR UPDATE OF e;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Recoverable automation exception not found.';
  END IF;

  SELECT r.* INTO v_receipt FROM public.receipts r
  WHERE r.id = v_exception.receipt_id AND r.company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Recoverable Receipt not found.';
  END IF;
  PERFORM public.rpc_check_customer_access(
    p_actor_user_id, p_company_id, v_receipt.customer_id
  );
  SELECT i.* INTO v_invoice FROM public.invoices i
  WHERE i.id = p_invoice_id AND i.company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Eligible Invoice not found.';
  END IF;
  IF v_invoice.customer_id <> v_receipt.customer_id
    OR v_invoice.currency <> v_receipt.currency
    OR v_invoice.status NOT IN ('Open', 'Overdue', 'Partially Paid')
    OR v_invoice.outstanding <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'NOT_FOUND: Eligible Invoice not found.';
  END IF;

  SELECT er.extracted_fields->'invoice_references' INTO v_references
  FROM public.automation_extraction_results er
  WHERE er.id = v_exception.extraction_id AND er.company_id = p_company_id
    AND er.validation_status = 'valid';
  IF jsonb_typeof(v_references) <> 'array'
    OR jsonb_array_length(v_references) <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'BR-AUTO-ALLOC-EVIDENCE: Original Receipt evidence is unavailable.';
  END IF;

  SELECT * INTO v_existing
  FROM public.automation_exception_recoveries
  WHERE company_id = p_company_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.exception_id <> p_exception_id
      OR v_existing.invoice_id <> p_invoice_id
      OR v_existing.action_type <> p_action_type THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'CONFLICT: Recovery idempotency evidence differs.';
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;

  IF p_action_type = 'correct_invoice_external_reference' THEN
    IF p_corrected_reference IS NULL
      OR length(btrim(p_corrected_reference)) NOT BETWEEN 1 AND 50
      OR p_corrected_reference ~ '[[:cntrl:]]'
      OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_references) ref
        WHERE ref = btrim(p_corrected_reference)
      )
      OR EXISTS (
        SELECT 1 FROM public.invoices other
        WHERE other.company_id = p_company_id
          AND other.customer_id = v_receipt.customer_id
          AND other.id <> v_invoice.id
          AND (
            other.invoice_no = btrim(p_corrected_reference)
            OR other.reference_no = btrim(p_corrected_reference)
          )
      ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001',
        MESSAGE = 'BR-DOC-REFERENCE: Corrected external reference is not safe.';
    END IF;
    PERFORM public.correct_posted_invoice_reference(
      v_invoice.id, p_actor_user_id, p_company_id, btrim(p_corrected_reference)
    );
  ELSIF p_corrected_reference IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001',
      MESSAGE = 'VALIDATION: Match confirmation cannot rewrite Invoice metadata.';
  END IF;

  INSERT INTO public.automation_exception_recoveries (
    company_id, exception_id, command_id, receipt_id, invoice_id,
    action_type, original_invoice_reference, corrected_invoice_reference,
    original_receipt_references, resolution_note, actor_user_id,
    idempotency_key
  ) VALUES (
    p_company_id, v_exception.id, v_exception.command_id,
    v_receipt.id, v_invoice.id, p_action_type, v_invoice.reference_no,
    CASE WHEN p_action_type = 'correct_invoice_external_reference'
      THEN btrim(p_corrected_reference) ELSE NULL END,
    v_references, btrim(p_resolution_note), p_actor_user_id,
    p_idempotency_key
  ) RETURNING * INTO v_recovery;

  INSERT INTO public.automation_audit_events (
    company_id, event_type, entity_type, entity_id, actor_type,
    actor_user_id, trace_id, safe_metadata
  ) VALUES (
    p_company_id, 'automation_exception_recovery_recorded',
    'automation_exception_recovery', v_recovery.id, 'user',
    p_actor_user_id, v_recovery.id::TEXT,
    jsonb_build_object(
      'action', CASE WHEN p_action_type = 'correct_invoice_external_reference'
        THEN 'correct_reference' ELSE 'confirm_match' END,
      'exception_id', p_exception_id,
      'receipt_id', v_receipt.id,
      'invoice_id', v_invoice.id
    )
  );
  RETURN to_jsonb(v_recovery);
END;
$$;

ALTER TABLE public.automation_allocation_decisions
  DROP CONSTRAINT chk_automation_allocation_evidence_type,
  ADD CONSTRAINT chk_automation_allocation_evidence_type CHECK (
    evidence_type IN (
      'exact_invoice_reference',
      'exact_amount_single_invoice',
      'explicit_partial_reference',
      'explicit_multi_invoice_references',
      'human_confirmed_invoice'
    )
  );

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

  v_key := encode(digest(
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

REVOKE ALL ON FUNCTION public.automation_recovery_context(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_record_exception_recovery(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_retry_exception_matching(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_recovery_context(UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_record_exception_recovery(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_retry_exception_matching(UUID, UUID, UUID)
  TO service_role;

ALTER FUNCTION public.automation_recovery_context(UUID, UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.automation_record_exception_recovery(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.automation_retry_exception_matching(UUID, UUID, UUID)
  OWNER TO postgres;

COMMENT ON TABLE public.automation_exception_recoveries IS
  'Immutable Finance Manager authority for critical-reference recovery. Original provider extraction remains unchanged.';
COMMENT ON FUNCTION public.automation_retry_exception_matching(UUID, UUID, UUID) IS
  'Service-role-only deterministic Retry Matching. Revalidates and locks current financial state, derives the allocation amount, and resolves the exception idempotently.';

COMMIT;
