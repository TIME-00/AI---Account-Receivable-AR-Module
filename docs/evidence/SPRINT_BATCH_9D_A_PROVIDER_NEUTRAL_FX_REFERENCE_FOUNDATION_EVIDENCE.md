# Sprint Batch 9D-A Provider-Neutral FX Reference Foundation Evidence

## Scope

Batch 9D-A implements the provider-neutral FX reference foundation only.

Implemented:

- `public.fx_reference_rates` for reference/provider FX rates.
- `public.fx_sync_runs` for sync observability.
- RLS for company-scoped authenticated read.
- Service-role-only write boundary through backend sync paths.
- Provider adapter interface.
- Deterministic mock provider.
- Pair-direction validation using `from_currency` and `to_currency`.
- Idempotent duplicate handling.
- Immutable/versioned correction behavior.
- Overlap protection through a scoped advisory-lock helper.
- Partial failure recording.
- Reference read API.
- Privileged mock/manual sync API.
- Local backend tests and safety scans.

Not implemented:

- No real FX provider.
- No external FX API call.
- No provider credentials.
- No real provider adapter.
- No cron activation.
- No production sync.
- No frontend UX.
- No report/dashboard correction.
- No booking-rate promotion.

## Baseline

- Approved plan commit: `f7ba7dec439f342d8eeee9015c8ae5ead6285ae4`
- Branch: `main`
- Baseline HEAD/origin/main before implementation: `f7ba7dec439f342d8eeee9015c8ae5ead6285ae4`
- Worktree before implementation: clean

## Files changed

- `database/017_fx_reference_foundation.sql`
- `backend/supabase/functions/fx-rate-sync/deno.json`
- `backend/supabase/functions/fx-rate-sync/index.ts`
- `backend/supabase/functions/fx-rate-sync/provider.ts`
- `backend/supabase/functions/fx-rate-sync/service.ts`
- `backend/supabase/functions/fx-rate-sync/types.ts`
- `backend/supabase/functions/fx-rate-sync/validation.ts`
- `backend/supabase/functions/fx-rate-sync/fx_reference_test.ts`
- `backend/supabase/functions/fx-rates/deno.json`
- `backend/supabase/functions/fx-rates/index.ts`
- `backend/supabase/functions/fx-rates/service.ts`
- `docs/evidence/SPRINT_BATCH_9D_A_PROVIDER_NEUTRAL_FX_REFERENCE_FOUNDATION_EVIDENCE.md`

## Database migration summary

Migration created:

- `database/017_fx_reference_foundation.sql`

Tables:

- `public.fx_sync_runs`
- `public.fx_reference_rates`

Key constraints and indexes:

- `fx_sync_runs.status` bounded to `Running`, `Succeeded`, `PartialFailure`, `Failed`.
- `fx_reference_rates.status` bounded to `Active`, `Superseded`.
- `from_currency` and `to_currency` are three-letter uppercase currency codes and must differ.
- `rate > 0`.
- One Active reference row per company/from/to/effective_date/provider/provider_rate_type key.
- Lookup indexes for company/pair/provider/effective_date.
- Run indexes for company/provider/effective_date and company/started_at.

RLS:

- RLS enabled on both new tables.
- Authenticated users can SELECT only rows for companies they can access through existing `rls_has_company_access`.
- No authenticated INSERT/UPDATE/DELETE policies were created.
- Service-role grants are limited to backend-controlled sync/write paths.

Helper RPCs:

- `public.fx_try_sync_lock(company_id, provider)` provides scoped advisory-lock overlap protection.
- `public.fx_upsert_reference_rate(...)` performs transactional insert/noop/correct behavior for versioned reference rates.
- Both helper RPCs revoke public/authenticated execute and grant execute to `service_role` only.

No migration writes to `public.exchange_rates`.

## Pair-direction semantics

Columns use explicit direction:

- `from_currency` = transaction/foreign/reference source currency.
- `to_currency` = company base currency for the company-scoped reference pair.
- `rate` means: `1 from_currency = rate to_currency`.

Example:

- `from_currency = SGD`
- `to_currency = MYR`
- `rate = 3.48000000`
- Meaning: `1 SGD = 3.48 MYR`

Provider data is not silently inverted. Inverted direction is rejected by validation.

## Mock provider architecture

Implemented deterministic mock provider:

- Provider id: `mock_batch_9d_a`
- Source host identifier: `mock.fx.local`
- No external network calls.
- No API key.
- No environment secret.
- Supports deterministic scenarios:
  - success
  - malformed
  - invalid-rate
  - inverted-pair
  - unsupported-currency
  - partial-failure
  - duplicate
  - correction

The mock provider is suitable for local tests and future controlled staging tests.

## Sync lifecycle

`fx-rate-sync` provides a provider-neutral mock/manual route:

- `POST /fx-rate-sync/mock-sync`

Lifecycle:

1. Authenticates user and company context.
2. Requires `Finance Manager` or `System Admin`.
3. Loads company base currency.
4. Starts `fx_sync_runs` row as `Running`.
5. Acquires scoped advisory lock.
6. Fetches deterministic mock data.
7. Normalizes and validates each pair.
8. Inserts/noops/corrects versioned reference rows through `fx_upsert_reference_rate`.
9. Records pair counts.
10. Marks run `Succeeded`, `PartialFailure`, or `Failed`.

No real scheduler is activated.

## Idempotency and correction behavior

Duplicate unchanged ingestion:

- Existing Active row with same logical key and same rate results in `noop`.
- No duplicate Active row is created.

Historical correction:

- Changed rate for the same logical key supersedes the previous Active row.
- A new Active row is inserted.
- The new row links to the superseded row through `supersedes_rate_id`.
- Prior history is preserved.
- Behavior is handled in the database function for transactional consistency.

