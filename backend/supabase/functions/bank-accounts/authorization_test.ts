import type { AuthContext } from "../_shared/auth.ts";
import { AuthenticationError, AuthorizationError } from "../_shared/errors.ts";
import type { UserRole } from "../_shared/types.ts";
import {
  createBankAccountsHandler,
  listActiveCompanyBankAccounts,
  requireBankAccountReadAccess,
} from "./index.ts";

const COMPANY_A = "10000000-0000-4000-8000-000000000001";
const COMPANY_B = "20000000-0000-4000-8000-000000000002";
const USER_ID = "10000000-0000-4000-8000-000000000003";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `${message}: expected ${String(expected)}, received ${String(actual)}`,
    );
  }
}

function auth(role: UserRole, companyId = COMPANY_A): AuthContext {
  return {
    userId: USER_ID,
    companyId,
    roles: [role],
    highestRole: role,
    email: null,
  };
}

function request(method = "GET", companyId = COMPANY_A): Request {
  return new Request("https://edge.invalid/bank-accounts", {
    method,
    headers: {
      Authorization: "Bearer synthetic-test-token",
      "X-Company-Id": companyId,
    },
  });
}

function handlerProbe(options: {
  role?: UserRole;
  authenticatedCompanyId?: string;
  authenticationError?: Error;
} = {}) {
  const calls: string[] = [];
  const handler = createBankAccountsHandler({
    authenticate: (_req, requestedCompanyId) => {
      calls.push(`authenticate:${requestedCompanyId}`);
      if (options.authenticationError) {
        return Promise.reject(options.authenticationError);
      }
      if (!options.role) {
        return Promise.resolve({
          ...auth("Auditor", options.authenticatedCompanyId),
          roles: [],
        });
      }
      return Promise.resolve(
        auth(
          options.role,
          options.authenticatedCompanyId ?? requestedCompanyId,
        ),
      );
    },
    listActive: (companyId) => {
      calls.push(`list:${companyId}`);
      return Promise.resolve([
        { id: "bank-a", company_id: companyId, is_active: true },
      ]);
    },
  });
  return { handler, calls };
}

for (
  const role of [
    "AR Clerk",
    "AR Supervisor",
    "Finance Manager",
    "Auditor",
    "System Admin",
  ] as const
) {
  Deno.test(`bank-accounts permits company-scoped read for ${role}`, async () => {
    const probe = handlerProbe({ role });
    const response = await probe.handler(request());
    const body = await response.json();
    assertEquals(response.status, 200, `${role} response status`);
    assertEquals(body.data.length, 1, `${role} row count`);
    assertEquals(
      body.data[0].company_id,
      COMPANY_A,
      `${role} tenant result`,
    );
    assertEquals(
      probe.calls.join(","),
      `authenticate:${COMPANY_A},list:${COMPANY_A}`,
      `${role} authenticated query order`,
    );
  });
}

Deno.test("bank-accounts denies an authenticated user with no permitted role", async () => {
  const probe = handlerProbe();
  const response = await probe.handler(request());
  const body = await response.json();
  assertEquals(response.status, 403, "no-role status");
  assertEquals(body.error.code, "AUTHORIZATION_ERROR", "no-role code");
  assertEquals(probe.calls.length, 1, "no-role privileged call count");
});

Deno.test("bank-accounts requires authentication before listing", async () => {
  const probe = handlerProbe({
    authenticationError: new AuthenticationError(),
  });
  const response = await probe.handler(request());
  const body = await response.json();
  assertEquals(response.status, 401, "authentication status");
  assertEquals(
    body.error.code,
    "AUTHENTICATION_ERROR",
    "authentication code",
  );
  assertEquals(probe.calls.length, 1, "authentication failure call count");
});

Deno.test("bank-accounts uses authenticated tenant authority, not caller filter authority", async () => {
  const probe = handlerProbe({
    role: "System Admin",
    authenticatedCompanyId: COMPANY_B,
  });
  const response = await probe.handler(request("GET", COMPANY_A));
  const body = await response.json();
  assertEquals(response.status, 200, "tenant authority status");
  assertEquals(body.data.length, 1, "tenant authority row count");
  assertEquals(
    body.data[0].company_id,
    COMPANY_B,
    "authenticated company must bind the list",
  );
  assertEquals(
    probe.calls.join(","),
    `authenticate:${COMPANY_A},list:${COMPANY_B}`,
    "authenticated tenant query",
  );
});

Deno.test("bank-accounts rejects write methods without invoking the read query", async () => {
  const probe = handlerProbe({ role: "System Admin" });
  const response = await probe.handler(request("POST"));
  const body = await response.json();
  assertEquals(response.status, 404, "write route status");
  assertEquals(body.error.code, "ROUTE_NOT_FOUND", "write route code");
  assertEquals(
    probe.calls.join(","),
    `authenticate:${COMPANY_A}`,
    "write route must not list or mutate",
  );
});

Deno.test("bank-account role expansion is endpoint-local", () => {
  requireBankAccountReadAccess(auth("System Admin"));
  let denied = false;
  try {
    requireBankAccountReadAccess({
      ...auth("Auditor"),
      roles: [],
    });
  } catch (error) {
    denied = error instanceof AuthorizationError;
  }
  assert(denied, "empty role set must remain denied");
});

Deno.test("production bank-account query enforces company and active filters", async () => {
  const rows = [
    { id: "a-active", company_id: COMPANY_A, is_active: true },
    { id: "a-inactive", company_id: COMPANY_A, is_active: false },
    { id: "b-active", company_id: COMPANY_B, is_active: true },
  ];
  const filters: Array<[string, unknown]> = [];
  let table = "";
  let selected = "";
  const builder = {
    select(columns: string) {
      selected = columns;
      return this;
    },
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return this;
    },
    order() {
      return this;
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ): PromiseLike<TResult1 | TResult2> {
      const filtered = rows.filter((row) =>
        filters.every(([column, value]) =>
          row[column as keyof typeof row] === value
        )
      );
      return Promise.resolve({ data: filtered, error: null }).then(
        onfulfilled,
        onrejected,
      );
    },
  };
  const client = {
    from(name: string) {
      table = name;
      return builder;
    },
  };

  const result = await listActiveCompanyBankAccounts(
    COMPANY_A,
    client as never,
  );
  assertEquals(table, "bank_accounts", "queried table");
  assert(selected.includes("company_id"), "company field must be selected");
  assertEquals(result.length, 1, "cross-company/inactive rows excluded");
  assertEquals(result[0].id, "a-active", "only tenant-active row returned");
  assertEquals(
    JSON.stringify(filters),
    JSON.stringify([
      ["company_id", COMPANY_A],
      ["is_active", true],
    ]),
    "exact production filters",
  );
});

Deno.test("bank-account responses expose no service credential material", async () => {
  const probe = handlerProbe({ role: "System Admin" });
  const response = await probe.handler(request());
  const serialized = await response.text();
  assert(!serialized.includes("service_role"), "service role must not leak");
  assert(!serialized.includes("client_secret"), "client secret must not leak");
  assert(!serialized.includes("Bearer "), "authorization must not leak");
});
