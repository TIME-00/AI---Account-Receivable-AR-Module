import {
  AuthenticationError,
  BusinessError,
  ValidationError,
} from "./_shared/errors.ts";
import type { AuthContext } from "./_shared/auth.ts";
import {
  assertExactKeys,
  assertQueryParameters,
  automationSuccess,
  documentCapabilityProfile,
  isSemanticIsoDate,
  isSemanticIsoTimestamp,
  normalizeEmail,
  normalizePhone,
  parsePage,
  reminderCapabilityProfile,
  requireIsoDate,
} from "./automation/contract.ts";
import {
  DisabledDocumentIntelligenceProvider,
  type DocumentIntelligenceResult,
  FixtureDocumentIntelligenceProvider,
  resolveCustomerDeterministically,
  validateDocumentResult,
} from "./automation/document.ts";
import {
  classifyProviderFailure,
  DisabledDeliveryProvider,
  FixtureSecretResolver,
  GmailDeliveryProvider,
  GmailMailboxProvider,
  MicrosoftDeliveryProvider,
  MicrosoftMailboxProvider,
  OAUTH_SCOPES,
} from "./automation/providers.ts";
import {
  buildOAuthAuthorizationUrl,
  completeOAuthCallback,
  DisabledOAuthSecretWriter,
  exchangeOAuthCode,
  FixtureOAuthSecretWriter,
} from "./automation/oauth.ts";
import { handleAutomationRequest } from "./automation/index.ts";
import {
  assertAutomaticAllocationCommandEligible,
  assertProviderMessageBounded,
  attachmentExceptionReason,
  AUTOMATION_CUSTOMER_CODE_DATABASE_COLUMN,
  AUTOMATION_CUSTOMER_RESOLUTION_SELECT,
  AutomationService,
  boundedOAuthAuthorizationUrl,
  buildAutomaticAllocationPlan,
  customerResolutionFailureMayRecover,
  exactAutomationDecimalNumber,
  isAutomationExceptionIdempotencyConflict,
  mailboxCapabilityIsReady,
  resolveReceiptInvoiceReferenceAuthority,
  tokenExpiryIsCurrent,
} from "./automation/service.ts";
import {
  assignmentHistoryDto,
  auditEventDto,
  automationPrimitivePatterns,
  automationSettingsDto,
  currentAssignmentDto,
  documentDecisionDto,
  exceptionDto,
  exceptionRecoveryContextDto,
  mailboxDto,
  reminderDto,
  safeAutomationMetadata,
  syncRunDto,
} from "./automation/dto.ts";
import {
  AUTOMATION_WORKER_SECRET_HEADER,
  validateAutomationWorker,
} from "./automation/worker-auth.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(
  actual: unknown,
  expected: unknown,
  message = "Values differ",
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

async function rejects(
  action: () => unknown | Promise<unknown>,
  expected: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    const record = error && typeof error === "object"
      ? error as Record<string, unknown>
      : {};
    const searchable = [
      String(error),
      String(record.code ?? ""),
      JSON.stringify(record.details ?? {}),
    ].join(" ");
    assert(
      searchable.includes(expected),
      `Expected ${expected}, got ${searchable}`,
    );
    return;
  }
  throw new Error(`Expected rejection containing ${expected}`);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const auth: AuthContext = {
  userId: "00000000-0000-0000-0000-000000000010",
  companyId: "00000000-0000-0000-0000-000000000001",
  roles: ["Finance Manager"],
  highestRole: "Finance Manager",
  email: "finance@example.test",
};

const companyId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
const mailboxId = "10000000-0000-4000-8000-000000000003";
const attachmentId = "10000000-0000-4000-8000-000000000005";
const classificationId = "10000000-0000-4000-8000-000000000006";
const extractionId = "10000000-0000-4000-8000-000000000007";
const representativeId = "10000000-0000-4000-8000-000000000008";
const customerId = "10000000-0000-4000-8000-000000000009";
const now = "2026-08-06T04:05:06.000Z";

const invoiceFixture: DocumentIntelligenceResult = {
  classification: {
    schema_version: 1,
    document_type: "invoice",
    confidence: 0.999,
    critical_field_confidence: 0.999,
    provider: "fixture",
    model: "fixture-v1",
    provider_version: "1",
    trace_id: "trace-invoice",
  },
  extraction: {
    schema_version: 1,
    document_type: "invoice",
    customer: { customer_code: "CUS-001" },
    invoice_date: "2026-07-01",
    due_date: "2026-07-31",
    currency: "MYR",
    subtotal: "100.00",
    tax_total: "8.00",
    total: "108.00",
    lines: [{
      description: "Service",
      quantity: "1",
      unit_price: "100.00",
      line_total: "100.00",
    }],
  },
  field_confidence: { customer_code: 1, total: 1 },
};

Deno.test("Gate E common contract bounds pagination and normalizes contacts", () => {
  assertEquals(
    parsePage(new URL("https://test/automation/runs?page=2&page_size=100")),
    {
      page: 2,
      page_size: 100,
    },
  );
  assertEquals(normalizeEmail(" Finance@Example.COM "), "finance@example.com");
  assertEquals(normalizePhone("+60 12-345 6789"), "+60123456789");
  assertEquals(automationSuccess([]).contract_version, "gate-e.1");
  assertExactKeys({ name: "A" }, ["name"], ["name"]);
});

Deno.test("Gate E common contract rejects overflow and unknown request fields", async () => {
  await rejects(
    () =>
      parsePage(new URL("https://test/automation/runs?page=1&page_size=101")),
    "page_size",
  );
  await rejects(
    () => assertExactKeys({ company_id: "forged" }, ["name"]),
    "unexpected_fields",
  );
  await rejects(
    () =>
      assertQueryParameters(
        new URL("https://test/automation/runs?page=1&page=2"),
        ["page"],
      ),
    "duplicate",
  );
});

Deno.test("Gate E settings DTO has identical JSON types for defaults and PostgreSQL rows", () => {
  const defaults = automationSettingsDto(null, auth.companyId);
  const persisted = automationSettingsDto({
    ...defaults,
    minimum_overall_confidence: "0.9500",
    minimum_critical_confidence: "0.9900",
    created_at: now,
    updated_at: now,
  }, companyId);
  assertEquals(typeof defaults.minimum_overall_confidence, "number");
  assertEquals(typeof persisted.minimum_overall_confidence, "number");
  assertEquals(defaults.operating_mode, "disabled");
  assertEquals(defaults.mailbox_sync_enabled, false);
  assertEquals(persisted.minimum_critical_confidence, 0.99);
});

Deno.test("Gate E sync-run DTO uses measured counters and redacts provider cursors", () => {
  const dto = syncRunDto({
    id: classificationId,
    company_id: companyId,
    mailbox_id: mailboxId,
    provider_type: "gmail",
    status: "completed",
    cursor_before: "private-history-id",
    cursor_after: "private-next-history-id",
    started_at: now,
    completed_at: now,
    failed_at: null,
    messages_seen: 7,
    messages_persisted: 5,
    attachments_persisted: 4,
    duplicate_messages: 2,
    duplicate_attachments: 3,
    attachments_processed: 4,
    commands_processed: 2,
    allocations_completed: 1,
    failures: 1,
    attempt_count: 1,
    max_attempts: 3,
    redacted_error_code: null,
    created_at: now,
  });
  assertEquals(dto.messages_discovered, 7);
  assertEquals(dto.attachments_discovered, 7);
  assertEquals(dto.cursor_before, "[redacted]");
  assertEquals(JSON.stringify(dto).includes("private-history-id"), false);
});

Deno.test("Gate E document-decision DTO normalizes provider, attachment, and extraction names", () => {
  const dto = documentDecisionDto({
    id: classificationId,
    company_id: companyId,
    attachment_id: attachmentId,
    schema_version: 1,
    document_type: "invoice",
    status: "accepted",
    confidence: "0.9900",
    critical_confidence: "0.9800",
    provider_name: "fixture",
    provider_model: "fixture-v1",
    provider_version: "1",
    trace_id: "trace-safe",
    created_at: now,
    attachment: {
      id: attachmentId,
      original_file_name: "北京-invoice.pdf",
      detected_mime_type: "application/pdf",
      size_bytes: 123,
      page_count: 1,
      scan_status: "unavailable",
      safety_status: "accepted",
      processing_status: "processed",
      content_purged_at: null,
    },
    extraction: {
      id: extractionId,
      schema_version: 1,
      validation_status: "valid",
      validation_codes: [],
      field_confidence: { total: "0.99" },
      customer_id: customerId,
      customer_resolution_method: "customer_code",
      trace_id: "trace-safe",
      validated_at: now,
      created_at: now,
    },
    command: null,
    linked_exception_ids: [],
  });
  assertEquals(dto.critical_field_confidence, 0.98);
  assertEquals(dto.provider, "fixture");
  assertEquals(
    (dto.attachment as Record<string, unknown>).file_name,
    "北京-invoice.pdf",
  );
  assertEquals(
    (dto.extraction as Record<string, unknown>).document_type,
    "invoice",
  );
  assertEquals("provider_name" in dto, false);
});

Deno.test("Gate E exception DTO exposes bounded monitoring context without document contents", () => {
  const dto = exceptionDto({
    id: classificationId,
    company_id: companyId,
    mailbox_id: mailboxId,
    sync_run_id: null,
    message_id: null,
    attachment_id: attachmentId,
    command_id: null,
    invoice_id: null,
    receipt_id: null,
    reason_code: "unsupported_document",
    idempotency_key: null,
    lifecycle_status: "open",
    safe_details: { document_type: "unsupported" },
    retry_count: 0,
    max_retries: 3,
    actor_user_id: null,
    resolution_note: null,
    opened_at: now,
    resolved_at: null,
    dismissed_at: null,
    updated_at: now,
    document_context: {
      file_name: "gate-e-observe-unsupported-20260809.png",
      document_type: "unsupported",
      processing_status: "processed",
      classification_status: "rejected",
    },
  });
  assertEquals(dto.document, {
    file_name: "gate-e-observe-unsupported-20260809.png",
    document_type: "unsupported",
    processing_status: "processed",
    classification_status: "rejected",
    manual_review_required: true,
  });
  assertEquals(JSON.stringify(dto).includes("document_context"), false);
  assertEquals(
    exceptionDto({
      ...dto,
      lifecycle_status: "resolved",
      resolved_at: now,
      resolution_note: "Reviewed safely.",
      document_context: {
        file_name: "gate-e-observe-unsupported-20260809.png",
        document_type: "unsupported",
        processing_status: "processed",
        classification_status: "rejected",
      },
    }).document,
    {
      file_name: "gate-e-observe-unsupported-20260809.png",
      document_type: "unsupported",
      processing_status: "processed",
      classification_status: "rejected",
      manual_review_required: false,
    },
  );
  assertEquals(
    exceptionDto({
      ...dto,
      document_context: null,
    }).document,
    null,
  );
});

Deno.test("Gate E current assignment and history include normalized representative identity", () => {
  const row = {
    id: classificationId,
    company_id: companyId,
    customer_id: customerId,
    sales_representative_id: representativeId,
    assignment_source: "customer_onboarding",
    assigned_by: userId,
    assigned_at: now,
    assignment_reason: "负责客户交接",
    superseded_at: null,
    superseded_by: null,
    created_at: now,
    sales_representative: {
      id: representativeId,
      company_id: companyId,
      name: "張偉",
      email: "sales@example.test",
      phone: "+60123456789",
      is_active: true,
      created_at: now,
      updated_at: now,
      created_by: userId,
      updated_by: userId,
    },
  };
  const current = currentAssignmentDto(row)!;
  const history = assignmentHistoryDto({
    ...row,
    superseded_at: now,
    superseded_by: userId,
  });
  assertEquals(
    (current.sales_representative as Record<string, unknown>).name,
    "張偉",
  );
  assertEquals(
    (history.assignment as Record<string, unknown>).superseded_at,
    now,
  );
  assertEquals(currentAssignmentDto(null), null);
});

Deno.test("Gate E mailbox DTO exposes readiness metadata but never secret refs or raw cursor", () => {
  const dto = mailboxDto({
    id: mailboxId,
    company_id: auth.companyId,
    provider_type: "microsoft",
    mailbox_address: "automation@example.test",
    default_bank_account_id: null,
    connection_status: "connected",
    ingestion_secret_ref: "GATE_E_TEST_INGESTION",
    delivery_secret_ref: null,
    ingestion_token_expires_at: now,
    delivery_token_expires_at: null,
    cursor_kind: "delta_link",
    incremental_cursor: "private-delta-link",
    last_successful_sync_at: now,
    last_failed_sync_at: null,
    reconnect_required: false,
    delivery_reconnect_required: false,
    is_enabled: true,
    ingestion_enabled: true,
    delivery_enabled: false,
    redacted_error_code: null,
    created_at: now,
    updated_at: now,
  });
  assertEquals(dto.ingestion_secret_configured, true);
  assertEquals(dto.cursor_present, true);
  assertEquals("ingestion_secret_ref" in dto, false);
  assertEquals(JSON.stringify(dto).includes("private-delta-link"), false);
});

Deno.test("Gate E mailbox collection serializes PostgreSQL UUID identifiers", async () => {
  const mailbox = {
    id: mailboxId,
    company_id: auth.companyId,
    provider_type: "gmail",
    mailbox_address: "controlled-mailbox@example.test",
    default_bank_account_id: null,
    connection_status: "disabled",
    ingestion_secret_ref: "AR_MAILBOX_INGESTION_1",
    delivery_secret_ref: null,
    ingestion_token_expires_at: null,
    delivery_token_expires_at: null,
    cursor_kind: null,
    incremental_cursor: null,
    last_successful_sync_at: null,
    last_failed_sync_at: null,
    reconnect_required: false,
    delivery_reconnect_required: false,
    is_enabled: false,
    ingestion_enabled: false,
    delivery_enabled: false,
    redacted_error_code: null,
    created_at: now,
    updated_at: now,
  };
  const client = {
    from(table: string) {
      assertEquals(table, "automation_mailboxes");
      const query = {
        select() {
          return query;
        },
        eq(field: string, value: unknown) {
          assertEquals(field, "company_id");
          assertEquals(value, auth.companyId);
          return query;
        },
        order() {
          return query;
        },
        range() {
          return Promise.resolve({ data: [mailbox], count: 1, error: null });
        },
      };
      return query;
    },
  };
  const result = await new AutomationService({ client: client as never })
    .listTable(auth, "automation_mailboxes", { page: 1, page_size: 50 });
  assertEquals(result.meta.total, 1);
  assertEquals(result.rows[0].company_id, auth.companyId);
});

Deno.test("Gate E audit metadata allowlist suppresses credentials and provider bodies", () => {
  const metadata = safeAutomationMetadata({
    action: "resolved",
    reminder_id: classificationId,
    access_token: "forbidden",
    refresh_token: "forbidden",
    authorization: "forbidden",
    provider_body: { private: true },
    stack: "forbidden",
  });
  assertEquals(metadata, { action: "resolved", reminder_id: classificationId });
  const dto = auditEventDto({
    id: classificationId,
    company_id: companyId,
    event_type: "exception.resolved",
    entity_type: "automation_exception",
    entity_id: extractionId,
    actor_type: "system_worker",
    actor_user_id: null,
    trace_id: "trace-safe",
    safe_metadata: metadata,
    created_at: now,
  });
  assertEquals(dto.actor_type, "system");
});

Deno.test("Gate E safe metadata validates each public key and drops credential-shaped values", () => {
  const credentialValues: Record<string, unknown> = {
    status: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature123",
    operation: "Bearer oauth-access-token",
    action: "Abc123Def456Ghi789Jkl012Mno345Pqr678Stu901Vwx234Yz",
    error_code: "Bearer SECRET",
    reason_code: "eyJhbGciOiJIUzI1NiJ9.payload.signature123",
    provider_type: "ya29.secret-token-value",
    operating_mode: "postgresql://user:password@example.test/database",
  };
  assertEquals(safeAutomationMetadata(credentialValues), {});

  assertEquals(
    safeAutomationMetadata({
      assignment_id: classificationId,
      reminder_id: extractionId,
      status: "completed",
      operation: "update",
      action: "resolved",
      error_code: "PROVIDER_UNAVAILABLE",
      reason_code: "provider_unavailable",
      provider_type: "gmail",
      operating_mode: "observe_only",
      changed_fields: ["name", "reminder_delivery_enabled"],
      retry_blocked: true,
      stage_offset_days: -3,
      duplicate_no_op: true,
    }),
    {
      assignment_id: classificationId,
      reminder_id: extractionId,
      status: "completed",
      operation: "update",
      action: "resolved",
      error_code: "PROVIDER_UNAVAILABLE",
      reason_code: "provider_unavailable",
      provider_type: "gmail",
      operating_mode: "observe_only",
      changed_fields: ["name", "reminder_delivery_enabled"],
      retry_blocked: true,
      stage_offset_days: -3,
      duplicate_no_op: true,
    },
  );

  assertEquals(
    safeAutomationMetadata({
      status: "x".repeat(201),
      operation: { value: "update" },
      action: [{ value: "resolved" }],
      changed_fields: [{ value: "name" }],
      access_token: "forbidden",
      private_key: "-----BEGIN PRIVATE KEY-----",
      cursor: "private-history-state",
    }),
    {},
  );
});

