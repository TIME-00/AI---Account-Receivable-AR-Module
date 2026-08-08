import { BusinessError } from "./_shared/errors.ts";
import {
  completeOAuthCallback,
  FixtureOAuthSecretWriter,
  type OAuthSecretContext,
  type OAuthTokenSet,
  parseStoredOAuthTokenSet,
  refreshOAuthTokens,
  serializeOAuthTokenSet,
  validateOAuthRedirectUri,
  VaultOAuthSecretStore,
} from "./automation/oauth.ts";
import { handleAutomationRequest } from "./automation/index.ts";
import { AutomationService } from "./automation/service.ts";
import { FixtureSecretResolver } from "./automation/providers.ts";
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

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
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
    const text = `${String(error)} ${String(record.code ?? "")}`;
    assert(text.includes(expected), `Expected ${expected}, got ${text}`);
    return;
  }
  throw new Error(`Expected rejection containing ${expected}`);
}

const context: OAuthSecretContext = {
  company_id: "10000000-0000-4000-8000-000000000001",
  mailbox_id: "10000000-0000-4000-8000-000000000002",
  provider: "gmail",
  capability: "ingestion",
  secret_reference: "GATE_E_ACTIVATION_TEST_TOKEN",
};

const tokens: OAuthTokenSet = {
  access_token: "fixture-access-token-one",
  refresh_token: "fixture-refresh-token-one",
  expires_at: "2026-08-08T01:00:00.000Z",
  scope: ["https://www.googleapis.com/auth/gmail.readonly"],
  token_type: "Bearer",
};

class FixtureVaultRpcClient {
  payload: string | null = null;
  readonly calls: Array<{ name: string; parameters: Record<string, unknown> }> =
    [];
  fail: string | null = null;

  rpc(name: string, parameters: Record<string, unknown>) {
    this.calls.push({ name, parameters: structuredClone(parameters) });
    if (this.fail === name) {
      return Promise.resolve({
        data: null,
        error: { message: "private failure" },
      });
    }
    if (name === "automation_oauth_secret_write") {
      this.payload = String(parameters.p_secret_payload);
      return Promise.resolve({ data: null, error: null });
    }
    if (name === "automation_oauth_secret_resolve") {
      return Promise.resolve({ data: this.payload, error: null });
    }
    if (name === "automation_oauth_secret_delete") {
      this.payload = null;
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: null, error: { message: "unknown rpc" } });
  }
}

class CallbackDatabase {
  consumed = false;
  mailboxPatch: Record<string, unknown> | null = null;

  constructor(
    readonly stateRow: Record<string, unknown>,
    readonly mailbox: Record<string, unknown>,
  ) {}

