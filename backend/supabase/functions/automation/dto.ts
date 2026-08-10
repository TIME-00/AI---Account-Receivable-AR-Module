import { BusinessError } from "../_shared/errors.ts";
import {
  AUTOMATION_POSTGRES_UUID_PATTERN,
  isSemanticIsoDate,
  isSemanticIsoTimestamp,
} from "./contract.ts";

export type AutomationRow = Record<string, unknown>;

const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.\d+)?$/;
const CURRENCY = /^[A-Z]{3}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+[1-9][0-9]{6,14}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function invalid(field: string): never {
  throw new BusinessError(
    "AUTOMATION_RESPONSE_INVALID",
    "Automation data could not be returned safely.",
    500,
    { field },
  );
}

function requiredString(value: unknown, field: string, max = 1000): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    return invalid(field);
  }
  return value;
}

function nullableString(
  value: unknown,
  field: string,
  max = 1000,
): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value, field, max);
}

function uuid(value: unknown, field: string): string {
  const text = requiredString(value, field, 36);
  return AUTOMATION_POSTGRES_UUID_PATTERN.test(text) ? text : invalid(field);
}

function nullableUuid(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return uuid(value, field);
}

function timestamp(value: unknown, field: string): string {
  const text = requiredString(value, field, 40);
  if (!isSemanticIsoTimestamp(text)) {
    return invalid(field);
  }
  return new Date(text).toISOString();
}

function nullableTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return timestamp(value, field);
}

function date(value: unknown, field: string): string {
  const text = requiredString(value, field, 10);
  return isSemanticIsoDate(text) ? text : invalid(field);
}

function nullableDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return date(value, field);
}

function boolean(value: unknown, field: string): boolean {
  return typeof value === "boolean" ? value : invalid(field);
}

function integer(value: unknown, field: string, minimum = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) return invalid(field);
  return number;
}

function nullableInteger(
  value: unknown,
  field: string,
  minimum = 0,
): number | null {
  if (value === null || value === undefined) return null;
  return integer(value, field, minimum);
}

function finiteNumber(value: unknown, field: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return invalid(field);
  return number;
}

function nullableNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return finiteNumber(value, field);
}

function decimal(value: unknown, field: string): string {
  const text = String(value);
  return DECIMAL.test(text) ? text : invalid(field);
}

function patternString(
  value: unknown,
  field: string,
  pattern: RegExp,
  max: number,
): string {
  const text = requiredString(value, field, max);
  return pattern.test(text) ? text : invalid(field);
}

function nullableDecimal(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return decimal(value, field);
}

function enumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? value as T
    : invalid(field);
}

function safeStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 100) return invalid(field);
  return value.map((item, index) =>
    requiredString(item, `${field}.${index}`, 200)
  );
}

const SENSITIVE_KEY =
  /(access[_-]?token|refresh[_-]?token|secret|password|authorization|private[_-]?key|provider[_-]?(?:body|response)|raw[_-]?(?:document|prompt)|stack|sql|bank|cursor|history[_-]?id|delta[_-]?link)/i;

const CREDENTIAL_VALUE = [
  /\bBearer\s+\S+/i,
  /\b(?:access_token|refresh_token|client_secret|authorization)\s*[:=]/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /^(?:postgres(?:ql)?|mysql|mssql):\/\//i,
  /^(?:ya29\.|1\/\/|gh[pousr]_|sk-|sbp_|AKIA)[A-Za-z0-9_./+=-]+$/,
  /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/,
  /\bat\s+.+\(.+:\d+:\d+\)/i,
  /\b(?:select|insert|update|delete|drop|alter)\b.+\b(?:from|into|table|set)\b/i,
];

const UUID_METADATA_KEYS = new Set([
  "assignment_id",
  "superseded_assignment_id",
  "classification_id",
  "extraction_id",
  "attachment_id",
  "command_id",
  "invoice_id",
  "mailbox_id",
  "message_id",
  "receipt_id",
  "reminder_id",
  "sales_representative_id",
  "sync_run_id",
]);

