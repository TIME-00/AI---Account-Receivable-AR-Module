// ============================================================================
// Gate E — Autonomous AR Operations — desktop + mobile E2E (actual execution).
//
// Fully deterministic: a synthetic local Supabase session is injected in the
// browser (no real credentials, no real auth file), and EVERY backend call
// (`**/functions/v1/**`, including `/auth/me`) is answered by a STRICT in-test
// mock router. The router keeps an explicit allowlist of every expected Gate E
// route; an unmatched automation/auth Edge call is recorded and fails the test
// (it never silently returns an empty collection). Console errors, page errors,
// request failures, and unexpected Edge calls are all asserted to be zero.
//
// No real provider, OAuth, mailbox, email, AI, scheduler, migration,
// deployment, or Production action can occur. Runs only against a loopback
// PLAYWRIGHT_BASE_URL — but the local server is real and the tests actually
// execute and assert, they do not skip.
// ============================================================================

import { expect, test, type Page } from "@playwright/test";
import { classifyRequestFailure } from "./diagnostics";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "";
function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}
const isLocal = isLoopbackHttpUrl(baseURL);

// ─── Self-contained EMPTY browser storage state (safety boundary) ──────────────
// Gate E runs with an in-memory empty storage state and NEVER reads
// `playwright/.auth/*`. The synthetic authenticated session is injected entirely
// in-page by `installSyntheticLocalSession` (an `addInitScript` that stubs the
// Supabase auth-token localStorage read), so no real credentials, no
// `PLAYWRIGHT_STORAGE_STATE`, and no ad-hoc local JSON file are required to run
// this spec. This override applies only to the Gate E spec; the default
// (non-Gate-E) suite still uses the storage state configured in
// playwright.config.ts, and Production authentication code is unchanged.
test.use({ storageState: { cookies: [], origins: [] } });

// ─── Synthetic UUIDs (strict gate-e.1 primitives require RFC-4122) ──────────────

const CO = "10000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000003";
const REP = "10000000-0000-4000-8000-000000000002";
const CUST = "10000000-0000-4000-8000-000000000005";
const MB_GMAIL = "10000000-0000-4000-8000-000000000006";
const MB_MS = "10000000-0000-4000-8000-000000000026";
const RUN = "10000000-0000-4000-8000-000000000007";
const ATT_INV = "10000000-0000-4000-8000-000000000091";
const ATT_RCP = "10000000-0000-4000-8000-000000000092";
const EXT_INV = "10000000-0000-4000-8000-000000000101";
const EXT_RCP = "10000000-0000-4000-8000-000000000102";
const MSG = "10000000-0000-4000-8000-000000000013";
const CMD_INV = "10000000-0000-4000-8000-000000000111";
const CMD_RCP = "10000000-0000-4000-8000-000000000112";
const CMD_ALLOC = "10000000-0000-4000-8000-000000000113";
const INV_RESULT = "10000000-0000-4000-8000-000000000121";
const RCP_RESULT = "10000000-0000-4000-8000-000000000122";
const EXC_OPEN = "10000000-0000-4000-8000-000000000141";
const EXC_RETRY = "10000000-0000-4000-8000-000000000142";
const REM = "10000000-0000-4000-8000-000000000015";
const ATTEMPT = "10000000-0000-4000-8000-000000000017";
const ASG = "10000000-0000-4000-8000-000000000004";
const INV = "10000000-0000-4000-8000-000000000016";
const AUDIT_ASG = "10000000-0000-4000-8000-000000000181";
const AUDIT_REM = "10000000-0000-4000-8000-000000000182";
const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Roles ────────────────────────────────────────────────────────────────────

type RoleName = "Finance Manager" | "Auditor" | "AR Supervisor" | "AR Clerk" | "System Admin";

function authContext(role: RoleName) {
  const readOnly = role === "Auditor" || role === "AR Clerk";
  const systemAdmin = role === "System Admin";
  return {
    user: { id: USER, email: "browser-test@example.invalid" },
    company: { id: CO, code: "E2E", name: "E2E Company", base_currency: "MYR", country: "MY" },
    roles: [role],
    highest_role: role,
    capabilities: {
      can_read_operational_data: !systemAdmin,
      can_read_reports: !systemAdmin,
      can_create_invoice: !readOnly && !systemAdmin,
      can_post_invoice: !readOnly && !systemAdmin,
      can_create_receipt: !readOnly && !systemAdmin,
      can_post_receipt: !readOnly && !systemAdmin,
      can_allocate_receipt: !readOnly && !systemAdmin,
      is_read_only: readOnly,
      is_system_admin_only: systemAdmin,
    },
  };
}

// ─── Contract-shaped fixtures (must satisfy the strict gate-e.1 Zod schemas) ────

