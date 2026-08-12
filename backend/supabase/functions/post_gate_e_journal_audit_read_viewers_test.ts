import type { AuthContext } from "./_shared/auth.ts";
import { AuthorizationError } from "./_shared/errors.ts";
import {
  encodeJournalCursor,
  parseJournalCursor,
  parseJournalListParams,
} from "./journal-entries/contract.ts";
import {
  createJournalReadHandler,
  requireJournalReadAccess,
} from "./journal-entries/index.ts";
import {
  type JournalDetail,
  type JournalListItem,
  type JournalListResult,
  JournalReadService,
  type JournalReadServiceContract,
} from "./journal-entries/read-service.ts";
import {
  encodeAuditCursor,
  parseAuditCursor,
  parseAuditListParams,
  validateAuditEventId,
} from "./audit-trail/contract.ts";
import {
  createAuditReadHandler,
  requireAuditReadAccess,
} from "./audit-trail/index.ts";
import {
  type AuditEvent,
  type AuditListResult,
  AuditReadService,
  type AuditReadServiceContract,
} from "./audit-trail/service.ts";

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompanyId = "20000000-0000-4000-8000-000000000002";
const userId = "30000000-0000-4000-8000-000000000003";
const journalId = "40000000-0000-4000-8000-000000000004";
const sourceId = "50000000-0000-4000-8000-000000000005";
const lineId = "60000000-0000-4000-8000-000000000006";
const secondLineId = "60000000-0000-4000-8000-000000000008";
const accountId = "70000000-0000-4000-8000-000000000007";
const eventId = `invoice_posted:${sourceId}`;

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

async function assertRejects(
  callback: () => Promise<unknown>,
  errorClass?: new (...args: never[]) => Error,
  messageIncludes?: string,
): Promise<void> {
  try {
    await callback();
  } catch (error) {
    if (errorClass && !(error instanceof errorClass)) {
      throw new Error(`Expected ${errorClass.name}, received ${String(error)}`);
    }
    if (
      messageIncludes &&
      (!(error instanceof Error) || !error.message.includes(messageIncludes))
    ) {
      throw new Error(
        `Expected rejection containing ${messageIncludes}, received ${
          String(error)
        }`,
      );
    }
    return;
  }
  throw new Error("Expected callback to reject");
}

function auth(role: AuthContext["highestRole"]): AuthContext {
  return { userId, companyId, roles: [role], highestRole: role, email: null };
}

const journalItem: JournalListItem = {
  id: journalId,
  je_no: "JE-INV-202608-00001",
  je_date: "2026-08-11",
  posting_period: "2026-08",
  source_type: "INV",
  source_doc_no: "INV-202608-00001",
  source_doc_id: sourceId,
  description: "Invoice posting",
  currency: "MYR",
  base_currency: "MYR",
  total_debit: "137.42",
  total_credit: "137.42",
  is_balanced: true,
  is_reversal: false,
  created_at: "2026-08-11T03:30:00.000Z",
  created_by: userId,
  line_count: 2,
  source: {
    entity_type: "invoice",
    entity_id: sourceId,
    entity_number: "INV-202608-00001",
  },
};

const journalDetail: JournalDetail = {
  ...journalItem,
  exchange_rate: "1.00000000",
  original_je_id: null,
  reversal_je_id: null,
  is_reversed: false,
  lines: [
    {
      id: lineId,
      line_no: 1,
      gl_account_id: accountId,
      account_code: "1100-AR",
      account_name: "Accounts Receivable",
      account_type: "Asset",
      description: "Invoice posting",
      debit_amount: "137.42",
      credit_amount: "0.00",
      base_debit: "137.42",
      base_credit: "0.00",
      currency: "MYR",
      original_amount: "137.42",
      created_at: "2026-08-11T03:30:00.000Z",
    },
    {
      id: secondLineId,
      line_no: 2,
      gl_account_id: accountId,
      account_code: "4000-REV",
      account_name: "Revenue",
      account_type: "Revenue",
      description: "Invoice posting",
      debit_amount: "0.00",
      credit_amount: "137.42",
      base_debit: "0.00",
      base_credit: "137.42",
      currency: "MYR",
      original_amount: "137.42",
      created_at: "2026-08-11T03:30:00.000Z",
    },
  ],
};

