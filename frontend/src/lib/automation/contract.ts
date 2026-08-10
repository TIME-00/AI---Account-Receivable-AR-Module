// ============================================================================
// Gate E — Autonomous AR Operations — frozen frontend contract (gate-e.1)
//
// Strict Zod parsing for every Gate E API response. The backend is the single
// authority: the UI never computes FX, allocation, customer matches, or
// financial totals, and never trusts a raw payload. Any response that does not
// match the frozen `gate-e.1` contract fails closed at the parse boundary.
//
// Primitive validators and every record shape below mirror the backend DTO
// normalization boundary (backend/supabase/functions/automation/dto.ts) and the
// frozen contract document (docs/contracts/GATE_E_AUTOMATION_API_CONTRACT.md)
// exactly. Weak "non-empty string" validation is intentionally NOT used for
// identifiers, timestamps, decimals, currency, email, phone, or hashes.
// ============================================================================

import { z } from "zod";

// ─── Strict primitives (mirror dto.ts) ────────────────────────────────────────

/**
 * Canonical PostgreSQL UUID text: 8-4-4-4-12 lowercase/uppercase hexadecimal,
 * case-insensitive. Mirrors the backend Gate E database UUID contract, which
 * intentionally does NOT impose application-level RFC version/variant bits so
 * that any well-formed PostgreSQL `uuid` value (including the all-zeros-prefixed
 * Production company identifier) is accepted. Scheduler nonce authorization
 * validation remains separately UUIDv4-specific and is defined elsewhere.
 */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ISO-8601 UTC timestamp with optional fractional seconds and offset. */
export const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
/** Calendar date `YYYY-MM-DD`. */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Base-10 decimal string; the UI never re-computes money. */
export const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.\d+)?$/;
/** ISO 4217 currency. */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;
/** Normalized bounded email. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** E.164 international phone. */
export const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/;
/** 64-char lowercase hex (SHA-256 / idempotency key). */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

// ─── Semantic calendar/clock validation (mirror backend contract.ts) ──────────
// Regex alone accepts impossible dates like 2026-02-30 or offset +15:00. These
// validators enforce a real Gregorian calendar date and valid clock/offset
// components exactly as the backend does, so the frontend rejects the same
// impossible values rather than trusting a syntactically-shaped string.

const ISO_DATE_COMPONENTS = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP_COMPONENTS =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function validGregorianComponents(
  year: number,
  month: number,
  day: number,
): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

/** True only for a real calendar date `YYYY-MM-DD`. */
export function isSemanticIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_COMPONENTS.exec(value);
  if (!match) return false;
  return validGregorianComponents(Number(match[1]), Number(match[2]), Number(match[3]));
}

/**
 * True only for an ISO-8601 timestamp with a real date, valid clock components,
 * an explicit `Z`/offset (no implicit local-time normalization), and an offset
 * bounded to ±14:00 — matching the backend semantic validator.
 */