const SETTINGS = {
  company_id: CO,
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

const OVERVIEW = {
  settings: SETTINGS,
  ingestion_ready: false,
  delivery_ready: false,
  document_intelligence_ready: false,
  connected_mailbox_count: 1,
  reconnect_required_mailbox_count: 1,
  last_successful_sync_at: "2026-07-30T00:00:00Z",
  last_failed_sync_at: null,
  processing_runs: 1,
  documents_processed: 2,
  accepted_documents: 2,
  rejected_documents: 0,
  invoices_created: 1,
  receipts_created: 1,
  allocations_completed: 0,
  reminders_evaluated: 1,
  reminders_sent: 0,
  open_exceptions: 1,
  retryable_exceptions: 1,
};

const REP_ROW = {
  id: REP,
  company_id: CO,
  name: "陈凯文 François",
  email: "rep@example.com",
  phone: "+60123456789",
  is_active: true,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  created_by: USER,
  updated_by: USER,
};
const SALES_REPS = [REP_ROW];

function mailbox(
  id: string,
  provider: "gmail" | "microsoft",
  address: string,
  overrides: Record<string, unknown>,
) {
  return {
    id,
    company_id: CO,
    provider_type: provider,
    mailbox_address: address,
    default_bank_account_id: null,
    connection_status: "disabled",
    ingestion_secret_configured: false,
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
    created_at: "2026-07-30T00:00:00Z",
    updated_at: "2026-07-30T00:00:00Z",
    ...overrides,
  };
}

const MAILBOXES = [
  mailbox(MB_GMAIL, "gmail", "ar-gmail@example.com", {
    connection_status: "connected",
    ingestion_secret_configured: true,
    ingestion_token_expires_at: "2026-09-01T00:00:00Z",
    cursor_kind: "history_id",
    cursor_present: true,
    last_successful_sync_at: "2026-07-30T00:00:00Z",
    is_enabled: true,
    ingestion_enabled: true,
  }),
  mailbox(MB_MS, "microsoft", "ar-ms@example.com", {
    connection_status: "reconnect_required",
    ingestion_secret_configured: true,
    cursor_kind: "delta_link",
    last_failed_sync_at: "2026-07-29T00:00:00Z",
    reconnect_required: true,
    redacted_error_code: "AUTH_REVOKED",
  }),
];

const BANK_ACCOUNT_ACTIVE = "10000000-0000-4000-8000-000000000301";
const BANK_ACCOUNTS = [
  {
    id: BANK_ACCOUNT_ACTIVE,
    company_id: CO,
    bank_name: "Maybank",
    account_no: "1234567890",
    account_name: "E2E Operating",
    swift_code: null,
    currency: "MYR",
    gl_account_id: null,
    is_active: true,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  },
  {
    id: "10000000-0000-4000-8000-000000000302",
    company_id: CO,
    bank_name: "Legacy Bank",
    account_no: "5555000011",
    account_name: "Closed Account",
    swift_code: null,
    currency: "MYR",
    gl_account_id: null,
    is_active: false,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  },
];

const RUNS = [
  {
    id: RUN,
    company_id: CO,
    mailbox_id: MB_GMAIL,
    provider_type: "gmail",
    status: "completed",
    cursor_before: "[redacted]",
    cursor_after: "[redacted]",
    started_at: "2026-07-30T00:00:00Z",
    completed_at: "2026-07-30T00:05:00Z",
    failed_at: null,
    messages_discovered: 3,
    messages_persisted: 3,
    attachments_discovered: 2,
    attachments_persisted: 2,
    duplicate_messages: 0,
    duplicate_attachments: 0,
    attachments_processed: 2,
    commands_processed: 2,
    allocations_completed: 0,
    failures: 0,
    attempt_count: 1,
    max_attempts: 3,
    redacted_error_code: null,
    created_at: "2026-07-30T00:00:00Z",
  },
];

function decision(
  id: string,
  attachmentId: string,
  extractionId: string,
  documentType: "invoice" | "receipt",
  fileName: string,
  command: Record<string, unknown> | null,
) {
  return {
    id,
    company_id: CO,
    attachment_id: attachmentId,
    schema_version: 1,
    document_type: documentType,
    status: "accepted",
    confidence: 0.97,
    critical_field_confidence: 0.99,
    provider: "test-doc-intel",
    model: "test-model",
    provider_version: "2026-07",
    trace_id: "trace-doc-1",
    created_at: "2026-07-30T00:00:00Z",
    attachment: {
      id: attachmentId,
      file_name: fileName,
      content_mime_type: "application/pdf",
      size_bytes: 20480,
      page_count: 1,
      scan_status: "passed",
      safety_status: "accepted",
      processing_status: "processed",
      content_purged_at: null,
    },
    extraction: {
      id: extractionId,
      schema_version: 1,
      document_type: documentType,
      validation_status: "valid",
      validation_codes: ["schema_ok", "arithmetic_ok"],
      field_confidence: { total: 0.98 },
      customer_id: CUST,
      customer_resolution_method: "customer_code",
      trace_id: "trace-doc-1",
      validated_at: "2026-07-30T00:00:00Z",
      created_at: "2026-07-30T00:00:00Z",
    },
    command,
    linked_exception_ids: [] as string[],
  };
}

function commandRef(id: string, type: string, invoiceId: string | null, receiptId: string | null) {
  return {
    id,
    command_type: type,
    status: "completed",
    resulting_invoice_id: invoiceId,
    resulting_receipt_id: receiptId,
    failure_code: null,
  };
}

const DOCUMENTS = [
  decision(
    "10000000-0000-4000-8000-000000000081",
    ATT_INV,
    EXT_INV,
    "invoice",
    "invoice-INV-001.pdf",
    commandRef(CMD_INV, "create_invoice", INV_RESULT, null),
  ),
  decision(
    "10000000-0000-4000-8000-000000000082",
    ATT_RCP,
    EXT_RCP,
    "receipt",
    "receipt-RCP-001.pdf",
    commandRef(CMD_RCP, "create_receipt", null, RCP_RESULT),
  ),
];

function command(
  id: string,
  type: "create_invoice" | "create_receipt" | "allocate_receipt",
  status: string,
  invoiceId: string | null,
  receiptId: string | null,
  key: string,
) {
  return {
    id,
    command_type: type,
    status,
    resulting_invoice_id: invoiceId,
    resulting_receipt_id: receiptId,
    failure_code: null,
    company_id: CO,
    mailbox_id: MB_GMAIL,
    message_id: MSG,
    attachment_id: type === "create_invoice" ? ATT_INV : ATT_RCP,
    extraction_id: type === "create_invoice" ? EXT_INV : EXT_RCP,
    operating_mode: "straight_through",
    schema_version: 1,
    idempotency_key: key,
    created_by: USER,
    created_at: "2026-07-30T00:00:00Z",
    completed_at: status === "completed" ? "2026-07-30T00:01:00Z" : null,
    failed_at: null,
  };
}

const COMMANDS = [
  command(CMD_INV, "create_invoice", "completed", INV_RESULT, null, SHA),
  // Eligible for allocation: completed create_receipt with a resulting receipt.
  command(CMD_RCP, "create_receipt", "completed", null, RCP_RESULT, SHA2),
  // Ineligible: allocate_receipt in a non-terminal state.
  command(CMD_ALLOC, "allocate_receipt", "proposed", null, null, "c".repeat(64)),
];

function exception(
  id: string,
  lifecycle: "open" | "retryable" | "resolved" | "dismissed",
  reasonCode: string,
  document:
    | {
      file_name: string;
      document_type: string | null;
      processing_status: string;
      classification_status: string | null;
      manual_review_required: boolean;
    }
    | null = null,
) {
  return {
    id,
    company_id: CO,
    mailbox_id: null,
    sync_run_id: null,
    message_id: null,
    attachment_id: document ? ATT_INV : null,
    command_id: null,
    invoice_id: null,
    receipt_id: null,
    reason_code: reasonCode,
    idempotency_key: null,
    lifecycle_status: lifecycle,
    safe_details: { error_code: reasonCode.toUpperCase() },
    retry_count: lifecycle === "retryable" ? 1 : 0,
    max_retries: 3,
    actor_user_id: null,
    resolution_note: null,
    // Automation v15 nullable bounded document monitoring projection.
    document,
    opened_at: "2026-07-30T00:00:00Z",
    resolved_at: null,
    dismissed_at: null,
    created_at: "2026-07-30T00:00:00Z",
    updated_at: "2026-07-30T00:00:00Z",
  };
}

const EXCEPTIONS = [
  exception(EXC_OPEN, "open", "low_confidence"),
  // Retained Observe-Only receipt: a retryable internal-processing failure with a
  // bounded v15 document projection the monitoring UI must surface.
  exception(EXC_RETRY, "retryable", "internal_processing_failure", {
    file_name: "gate-e-observe-receipt-20260809.png",
    document_type: "receipt",
    processing_status: "processed",
    classification_status: "accepted",
    manual_review_required: true,
  }),
];

const REMINDERS = [
  {
    id: REM,
    company_id: CO,
    invoice_id: INV,
    customer_id: CUST,
    sales_representative_id: REP,
    stage_offset_days: -3,
    scheduled_for: "2026-07-28",
    status: "pending",
    recipient_name_snapshot: "陈凯文 François",
    recipient_email_snapshot: "rep@example.com",
    recipient_phone_snapshot: "+60123456789",
    customer_name_snapshot: "Müller 商事",
    invoice_no_snapshot: "INV-001",
    due_date_snapshot: "2026-07-31",
    outstanding_snapshot: "100.00",
    currency_snapshot: "MYR",
    created_at: "2026-07-27T00:00:00Z",
    delivered_at: null,
  },
];

const REMINDER_ATTEMPTS = [
  {
    id: ATTEMPT,
    company_id: CO,
    reminder_id: REM,
    mailbox_id: MB_GMAIL,
    provider_type: "gmail",
    attempt_number: 1,
    idempotency_key: SHA,
    status: "retryable_failure",
    provider_message_id: null,
    error_class: "retryable",
    redacted_error_code: "PROVIDER_THROTTLED",
    started_at: "2026-07-28T00:00:00Z",
    completed_at: "2026-07-28T00:00:01Z",
    created_at: "2026-07-28T00:00:00Z",
  },
];

const CURRENT_ASSIGNMENT = {
  assignment: {
    id: ASG,
    company_id: CO,
    customer_id: CUST,
    sales_representative_id: REP,
    assignment_source: "manual_assignment",
    assigned_by: USER,
    assigned_at: "2026-07-01T00:00:00Z",
    assignment_reason: "Initial onboarding",
    superseded_at: null,
    superseded_by: null,
    created_at: "2026-07-01T00:00:00Z",
  },
  sales_representative: REP_ROW,
};

function auditEvent(id: string, entityType: string, entityId: string) {
  return {
    id,
    company_id: CO,
    event_type: `${entityType}_update`,
    entity_type: entityType,
    entity_id: entityId,
    actor_type: "system",
    actor_user_id: null,
    trace_id: "trace-safe",
    safe_metadata: { operation: "update", status: "completed" },
    created_at: "2026-07-30T00:00:00Z",
  };
}

const OAUTH_START_INVALID = {
  provider: "gmail",
  // A syntactically valid URL, but NOT an allowlisted provider origin — the
  // frontend must refuse to navigate to it.
  authorization_url: "https://evil.example.test/o/oauth2/v2/auth?client_id=x",
  expires_at: "2026-07-30T00:10:00Z",
  capability: "ingestion",
};

const INVOICE = {
  id: INV,
  company_id: CO,
  invoice_no: "INV-001",
  customer_id: CUST,
  customer_name: "Müller 商事",
  doc_type: "Invoice",
  invoice_date: "2026-07-01",
  due_date: "2026-07-31",
  currency: "MYR",
  base_currency: "MYR",
  exchange_rate: null,
  total_amount: 100,
  base_total: 100,
  outstanding: 100,
  status: "Open",
  base_available: true,
  fx_posting_eligibility: null,
  fx_decision: null,
  fx_decision_id: null,
  lines: [],
};

const CUSTOMER = {
  id: CUST,
  company_id: CO,
  customer_id: "CUST-001",
  customer_name: "Müller 商事",
  customer_type: "Corporate",
  status: "Active",
  is_deleted: false,
  is_hidden: false,
  credit_rating: "A",
  email: "customer@example.com",
  phone: "+60123456780",
  currency: "MYR",
};

// ─── Deterministic synthetic local session (no real credentials) ───────────────

async function installSyntheticLocalSession(page: Page): Promise<void> {
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
  // Deterministic favicon stub so a missing icon can never surface as a
  // "Failed to load resource" console/HTTP error (handled at the source rather
  // than broadly ignored). Exact path, exact 200 empty body.
  await page.route("**/favicon.ico", (route) =>
    route.fulfill({ status: 200, contentType: "image/x-icon", body: "" }),
  );
  await page.addInitScript((companyId) => {
    const encode = (value: object) =>
      btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const now = Math.floor(Date.now() / 1000);
    const userId = "00000000-0000-4000-8000-0000000000e2";
    const accessToken = [
      encode({ alg: "HS256", typ: "JWT" }),
      encode({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: userId }),
      encode({ nonce: "gate-e" }),
    ].join(".");
    const session = {
      access_token: accessToken,
      refresh_token: "gate-e-refresh",
      expires_at: now + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user: {
        id: userId,
        aud: "authenticated",
        role: "authenticated",
        email: "browser-test@example.invalid",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        identities: [],
        created_at: new Date().toISOString(),
      },
    };
    try {
      window.localStorage.setItem(
        "tsh-company-store",
        JSON.stringify({
          state: { companyId, companyName: "E2E Company", baseCurrency: null, companies: [] },
          version: 2,
        }),
      );
    } catch {
      /* ignore storage errors */
    }
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
        return JSON.stringify(session);
      }
      return originalGetItem.call(this, key);
    };
  }, CO);
}