Deno.test("Gate E primitive formats are frozen and reject arbitrary strings", async () => {
  const uuid = new RegExp(automationPrimitivePatterns.uuid, "i");
  assert(uuid.test(auth.companyId));
  assert(uuid.test(companyId));
  const malformed = [
    "00000000_0000-0000-0000-000000000001",
    auth.companyId.slice(0, -1),
    `${auth.companyId}0`,
    "00000000-0000-0000-0000-00000000000g",
    "customer-1",
  ];
  for (const value of malformed) {
    assert(!uuid.test(value), `Unexpected UUID acceptance: ${value}`);
    await rejects(
      () => automationSettingsDto(null, value),
      "AUTOMATION_RESPONSE_INVALID",
    );
  }
  assertEquals(
    automationSettingsDto(null, auth.companyId).company_id,
    auth.companyId,
  );
  await new FixtureOAuthSecretWriter().deleteTokenSet({
    company_id: auth.companyId,
    mailbox_id: mailboxId,
    provider: "gmail",
    capability: "ingestion",
    secret_reference: "GATE_E_PRODUCTION_UUID_TEST",
  });
  assert(new RegExp(automationPrimitivePatterns.iso_date).test("2026-08-06"));
  assert(
    !new RegExp(automationPrimitivePatterns.decimal_string).test("MYR 1.00"),
  );
  assert(new RegExp(automationPrimitivePatterns.sha256).test("a".repeat(64)));
});

Deno.test("Gate E ISO date and timestamp validation is semantic", () => {
  for (const valid of ["2026-08-06", "2024-02-29"]) {
    assert(isSemanticIsoDate(valid), `Expected valid date ${valid}`);
  }
  for (
    const invalid of [
      "2026-00-10",
      "2026-13-01",
      "2026-02-30",
      "2026-99-99",
      "2025-02-29",
    ]
  ) {
    assert(!isSemanticIsoDate(invalid), `Expected invalid date ${invalid}`);
  }
  for (
    const valid of [
      "2026-08-06T04:05:06Z",
      "2026-08-06T04:05:06.123456+08:00",
      "2024-02-29T23:59:59-05:30",
    ]
  ) {
    assert(
      isSemanticIsoTimestamp(valid),
      `Expected valid timestamp ${valid}`,
    );
  }
  for (
    const invalid of [
      "2025-02-29T04:05:06Z",
      "2026-02-30T04:05:06Z",
      "2026-08-06T24:00:00Z",
      "2026-08-06T23:60:00Z",
      "2026-08-06T23:59:60Z",
      "2026-08-06T04:05:06+14:01",
      "2026-08-06T04:05:06+15:00",
      "NaN",
      "Infinity",
    ]
  ) {
    assert(
      !isSemanticIsoTimestamp(invalid),
      `Expected invalid timestamp ${invalid}`,
    );
  }

  const baseReminder = {
    id: classificationId,
    company_id: companyId,
    invoice_id: extractionId,
    customer_id: customerId,
    sales_representative_id: mailboxId,
    stage_offset_days: -3,
    scheduled_for: "2026-08-06",
    status: "pending",
    recipient_name_snapshot: "Representative",
    recipient_email_snapshot: "representative@example.test",
    recipient_phone_snapshot: null,
    customer_name_snapshot: "Customer",
    invoice_no_snapshot: "INV-1",
    due_date_snapshot: "2026-08-09",
    outstanding_snapshot: "1.00",
    currency_snapshot: "MYR",
    created_at: "2026-08-06T04:05:06+08:00",
    delivered_at: null,
  };
  assertEquals(
    reminderDto(baseReminder).created_at,
    "2026-08-05T20:05:06.000Z",
  );
  for (const scheduled_for of ["2026-02-30", "2025-02-29"]) {
    try {
      reminderDto({ ...baseReminder, scheduled_for });
      throw new Error(`Expected invalid reminder date ${scheduled_for}`);
    } catch (error) {
      assert(String(error).includes("Automation data"));
    }
  }
});

Deno.test("Gate E automatic allocation eligibility is only completed create_receipt with a result", async () => {
  const eligible = {
    command_type: "create_receipt",
    status: "completed",
    resulting_receipt_id: classificationId,
  };
  assertAutomaticAllocationCommandEligible(eligible);
  for (
    const invalid of [
      { ...eligible, command_type: "allocate_receipt" },
      { ...eligible, status: "proposed" },
      { ...eligible, status: "pending" },
      { ...eligible, status: "failed" },
      { ...eligible, resulting_receipt_id: null },
    ]
  ) {
    await rejects(
      () => assertAutomaticAllocationCommandEligible(invalid),
      "ALLOCATION_EVIDENCE_INSUFFICIENT",
    );
  }
});

Deno.test("Gate E calendar-date contract rejects impossible reminder dates", async () => {
  assertEquals(requireIsoDate("2028-02-29", "evaluation_date"), "2028-02-29");
  await rejects(
    () => requireIsoDate("2026-02-29", "evaluation_date"),
    "real calendar date",
  );
  await rejects(
    () => requireIsoDate("30-07-2026", "evaluation_date"),
    "YYYY-MM-DD",
  );
});

Deno.test("Gate E worker authentication is independent and fails closed", async () => {
  const valid = new Request("https://example.test/automation/worker/run", {
    method: "POST",
    headers: { [AUTOMATION_WORKER_SECRET_HEADER]: "fixture-worker-secret" },
  });
  validateAutomationWorker(valid, "fixture-worker-secret");
  await rejects(
    () => validateAutomationWorker(valid, undefined),
    "AUTOMATION_WORKER_NOT_CONFIGURED",
  );
  await rejects(
    () =>
      validateAutomationWorker(
        new Request("https://example.test/automation/worker/run", {
          method: "POST",
        }),
        "fixture-worker-secret",
      ),
    "Authentication",
  );
});

Deno.test("Gate E disabled document provider fails closed", async () => {
  await rejects(
    () =>
      new DisabledDocumentIntelligenceProvider().analyze({
        file_name: "invoice.pdf",
        detected_mime_type: "application/pdf",
        sha256: "a".repeat(64),
        bytes: new Uint8Array(),
      }),
    "DOCUMENT_INTELLIGENCE_DISABLED",
  );
});

Deno.test("Gate E fixture document provider returns deterministic independent values", async () => {
  const provider = new FixtureDocumentIntelligenceProvider(invoiceFixture);
  const first = await provider.analyze({
    file_name: "invoice.pdf",
    detected_mime_type: "application/pdf",
    sha256: "a".repeat(64),
    bytes: new Uint8Array(),
  });
  const second = await provider.analyze({
    file_name: "invoice.pdf",
    detected_mime_type: "application/pdf",
    sha256: "a".repeat(64),
    bytes: new Uint8Array(),
  });
  assertEquals(first, second);
  assert(first !== second);
});

Deno.test("Gate E invoice extraction validates exact decimal arithmetic", () => {
  assertEquals(validateDocumentResult(invoiceFixture), invoiceFixture);
});

Deno.test("Gate E invoice line reconciliation uses governed half-up currency rounding", async () => {
  const fixture = structuredClone(invoiceFixture);
  if (fixture.extraction?.document_type !== "invoice") {
    throw new Error("invoice fixture expected");
  }
  fixture.extraction.lines = [{
    description: "Precision service",
    quantity: "1.234",
    unit_price: "10.1234",
    line_total: "12.49",
  }];
  fixture.extraction.subtotal = "12.49";
  fixture.extraction.tax_total = "0.00";
  fixture.extraction.total = "12.49";
  assertEquals(
    validateDocumentResult(fixture).extraction?.document_type,
    "invoice",
  );
  fixture.extraction.lines[0].line_total = "12.50";
  await rejects(() => validateDocumentResult(fixture), "reconcile");
});

Deno.test("Gate E financial extraction rejects negative, over-precision, and oversized decimals", async () => {
  const negative = structuredClone(invoiceFixture);
  if (negative.extraction?.document_type === "invoice") {
    negative.extraction.lines[0].unit_price = "-100.00";
  }
  await rejects(() => validateDocumentResult(negative), "negative");

  const overPrecision = structuredClone(invoiceFixture);
  if (overPrecision.extraction?.document_type === "invoice") {
    overPrecision.extraction.lines[0].quantity = "1.0001";
  }
  await rejects(() => validateDocumentResult(overPrecision), "precision");

  const oversized = structuredClone(invoiceFixture);
  if (oversized.extraction?.document_type === "invoice") {
    oversized.extraction.subtotal = "1".repeat(17);
  }
  await rejects(() => validateDocumentResult(oversized), "precision");
});

Deno.test("Gate E financial commands reject decimal values that JavaScript would round", async () => {
  assertEquals(
    exactAutomationDecimalNumber("1234.56", 2, "receipt_amount"),
    1234.56,
  );
  assertEquals(
    exactAutomationDecimalNumber("10.250", 3, "quantity"),
    10.25,
  );
  await rejects(
    () =>
      exactAutomationDecimalNumber(
        "99999999999999.99",
        2,
        "receipt_amount",
      ),
    "cannot be represented exactly",
  );
  await rejects(
    () => exactAutomationDecimalNumber("1.0001", 3, "quantity"),
    "precision",
  );
});

Deno.test("Gate E document schema rejects extra provider authority and impossible dates", async () => {
  const extra = structuredClone(invoiceFixture) as
    & DocumentIntelligenceResult
    & Record<string, unknown>;
  extra.sql = "select * from invoices";
  await rejects(() => validateDocumentResult(extra), "unexpected_fields");

  const impossible = structuredClone(invoiceFixture);
  if (impossible.extraction?.document_type === "invoice") {
    impossible.extraction.invoice_date = "2026-02-31";
  }
  await rejects(() => validateDocumentResult(impossible), "invoice_date");
});

Deno.test("Gate E unsupported operational currency fails before command creation", async () => {
  const unsupported = structuredClone(invoiceFixture);
  if (unsupported.extraction?.document_type === "invoice") {
    unsupported.extraction.currency = "JPY";
  }
  await rejects(() => validateDocumentResult(unsupported), "not supported");
});

Deno.test("Gate E arithmetic mismatch fails without financial command", async () => {
  const invalid = structuredClone(invoiceFixture);
  if (invalid.extraction?.document_type === "invoice") {
    invalid.extraction.total = "109.00";
  }
  await rejects(() => validateDocumentResult(invalid), "ARITHMETIC_MISMATCH");
});

Deno.test("Gate E low confidence fails closed", async () => {
  const invalid = structuredClone(invoiceFixture);
  invalid.classification.confidence = 0.5;
  await rejects(() => validateDocumentResult(invalid), "LOW_CONFIDENCE");
});

Deno.test("Gate E receipt extraction validates supported payment and precision", () => {
  const receipt: DocumentIntelligenceResult = {
    classification: {
      ...invoiceFixture.classification,
      document_type: "receipt",
      trace_id: "trace-receipt",
    },
    extraction: {
      schema_version: 1,
      document_type: "receipt",
      customer: { registration_identifier: "REG-1" },
      receipt_date: "2026-07-10",
      currency: "SGD",
      amount: "1234.56",
      payment_method: "TT",
      invoice_references: ["INV-1"],
    },
    field_confidence: { amount: 1 },
  };
  assertEquals(validateDocumentResult(receipt), receipt);
});

Deno.test("Gate E deterministic customer resolution prefers exact customer code", () => {
  assertEquals(
    resolveCustomerDeterministically(
      { customer_code: "CUS-2", company_name: "Duplicate" },
      [
        {
          id: "1",
          customer_code: "CUS-1",
          registration_identifier: null,
          email: null,
          customer_name: "Duplicate",
        },
        {
          id: "2",
          customer_code: "CUS-2",
          registration_identifier: null,
          email: null,
          customer_name: "Duplicate",
        },
      ],
    ),
    { customer_id: "2", method: "customer_code" },
  );
});

Deno.test("Gate E ambiguous exact customer match fails closed", async () => {
  await rejects(() =>
    resolveCustomerDeterministically(
      { email: "same@example.test" },
      [1, 2].map((id) => ({
        id: String(id),
        customer_code: `CUS-${id}`,
        registration_identifier: null,
        email: "same@example.test",
        customer_name: `Customer ${id}`,
      })),
    ), "CUSTOMER_AMBIGUOUS");
});

Deno.test("Gate E runtime customer resolver uses the PostgreSQL business-code column", () => {
  assertEquals(AUTOMATION_CUSTOMER_CODE_DATABASE_COLUMN, "customer_id");
  assertEquals(
    AUTOMATION_CUSTOMER_RESOLUTION_SELECT,
    "id,customer_id,registration_no,tax_id,contact_email,customer_name",
  );
  assert(
    !AUTOMATION_CUSTOMER_RESOLUTION_SELECT.split(",").includes(
      "customer_code",
    ),
    "The runtime customer query must not select the nonexistent customer_code column",
  );
});

Deno.test("Gate E persisted customer-resolution failures remain safely retryable", () => {
  assert(customerResolutionFailureMayRecover(["customer_unresolved"]));
  assert(customerResolutionFailureMayRecover(["customer_ambiguous"]));
  assert(customerResolutionFailureMayRecover(["internal_processing_failure"]));
  assert(
    !customerResolutionFailureMayRecover(["arithmetic_mismatch"]),
    "Non-customer validation failures must not be reclassified as resolved",
  );
  assert(
    !customerResolutionFailureMayRecover(["invoice_conflict"]),
    "Financial identifier conflicts must remain fail-closed",
  );
});

Deno.test("Gate E persisted extraction recovery revalidates financial identifiers before acceptance", async () => {
  const service = await Deno.readTextFile(
    new URL("./automation/service.ts", import.meta.url),
  );
  const recoveryStart = service.indexOf(
    "if (!customerResolutionFailureMayRecover(validationCodes))",
  );
  const recoveryEnd = service.indexOf(
    "const { data: recovered, error: recoveryError }",
    recoveryStart,
  );
  const recovery = service.slice(recoveryStart, recoveryEnd);
  assert(recoveryStart >= 0 && recoveryEnd > recoveryStart);
  assert(recovery.includes("await this.resolveCustomer("));
  assert(recovery.includes("await this.assertNoFinancialIdentifierConflict("));
});

Deno.test("Gate E exception idempotency ignores only its exact partial-index collision", () => {
  assert(isAutomationExceptionIdempotencyConflict({
    code: "23505",
    message:
      'duplicate key value violates unique constraint "uq_automation_exception_idempotency"',
  }));
  assert(
    !isAutomationExceptionIdempotencyConflict({
      code: "23505",
      message: 'duplicate key value violates unique constraint "other_unique"',
    }),
  );
  assert(
    !isAutomationExceptionIdempotencyConflict({
      code: "42501",
      message: "permission denied",
    }),
  );
  assert(!isAutomationExceptionIdempotencyConflict(null));
});

Deno.test("Gmail history adapter maps messages and cursor without real network", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/history?")) {
      return Promise.resolve(json({
        history: [{ messagesAdded: [{ message: { id: "m1" } }] }],
        historyId: "101",
      }));
    }
    return Promise.resolve(json({
      id: "m1",
      threadId: "t1",
      historyId: "101",
      internalDate: "1700000000000",
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "Message-ID", value: "<m1@example.test>" },
          { name: "From", value: "sender@example.test" },
          { name: "Subject", value: "Invoice" },
        ],
        parts: [{
          filename: "invoice.pdf",
          mimeType: "application/pdf",
          body: { attachmentId: "a1", size: 10 },
        }],
      },
    }));
  };
  const result = await new GmailMailboxProvider(fetcher).syncPage({
    accessToken: "fixture-token",
    cursor: "100",
    pageToken: null,
  });
  assertEquals(result.completed_cursor, "101");
  assertEquals(result.messages[0].attachments[0].provider_attachment_id, "a1");
  assert(calls.every((url) => url.startsWith("https://gmail.googleapis.com/")));
});

Deno.test("Gmail initial sync obtains profile historyId after the final message page", async () => {
  const calls: string[] = [];
  const provider = new GmailMailboxProvider((input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/profile")) {
      return Promise.resolve(json({ historyId: "initial-200" }));
    }
    return Promise.resolve(json({ messages: [] }));
  });
  const result = await provider.syncPage({
    accessToken: "fixture-token",
    cursor: null,
    pageToken: null,
  });
  assertEquals(result.completed_cursor, "initial-200");
  assert(calls.some((url) => url.endsWith("/profile")));
});

Deno.test("Gmail changed-message label history is processed deterministically", async () => {
  const provider = new GmailMailboxProvider((input) => {
    const url = String(input);
    if (url.includes("/history?")) {
      return Promise.resolve(json({
        history: [{
          labelsAdded: [{ message: { id: "changed-1" } }],
          labelsRemoved: [{ message: { id: "changed-1" } }],
        }],
        historyId: "202",
      }));
    }
    return Promise.resolve(json({
      id: "changed-1",
      internalDate: "1700000000000",
      payload: { headers: [], parts: [] },
    }));
  });
  const result = await provider.syncPage({
    accessToken: "fixture-token",
    cursor: "201",
    pageToken: null,
  });
  assertEquals(result.messages.map((message) => message.provider_message_id), [
    "changed-1",
  ]);
});

Deno.test("Gmail expired history cursor is explicit and does not advance", async () => {
  const provider = new GmailMailboxProvider(() =>
    Promise.resolve(json({}, 404))
  );
  const result = await provider.syncPage({
    accessToken: "fixture-token",
    cursor: "expired",
    pageToken: null,
  });
  assert(result.cursor_invalid);
  assertEquals(result.completed_cursor, null);
});

Deno.test("Gmail attachment base64url fixture maps exact bytes", async () => {
  const provider = new GmailMailboxProvider(() =>
    Promise.resolve(json({ data: "AQID" }))
  );
  assertEquals([
    ...await provider.getAttachment({
      accessToken: "fixture-token",
      messageId: "m1",
      attachmentId: "a1",
    }),
  ], [1, 2, 3]);
});

