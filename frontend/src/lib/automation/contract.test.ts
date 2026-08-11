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
  deliveryActionResultSchema,
  documentDecisionSchema,
  errorEnvelopeSchema,
  exceptionSchema,
  EXCEPTION_REASON_CODES,
  filterSafeMetadata,
  GATE_E_CONTRACT_VERSION,
  GateEContractError,
  mailboxSchema,
  oauthStartSchema,
  overviewSchema,
  parseGateEData,
  recoveryContextSchema,
  reminderAttemptSchema,
  reminderSchema,
  salesRepresentativeSchema,
  settingsSchema,
  successEnvelopeSchema,
  syncRunSchema,
  UUID_PATTERN,
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
  reminder_mode: "off",
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
    delivery_reconnect_required: false,
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

  it("REQUIRES the independent delivery reconnect flag", () => {
    const { delivery_reconnect_required: _omitted, ...withoutFlag } = mailbox;
    expect(mailboxSchema.safeParse(withoutFlag).success).toBe(false);
    expect(
      mailboxSchema.safeParse({ ...mailbox, delivery_reconnect_required: "no" })
        .success,
    ).toBe(false);
    const parsed = parseGateEData(mailboxSchema, {
      ...mailbox,
      reconnect_required: false,
      delivery_reconnect_required: true,
    });
    // Delivery health is carried separately from ingestion health.
    expect(parsed.delivery_reconnect_required).toBe(true);
    expect(parsed.reconnect_required).toBe(false);
  });
});

