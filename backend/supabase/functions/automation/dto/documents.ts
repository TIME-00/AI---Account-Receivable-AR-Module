import {
  type AutomationRow,
  enumValue,
  finiteNumber,
  integer,
  invalid,
  nullableInteger,
  nullableNumber,
  nullableString,
  nullableTimestamp,
  nullableUuid,
  patternString,
  requiredString,
  safeAutomationMetadata,
  safeStringArray,
  SHA256,
  uuid,
} from "./common.ts";

function attachmentDto(row: AutomationRow | null): AutomationRow | null {
  if (!row) return null;
  return {
    id: uuid(row.id, "attachment.id"),
    file_name: requiredString(
      row.original_file_name,
      "attachment.file_name",
      255,
    ),
    content_mime_type: nullableString(
      row.detected_mime_type,
      "attachment.content_mime_type",
      255,
    ),
    size_bytes: nullableInteger(row.size_bytes, "attachment.size_bytes"),
    page_count: nullableInteger(row.page_count, "attachment.page_count"),
    scan_status: nullableString(row.scan_status, "attachment.scan_status", 40),
    safety_status: nullableString(
      row.safety_status,
      "attachment.safety_status",
      40,
    ),
    processing_status: requiredString(
      row.processing_status,
      "attachment.processing_status",
      40,
    ),
    content_purged_at: nullableTimestamp(
      row.content_purged_at,
      "attachment.content_purged_at",
    ),
  };
}

function extractionDto(
  row: AutomationRow | null,
  documentType: unknown,
): AutomationRow | null {
  if (!row) return null;
  const confidence = row.field_confidence;
  if (
    confidence !== null && confidence !== undefined &&
    (!confidence || typeof confidence !== "object" || Array.isArray(confidence))
  ) {
    return invalid("extraction.field_confidence");
  }
  const safeConfidence: AutomationRow | null = confidence == null ? null : {};
  if (safeConfidence) {
    for (const [key, value] of Object.entries(confidence as AutomationRow)) {
      if (key.length > 100) continue;
      safeConfidence[key] = finiteNumber(
        value,
        `extraction.field_confidence.${key}`,
      );
    }
  }
  return {
    id: uuid(row.id, "extraction.id"),
    schema_version: integer(row.schema_version, "extraction.schema_version", 1),
    document_type: enumValue(documentType, "extraction.document_type", [
      "invoice",
      "receipt",
      "payment_advice",
      "unsupported",
      "ambiguous",
    ]),
    validation_status: requiredString(
      row.validation_status,
      "extraction.validation_status",
      40,
    ),
    validation_codes: safeStringArray(
      row.validation_codes ?? [],
      "extraction.validation_codes",
    ),
    field_confidence: safeConfidence,
    customer_id: nullableUuid(row.customer_id, "extraction.customer_id"),
    customer_resolution_method: nullableString(
      row.customer_resolution_method,
      "extraction.customer_resolution_method",
      80,
    ),
    trace_id: nullableString(row.trace_id, "extraction.trace_id", 200),
    validated_at: nullableTimestamp(
      row.validated_at,
      "extraction.validated_at",
    ),
    created_at: nullableTimestamp(row.created_at, "extraction.created_at"),
  };
}

export function documentDecisionDto(row: AutomationRow): AutomationRow {
  const documentType = row.document_type;
  return {
    id: uuid(row.id, "decision.id"),
    company_id: uuid(row.company_id, "decision.company_id"),
    attachment_id: uuid(row.attachment_id, "decision.attachment_id"),
    schema_version: integer(row.schema_version, "decision.schema_version", 1),
    document_type: enumValue(documentType, "decision.document_type", [
      "invoice",
      "receipt",
      "payment_advice",
      "unsupported",
      "ambiguous",
    ]),
    status: enumValue(row.status, "decision.status", [
      "proposed",
      "accepted",
      "rejected",
    ]),
    confidence: nullableNumber(row.confidence, "decision.confidence"),
    critical_field_confidence: nullableNumber(
      row.critical_confidence,
      "decision.critical_field_confidence",
    ),
    provider: nullableString(row.provider_name, "decision.provider", 100),
    model: nullableString(row.provider_model, "decision.model", 200),
    provider_version: nullableString(
      row.provider_version,
      "decision.provider_version",
      100,
    ),
    trace_id: nullableString(row.trace_id, "decision.trace_id", 200),
    created_at: nullableTimestamp(row.created_at, "decision.created_at"),
    attachment: attachmentDto((row.attachment ?? null) as AutomationRow | null),
    extraction: extractionDto(
      (row.extraction ?? null) as AutomationRow | null,
      documentType,
    ),
    command: row.command && typeof row.command === "object"
      ? commandReferenceDto(row.command as AutomationRow)
      : null,
    linked_exception_ids: Array.isArray(row.linked_exception_ids)
      ? row.linked_exception_ids.map((item, index) =>
        uuid(item, `decision.linked_exception_ids.${index}`)
      )
      : [],
  };
}

