-- Gate E: Autonomous AR Operations
-- Forward-only foundation. This migration installs no scheduler, performs no
-- financial-row backfill, and leaves every real provider and mutation switch off.

BEGIN;

CREATE OR REPLACE FUNCTION public.automation_valid_reminder_offsets(
  p_offsets INTEGER[]
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT cardinality(p_offsets) BETWEEN 1 AND 10
    AND NOT EXISTS (
      SELECT 1 FROM unnest(p_offsets) value
      WHERE value < -90 OR value > 0
    )
    AND cardinality(p_offsets) = (
      SELECT count(DISTINCT value) FROM unnest(p_offsets) value
    );
$$;

-- ---------------------------------------------------------------------------
-- Tenant-scoped people, ownership, configuration, and provider connections
-- ---------------------------------------------------------------------------

CREATE TABLE public.sales_representatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  email TEXT NULL,
  phone TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL,
  updated_by UUID NULL,
  CONSTRAINT chk_sales_representative_name
    CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT chk_sales_representative_email
    CHECK (
      email IS NULL
      OR (
        email = lower(btrim(email))
        AND length(email) <= 254
        AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      )
    ),
  CONSTRAINT chk_sales_representative_phone
    CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT chk_active_sales_representative_email
    CHECK (NOT is_active OR email IS NOT NULL)
);

CREATE UNIQUE INDEX uq_sales_representatives_company_email
  ON public.sales_representatives(company_id, email)
  WHERE email IS NOT NULL;
CREATE INDEX idx_sales_representatives_company_active
  ON public.sales_representatives(company_id, is_active, name, id);
CREATE TRIGGER trg_sales_representatives_updated_at
  BEFORE UPDATE ON public.sales_representatives
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.customer_sales_representative_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  sales_representative_id UUID NOT NULL
    REFERENCES public.sales_representatives(id) ON DELETE RESTRICT,
  assignment_source TEXT NOT NULL,
  assigned_by UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assignment_reason TEXT NOT NULL,
  superseded_at TIMESTAMPTZ NULL,
  superseded_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_customer_sales_assignment_source CHECK (
    assignment_source IN (
      'customer_acquisition',
      'customer_onboarding',
      'manual_assignment',
      'import'
    )
  ),
  CONSTRAINT chk_customer_sales_assignment_reason
    CHECK (length(btrim(assignment_reason)) BETWEEN 1 AND 500),
  CONSTRAINT chk_customer_sales_assignment_superseded CHECK (
    (superseded_at IS NULL AND superseded_by IS NULL)
    OR (superseded_at IS NOT NULL AND superseded_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_customer_sales_assignment_current
  ON public.customer_sales_representative_assignments(company_id, customer_id)
  WHERE superseded_at IS NULL;
CREATE INDEX idx_customer_sales_assignment_history
  ON public.customer_sales_representative_assignments(
    company_id, customer_id, assigned_at DESC, id DESC
  );
CREATE INDEX idx_customer_sales_assignment_representative
  ON public.customer_sales_representative_assignments(
    company_id, sales_representative_id
  ) WHERE superseded_at IS NULL;

CREATE TABLE public.automation_settings (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE RESTRICT,
  automation_actor_user_id UUID NULL,
  operating_mode TEXT NOT NULL DEFAULT 'disabled',
  mailbox_sync_enabled BOOLEAN NOT NULL DEFAULT false,
  document_intelligence_enabled BOOLEAN NOT NULL DEFAULT false,
  invoice_automation_enabled BOOLEAN NOT NULL DEFAULT false,
  receipt_automation_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_allocation_enabled BOOLEAN NOT NULL DEFAULT false,
  reminder_evaluation_enabled BOOLEAN NOT NULL DEFAULT false,
  reminder_delivery_enabled BOOLEAN NOT NULL DEFAULT false,
  reminder_stage_offsets INTEGER[] NOT NULL DEFAULT ARRAY[-3, 0]::INTEGER[],
  reminder_timezone TEXT NOT NULL DEFAULT 'UTC',
  extraction_schema_version INTEGER NOT NULL DEFAULT 1,
  minimum_overall_confidence NUMERIC(5,4) NOT NULL DEFAULT 0.9500,
  minimum_critical_confidence NUMERIC(5,4) NOT NULL DEFAULT 0.9900,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL,
  updated_by UUID NULL,
  CONSTRAINT chk_automation_operating_mode CHECK (
    operating_mode IN ('disabled', 'observe_only', 'draft_only', 'straight_through')
  ),
  CONSTRAINT chk_automation_reminder_stages CHECK (
    public.automation_valid_reminder_offsets(reminder_stage_offsets)
  ),
  CONSTRAINT chk_automation_schema_version CHECK (extraction_schema_version > 0),
  CONSTRAINT chk_automation_confidence CHECK (
    minimum_overall_confidence BETWEEN 0 AND 1
    AND minimum_critical_confidence BETWEEN 0 AND 1
  ),
  CONSTRAINT chk_straight_through_explicit_switches CHECK (
    operating_mode <> 'straight_through'
    OR (
      document_intelligence_enabled
      AND (invoice_automation_enabled OR receipt_automation_enabled)
    )
  ),
  CONSTRAINT chk_enabled_mode_has_actor CHECK (
    operating_mode = 'disabled' OR automation_actor_user_id IS NOT NULL
  ),
  CONSTRAINT chk_observe_only_no_delivery CHECK (
    operating_mode <> 'observe_only' OR NOT reminder_delivery_enabled
  )
);

CREATE TABLE public.automation_mailboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  provider_type TEXT NOT NULL,
  mailbox_address TEXT NOT NULL,
  default_bank_account_id UUID NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  connection_status TEXT NOT NULL DEFAULT 'disabled',
  ingestion_secret_ref TEXT NULL,
  delivery_secret_ref TEXT NULL,
  ingestion_token_expires_at TIMESTAMPTZ NULL,
  delivery_token_expires_at TIMESTAMPTZ NULL,
  incremental_cursor TEXT NULL,
  cursor_kind TEXT NULL,
  last_successful_sync_at TIMESTAMPTZ NULL,
  last_failed_sync_at TIMESTAMPTZ NULL,
  reconnect_required BOOLEAN NOT NULL DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  ingestion_enabled BOOLEAN NOT NULL DEFAULT false,
  delivery_enabled BOOLEAN NOT NULL DEFAULT false,
  redacted_error_code TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL,
  updated_by UUID NULL,
  CONSTRAINT chk_automation_mailbox_provider
    CHECK (provider_type IN ('gmail', 'microsoft')),
  CONSTRAINT chk_automation_mailbox_address CHECK (
    mailbox_address = lower(btrim(mailbox_address))
    AND length(mailbox_address) <= 254
    AND mailbox_address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  CONSTRAINT chk_automation_mailbox_connection_status CHECK (
    connection_status IN (
      'disabled', 'pending_consent', 'connected', 'reconnect_required', 'error'
    )
  ),
  CONSTRAINT chk_automation_mailbox_cursor_kind CHECK (
    cursor_kind IS NULL
    OR (provider_type = 'gmail' AND cursor_kind = 'history_id')
    OR (provider_type = 'microsoft' AND cursor_kind = 'delta_link')
  ),
  CONSTRAINT chk_automation_mailbox_secret_references CHECK (
    (ingestion_secret_ref IS NULL OR ingestion_secret_ref ~ '^[A-Z][A-Z0-9_]{2,127}$')
    AND (delivery_secret_ref IS NULL OR delivery_secret_ref ~ '^[A-Z][A-Z0-9_]{2,127}$')
  ),
  CONSTRAINT chk_automation_mailbox_enabled_ready CHECK (
    NOT is_enabled
    OR (
      connection_status = 'connected'
      AND ingestion_secret_ref IS NOT NULL
      AND ingestion_token_expires_at IS NOT NULL
      AND NOT reconnect_required
    )
  ),
  CONSTRAINT chk_automation_mailbox_capability_ready CHECK (
    (NOT ingestion_enabled OR (
      connection_status = 'connected'
      AND ingestion_secret_ref IS NOT NULL
      AND ingestion_token_expires_at IS NOT NULL
      AND NOT reconnect_required
    ))
    AND (NOT delivery_enabled OR (
      connection_status = 'connected'
      AND delivery_secret_ref IS NOT NULL
      AND delivery_token_expires_at IS NOT NULL
      AND NOT reconnect_required
    ))
  )
);

CREATE TRIGGER trg_automation_settings_updated_at
  BEFORE UPDATE ON public.automation_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE UNIQUE INDEX uq_automation_mailbox_company_address
  ON public.automation_mailboxes(company_id, provider_type, mailbox_address);
CREATE INDEX idx_automation_mailbox_poll
  ON public.automation_mailboxes(company_id, provider_type, id)
  WHERE is_enabled AND ingestion_enabled AND NOT reconnect_required;
CREATE TRIGGER trg_automation_mailboxes_updated_at
  BEFORE UPDATE ON public.automation_mailboxes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.automation_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES public.automation_mailboxes(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  requested_scopes TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_automation_oauth_provider
    CHECK (provider_type IN ('gmail', 'microsoft')),
  CONSTRAINT chk_automation_oauth_state_hash
    CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_automation_oauth_expiry
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX uq_automation_oauth_state_hash
  ON public.automation_oauth_states(state_hash);
CREATE INDEX idx_automation_oauth_expiry
  ON public.automation_oauth_states(expires_at)
  WHERE consumed_at IS NULL;

-- ---------------------------------------------------------------------------
-- Ingestion, document intelligence, commands, exceptions, reminders, audit
-- ---------------------------------------------------------------------------

CREATE TABLE public.mailbox_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  mailbox_id UUID NOT NULL REFERENCES public.automation_mailboxes(id) ON DELETE RESTRICT,
  provider_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  cursor_before TEXT NULL,
  cursor_after TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  failed_at TIMESTAMPTZ NULL,
  messages_seen INTEGER NOT NULL DEFAULT 0,
  messages_persisted INTEGER NOT NULL DEFAULT 0,
  attachments_persisted INTEGER NOT NULL DEFAULT 0,
  duplicate_messages INTEGER NOT NULL DEFAULT 0,
  duplicate_attachments INTEGER NOT NULL DEFAULT 0,
  attachments_processed INTEGER NOT NULL DEFAULT 0,
  commands_processed INTEGER NOT NULL DEFAULT 0,
  allocations_completed INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  redacted_error_code TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_mailbox_sync_provider CHECK (provider_type IN ('gmail', 'microsoft')),
  CONSTRAINT chk_mailbox_sync_status CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'reconnect_required')
  ),
  CONSTRAINT chk_mailbox_sync_counts CHECK (
    messages_seen >= 0 AND messages_persisted >= 0
    AND attachments_persisted >= 0 AND duplicate_messages >= 0
    AND duplicate_attachments >= 0
    AND attachments_processed >= 0 AND commands_processed >= 0
    AND allocations_completed >= 0 AND failures >= 0
    AND attempt_count BETWEEN 0 AND max_attempts
    AND max_attempts BETWEEN 1 AND 10
  )
);

