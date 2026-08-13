import { AuthenticationError, ValidationError } from "./_shared/errors.ts";
import type { AuthContext } from "./_shared/auth.ts";
import {
  parseUiThemePatch,
  requireUiTheme,
  type UiTheme,
} from "./auth/contract.ts";
import {
  type AuthHandlerDependencies,
  createAuthHandler,
} from "./auth/index.ts";
import {
  UiPreferenceService,
  type UiPreferenceServiceContract,
} from "./auth/preference-service.ts";
import { AutomationService } from "./automation/service.ts";
import { CustomerService } from "./customers/service.ts";
import { ImportService } from "./imports/service.ts";
import { InvoiceService } from "./invoices/service.ts";

const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "20000000-0000-4000-8000-000000000002";

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
  callback: () => unknown | Promise<unknown>,
  expected: new (...args: never[]) => Error,
): Promise<void> {
  try {
    await callback();
  } catch (error) {
    assert(
      error instanceof expected,
      `Expected ${expected.name}, received ${String(error)}`,
    );
    return;
  }
  throw new Error("Expected callback to reject");
}

function memoryPreferenceClient(initial: Array<[string, UiTheme]> = []) {
  const rows = new Map<string, UiTheme>(initial);
  const writes: Array<{ user_id: string; theme_preference: UiTheme }> = [];
  return {
    rows,
    writes,
    client: {
      from(table: string) {
        assertEquals(table, "user_ui_preferences");
        return {
          select() {
            return {
              eq(_column: string, userId: string) {
                return {
                  maybeSingle: () =>
                    Promise.resolve({
                      data: rows.has(userId)
                        ? {
                          user_id: userId,
                          theme_preference: rows.get(userId),
                        }
                        : null,
                      error: null,
                    }),
                };
              },
            };
          },
          upsert(
            payload: { user_id: string; theme_preference: UiTheme },
            options: { onConflict: string },
          ) {
            assertEquals(options, { onConflict: "user_id" });
            rows.set(payload.user_id, payload.theme_preference);
            writes.push(payload);
            return {
              select() {
                return {
                  single: () => Promise.resolve({ data: payload, error: null }),
                };
              },
            };
          },
        };
      },
    },
  };
}

function handlerDependencies(
  userId: string,
  service: UiPreferenceServiceContract,
  anonymous = false,
): AuthHandlerDependencies {
  return {
    authenticateUser: () =>
      anonymous
        ? Promise.reject(new AuthenticationError())
        : Promise.resolve({ userId, email: null }),
    authenticateCompany: () =>
      Promise.resolve(
        {
          userId,
          companyId: "30000000-0000-4000-8000-000000000003",
          roles: ["AR Clerk"],
          highestRole: "AR Clerk",
          email: null,
        } satisfies AuthContext,
      ),
    createPreferenceService: () => service,
    loadCompany: () => Promise.resolve(null),
  };
}

Deno.test("UI preference parser accepts only dark and light", () => {
  assertEquals(parseUiThemePatch({ theme: "dark" }), "dark");
  assertEquals(parseUiThemePatch({ theme: "light" }), "light");
});

Deno.test("UI preference parser rejects invalid, missing, and additional authority", async () => {
  await assertRejects(
    () => parseUiThemePatch({ theme: "system" }),
    ValidationError,
  );
  await assertRejects(() => parseUiThemePatch({}), ValidationError);
  await assertRejects(
    () => parseUiThemePatch({ theme: "dark", user_id: USER_B }),
    ValidationError,
  );
});

Deno.test("stored preference vocabulary fails closed", async () => {
  assertEquals(requireUiTheme("dark"), "dark");
  await assertRejects(() => requireUiTheme("system"), Error);
});

Deno.test("missing preference resolves to dark without creating a row", async () => {
  const memory = memoryPreferenceClient();
  const service = new UiPreferenceService(memory.client as never);
  assertEquals(await service.get(USER_A), { theme: "dark", source: "default" });
  assertEquals(memory.writes.length, 0);
});

Deno.test("saved dark resolves as saved dark", async () => {
  const memory = memoryPreferenceClient([[USER_A, "dark"]]);
  const service = new UiPreferenceService(memory.client as never);
  assertEquals(await service.get(USER_A), { theme: "dark", source: "saved" });
});

Deno.test("saved light resolves as saved light", async () => {
  const memory = memoryPreferenceClient([[USER_A, "light"]]);
  const service = new UiPreferenceService(memory.client as never);
  assertEquals(await service.get(USER_A), { theme: "light", source: "saved" });
});