Deno.test("Gmail inline MIME attachment bytes are ingested without a provider attachment request", async () => {
  let calls = 0;
  const provider = new GmailMailboxProvider((input) => {
    calls++;
    const url = String(input);
    if (url.includes("/history?")) {
      return Promise.resolve(json({
        history: [{ messagesAdded: [{ message: { id: "m-inline" } }] }],
        historyId: "301",
      }));
    }
    return Promise.resolve(json({
      id: "m-inline",
      internalDate: "1700000000000",
      payload: {
        headers: [],
        parts: [{
          partId: "1",
          filename: "inline.pdf",
          mimeType: "application/pdf",
          body: { data: "AQID", size: 3 },
        }],
      },
    }));
  });
  const result = await provider.syncPage({
    accessToken: "fixture-token",
    cursor: "300",
    pageToken: null,
  });
  assertEquals(calls, 2);
  assertEquals(
    result.messages[0].attachments[0].provider_attachment_id,
    "inline:1",
  );
  assertEquals([...result.messages[0].attachments[0].bytes ?? []], [1, 2, 3]);
});

Deno.test("Provider message metadata and attachment fan-out are bounded before persistence", async () => {
  const valid = {
    provider_message_id: "message-1",
    provider_thread_id: null,
    internet_message_id: null,
    received_at: "2026-07-30T00:00:00.000Z",
    sender_address: "sender@example.test",
    subject: "Invoice",
    mime_type: "message/rfc822",
    revision: null,
    attachments: [],
  };
  assertProviderMessageBounded(valid);
  await rejects(
    () =>
      assertProviderMessageBounded({
        ...valid,
        attachments: Array.from({ length: 101 }, (_, index) => ({
          provider_attachment_id: `attachment-${index}`,
          file_name: "invoice.pdf",
          content_type: "application/pdf",
          size: 10,
        })),
      }),
    "PROVIDER_RESPONSE_INVALID",
  );
});

Deno.test("Microsoft delta adapter follows nextLink and maps attachments", async () => {
  const fetcher: typeof fetch = (input) => {
    const url = String(input);
    if (url.includes("/attachments?")) {
      return Promise.resolve(json({
        value: [{
          id: "a1",
          name: "receipt.pdf",
          contentType: "application/pdf",
          size: 20,
        }],
      }));
    }
    return Promise.resolve(json({
      value: [{
        id: "m1",
        receivedDateTime: "2026-07-01T00:00:00Z",
        internetMessageId: "<m1@example.test>",
        from: { emailAddress: { address: "sender@example.test" } },
        subject: "Receipt",
        hasAttachments: true,
        changeKey: "v1",
      }],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/next",
    }));
  };
  const result = await new MicrosoftMailboxProvider(fetcher).syncPage({
    accessToken: "fixture-token",
    cursor: null,
    pageToken: null,
  });
  assertEquals(result.next_page_token, "https://graph.microsoft.com/v1.0/next");
  assertEquals(result.messages[0].attachments.length, 1);
  assertEquals(result.completed_cursor, null);
});

Deno.test("Microsoft final deltaLink is the only committed cursor", async () => {
  const provider = new MicrosoftMailboxProvider(() =>
    Promise.resolve(json({
      value: [],
      "@odata.deltaLink": "https://graph.microsoft.com/v1.0/final-delta",
    }))
  );
  const result = await provider.syncPage({
    accessToken: "fixture-token",
    cursor: null,
    pageToken: null,
  });
  assertEquals(
    result.completed_cursor,
    "https://graph.microsoft.com/v1.0/final-delta",
  );
});

Deno.test("Microsoft invalid delta cursor is explicit", async () => {
  const provider = new MicrosoftMailboxProvider(() =>
    Promise.resolve(json({}, 410))
  );
  const result = await provider.syncPage({
    accessToken: "fixture-token",
    cursor: "https://graph.microsoft.com/v1.0/expired",
    pageToken: null,
  });
  assert(result.cursor_invalid);
});

Deno.test("Gmail delivery uses send endpoint and no attachment", async () => {
  let captured = "";
  const provider = new GmailDeliveryProvider((_input, init) => {
    captured = String((init as RequestInit | undefined)?.body);
    return Promise.resolve(json({ id: "gmail-message-1" }));
  });
  const result = await provider.send({
    accessToken: "fixture-token",
    fromAddress: "ar@example.test",
    toAddress: "sales@example.test",
    subject: "Invoice due reminder",
    textBody:
      "Customer: Example\nInvoice: INV-1\nDue date: 2026-08-01\nOutstanding: 10.00 MYR\nPlease contact the customer.",
    idempotencyKey: "a".repeat(64),
  });
  assertEquals(result.provider_message_id, "gmail-message-1");
  assert(!captured.includes("attachment"));
});

Deno.test("Microsoft delivery fixture maps Graph sendMail", async () => {
  let url = "";
  const provider = new MicrosoftDeliveryProvider((input) => {
    url = String(input);
    return Promise.resolve(new Response(null, { status: 202 }));
  });
  const result = await provider.send({
    accessToken: "fixture-token",
    fromAddress: "ar@example.test",
    toAddress: "sales@example.test",
    subject: "Invoice due reminder",
    textBody:
      "Customer: Example\nInvoice: INV-1\nDue date: 2026-08-01\nOutstanding: 10.00 MYR\nPlease contact the customer.",
    idempotencyKey: "b".repeat(64),
  });
  assert(url.endsWith("/me/sendMail"));
  assert(result.accepted);
  assertEquals(result.provider_message_id, null);
});

Deno.test("Delivery adapters block retry when the provider outcome is ambiguous", async () => {
  const request = {
    accessToken: "fixture-token",
    fromAddress: "ar@example.test",
    toAddress: "sales@example.test",
    subject: "Invoice due reminder",
    textBody:
      "Customer: Example\nInvoice: INV-1\nDue date: 2026-08-01\nOutstanding amount: 10.00 MYR\nPlease contact the customer.",
    idempotencyKey: "c".repeat(64),
  };
  await rejects(
    () =>
      new GmailDeliveryProvider(() => Promise.resolve(json({}, 500))).send(
        request,
      ),
    "PROVIDER_DELIVERY_OUTCOME_UNCONFIRMED",
  );
  await rejects(
    () =>
      new MicrosoftDeliveryProvider(() =>
        Promise.resolve(new Response(null, { status: 503 }))
      ).send(request),
    "PROVIDER_DELIVERY_OUTCOME_UNCONFIRMED",
  );
});

Deno.test("Delivery adapters retry only an explicit provider throttle", async () => {
  const request = {
    accessToken: "fixture-token",
    fromAddress: "ar@example.test",
    toAddress: "sales@example.test",
    subject: "Invoice due reminder",
    textBody:
      "Customer: Example\nInvoice: INV-1\nDue date: 2026-08-01\nOutstanding amount: 10.00 MYR\nPlease contact the customer.",
    idempotencyKey: "d".repeat(64),
  };
  await rejects(
    () =>
      new GmailDeliveryProvider(() => Promise.resolve(json({}, 429))).send(
        request,
      ),
    "PROVIDER_DELIVERY_RETRYABLE",
  );
  await rejects(
    () =>
      new MicrosoftDeliveryProvider(() =>
        Promise.resolve(new Response(null, { status: 429 }))
      ).send(request),
    "PROVIDER_DELIVERY_RETRYABLE",
  );
});

Deno.test("Disabled delivery provider never sends", async () => {
  await rejects(() =>
    new DisabledDeliveryProvider("gmail").send({
      accessToken: "fixture-token",
      fromAddress: "ar@example.test",
      toAddress: "sales@example.test",
      subject: "Invoice due reminder",
      textBody: "Customer: Example",
      idempotencyKey: "a".repeat(64),
    }), "REMINDER_DELIVERY_DISABLED");
});

Deno.test("Reminder delivery rejects header injection before provider I/O", async () => {
  let called = false;
  const provider = new GmailDeliveryProvider(() => {
    called = true;
    return Promise.resolve(json({ id: "must-not-send" }));
  });
  await rejects(
    () =>
      provider.send({
        accessToken: "fixture-token",
        fromAddress: "ar@example.test",
        toAddress: "sales@example.test",
        subject: "Reminder\r\nBcc: attacker@example.test",
        textBody: "Customer: Example",
        idempotencyKey: "a".repeat(64),
      }),
    "headers",
  );
  assert(!called);
});

Deno.test("Provider failure classification is bounded and redacted", () => {
  assertEquals(
    classifyProviderFailure(
      new BusinessError("PROVIDER_UNAVAILABLE", "private detail", 503),
    ),
    { retryable: true, code: "PROVIDER_UNAVAILABLE" },
  );
  assertEquals(classifyProviderFailure(new Error("token=secret")), {
    retryable: false,
    code: "INTERNAL_PROCESSING_FAILURE",
  });
});

Deno.test("Mailbox and OAuth adapters reject oversized provider responses without parsing private bodies", async () => {
  const gmail = new GmailMailboxProvider(() =>
    Promise.resolve(
      new Response('{"messages":[]}', {
        headers: { "content-length": String(16 * 1024 * 1024 + 1) },
      }),
    )
  );
  await rejects(
    () =>
      gmail.syncPage({
        accessToken: "fixture-token",
        cursor: null,
        pageToken: null,
      }),
    "PROVIDER_RESPONSE_INVALID",
  );

  await rejects(
    () =>
      exchangeOAuthCode({
        configuration: {
          provider: "gmail",
          client_id: "client",
          client_secret: "fixture-client-secret",
          redirect_uri: "https://example.test/callback",
        },
        code: "fixture-code",
        fetcher: () =>
          Promise.resolve(
            new Response('{"access_token":"private"}', {
              headers: { "content-length": String(1024 * 1024 + 1) },
            }),
          ),
      }),
    "OAUTH_RESPONSE_INVALID",
  );
});

Deno.test("Mailbox attachment failures map to exact bounded exception codes", () => {
  assertEquals(
    attachmentExceptionReason(
      new ValidationError("Encrypted PDF.", { reason: "encrypted_pdf" }),
    ),
    "encrypted_document",
  );
  assertEquals(
    attachmentExceptionReason(
      new ValidationError("Payload too large.", { max_bytes: 10 }),
    ),
    "oversized_document",
  );
  assertEquals(
    attachmentExceptionReason(
      new ValidationError("Too many pages.", { max_pages: 3 }),
    ),
    "oversized_document",
  );
  assertEquals(
    attachmentExceptionReason(
      new ValidationError("Active PDF.", { reason: "pdf_active_content" }),
    ),
    "unsafe_file",
  );
  assertEquals(
    attachmentExceptionReason(new ValidationError("Unsupported file.")),
    "unsupported_file",
  );
  assertEquals(
    attachmentExceptionReason(new Error("scanner failed")),
    "unsafe_file",
  );
});

Deno.test("Mailbox OAuth readiness fails closed on absent or expired metadata", () => {
  const now = new Date("2026-07-30T00:00:00.000Z");
  assert(!tokenExpiryIsCurrent(null, now));
  assert(!tokenExpiryIsCurrent("invalid", now));
  assert(!tokenExpiryIsCurrent("2026-07-29T23:59:59.999Z", now));
  assert(!tokenExpiryIsCurrent("2026-07-30T00:00:00.000Z", now));
  assert(tokenExpiryIsCurrent("2026-07-30T00:00:00.001Z", now));
  assert(!tokenExpiryIsCurrent("2026-02-30T00:00:00.001Z", now));
});

Deno.test("Mailbox ingestion and delivery readiness are independent and fail closed", () => {
  const now = new Date("2026-08-06T04:00:00.000Z");
  const base = {
    provider_type: "gmail",
    connection_status: "connected",
    reconnect_required: false,
    delivery_reconnect_required: false,
    is_enabled: true,
    ingestion_enabled: true,
    delivery_enabled: true,
    ingestion_secret_ref: "GATE_E_TEST_INGESTION",
    delivery_secret_ref: "GATE_E_TEST_DELIVERY",
    ingestion_token_expires_at: "2026-08-07T00:00:00.000Z",
    delivery_token_expires_at: "2026-08-07T00:00:00.000Z",
  };
  assert(mailboxCapabilityIsReady(base, "ingestion", now, true));
  assert(mailboxCapabilityIsReady(base, "delivery", now, true));
  assert(
    mailboxCapabilityIsReady(
      { ...base, delivery_enabled: false },
      "ingestion",
      now,
      true,
    ),
  );
  assert(
    mailboxCapabilityIsReady(
      { ...base, is_enabled: false, ingestion_enabled: false },
      "delivery",
      now,
      true,
    ),
  );
  assert(
    !mailboxCapabilityIsReady(
      { ...base, delivery_enabled: false },
      "delivery",
      now,
      true,
    ),
  );
  for (
    const changed of [
      { is_enabled: false },
      { reconnect_required: true },
      { connection_status: "reconnect_required" },
      { ingestion_secret_ref: null },
      { ingestion_token_expires_at: "2026-08-05T00:00:00.000Z" },
    ]
  ) {
    assert(
      !mailboxCapabilityIsReady(
        { ...base, ...changed },
        "ingestion",
        now,
        true,
      ),
    );
  }
  assert(!mailboxCapabilityIsReady(base, "ingestion", now, false));
  assert(
    !mailboxCapabilityIsReady(
      { ...base, delivery_secret_ref: null },
      "delivery",
      now,
      true,
    ),
  );
  assert(
    !mailboxCapabilityIsReady(
      { ...base, delivery_token_expires_at: "2026-08-05T00:00:00.000Z" },
      "delivery",
      now,
      true,
    ),
  );
  assertEquals(new GmailMailboxProvider().readiness().ready, true);
  assertEquals(new MicrosoftMailboxProvider().readiness().ready, true);
  assertEquals(new GmailDeliveryProvider().readiness().ready, true);
  assertEquals(new MicrosoftDeliveryProvider().readiness().ready, true);
  assertEquals(new DisabledDeliveryProvider("gmail").readiness().ready, false);
});

Deno.test("OAuth scope sets separate ingestion and delivery authority", () => {
  assertEquals(OAUTH_SCOPES.gmail_ingestion, [
    "https://www.googleapis.com/auth/gmail.readonly",
  ]);
  assertEquals(OAUTH_SCOPES.gmail_delivery, [
    "https://www.googleapis.com/auth/gmail.send",
  ]);
  assertEquals(OAUTH_SCOPES.microsoft_ingestion, [
    "offline_access",
    "Mail.Read",
  ]);
  assertEquals(OAUTH_SCOPES.microsoft_delivery, [
    "offline_access",
    "Mail.Send",
  ]);
});

Deno.test("OAuth authorization URLs use exact provider endpoints and scopes", () => {
  const gmail = new URL(buildOAuthAuthorizationUrl({
    configuration: {
      provider: "gmail",
      client_id: "client",
      client_secret: "not-used",
      redirect_uri: "https://example.test/callback",
    },
    state: "a".repeat(32),
    capability: "ingestion",
  }));
  assertEquals(gmail.origin, "https://accounts.google.com");
  assert(gmail.searchParams.get("scope")?.includes("gmail.readonly"));
  assert(!gmail.searchParams.get("scope")?.includes("gmail.send"));
  assertEquals(gmail.searchParams.get("include_granted_scopes"), null);
  const microsoft = new URL(buildOAuthAuthorizationUrl({
    configuration: {
      provider: "microsoft",
      client_id: "client",
      client_secret: "not-used",
      redirect_uri: "https://example.test/callback",
    },
    state: "b".repeat(32),
    capability: "delivery",
  }));
  assert(microsoft.pathname.includes("/common/oauth2/v2.0/authorize"));
  assert(microsoft.searchParams.get("scope")?.includes("Mail.Send"));
});

Deno.test("OAuth start DTO permits only fixed provider authorization origins", async () => {
  const google =
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture";
  const microsoft =
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=fixture";
  assertEquals(boundedOAuthAuthorizationUrl("gmail", google), google);
  assertEquals(
    boundedOAuthAuthorizationUrl("microsoft", microsoft),
    microsoft,
  );
  await rejects(
    () =>
      boundedOAuthAuthorizationUrl(
        "gmail",
        "https://attacker.example/oauth?redirect=accounts.google.com",
      ),
    "OAUTH_AUTHORIZATION_URL_INVALID",
  );
  await rejects(
    () => boundedOAuthAuthorizationUrl("microsoft", "javascript:alert(1)"),
    "OAUTH_AUTHORIZATION_URL_INVALID",
  );
});

Deno.test("OAuth token exchange is fixture-only and secret writer receives opaque destination", async () => {
  const fetcher: typeof fetch = () =>
    Promise.resolve(json({
      access_token: "fixture-access",
      refresh_token: "fixture-refresh",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "Mail.Read",
    }));
  const writer = new FixtureOAuthSecretWriter();
  const result = await completeOAuthCallback({
    configuration: {
      provider: "microsoft",
      client_id: "client",
      client_secret: "fixture-client-secret",
      redirect_uri: "https://example.test/callback",
    },
    code: "fixture-code",
    secret_context: {
      company_id: companyId,
      mailbox_id: mailboxId,
      provider: "microsoft",
      capability: "ingestion",
      secret_reference: "AUTOMATION_MAILBOX_TOKEN_1",
    },
    required_scopes: ["Mail.Read", "offline_access"],
    writer,
    fetcher,
    now: new Date("2026-07-30T00:00:00Z"),
  });
  assertEquals(result.secret_reference, "AUTOMATION_MAILBOX_TOKEN_1");
  assertEquals(writer.writes.length, 1);
  assertEquals(result.expires_at, "2026-07-30T01:00:00.000Z");
});

