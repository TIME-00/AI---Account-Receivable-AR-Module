-- Gate E: exact Receipt-to-Invoice reference authority for automatic allocation.
--
-- Receipt references are provider-extracted lookup evidence, not Invoice ids.
-- This replacement keeps every Migration 034 financial, locking, idempotency,
-- FX, and privilege boundary while accepting a unique exact internal invoice_no
-- or external reference_no inside the governed company/customer/currency scope.
-- It does not activate a setting or mutate financial/business rows.

BEGIN;

-- Non-unique by design: duplicate external references remain representable so
-- the resolver can detect ambiguity and fail closed rather than inventing
-- global authority for supplier metadata.
CREATE INDEX IF NOT EXISTS idx_invoices_company_customer_reference
  ON public.invoices (company_id, customer_id, reference_no)
  WHERE reference_no IS NOT NULL;

CREATE OR REPLACE FUNCTION public.automation_resolve_receipt_invoice_references(
  p_company_id UUID,
  p_customer_id UUID,
  p_currency TEXT,
  p_references JSONB
)
RETURNS TABLE(reference TEXT, invoice_id UUID)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH requested AS (
    SELECT value AS reference, ordinality
    FROM jsonb_array_elements_text(p_references)
      WITH ORDINALITY AS item(value, ordinality)
  ), matches AS (
    SELECT requested.reference, requested.ordinality, i.id AS invoice_id
    FROM requested
    JOIN public.invoices i
      ON i.company_id = p_company_id
      AND i.customer_id = p_customer_id
      AND i.currency = p_currency
      AND i.status IN ('Open', 'Overdue', 'Partially Paid')
      AND i.outstanding > 0
      AND (
        i.invoice_no = requested.reference
        OR i.reference_no = requested.reference
      )
  ), resolved AS (
    SELECT matches.reference, matches.ordinality,
           array_agg(DISTINCT matches.invoice_id) AS invoice_ids,
           count(DISTINCT matches.invoice_id) AS match_count
    FROM matches
    GROUP BY matches.reference, matches.ordinality
  )
  SELECT resolved.reference, resolved.invoice_ids[1]
  FROM resolved
  WHERE resolved.match_count = 1
  ORDER BY resolved.ordinality
$$;