// ─── Strict mock router + diagnostics ───────────────────────────────────────────

interface Recorder {
  allocateBodies: string[];
  settingsPatches: unknown[];
  mailboxPatches: Array<{ id: string; body: unknown }>;
  repPatches: Array<{ id: string; body: unknown }>;
  oauthStarts: number;
  exceptionResolveCalls: number;
  exceptionRetryCalls: number;
  unexpected: string[];
  httpErrors: string[];
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  /**
   * Deterministic, intentionally-aborted requests, recorded SEPARATELY from
   * unexpected request failures. Only the exact OAuth-provider-origin guard
   * aborts (Google / Microsoft) are ever classified here — never an arbitrary
   * `/functions/v1/` or same-origin app request. Unexpected request failures
   * (`requestFailures`) must still be zero.
   */
  expectedAborts: string[];
  externalNavigations: string[];
  /** Full URL of the accepted GET /auth/me, captured for the method-gating test. */
  authMeUrl?: string;
}

// The ONLY origins whose aborted requests are treated as expected: the OAuth
// provider consent hosts, which the guard route below deterministically aborts
// so a mocked-OAuth regression can never reach a real provider.
const OAUTH_PROVIDER_ORIGINS = [
  "https://accounts.google.com",
  "https://login.microsoftonline.com",
];