Deno.test("preference update is own-user-bound and idempotent", async () => {
  const memory = memoryPreferenceClient();
  const service = new UiPreferenceService(memory.client as never);
  assertEquals(await service.update(USER_A, "light"), {
    theme: "light",
    source: "saved",
  });
  assertEquals(await service.update(USER_A, "light"), {
    theme: "light",
    source: "saved",
  });
  assertEquals(memory.rows.size, 1);
  assertEquals(memory.rows.get(USER_A), "light");
  assert(memory.writes.every((write) => write.user_id === USER_A));
});

Deno.test("GET UI preference authenticates the account without requiring financial role authority", async () => {
  const service: UiPreferenceServiceContract = {
    get: (userId) => {
      assertEquals(userId, USER_A);
      return Promise.resolve({ theme: "dark", source: "default" });
    },
    update: () => Promise.reject(new Error("not called")),
  };
  const response = await createAuthHandler(
    handlerDependencies(USER_A, service),
  )(
    new Request("https://example.test/auth/ui-preferences"),
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).data, {
    theme: "dark",
    source: "default",
  });
});

Deno.test("PATCH derives user id from authentication and accepts no caller user id", async () => {
  let seen: string | null = null;
  const service: UiPreferenceServiceContract = {
    get: () => Promise.reject(new Error("not called")),
    update: (userId, theme) => {
      seen = userId;
      return Promise.resolve({ theme, source: "saved" });
    },
  };
  const handler = createAuthHandler(handlerDependencies(USER_A, service));
  const accepted = await handler(
    new Request("https://example.test/auth/ui-preferences", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-company-id": "ffffffff-ffff-4fff-8fff-ffffffffffff",
      },
      body: JSON.stringify({ theme: "light" }),
    }),
  );
  assertEquals(accepted.status, 200);
  assertEquals(seen, USER_A);
  const rejected = await handler(
    new Request("https://example.test/auth/ui-preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: "dark", user_id: USER_B }),
    }),
  );
  assertEquals(rejected.status, 400);
});

Deno.test("anonymous UI preference requests fail before preference access", async () => {
  let called = false;
  const service: UiPreferenceServiceContract = {
    get: () => {
      called = true;
      return Promise.resolve({ theme: "dark", source: "default" });
    },
    update: () => {
      called = true;
      return Promise.resolve({ theme: "dark", source: "saved" });
    },
  };
  const response = await createAuthHandler(
    handlerDependencies(USER_A, service, true),
  )(
    new Request("https://example.test/auth/ui-preferences"),
  );
  assertEquals(response.status, 401);
  assertEquals(called, false);
});

Deno.test("UI preference routes reject query-string authority", async () => {
  let called = false;
  const service: UiPreferenceServiceContract = {
    get: () => {
      called = true;
      return Promise.resolve({ theme: "dark", source: "default" });
    },
    update: () => Promise.reject(new Error("not called")),
  };
  const response = await createAuthHandler(
    handlerDependencies(USER_A, service),
  )(
    new Request("https://example.test/auth/ui-preferences?user_id=" + USER_B),
  );
  assertEquals(response.status, 400);
  assertEquals(called, false);
});

Deno.test("preference identity is account-level and independent of company header", async () => {
  const seen: string[] = [];
  const service: UiPreferenceServiceContract = {
    get: (userId) => {
      seen.push(userId);
      return Promise.resolve({ theme: "light", source: "saved" });
    },
    update: () => Promise.reject(new Error("not called")),
  };
  const handler = createAuthHandler(handlerDependencies(USER_A, service));
  for (
    const company of [
      "30000000-0000-4000-8000-000000000003",
      "40000000-0000-4000-8000-000000000004",
    ]
  ) {
    const response = await handler(
      new Request("https://example.test/auth/ui-preferences", {
        headers: { "x-company-id": company },
      }),
    );
    assertEquals(response.status, 200);
  }
  assertEquals(seen, [USER_A, USER_A]);
});

Deno.test("existing auth/me company, role, and capability contract is preserved", async () => {
  const service: UiPreferenceServiceContract = {
    get: () => Promise.reject(new Error("not called")),
    update: () => Promise.reject(new Error("not called")),
  };
  const dependencies = handlerDependencies(USER_A, service);
  dependencies.loadCompany = (companyId) =>
    Promise.resolve({
      id: companyId,
      company_code: "COMP-TEST",
      company_name: "Test Company",
      base_currency: "MYR",
      country: "MY",
    });
  const response = await createAuthHandler(dependencies)(
    new Request("https://example.test/auth/me", {
      headers: {
        "x-company-id": "30000000-0000-4000-8000-000000000003",
      },
    }),
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.user, { id: USER_A, email: null });
  assertEquals(body.data.company, {
    id: "30000000-0000-4000-8000-000000000003",
    code: "COMP-TEST",
    name: "Test Company",
    base_currency: "MYR",
    country: "MY",
  });
  assertEquals(body.data.roles, ["AR Clerk"]);
  assertEquals(body.data.highest_role, "AR Clerk");
  assertEquals(body.data.capabilities.can_create_invoice, true);
  assertEquals(body.data.capabilities.can_write_config, false);
});

