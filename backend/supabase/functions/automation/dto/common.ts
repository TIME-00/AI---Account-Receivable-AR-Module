import { BusinessError } from "../../_shared/errors.ts";
import {
  AUTOMATION_POSTGRES_UUID_PATTERN,
  isSemanticIsoDate,
  isSemanticIsoTimestamp,
} from "../contract.ts";

export type AutomationRow = Record<string, unknown>;

export const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.\d+)?$/;
export const CURRENCY = /^[A-Z]{3}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE = /^\+[1-9][0-9]{6,14}$/;
export const SHA256 = /^[0-9a-f]{64}$/;

export function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

export function invalid(field: string): never {
  throw new BusinessError(
    "AUTOMATION_RESPONSE_INVALID",
    "Automation data could not be returned safely.",
    500,
    { field },
  );
}

export function requiredString(
  value: unknown,
  field: string,
  max = 1000,
): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    return invalid(field);
  }
  return value;
}

export function nullableString(
  value: unknown,
  field: string,
  max = 1000,
): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value, field, max);
}

export function uuid(value: unknown, field: string): string {
  const text = requiredString(value, field, 36);
  return AUTOMATION_POSTGRES_UUID_PATTERN.test(text) ? text : invalid(field);
}

export function nullableUuid(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return uuid(value, field);
}

export function timestamp(value: unknown, field: string): string {
  const text = requiredString(value, field, 40);
  if (!isSemanticIsoTimestamp(text)) {
    return invalid(field);
  }
  return new Date(text).toISOString();
}

export function nullableTimestamp(
  value: unknown,
  field: string,
): string | null {
  if (value === null || value === undefined) return null;
  return timestamp(value, field);
}

export function date(value: unknown, field: string): string {
  const text = requiredString(value, field, 10);
  return isSemanticIsoDate(text) ? text : invalid(field);
}

export function nullableDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return date(value, field);
}

export function boolean(value: unknown, field: string): boolean {
  return typeof value === "boolean" ? value : invalid(field);
}

export function integer(value: unknown, field: string, minimum = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) return invalid(field);
  return number;
}

export function nullableInteger(
  value: unknown,
  field: string,
  minimum = 0,
): number | null {
  if (value === null || value === undefined) return null;
  return integer(value, field, minimum);
}

export function finiteNumber(value: unknown, field: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return invalid(field);
  return number;
}

export function nullableNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return finiteNumber(value, field);
}

export function decimal(value: unknown, field: string): string {
  const text = String(value);
  return DECIMAL.test(text) ? text : invalid(field);
}

export function patternString(
  value: unknown,
  field: string,
  pattern: RegExp,
  max: number,
): string {
  const text = requiredString(value, field, max);
  return pattern.test(text) ? text : invalid(field);
}

export function nullableDecimal(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return decimal(value, field);
}

export function enumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? value as T
    : invalid(field);
}

export function safeStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 100) return invalid(field);
  return value.map((item, index) =>
    requiredString(item, `${field}.${index}`, 200)
  );
}

export const SENSITIVE_KEY =
  /(access[_-]?token|refresh[_-]?token|secret|password|authorization|private[_-]?key|provider[_-]?(?:body|response)|raw[_-]?(?:document|prompt)|stack|sql|bank|cursor|history[_-]?id|delta[_-]?link)/i;

export const CREDENTIAL_VALUE = [
  /\bBearer\s+\S+/i,
  /\b(?:access_token|refresh_token|client_secret|authorization)\s*[:=]/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /^(?:postgres(?:ql)?|mysql|mssql):\/\//i,
  /^(?:ya29\.|1\/\/|gh[pousr]_|sk-|sbp_|AKIA)[A-Za-z0-9_./+=-]+$/,
  /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/,
  /\bat\s+.+\(.+:\d+:\d+\)/i,
  /\b(?:select|insert|update|delete|drop|alter)\b.+\b(?:from|into|table|set)\b/i,
];

export const UUID_METADATA_KEYS = new Set([
  "assignment_id",
  "superseded_assignment_id",
  "classification_id",
  "extraction_id",
  "attachment_id",
  "command_id",
  "exception_id",
  "invoice_id",
  "mailbox_id",
  "message_id",
  "receipt_id",
  "recovery_id",
  "reminder_id",
  "sales_representative_id",
  "sync_run_id",
]);

export const STATUS_VALUES = new Set([
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

export const ACTION_VALUES = new Set([
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
  "correct_reference",
  "confirm_match",
  "retry_matching",
]);

export const CHANGED_FIELD_VALUES = new Set([
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
  "reminder_mode",
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

export const REASON_CODE_VALUES = new Set([
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
  "fx_reference_unavailable",
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

export type MetadataValidator = (value: unknown) => unknown | undefined;

export function credentialShaped(value: string): boolean {
  if (
    value.length > 200 ||
    CREDENTIAL_VALUE.some((pattern) => pattern.test(value))
  ) {
    return true;
  }
  return value.length >= 48 && /[a-z]/.test(value) && /[A-Z]/.test(value) &&
    /[0-9]/.test(value) && /^[A-Za-z0-9+/_=-]+$/.test(value);
}

export function exactString(values: ReadonlySet<string>): MetadataValidator {
  return (value) =>
    typeof value === "string" && !credentialShaped(value) && values.has(value)
      ? value
      : undefined;
}

export function metadataUuid(value: unknown): unknown | undefined {
  return typeof value === "string" && !credentialShaped(value) &&
      AUTOMATION_POSTGRES_UUID_PATTERN.test(value)
    ? value
    : undefined;
}

export const METADATA_VALIDATORS: Record<string, MetadataValidator> = {
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
