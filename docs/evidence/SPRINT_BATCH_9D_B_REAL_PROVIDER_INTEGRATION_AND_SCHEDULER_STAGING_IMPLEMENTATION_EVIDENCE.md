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

## Safety boundaries

- No staging deployment.
- No scheduler activation.
- No production deployment.
- No production provider call.
- No provider credential.
- No `public.exchange_rates` write.
- No invoice, receipt, allocation, journal, or balance mutation.
- No `/allocations/auto` change.
