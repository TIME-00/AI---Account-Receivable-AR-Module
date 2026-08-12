// ============================================================================
// Post-Gate-E — Journal Entries + Audit Trail READ viewer contract.
//
// These types mirror the reviewed backend read contracts EXACTLY:
//   backend/supabase/functions/journal-entries/{contract,read-service}.ts
//   backend/supabase/functions/audit-trail/{contract,service}.ts
//
// Three properties this module exists to guarantee:
//
//   1. Money stays a DECIMAL STRING end to end. The backend casts NUMERIC to
//      text precisely so exact values survive; parsing them through `Number`
//      would reintroduce binary floating point into a financial surface. There
//      is deliberately no helper here that returns a number for an amount.
//   2. A source-document link is derived ONLY from the backend's allow-listed
//      `source` object. A `source_type` string alone (REV/ADJ/WO, or an
//      unresolved source) never produces a route.
//   3. Actor and metadata presentation are closed vocabularies. "unknown" is
//      never relabelled as a system actor, and only allow-listed metadata keys
//      are rendered — the raw object is never dumped.
// ============================================================================

import { z } from "zod";
import type { UserRole } from "@/types";

// ─── Role policy (UX gate only — the backend remains final authority) ───────

/**
 * Journal viewer roles, mirroring `requireJournalReadAccess` AND the
 * independent `ur.role IN (...)` check inside `journal_read_list` /
 * `journal_read_detail`. AR Clerk and System Admin are excluded: AR Clerk has
 * no company-wide financial read, and System Admin is configuration-only.
 */
export const JOURNAL_VIEWER_ROLES: readonly UserRole[] = [
  "AR Supervisor",
  "Finance Manager",
  "Auditor",
];

/**
 * Audit viewer roles, mirroring `requireAuditReadAccess` and the database
 * check in `audit_read_list` / `audit_read_detail`. Narrower than the Journal
 * policy by design: AR Supervisor is NOT granted the company-wide Audit Trail.
 */
export const AUDIT_VIEWER_ROLES: readonly UserRole[] = ["Finance Manager", "Auditor"];

function hasAnyRole(userRoles: readonly string[], allowed: readonly string[]): boolean {
  return userRoles.some((role) => allowed.includes(role));
}

/** Whether these roles may open the Journal Entries viewer. */
export function canViewJournalEntries(userRoles: readonly string[]): boolean {
  return hasAnyRole(userRoles, JOURNAL_VIEWER_ROLES);
}

/** Whether these roles may open the Audit Trail viewer. */
export function canViewAuditTrail(userRoles: readonly string[]): boolean {
  return hasAnyRole(userRoles, AUDIT_VIEWER_ROLES);
}

// ─── Journal contract ───────────────────────────────────────────────────────

export const JOURNAL_SOURCE_TYPES = ["INV", "RCT", "CN", "DN", "REV", "ADJ", "WO"] as const;
export type JournalSourceType = (typeof JOURNAL_SOURCE_TYPES)[number];

/** Human labels for the source types the backend actually supports. */
export const JOURNAL_SOURCE_LABEL: Record<JournalSourceType, string> = {
  INV: "Invoice",
  RCT: "Receipt",
  CN: "Credit Note",
  DN: "Debit Note",
  REV: "Reversal",
  ADJ: "Adjustment",
  WO: "Write-Off",
};

/** Label a source type without inventing one for an unexpected value. */
export function journalSourceLabel(sourceType: string): string {
  return (JOURNAL_SOURCE_LABEL as Record<string, string>)[sourceType] ?? sourceType;
}

export type JournalSourceEntityType = "invoice" | "credit_note" | "debit_note" | "receipt";

export interface JournalSourceLink {
  entity_type: JournalSourceEntityType;
  entity_id: string;
  entity_number: string;
}