CREATE INDEX idx_mailbox_sync_runs_list
  ON public.mailbox_sync_runs(company_id, created_at DESC, id DESC);
CREATE INDEX idx_mailbox_sync_runs_pending
  ON public.mailbox_sync_runs(mailbox_id, created_at, id)
  WHERE status IN ('pending', 'failed');

CREATE TABLE public.automation_source_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  mailbox_id UUID NOT NULL REFERENCES public.automation_mailboxes(id) ON DELETE RESTRICT,
  sync_run_id UUID NULL REFERENCES public.mailbox_sync_runs(id) ON DELETE SET NULL,
  provider_type TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  provider_thread_id TEXT NULL,
  internet_message_id TEXT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  sender_address TEXT NULL,
  subject_redacted TEXT NULL,
  mime_type TEXT NULL,
  provider_revision TEXT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_automation_source_message_provider
    CHECK (provider_type IN ('gmail', 'microsoft')),
  CONSTRAINT chk_automation_source_message_id
    CHECK (length(provider_message_id) BETWEEN 1 AND 512),
  CONSTRAINT chk_automation_source_message_status CHECK (
    processing_status IN (
      'received', 'attachments_persisted', 'classified', 'validated',
      'commanded', 'exception', 'ignored'
    )
  )
);

CREATE UNIQUE INDEX uq_automation_source_message_provider
  ON public.automation_source_messages(mailbox_id, provider_message_id);
CREATE INDEX idx_automation_source_message_list
  ON public.automation_source_messages(company_id, received_at DESC, id DESC);

CREATE TABLE public.automation_source_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  mailbox_id UUID NOT NULL REFERENCES public.automation_mailboxes(id) ON DELETE RESTRICT,
  message_id UUID NOT NULL REFERENCES public.automation_source_messages(id) ON DELETE CASCADE,
  provider_attachment_id TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  safe_storage_path TEXT NOT NULL,
  declared_mime_type TEXT NOT NULL,
  detected_mime_type TEXT NOT NULL,
  extension TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  page_count INTEGER NULL,
  scan_status TEXT NOT NULL DEFAULT 'unavailable',
  safety_status TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'pending',
  retention_expires_at TIMESTAMPTZ NOT NULL,
  content_purged_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_automation_attachment_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_automation_attachment_size CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  CONSTRAINT chk_automation_attachment_pages CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 20),
  CONSTRAINT chk_automation_attachment_scan CHECK (
    scan_status IN ('passed', 'rejected', 'quarantined', 'unavailable')
  ),
  CONSTRAINT chk_automation_attachment_safety CHECK (
    safety_status IN ('accepted', 'unsupported', 'unsafe', 'encrypted', 'oversized')
  ),
  CONSTRAINT chk_automation_attachment_processing CHECK (
    processing_status IN ('pending', 'retryable', 'processed')
  ),
  CONSTRAINT chk_automation_attachment_retention CHECK (
    retention_expires_at > created_at
    AND (content_purged_at IS NULL OR content_purged_at >= created_at)
  ),
  CONSTRAINT chk_automation_attachment_storage_path CHECK (
    safe_storage_path ~ '^[0-9a-f-]{36}/automation/[0-9a-f-]{36}/[0-9a-f]{64}\.[a-z0-9]{1,8}$'
  )
);

CREATE UNIQUE INDEX uq_automation_source_attachment_provider
  ON public.automation_source_attachments(message_id, provider_attachment_id);
CREATE UNIQUE INDEX uq_automation_source_attachment_company_sha
  ON public.automation_source_attachments(company_id, sha256);
CREATE INDEX idx_automation_source_attachment_message
  ON public.automation_source_attachments(message_id);
CREATE INDEX idx_automation_source_attachment_retention
  ON public.automation_source_attachments(retention_expires_at, id)
  WHERE content_purged_at IS NULL;