const auditEvent: AuditEvent = {
  event_id: eventId,
  occurred_at: "2026-08-11T03:30:00.000Z",
  actor: { type: "user", user_id: userId, display_name: null, role: null },
  action: "posted",
  entity_type: "invoice",
  entity_id: sourceId,
  entity_number: "INV-202608-00001",
  result: "Open",
  summary: "Invoice INV-202608-00001 was posted.",
  metadata: { document_type: "Invoice", status: "Open" },
  source_kind: "invoice",
};

function request(
  functionName: string,
  path = "/",
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer synthetic-test-token");
  headers.set("X-Company-Id", companyId);
  return new Request(
    `https://example.test/functions/v1/${functionName}${path}`,
    { ...init, headers },
  );
}

Deno.test("Journal contract round-trips its stable timestamp/id cursor", () => {
  const cursor = { created_at: journalItem.created_at, id: journalId };
  assertEquals(parseJournalCursor(encodeJournalCursor(cursor)), cursor);
});

Deno.test("Journal list contract accepts every bounded authority-backed filter", () => {
  const cursor = encodeJournalCursor({
    created_at: journalItem.created_at,
    id: journalId,
  });
  const params = parseJournalListParams(
    new URL(
      `https://example.test/?limit=50&cursor=${cursor}&q=INV-202608&date_from=2026-08-01&date_to=2026-08-31&source_type=INV&currency=myr&account_code=1100-AR`,
    ),
  );
  assertEquals(params.limit, 50);
  assertEquals(params.currency, "MYR");
  assertEquals(params.sourceType, "INV");
  assertEquals(params.accountCode, "1100-AR");
});

Deno.test("Journal list contract rejects malformed cursor, duplicates, limits, ranges, and enums", () => {
  for (
    const url of [
      "https://example.test/?cursor=not-json",
      "https://example.test/?limit=1&limit=2",
      "https://example.test/?limit=51",
      "https://example.test/?date_from=2026-08-12&date_to=2026-08-11",
      "https://example.test/?source_type=PAYMENT",
      "https://example.test/?currency=MYR%00",
      "https://example.test/?unknown=value",
    ]
  ) assertRejects(() => Promise.resolve(parseJournalListParams(new URL(url))));
});

Deno.test("Journal role matrix permits Supervisor, Finance Manager, and Auditor only", () => {
  for (const role of ["AR Supervisor", "Finance Manager", "Auditor"] as const) {
    requireJournalReadAccess(auth(role));
  }
  for (const role of ["AR Clerk", "System Admin"] as const) {
    assertRejects(
      () => Promise.resolve(requireJournalReadAccess(auth(role))),
      AuthorizationError,
    );
  }
});

class FakeJournalService implements JournalReadServiceContract {
  calls: string[] = [];
  list(
    _auth: AuthContext,
    params: Parameters<JournalReadServiceContract["list"]>[1],
  ): Promise<JournalListResult> {
    this.calls.push(`list:${params.limit}`);
    return Promise.resolve({
      data: [journalItem],
      meta: { limit: params.limit, has_more: false, next_cursor: null },
    });
  }
  detail(_auth: AuthContext, id: string): Promise<JournalDetail> {
    this.calls.push(`detail:${id}`);
    return Promise.resolve(journalDetail);
  }
}

function journalHandler(
  service: JournalReadServiceContract,
  role: AuthContext["highestRole"] = "Finance Manager",
) {
  return createJournalReadHandler({
    authenticate: (_req, suppliedCompany) =>
      suppliedCompany === companyId
        ? Promise.resolve(auth(role))
        : Promise.reject(
          new AuthorizationError("Company context is not permitted."),
        ),
    createService: () => service,
  });
}

Deno.test("Journal handler exposes only GET list/detail and never a mutation route", async () => {
  const service = new FakeJournalService();
  const handler = journalHandler(service);
  assertEquals(
    (await handler(request("journal-entries", "/?limit=10"))).status,
    200,
  );
  assertEquals(
    (await handler(request("journal-entries", `/${journalId}`))).status,
    200,
  );
  assertEquals(
    (await handler(
      request("journal-entries", "/", { method: "POST", body: "{}" }),
    )).status,
    404,
  );
  assertEquals(service.calls, [`list:10`, `detail:${journalId}`]);
});

