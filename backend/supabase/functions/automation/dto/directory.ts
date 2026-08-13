import {
  type AutomationRow,
  boolean,
  EMAIL,
  enumValue,
  integer,
  invalid,
  nullableString,
  nullableTimestamp,
  nullableUuid,
  patternString,
  PHONE,
  requiredString,
  timestamp,
  uuid,
} from "./common.ts";

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
    delivery_reconnect_required: boolean(
      row.delivery_reconnect_required,
      "mailbox.delivery_reconnect_required",
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