const STATUS_VALUES = new Set([
  "disabled",
  "pending_consent",
  "connected",
  "reconnect_required",
  "error",
  "pending",
  "running",
  "completed",
  "failed",
  "received",
  "attachments_persisted",
  "classified",
  "validated",
  "commanded",
  "exception",
  "ignored",
  "retryable",
  "processed",
  "proposed",
  "accepted",
  "rejected",
  "valid",
  "invalid",
  "ambiguous",
  "unsupported",
  "refused",
  "open",
  "resolved",
  "dismissed",
  "sending",
  "delivered",
  "cancelled",
  "sent",
  "retryable_failure",
  "permanent_failure",
]);

const ACTION_VALUES = new Set([
  "create",
  "update",
  "activate",
  "deactivate",
  "assign",
  "reassign",
  "retry",
  "resolve",
  "resolved",
  "dismiss",
  "dismissed",
  "process",
  "evaluate",
  "deliver",
  "allocate",
]);

const CHANGED_FIELD_VALUES = new Set([
  "name",
  "email",
  "phone",
  "is_active",
  "operating_mode",
  "mailbox_sync_enabled",
  "document_intelligence_enabled",
  "invoice_automation_enabled",
  "receipt_automation_enabled",
  "auto_allocation_enabled",
  "reminder_evaluation_enabled",
  "reminder_delivery_enabled",
  "reminder_stage_offsets",
  "reminder_timezone",
  "minimum_overall_confidence",
  "minimum_critical_confidence",
  "default_bank_account_id",
  "is_enabled",
  "ingestion_enabled",
  "delivery_enabled",
  "connection_status",
]);

const REASON_CODE_VALUES = new Set([
  "mailbox_not_configured",
  "mailbox_reconnect_required",
  "provider_unavailable",
  "message_duplicate",
  "attachment_duplicate",
  "unsupported_file",
  "unsafe_file",
  "encrypted_document",
  "oversized_document",
  "ambiguous_classification",
  "unsupported_document",
  "low_confidence",
  "extraction_schema_invalid",
  "arithmetic_mismatch",
  "currency_unsupported",
  "customer_unresolved",
  "customer_ambiguous",
  "invoice_conflict",
  "receipt_conflict",
  "critical_identifier_unverified",
  "missing_salesman",
  "invalid_salesman_email",
  "allocation_evidence_insufficient",
  "allocation_currency_mismatch",
  "allocation_conflict",
  "concurrency_conflict",
  "provider_delivery_failed",
  "internal_processing_failure",
]);

type MetadataValidator = (value: unknown) => unknown | undefined;

function credentialShaped(value: string): boolean {
  if (
    value.length > 200 ||
    CREDENTIAL_VALUE.some((pattern) => pattern.test(value))
  ) {
    return true;
  }
  return value.length >= 48 && /[a-z]/.test(value) && /[A-Z]/.test(value) &&
    /[0-9]/.test(value) && /^[A-Za-z0-9+/_=-]+$/.test(value);
}

function exactString(values: ReadonlySet<string>): MetadataValidator {
  return (value) =>
    typeof value === "string" && !credentialShaped(value) && values.has(value)
      ? value
      : undefined;
}

function metadataUuid(value: unknown): unknown | undefined {
  return typeof value === "string" && !credentialShaped(value) &&
      AUTOMATION_POSTGRES_UUID_PATTERN.test(value)
    ? value
    : undefined;
}