Deno.test("OAuth completion rejects missing capability scope before secret write", async () => {
  const writer = new FixtureOAuthSecretWriter();
  await rejects(
    () =>
      completeOAuthCallback({
        configuration: {
          provider: "microsoft",
          client_id: "client",
          client_secret: "fixture-client-secret",
          redirect_uri: "https://example.test/callback",
        },
        code: "fixture-code",
        secret_context: {
          company_id: companyId,
          mailbox_id: mailboxId,
          provider: "microsoft",
          capability: "delivery",
          secret_reference: "AUTOMATION_MAILBOX_TOKEN_2",
        },
        required_scopes: ["Mail.Send", "offline_access"],
        writer,
        fetcher: () =>
          Promise.resolve(json({
            access_token: "fixture-access",
            refresh_token: "fixture-refresh",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "Mail.Read offline_access",
          })),
      }),
    "OAUTH_SCOPE_INSUFFICIENT",
  );
  assertEquals(writer.writes.length, 0);
});

Deno.test("OAuth callback state is atomically claimed before token exchange", async () => {
  const service = await Deno.readTextFile(
    new URL("./automation/service.ts", import.meta.url),
  );
  const claim = service.indexOf(
    '.is("consumed_at", null).select("id").maybeSingle()',
  );
  const exchange = service.indexOf("completeOAuthCallback({", claim);
  assert(claim >= 0);
  assert(exchange > claim);
  assert(service.includes('"OAUTH_STATE_ALREADY_USED"'));
});

Deno.test("Explicit disabled OAuth secret store fails closed", async () => {
  const tokens = await exchangeOAuthCode({
    configuration: {
      provider: "gmail",
      client_id: "client",
      client_secret: "fixture-client-secret",
      redirect_uri: "https://example.test/callback",
    },
    code: "fixture-code",
    fetcher: () =>
      Promise.resolve(json({
        access_token: "fixture-access",
        expires_in: 3600,
        token_type: "Bearer",
      })),
  });
  await rejects(
    () =>
      new DisabledOAuthSecretWriter().writeTokenSet({
        company_id: companyId,
        mailbox_id: mailboxId,
        provider: "gmail",
        capability: "ingestion",
        secret_reference: "TOKEN_REF",
      }, tokens),
    "OAUTH_SECRET_WRITER_DISABLED",
  );
});

Deno.test("Fixture secret resolver returns only named test values", async () => {
  const resolver = new FixtureSecretResolver({
    FIXTURE_TOKEN: "fixture-value",
  });
  assertEquals(await resolver.resolve("FIXTURE_TOKEN"), "fixture-value");
  await rejects(() => resolver.resolve("MISSING"), "fixture secret missing");
});

Deno.test("Automation handler rejects unauthenticated requests with sanitized contract", async () => {
  const response = await handleAutomationRequest(
    new Request("https://example.test/automation/overview", {
      headers: { "X-Company-Id": auth.companyId },
    }),
    {
      authenticate: () =>
        Promise.reject(
          new AuthenticationError(),
        ),
      createService: () => ({} as AutomationService),
    },
  );
  assertEquals(response.status, 401);
  const result = await response.json();
  assertEquals(result.error.code, "AUTHENTICATION_ERROR");
  assertEquals(result.contract_version, "gate-e.1");
  assert(!JSON.stringify(result).includes("token"));
});

Deno.test("Automation mailbox PATCH preflight advertises only the shared supported methods", async () => {
  let authCalls = 0;
  let serviceCalls = 0;
  const dependencies = {
    authenticate: () => {
      authCalls += 1;
      return Promise.resolve(auth);
    },
    createService: () => {
      serviceCalls += 1;
      return {} as AutomationService;
    },
  };
  const url = `https://example.test/automation/mailboxes/${mailboxId}`;
  const preflight = await handleAutomationRequest(
    new Request(url, {
      method: "OPTIONS",
      headers: {
        Origin: "https://account-receivable-module.vercel.app",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers":
          "authorization, apikey, content-type, x-company-id",
      },
    }),
    dependencies,
  );
  assertEquals(preflight.status, 204);
  assertEquals(
    preflight.headers.get("Access-Control-Allow-Methods")?.split(",").map(
      (method) => method.trim(),
    ),
    ["POST", "GET", "OPTIONS", "PUT", "PATCH", "DELETE"],
  );
  assertEquals(preflight.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(
    preflight.headers.get("Access-Control-Allow-Headers"),
    "authorization, x-client-info, apikey, content-type, x-company-id",
  );
  assertEquals(authCalls, 0);
  assertEquals(serviceCalls, 0);

  const unsupported = await handleAutomationRequest(
    new Request(url, {
      method: "HEAD",
      headers: { "X-Company-Id": auth.companyId },
    }),
    dependencies,
  );
  assertEquals(unsupported.status, 405);
  const payload = await unsupported.json();
  assertEquals(payload, {
    success: false,
    contract_version: "gate-e.1",
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "HTTP method is not supported for this automation route.",
    },
  });
  assertEquals(authCalls, 1);
  assertEquals(serviceCalls, 1);
});

Deno.test("Automation handler exposes frozen overview envelope", async () => {
  const response = await handleAutomationRequest(
    new Request("https://example.test/automation/overview", {
      headers: { "X-Company-Id": auth.companyId },
    }),
    {
      authenticate: () => Promise.resolve(auth),
      createService: () => ({
        overview: () =>
          Promise.resolve({
            settings: automationSettingsDto(null, auth.companyId),
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
          }),
      } as unknown as AutomationService),
    },
  );
  assertEquals(response.status, 200);
  const result = await response.json();
  assertEquals(result.contract_version, "gate-e.1");
  assertEquals(result.data.settings.company_id, auth.companyId);
  assertEquals(result.data.open_exceptions, 0);
  assertEquals(result.data.settings.minimum_overall_confidence, 0.95);
  assertEquals(Object.keys(result.data).sort(), [
    "accepted_documents",
    "allocations_completed",
    "connected_mailbox_count",
    "delivery_ready",
    "document_intelligence_ready",
    "documents_processed",
    "ingestion_ready",
    "invoices_created",
    "last_failed_sync_at",
    "last_successful_sync_at",
    "open_exceptions",
    "processing_runs",
    "receipts_created",
    "reconnect_required_mailbox_count",
    "rejected_documents",
    "reminders_evaluated",
    "reminders_sent",
    "retryable_exceptions",
    "settings",
  ]);
});

Deno.test("Automation settings route serializes the Production PostgreSQL UUID", async () => {
  const client = {
    from(table: string) {
      assertEquals(table, "automation_settings");
      const query = {
        select() {
          return query;
        },
        eq(field: string, value: unknown) {
          assertEquals(field, "company_id");
          assertEquals(value, auth.companyId);
          return query;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
      };
      return query;
    },
  };
  const response = await handleAutomationRequest(
    new Request("https://example.test/automation/settings", {
      headers: { "X-Company-Id": auth.companyId },
    }),
    {
      authenticate: () => Promise.resolve(auth),
      createService: () => new AutomationService({ client: client as never }),
    },
  );
  assertEquals(response.status, 200);
  const result = await response.json();
  assertEquals(result.contract_version, "gate-e.1");
  assertEquals(result.data.company_id, auth.companyId);
  assertEquals(result.data.operating_mode, "disabled");
});

Deno.test("Automation service overview derives every tenant count and readiness field", async () => {
  const countKey = (table: string, filters: Record<string, unknown>) =>
    `${table}:${
      Object.entries(filters).map(([key, value]) => `${key}=${value}`).sort()
        .join(",")
    }`;
  const counts = new Map<string, number>([
    ["mailbox_sync_runs:", 4],
    ["automation_document_classifications:", 5],
    ["automation_document_classifications:status=accepted", 3],
    ["automation_document_classifications:status=rejected", 2],
    ["automation_commands:command_type=create_invoice,status=completed", 1],
    ["automation_commands:command_type=create_receipt,status=completed", 2],
    ["automation_allocation_decisions:status=completed", 1],
    ["invoice_reminders:", 6],
    ["invoice_reminders:status=delivered", 4],
    ["automation_exceptions:lifecycle_status=open", 2],
    ["automation_exceptions:lifecycle_status=retryable", 1],
  ]);
  let mailboxFixtures: Array<Record<string, unknown>> = [{
    id: mailboxId,
    company_id: companyId,
    provider_type: "gmail",
    connection_status: "connected",
    reconnect_required: false,
    delivery_reconnect_required: false,
    is_enabled: true,
    ingestion_enabled: true,
    delivery_enabled: false,
    ingestion_secret_ref: "FIXTURE_INGESTION_SECRET_REFERENCE",
    delivery_secret_ref: null,
    ingestion_token_expires_at: "2026-08-07T00:00:00.000Z",
    delivery_token_expires_at: null,
    last_successful_sync_at: "2026-08-06T03:00:00.000Z",
    last_failed_sync_at: null,
  }, {
    id: "10000000-0000-4000-8000-000000000004",
    company_id: companyId,
    provider_type: "microsoft",
    connection_status: "connected",
    reconnect_required: false,
    delivery_reconnect_required: false,
    is_enabled: true,
    ingestion_enabled: false,
    delivery_enabled: true,
    ingestion_secret_ref: null,
    delivery_secret_ref: "FIXTURE_DELIVERY_SECRET_REFERENCE",
    ingestion_token_expires_at: null,
    delivery_token_expires_at: "2026-08-07T00:00:00.000Z",
    last_successful_sync_at: null,
    last_failed_sync_at: "2026-08-06T02:00:00.000Z",
  }];
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let head = false;
      let selectedColumns = "";
      const query = {
        select(columns: string, options?: { head?: boolean }) {
          selectedColumns = columns;
          head = options?.head === true;
          return query;
        },
        eq(field: string, value: unknown) {
          if (field === "company_id") assertEquals(value, companyId);
          else filters[field] = value;
          return query;
        },
        not() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (value: unknown) => unknown) {
          if (head) {
            return Promise.resolve({
              data: null,
              count: counts.get(countKey(table, filters)) ?? 0,
              error: null,
            }).then(resolve);
          }
          const selected = new Set(
            selectedColumns.split(",").map((column) => column.trim()),
          );
          return Promise.resolve({
            data: table === "automation_mailboxes"
              ? mailboxFixtures.map((mailbox) =>
                Object.fromEntries(
                  Object.entries(mailbox).filter(([column]) =>
                    selected.has(column)
                  ),
                )
              )
              : [],
            error: null,
          }).then(resolve);
        },
      };
      return query;
    },
  };
  const oauthSecretStore = new FixtureOAuthSecretWriter();
  await oauthSecretStore.writeTokenSet({
    company_id: companyId,
    mailbox_id: mailboxId,
    provider: "gmail",
    capability: "ingestion",
    secret_reference: "FIXTURE_INGESTION_SECRET_REFERENCE",
  }, {
    access_token: "fixture-ingestion-access-token",
    refresh_token: "fixture-ingestion-refresh-token",
    expires_at: "2026-08-07T00:00:00.000Z",
    scope: [...OAUTH_SCOPES.gmail_ingestion],
    token_type: "Bearer",
  });
  await oauthSecretStore.writeTokenSet({
    company_id: companyId,
    mailbox_id: "10000000-0000-4000-8000-000000000004",
    provider: "microsoft",
    capability: "delivery",
    secret_reference: "FIXTURE_DELIVERY_SECRET_REFERENCE",
  }, {
    access_token: "fixture-delivery-access-token",
    refresh_token: "fixture-delivery-refresh-token",
    expires_at: "2026-08-07T00:00:00.000Z",
    scope: [...OAUTH_SCOPES.microsoft_delivery],
    token_type: "Bearer",
  });
  const service = new AutomationService({
    client: client as never,
    now: () => new Date("2026-08-06T04:00:00.000Z"),
    oauthSecretStore,
    documentProvider: new FixtureDocumentIntelligenceProvider(invoiceFixture),
  });
  const overview = await service.overview({ ...auth, companyId });
  assertEquals(overview.ingestion_ready, true);
  assertEquals(overview.delivery_ready, true);
  assertEquals(overview.document_intelligence_ready, true);
  assertEquals(overview.processing_runs, 4);
  assertEquals(overview.documents_processed, 5);
  assertEquals(overview.invoices_created, 1);
  assertEquals(overview.receipts_created, 2);
  assertEquals(overview.reminders_sent, 4);
  assertEquals(overview.retryable_exceptions, 1);
  assertEquals(
    (overview.settings as Record<string, unknown>).minimum_overall_confidence,
    0.95,
  );
  const missingOpaqueSecret = await new AutomationService({
    client: client as never,
    now: () => new Date("2026-08-06T04:00:00.000Z"),
    oauthSecretStore: new FixtureOAuthSecretWriter(),
  }).overview({ ...auth, companyId });
  assertEquals(missingOpaqueSecret.ingestion_ready, false);
  assertEquals(missingOpaqueSecret.delivery_ready, false);

  const blankOpaqueSecret = await new AutomationService({
    client: client as never,
    now: () => new Date("2026-08-06T04:00:00.000Z"),
    oauthSecretStore: {
      writeTokenSet: () => Promise.resolve(),
      deleteTokenSet: () => Promise.resolve(),
      resolveTokenSet: () =>
        Promise.resolve({
          access_token: "   ",
          refresh_token: null,
          expires_at: "2026-08-07T00:00:00.000Z",
          scope: [],
          token_type: "Bearer" as const,
        }),
    },
  }).overview({ ...auth, companyId });
  assertEquals(blankOpaqueSecret.ingestion_ready, false);
  assertEquals(blankOpaqueSecret.delivery_ready, false);

  const wrongScopeSecret = await new AutomationService({
    client: client as never,
    now: () => new Date("2026-08-06T04:00:00.000Z"),
    oauthSecretStore: {
      writeTokenSet: () => Promise.resolve(),
      deleteTokenSet: () => Promise.resolve(),
      resolveTokenSet: (secretContext) =>
        Promise.resolve({
          access_token: "fixture-wrong-capability-access-token",
          refresh_token: "fixture-wrong-capability-refresh-token",
          expires_at: "2026-08-07T00:00:00.000Z",
          scope: secretContext.capability === "ingestion"
            ? [...OAUTH_SCOPES.gmail_delivery]
            : [...OAUTH_SCOPES.microsoft_ingestion],
          token_type: "Bearer" as const,
        }),
    },
  }).overview({ ...auth, companyId });
  assertEquals(wrongScopeSecret.ingestion_ready, false);
  assertEquals(wrongScopeSecret.delivery_ready, false);

  const missingRefreshSecret = await new AutomationService({
    client: client as never,
    now: () => new Date("2026-08-06T04:00:00.000Z"),
    oauthSecretStore: {
      writeTokenSet: () => Promise.resolve(),
      deleteTokenSet: () => Promise.resolve(),
      resolveTokenSet: (secretContext) =>
        Promise.resolve({
          access_token: "fixture-nonrenewable-access-token",
          refresh_token: null,
          expires_at: "2026-08-07T00:00:00.000Z",
          scope: secretContext.capability === "ingestion"
            ? [...OAUTH_SCOPES.gmail_ingestion]
            : [...OAUTH_SCOPES.microsoft_delivery],
          token_type: "Bearer" as const,
        }),
    },
  }).overview({ ...auth, companyId });
  assertEquals(missingRefreshSecret.ingestion_ready, false);
  assertEquals(missingRefreshSecret.delivery_ready, false);

  mailboxFixtures = [];
  const noMailbox = await service.overview({ ...auth, companyId });
  assertEquals(noMailbox.ingestion_ready, false);
  assertEquals(noMailbox.delivery_ready, false);
});

Deno.test("Automation handler sanitizes database and provider internals", async () => {
  const response = await handleAutomationRequest(
    new Request("https://example.test/automation/overview", {
      headers: { "X-Company-Id": auth.companyId },
    }),
    {
      authenticate: () => Promise.resolve(auth),
      createService: () => ({
        overview: () =>
          Promise.reject(
            new Error(
              "relation private_automation_table does not exist; token=secret",
            ),
          ),
      } as unknown as AutomationService),
    },
  );
  assertEquals(response.status, 500);
  const serialized = JSON.stringify(await response.json());
  assert(serialized.includes("INTERNAL_ERROR"));
  assert(!serialized.includes("private_automation_table"));
  assert(!serialized.includes("token=secret"));
});

Deno.test("Automation document decisions use the enriched bounded service contract", async () => {
  let filters: unknown = null;
  const response = await handleAutomationRequest(
    new Request(
      "https://example.test/automation/documents?page=2&page_size=10&document_type=invoice&status=accepted",
      { headers: { "X-Company-Id": auth.companyId } },
    ),
    {
      authenticate: () => Promise.resolve(auth),
      createService: () => ({
        listDocumentDecisions: (
          _auth: AuthContext,
          page: unknown,
          receivedFilters: unknown,
        ) => {
          filters = { page, receivedFilters };
          return Promise.resolve({
            rows: [{
              id: "decision-1",
              extraction: { validation_status: "valid" },
              attachment: { original_file_name: "invoice.pdf" },
            }],
            meta: { page: 2, page_size: 10, total: 11, has_more: false },
          });
        },
      } as unknown as AutomationService),
    },
  );
  assertEquals(response.status, 200);
  const result = await response.json();
  assertEquals(result.data[0].extraction.validation_status, "valid");
  assertEquals(result.meta.total, 11);
  assertEquals(filters, {
    page: { page: 2, page_size: 10 },
    receivedFilters: { document_type: "invoice", status: "accepted" },
  });
});