  from(table: string) {
    let operation: "select" | "update" = "select";
    let patch: Record<string, unknown> = {};
    const filters: Record<string, unknown> = {};
    const nullFilters = new Set<string>();
    const query = {
      select(_columns?: string) {
        return query;
      },
      update(value: Record<string, unknown>) {
        operation = "update";
        patch = value;
        return query;
      },
      eq(field: string, value: unknown) {
        filters[field] = value;
        return query;
      },
      is(field: string, value: unknown) {
        if (value === null) nullFilters.add(field);
        return query;
      },
      maybeSingle: () => {
        if (table === "automation_oauth_states") {
          if (operation === "update") {
            if (this.consumed && nullFilters.has("consumed_at")) {
              return Promise.resolve({ data: null, error: null });
            }
            this.consumed = true;
            return Promise.resolve({
              data: { id: this.stateRow.id },
              error: null,
            });
          }
          if (
            (filters.provider_type !== undefined &&
              filters.provider_type !== this.stateRow.provider_type) ||
            (this.consumed && nullFilters.has("consumed_at"))
          ) {
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({
            data: { ...this.stateRow, mailbox: this.mailbox },
            error: null,
          });
        }
        if (table === "automation_mailboxes" && operation === "update") {
          this.mailboxPatch = structuredClone(patch);
          return Promise.resolve({
            data: { id: this.mailbox.id },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return query;
  }
}

class RuntimeMailboxDatabase {
  readonly updates: Record<string, unknown>[] = [];

  from(table: string) {
    let patch: Record<string, unknown> = {};
    const query = {
      update: (value: Record<string, unknown>) => {
        assertEquals(table, "automation_mailboxes");
        patch = value;
        return query;
      },
      eq: (_field: string, _value: unknown) => query,
      then: (resolve: (value: unknown) => unknown) => {
        this.updates.push(structuredClone(patch));
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return query;
  }
}

function oauthCallbackFixture(overrides: Record<string, unknown> = {}) {
  const mailbox = {
    id: context.mailbox_id,
    company_id: context.company_id,
    provider_type: "gmail",
    ingestion_secret_ref: context.secret_reference,
    delivery_secret_ref: "GATE_E_ACTIVATION_TEST_DELIVERY",
  };
  return new CallbackDatabase({
    id: "10000000-0000-4000-8000-000000000004",
    company_id: context.company_id,
    mailbox_id: context.mailbox_id,
    provider_type: "gmail",
    redirect_uri:
      "https://example.test/functions/v1/automation/oauth/gmail/callback",
    requested_scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    expires_at: "2026-08-08T00:10:00.000Z",
    created_by: "10000000-0000-4000-8000-000000000005",
    ...overrides,
  }, mailbox);
}

async function withOAuthEnvironment(action: () => Promise<void>) {
  const names = [
    "GMAIL_OAUTH_CLIENT_ID",
    "GMAIL_OAUTH_REDIRECT_URI",
    "SUPABASE_URL",
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, Deno.env.get(name)]),
  );
  Deno.env.set("GMAIL_OAUTH_CLIENT_ID", "fixture-client");
  Deno.env.set(
    "GMAIL_OAUTH_REDIRECT_URI",
    "https://example.test/functions/v1/automation/oauth/gmail/callback",
  );
  Deno.env.set("SUPABASE_URL", "https://example.test");
  try {
    await action();
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

Deno.test("Gate E Vault OAuth store writes, resolves, rotates, and revokes opaque credentials", async () => {
  const client = new FixtureVaultRpcClient();
  const store = new VaultOAuthSecretStore(client as never);
  await store.writeTokenSet(context, tokens);
  assertEquals(await store.resolveTokenSet(context), tokens);
  const rotated = {
    ...tokens,
    access_token: "fixture-access-token-two",
    expires_at: "2026-08-08T02:00:00.000Z",
  };
  await store.writeTokenSet(context, rotated);
  assertEquals(await store.resolveTokenSet(context), rotated);
  await store.deleteTokenSet(context);
  await rejects(
    () => store.resolveTokenSet(context),
    "OAUTH_SECRET_UNAVAILABLE",
  );
  assertEquals(client.calls.map((call) => call.name), [
    "automation_oauth_secret_write",
    "automation_oauth_secret_resolve",
    "automation_oauth_secret_write",
    "automation_oauth_secret_resolve",
    "automation_oauth_secret_delete",
    "automation_oauth_secret_resolve",
  ]);
  for (const call of client.calls) {
    assertEquals(call.parameters.p_company_id, context.company_id);
    assertEquals(call.parameters.p_mailbox_id, context.mailbox_id);
    assertEquals(call.parameters.p_capability, "ingestion");
  }
});

Deno.test("Gate E OAuth token serialization is versioned, strict, and never accepts malformed storage", async () => {
  assertEquals(
    parseStoredOAuthTokenSet(serializeOAuthTokenSet(tokens)),
    tokens,
  );
  await rejects(
    () => Promise.resolve(parseStoredOAuthTokenSet("not-json")),
    "OAUTH_SECRET_INVALID",
  );
  await rejects(
    () =>
      Promise.resolve(parseStoredOAuthTokenSet(JSON.stringify({
        schema_version: "gate-e-oauth.1",
        tokens: { ...tokens, provider_body: "forbidden" },
      }))),
    "OAUTH_SECRET_INVALID",
  );
});

Deno.test("Gate E Vault failures are sanitized and never echo credential values", async () => {
  const client = new FixtureVaultRpcClient();
  client.fail = "automation_oauth_secret_write";
  const store = new VaultOAuthSecretStore(client as never);
  try {
    await store.writeTokenSet(context, tokens);
    throw new Error("write unexpectedly succeeded");
  } catch (error) {
    assert(error instanceof BusinessError);
    const exposed = JSON.stringify({
      code: error.code,
      message: error.message,
      details: error.details,
    });
    assert(!exposed.includes(tokens.access_token));
    assert(!exposed.includes(String(tokens.refresh_token)));
  }
  client.fail = "automation_oauth_secret_resolve";
  try {
    await store.resolveTokenSet(context);
    throw new Error("resolve unexpectedly succeeded");
  } catch (error) {
    assert(error instanceof BusinessError);
    const exposed = JSON.stringify({
      code: error.code,
      message: error.message,
      details: error.details,
    });
    assert(!exposed.includes(tokens.access_token));
    assert(!exposed.includes(String(tokens.refresh_token)));
  }
});

Deno.test("Gate E fixture OAuth store is tenant, mailbox, provider, and capability isolated", async () => {
  const store = new FixtureOAuthSecretWriter();
  await store.writeTokenSet(context, tokens);
  for (
    const changed of [
      { company_id: "10000000-0000-4000-8000-000000000003" },
      { mailbox_id: "10000000-0000-4000-8000-000000000003" },
      { provider: "microsoft" as const },
      { capability: "delivery" as const },
    ]
  ) {
    await rejects(
      () => store.resolveTokenSet({ ...context, ...changed }),
      "OAUTH_SECRET_UNAVAILABLE",
    );
  }
});

Deno.test("Gate E Gmail and Microsoft redirects are provider-specific and fail closed", async () => {
  const gmail =
    "https://kusseuycqgdilychphpq.supabase.co/functions/v1/automation/oauth/gmail/callback";
  const microsoft =
    "https://kusseuycqgdilychphpq.supabase.co/functions/v1/automation/oauth/microsoft/callback";
  const projectUrl = "https://kusseuycqgdilychphpq.supabase.co";
  assertEquals(validateOAuthRedirectUri("gmail", gmail, projectUrl), gmail);
  assertEquals(
    validateOAuthRedirectUri("microsoft", microsoft, projectUrl),
    microsoft,
  );
  for (
    const [provider, uri] of [
      ["gmail", microsoft],
      ["microsoft", gmail],
      [
        "gmail",
        "http://example.test/functions/v1/automation/oauth/gmail/callback",
      ],
      ["gmail", `${gmail}?redirect=attacker.example`],
      [
        "gmail",
        "https://attacker.example/functions/v1/automation/oauth/gmail/callback",
      ],
    ] as const
  ) {
    await rejects(
      () =>
        Promise.resolve(validateOAuthRedirectUri(provider, uri, projectUrl)),
      "OAUTH_NOT_CONFIGURED",
    );
  }
  await rejects(
    () => Promise.resolve(validateOAuthRedirectUri("gmail", gmail, undefined)),
    "OAUTH_NOT_CONFIGURED",
  );
});

Deno.test("Gate E OAuth refresh rotates access credentials while retaining an omitted refresh token", async () => {
  const refreshed = await refreshOAuthTokens({
    configuration: {
      provider: "gmail",
      client_id: "fixture-client",
      client_secret: "fixture-client-secret",
      redirect_uri:
        "https://example.test/functions/v1/automation/oauth/gmail/callback",
    },
    current: tokens,
    fetcher: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "fixture-access-token-rotated",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  assertEquals(refreshed.access_token, "fixture-access-token-rotated");
  assertEquals(refreshed.refresh_token, tokens.refresh_token);
  assertEquals(refreshed.expires_at, "2026-08-08T01:00:00.000Z");
});

Deno.test("Gate E Microsoft refresh uses its tenant endpoint and preserves separate Mail.Read authority", async () => {
  let requestUrl = "";
  let requestBody = "";
  const refreshed = await refreshOAuthTokens({
    configuration: {
      provider: "microsoft",
      client_id: "fixture-client",
      client_secret: "fixture-client-secret",
      redirect_uri:
        "https://example.test/functions/v1/automation/oauth/microsoft/callback",
      tenant: "organizations",
    },
    current: {
      ...tokens,
      scope: ["offline_access", "Mail.Read"],
    },
    fetcher: async (url, init) => {
      requestUrl = String(url);
      requestBody = await new Request(url, init).text();
      return new Response(
        JSON.stringify({
          access_token: "fixture-microsoft-access-rotated",
          refresh_token: "fixture-microsoft-refresh-rotated",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "Mail.Read",
        }),
        { status: 200 },
      );
    },
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  assert(requestUrl.includes("/organizations/oauth2/v2.0/token"));
  assert(requestBody.includes("scope=offline_access+Mail.Read"));
  assert(!requestBody.includes("Mail.Send"));
  assertEquals(refreshed.scope, ["Mail.Read", "offline_access"]);
});

Deno.test("Gate E Microsoft callback proves offline access from the refresh token", async () => {
  const store = new FixtureOAuthSecretWriter();
  const microsoftContext: OAuthSecretContext = {
    ...context,
    provider: "microsoft",
  };
  const result = await completeOAuthCallback({
    configuration: {
      provider: "microsoft",
      client_id: "fixture-client",
      client_secret: "fixture-client-secret",
      redirect_uri:
        "https://example.test/functions/v1/automation/oauth/microsoft/callback",
    },
    code: "fixture-authorization-code",
    secret_context: microsoftContext,
    required_scopes: ["offline_access", "Mail.Read"],
    writer: store,
    fetcher: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "fixture-microsoft-access-token",
            refresh_token: "fixture-microsoft-refresh-token",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "Mail.Read",
          }),
          { status: 200 },
        ),
      ),
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  assertEquals(result.scopes, ["Mail.Read", "offline_access"]);
  assertEquals(store.writes[0].tokens.scope, ["Mail.Read", "offline_access"]);

  await rejects(
    () =>
      completeOAuthCallback({
        configuration: {
          provider: "microsoft",
          client_id: "fixture-client",
          client_secret: "fixture-client-secret",
          redirect_uri:
            "https://example.test/functions/v1/automation/oauth/microsoft/callback",
        },
        code: "fixture-authorization-code",
        secret_context: microsoftContext,
        required_scopes: ["offline_access", "Mail.Read"],
        writer: new FixtureOAuthSecretWriter(),
        fetcher: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: "fixture-microsoft-access-token",
                expires_in: 3600,
                token_type: "Bearer",
                scope: "Mail.Read",
              }),
              { status: 200 },
            ),
          ),
      }),
    "OAUTH_SCOPE_INSUFFICIENT",
  );
});

Deno.test("Gate E runtime refresh persists the rotated Vault bundle and only safe mailbox metadata", async () => {
  await withOAuthEnvironment(async () => {
    const store = new FixtureOAuthSecretWriter();
    const expiring = {
      ...tokens,
      expires_at: "2026-08-08T00:01:00.000Z",
    };
    await store.writeTokenSet(context, expiring);
    const database = new RuntimeMailboxDatabase();
    const service = new AutomationService({
      client: database as never,
      oauthSecretStore: store,
      secretResolver: new FixtureSecretResolver({
        GMAIL_OAUTH_CLIENT_SECRET: "fixture-client-secret",
      }),
      oauthFetcher: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "fixture-runtime-access-rotated",
              refresh_token: "fixture-runtime-refresh-rotated",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "https://www.googleapis.com/auth/gmail.readonly",
            }),
            { status: 200 },
          ),
        ),
      now: () => new Date("2026-08-08T00:00:00.000Z"),
    });
    const accessToken = await service.resolveOAuthAccessTokenForRuntime({
      id: context.mailbox_id,
      company_id: context.company_id,
      provider_type: "gmail",
      ingestion_secret_ref: context.secret_reference,
    }, "ingestion");
    assertEquals(accessToken, "fixture-runtime-access-rotated");
    assertEquals(store.writes.length, 2);
    assertEquals(
      (await store.resolveTokenSet(context)).refresh_token,
      "fixture-runtime-refresh-rotated",
    );
    assertEquals(
      database.updates[0].ingestion_token_expires_at,
      "2026-08-08T01:00:00.000Z",
    );
    const publicMetadata = JSON.stringify(database.updates);
    assert(!publicMetadata.includes("fixture-runtime-access"));
    assert(!publicMetadata.includes("fixture-runtime-refresh"));
  });
});

Deno.test("Gate E runtime refresh marks revoked authorization reconnect-required", async () => {
  await withOAuthEnvironment(async () => {
    const store = new FixtureOAuthSecretWriter();
    await store.writeTokenSet(context, {
      ...tokens,
      expires_at: "2026-08-08T00:01:00.000Z",
    });
    const database = new RuntimeMailboxDatabase();
    const service = new AutomationService({
      client: database as never,
      oauthSecretStore: store,
      secretResolver: new FixtureSecretResolver({
        GMAIL_OAUTH_CLIENT_SECRET: "fixture-client-secret",
      }),
      oauthFetcher: () => Promise.resolve(new Response("{}", { status: 401 })),
      now: () => new Date("2026-08-08T00:00:00.000Z"),
    });
    await rejects(
      () =>
        service.resolveOAuthAccessTokenForRuntime({
          id: context.mailbox_id,
          company_id: context.company_id,
          provider_type: "gmail",
          ingestion_secret_ref: context.secret_reference,
        }, "ingestion"),
      "OAUTH_RECONNECT_REQUIRED",
    );
    assertEquals(database.updates.at(-1)?.reconnect_required, true);
    assertEquals(
      database.updates.at(-1)?.connection_status,
      "reconnect_required",
    );
  });
});

Deno.test("Gate E OAuth refresh fails closed for revoked and unavailable credentials", async () => {
  await rejects(
    () =>
      refreshOAuthTokens({
        configuration: {
          provider: "microsoft",
          client_id: "fixture-client",
          client_secret: "fixture-client-secret",
          redirect_uri:
            "https://example.test/functions/v1/automation/oauth/microsoft/callback",
        },
        current: { ...tokens, scope: ["offline_access", "Mail.Read"] },
        fetcher: () => Promise.resolve(new Response("{}", { status: 401 })),
      }),
    "OAUTH_RECONNECT_REQUIRED",
  );
  await rejects(
    () =>
      refreshOAuthTokens({
        configuration: {
          provider: "gmail",
          client_id: "fixture-client",
          client_secret: "fixture-client-secret",
          redirect_uri:
            "https://example.test/functions/v1/automation/oauth/gmail/callback",
        },
        current: { ...tokens, refresh_token: null },
      }),
    "OAUTH_RECONNECT_REQUIRED",
  );
});

Deno.test("Gate E callback exchanges only after capability scope validation and secure write", async () => {
  const store = new FixtureOAuthSecretWriter();
  const result = await completeOAuthCallback({
    configuration: {
      provider: "gmail",
      client_id: "fixture-client",
      client_secret: "fixture-client-secret",
      redirect_uri:
        "https://example.test/functions/v1/automation/oauth/gmail/callback",
    },
    code: "fixture-authorization-code",
    secret_context: context,
    required_scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    writer: store,
    fetcher: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "fixture-access-token-callback",
            refresh_token: "fixture-refresh-token-callback",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "https://www.googleapis.com/auth/gmail.readonly",
          }),
          { status: 200 },
        ),
      ),
    now: new Date("2026-08-08T00:00:00.000Z"),
  });
  assertEquals(result.secret_reference, context.secret_reference);
  assertEquals(store.writes.length, 1);
  assert(!JSON.stringify(result).includes("fixture-access"));
  assert(!JSON.stringify(result).includes("fixture-refresh"));
});