CREATE INDEX idx_automation_source_attachment_processing
  ON public.automation_source_attachments(
    company_id, mailbox_id, created_at, id
  )
  WHERE safety_status = 'accepted'
    AND processing_status IN ('pending', 'retryable')
    AND content_purged_at IS NULL;

CREATE TABLE public.automation_document_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  attachment_id UUID NOT NULL REFERENCES public.automation_source_attachments(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  provider_name TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  provider_version TEXT NOT NULL,
  document_type TEXT NOT NULL,
  confidence NUMERIC(5,4) NOT NULL,
  critical_confidence NUMERIC(5,4) NOT NULL,
  status TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_automation_document_type CHECK (
    document_type IN ('invoice', 'receipt', 'payment_advice', 'unsupported', 'ambiguous')
  ),
  CONSTRAINT chk_automation_classification_confidence CHECK (
    confidence BETWEEN 0 AND 1 AND critical_confidence BETWEEN 0 AND 1
  ),
  CONSTRAINT chk_automation_classification_status CHECK (
    status IN ('proposed', 'accepted', 'rejected')
  ),
  CONSTRAINT chk_automation_classification_schema CHECK (schema_version > 0)
);

CREATE UNIQUE INDEX uq_automation_classification_version
  ON public.automation_document_classifications(attachment_id, schema_version);
CREATE INDEX idx_automation_classification_list
  ON public.automation_document_classifications(company_id, created_at DESC, id DESC);

CREATE TABLE public.automation_extraction_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  classification_id UUID NOT NULL
    REFERENCES public.automation_document_classifications(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  provider_name TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  provider_version TEXT NOT NULL,
  extracted_fields JSONB NOT NULL,
  field_confidence JSONB NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'pending',
  validation_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  customer_id UUID NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  customer_resolution_method TEXT NULL,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_automation_extraction_schema CHECK (schema_version > 0),
  CONSTRAINT chk_automation_extraction_status CHECK (
    validation_status IN ('pending', 'valid', 'invalid', 'ambiguous', 'unsupported')
  ),
  CONSTRAINT chk_automation_customer_resolution_method CHECK (
    customer_resolution_method IS NULL
    OR customer_resolution_method IN (
      'customer_code', 'registration_identifier', 'known_email',
      'invoice_reference', 'unique_normalized_name'
    )
  ),
  CONSTRAINT chk_automation_extracted_fields_object
    CHECK (jsonb_typeof(extracted_fields) = 'object'),
  CONSTRAINT chk_automation_field_confidence_object
    CHECK (jsonb_typeof(field_confidence) = 'object')
);

CREATE UNIQUE INDEX uq_automation_extraction_version
  ON public.automation_extraction_results(classification_id, schema_version);
CREATE INDEX idx_automation_extraction_customer
  ON public.automation_extraction_results(company_id, customer_id)
  WHERE customer_id IS NOT NULL;