Deno.test("Journal handler rejects AR Clerk, System Admin, cross-company, and malformed detail before data access", async () => {
  const service = new FakeJournalService();
  for (const role of ["AR Clerk", "System Admin"] as const) {
    assertEquals(
      (await journalHandler(service, role)(request("journal-entries"))).status,
      403,
    );
  }
  const wrong = request("journal-entries");
  wrong.headers.set("X-Company-Id", otherCompanyId);
  assertEquals((await journalHandler(service)(wrong)).status, 403);
  assertEquals(
    (await journalHandler(service)(request("journal-entries", "/not-a-uuid")))
      .status,
    400,
  );
  assertEquals(service.calls.length, 0);
});

Deno.test("Journal service forwards authenticated tenant/user and every bounded filter", async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    rpc: (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return Promise.resolve({
        data: { rows: [journalItem], has_more: true },
        error: null,
      });
    },
  };
  const service = new JournalReadService(client as never);
  const result = await service.list(auth("Finance Manager"), {
    limit: 25,
    cursor: { created_at: journalItem.created_at, id: journalId },
    q: "INV",
    dateFrom: "2026-08-01",
    dateTo: "2026-08-31",
    sourceType: "INV",
    currency: "MYR",
    accountCode: "1100-AR",
  });
  assert(result.meta.next_cursor !== null);
  assertEquals(calls[0].params.p_company_id, companyId);
  assertEquals(calls[0].params.p_user_id, userId);
  assertEquals(calls[0].params.p_account_code, "1100-AR");
});

Deno.test("Journal service preserves decimal strings and rejects malformed/cross-shaped RPC data", async () => {
  const valid = new JournalReadService(
    {
      rpc: () => Promise.resolve({ data: journalDetail, error: null }),
    } as never,
  );
  assertEquals(
    (await valid.detail(auth("Auditor"), journalId)).total_debit,
    "137.42",
  );
  const incomplete = new JournalReadService(
    {
      rpc: () =>
        Promise.resolve({
          data: { ...journalDetail, lines: journalDetail.lines.slice(0, 1) },
          error: null,
        }),
    } as never,
  );
  await assertRejects(
    () => incomplete.detail(auth("Auditor"), journalId),
    Error,
    "invalid result",
  );
  for (
    const malformed of [
      { ...journalItem, total_debit: 137.42 },
      {
        ...journalItem,
        source: {
          entity_type: "sql_table",
          entity_id: sourceId,
          entity_number: "x",
        },
      },
      { ...journalItem, line_count: -1 },
    ]
  ) {
    const service = new JournalReadService(
      {
        rpc: () =>
          Promise.resolve({
            data: { rows: [malformed], has_more: false },
            error: null,
          }),
      } as never,
    );
    await assertRejects(
      () =>
        service.list(auth("Finance Manager"), {
          limit: 25,
          cursor: null,
          q: null,
          dateFrom: null,
          dateTo: null,
          sourceType: null,
          currency: null,
          accountCode: null,
        }),
      Error,
      "invalid result",
    );
  }
});

Deno.test("Audit contract round-trips its stable timestamp/event cursor", () => {
  const cursor = { occurred_at: auditEvent.occurred_at, event_id: eventId };
  assertEquals(parseAuditCursor(encodeAuditCursor(cursor)), cursor);
  validateAuditEventId(eventId);
});

Deno.test("Audit list contract accepts bounded event, entity, actor, result, date, and identifier filters", () => {
  const params = parseAuditListParams(
    new URL(
      `https://example.test/?limit=50&action=posted&entity_type=invoice&actor_type=user&actor_user_id=${userId}&result=open&q=INV-202608&date_from=2026-08-01&date_to=2026-08-31`,
    ),
  );
  assertEquals(params.entityType, "invoice");
  assertEquals(params.actorType, "user");
  assertEquals(params.actorUserId, userId);
});

Deno.test("Audit contract rejects malformed cursors, duplicate filters, bad actors, IDs, and unbounded extraction", () => {
  for (
    const url of [
      "https://example.test/?cursor=bad",
      "https://example.test/?limit=1&limit=2",
      "https://example.test/?limit=51",
      "https://example.test/?actor_type=robot",
      "https://example.test/?actor_user_id=nope",
      "https://example.test/?entity_type=oauth_token",
      `https://example.test/?q=${"x".repeat(101)}`,
    ]
  ) assertRejects(() => Promise.resolve(parseAuditListParams(new URL(url))));
  assertRejects(() =>
    Promise.resolve(validateAuditEventId("raw-table:SELECT *"))
  );
  assertRejects(() =>
    Promise.resolve(validateAuditEventId(`invoice_posted:${"-".repeat(36)}`))
  );
});