Deno.test("Gate E service callback atomically claims state and persists only safe mailbox metadata", async () => {
  await withOAuthEnvironment(async () => {
    const database = oauthCallbackFixture();
    const store = new FixtureOAuthSecretWriter();
    const service = new AutomationService({
      client: database as never,
      oauthSecretStore: store,
      secretResolver: new FixtureSecretResolver({
        GMAIL_OAUTH_CLIENT_SECRET: "fixture-client-secret",
      }),
      oauthFetcher: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "fixture-access-token-service",
              refresh_token: "fixture-refresh-token-service",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "https://www.googleapis.com/auth/gmail.readonly",
            }),
            { status: 200 },
          ),
        ),
      now: () => new Date("2026-08-08T00:00:00.000Z"),
    });
    const result = await service.completeOAuth(
      "gmail",
      "d".repeat(64),
      "fixture-authorization-code",
    );
    assertEquals(database.consumed, true);
    assertEquals(store.writes.length, 1);
    assertEquals(result.connection_status, "connected");
    assertEquals(database.mailboxPatch?.connection_status, "connected");
    assert(!JSON.stringify(result).includes("fixture-access"));
    assert(!JSON.stringify(database.mailboxPatch).includes("fixture-access"));
  });
});

Deno.test("Gate E service callback rejects provider mismatch, expired state, and state reuse", async () => {
  await withOAuthEnvironment(async () => {
    const mismatch = oauthCallbackFixture();
    const mismatchService = new AutomationService({
      client: mismatch as never,
      oauthSecretStore: new FixtureOAuthSecretWriter(),
      now: () => new Date("2026-08-08T00:00:00.000Z"),
    });
    await rejects(
      () =>
        mismatchService.completeOAuth(
          "microsoft",
          "e".repeat(64),
          "fixture-authorization-code",
        ),
      "NotFoundError",
    );

    const expired = oauthCallbackFixture({
      expires_at: "2026-08-07T23:59:59.000Z",
    });
    const expiredService = new AutomationService({
      client: expired as never,
      oauthSecretStore: new FixtureOAuthSecretWriter(),
      now: () => new Date("2026-08-08T00:00:00.000Z"),
    });
    await rejects(
      () =>
        expiredService.completeOAuth(
          "gmail",
          "f".repeat(64),
          "fixture-authorization-code",
        ),
      "OAUTH_STATE_EXPIRED",
    );

    const redirectMismatch = oauthCallbackFixture({
      redirect_uri:
        "https://example.test/functions/v1/automation/oauth/microsoft/callback",
    });
    const redirectMismatchService = new AutomationService({
      client: redirectMismatch as never,
      oauthSecretStore: new FixtureOAuthSecretWriter(),
      now: () => new Date("2026-08-08T00:00:00.000Z"),
    });
    await rejects(
      () =>
        redirectMismatchService.completeOAuth(
          "gmail",
          "j".repeat(64),
          "fixture-authorization-code",
        ),
      "OAUTH_STATE_MISMATCH",
    );

    const scopeMismatch = oauthCallbackFixture({
      requested_scopes: [],
    });
    const scopeMismatchService = new AutomationService({
      client: scopeMismatch as never,
      oauthSecretStore: new FixtureOAuthSecretWriter(),
      now: () => new Date("2026-08-08T00:00:00.000Z"),
    });
    await rejects(
      () =>
        scopeMismatchService.completeOAuth(
          "gmail",
          "k".repeat(64),
          "fixture-authorization-code",
        ),
      "OAUTH_STATE_MISMATCH",
    );
    assertEquals(scopeMismatch.consumed, false);

    const reused = oauthCallbackFixture();
    reused.consumed = true;
    const reusedService = new AutomationService({
      client: reused as never,
      oauthSecretStore: new FixtureOAuthSecretWriter(),
      now: () => new Date("2026-08-08T00:00:00.000Z"),
    });
    await rejects(
      () =>
        reusedService.completeOAuth(
          "gmail",
          "g".repeat(64),
          "fixture-authorization-code",
        ),
      "NotFoundError",
    );
  });
});