export function isSemanticIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_TIMESTAMP_COMPONENTS.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === "Z" ? 0 : Number(match[10]);
  const offsetMinute = match[8] === "Z" ? 0 : Number(match[11]);
  if (
    !validGregorianComponents(year, month, day) ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 14 || offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

const uuid = z.string().regex(UUID_PATTERN, "invalid uuid");
const isoTimestamp = z
  .string()
  .refine(isSemanticIsoTimestamp, "invalid iso timestamp");
const isoDate = z.string().refine(isSemanticIsoDate, "invalid iso date");
const decimalString = z.string().regex(DECIMAL_PATTERN, "invalid decimal");
const currency = z.string().regex(CURRENCY_PATTERN, "invalid currency");
const email = z.string().regex(EMAIL_PATTERN, "invalid email").max(254);
const phone = z.string().regex(PHONE_PATTERN, "invalid phone").max(30);
const sha256 = z.string().regex(SHA256_PATTERN, "invalid sha-256");

/** Small helper: a bounded non-empty string with an explicit max length. */
const boundedString = (max: number) => z.string().min(1).max(max);

// ─── Enums (exact value sets) ─────────────────────────────────────────────────

export const PROVIDER_TYPES = ["gmail", "microsoft"] as const;
export const OPERATING_MODES = [
  "disabled",
  "observe_only",
  "draft_only",
  "straight_through",
] as const;
export const CONNECTION_STATUSES = [
  "disabled",
  "pending_consent",
  "connected",
  "reconnect_required",
  "error",
] as const;
export const CURSOR_KINDS = ["history_id", "delta_link"] as const;
export const RUN_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "reconnect_required",
] as const;
export const DOCUMENT_TYPES = [
  "invoice",
  "receipt",
  "payment_advice",
  "unsupported",
  "ambiguous",
] as const;
export const CLASSIFICATION_STATUSES = ["proposed", "accepted", "rejected"] as const;
export const ATTACHMENT_PROCESSING_STATUSES = [
  "pending",
  "retryable",
  "processed",
] as const;
export const EXTRACTION_VALIDATION_STATUSES = [
  "pending",
  "valid",
  "invalid",
  "ambiguous",
  "unsupported",
] as const;
export const CUSTOMER_RESOLUTION_METHODS = [
  "customer_code",
  "registration_identifier",
  "known_email",
  "invoice_reference",
  "unique_normalized_name",
] as const;
export const COMMAND_TYPES = [
  "create_invoice",
  "create_receipt",
  "allocate_receipt",
] as const;
export const COMMAND_MODES = ["observe_only", "draft_only", "straight_through"] as const;
export const COMMAND_STATUSES = [
  "proposed",
  "pending",
  "running",
  "completed",
  "failed",
  "refused",
] as const;
export const EXCEPTION_LIFECYCLES = [
  "open",
  "retryable",
  "resolved",
  "dismissed",
] as const;
export const EXCEPTION_REASON_CODES = [
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
  "missing_salesman",
  "invalid_salesman_email",
  "allocation_evidence_insufficient",
  "allocation_currency_mismatch",
  "allocation_conflict",
  "concurrency_conflict",
  "provider_delivery_failed",
  "internal_processing_failure",
] as const;
export const REMINDER_STATUSES = [
  "pending",
  "sending",
  "delivered",
  "failed",
  "cancelled",
] as const;
export const REMINDER_ATTEMPT_STATUSES = [
  "pending",
  "sending",
  "sent",
  "retryable_failure",
  "permanent_failure",
] as const;
export const ASSIGNMENT_SOURCES = [
  "customer_acquisition",
  "customer_onboarding",
  "manual_assignment",
  "import",
] as const;
/** Backend-normalized audit actor types (dto.ts collapses worker/fixture). */
export const AUDIT_ACTOR_TYPES = ["user", "system", "provider"] as const;
export const OAUTH_CAPABILITIES = ["ingestion", "delivery"] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];
export type OperatingMode = (typeof OPERATING_MODES)[number];
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type ClassificationStatus = (typeof CLASSIFICATION_STATUSES)[number];
export type AttachmentProcessingStatus = (typeof ATTACHMENT_PROCESSING_STATUSES)[number];
export type CommandType = (typeof COMMAND_TYPES)[number];
export type CommandStatus = (typeof COMMAND_STATUSES)[number];
export type ExceptionLifecycle = (typeof EXCEPTION_LIFECYCLES)[number];
export type ExceptionReasonCode = (typeof EXCEPTION_REASON_CODES)[number];
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];
export type ReminderAttemptStatus = (typeof REMINDER_ATTEMPT_STATUSES)[number];
export type AssignmentSource = (typeof ASSIGNMENT_SOURCES)[number];
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
export type OAuthCapability = (typeof OAUTH_CAPABILITIES)[number];

const providerType = z.enum(PROVIDER_TYPES);
const operatingMode = z.enum(OPERATING_MODES);

// ─── Envelope + collection meta ───────────────────────────────────────────────

export const GATE_E_CONTRACT_VERSION = "gate-e.1" as const;

export const collectionMetaSchema = z.object({
  page: z.number().int().nonnegative(),
  page_size: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  has_more: z.boolean(),
}).strict();
export type CollectionMeta = z.infer<typeof collectionMetaSchema>;

