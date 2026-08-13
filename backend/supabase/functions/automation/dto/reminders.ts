import {
  type AutomationRow,
  boolean,
  CURRENCY,
  date,
  decimal,
  enumValue,
  integer,
  nullableDate,
  nullableDecimal,
  nullableString,
  nullableTimestamp,
  nullableUuid,
  patternString,
  requiredString,
  safeAutomationMetadata,
  SHA256,
  timestamp,
  uuid,
} from "./common.ts";

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