Deno.test("Gate E callback consumes state but exposes no token when exchange or secure write fails", async () => {
  await withOAuthEnvironment(async () => {
    const exchangeFailure = oauthCallbackFixture();
    const exchangeService = new AutomationService({
      client: exchangeFailure as never,
      oauthSecretStore: new FixtureOAuthSecretWriter(),
      secretResolver: new FixtureSecretResolver({
        GMAIL_OAUTH_CLIENT_SECRET: "fixture-client-secret",
      }),
      oauthFetcher: () => Promise.resolve(new Response("{}", { status: 401 })),
      now: () => new Date("2026-08-08T00:00:00.000Z"),
    });
    await rejects(
      () =>
        exchangeService.completeOAuth(
          "gmail",
          "h".repeat(64),
          "fixture-authorization-code",
        ),
      "OAUTH_RECONNECT_REQUIRED",
    );
    assertEquals(exchangeFailure.consumed, true);
    assertEquals(exchangeFailure.mailboxPatch, null);

    const writeFailure = oauthCallbackFixture();
    const writeService = new AutomationService({
      client: writeFailure as never,
      oauthSecretStore: {
        writeTokenSet: () =>
          Promise.reject(
            new BusinessError(
              "OAUTH_SECRET_WRITE_FAILED",
              "OAuth authorization could not be stored securely.",
              503,
            ),
          ),
        resolveTokenSet: () => Promise.reject(new Error("not used")),
        deleteTokenSet: () => Promise.resolve(),
      },
      secretResolver: new FixtureSecretResolver({
        GMAIL_OAUTH_CLIENT_SECRET: "fixture-client-secret",
      }),
      oauthFetcher: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "fixture-access-token-write-failure",
              refresh_token: "fixture-refresh-token-write-failure",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "https://www.googleapis.com/auth/gmail.readonly",
            }),
            { status: 200 },
          ),
        ),
      now: () => new Date("2026-08-08T00:00:00.000Z"),
    });
    await rejects(
      () =>
        writeService.completeOAuth(
          "gmail",
          "i".repeat(64),
          "fixture-authorization-code",
        ),
      "OAUTH_SECRET_WRITE_FAILED",
    );
    assertEquals(writeFailure.consumed, true);
    assertEquals(writeFailure.mailboxPatch, null);
  });
});