async function boot(page: Page, role: RoleName): Promise<Recorder> {
  const rec: Recorder = {
    allocateBodies: [],
    settingsPatches: [],
    mailboxPatches: [],
    repPatches: [],
    oauthStarts: 0,
    exceptionResolveCalls: 0,
    exceptionRetryCalls: 0,
    unexpected: [],
    httpErrors: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    expectedAborts: [],
    externalNavigations: [],
  };

  // Every error-level console message is captured and asserted to be zero. The
  // previous blanket "ignore anything starting with 'Failed to load resource'"
  // rule was removed — it hid real subresource/application failures. Predictable
  // non-application subresources are instead neutralised at the source (the
  // Google Fonts and favicon stubs below), so a genuine error is never masked.
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    rec.consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => rec.pageErrors.push(String(err)));
  const appOrigin = isLocal ? new URL(baseURL).origin : "";
  page.on("requestfailed", (req) => {
    const url = req.url();
    const failure = req.failure()?.errorText ?? "";
    // Classification is delegated to a PURE, unit-tested helper (diagnostics.ts):
    // there is no blanket `ERR_ABORTED` exemption, and a `/functions/v1/` Edge
    // request can NEVER be laundered into the RSC-prefetch bucket. Only two exact
    // aborts are expected (OAuth consent origin; same-origin non-Edge Next.js RSC
    // GET prefetch); everything else is an unexpected request failure.
    const cls = classifyRequestFailure({
      url,
      method: req.method(),
      failureText: failure,
      appOrigin,
      oauthOrigins: OAUTH_PROVIDER_ORIGINS,
    });
    if (cls === "oauth-abort") {
      rec.expectedAborts.push(`OAUTH ${req.method()} ${url}`);
      return;
    }
    if (cls === "rsc-prefetch-abort") {
      rec.expectedAborts.push(`RSC_PREFETCH GET ${new URL(url).pathname}`);
      return;
    }
    rec.requestFailures.push(`${req.method()} ${url} (${failure})`);
  });
  // HTTP 4xx/5xx responses do NOT emit `requestfailed`, so they are monitored
  // here. Scoped to BOTH the mocked Edge surface (`/functions/v1/`) AND every
  // same-origin local application response — so a real Next.js app 4xx/5xx is
  // caught, not just Edge errors. Provider origins are aborted before any HTTP
  // response occurs, so they never appear here. Every EXPECTED route returns
  // 200; any >= 400 is recorded (method, path, status) and asserted zero.
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    let origin = "";
    let pathname = url;
    try {
      const parsed = new URL(url);
      origin = parsed.origin;
      pathname = parsed.pathname;
    } catch {
      /* keep raw url */
    }
    const isEdge = url.includes("/functions/v1/");
    const isSameOriginApp = appOrigin !== "" && origin === appOrigin;
    if (!isEdge && !isSameOriginApp) return;
    rec.httpErrors.push(
      `${response.request().method()} ${pathname} → ${response.status()} [${response.request().resourceType()}]`,
    );
  });
  // Any window.open / target=_blank navigation surfaces as a popup — a real
  // OAuth provider tab opening during the test is an UNEXPECTED external
  // navigation and must be recorded (and asserted zero).
  page.on("popup", (popup) => rec.externalNavigations.push(popup.url()));

  // Belt-and-suspenders: a mocked-OAuth regression can never actually reach a
  // real provider. Abort any request to an OAuth provider origin.
  await page.route(/accounts\.google\.com|login\.microsoftonline\.com/, (r) =>
    r.abort(),
  );

  await installSyntheticLocalSession(page);

  await page.route("**/functions/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    const send = (data: unknown, meta?: Record<string, unknown>) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data,
          contract_version: "gate-e.1",
          ...(meta ? { meta } : {}),
        }),
      });
    const collection = (rows: unknown[], pageSize = 50) =>
      send(rows, { page: 1, page_size: pageSize, total: rows.length, has_more: false });
    const fail = () => {
      rec.unexpected.push(`${method} ${path}`);
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: { code: "TEST_UNEXPECTED_ROUTE", message: `Unexpected Edge call: ${method} ${path}` },
          contract_version: "gate-e.1",
        }),
      });
    };

    // ── Authenticated role/company context (GET ONLY) ──
    // Only GET /auth/me returns the synthetic auth context. Any other method
    // (POST/PATCH/PUT/DELETE) falls through to the final strict fail() branch —
    // there is no wrong-method success response.
    if (path.endsWith("/auth/me") && method === "GET") {
      rec.authMeUrl = request.url();
      return send(authContext(role));
    }

    // ── Automation: customer assignment sub-resources (most specific first) ──
    // Every branch is path-scoped to THIS customer id and method-checked; a wrong
    // method or an unmatched sub-path falls through to fail().
    if (path.includes("/automation/customers/")) {
      if (path.endsWith("/sales-representative/history") && method === "GET") {
        // The panel always paginates history — assert both params are present so
        // a regression that drops pagination fails the E2E.
        const historyPage = url.searchParams.get("page");
        const historyPageSize = url.searchParams.get("page_size");
        if (!historyPage || !historyPageSize) return fail();
        return collection([CURRENT_ASSIGNMENT], 10);
      }
      if (path.endsWith("/sales-representative/assign") && method === "POST") {
        return send({ changed: true, current: CURRENT_ASSIGNMENT });
      }
      if (path.endsWith("/sales-representative") && method === "GET") {
        return send(CURRENT_ASSIGNMENT);
      }
      return fail();
    }

    // ── Automation collections / actions ──
    if (path.endsWith("/automation/overview") && method === "GET") return send(OVERVIEW);
    if (path.endsWith("/automation/settings")) {
      if (method === "PATCH") {
        rec.settingsPatches.push(request.postDataJSON());
        return send({ ...SETTINGS, operating_mode: "straight_through" });
      }
      if (method === "GET") return send(SETTINGS);
      return fail();
    }
    if (path.endsWith("/automation/sales-representatives")) {
      if (method === "POST") return send(REP_ROW);
      if (method === "GET") return collection(SALES_REPS, 25);
      return fail();
    }
    if (/\/automation\/sales-representatives\/[^/]+$/.test(path) && method === "PATCH") {
      const id = path.split("/").pop() ?? "";
      rec.repPatches.push({ id, body: request.postDataJSON() });
      return send({ ...REP_ROW, name: "陈凯文 Renamed" });
    }
    if (path.endsWith("/automation/mailboxes") && method === "GET") return collection(MAILBOXES);
    if (/\/automation\/mailboxes\/[^/]+\/oauth\/start$/.test(path) && method === "POST") {
      rec.oauthStarts += 1;
      return send(OAUTH_START_INVALID);
    }
    if (/\/automation\/mailboxes\/[^/]+$/.test(path) && method === "PATCH") {
      const id = path.split("/").pop() ?? "";
      rec.mailboxPatches.push({ id, body: request.postDataJSON() });
      return send(mailbox(id, "gmail", "ar-gmail@example.com", { is_enabled: true }));
    }
    if (path.endsWith("/automation/runs") && method === "GET") return collection(RUNS);
    if (path.endsWith("/automation/documents") && method === "GET") return collection(DOCUMENTS);
    if (path.endsWith("/automation/commands") && method === "GET") return collection(COMMANDS);
    if (/\/automation\/commands\/[^/]+\/allocate$/.test(path) && method === "POST") {
      rec.allocateBodies.push(request.postData() ?? "");
      return send({
        command_id: CMD_RCP,
        receipt_id: RCP_RESULT,
        allocated_count: 1,
        total_allocated: "100.00",
        receipt_status: "Fully Allocated",
      });
    }
    if (path.endsWith("/automation/exceptions") && method === "GET") return collection(EXCEPTIONS);
    if (/\/automation\/exceptions\/[^/]+\/(resolve|dismiss|retry)$/.test(path) && method === "POST") {
      if (path.endsWith("/resolve")) rec.exceptionResolveCalls += 1;
      if (path.endsWith("/retry")) rec.exceptionRetryCalls += 1;
      // The retry response is a valid v15 exception (nullable document projection
      // included) so the strict frontend contract parses it.
      return send(
        path.endsWith("/retry")
          ? exception(EXC_RETRY, "retryable", "internal_processing_failure", {
            file_name: "gate-e-observe-receipt-20260809.png",
            document_type: "receipt",
            processing_status: "processed",
            classification_status: "accepted",
            manual_review_required: true,
          })
          : exception(EXC_OPEN, "resolved", "low_confidence"),
      );
    }
    if (path.endsWith("/automation/reminders") && method === "GET") {
      // Invoice-bound ONLY: a regression to tenant-wide reminder fetching (no
      // `invoice_id`) must fail the E2E, not silently return the collection.
      const invoiceId = url.searchParams.get("invoice_id");
      if (!invoiceId || !UUID_RE.test(invoiceId)) return fail();
      return collection(REMINDERS);
    }
    if (path.endsWith("/automation/reminder-attempts") && method === "GET") {
      const reminderId = url.searchParams.get("reminder_id");
      if (!reminderId || !UUID_RE.test(reminderId)) return fail();
      return collection(REMINDER_ATTEMPTS);
    }
    if (path.endsWith("/automation/audit") && method === "GET") {
      // Entity-scoped ONLY: require a bounded entity_type AND a UUID entity_id.
      // An unfiltered tenant-wide audit request must fail the E2E.
      const entityType = url.searchParams.get("entity_type");
      const entityId = url.searchParams.get("entity_id");
      if (!entityType || !entityId || !UUID_RE.test(entityId)) return fail();
      return collection([
        auditEvent(AUDIT_ASG, "customer_sales_representative_assignments", ASG),
        auditEvent(AUDIT_REM, "invoice_reminders", REM),
      ]);
    }

    // ── Non-automation host data (EXPLICIT allowlist — every route the suite's
    //    dashboard chrome + detail pages actually call, method-checked). There
    //    is deliberately NO broad "return empty success" fallback: an unlisted
    //    or wrong-method host call is unexpected and must fail the test. ──

    // Global dashboard chrome (present on every page via the shared layout).
    if (path.endsWith("/notifications/unread-count") && method === "GET") {
      return send({ unread_count: 0 });
    }
    if (path.endsWith("/notifications") && method === "GET") return collection([]);

    // Company-scoped bank accounts (reused by the Mailboxes default-receiving
    // -bank control, exactly as Receipts/Settings consume it). Returns a plain
    // array payload.
    if (path.endsWith("/bank-accounts") && method === "GET") return send(BANK_ACCOUNTS);

    // Invoice detail page (invoice + its payment-allocation history table).
    if (/\/invoices\/[^/]+$/.test(path) && method === "GET") return send(INVOICE);
    if (path.endsWith("/invoices") && method === "GET") return collection([INVOICE]);
    if (path.endsWith("/allocations") && method === "GET") return collection([]);

    // Customer detail page (customer, its invoice/receipt lists, aging exposure).
    if (/\/customers\/[^/]+$/.test(path) && method === "GET") return send(CUSTOMER);
    if (path.endsWith("/customers") && method === "GET") return collection([CUSTOMER]);
    if (path.endsWith("/receipts") && method === "GET") return collection([]);
    if (path.endsWith("/reports/aging/by-customer") && method === "GET") {
      return collection([]);
    }

    // ── No broad fallback. ANY other request — unmatched path, wrong method, an
    //    unexpected automation/auth Edge call, or a tenant-wide query-param
    //    regression — is recorded and fails the test via an explicit test-error
    //    response. A valid empty success envelope is NEVER synthesised here. ──
    return fail();
  });

  return rec;
}