Deno.test("Audit role matrix permits Finance Manager and Auditor only", () => {
  for (const role of ["Finance Manager", "Auditor"] as const) {
    requireAuditReadAccess(auth(role));
  }
  for (const role of ["AR Clerk", "AR Supervisor", "System Admin"] as const) {
    assertRejects(
      () => Promise.resolve(requireAuditReadAccess(auth(role))),
      AuthorizationError,
    );
  }
});

class FakeAuditService implements AuditReadServiceContract {
  calls: string[] = [];
  list(
    _auth: AuthContext,
    params: Parameters<AuditReadServiceContract["list"]>[1],
  ): Promise<AuditListResult> {
    this.calls.push(`list:${params.limit}`);
    return Promise.resolve({
      data: [auditEvent],
      meta: { limit: params.limit, has_more: false, next_cursor: null },
    });
  }
  detail(_auth: AuthContext, id: string): Promise<AuditEvent> {
    this.calls.push(`detail:${id}`);
    return Promise.resolve(auditEvent);
  }
}

function auditHandler(
  service: AuditReadServiceContract,
  role: AuthContext["highestRole"] = "Finance Manager",
) {
  return createAuditReadHandler({
    authenticate: (_req, suppliedCompany) =>
      suppliedCompany === companyId
        ? Promise.resolve(auth(role))
        : Promise.reject(
          new AuthorizationError("Company context is not permitted."),
        ),
    createService: () => service,
  });
}

Deno.test("Audit handler exposes only GET list/detail and never a mutation route", async () => {
  const service = new FakeAuditService();
  const handler = auditHandler(service);
  assertEquals(
    (await handler(request("audit-trail", "/?limit=10"))).status,
    200,
  );
  assertEquals(
    (await handler(request("audit-trail", `/${eventId}`))).status,
    200,
  );
  assertEquals(
    (await handler(request("audit-trail", "/", { method: "DELETE" }))).status,
    404,
  );
  assertEquals(service.calls, [`list:10`, `detail:${eventId}`]);
});

Deno.test("Audit handler rejects Supervisor, Clerk, System Admin, cross-company, and malformed event IDs", async () => {
  const service = new FakeAuditService();
  for (const role of ["AR Clerk", "AR Supervisor", "System Admin"] as const) {
    assertEquals(
      (await auditHandler(service, role)(request("audit-trail"))).status,
      403,
    );
  }
  const wrong = request("audit-trail");
  wrong.headers.set("X-Company-Id", otherCompanyId);
  assertEquals((await auditHandler(service)(wrong)).status, 403);
  assertEquals(
    (await auditHandler(service)(request("audit-trail", "/unsafe"))).status,
    400,
  );
  assertEquals(service.calls.length, 0);
});

Deno.test("Audit service forwards only authenticated tenant/user and bounded filters", async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const service = new AuditReadService(
    {
      rpc: (name: string, params: Record<string, unknown>) => {
        calls.push({ name, params });
        return Promise.resolve({
          data: { rows: [auditEvent], has_more: true },
          error: null,
        });
      },
    } as never,
  );
  const result = await service.list(auth("Finance Manager"), {
    limit: 25,
    cursor: { occurred_at: auditEvent.occurred_at, event_id: eventId },
    dateFrom: "2026-08-01",
    dateTo: "2026-08-31",
    action: "posted",
    entityType: "invoice",
    actorType: "user",
    actorUserId: userId,
    result: "open",
    q: "INV",
  });
  assert(result.meta.next_cursor !== null);
  assertEquals(calls[0].params.p_company_id, companyId);
  assertEquals(calls[0].params.p_actor_user_id, userId);
});

