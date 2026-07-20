import {
  ADMIN_API_KEY_NAME,
  PUBLISHABLE_API_KEY_NAME,
  resolveNamedApiKey,
} from "./db.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("named API-key dictionaries resolve only the requested modern keys", () => {
  const admin = resolveNamedApiKey(
    JSON.stringify({
      [ADMIN_API_KEY_NAME]: "test-secret-value",
      default: "wrong-secret",
    }),
    ADMIN_API_KEY_NAME,
    "SUPABASE_SECRET_KEYS",
  );
  const publishable = resolveNamedApiKey(
    JSON.stringify({ [PUBLISHABLE_API_KEY_NAME]: "test-publishable-value" }),
    PUBLISHABLE_API_KEY_NAME,
    "SUPABASE_PUBLISHABLE_KEYS",
  );

  assert(
    admin === "test-secret-value",
    "Admin key must use the dedicated named secret",
  );
  assert(
    publishable === "test-publishable-value",
    "User client must use the default publishable key",
  );
});

Deno.test("named API-key dictionaries fail closed for missing, blank, or malformed entries", () => {
  const cases: Array<
    [
      string | undefined,
      string,
      "SUPABASE_SECRET_KEYS" | "SUPABASE_PUBLISHABLE_KEYS",
    ]
  > = [
    [undefined, ADMIN_API_KEY_NAME, "SUPABASE_SECRET_KEYS"],
    ["not-json", ADMIN_API_KEY_NAME, "SUPABASE_SECRET_KEYS"],
    ["{}", ADMIN_API_KEY_NAME, "SUPABASE_SECRET_KEYS"],
    [
      JSON.stringify({ [ADMIN_API_KEY_NAME]: "" }),
      ADMIN_API_KEY_NAME,
      "SUPABASE_SECRET_KEYS",
    ],
    [
      JSON.stringify({ [PUBLISHABLE_API_KEY_NAME]: 123 }),
      PUBLISHABLE_API_KEY_NAME,
      "SUPABASE_PUBLISHABLE_KEYS",
    ],
  ];

  for (const [raw, name, environment] of cases) {
    let failed = false;
    try {
      resolveNamedApiKey(raw, name, environment);
    } catch (error) {
      failed = error instanceof Error && error.message.includes(environment) &&
        !error.message.includes("test-");
    }
    assert(
      failed,
      `${environment}.${name} must fail with a non-sensitive configuration error`,
    );
  }
});

Deno.test("shared database helper has no executable legacy API-key dependency", async () => {
  const source = await Deno.readTextFile(new URL("./db.ts", import.meta.url));
  assert(
    !source.includes("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')"),
    "Admin client must not read the legacy service-role key",
  );
  assert(
    !source.includes("Deno.env.get('SUPABASE_ANON_KEY')"),
    "User client must not read the legacy anon key",
  );
  assert(
    source.includes("Deno.env.get('SUPABASE_SECRET_KEYS')"),
    "Admin client must use the modern secret-key dictionary",
  );
  assert(
    source.includes("Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')"),
    "User client must use the modern publishable-key dictionary",
  );
});
