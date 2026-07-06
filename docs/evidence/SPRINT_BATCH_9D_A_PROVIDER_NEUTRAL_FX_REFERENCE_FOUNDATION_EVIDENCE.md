# Sprint Batch 9D-A Provider-Neutral FX Reference Foundation Evidence

## Document status

> This document records **three** remediation stages and preserves the full history of all of them:
>
> 1. the **original Batch 9D-A implementation** (`48e93fdcccbc588ef8f235ba63fe117ecf7b8043`,
>    `feat(fx): add provider-neutral FX reference foundation`);
> 2. **Batch 9D-A Fix1** (`a562aaff767568ebe8dabe16bba386b4434e686c`,
>    `fix(fx): harden sync lease and rate concurrency`), which remediates a defect found in the
>    Post-Implementation Review; and
> 3. **Batch 9D-A Fix2** (`b551a694ee40ffc737214ed81be6385f1ce8e669`,
>    `fix(fx): fence reference writes by lease ownership`), which remediates a **remaining zombie-worker
>    / TOCTOU defect** found in the Post-Fix1 Review.
>
> Both the original implementation *and* Fix1 had real, distinct defects. This document does **not**
> rewrite either as though it had been fully correct. Original and Fix1 sections are retained as
> historical record; claims that a later stage supersedes are marked inline with a
> **`⚠ SUPERSEDED BY FIX1`** or **`⚠ SUPERSEDED BY FIX2`** note that points to the superseding
> section. In particular, Fix1's zombie-worker protection was **not** complete — see
> [§ Post-Fix1 Review finding](#post-fix1-review-finding-remaining-zombie-worker--toctou-defect).
>
> The final current architecture is:
>
> - **Fix1** — persistent lifecycle lease + acquire/renew/complete ownership model + same-key upsert
>   serialization; and
> - **Fix2** — transactional lease-row `FOR UPDATE` fencing inside the protected write + explicit lock
>   ordering + terminal-failure sync-count accuracy correction.
>
> **Current status:** *Batch 9D-A Fix2 implementation has completed local verification and is ready for
> Post-Fix2 Review. Runtime DB, RLS, grant, lease-recovery, and concurrency verification remain
> pending staging authorization and execution.*
>
> Batch 9D-A remains **reference-only**. No real provider, no Frankfurter integration, no scheduler, no
> `public.exchange_rates` write, and no financial mutation were introduced by the original
> implementation, Fix1, or Fix2.

---

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

> **`⚠ SUPERSEDED BY FIX1`** — `fx_try_sync_lock` is **dropped** by Fix1 migration
> `database/018_fx_reference_concurrency_hardening.sql` because a transaction-scoped advisory lock is
> not a valid lifecycle overlap guard. Fix1 replaces it with a persistent lease and owner-checked
> RPCs, and re-creates `fx_upsert_reference_rate` with an added `p_lease_token` owner fence and an
> in-RPC transaction-scoped critical section. See [§ Fix1 architecture](#fix1-architecture).

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

> **`⚠ SUPERSEDED BY FIX1`** — Step 5 above (original design) relied on the standalone
> transaction-scoped advisory-lock helper `fx_try_sync_lock`, which was released the moment its RPC
> transaction returned and therefore did **not** protect steps 6–10 of the lifecycle. Fix1 replaces
> this with a persistent DB-backed lease acquired atomically with the run start, renewed across the
> lifecycle, and released only on owner-checked completion. See
> [§ Post-Implementation Review finding](#post-implementation-review-finding) and
> [§ Fix1 architecture](#fix1-architecture).

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

> **`⚠ SUPERSEDED BY FIX1`** — This entire section describes the **original, defective** overlap
> guard. Post-Implementation Review found that a transaction-scoped advisory lock cannot serve as a
> lifecycle overlap guard, because it is released when the RPC transaction returns and does not span
> the remaining Edge Function lifecycle (provider fetch, normalization, validation, rate upserts,
> completion). The claims below are retained only as historical record and are **no longer the
> implemented behavior**. The current behavior is defined in
> [§ Post-Implementation Review finding](#post-implementation-review-finding),
> [§ Fix1 architecture](#fix1-architecture), and
> [§ Fix1 stale and zombie worker protection](#fix1-stale-and-zombie-worker-protection).

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

Results (original 9D-A implementation):

- `deno check`: PASS
- Targeted Deno tests: PASS, 13 passed / 0 failed

> **Note (Fix1):** Fix1 adds three concurrency/lease assertions, and the current suite is
> **16 passed / 0 failed**. The `13` figure above is retained as the original-implementation result.
> The current re-run is recorded in
> [§ Fix1 local verification](#fix1-local-verification).

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

---

# Batch 9D-A Fix1 — Lifecycle-Wide Sync Lease and Concurrent FX Reference Upsert Hardening

- **Fix1 commit:** `a562aaff767568ebe8dabe16bba386b4434e686c`
- **Fix1 message:** `fix(fx): harden sync lease and rate concurrency`
- **Baseline (original 9D-A) commit:** `48e93fdcccbc588ef8f235ba63fe117ecf7b8043`
- **Fix1 files changed:**
  - `database/018_fx_reference_concurrency_hardening.sql` (new migration)
  - `backend/supabase/functions/fx-rate-sync/service.ts`
  - `backend/supabase/functions/fx-rate-sync/types.ts`
  - `backend/supabase/functions/fx-rate-sync/fx_reference_test.ts`

## Post-Implementation Review finding

**Post-Implementation Review verdict:** `PASS WITH REQUIRED FIXES`.
**Gate recommendation:** `FIX REQUIRED BEFORE STAGING`.

**Finding — defective lifecycle overlap guard.** The original Batch 9D-A implementation guarded
against overlapping syncs with `pg_try_advisory_xact_lock`, invoked through a standalone
Supabase/PostgREST RPC (`public.fx_try_sync_lock`). A `*_xact_lock` advisory lock is
**transaction-scoped**: PostgreSQL releases it automatically when the transaction that acquired it
commits or rolls back. Because that lock was acquired inside its own short RPC transaction, it was
already released by the time the RPC returned.

Consequently the lock did **not** span the remaining Edge Function lifecycle, which executes as a
series of *separate* database round-trips after the lock RPC has returned:

- provider adapter execution (mock fetch);
- normalization;
- validation;
- reference-rate upserts;
- sync completion / run terminalization.

A second concurrent invocation could therefore acquire the same "lock" and proceed in parallel, and
an abandoned `Running` run had no bounded, owner-checked recovery path. The original evidence's claim
that this standalone advisory lock protected concurrent sync for the company/provider scope was
inaccurate for the full lifecycle, and has been marked
**`⚠ SUPERSEDED BY FIX1`** in the original sections above. No unqualified "the standalone advisory
lock protected the full Edge Function lifecycle" claim is retained.

## Fix1 architecture

Fix1 introduces migration `database/018_fx_reference_concurrency_hardening.sql`, which replaces the
lifecycle lock with a **persistent, owner-fenced lease** and hardens the rate upsert. It preserves
reference-only semantics and writes nothing to `public.exchange_rates`.

### Persistent lease table — `public.fx_sync_leases`

- Lease scope: **`company_id + provider`** (primary key).
- Owner identity: **`owner_run_id`** (FK to `fx_sync_runs`) plus an opaque **`lease_token`** UUID.
- `lease_expires_at` bounds recovery; `acquired_at` / `renewed_at` / `updated_at` track lifetime.
- RLS enabled; authenticated users may only `SELECT` rows for companies they can access via
  `rls_has_company_access`; `GRANT ALL` is limited to `service_role`. No authenticated write policy.

### Atomic acquisition / start — `public.fx_acquire_sync_lease(...)`

Performs, in a single atomic statement set:

- atomically acquire the `company_id + provider` scope via
  `INSERT ... ON CONFLICT (company_id, provider) DO UPDATE ... WHERE lease_expires_at <= now`;
- reject overlapping active ownership (`acquired: false`, `FX_SYNC_ALREADY_RUNNING`) when a live
  lease still holds the scope;
- reclaim an **expired** lease (the conditional `DO UPDATE` only fires past expiry);
- terminalize the abandoned prior `Running` run to `Failed` with `FX_SYNC_LEASE_EXPIRED`;
- create and start the owning `fx_sync_runs` row as `Running`, returning `run_id` + `lease_token`.

### Owner-checked renewal — `public.fx_renew_sync_lease(...)`

- Renews the lease **only** when `owner_run_id` **and** `lease_token` match and the lease has not yet
  expired.
- Fails closed (`renewed: false`, `FX_SYNC_LEASE_LOST`) when ownership has been lost or reclaimed.
- The Edge Function renews around every lifecycle step (`renewLeaseOrFail`), so a run that has lost
  ownership stops before performing further work.

### Owner-checked completion / release — `public.fx_complete_sync_run(...)`

- Verifies live ownership (`owner_run_id` + `lease_token`, not expired) `FOR UPDATE`.
- Terminalizes **only** the owned `Running` run (guarded by `status = 'Running'`).
- Releases (deletes) the lease **only after** successful terminalization, and only for the matching
  owner + token — an old owner cannot release a successor's lease (returns `FX_SYNC_LEASE_LOST` or
  `FX_SYNC_RUN_NOT_RUNNING`).

### Owner-fenced upsert — `public.fx_upsert_reference_rate(..., p_lease_token UUID)`

The upsert RPC now takes `p_lease_token` and:

- checks lease ownership **before** doing any work (fails closed with `FX_SYNC_LEASE_LOST`);
- takes a **transaction-scoped** advisory lock (`pg_advisory_xact_lock`) on
  `(company_id, from|to|effective_date|provider|rate_type)` as an in-RPC critical section;
- **rechecks** lease ownership **after** acquiring the lock (post-serialization fence);
- rereads the current `Active` row `FOR UPDATE`, then applies the noop / insert / correction decision,
  supersede + new `Active` insert, and returns the result — **all inside the one DB transaction that
  the advisory lock spans**;
- the existing partial unique index (one `Active` per logical key) remains as defense in depth.

**This transaction-scoped lock use is valid**, precisely because — unlike the original lifecycle
misuse — the lock here protects a single database transaction (serialization → active-row reread →
decision → supersede → new `Active` insert → return). It is not being asked to span multiple separate
Edge Function round-trips. This is the distinction the original design got wrong and Fix1 gets right.

> **`⚠ SUPERSEDED BY FIX2`** — Fix1's `fx_upsert_reference_rate` only **read** lease ownership (a
> `SELECT`/`EXISTS` check) before and after taking the rate-key advisory lock; it did **not** hold a
> transactional lock on the matching `fx_sync_leases` ownership row for the remainder of the write
> transaction. That leaves a zombie-worker / TOCTOU window: an old worker could pass both ownership
> checks, then have its lease expire and be reclaimed by a successor, and still commit its
> reference-rate mutation after ownership was lost. The rate-key advisory lock serialized same-key FX
> writes but did **not** protect lifecycle lease ownership. Fix2 replaces this with a transactional
> `FOR UPDATE` lock on the live owned lease row held through the whole protected write. See
> [§ Post-Fix1 Review finding](#post-fix1-review-finding-remaining-zombie-worker--toctou-defect) and
> [§ Fix2 transactional lease fencing](#fix2-transactional-lease-fencing-migration-019).

## Fix1 stale and zombie worker protection

> **`⚠ SUPERSEDED BY FIX2` (partial).** The mechanisms listed below are real and remain in place, but
> Fix1's protection against a zombie worker was **not** complete: the "owner-fenced protected upsert"
> relied on ownership *reads* rather than a transactional lock on the owned lease row, so a stale
> worker whose lease was reclaimed mid-write could still commit a reference-rate mutation after
> ownership loss. Do **not** read this section as evidence that Fix1 alone fully prevented
> post-reclaim stale writes. Complete zombie-worker fencing is delivered only by Fix2 — see
> [§ Post-Fix1 Review finding](#post-fix1-review-finding-remaining-zombie-worker--toctou-defect),
> [§ Fix2 transactional lease fencing](#fix2-transactional-lease-fencing-migration-019), and
> [§ Fix2 zombie-worker scenario semantics](#fix2-zombie-worker-scenario-semantics-intended-design).

Stale / zombie ownership is addressed through:

- persistent lease state in `fx_sync_leases`;
- bounded `lease_expires_at` expiry;
- atomic expired-lease reclaim in `fx_acquire_sync_lease` (conditional `ON CONFLICT ... DO UPDATE`);
- `owner_run_id` owner identity;
- opaque `lease_token`;
- owner-checked renewal;
- owner-fenced protected upsert;
- owner-checked completion / release;
- fail-closed behavior on `FX_SYNC_LEASE_LOST` throughout the Edge Function service.

An expired, abandoned `Running` run is recovered to terminal `Failed` status with error category
**`FX_SYNC_LEASE_EXPIRED`** when a successor reclaims the scope.

> This *Fix1* stale/zombie handling is established by the implemented design and source-level review,
> **but it is incomplete** — see the `⚠ SUPERSEDED BY FIX2 (partial)` note at the top of this section.
> Even with Fix2, none of this is yet proven by runtime staging execution.

## Fix1 concurrent upsert semantics (intended, serialized)

The following behaviors are the **intended, serialized** semantics supported by the implemented
design and confirmed by source-level review. **True runtime concurrent database behavior is still
pending staging verification.**

- **Concurrent first insert** — one transaction inserts the `Active` row; a later same-rate
  transaction, once serialized behind the advisory lock, rereads the now-existing `Active` row and
  returns `noop`/equivalent. No duplicate `Active` row.
- **Duplicate same-rate retry** — the existing `Active` rate is preserved; the retry converges to
  `noop`/equivalent.
- **Concurrent correction** — corrections are serialized; exactly one `Active` logical row remains;
  the prior `Active` row becomes `Superseded` (linked via `supersedes_rate_id`); valid correction
  history is retained.
- **Retry versus correction** — serial ordering is enforced; no duplicate `Active` logical row is
  produced; a normal-race unique collision is avoided by the in-RPC critical section rather than being
  surfaced as a spurious pair failure.

## Fix1 local verification

Executed locally against the current worktree (`a562aaf`):

```text
cd backend/supabase/functions
deno check fx-rate-sync/index.ts fx-rates/index.ts
deno test --no-lock --allow-read=../../.. --config fx-rate-sync/deno.json fx-rate-sync/fx_reference_test.ts
git diff --check
```

- `deno check` (`fx-rate-sync/index.ts`, `fx-rates/index.ts`): **PASS**.
- Targeted Deno tests: **16 passed / 0 failed**.
- `git diff --check`: **PASS**.

Static / source assertions included in the suite and scans:

- persistent lease table (`fx_sync_leases`) present;
- atomic acquire/start function (`fx_acquire_sync_lease`) present;
- owner-checked renew (`fx_renew_sync_lease`) present;
- owner-checked complete/release (`fx_complete_sync_run`) present;
- expired-lease recovery markers (`FX_SYNC_LEASE_EXPIRED`) present;
- removal (DROP) of the old lifecycle lock helper `fx_try_sync_lock`;
- owner-fenced upsert (`fx_upsert_reference_rate(..., p_lease_token)`);
- in-RPC transaction advisory serialization (`pg_advisory_xact_lock`);
- no writes to `public.exchange_rates`.

## Fix1 test classification

The evidence distinguishes what was actually executed from what was only statically asserted, and
from what remains unproven until staging.

**Executable local tests (actually run):**

- `deno check` on `fx-rate-sync/index.ts` and `fx-rates/index.ts`;
- the 16 Deno unit tests in `fx_reference_test.ts`.

**Static / source assertions (text and construction checks, not live DB execution):**

- migration text assertions (lease table, owner-checked RPCs, expiry markers, DROP of old lock);
- SQL construction checks (owner fencing, in-RPC advisory serialization);
- forbidden-write scans (no `exchange_rates` writes, no protected financial DML,
  no `/allocations/auto` change, no `ar.*` schema);
- secret / provider scans (no real provider host, credential, `NEXT_PUBLIC` key, or JWT leakage).

**Not yet runtime-proven (pending staging):**

- actual application of migration `018` to a database;
- runtime RLS enforcement on `fx_sync_leases` and the reference tables;
- runtime helper-RPC grants (service-role-only execute) under a live role;
- service-role-only invocation of the lease/upsert/complete RPCs;
- duplicate/overlapping sync rejection at runtime;
- stale/expired lease recovery at runtime (`FX_SYNC_LEASE_EXPIRED`);
- concurrent first insert;
- concurrent duplicate retry;
- concurrent correction;
- retry-versus-correction race.

Static SQL assertions are **not** described here as executable DB integration proof.

## Fix1 financial safety boundary

Fix1 introduces **none** of the following:

- real provider;
- provider network call;
- provider credential;
- scheduler;
- cron;
- write to `public.exchange_rates`;
- automatic promotion of reference rates to booking rates;
- booked transaction rate-snapshot mutation;
- invoice mutation;
- receipt mutation;
- allocation mutation;
- journal entry creation;
- balance mutation;
- financial RPC invocation;
- `/allocations/auto` behavior change;
- staging deployment;
- production deployment.

`POST /allocations/auto` remains outside this batch and remains disabled. Batch 9D-A remains
**reference-only**.

## Fix1 pending staging verification

The following remain **pending** and are **not** claimed as proven:

- runtime DB verification on staging (migration application, RLS, grants, service-role-only invocation);
- runtime duplicate-overlap rejection;
- runtime stale/expired lease recovery;
- runtime concurrent upsert behavior (first insert, duplicate retry, correction, retry-vs-correction).

No staging or production mutation, deployment, cron, or provider call was performed for this Fix1
evidence update.

## Fix1 next gate recommendation

> **`⚠ SUPERSEDED BY FIX2`.** At the time Fix1 was written this section recommended proceeding to
> Post-Fix1 Review as if Fix1 were the final design. The Post-Fix1 Review then returned
> **`FAIL — FIX2 REQUIRED`**. This recommendation is retained as history only; the current gate
> status is in [§ Fix2 next gate recommendation](#fix2-next-gate-recommendation).

Original 9D-A implementation → Post-Implementation Review returned `PASS WITH REQUIRED FIXES`
(`FIX REQUIRED BEFORE STAGING`). Fix1 has now been implemented and verified locally.

**Current status:** *Batch 9D-A Fix1 implementation completed locally and is ready for Codex Post-Fix1
Review. Staging runtime verification remains pending.*

Proceed to **Codex Post-Fix1 Review** for Batch 9D-A. After that review passes, a separate staging
readiness / deployment gate is still required before applying migrations `017`/`018` or deploying the
`fx-rate-sync` / `fx-rates` Edge Functions to staging. Real provider integration and scheduler
activation remain blocked by DG-1 and are out of scope for Batch 9D-A. Batch 9D-B has not started.

---

# Batch 9D-A Fix2 — Transactional Lease Fencing and Sync Count Accuracy

- **Fix2 commit:** `b551a694ee40ffc737214ed81be6385f1ce8e669`
- **Fix2 message:** `fix(fx): fence reference writes by lease ownership`
- **Predecessor (Fix1) commit:** `a562aaff767568ebe8dabe16bba386b4434e686c`
- **Fix1 evidence amendment commit:** `5184e893cc99b964fe263be78f2ce5bef4195e72`
- **Fix2 files changed:**
  - `database/019_fx_reference_transactional_fencing.sql` (new migration)
  - `backend/supabase/functions/fx-rate-sync/service.ts`
  - `backend/supabase/functions/fx-rate-sync/fx_reference_test.ts`
  - `docs/runbooks/BATCH_9D_A_FIX2_STAGING_CONCURRENCY_TESTS.md` (new staging-only runbook)

## Post-Fix1 Review finding (remaining zombie-worker / TOCTOU defect)

**Post-Fix1 Review verdict:** `FAIL — FIX2 REQUIRED`.
**Final recommendation:** `BATCH 9D-A FIX2 REQUIRED BEFORE STAGING READINESS`.

**Remaining blocking defect — zombie-worker / TOCTOU in `public.fx_upsert_reference_rate(...)`.**
Fix1 checked lease ownership **before** the protected reference-rate write (and again after taking the
rate-key advisory lock), but those were ownership **reads**. Fix1 did **not** hold a transactional
lock — or equivalent fencing — on the matching live `public.fx_sync_leases` ownership row for the
remainder of the write transaction. Between the ownership read and the commit, ownership could change.

Therefore this sequence remained possible:

```text
old worker passes lease ownership checks
→ lease expires
→ successor reclaims lease
→ successor becomes new owner
→ old worker continues rate mutation
→ old worker commits after ownership loss
```

The rate-key advisory lock (`pg_advisory_xact_lock` on the logical FX key) serialized concurrent
writes to the **same logical rate key**, but it provided **no** protection over lifecycle lease
ownership: two different owners writing different keys, or an old owner writing after reclaim, were not
fenced by it. This is the reason **Fix2 was required before staging readiness**.

## Fix2 transactional lease fencing (migration 019)

Fix2 introduces `database/019_fx_reference_transactional_fencing.sql`, which `CREATE OR REPLACE`s
`public.fx_upsert_reference_rate(...)` **with the same RPC signature** (still
`(..., p_sync_run_id UUID, p_lease_token UUID)`), preserving reference-only semantics — it does not
write `public.exchange_rates` or any financial/protected table.

The protected upsert now:

1. locks the matching **live** `public.fx_sync_leases` ownership row using `FOR UPDATE`;
2. verifies, in that same locking predicate, all of:
   - `company_id`;
   - `provider`;
   - `owner_run_id` (= `p_sync_run_id`);
   - `lease_token` (= `p_lease_token`);
   - live `lease_expires_at > clock_timestamp()`;
3. **holds that lease-ownership row lock** through the remainder of the protected reference-rate
   transaction (until commit/rollback);
4. fails closed with **`FX_SYNC_LEASE_LOST`** if a matching live owned lease row cannot be locked
   (`IF NOT FOUND THEN RAISE EXCEPTION`), before any rate DML;
5. retains the same-logical-key advisory transaction serialization (`pg_advisory_xact_lock` on the
   `company_id` + `from|to|effective_date|provider|rate_type` key);
6. retains the `Active` `fx_reference_rates` row lock (`SELECT ... FOR UPDATE`);
7. retains the unique `Active` logical-key index as defense in depth.

The decisive change from Fix1 is step 1–3: the ownership check is no longer a bare read but a held
`FOR UPDATE` row lock, so a successor reclaim (which must `UPDATE` that same lease row) cannot
establish new ownership while an in-flight protected write holds the row.

## Fix2 lock ordering

The implemented lock order is:

```text
1. fx_sync_leases ownership row       — FOR UPDATE
2. logical FX rate advisory transaction lock  — pg_advisory_xact_lock
3. Active fx_reference_rates row       — FOR UPDATE
```

**Why the order matters.** Acquiring the lease-ownership row lock **first** — before the rate-key
advisory lock — prevents the dangerous conceptual lock cycle:

```text
Transaction A: holds rate lock → waits for lease row
Transaction B: holds lease row → waits for same rate lock
```

Because every protected write takes the lease row before the rate-key advisory lock, no protected
write ever holds the rate lock while waiting on the lease row, so that cycle cannot form. Per the Fix2
implementation handoff, the lifecycle acquire/renew/complete RPCs (`fx_acquire_sync_lease`,
`fx_renew_sync_lease`, `fx_complete_sync_run`) do **not** request the logical FX rate advisory lock,
so they cannot participate in a rate-lock/lease-row cycle either.

> This lock-ordering reasoning is a source/design property. Runtime deadlock testing has **not**
> occurred and is not claimed.

## Fix2 zombie-worker scenario semantics (intended design)

The following are the **intended source/design** semantics. True runtime database-concurrency
verification remains **pending staging**.

**Old worker locks first**

```text
old worker locks owned lease row
→ protected reference-rate transaction proceeds
→ successor reclaim waits on the same lease row
→ old transaction commits or rolls back
→ successor reclaim may continue afterward
```

**Successor reclaim wins first**

```text
successor establishes new ownership
→ old owner values (owner_run_id / lease_token / live expiry) no longer match
→ old worker cannot lock a matching owned live lease row
→ FX_SYNC_LEASE_LOST
→ no protected reference-rate write
```

**Expiry during a protected transaction.** Lease expiry **alone** does not establish successor
ownership while an existing protected transaction still holds the lease-ownership row lock; the
successor's reclaiming `UPDATE` must wait for that row lock to be released. The intended invariant is:

> **No protected reference-rate write commits after successor ownership has already been established.**

This is the implemented **source/design model**. True runtime database concurrency verification
remains pending staging.

## Fix2 same-key FX reference upsert behavior

Fix2 preserves the existing rate-key serialization model unchanged; the following are supported by
design/static review, with runtime concurrent DB verification **pending staging**:

- **Concurrent first insert** — one insert; a later same-rate attempt rereads the current `Active`
  row and returns `noop`/equivalent; exactly one `Active` logical row.
- **Duplicate same-rate retry** — current `Active` row preserved; no unnecessary correction-history
  row; `noop`/equivalent result.
- **Concurrent correction** — transactions serialize by logical reference-rate key; valid correction
  history chain; exactly one `Active` logical row; prior values become `Superseded` correctly with
  `supersedes_rate_id` linkage retained.
- **Retry versus correction** — outcome corresponds to a valid serialized ordering; no duplicate
  `Active` logical row; no broken correction history.

## Fix2 sync count accuracy

The Post-Fix1 Review also raised a **non-blocking observability** finding: before Fix2, a top-level
failure that occurred **after** some pairs had already been written successfully could record:

```text
succeeded_pair_count = 0
failed_pair_count    = all pairs
```

even though successful reference-rate rows had already been persisted — misrepresenting what actually
happened.

Fix2 updates `backend/supabase/functions/fx-rate-sync/service.ts`: the accumulators
(`succeeded` / `failed` / counts) are hoisted so they survive into the top-level `catch`, and a new
helper `calculateTerminalFailureCounts(attempted, succeeded, failedSoFar)` computes the terminal
counts so that they:

- preserve the accumulated successful pair count;
- preserve the already-observed failed pair count;
- classify the remaining unprocessed pairs as failed for terminal `Failed` runs.

The intended terminal-failure invariant, **for the terminal `Failed` completion path handled by the
new helper**, is:

```text
succeeded_pair_count + failed_pair_count = attempted_pair_count
```

This claim is scoped to that terminal-failure path and is not generalized to every run outcome.

## Fix2 local verification

Executed locally against the current worktree (`b551a69`):

```text
cd backend/supabase/functions
deno check fx-rate-sync/index.ts fx-rates/index.ts
deno test --no-lock --allow-read=../../.. --config fx-rate-sync/deno.json fx-rate-sync/fx_reference_test.ts
git diff --check
```

**Executable checks (actually run):**

- `deno check` (`fx-rate-sync/index.ts`, `fx-rates/index.ts`): **PASS**.
- Targeted Deno tests: **18 passed / 0 failed**.
- `git diff --check`: **PASS**.

**Executable helper coverage.** The suite now includes executable coverage of terminal-failure count
handling — preservation of accumulated successful pairs and classification of remaining/unprocessed
pairs — via `calculateTerminalFailureCounts`, alongside the existing lease-lost fail-closed detection.

## Fix2 test classification

**Executable local tests (actually run):**

- `deno check` on `fx-rate-sync/index.ts` and `fx-rates/index.ts`;
- the 18 Deno unit tests in `fx_reference_test.ts`, including terminal-failure count handling.

**Static / source assertions (text and construction checks, not live DB execution):**

- migration `019` contains the matching lease-ownership conditions
  (`company_id` / `provider` / `owner_run_id` / `lease_token`);
- lease-token check present;
- live-expiry check (`lease_expires_at > ...`) present;
- lease row `FOR UPDATE` present;
- the lease-row lock appears **before** the rate-key advisory lock;
- the rate-key advisory lock remains **before** `Active` rate-row access;
- `FX_SYNC_LEASE_LOST` fail-closed path present;
- fixed `search_path` (`SET search_path = public`);
- explicit RPC `GRANT`/`REVOKE` structure (revoke `PUBLIC`/`authenticated`, grant `service_role`);
- no `public.exchange_rates` insert/update/delete.

Static SQL assertions are **not** described as executable DB concurrency proof.

**Not yet runtime-proven (pending staging).** See
[§ Fix2 runtime DB verification status](#fix2-runtime-db-verification-status).

## Fix2 runtime DB verification status

Runtime database verification status: **`NOT YET RUNTIME-EXECUTED`**.

The staging-only concurrency runbook is
`docs/runbooks/BATCH_9D_A_FIX2_STAGING_CONCURRENCY_TESTS.md`; its status is
**`PREPARED BUT NOT YET RUNTIME-EXECUTED`**.

Pending staging runtime verification includes at minimum:

1. stale owner versus successor reclaim;
2. successor reclaim wins first;
3. old owner cannot write after successor ownership;
4. concurrent first insert;
5. concurrent duplicate retry;
6. concurrent correction;
7. retry versus correction.

The following also remain **pending** staging verification and are **not** claimed as PASS:

- migration application (`017` / `018` / `019`);
- RLS enforcement;
- helper RPC grants;
- service-role-only invocation;
- overlap rejection;
- expired / stale lease recovery.

None of the above is claimed as passing yet.

## Fix2 security and privilege record (source-level)

Source-level migration design for `fx_upsert_reference_rate` in `019`:

- public schema only;
- same upsert RPC signature preserved;
- `SECURITY DEFINER`;
- `SET search_path = public`;
- `EXECUTE` revoked from `PUBLIC`;
- `EXECUTE` revoked from `authenticated`;
- `EXECUTE` granted to `service_role`;
- no authenticated mutation path added;
- no anonymous mutation path added.

This is **source-level verification only**. Runtime grants and RLS remain pending staging
verification.

## Fix2 financial safety boundary

Fix2 introduces **none** of the following:

- Frankfurter integration;
- real FX provider;
- external provider API call;
- provider credential;
- API key;
- scheduler;
- cron;
- `public.exchange_rates` write;
- reference-to-booking automatic promotion;
- booked transaction rate-snapshot mutation;
- invoice mutation;
- receipt mutation;
- allocation mutation;
- journal entry creation;
- balance mutation;
- financial RPC invocation;
- frontend work;
- staging deployment;
- production deployment.

`POST /allocations/auto` remains outside this scope and remains disabled. Batch 9D-A remains
**reference-only**.

## Fix2 next gate recommendation

Original 9D-A → Post-Implementation Review `PASS WITH REQUIRED FIXES` → **Fix1**.
Fix1 → Post-Fix1 Review **`FAIL — FIX2 REQUIRED`** (`BATCH 9D-A FIX2 REQUIRED BEFORE STAGING
READINESS`) → **Fix2**, now implemented and verified locally.

**Current status:** *Batch 9D-A Fix2 implementation has completed local verification and is ready for
Post-Fix2 Review. Runtime DB, RLS, grant, lease-recovery, and concurrency verification remain pending
staging authorization and execution.*

Proceed to **Codex Post-Fix2 Review** for Batch 9D-A. After that review passes, a separate staging
readiness / deployment gate is still required before applying migrations `017` / `018` / `019` or
deploying the `fx-rate-sync` / `fx-rates` Edge Functions to staging, and the
`BATCH_9D_A_FIX2_STAGING_CONCURRENCY_TESTS` runbook must then be runtime-executed on staging. Real
provider / Frankfurter integration and scheduler activation remain blocked by DG-1 and are out of
scope for Batch 9D-A. Batch 9D-B has not started.