Deno.test("Gate E provider callback is state-authorized and does not require a browser JWT", async () => {
  let authenticated = false;
  let completed = false;
  const query = new URLSearchParams({
    code: "fixture-code",
    state: "a".repeat(64),
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    authuser: "0",
    prompt: "consent",
    iss: "https://accounts.google.com",
    hd: "workspace.example",
  });
  const response = await handleAutomationRequest(
    new Request(
      `https://example.test/automation/oauth/gmail/callback?${query}`,
    ),
    {
      authenticate: () => {
        authenticated = true;
        return Promise.reject(new Error("must not authenticate callback"));
      },
      createService: () => ({
        completeOAuth: () => {
          completed = true;
          return Promise.resolve({
            mailbox_id: context.mailbox_id,
            provider: "gmail",
            capability: "ingestion",
            connection_status: "connected",
            token_expires_at: "2026-08-08T01:00:00.000Z",
            granted_scopes: [
              "https://www.googleapis.com/auth/gmail.readonly",
            ],
          });
        },
      } as unknown as AutomationService),
    },
  );
  assertEquals(response.status, 200);
  assertEquals(authenticated, false);
  assertEquals(completed, true);
  const body = await response.json();
  assertEquals(body.contract_version, "gate-e.1");
  assert(!JSON.stringify(body).includes("access_token"));
  assert(!JSON.stringify(body).includes("refresh_token"));
});