const METADATA_VALIDATORS: Record<string, MetadataValidator> = {
  action: exactString(ACTION_VALUES),
  capability: exactString(new Set(["ingestion", "delivery"])),
  changed_fields: (value) =>
    Array.isArray(value) && value.length <= 20 &&
      value.every((item) =>
        typeof item === "string" && !credentialShaped(item) &&
        CHANGED_FIELD_VALUES.has(item)
      )
      ? [...value]
      : undefined,
  command_type: exactString(
    new Set(["create_invoice", "create_receipt", "allocate_receipt"]),
  ),
  document_type: exactString(
    new Set([
      "invoice",
      "receipt",
      "payment_advice",
      "unsupported",
      "ambiguous",
    ]),
  ),
  error_code: (value) =>
    typeof value === "string" && !credentialShaped(value) &&
      /^[A-Z][A-Z0-9_]{0,79}$/.test(value)
      ? value
      : undefined,
  from_status: exactString(STATUS_VALUES),
  lifecycle_status: exactString(
    new Set(["open", "retryable", "resolved", "dismissed"]),
  ),
  operating_mode: exactString(
    new Set(["disabled", "observe_only", "draft_only", "straight_through"]),
  ),
  operation: exactString(new Set(["insert", "update", "delete"])),
  processing_status: exactString(STATUS_VALUES),
  provider_type: exactString(new Set(["gmail", "microsoft"])),
  reason_code: exactString(REASON_CODE_VALUES),
  retry_blocked: (value) => typeof value === "boolean" ? value : undefined,
  stage_offset_days: (value) =>
    Number.isSafeInteger(value) && Number(value) >= -90 && Number(value) <= 0
      ? value
      : undefined,
  status: exactString(STATUS_VALUES),
  to_status: exactString(STATUS_VALUES),
  validation_status: exactString(
    new Set(["pending", "valid", "invalid", "ambiguous", "unsupported"]),
  ),
  source: exactString(
    new Set([
      "customer_acquisition",
      "customer_onboarding",
      "manual_assignment",
      "import",
    ]),
  ),
  duplicate_no_op: (value) => typeof value === "boolean" ? value : undefined,
  provider_attachment_present: (value) =>
    typeof value === "boolean" ? value : undefined,
};

for (const key of UUID_METADATA_KEYS) {
  METADATA_VALIDATORS[key] = metadataUuid;
}

export function safeAutomationMetadata(value: unknown): AutomationRow | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid("safe_metadata");
  }
  const output: AutomationRow = {};
  for (const [key, item] of Object.entries(value as AutomationRow)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const safeValue = METADATA_VALIDATORS[key]?.(item);
    if (safeValue !== undefined) output[key] = safeValue;
  }
  return output;
}