describe("governed Delivery action contract (post-Gate-E)", () => {
  const mailbox = {
    id: UUID,
    company_id: UUID,
    provider_type: "gmail",
    mailbox_address: "ar@example.com",
    default_bank_account_id: null,
    connection_status: "connected",
    ingestion_secret_configured: true,
    delivery_secret_configured: true,
    ingestion_token_expires_at: TS,
    delivery_token_expires_at: TS,
    cursor_kind: null,
    cursor_present: false,
    last_successful_sync_at: null,
    last_failed_sync_at: null,
    reconnect_required: false,
    delivery_reconnect_required: false,
    is_enabled: true,
    ingestion_enabled: true,
    delivery_enabled: true,
    redacted_error_code: null,
    created_at: TS,
    updated_at: TS,
  };

  const oauthRequired = {
    outcome: "oauth_required",
    provider: "gmail",
    authorization_url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
    expires_at: TS,
    capability: "delivery",
    intent: "enable_delivery",
  };

  it("parses the enabled branch with a full strict mailbox", () => {
    const parsed = parseGateEData(deliveryActionResultSchema, {
      outcome: "enabled",
      mailbox,
    });
    expect(parsed.outcome).toBe("enabled");
    if (parsed.outcome === "enabled") {
      expect(parsed.mailbox.delivery_enabled).toBe(true);
    }
  });

  it("parses both delivery oauth intents on the oauth_required branch", () => {
    for (const intent of ["enable_delivery", "reconnect_delivery"]) {
      const parsed = parseGateEData(deliveryActionResultSchema, {
        ...oauthRequired,
        intent,
      });
      expect(parsed.outcome).toBe("oauth_required");
      if (parsed.outcome === "oauth_required") {
        expect(parsed.intent).toBe(intent);
        expect(parsed.capability).toBe("delivery");
      }
    }
  });

  it("REJECTS an enabled branch whose mailbox is partial or leaks a credential", () => {
    expect(
      deliveryActionResultSchema.safeParse({ outcome: "enabled", delivery_enabled: true })
        .success,
    ).toBe(false);
    expect(
      deliveryActionResultSchema.safeParse({
        outcome: "enabled",
        mailbox: { ...mailbox, delivery_secret_ref: "AR_DELIVERY_1" },
      }).success,
    ).toBe(false);
    expect(
      deliveryActionResultSchema.safeParse({
        outcome: "enabled",
        mailbox,
        access_token: "ya29.SECRET",
      }).success,
    ).toBe(false);
  });

  it("REJECTS a consent start that is not an exact delivery capability/intent", () => {
    for (
      const drift of [
        { capability: "ingestion" },
        { intent: "connect_capability" },
        { intent: "enable_ingestion" },
        { outcome: "ok" },
        { authorization_url: "not-a-url" },
      ]
    ) {
      expect(
        deliveryActionResultSchema.safeParse({ ...oauthRequired, ...drift }).success,
      ).toBe(false);
    }
  });

  it("REQUIRES the server-authored intent on every OAuth start", () => {
    const start = {
      provider: "gmail",
      authorization_url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x",
      expires_at: TS,
      capability: "ingestion",
    };
    expect(oauthStartSchema.safeParse(start).success).toBe(false);
    expect(
      oauthStartSchema.safeParse({ ...start, intent: "connect_capability" }).success,
    ).toBe(true);
    expect(oauthStartSchema.safeParse({ ...start, intent: "whatever" }).success).toBe(
      false,
    );
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
    document: null,
    opened_at: TS,
    resolved_at: null,
    dismissed_at: null,
    created_at: TS,
    updated_at: TS,
  };

  it("exposes exactly the 29 bounded reason codes", () => {
    expect(EXCEPTION_REASON_CODES).toHaveLength(29);
    expect(EXCEPTION_REASON_CODES).toContain("missing_salesman");
    expect(EXCEPTION_REASON_CODES).toContain("fx_reference_unavailable");
  });

  it("accepts an exception and its lifecycle timestamps", () => {
    const parsed = parseGateEData(exceptionSchema, { ...base, reason_code: "low_confidence" });
    expect(parsed.opened_at).toBe(TS);
    expect(parsed.max_retries).toBe(3);
  });

  // ── Automation v15 nullable `document` monitoring projection ────────────────
  // The frontend mirror must accept the exact bounded backend object and null,
  // and fail closed on any drift. `base.document` is null; each case overrides.
  const validInvoiceDocument = {
    file_name: "gate-e-observe-invoice-20260809.png",
    document_type: "invoice",
    processing_status: "processed",
    classification_status: "accepted",
    manual_review_required: true,
  };

  it("1. accepts document = null", () => {
    expect(exceptionSchema.safeParse({ ...base, reason_code: "low_confidence" }).success)
      .toBe(true);
  });

  it("2. accepts a valid Invoice document projection", () => {
    const parsed = parseGateEData(exceptionSchema, {
      ...base,
      reason_code: "internal_processing_failure",
      lifecycle_status: "retryable",
      document: validInvoiceDocument,
    });
    expect(parsed.document?.file_name).toBe("gate-e-observe-invoice-20260809.png");
    expect(parsed.document?.document_type).toBe("invoice");
  });

  it("3. accepts a valid Receipt projection", () => {
    const parsed = parseGateEData(exceptionSchema, {
      ...base,
      reason_code: "internal_processing_failure",
      lifecycle_status: "retryable",
      document: {
        file_name: "gate-e-observe-receipt-20260809.png",
        document_type: "receipt",
        processing_status: "processed",
        classification_status: "accepted",
        manual_review_required: true,
      },
    });
    expect(parsed.document?.document_type).toBe("receipt");
  });

  it("accepts a monitorable critical-identifier refusal", () => {
    const parsed = parseGateEData(exceptionSchema, {
      ...base,
      reason_code: "critical_identifier_unverified",
      lifecycle_status: "open",
      safe_details: {
        error_code: "INVOICE_REFERENCE_NOT_AUTHORITATIVE",
      },
      document: {
        ...validInvoiceDocument,
        file_name: "controlled-receipt.png",
        document_type: "receipt",
      },
    });
    expect(parsed.reason_code).toBe("critical_identifier_unverified");
    expect(parsed.safe_details).toEqual({
      error_code: "INVOICE_REFERENCE_NOT_AUTHORITATIVE",
    });
  });

  it("4. accepts an unsupported projection (nullable classification)", () => {
    const parsed = parseGateEData(exceptionSchema, {
      ...base,
      reason_code: "unsupported_document",
      document: {
        file_name: "gate-e-observe-unsupported-20260809.png",
        document_type: "unsupported",
        processing_status: "processed",
        classification_status: "rejected",
        manual_review_required: true,
      },
    });
    expect(parsed.document?.document_type).toBe("unsupported");
  });

  it("5. accepts manual_review_required = true for open/retryable", () => {
    expect(
      exceptionSchema.safeParse({
        ...base,
        reason_code: "low_confidence",
        lifecycle_status: "open",
        document: { ...validInvoiceDocument, manual_review_required: true },
      }).success,
    ).toBe(true);
  });

  it("6. accepts a resolved/dismissed projection with manual_review_required = false", () => {
    expect(
      exceptionSchema.safeParse({
        ...base,
        reason_code: "low_confidence",
        lifecycle_status: "resolved",
        resolved_at: TS,
        document: { ...validInvoiceDocument, manual_review_required: false },
      }).success,
    ).toBe(true);
  });

  it("7. rejects an unknown document_type", () => {
    expect(
      exceptionSchema.safeParse({
        ...base,
        reason_code: "low_confidence",
        document: { ...validInvoiceDocument, document_type: "purchase_order" },
      }).success,
    ).toBe(false);
  });

  it("8. rejects an unknown classification_status", () => {
    expect(
      exceptionSchema.safeParse({
        ...base,
        reason_code: "low_confidence",
        document: { ...validInvoiceDocument, classification_status: "escalated" },
      }).success,
    ).toBe(false);
  });

  it("9. rejects a processing_status that exceeds the bounded contract", () => {
    expect(
      exceptionSchema.safeParse({
        ...base,
        reason_code: "low_confidence",
        document: { ...validInvoiceDocument, processing_status: "x".repeat(41) },
      }).success,
    ).toBe(false);
    // A blank processing_status is also rejected (required, non-empty).
    expect(
      exceptionSchema.safeParse({
        ...base,
        reason_code: "low_confidence",
        document: { ...validInvoiceDocument, processing_status: "" },
      }).success,
    ).toBe(false);
  });

  it("10. rejects an overlong file_name", () => {
    expect(
      exceptionSchema.safeParse({
        ...base,
        reason_code: "low_confidence",
        document: { ...validInvoiceDocument, file_name: "a".repeat(256) },
      }).success,
    ).toBe(false);
  });

  it("11. rejects a missing required nested key", () => {
    const { manual_review_required: _omit, ...withoutFlag } = validInvoiceDocument;
    expect(
      exceptionSchema.safeParse({
        ...base,
        reason_code: "low_confidence",
        document: withoutFlag,
      }).success,
    ).toBe(false);
  });

  it("12. rejects an extra unknown nested field", () => {
    expect(
      exceptionSchema.safeParse({
        ...base,
        reason_code: "low_confidence",
        document: { ...validInvoiceDocument, extraction_json: { total: 100 } },
      }).success,
    ).toBe(false);
  });

  it("13. rejects a non-boolean manual_review_required", () => {
    expect(
      exceptionSchema.safeParse({
        ...base,
        reason_code: "low_confidence",
        document: { ...validInvoiceDocument, manual_review_required: "true" },
      }).success,
    ).toBe(false);
  });

  it("14. remains strict at the top level (unknown fields + missing document fail closed)", () => {
    // Unknown top-level field fails.
    expect(
      exceptionSchema.safeParse({
        ...base,
        reason_code: "low_confidence",
        surprise: "x",
      }).success,
    ).toBe(false);
    // The `document` key is required (v15 always emits it): omitting it fails.
    const { document: _omitDoc, ...withoutDocument } = base;
    expect(
      exceptionSchema.safeParse({ ...withoutDocument, reason_code: "low_confidence" }).success,
    ).toBe(false);
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

describe("canonical PostgreSQL UUID identifier contract (mirrors backend)", () => {
  // The backend Gate E database UUID contract is canonical 8-4-4-4-12
  // hexadecimal, case-insensitive, and intentionally imposes no RFC
  // version/variant bits. The Production company identifier below is a valid
  // PostgreSQL uuid whose version nibble is 0 and variant nibble is 0, so it
  // was wrongly rejected by the previous RFC-version-specific mirror.
  const PROD_UUID = "00000000-0000-0000-0000-000000000001";
  const UUID_V4 = "11111111-1111-4111-8111-111111111111";

  const mailboxFixture = (id: string, companyId: string) => ({
    id,
    company_id: companyId,
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
    delivery_reconnect_required: false,
    is_enabled: false,
    ingestion_enabled: false,
    delivery_enabled: false,
    redacted_error_code: null,
    created_at: TS,
    updated_at: TS,
  });

  const acceptedIds = [
    ["Production company UUID (v/variant nibble 0)", PROD_UUID],
    ["canonical UUIDv4", UUID_V4],
    ["uppercase hexadecimal", PROD_UUID.toUpperCase()],
  ] as const;

  const rejectedIds = [
    ["wrong separators (underscores)", "00000000_0000_0000_0000_000000000001"],
    ["wrong separators (no dashes)", "00000000000000000000000000000001"],
    ["truncated final group", "00000000-0000-0000-0000-00000000000"],
    ["truncated whole value", "00000000-0000-0000-0000"],
    ["overlong final group", "00000000-0000-0000-0000-0000000000012"],
    ["overlong extra group", "00000000-0000-0000-0000-000000000001-0000"],
    ["non-hex characters", "zzzzzzzz-0000-0000-0000-000000000001"],
    ["arbitrary string", "not-a-uuid"],
    ["empty string", ""],
  ] as const;

  it("accepts canonical PostgreSQL UUID text on the primitive", () => {
    for (const [, id] of acceptedIds) expect(UUID_PATTERN.test(id)).toBe(true);
  });

  it("rejects malformed identifiers on the primitive (fails closed)", () => {
    for (const [, id] of rejectedIds) expect(UUID_PATTERN.test(id)).toBe(false);
  });

  describe.each(acceptedIds)("accepts %s through page schemas", (_label, id) => {
    it("settings schema accepts the company identifier", () => {
      const parsed = parseGateEData(settingsSchema, { ...baseSettings, company_id: id });
      expect(parsed.company_id).toBe(id);
    });

    it("mailbox schema accepts tenant + mailbox identifiers", () => {
      const parsed = parseGateEData(mailboxSchema, mailboxFixture(id, id));
      expect(parsed.id).toBe(id);
      expect(parsed.company_id).toBe(id);
    });

    it("overview schema accepts the nested settings company identifier", () => {
      const parsed = parseGateEData(
        overviewSchema,
        validOverview({ settings: { ...baseSettings, company_id: id } }),
      );
      expect(parsed.settings.company_id).toBe(id);
    });
  });

  describe.each(rejectedIds)("rejects %s through page schemas", (_label, id) => {
    it("settings schema fails closed", () => {
      expect(settingsSchema.safeParse({ ...baseSettings, company_id: id }).success).toBe(false);
    });

    it("mailbox schema fails closed", () => {
      expect(mailboxSchema.safeParse(mailboxFixture(id, UUID)).success).toBe(false);
      expect(mailboxSchema.safeParse(mailboxFixture(UUID, id)).success).toBe(false);
    });

    it("overview schema fails closed on nested settings", () => {
      expect(
        overviewSchema.safeParse(
          validOverview({ settings: { ...baseSettings, company_id: id } }),
        ).success,
      ).toBe(false);
    });
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

describe("reminder_mode contract", () => {
  it("parses each valid reminder_mode", () => {
    for (const mode of ["off", "evaluate_only", "automatic_delivery"]) {
      expect(
        settingsSchema.safeParse({ ...baseSettings, reminder_mode: mode }).success,
      ).toBe(true);
    }
  });
  it("fails closed on an unknown reminder_mode and on a missing one", () => {
    expect(
      settingsSchema.safeParse({ ...baseSettings, reminder_mode: "sometimes" }).success,
    ).toBe(false);
    const { reminder_mode: _omit, ...withoutMode } = baseSettings;
    expect(settingsSchema.safeParse(withoutMode).success).toBe(false);
  });
});

describe("recovery context contract", () => {
  const validContext = {
    exception_id: UUID,
    lifecycle_status: "open",
    reason_code: "critical_identifier_unverified",
    receipt: {
      id: UUID2,
      receipt_no: "RCT-202608-00001",
      status: "Posted",
      currency: "MYR",
      unallocated_amount: "100.00",
      attachment_id: UUID,
    },
    original_invoice_references: ["GATEE-INV-DRAFT-20260810-001"],
    eligible_invoices: [
      {
        invoice_id: UUID2,
        invoice_no: "INV-202608-00001",
        reference_no: "SUPPLIER-INV-123",
        status: "Open",
        currency: "MYR",
        outstanding: "100.00",
      },
    ],
    latest_recovery: null,
  };

  it("parses a strict, bounded recovery context", () => {
    const parsed = parseGateEData(recoveryContextSchema, validContext);
    expect(parsed.eligible_invoices[0].invoice_no).toBe("INV-202608-00001");
    expect(parsed.latest_recovery).toBeNull();
  });

  it("accepts a nullable external reference and a present latest_recovery", () => {
    const parsed = parseGateEData(recoveryContextSchema, {
      ...validContext,
      eligible_invoices: [{ ...validContext.eligible_invoices[0], reference_no: null }],
      latest_recovery: {
        id: UUID,
        action_type: "confirm_receipt_invoice_match",
        invoice_id: UUID2,
        created_at: TS,
      },
    });
    expect(parsed.eligible_invoices[0].reference_no).toBeNull();
    expect(parsed.latest_recovery?.action_type).toBe("confirm_receipt_invoice_match");
  });

  it("fails closed on a non-recoverable reason, unknown field, or oversized list", () => {
    expect(
      recoveryContextSchema.safeParse({ ...validContext, reason_code: "low_confidence" }).success,
    ).toBe(false);
    expect(
      recoveryContextSchema.safeParse({ ...validContext, injected: true }).success,
    ).toBe(false);
    expect(
      recoveryContextSchema.safeParse({
        ...validContext,
        eligible_invoices: Array.from({ length: 101 }, () => validContext.eligible_invoices[0]),
      }).success,
    ).toBe(false);
    expect(
      recoveryContextSchema.safeParse({ ...validContext, original_invoice_references: [] }).success,
    ).toBe(false);
  });
});