Deno.test("Gate E Gmail callback validates issuer and hosted-domain metadata before exchange", async () => {
  const state = "j".repeat(64);
  const cases = [
    new URLSearchParams({
      code: "fixture-code",
      state,
      iss: "https://attacker.example",
    }),
    new URLSearchParams({
      code: "fixture-code",
      state,
      iss: "accounts.google.com",
    }),
    new URLSearchParams({
      code: "fixture-code",
      state,
      hd: "invalid..example",
    }),
    new URLSearchParams({
      code: "fixture-code",
      state,
      unexpected: "value",
    }),
  ];
  let exchanged = false;
  for (const query of cases) {
    const response = await handleAutomationRequest(
      new Request(
        `https://example.test/automation/oauth/gmail/callback?${query}`,
      ),
      {
        authenticate: () => Promise.reject(new Error("not used")),
        createService: () => ({
          completeOAuth: () => {
            exchanged = true;
            return Promise.resolve({});
          },
        } as unknown as AutomationService),
      },
    );
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.error.code, "VALIDATION_ERROR");
    assert(!JSON.stringify(body).includes("attacker.example"));
  }
  assertEquals(exchanged, false);
});

Deno.test("Gate E callback keeps existing Microsoft parameters but rejects Google-only metadata", async () => {
  const state = "k".repeat(64);
  let completed = 0;
  const accepted = new URLSearchParams({
    code: "fixture-code",
    state,
    scope: "offline_access Mail.Read",
    session_state: "fixture-session",
  });
  const dependencies = {
    authenticate: () => Promise.reject(new Error("not used")),
    createService: () => ({
      completeOAuth: () => {
        completed++;
        return Promise.resolve({
          mailbox_id: context.mailbox_id,
          provider: "microsoft",
          capability: "ingestion",
          connection_status: "connected",
          token_expires_at: "2026-08-08T01:00:00.000Z",
          granted_scopes: ["offline_access", "Mail.Read"],
        });
      },
    } as unknown as AutomationService),
  };
  const acceptedResponse = await handleAutomationRequest(
    new Request(
      `https://example.test/automation/oauth/microsoft/callback?${accepted}`,
    ),
    dependencies,
  );
  assertEquals(acceptedResponse.status, 200);
  assertEquals(completed, 1);

  for (
    const [key, value] of [
      ["iss", "https://accounts.google.com"],
      ["hd", "workspace.example"],
    ] as const
  ) {
    const rejected = new URLSearchParams({
      code: "fixture-code",
      state,
      [key]: value,
    });
    const response = await handleAutomationRequest(
      new Request(
        `https://example.test/automation/oauth/microsoft/callback?${rejected}`,
      ),
      dependencies,
    );
    assertEquals(response.status, 400);
  }
  assertEquals(completed, 1);
});