export function automationSettingsDto(
  row: AutomationRow | null,
  companyId: string,
): AutomationRow {
  const source = row ?? {
    company_id: companyId,
    automation_actor_user_id: null,
    operating_mode: "disabled",
    mailbox_sync_enabled: false,
    document_intelligence_enabled: false,
    invoice_automation_enabled: false,
    receipt_automation_enabled: false,
    auto_allocation_enabled: false,
    reminder_evaluation_enabled: false,
    reminder_delivery_enabled: false,
    reminder_stage_offsets: [-3, 0],
    reminder_timezone: "UTC",
    extraction_schema_version: 1,
    minimum_overall_confidence: 0.95,
    minimum_critical_confidence: 0.99,
  };
  const offsets = source.reminder_stage_offsets;
  if (
    !Array.isArray(offsets) || offsets.length === 0 || offsets.length > 10 ||
    offsets.some((item) => !Number.isInteger(Number(item)))
  ) invalid("reminder_stage_offsets");
  return {
    company_id: uuid(source.company_id, "company_id"),
    automation_actor_user_id: nullableUuid(
      source.automation_actor_user_id,
      "automation_actor_user_id",
    ),
    operating_mode: enumValue(source.operating_mode, "operating_mode", [
      "disabled",
      "observe_only",
      "draft_only",
      "straight_through",
    ]),
    mailbox_sync_enabled: boolean(
      source.mailbox_sync_enabled,
      "mailbox_sync_enabled",
    ),
    document_intelligence_enabled: boolean(
      source.document_intelligence_enabled,
      "document_intelligence_enabled",
    ),
    invoice_automation_enabled: boolean(
      source.invoice_automation_enabled,
      "invoice_automation_enabled",
    ),
    receipt_automation_enabled: boolean(
      source.receipt_automation_enabled,
      "receipt_automation_enabled",
    ),
    auto_allocation_enabled: boolean(
      source.auto_allocation_enabled,
      "auto_allocation_enabled",
    ),
    reminder_evaluation_enabled: boolean(
      source.reminder_evaluation_enabled,
      "reminder_evaluation_enabled",
    ),
    reminder_delivery_enabled: boolean(
      source.reminder_delivery_enabled,
      "reminder_delivery_enabled",
    ),
    reminder_stage_offsets: offsets.map((item, index) =>
      integer(item, `reminder_stage_offsets.${index}`, -90)
    ),
    reminder_timezone: requiredString(
      source.reminder_timezone,
      "reminder_timezone",
      100,
    ),
    extraction_schema_version: integer(
      source.extraction_schema_version,
      "extraction_schema_version",
      1,
    ),
    minimum_overall_confidence: finiteNumber(
      source.minimum_overall_confidence,
      "minimum_overall_confidence",
    ),
    minimum_critical_confidence: finiteNumber(
      source.minimum_critical_confidence,
      "minimum_critical_confidence",
    ),
    created_at: nullableTimestamp(source.created_at, "created_at"),
    updated_at: nullableTimestamp(source.updated_at, "updated_at"),
    created_by: nullableUuid(source.created_by, "created_by"),
    updated_by: nullableUuid(source.updated_by, "updated_by"),
  };
}

export function salesRepresentativeDto(row: AutomationRow): AutomationRow {
  return {
    id: uuid(row.id, "sales_representative.id"),
    company_id: uuid(row.company_id, "sales_representative.company_id"),
    name: requiredString(row.name, "sales_representative.name", 200),
    email: row.email == null
      ? null
      : patternString(row.email, "sales_representative.email", EMAIL, 254),
    phone: row.phone == null
      ? null
      : patternString(row.phone, "sales_representative.phone", PHONE, 30),
    is_active: boolean(row.is_active, "sales_representative.is_active"),
    created_at: nullableTimestamp(
      row.created_at,
      "sales_representative.created_at",
    ),
    updated_at: nullableTimestamp(
      row.updated_at,
      "sales_representative.updated_at",
    ),
    created_by: nullableUuid(row.created_by, "sales_representative.created_by"),
    updated_by: nullableUuid(row.updated_by, "sales_representative.updated_by"),
  };
}

export function assignmentDto(row: AutomationRow): AutomationRow {
  return {
    id: uuid(row.id, "assignment.id"),
    company_id: uuid(row.company_id, "assignment.company_id"),
    customer_id: uuid(row.customer_id, "assignment.customer_id"),
    sales_representative_id: uuid(
      row.sales_representative_id,
      "assignment.sales_representative_id",
    ),
    assignment_source: enumValue(
      row.assignment_source,
      "assignment.assignment_source",
      [
        "customer_acquisition",
        "customer_onboarding",
        "manual_assignment",
        "import",
      ],
    ),
    assigned_by: nullableUuid(row.assigned_by, "assignment.assigned_by"),
    assigned_at: timestamp(row.assigned_at, "assignment.assigned_at"),
    assignment_reason: requiredString(
      row.assignment_reason,
      "assignment.assignment_reason",
      500,
    ),
    superseded_at: nullableTimestamp(
      row.superseded_at,
      "assignment.superseded_at",
    ),
    superseded_by: nullableUuid(row.superseded_by, "assignment.superseded_by"),
    created_at: nullableTimestamp(row.created_at, "assignment.created_at"),
  };
}