CREATE OR REPLACE FUNCTION public.automation_allocate_receipt(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_command_id UUID,
  p_receipt_id UUID,
  p_evidence_type TEXT,
  p_evidence JSONB,
  p_allocations JSONB,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt RECORD;
  v_allocation JSONB;
  v_invoice RECORD;
  v_existing_decision RECORD;
  v_decision_id UUID;
  v_result JSONB;
  v_allocation_count INTEGER;
  v_distinct_invoice_count INTEGER;
  v_exact_match_count INTEGER;
  v_reference_match_count INTEGER;
  v_reference_resolved_count INTEGER;
  v_allocation_total NUMERIC(18,2);
  v_command_extraction JSONB;
  v_previous_allocation_decision_setting TEXT;
BEGIN
  PERFORM public.rpc_check_role(
    p_actor_user_id, p_company_id,
    ARRAY['AR Clerk', 'AR Supervisor', 'Finance Manager']
  );
  IF p_evidence_type NOT IN (
    'exact_invoice_reference', 'exact_amount_single_invoice',
    'explicit_partial_reference', 'explicit_multi_invoice_references'
  ) OR jsonb_typeof(p_evidence) <> 'object'
    OR jsonb_typeof(p_allocations) <> 'array'
    OR p_evidence->>'source' <> 'document_extraction_v1'
    OR (p_evidence - ARRAY[
      'invoice_references', 'payment_reference', 'source'
    ]) <> '{}'::jsonb
    OR p_idempotency_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Allocation evidence is insufficient.';
  END IF;
  IF (
    NOT (p_evidence ? 'invoice_references')
    OR jsonb_typeof(p_evidence->'invoice_references') <> 'array'
    OR jsonb_array_length(p_evidence->'invoice_references') = 0
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_evidence->'invoice_references') reference
      WHERE jsonb_typeof(reference) <> 'string'
        OR length(btrim(reference #>> '{}')) NOT BETWEEN 1 AND 100
    )
    OR (
      SELECT count(*) FROM jsonb_array_elements(
        p_evidence->'invoice_references'
      )
    ) <> (
      SELECT count(DISTINCT reference #>> '{}')
      FROM jsonb_array_elements(p_evidence->'invoice_references') reference
    )
  ) THEN
    RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Allocation references are required.';
  END IF;

  SELECT e.extracted_fields INTO v_command_extraction
  FROM public.automation_commands c
  JOIN public.automation_extraction_results e ON e.id = c.extraction_id
  WHERE c.id = p_command_id
    AND c.company_id = p_company_id
    AND c.command_type = 'create_receipt'
    AND c.status = 'completed'
    AND c.resulting_receipt_id = p_receipt_id
    AND e.company_id = p_company_id
    AND e.validation_status = 'valid';
  IF NOT FOUND OR v_command_extraction->>'document_type' <> 'receipt' THEN
    RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Receipt command evidence is inconsistent.';
  END IF;
  IF COALESCE(p_evidence->>'payment_reference', '') <>
      COALESCE(v_command_extraction->>'reference_no', '') THEN
    RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Payment reference evidence is inconsistent.';
  END IF;
  IF p_evidence_type IN (
    'exact_invoice_reference',
    'explicit_partial_reference',
    'explicit_multi_invoice_references'
  ) AND p_evidence->'invoice_references' IS DISTINCT FROM
    v_command_extraction->'invoice_references' THEN
    RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Invoice reference evidence is inconsistent.';
  END IF;
  IF p_evidence_type = 'exact_amount_single_invoice'
    AND jsonb_array_length(
      COALESCE(v_command_extraction->'invoice_references', '[]'::jsonb)
    ) <> 0 THEN
    RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Exact-amount evidence cannot replace document references.';
  END IF;

  SELECT * INTO v_receipt
  FROM public.receipts
  WHERE id = p_receipt_id AND company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Receipt is unavailable.'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_receipt_id::TEXT, 0));

  SELECT * INTO v_existing_decision
  FROM public.automation_allocation_decisions
  WHERE company_id = p_company_id
    AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_decision.command_id <> p_command_id
      OR v_existing_decision.receipt_id <> p_receipt_id
      OR v_existing_decision.evidence_type <> p_evidence_type
      OR v_existing_decision.evidence <> p_evidence THEN
      RAISE EXCEPTION 'CONFLICT: Automatic allocation idempotency evidence differs.';
    END IF;
    IF v_existing_decision.allocation_result IS NULL THEN
      RAISE EXCEPTION 'CONFLICT: Automatic allocation is already being processed.';
    END IF;
    RETURN v_existing_decision.allocation_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.automation_settings s
    WHERE s.company_id = p_company_id
      AND s.operating_mode = 'straight_through'
      AND s.auto_allocation_enabled
  ) THEN
    RAISE EXCEPTION 'BR-AUTO-ALLOC-DISABLED: Automatic allocation is disabled.';
  END IF;
  IF NOT public.automation_fx_is_authoritative(p_company_id, NULL, p_receipt_id) THEN
    RAISE EXCEPTION 'BR-AUTO-FX-UNAVAILABLE: Receipt booked FX authority is unavailable.';
  END IF;

  -- Explicit Receipt references are probabilistic lookup evidence only. Each
  -- value must resolve exactly once inside the authoritative financial scope,
  -- and distinct values must not collapse onto the same Invoice.
  IF p_evidence_type IN (
    'exact_invoice_reference',
    'explicit_partial_reference',
    'explicit_multi_invoice_references'
  ) THEN
    SELECT count(*), count(DISTINCT resolved.invoice_id)
      INTO v_reference_match_count, v_reference_resolved_count
    FROM public.automation_resolve_receipt_invoice_references(
      p_company_id,
      v_receipt.customer_id,
      v_receipt.currency,
      p_evidence->'invoice_references'
    ) resolved;
    IF v_reference_match_count <>
        jsonb_array_length(p_evidence->'invoice_references')
      OR v_reference_resolved_count <> v_reference_match_count THEN
      RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Invoice reference evidence is not uniquely resolvable.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_allocations) item
    WHERE jsonb_typeof(item) <> 'object'
      OR item->>'invoice_id' !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      OR item->>'amount' !~ '^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$'
      OR (item->>'amount')::NUMERIC <= 0
      OR item->>'discount_amount' !~
        '^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$'
      OR (item->>'discount_amount')::NUMERIC <> 0
      OR (item - ARRAY['invoice_id', 'amount', 'discount_amount']) <> '{}'::jsonb
  ) THEN
    RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Allocation values are invalid.';
  END IF;

  SELECT count(*), count(DISTINCT item->>'invoice_id'),
         COALESCE(sum((item->>'amount')::NUMERIC), 0)
    INTO v_allocation_count, v_distinct_invoice_count, v_allocation_total
  FROM jsonb_array_elements(p_allocations) item;
  IF v_allocation_count < 1 OR v_allocation_count > 100
    OR v_distinct_invoice_count <> v_allocation_count
    OR jsonb_array_length(p_evidence->'invoice_references') <>
      v_allocation_count
    OR (
      p_evidence_type IN (
        'exact_invoice_reference',
        'exact_amount_single_invoice',
        'explicit_partial_reference'
      )
      AND v_allocation_count <> 1
    )
    OR (
      p_evidence_type = 'explicit_multi_invoice_references'
      AND v_allocation_count < 2
    ) THEN
    RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Allocation count is inconsistent with the evidence.';
  END IF;
  IF v_allocation_total <> v_receipt.unallocated_amount THEN
    RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Allocation amount does not reconcile to the Receipt.';
  END IF;

  INSERT INTO public.automation_allocation_decisions (
    company_id, command_id, receipt_id, evidence_type, evidence,
    idempotency_key, status
  ) VALUES (
    p_company_id, p_command_id, p_receipt_id, p_evidence_type, p_evidence,
    p_idempotency_key, 'pending'
  )
  ON CONFLICT (company_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_decision_id;

  IF v_decision_id IS NULL THEN
    RAISE EXCEPTION 'CONFLICT: Automatic allocation idempotency key is already in use.';
  END IF;

  FOR v_allocation IN
    SELECT value FROM jsonb_array_elements(p_allocations)
  LOOP
    SELECT * INTO v_invoice
    FROM public.invoices
    WHERE id = (v_allocation->>'invoice_id')::UUID
      AND company_id = p_company_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Invoice is unavailable.'; END IF;
    IF v_invoice.customer_id <> v_receipt.customer_id
      OR v_invoice.currency <> v_receipt.currency THEN
      RAISE EXCEPTION 'BR-AUTO-ALLOC-MISMATCH: Allocation customer or currency does not match.';
    END IF;
    IF v_invoice.status NOT IN ('Open', 'Overdue', 'Partially Paid')
      OR v_invoice.outstanding <= 0 THEN
      RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Referenced Invoice is not allocatable.';
    END IF;
    IF p_evidence_type IN (
      'exact_invoice_reference',
      'explicit_partial_reference',
      'explicit_multi_invoice_references'
    ) AND NOT EXISTS (
      SELECT 1
      FROM public.automation_resolve_receipt_invoice_references(
        p_company_id,
        v_receipt.customer_id,
        v_receipt.currency,
        p_evidence->'invoice_references'
      ) resolved
      WHERE resolved.invoice_id = v_invoice.id
    ) THEN
      RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Invoice reference evidence is inconsistent.';
    END IF;
    IF NOT public.automation_fx_is_authoritative(p_company_id, v_invoice.id, NULL) THEN
      RAISE EXCEPTION 'BR-AUTO-FX-UNAVAILABLE: Invoice booked FX authority is unavailable.';
    END IF;
    IF p_evidence_type = 'exact_invoice_reference'
      AND (v_allocation->>'amount')::NUMERIC <> v_invoice.outstanding THEN
      RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Exact reference amount does not reconcile.';
    END IF;
    IF p_evidence_type = 'explicit_partial_reference'
      AND (v_allocation->>'amount')::NUMERIC >= v_invoice.outstanding THEN
      RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Partial reference amount is not partial.';
    END IF;
  END LOOP;

  IF p_evidence_type = 'exact_amount_single_invoice' THEN
    SELECT count(*) INTO v_exact_match_count
    FROM public.invoices i
    WHERE i.company_id = p_company_id
      AND i.customer_id = v_receipt.customer_id
      AND i.currency = v_receipt.currency
      AND i.status IN ('Open', 'Overdue', 'Partially Paid')
      AND i.outstanding = v_receipt.unallocated_amount;
    IF v_exact_match_count <> 1
      OR (p_allocations->0->>'amount')::NUMERIC <> v_receipt.unallocated_amount
      OR (p_allocations->0->>'discount_amount')::NUMERIC <> 0 THEN
      RAISE EXCEPTION 'BR-AUTO-ALLOC-EVIDENCE: Exact-amount allocation is not unambiguous.';
    END IF;
  END IF;

  v_previous_allocation_decision_setting := current_setting(
    'app.automation_allocation_decision_id',
    true
  );
  PERFORM set_config(
    'app.automation_allocation_decision_id',
    v_decision_id::TEXT,
    true
  );
  BEGIN
    v_result := public.allocate_receipt(
      p_receipt_id, p_actor_user_id, p_company_id, p_allocations
    );
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM set_config(
        'app.automation_allocation_decision_id',
        COALESCE(v_previous_allocation_decision_setting, ''),
        true
      );
      RAISE;
  END;
  PERFORM set_config(
    'app.automation_allocation_decision_id',
    COALESCE(v_previous_allocation_decision_setting, ''),
    true
  );

  UPDATE public.automation_allocation_decisions
  SET status = 'completed', allocation_result = v_result, completed_at = clock_timestamp()
  WHERE id = v_decision_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.automation_resolve_receipt_invoice_references(
  UUID, UUID, TEXT, JSONB
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.automation_allocate_receipt(
  UUID, UUID, UUID, UUID, TEXT, JSONB, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.automation_allocate_receipt(
  UUID, UUID, UUID, UUID, TEXT, JSONB, JSONB, TEXT
) TO service_role;

ALTER FUNCTION public.automation_allocate_receipt(
  UUID, UUID, UUID, UUID, TEXT, JSONB, JSONB, TEXT
) OWNER TO postgres;

ALTER FUNCTION public.automation_resolve_receipt_invoice_references(
  UUID, UUID, TEXT, JSONB
) OWNER TO postgres;

COMMENT ON FUNCTION public.automation_resolve_receipt_invoice_references(
  UUID, UUID, TEXT, JSONB
) IS
  'Private Gate E exact reference resolver. Returns only uniquely matched eligible Invoice ids inside the supplied financial scope.';

COMMENT ON FUNCTION public.automation_allocate_receipt(
  UUID, UUID, UUID, UUID, TEXT, JSONB, JSONB, TEXT
) IS
  'Gate E DB-authoritative Receipt allocation. Explicit references must resolve uniquely and exactly to one eligible Invoice by internal invoice_no or external reference_no within company/customer/currency scope.';

COMMIT;