Deno.test("Document decisions normalize the Production extraction embed and linked lifecycle", async () => {
  const ordered: Array<[string, string]> = [];
  const classification = {
    id: classificationId,
    company_id: auth.companyId,
    attachment_id: attachmentId,
    schema_version: 1,
    document_type: "invoice",
    status: "accepted",
    confidence: "1.0000",
    critical_confidence: "1.0000",
    provider_name: "openai",
    provider_model: "gpt-5.6-luna",
    provider_version: "responses-v1",
    trace_id: "trace-draft-document",
    created_at: now,
    extraction: [{
      id: extractionId,
      schema_version: 1,
      field_confidence: {},
      validation_status: "valid",
      validation_codes: [],
      customer_id: "266b5e9f-4b75-4433-8829-a8b590f7ad01",
      customer_resolution_method: "customer_code",
      trace_id: "trace-draft-document",
      validated_at: now,
      created_at: now,
    }],
    attachment: {
      id: attachmentId,
      message_id: "10000000-0000-4000-8000-000000000004",
      original_file_name: "controlled-draft-invoice.png",
      detected_mime_type: "image/png",
      size_bytes: 1234,
      page_count: null,
      scan_status: "unavailable",
      safety_status: "accepted",
      processing_status: "processed",
      content_purged_at: null,
    },
  };
  const exceptionId = "10000000-0000-4000-8000-000000000011";
  const client = {
    from(table: string) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        in() {
          return query;
        },
        order(field: string) {
          ordered.push([table, field]);
          if (table === "automation_exceptions" && field !== "opened_at") {
            throw new Error(`Unknown exception order column: ${field}`);
          }
          return query;
        },
        range() {
          return Promise.resolve({
            data: [classification],
            count: 1,
            error: null,
          });
        },
        limit() {
          return Promise.resolve({
            data: table === "automation_exceptions"
              ? [{ id: exceptionId, attachment_id: attachmentId }]
              : table === "automation_commands"
              ? [{
                id: "10000000-0000-4000-8000-000000000012",
                extraction_id: extractionId,
                command_type: "create_invoice",
                status: "completed",
                resulting_invoice_id: "10000000-0000-4000-8000-000000000013",
                resulting_receipt_id: null,
                failure_code: null,
              }]
              : [],
            error: null,
          });
        },
      };
      return query;
    },
  };
  const result = await new AutomationService({ client: client as never })
    .listDocumentDecisions(auth, { page: 1, page_size: 15 }, {});
  assertEquals(result.meta, {
    page: 1,
    page_size: 15,
    total: 1,
    has_more: false,
  });
  assertEquals(result.rows[0].linked_exception_ids, [exceptionId]);
  assertEquals(result.rows[0].extraction, {
    id: extractionId,
    schema_version: 1,
    document_type: "invoice",
    validation_status: "valid",
    validation_codes: [],
    field_confidence: {},
    customer_id: "266b5e9f-4b75-4433-8829-a8b590f7ad01",
    customer_resolution_method: "customer_code",
    trace_id: "trace-draft-document",
    validated_at: new Date(now).toISOString(),
    created_at: new Date(now).toISOString(),
  });
  assertEquals(result.rows[0].command, {
    id: "10000000-0000-4000-8000-000000000012",
    command_type: "create_invoice",
    status: "completed",
    resulting_invoice_id: "10000000-0000-4000-8000-000000000013",
    resulting_receipt_id: null,
    failure_code: null,
  });
  assert(
    ordered.some(([table, field]) =>
      table === "automation_exceptions" && field === "opened_at"
    ),
  );
  assert(
    !ordered.some(([table, field]) =>
      table === "automation_exceptions" && field === "created_at"
    ),
  );
});

Deno.test("Scheduled Draft recovery commands a persisted valid extraction exactly once", async () => {
  const actorId = "10000000-0000-4000-8000-000000000012";
  const commandId = "10000000-0000-4000-8000-000000000013";
  const greaterThanFilters: Array<[string, unknown]> = [];
  const notEqualFilters: Array<[string, unknown]> = [];
  const tables: Record<string, Array<Record<string, unknown>>> = {
    automation_settings: [{
      company_id: auth.companyId,
      automation_actor_user_id: actorId,
      operating_mode: "draft_only",
      mailbox_sync_enabled: false,
      document_intelligence_enabled: true,
      invoice_automation_enabled: true,
      receipt_automation_enabled: true,
      auto_allocation_enabled: false,
      reminder_evaluation_enabled: false,
      reminder_delivery_enabled: false,
      reminder_timezone: "UTC",
      created_at: "2026-08-06T02:00:00.000Z",
    }],
    user_roles: [{
      company_id: auth.companyId,
      user_id: actorId,
      role: "Finance Manager",
    }],
    automation_mailboxes: [],
    automation_source_attachments: [],
    automation_audit_events: [{
      created_at: "2026-08-06T03:00:00.000Z",
    }],
    automation_extraction_results: [{
      id: extractionId,
      extracted_fields: invoiceFixture.extraction,
      classification: { document_type: "invoice" },
      commands: [],
    }],
  };
  const client = {
    from(table: string) {
      const query = {
        select() {
          return query;
        },
        neq(field: string, value: unknown) {
          notEqualFilters.push([field, value]);
          return query;
        },
        not() {
          return query;
        },
        in() {
          return query;
        },
        eq() {
          return query;
        },
        is() {
          return query;
        },
        gt(field: string, value: unknown) {
          greaterThanFilters.push([field, value]);
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        maybeSingle() {
          return Promise.resolve({
            data: (tables[table] ?? [])[0] ?? null,
            error: null,
          });
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({
            data: tables[table] ?? [],
            error: null,
          }).then(resolve);
        },
      };
      return query;
    },
  };
  const service = new AutomationService({ client: client as never });
  const internal = service as unknown as {
    purgeExpiredAttachmentContent: () => Promise<{
      purged: number;
      failures: number;
    }>;
    executeCommand: (
      auth: AuthContext,
      extractionId: string,
    ) => Promise<Record<string, unknown>>;
    runScheduledCycleWithLease: () => Promise<Record<string, unknown>>;
  };
  internal.purgeExpiredAttachmentContent = () =>
    Promise.resolve({ purged: 0, failures: 0 });
  let executedExtractionId: string | null = null;
  internal.executeCommand = (_auth, receivedExtractionId) => {
    executedExtractionId = receivedExtractionId;
    return Promise.resolve({
      id: commandId,
      command_type: "create_invoice",
      status: "completed",
    });
  };
  const result = await internal.runScheduledCycleWithLease();
  assertEquals(executedExtractionId, extractionId);
  assertEquals(result.attachments_processed, 0);
  assertEquals(result.commands_processed, 1);
  assertEquals(result.failures, 0);
  assert(
    notEqualFilters.some(([field, value]) =>
      field === "safe_metadata->>operating_mode" && value === "draft_only"
    ),
  );
  assertEquals(greaterThanFilters, [[
    "created_at",
    "2026-08-06T03:00:00.000Z",
  ]]);
});

Deno.test("Scheduled command recovery fails closed without a proven mode boundary", async () => {
  const actorId = "10000000-0000-4000-8000-000000000012";
  const tables: Record<string, Array<Record<string, unknown>>> = {
    automation_settings: [{
      company_id: auth.companyId,
      automation_actor_user_id: actorId,
      operating_mode: "draft_only",
      mailbox_sync_enabled: false,
      document_intelligence_enabled: true,
      invoice_automation_enabled: true,
      receipt_automation_enabled: true,
      auto_allocation_enabled: false,
      reminder_evaluation_enabled: false,
      reminder_delivery_enabled: false,
      reminder_timezone: "UTC",
      created_at: "2026-08-06T02:00:00.000Z",
    }],
    user_roles: [{
      company_id: auth.companyId,
      user_id: actorId,
      role: "Finance Manager",
    }],
    automation_mailboxes: [],
    automation_source_attachments: [],
    automation_audit_events: [],
    automation_extraction_results: [{
      id: extractionId,
      extracted_fields: invoiceFixture.extraction,
      classification: { document_type: "invoice" },
      commands: [],
    }],
  };
  const selectedTables: string[] = [];
  const client = {
    from(table: string) {
      const query = {
        select() {
          selectedTables.push(table);
          return query;
        },
        neq() {
          return query;
        },
        not() {
          return query;
        },
        in() {
          return query;
        },
        eq() {
          return query;
        },
        is() {
          return query;
        },
        gt() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        maybeSingle() {
          return Promise.resolve({
            data: (tables[table] ?? [])[0] ?? null,
            error: null,
          });
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({
            data: tables[table] ?? [],
            error: null,
          }).then(resolve);
        },
      };
      return query;
    },
  };
  const service = new AutomationService({ client: client as never });
  const internal = service as unknown as {
    purgeExpiredAttachmentContent: () => Promise<{
      purged: number;
      failures: number;
    }>;
    executeCommand: () => Promise<Record<string, unknown>>;
    runScheduledCycleWithLease: () => Promise<Record<string, unknown>>;
  };
  internal.purgeExpiredAttachmentContent = () =>
    Promise.resolve({ purged: 0, failures: 0 });
  let executed = false;
  internal.executeCommand = () => {
    executed = true;
    return Promise.resolve({});
  };
  const result = await internal.runScheduledCycleWithLease();
  assertEquals(executed, false);
  assertEquals(result.commands_processed, 0);
  assertEquals(result.failures, 1);
  assertEquals(
    selectedTables.filter((table) => table === "automation_extraction_results")
      .length,
    0,
  );
});

Deno.test("Duplicate mailbox OAuth reference returns a tenant-safe 409", async () => {
  const client = {
    from(table: string) {
      assertEquals(table, "automation_mailboxes");
      const query = {
        insert() {
          return query;
        },
        select() {
          return query;
        },
        single() {
          return Promise.resolve({
            data: null,
            error: {
              code: "P0001",
              message:
                "OAUTH_SECRET_REFERENCE_CONFLICT: reference is already assigned",
              details: "private cross-tenant database detail",
            },
          });
        },
      };
      return query;
    },
  };
  const response = await handleAutomationRequest(
    new Request("https://example.test/automation/mailboxes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Company-Id": auth.companyId,
      },
      body: JSON.stringify({
        provider_type: "gmail",
        mailbox_address: "controlled-mailbox@example.test",
        ingestion_secret_ref: "AR_MAILBOX_INGESTION_1",
        delivery_secret_ref: null,
      }),
    }),
    {
      authenticate: () => Promise.resolve(auth),
      createService: () => new AutomationService({ client: client as never }),
    },
  );
  assertEquals(response.status, 409);
  const payload = await response.json();
  assertEquals(payload.contract_version, "gate-e.1");
  assertEquals(payload.error.code, "OAUTH_SECRET_REFERENCE_CONFLICT");
  assertEquals(
    payload.error.message,
    "This secret reference is already in use. Choose another reference.",
  );
  const serialized = JSON.stringify(payload);
  assert(!serialized.includes("reference is already assigned"));
  assert(!serialized.includes("cross-tenant"));
  assert(!serialized.includes("company_id"));
  assert(!serialized.includes("mailbox_id"));
});

Deno.test("Rejected extraction cannot reach an Invoice or Receipt financial service", async () => {
  const queried: string[] = [];
  const client = {
    from(table: string) {
      queried.push(table);
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        maybeSingle() {
          return Promise.resolve({
            data: table === "automation_settings"
              ? {
                ...automationSettingsDto(null, companyId),
                operating_mode: "observe_only",
                invoice_automation_enabled: true,
                receipt_automation_enabled: true,
              }
              : {
                id: "00000000-0000-0000-0000-000000000099",
                validation_status: "invalid",
              },
            error: null,
          });
        },
      };
      return query;
    },
  };
  const service = new AutomationService({ client: client as never });
  await rejects(
    () =>
      service.executeCommand(
        auth,
        "00000000-0000-0000-0000-000000000099",
      ),
    "EXTRACTION_NOT_VALID",
  );
  assert(!queried.includes("invoices"));
  assert(!queried.includes("receipts"));
});

Deno.test("Automation collection filters reject unsupported enum values", async () => {
  const response = await handleAutomationRequest(
    new Request(
      "https://example.test/automation/exceptions?lifecycle_status=deleted",
      { headers: { "X-Company-Id": auth.companyId } },
    ),
    {
      authenticate: () => Promise.resolve(auth),
      createService: () => ({} as AutomationService),
    },
  );
  assertEquals(response.status, 400);
  const result = await response.json();
  assertEquals(result.error.code, "VALIDATION_ERROR");
  assertEquals(result.contract_version, "gate-e.1");
});

Deno.test("Automation reminder and attempt routes pass exact server-side identity filters", async () => {
  const invoiceId = "00000000-0000-0000-0000-000000000030";
  const reminderId = "00000000-0000-0000-0000-000000000031";
  const captured: unknown[] = [];
  const dependencies = {
    authenticate: () => Promise.resolve(auth),
    createService: () => ({
      listTable: (
        _auth: AuthContext,
        table: string,
        page: unknown,
        filters: unknown,
      ) => {
        captured.push({ table, page, filters });
        return Promise.resolve({
          rows: [],
          meta: { page: 1, page_size: 25, total: 0, has_more: false },
        });
      },
    } as unknown as AutomationService),
  };
  const reminderResponse = await handleAutomationRequest(
    new Request(
      `https://example.test/automation/reminders?invoice_id=${invoiceId}`,
      { headers: { "X-Company-Id": auth.companyId } },
    ),
    dependencies,
  );
  const attemptResponse = await handleAutomationRequest(
    new Request(
      `https://example.test/automation/reminder-attempts?reminder_id=${reminderId}`,
      { headers: { "X-Company-Id": auth.companyId } },
    ),
    dependencies,
  );
  assertEquals(reminderResponse.status, 200);
  assertEquals(attemptResponse.status, 200);
  assertEquals(captured, [
    {
      table: "invoice_reminders",
      page: { page: 1, page_size: 25 },
      filters: { invoice_id: invoiceId },
    },
    {
      table: "reminder_delivery_attempts",
      page: { page: 1, page_size: 25 },
      filters: { reminder_id: reminderId },
    },
  ]);
});

Deno.test("Automation audit route validates entity and actor filters", async () => {
  let captured: unknown = null;
  const entityId = "00000000-0000-0000-0000-000000000032";
  const response = await handleAutomationRequest(
    new Request(
      `https://example.test/automation/audit?entity_type=invoice&entity_id=${entityId}&actor_type=system`,
      { headers: { "X-Company-Id": auth.companyId } },
    ),
    {
      authenticate: () => Promise.resolve(auth),
      createService: () => ({
        listTable: (
          _auth: AuthContext,
          table: string,
          _page: unknown,
          filters: unknown,
        ) => {
          captured = { table, filters };
          return Promise.resolve({
            rows: [],
            meta: { page: 1, page_size: 25, total: 0, has_more: false },
          });
        },
      } as unknown as AutomationService),
    },
  );
  assertEquals(response.status, 200);
  assertEquals(captured, {
    table: "automation_audit_events",
    filters: {
      entity_type: "invoice",
      entity_id: entityId,
      actor_type: "system",
    },
  });
});

Deno.test("Gate E role matrix keeps System Admin configuration-only", async () => {
  const systemAdmin: AuthContext = {
    ...auth,
    roles: ["System Admin"],
    highestRole: "System Admin",
  };
  const service = new AutomationService({ client: {} as never });
  await rejects(() => service.overview(systemAdmin), "Authorization");
  await rejects(
    () =>
      service.listTable(
        systemAdmin,
        "automation_audit_events",
        { page: 1, page_size: 25 },
      ),
    "Authorization",
  );
});

