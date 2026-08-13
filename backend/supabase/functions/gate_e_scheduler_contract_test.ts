import {
  AUTOMATION_WORKER_SECRET_HEADER,
  signAutomationWorkerInvocation,
  validateAutomationWorker,
} from "./automation/worker-auth.ts";
import { readAutomationServiceSource } from "./test-support/refactored-source.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejects(
  action: () => unknown | Promise<unknown>,
  expected: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(String(error).includes(expected), `Expected ${expected}: ${error}`);
    return;
  }
  throw new Error(`Expected rejection containing ${expected}`);
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const migration = await Deno.readTextFile(
  new URL(
    "../../../database/036_gate_e_secure_scheduler.sql",
    import.meta.url,
  ),
);
const smoke = await Deno.readTextFile(
  new URL(
    "../../../database/036b_gate_e_secure_scheduler_smoke_tests.sql",
    import.meta.url,
  ),
);
const service = await readAutomationServiceSource(import.meta.url);
const workerAuth = await Deno.readTextFile(
  new URL("./automation/worker-auth.ts", import.meta.url),
);
const router = await Deno.readTextFile(
  new URL("./automation/index.ts", import.meta.url),
);
const supabaseConfig = await Deno.readTextFile(
  new URL("../config.toml", import.meta.url),
);

Deno.test("Migration 036 requires pg_cron, pg_net, and Vault", () => {
  assert(migration.includes("CREATE EXTENSION IF NOT EXISTS pg_cron"));
  assert(migration.includes("CREATE EXTENSION IF NOT EXISTS pg_net"));
  assert(migration.includes("to_regclass('vault.decrypted_secrets')"));
  assert(migration.includes("net.http_post(text,jsonb,jsonb,jsonb,integer)"));
  assert(migration.includes("cron.schedule(text,text,text)"));
});

Deno.test("Migration 036 installs infrastructure without activating the job", () => {
  assert(!migration.includes("PERFORM public.automation_scheduler_install();"));
  assert(!migration.includes("SELECT public.automation_scheduler_install();"));
  assert(!migration.includes("vault.create_secret("));
  assert(migration.trimEnd().endsWith("COMMIT;"));
});

Deno.test("Scheduler functions are postgres-owned security definers", () => {
  for (
    const name of [
      "automation_scheduler_assert_secret",
      "automation_scheduler_invoke",
      "automation_scheduler_install",
      "automation_scheduler_remove",
    ]
  ) {
    assert(migration.includes(`FUNCTION public.${name}(`));
    assert(migration.includes(`ALTER FUNCTION public.${name}()`));
  }
  assert(count(migration, "SECURITY DEFINER") >= 7);
  assert(count(migration, "SET search_path = ''") >= 7);
});

Deno.test("Browser and service roles cannot invoke scheduler operations", () => {
  for (
    const name of [
      "automation_scheduler_assert_secret",
      "automation_scheduler_invoke",
      "automation_scheduler_install",
      "automation_scheduler_remove",
    ]
  ) {
    assert(
      migration.includes(`FUNCTION public.${name}()`),
      `Missing ${name}`,
    );
  }
  assert(
    count(migration, "FROM PUBLIC, anon, authenticated, service_role;") >= 7,
  );
  assert(
    !/GRANT EXECUTE ON FUNCTION public\.automation_scheduler_/i.test(migration),
  );
});

Deno.test("Scheduler uses one fixed Vault identity and description", () => {
  assert(count(migration, "'AUTOMATION_WORKER_SECRET'") === 2);
  assert(
    count(migration, "'Gate E Automation worker scheduler secret'") === 2,
  );
  assert(!migration.includes("p_secret_name"));
});

Deno.test("Worker secret validation is bounded and fail closed", () => {
  assert(migration.includes("v_secret_count <> 1"));
  assert(migration.includes("pg_catalog.octet_length(v_secret) < 43"));
  assert(migration.includes("pg_catalog.octet_length(v_secret) > 128"));
  assert(migration.includes("v_secret !~ '^[A-Za-z0-9_-]+$'"));
  assert(migration.includes("GATE_E_WORKER_SECRET_UNAVAILABLE"));
});

Deno.test("Scheduler invocation has a fixed trusted HTTPS worker URL", () => {
  assert(
    migration.includes(
      "https://kusseuycqgdilychphpq.supabase.co/functions/v1/automation/worker/run",
    ),
  );
  assert(!migration.includes("p_url"));
  assert(!migration.includes("http://"));
});

Deno.test("Scheduler invocation is exact POST JSON with a signed worker header", () => {
  assert(migration.includes("SELECT net.http_post("));
  assert(migration.includes("body := '{}'::JSONB"));
  assert(migration.includes("params := '{}'::JSONB"));
  assert(migration.includes("'Content-Type', 'application/json'"));
  assert(migration.includes("'X-Automation-Worker-Secret', v_authorization"));
  assert(migration.includes("extensions.hmac("));
  assert(migration.includes("'gate-e-automation-worker:v1:'"));
  assert(migration.includes("timeout_milliseconds := 120000"));
});