export interface JournalListItem {
  id: string;
  je_no: string;
  je_date: string;
  posting_period: string;
  source_type: string;
  source_doc_no: string | null;
  source_doc_id: string | null;
  description: string | null;
  currency: string;
  base_currency: string;
  /** Exact decimal string — never parsed into a number. */
  total_debit: string;
  total_credit: string;
  is_balanced: boolean;
  is_reversal: boolean;
  created_at: string;
  created_by: string | null;
  line_count: number;
  source: JournalSourceLink | null;
}

export interface JournalLine {
  id: string;
  line_no: number;
  gl_account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  description: string | null;
  debit_amount: string;
  credit_amount: string;
  base_debit: string;
  base_credit: string;
  currency: string;
  original_amount: string | null;
  created_at: string;
}

export interface JournalDetail extends JournalListItem {
  exchange_rate: string;
  original_je_id: string | null;
  reversal_je_id: string | null;
  is_reversed: boolean;
  lines: JournalLine[];
}

export interface CursorMeta {
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * Routes for the ONLY entity types the backend will ever put in `source`.
 * Credit and Debit Notes are Invoice-family records and share the Invoice
 * detail route, which is a real page in this app.
 */
const SOURCE_ROUTES: Record<JournalSourceEntityType, string> = {
  invoice: "/invoices",
  credit_note: "/invoices",
  debit_note: "/invoices",
  receipt: "/receipts",
};

/**
 * Build a source-document href, or `null` when the backend did not supply a
 * linkable source. A REV/ADJ/WO entry, or one whose source document could not
 * be resolved inside the company boundary, returns `null` — the UI must then
 * show plain text rather than fabricate a destination from `source_doc_no`.
 */
export function journalSourceHref(source: JournalSourceLink | null | undefined): string | null {
  if (!source) return null;
  const base = SOURCE_ROUTES[source.entity_type];
  if (!base) return null;
  return `${base}/${encodeURIComponent(source.entity_id)}`;
}

// ─── Audit contract ─────────────────────────────────────────────────────────

export const AUDIT_ACTOR_TYPES = ["user", "system", "unknown"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const AUDIT_ENTITY_TYPES = [
  "invoice",
  "credit_note",
  "debit_note",
  "receipt",
  "allocation",
  "credit_note_allocation",
  "journal_entry",
  "customer",
  "report",
  "automation",
  "reminder",
  "reminder_delivery",
  "fx_booking_decision",
  "import_batch",
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const AUDIT_ENTITY_LABEL: Record<AuditEntityType, string> = {
  invoice: "Invoice",
  credit_note: "Credit Note",
  debit_note: "Debit Note",
  receipt: "Receipt",
  allocation: "Allocation",
  credit_note_allocation: "Credit Note Allocation",
  journal_entry: "Journal Entry",
  customer: "Customer",
  report: "Report",
  automation: "Automation",
  reminder: "Reminder",
  reminder_delivery: "Reminder Delivery",
  fx_booking_decision: "FX Booking Decision",
  import_batch: "Import Batch",
};

/**
 * Action tokens the read model can emit, with human labels. The list mirrors
 * the `action` values produced by `audit_read_source`; an unrecognised token is
 * humanised rather than dropped, so a future backend action still reads
 * sensibly instead of disappearing.
 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  created: "Created",
  posted: "Posted",
  cancelled: "Cancelled",
  allocated: "Allocated",
  reversed: "Reversed",
  generated: "Generated",
  field_changed: "Field Changed",
  credit_control_action: "Credit Control Action",
  evaluated: "Evaluated",
  delivery_attempted: "Delivery Attempted",
  completed: "Completed",
  automation_commands_insert: "Automation Command Created",
  automation_commands_update: "Automation Command Updated",
  automation_exceptions_insert: "Automation Exception Opened",
  automation_exceptions_update: "Automation Exception Updated",
  automation_exception_recovery_recorded: "Exception Recovery Recorded",
  automation_exception_matching_completed: "Exception Matching Completed",
  sales_representative_assigned: "Sales Representative Assigned",
};

/** Filterable action tokens offered in the UI (a subset that spans sources). */
export const AUDIT_FILTER_ACTIONS = [
  "created",
  "posted",
  "cancelled",
  "allocated",
  "reversed",
  "generated",
  "field_changed",
  "credit_control_action",
  "evaluated",
  "delivery_attempted",
  "completed",
] as const;

/** Humanise an action token without inventing meaning. */
export function auditActionLabel(action: string): string {
  const known = AUDIT_ACTION_LABEL[action];
  if (known) return known;
  return action
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function auditEntityLabel(entityType: string): string {
  return (AUDIT_ENTITY_LABEL as Record<string, string>)[entityType] ?? entityType;
}

export interface AuditActor {
  type: AuditActorType;
  user_id: string | null;
  /**
   * Bounded display name. The backend deliberately returns `null` for every
   * event — it never joins `auth.users` — so no name or email is exposed here.
   */
  display_name: string | null;
  role: string | null;
}

export interface AuditEvent {
  event_id: string;
  occurred_at: string;
  actor: AuditActor;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_number: string | null;
  result: string | null;
  summary: string;
  /** Allow-listed scalar metadata only — never an arbitrary source row. */
  metadata: Record<string, string | number | boolean | null>;
  source_kind: string;
}

// ─── Strict runtime response parsing ────────────────────────────────────────

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.\d+)?$/;
const TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

const uuidSchema = z.string().regex(UUID_PATTERN);
const dateSchema = z.string().regex(ISO_DATE_PATTERN).refine(
  (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
);
const timestampSchema = z.string().regex(ISO_TIMESTAMP_PATTERN).refine(
  (value) => !Number.isNaN(Date.parse(value)),
);
const decimalSchema = z.string().regex(DECIMAL_PATTERN);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const safeText = (maximum: number) => z.string().max(maximum);
const nullableSafeText = (maximum: number) => safeText(maximum).nullable();

const journalSourceSchema = z.object({
  entity_type: z.enum(["invoice", "credit_note", "debit_note", "receipt"]),
  entity_id: uuidSchema,
  entity_number: safeText(100).min(1),
}).strict();

export const journalListItemSchema = z.object({
  id: uuidSchema,
  je_no: safeText(100).min(1),
  je_date: dateSchema,
  posting_period: safeText(20).min(1),
  source_type: z.enum(JOURNAL_SOURCE_TYPES),
  source_doc_no: nullableSafeText(100),
  source_doc_id: uuidSchema.nullable(),
  description: nullableSafeText(500),
  currency: currencySchema,
  base_currency: currencySchema,
  total_debit: decimalSchema,
  total_credit: decimalSchema,
  is_balanced: z.boolean(),
  is_reversal: z.boolean(),
  created_at: timestampSchema,
  created_by: uuidSchema.nullable(),
  line_count: z.number().int().nonnegative(),
  source: journalSourceSchema.nullable(),
}).strict();

const journalLineSchema = z.object({
  id: uuidSchema,
  line_no: z.number().int().positive(),
  gl_account_id: uuidSchema,
  account_code: safeText(100).min(1),
  account_name: safeText(200).min(1),
  account_type: safeText(100).min(1),
  description: nullableSafeText(500),
  debit_amount: decimalSchema,
  credit_amount: decimalSchema,
  base_debit: decimalSchema,
  base_credit: decimalSchema,
  currency: currencySchema,
  original_amount: decimalSchema.nullable(),
  created_at: timestampSchema,
}).strict();

export const journalDetailSchema = journalListItemSchema.extend({
  exchange_rate: decimalSchema,
  original_je_id: uuidSchema.nullable(),
  reversal_je_id: uuidSchema.nullable(),
  is_reversed: z.boolean(),
  lines: z.array(journalLineSchema),
}).strict().superRefine((value, context) => {
  if (value.lines.length !== value.line_count) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Journal line count does not match the detail contract.",
      path: ["lines"],
    });
  }
  for (let index = 1; index < value.lines.length; index += 1) {
    if (value.lines[index - 1].line_no > value.lines[index].line_no) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Journal lines are not in authoritative line order.",
        path: ["lines", index, "line_no"],
      });
    }
  }
});

