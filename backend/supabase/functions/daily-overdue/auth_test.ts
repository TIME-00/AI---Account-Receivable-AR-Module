import { validateDailyOverdueCronAuth } from "./auth.ts";
import { createDailyOverdueHandler } from "./index.ts";

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

function requestWithSecret(secret?: string): Request {
  const headers = new Headers();
  if (secret !== undefined) headers.set("X-Cron-Secret", secret);
  return new Request("https://scheduled-task.invalid/", {
    method: "POST",
    headers,
  });
}

function testHandler(
  expectedSecret: string | undefined,
  suppliedSecret?: string,
) {
  let clientCalls = 0;
  let taskCalls = 0;
  const handler = createDailyOverdueHandler({
    getExpectedSecret: () => expectedSecret,
    getClient: () => {
      clientCalls += 1;
      return {} as never;
    },
    runTask: async () => {
      taskCalls += 1;
      return Response.json({ success: true });
    },
  });
  return {
    response: handler(requestWithSecret(suppliedSecret)),
    counts: () => ({ clientCalls, taskCalls }),
  };
}

for (
  const [name, expectedSecret] of [
    ["absent", undefined],
    ["blank", ""],
    ["whitespace", "   "],
  ] as const
) {
  Deno.test(`daily-overdue fails closed when the server secret is ${name}`, async () => {
    const probe = testHandler(expectedSecret);
    const response = await probe.response;
    const body = await response.json();
    assertEquals(response.status, 500, "configuration failure status");
    assertEquals(
      body.error.code,
      "SCHEDULED_AUTH_NOT_CONFIGURED",
      "configuration failure code",
    );
    assertEquals(
      probe.counts().clientCalls,
      0,
      "admin client must not be created",
    );
    assertEquals(probe.counts().taskCalls, 0, "privileged task must not run");
  });
}

for (
  const [name, suppliedSecret] of [
    ["absent", undefined],
    ["blank", ""],
    ["whitespace", "   "],
  ] as const
) {
  Deno.test(`daily-overdue rejects a ${name} caller secret`, async () => {
    const expectedSecret = crypto.randomUUID();
    const probe = testHandler(expectedSecret, suppliedSecret);
    const response = await probe.response;
    const body = await response.json();
    assertEquals(response.status, 401, "caller failure status");
    assertEquals(body.error.code, "UNAUTHORIZED", "caller failure code");
    assertEquals(
      probe.counts().clientCalls,
      0,
      "admin client must not be created",
    );
    assertEquals(probe.counts().taskCalls, 0, "privileged task must not run");
    assert(
      !JSON.stringify(body).includes(expectedSecret),
      "response must not contain expected secret",
    );
  });
}

Deno.test("daily-overdue rejects an incorrect caller secret before privileged work", async () => {
  const expectedSecret = crypto.randomUUID();
  const suppliedSecret = crypto.randomUUID();
  const probe = testHandler(expectedSecret, suppliedSecret);
  const response = await probe.response;
  const serialized = await response.text();
  assertEquals(response.status, 401, "wrong-secret status");
  assertEquals(
    probe.counts().clientCalls,
    0,
    "admin client must not be created",
  );
  assertEquals(probe.counts().taskCalls, 0, "privileged task must not run");
  assert(
    !serialized.includes(expectedSecret),
    "response must not contain expected secret",
  );
  assert(
    !serialized.includes(suppliedSecret),
    "response must not contain supplied secret",
  );
});

Deno.test("daily-overdue accepts the correct secret and reaches the intended task", async () => {
  const secret = crypto.randomUUID();
  const probe = testHandler(secret, secret);
  const response = await probe.response;
  assertEquals(response.status, 200, "correct-secret status");
  assertEquals(probe.counts().clientCalls, 1, "admin client creation count");
  assertEquals(probe.counts().taskCalls, 1, "privileged task execution count");
});

Deno.test("daily-overdue auth uses the accepted constant-time helper without direct equality", async () => {
  const authSource = await Deno.readTextFile(
    new URL("./auth.ts", import.meta.url),
  );
  assert(
    authSource.includes("constantTimeEqual(suppliedSecret, expectedSecret)"),
    "constant-time comparison missing",
  );
  assert(
    !authSource.includes("suppliedSecret !== expectedSecret"),
    "direct inequality must not authorize secrets",
  );
  assert(
    !authSource.includes("suppliedSecret === expectedSecret"),
    "direct equality must not authorize secrets",
  );
});

Deno.test("daily-overdue production composition authenticates before creating its admin client", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  const authIndex = source.indexOf(
    "validateDailyOverdueCronAuth(req, expectedSecret)",
  );
  const clientIndex = source.indexOf(
    "(dependencies.getClient ?? getAdminClient)()",
  );
  assert(authIndex >= 0, "production authentication call missing");
  assert(
    clientIndex > authIndex,
    "admin client must be created only after authentication",
  );
});

Deno.test("daily-overdue OPTIONS preflight performs no privileged work", async () => {
  let privilegedCalls = 0;
  const handler = createDailyOverdueHandler({
    getExpectedSecret: () => undefined,
    getClient: () => {
      privilegedCalls += 1;
      return {} as never;
    },
    runTask: async () => {
      privilegedCalls += 1;
      return Response.json({ success: true });
    },
  });
  const response = await handler(
    new Request("https://scheduled-task.invalid/", { method: "OPTIONS" }),
  );
  assertEquals(response.status, 204, "preflight status");
  assertEquals(privilegedCalls, 0, "preflight privileged calls");
});

Deno.test("daily-overdue exact auth function distinguishes configuration and caller failures", () => {
  const missingConfiguration = validateDailyOverdueCronAuth(
    requestWithSecret(),
    undefined,
  );
  const wrongCaller = validateDailyOverdueCronAuth(
    requestWithSecret(crypto.randomUUID()),
    crypto.randomUUID(),
  );
  assertEquals(missingConfiguration?.status, 500, "configuration status");
  assertEquals(wrongCaller?.status, 401, "caller status");
});
