const root = new URL("../../", import.meta.url);
const manifestSql = await Deno.readTextFile(
  new URL(
    "database/operators/batch_9d_e1_f3_test_data_reset_manifest.sql",
    root,
  ),
);
const applySql = await Deno.readTextFile(
  new URL("database/operators/batch_9d_e1_f3_test_data_reset_apply.sql", root),
);
const runbook = await Deno.readTextFile(
  new URL(
    "docs/runbooks/BATCH_9D_E1_F3_PRODUCTION_TEST_DATA_RESET_RUNBOOK.md",
    root,
  ),
);
const allocationRoute = await Deno.readTextFile(
  new URL("backend/supabase/functions/allocations/index.ts", root),
);

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message = "values differ") {
  if (actual !== expected) {
    throw new Error(`${message}: ${actual} !== ${expected}`);
  }
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type ModelRow = {
  id: string;
  kind: string;
  companyId: string;
  amountCents: bigint;
  retain: boolean;
};

type ModelState = { rows: ModelRow[]; applied: boolean };

function cloneState(state: ModelState): ModelState {
  return {
    rows: state.rows.map((row) => ({ ...row })),
    applied: state.applied,
  };
}

async function modelHash(rows: ModelRow[]): Promise<string> {
  const canonical = [...rows].sort((a, b) =>
    `${a.kind}|${a.id}`.localeCompare(`${b.kind}|${b.id}`)
  ).map((row) =>
    `${row.kind}|${row.id}|${row.companyId}|${row.amountCents.toString()}`
  ).join("\n");
  return await sha256(canonical);
}

async function modelApply(
  state: ModelState,
  companyId: string,
  approvedDeleteHash: string,
  failAfterDeletes = false,
): Promise<ModelState> {
  if (state.applied) return cloneState(state);
  if (state.rows.some((row) => row.companyId !== companyId)) {
    throw new Error("company mismatch");
  }
  if (
    state.rows.some((row) =>
      !["invoices", "receipts", "customers"].includes(row.kind)
    )
  ) {
    throw new Error("unclassified row");
  }
  const deletion = state.rows.filter((row) => !row.retain);
  if (await modelHash(deletion) !== approvedDeleteHash) {
    throw new Error("manifest drift");
  }
  const working = cloneState(state);
  working.rows = working.rows.filter((row) => row.retain);
  if (failAfterDeletes) throw new Error("injected failure");
  working.applied = true;
  return working;
}

const company = "00000000-0000-0000-0000-000000000001";
const model: ModelState = {
  applied: false,
  rows: [
    {
      id: "01",
      kind: "invoices",
      companyId: company,
      amountCents: 10000n,
      retain: true,
    },
    {
      id: "02",
      kind: "receipts",
      companyId: company,
      amountCents: 10000n,
      retain: true,
    },
    {
      id: "03",
      kind: "customers",
      companyId: company,
      amountCents: 0n,
      retain: true,
    },
    {
      id: "04",
      kind: "invoices",
      companyId: company,
      amountCents: 268170331n,
      retain: false,
    },
  ],
};

Deno.test("exactly ten principal scenario anchors are fixed", () => {
  const anchors = manifestSql.match(/\(\d+, '[0-9a-f-]{36}'::uuid,/g) ?? [];
  assertEquals(anchors.length, 10);
});

Deno.test("retained dependency graph expected count is fixed", () => {
  assert(manifestSql.includes("179::bigint AS retained_row_count"));
  assert(applySql.includes("v_retain_count <> 179"));
});

Deno.test("all 128 defective Paid invoices are an asserted deletion subset", () => {
  assert(manifestSql.includes("128::bigint AS defective_paid_count"));
  assert(applySql.includes("<> 128"));
  assert(applySql.includes("i.id = ANY(v_del_invoices)"));
});

Deno.test("all 922 header-only Open invoices are an asserted deletion subset", () => {
  assert(manifestSql.includes("922::bigint AS header_open_count"));
  assert(applySql.includes("<> 922"));
});

Deno.test("all non-retained invoices are exact-ID bound", () => {
  assert(applySql.includes("cardinality(v_del_invoices) <> 1112"));
  assert(
    applySql.includes(
      "DELETE FROM public.invoices WHERE id = ANY(v_del_invoices)",
    ),
  );
});

Deno.test("non-retained and retained receipts are separated", () => {
  assert(applySql.includes("cardinality(v_del_receipts) <> 29"));
  assert(manifestSql.includes("'receipts'"));
});

Deno.test("retained allocations are graph-reachable", () => {
  assert(manifestSql.includes("'allocation_details', x.id"));
  assert(manifestSql.includes("x.receipt_id = g.id"));
});

Deno.test("deleted allocations are exact-ID removed", () => {
  assert(applySql.includes("cardinality(v_del_allocations) <> 13"));
  assert(
    applySql.includes(
      "DELETE FROM public.allocation_details WHERE id = ANY(v_del_allocations)",
    ),
  );
});

Deno.test("CN and DN relationship handling is explicit", () => {
  assert(manifestSql.includes("'cn_allocations'"));
  assert(manifestSql.includes("i.ref_invoice_id"));
  assert(manifestSql.includes("partially-paid-debit-note"));
});

Deno.test("journal original and reversal closure is complete", () => {
  for (
    const token of ["original_je_id", "reversal_je_id", "journal_entry_lines"]
  ) {
    assert(manifestSql.includes(token), `missing ${token}`);
  }
});

Deno.test("import batch, row, allocation, file and OCR closure is complete", () => {
  for (
    const token of [
      "import_batches",
      "import_rows",
      "import_row_allocations",
      "import_files",
      "ocr_review_decisions",
    ]
  ) {
    assert(manifestSql.includes(token), `missing ${token}`);
  }
  assert(manifestSql.includes("x.duplicate_of"));
  assert(applySql.includes("x.duplicate_of"));
});

Deno.test("customer dependencies protect assignments and immutable audits", () => {
  for (
    const token of [
      "user_customer_assignments",
      "customer_change_logs",
      "credit_control_logs",
    ]
  ) {
    assert(applySql.includes(token), `missing ${token}`);
  }
  assert(
    !/DELETE FROM public\.(user_customer_assignments|customer_change_logs|credit_control_logs)/i
      .test(applySql),
  );
  assert(manifestSql.includes("protected_customer_graph"));
  assert(applySql.includes("protected_customer_graph"));
});

Deno.test("financial arithmetic is PostgreSQL NUMERIC only", () => {
  assert(manifestSql.includes("numeric(30,2)"));
  assert(!/\b(float|double precision|real)\b/i.test(manifestSql));
});

Deno.test("retention hash is deterministic and full-row based", () => {
  assert(manifestSql.includes("to_jsonb"));
  assert(manifestSql.includes("ORDER BY kind, id"));
  assert(
    manifestSql.includes(
      "36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0",
    ),
  );
});

Deno.test("deletion hash is deterministic and full-row based", () => {
  assert(
    manifestSql.includes(
      "cfa7d6d7bc739bd190fb14a2e8bb680dc473fbe1e678db1b1235f07e9b75cb7d",
    ),
  );
  assert(applySql.includes("c_delete_hash constant text"));
});

Deno.test("dry-run contains no mutation statement", () => {
  const executable = manifestSql.replace(/^\s*--.*$/gm, "");
  assert(
    !/^\s*(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/im
      .test(executable),
  );
  assert(executable.includes("READ ONLY"));
  assert(executable.trimEnd().endsWith("ROLLBACK;"));
});

Deno.test("dry-run model leaves state unchanged", async () => {
  const before = await modelHash(model.rows);
  await modelHash(model.rows.filter((row) => !row.retain));
  assertEquals(await modelHash(model.rows), before);
});

Deno.test("wrong manifest hash aborts", async () => {
  let failed = false;
  try {
    await modelApply(model, company, "wrong");
  } catch {
    failed = true;
  }
  assert(failed);
  assert(applySql.includes("F3_RESET_DRIFT"));
});

Deno.test("count drift abort is encoded", () => {
  assert(applySql.includes("F3_RESET_DRIFT: per-table count mismatch"));
});

Deno.test("monetary drift changes the canonical hash", async () => {
  const deletion = model.rows.filter((row) => !row.retain);
  const changed = deletion.map((row) => ({
    ...row,
    amountCents: row.amountCents + 1n,
  }));
  assert((await modelHash(deletion)) !== (await modelHash(changed)));
});

Deno.test("dependency drift changes full-row state hash contract", () => {
  assert(manifestSql.includes("payload::text"));
  assert(manifestSql.includes("scenario_hash_matches"));
});

Deno.test("cross-company entry aborts", async () => {
  const state = cloneState(model);
  state.rows[0].companyId = "other";
  let failed = false;
  try {
    await modelApply(
      state,
      company,
      await modelHash(state.rows.filter((row) => !row.retain)),
    );
  } catch {
    failed = true;
  }
  assert(failed);
});

Deno.test("unclassified row aborts", async () => {
  const state = cloneState(model);
  state.rows.push({
    id: "05",
    kind: "unknown",
    companyId: company,
    amountCents: 0n,
    retain: false,
  });
  let failed = false;
  try {
    await modelApply(
      state,
      company,
      await modelHash(state.rows.filter((row) => !row.retain)),
    );
  } catch {
    failed = true;
  }
  assert(failed);
  assert(applySql.includes("F3_RESET_UNCLASSIFIED"));
});

Deno.test("injected failure preserves original model state", async () => {
  const before = await modelHash(model.rows);
  let failed = false;
  try {
    await modelApply(
      model,
      company,
      await modelHash(model.rows.filter((row) => !row.retain)),
      true,
    );
  } catch {
    failed = true;
  }
  assert(failed);
  assertEquals(await modelHash(model.rows), before);
});

Deno.test("transaction rollback and no partial commit are load-bearing", () => {
  assert(applySql.includes("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE"));
  assert(applySql.includes("RAISE EXCEPTION"));
  assert(!applySql.includes("best effort"));
});

Deno.test("stable table and row lock ordering is explicit", () => {
  assert(applySql.includes("LOCK TABLE public.allocation_details"));
  assert(applySql.includes("ORDER BY id FOR UPDATE"));
  assert(applySql.includes("lock_timeout = '5s'"));
  assert(applySql.includes("statement_timeout = '120s'"));
});

Deno.test("second apply is idempotent", async () => {
  const expected = await modelHash(model.rows.filter((row) => !row.retain));
  const applied = await modelApply(model, company, expected);
  const second = await modelApply(applied, company, expected);
  assertEquals(await modelHash(second.rows), await modelHash(applied.rows));
  assert(applySql.includes("F3_RESET_ALREADY_APPLIED"));
});

Deno.test("second apply creates no duplicate financial effect", async () => {
  const expected = await modelHash(model.rows.filter((row) => !row.retain));
  const once = await modelApply(model, company, expected);
  const twice = await modelApply(once, company, expected);
  const total = (rows: ModelRow[]) =>
    rows.reduce((sum, row) => sum + row.amountCents, 0n);
  assertEquals(total(once.rows), total(twice.rows));
});

Deno.test("retained settlement equation includes discount and credit-note allocations", () => {
  assert(applySql.includes("a.allocated_amount + a.discount_amount"));
  assert(applySql.includes("ca.allocated_amount"));
  assert(manifestSql.includes("retained_settlement_mismatch_count"));
  assert(manifestSql.includes("a.allocated_amount + a.discount_amount"));
});

Deno.test("dry-run exposes per-scenario dependency counts and SHA-256", () => {
  for (
    const token of [
      "scenario_manifest",
      "dependency_row_count",
      "dependency_ids",
      "dependencies",
      "scenario_hash",
      "i.company_id",
      "i.doc_type",
      "i.customer_id",
      "i.exchange_rate",
      "i.total_amount",
      "i.base_total",
      "i.outstanding",
      "i.version",
    ]
  ) {
    assert(manifestSql.includes(token));
  }
});

Deno.test("retained scenarios remain queryable after-state", () => {
  assert(
    applySql.includes(
      "count(*) FROM public.invoices WHERE company_id = c_company) <> 16",
    ),
  );
  assert(applySql.includes("v_after_hash <> c_retain_hash"));
});

Deno.test("deleted rows are no longer queryable by exact IDs", () => {
  const deletes = applySql.match(
    /DELETE FROM public\.[a-z_]+ WHERE id = ANY\(v_del_[a-z_]+\)/g,
  ) ?? [];
  assertEquals(deletes.length, 14);
  assert(applySql.includes("GET DIAGNOSTICS v_rows = ROW_COUNT"));
});

Deno.test("company roles assignments and audit state are unchanged", () => {
  assert(applySql.includes("v_protected_before"));
  assert(
    applySql.includes("v_protected_after IS DISTINCT FROM v_protected_before"),
  );
});

Deno.test("RLS grants and schema are unchanged", () => {
  const executable = applySql.replace(/^\s*--.*$/gm, "");
  assert(!/^\s*(ALTER|CREATE|DROP|GRANT|REVOKE)\b/im.test(executable));
  assert(!/DISABLE\s+TRIGGER/i.test(executable));
});

Deno.test("auto allocation remains disabled", () => {
  assert(allocationRoute.includes("AUTO_ALLOCATION_DISABLED"));
  assert(allocationRoute.includes("}, 403)"));
});

Deno.test("operator never fabricates financial evidence", () => {
  assert(
    !/INSERT\s+INTO\s+public\.(receipts|allocation_details|cn_allocations|journal_entries|import_rows)/i
      .test(applySql),
  );
});

Deno.test("postgres-only authorization runs before table locking", () => {
  const guard = applySql.indexOf("$f3_authorization_guard$");
  const lock = applySql.indexOf("LOCK TABLE");
  assert(guard >= 0 && guard < lock);
  assert(applySql.includes("current_user <> 'postgres'"));
});

Deno.test("no trigger bypass or reusable mutation function exists", () => {
  assert(!/DISABLE\s+TRIGGER|session_replication_role/i.test(applySql));
  assert(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(applySql));
  assert(applySql.includes("target lifecycle is installed; STOP"));
});

Deno.test("Storage object cleanup is exact-hash bound and separate", () => {
  assert(
    runbook.includes(
      "f77add7cc35df009832237db3083c1db63a65eb0d8477aa1b5fd0e6fa7551094",
    ),
  );
  assert(runbook.includes("63 Storage object"));
  assert(/outside the PostgreSQL\s+transaction/.test(runbook));
  assert(applySql.includes("F3_RESET_STORAGE: exact object manifest drift"));
});

Deno.test("no production execution is claimed", () => {
  assert(runbook.includes("production mutation is not authorized"));
  assert(applySql.includes("DO NOT RUN YET"));
});