export const cursorMetaSchema = z.object({
  limit: z.number().int().min(1).max(50),
  has_more: z.boolean(),
  next_cursor: z.string().min(1).max(4096).nullable(),
}).strict().superRefine((value, context) => {
  if (value.has_more !== (value.next_cursor !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cursor continuation state is inconsistent.",
      path: ["next_cursor"],
    });
  }
});

const auditActorSchema = z.object({
  type: z.enum(AUDIT_ACTOR_TYPES),
  user_id: uuidSchema.nullable(),
  display_name: nullableSafeText(120),
  role: nullableSafeText(50),
}).strict().superRefine((value, context) => {
  if ((value.type === "user") !== (value.user_id !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Audit actor identity is inconsistent.",
      path: ["user_id"],
    });
  }
});

const optionalString = (maximum = 500) => safeText(maximum).nullable().optional();
const optionalNumber = z.number().finite().nullable().optional();
const optionalBoolean = z.boolean().nullable().optional();

const auditMetadataSchemas = {
  invoice: z.object({
    document_type: optionalString(50), status: optionalString(64), reason: optionalString(),
  }).strict(),
  receipt: z.object({ status: optionalString(64), reason: optionalString() }).strict(),
  allocation: z.object({
    receipt_number: optionalString(100), invoice_number: optionalString(100),
    amount: optionalString(100), method: optionalString(64), status: optionalString(64),
    reason: optionalString(),
  }).strict(),
  credit_note_allocation: z.object({
    credit_note_number: optionalString(100), invoice_number: optionalString(100),
    amount: optionalString(100), status: optionalString(64), reason: optionalString(),
  }).strict(),
  journal_entry: z.object({
    source_type: optionalString(20), source_document_number: optionalString(100),
    currency: optionalString(3), total_debit: optionalString(100),
    total_credit: optionalString(100), is_reversal: optionalBoolean,
  }).strict(),
  customer_change_log: z.object({
    field_name: optionalString(100), old_value: optionalString(200),
    new_value: optionalString(200), value_redacted: optionalBoolean,
    change_reason_redacted: optionalBoolean,
  }).strict(),
  credit_control_log: z.object({
    action: optionalString(100), amount: optionalString(100), approved: optionalBoolean,
  }).strict(),
  report_audit_log: z.object({
    report_type: optionalString(100), export_format: optionalString(50),
  }).strict(),
  automation_audit_event: z.object({
    status: optionalString(64), reason_code: optionalString(64),
    lifecycle_status: optionalString(64), action: optionalString(64),
    invoice_id: optionalString(36), receipt_id: optionalString(36),
  }).strict(),
  invoice_reminder: z.object({
    invoice_number: optionalString(100), stage_offset_days: optionalNumber,
    scheduled_for: optionalString(50), status: optionalString(64),
    currency: optionalString(3), outstanding: optionalString(100),
  }).strict(),
  reminder_delivery_attempt: z.object({
    invoice_number: optionalString(100), provider_type: optionalString(64),
    attempt_number: optionalNumber, status: optionalString(64),
    error_class: optionalString(64), error_code: optionalString(64),
  }).strict(),
  fx_booking_decision_event: z.object({
    event_type: optionalString(64), decision_version: optionalNumber,
    prior_status: optionalString(64), new_status: optionalString(64),
    source_category: optionalString(64), selected_rate: optionalString(100),
    final_rate: optionalString(100),
  }).strict(),
  import_batch: z.object({
    import_type: optionalString(64), status: optionalString(64), total_rows: optionalNumber,
    valid_rows: optionalNumber, error_rows: optionalNumber, created_count: optionalNumber,
    posted_count: optionalNumber, allocated_count: optionalNumber, skipped_count: optionalNumber,
    unmatched_count: optionalNumber,
  }).strict(),
} as const;

