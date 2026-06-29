# Sprint Batch 8F2 XLSX Parser Security Remediation Evidence

## 1. Scope and final result

- Date: 2026-06-29 (Asia/Kuala_Lumpur).
- Baseline commit: `6c10c14e50e3e0dbcba1eeb51d6b7f9d7607ab62`.
- Baseline subject: `fix(security): upgrade Next.js runtime to 15.5.19`.
- Batch: 8F2 - XLSX Parser Supply-Chain and Runtime Remediation.
- Local implementation result: **PASS**.
- Staging validation result: **PASS**.
- Overall Batch 8F2 result: **PASS**.
- Production rollout remains **PAUSED** until final review/commit and the separately approved production rollout.

The implementation vendors the official SheetJS Community Edition 0.20.3 ESM artifact and removes
the vulnerable SheetJS 0.18.5 runtime mapping. No CSV-only fallback was required.

No production action, production deployment, production migration, production fixture execution, or
production data mutation occurred.

## 2. Official artifact provenance

Authoritative source: SheetJS CDN, as specified by the official SheetJS Deno installation
documentation.

Retrieval date: 2026-06-23 (Asia/Kuala_Lumpur).

| File | Official source | SHA-256 |
| --- | --- | --- |
| `xlsx.mjs` | `https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs` | `1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db` |
| `types/index.d.ts` | `https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts` | `191e4e6aceae3602aa3a1e9a6bc0e98821d6d5fb787e2bc16e250439482bddb6` |
| `LICENSE` | `https://cdn.sheetjs.com/xlsx-0.20.3/package/LICENSE` | `4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64` |

The `xlsx.mjs` digest exactly matches the repository's pre-existing Deno lock integrity entry for
the same official 0.20.3 CDN artifact. No unofficial mirror, npm copy, or transformed bundle was
used.

License:

- SheetJS Community Edition;
- Apache License 2.0;
- required SheetJS attribution retained in the vendored directory.

Vendored provenance files:

- `ATTRIBUTION.md`;
- `PROVENANCE.md`;
- `SHA256SUMS`;
- complete `LICENSE`.

## 3. Files changed

- `backend/supabase/functions/imports/deno.json`
- `backend/supabase/functions/imports/xlsx.ts`
- `backend/supabase/functions/import_map.json`
- `backend/supabase/functions/deno.lock`
- `backend/supabase/functions/imports/parser_security_test.ts`
- `backend/supabase/functions/imports/vendor/sheetjs-0.20.3/xlsx.mjs`
- `backend/supabase/functions/imports/vendor/sheetjs-0.20.3/types/index.d.ts`
- `backend/supabase/functions/imports/vendor/sheetjs-0.20.3/LICENSE`
- `backend/supabase/functions/imports/vendor/sheetjs-0.20.3/ATTRIBUTION.md`
- `backend/supabase/functions/imports/vendor/sheetjs-0.20.3/PROVENANCE.md`
- `backend/supabase/functions/imports/vendor/sheetjs-0.20.3/SHA256SUMS`
- `docs/evidence/SPRINT_BATCH_8F2_XLSX_PARSER_SECURITY_REMEDIATION_EVIDENCE.md`

No frontend source change was required because XLSX behavior is preserved.

## 4. Dependency-path remediation

Before:

- the imports function mapped `xlsx` to `https://esm.sh/xlsx@0.18.5?target=deno`;
- the shared import map contained a separate SheetJS 0.20.3 CDN alias;
- the root Deno lock contained the remote 0.20.3 artifact entry;
- `xlsx.ts` imported the bare `xlsx` specifier.

After:

- `xlsx.ts` imports the local vendored 0.20.3 ESM file directly;
- matching local type declarations are selected with `@deno-types`;
- the vulnerable function-level 0.18.5 mapping is removed;
- the stale global `xlsx` alias is removed;
- the obsolete remote SheetJS entry is removed from the Deno lock;
- the imports bundle has no remote SheetJS runtime dependency.

Active runtime scans found no:

- `esm.sh/xlsx@0.18.5`;
- `xlsx@0.18.5`;
- bare `xlsx` runtime import;
- remote SheetJS execution path.

The official CDN URLs remain only in non-executable provenance documentation.

## 5. Parser/security tests

Added `imports/parser_security_test.ts` with in-memory tests only. No staging, production, storage,
or database record is used.

Covered:

- valid CSV parsing;
- valid XLSX parsing with vendored SheetJS 0.20.3;
- malformed/truncated workbook rejection;
- empty-sheet rejection;
- duplicate normalized header rejection;
- XLSX files over 10 MB rejected before persistence.

Result:

```text
6 passed
0 failed
```

The oversized-file test injects a non-operational client and confirms the existing size guard throws
before any database or storage method can run.

## 6. Local validation

Passed:

```text
deno check --no-lock --config imports/deno.json imports/index.ts
deno check --config imports/deno.json imports/index.ts
deno test --no-lock --config imports/deno.json imports/parser_security_test.ts
deno check invoices/index.ts receipts/index.ts allocations/index.ts customers/index.ts reports/index.ts bank-accounts/index.ts
npm.cmd run build
git diff --check
```

Additional checks:

- artifact hashes match `SHA256SUMS`;
- Next.js 15.5.19 production build passed with all 23 routes;
- frontend source remained unchanged;
- financial RPC and migration files remained unchanged;
- no generated CSV/XLSX fixture was added or staged;
- generated function-local `imports/deno.lock` created by a Deno validation command was removed;
- the tracked root `backend/supabase/functions/deno.lock` remains the only repository Deno lock;
- no secret, token, or JWT value was written;
- `POST /allocations/auto` remains hard-coded HTTP 403 `AUTO_ALLOCATION_DISABLED`;
- no executable `autoAllocate()` implementation exists.

## 7. Staging validation result

Target staging project:

`gcdsdyegwjdcskpukqlq`

Pre-deployment targeting:

- all required staging environment variables were present;
- `SUPABASE_URL` targeted only `https://gcdsdyegwjdcskpukqlq.supabase.co`;
- production project ref was not present in the active environment scan;
- no token values were printed or written.

Deploy command:

```text
supabase functions deploy imports --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
```

Result: **PASS**. Only the `imports` Edge Function was deployed to staging.

Staging function metadata:

- `imports`: `ACTIVE`;
- version: `7`;
- import map path: function-level `supabase/functions/imports/deno.json`;
- deployed asset list included `imports/vendor/sheetjs-0.20.3/xlsx.mjs`.

Boot/read check:

- `GET /imports?page_size=1` with a Finance Manager staging token returned HTTP 200.

No production project was targeted.

### Initial credential blocker

The first staging attempt was blocked because the process initially had no Supabase access token,
staging URL, anon key, staging company ID, or staging role tokens. The Supabase CLI stopped before
any project action with:

```text
Access token not provided. Supply an access token by running supabase login or
setting the SUPABASE_ACCESS_TOKEN environment variable.
```

## 8. Functional staging smoke

Runtime prefix:

`B8F2-XLSXSEC-20260629142821`

Customer used:

- `85000000-0000-0000-0000-000000000001`;
- `P1 API Assigned Customer`.

Bank account used:

- `84000000-0000-0000-0000-000000000001`.

The runtime CSV/XLSX files were generated under the OS temporary directory, were never tracked, and
were removed after validation.

### Invoice CSV

- Batch: `81421d56-6036-46c3-87a3-d5a61b9b7f13`.
- Invoice: `93476330-22be-4721-9e7d-b89be9aa6de5`.
- Upload/parse/validate/execute: **PASS**.
- Readback: HTTP 200.
- Persisted lines: 1.
- Cleanup: posted through the supported invoice API, then cancelled through the supported invoice API.
- Final state: `Cancelled`, outstanding `0`.

### Invoice XLSX / vendored SheetJS 0.20.3

