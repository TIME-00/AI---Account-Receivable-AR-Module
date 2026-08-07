// ============================================================================
// Gate E — strict gate-e.1 contract parsing tests.
// Proves the frontend fails closed on any contract drift and accepts exactly
// the frozen envelope, strict primitives, normalized DTOs, and collection meta.
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  auditEventSchema,
  collectionMetaSchema,
  commandSchema,
  documentDecisionSchema,
  errorEnvelopeSchema,
  exceptionSchema,
  EXCEPTION_REASON_CODES,
  filterSafeMetadata,
  GATE_E_CONTRACT_VERSION,
  GateEContractError,
  mailboxSchema,
  overviewSchema,
  parseGateEData,
  reminderAttemptSchema,
  reminderSchema,
  salesRepresentativeSchema,
  settingsSchema,
  successEnvelopeSchema,
  syncRunSchema,
} from "./contract";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const TS = "2026-08-06T04:05:06.000Z";
const SHA = "a".repeat(64);

const baseSettings = {
  company_id: UUID,
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
  created_at: null,
  updated_at: null,
  created_by: null,
  updated_by: null,
};

describe("gate-e.1 envelope", () => {
  it("accepts a success envelope with the exact contract version", () => {
    const parsed = successEnvelopeSchema.parse({
      success: true,
      data: { ok: true },
      contract_version: "gate-e.1",
    });
    expect(parsed.contract_version).toBe(GATE_E_CONTRACT_VERSION);
  });

  it("rejects a wrong contract version", () => {
    expect(
      successEnvelopeSchema.safeParse({
        success: true,
        data: {},
        contract_version: "gate-d.1",
      }).success,
    ).toBe(false);
  });

  it("accepts a versioned, sanitized error envelope", () => {
    const parsed = errorEnvelopeSchema.parse({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "bad" },
      contract_version: "gate-e.1",
    });
    expect(parsed.error.code).toBe("VALIDATION_ERROR");
  });

  it("parses collection meta and rejects missing has_more", () => {
    expect(
      collectionMetaSchema.parse({ page: 1, page_size: 25, total: 3, has_more: false })
        .page_size,
    ).toBe(25);
    expect(
      collectionMetaSchema.safeParse({ page: 1, page_size: 25, total: 0 }).success,
    ).toBe(false);
  });
});