CREATE TABLE public.automation_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  mailbox_id UUID NOT NULL REFERENCES public.automation_mailboxes(id) ON DELETE RESTRICT,
  message_id UUID NOT NULL REFERENCES public.automation_source_messages(id) ON DELETE RESTRICT,
  attachment_id UUID NOT NULL REFERENCES public.automation_source_attachments(id) ON DELETE RESTRICT,
  extraction_id UUID NOT NULL REFERENCES public.automation_extraction_results(id) ON DELETE RESTRICT,
  command_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  operating_mode TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  command_payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  resulting_invoice_id UUID NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  resulting_receipt_id UUID NULL REFERENCES public.receipts(id) ON DELETE RESTRICT,
  failure_code TEXT NULL,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  failed_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_automation_command_type CHECK (
    command_type IN ('create_invoice', 'create_receipt', 'allocate_receipt')
  ),
  CONSTRAINT chk_automation_command_mode CHECK (
    operating_mode IN ('observe_only', 'draft_only', 'straight_through')
  ),
  CONSTRAINT chk_automation_command_status CHECK (
    status IN ('proposed', 'pending', 'running', 'completed', 'failed', 'refused')
  ),
  CONSTRAINT chk_automation_command_key CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_automation_command_payload CHECK (jsonb_typeof(command_payload) = 'object'),
  CONSTRAINT chk_automation_command_result_shape CHECK (
    NOT (resulting_invoice_id IS NOT NULL AND resulting_receipt_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_automation_command_idempotency
  ON public.automation_commands(company_id, idempotency_key);
CREATE INDEX idx_automation_command_list
  ON public.automation_commands(company_id, created_at DESC, id DESC);

CREATE TABLE public.automation_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  mailbox_id UUID NULL REFERENCES public.automation_mailboxes(id) ON DELETE SET NULL,
  sync_run_id UUID NULL REFERENCES public.mailbox_sync_runs(id) ON DELETE SET NULL,
  message_id UUID NULL REFERENCES public.automation_source_messages(id) ON DELETE SET NULL,
  attachment_id UUID NULL REFERENCES public.automation_source_attachments(id) ON DELETE SET NULL,
  command_id UUID NULL REFERENCES public.automation_commands(id) ON DELETE SET NULL,
  invoice_id UUID NULL REFERENCES public.invoices(id) ON DELETE SET NULL,
  receipt_id UUID NULL REFERENCES public.receipts(id) ON DELETE SET NULL,
  reason_code TEXT NOT NULL,
  idempotency_key TEXT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'open',
  safe_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL,
  dismissed_at TIMESTAMPTZ NULL,
  actor_user_id UUID NULL,
  resolution_note TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_automation_exception_reason CHECK (
    reason_code IN (
      'mailbox_not_configured', 'mailbox_reconnect_required', 'provider_unavailable',
      'message_duplicate', 'attachment_duplicate', 'unsupported_file', 'unsafe_file',
      'encrypted_document', 'oversized_document', 'ambiguous_classification',
      'unsupported_document', 'low_confidence', 'extraction_schema_invalid',
      'arithmetic_mismatch', 'currency_unsupported', 'customer_unresolved',
      'customer_ambiguous', 'invoice_conflict', 'receipt_conflict',
      'missing_salesman', 'invalid_salesman_email',
      'allocation_evidence_insufficient', 'allocation_currency_mismatch',
      'allocation_conflict', 'concurrency_conflict', 'provider_delivery_failed',
      'internal_processing_failure'
    )
  ),
  CONSTRAINT chk_automation_exception_lifecycle CHECK (
    lifecycle_status IN ('open', 'retryable', 'resolved', 'dismissed')
  ),
  CONSTRAINT chk_automation_exception_retry CHECK (
    retry_count BETWEEN 0 AND max_retries AND max_retries BETWEEN 0 AND 10
  ),
  CONSTRAINT chk_automation_exception_key CHECK (
    idempotency_key IS NULL OR idempotency_key ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT chk_automation_exception_details CHECK (jsonb_typeof(safe_details) = 'object'),
  CONSTRAINT chk_automation_exception_resolution CHECK (
    (lifecycle_status = 'resolved' AND resolved_at IS NOT NULL AND length(btrim(resolution_note)) > 0)
    OR (lifecycle_status = 'dismissed' AND dismissed_at IS NOT NULL AND length(btrim(resolution_note)) > 0)
    OR lifecycle_status IN ('open', 'retryable')
  )
);

CREATE INDEX idx_automation_exception_queue
  ON public.automation_exceptions(
    company_id, lifecycle_status, opened_at DESC, id DESC
  );
CREATE UNIQUE INDEX uq_automation_exception_idempotency
  ON public.automation_exceptions(company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE TRIGGER trg_automation_exceptions_updated_at
  BEFORE UPDATE ON public.automation_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.automation_allocation_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  command_id UUID NOT NULL REFERENCES public.automation_commands(id) ON DELETE RESTRICT,
  receipt_id UUID NOT NULL REFERENCES public.receipts(id) ON DELETE RESTRICT,
  evidence_type TEXT NOT NULL,
  evidence JSONB NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  allocation_result JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_automation_allocation_evidence_type CHECK (
    evidence_type IN (
      'exact_invoice_reference',
      'exact_amount_single_invoice',
      'explicit_partial_reference',
      'explicit_multi_invoice_references'
    )
  ),
  CONSTRAINT chk_automation_allocation_status CHECK (
    status IN ('pending', 'completed', 'refused', 'failed')
  ),
  CONSTRAINT chk_automation_allocation_key CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_automation_allocation_evidence CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE UNIQUE INDEX uq_automation_allocation_idempotency
  ON public.automation_allocation_decisions(company_id, idempotency_key);
CREATE INDEX idx_automation_allocation_receipt
  ON public.automation_allocation_decisions(receipt_id, created_at DESC);

CREATE TABLE public.invoice_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  sales_representative_id UUID NOT NULL
    REFERENCES public.sales_representatives(id) ON DELETE RESTRICT,
  stage_offset_days INTEGER NOT NULL,
  scheduled_for DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  recipient_name_snapshot TEXT NOT NULL,
  recipient_email_snapshot TEXT NOT NULL,
  recipient_phone_snapshot TEXT NULL,
  customer_name_snapshot TEXT NOT NULL,
  invoice_no_snapshot TEXT NOT NULL,
  due_date_snapshot DATE NOT NULL,
  outstanding_snapshot NUMERIC(18,2) NOT NULL,
  currency_snapshot CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ NULL,
  cancelled_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_invoice_reminder_stage CHECK (stage_offset_days BETWEEN -90 AND 0),
  CONSTRAINT chk_invoice_reminder_status CHECK (
    status IN ('pending', 'sending', 'delivered', 'failed', 'cancelled')
  ),
  CONSTRAINT chk_invoice_reminder_email CHECK (
    recipient_email_snapshot = lower(btrim(recipient_email_snapshot))
    AND recipient_email_snapshot ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  CONSTRAINT chk_invoice_reminder_outstanding CHECK (outstanding_snapshot > 0)
);

CREATE UNIQUE INDEX uq_invoice_reminder_stage
  ON public.invoice_reminders(company_id, invoice_id, stage_offset_days);
CREATE INDEX idx_invoice_reminder_delivery
  ON public.invoice_reminders(company_id, scheduled_for, id)
  WHERE status IN ('pending', 'failed');
CREATE INDEX idx_invoice_reminder_invoice_list
  ON public.invoice_reminders(company_id, invoice_id, scheduled_for DESC, id DESC);

CREATE TABLE public.reminder_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  reminder_id UUID NOT NULL REFERENCES public.invoice_reminders(id) ON DELETE CASCADE,
  mailbox_id UUID NOT NULL REFERENCES public.automation_mailboxes(id) ON DELETE RESTRICT,
  provider_type TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_message_id TEXT NULL,
  error_class TEXT NULL,
  redacted_error_code TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_reminder_attempt_provider CHECK (provider_type IN ('gmail', 'microsoft')),
  CONSTRAINT chk_reminder_attempt_number CHECK (attempt_number BETWEEN 1 AND 10),
  CONSTRAINT chk_reminder_attempt_key CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_reminder_attempt_status CHECK (
    status IN ('pending', 'sending', 'sent', 'retryable_failure', 'permanent_failure')
  ),
  CONSTRAINT chk_reminder_attempt_error_class CHECK (
    error_class IS NULL OR error_class IN ('retryable', 'non_retryable')
  )
);

CREATE UNIQUE INDEX uq_reminder_delivery_attempt_number
  ON public.reminder_delivery_attempts(reminder_id, attempt_number);
CREATE UNIQUE INDEX uq_reminder_delivery_idempotency
  ON public.reminder_delivery_attempts(company_id, idempotency_key);
CREATE INDEX idx_reminder_delivery_attempt_list
  ON public.reminder_delivery_attempts(
    company_id, reminder_id, attempt_number DESC, id DESC
  );

CREATE TABLE public.automation_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NULL,
  actor_type TEXT NOT NULL,
  actor_user_id UUID NULL,
  trace_id TEXT NOT NULL,
  safe_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_automation_audit_actor CHECK (
    actor_type IN ('user', 'system_worker', 'provider_fixture')
  ),
  CONSTRAINT chk_automation_audit_metadata CHECK (jsonb_typeof(safe_metadata) = 'object')
);

CREATE INDEX idx_automation_audit_timeline
  ON public.automation_audit_events(company_id, created_at DESC, id DESC);
CREATE INDEX idx_automation_audit_entity_timeline
  ON public.automation_audit_events(
    company_id, entity_type, entity_id, created_at DESC, id DESC
  );

CREATE OR REPLACE FUNCTION public.automation_update_sync_run_counters()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_sync_run_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'automation_source_attachments' THEN
    IF TG_OP <> 'UPDATE'
      OR OLD.processing_status = 'processed'
      OR NEW.processing_status <> 'processed' THEN
      RETURN NEW;
    END IF;
    SELECT m.sync_run_id INTO v_sync_run_id
    FROM public.automation_source_messages m
    WHERE m.id = NEW.message_id AND m.company_id = NEW.company_id;
    UPDATE public.mailbox_sync_runs
    SET attachments_processed = attachments_processed + 1
    WHERE id = v_sync_run_id AND company_id = NEW.company_id;
  ELSIF TG_TABLE_NAME = 'automation_commands' THEN
    IF NOT (
      (TG_OP = 'INSERT' AND NEW.status = 'proposed')
      OR (
        TG_OP = 'UPDATE'
        AND OLD.status NOT IN ('completed', 'failed', 'refused')
        AND NEW.status IN ('completed', 'failed', 'refused')
      )
    ) THEN
      RETURN NEW;
    END IF;
    SELECT m.sync_run_id INTO v_sync_run_id
    FROM public.automation_source_messages m
    WHERE m.id = NEW.message_id AND m.company_id = NEW.company_id;
    UPDATE public.mailbox_sync_runs
    SET commands_processed = commands_processed + 1
    WHERE id = v_sync_run_id AND company_id = NEW.company_id;
  ELSIF TG_TABLE_NAME = 'automation_allocation_decisions' THEN
    IF TG_OP <> 'UPDATE'
      OR OLD.status = 'completed'
      OR NEW.status <> 'completed' THEN
      RETURN NEW;
    END IF;
    SELECT m.sync_run_id INTO v_sync_run_id
    FROM public.automation_commands c
    JOIN public.automation_source_messages m ON m.id = c.message_id
    WHERE c.id = NEW.command_id AND c.company_id = NEW.company_id;
    UPDATE public.mailbox_sync_runs
    SET allocations_completed = allocations_completed + 1
    WHERE id = v_sync_run_id AND company_id = NEW.company_id;
  ELSIF TG_TABLE_NAME = 'automation_exceptions' THEN
    IF NEW.lifecycle_status NOT IN ('open', 'retryable')
      OR NEW.reason_code IN ('message_duplicate', 'attachment_duplicate') THEN
      RETURN NEW;
    END IF;
    v_sync_run_id := NEW.sync_run_id;
    IF v_sync_run_id IS NULL AND NEW.message_id IS NOT NULL THEN
      SELECT m.sync_run_id INTO v_sync_run_id
      FROM public.automation_source_messages m
      WHERE m.id = NEW.message_id AND m.company_id = NEW.company_id;
    END IF;
    UPDATE public.mailbox_sync_runs
    SET failures = failures + 1
    WHERE id = v_sync_run_id AND company_id = NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_automation_attachment_run_counter
  AFTER UPDATE OF processing_status ON public.automation_source_attachments
  FOR EACH ROW EXECUTE FUNCTION public.automation_update_sync_run_counters();
CREATE TRIGGER trg_automation_command_insert_run_counter
  AFTER INSERT ON public.automation_commands
  FOR EACH ROW EXECUTE FUNCTION public.automation_update_sync_run_counters();
CREATE TRIGGER trg_automation_command_update_run_counter
  AFTER UPDATE OF status ON public.automation_commands
  FOR EACH ROW EXECUTE FUNCTION public.automation_update_sync_run_counters();
CREATE TRIGGER trg_automation_allocation_run_counter
  AFTER UPDATE OF status ON public.automation_allocation_decisions
  FOR EACH ROW EXECUTE FUNCTION public.automation_update_sync_run_counters();
CREATE TRIGGER trg_automation_exception_run_counter
  AFTER INSERT ON public.automation_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.automation_update_sync_run_counters();

-- ---------------------------------------------------------------------------
-- Tenant integrity triggers and immutable history/audit guards
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.automation_assert_tenant_links()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'customer_sales_representative_assignments' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = NEW.customer_id AND c.company_id = NEW.company_id
    ) OR NOT EXISTS (
      SELECT 1 FROM public.sales_representatives s
      WHERE s.id = NEW.sales_representative_id AND s.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'TENANT_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'automation_settings' THEN
    IF NEW.automation_actor_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.user_roles role
      WHERE role.user_id = NEW.automation_actor_user_id
        AND role.company_id = NEW.company_id
        AND role.is_active
        AND role.role IN ('AR Supervisor', 'Finance Manager')
    ) THEN
      RAISE EXCEPTION 'TENANT_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'invoice_reminders' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = NEW.invoice_id
        AND i.company_id = NEW.company_id
        AND i.customer_id = NEW.customer_id
        AND i.doc_type = 'Invoice'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.sales_representatives s
      WHERE s.id = NEW.sales_representative_id AND s.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'TENANT_MISMATCH';
    END IF;
  ELSIF TG_TABLE_NAME = 'automation_oauth_states' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.automation_mailboxes m
      WHERE m.id = NEW.mailbox_id AND m.company_id = NEW.company_id
        AND m.provider_type = NEW.provider_type
    ) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME = 'automation_mailboxes' THEN
    IF NEW.default_bank_account_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.bank_accounts b
      WHERE b.id = NEW.default_bank_account_id
        AND b.company_id = NEW.company_id
        AND b.is_active
    ) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME = 'mailbox_sync_runs' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.automation_mailboxes m
      WHERE m.id = NEW.mailbox_id AND m.company_id = NEW.company_id
        AND m.provider_type = NEW.provider_type
    ) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME = 'automation_source_messages' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.automation_mailboxes m
      WHERE m.id = NEW.mailbox_id AND m.company_id = NEW.company_id
    ) OR (
      NEW.sync_run_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.mailbox_sync_runs r
        WHERE r.id = NEW.sync_run_id AND r.company_id = NEW.company_id
          AND r.mailbox_id = NEW.mailbox_id
      )
    ) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME = 'automation_source_attachments' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.automation_source_messages m
      WHERE m.id = NEW.message_id AND m.company_id = NEW.company_id
        AND m.mailbox_id = NEW.mailbox_id
    ) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME = 'automation_document_classifications' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.automation_source_attachments a
      WHERE a.id = NEW.attachment_id AND a.company_id = NEW.company_id
    ) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME = 'automation_extraction_results' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.automation_document_classifications c
      WHERE c.id = NEW.classification_id AND c.company_id = NEW.company_id
    ) OR (
      NEW.customer_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.customers c
        WHERE c.id = NEW.customer_id AND c.company_id = NEW.company_id
          AND NOT c.is_deleted AND NOT c.is_hidden
      )
    ) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME = 'automation_commands' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.automation_mailboxes mb
      JOIN public.automation_source_messages sm
        ON sm.id = NEW.message_id AND sm.mailbox_id = mb.id
      JOIN public.automation_source_attachments sa
        ON sa.id = NEW.attachment_id AND sa.message_id = sm.id
      JOIN public.automation_extraction_results er
        ON er.id = NEW.extraction_id AND er.company_id = NEW.company_id
      WHERE mb.id = NEW.mailbox_id AND mb.company_id = NEW.company_id
        AND sm.company_id = NEW.company_id AND sa.company_id = NEW.company_id
    ) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME = 'automation_exceptions' THEN
    IF (
      NEW.mailbox_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.automation_mailboxes mb
        WHERE mb.id = NEW.mailbox_id AND mb.company_id = NEW.company_id
      )
    ) OR (
      NEW.sync_run_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.mailbox_sync_runs run
        WHERE run.id = NEW.sync_run_id AND run.company_id = NEW.company_id
      )
    ) OR (
      NEW.message_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.automation_source_messages msg
        WHERE msg.id = NEW.message_id AND msg.company_id = NEW.company_id
      )
    ) OR (
      NEW.attachment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.automation_source_attachments att
        WHERE att.id = NEW.attachment_id AND att.company_id = NEW.company_id
      )
    ) OR (
      NEW.command_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.automation_commands cmd
        WHERE cmd.id = NEW.command_id AND cmd.company_id = NEW.company_id
      )
    ) OR (
      NEW.invoice_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.invoices inv
        WHERE inv.id = NEW.invoice_id AND inv.company_id = NEW.company_id
      )
    ) OR (
      NEW.receipt_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.receipts rct
        WHERE rct.id = NEW.receipt_id AND rct.company_id = NEW.company_id
      )
    ) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME = 'automation_allocation_decisions' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.automation_commands c
      WHERE c.id = NEW.command_id AND c.company_id = NEW.company_id
    ) OR NOT EXISTS (
      SELECT 1 FROM public.receipts r
      WHERE r.id = NEW.receipt_id AND r.company_id = NEW.company_id
    ) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  ELSIF TG_TABLE_NAME = 'reminder_delivery_attempts' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.invoice_reminders r
      WHERE r.id = NEW.reminder_id AND r.company_id = NEW.company_id
    ) OR NOT EXISTS (
      SELECT 1 FROM public.automation_mailboxes m
      WHERE m.id = NEW.mailbox_id AND m.company_id = NEW.company_id
        AND m.provider_type = NEW.provider_type
    ) THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_customer_sales_assignment_tenant
  BEFORE INSERT OR UPDATE ON public.customer_sales_representative_assignments
  FOR EACH ROW EXECUTE FUNCTION public.automation_assert_tenant_links();