Deno.test("Every Gate E mutation route returns the frozen success envelope", async () => {
  const id = "00000000-0000-4000-8000-000000000040";
  const marker = (operation: string) => ({ operation });
  const service = {
    updateSettings: () => Promise.resolve(marker("settings_update")),
    createSalesRepresentative: () =>
      Promise.resolve(marker("representative_create")),
    updateSalesRepresentative: () =>
      Promise.resolve(marker("representative_update")),
    assignSalesRepresentative: () => Promise.resolve(marker("assignment")),
    createMailbox: () => Promise.resolve(marker("mailbox_create")),
    updateMailbox: () => Promise.resolve(marker("mailbox_update")),
    beginOAuth: () => Promise.resolve(marker("oauth_start")),
    disconnectMailboxOAuth: () => Promise.resolve(marker("oauth_disconnect")),
    enableMailboxDelivery: () => Promise.resolve(marker("delivery_enable")),
    disableMailboxDelivery: () => Promise.resolve(marker("delivery_disable")),
    reconnectMailboxDelivery: () =>
      Promise.resolve(marker("delivery_reconnect")),
    completeOAuth: () => Promise.resolve(marker("oauth_callback")),
    syncMailbox: () => Promise.resolve(marker("mailbox_sync")),
    processAttachment: () => Promise.resolve(marker("document_process")),
    executeCommand: () => Promise.resolve(marker("command_execute")),
    allocateCommand: () => Promise.resolve(marker("command_allocate")),
    retryException: () => Promise.resolve(marker("exception_retry")),
    closeException: (
      _auth: AuthContext,
      _id: string,
      status: "resolved" | "dismissed",
    ) => Promise.resolve(marker(`exception_${status}`)),
    evaluateReminders: () => Promise.resolve(marker("reminder_evaluate")),
    deliverReminder: () => Promise.resolve(marker("reminder_deliver")),
  } as unknown as AutomationService;
  const cases = [
    ["PATCH", "/settings", {}, "settings_update", 200],
    ["POST", "/sales-representatives", {}, "representative_create", 201],
    ["PATCH", `/sales-representatives/${id}`, {}, "representative_update", 200],
    [
      "POST",
      `/customers/${id}/sales-representative/assign`,
      {},
      "assignment",
      200,
    ],
    ["POST", "/mailboxes", {}, "mailbox_create", 201],
    ["PATCH", `/mailboxes/${id}`, {}, "mailbox_update", 200],
    [
      "POST",
      `/mailboxes/${id}/oauth/start`,
      { capability: "ingestion" },
      "oauth_start",
      200,
    ],
    [
      "GET",
      `/oauth/gmail/callback?code=fixture&state=${"a".repeat(64)}`,
      undefined,
      "oauth_callback",
      200,
    ],
    [
      "POST",
      `/mailboxes/${id}/oauth/disconnect`,
      { capability: "ingestion" },
      "oauth_disconnect",
      200,
    ],
    ["POST", `/mailboxes/${id}/delivery/enable`, {}, "delivery_enable", 200],
    [
      "POST",
      `/mailboxes/${id}/delivery/disable`,
      {},
      "delivery_disable",
      200,
    ],
    [
      "POST",
      `/mailboxes/${id}/delivery/reconnect`,
      {},
      "delivery_reconnect",
      200,
    ],
    ["POST", `/mailboxes/${id}/sync`, undefined, "mailbox_sync", 200],
    ["POST", `/documents/${id}/process`, undefined, "document_process", 200],
    ["POST", `/extractions/${id}/command`, undefined, "command_execute", 200],
    ["POST", `/commands/${id}/allocate`, {}, "command_allocate", 200],
    ["POST", `/exceptions/${id}/retry`, undefined, "exception_retry", 200],
    [
      "POST",
      `/exceptions/${id}/resolve`,
      { resolution_note: "Resolved through the governed path." },
      "exception_resolved",
      200,
    ],
    [
      "POST",
      `/exceptions/${id}/dismiss`,
      { resolution_note: "Dismissed with an auditable reason." },
      "exception_dismissed",
      200,
    ],
    [
      "POST",
      "/reminders/evaluate",
      { evaluation_date: "2026-08-06" },
      "reminder_evaluate",
      200,
    ],
    [
      "POST",
      `/reminders/${id}/deliver`,
      { mailbox_id: id },
      "reminder_deliver",
      200,
    ],
  ] as const;

  for (const [method, path, requestBody, operation, expectedStatus] of cases) {
    const response = await handleAutomationRequest(
      new Request(`https://example.test/automation${path}`, {
        method,
        headers: {
          "X-Company-Id": auth.companyId,
          ...(requestBody === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        body: requestBody === undefined
          ? undefined
          : JSON.stringify(requestBody),
      }),
      {
        authenticate: () => Promise.resolve(auth),
        createService: () => service,
      },
    );
    assertEquals(response.status, expectedStatus, `${method} ${path}`);
    const payload = await response.json();
    assertEquals(payload, {
      success: true,
      data: { operation },
      contract_version: "gate-e.1",
    }, `${method} ${path}`);
  }
});

Deno.test("Automation worker route uses only the dedicated worker boundary", async () => {
  let userAuthCalled = false;
  const response = await handleAutomationRequest(
    new Request("https://example.test/automation/worker/run", {
      method: "POST",
      headers: { [AUTOMATION_WORKER_SECRET_HEADER]: "fixture-worker" },
    }),
    {
      authenticate: () => {
        userAuthCalled = true;
        return Promise.resolve(auth);
      },
      authenticateWorker: () => undefined,
      createService: () => ({
        runScheduledCycle: () =>
          Promise.resolve({ companies_considered: 0, failures: 0 }),
      } as unknown as AutomationService),
    },
  );
  assertEquals(response.status, 200);
  assert(!userAuthCalled);
  const result = await response.json();
  assertEquals(result.data.companies_considered, 0);
});

Deno.test("Automation allocation route derives authority from the stored command only", async () => {
  let captured: unknown = null;
  const commandId = "00000000-0000-0000-0000-000000000020";
  const response = await handleAutomationRequest(
    new Request(
      `https://example.test/automation/commands/${commandId}/allocate`,
      {
        method: "POST",
        headers: {
          "X-Company-Id": auth.companyId,
          "content-type": "application/json",
        },
        body: "{}",
      },
    ),
    {
      authenticate: () => Promise.resolve(auth),
      createService: () => ({
        allocateCommand: (_auth: AuthContext, id: string) => {
          captured = { id };
          return Promise.resolve({ allocated: true });
        },
      } as unknown as AutomationService),
    },
  );
  assertEquals(response.status, 200);
  assertEquals(captured, { id: commandId });

  let forgedServiceCalled = false;
  const forged = await handleAutomationRequest(
    new Request(
      `https://example.test/automation/commands/${commandId}/allocate`,
      {
        method: "POST",
        headers: {
          "X-Company-Id": auth.companyId,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          receipt_id: "00000000-0000-0000-0000-000000000021",
          allocations: [],
        }),
      },
    ),
    {
      authenticate: () => Promise.resolve(auth),
      createService: () => ({
        allocateCommand: () => {
          forgedServiceCalled = true;
          return Promise.resolve({ allocated: true });
        },
      } as unknown as AutomationService),
    },
  );
  assertEquals(forged.status, 400);
  assert(!forgedServiceCalled);
});

Deno.test("Automatic allocation planner accepts only exact authoritative evidence", () => {
  const exact = buildAutomaticAllocationPlan({
    receipt_unallocated: "100.00",
    invoice_references: ["INV-001"],
    payment_reference: "PAY-1",
    invoices: [{ id: "invoice-1", invoice_no: "INV-001", outstanding: "100" }],
  });
  assert(exact.ok);
  if (exact.ok) {
    assertEquals(exact.evidence_type, "exact_invoice_reference");
    assertEquals(exact.allocations[0].amount, "100.00");
  }

  const external = buildAutomaticAllocationPlan({
    receipt_unallocated: "100.00",
    invoice_references: ["SUPPLIER-INV-123"],
    payment_reference: "PAYMENT-METADATA-001",
    invoices: [{
      id: "invoice-1",
      invoice_no: "INV-202608-00001",
      reference_no: "SUPPLIER-INV-123",
      matched_reference: "SUPPLIER-INV-123",
      outstanding: "100.00",
    }],
  });
  assert(external.ok);
  if (external.ok) {
    assertEquals(external.evidence.invoice_references, ["SUPPLIER-INV-123"]);
    assertEquals(external.allocations[0].invoice_id, "invoice-1");
  }

  const partial = buildAutomaticAllocationPlan({
    receipt_unallocated: "40.10",
    invoice_references: ["INV-001"],
    invoices: [{
      id: "invoice-1",
      invoice_no: "INV-001",
      outstanding: "100.00",
    }],
  });
  assert(partial.ok);
  if (partial.ok) {
    assertEquals(partial.evidence_type, "explicit_partial_reference");
    assertEquals(partial.allocations[0].amount, "40.10");
  }

  const multi = buildAutomaticAllocationPlan({
    receipt_unallocated: "100.00",
    invoice_references: ["INV-001", "INV-002"],
    invoices: [
      { id: "invoice-1", invoice_no: "INV-001", outstanding: "60.00" },
      { id: "invoice-2", invoice_no: "INV-002", outstanding: "40.00" },
    ],
  });
  assert(multi.ok);
  if (multi.ok) {
    assertEquals(multi.evidence_type, "explicit_multi_invoice_references");
    assertEquals(
      multi.allocations.map((row) => row.amount),
      ["60.00", "40.00"],
    );
  }
});

Deno.test("Automatic allocation planner rejects ambiguous and mismatched evidence", () => {
  assertEquals(
    buildAutomaticAllocationPlan({
      receipt_unallocated: "100.00",
      invoice_references: [],
      invoices: [
        { id: "1", invoice_no: "INV-1", outstanding: "100.00" },
        { id: "2", invoice_no: "INV-2", outstanding: "100.00" },
      ],
    }),
    { ok: false, error_code: "EXACT_AMOUNT_NOT_UNAMBIGUOUS" },
  );
  assertEquals(
    buildAutomaticAllocationPlan({
      receipt_unallocated: "101.00",
      invoice_references: ["INV-1", "INV-2"],
      invoices: [
        { id: "1", invoice_no: "INV-1", outstanding: "60.00" },
        { id: "2", invoice_no: "INV-2", outstanding: "40.00" },
      ],
    }),
    { ok: false, error_code: "MULTI_REFERENCE_AMOUNT_MISMATCH" },
  );
  assertEquals(
    buildAutomaticAllocationPlan({
      receipt_unallocated: "101.00",
      invoice_references: ["INV-1"],
      invoices: [{ id: "1", invoice_no: "INV-1", outstanding: "100.00" }],
    }),
    { ok: false, error_code: "RECEIPT_EXCEEDS_REFERENCED_INVOICE" },
  );
  assertEquals(
    buildAutomaticAllocationPlan({
      receipt_unallocated: "100.00",
      invoice_references: ["INV-X"],
      invoices: [{ id: "1", invoice_no: "INV-1", outstanding: "100.00" }],
    }),
    { ok: false, error_code: "INVOICE_REFERENCE_NOT_EXACT" },
  );
});

Deno.test("Receipt references resolve uniquely through internal or external Invoice identifiers", () => {
  const boundary = {
    company_id: auth.companyId,
    customer_id: customerId,
    currency: "MYR",
  };
  const invoice = {
    id: "10000000-0000-4000-8000-000000000041",
    company_id: auth.companyId,
    customer_id: customerId,
    currency: "MYR",
    status: "Open",
    outstanding: "100.00",
    invoice_no: "INV-202608-00001",
    reference_no: "SUPPLIER-INV-123",
  };
  for (const reference of [invoice.invoice_no, invoice.reference_no]) {
    const result = resolveReceiptInvoiceReferenceAuthority(
      [reference],
      [invoice],
      boundary,
    );
    assert(result.ok);
    assertEquals(result.status, "corroborated");
    assertEquals(result.invoices[0].id, invoice.id);
    assertEquals(result.invoices[0].matched_reference, reference);
  }
  assertEquals(
    resolveReceiptInvoiceReferenceAuthority([], [], boundary),
    { ok: true, status: "not_required", invoices: [] },
  );
});

Deno.test("Receipt reference resolution fails closed for missing, ambiguous, duplicate-target, and out-of-bound evidence", () => {
  const boundary = {
    company_id: auth.companyId,
    customer_id: customerId,
    currency: "MYR",
  };
  const invoice = {
    id: "10000000-0000-4000-8000-000000000042",
    company_id: auth.companyId,
    customer_id: customerId,
    currency: "MYR",
    status: "Open",
    outstanding: "100.00",
    invoice_no: "INV-202608-00002",
    reference_no: "SUPPLIER-DUPLICATE",
  };
  const error = (
    result: ReturnType<typeof resolveReceiptInvoiceReferenceAuthority>,
  ) => {
    assert(!result.ok);
    assertEquals(result.status, "unverified");
    assertEquals(result.unverified_fields, ["invoice_reference"]);
    return result.error_code;
  };
  assertEquals(
    error(resolveReceiptInvoiceReferenceAuthority(
      ["GATEE-INV-DRAFT-20260810-001"],
      [{ ...invoice, reference_no: "GATE-INV-DRAFT-20260810-001" }],
      boundary,
    )),
    "INVOICE_REFERENCE_NOT_FOUND",
  );
  assertEquals(
    error(resolveReceiptInvoiceReferenceAuthority(
      ["SUPPLIER-DUPLICATE"],
      [invoice, { ...invoice, id: "10000000-0000-4000-8000-000000000043" }],
      boundary,
    )),
    "INVOICE_REFERENCE_AMBIGUOUS",
  );
  assertEquals(
    error(resolveReceiptInvoiceReferenceAuthority(
      [invoice.invoice_no, invoice.reference_no],
      [invoice],
      boundary,
    )),
    "INVOICE_REFERENCE_DUPLICATE_TARGET",
  );
  for (
    const candidate of [
      { ...invoice, company_id: "20000000-0000-4000-8000-000000000001" },
      { ...invoice, customer_id: "20000000-0000-4000-8000-000000000002" },
      { ...invoice, currency: "SGD" },
      { ...invoice, status: "Draft" },
      { ...invoice, outstanding: "0.00" },
    ]
  ) {
    assertEquals(
      error(resolveReceiptInvoiceReferenceAuthority(
        [invoice.reference_no],
        [candidate],
        boundary,
      )),
      "INVOICE_REFERENCE_NOT_FOUND",
    );
  }
});

Deno.test("Optional external references remain metadata while system numbers remain authoritative", async () => {
  const documentResult = validateDocumentResult({
    classification: {
      schema_version: 1,
      document_type: "invoice",
      confidence: 1,
      critical_field_confidence: 1,
      provider: "fixture",
      model: "fixture-v1",
      provider_version: "1",
      trace_id: "trace-critical-identifier",
    },
    extraction: {
      schema_version: 1,
      document_type: "invoice",
      customer: { customer_code: "CUST-00007" },
      invoice_date: "2026-08-10",
      due_date: "2026-08-12",
      currency: "MYR",
      reference_no: "GATE-INV-DRAFT-20260810-001",
      subtotal: "100.00",
      tax_total: "0.00",
      total: "100.00",
      lines: [{
        description: "Controlled service",
        quantity: "1",
        unit_price: "100.00",
        line_total: "100.00",
      }],
    },
    field_confidence: {},
  });
  assertEquals(
    documentResult.extraction?.reference_no,
    "GATE-INV-DRAFT-20260810-001",
  );
  const automation = await Deno.readTextFile(
    new URL("./automation/service.ts", import.meta.url),
  );
  const commandStart = automation.indexOf("async executeCommand(");
  const allocationStart = automation.indexOf(
    "private async proposeAndAllocateReceipt(",
    commandStart,
  );
  const commandCreation = automation.slice(commandStart, allocationStart);
  assert(commandStart >= 0 && allocationStart > commandStart);
  assert(!commandCreation.includes("critical_identifier_unverified"));
  assert(commandCreation.includes("reference_no: payload.reference_no"));
  assert(
    commandCreation.includes('postAtomically: mode === "straight_through"'),
  );

  const invoiceService = await Deno.readTextFile(
    new URL("./invoices/service.ts", import.meta.url),
  );
  const receiptService = await Deno.readTextFile(
    new URL("./receipts/service.ts", import.meta.url),
  );
  assert(invoiceService.includes("const invoiceNo = await getNextSequence("));
  assert(invoiceService.includes("invoice_no: invoiceNo"));
  assert(receiptService.includes("const receiptNo = await getNextSequence("));
  assert(receiptService.includes("receipt_no: receiptNo"));
});

Deno.test("Provider confidence cannot bypass Receipt matching authority", () => {
  const result = validateDocumentResult({
    classification: {
      schema_version: 1,
      document_type: "receipt",
      confidence: 1,
      critical_field_confidence: 1,
      provider: "fixture",
      model: "fixture-v1",
      provider_version: "1",
      trace_id: "trace-receipt-authority",
    },
    extraction: {
      schema_version: 1,
      document_type: "receipt",
      customer: { customer_code: "CUST-00007" },
      receipt_date: "2026-08-10",
      currency: "MYR",
      amount: "100.00",
      payment_method: "TT",
      reference_no: "GATEE-RCPT-DRAFT-20260810-001",
      invoice_references: ["GATE-INV-DRAFT-20260810-001"],
    },
    field_confidence: {},
  });
  assert(result.extraction?.document_type === "receipt");
  assertEquals(result.extraction.reference_no, "GATEE-RCPT-DRAFT-20260810-001");
  const resolution = resolveReceiptInvoiceReferenceAuthority(
    result.extraction.invoice_references,
    [{
      id: "10000000-0000-4000-8000-000000000044",
      company_id: auth.companyId,
      customer_id: customerId,
      currency: "MYR",
      status: "Open",
      outstanding: "100.00",
      invoice_no: "INV-202608-00001",
      reference_no: "GATEE-INV-DRAFT-20260810-001",
    }],
    { company_id: auth.companyId, customer_id: customerId, currency: "MYR" },
  );
  assert(!resolution.ok);
  assertEquals(resolution.error_code, "INVOICE_REFERENCE_NOT_FOUND");
});

Deno.test("Exact external-reference conflicts remain company/customer bound and fail closed", async () => {
  let count = 1;
  const filters: Array<[string, unknown]> = [];
  const client = {
    from(table: string) {
      assertEquals(table, "invoices");
      const query = {
        select(_columns: string, options: Record<string, unknown>) {
          assertEquals(options, { count: "exact", head: true });
          return query;
        },
        eq(field: string, value: unknown) {
          filters.push([field, value]);
          return query;
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ count, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const service = new AutomationService({ client: client as never });
  const internal = service as unknown as {
    assertNoFinancialIdentifierConflict: (
      auth: AuthContext,
      extraction: Record<string, unknown>,
      customerId: string,
    ) => Promise<void>;
  };
  const extraction = {
    schema_version: 1,
    document_type: "invoice",
    customer: { customer_code: "CUST-00007" },
    invoice_date: "2026-08-10",
    due_date: "2026-08-12",
    currency: "MYR",
    reference_no: "SUPPLIER-REF-001",
    subtotal: "100.00",
    tax_total: "0.00",
    total: "100.00",
    lines: [],
  };
  await rejects(
    () =>
      internal.assertNoFinancialIdentifierConflict(
        auth,
        extraction,
        customerId,
      ),
    "INVOICE_CONFLICT",
  );
  assertEquals(filters, [
    ["company_id", auth.companyId],
    ["customer_id", customerId],
    ["reference_no", "SUPPLIER-REF-001"],
  ]);
  count = 0;
  await internal.assertNoFinancialIdentifierConflict(
    auth,
    extraction,
    customerId,
  );
});

Deno.test("Receipt allocation resolves a unique external Invoice reference inside the financial boundary", async () => {
  const receiptId = "10000000-0000-4000-8000-000000000021";
  const commandId = "10000000-0000-4000-8000-000000000022";
  const invoiceId = "10000000-0000-4000-8000-000000000023";
  const filters: Array<[string, string, unknown]> = [];
  const inFilters: Array<[string, string, unknown]> = [];
  const gtFilters: Array<[string, string, unknown]> = [];
  const client = {
    from(table: string) {
      let referenceField = "";
      const query = {
        select() {
          return query;
        },
        eq(field: string, value: unknown) {
          filters.push([table, field, value]);
          return query;
        },
        in(field: string, value: unknown) {
          inFilters.push([table, field, value]);
          if (field === "invoice_no" || field === "reference_no") {
            referenceField = field;
          }
          return query;
        },
        gt(field: string, value: unknown) {
          gtFilters.push([table, field, value]);
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        maybeSingle() {
          assertEquals(table, "receipts");
          return Promise.resolve({
            data: {
              id: receiptId,
              customer_id: customerId,
              currency: "MYR",
              status: "Posted",
              unallocated_amount: "100.00",
            },
            error: null,
          });
        },
        then(resolve: (value: unknown) => unknown) {
          assertEquals(table, "invoices");
          return Promise.resolve({
            data: referenceField === "reference_no"
              ? [{
                id: invoiceId,
                company_id: auth.companyId,
                invoice_no: "INV-202608-00001",
                reference_no: "SUPPLIER-INV-123",
                customer_id: customerId,
                currency: "MYR",
                status: "Open",
                outstanding: "100.00",
              }]
              : [],
            error: null,
          }).then(resolve);
        },
      };
      return query;
    },
  };
  const service = new AutomationService({ client: client as never });
  const persistedInputs: Array<Record<string, unknown>> = [];
  const internal = service as unknown as {
    proposeAndAllocateReceipt: (
      auth: AuthContext,
      command: Record<string, unknown>,
      extraction: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | null>;
    persistAutomaticAllocation: (
      auth: AuthContext,
      commandId: string,
      input: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
  };
  internal.persistAutomaticAllocation = (_auth, receivedCommandId, input) => {
    assertEquals(receivedCommandId, commandId);
    persistedInputs.push(input);
    return Promise.resolve({ id: "10000000-0000-4000-8000-000000000024" });
  };
  const command = {
    id: commandId,
    status: "completed",
    command_type: "create_receipt",
    resulting_receipt_id: receiptId,
    mailbox_id: mailboxId,
    message_id: "10000000-0000-4000-8000-000000000025",
    attachment_id: attachmentId,
  };
  const result = await internal.proposeAndAllocateReceipt(auth, command, {
    schema_version: 1,
    document_type: "receipt",
    customer: { customer_code: "CUST-00007" },
    receipt_date: "2026-08-10",
    currency: "MYR",
    amount: "100.00",
    payment_method: "TT",
    reference_no: "PAYMENT-METADATA-001",
    invoice_references: ["SUPPLIER-INV-123"],
  });
  assert(result);
  assertEquals(persistedInputs.length, 1);
  assertEquals(
    (persistedInputs[0].evidence as Record<string, unknown>).payment_reference,
    "PAYMENT-METADATA-001",
  );
  assertEquals(
    (persistedInputs[0].allocations as Array<Record<string, unknown>>)[0]
      .invoice_id,
    invoiceId,
  );
  assertEquals(filters, [
    ["receipts", "id", receiptId],
    ["receipts", "company_id", auth.companyId],
    ["invoices", "company_id", auth.companyId],
    ["invoices", "customer_id", customerId],
    ["invoices", "currency", "MYR"],
    ["invoices", "company_id", auth.companyId],
    ["invoices", "customer_id", customerId],
    ["invoices", "currency", "MYR"],
  ]);
  assertEquals(inFilters, [
    ["invoices", "status", ["Open", "Overdue", "Partially Paid"]],
    ["invoices", "invoice_no", ["SUPPLIER-INV-123"]],
    ["invoices", "status", ["Open", "Overdue", "Partially Paid"]],
    ["invoices", "reference_no", ["SUPPLIER-INV-123"]],
  ]);
  assertEquals(gtFilters, [
    ["invoices", "outstanding", 0],
    ["invoices", "outstanding", 0],
  ]);
});

Deno.test("Unverified Receipt matching evidence withholds allocation once and redacts values", async () => {
  const receiptId = "10000000-0000-4000-8000-000000000031";
  const commandId = "10000000-0000-4000-8000-000000000032";
  const exceptions: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        in() {
          return query;
        },
        gt() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        maybeSingle() {
          assertEquals(table, "receipts");
          return Promise.resolve({
            data: {
              id: receiptId,
              customer_id: customerId,
              currency: "MYR",
              status: "Posted",
              unallocated_amount: "100.00",
            },
            error: null,
          });
        },
        then(resolve: (value: unknown) => unknown) {
          assertEquals(table, "invoices");
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
        insert(value: Record<string, unknown>) {
          assertEquals(table, "automation_exceptions");
          const duplicate = exceptions.some((row) =>
            row.idempotency_key === value.idempotency_key
          );
          if (!duplicate) exceptions.push(value);
          return Promise.resolve({
            error: duplicate
              ? {
                code: "23505",
                message:
                  'duplicate key value violates unique constraint "uq_automation_exception_idempotency"',
              }
              : null,
          });
        },
      };
      return query;
    },
  };
  const service = new AutomationService({ client: client as never });
  let allocationCalls = 0;
  const internal = service as unknown as {
    proposeAndAllocateReceipt: (
      auth: AuthContext,
      command: Record<string, unknown>,
      extraction: Record<string, unknown>,
    ) => Promise<Record<string, unknown> | null>;
    persistAutomaticAllocation: () => Promise<Record<string, unknown>>;
  };
  internal.persistAutomaticAllocation = () => {
    allocationCalls++;
    return Promise.resolve({});
  };
  const command = {
    id: commandId,
    status: "completed",
    command_type: "create_receipt",
    resulting_receipt_id: receiptId,
    mailbox_id: mailboxId,
    message_id: "10000000-0000-4000-8000-000000000033",
    attachment_id: attachmentId,
  };
  const extraction = {
    schema_version: 1,
    document_type: "receipt",
    customer: { customer_code: "CUST-00007" },
    receipt_date: "2026-08-10",
    currency: "MYR",
    amount: "100.00",
    payment_method: "TT",
    reference_no: "PAYMENT-METADATA-001",
    invoice_references: ["GATE-INV-DRAFT-20260810-001"],
  };
  assertEquals(
    await internal.proposeAndAllocateReceipt(auth, command, extraction),
    null,
  );
  assertEquals(
    await internal.proposeAndAllocateReceipt(auth, command, extraction),
    null,
  );
  assertEquals(command.status, "completed");
  assertEquals(command.resulting_receipt_id, receiptId);
  assertEquals(allocationCalls, 0);
  assertEquals(exceptions.length, 1);
  assertEquals(exceptions[0].reason_code, "critical_identifier_unverified");
  assertEquals(exceptions[0].lifecycle_status, "open");
  assertEquals(exceptions[0].safe_details, {
    error_code: "INVOICE_REFERENCE_NOT_FOUND",
  });
  const serialized = JSON.stringify(exceptions);
  assert(!serialized.includes("GATE-INV"));
  assert(!serialized.includes("PAYMENT-METADATA"));
});

Deno.test("Migration 037 adds only the bounded critical-identifier reason", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../database/037_gate_e_critical_identifier_authority.sql",
      import.meta.url,
    ),
  );
  const smoke = await Deno.readTextFile(
    new URL(
      "../../../database/037b_gate_e_critical_identifier_authority_smoke_tests.sql",
      import.meta.url,
    ),
  );
  assert(migration.includes("'critical_identifier_unverified'"));
  assert(
    migration.includes("VALIDATE CONSTRAINT chk_automation_exception_reason"),
  );
  assert(!/\b(?:GRANT|REVOKE)\b/.test(migration));
  assert(!/\b(?:INSERT|UPDATE|DELETE)\b/.test(migration));
  assert(!migration.includes("operating_mode"));
  assert(smoke.includes("ROLLBACK;"));
  assert(smoke.includes("relrowsecurity"));
  assert(smoke.includes("has_table_privilege('anon'"));
  assert(smoke.includes("has_table_privilege('authenticated'"));
});

Deno.test("Migration 038 keeps Receipt reference resolution exact, unique, and DB-authoritative", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../database/038_gate_e_receipt_invoice_reference_authority.sql",
      import.meta.url,
    ),
  );
  const smoke = await Deno.readTextFile(
    new URL(
      "../../../database/038b_gate_e_receipt_invoice_reference_authority_smoke_tests.sql",
      import.meta.url,
    ),
  );
  for (
    const required of [
      "automation_resolve_receipt_invoice_references",
      "count(DISTINCT matches.invoice_id)",
      "i.company_id = p_company_id",
      "i.customer_id = p_customer_id",
      "i.currency = p_currency",
      "i.status IN ('Open', 'Overdue', 'Partially Paid')",
      "i.outstanding > 0",
      "i.invoice_no = requested.reference",
      "i.reference_no = requested.reference",
      "count(DISTINCT resolved.invoice_id)",
      "resolved.invoice_id = v_invoice.id",
      "Invoice reference evidence is not uniquely resolvable",
      "pg_advisory_xact_lock",
      "automation_fx_is_authoritative",
      "public.allocate_receipt",
    ]
  ) {
    assert(
      migration.includes(required),
      `Missing Migration 038 rule: ${required}`,
    );
  }
  assert(migration.includes("SECURITY DEFINER"));
  assert(migration.includes("SET search_path = ''"));
  assert(migration.includes("FROM PUBLIC, anon, authenticated"));
  assert(migration.includes("TO service_role"));
  assert(migration.includes("OWNER TO postgres"));
  assert(
    migration.includes("idx_invoices_company_customer_reference"),
  );
  assert(migration.includes("WHERE reference_no IS NOT NULL"));
  assert(!migration.includes("CREATE UNIQUE INDEX"));
  assert(!migration.includes("UPDATE public.automation_settings"));
  assert(!migration.includes("ALTER TABLE"));
  assert(!migration.includes("CREATE POLICY"));
  assert(smoke.includes("ROLLBACK;"));
  assert(smoke.includes("has_function_privilege("));
  assert(smoke.includes("count(DISTINCT matches.invoice_id)"));
  assert(smoke.includes("i.invoice_no = requested.reference"));
  assert(smoke.includes("i.reference_no = requested.reference"));
  assert(smoke.includes("idx_invoices_company_customer_reference"));
  assert(smoke.includes("Unique external Invoice reference did not resolve"));
  assert(smoke.includes("Ambiguous external Invoice reference resolved"));
  assert(smoke.includes("Non-exact GATEE/GATE reference resolved"));
});