/** Success envelope exactly as the Edge Function returns it. */
export const successEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.unknown(),
  contract_version: z.literal(GATE_E_CONTRACT_VERSION),
  meta: collectionMetaSchema.optional(),
}).strict();

/** Error envelope exactly as the Edge Function returns it. */
export const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    details: z.unknown().optional(),
  }).strict(),
  contract_version: z.literal(GATE_E_CONTRACT_VERSION),
}).strict();

// ─── Safe-metadata allowlist (mirror dto.ts) ──────────────────────────────────

/** Defense-in-depth: never render a value under an obviously sensitive key. */
const SENSITIVE_KEY_PATTERN =
  /(access[_-]?token|refresh[_-]?token|secret|password|authorization|private[_-]?key|provider[_-]?(?:body|response)|raw[_-]?(?:document|prompt)|stack|sql|bank|cursor|history[_-]?id|delta[_-]?link)/i;

export type SafeMetadataValue = string | number | boolean | string[];

// ─── Per-key metadata validators (mirror backend dto.ts METADATA_VALIDATORS) ──
// A value is rendered ONLY when its key has an explicit validator AND the value
// passes that validator. This is stronger than a key allowlist: a
// credential-shaped string under an otherwise-safe key (e.g. a JWT under
// `status`) is rejected because it is not a member of the key's exact value set.
// A defensive `credentialShaped` guard covers the few free-form keys as well.

const STATUS_VALUES = new Set<string>([
  "disabled", "pending_consent", "connected", "reconnect_required", "error",
  "pending", "running", "completed", "failed", "received",
  "attachments_persisted", "classified", "validated", "commanded", "exception",
  "ignored", "retryable", "processed", "proposed", "accepted", "rejected",
  "valid", "invalid", "ambiguous", "unsupported", "refused", "open", "resolved",
  "dismissed", "sending", "delivered", "cancelled", "sent", "retryable_failure",
  "permanent_failure",
]);

const ACTION_VALUES = new Set<string>([
  "create", "update", "activate", "deactivate", "assign", "reassign", "retry",
  "resolve", "resolved", "dismiss", "dismissed", "process", "evaluate",
  "deliver", "allocate",
]);

const CHANGED_FIELD_VALUES = new Set<string>([
  "name", "email", "phone", "is_active", "operating_mode", "mailbox_sync_enabled",
  "document_intelligence_enabled", "invoice_automation_enabled",
  "receipt_automation_enabled", "auto_allocation_enabled",
  "reminder_evaluation_enabled", "reminder_delivery_enabled",
  "reminder_stage_offsets", "reminder_timezone", "minimum_overall_confidence",
  "minimum_critical_confidence", "default_bank_account_id", "is_enabled",
  "ingestion_enabled", "delivery_enabled", "connection_status",
]);

const UUID_METADATA_KEYS = [
  "assignment_id", "superseded_assignment_id", "classification_id",
  "extraction_id", "attachment_id", "command_id", "invoice_id", "mailbox_id",
  "message_id", "receipt_id", "reminder_id", "sales_representative_id",
  "sync_run_id",
] as const;

const CREDENTIAL_VALUE_PATTERNS = [
  /\bBearer\s+\S+/i,
  /\b(?:access_token|refresh_token|client_secret|authorization)\s*[:=]/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /^(?:postgres(?:ql)?|mysql|mssql):\/\//i,
  /^(?:ya29\.|1\/\/|gh[pousr]_|sk-|sbp_|AKIA)[A-Za-z0-9_./+=-]+$/,
  /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/,
  /\bat\s+.+\(.+:\d+:\d+\)/i,
  /\b(?:select|insert|update|delete|drop|alter)\b.+\b(?:from|into|table|set)\b/i,
];

/** Mirror of the backend `credentialShaped` heuristic. */
function credentialShaped(value: string): boolean {
  if (value.length > 200 || CREDENTIAL_VALUE_PATTERNS.some((p) => p.test(value))) {
    return true;
  }
  return (
    value.length >= 48 && /[a-z]/.test(value) && /[A-Z]/.test(value) &&
    /[0-9]/.test(value) && /^[A-Za-z0-9+/_=-]+$/.test(value)
  );
}