- Batch: `ed0e42ad-916b-4bc3-8045-1f4d1ce62266`.
- Invoice: `ff6f683e-c718-473a-85bb-5afdff6d6934`.
- Upload/parse/validate/execute: **PASS**.
- Readback: HTTP 200.
- Persisted lines: 1.
- Cleanup: posted through the supported invoice API, then cancelled through the supported invoice API.
- Final state: `Cancelled`, outstanding `0`.

### Receipt CSV

- Batch: `729b71d6-2f3f-4529-848a-90196f2de52d`.
- Receipt: `61f640a1-c994-4e34-86e5-e59a20babdf5`.
- Upload/parse/validate/execute with `auto_post=true`: **PASS**.
- Readback: HTTP 200.
- Cleanup: cancelled through the supported receipt API.
- Final state: `Cancelled`, allocated/unallocated `0`/`0`.

### Receipt XLSX / vendored SheetJS 0.20.3

- Batch: `165f4b2d-5406-4aa1-a754-4718a06f902e`.
- Receipt: `377333e2-fec9-428e-88c2-88a5c24462ec`.
- Upload/parse/validate/execute with `auto_post=true`: **PASS**.
- Readback: HTTP 200.
- Cleanup: cancelled through the supported receipt API.
- Final state: `Cancelled`, allocated/unallocated `0`/`0`.

### Negative XLSX checks

- Malformed/truncated XLSX:
  - batch `f6b87941-8a15-4dcc-9297-dfc16baf0e3b`;
  - upload accepted as a file object;
  - parse rejected with HTTP 500 `INTERNAL_ERROR`;
  - result: **PASS for rejection**, with a caveat that malformed parser errors currently map to 500
    rather than a validation-specific 400.
- Oversized XLSX:
  - upload rejected before parse/execute;
  - HTTP 400 `VALIDATION_ERROR`;
  - result: **PASS**.

### Readback and safety regression

- Dashboard: HTTP 200.
- Aging report: HTTP 200.
- Invoice list: HTTP 200.
- Receipt list: HTTP 200.
- Allocation history/list: HTTP 200.
- `POST /allocations/auto`: HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- Cleanup audit: all created B8F2 financial documents are cancelled with zero active balance.

### Interrupted staging attempt and cleanup

An earlier staging smoke attempt used `payment_method=Bank Transfer`, which is not an accepted
receipt payment method. The receipt CSV row was marked `Error` and no receipt was created.

That interrupted attempt created two draft invoices:

- `b3f3760e-fb71-4751-95a4-aa3b7d6c7639`;
- `81123528-b400-40c6-b42f-0cae31c1f7da`.

Both were cleaned up through supported invoice APIs:

- posted through `POST /invoices/:id/post`;
- cancelled through `POST /invoices/:id/cancel`;
- final state: `Cancelled`, outstanding `0`, one persisted line each.

## 9. Rollback

Local/staging rollback unit:

- `imports/xlsx.ts`;
- `imports/deno.json`;
- shared `import_map.json`;
- root `deno.lock`;
- vendored SheetJS directory;
- parser test.

If the new imports function fails staging bundling or runtime validation:

- redeploy the previous known-good staging imports version;
- do not deploy SheetJS 0.18.5 to production;
- proceed to the separately approved CSV-only fallback if local vendoring cannot be made deployable.

The vulnerable 0.18.5 dependency must not be used as a production rollback.

## 10. Safety confirmations

- No financial RPC business logic changed.
- No database or migration changed.
- No direct `allocation_details` insert occurred.
- No direct invoice outstanding update occurred.
- No direct receipt allocated/unallocated update occurred.
- No automatic allocation behavior was enabled.
- No mock dashboard data was introduced.
- Staging financial records were created only through supported import/API flows and were cleaned up
  through supported post/cancel APIs.
- Remaining B8F2 staging records are append-only import batch/row/upload audit evidence and
  cancelled financial documents with zero active balance.
- No direct financial-table mutation occurred.
- No production user or financial record was created.
- No production deployment occurred.
- No commit or push occurred.
- No token values were printed or written.

## 11. Readiness

Batch 8F2 local implementation and staging validation are complete.

Result: **PASS**.

Batch 8F2 is ready for final review before commit/push.

Production rollout remains paused.