Deno.test("Migration 034 installs all Gate E tables, RLS, grants, and no activation", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../database/034_gate_e_autonomous_ar_operations.sql",
      import.meta.url,
    ),
  );
  for (
    const table of [
      "sales_representatives",
      "customer_sales_representative_assignments",
      "automation_settings",
      "automation_mailboxes",
      "mailbox_sync_runs",
      "automation_source_messages",
      "automation_source_attachments",
      "automation_document_classifications",
      "automation_extraction_results",
      "automation_commands",
      "automation_exceptions",
      "automation_allocation_decisions",
      "invoice_reminders",
      "reminder_delivery_attempts",
      "automation_audit_events",
    ]
  ) {
    assert(sql.includes(`CREATE TABLE public.${table}`), `Missing ${table}`);
    assert(
      sql.includes(`'${table}'`),
      `Missing RLS table manifest for ${table}`,
    );
  }
  assert(sql.includes("operating_mode TEXT NOT NULL DEFAULT 'disabled'"));
  assert(
    sql.includes("auto_allocation_enabled BOOLEAN NOT NULL DEFAULT false"),
  );
  assert(sql.includes("automation_actor_user_id UUID NULL"));
  assert(sql.includes("ingestion_token_expires_at TIMESTAMPTZ NULL"));
  assert(sql.includes("delivery_token_expires_at TIMESTAMPTZ NULL"));
  assert(sql.includes("trg_automation_exception_tenant"));
  assert(
    !sql.match(
      /\bINSERT INTO public\.(invoices|receipts|allocation_details)\b/i,
    ),
  );
  assert(!sql.includes("cron.schedule"));
});

Deno.test("Migration 034 salesman remains separate from auth and enforces one current owner", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../database/034_gate_e_autonomous_ar_operations.sql",
      import.meta.url,
    ),
  );
  const salesmanBlock = sql.slice(
    sql.indexOf("CREATE TABLE public.sales_representatives"),
    sql.indexOf(
      "CREATE TABLE public.customer_sales_representative_assignments",
    ),
  );
  assert(!salesmanBlock.includes("auth.users"));
  assert(
    sql.includes("CREATE UNIQUE INDEX uq_customer_sales_assignment_current"),
  );
  assert(sql.includes("WHERE superseded_at IS NULL"));
  assert(sql.includes("automation_assign_sales_representative"));
  assert(sql.includes("automation_guard_assignment_history"));
  assert(sql.includes("IMMUTABLE_SALES_ASSIGNMENT_HISTORY"));
  assert(sql.includes("automation_guard_extraction_history"));
  assert(sql.includes("IMMUTABLE_AUTOMATION_EXTRACTION_HISTORY"));
  assert(sql.includes("automation_record_lifecycle_audit"));
  assert(sql.includes("'reminder_delivery_attempts'"));
});

Deno.test("Migration 034 auto allocation is DB-authoritative, locked, idempotent, and same-currency", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../database/034_gate_e_autonomous_ar_operations.sql",
      import.meta.url,
    ),
  );
  assert(sql.includes("pg_advisory_xact_lock"));
  assert(sql.includes("FOR UPDATE"));
  assert(sql.includes("automation_fx_is_authoritative"));
  assert(sql.includes("automation_attribute_allocation_method"));
  assert(sql.includes("app.automation_allocation_decision_id"));
  assert(sql.includes("d.status = 'pending'"));
  assert(!sql.includes("created_at >= v_started_at"));
  assert(sql.includes("v_invoice.currency <> v_receipt.currency"));
  assert(sql.includes("v_exact_match_count <> 1"));
  assert(sql.includes("NEW.allocation_method := 'Auto_Amount'"));
  assert(sql.includes("c.resulting_receipt_id = p_receipt_id"));
  assert(sql.includes("JOIN public.automation_extraction_results e"));
  assert(sql.includes("v_command_extraction->'invoice_references'"));
  assert(sql.includes("p_evidence->>'source' <> 'document_extraction_v1'"));
  assert(sql.includes("count(DISTINCT item->>'invoice_id')"));
  assert(sql.includes("v_allocation_total <> v_receipt.unallocated_amount"));
  assert(sql.includes("public.allocate_receipt("));
  assert(sql.includes("uq_automation_allocation_idempotency"));
  assert(!sql.includes("Auto_FIFO"));
});

Deno.test("Gate E financial commands are DB-atomic, idempotent, and crash-reclaimable", async () => {
  const [sql, smoke, service, invoiceService, receiptService] = await Promise
    .all([
      Deno.readTextFile(
        new URL(
          "../../../database/034_gate_e_autonomous_ar_operations.sql",
          import.meta.url,
        ),
      ),
      Deno.readTextFile(
        new URL(
          "../../../database/034b_gate_e_autonomous_ar_operations_smoke_tests.sql",
          import.meta.url,
        ),
      ),
      Deno.readTextFile(new URL("./automation/service.ts", import.meta.url)),
      Deno.readTextFile(new URL("./invoices/service.ts", import.meta.url)),
      Deno.readTextFile(new URL("./receipts/service.ts", import.meta.url)),
    ]);
  for (
    const functionName of [
      "automation_execute_invoice_command",
      "automation_execute_receipt_command",
    ]
  ) {
    assert(sql.includes(`FUNCTION public.${functionName}`));
    assert(sql.includes(`GRANT EXECUTE ON FUNCTION public.${functionName}`));
    assert(smoke.includes(functionName));
  }
  assert(sql.includes("FROM public.automation_commands"));
  assert(sql.includes("FOR UPDATE"));
  assert(sql.includes("AUTOMATION_COMMAND_PROVENANCE_MISMATCH"));
  assert(sql.includes("automation_record_lifecycle_audit"));
  assert(sql.includes("'automation_commands'"));
  assert(
    smoke.includes("Atomic financial-command failure left partial residue"),
  );
  assert(invoiceService.includes("automation_execute_invoice_command"));
  assert(receiptService.includes("automation_execute_receipt_command"));
  assert(service.includes("automationCommandId: String(command.id)"));
  assert(service.includes("15 * 60 * 1000"));
  assert(!service.includes("await invoice.deleteDraftInvoice"));
  assert(!service.includes("await receipt.deleteDraftReceipt"));
});