type MetadataValidator = (value: unknown) => SafeMetadataValue | undefined;

const exactString = (values: ReadonlySet<string>): MetadataValidator =>
  (value) =>
    typeof value === "string" && !credentialShaped(value) && values.has(value)
      ? value
      : undefined;

const metadataUuid: MetadataValidator = (value) =>
  typeof value === "string" && !credentialShaped(value) && UUID_PATTERN.test(value)
    ? value
    : undefined;

const booleanValue: MetadataValidator = (value) =>
  typeof value === "boolean" ? value : undefined;

const METADATA_VALIDATORS: Record<string, MetadataValidator> = {
  action: exactString(ACTION_VALUES),
  capability: exactString(new Set(["ingestion", "delivery"])),
  changed_fields: (value) =>
    Array.isArray(value) && value.length <= 20 &&
      value.every((item) =>
        typeof item === "string" && !credentialShaped(item) &&
        CHANGED_FIELD_VALUES.has(item)
      )
      ? [...(value as string[])]
      : undefined,
  command_type: exactString(new Set(COMMAND_TYPES)),
  document_type: exactString(new Set(DOCUMENT_TYPES)),
  error_code: (value) =>
    typeof value === "string" && !credentialShaped(value) &&
      /^[A-Z][A-Z0-9_]{0,79}$/.test(value)
      ? value
      : undefined,
  from_status: exactString(STATUS_VALUES),
  lifecycle_status: exactString(new Set(EXCEPTION_LIFECYCLES)),
  operating_mode: exactString(new Set(OPERATING_MODES)),
  operation: exactString(new Set(["insert", "update", "delete"])),
  processing_status: exactString(STATUS_VALUES),
  provider_type: exactString(new Set(PROVIDER_TYPES)),
  reason_code: exactString(new Set(EXCEPTION_REASON_CODES)),
  retry_blocked: booleanValue,
  stage_offset_days: (value) =>
    typeof value === "number" && Number.isSafeInteger(value) &&
      value >= -90 && value <= 0
      ? value
      : undefined,
  status: exactString(STATUS_VALUES),
  to_status: exactString(STATUS_VALUES),
  validation_status: exactString(new Set(EXTRACTION_VALIDATION_STATUSES)),
  source: exactString(new Set(ASSIGNMENT_SOURCES)),
  duplicate_no_op: booleanValue,
  provider_attachment_present: booleanValue,
};
for (const key of UUID_METADATA_KEYS) {
  METADATA_VALIDATORS[key] = metadataUuid;
}

/**
 * Explicit allowlist of audit/exception metadata keys the UI may render —
 * exactly the keys with a per-key validator above. Mirrors the backend so the
 * client never surfaces a scalar the backend would have suppressed.
 */
export const SAFE_METADATA_KEYS: ReadonlySet<string> = new Set(
  Object.keys(METADATA_VALIDATORS),
);

/**
 * Reduce an arbitrary metadata object to safely-renderable entries. Each entry
 * must have an allowlisted key AND a value that passes that key's exact
 * validator; credential-shaped strings, sensitive keys, and object /
 * array-of-object values are dropped. Returns an ordered `[key, value]` list.
 */
export function filterSafeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): [string, SafeMetadataValue][] {
  if (!metadata || typeof metadata !== "object") return [];
  const out: [string, SafeMetadataValue][] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const validator = METADATA_VALIDATORS[key];
    if (!validator) continue;
    const safe = validator(value);
    if (safe !== undefined) out.push([key, safe]);
  }
  return out;
}

// ─── Records ──────────────────────────────────────────────────────────────────