function expectClean(rec: Recorder): void {
  expect(rec.unexpected, `unmatched requests: ${rec.unexpected.join(", ")}`).toEqual([]);
  expect(rec.httpErrors, `unexpected HTTP errors: ${rec.httpErrors.join(", ")}`).toEqual([]);
  expect(rec.consoleErrors, `console errors: ${rec.consoleErrors.join(" | ")}`).toEqual([]);
  expect(rec.pageErrors, `page errors: ${rec.pageErrors.join(" | ")}`).toEqual([]);
  // UNEXPECTED request failures must be zero. Intentional OAuth-origin aborts,
  // if any occurred, are captured separately in `rec.expectedAborts` and are not
  // failures — they are asserted for shape by the test that triggers them.
  expect(
    rec.requestFailures,
    `unexpected request failures: ${rec.requestFailures.join(", ")}`,
  ).toEqual([]);
  expect(
    rec.externalNavigations,
    `external navigations: ${rec.externalNavigations.join(", ")}`,
  ).toEqual([]);
}

/**
 * Precise clean gate for the DELIBERATELY-negative `/auth/me` wrong-method test.
 * It is the equivalent of `expectClean()` for a scenario that intentionally
 * drives failures: it asserts EXACTLY the four intended failures (and their four
 * deliberate HTTP 500s) and nothing else, with every unrelated diagnostic zero.
 */