Deno.test("Audit service rejects arbitrary metadata, secrets, fabricated system actors, and malformed events", async () => {
  for (
    const malformed of [
      {
        ...auditEvent,
        metadata: { ...auditEvent.metadata, access_token: "never" },
      },
      {
        ...auditEvent,
        actor: {
          type: "system",
          user_id: userId,
          display_name: null,
          role: null,
        },
      },
      { ...auditEvent, source_kind: "raw_row", metadata: {} },
      { ...auditEvent, event_id: "invoice_posted:not-a-uuid" },
    ]
  ) {
    const service = new AuditReadService(
      {
        rpc: () =>
          Promise.resolve({
            data: { rows: [malformed], has_more: false },
            error: null,
          }),
      } as never,
    );
    await assertRejects(
      () =>
        service.list(auth("Auditor"), {
          limit: 25,
          cursor: null,
          dateFrom: null,
          dateTo: null,
          action: null,
          entityType: null,
          actorType: null,
          actorUserId: null,
          result: null,
          q: null,
        }),
      Error,
      "invalid result",
    );
  }
});

Deno.test("Audit detail returns one allow-listed event and null becomes safe Not Found", async () => {
  const valid = new AuditReadService(
    { rpc: () => Promise.resolve({ data: auditEvent, error: null }) } as never,
  );
  assertEquals(
    (await valid.detail(auth("Auditor"), eventId)).event_id,
    eventId,
  );
  const missing = new AuditReadService(
    { rpc: () => Promise.resolve({ data: null, error: null }) } as never,
  );
  await assertRejects(
    () => missing.detail(auth("Auditor"), eventId),
    Error,
    "not found",
  );
});

Deno.test("Migration 044 is read-only, tenant-scoped, role-governed, keyset ordered, and service-role-only", async () => {
  const migration = await Deno.readTextFile(
    "../../../database/044_post_gate_e_journal_audit_read_viewers.sql",
  );
  for (
    const required of [
      "WHERE je.company_id = p_company_id",
      "account.company_id = p_company_id",
      "ur.role IN ('AR Supervisor', 'Finance Manager', 'Auditor')",
      "ur.role IN ('Finance Manager', 'Auditor')",
      "source.created_at = p_cursor_created_at AND source.id < p_cursor_id",
      "event.occurred_at = p_cursor_occurred_at AND event.event_id < p_cursor_event_id",
      "LIMIT p_limit + 1",
      "SET search_path = ''",
      "FROM PUBLIC, anon, authenticated, service_role",
      "TO service_role",
      "jsonb_strip_nulls",
      "'value_redacted', true",
      "WHEN event.actor_type = 'user' AND event.actor_user_id IS NOT NULL THEN 'user'",
      "ELSE 'unknown'",
      "lower(event.result) = p_result",
      "lower(regexp_replace(event.event_type",
      "'automation_commands_insert','automation_commands_update'",
      "'automation_exceptions_insert','automation_exceptions_update'",
    ]
  ) assert(migration.includes(required), `Migration 044 missing: ${required}`);
  assert(!/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\s+/imu.test(migration));
  assert(!migration.includes("auth.users"));
  assert(!migration.includes("safe_metadata', event.safe_metadata"));
  assert(!migration.includes("'automation_command_insert'"));
  assert(!migration.includes("'automation_exception_insert'"));
});

Deno.test("Migration 044 source vocabulary and source-link mapping remain bounded", async () => {
  const migration = await Deno.readTextFile(
    "../../../database/044_post_gate_e_journal_audit_read_viewers.sql",
  );
  assert(migration.includes("('INV','RCT','CN','DN','REV','ADJ','WO')"));
  assert(migration.includes("WHEN je.source_type = 'RCT'"));
  assert(migration.includes("ELSE NULL"));
  assert(!migration.includes("'/invoices/' ||"));
  assert(!migration.includes("table_name"));
});

Deno.test("Migration 044b is rollback-only and checks zero source-row mutation", async () => {
  const smoke = await Deno.readTextFile(
    "../../../database/044b_post_gate_e_journal_audit_read_viewers_smoke_tests.sql",
  );
  assert(smoke.trimStart().startsWith("-- ROLLBACK-ONLY"));
  assert(smoke.includes("BEGIN;"));
  assert(smoke.trimEnd().endsWith("ROLLBACK;"));
  assert(!/\bCOMMIT\b/u.test(smoke));
  assert(smoke.includes("cross-company detail leaked"));
  assert(smoke.includes("a source row count changed"));
});