CREATE TRIGGER trg_automation_settings_tenant
  BEFORE INSERT OR UPDATE ON public.automation_settings
  FOR EACH ROW EXECUTE FUNCTION public.automation_assert_tenant_links();
CREATE TRIGGER trg_invoice_reminder_tenant
  BEFORE INSERT OR UPDATE ON public.invoice_reminders
  FOR EACH ROW EXECUTE FUNCTION public.automation_assert_tenant_links();
CREATE TRIGGER trg_automation_oauth_tenant
  BEFORE INSERT OR UPDATE ON public.automation_oauth_states
  FOR EACH ROW EXECUTE FUNCTION public.automation_assert_tenant_links();
CREATE TRIGGER trg_automation_mailbox_tenant
  BEFORE INSERT OR UPDATE ON public.automation_mailboxes
  FOR EACH ROW EXECUTE FUNCTION public.automation_assert_tenant_links();
CREATE TRIGGER trg_mailbox_sync_run_tenant
  BEFORE INSERT OR UPDATE ON public.mailbox_sync_runs
  FOR EACH ROW EXECUTE FUNCTION public.automation_assert_tenant_links();
CREATE TRIGGER trg_automation_source_message_tenant
  BEFORE INSERT OR UPDATE ON public.automation_source_messages
  FOR EACH ROW EXECUTE FUNCTION public.automation_assert_tenant_links();
