# Batch 9D-B Real Provider Integration and Scheduler Staging Implementation Evidence

Status: implementation evidence only. Staging deployment, scheduler activation, production deployment, and
production provider calls were not performed.

## Baseline

- Approved implementation baseline: `f5b4c3b02a43f563efcc268f8ada01fe697064c3`
- Batch: 9D-B — Real Provider Integration and Scheduler Staging
- Scope: backend/provider adapter, routes, scheduler-auth boundary, local tests, static scans, and
  scheduler configuration artifact.

## Implemented source behavior

- Added a real Frankfurter v2 provider adapter behind the existing provider abstraction.
- Preserved the deterministic mock provider and `/fx-rate-sync/mock-sync` route.
- Added manual real sync route: `POST /fx-rate-sync/sync`.
- Added scheduled sync route: `POST /fx-rate-sync/scheduled-sync`.
- Reused the existing 9D-A sync lifecycle:
  - `fx_acquire_sync_lease`
  - `fx_renew_sync_lease`
  - `fx_upsert_reference_rate`
  - `fx_complete_sync_run`
- Reused existing lease overlap protection, stale recovery, transactional fencing, versioned correction,
  and duplicate/noop behavior.

## Locked provider contract implemented

- Host: `https://api.frankfurter.dev/v2`
- Endpoint: `GET /rates`
- Query parameters:
  - `base=<from_currency>`
  - `quotes=<to_currency>`
  - `date=<requested_date>` for manual/date-mode requests
  - `providers=MAS`
  - `expand=providers`
- Provider: `MAS`
- Source host recorded: `api.frankfurter.dev`
- Authentication: no provider API key.

## MAS attribution and provenance

- Every real provider request includes `providers=MAS` and `expand=providers`.
- Returned provider attribution must include only `MAS`.
- Missing, empty, absent-MAS, or conflicting attribution fails closed with `FX_PROVIDER_MISMATCH`.
- Internally persisted `provider='MAS'` is not accepted as proof by itself.
- Provider rate type is conservatively classified as `frankfurter-rebased-mas-reference`.

## Scheduler implementation boundary

- Scheduler route uses a dedicated internal scheduler secret header.
- The scheduler route does not accept a user JWT as scheduler authorization.
- The scheduler route does not use a service-role key in cron.
- Runtime secret values are not committed.
- Company scope is configured via `FX_SCHEDULER_COMPANY_ID`.
- Initial pair scope is fixed to:
  - `SGD -> MYR`
  - `USD -> MYR`
  - `EUR -> MYR`
- If the configured company base currency is not `MYR`, the sync fails closed and requires plan amendment.

## Scheduler artifact decision

No `database/021_fx_scheduler_staging.sql` scheduler migration was created in this implementation commit
because scheduler activation is not authorized in this task and the final cron/Vault wiring is
staging-environment specific. A scheduler staging configuration runbook was created instead:

`docs/runbooks/BATCH_9D_B_SCHEDULER_STAGING_CONFIGURATION_RUNBOOK.md`

The later staging gate may create a forward-only scheduler migration or staging SQL artifact if SQL-managed
cron setup is required. No raw secret may be stored in SQL.

## Database migration

Created:

`database/021_fx_real_provider_identifier_support.sql`

Reason: Batch 9D-A provider constraints allowed lowercase mock provider IDs only, while DG-1 locks the
official Frankfurter provider key as uppercase `MAS`. Migration 021 widens the provider identifier check
constraints on `fx_sync_runs`, `fx_reference_rates`, and `fx_sync_leases` to accept uppercase official
provider keys. It does not create scheduler jobs, does not store secrets, does not call providers, does
not write `public.exchange_rates`, and does not mutate financial tables.

## Local implementation proof

- Deno check for affected Edge Functions: PASS.
  - `deno check fx-rate-sync/index.ts fx-rates/index.ts`