export const settingsSchema = z.object({
  company_id: uuid,
  automation_actor_user_id: uuid.nullable(),
  operating_mode: operatingMode,
  mailbox_sync_enabled: z.boolean(),
  document_intelligence_enabled: z.boolean(),
  invoice_automation_enabled: z.boolean(),
  receipt_automation_enabled: z.boolean(),
  auto_allocation_enabled: z.boolean(),
  reminder_evaluation_enabled: z.boolean(),
  reminder_delivery_enabled: z.boolean(),
  reminder_stage_offsets: z.array(z.number().int()),
  reminder_timezone: boundedString(100),
  extraction_schema_version: z.number().int().positive(),
  minimum_overall_confidence: z.number(),
  minimum_critical_confidence: z.number(),
  created_at: isoTimestamp.nullable(),
  updated_at: isoTimestamp.nullable(),
  created_by: uuid.nullable(),
  updated_by: uuid.nullable(),
}).strict();
export type AutomationSettings = z.infer<typeof settingsSchema>;

export const KILL_SWITCH_KEYS = [
  "mailbox_sync_enabled",
  "document_intelligence_enabled",
  "invoice_automation_enabled",
  "receipt_automation_enabled",
  "auto_allocation_enabled",
  "reminder_evaluation_enabled",
  "reminder_delivery_enabled",
] as const;
export type KillSwitchKey = (typeof KILL_SWITCH_KEYS)[number];

export const salesRepresentativeSchema = z.object({
  id: uuid,
  company_id: uuid,
  name: boundedString(200),
  email: email.nullable(),
  phone: phone.nullable(),
  is_active: z.boolean(),
  created_at: isoTimestamp.nullable(),
  updated_at: isoTimestamp.nullable(),
  created_by: uuid.nullable(),
  updated_by: uuid.nullable(),
}).strict();
export type SalesRepresentative = z.infer<typeof salesRepresentativeSchema>;

export const assignmentSchema = z.object({
  id: uuid,
  company_id: uuid,
  customer_id: uuid,
  sales_representative_id: uuid,
  assignment_source: z.enum(ASSIGNMENT_SOURCES),
  assigned_by: uuid.nullable(),
  assigned_at: isoTimestamp,
  assignment_reason: boundedString(500),
  superseded_at: isoTimestamp.nullable(),
  superseded_by: uuid.nullable(),
  created_at: isoTimestamp.nullable(),
}).strict();
export type Assignment = z.infer<typeof assignmentSchema>;

/** `{assignment, sales_representative}` — used for current owner and history rows. */
export const assignmentWithRepSchema = z.object({
  assignment: assignmentSchema,
  sales_representative: salesRepresentativeSchema,
}).strict();
export type AssignmentWithRep = z.infer<typeof assignmentWithRepSchema>;

/** Current-owner responses add the nested representative (or null when unset). */
export const currentAssignmentSchema = assignmentWithRepSchema.nullable();
export type CurrentAssignment = z.infer<typeof currentAssignmentSchema>;

export const mailboxSchema = z.object({
  id: uuid,
  company_id: uuid,
  provider_type: providerType,
  mailbox_address: email,
  default_bank_account_id: uuid.nullable(),
  connection_status: z.enum(CONNECTION_STATUSES),
  // Secret-reference NAMES are never returned; only whether one is configured.
  ingestion_secret_configured: z.boolean(),
  delivery_secret_configured: z.boolean(),
  ingestion_token_expires_at: isoTimestamp.nullable(),
  delivery_token_expires_at: isoTimestamp.nullable(),
  cursor_kind: z.enum(CURSOR_KINDS).nullable(),
  // Raw cursor is never returned; only whether one is present.
  cursor_present: z.boolean(),
  last_successful_sync_at: isoTimestamp.nullable(),
  last_failed_sync_at: isoTimestamp.nullable(),
  reconnect_required: z.boolean(),
  is_enabled: z.boolean(),
  ingestion_enabled: z.boolean(),
  delivery_enabled: z.boolean(),
  redacted_error_code: z.string().max(80).nullable(),
  created_at: isoTimestamp.nullable(),
  updated_at: isoTimestamp.nullable(),
}).strict();
export type Mailbox = z.infer<typeof mailboxSchema>;