const auditSourceKindSchema = z.enum([
  "invoice", "receipt", "allocation", "credit_note_allocation", "journal_entry",
  "customer_change_log", "credit_control_log", "report_audit_log",
  "automation_audit_event", "invoice_reminder", "reminder_delivery_attempt",
  "fx_booking_decision_event", "import_batch",
]);

const auditEventBaseSchema = z.object({
  event_id: z.string().regex(
    /^[a-z][a-z0-9_]{1,40}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  ),
  occurred_at: timestampSchema,
  actor: auditActorSchema,
  action: z.string().regex(TOKEN_PATTERN),
  entity_type: z.enum(AUDIT_ENTITY_TYPES),
  entity_id: uuidSchema,
  entity_number: nullableSafeText(150),
  result: nullableSafeText(64),
  summary: safeText(300).min(1),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  source_kind: auditSourceKindSchema,
}).strict();

export class JournalAuditContractError extends Error {
  constructor() {
    super("The Journal or Audit response did not match its expected contract.");
    this.name = "JournalAuditContractError";
  }
}

function parseOrFail<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new JournalAuditContractError();
  return parsed.data;
}

export function parseJournalList(data: unknown, meta: unknown): {
  rows: JournalListItem[];
  meta: CursorMeta;
} {
  return {
    rows: parseOrFail(z.array(journalListItemSchema), data) as JournalListItem[],
    meta: parseOrFail(cursorMetaSchema, meta),
  };
}