Deno.test("Gate E provider denial consumes the state through the bounded rejection path", async () => {
  let rejected = false;
  const query = new URLSearchParams({
    error: "access_denied",
    error_description: "private",
    error_uri: "https://accounts.google.com/o/oauth2/error",
    state: "b".repeat(64),
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    authuser: "0",
    prompt: "consent",
    iss: "https://accounts.google.com",
    hd: "workspace.example",
  });
  const response = await handleAutomationRequest(
    new Request(
      `https://example.test/automation/oauth/gmail/callback?${query}`,
    ),
    {
      authenticate: () => Promise.reject(new Error("not used")),
      createService: () => ({
        rejectOAuth: () => {
          rejected = true;
          return Promise.reject(
            new BusinessError(
              "OAUTH_PROVIDER_DENIED",
              "OAuth consent was not completed.",
              409,
            ),
          );
        },
      } as unknown as AutomationService),
    },
  );
  assertEquals(response.status, 409);
  assertEquals(rejected, true);
  const body = await response.json();
  assertEquals(body.error.code, "OAUTH_PROVIDER_DENIED");
  assert(!JSON.stringify(body).includes("private"));
});

Deno.test("Gate E callback rejects missing or malformed code/state without exchange", async () => {
  let invoked = false;
  for (
    const query of [
      "",
      `?state=${"c".repeat(64)}`,
      "?code=fixture-code",
      `?state=${"c".repeat(64)}&code=${"x".repeat(4_097)}`,
    ]
  ) {
    const response = await handleAutomationRequest(
      new Request(
        `https://example.test/automation/oauth/gmail/callback${query}`,
      ),
      {
        authenticate: () => Promise.reject(new Error("not used")),
        createService: () => ({
          completeOAuth: () => {
            invoked = true;
            return Promise.resolve({});
          },
        } as unknown as AutomationService),
      },
    );
    assertEquals(response.status, 400);
  }
  assertEquals(invoked, false);
});