export const syncRunSchema = z.object({
  id: uuid,
  company_id: uuid,
  mailbox_id: uuid,
  provider_type: providerType,
  status: z.enum(RUN_STATUSES),
  // Cursors are redacted at the DTO boundary: literal "[redacted]" or null.
  cursor_before: z.union([z.literal("[redacted]"), z.null()]),
  cursor_after: z.union([z.literal("[redacted]"), z.null()]),
  started_at: isoTimestamp.nullable(),
  completed_at: isoTimestamp.nullable(),
  failed_at: isoTimestamp.nullable(),
  messages_discovered: z.number().int().nonnegative(),
  messages_persisted: z.number().int().nonnegative(),
  attachments_discovered: z.number().int().nonnegative(),
  attachments_persisted: z.number().int().nonnegative(),
  duplicate_messages: z.number().int().nonnegative(),
  duplicate_attachments: z.number().int().nonnegative(),
  attachments_processed: z.number().int().nonnegative(),
  commands_processed: z.number().int().nonnegative(),
  allocations_completed: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  attempt_count: z.number().int().positive(),
  max_attempts: z.number().int().positive(),
  redacted_error_code: z.string().max(80).nullable(),
  created_at: isoTimestamp.nullable(),
}).strict();
export type SyncRun = z.infer<typeof syncRunSchema>;

const attachmentMetadataSchema = z.object({
  id: uuid,
  file_name: z.string(),
  content_mime_type: z.string().nullable(),
  size_bytes: z.number().int().nonnegative().nullable(),
  page_count: z.number().int().nonnegative().nullable(),
  scan_status: z.string().nullable(),
  safety_status: z.string().nullable(),
  processing_status: z.enum(ATTACHMENT_PROCESSING_STATUSES),
  content_purged_at: isoTimestamp.nullable(),
}).strict();
export type AttachmentMetadata = z.infer<typeof attachmentMetadataSchema>;

const extractionSchema = z.object({
  id: uuid,
  schema_version: z.number().int().positive(),
  document_type: z.enum(DOCUMENT_TYPES),
  validation_status: z.enum(EXTRACTION_VALIDATION_STATUSES),
  validation_codes: z.array(z.string()),
  field_confidence: z.record(z.string(), z.number()).nullable(),
  customer_id: uuid.nullable(),
  // dto.ts returns this as a bounded string, not a strict enum.
  customer_resolution_method: z.string().max(80).nullable(),
  trace_id: z.string().nullable(),
  validated_at: isoTimestamp.nullable(),
  created_at: isoTimestamp.nullable(),
}).strict();
export type Extraction = z.infer<typeof extractionSchema>;

/** Bounded command reference embedded in a document decision. */
export const commandReferenceSchema = z.object({
  id: uuid,
  command_type: z.enum(COMMAND_TYPES),
  status: z.enum(COMMAND_STATUSES),
  resulting_invoice_id: uuid.nullable(),
  resulting_receipt_id: uuid.nullable(),
  failure_code: z.string().max(80).nullable(),
}).strict();
export type CommandReference = z.infer<typeof commandReferenceSchema>;

export const documentDecisionSchema = z.object({
  id: uuid,
  company_id: uuid,
  attachment_id: uuid,
  schema_version: z.number().int().positive(),
  document_type: z.enum(DOCUMENT_TYPES),
  status: z.enum(CLASSIFICATION_STATUSES),
  confidence: z.number().nullable(),
  critical_field_confidence: z.number().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  provider_version: z.string().nullable(),
  trace_id: z.string().nullable(),
  created_at: isoTimestamp.nullable(),
  attachment: attachmentMetadataSchema.nullable(),
  extraction: extractionSchema.nullable(),
  command: commandReferenceSchema.nullable(),
  linked_exception_ids: z.array(uuid),
}).strict();
export type DocumentDecision = z.infer<typeof documentDecisionSchema>;

export const commandSchema = z.object({
  id: uuid,
  command_type: z.enum(COMMAND_TYPES),
  status: z.enum(COMMAND_STATUSES),
  resulting_invoice_id: uuid.nullable(),
  resulting_receipt_id: uuid.nullable(),
  failure_code: z.string().max(80).nullable(),
  company_id: uuid,
  mailbox_id: uuid,
  message_id: uuid,
  attachment_id: uuid,
  extraction_id: uuid,
  operating_mode: z.enum(COMMAND_MODES),
  schema_version: z.number().int().positive(),
  idempotency_key: sha256,
  created_by: uuid.nullable(),
  created_at: isoTimestamp.nullable(),
  completed_at: isoTimestamp.nullable(),
  failed_at: isoTimestamp.nullable(),
}).strict();
export type AutomationCommand = z.infer<typeof commandSchema>;