Deno.test("pg_net queue receives no reusable root worker secret", () => {
  assert(
    migration.includes(
      "receives only a three-minute HMAC token with a one-time nonce",
    ),
  );
  assert(migration.includes("v_authorization := 'v1.'"));
  assert(migration.includes("v_secret := NULL"));
  assert(!migration.includes("'X-Automation-Worker-Secret', v_secret"));
});

Deno.test("net and cron schemas are excluded from the reviewed Data API", () => {
  assert(
    supabaseConfig.includes('schemas = ["public", "graphql_public"]'),
  );
  assert(
    !supabaseConfig.includes('schemas = ["public", "graphql_public", "net"'),
  );
  assert(
    !supabaseConfig.includes('schemas = ["public", "graphql_public", "cron"'),
  );
  assert(
    !/GRANT EXECUTE ON FUNCTION public\.automation_scheduler_/i.test(migration),
  );
});

Deno.test("Scheduler job has one stable identity and ten-minute cadence", () => {
  assert(count(migration, "'gate-e-automation-worker'") >= 4);
  assert(migration.includes("'*/10 * * * *'"));
  assert(
    migration.includes("SELECT public.automation_scheduler_invoke();"),
  );
});

Deno.test("Install is serialized, secret-gated, and duplicate-safe", () => {
  assert(
    migration.includes(
      "pg_catalog.hashtextextended('gate-e-automation-worker-scheduler', 0)",
    ),
  );
  assert(
    migration.includes("PERFORM public.automation_scheduler_assert_secret()"),
  );
  assert(migration.includes("PERFORM cron.unschedule(v_existing_job.jobid)"));
  assert(migration.includes("SELECT cron.schedule("));
  assert(migration.includes("AND job.active"));
});

Deno.test("Removal is scoped only to the stable Gate E job", () => {
  assert(migration.includes("FUNCTION public.automation_scheduler_remove()"));
  assert(migration.includes("WHERE job.jobname = 'gate-e-automation-worker'"));
  assert(migration.includes("v_removed := v_removed + 1"));
  assert(!migration.includes("DELETE FROM cron.job"));
});

Deno.test("Worker lease is private, coherent, and expires before the next tick", () => {
  assert(migration.includes("CREATE SCHEMA IF NOT EXISTS gate_e_internal"));
  assert(migration.includes("automation_worker_lease"));
  assert(migration.includes("INTERVAL '8 minutes'"));
  assert(
    migration.includes(
      "OR gate_e_internal.automation_worker_lease.lease_expires_at",
    ),
  );
  assert(migration.includes("lease_token = p_lease_token"));
});

Deno.test("Only service_role can acquire or release the worker lease", () => {
  assert(
    migration.includes(
      "GRANT EXECUTE ON FUNCTION public.automation_worker_lease_acquire(UUID)",
    ),
  );
  assert(
    migration.includes(
      "GRANT EXECUTE ON FUNCTION public.automation_worker_lease_release(UUID, BOOLEAN)",
    ),
  );
  assert(
    migration.includes(
      "REVOKE ALL ON TABLE gate_e_internal.automation_worker_lease",
    ),
  );
  assert(
    migration.includes(
      "GRANT EXECUTE ON FUNCTION public.automation_worker_nonce_claim(UUID, TIMESTAMPTZ)",
    ),
  );
  assert(
    migration.includes(
      "REVOKE ALL ON TABLE gate_e_internal.automation_worker_nonces",
    ),
  );
});

Deno.test("Automation worker acquires and releases the database lease", () => {
  assert(service.includes('"automation_worker_lease_acquire"'));
  assert(service.includes('"automation_worker_lease_release"'));
  assert(service.includes("p_lease_token: leaseToken"));
  assert(service.includes("p_succeeded: !cycleFailed"));
  assert(service.includes("if (!acquired) return emptyScheduledCycleResult()"));
});

Deno.test("Scheduler preserves the deployed worker route and auth contract", () => {
  assert(workerAuth.includes('"X-Automation-Worker-Secret"'));
  assert(workerAuth.includes('"AUTOMATION_WORKER_SECRET"'));
  assert(router.includes('name: "worker-run"'));
  assert(router.includes("/^\\/worker\\/run\\/?$/"));
  assert(router.includes('route.name === "worker-run"'));
  assert(router.includes('req.method !== "POST"'));
  assert(router.includes("await (dependencies.authenticateWorker"));
  assert(workerAuth.includes("signAutomationWorkerInvocation"));
  assert(workerAuth.includes("automation_worker_nonce_claim"));
  assert(workerAuth.includes("constantTimeEqual"));
});

