import {
  type AutomationRow,
  boolean,
  containsControlCharacter,
  CURRENCY,
  decimal,
  enumValue,
  finiteNumber,
  integer,
  invalid,
  nullableString,
  nullableTimestamp,
  nullableUuid,
  patternString,
  requiredString,
  safeStringArray,
  timestamp,
  uuid,
} from "./common.ts";

export function automationSettingsDto(
  row: AutomationRow | null,
  companyId: string,
): AutomationRow {
  const source: AutomationRow = row
    ? {
      ...row,
      reminder_mode: row.reminder_mode ??
        (row.reminder_delivery_enabled === true
          ? "automatic_delivery"
          : row.reminder_evaluation_enabled === true
          ? "evaluate_only"
          : "off"),
    }
    : {
      company_id: companyId,
      automation_actor_user_id: null,
      operating_mode: "disabled",
      mailbox_sync_enabled: false,
      document_intelligence_enabled: false,
      invoice_automation_enabled: false,
      receipt_automation_enabled: false,
      auto_allocation_enabled: false,
      reminder_mode: "off",
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
    reminder_mode: enumValue(source.reminder_mode, "reminder_mode", [
      "off",
      "evaluate_only",
      "automatic_delivery",
    ]),
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

export function exceptionRecoveryContextDto(row: AutomationRow): AutomationRow {
  const receipt = row.receipt;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return invalid("recovery.receipt");
  }
  const receiptRow = receipt as AutomationRow;
  const references = safeStringArray(
    row.original_invoice_references,
    "recovery.original_invoice_references",
  );
  if (
    references.length === 0 ||
    references.some(containsControlCharacter)
  ) {
    return invalid("recovery.original_invoice_references");
  }
  if (
    !Array.isArray(row.eligible_invoices) || row.eligible_invoices.length > 100
  ) {
    return invalid("recovery.eligible_invoices");
  }
  const eligibleInvoices = row.eligible_invoices.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return invalid(`recovery.eligible_invoices.${index}`);
    }
    const invoice = item as AutomationRow;
    return {
      invoice_id: uuid(
        invoice.invoice_id,
        `recovery.eligible_invoices.${index}.invoice_id`,
      ),
      invoice_no: requiredString(
        invoice.invoice_no,
        `recovery.eligible_invoices.${index}.invoice_no`,
        50,
      ),
      reference_no: nullableString(
        invoice.reference_no,
        `recovery.eligible_invoices.${index}.reference_no`,
        50,
      ),
      status: enumValue(
        invoice.status,
        `recovery.eligible_invoices.${index}.status`,
        [
          "Open",
          "Overdue",
          "Partially Paid",
        ],
      ),
      currency: patternString(
        invoice.currency,
        `recovery.eligible_invoices.${index}.currency`,
        CURRENCY,
        3,
      ),
      outstanding: decimal(
        invoice.outstanding,
        `recovery.eligible_invoices.${index}.outstanding`,
      ),
    };
  });
  let latestRecovery: AutomationRow | null = null;
  if (row.latest_recovery !== null && row.latest_recovery !== undefined) {
    if (
      !row.latest_recovery || typeof row.latest_recovery !== "object" ||
      Array.isArray(row.latest_recovery)
    ) return invalid("recovery.latest_recovery");
    const recovery = row.latest_recovery as AutomationRow;
    latestRecovery = {
      id: uuid(recovery.id, "recovery.latest_recovery.id"),
      action_type: enumValue(
        recovery.action_type,
        "recovery.latest_recovery.action_type",
        [
          "correct_invoice_external_reference",
          "confirm_receipt_invoice_match",
        ],
      ),
      invoice_id: uuid(
        recovery.invoice_id,
        "recovery.latest_recovery.invoice_id",
      ),
      created_at: timestamp(
        recovery.created_at,
        "recovery.latest_recovery.created_at",
      ),
    };
  }
  return {
    exception_id: uuid(row.exception_id, "recovery.exception_id"),
    lifecycle_status: enumValue(
      row.lifecycle_status,
      "recovery.lifecycle_status",
      [
        "open",
        "retryable",
        "resolved",
      ],
    ),
    reason_code: enumValue(row.reason_code, "recovery.reason_code", [
      "critical_identifier_unverified",
    ]),
    receipt: {
      id: uuid(receiptRow.id, "recovery.receipt.id"),
      receipt_no: requiredString(
        receiptRow.receipt_no,
        "recovery.receipt.receipt_no",
        50,
      ),
      status: enumValue(receiptRow.status, "recovery.receipt.status", [
        "Posted",
        "Fully Allocated",
      ]),
      currency: patternString(
        receiptRow.currency,
        "recovery.receipt.currency",
        CURRENCY,
        3,
      ),
      unallocated_amount: decimal(
        receiptRow.unallocated_amount,
        "recovery.receipt.unallocated_amount",
      ),
      attachment_id: uuid(
        receiptRow.attachment_id,
        "recovery.receipt.attachment_id",
      ),
    },
    original_invoice_references: references,
    eligible_invoices: eligibleInvoices,
    latest_recovery: latestRecovery,
  };
}