function expectDeliberateAuthMethodFailures(rec: Recorder, authMePath: string): void {
  const methods = ["DELETE", "PATCH", "POST", "PUT"]; // ascending sort order
  // A. Exact unmatched set — exactly the four wrong methods, no extras (no stray
  //    unmatched Edge call, no CORS-preflight OPTIONS leakage).
  expect([...rec.unexpected].sort()).toEqual(methods.map((m) => `${m} ${authMePath}`));
  // B. Exact deliberate HTTP-500 set — exactly four, one per wrong method, all on
  //    the /auth/me Edge path; no unrelated local or Edge >= 400.
  expect(rec.httpErrors).toHaveLength(4);
  for (const m of methods) {
    expect(
      rec.httpErrors.filter((e) => e.startsWith(`${m} ${authMePath} → 500`)),
      `exactly one deliberate 500 for ${m}`,
    ).toHaveLength(1);
  }
  // C. Console errors: the browser emits ONE "Failed to load resource … 500"
  //    echo per deliberate wrong-method 500 — these are DIRECT, expected
  //    consequences of the four intentional failures, not unrelated noise. Assert
  //    exactly four such echoes and ZERO unrelated console errors.
  const deliberate500Echo = /Failed to load resource.*\b500\b/i;
  const relatedConsole = rec.consoleErrors.filter((e) => deliberate500Echo.test(e));
  const unrelatedConsole = rec.consoleErrors.filter((e) => !deliberate500Echo.test(e));
  expect(relatedConsole, "one 500 console echo per deliberate wrong method").toHaveLength(4);
  expect(
    unrelatedConsole,
    `unrelated console errors: ${unrelatedConsole.join(" | ")}`,
  ).toEqual([]);
  // D. Every other unrelated diagnostic remains exactly zero.
  expect(rec.pageErrors, `page errors: ${rec.pageErrors.join(" | ")}`).toEqual([]);
  expect(
    rec.requestFailures,
    `unexpected request failures: ${rec.requestFailures.join(", ")}`,
  ).toEqual([]);
  expect(rec.externalNavigations, "external navigations").toEqual([]);
  // E. The accepted GET is never recorded as unexpected and never an HTTP error.
  expect(rec.unexpected).not.toContain(`GET ${authMePath}`);
  expect(rec.httpErrors.some((e) => e.startsWith(`GET ${authMePath}`))).toBe(false);
}

// ─── Suite ─────────────────────────────────────────────────────────────────────

