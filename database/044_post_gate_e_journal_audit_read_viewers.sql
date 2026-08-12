-- Post-Gate-E Journal and Audit read viewers
-- Read-side only: no source financial or audit row is created, rewritten, or deleted.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_je_company_created_cursor
  ON public.journal_entries(company_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.journal_read_source(p_company_id UUID)
RETURNS TABLE (
  id UUID,
  je_no TEXT,
  je_date DATE,
  posting_period TEXT,
  source_type TEXT,
  source_doc_no TEXT,
  source_doc_id UUID,
  description TEXT,
  currency TEXT,
  exchange_rate TEXT,
  base_currency TEXT,
  total_debit TEXT,
  total_credit TEXT,
  is_balanced BOOLEAN,
  is_reversal BOOLEAN,
  original_je_id UUID,
  is_reversed BOOLEAN,
  reversal_je_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ,
  line_count INTEGER,
  source_link JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    je.id,
    je.je_no::TEXT,
    je.je_date,
    je.posting_period::TEXT,
    je.source_type::TEXT,
    je.source_doc_no::TEXT,
    je.source_doc_id,
    je.description,
    je.currency::TEXT,
    je.exchange_rate::TEXT,
    je.base_currency::TEXT,
    je.total_debit::TEXT,
    je.total_credit::TEXT,
    je.total_debit = je.total_credit,
    je.is_reversal,
    je.original_je_id,
    je.is_reversed,
    je.reversal_je_id,
    je.created_by,
    je.created_at,
    (SELECT COUNT(*)::INTEGER FROM public.journal_entry_lines line WHERE line.je_id = je.id),
    CASE
      WHEN je.source_type IN ('INV', 'CN', 'DN') AND inv.id IS NOT NULL THEN
        jsonb_build_object(
          'entity_type', CASE inv.doc_type
            WHEN 'Invoice' THEN 'invoice'
            WHEN 'Credit Note' THEN 'credit_note'
            WHEN 'Debit Note' THEN 'debit_note'
          END,
          'entity_id', inv.id,
          'entity_number', inv.invoice_no
        )
      WHEN je.source_type = 'RCT' AND receipt.id IS NOT NULL THEN
        jsonb_build_object(
          'entity_type', 'receipt',
          'entity_id', receipt.id,
          'entity_number', receipt.receipt_no
        )
      ELSE NULL
    END
  FROM public.journal_entries je
  LEFT JOIN public.invoices inv
    ON inv.company_id = je.company_id
   AND inv.id = je.source_doc_id
   AND je.source_type IN ('INV', 'CN', 'DN')
  LEFT JOIN public.receipts receipt
    ON receipt.company_id = je.company_id
   AND receipt.id = je.source_doc_id
   AND je.source_type = 'RCT'
  WHERE je.company_id = p_company_id;
$function$;

CREATE OR REPLACE FUNCTION public.journal_read_list(
  p_company_id UUID,
  p_user_id UUID,
  p_limit INTEGER,
  p_cursor_created_at TIMESTAMPTZ,
  p_cursor_id UUID,
  p_q TEXT,
  p_date_from DATE,
  p_date_to DATE,
  p_source_type TEXT,
  p_currency TEXT,
  p_account_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'VALIDATION: limit must be an integer from 1 to 50';
  END IF;
  IF (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'VALIDATION: incomplete journal cursor';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'VALIDATION: invalid date range';
  END IF;
  IF p_source_type IS NOT NULL AND p_source_type NOT IN ('INV','RCT','CN','DN','REV','ADJ','WO') THEN
    RAISE EXCEPTION 'VALIDATION: unsupported journal source type';
  END IF;
  IF p_currency IS NOT NULL AND p_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'VALIDATION: invalid currency';
  END IF;
  IF length(COALESCE(p_q, '')) > 100 OR length(COALESCE(p_account_code, '')) > 30 THEN
    RAISE EXCEPTION 'VALIDATION: search value is too long';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.company_id = p_company_id AND ur.user_id = p_user_id
      AND ur.is_active = true
      AND ur.role IN ('AR Supervisor', 'Finance Manager', 'Auditor')
  ) THEN
    RAISE EXCEPTION 'AUTH: journal read access is not permitted';
  END IF;

  WITH filtered AS MATERIALIZED (
    SELECT source.*
    FROM public.journal_read_source(p_company_id) source
    WHERE (p_q IS NULL OR position(lower(p_q) IN lower(
      concat_ws(' ', source.je_no, source.source_doc_no, source.description)
    )) > 0)
      AND (p_date_from IS NULL OR source.je_date >= p_date_from)
      AND (p_date_to IS NULL OR source.je_date <= p_date_to)
      AND (p_source_type IS NULL OR source.source_type = p_source_type)
      AND (p_currency IS NULL OR source.currency = p_currency)
      AND (p_account_code IS NULL OR EXISTS (
        SELECT 1
        FROM public.journal_entry_lines line
        JOIN public.gl_accounts account
          ON account.id = line.gl_account_id
         AND account.company_id = p_company_id
        WHERE line.je_id = source.id
          AND lower(account.account_code) = lower(p_account_code)
      ))
      AND (
        p_cursor_created_at IS NULL
        OR source.created_at < p_cursor_created_at
        OR (source.created_at = p_cursor_created_at AND source.id < p_cursor_id)
      )
    ORDER BY source.created_at DESC, source.id DESC
    LIMIT p_limit + 1
  ), page_rows AS (
    SELECT * FROM filtered ORDER BY created_at DESC, id DESC LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', p.id,
      'je_no', p.je_no,
      'je_date', p.je_date,
      'posting_period', p.posting_period,
      'source_type', p.source_type,
      'source_doc_no', p.source_doc_no,
      'source_doc_id', p.source_doc_id,
      'description', p.description,
      'currency', p.currency,
      'base_currency', p.base_currency,
      'total_debit', p.total_debit,
      'total_credit', p.total_credit,
      'is_balanced', p.is_balanced,
      'is_reversal', p.is_reversal,
      'created_at', p.created_at,
      'created_by', p.created_by,
      'line_count', p.line_count,
      'source', p.source_link
    ) ORDER BY p.created_at DESC, p.id DESC) FROM page_rows p), '[]'::JSONB),
    'has_more', (SELECT COUNT(*) > p_limit FROM filtered)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.journal_read_detail(
  p_company_id UUID,
  p_user_id UUID,
  p_journal_entry_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.company_id = p_company_id AND ur.user_id = p_user_id
      AND ur.is_active = true
      AND ur.role IN ('AR Supervisor', 'Finance Manager', 'Auditor')
  ) THEN
    RAISE EXCEPTION 'AUTH: journal read access is not permitted';
  END IF;

  SELECT jsonb_build_object(
    'id', source.id,
    'je_no', source.je_no,
    'je_date', source.je_date,
    'posting_period', source.posting_period,
    'source_type', source.source_type,
    'source_doc_no', source.source_doc_no,
    'source_doc_id', source.source_doc_id,
    'description', source.description,
    'currency', source.currency,
    'exchange_rate', source.exchange_rate,
    'base_currency', source.base_currency,
    'total_debit', source.total_debit,
    'total_credit', source.total_credit,
    'is_balanced', source.is_balanced,
    'is_reversal', source.is_reversal,
    'original_je_id', source.original_je_id,
    'is_reversed', source.is_reversed,
    'reversal_je_id', source.reversal_je_id,
    'created_at', source.created_at,
    'created_by', source.created_by,
    'line_count', source.line_count,
    'source', source.source_link,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', line.id,
        'line_no', line.line_no,
        'gl_account_id', line.gl_account_id,
        'account_code', account.account_code,
        'account_name', account.account_name,
        'account_type', account.account_type,
        'description', line.description,
        'debit_amount', line.debit_amount::TEXT,
        'credit_amount', line.credit_amount::TEXT,
        'base_debit', line.base_debit::TEXT,
        'base_credit', line.base_credit::TEXT,
        'currency', line.currency::TEXT,
        'original_amount', line.original_amount::TEXT,
        'created_at', line.created_at
      ) ORDER BY line.line_no, line.id)
      FROM public.journal_entry_lines line
      JOIN public.gl_accounts account
        ON account.id = line.gl_account_id
       AND account.company_id = p_company_id
      WHERE line.je_id = source.id
    ), '[]'::JSONB)
  ) INTO v_result
  FROM public.journal_read_source(p_company_id) source
  WHERE source.id = p_journal_entry_id;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_read_source(p_company_id UUID)
