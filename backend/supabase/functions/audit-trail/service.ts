import type { SupabaseClient } from "supabase";
import type { AuthContext } from "../_shared/auth.ts";
import { throwDatabaseError } from "../_shared/db.ts";
import { NotFoundError } from "../_shared/errors.ts";
import type {
  AuditActorType,
  AuditEntityType,
  AuditListParams,
} from "./contract.ts";
import { encodeAuditCursor } from "./contract.ts";

export interface AuditEvent {
  event_id: string;
  occurred_at: string;
  actor: {
    type: AuditActorType;
    user_id: string | null;
    display_name: string | null;
    role: string | null;
  };
  action: string;
  entity_type: AuditEntityType;
  entity_id: string;
  entity_number: string | null;
  result: string | null;
  summary: string;
  metadata: Record<string, string | number | boolean | null>;
  source_kind: string;
}

export interface AuditListResult {
  data: AuditEvent[];
  meta: { limit: number; has_more: boolean; next_cursor: string | null };
}

interface RpcEnvelope {
  rows?: unknown[];
  has_more?: boolean;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_ID_PATTERN =
  /^[a-z][a-z0-9_]{1,40}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const METADATA_KEYS: Record<string, ReadonlySet<string>> = {
  invoice: new Set(["document_type", "status", "reason"]),
  receipt: new Set(["status", "reason"]),
  allocation: new Set([
    "receipt_number",
    "invoice_number",
    "amount",
    "method",
    "status",
    "reason",
  ]),
  credit_note_allocation: new Set([
    "credit_note_number",
    "invoice_number",
    "amount",
    "status",
    "reason",
  ]),
  journal_entry: new Set([
    "source_type",
    "source_document_number",
    "currency",
    "total_debit",
    "total_credit",
    "is_reversal",
  ]),
  customer_change_log: new Set([
    "field_name",
    "old_value",
    "new_value",
    "value_redacted",
    "change_reason_redacted",
  ]),
  credit_control_log: new Set(["action", "amount", "approved"]),
  report_audit_log: new Set(["report_type", "export_format"]),
  automation_audit_event: new Set([
    "status",
    "reason_code",
    "lifecycle_status",
    "action",
    "invoice_id",
    "receipt_id",
  ]),
  invoice_reminder: new Set([
    "invoice_number",
    "stage_offset_days",
    "scheduled_for",
    "status",
    "currency",
    "outstanding",
  ]),
  reminder_delivery_attempt: new Set([
    "invoice_number",
    "provider_type",
    "attempt_number",
    "status",
    "error_class",
    "error_code",
  ]),
  fx_booking_decision_event: new Set([
    "event_type",
    "decision_version",
    "prior_status",
    "new_status",
    "source_category",
    "selected_rate",
    "final_rate",
  ]),
  import_batch: new Set([
    "import_type",
    "status",
    "total_rows",
    "valid_rows",
    "error_rows",
    "created_count",
    "posted_count",
    "allocated_count",
    "skipped_count",
    "unmatched_count",
  ]),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function metadataIsSafe(
  sourceKind: string,
  value: unknown,
): value is Record<string, string | number | boolean | null> {
  if (!isRecord(value)) return false;
  const allowed = METADATA_KEYS[sourceKind];
  if (!allowed || Object.keys(value).some((key) => !allowed.has(key))) {
    return false;
  }
  return Object.values(value).every((entry) =>
    entry === null || typeof entry === "string" || typeof entry === "number" ||
    typeof entry === "boolean"
  );
}

function isAuditEvent(value: unknown): value is AuditEvent {
  if (!isRecord(value) || !isRecord(value.actor)) return false;
  const actorType = value.actor.type;
  const userId = value.actor.user_id;
  if (
    !["user", "system", "unknown"].includes(String(actorType)) ||
    (userId !== null &&
      (typeof userId !== "string" || !UUID_PATTERN.test(userId))) ||
    (actorType === "user" && userId === null) ||
    (actorType !== "user" && userId !== null) ||
    (value.actor.display_name !== null &&
      typeof value.actor.display_name !== "string") ||
    (value.actor.role !== null && typeof value.actor.role !== "string")
  ) return false;
  return typeof value.event_id === "string" &&
    EVENT_ID_PATTERN.test(value.event_id) &&
    typeof value.occurred_at === "string" &&
    !Number.isNaN(Date.parse(value.occurred_at)) &&
    typeof value.action === "string" && TOKEN_PATTERN.test(value.action) &&
    typeof value.entity_type === "string" &&
    [
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
    ].includes(value.entity_type) &&
    typeof value.entity_id === "string" && UUID_PATTERN.test(value.entity_id) &&
    (value.entity_number === null || typeof value.entity_number === "string") &&
    (value.result === null ||
      (typeof value.result === "string" && value.result.length <= 64)) &&
    typeof value.summary === "string" && value.summary.length > 0 &&
    value.summary.length <= 300 &&
    typeof value.source_kind === "string" &&
    metadataIsSafe(value.source_kind, value.metadata);
}

function invalidResult(): never {
  throw new Error("Audit read RPC returned an invalid result");
}

export interface AuditReadServiceContract {
  list(auth: AuthContext, params: AuditListParams): Promise<AuditListResult>;
  detail(auth: AuthContext, eventId: string): Promise<AuditEvent>;
}

export class AuditReadService implements AuditReadServiceContract {
  constructor(private readonly client: SupabaseClient) {}

  private async rpc<T>(
    name: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await this.client.rpc(name, params);
    if (error) throwDatabaseError(error, `Audit read RPC ${name} failed`);
    return data as T;
  }

  async list(
    auth: AuthContext,
    params: AuditListParams,
  ): Promise<AuditListResult> {
    const envelope = await this.rpc<RpcEnvelope>("audit_read_list", {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_limit: params.limit,
      p_cursor_occurred_at: params.cursor?.occurred_at ?? null,
      p_cursor_event_id: params.cursor?.event_id ?? null,
      p_date_from: params.dateFrom,
      p_date_to: params.dateTo,
      p_action: params.action,
      p_entity_type: params.entityType,
      p_actor_type: params.actorType,
      p_actor_user_id: params.actorUserId,
      p_result: params.result,
      p_q: params.q,
    });
    if (
      !isRecord(envelope) || !Array.isArray(envelope.rows) ||
      typeof envelope.has_more !== "boolean" ||
      envelope.rows.length > params.limit ||
      !envelope.rows.every(isAuditEvent)
    ) invalidResult();
    const rows = envelope.rows as AuditEvent[];
    if (envelope.has_more && rows.length === 0) invalidResult();
    const last = rows.at(-1);
    return {
      data: rows,
      meta: {
        limit: params.limit,
        has_more: envelope.has_more,
        next_cursor: envelope.has_more && last
          ? encodeAuditCursor({
            occurred_at: last.occurred_at,
            event_id: last.event_id,
          })
          : null,
      },
    };
  }

  async detail(auth: AuthContext, eventId: string): Promise<AuditEvent> {
    const result = await this.rpc<unknown>("audit_read_detail", {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_event_id: eventId,
    });
    if (result === null) throw new NotFoundError("Audit event", eventId);
    if (!isAuditEvent(result)) invalidResult();
    return result as AuditEvent;
  }
}
