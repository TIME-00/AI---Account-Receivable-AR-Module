const root = new URL("../../", import.meta.url);
const operator = await Deno.readTextFile(
  new URL(
    "database/operators/batch_9d_e1_b9de_e1_005_user_roles_rls_remediation.sql",
    root,
  ),
);
const sourceRls = await Deno.readTextFile(
  new URL("database/006_rls_policies.sql", root),
);
const authHelper = await Deno.readTextFile(
  new URL("backend/supabase/functions/_shared/auth.ts", root),
);
const frontendRoleHook = await Deno.readTextFile(
  new URL("frontend/src/hooks/use-user-role.ts", root),
);

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

Deno.test("Mode A changes only the exact legacy policy", () => {
  assert(
    operator.includes('DROP POLICY "Temp Allow All" ON public.user_roles'),
  );
  assert(!operator.includes("DROP POLICY IF EXISTS"));
  assert(!/CREATE\s+POLICY/i.test(operator));
  assert(!/ALTER\s+POLICY/i.test(operator));
  assert(!/ALTER\s+TABLE/i.test(operator));
  assert(!/^\s*(?:GRANT|REVOKE)\b/im.test(operator));
  assert(
    !/^\s*(?:INSERT|UPDATE|DELETE|MERGE)\s+(?:INTO|FROM|public\.)/im.test(
      operator,
    ),
  );
  assert(occurrences(operator, "DROP POLICY") === 1);
});

Deno.test("transaction, narrow lock and fail-closed timeouts are load-bearing", () => {
  assert(/^--[\s\S]*\nBEGIN;/m.test(operator));
  assert(operator.includes("pg_catalog.pg_advisory_xact_lock"));
  assert(operator.includes("SET LOCAL lock_timeout = '5s'"));
  assert(operator.includes("SET LOCAL statement_timeout = '30s'"));
  assert(operator.trimEnd().endsWith("COMMIT;"));
  assert(operator.includes("RAISE EXCEPTION"));
});

Deno.test("complete legacy signature is checked before exact drop", () => {
  for (
    const fragment of [
      "p.polname = 'Temp Allow All'",
      "p.polcmd = 'r'",
      "p.polpermissive",
      "p.polroles = ARRAY[r.oid]",
      "r.rolname = 'authenticated'",
      ")) = 'true'",
      "p.polwithcheck IS NULL",
    ]
  ) assert(operator.includes(fragment), `missing signature guard: ${fragment}`);
  assert(
    operator.indexOf("legacy policy signature mismatch") <
      operator.indexOf("EXECUTE 'DROP POLICY"),
  );
});

Deno.test("catalog drift rolls back rather than broadening scope", () => {
  for (
    const fragment of [
      "expected enabled, non-forced RLS",
      "authenticated SELECT grant absent",
      "source-backed ur_select is absent or changed",
      "duplicate legacy policy name",
      "unrelated catalog drift",
    ]
  ) assert(operator.includes(fragment), `missing drift stop: ${fragment}`);
});

Deno.test("rerun is an assertion-only no-op", () => {
  assert(operator.includes("IF v_target_count = 1 THEN"));
  assert(operator.includes("ELSIF v_target_count <> 0 THEN"));
  assert(operator.includes("legacy policy remains"));
  assert(operator.includes("exposed unconditional policies remain"));
  assert(operator.includes("ur_select changed"));
});

Deno.test("source-backed visibility is self or active same-company", () => {
  assert(
    sourceRls.includes("CREATE POLICY ur_select ON user_roles FOR SELECT"),
  );
  assert(
    sourceRls.includes(
      "USING (user_id = auth.uid() OR rls_has_company_access(company_id))",
    ),
  );
  assert(
    sourceRls.includes("CREATE OR REPLACE FUNCTION rls_has_company_access"),
  );
  assert(sourceRls.includes("ur.is_active = TRUE"));
  assert(
    operator.includes(
      "((user_id = auth.uid()) OR rls_has_company_access(company_id))",
    ),
  );
});

Deno.test("operator preserves every other policy grant and helper", () => {
  assert(operator.includes("v_other_policy_before"));
  assert(operator.includes("v_all_policy_before"));
  assert(operator.includes("v_grant_before"));
  assert(operator.includes("v_helper_before"));
  assert(operator.includes("v_other_policy_after IS DISTINCT FROM"));
  assert(operator.includes("v_all_policy_after IS DISTINCT FROM"));
  assert(operator.includes("v_grant_after IS DISTINCT FROM"));
  assert(operator.includes("v_helper_after IS DISTINCT FROM"));
});

Deno.test("unconditional exposed SELECT and write policies must both be zero", () => {
  assert(operator.includes("v_unconditional_select"));
  assert(operator.includes("v_unconditional_write"));
  assert(operator.includes("rolname IN ('anon', 'authenticated')"));
  assert(operator.includes("v_unconditional_select <> 0"));
  assert(operator.includes("v_unconditional_write <> 0"));
});

Deno.test("application role lookup remains server-admin mediated", () => {
  assert(authHelper.includes("getAdminClient()"));
  assert(authHelper.includes(".from('user_roles')"));
  assert(authHelper.includes(".eq('user_id', userId)"));
  assert(frontendRoleHook.includes("/auth/me"));
  assert(!frontendRoleHook.includes('from("user_roles")'));
});