Deno.test("Signed scheduler authorization validates and claims one nonce", async () => {
  const secret = "A".repeat(64);
  const now = new Date("2026-08-08T00:00:00.000Z");
  const nonce = "10000000-0000-4000-8000-000000000001";
  const token = await signAutomationWorkerInvocation(secret, now, nonce);
  const claims: Array<{ nonce: string; issuedAt: string }> = [];
  await validateAutomationWorker(
    new Request("https://example.test/automation/worker/run", {
      method: "POST",
      headers: { [AUTOMATION_WORKER_SECRET_HEADER]: token },
    }),
    secret,
    (claimedNonce, issuedAt) => {
      claims.push({ nonce: claimedNonce, issuedAt });
      return Promise.resolve(true);
    },
    now,
  );
  assert(claims.length === 1);
  assert(claims[0].nonce === nonce);
  assert(claims[0].issuedAt === now.toISOString());
  assert(!token.includes(secret));
});

Deno.test("Signed scheduler authorization rejects tampering", async () => {
  const secret = "B".repeat(64);
  const now = new Date("2026-08-08T00:00:00.000Z");
  const token = await signAutomationWorkerInvocation(
    secret,
    now,
    "20000000-0000-4000-8000-000000000002",
  );
  await rejects(
    () =>
      validateAutomationWorker(
        new Request("https://example.test/automation/worker/run", {
          method: "POST",
          headers: {
            [AUTOMATION_WORKER_SECRET_HEADER]: `${token.slice(0, -1)}0`,
          },
        }),
        secret,
        () => Promise.resolve(true),
        now,
      ),
    "Authentication",
  );
});

Deno.test("Signed scheduler authorization rejects expired and future tokens", async () => {
  const secret = "C".repeat(64);
  const nonce = "30000000-0000-4000-8000-000000000003";
  const now = new Date("2026-08-08T00:10:00.000Z");
  for (
    const issuedAt of [
      new Date("2026-08-08T00:06:59.000Z"),
      new Date("2026-08-08T00:10:31.000Z"),
    ]
  ) {
    const token = await signAutomationWorkerInvocation(secret, issuedAt, nonce);
    await rejects(
      () =>
        validateAutomationWorker(
          new Request("https://example.test/automation/worker/run", {
            method: "POST",
            headers: { [AUTOMATION_WORKER_SECRET_HEADER]: token },
          }),
          secret,
          () => Promise.resolve(true),
          now,
        ),
      "Authentication",
    );
  }
});

Deno.test("Signed scheduler authorization rejects nonce replay", async () => {
  const secret = "D".repeat(64);
  const now = new Date("2026-08-08T00:00:00.000Z");
  const token = await signAutomationWorkerInvocation(
    secret,
    now,
    "40000000-0000-4000-8000-000000000004",
  );
  await rejects(
    () =>
      validateAutomationWorker(
        new Request("https://example.test/automation/worker/run", {
          method: "POST",
          headers: { [AUTOMATION_WORKER_SECRET_HEADER]: token },
        }),
        secret,
        () => Promise.resolve(false),
        now,
      ),
    "Authentication",
  );
});

Deno.test("Scheduler smoke is rollback-only and cannot commit HTTP work", () => {
  assert(
    smoke.trimStart().startsWith("-- Gate E secure scheduler rollback smoke"),
  );
  assert(smoke.includes("BEGIN;"));
  assert(smoke.trimEnd().endsWith("ROLLBACK;"));
  assert(!smoke.includes("COMMIT;"));
});

Deno.test("Scheduler smoke proves missing-secret and overlap failures", () => {
  assert(smoke.includes("Scheduler installed without its Vault secret"));
  assert(smoke.includes("GATE_E_WORKER_SECRET_UNAVAILABLE"));
  assert(smoke.includes("Overlapping worker lease was acquired"));
  assert(smoke.includes("Released worker lease could not be reacquired"));
});

Deno.test("Scheduler smoke verifies idempotent install and scoped removal", () => {
  assert(count(smoke, "public.automation_scheduler_install()") === 4);
  assert(smoke.includes("Scheduler install was not idempotent"));
  assert(smoke.includes("gate-e-scheduler-smoke-unrelated"));
  assert(smoke.includes("Scheduler removal exceeded the Gate E job boundary"));
});

Deno.test("Scheduler smoke inspects the exact queued request without committing", () => {
  assert(smoke.includes("FROM net.http_request_queue AS request"));
  assert(smoke.includes("v_request.method <> 'POST'"));
  assert(smoke.includes("v_request.body_text <> '{}'"));
  assert(smoke.includes("v_request.timeout_milliseconds <> 120000"));
  assert(smoke.includes("X-Automation-Worker-Secret"));
  assert(smoke.includes("v_authorization = v_fixture_secret"));
  assert(smoke.includes("Scheduler invocation nonce was not one-time"));
});

Deno.test("Migration contains no worker secret value or financial DML", () => {
  assert(!migration.includes("scheduler_smoke_fixture"));
  assert(
    !/INSERT\s+INTO\s+public\.(invoices|receipts|allocations|journal)/i.test(
      migration,
    ),
  );
  assert(
    !/UPDATE\s+public\.(invoices|receipts|allocations|journal)/i.test(
      migration,
    ),
  );
  assert(
    !/DELETE\s+FROM\s+public\.(invoices|receipts|allocations|journal)/i.test(
      migration,
    ),
  );
});