RETURNS TABLE (
  event_id TEXT,
  occurred_at TIMESTAMPTZ,
  actor_type TEXT,
  actor_user_id UUID,
  actor_role TEXT,
  action TEXT,
  entity_type TEXT,
  entity_id UUID,
  entity_number TEXT,
  result TEXT,
  summary TEXT,
  metadata JSONB,
  source_kind TEXT,
  search_text TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT 'invoice_created:' || i.id, i.created_at,
    CASE WHEN i.created_by IS NULL THEN 'unknown' ELSE 'user' END, i.created_by, NULL::TEXT,
    'created', CASE i.doc_type WHEN 'Credit Note' THEN 'credit_note' WHEN 'Debit Note' THEN 'debit_note' ELSE 'invoice' END,
    i.id, i.invoice_no::TEXT, i.status::TEXT,
    i.doc_type::TEXT || ' ' || i.invoice_no::TEXT || ' was created.',
    jsonb_build_object('document_type', i.doc_type, 'status', i.status),
    'invoice', i.invoice_no::TEXT
  FROM public.invoices i WHERE i.company_id = p_company_id
  UNION ALL
  SELECT 'invoice_posted:' || i.id, i.posted_at,
    CASE WHEN i.posted_by IS NULL THEN 'unknown' ELSE 'user' END, i.posted_by, NULL::TEXT,
    'posted', CASE i.doc_type WHEN 'Credit Note' THEN 'credit_note' WHEN 'Debit Note' THEN 'debit_note' ELSE 'invoice' END,
    i.id, i.invoice_no::TEXT, i.status::TEXT,
    i.doc_type::TEXT || ' ' || i.invoice_no::TEXT || ' was posted.',
    jsonb_build_object('document_type', i.doc_type, 'status', i.status),
    'invoice', i.invoice_no::TEXT
  FROM public.invoices i WHERE i.company_id = p_company_id AND i.posted_at IS NOT NULL
  UNION ALL
  SELECT 'invoice_cancelled:' || i.id, i.cancelled_at,
    CASE WHEN i.cancelled_by IS NULL THEN 'unknown' ELSE 'user' END, i.cancelled_by, NULL::TEXT,
    'cancelled', CASE i.doc_type WHEN 'Credit Note' THEN 'credit_note' WHEN 'Debit Note' THEN 'debit_note' ELSE 'invoice' END,
    i.id, i.invoice_no::TEXT, i.status::TEXT,
    i.doc_type::TEXT || ' ' || i.invoice_no::TEXT || ' was cancelled.',
    jsonb_strip_nulls(jsonb_build_object('document_type', i.doc_type, 'status', i.status, 'reason', left(i.cancel_reason, 500))),
    'invoice', i.invoice_no::TEXT
  FROM public.invoices i WHERE i.company_id = p_company_id AND i.cancelled_at IS NOT NULL
  UNION ALL
  SELECT 'receipt_created:' || r.id, r.created_at,
    CASE WHEN r.created_by IS NULL THEN 'unknown' ELSE 'user' END, r.created_by, NULL::TEXT,
    'created', 'receipt', r.id, r.receipt_no::TEXT, r.status::TEXT,
    'Receipt ' || r.receipt_no::TEXT || ' was created.',
    jsonb_build_object('status', r.status), 'receipt', r.receipt_no::TEXT
  FROM public.receipts r WHERE r.company_id = p_company_id
  UNION ALL
  SELECT 'receipt_posted:' || r.id, r.posted_at,
    CASE WHEN r.posted_by IS NULL THEN 'unknown' ELSE 'user' END, r.posted_by, NULL::TEXT,
    'posted', 'receipt', r.id, r.receipt_no::TEXT, r.status::TEXT,
    'Receipt ' || r.receipt_no::TEXT || ' was posted.',
    jsonb_build_object('status', r.status), 'receipt', r.receipt_no::TEXT
  FROM public.receipts r WHERE r.company_id = p_company_id AND r.posted_at IS NOT NULL
  UNION ALL
  SELECT 'receipt_cancelled:' || r.id, r.cancelled_at,
    CASE WHEN r.cancelled_by IS NULL THEN 'unknown' ELSE 'user' END, r.cancelled_by, NULL::TEXT,
    'cancelled', 'receipt', r.id, r.receipt_no::TEXT, r.status::TEXT,
    'Receipt ' || r.receipt_no::TEXT || ' was cancelled.',
    jsonb_strip_nulls(jsonb_build_object('status', r.status, 'reason', left(r.cancel_reason, 500))),
    'receipt', r.receipt_no::TEXT
  FROM public.receipts r WHERE r.company_id = p_company_id AND r.cancelled_at IS NOT NULL
  UNION ALL
  SELECT 'allocation_created:' || a.id, a.allocation_date,
    CASE WHEN a.allocated_by IS NULL THEN 'unknown' ELSE 'user' END, a.allocated_by, NULL::TEXT,
    'allocated', 'allocation', a.id, receipt.receipt_no::TEXT, a.status::TEXT,
    'Receipt ' || receipt.receipt_no::TEXT || ' was allocated to ' || invoice.invoice_no::TEXT || '.',
    jsonb_build_object('receipt_number', receipt.receipt_no, 'invoice_number', invoice.invoice_no,
      'amount', a.allocated_amount::TEXT, 'method', a.allocation_method, 'status', a.status),
    'allocation', receipt.receipt_no::TEXT || ' ' || invoice.invoice_no::TEXT
  FROM public.allocation_details a
  JOIN public.receipts receipt ON receipt.id = a.receipt_id AND receipt.company_id = p_company_id
  JOIN public.invoices invoice ON invoice.id = a.invoice_id AND invoice.company_id = p_company_id
  UNION ALL
  SELECT 'allocation_reversed:' || a.id, a.reversed_at,
    CASE WHEN a.reversed_by IS NULL THEN 'unknown' ELSE 'user' END, a.reversed_by, NULL::TEXT,
    'reversed', 'allocation', a.id, receipt.receipt_no::TEXT, a.status::TEXT,
    'Allocation from ' || receipt.receipt_no::TEXT || ' to ' || invoice.invoice_no::TEXT || ' was reversed.',
    jsonb_strip_nulls(jsonb_build_object('receipt_number', receipt.receipt_no, 'invoice_number', invoice.invoice_no,
      'amount', a.allocated_amount::TEXT, 'method', a.allocation_method, 'status', a.status, 'reason', left(a.reverse_reason, 500))),
    'allocation', receipt.receipt_no::TEXT || ' ' || invoice.invoice_no::TEXT
  FROM public.allocation_details a
  JOIN public.receipts receipt ON receipt.id = a.receipt_id AND receipt.company_id = p_company_id
  JOIN public.invoices invoice ON invoice.id = a.invoice_id AND invoice.company_id = p_company_id
  WHERE a.reversed_at IS NOT NULL
  UNION ALL
  SELECT 'cnalloc_created:' || a.id, a.allocation_date,
    CASE WHEN a.allocated_by IS NULL THEN 'unknown' ELSE 'user' END, a.allocated_by, NULL::TEXT,
    'allocated', 'credit_note_allocation', a.id, cn.invoice_no::TEXT, a.status::TEXT,
    'Credit Note ' || cn.invoice_no::TEXT || ' was allocated to ' || invoice.invoice_no::TEXT || '.',
    jsonb_build_object('credit_note_number', cn.invoice_no, 'invoice_number', invoice.invoice_no,
      'amount', a.allocated_amount::TEXT, 'status', a.status),
    'credit_note_allocation', cn.invoice_no::TEXT || ' ' || invoice.invoice_no::TEXT
  FROM public.cn_allocations a
  JOIN public.invoices cn ON cn.id = a.cn_id AND cn.company_id = p_company_id AND cn.doc_type = 'Credit Note'
  JOIN public.invoices invoice ON invoice.id = a.invoice_id AND invoice.company_id = p_company_id
  UNION ALL
  SELECT 'cnalloc_reversed:' || a.id, a.reversed_at,
    CASE WHEN a.reversed_by IS NULL THEN 'unknown' ELSE 'user' END, a.reversed_by, NULL::TEXT,
    'reversed', 'credit_note_allocation', a.id, cn.invoice_no::TEXT, a.status::TEXT,
    'Credit Note allocation from ' || cn.invoice_no::TEXT || ' to ' || invoice.invoice_no::TEXT || ' was reversed.',
    jsonb_strip_nulls(jsonb_build_object('credit_note_number', cn.invoice_no, 'invoice_number', invoice.invoice_no,
      'amount', a.allocated_amount::TEXT, 'status', a.status, 'reason', left(a.reverse_reason, 500))),
    'credit_note_allocation', cn.invoice_no::TEXT || ' ' || invoice.invoice_no::TEXT
  FROM public.cn_allocations a
  JOIN public.invoices cn ON cn.id = a.cn_id AND cn.company_id = p_company_id AND cn.doc_type = 'Credit Note'
  JOIN public.invoices invoice ON invoice.id = a.invoice_id AND invoice.company_id = p_company_id
  WHERE a.reversed_at IS NOT NULL
  UNION ALL
  SELECT 'journal_created:' || je.id, je.created_at,
    CASE WHEN je.created_by IS NULL THEN 'unknown' ELSE 'user' END, je.created_by, NULL::TEXT,
    'generated', 'journal_entry', je.id, je.je_no::TEXT, 'balanced',
    'Journal Entry ' || je.je_no::TEXT || ' was generated.',
    jsonb_build_object('source_type', je.source_type, 'source_document_number', je.source_doc_no,
      'currency', je.currency, 'total_debit', je.total_debit::TEXT,
      'total_credit', je.total_credit::TEXT, 'is_reversal', je.is_reversal),
    'journal_entry', je.je_no::TEXT || ' ' || je.source_doc_no::TEXT
  FROM public.journal_entries je WHERE je.company_id = p_company_id
  UNION ALL
  SELECT 'customer_changed:' || log.id, log.changed_at,
    CASE WHEN log.changed_by IS NULL THEN 'unknown' ELSE 'user' END, log.changed_by, NULL::TEXT,
    'field_changed', 'customer', customer.id, customer.customer_id::TEXT, NULL::TEXT,
    'Customer ' || customer.customer_id::TEXT || ' field ' || log.field_name::TEXT || ' changed.',
    CASE WHEN log.field_name IN ('status','customer_type','default_currency','credit_rating','e_invoice_enabled','is_hidden','payment_term_id','customer_group_id')
      THEN jsonb_strip_nulls(jsonb_build_object('field_name', log.field_name,
        'old_value', left(log.old_value, 200), 'new_value', left(log.new_value, 200),
        'value_redacted', false, 'change_reason_redacted', log.change_reason IS NOT NULL))
      ELSE jsonb_build_object('field_name', log.field_name, 'value_redacted', true,
        'change_reason_redacted', log.change_reason IS NOT NULL)
    END,
    'customer_change_log', customer.customer_id::TEXT
  FROM public.customer_change_logs log
  JOIN public.customers customer ON customer.id = log.customer_id AND customer.company_id = p_company_id
  UNION ALL
  SELECT 'credit_control:' || log.id, log.created_at,
    CASE WHEN log.created_by IS NULL THEN 'unknown' ELSE 'user' END, log.created_by, NULL::TEXT,
    'credit_control_action', 'customer', customer.id, customer.customer_id::TEXT, NULL::TEXT,
    'Credit control action recorded for customer ' || customer.customer_id::TEXT || '.',
    jsonb_strip_nulls(jsonb_build_object('action', log.action, 'amount', log.amount::TEXT,
      'approved', log.approved_at IS NOT NULL)),
    'credit_control_log', customer.customer_id::TEXT
  FROM public.credit_control_logs log
  JOIN public.customers customer ON customer.id = log.customer_id AND customer.company_id = p_company_id
  WHERE log.company_id = p_company_id
  UNION ALL
  SELECT 'report_generated:' || log.id, log.generated_at,
    CASE WHEN log.generated_by IS NULL THEN 'unknown' ELSE 'user' END, log.generated_by, NULL::TEXT,
    'generated', 'report', log.id, log.report_type::TEXT, NULL::TEXT,
    'Report ' || log.report_type::TEXT || ' was generated.',
    jsonb_strip_nulls(jsonb_build_object('report_type', log.report_type, 'export_format', log.export_format)),
    'report_audit_log', log.report_type::TEXT
  FROM public.report_audit_logs log WHERE log.company_id = p_company_id
  UNION ALL
  SELECT 'automation_event:' || event.id, event.created_at,
    CASE
      WHEN event.actor_type = 'user' AND event.actor_user_id IS NOT NULL THEN 'user'
      WHEN event.actor_type <> 'user' THEN 'system'
      ELSE 'unknown'
    END,
    CASE WHEN event.actor_type = 'user' THEN event.actor_user_id ELSE NULL END,
    NULL::TEXT, event.event_type, 'automation', event.entity_id, NULL::TEXT,
    COALESCE(event.safe_metadata->>'status', event.safe_metadata->>'lifecycle_status'),
    CASE event.event_type
      WHEN 'automation_commands_insert' THEN 'Automation command was created.'
      WHEN 'automation_commands_update' THEN 'Automation command state changed.'
      WHEN 'automation_exceptions_insert' THEN 'Automation exception was opened.'
      WHEN 'automation_exceptions_update' THEN 'Automation exception state changed.'
      WHEN 'automation_exception_recovery_recorded' THEN 'Governed exception recovery was recorded.'
      WHEN 'automation_exception_matching_completed' THEN 'Exception matching completed.'
      WHEN 'sales_representative_assigned' THEN 'Sales Representative assignment was recorded.'
    END,
    jsonb_strip_nulls(jsonb_build_object(
      'status', left(event.safe_metadata->>'status', 64),
      'reason_code', left(event.safe_metadata->>'reason_code', 64),
      'lifecycle_status', left(event.safe_metadata->>'lifecycle_status', 64),
      'action', left(event.safe_metadata->>'action', 64),
      'invoice_id', left(event.safe_metadata->>'invoice_id', 36),
      'receipt_id', left(event.safe_metadata->>'receipt_id', 36)
    )),
    'automation_audit_event', ''::TEXT
  FROM public.automation_audit_events event
  WHERE event.company_id = p_company_id
    AND event.event_type IN (
      'automation_commands_insert','automation_commands_update',
      'automation_exceptions_insert','automation_exceptions_update',
      'automation_exception_recovery_recorded','automation_exception_matching_completed',
      'sales_representative_assigned'
    )
  UNION ALL
  SELECT 'reminder_created:' || reminder.id, reminder.created_at,
    'unknown', NULL::UUID, NULL::TEXT, 'evaluated', 'reminder', reminder.id,
    reminder.invoice_no_snapshot, reminder.status,
    'Reminder stage was evaluated for Invoice ' || reminder.invoice_no_snapshot || '.',
    jsonb_build_object('invoice_number', reminder.invoice_no_snapshot,
      'stage_offset_days', reminder.stage_offset_days, 'scheduled_for', reminder.scheduled_for,
      'status', reminder.status, 'currency', reminder.currency_snapshot,
      'outstanding', reminder.outstanding_snapshot::TEXT),
    'invoice_reminder', reminder.invoice_no_snapshot
  FROM public.invoice_reminders reminder WHERE reminder.company_id = p_company_id
  UNION ALL
  SELECT 'reminder_delivery:' || attempt.id, COALESCE(attempt.completed_at, attempt.started_at, attempt.created_at),
    'unknown', NULL::UUID, NULL::TEXT, 'delivery_attempted', 'reminder_delivery', attempt.id,
    reminder.invoice_no_snapshot, attempt.status,
    'Reminder delivery attempt was recorded for Invoice ' || reminder.invoice_no_snapshot || '.',
    jsonb_strip_nulls(jsonb_build_object('invoice_number', reminder.invoice_no_snapshot,
      'provider_type', attempt.provider_type, 'attempt_number', attempt.attempt_number,
      'status', attempt.status, 'error_class', attempt.error_class,
      'error_code', left(attempt.redacted_error_code, 64))),
    'reminder_delivery_attempt', reminder.invoice_no_snapshot
  FROM public.reminder_delivery_attempts attempt
  JOIN public.invoice_reminders reminder ON reminder.id = attempt.reminder_id AND reminder.company_id = p_company_id
  WHERE attempt.company_id = p_company_id
  UNION ALL
  SELECT 'fx_decision:' || event.id, event.event_at,
    CASE WHEN event.actor_user_id IS NULL THEN 'unknown' ELSE 'user' END,
    event.actor_user_id, left(event.actor_role, 50),
    lower(regexp_replace(event.event_type, '([a-z0-9])([A-Z])', '\1_\2', 'g')),
    'fx_booking_decision', event.decision_id,
    COALESCE(invoice.invoice_no::TEXT, receipt.receipt_no::TEXT), event.new_approval_status,
    'FX booking decision event ' || event.event_type || ' was recorded.',
    jsonb_strip_nulls(jsonb_build_object('event_type', event.event_type,
      'decision_version', event.decision_version, 'prior_status', event.prior_approval_status,
      'new_status', event.new_approval_status, 'source_category', event.source_category,
      'selected_rate', event.selected_rate::TEXT, 'final_rate', event.final_rate::TEXT)),
    'fx_booking_decision_event', COALESCE(invoice.invoice_no::TEXT, receipt.receipt_no::TEXT, '')
  FROM public.fx_booking_rate_decision_events event
  LEFT JOIN public.invoices invoice ON invoice.id = event.invoice_id AND invoice.company_id = p_company_id
  LEFT JOIN public.receipts receipt ON receipt.id = event.receipt_id AND receipt.company_id = p_company_id
  WHERE event.company_id = p_company_id AND event.decision_id IS NOT NULL
  UNION ALL
  SELECT 'import_created:' || batch.id, batch.created_at,
    CASE WHEN batch.created_by IS NULL THEN 'unknown' ELSE 'user' END, batch.created_by, NULL::TEXT,
    'created', 'import_batch', batch.id, batch.id::TEXT, batch.status::TEXT,
    'Import batch was created.',
    jsonb_build_object('import_type', batch.import_type, 'status', batch.status,
      'total_rows', batch.total_rows, 'valid_rows', batch.valid_rows, 'error_rows', batch.error_rows,
      'created_count', batch.created_count, 'posted_count', batch.posted_count,
      'allocated_count', batch.allocated_count, 'skipped_count', batch.skipped_count,
      'unmatched_count', batch.unmatched_count),
    'import_batch', batch.id::TEXT
  FROM public.import_batches batch WHERE batch.company_id = p_company_id
  UNION ALL
  SELECT 'import_completed:' || batch.id, batch.completed_at,
    'unknown', NULL::UUID, NULL::TEXT, 'completed', 'import_batch', batch.id,
    batch.id::TEXT, batch.status::TEXT, 'Import batch completed.',
    jsonb_build_object('import_type', batch.import_type, 'status', batch.status,
      'total_rows', batch.total_rows, 'valid_rows', batch.valid_rows, 'error_rows', batch.error_rows,
      'created_count', batch.created_count, 'posted_count', batch.posted_count,
      'allocated_count', batch.allocated_count, 'skipped_count', batch.skipped_count,
      'unmatched_count', batch.unmatched_count),
    'import_batch', batch.id::TEXT
  FROM public.import_batches batch WHERE batch.company_id = p_company_id AND batch.completed_at IS NOT NULL
  UNION ALL
  SELECT 'import_cancelled:' || batch.id, batch.cancelled_at,
    CASE WHEN batch.cancelled_by IS NULL THEN 'unknown' ELSE 'user' END, batch.cancelled_by, NULL::TEXT,
    'cancelled', 'import_batch', batch.id, batch.id::TEXT, batch.status::TEXT,
    'Import batch was cancelled.',
    jsonb_build_object('import_type', batch.import_type, 'status', batch.status,
      'total_rows', batch.total_rows, 'valid_rows', batch.valid_rows, 'error_rows', batch.error_rows,
      'created_count', batch.created_count, 'posted_count', batch.posted_count,
      'allocated_count', batch.allocated_count, 'skipped_count', batch.skipped_count,
      'unmatched_count', batch.unmatched_count),
    'import_batch', batch.id::TEXT
  FROM public.import_batches batch WHERE batch.company_id = p_company_id AND batch.cancelled_at IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.audit_read_list(
  p_company_id UUID,
  p_user_id UUID,
  p_limit INTEGER,
  p_cursor_occurred_at TIMESTAMPTZ,
  p_cursor_event_id TEXT,
  p_date_from DATE,
  p_date_to DATE,
  p_action TEXT,
  p_entity_type TEXT,
  p_actor_type TEXT,
  p_actor_user_id UUID,
  p_result TEXT,
  p_q TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'VALIDATION: limit must be an integer from 1 to 50';
  END IF;
  IF (p_cursor_occurred_at IS NULL) <> (p_cursor_event_id IS NULL) THEN
    RAISE EXCEPTION 'VALIDATION: incomplete audit cursor';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'VALIDATION: invalid date range';
  END IF;
  IF p_actor_type IS NOT NULL AND p_actor_type NOT IN ('user','system','unknown') THEN
    RAISE EXCEPTION 'VALIDATION: unsupported actor type';
  END IF;
  IF length(COALESCE(p_q, '')) > 100 OR length(COALESCE(p_action, '')) > 50
    OR length(COALESCE(p_entity_type, '')) > 50 OR length(COALESCE(p_result, '')) > 50 THEN
    RAISE EXCEPTION 'VALIDATION: audit filter is too long';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.company_id = p_company_id AND ur.user_id = p_user_id
      AND ur.is_active = true AND ur.role IN ('Finance Manager', 'Auditor')
  ) THEN
    RAISE EXCEPTION 'AUTH: audit read access is not permitted';
  END IF;

  WITH filtered AS MATERIALIZED (
    SELECT event.* FROM public.audit_read_source(p_company_id) event
    WHERE (p_date_from IS NULL OR event.occurred_at >= p_date_from::TIMESTAMPTZ)
      AND (p_date_to IS NULL OR event.occurred_at < (p_date_to + 1)::TIMESTAMPTZ)
      AND (p_action IS NULL OR event.action = p_action)
      AND (p_entity_type IS NULL OR event.entity_type = p_entity_type)
      AND (p_actor_type IS NULL OR event.actor_type = p_actor_type)
      AND (p_actor_user_id IS NULL OR event.actor_user_id = p_actor_user_id)
      AND (p_result IS NULL OR lower(event.result) = p_result)
      AND (p_q IS NULL OR position(lower(p_q) IN lower(COALESCE(event.search_text, ''))) > 0)
      AND (
        p_cursor_occurred_at IS NULL
        OR event.occurred_at < p_cursor_occurred_at
        OR (event.occurred_at = p_cursor_occurred_at AND event.event_id < p_cursor_event_id)
      )
    ORDER BY event.occurred_at DESC, event.event_id DESC
    LIMIT p_limit + 1
  ), page_rows AS (
    SELECT * FROM filtered ORDER BY occurred_at DESC, event_id DESC LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'event_id', p.event_id,
      'occurred_at', p.occurred_at,
      'actor', jsonb_build_object('type', p.actor_type, 'user_id', p.actor_user_id,
        'display_name', NULL, 'role', p.actor_role),
      'action', p.action,
      'entity_type', p.entity_type,
      'entity_id', p.entity_id,
      'entity_number', p.entity_number,
      'result', p.result,
      'summary', p.summary,
      'metadata', p.metadata,
      'source_kind', p.source_kind
    ) ORDER BY p.occurred_at DESC, p.event_id DESC) FROM page_rows p), '[]'::JSONB),
    'has_more', (SELECT COUNT(*) > p_limit FROM filtered)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_read_detail(
  p_company_id UUID,
  p_user_id UUID,
  p_event_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.company_id = p_company_id AND ur.user_id = p_user_id
      AND ur.is_active = true AND ur.role IN ('Finance Manager', 'Auditor')
  ) THEN
    RAISE EXCEPTION 'AUTH: audit read access is not permitted';
  END IF;
  SELECT jsonb_build_object(
    'event_id', event.event_id,
    'occurred_at', event.occurred_at,
    'actor', jsonb_build_object('type', event.actor_type, 'user_id', event.actor_user_id,
      'display_name', NULL, 'role', event.actor_role),
    'action', event.action,
    'entity_type', event.entity_type,
    'entity_id', event.entity_id,
    'entity_number', event.entity_number,
    'result', event.result,
    'summary', event.summary,
    'metadata', event.metadata,
    'source_kind', event.source_kind
  ) INTO v_result
  FROM public.audit_read_source(p_company_id) event
  WHERE event.event_id = p_event_id;
  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.journal_read_source(UUID) OWNER TO postgres;