export function currentAssignmentDto(
  row: AutomationRow | null,
): AutomationRow | null {
  if (!row) return null;
  const representative = row.sales_representative;
  if (
    !representative || typeof representative !== "object" ||
    Array.isArray(representative)
  ) {
    return invalid("assignment.sales_representative");
  }
  return {
    assignment: assignmentDto(row),
    sales_representative: salesRepresentativeDto(
      representative as AutomationRow,
    ),
  };
}

export function assignmentHistoryDto(row: AutomationRow): AutomationRow {
  const current = currentAssignmentDto(row);
  if (!current) return invalid("assignment_history");
  return current;
}

export function mailboxDto(row: AutomationRow): AutomationRow {
  return {
    id: uuid(row.id, "mailbox.id"),
    company_id: uuid(row.company_id, "mailbox.company_id"),
    provider_type: enumValue(row.provider_type, "mailbox.provider_type", [
      "gmail",
      "microsoft",
    ]),
    mailbox_address: patternString(
      row.mailbox_address,
      "mailbox.mailbox_address",
      EMAIL,
      254,
    ),
    default_bank_account_id: nullableUuid(
      row.default_bank_account_id,
      "mailbox.default_bank_account_id",
    ),
    connection_status: enumValue(
      row.connection_status,
      "mailbox.connection_status",
      [
        "disabled",
        "pending_consent",
        "connected",
        "reconnect_required",
        "error",
      ],
    ),
    ingestion_secret_configured: row.ingestion_secret_ref !== null &&
      row.ingestion_secret_ref !== undefined,
    delivery_secret_configured: row.delivery_secret_ref !== null &&
      row.delivery_secret_ref !== undefined,
    ingestion_token_expires_at: nullableTimestamp(
      row.ingestion_token_expires_at,
      "mailbox.ingestion_token_expires_at",
    ),
    delivery_token_expires_at: nullableTimestamp(
      row.delivery_token_expires_at,
      "mailbox.delivery_token_expires_at",
    ),
    cursor_kind: nullableString(row.cursor_kind, "mailbox.cursor_kind", 32),
    cursor_present: row.incremental_cursor !== null &&
      row.incremental_cursor !== undefined,
    last_successful_sync_at: nullableTimestamp(
      row.last_successful_sync_at,
      "mailbox.last_successful_sync_at",
    ),
    last_failed_sync_at: nullableTimestamp(
      row.last_failed_sync_at,
      "mailbox.last_failed_sync_at",
    ),
    reconnect_required: boolean(
      row.reconnect_required,
      "mailbox.reconnect_required",
    ),
    is_enabled: boolean(row.is_enabled, "mailbox.is_enabled"),
    ingestion_enabled: boolean(
      row.ingestion_enabled,
      "mailbox.ingestion_enabled",
    ),
    delivery_enabled: boolean(row.delivery_enabled, "mailbox.delivery_enabled"),
    redacted_error_code: nullableString(
      row.redacted_error_code,
      "mailbox.redacted_error_code",
      80,
    ),
    created_at: nullableTimestamp(row.created_at, "mailbox.created_at"),
    updated_at: nullableTimestamp(row.updated_at, "mailbox.updated_at"),
  };
}