/**
 * Bounded monitoring projection for the linked source document (Automation
 * v15). This mirrors the backend `exceptionDto` `document` object EXACTLY: it
 * exposes only human-readable file identity, document/classification status,
 * and a lifecycle-derived manual-review flag. It NEVER carries document bytes,
 * raw extraction fields, provider payloads, or any OAuth/credential data.
 *
 * Bounds mirror the backend: `file_name` is a required string ≤255, and
 * `processing_status` is a required bounded string ≤40 (the backend projects it
 * as a bounded string, not a closed enum, so the mirror must not over-constrain
 * it to the attachment-status enum and fail-close on a valid backend value).
 * `document_type` and `classification_status` are the backend enums (nullable).
 */
export const exceptionDocumentSchema = z.object({
  file_name: z.string().min(1).max(255),
  document_type: z.enum(DOCUMENT_TYPES).nullable(),
  processing_status: z.string().min(1).max(40),
  classification_status: z.enum(CLASSIFICATION_STATUSES).nullable(),
  manual_review_required: z.boolean(),
}).strict();
export type ExceptionDocument = z.infer<typeof exceptionDocumentSchema>;

export const exceptionSchema = z.object({
  id: uuid,
  company_id: uuid,
  mailbox_id: uuid.nullable(),
  sync_run_id: uuid.nullable(),
  message_id: uuid.nullable(),
  attachment_id: uuid.nullable(),
  command_id: uuid.nullable(),
  invoice_id: uuid.nullable(),
  receipt_id: uuid.nullable(),
  // dto.ts returns reason_code as a bounded string; label map handles unknowns.
  reason_code: z.string().min(1).max(80),
  idempotency_key: sha256.nullable(),
  lifecycle_status: z.enum(EXCEPTION_LIFECYCLES),
  safe_details: z.record(z.string(), z.unknown()).nullable(),
  retry_count: z.number().int().nonnegative(),
  max_retries: z.number().int().nonnegative(),
  actor_user_id: uuid.nullable(),
  resolution_note: z.string().nullable(),
  // Automation v15 always emits this key; the value is nullable (no linked
  // document) or the exact bounded projection above. Required, not optional —
  // a missing key means a contract drift and must fail closed.
  document: exceptionDocumentSchema.nullable(),
  opened_at: isoTimestamp.nullable(),
  resolved_at: isoTimestamp.nullable(),
  dismissed_at: isoTimestamp.nullable(),
  created_at: isoTimestamp.nullable(),
  updated_at: isoTimestamp.nullable(),
}).strict();
export type AutomationException = z.infer<typeof exceptionSchema>;

export const reminderSchema = z.object({
  id: uuid,
  company_id: uuid,
  invoice_id: uuid,
  customer_id: uuid,
  sales_representative_id: uuid,
  stage_offset_days: z.number().int(),
  scheduled_for: isoDate,
  status: z.enum(REMINDER_STATUSES),
  recipient_name_snapshot: z.string().nullable(),
  recipient_email_snapshot: z.string().nullable(),
  recipient_phone_snapshot: z.string().nullable(),
  customer_name_snapshot: z.string().nullable(),
  invoice_no_snapshot: z.string().nullable(),
  due_date_snapshot: isoDate.nullable(),
  outstanding_snapshot: decimalString.nullable(),
  currency_snapshot: currency.nullable(),
  created_at: isoTimestamp.nullable(),
  delivered_at: isoTimestamp.nullable(),
}).strict();
export type InvoiceReminder = z.infer<typeof reminderSchema>;