export function parseJournalDetail(data: unknown): JournalDetail {
  return parseOrFail(journalDetailSchema, data) as JournalDetail;
}

export function parseAuditEvent(data: unknown): AuditEvent {
  const event = parseOrFail(auditEventBaseSchema, data);
  const metadataSchema = auditMetadataSchemas[event.source_kind] as z.ZodType<
    Record<string, string | number | boolean | null>
  >;
  const metadata = parseOrFail(metadataSchema, event.metadata);
  return { ...event, metadata } as AuditEvent;
}

export function parseAuditList(data: unknown, meta: unknown): {
  rows: AuditEvent[];
  meta: CursorMeta;
} {
  const rawRows = parseOrFail(z.array(z.unknown()), data);
  return {
    rows: rawRows.map(parseAuditEvent),
    meta: parseOrFail(cursorMetaSchema, meta),
  };
}

// ─── Actor presentation ─────────────────────────────────────────────────────

export interface ActorPresentation {
  label: string;
  detail: string | null;
  tone: "user" | "system" | "unknown";
}

/**
 * Present an actor truthfully.
 *
 * The critical rule: `unknown` means the stored evidence does not identify an
 * actor. It is NEVER upgraded to "System Automation" — doing so would assert
 * an origin the database never recorded. A system label is used only where
 * `actor.type` is literally `system`.
 *
 * A user actor shows a bounded identifier: the backend returns no name or
 * email, so a short form of the stored user id is the only truthful handle.
 */
export function presentAuditActor(actor: AuditActor): ActorPresentation {
  if (actor.type === "user") {
    const shortId = actor.user_id ? actor.user_id.slice(0, 8) : null;
    return {
      label: actor.display_name ?? (shortId ? `User ${shortId}` : "User"),
      detail: actor.role,
      tone: "user",
    };
  }
  if (actor.type === "system") {
    return { label: "System", detail: "Recorded by an automated process", tone: "system" };
  }
  return { label: "Unknown", detail: "No actor was recorded for this event", tone: "unknown" };
}

// ─── Metadata presentation (closed allow-list) ──────────────────────────────

/**
 * Human labels for every metadata key the backend may emit, keyed by the same
 * `source_kind` vocabulary the API validates against. A key absent from this
 * map is NOT rendered: the UI shows only what it can name, which keeps an
 * unexpected field from being dumped into the page.
 */