describe("strict primitives", () => {
  it("rejects a non-RFC-4122 uuid", () => {
    expect(
      salesRepresentativeSchema.safeParse({
        ...validRep(),
        id: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed timestamp", () => {
    expect(
      settingsSchema.safeParse({ ...baseSettings, created_at: "2026/08/06" }).success,
    ).toBe(false);
  });

  it("rejects a non-decimal outstanding snapshot", () => {
    expect(
      reminderFixture({ outstanding_snapshot: "1,000.00" }).success,
    ).toBe(false);
  });

  it("rejects a non-E.164 phone and a non-lowercase-domain email is still bounded", () => {
    expect(
      salesRepresentativeSchema.safeParse({ ...validRep(), phone: "0123456789" }).success,
    ).toBe(false);
    expect(
      salesRepresentativeSchema.safeParse({ ...validRep(), email: "not-an-email" }).success,
    ).toBe(false);
  });

  it("rejects a non-SHA-256 idempotency key on a command", () => {
    expect(
      commandSchema.safeParse({ ...validCommand(), idempotency_key: "short" }).success,
    ).toBe(false);
  });
});

function validRep() {
  return {
    id: UUID2,
    company_id: UUID,
    name: "Rep",
    email: "rep@example.com",
    phone: "+60123456789",
    is_active: true,
    created_at: TS,
    updated_at: TS,
    created_by: null,
    updated_by: null,
  };
}

function validCommand() {
  return {
    id: UUID,
    command_type: "create_receipt",
    status: "completed",
    resulting_invoice_id: null,
    resulting_receipt_id: UUID2,
    failure_code: null,
    company_id: UUID,
    mailbox_id: UUID,
    message_id: UUID,
    attachment_id: UUID,
    extraction_id: UUID,
    operating_mode: "straight_through",
    schema_version: 1,
    idempotency_key: SHA,
    created_by: null,
    created_at: TS,
    completed_at: TS,
    failed_at: null,
  };
}

function reminderFixture(overrides: Record<string, unknown>) {
  return reminderSchema.safeParse({
    id: UUID,
    company_id: UUID,
    invoice_id: UUID2,
    customer_id: UUID,
    sales_representative_id: UUID,
    stage_offset_days: -3,
    scheduled_for: "2026-08-06",
    status: "pending",
    recipient_name_snapshot: null,
    recipient_email_snapshot: null,
    recipient_phone_snapshot: null,
    customer_name_snapshot: null,
    invoice_no_snapshot: null,
    due_date_snapshot: null,
    outstanding_snapshot: "100.00",
    currency_snapshot: "MYR",
    created_at: null,
    delivered_at: null,
    ...overrides,
  });
}

describe("settings contract", () => {
  it("parses safe disabled defaults with numeric confidences", () => {
    const s = parseGateEData(settingsSchema, baseSettings);
    expect(s.operating_mode).toBe("disabled");
    expect(s.reminder_stage_offsets).toEqual([-3, 0]);
    expect(typeof s.minimum_overall_confidence).toBe("number");
  });

  it("rejects an unknown operating mode (fails closed)", () => {
    expect(() =>
      parseGateEData(settingsSchema, { ...baseSettings, operating_mode: "yolo_mode" }),
    ).toThrow(GateEContractError);
  });

  it("rejects a numeric confidence sent as a string", () => {
    expect(
      settingsSchema.safeParse({ ...baseSettings, minimum_overall_confidence: "0.95" })
        .success,
    ).toBe(false);
  });
});

describe("sales representative contract", () => {
  it("accepts a Unicode name and null contact fields", () => {
    const rep = parseGateEData(salesRepresentativeSchema, {
      ...validRep(),
      name: "陈凯文 · François",
      email: null,
      phone: null,
      is_active: false,
    });
    expect(rep.name).toContain("François");
    expect(rep.email).toBeNull();
  });

  it("REJECTS an unexpected auth-user or financial-role field (strict, fails closed)", () => {
    // A strict wire DTO never silently strips a sensitive extra — it fails closed.
    expect(
      salesRepresentativeSchema.safeParse({
        ...validRep(),
        user_id: "sneaky",
        role: "AR Clerk",
      }).success,
    ).toBe(false);
    expect(() =>
      parseGateEData(salesRepresentativeSchema, { ...validRep(), password: "x" }),
    ).toThrow(GateEContractError);
  });
});

describe("mailbox contract never surfaces secret names or tokens", () => {
  const mailbox = {
    id: UUID2,
    company_id: UUID,
    provider_type: "gmail",
    mailbox_address: "ar@example.com",
    default_bank_account_id: null,
    connection_status: "disabled",
    ingestion_secret_configured: true,
    delivery_secret_configured: false,
    ingestion_token_expires_at: null,
    delivery_token_expires_at: null,
    cursor_kind: null,
    cursor_present: false,
    last_successful_sync_at: null,
    last_failed_sync_at: null,
    reconnect_required: false,
    is_enabled: false,
    ingestion_enabled: false,
    delivery_enabled: false,
    redacted_error_code: null,
    created_at: TS,
    updated_at: TS,
  };

  it("parses only *_configured booleans on the exact frozen shape", () => {
    const parsed = parseGateEData(mailboxSchema, mailbox);
    expect(parsed.ingestion_secret_configured).toBe(true);
    expect(parsed.delivery_secret_configured).toBe(false);
    expect(parsed.cursor_present).toBe(false);
  });

  it("REJECTS a response that leaks a token or secret-reference field (strict)", () => {
    for (const leak of [
      { access_token: "ya29.SECRET" },
      { refresh_token: "1//SECRET" },
      { ingestion_secret_ref: "AR_ING_1" },
      { cursor_value: "history_id:12345" },
    ]) {
      expect(mailboxSchema.safeParse({ ...mailbox, ...leak }).success).toBe(false);
    }
  });

  it("rejects an unknown provider type", () => {
    expect(mailboxSchema.safeParse({ ...mailbox, provider_type: "yahoo" }).success).toBe(false);
  });
});

describe("sync run contract exposes measured fields with redacted cursors", () => {
  const run = {
    id: UUID,
    company_id: UUID,
    mailbox_id: UUID2,
    provider_type: "gmail",
    status: "completed",
    cursor_before: "[redacted]",
    cursor_after: "[redacted]",
    started_at: TS,
    completed_at: TS,
    failed_at: null,
    messages_discovered: 2,
    messages_persisted: 2,
    attachments_discovered: 2,
    attachments_persisted: 2,
    duplicate_messages: 0,
    duplicate_attachments: 0,
    attachments_processed: 2,
    commands_processed: 1,
    allocations_completed: 0,
    failures: 0,
    attempt_count: 1,
    max_attempts: 3,
    redacted_error_code: null,
    created_at: TS,
  };

  it("parses the measured DTO", () => {
    const parsed = parseGateEData(syncRunSchema, run);
    expect(parsed.attachments_persisted).toBe(2);
    expect(parsed.max_attempts).toBe(3);
  });

  it("rejects a raw (non-redacted) cursor value", () => {
    expect(syncRunSchema.safeParse({ ...run, cursor_after: "history_id:12345" }).success).toBe(
      false,
    );
  });
});

describe("exception reason codes + normalized lifecycle fields", () => {
  const base = {
    id: UUID,
    company_id: UUID,
    mailbox_id: null,
    sync_run_id: null,
    message_id: null,
    attachment_id: null,
    command_id: null,
    invoice_id: null,
    receipt_id: null,
    idempotency_key: null,
    lifecycle_status: "open",
    safe_details: { error_code: "PROVIDER_UNAVAILABLE" },
    retry_count: 0,
    max_retries: 3,
    actor_user_id: null,
    resolution_note: null,
    opened_at: TS,
    resolved_at: null,
    dismissed_at: null,
    created_at: TS,
    updated_at: TS,
  };

  it("exposes exactly the 27 frozen reason codes", () => {
    expect(EXCEPTION_REASON_CODES).toHaveLength(27);
    expect(EXCEPTION_REASON_CODES).toContain("missing_salesman");
  });

  it("accepts an exception and its lifecycle timestamps", () => {
    const parsed = parseGateEData(exceptionSchema, { ...base, reason_code: "low_confidence" });
    expect(parsed.opened_at).toBe(TS);
    expect(parsed.max_retries).toBe(3);
  });
});

describe("document decision contract with command + linked exceptions", () => {
  const decision = {
    id: UUID,
    company_id: UUID,
    attachment_id: UUID2,
    schema_version: 1,
    document_type: "invoice",
    status: "accepted",
    confidence: 0.97,
    critical_field_confidence: 0.995,
    provider: "fixture",
    model: "fixture",
    provider_version: "1",
    trace_id: "trace-1",
    created_at: TS,
    attachment: {
      id: UUID2,
      file_name: "invoice.pdf",
      content_mime_type: "application/pdf",
      size_bytes: 1024,
      page_count: 1,
      scan_status: "unavailable",
      safety_status: "accepted",
      processing_status: "processed",
      content_purged_at: null,
    },
    extraction: null,
    command: {
      id: UUID,
      command_type: "create_invoice",
      status: "completed",
      resulting_invoice_id: UUID2,
      resulting_receipt_id: null,
      failure_code: null,
    },
    linked_exception_ids: [UUID],
  };

  it("parses the nested command reference and linked exceptions", () => {
    const parsed = parseGateEData(documentDecisionSchema, decision);
    expect(parsed.command?.resulting_invoice_id).toBe(UUID2);
    expect(parsed.linked_exception_ids).toHaveLength(1);
  });

  it("rejects an unknown processing status", () => {
    expect(
      documentDecisionSchema.safeParse({
        ...decision,
        attachment: { ...decision.attachment, processing_status: "stuck" },
      }).success,
    ).toBe(false);
  });
});

describe("audit event uses normalized actor types", () => {
  const base = {
    id: UUID,
    company_id: UUID,
    event_type: "automation_commands_update",
    entity_type: "automation_commands",
    entity_id: UUID2,
    actor_user_id: null,
    trace_id: "trace-safe",
    safe_metadata: { operation: "update", status: "completed" },
    created_at: TS,
  };

  it("accepts user|system|provider and rejects raw worker/fixture labels", () => {
    for (const actor_type of ["user", "system", "provider"]) {
      expect(auditEventSchema.safeParse({ ...base, actor_type }).success).toBe(true);
    }
    expect(auditEventSchema.safeParse({ ...base, actor_type: "system_worker" }).success).toBe(
      false,
    );
  });
});

describe("filterSafeMetadata per-key validators + credential suppression", () => {
  it("keeps valid enum/uuid/array scalars and drops sensitive/unknown keys", () => {
    const out = new Map(
      filterSafeMetadata({
        operation: "update",
        status: "completed",
        error_code: "PROVIDER_UNAVAILABLE",
        stage_offset_days: -3,
        retry_blocked: true,
        invoice_id: UUID,
        changed_fields: ["name", "email"],
        access_token: "ya29.SECRET",
        refresh_token: "1//SECRET",
        authorization: "Bearer x",
        bank_account: "12345",
        unknown_key: "value",
      }),
    );
    expect(out.get("operation")).toBe("update");
    expect(out.get("status")).toBe("completed");
    expect(out.get("error_code")).toBe("PROVIDER_UNAVAILABLE");
    expect(out.get("stage_offset_days")).toBe(-3);
    expect(out.get("retry_blocked")).toBe(true);
    expect(out.get("invoice_id")).toBe(UUID);
    expect(out.get("changed_fields")).toEqual(["name", "email"]);
    for (const dropped of [
      "access_token", "refresh_token", "authorization", "bank_account", "unknown_key",
    ]) {
      expect(out.has(dropped)).toBe(false);
    }
  });

  it("REJECTS credential-shaped values even under an allowlisted key", () => {
    const jwt = "aaaaaaaa.bbbbbbbb.cccccccc";
    const out = new Map(
      filterSafeMetadata({
        status: jwt, // JWT-shaped under an allowlisted key
        operation: "Bearer abc123def456", // bearer token under operation
        action: "x".repeat(60), // long secret under action
        operating_mode: "postgres://user:pass@host/db", // connection string
        error_code: "ya29.tokenlike", // not an uppercase error code
      }),
    );
    expect(out.size).toBe(0);
  });

  it("drops object and array-of-object values", () => {
    const out = filterSafeMetadata({
      status: { nested: true } as unknown as string,
      changed_fields: [{ a: 1 }] as unknown as string[],
    });
    expect(out).toHaveLength(0);
  });

  it("rejects an out-of-range stage offset and an unknown changed_field", () => {
    expect(filterSafeMetadata({ stage_offset_days: 5 })).toHaveLength(0);
    expect(filterSafeMetadata({ changed_fields: ["not_a_field"] })).toHaveLength(0);
  });
});

describe("reminder attempt contract", () => {
  it("parses attempts with provider message id and redacted error", () => {
    const parsed = parseGateEData(reminderAttemptSchema, {
      id: UUID,
      company_id: UUID,
      reminder_id: UUID2,
      mailbox_id: UUID,
      provider_type: "gmail",
      attempt_number: 1,
      idempotency_key: SHA,
      status: "sent",
      provider_message_id: "provider-message-id",
      error_class: null,
      redacted_error_code: null,
      started_at: TS,
      completed_at: TS,
      created_at: TS,
    });
    expect(parsed.status).toBe("sent");
    expect(parsed.attempt_number).toBe(1);
  });
});

function validOverview(overrides: Record<string, unknown> = {}) {
  return {
    settings: baseSettings,
    ingestion_ready: false,
    delivery_ready: false,
    document_intelligence_ready: false,
    connected_mailbox_count: 0,
    reconnect_required_mailbox_count: 0,
    last_successful_sync_at: null,
    last_failed_sync_at: null,
    processing_runs: 0,
    documents_processed: 0,
    accepted_documents: 0,
    rejected_documents: 0,
    invoices_created: 0,
    receipts_created: 0,
    allocations_completed: 0,
    reminders_evaluated: 0,
    reminders_sent: 0,
    open_exceptions: 0,
    retryable_exceptions: 0,
    ...overrides,
  };
}

describe("overview contract — split readiness", () => {
  it("parses independent ingestion/delivery/doc-intelligence readiness", () => {
    const overview = parseGateEData(
      overviewSchema,
      validOverview({ ingestion_ready: true, delivery_ready: false }),
    );
    expect(overview.ingestion_ready).toBe(true);
    expect(overview.delivery_ready).toBe(false);
    expect(overview.document_intelligence_ready).toBe(false);
    expect(overview.connected_mailbox_count).toBe(0);
  });

  it("REJECTS the obsolete generic provider_ready field (contract drift)", () => {
    const drifted = validOverview();
    delete (drifted as Record<string, unknown>).delivery_ready;
    (drifted as Record<string, unknown>).provider_ready = false;
    expect(overviewSchema.safeParse(drifted).success).toBe(false);
  });

  it("REJECTS an unexpected extra field on overview (strict)", () => {
    expect(
      overviewSchema.safeParse(validOverview({ leaked_secret: "x" })).success,
    ).toBe(false);
  });

  it("REJECTS an unexpected nested field on settings (deep strict)", () => {
    expect(
      overviewSchema.safeParse(
        validOverview({ settings: { ...baseSettings, sneaky: true } }),
      ).success,
    ).toBe(false);
  });
});

describe("semantic date/timestamp validation (matches backend)", () => {
  const badDates = [
    "2026-00-10", "2026-13-01", "2026-02-30", "2026-99-99", "2025-02-29",
  ];
  const goodDates = ["2024-02-29", "2026-08-06", "2026-12-31"];
  const badTimestamps = [
    "2026-01-01T24:00:00Z", "2026-01-01T00:60:00Z", "2026-01-01T00:00:60Z",
    "2026-01-01T00:00:00+14:01", "2026-01-01T00:00:00+15:00",
    "2026-02-30T00:00:00Z", "2026-01-01T00:00:00", // no explicit offset
  ];
  const goodTimestamps = [
    "2024-02-29T23:59:59Z", "2026-08-06T04:05:06.123456Z",
    "2026-08-06T04:05:06+08:00", "2026-08-06T04:05:06-05:30",
    "2026-08-06T04:05:06+14:00",
  ];

  it("rejects impossible calendar dates", () => {
    for (const d of badDates) {
      expect(reminderFixture({ scheduled_for: d }).success).toBe(false);
    }
  });
  it("accepts real calendar dates incl. leap day", () => {
    for (const d of goodDates) {
      expect(reminderFixture({ scheduled_for: d }).success).toBe(true);
    }
  });
  it("rejects impossible clock/offset timestamps", () => {
    for (const ts of badTimestamps) {
      expect(settingsSchema.safeParse({ ...baseSettings, created_at: ts }).success).toBe(false);
    }
  });
  it("accepts valid UTC/fractional/offset (±14:00) timestamps", () => {
    for (const ts of goodTimestamps) {
      expect(settingsSchema.safeParse({ ...baseSettings, created_at: ts }).success).toBe(true);
    }
  });
});