export function syncRunDto(row: AutomationRow): AutomationRow {
  const persisted = integer(
    row.attachments_persisted,
    "run.attachments_persisted",
  );
  const duplicates = integer(
    row.duplicate_attachments,
    "run.duplicate_attachments",
  );
  return {
    id: uuid(row.id, "run.id"),
    company_id: uuid(row.company_id, "run.company_id"),
    mailbox_id: uuid(row.mailbox_id, "run.mailbox_id"),
    provider_type: enumValue(row.provider_type, "run.provider_type", [
      "gmail",
      "microsoft",
    ]),
    status: enumValue(row.status, "run.status", [
      "pending",
      "running",
      "completed",
      "failed",
      "reconnect_required",
    ]),
    cursor_before: row.cursor_before == null ? null : "[redacted]",
    cursor_after: row.cursor_after == null ? null : "[redacted]",
    started_at: nullableTimestamp(row.started_at, "run.started_at"),
    completed_at: nullableTimestamp(row.completed_at, "run.completed_at"),
    failed_at: nullableTimestamp(row.failed_at, "run.failed_at"),
    messages_discovered: integer(row.messages_seen, "run.messages_seen"),
    messages_persisted: integer(
      row.messages_persisted,
      "run.messages_persisted",
    ),
    attachments_discovered: persisted + duplicates,
    attachments_persisted: persisted,
    duplicate_messages: integer(
      row.duplicate_messages,
      "run.duplicate_messages",
    ),
    duplicate_attachments: duplicates,
    attachments_processed: integer(
      row.attachments_processed,
      "run.attachments_processed",
    ),
    commands_processed: integer(
      row.commands_processed,
      "run.commands_processed",
    ),
    allocations_completed: integer(
      row.allocations_completed,
      "run.allocations_completed",
    ),
    failures: integer(row.failures, "run.failures"),
    attempt_count: integer(row.attempt_count, "run.attempt_count", 1),
    max_attempts: integer(row.max_attempts, "run.max_attempts", 1),
    redacted_error_code: nullableString(
      row.redacted_error_code,
      "run.redacted_error_code",
      80,
    ),
    created_at: nullableTimestamp(row.created_at, "run.created_at"),
  };
}

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

export function reminderDto(row: AutomationRow): AutomationRow {
  return {
    id: uuid(row.id, "reminder.id"),
    company_id: uuid(row.company_id, "reminder.company_id"),
    invoice_id: uuid(row.invoice_id, "reminder.invoice_id"),
    customer_id: uuid(row.customer_id, "reminder.customer_id"),
    sales_representative_id: uuid(
      row.sales_representative_id,
      "reminder.sales_representative_id",
    ),
    stage_offset_days: integer(
      row.stage_offset_days,
      "reminder.stage_offset_days",
      -90,
    ),
    scheduled_for: date(row.scheduled_for, "reminder.scheduled_for"),
    status: enumValue(row.status, "reminder.status", [
      "pending",
      "sending",
      "delivered",
      "failed",
      "cancelled",
    ]),
    recipient_name_snapshot: nullableString(
      row.recipient_name_snapshot,
      "reminder.recipient_name_snapshot",
      200,
    ),
    recipient_email_snapshot: nullableString(
      row.recipient_email_snapshot,
      "reminder.recipient_email_snapshot",
      254,
    ),
    recipient_phone_snapshot: nullableString(
      row.recipient_phone_snapshot,
      "reminder.recipient_phone_snapshot",
      30,
    ),
    customer_name_snapshot: nullableString(
      row.customer_name_snapshot,
      "reminder.customer_name_snapshot",
      300,
    ),
    invoice_no_snapshot: nullableString(
      row.invoice_no_snapshot,
      "reminder.invoice_no_snapshot",
      100,
    ),
    due_date_snapshot: nullableDate(
      row.due_date_snapshot,
      "reminder.due_date_snapshot",
    ),
    outstanding_snapshot: nullableDecimal(
      row.outstanding_snapshot,
      "reminder.outstanding_snapshot",
    ),
    currency_snapshot: row.currency_snapshot == null ? null : patternString(
      row.currency_snapshot,
      "reminder.currency_snapshot",
      CURRENCY,
      3,
    ),
    created_at: nullableTimestamp(row.created_at, "reminder.created_at"),
    delivered_at: nullableTimestamp(row.delivered_at, "reminder.delivered_at"),
  };
}