const METADATA_LABELS: Record<string, Record<string, string>> = {
  invoice: { document_type: "Document Type", status: "Status", reason: "Reason" },
  receipt: { status: "Status", reason: "Reason" },
  allocation: {
    receipt_number: "Receipt",
    invoice_number: "Invoice",
    amount: "Amount",
    method: "Method",
    status: "Status",
    reason: "Reason",
  },
  credit_note_allocation: {
    credit_note_number: "Credit Note",
    invoice_number: "Invoice",
    amount: "Amount",
    status: "Status",
    reason: "Reason",
  },
  journal_entry: {
    source_type: "Source Type",
    source_document_number: "Source Document",
    currency: "Currency",
    total_debit: "Total Debit",
    total_credit: "Total Credit",
    is_reversal: "Reversal",
  },
  customer_change_log: {
    field_name: "Field",
    old_value: "Previous Value",
    new_value: "New Value",
  },
  credit_control_log: { action: "Action", amount: "Amount", approved: "Approved" },
  report_audit_log: { report_type: "Report Type", export_format: "Export Format" },
  automation_audit_event: {
    status: "Status",
    reason_code: "Reason Code",
    lifecycle_status: "Lifecycle Status",
    action: "Action",
    invoice_id: "Invoice Reference",
    receipt_id: "Receipt Reference",
  },
  invoice_reminder: {
    invoice_number: "Invoice",
    stage_offset_days: "Stage (days)",
    scheduled_for: "Scheduled For",
    status: "Status",
    currency: "Currency",
    outstanding: "Outstanding",
  },
  reminder_delivery_attempt: {
    invoice_number: "Invoice",
    provider_type: "Provider",
    attempt_number: "Attempt",
    status: "Status",
    error_class: "Error Class",
    error_code: "Error Code",
  },
  fx_booking_decision_event: {
    event_type: "Event Type",
    decision_version: "Decision Version",
    prior_status: "Previous Status",
    new_status: "New Status",
    source_category: "Source",
    selected_rate: "Selected Rate",
    final_rate: "Final Rate",
  },
  import_batch: {
    import_type: "Import Type",
    status: "Status",
    total_rows: "Total Rows",
    valid_rows: "Valid Rows",
    error_rows: "Error Rows",
    created_count: "Created",
    posted_count: "Posted",
    allocated_count: "Allocated",
    skipped_count: "Skipped",
    unmatched_count: "Unmatched",
  },
};

/** Keys that are control flags, surfaced as their own notice rather than rows. */
const CONTROL_KEYS = new Set(["value_redacted", "change_reason_redacted"]);

export interface MetadataRow {
  key: string;
  label: string;
  value: string;
}

export interface PresentedMetadata {
  rows: MetadataRow[];
  /** True when the backend withheld the changed values as sensitive. */
  valueRedacted: boolean;
  /** True when a change reason exists but is deliberately not exposed. */
  changeReasonRedacted: boolean;
}

/**
 * Turn allow-listed metadata into labelled display rows.
 *
 * Only keys that are BOTH present in the payload AND named in
 * {@link METADATA_LABELS} for that `source_kind` are rendered, so nothing
 * arbitrary can reach the page even if the API contract later widens. Redaction
 * flags become an explicit notice instead of a value — a redacted field is
 * never rendered as an empty or guessed value.
 */
export function presentAuditMetadata(event: AuditEvent): PresentedMetadata {
  const labels = METADATA_LABELS[event.source_kind] ?? {};
  const metadata = event.metadata ?? {};
  const valueRedacted = metadata.value_redacted === true;
  const changeReasonRedacted = metadata.change_reason_redacted === true;

  const rows: MetadataRow[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (CONTROL_KEYS.has(key)) continue;
    const label = labels[key];
    if (!label) continue;
    if (value === null || value === "") continue;
    rows.push({ key, label, value: String(value) });
  }
  return { rows, valueRedacted, changeReasonRedacted };
}

/** Sentence shown in place of a sensitive customer value. */
export const REDACTED_VALUE_NOTICE = "Value changed — sensitive value hidden";