Deno.test("Gate E worker authentication remains dedicated, constant-time, and fail-closed", async () => {
  const request = new Request("https://example.test/automation/worker/run", {
    method: "POST",
    headers: { [AUTOMATION_WORKER_SECRET_HEADER]: "fixture-worker-secret" },
  });
  validateAutomationWorker(request, "fixture-worker-secret");
  await rejects(
    () => Promise.resolve(validateAutomationWorker(request, undefined)),
    "AUTOMATION_WORKER_NOT_CONFIGURED",
  );
  await rejects(
    () => Promise.resolve(validateAutomationWorker(request, "wrong-secret")),
    "AUTHENTICATION_ERROR",
  );
});

Deno.test("Migration 035 installs only Vault boundaries and no scheduler or financial DML", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../database/035_gate_e_secure_oauth_vault.sql",
      import.meta.url,
    ),
  );
  for (
    const name of [
      "automation_oauth_secret_write",
      "automation_oauth_secret_resolve",
      "automation_oauth_secret_delete",
      "automation_guard_oauth_secret_references",
    ]
  ) assert(sql.includes(name));
  assert(sql.includes("vault.decrypted_secrets"));
  assert(sql.includes("secret.description = v_description"));
  assert(
    sql.includes("v_existing_description IS DISTINCT FROM v_description"),
  );
  assert(sql.includes("GRANT EXECUTE ON FUNCTION"));
  assert(sql.includes("TO service_role"));
  assert(!sql.includes("cron.schedule"));
  assert(!sql.match(/INSERT INTO public\.(invoices|receipts|allocations)/i));
});

Deno.test("Gate E OpenAI document intelligence remains disabled until server configuration is valid", async () => {
  const [service, document, openai] = await Promise.all([
    Deno.readTextFile(new URL("./automation/service.ts", import.meta.url)),
    Deno.readTextFile(new URL("./automation/document.ts", import.meta.url)),
    Deno.readTextFile(
      new URL("./automation/openai-document.ts", import.meta.url),
    ),
  ]);
  assert(service.includes("createOpenAIDocumentProvider"));
  assert(service.includes('Deno.env.get("OPENAI_API_KEY")'));
  assert(service.includes('Deno.env.get("OPENAI_DOCUMENT_MODEL")'));
  assert(document.includes("DOCUMENT_INTELLIGENCE_DISABLED"));
  assert(openai.includes('DEFAULT_OPENAI_DOCUMENT_MODEL = "gpt-5.6-luna"'));
  assert(openai.includes("return new DisabledDocumentIntelligenceProvider()"));
  assert(openai.includes("tools: []"));
  assert(!openai.includes("ANTHROPIC_API_KEY"));
  assert(!openai.includes("GOOGLE_API_KEY"));
});