export function reminderAttemptDto(row: AutomationRow): AutomationRow {
  return {
    id: uuid(row.id, "attempt.id"),
    company_id: uuid(row.company_id, "attempt.company_id"),
    reminder_id: uuid(row.reminder_id, "attempt.reminder_id"),
    mailbox_id: uuid(row.mailbox_id, "attempt.mailbox_id"),
    provider_type: enumValue(row.provider_type, "attempt.provider_type", [
      "gmail",
      "microsoft",
    ]),
    attempt_number: integer(row.attempt_number, "attempt.attempt_number", 1),
    idempotency_key: patternString(
      row.idempotency_key,
      "attempt.idempotency_key",
      SHA256,
      64,
    ),
    status: enumValue(row.status, "attempt.status", [
      "pending",
      "sending",
      "sent",
      "retryable_failure",
      "permanent_failure",
    ]),
    provider_message_id: nullableString(
      row.provider_message_id,
      "attempt.provider_message_id",
      512,
    ),
    error_class: nullableString(row.error_class, "attempt.error_class", 40),
    redacted_error_code: nullableString(
      row.redacted_error_code,
      "attempt.redacted_error_code",
      80,
    ),
    started_at: nullableTimestamp(row.started_at, "attempt.started_at"),
    completed_at: nullableTimestamp(row.completed_at, "attempt.completed_at"),
    created_at: nullableTimestamp(row.created_at, "attempt.created_at"),
  };
}

export function allocationResultDto(
  commandId: string,
  row: AutomationRow,
): AutomationRow {
  return {
    command_id: uuid(commandId, "allocation.command_id"),
    receipt_id: uuid(row.receipt_id, "allocation.receipt_id"),
    allocated_count: integer(row.allocated_count, "allocation.allocated_count"),
    total_allocated: decimal(row.total_allocated, "allocation.total_allocated"),
    receipt_status: requiredString(
      row.receipt_status,
      "allocation.receipt_status",
      40,
    ),
  };
}

export function reminderEvaluationDto(row: AutomationRow): AutomationRow {
  return {
    created: integer(row.created, "reminder_evaluation.created"),
    exceptions: integer(row.exceptions, "reminder_evaluation.exceptions"),
    disabled: boolean(row.disabled, "reminder_evaluation.disabled"),
  };
}

export function auditEventDto(row: AutomationRow): AutomationRow {
  const actorType = row.actor_type === "system_worker"
    ? "system"
    : row.actor_type === "provider_fixture"
    ? "provider"
    : row.actor_type;
  return {
    id: uuid(row.id, "audit.id"),
    company_id: uuid(row.company_id, "audit.company_id"),
    event_type: requiredString(row.event_type, "audit.event_type", 100),
    entity_type: requiredString(row.entity_type, "audit.entity_type", 80),
    entity_id: nullableUuid(row.entity_id, "audit.entity_id"),
    actor_type: enumValue(actorType, "audit.actor_type", [
      "user",
      "system",
      "provider",
    ]),
    actor_user_id: nullableUuid(row.actor_user_id, "audit.actor_user_id"),
    trace_id: nullableString(row.trace_id, "audit.trace_id", 200),
    safe_metadata: safeAutomationMetadata(row.safe_metadata),
    created_at: timestamp(row.created_at, "audit.created_at"),
  };
}

export function mapAutomationCollectionRow(
  table: string,
  row: AutomationRow,
): AutomationRow {
  if (table === "automation_mailboxes") return mailboxDto(row);
  if (table === "mailbox_sync_runs") return syncRunDto(row);
  if (table === "automation_commands") return commandDto(row);
  if (table === "automation_exceptions") return exceptionDto(row);
  if (table === "invoice_reminders") return reminderDto(row);
  if (table === "reminder_delivery_attempts") return reminderAttemptDto(row);
  if (table === "automation_audit_events") return auditEventDto(row);
  return invalid("collection");
}

export const automationPrimitivePatterns = Object.freeze({
  uuid: AUTOMATION_POSTGRES_UUID_PATTERN.source,
  iso_date: ISO_DATE.source,
  iso_timestamp: ISO_TIMESTAMP.source,
  decimal_string: DECIMAL.source,
  currency: CURRENCY.source,
  email: EMAIL.source,
  phone: PHONE.source,
  sha256: SHA256.source,
});