test.describe("Gate E automation (desktop + mobile)", () => {
  test.skip(!isLocal, "Gate E automation E2E requires a loopback PLAYWRIGHT_BASE_URL (local app).");

  // The recorder for the currently running test, so the final settling gate can
  // re-assert cleanliness AFTER the last in-test assertion (a late console/page
  // error, request failure, or popup can never slip through unnoticed).
  let currentRec: Recorder | null = null;
  const bootAndTrack = async (page: Page, role: RoleName): Promise<Recorder> => {
    const rec = await boot(page, role);
    currentRec = rec;
    return rec;
  };

  test.afterEach(async ({ page }) => {
    // Let any in-flight microtask/navigation settle, then re-assert.
    await page.waitForTimeout(150);
    if (currentRec) expectClean(currentRec);
    currentRec = null;
  });

  test("Overview: disabled + provider-not-configured + fail-closed + measured KPIs", async ({ page }) => {
    const rec = await bootAndTrack(page, "Finance Manager");
    await page.goto("/automation", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Autonomous AR Operations" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Capabilities" })).toBeVisible();
    await expect(page.getByText(/Provider Configuration Required/i).first()).toBeVisible();
    // Truthful fail-closed messaging: nothing is implied to have run, and
    // Straight-Through is reported inactive.
    await expect(page.getByText(/Counters reflect only what has actually run/i)).toBeVisible();
    await expect(page.getByText(/Straight-Through is not active/i)).toBeVisible();
    await expect(page.getByText("Open Exceptions")).toHaveCount(1);
    await expect(page.getByText("Processing Runs")).toHaveCount(1);
    expectClean(rec);
  });

  test("Settings: straight-through requires confirmation and sends the token (Finance Manager)", async ({ page }) => {
    const rec = await bootAndTrack(page, "Finance Manager");
    await page.goto("/automation/settings", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Operating Mode" })).toBeVisible();
    await page.getByRole("radio", { name: /Straight-Through/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Confirm mode change")).toBeVisible();
    await expect(dialog.getByText(/without a person/i).first()).toBeVisible();
    expect(rec.settingsPatches.length).toBe(0);

    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => rec.settingsPatches.length).toBeGreaterThan(0);
    expect(rec.settingsPatches[0]).toMatchObject({
      operating_mode: "straight_through",
      activation_confirmation: "ENABLE_STRAIGHT_THROUGH",
    });
    expectClean(rec);
  });

  test("Settings: capabilities and reminder automation render read-only for Finance Manager", async ({ page }) => {
    const rec = await bootAndTrack(page, "Finance Manager");
    await page.goto("/automation/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Operating Mode" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reminder Automation" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Capabilities" })).toBeVisible();
    // Kill Switches are gone from Settings; capabilities are read-only status.
    await expect(page.getByRole("heading", { name: "Kill Switches" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Enable|Disable)$/ })).toHaveCount(0);
    expectClean(rec);
  });

  test("Dialog a11y (real browser): straight-through dialog traps focus and RESTORES it to the trigger on Escape", async ({ page }) => {
    // Real-Chromium proof of the focus-restoration requirement that jsdom cannot
    // reliably verify (the unit test asserts only that focus is released).
    const rec = await bootAndTrack(page, "Finance Manager");
    await page.goto("/automation/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Operating Mode" })).toBeVisible();

    // 1. Open the AutomationDialog by activating the trigger (the Straight-Through
    //    radio). A real click focuses the trigger, so Radix records it as the
    //    focus-return target.
    const trigger = page.getByRole("radio", { name: /Straight-Through/i });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // 2. Focus is moved INTO the dialog (Radix initial focus + focus trap).
    await expect
      .poll(() => dialog.evaluate((d) => d.contains(document.activeElement)))
      .toBe(true);

    // 3. Close using Escape (cancel — no settings mutation is sent).
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(rec.settingsPatches.length).toBe(0);

    // 4. Focus RETURNS to the original trigger (real-browser Radix restoration).
    await expect(trigger).toBeFocused();
    expectClean(rec);
  });

  test("Router: /auth/me is GET-only — wrong methods hit the strict fail() branch", async ({ page }) => {
    // Deliberately drives UNEXPECTED calls, so it uses boot() directly (NOT
    // bootAndTrack): the afterEach clean-gate must not run for this negative test.
    const rec = await boot(page, "Finance Manager");
    await page.goto("/automation", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Autonomous AR Operations" })).toBeVisible();

    // The real app issues an ACCEPTED GET /auth/me during load (captured in the
    // GET-only router branch). Poll until it lands before driving wrong methods.
    await expect.poll(() => rec.authMeUrl, { timeout: 15_000 }).toBeTruthy();
    const authMeUrl = rec.authMeUrl as string;
    const authMePath = new URL(authMeUrl).pathname;

    // Baseline: the accepted GET was never recorded as unexpected.
    expect(rec.unexpected).not.toContain(`GET ${authMePath}`);

    // Drive EXACTLY the four wrong methods at the SAME /auth/me mock URL. Each is
    // intercepted by the router, does not match the GET-only branch, and falls
    // through to fail() — recorded as unexpected + a deliberate 500 test error.
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      await page.evaluate(
        async ([u, m]) => {
          try {
            await fetch(u, { method: m });
          } catch {
            /* CORS/read rejection is irrelevant — the router already recorded it */
          }
        },
        [authMeUrl, method] as const,
      );
      await expect.poll(() => rec.unexpected.includes(`${method} ${authMePath}`)).toBe(true);
    }

    // Let any in-flight prefetch/microtask settle, then assert the PRECISE
    // negative-test clean gate: exactly the four intended unmatched calls, their
    // four deliberate 500s, and every unrelated diagnostic zero.
    await page.waitForTimeout(200);
    expectDeliberateAuthMethodFailures(rec, authMePath);
  });

  test("Settings: read-only for Auditor", async ({ page }) => {
    const rec = await bootAndTrack(page, "Auditor");
    await page.goto("/automation/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Operating Mode" })).toBeVisible();
    await expect(page.getByText(/Read-only\./i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Enable|Disable)$/ })).toHaveCount(0);
    expectClean(rec);
  });

  test("Unauthorized role (AR Clerk) is denied operational Automation pages", async ({ page }) => {
    const rec = await bootAndTrack(page, "AR Clerk");
    await page.goto("/automation", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/do not have permission to access this Automation section/i)).toBeVisible();
    // Direct-URL access to an operational page is also denied (safe, not a 403).
    await page.goto("/automation/runs", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/do not have permission to access this Automation section/i)).toBeVisible();
    expectClean(rec);
  });

  test("System Admin is configuration-only: sees config tabs, not operational ones", async ({ page }) => {
    const rec = await bootAndTrack(page, "System Admin");
    await page.goto("/automation/settings", { waitUntil: "domcontentloaded" });
    // Scope to the automation sub-nav (the global sidebar also has a Settings link).
    const nav = page.getByLabel("Automation sections");
    // Configuration tabs are present.
    await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Mailboxes" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Sales Representatives" })).toBeVisible();
    // Operational tabs are NOT present for System Admin.
    await expect(nav.getByRole("link", { name: "Overview" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Runs" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Exceptions" })).toHaveCount(0);
    // Direct-URL access to an operational page is denied.
    await page.goto("/automation/runs", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/do not have permission to access this Automation section/i)).toBeVisible();
    expectClean(rec);
  });

  test("Mailboxes: Gmail + Microsoft render; configured state shown; secrets never shown; update + OAuth allowlist", async ({ page }) => {
    const rec = await bootAndTrack(page, "Finance Manager");
    await page.goto("/automation/mailboxes", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("ar-gmail@example.com")).toBeVisible();
    await expect(page.getByText("ar-ms@example.com")).toBeVisible();
    await expect(page.getByText(/Gmail \/ Google Workspace/).first()).toBeVisible();
    await expect(page.getByText(/Microsoft Outlook \/ 365/).first()).toBeVisible();
    await expect(page.getByText(/Reconnect/i).first()).toBeVisible();
    await expect(page.getByText(/Configured/).first()).toBeVisible();
    // Secret references / raw tokens are never rendered.
    await expect(page.getByText(/AR_ING|AR_MAILBOX/)).toHaveCount(0);

    // The generic mailbox master switch was removed: only the single atomic
    // ingestion activation control remains (no exact "Enable"/"Disable" button).
    await expect(page.getByRole("button", { name: "Disable", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enable", exact: true })).toHaveCount(0);

    // Mailbox update (PATCH) — the connected+enabled Gmail mailbox exposes a
    // single "Disable ingestion" control that sends ONE atomic PATCH clearing
    // both is_enabled and ingestion_enabled together (never two mutations, never
    // a half-enabled intermediate state).
    await page.getByRole("button", { name: "Disable ingestion" }).first().click();
    await expect.poll(() => rec.mailboxPatches.length).toBe(1);
    expect(rec.mailboxPatches[0].id).toBe(MB_GMAIL);
    expect(rec.mailboxPatches[0].body).toEqual({
      is_enabled: false,
      ingestion_enabled: false,
    });

    // Default receiving bank account: the Gmail card exposes a company-scoped
    // selector listing only ACTIVE accounts, safely masked (never the full
    // number). Saving sends ONE mailbox PATCH carrying ONLY the mapping — no
    // ingestion/delivery/settings field is coupled to it.
    const bankSelect = page.getByLabel("Default receiving bank account").first();
    await expect(bankSelect).toBeVisible();
    await expect(bankSelect.getByRole("option", { name: /Maybank.*ending 7890.*MYR/ }))
      .toHaveCount(1);
    await expect(bankSelect.getByRole("option", { name: /Legacy Bank|Closed Account/ }))
      .toHaveCount(0);
    await expect(page.getByText(/1234567890/)).toHaveCount(0);
    await bankSelect.selectOption(BANK_ACCOUNT_ACTIVE);
    await page.getByRole("button", { name: "Save bank account" }).first().click();
    await expect.poll(() => rec.mailboxPatches.length).toBe(2);
    expect(rec.mailboxPatches[1].id).toBe(MB_GMAIL);
    expect(rec.mailboxPatches[1].body).toEqual({
      default_bank_account_id: BANK_ACCOUNT_ACTIVE,
    });

    // OAuth start returns a non-allowlisted URL → the client refuses to navigate.
    await page.getByRole("button", { name: "Connect ingestion" }).first().click();
    await expect(page.getByText(/unrecognized provider|refused/i)).toBeVisible();
    expect(rec.oauthStarts).toBeGreaterThan(0);
    expectClean(rec);
  });

  test("Runs: measured counters render, cursor is redacted, provider filter works", async ({ page }) => {
    const rec = await bootAndTrack(page, "Finance Manager");
    await page.goto("/automation/runs", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("cell", { name: "Gmail / Google Workspace" })).toBeVisible();
    await expect(page.getByText("Set (hidden)").first()).toBeVisible();
    await expect(page.getByText(/\[redacted\]|history_id:|delta_link:/)).toHaveCount(0);
    await page.getByLabel("Provider").selectOption({ label: "Gmail / Google Workspace" });
    await expect(page.getByRole("cell", { name: "Gmail / Google Workspace" })).toBeVisible();
    expectClean(rec);
  });

  test("Documents: three stages separated (invoice + receipt) with linked command", async ({ page }) => {
    const rec = await bootAndTrack(page, "Finance Manager");
    await page.goto("/automation/documents", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("invoice-INV-001.pdf")).toBeVisible();
    await expect(page.getByText("receipt-RCP-001.pdf")).toBeVisible();
    await page.getByRole("button", { name: "Detail" }).first().click();
    await expect(page.getByText(/AI Candidate/i)).toBeVisible();
    await expect(page.getByText(/Deterministic Validation/i)).toBeVisible();
    await expect(page.getByText(/Authoritative Result/i)).toBeVisible();
    await expect(page.getByText(/Command:/i)).toBeVisible();
    expectClean(rec);
  });

  test("Commands: eligible completed create_receipt posts exactly {}; ineligible has no action", async ({ page }) => {
    const rec = await bootAndTrack(page, "Finance Manager");
    await page.goto("/automation/commands", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("cell", { name: "Create Invoice" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Create Receipt" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Allocate Receipt" })).toBeVisible();

    // Exactly one eligible command (the completed create_receipt) offers allocation.
    const runButtons = page.getByRole("button", { name: /Run allocation/i });
    await expect(runButtons).toHaveCount(1);
    await runButtons.first().click();
    await expect.poll(() => rec.allocateBodies.length).toBeGreaterThan(0);
    expect(JSON.parse(rec.allocateBodies[0] || "{}")).toEqual({});
    expectClean(rec);
  });

  test("Exceptions: v15 document projection renders; retry sends exactly one request; resolve needs a note", async ({ page }) => {
    const rec = await bootAndTrack(page, "Finance Manager");
    await page.goto("/automation/exceptions", { waitUntil: "domcontentloaded" });

    // Automation v15 nullable document projection parses and the monitoring UI
    // surfaces the problem document identity, type, status, reason, and review.
    // Scope to the table so the assertions never match a (hidden) filter-select
    // <option> that shares the same label text.
    const monitorTable = page.getByRole("table");
    await expect(monitorTable.getByText("gate-e-observe-receipt-20260809.png")).toBeVisible();
    await expect(monitorTable.getByText("Receipt").first()).toBeVisible();
    await expect(monitorTable.getByText("Processed").first()).toBeVisible();
    await expect(monitorTable.getByText("Accepted").first()).toBeVisible();
    await expect(monitorTable.getByText(/Internal Processing Failure/i).first()).toBeVisible();
    await expect(monitorTable.getByText("Manual review required").first()).toBeVisible();
    // No raw extraction/provider/credential data leaks into the monitoring view.
    await expect(page.getByText(/extracted_fields|access_token|ya29/i)).toHaveCount(0);

    // Retry is offered for the retryable exception and performs EXACTLY ONE
    // request (no auto-retry on load). Assert before opening the resolve modal.
    expect(rec.exceptionRetryCalls).toBe(0);
    await page.getByRole("button", { name: "Retry" }).first().click();
    await expect.poll(() => rec.exceptionRetryCalls).toBe(1);
    expect(rec.exceptionResolveCalls).toBe(0);

    await page.getByRole("button", { name: "Resolve" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText(/A note is required\./i)).toBeVisible();
    expect(rec.exceptionResolveCalls).toBe(0);
    expectClean(rec);
  });

  test("Sales Representatives: Unicode name renders; create validates; edit prefills and PATCHes", async ({ page }) => {
    const rec = await bootAndTrack(page, "Finance Manager");
    await page.goto("/automation/sales-representatives", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("陈凯文 François")).toBeVisible();
    await expect(page.getByText(/password/i)).toHaveCount(0);

    // Edit workflow: open the PREFILLED editor and save an update. The mock
    // directory is static, so success is proven by the recorded PATCH (with the
    // edited value) and the success toast — not by the static list re-rendering.
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const nameInput = page.getByLabel("Name");
    await expect(nameInput).toHaveValue(/François/);
    await nameInput.fill("陈凯文 Renamed");
    await page.getByRole("button", { name: "Update" }).click();
    await expect(page.getByText(/Sales representative updated/i)).toBeVisible();
    await expect.poll(() => rec.repPatches.length).toBeGreaterThan(0);
    expect(rec.repPatches[0].body).toMatchObject({ name: "陈凯文 Renamed" });
    expect(rec.repPatches[0].id).toBe(REP);
    expectClean(rec);
  });

  test("Customer detail: assignment panel — current rep, single-current, history identity, audit", async ({ page }) => {
    const rec = await bootAndTrack(page, "Finance Manager");
    await page.goto(`/customers/${CUST}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText("陈凯文 François").first()).toBeVisible();
    await expect(page.getByText(/exactly one current representative/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Reassign|Assign/ }).first()).toBeVisible();

    // History carries the historical representative identity; audit renders.
    await page.getByText(/Assignment history/i).click();
    await expect(page.getByText(/Audit Timeline/i)).toBeVisible();
    // The integrated detail page must be fully clean (no unmatched host/Edge
    // calls, no HTTP errors, no console/page errors).
    expectClean(rec);
  });

  test("Invoice detail: reminder panel — Invoice-only policy, derived delivery state, attempts", async ({ page }) => {
    const rec = await bootAndTrack(page, "Finance Manager");
    await page.goto(`/invoices/${INV}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText(/Invoice Due Reminders/i)).toBeVisible();
    await expect(page.getByText(/3 days before and on the due date/i)).toBeVisible();
    await expect(page.getByText(/3 day\(s\) before due/i)).toBeVisible();
    // Delivery state is DERIVED (kill switch off), not a hard-coded string.
    await expect(page.getByText("Delivery disabled")).toBeVisible();
    // Expand attempts for the reminder.
    await page.getByRole("button", { name: "Attempts" }).first().click();
    await expect(page.getByText(/Delivery attempts/i)).toBeVisible();
    await expect(page.getByText(/Retryable Failure/i)).toBeVisible();
    expectClean(rec);
  });

  test("Mobile: automation sub-navigation is present and navigable", async ({ page }) => {
    const rec = await bootAndTrack(page, "Finance Manager");
    await page.goto("/automation", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("link", { name: "Mailboxes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Exceptions" })).toBeVisible();
    await page.getByRole("link", { name: "Exceptions" }).click();
    await expect(page).toHaveURL(/\/automation\/exceptions$/);
    await expect(page.getByText("Lifecycle").first()).toBeVisible();
    expectClean(rec);
  });
});