Deno.test("Migration 045 is presentation-only, RLS-enabled, and closes direct browser grants", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../database/045_post_gate_e_user_ui_preferences.sql",
      import.meta.url,
    ),
  );
  const smoke = await Deno.readTextFile(
    new URL(
      "../../../database/045b_post_gate_e_user_ui_preferences_smoke_tests.sql",
      import.meta.url,
    ),
  );
  assert(migration.includes("CHECK (theme_preference IN ('dark', 'light'))"));
  assert(migration.includes("ENABLE ROW LEVEL SECURITY"));
  assert(migration.includes("(SELECT auth.uid()) = user_id"));
  assert(
    migration.includes(
      "REVOKE ALL ON TABLE public.user_ui_preferences FROM PUBLIC, anon, authenticated",
    ),
  );
  assert(
    migration.includes(
      "REVOKE ALL ON TABLE public.user_ui_preferences FROM service_role",
    ),
  );
  assert(
    migration.includes(
      "GRANT SELECT, INSERT, UPDATE ON TABLE public.user_ui_preferences TO service_role",
    ),
  );
  for (
    const forbidden of [
      "UPDATE public.invoices",
      "UPDATE public.receipts",
      "UPDATE public.automation_settings",
      "DELETE FROM",
      "TRUNCATE",
    ]
  ) {
    assert(
      !migration.includes(forbidden),
      `Migration contains forbidden financial/settings DML: ${forbidden}`,
    );
  }
  assert(smoke.trimStart().startsWith("-- ROLLBACK-ONLY"));
  assert(smoke.trimEnd().endsWith("ROLLBACK;"));
  assert(!/^\s*COMMIT\s*;/mi.test(smoke));
});

function prototypeProvides(
  constructor: { prototype: object },
  method: string,
): boolean {
  let cursor: object | null = constructor.prototype;
  while (cursor && cursor !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(cursor, method)) return true;
    cursor = Object.getPrototypeOf(cursor);
  }
  return false;
}

Deno.test("refactored service facades preserve every representative public domain capability", () => {
  const expectations = [
    [AutomationService, [
      "overview",
      "createMailbox",
      "syncMailbox",
      "processAttachment",
      "allocateCommand",
      "retryException",
      "evaluateReminders",
      "runScheduledCycle",
    ]],
    [ImportService, [
      "uploadFile",
      "startOcr",
      "parseBatch",
      "validateBatch",
      "reviewRow",
      "executeDraftCreation",
    ]],
    [InvoiceService, [
      "createInvoice",
      "addLines",
      "postInvoice",
      "cancelInvoice",
      "listInvoices",
    ]],
    [CustomerService, [
      "createCustomer",
      "classifyImportCustomer",
      "listCustomers",
      "updateCustomer",
      "updateCreditLimit",
      "performCreditCheck",
    ]],
  ] as const;
  for (const [constructor, methods] of expectations) {
    for (const method of methods) {
      assert(
        prototypeProvides(constructor, method),
        `${constructor.name} lost ${method}`,
      );
    }
  }
});

async function productionSources(
  directory: URL,
): Promise<Array<{ path: string; lines: number }>> {
  const results: Array<{ path: string; lines: number }> = [];
  for await (const entry of Deno.readDir(directory)) {
    if (["vendor", "test-support"].includes(entry.name)) continue;
    const child = new URL(
      `${entry.name}${entry.isDirectory ? "/" : ""}`,
      directory,
    );
    if (entry.isDirectory) {
      results.push(...await productionSources(child));
      continue;
    }
    if (
      !/\.(?:ts|tsx|js|jsx)$/.test(entry.name) || /_test\.ts$/.test(entry.name)
    ) {
      continue;
    }
    const source = (await Deno.readTextFile(child)).replace(/\r\n/g, "\n")
      .replace(/\n$/, "");
    results.push({ path: child.pathname, lines: source.split("\n").length });
  }
  return results;
}

Deno.test("maintainable backend production sources stay within the 1000-line ownership boundary", async () => {
  const sources = await productionSources(new URL("./", import.meta.url));
  const oversized = sources.filter((source) => source.lines > 1000);
  assertEquals(oversized, []);
});