- Targeted FX reference/provider tests: PASS.
  - `deno test --no-lock --allow-read=../../.. --config fx-rate-sync/deno.json fx-rate-sync/fx_reference_test.ts`
  - Result: 30 passed / 0 failed.
- `git diff --check`: PASS.
- Static scan for `public.exchange_rates` DML: PASS, no DML found.
- Static scan for financial mutation paths: PASS; matches were safe boundary/test references only.
- Static scan for arbitrary provider host/URL handling: PASS; provider request uses fixed
  `FRANKFURTER_BASE_URL`.
- Mojibake scan: PASS.
- Secret-pattern scan: PASS; matches were safe fake test strings only, no real secret values.

## Pending staging proof

The following are not claimed as proven by this implementation task:

- real Frankfurter connectivity;
- on-the-wire `providers=MAS`;
- on-the-wire `expand=providers`;
- MAS attribution from live response;
- real weekend/holiday/no-publication behavior;
- scheduler invocation through `pg_cron`/`pg_net`;
- scheduler auth through Supabase Vault;
- staging RLS/regression matrix;
- zero financial mutation runtime comparison;
- staging cleanup.

## Staging runtime verification - 2026-07-08

Status: Batch 9D-B staging runtime verification executed on staging project
`gcdsdyegwjdcskpukqlq` only. Production project `kusseuycqgdilychphpq` was not
targeted.

### Target and baseline

- Git baseline before staging actions: `b42e740984a49cf803dc7bc8fbe8aeb0dfd3f354`.
- Root Supabase context: staging project `gcdsdyegwjdcskpukqlq`.
- Backend Supabase contexts were observed to remain production-linked and were
  not used for linked DB/deploy operations.
- Selected staging company: `TSH-MY` / `TSH Synergy Sdn Bhd`,
  `00000000-0000-0000-0000-000000000001`, base currency `MYR`.

### Migration 021

- Applied `database/021_fx_real_provider_identifier_support.sql` to staging.
- Post-apply constraints on `fx_sync_runs`, `fx_reference_rates`, and
  `fx_sync_leases` now accept uppercase provider identifiers:
  `^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$`.
- FX row counts immediately after migration remained zero for
  `fx_sync_runs`, `fx_reference_rates`, and `fx_sync_leases`.
- Helper RPC privilege boundary remained intact:
  - anon execute: denied;
  - authenticated execute: denied;
  - service_role execute: allowed.
- The staging database did not expose a standard
  `supabase_migrations.schema_migrations` table; migration application was
  verified through live object/constraint state.

### Edge Function and secrets

- Deployed only `fx-rate-sync` to staging.
- Deployment result: `fx-rate-sync` ACTIVE version 2, `verify_jwt=false`.
- `fx-rates` was not redeployed.
- Configured staging runtime secrets:
  - `FX_SCHEDULER_SECRET`;
  - `FX_SCHEDULER_COMPANY_ID`.
- Raw secret values were not printed, committed, or recorded.

### Local verification during staging gate

- `deno check fx-rate-sync/index.ts fx-rates/index.ts`: PASS.
- `deno test --no-lock --allow-read=../../.. --config fx-rate-sync/deno.json fx-rate-sync/fx_reference_test.ts`: PASS, 30 passed / 0 failed.

### Manual real-provider route authorization

Route: `POST /fx-rate-sync/sync`.

| Role | Result |
| --- | --- |
| Finance Manager | HTTP 200, allowed |
| System Admin | HTTP 200, allowed |
| AR Clerk | HTTP 403, denied |
| AR Supervisor | HTTP 403, denied |
| Auditor | HTTP 403, denied |
| Unauthenticated | HTTP 401, denied |

Temporary staging-only role assignments were created for the existing staging
test users on the MYR company and removed during cleanup.

### Real Frankfurter/MAS provider proof

- First one-pair smoke: `SGD -> MYR`, provider `MAS`, requested date
  `2024-07-03`.