export function documentProcessingResultDto(
  value: AutomationRow,
): AutomationRow {
  const classification = (value.classification ?? value) as AutomationRow;
  const extraction = value.extraction as AutomationRow | null | undefined;
  return {
    decision_id: uuid(classification.id, "processing.decision_id"),
    attachment_id: uuid(
      classification.attachment_id,
      "processing.attachment_id",
    ),
    document_type: enumValue(
      classification.document_type,
      "processing.document_type",
      [
        "invoice",
        "receipt",
        "payment_advice",
        "unsupported",
        "ambiguous",
      ],
    ),
    decision_status: enumValue(
      classification.status,
      "processing.decision_status",
      [
        "proposed",
        "accepted",
        "rejected",
      ],
    ),
    extraction_id: extraction
      ? uuid(extraction.id, "processing.extraction_id")
      : null,
    validation_status: extraction
      ? requiredString(
        extraction.validation_status,
        "processing.validation_status",
        40,
      )
      : null,
    command_eligible: extraction?.validation_status === "valid" &&
      ["invoice", "receipt"].includes(String(classification.document_type)),
  };
}

export function commandReferenceDto(row: AutomationRow): AutomationRow {
  return {
    id: uuid(row.id, "command.id"),
    command_type: enumValue(row.command_type, "command.command_type", [
      "create_invoice",
      "create_receipt",
      "allocate_receipt",
    ]),
    status: enumValue(row.status, "command.status", [
      "proposed",
      "pending",
      "running",
      "completed",
      "failed",
      "refused",
    ]),
    resulting_invoice_id: nullableUuid(
      row.resulting_invoice_id,
      "command.resulting_invoice_id",
    ),
    resulting_receipt_id: nullableUuid(
      row.resulting_receipt_id,
      "command.resulting_receipt_id",
    ),
    failure_code: nullableString(row.failure_code, "command.failure_code", 80),
  };
}

export function commandDto(row: AutomationRow): AutomationRow {
  return {
    ...commandReferenceDto(row),
    company_id: uuid(row.company_id, "command.company_id"),
    mailbox_id: uuid(row.mailbox_id, "command.mailbox_id"),
    message_id: uuid(row.message_id, "command.message_id"),
    attachment_id: uuid(row.attachment_id, "command.attachment_id"),
    extraction_id: uuid(row.extraction_id, "command.extraction_id"),
    operating_mode: enumValue(row.operating_mode, "command.operating_mode", [
      "observe_only",
      "draft_only",
      "straight_through",
    ]),
    schema_version: integer(row.schema_version, "command.schema_version", 1),
    idempotency_key: patternString(
      row.idempotency_key,
      "command.idempotency_key",
      SHA256,
      64,
    ),
    created_by: nullableUuid(row.created_by, "command.created_by"),
    created_at: nullableTimestamp(row.created_at, "command.created_at"),
    completed_at: nullableTimestamp(row.completed_at, "command.completed_at"),
    failed_at: nullableTimestamp(row.failed_at, "command.failed_at"),
  };
}

export function exceptionDto(row: AutomationRow): AutomationRow {
  const context = row.document_context as AutomationRow | null | undefined;
  const document = context == null ? null : {
    file_name: requiredString(
      context.file_name,
      "exception.document.file_name",
      255,
    ),
    document_type: context.document_type == null ? null : enumValue(
      context.document_type,
      "exception.document.document_type",
      ["invoice", "receipt", "payment_advice", "unsupported", "ambiguous"],
    ),
    processing_status: requiredString(
      context.processing_status,
      "exception.document.processing_status",
      40,
    ),
    classification_status: context.classification_status == null
      ? null
      : enumValue(
        context.classification_status,
        "exception.document.classification_status",
        ["proposed", "accepted", "rejected"],
      ),
    manual_review_required: ["open", "retryable"].includes(
      String(row.lifecycle_status),
    ),
  };
  return {
    id: uuid(row.id, "exception.id"),
    company_id: uuid(row.company_id, "exception.company_id"),
    mailbox_id: nullableUuid(row.mailbox_id, "exception.mailbox_id"),
    sync_run_id: nullableUuid(row.sync_run_id, "exception.sync_run_id"),
    message_id: nullableUuid(row.message_id, "exception.message_id"),
    attachment_id: nullableUuid(row.attachment_id, "exception.attachment_id"),
    command_id: nullableUuid(row.command_id, "exception.command_id"),
    invoice_id: nullableUuid(row.invoice_id, "exception.invoice_id"),
    receipt_id: nullableUuid(row.receipt_id, "exception.receipt_id"),
    reason_code: requiredString(row.reason_code, "exception.reason_code", 80),
    idempotency_key: row.idempotency_key == null ? null : patternString(
      row.idempotency_key,
      "exception.idempotency_key",
      SHA256,
      64,
    ),
    lifecycle_status: enumValue(
      row.lifecycle_status,
      "exception.lifecycle_status",
      ["open", "retryable", "resolved", "dismissed"],
    ),
    safe_details: safeAutomationMetadata(row.safe_details),
    retry_count: integer(row.retry_count ?? 0, "exception.retry_count"),
    max_retries: integer(row.max_retries ?? 0, "exception.max_retries"),
    actor_user_id: nullableUuid(row.actor_user_id, "exception.actor_user_id"),
    resolution_note: nullableString(
      row.resolution_note,
      "exception.resolution_note",
      1000,
    ),
    document,
    opened_at: nullableTimestamp(row.opened_at, "exception.opened_at"),
    resolved_at: nullableTimestamp(row.resolved_at, "exception.resolved_at"),
    dismissed_at: nullableTimestamp(row.dismissed_at, "exception.dismissed_at"),
    created_at: nullableTimestamp(row.opened_at, "exception.created_at"),
    updated_at: nullableTimestamp(row.updated_at, "exception.updated_at"),
  };
}