Booked invoice/receipt snapshots are unaffected.

## Overlap and abandoned run recovery

Overlap protection:

- `public.fx_try_sync_lock(company_id, provider)` uses a transaction-scoped PostgreSQL advisory lock.
- Concurrent sync for the same company/provider scope is rejected.

Recovery:

- The lock is transaction-scoped and cannot remain held after the request transaction ends.
- If a previous run record is left as `Running` by an infrastructure failure, a later retry remains idempotent because Active rate uniqueness and correction semantics are enforced at the database layer.
- Future operational cleanup of stale `Running` rows can be implemented as an observability/ops task without affecting booked transactions.

## Partial failure and retry behavior

Partial failure:

- Successful pairs are retained.
- Failed pairs increment `failed_pair_count`.
- Run status becomes `PartialFailure`.
- Error summaries are sanitized and bounded.

Safe retry:

- Re-running unchanged pairs is idempotent.
- Corrected provider values create versioned corrections.
- No unrelated successful pair is rolled back due to another pair failure.

## FX reference read API

`fx-rates` provides authenticated, company-scoped reference read routes:

- `GET /fx-rates/latest`
- `GET /fx-rates/lookup?from_currency=SGD&to_currency=MYR&requested_date=YYYY-MM-DD`
- `GET /fx-rates/history?from_currency=SGD&to_currency=MYR`
- `GET /fx-rates/health`

Responses identify:

- `from_currency`
- `to_currency`
- `rate`
- provider
- provider rate type
- actual effective date
- requested date where applicable
- fetched timestamp
- stale state
- correction/version metadata where safe
- `reference_only: true`

The API does not claim these rates are accounting-authoritative.

## Weekend/holiday lookup behavior

Implemented reference lookup semantics:

- Provider effective date is preserved.
- No fake weekend rows.
- No synthetic holiday rows.
- Requested-date lookup uses latest `effective_date <= requested_date`.
- Response exposes the actual effective date used.

Tests cover Saturday/Sunday style fallback and holiday-like gaps.

## Security boundaries

Confirmed by implementation and scans:

- Backend-only provider access.
- Deterministic mock provider only.
- No real provider host.
- No external provider network call.
- No provider credentials.
- No frontend provider secrets.
- No `NEXT_PUBLIC` FX/provider key.
- No user-controlled provider URL.
- Sanitized bounded error summaries.
- Authenticated company-scoped read API.
- Privileged backend sync write path.
- No anonymous public read.
- Public schema only.

## Financial zero-mutation boundary

9D-A does not:

- write `public.exchange_rates`;
- update invoice exchange rates or base totals;
- update receipt exchange rates or base amounts;
- update invoice outstanding balances;
- update receipt allocated/unallocated balances;
- insert `allocation_details`;
- create journal entries or journal entry lines;
- call financial RPCs;
- call or modify `/allocations/auto`.

Existing booked transaction snapshots and realized FX allocation accounting are untouched.

## Tests and checks run

Commands:

```text
cd backend/supabase/functions
deno check fx-rate-sync/index.ts fx-rates/index.ts
deno test --no-lock --allow-read=../../.. --config fx-rate-sync/deno.json fx-rate-sync/fx_reference_test.ts
```

Results:

- `deno check`: PASS
- Targeted Deno tests: PASS, 13 passed / 0 failed

Test coverage includes:

- provider normalization;
- pair direction;
- inversion rejection;
- precision;
- zero/negative rate rejection;
- unsupported currency;
- future effective date rejection;
- deterministic mock provider;
- partial failure;
- duplicate sync idempotency decision;
- historical correction/versioning decision;
- requested-date fallback;
- stale calculation;
- safe read API pair parsing;
- sanitized error redaction;
- migration RLS/unique/no-`exchange_rates`-write source checks.

Additional safety scans were run for:

- external provider URLs/network calls;
- provider credentials/API keys;
- `NEXT_PUBLIC` provider secrets;
- JWT/token leakage;
- user-controlled URL;
- writes to `exchange_rates`;
- protected financial DML;
- `/allocations/auto` changes;
- `ar.*` schema usage.

Findings:

- No real provider URLs or external FX calls were introduced.
- No provider credentials were introduced.
- No `exchange_rates` write path was introduced.
- No protected financial DML was introduced.
- No `/allocations/auto` change was introduced.
- No `ar.*` schema was introduced.

Expected safe scan matches:

- Deno import-map URL for Supabase library.
- `service_role` grants in the migration.
- Synthetic redaction-test strings in unit tests.

## Deployment and environment actions

Not performed:

- No migration was applied to staging.
- No migration was applied to production.
- No Edge Function was deployed.
- No frontend deployment occurred.
- No staging sync was run.
- No production sync was run.
- No external FX provider was called.
- No provider credential was configured.
- No cron was configured or activated.

## Known limitations

- 9D-A uses only a deterministic mock provider.
- Real provider selection and real scheduler behavior remain blocked until DG-1 and explicit user approval.
- `public.exchange_rates` remains the booking source and is intentionally not populated or promoted from reference rates.
- Report/dashboard monetary aggregation correction is out of scope for 9D-A.
- Frontend UX for reference-vs-booked rates is out of scope for 9D-A.
- Stale `Running` run operational cleanup is not implemented as a separate cleanup feature; duplicate/retry safety is enforced by the advisory lock and rate-level idempotency/versioning.

## Next gate recommendation

Proceed to Codex post-implementation review for Batch 9D-A.

After review, a separate staging readiness/deployment gate is required before applying the migration or deploying the new Edge Functions to staging.