- Result: terminal `Succeeded`, attempted 1, succeeded 1, failed 0.
- Live provider rows persisted with:
  - provider `MAS`;
  - source host `api.frankfurter.dev` on `fx_sync_runs`;
  - provider rate type `frankfurter-rebased-mas-reference`;
  - fetched timestamp present;
  - explicit direction preserved.
- Approved pair matrix result for `2024-07-03`:
  - `SGD -> MYR`: Active, rate `3.47830000`;
  - `USD -> MYR`: Active, rate `4.71970000`;
  - `EUR -> MYR`: Active, rate `5.07100000`.
- Three-pair sync result: terminal `Succeeded`, attempted 3, succeeded 3,
  failed 0, inserted 2, unchanged 1.
- Latest-mode scheduled route persisted provider-returned effective date
  `2026-07-07` for all three pairs while the run/request date was
  `2026-07-08`.
- Historical weekend request `2024-07-06` for `SGD -> MYR` persisted provider
  effective date `2024-07-05`; no fabricated weekend row was stored.

Controlled local simulation remains the proof source for malformed payload,
missing attribution, empty attribution, conflicting attribution, timeout, and
selected HTTP error behavior.

### Scheduled route authentication

Route: `POST /fx-rate-sync/scheduled-sync`.

| Case | Result |
| --- | --- |
| Missing scheduler secret | HTTP 401, denied |
| Wrong scheduler secret | HTTP 401, denied |
| User JWT only | HTTP 401, denied |
| Valid scheduler secret with body override attempt | HTTP 200, allowed |

The valid scheduled route invocation ignored attempted body overrides and used
the configured company and fixed pair allowlist.

### RLS and helper privilege regression

- Direct helper RPC invocation:
  - anon: HTTP 401 / `42501`, denied;
  - authenticated: HTTP 403 / `42501`, denied;
  - service-role path: proved through successful Edge Function sync execution.
- DB-side RLS simulation:
  - same-company authenticated `fx_reference_rates` read: 7 visible rows;
  - same-company authenticated `fx_sync_runs` read: 8 visible rows at check time;
  - same-company authenticated `fx_sync_leases` read: 0 visible rows because no lease was active;
  - cross-company reads: 0 rows;
  - anon reads: 0 rows.
- Authenticated INSERT attempts into `fx_sync_runs`, `fx_reference_rates`, and
  `fx_sync_leases` were denied by RLS.
- Authenticated UPDATE/DELETE attempts against protected FX reference rows
  returned zero affected rows.

### Lease, overlap, stale recovery, and fencing regression

- Manual real sync overlap against an active MAS lease: HTTP 409.
- Scheduled sync overlap against the same active MAS lease: HTTP 409.
- Controlled expired lease reclaim:
  - successor acquired ownership;
  - predecessor run was terminalized as `Failed`;
  - predecessor `error_category = FX_SYNC_LEASE_EXPIRED`.
- Old-owner behavior after successor reclaim:
  - renew returned `FX_SYNC_LEASE_LOST`;
  - completion returned `FX_SYNC_LEASE_LOST`;
  - protected upsert failed closed with `FX_SYNC_LEASE_LOST`.
- Normal cleanup/release left MAS lease count at 0.

### Read API smoke

Routes tested on staging using MAS reference rows:

- `/fx-rates/latest`: HTTP 200, `reference_only=true`, 3 rows.
- `/fx-rates/lookup`: HTTP 200, `reference_only=true`, found result.
- `/fx-rates/lookup` missing case: HTTP 200, `reference_only=true`,
  `found=false`.
- `/fx-rates/history`: HTTP 200, `reference_only=true`, 3 rows.
- `/fx-rates/health`: HTTP 200, `reference_only=true`.

Known non-blocking note remains: `/fx-rates/latest` applies a global limit
before application-side grouping.

### Scheduler infrastructure and runtime proof