CREATE TRIGGER trg_automation_source_attachment_tenant
  BEFORE INSERT OR UPDATE ON public.automation_source_attachments
  FOR EACH ROW EXECUTE FUNCTION public.automation_assert_tenant_links();
CREATE TRIGGER trg_automation_classification_tenant
  BEFORE INSERT OR UPDATE ON public.automation_document_classifications
  FOR EACH ROW EXECUTE FUNCTION public.automation_assert_tenant_links();
CREATE TRIGGER trg_automation_extraction_tenant
  BEFORE INSERT OR UPDATE ON public.automation_extraction_results
  FOR EACH ROW EXECUTE FUNCTION public.automation_assert_tenant_links();
CREATE TRIGGER trg_automation_command_tenant
  BEFORE INSERT OR UPDATE ON public.automation_commands
  FOR EACH ROW EXECUTE FUNCTION public.automation_assert_tenant_links();
CREATE TRIGGER trg_automation_exception_tenant
  BEFORE INSERT OR UPDATE ON public.automation_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.automation_assert_tenant_links();
CREATE TRIGGER trg_automation_allocation_tenant
  BEFORE INSERT OR UPDATE ON public.automation_allocation_decisions
  FOR EACH ROW EXECUTE FUNCTION public.automation_assert_tenant_links();
CREATE TRIGGER trg_reminder_delivery_attempt_tenant
  BEFORE INSERT OR UPDATE ON public.reminder_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION public.automation_assert_tenant_links();

CREATE OR REPLACE FUNCTION public.automation_record_lifecycle_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row JSONB := to_jsonb(NEW);
  v_company_id UUID := (v_row->>'company_id')::UUID;
  v_entity_id UUID := COALESCE(
    NULLIF(v_row->>'id', '')::UUID,
    v_company_id
  );
  v_actor_user_id UUID := NULLIF(
    COALESCE(
      v_row->>'updated_by',
      v_row->>'actor_user_id',
      v_row->>'created_by'
    ),
    ''
  )::UUID;
BEGIN
  INSERT INTO public.automation_audit_events (
    company_id, event_type, entity_type, entity_id, actor_type,
    actor_user_id, trace_id, safe_metadata
  ) VALUES (
    v_company_id,
    TG_TABLE_NAME || '_' || lower(TG_OP),
    TG_TABLE_NAME,
    v_entity_id,
    CASE WHEN v_actor_user_id IS NULL THEN 'system_worker' ELSE 'user' END,
    v_actor_user_id,
    COALESCE(NULLIF(v_row->>'trace_id', ''), v_entity_id::TEXT),
    jsonb_strip_nulls(jsonb_build_object(
      'operation', lower(TG_OP),
      'status', v_row->>'status',
      'processing_status', v_row->>'processing_status',
      'validation_status', v_row->>'validation_status',
      'lifecycle_status', v_row->>'lifecycle_status',
      'operating_mode', v_row->>'operating_mode',
      'reason_code', v_row->>'reason_code',
      'provider_type', v_row->>'provider_type'
    ))
  );
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'sales_representatives',
    'automation_settings',
    'automation_mailboxes',
    'automation_oauth_states',
    'mailbox_sync_runs',
    'automation_source_messages',
    'automation_source_attachments',
    'automation_document_classifications',
    'automation_extraction_results',
    'automation_commands',
    'automation_exceptions',
    'automation_allocation_decisions',
    'invoice_reminders',
    'reminder_delivery_attempts'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.automation_record_lifecycle_audit()',
      'trg_' || v_table || '_audit',
      v_table
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.automation_guard_assignment_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.superseded_at IS NULL
    AND NEW.superseded_at IS NOT NULL
    AND NEW.superseded_by IS NOT NULL
    AND NEW.id = OLD.id
    AND NEW.company_id = OLD.company_id
    AND NEW.customer_id = OLD.customer_id
    AND NEW.sales_representative_id = OLD.sales_representative_id
    AND NEW.assignment_source = OLD.assignment_source
    AND NEW.assigned_by = OLD.assigned_by
    AND NEW.assigned_at = OLD.assigned_at
    AND NEW.assignment_reason = OLD.assignment_reason
    AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_SALES_ASSIGNMENT_HISTORY';
END;
$$;

CREATE TRIGGER trg_customer_sales_assignment_history_immutable
  BEFORE UPDATE OR DELETE
  ON public.customer_sales_representative_assignments
  FOR EACH ROW EXECUTE FUNCTION public.automation_guard_assignment_history();

