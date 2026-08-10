-- Gate E: prospective Straight-Through critical-identifier authority boundary.
--
-- This migration adds one bounded, monitorable exception reason. It does not
-- activate Straight-Through, modify operating settings, change RLS/grants, or
-- touch existing financial/document rows.

BEGIN;

LOCK TABLE public.automation_exceptions IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.automation_exceptions
  DROP CONSTRAINT chk_automation_exception_reason;

ALTER TABLE public.automation_exceptions
  ADD CONSTRAINT chk_automation_exception_reason CHECK (
    reason_code IN (
      'mailbox_not_configured', 'mailbox_reconnect_required', 'provider_unavailable',
      'message_duplicate', 'attachment_duplicate', 'unsupported_file', 'unsafe_file',
      'encrypted_document', 'oversized_document', 'ambiguous_classification',
      'unsupported_document', 'low_confidence', 'extraction_schema_invalid',
      'arithmetic_mismatch', 'currency_unsupported', 'customer_unresolved',
      'customer_ambiguous', 'invoice_conflict', 'receipt_conflict',
      'critical_identifier_unverified',
      'missing_salesman', 'invalid_salesman_email',
      'allocation_evidence_insufficient', 'allocation_currency_mismatch',
      'allocation_conflict', 'concurrency_conflict', 'provider_delivery_failed',
      'internal_processing_failure'
    )
  ) NOT VALID;

ALTER TABLE public.automation_exceptions
  VALIDATE CONSTRAINT chk_automation_exception_reason;

COMMIT;