- Enabled staging extensions:
  - `pg_cron` 1.6.4;
  - `pg_net` 0.20.0;
  - `supabase_vault` 0.3.1 already installed.
- Stored scheduler secret in Vault under name
  `batch_9d_b_fx_scheduler_secret`; raw value was not recorded.
- Created staging cron job:
  - job name: `batch_9d_b_fx_scheduler_staging`;
  - job id: 1;
  - schedule: `30 7 * * *` UTC, equivalent to 15:30 Asia/Singapore;
  - active: true;
  - invocation target:
    `https://gcdsdyegwjdcskpukqlq.supabase.co/functions/v1/fx-rate-sync/scheduled-sync`;
  - credential source: Vault secret lookup.
- Manual `pg_net` invocation using the same Vault/header path:
  - first request reached the Edge Function, HTTP 200, terminal
    `PartialFailure` due to sanitized transient `SGD/MYR:
    FX_PROVIDER_SERVER_ERROR`;
  - retry reached the Edge Function, HTTP 200, terminal `Succeeded`,
    attempted 3, succeeded 3, failed 0, unchanged 3.
- Scheduler remains active for continued staging observation.

### Financial zero-mutation proof

Before and after fingerprints/counts matched exactly:

| Table | Count | Fingerprint |
| --- | ---: | --- |
| `allocation_details` | 5 | `524c13c4bbd99e25ad957507f3801077` |
| `cn_allocations` | 1 | `69e431d0cad7dddb8f873fc509cdbbd4` |
| `exchange_rates` | 10 | `be192dc6a9a2e7fe66efb525a9720adf` |
| `import_row_allocations` | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `invoice_lines` | 33 | `399c2bc6685c5fe1253462a821cd0902` |
| `invoices` | 35 | `134baf7b7e2221bcf3a241d480ac2f8d` |
| `journal_entries` | 42 | `7d0898458a1eb9252dcfa070628ef2aa` |
| `journal_entry_lines` | 84 | `5a0cfb8d602fdb682f5f09678eee6272` |
| `receipts` | 13 | `fe03257d3e43f05ea8ae1dc1c87127eb` |

Result: **NO FINANCIAL CHANGE CAUSED BY 9D-B PROVIDER/SCHEDULER TESTS**.

### Cleanup / retention

- Removed temporary staging-only MYR-company role assignments; final count 0.
- Removed synthetic helper-run artifacts for overlap/reclaim setup.
- Removed local temporary scheduler secret file.
- Final MAS lease count: 0.
- Final orphan MAS `Running` runs: 0.
- Retained legitimate staging MAS provider artifacts:
  - 7 MAS reference rows;
  - 10 MAS sync runs.
- Staging scheduler job remains active for continued staging observation.

### Deviations / limitations

- `fx_reference_rates` does not have a `source_host` column; source host is
  recorded on `fx_sync_runs` and returned in sync responses.
- `FxSyncResult.effective_date` reports the requested/run date, while the
  provider-returned effective date is correctly persisted on
  `fx_reference_rates`. This is an observability wording/response-shape note,
  not a persistence defect.
- Standard Supabase migration-history metadata was unavailable in this staging
  database; migration 021 was verified through live constraint state instead.
- Direct REST access to FX tables returned PostgREST 404, so RLS was verified
  through database-side role/JWT-claim simulation plus helper/API behavior.
- One `pg_net` scheduler-path invocation produced a sanitized transient
  provider `PartialFailure`; an immediate retry using the same path succeeded.

## Safety boundaries

- Staging deployment and staging scheduler activation were performed only after
  explicit user approval for this staging runtime verification gate.
- No production deployment.
- No production provider call.
- No production scheduler activation.
- No provider credential or API key was introduced.
- No `public.exchange_rates` write.
- No invoice, receipt, allocation, journal, or balance mutation.
- No `/allocations/auto` change.