ALTER FUNCTION public.journal_read_list(UUID,UUID,INTEGER,TIMESTAMPTZ,UUID,TEXT,DATE,DATE,TEXT,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.journal_read_detail(UUID,UUID,UUID) OWNER TO postgres;
ALTER FUNCTION public.audit_read_source(UUID) OWNER TO postgres;
ALTER FUNCTION public.audit_read_list(UUID,UUID,INTEGER,TIMESTAMPTZ,TEXT,DATE,DATE,TEXT,TEXT,TEXT,UUID,TEXT,TEXT) OWNER TO postgres;
ALTER FUNCTION public.audit_read_detail(UUID,UUID,TEXT) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.journal_read_source(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.journal_read_list(UUID,UUID,INTEGER,TIMESTAMPTZ,UUID,TEXT,DATE,DATE,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.journal_read_detail(UUID,UUID,UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.audit_read_source(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.audit_read_list(UUID,UUID,INTEGER,TIMESTAMPTZ,TEXT,DATE,DATE,TEXT,TEXT,TEXT,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.audit_read_detail(UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.journal_read_list(UUID,UUID,INTEGER,TIMESTAMPTZ,UUID,TEXT,DATE,DATE,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.journal_read_detail(UUID,UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_read_list(UUID,UUID,INTEGER,TIMESTAMPTZ,TEXT,DATE,DATE,TEXT,TEXT,TEXT,UUID,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_read_detail(UUID,UUID,TEXT) TO service_role;

COMMENT ON FUNCTION public.journal_read_list(UUID,UUID,INTEGER,TIMESTAMPTZ,UUID,TEXT,DATE,DATE,TEXT,TEXT,TEXT)
  IS 'Service-role-only, company-scoped, role-governed, keyset-paginated Journal Entry read model.';
COMMENT ON FUNCTION public.audit_read_list(UUID,UUID,INTEGER,TIMESTAMPTZ,TEXT,DATE,DATE,TEXT,TEXT,TEXT,UUID,TEXT,TEXT)
  IS 'Service-role-only, company-scoped, role-governed Audit Trail read model over authoritative stored evidence with allow-listed metadata.';

COMMIT;
