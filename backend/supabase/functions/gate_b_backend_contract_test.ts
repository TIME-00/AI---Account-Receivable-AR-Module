import type { AuthContext } from "./_shared/auth.ts";
import { AuthorizationError } from "./_shared/errors.ts";
import {
  encodeNotificationCursor,
  parseNotificationCursor,
  parseNotificationKey,
  parseNotificationListParams,
  parseReadAllBody,
  parseReadOneBody,
} from "./notifications/contract.ts";
import { createNotificationHandler } from "./notifications/index.ts";
import type {
  NotificationListResult,
  NotificationServiceContract,
} from "./notifications/service.ts";
import { NotificationService } from "./notifications/service.ts";

const read = (path: string) =>
  Deno.readTextFile(new URL(path, import.meta.url));

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(
  actual: T,
  expected: T,
  message = "Values differ",
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

const companyId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const batchId = "30000000-0000-4000-8000-000000000001";
const notificationKey = `import:${batchId}:import_error`;
const managerAuth: AuthContext = {
  companyId,
  userId,
  roles: ["Finance Manager"],
  highestRole: "Finance Manager",
  email: null,
};

function expectThrows(action: () => unknown, fragment: string): void {
  try {
    action();
  } catch (error) {
    assert(
      String(error).includes(fragment),
      `Expected error containing ${fragment}`,
    );
    return;
  }
  throw new Error(`Expected error containing ${fragment}`);
}

Deno.test("Gate B migration is one guarded forward contract with no cron or business rewrite", async () => {
  const migration = await read(
    "../../../database/032_post_batch_9d_gate_b_notifications_and_rating_drilldown.sql",
  );

  for (
    const required of [
      "BEGIN;",
      "COMMIT;",
      "SET LOCAL lock_timeout = '5s'",
      "SET LOCAL statement_timeout = '60s'",
      "CREATE FUNCTION public.ar_aging_by_customer(",
      "p_credit_rating TEXT",
      "AND (p_credit_rating IS NULL OR c.credit_rating = p_credit_rating)",
      "AND i.invoice_date <= v_as_of_date",
      "CREATE TABLE public.notification_acknowledgements",
      "UNIQUE (company_id, user_id, notification_key)",
      "REFERENCES public.import_batches(id) ON DELETE CASCADE",
      "ALTER TABLE public.notification_acknowledgements ENABLE ROW LEVEL SECURITY",
      "CREATE POLICY notification_ack_self_select",
      "GRANT SELECT ON TABLE public.notification_acknowledgements TO authenticated",
      "TO service_role",
    ]
  ) {
    assert(
      migration.includes(required),
      `Missing migration contract: ${required}`,
    );
  }

  for (
    const prohibited of [
      "CREATE EXTENSION pg_cron",
      "cron.schedule",
      "UPDATE public.invoices",
      "UPDATE public.receipts",
      "DELETE FROM public.invoices",
      "DELETE FROM public.receipts",
      "LEGACY_UNVERIFIED",
    ]
  ) {
    assert(
      !migration.includes(prohibited),
      `Prohibited Gate B SQL found: ${prohibited}`,
    );
  }
});

Deno.test("Gate B aging overload is exact, backward compatible, scoped, and reconciliation-safe", async () => {
  const migration = await read(
    "../../../database/032_post_batch_9d_gate_b_notifications_and_rating_drilldown.sql",
  );
  const service = await read("./reports/service.ts");
  const handler = await read("./reports/index.ts");

  assert(migration.includes(
    "'public.ar_aging_by_customer(uuid,uuid,text,date,integer,integer)'",
  ));
  assert(migration.includes(
    "'public.ar_aging_by_customer(uuid,uuid,text,date,integer,integer,text)'",
  ));
  assert(migration.includes("rating overload must not have defaults"));
  assert(
    migration.includes("expected exactly two unambiguous aging signatures"),
  );
  assert(migration.includes("SET search_path = ''"));
  assert(migration.includes("SECURITY INVOKER"));
  assert(migration.includes("TO authenticated"));
  assert(migration.includes("c.is_deleted = false"));
  assert(migration.includes("c.is_hidden = false"));
  assert(migration.includes("p_scope_mode = 'company'"));
  assert(migration.includes("uca.user_id = p_user_id"));
  assert(migration.includes("WHERE cg.base_total > 0"));
  assert(migration.includes(
    "ORDER BY cg.base_total DESC, cg.customer_name, cg.customer_id",
  ));
  assert(service.includes("p_credit_rating: creditRating ?? null"));
  assert(handler.includes(
    "validateEnum(creditRatingText, CREDIT_RATINGS, 'credit_rating')",
  ));
});

Deno.test("Gate B notification cursor round-trips exact descending tuple authority", () => {
  const cursor = {
    created_at: "2026-07-26T15:30:45.123Z",
    notification_key: notificationKey,
  };
  const encoded = encodeNotificationCursor(cursor);
  assert(/^[A-Za-z0-9_-]+$/.test(encoded));
  assertEquals(parseNotificationCursor(encoded), cursor);

  const postgresCursor = {
    created_at: "2026-07-26T15:30:45.123456+00:00",
    notification_key: notificationKey,
  };
  assertEquals(
    parseNotificationCursor(encodeNotificationCursor(postgresCursor)),
    postgresCursor,
  );

  const url = new URL(
    `https://example.test/notifications?limit=20&read_state=unread&type=import_error&cursor=${encoded}`,
  );
  assertEquals(parseNotificationListParams(url), {
    limit: 20,
    cursor,
    readState: "unread",
    type: "import_error",
  });

  for (
    const malformed of [
      "not+base64",
      "e30",
      encodeNotificationCursor({
        created_at: "not-a-date",
        notification_key: notificationKey,
      }),
    ]
  ) {
    expectThrows(() => parseNotificationCursor(malformed), "cursor");
  }
  expectThrows(
    () =>
      parseNotificationCursor(encodeNotificationCursor({
        created_at: cursor.created_at,
        notification_key: "other:key",
      })),
    "notification_key",
  );
});

Deno.test("Gate B notification request validators reject malformed keys, bodies, states, and limits", () => {
  assertEquals(parseNotificationKey(notificationKey), {
    notificationKey,
    importBatchId: batchId,
    conditionType: "import_error",
  });
  assertEquals(parseReadOneBody({ notification_key: notificationKey }), {
    notificationKey,
    importBatchId: batchId,
    conditionType: "import_error",
  });
  assertEquals(parseReadAllBody({}), { type: null });
  assertEquals(parseReadAllBody({ type: "import_review" }), {
    type: "import_review",
  });

  expectThrows(
    () =>
      parseReadOneBody({ notification_key: notificationKey, user_id: userId }),
    "unsupported",
  );
  expectThrows(() => parseReadAllBody({ type: "overdue_ar" }), "import_error");
  expectThrows(
    () =>
      parseNotificationListParams(
        new URL("https://x.test/notifications?limit=21"),
      ),
    "limit",
  );
  expectThrows(
    () =>
      parseNotificationListParams(
        new URL("https://x.test/notifications?read_state=invalid"),
      ),
    "read_state",
  );
  expectThrows(
    () =>
      parseNotificationListParams(
        new URL("https://x.test/notifications?company_id=forged"),
      ),
    "not supported",
  );
  expectThrows(
    () =>
      parseNotificationListParams(
        new URL("https://x.test/notifications?limit=10&limit=20"),
      ),
    "must appear once",
  );
});

class FakeNotificationService implements NotificationServiceContract {
  calls: Array<{ method: string; value?: unknown }> = [];

  list(
    _auth: AuthContext,
    params: Parameters<NotificationServiceContract["list"]>[1],
  ): Promise<NotificationListResult> {
    this.calls.push({ method: "list", value: params });
    return Promise.resolve({
      data: [{
        notification_key: notificationKey,
        type: "import_error",
        title: "Import completed with errors",
        message: "Synthetic import has 1 error row.",
        severity: "error",
        created_at: "2026-07-26T15:30:45.123Z",
        source: { type: "import_batch", id: batchId },
        deep_link: `/imports/${batchId}`,
        read_at: null,
      }],
      meta: { limit: params.limit, next_cursor: null, has_more: false },
    });
  }

  unreadCount(): Promise<number> {
    this.calls.push({ method: "unreadCount" });
    return Promise.resolve(25);
  }

  readOne(
    _auth: AuthContext,
    key: ReturnType<typeof parseNotificationKey>,
  ): Promise<{ notification_key: string; read_at: string }> {
    this.calls.push({ method: "readOne", value: key });
    return Promise.resolve({
      notification_key: key.notificationKey,
      read_at: "2026-07-26T15:31:00.000Z",
    });
  }

  readAll(
    _auth: AuthContext,
    type: "import_error" | "import_review" | null,
  ): Promise<{ acknowledged_count: number; completed_at: string }> {
    this.calls.push({ method: "readAll", value: type });
    return Promise.resolve({
      acknowledged_count: 25,
      completed_at: "2026-07-26T15:32:00.000Z",
    });
  }
}

function handlerWith(
  service: NotificationServiceContract,
  auth: AuthContext = managerAuth,
  expectedCompany = companyId,
): (req: Request) => Promise<Response> {
  return createNotificationHandler({
    authenticate: (_req, suppliedCompany) => {
      if (suppliedCompany !== expectedCompany) {
        return Promise.reject(
          new AuthorizationError("Company context is not permitted."),
        );
      }
      return Promise.resolve(auth);
    },
    createService: () => service,
  });
}

function request(
  path: string,
  init: RequestInit = {},
  suppliedCompany = companyId,
): Request {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer synthetic-test-token");
  headers.set("X-Company-Id", suppliedCompany);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return new Request(`https://example.test/functions/v1/notifications${path}`, {
    ...init,
    headers,
  });
}

Deno.test("Gate B exact notification routes expose list, independent unread count, read-one, and server-derived read-all", async () => {
  const service = new FakeNotificationService();
  const handler = handlerWith(service);

  const listResponse = await handler(request("/?limit=20&read_state=unread"));
  assertEquals(listResponse.status, 200);
  const listBody = await responseBody(listResponse);
  assertEquals((listBody.meta as Record<string, unknown>).limit, 20);

  const countResponse = await handler(request("/unread-count"));
  assertEquals(countResponse.status, 200);
  assertEquals(
    ((await responseBody(countResponse)).data as Record<string, unknown>)
      .unread_count,
    25,
  );

  const readResponse = await handler(request("/read", {
    method: "POST",
    body: JSON.stringify({ notification_key: notificationKey }),
  }));
  assertEquals(readResponse.status, 200);

  const readAllResponse = await handler(request("/read-all", {
    method: "POST",
    body: JSON.stringify({ type: "import_error" }),
  }));
  assertEquals(readAllResponse.status, 200);

  assertEquals(service.calls.map((call) => call.method), [
    "list",
    "unreadCount",
    "readOne",
    "readAll",
  ]);
  assertEquals(service.calls[3].value, "import_error");

  const prohibitedRoute = await handler(request(`/${notificationKey}/read`, {
    method: "POST",
    body: "{}",
  }));
  assertEquals(prohibitedRoute.status, 404);
});

Deno.test("Gate B notification handler fails closed before service for invalid or unauthorized requests", async () => {
  const service = new FakeNotificationService();
  const handler = handlerWith(service);

  const malformed = await handler(request("/?limit=50"));
  assertEquals(malformed.status, 400);
  assertEquals(service.calls.length, 0);

  const mixedBody = await handler(request("/read", {
    method: "POST",
    body: JSON.stringify({
      notification_key: notificationKey,
      user_id: "forged",
    }),
  }));
  assertEquals(mixedBody.status, 400);
  assertEquals(service.calls.length, 0);

  const wrongCompany = await handlerWith(service)(
    request("/", {}, "40000000-0000-4000-8000-000000000001"),
  );
  assertEquals(wrongCompany.status, 403);
  assertEquals(service.calls.length, 0);

  const systemAdmin: AuthContext = {
    ...managerAuth,
    roles: ["System Admin"],
    highestRole: "System Admin",
  };
  const unauthorized = await handlerWith(service, systemAdmin)(request("/"));
  assertEquals(unauthorized.status, 403);
  assertEquals(service.calls.length, 0);
});

Deno.test("Gate B notification handler sanitizes unexpected database details", async () => {
  const failingService: NotificationServiceContract = {
    list: () =>
      Promise.reject(
        new Error("relation private_notification_table does not exist"),
      ),
    unreadCount: () => Promise.resolve(0),
    readOne: () =>
      Promise.resolve({
        notification_key: notificationKey,
        read_at: "2026-07-26T15:31:00.000Z",
      }),
    readAll: () =>
      Promise.resolve({
        acknowledged_count: 0,
        completed_at: "2026-07-26T15:32:00.000Z",
      }),
  };
  const response = await handlerWith(failingService)(request("/"));
  const body = await responseBody(response);
  const serialized = JSON.stringify(body);

  assertEquals(response.status, 500);
  assert(serialized.includes("INTERNAL_ERROR"));
  assert(!serialized.includes("private_notification_table"));
  assert(!serialized.includes("relation"));
});

Deno.test("Gate B unknown or inaccessible notification sources use one safe 404 envelope", async () => {
  const inaccessibleClient = {
    rpc: () =>
      Promise.resolve({
        data: null,
        error: {
          message: "NOT_FOUND: notification is not actionable or accessible",
        },
      }),
  };
  const service = new NotificationService(inaccessibleClient as never);
  const response = await handlerWith(service)(request("/read", {
    method: "POST",
    body: JSON.stringify({ notification_key: notificationKey }),
  }));
  const body = await responseBody(response);
  const error = body.error as Record<string, unknown>;

  assertEquals(response.status, 404);
  assertEquals(error.code, "NOT_FOUND");
  assertEquals(
    error.message,
    "NOT_FOUND: notification is not actionable or accessible",
  );
  assert(!JSON.stringify(body).includes("SQL"));
  assert(!JSON.stringify(body).includes("relation"));
});

class RpcCaptureClient {
  calls: Array<{ functionName: string; params: Record<string, unknown> }> = [];

  rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<{ data: unknown; error: null }> {
    this.calls.push({ functionName, params });
    if (functionName === "notification_list_import_alerts") {
      return Promise.resolve({
        data: {
          rows: [{
            notification_key: notificationKey,
            type: "import_error",
            title: "Import completed with errors",
            message: "Synthetic",
            severity: "error",
            created_at: "2026-07-26T15:30:45.123Z",
            source: { type: "import_batch", id: batchId },
            deep_link: `/imports/${batchId}`,
            read_at: null,
          }],
          has_more: true,
        },
        error: null,
      });
    }
    if (functionName === "notification_unread_import_alert_count") {
      return Promise.resolve({ data: 25, error: null });
    }
    if (functionName === "notification_mark_import_read") {
      return Promise.resolve({
        data: {
          notification_key: notificationKey,
          read_at: "2026-07-26T15:31:00.000Z",
        },
        error: null,
      });
    }
    if (functionName === "notification_mark_all_import_read") {
      return Promise.resolve({
        data: {
          acknowledged_count: 25,
          completed_at: "2026-07-26T15:32:00.000Z",
        },
        error: null,
      });
    }
    return Promise.resolve({ data: 0, error: null });
  }
}

Deno.test("Gate B NotificationService forwards only authenticated context and bounded maintenance authority", async () => {
  const client = new RpcCaptureClient();
  const service = new NotificationService(client as never);
  const cursor = {
    created_at: "2026-07-26T15:30:45.123Z",
    notification_key: notificationKey,
  };

  const list = await service.list(managerAuth, {
    limit: 20,
    cursor,
    readState: "unread",
    type: "import_error",
  });
  assertEquals(list.meta.has_more, true);
  assert(list.meta.next_cursor !== null);
  assertEquals(parseNotificationCursor(list.meta.next_cursor), cursor);

  assertEquals(await service.unreadCount(managerAuth), 25);
  await service.readOne(managerAuth, parseNotificationKey(notificationKey));
  await service.readAll(managerAuth, null);

  const listCall = client.calls[0];
  assertEquals(listCall.params.p_company_id, companyId);
  assertEquals(listCall.params.p_user_id, userId);
  assertEquals(listCall.params.p_cursor_created_at, cursor.created_at);
  assertEquals(listCall.params.p_cursor_notification_key, notificationKey);

  const pruneCalls = client.calls.filter((call) =>
    call.functionName === "notification_prune_import_acknowledgements"
  );
  assertEquals(pruneCalls.length, 2);
  assert(pruneCalls.every((call) => call.params.p_limit === 500));
  assert(
    pruneCalls.every((call) =>
      call.params.p_company_id === companyId && call.params.p_user_id === userId
    ),
  );
});

Deno.test("Gate B SQL contract fixes exact order, tie-break, retention, cascade, and bounded pruning", async () => {
  const migration = await read(
    "../../../database/032_post_batch_9d_gate_b_notifications_and_rating_drilldown.sql",
  );

  for (
    const required of [
      "ORDER BY a.created_at DESC, a.notification_key DESC",
      "a.created_at < p_cursor_created_at",
      "a.created_at = p_cursor_created_at",
      "a.notification_key < p_cursor_notification_key",
      "LIMIT p_limit + 1",
      "p_limit > 20",
      "notification_type IN ('import_error', 'import_review')",
      "ON CONFLICT (company_id, user_id, notification_key)",
      "clock_timestamp() - INTERVAL '90 days'",
      "LIMIT p_limit",
      "p_limit > 500",
      "NOT EXISTS (",
      "FROM public.notification_import_alerts(p_company_id) active",
    ]
  ) {
    assert(
      migration.includes(required),
      `Missing notification SQL: ${required}`,
    );
  }
});