CREATE OR REPLACE FUNCTION public.automation_guard_extraction_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.validation_status IN ('invalid', 'ambiguous')
    AND NEW.validation_status = 'valid'
    AND NEW.customer_id IS NOT NULL
    AND NEW.customer_resolution_method IS NOT NULL
    AND NEW.validation_codes = ARRAY[]::TEXT[]
    AND (
      to_jsonb(NEW) - ARRAY[
        'validation_status', 'validation_codes', 'customer_id',
        'customer_resolution_method', 'validated_at'
      ]
    ) = (
      to_jsonb(OLD) - ARRAY[
        'validation_status', 'validation_codes', 'customer_id',
        'customer_resolution_method', 'validated_at'
      ]
    ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'IMMUTABLE_AUTOMATION_EXTRACTION_HISTORY';
END;
$$;

CREATE OR REPLACE FUNCTION public.automation_prevent_immutable_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_AUTOMATION_AUDIT_RECORD';
END;
$$;

CREATE TRIGGER trg_automation_audit_immutable
  BEFORE UPDATE OR DELETE ON public.automation_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.automation_prevent_immutable_mutation();
CREATE TRIGGER trg_automation_classification_immutable
  BEFORE UPDATE OR DELETE ON public.automation_document_classifications
  FOR EACH ROW EXECUTE FUNCTION public.automation_prevent_immutable_mutation();
CREATE TRIGGER trg_automation_extraction_immutable
  BEFORE UPDATE OR DELETE ON public.automation_extraction_results
  FOR EACH ROW EXECUTE FUNCTION public.automation_guard_extraction_history();

CREATE OR REPLACE FUNCTION public.automation_attribute_allocation_method()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_decision_id UUID;
BEGIN
  BEGIN
    v_decision_id := NULLIF(
      current_setting('app.automation_allocation_decision_id', true),
      ''
    )::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_decision_id := NULL;
  END;

  IF v_decision_id IS NOT NULL
    AND NEW.allocation_method = 'Manual'
    AND EXISTS (
      SELECT 1
      FROM public.automation_allocation_decisions d
      WHERE d.id = v_decision_id
        AND d.receipt_id = NEW.receipt_id
        AND d.status = 'pending'
    )
  THEN
    NEW.allocation_method := 'Auto_Amount';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_automation_attribute_allocation_method
  BEFORE INSERT ON public.allocation_details
  FOR EACH ROW EXECUTE FUNCTION public.automation_attribute_allocation_method();

-- ---------------------------------------------------------------------------
-- Trusted mutation RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.automation_assign_sales_representative(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_customer_id UUID,
  p_sales_representative_id UUID,
  p_assignment_source TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_id UUID;
  v_new_id UUID;
BEGIN
  PERFORM public.rpc_check_role(
    p_actor_user_id, p_company_id,
    ARRAY['AR Supervisor', 'Finance Manager']
  );
  IF p_assignment_source NOT IN (
    'customer_acquisition', 'customer_onboarding', 'manual_assignment', 'import'
  ) OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: Reassignment requires a supported source and a reason.';
  END IF;
  PERFORM 1 FROM public.customers c
  WHERE c.id = p_customer_id AND c.company_id = p_company_id
    AND NOT c.is_deleted AND NOT c.is_hidden
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Customer is unavailable.'; END IF;
  PERFORM 1 FROM public.sales_representatives s
  WHERE s.id = p_sales_representative_id AND s.company_id = p_company_id
    AND s.is_active
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Sales representative is unavailable.'; END IF;

  SELECT a.id INTO v_old_id
  FROM public.customer_sales_representative_assignments a
  WHERE a.company_id = p_company_id
    AND a.customer_id = p_customer_id
    AND a.superseded_at IS NULL
  FOR UPDATE;

  IF v_old_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.customer_sales_representative_assignments a
      WHERE a.id = v_old_id
        AND a.sales_representative_id = p_sales_representative_id
    ) THEN
      RETURN jsonb_build_object('assignment_id', v_old_id, 'changed', false);
    END IF;
    UPDATE public.customer_sales_representative_assignments
    SET superseded_at = clock_timestamp(), superseded_by = p_actor_user_id
    WHERE id = v_old_id;
  END IF;

  INSERT INTO public.customer_sales_representative_assignments (
    company_id, customer_id, sales_representative_id, assignment_source,
    assigned_by, assignment_reason
  ) VALUES (
    p_company_id, p_customer_id, p_sales_representative_id, p_assignment_source,
    p_actor_user_id, btrim(p_reason)
  ) RETURNING id INTO v_new_id;

  INSERT INTO public.automation_audit_events (
    company_id, event_type, entity_type, entity_id, actor_type,
    actor_user_id, trace_id, safe_metadata
  ) VALUES (
    p_company_id, 'sales_representative_assigned', 'customer', p_customer_id,
    'user', p_actor_user_id, gen_random_uuid()::TEXT,
    jsonb_build_object(
      'assignment_id', v_new_id,
      'superseded_assignment_id', v_old_id,
      'source', p_assignment_source
    )
  );
  RETURN jsonb_build_object('assignment_id', v_new_id, 'changed', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.automation_fx_is_authoritative(
  p_company_id UUID,
  p_invoice_id UUID DEFAULT NULL,
  p_receipt_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fx_booking_rate_decisions d
    LEFT JOIN public.invoices i ON i.id = p_invoice_id
    LEFT JOIN public.receipts r ON r.id = p_receipt_id
    WHERE d.company_id = p_company_id
      AND (
        (p_invoice_id IS NOT NULL AND p_receipt_id IS NULL
          AND d.invoice_id = p_invoice_id AND i.company_id = p_company_id
          AND i.fx_decision_id = d.id AND i.fx_source_category = d.source_category
          AND i.exchange_rate = d.booked_rate)
        OR
        (p_receipt_id IS NOT NULL AND p_invoice_id IS NULL
          AND d.receipt_id = p_receipt_id AND r.company_id = p_company_id
          AND r.fx_decision_id = d.id AND r.fx_source_category = d.source_category
          AND r.exchange_rate = d.booked_rate)
      )
      AND d.lifecycle_status = 'Posted'
      AND d.posted
      AND d.approval_status IN ('NotRequired', 'Approved')
      AND d.source_category IN (
        'BASE_PARITY', 'CATALOG', 'REFERENCE_SELECTED', 'MANUAL_OVERRIDE'
      )
      AND (
        (d.source_category = 'BASE_PARITY'
          AND d.from_currency = d.to_currency AND d.booked_rate = 1)
        OR (d.source_category = 'CATALOG' AND d.exchange_rate_id IS NOT NULL)
        OR (d.source_category = 'REFERENCE_SELECTED' AND d.fx_reference_rate_id IS NOT NULL)
        OR (
          d.source_category = 'MANUAL_OVERRIDE'
          AND d.approval_status = 'Approved'
          AND d.approved_by IS NOT NULL
          AND d.approved_at IS NOT NULL
          AND d.baseline_kind NOT IN ('NONE', 'MISSING')
          AND length(btrim(d.override_reason)) > 0
        )
      )
  );
$$;

-- Gate E financial commands must not leave an unlinked draft if the worker
-- crashes between application calls. These narrow service-role wrappers lock
-- the idempotent command and compose governed creation, optional posting, and
-- command completion inside one PostgreSQL transaction. Any exception rolls
-- back the draft, booking decision, journal, posting, and command completion.
CREATE OR REPLACE FUNCTION public.automation_execute_invoice_command(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_command_id UUID,
  p_invoice JSONB,
  p_import_origin JSONB,
  p_lines JSONB,
  p_explicit_rate_supplied BOOLEAN,
  p_override_reason TEXT,
  p_fx_reference_rate_id UUID,
  p_post BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_command public.automation_commands%ROWTYPE;
  v_invoice_id UUID;
BEGIN
  SELECT * INTO v_command
  FROM public.automation_commands
  WHERE id = p_command_id AND company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND OR v_command.command_type <> 'create_invoice' THEN
    RAISE EXCEPTION 'AUTOMATION_COMMAND_NOT_FOUND';
  END IF;
  IF v_command.status = 'completed' AND v_command.resulting_invoice_id IS NOT NULL THEN
    RETURN v_command.resulting_invoice_id;
  END IF;
  IF v_command.status <> 'running' THEN
    RAISE EXCEPTION 'AUTOMATION_COMMAND_NOT_CLAIMED';
  END IF;
  IF (v_command.operating_mode = 'straight_through') IS DISTINCT FROM p_post THEN
    RAISE EXCEPTION 'AUTOMATION_COMMAND_MODE_MISMATCH';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.automation_settings s
    WHERE s.company_id = p_company_id
      AND s.automation_actor_user_id = p_actor_user_id
      AND s.operating_mode = v_command.operating_mode
      AND s.operating_mode IN ('draft_only', 'straight_through')
      AND s.invoice_automation_enabled
  ) THEN
    RAISE EXCEPTION 'AUTOMATION_DISABLED';
  END IF;
  IF p_import_origin ->> 'automation_command_id' IS DISTINCT FROM p_command_id::TEXT THEN
    RAISE EXCEPTION 'AUTOMATION_COMMAND_PROVENANCE_MISMATCH';
  END IF;

  v_invoice_id := public.fx_create_governed_invoice_draft(
    p_company_id,
    p_actor_user_id,
    p_invoice,
    p_import_origin,
    p_lines,
    p_explicit_rate_supplied,
    p_override_reason,
    p_fx_reference_rate_id
  );
  IF p_post THEN
    PERFORM public.post_invoice(v_invoice_id, p_actor_user_id, p_company_id);
  END IF;

  UPDATE public.automation_commands
  SET status = 'completed',
      resulting_invoice_id = v_invoice_id,
      failure_code = NULL,
      completed_at = now(),
      failed_at = NULL
  WHERE id = p_command_id;
  RETURN v_invoice_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.automation_execute_receipt_command(
  p_company_id UUID,
  p_actor_user_id UUID,
  p_command_id UUID,
  p_receipt JSONB,
  p_import_origin JSONB,
  p_explicit_rate_supplied BOOLEAN,
  p_override_reason TEXT,
  p_fx_reference_rate_id UUID,
  p_post BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_command public.automation_commands%ROWTYPE;
  v_receipt_id UUID;
BEGIN
  SELECT * INTO v_command
  FROM public.automation_commands
  WHERE id = p_command_id AND company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND OR v_command.command_type <> 'create_receipt' THEN
    RAISE EXCEPTION 'AUTOMATION_COMMAND_NOT_FOUND';
  END IF;
  IF v_command.status = 'completed' AND v_command.resulting_receipt_id IS NOT NULL THEN
    RETURN v_command.resulting_receipt_id;
  END IF;
  IF v_command.status <> 'running' THEN
    RAISE EXCEPTION 'AUTOMATION_COMMAND_NOT_CLAIMED';
  END IF;
  IF (v_command.operating_mode = 'straight_through') IS DISTINCT FROM p_post THEN
    RAISE EXCEPTION 'AUTOMATION_COMMAND_MODE_MISMATCH';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.automation_settings s
    WHERE s.company_id = p_company_id
      AND s.automation_actor_user_id = p_actor_user_id
      AND s.operating_mode = v_command.operating_mode
      AND s.operating_mode IN ('draft_only', 'straight_through')
      AND s.receipt_automation_enabled
  ) THEN
    RAISE EXCEPTION 'AUTOMATION_DISABLED';
  END IF;
  IF p_import_origin ->> 'automation_command_id' IS DISTINCT FROM p_command_id::TEXT THEN
    RAISE EXCEPTION 'AUTOMATION_COMMAND_PROVENANCE_MISMATCH';
  END IF;

  v_receipt_id := public.fx_create_governed_receipt_draft(
    p_company_id,
    p_actor_user_id,
    p_receipt,
    p_import_origin,
    p_explicit_rate_supplied,
    p_override_reason,
    p_fx_reference_rate_id
  );
  IF p_post THEN
    PERFORM public.post_receipt(v_receipt_id, p_actor_user_id, p_company_id);
  END IF;

  UPDATE public.automation_commands
  SET status = 'completed',
      resulting_receipt_id = v_receipt_id,
      failure_code = NULL,
      completed_at = now(),
      failed_at = NULL
  WHERE id = p_command_id;
  RETURN v_receipt_id;
END;
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
    IF p_evidence_type IN (
      'exact_invoice_reference',
      'explicit_partial_reference',
      'explicit_multi_invoice_references'
    ) AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(
        COALESCE(p_evidence->'invoice_references', '[]'::jsonb)
      ) reference
      WHERE reference = v_invoice.invoice_no
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
    WHERE s.company_id = p_company_id AND s.reminder_evaluation_enabled
      AND s.operating_mode <> 'disabled'
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

-- ---------------------------------------------------------------------------
-- RLS, grants, catalog invariants
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'sales_representatives',
    'customer_sales_representative_assignments',
    'automation_settings',
    'automation_mailboxes',
    'automation_oauth_states',
    'mailbox_sync_runs',
    'automation_source_messages',
    'automation_source_attachments',
    'automation_document_classifications',
    'automation_extraction_results',
    'automation_commands',
    'automation_exceptions',
    'automation_allocation_decisions',
    'invoice_reminders',
    'reminder_delivery_attempts',
    'automation_audit_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.rls_has_company_access(company_id)))',
      'gate_e_' || v_table || '_select', v_table
    );
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', v_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION public.automation_assert_tenant_links()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.automation_guard_assignment_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.automation_guard_extraction_history()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.automation_update_sync_run_counters()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.automation_attribute_allocation_method()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.automation_record_lifecycle_audit()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.automation_prevent_immutable_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.automation_valid_reminder_offsets(INTEGER[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_assign_sales_representative(
  UUID, UUID, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_fx_is_authoritative(
  UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_execute_invoice_command(
  UUID, UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT, UUID, BOOLEAN
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_execute_receipt_command(
  UUID, UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT, UUID, BOOLEAN
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_allocate_receipt(
  UUID, UUID, UUID, UUID, TEXT, JSONB, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.automation_evaluate_invoice_reminders(
  UUID, DATE, UUID
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.automation_assign_sales_representative(
  UUID, UUID, UUID, UUID, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_valid_reminder_offsets(INTEGER[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_fx_is_authoritative(
  UUID, UUID, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_execute_invoice_command(
  UUID, UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT, UUID, BOOLEAN
) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_execute_receipt_command(
  UUID, UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT, UUID, BOOLEAN
) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_allocate_receipt(
  UUID, UUID, UUID, UUID, TEXT, JSONB, JSONB, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_evaluate_invoice_reminders(
  UUID, DATE, UUID
) TO service_role;

ALTER FUNCTION public.automation_assert_tenant_links() OWNER TO postgres;
ALTER FUNCTION public.automation_guard_assignment_history() OWNER TO postgres;
ALTER FUNCTION public.automation_guard_extraction_history() OWNER TO postgres;
ALTER FUNCTION public.automation_attribute_allocation_method() OWNER TO postgres;
ALTER FUNCTION public.automation_record_lifecycle_audit() OWNER TO postgres;
ALTER FUNCTION public.automation_prevent_immutable_mutation() OWNER TO postgres;
ALTER FUNCTION public.automation_valid_reminder_offsets(INTEGER[]) OWNER TO postgres;
ALTER FUNCTION public.automation_assign_sales_representative(
  UUID, UUID, UUID, UUID, TEXT, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.automation_fx_is_authoritative(UUID, UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.automation_execute_invoice_command(
  UUID, UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT, UUID, BOOLEAN
) OWNER TO postgres;
ALTER FUNCTION public.automation_execute_receipt_command(
  UUID, UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT, UUID, BOOLEAN
) OWNER TO postgres;
ALTER FUNCTION public.automation_allocate_receipt(
  UUID, UUID, UUID, UUID, TEXT, JSONB, JSONB, TEXT
) OWNER TO postgres;
ALTER FUNCTION public.automation_evaluate_invoice_reminders(UUID, DATE, UUID) OWNER TO postgres;

COMMENT ON TABLE public.sales_representatives IS
  'Gate E tenant-scoped business contacts. A sales representative is not an auth user or financial role.';
COMMENT ON TABLE public.automation_mailboxes IS
  'Gate E mailbox metadata and opaque secret-reference names only. OAuth tokens are never stored here.';
COMMENT ON FUNCTION public.automation_allocate_receipt(
  UUID, UUID, UUID, UUID, TEXT, JSONB, JSONB, TEXT
) IS
  'Gate E DB-authoritative automatic allocation boundary. Requires explicit evidence, same currency/customer, governed booked FX, locks, and idempotency.';
COMMENT ON FUNCTION public.automation_execute_invoice_command(
  UUID, UUID, UUID, JSONB, JSONB, JSONB, BOOLEAN, TEXT, UUID, BOOLEAN
) IS
  'Gate E service-role boundary: governed invoice creation, optional posting, and command completion are atomic.';
COMMENT ON FUNCTION public.automation_execute_receipt_command(
  UUID, UUID, UUID, JSONB, JSONB, BOOLEAN, TEXT, UUID, BOOLEAN
) IS
  'Gate E service-role boundary: governed receipt creation, optional posting, and command completion are atomic.';

COMMIT;