export const reminderAttemptSchema = z.object({
  id: uuid,
  company_id: uuid,
  reminder_id: uuid,
  mailbox_id: uuid,
  provider_type: providerType,
  attempt_number: z.number().int().positive(),
  idempotency_key: sha256,
  status: z.enum(REMINDER_ATTEMPT_STATUSES),
  provider_message_id: z.string().nullable(),
  error_class: z.string().nullable(),
  redacted_error_code: z.string().max(80).nullable(),
  started_at: isoTimestamp.nullable(),
  completed_at: isoTimestamp.nullable(),
  created_at: isoTimestamp.nullable(),
}).strict();
export type ReminderAttempt = z.infer<typeof reminderAttemptSchema>;

export const auditEventSchema = z.object({
  id: uuid,
  company_id: uuid,
  event_type: boundedString(100),
  entity_type: boundedString(80),
  entity_id: uuid.nullable(),
  actor_type: z.enum(AUDIT_ACTOR_TYPES),
  actor_user_id: uuid.nullable(),
  trace_id: z.string().nullable(),
  safe_metadata: z.record(z.string(), z.unknown()).nullable(),
  created_at: isoTimestamp,
}).strict();
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const overviewSchema = z.object({
  settings: settingsSchema,
  // Readiness is split per capability — there is no generic `provider_ready`.
  // `ingestion_ready` gates mailbox/document ingestion; `delivery_ready` gates
  // reminder-email delivery ONLY; `document_intelligence_ready` gates
  // classification/extraction. Each is independently fail-closed on the server.
  ingestion_ready: z.boolean(),
  delivery_ready: z.boolean(),
  document_intelligence_ready: z.boolean(),
  connected_mailbox_count: z.number().int().nonnegative(),
  reconnect_required_mailbox_count: z.number().int().nonnegative(),
  last_successful_sync_at: isoTimestamp.nullable(),
  last_failed_sync_at: isoTimestamp.nullable(),
  processing_runs: z.number().int().nonnegative(),
  documents_processed: z.number().int().nonnegative(),
  accepted_documents: z.number().int().nonnegative(),
  rejected_documents: z.number().int().nonnegative(),
  invoices_created: z.number().int().nonnegative(),
  receipts_created: z.number().int().nonnegative(),
  allocations_completed: z.number().int().nonnegative(),
  reminders_evaluated: z.number().int().nonnegative(),
  reminders_sent: z.number().int().nonnegative(),
  open_exceptions: z.number().int().nonnegative(),
  retryable_exceptions: z.number().int().nonnegative(),
}).strict();
export type AutomationOverview = z.infer<typeof overviewSchema>;

// ─── Mutation-result DTOs ──────────────────────────────────────────────────────

export const allocationResultSchema = z.object({
  command_id: uuid,
  receipt_id: uuid,
  allocated_count: z.number().int().nonnegative(),
  total_allocated: decimalString,
  receipt_status: boundedString(40),
}).strict();
export type AllocationResult = z.infer<typeof allocationResultSchema>;

export const oauthStartSchema = z.object({
  provider: providerType,
  authorization_url: z.string().url(),
  expires_at: isoTimestamp,
  capability: z.enum(OAUTH_CAPABILITIES),
}).strict();
export type OAuthStart = z.infer<typeof oauthStartSchema>;

export const assignmentResultSchema = z.object({
  changed: z.boolean(),
  current: currentAssignmentSchema,
}).strict();
export type AssignmentResult = z.infer<typeof assignmentResultSchema>;

// ─── Strict parse helpers (fail closed) ───────────────────────────────────────

export class GateEContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateEContractError";
  }
}

/** Parse an already-unwrapped `data` payload; throws on any contract drift. */
export function parseGateEData<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new GateEContractError(
      "A Gate E response did not match the gate-e.1 contract.",
    );
  }
  return result.data;
}

export interface GateECollection<T> {
  rows: T[];
  meta: CollectionMeta;
}

/** Parse a paginated collection (`data: []` + collection `meta`). */
export function parseGateECollection<T>(
  schema: z.ZodType<T>,
  data: unknown,
  meta: unknown,
): GateECollection<T> {
  const rows = parseGateEData(z.array(schema), data);
  const parsedMeta = collectionMetaSchema.safeParse(meta);
  if (!parsedMeta.success) {
    throw new GateEContractError("Gate E collection meta is invalid.");
  }
  return { rows, meta: parsedMeta.data };
}