Deno.test("Migration 034 reminders are Invoice-only, idempotent, and never infer a recipient", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../database/034_gate_e_autonomous_ar_operations.sql",
      import.meta.url,
    ),
  );
  assert(sql.includes("i.doc_type = 'Invoice'"));
  assert(sql.includes("SELECT i.*, c.customer_name, stage.stage_offset_days"));
  assert(sql.includes("i.outstanding > 0"));
  assert(sql.includes("uq_invoice_reminder_stage"));
  assert(sql.includes("'missing_salesman'"));
  assert(sql.includes("'invalid_salesman_email'"));
  assert(sql.includes("chk_observe_only_no_delivery"));
  assert(!sql.includes("Debit Note'"));
});

Deno.test("Gate E source retains default-off providers, bounded worker, and no scheduler installation", async () => {
  const [service, config, migration] = await Promise.all([
    Deno.readTextFile(new URL("./automation/service.ts", import.meta.url)),
    Deno.readTextFile(
      new URL("../config.toml", import.meta.url),
    ),
    Deno.readTextFile(
      new URL(
        "../../../database/034_gate_e_autonomous_ar_operations.sql",
        import.meta.url,
      ),
    ),
  ]);
  assert(service.includes(".limit(100)"));
  assert(service.includes("remainingAttachments = 200"));
  assert(service.includes("remainingReminderDeliveries = 200"));
  assert(service.includes(
    "messagesSeen + page.messages.length > MAX_MESSAGES_PER_RUN",
  ));
  assert(service.includes("page.messages.length > 100"));
  assert(service.includes("purgeExpiredAttachmentContent"));
  assert(service.includes("content_purged_at"));
  assert(service.includes("RETENTION_PURGE_FAILED"));
  assert(service.includes(
    "`mailbox_not_configured:${companyId}:ingestion`",
  ));
  assert(service.includes(
    "`mailbox_not_configured:${companyId}:delivery`",
  ));
  assert(config.includes("[functions.automation]"));
  assert(!migration.includes("cron.schedule"));
});

Deno.test("Mailbox retries record exact duplicate no-ops and still advance persisted message lifecycle", async () => {
  const [service, migration] = await Promise.all([
    Deno.readTextFile(new URL("./automation/service.ts", import.meta.url)),
    Deno.readTextFile(
      new URL(
        "../../../database/034_gate_e_autonomous_ar_operations.sql",
        import.meta.url,
      ),
    ),
  ]);
  assert(service.includes('reason_code: "message_duplicate"'));
  assert(service.includes('reason_code: "attachment_duplicate"'));
  assert(service.includes("duplicate_no_op: true"));
  assert(service.includes(
    'processing_status: "attachments_persisted"',
  ));
  assert(migration.includes("uq_automation_exception_idempotency"));
  assert(migration.includes("WHERE idempotency_key IS NOT NULL"));
  assert(service.includes("isAutomationExceptionIdempotencyConflict(error)"));
  assert(
    !service.includes('from("automation_exceptions").upsert'),
    "PostgREST cannot infer the partial exception idempotency index",
  );
  assert(service.includes("ignoreDuplicates: true"));
  assert(service.includes('select("safe_storage_path")'));
  assert(service.includes(
    '.in("processing_status", ["received", "attachments_persisted"])',
  ));
  assert(service.includes("if (cursorError) throw cursorError"));
  assert(service.includes("if (completeRunError) throw completeRunError"));
  assert(service.includes("if (failureRunError) throw failureRunError"));
});

Deno.test("Mailbox document processing resumes a durable bounded attachment backlog", async () => {
  const [migration, smoke, service] = await Promise.all([
    Deno.readTextFile(
      new URL(
        "../../../database/034_gate_e_autonomous_ar_operations.sql",
        import.meta.url,
      ),
    ),
    Deno.readTextFile(
      new URL(
        "../../../database/034b_gate_e_autonomous_ar_operations_smoke_tests.sql",
        import.meta.url,
      ),
    ),
    Deno.readTextFile(new URL("./automation/service.ts", import.meta.url)),
  ]);
  assert(migration.includes(
    "processing_status TEXT NOT NULL DEFAULT 'pending'",
  ));
  assert(migration.includes(
    "idx_automation_source_attachment_processing",
  ));
  assert(smoke.includes(
    "Crash-safe attachment processing lifecycle is incomplete",
  ));
  assert(service.includes(
    '.in("processing_status", ["pending", "retryable"])',
  ));
  assert(service.includes('.is("content_purged_at", null)'));
  assert(service.includes(
    'processingStatus: "retryable" | "processed"',
  ));
  assert(service.includes(
    ".update({ processing_status: processingStatus })",
  ));
  assert(
    !service.includes(
      '.eq("company_id", auth.companyId).eq("sync_run_id", run.id)',
    ),
  );
});

Deno.test("Exception collection derives tenant-scoped document monitoring context", async () => {
  const service = await Deno.readTextFile(
    new URL("./automation/service.ts", import.meta.url),
  );
  assert(service.includes('table === "automation_exceptions"'));
  assert(service.includes(
    '.select("id,original_file_name,processing_status")',
  ));
  assert(service.includes(
    '.select("id,attachment_id,document_type,status,created_at")',
  ));
  assert(service.includes('.eq("company_id", auth.companyId)'));
  assert(service.includes("document_context: attachment"));
  assert(service.includes("classification_status: classification?.status"));
});

Deno.test("Reminder delivery never retries an unconfirmed provider outcome", async () => {
  const [service, providers] = await Promise.all([
    Deno.readTextFile(new URL("./automation/service.ts", import.meta.url)),
    Deno.readTextFile(new URL("./automation/providers.ts", import.meta.url)),
  ]);
  assert(
    service.includes(
      'deliveryError.code === "PROVIDER_DELIVERY_OUTCOME_UNCONFIRMED"',
    ),
  );
  assert(service.includes("retry_blocked: true"));
  assert(service.includes("if (attemptCompleteError)"));
  assert(service.includes("if (reminderCompleteError)"));
  assert(
    providers.includes('"PROVIDER_DELIVERY_OUTCOME_UNCONFIRMED"'),
  );
  assert(
    !classifyProviderFailure(
      new BusinessError(
        "PROVIDER_DELIVERY_OUTCOME_UNCONFIRMED",
        "ambiguous",
        409,
      ),
    ).retryable,
  );
});

Deno.test("Migration 034b is rollback-only and verifies service-role-only RPCs", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../database/034b_gate_e_autonomous_ar_operations_smoke_tests.sql",
      import.meta.url,
    ),
  );
  assert(sql.trimStart().startsWith("-- Gate E rollback-only"));
  assert(sql.includes("BEGIN;"));
  assert(sql.trimEnd().endsWith("ROLLBACK;"));
  assert(sql.includes("has_function_privilege('authenticated'"));
  assert(sql.includes("has_function_privilege('service_role'"));
  assert(sql.includes("has_table_privilege('authenticated'"));
  assert(sql.includes("has_table_privilege("));
  assert(sql.includes("idx_automation_source_attachment_retention"));
  assert(sql.includes("ingestion_token_expires_at IS NOT NULL"));
});

Deno.test("Operating Mode and Reminder Mode derive exact canonical capability profiles", () => {
  assertEquals(documentCapabilityProfile("disabled"), {
    mailbox_sync_enabled: false,
    document_intelligence_enabled: false,
    invoice_automation_enabled: false,
    receipt_automation_enabled: false,
    auto_allocation_enabled: false,
  });
  assertEquals(documentCapabilityProfile("observe_only"), {
    mailbox_sync_enabled: true,
    document_intelligence_enabled: true,
    invoice_automation_enabled: false,
    receipt_automation_enabled: false,
    auto_allocation_enabled: false,
  });
  assertEquals(documentCapabilityProfile("draft_only"), {
    mailbox_sync_enabled: true,
    document_intelligence_enabled: true,
    invoice_automation_enabled: true,
    receipt_automation_enabled: true,
    auto_allocation_enabled: false,
  });
  assertEquals(documentCapabilityProfile("straight_through"), {
    mailbox_sync_enabled: true,
    document_intelligence_enabled: true,
    invoice_automation_enabled: true,
    receipt_automation_enabled: true,
    auto_allocation_enabled: true,
  });
  assertEquals(reminderCapabilityProfile("off"), {
    reminder_evaluation_enabled: false,
    reminder_delivery_enabled: false,
  });
  assertEquals(reminderCapabilityProfile("evaluate_only"), {
    reminder_evaluation_enabled: true,
    reminder_delivery_enabled: false,
  });
  assertEquals(reminderCapabilityProfile("automatic_delivery"), {
    reminder_evaluation_enabled: true,
    reminder_delivery_enabled: true,
  });
});

Deno.test("Settings API refuses raw capability mutation and preserves Finance Manager arming", async () => {
  const service = new AutomationService({ client: {} as never });
  for (
    const field of [
      "mailbox_sync_enabled",
      "document_intelligence_enabled",
      "invoice_automation_enabled",
      "receipt_automation_enabled",
      "auto_allocation_enabled",
      "reminder_evaluation_enabled",
      "reminder_delivery_enabled",
    ]
  ) {
    await rejects(
      () => service.updateSettings(auth, { [field]: true }),
      "unexpected_fields",
    );
  }
  const systemAdmin: AuthContext = {
    ...auth,
    roles: ["System Admin"],
    highestRole: "System Admin",
  };
  await rejects(
    () => service.updateSettings(systemAdmin, { operating_mode: "draft_only" }),
    "Authorization",
  );
  await rejects(
    () =>
      service.updateSettings(systemAdmin, { reminder_mode: "evaluate_only" }),
    "Authorization",
  );
});

Deno.test("Automatic Reminder Delivery readiness failure leaves settings unmodified", async () => {
  let upserts = 0;
  const settings = {
    company_id: auth.companyId,
    automation_actor_user_id: auth.userId,
    operating_mode: "draft_only",
    mailbox_sync_enabled: true,
    document_intelligence_enabled: true,
    invoice_automation_enabled: true,
    receipt_automation_enabled: true,
    auto_allocation_enabled: false,
    reminder_mode: "off",
    reminder_evaluation_enabled: false,
    reminder_delivery_enabled: false,
    reminder_stage_offsets: [-3, 0],
    reminder_timezone: "Asia/Kuala_Lumpur",
    extraction_schema_version: 1,
    minimum_overall_confidence: "0.9500",
    minimum_critical_confidence: "0.9900",
  };
  const client = {
    from(table: string) {
      if (table === "automation_settings") {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          maybeSingle() {
            return Promise.resolve({ data: settings, error: null });
          },
          upsert() {
            upserts++;
            return query;
          },
          single() {
            return Promise.resolve({ data: settings, error: null });
          },
        };
        return query;
      }
      assertEquals(table, "automation_mailboxes");
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return Promise.resolve({ data: [], error: null });
        },
      };
      return query;
    },
  };
  const service = new AutomationService({ client: client as never });
  await rejects(
    () => service.updateSettings(auth, { reminder_mode: "automatic_delivery" }),
    "REMINDER_DELIVERY_NOT_READY",
  );
  assertEquals(upserts, 0);
});

Deno.test("Critical-reference recovery DTO is strict, bounded, and separately privileged", () => {
  const context = exceptionRecoveryContextDto({
    exception_id: "10000000-0000-4000-8000-000000000040",
    lifecycle_status: "open",
    reason_code: "critical_identifier_unverified",
    receipt: {
      id: "10000000-0000-4000-8000-000000000041",
      receipt_no: "RCT-202608-00002",
      status: "Posted",
      currency: "MYR",
      unallocated_amount: "137.42",
      attachment_id: "10000000-0000-4000-8000-000000000042",
    },
    original_invoice_references: ["SUPPLIER-INV-123"],
    eligible_invoices: [{
      invoice_id: "10000000-0000-4000-8000-000000000043",
      invoice_no: "INV-202608-00002",
      reference_no: "SUPPLIER-INV-123",
      status: "Open",
      currency: "MYR",
      outstanding: "137.42",
    }],
    latest_recovery: null,
  });
  assertEquals(context.original_invoice_references, ["SUPPLIER-INV-123"]);
  assertEquals((context.eligible_invoices as Record<string, unknown>[])[0], {
    invoice_id: "10000000-0000-4000-8000-000000000043",
    invoice_no: "INV-202608-00002",
    reference_no: "SUPPLIER-INV-123",
    status: "Open",
    currency: "MYR",
    outstanding: "137.42",
  });
  assertEquals(context.latest_recovery, null);
  assert(
    !("provider_payload" in context) && !("raw_document" in context),
    "restricted recovery DTO must not expose provider internals",
  );
});

Deno.test("Recovery routes preserve one governed mutation and no OpenAI payload", async () => {
  const id = "10000000-0000-4000-8000-000000000040";
  const invoiceId = "10000000-0000-4000-8000-000000000043";
  const captured: Array<Record<string, unknown>> = [];
  const service = {
    getExceptionRecoveryContext: () => Promise.resolve({ exception_id: id }),
    recordExceptionRecovery: (
      _auth: AuthContext,
      exceptionId: string,
      input: Record<string, unknown>,
    ) => {
      captured.push({ exceptionId, ...input });
      return Promise.resolve({ exception_id: id });
    },
    retryExceptionMatching: () => Promise.resolve({ command_id: invoiceId }),
  } as unknown as AutomationService;
  const dependencies = {
    authenticate: () => Promise.resolve(auth),
    createService: () => service,
  };
  const confirm = await handleAutomationRequest(
    new Request(
      `https://example.test/automation/exceptions/${id}/confirm-match`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Company-Id": auth.companyId,
        },
        body: JSON.stringify({
          invoice_id: invoiceId,
          resolution_note: "Reviewed source documents.",
        }),
      },
    ),
    dependencies,
  );
  assertEquals(confirm.status, 200);
  assertEquals(captured, [{
    exceptionId: id,
    action_type: "confirm_receipt_invoice_match",
    invoice_id: invoiceId,
    resolution_note: "Reviewed source documents.",
  }]);
  const retry = await handleAutomationRequest(
    new Request(
      `https://example.test/automation/exceptions/${id}/retry-matching`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Company-Id": auth.companyId,
        },
        body: "{}",
      },
    ),
    dependencies,
  );
  assertEquals(retry.status, 200);
});

Deno.test("Migration 039 derives atomic profiles without activating Production", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../database/039_gate_e_authoritative_capability_profiles.sql",
      import.meta.url,
    ),
  );
  const smoke = await Deno.readTextFile(
    new URL(
      "../../../database/039b_gate_e_authoritative_capability_profiles_smoke_tests.sql",
      import.meta.url,
    ),
  );
  assert(sql.includes("automation_apply_settings_profile"));
  assert(
    sql.includes(
      "NEW.auto_allocation_enabled := NEW.operating_mode = 'straight_through'",
    ),
  );
  assert(sql.includes("NEW.reminder_delivery_enabled :="));
  assert(sql.includes("BR-AUTO-DELIVERY-NOT-READY"));
  assert(sql.includes("SECURITY INVOKER"));
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.automation_apply_settings_profile()",
    ),
  );
  assert(!sql.includes("SET operating_mode = 'straight_through'"));
  assert(smoke.includes("ROLLBACK;"));
  assert(!smoke.includes("COMMIT;"));
});

Deno.test("Migration 040 keeps recovery immutable, tenant-bound, redacted, and DB-authoritative", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../database/040_gate_e_exception_recovery_authority.sql",
      import.meta.url,
    ),
  );
  const smoke = await Deno.readTextFile(
    new URL(
      "../../../database/040b_gate_e_exception_recovery_authority_smoke_tests.sql",
      import.meta.url,
    ),
  );
  assert(sql.includes("CREATE TABLE public.automation_exception_recoveries"));
  assert(sql.includes("AUDIT_IMMUTABLE"));
  assert(sql.includes("ARRAY['Finance Manager']"));
  assert(sql.includes("r.customer_id = i.customer_id"));
  assert(sql.includes("r.currency = i.currency"));
  assert(
    sql.includes("LEAST(v_receipt.unallocated_amount, v_invoice.outstanding)"),
  );
  assert(sql.includes("'human_confirmed_invoice'"));
  assert(sql.includes("public.allocate_receipt("));
  assert(sql.includes("correct_posted_invoice_reference"));
  assert(
    sql.includes(
      "v_exception.lifecycle_status NOT IN ('open', 'retryable')",
    ),
  );
  assert(!sql.includes("levenshtein"));
  assert(!sql.includes("provider_confidence"));
  assert(!sql.includes("UPDATE public.automation_extraction_results"));
  assert(smoke.includes("ROLLBACK;"));
  assert(smoke.includes("service_role"));
  assert(smoke.includes("authenticated"));
});

Deno.test("Migration 041 fixes empty-search-path Retry Matching without broadening authority", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../database/041_gate_e_retry_matching_runtime_compatibility.sql",
      import.meta.url,
    ),
  );
  const smoke = await Deno.readTextFile(
    new URL(
      "../../../database/041b_gate_e_retry_matching_runtime_compatibility_smoke_tests.sql",
      import.meta.url,
    ),
  );
  assert(sql.includes("extensions.digest("));
  assert(!sql.includes("encode(digest("));
  assert(sql.includes("SET search_path = ''"));
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.allocate_receipt(UUID, UUID, UUID, JSONB)",
    ),
  );
  assert(sql.includes("FROM PUBLIC, anon, authenticated"));
  assert(sql.includes("TO service_role"));
  assert(
    sql.includes("LEAST(v_receipt.unallocated_amount, v_invoice.outstanding)"),
  );
  assert(sql.includes("'human_confirmed_invoice'"));
  assert(smoke.includes("gate-e-runtime-probe"));
  assert(smoke.includes("has_function_privilege"));
  assert(smoke.includes("ROLLBACK;"));
  assert(!smoke.includes("COMMIT;"));
});
