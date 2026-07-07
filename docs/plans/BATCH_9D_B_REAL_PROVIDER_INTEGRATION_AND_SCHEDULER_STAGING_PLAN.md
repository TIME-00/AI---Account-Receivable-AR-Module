# Batch 9D-B — Real Provider Integration and Scheduler Staging — Detailed Implementation Plan

- **Batch:** 9D-B — Real Provider Integration and Scheduler Staging.
- **Type:** Detailed, implementation-ready sub-plan (planning/documentation only; **no** code, migration, deployment, provider call, or scheduler activation in this task).
- **Author:** Claude Code (discovery + implementation plan).
- **Parent plan:** `docs/plans/BATCH_9D_DAILY_FX_RATE_SYNC_AND_MULTI_CURRENCY_UX_PLAN.md` (authoritative phase/order document; this file is the 9D-B sub-plan referenced by master §0.4).
- **Baseline commit at authoring:** `22a52377df5d338ffe4a2a7501fa38ef320e7bfb` (`docs(plan): lock Batch 9D DG-1 provider decision`; `HEAD == origin/main`, clean tree).
- **Current approved state:** Batch **9D-A OFFICIALLY CLOSED**; **DG-1 FORMALLY APPROVED, LOCKED, CODEX CONFIRMED**; Batch **9D-B READY FOR DETAILED IMPLEMENTATION PLANNING, NOT YET IMPLEMENTED**.
- **Next gate:** **Codex Batch 9D-B Plan Second Review** → user staging-implementation approval → implementation → technical review → staging readiness → explicit staging approval → staging deployment → runtime verification → evidence → closure review.

> **Planning-only banner.** No backend code was written, no migration was created or applied, no Edge
> Function was deployed, no scheduler/cron was configured, no external FX provider (Frankfurter/MAS) was
> called, and neither staging nor production was mutated while producing this plan. Real provider
> integration and scheduler activation remain blocked until this plan passes Codex second review and the
> user grants explicit implementation approval.

---

## 1. Purpose and scope

This plan translates the locked DG-1 decision (Frankfurter v2 transport, mandatory explicit provider
pinning, initial provider `MAS`, reference-only destination) into exact implementation responsibilities,
contracts, gates, and verification criteria for Batch 9D-B. It is deliberately specific enough for Codex
to review architecture, provider contract, scheduler design, security boundaries, failure semantics,
runtime testability, exact files, migration needs, staging sequence, and the runtime verification matrix
**before** any implementation begins.

9D-B **reuses** the closed 9D-A provider-neutral foundation (lease lifecycle, overlap protection, stale
recovery, transactional fencing, versioned correction, sanitized errors, read API). It does **not** build
a second sync architecture, a second locking system, or a second read API. The only genuinely new
surfaces are: (a) a real Frankfurter v2 provider adapter behind the existing `FxProviderAdapter`
interface, (b) a real sync route beside the existing mock route, (c) an approved-provider pinning gate
that replaces the mock-only gate, and (d) a staging-only scheduler that **invokes** the existing sync
orchestration.

---

## 2. Current approved architecture (verified from source, must be preserved)

```text
public.fx_sync_runs      = sync lifecycle + observability      (migration 017)
public.fx_reference_rates= external/provider reference FX data (migration 017, versioned)
public.fx_sync_leases    = lifecycle ownership + overlap guard (migration 018)
public.exchange_rates    = existing booking-rate source        (unchanged; never written by sync)
```

Helper RPCs (all `SECURITY DEFINER`, `SET search_path = public`, **`service_role`-only** after migration
020): `fx_acquire_sync_lease`, `fx_renew_sync_lease`, `fx_complete_sync_run`, `fx_upsert_reference_rate`
(11-arg, lease-fenced from migration 019).

Edge Functions:
- `fx-rate-sync` — `POST /fx-rate-sync/mock-sync` only today; `assertProviderNeutralOnly()` rejects any
  provider other than `mock_batch_9d_a`.
- `fx-rates` — read API: `GET /latest`, `/lookup`, `/history`, `/health`; all responses carry
  `reference_only: true`; reads gated by `requireOperationalReadRole`.

Orchestration verified in `service.ts::runMockSync`:
`requireAnyRole(['Finance Manager','System Admin'])` → `fetchCompany(base_currency)` → `normalizePairs`
(forces `to_currency == base`, `from != to`) → `fx_acquire_sync_lease` → renew → `provider.fetchRates`
→ renew → per-rate `normalizeProviderRate` + `fx_upsert_reference_rate` (renew before each) → terminal
`fx_complete_sync_run`. Lease default 300s, renewed between every step. Terminal-failure counts clamped by
`calculateTerminalFailureCounts`.

**There must be no automatic bridge in 9D-B from `fx_reference_rates` to `exchange_rates`.** Any
controlled relationship between the reference layer and the booking-rate layer is owned exclusively by
**9D-C** (governance gate).

---

## 3. Locked DG-1 prohibitions carried into 9D-B (all mandatory)

1. implicit blended/default provider selection;
2. silent provider fallback;
3. silent provider substitution;
4. silent pair inversion;
5. unsupported-pair fabrication;
6. direct provider writes to `public.exchange_rates`;
7. automatic reference-to-booking-rate promotion;
8. retroactive mutation of booked **invoice** FX snapshots;
9. retroactive mutation of booked **receipt** FX snapshots;
10. provider-triggered invoice mutation;
11. provider-triggered receipt mutation;
12. provider-triggered allocation mutation;
13. provider-triggered journal mutation;
14. provider-triggered balance mutation;
15. provider-triggered financial RPC execution;
16. production provider rollout in 9D-B;
17. production scheduler activation in 9D-B.

Pair semantics remain **`from_currency × rate = to_currency`** with **no silent inversion**.

---

## 4. Frankfurter v2 adapter design

### 4.1 Adapter boundary (extend, do not replace)

The existing `FxProviderAdapter` interface in `provider.ts` is the seam:

```ts
interface FxProviderAdapter {
  readonly provider: string;
  readonly sourceHost: string;
  fetchRates(params: { effectiveDate: string; pairs: ProviderPairRequest[]; scenario?: MockFxScenario }):
    Promise<ProviderFetchResult>;
}
```

9D-B adds a **real** implementation `FrankfurterFxProvider` implementing this same interface, in a new
module `backend/supabase/functions/fx-rate-sync/frankfurter.ts`. `DeterministicMockFxProvider` in
`provider.ts` is **preserved unchanged** so the closed 9D-A mock path keeps working. The real adapter
ignores `scenario` (mock-only) and instead performs real HTTP with timeout/retry.

### 4.2 Adapter responsibilities (each an explicit implementation item)

| Concern | Responsibility |
| --- | --- |
| provider interface | implement `FxProviderAdapter` unchanged; return `ProviderFetchResult { provider, sourceHost, effectiveDate, rates[], failures[] }` |
| real implementation | `FrankfurterFxProvider` — fixed host, request builder, fetch with `AbortController`, response parse, per-pair mapping |
| mock preservation | `DeterministicMockFxProvider` untouched; still used by `/mock-sync` |
| provider selection | new factory `createFxProvider(providerId)` returns mock for `MOCK_PROVIDER_ID`, real for the approved real provider ID; throws for anything else (no fabrication, no default) |
| explicit provider ID | approved real provider ID defined as a **code constant** in `validation.ts` (see §7); written to `fx_sync_runs.provider` and `fx_reference_rates.provider` |
| request builder | build URL from a **fixed host allowlist constant** + fixed path + typed query params only; never from user/DB-supplied host |
| response parser | strict schema validation of the JSON body before mapping; reject on shape mismatch |
| normalization | map provider response to `ProviderRateInput[]` with explicit `direction: 'from_to'`; feed existing `normalizeProviderRate` (unchanged) |
| validation | reuse `normalizeProviderRate` / `normalizeRate` / `normalizeCurrency` / `assertDate` / `assertNotFutureDate` (no parallel validators) |
| error mapping | classify to bounded error categories (§14); surface per-pair `failures[]` for unsupported pairs |
| timeout | `AbortController` per outbound request (§12) |
| retry | bounded retry wrapper around a single fetch attempt (§13) |
| observability | provider, requested date, effective date(s), fetched timestamp, counts, status, retry count, sanitized error into `fx_sync_runs` |
| sanitization | reuse `sanitizeErrorSummary`; never log raw payloads, headers, or credentials |

### 4.3 Flow (conceptually identical to 9D-A; no second architecture)

```text
trigger (manual privileged OR staging scheduler)
  → authorization (Edge Function user/role OR scheduler principal)
  → fx_acquire_sync_lease
  → provider.fetchRates  (real Frankfurter v2, timeout + bounded retry)
  → response validation  (strict schema)
  → explicit pair normalization (from_to only)
  → fx_upsert_reference_rate (11-arg, lease-fenced, versioned)
  → fx_complete_sync_run (terminalize)
  → lease release
```

The real adapter **must not** bypass `fx_acquire_sync_lease`, the renew calls, `fx_upsert_reference_rate`,
or `fx_complete_sync_run`. It is a drop-in `fetchRates` provider only.

---

## 5. Explicit MAS provider pinning (technical enforcement)

DG-1 mandates explicit provider pinning with initial provider `MAS` and prohibits blended/default/
fallback/substitution behavior. Enforcement design:

- **Approved provider registry (code-level).** `validation.ts` defines
  `APPROVED_REAL_PROVIDER_ID` (the pinned real provider identifier) and an `APPROVED_PROVIDER_HOSTS`
  allowlist (SSRF-safe fixed hosts). Configuration is **compile-time/code-level**, not
  database-controlled and not free-form request input. Rationale: a code constant is auditable in git,
  cannot be mutated by a tenant, and cannot be altered by a compromised row.
- **Selection gate replaces the mock-only gate.** `assertProviderNeutralOnly()` is replaced by
  `assertApprovedProvider(provider)` which accepts only `MOCK_PROVIDER_ID` (mock route) or
  `APPROVED_REAL_PROVIDER_ID` (real route) and throws `ValidationError` for anything else. **Omitted
  provider selection on the real route is rejected** (no implicit default to any real provider).
- **No client fallback.** The real route does not accept a client-chosen alternative provider; an
  unrecognized/unapproved provider value fails closed with a validation error. There is no fallback
  provider and no substitution.
- **Provider written into history/observability.** The pinned provider ID is persisted to
  `fx_sync_runs.provider` and every `fx_reference_rates.provider`, so staging can prove which provider
  actually ran.
- **Requested-vs-returned consistency check.** If, and only if, the provider response exposes source/
  provider metadata, the adapter asserts it is consistent with the pinned provider and **fails closed**
  on mismatch (maps to `FX_PROVIDER_MISMATCH`, non-retryable). It never silently accepts metadata that
  differs from the requested provider.
- **Source-identity limitation (called out honestly).** Frankfurter is an open transport that historically
  serves ECB-published reference data; whether Frankfurter v2 exposes a **MAS**-specific source and
  whether provider/source identity is independently provable from the response is **NOT assumed** here and
  is a **MUST-LOCK** contract item (§8, §36). If source identity cannot be independently proven from the
  response, the strongest verifiable contract available is: (1) fixed approved host + fixed path
  (transport identity), (2) the pinned provider ID recorded in observability, (3) an explicit provider/
  base parameter sent on every request, and (4) fail-closed on any returned metadata that contradicts the
  request. This limitation must be documented in the 9D-B evidence rather than papered over.

---

## 6. Provider contract verification (must be validated before coding assumptions are finalized)

The following Frankfurter v2 contract items are **NOT hard-coded** in this plan. Each is marked
`[VERIFY]` and must be validated by Codex against current official provider documentation during
implementation review before the adapter is finalized:

- `[VERIFY]` exact endpoint host and base path (latest vs dated);
- `[VERIFY]` query parameter names for base currency and target/symbols;
- `[VERIFY]` how an explicit provider/source (`MAS`) is expressed, or whether it is unsupported by
  Frankfurter v2 (this directly affects §5 pinning and is the highest-risk item);
- `[VERIFY]` rate response JSON shape (object of `{ symbol: rate }` vs array);
- `[VERIFY]` base/from representation in the response;
- `[VERIFY]` quote/to representation in the response;
- `[VERIFY]` date/effective-date field name and format;
- `[VERIFY]` availability of provider/source metadata for identity proof;
- `[VERIFY]` unsupported-currency behavior (error vs omission);
- `[VERIFY]` unsupported-pair behavior;
- `[VERIFY]` weekend behavior (returns last publication vs error);
- `[VERIFY]` holiday / no-publication-day behavior;
- `[VERIFY]` historical-date behavior and earliest supported date;
- `[VERIFY]` "latest prior published rate" behavior when a requested date has no publication;
- `[VERIFY]` HTTP error semantics (status codes and bodies);
- `[VERIFY]` documented rate-limit behavior, if any;
- `[VERIFY]` timeout/retry implications and any documented SLA.

**Direction reconciliation.** Frankfurter is base-centric (rates expressed relative to a base). The
adapter must convert the base-centric response into the module's explicit `from_currency × rate =
to_currency` direction **without introducing silent inversion or silent reciprocal computation**. Because
9D-A requires `to_currency == company base`, and Frankfurter expresses rates relative to its own base,
the mapping strategy (which base to request, and how each requested pair maps onto the response) is a
`[VERIFY]` + design item: the adapter must request rates in a way that yields the requested direction
directly, or explicitly reject pairs it cannot represent without inversion. Reciprocal/inverted derivation
is **out of scope for 9D-B** unless separately approved (§9).

---

## 7. Pair direction and normalization rules (exact)

Reuse the existing validators (no parallel logic). The real adapter must guarantee, before calling
`fx_upsert_reference_rate`, that each rate passes `normalizeProviderRate`, which already enforces:

- uppercase ISO 3-letter currency normalization (`normalizeCurrency`);
- reject same-currency pair (`from == to`);
- reject malformed codes;
- reject zero rate, negative rate, non-numeric/NaN (`normalizeRate`);
- reject rate over the safe bound (1,000,000) and over 8 decimal places;
- reject `direction !== 'from_to'` (this is the anti-inversion guard);
- require `to_currency == company base currency`;
- require supported currency set membership;
- validate `effective_date` format and reject future dates;
- validate `provider_timestamp` (not materially future) and record `fetched_at` separately.

9D-B adapter-level additions (before handing to the validator): reject a **missing** pair in the
response (map to per-pair failure, not fabrication); preserve exact requested direction; record the
provider-returned effective date (never a fabricated date); record `fetched_at` at ingestion time. **No
silent reciprocal calculation.** If Frankfurter's response is base-centric, §6's mapping must produce the
requested direction explicitly; any pair that would require inversion/reciprocal is rejected (per-pair
failure) unless separately approved.

---

## 8. Currency universe and pair scope (conservative staging policy)

9D-B does **not** sync all possible pairs. The controlled staging policy:

- **Base:** company base currency (verified from `companies.base_currency`; test fixtures use `MYR`).
- **Source set:** the existing supported reference set intersected with currencies actually in use:
  `SUPPORTED_REFERENCE_CURRENCIES = {MYR, SGD, USD, EUR, GBP, CNY}` (from `validation.ts`), minus the
  base. Singapore/Malaysia relevance keeps SGD/MYR central.
- **Policy chosen:** **explicit allowlist of `source → base` pairs**, i.e. each supported source currency
  quoted against the company base (mirrors `defaultMockPairs`). This avoids uncontrolled all-pairs
  expansion and keeps `to_currency == base` invariant intact.
- `[VERIFY]` narrow the staging allowlist to currencies present in real transaction data (inspect
  `invoices` / `receipts` transaction currencies during implementation) so staging does not sync
  irrelevant pairs.
- **Tenant scoping preserved:** all sync is company-scoped; the pair set is resolved per company from that
  company's base currency.

---

## 9. Date, weekend, holiday, and publication semantics

Three distinct concepts must never be conflated:

```text
requested sync date   = the date the trigger/scheduler asks for
provider effective date= the publication date the provider actually returns
fetched_at            = wall-clock ingestion timestamp
```

Rules:
- **No fabricated weekend rows, no fabricated holiday rows, no fake effective date.** Persist only the
  provider's actual effective date.
- **Weekend/holiday scheduler behavior (proposed, pending §6 `[VERIFY]`):** on a non-publication day the
  scheduler run requests the latest available rate; if the provider returns the **latest prior published
  date**, the sync ingests it under that real effective date — which, if already present, resolves to a
  **noop** via the existing versioned upsert (no new history). The run is still recorded in
  `fx_sync_runs` (status `Succeeded`, `inserted=0`, `unchanged=N`). If the provider instead returns an
  error/empty for a non-publication day, the run terminalizes as `Succeeded` with zero pairs or
  `PartialFailure`, never fabricating a row. The exact choice (noop-latest vs skip) is locked once §6
  weekend/holiday behavior is verified.
- **Duplicate retrieval of the same effective date** → existing upsert returns `noop` (unchanged), no
  extra history row.
- **Provider later revises a historical value** → existing upsert supersedes the prior Active row and
  inserts a new Active row with `supersedes_rate_id` (correction), preserving audit history.
- **Recorded in `fx_sync_runs`:** requested effective date, provider, source host, attempted/succeeded/
  failed counts, terminal status, sanitized error summary. (Provider effective date is recorded per rate
  in `fx_reference_rates`.)

---

## 10. Timeout design (concrete)

- **Mechanism:** `AbortController` + `fetch(url, { signal })`; abort on timer expiry.
- **Duration (proposed):** **8000 ms** per outbound request. Criterion: comfortably above expected p99
  provider latency, and far below the 300 s lease so a timeout never risks lease loss. Final value
  confirmed at Codex implementation review (`[VERIFY]` against any documented provider SLA).
- **Abort behavior:** aborted request rejects; treated as a **retryable** transient error (§13).
- **Classification:** exhausted-timeout maps to `FX_PROVIDER_TIMEOUT`.
- **Terminal run status:** if all pairs fail due to exhausted timeout → run `Failed`; if some pairs
  succeeded → `PartialFailure`. Counts via existing accumulators + `calculateTerminalFailureCounts` on the
  terminal path.
- **Lease behavior:** timeout/retry wall-clock budget must stay well under the lease window; `renewLeaseOrFail`
  is called around fetch as today; on unrecoverable failure the run is terminalized (`fx_complete_sync_run`)
  and the lease released, exactly as the existing catch path does.
- **Error summary:** sanitized, bounded ≤500 chars; no URL query secrets, no headers.

---

## 11. Retry policy (bounded)

| Class | Examples | Retryable? |
| --- | --- | --- |
| transient network | DNS/connection reset, socket error | yes |
| timeout | aborted fetch | yes |
| server 5xx | 500, 502, 503, 504 | yes (bounded) |
| rate limit | 429 with bounded `Retry-After` | yes (bounded, honor Retry-After cap) |
| malformed response | schema mismatch, non-JSON | **no** |
| unsupported currency/pair | provider omits/errors a pair | **no** (per-pair failure) |
| invalid provider selection | unapproved provider | **no** |
| invalid normalized rate | zero/negative/NaN/over-bound | **no** |
| contract/schema mismatch | unexpected shape | **no** |
| lease lost | `FX_SYNC_LEASE_LOST` | **no** (propagate, fail closed) |

Parameters (proposed, `[VERIFY]` at review): **max 3 attempts** total per outbound request; **exponential
backoff** base 500 ms × 2^(n−1) with **full jitter**; **total wall-clock budget ≤ ~30 s** and always ≪
lease window; **lease renewed** between attempts if a wait occurs; **attempt count recorded** in
observability; **no unbounded retry loop**. Scheduler and manual trigger use the **same** retry semantics
(single code path); no scheduler-specific retry system.

---

## 12. Error mapping and sanitization

Bounded error categories (persisted to `fx_sync_runs.error_category`, sanitized summary to
`error_summary`):

| Condition | Category |
| --- | --- |
| network failure | `FX_PROVIDER_NETWORK` |
| timeout (exhausted) | `FX_PROVIDER_TIMEOUT` |
| provider 4xx | `FX_PROVIDER_CLIENT_ERROR` |
| provider 5xx | `FX_PROVIDER_SERVER_ERROR` |
| rate limit | `FX_PROVIDER_RATE_LIMIT` |
| malformed response | `FX_PROVIDER_MALFORMED` |
| missing rate for pair | per-pair failure (`FX_PROVIDER_MISSING_RATE`) |
| unsupported pair | per-pair failure (`FX_PROVIDER_UNSUPPORTED_PAIR`) |
| provider metadata mismatch | `FX_PROVIDER_MISMATCH` |
| validation failure | `FX_VALIDATION_ERROR` |
| lease lost | `FX_SYNC_LEASE_LOST` |
| overlap rejection | `FX_SYNC_ALREADY_RUNNING` |

Sanitization (reuse `sanitizeErrorSummary`, extend patterns if needed): **no** Authorization header, **no**
token/JWT, **no** full raw provider payload, **no** HTML error dump, **no** environment values; bounded
≤500 chars; safe operational code + message only. Preserve all existing 9D-A sanitization behavior.

---

## 13. Real sync route design

Inspected routing: `fx-rate-sync/index.ts` matches only `/^\/mock-sync\/?$/i`. 9D-B adds a **distinct**
real route; the mock route is preserved.

- **Method/path:** `POST /fx-rate-sync/sync`.
- **Request body:** `{ provider?: string (must equal APPROVED_REAL_PROVIDER_ID if present; omitted ⇒
  route pins the approved real provider explicitly — never an implicit default to a *different*
  provider), effective_date?: YYYY-MM-DD (default today, non-future), pairs?: [{from_currency,
  to_currency}] (optional; default = company allowlist §8) }`.
- **Company scope:** `extractCompanyId` (UUID-validated) + `getAuthContext`, identical to today.
- **Provider selection behavior:** `assertApprovedProvider` (real route only accepts the approved real
  provider; rejects mock and unknown). No client-provided arbitrary provider fallback.
- **Response contract:** same shape as `FxSyncResult` — `run_id`, `status`
  (`Succeeded|PartialFailure|Failed`), `attempted_pair_count`, `succeeded_pair_count`,
  `failed_pair_count`, `inserted_count`, `unchanged_count`, `corrected_count`, `provider`, `source_host`,
  `effective_date`. Safe error via existing `errorResponse`.
- **Reference-only:** route writes only to `fx_reference_rates` / `fx_sync_runs` / lease infra via the
  existing helper RPCs.

---

## 14. Authorization model (preserve existing layers; do not weaken)

Three distinct layers, kept separate:

1. **User authorization to trigger the Edge Function.** Real manual sync remains limited to the exact
   privileged roles used today: `requireAnyRole(['Finance Manager', 'System Admin'])` (verified in
   `service.ts::runMockSync`). 9D-B reuses this unchanged for the real route.
2. **Service-role execution for privileged helper RPCs.** `fx_acquire_sync_lease`, `fx_renew_sync_lease`,
   `fx_complete_sync_run`, `fx_upsert_reference_rate` remain **`service-role`-only** (migration 020). 9D-B
   must **not** grant these to `anon`/`authenticated`/`PUBLIC`.
3. **RLS read behavior.** `fx_reference_rates` / `fx_sync_runs` / `fx_sync_leases` remain SELECT-gated by
   `rls_has_company_access`; read API uses `requireOperationalReadRole`. Unchanged.

`[VERIFY]` re-confirm the exact privileged-sync role set against `service.ts` at implementation time in
case it changed. Do not confuse the trigger-role layer with the service-role RPC layer.

---

## 15. Scheduler architecture decision

**Recommended staging mechanism: Supabase `pg_cron` + `pg_net` (HTTP) invoking the Edge Function, with
the invocation secret stored in Supabase Vault.** Rationale: native to the project's Supabase stack,
auditable, and — critically — it **invokes the sync orchestration over HTTP** rather than mutating FX
tables directly. Alternative considered: Supabase Scheduled Edge Functions (cron declared in
`config.toml`); acceptable but the secret-handling and per-company enumeration are less explicit. External
schedulers (GitHub Actions/cloud cron) are rejected for staging to avoid another credential surface.

The scheduler design must define:

| Aspect | 9D-B staging decision |
| --- | --- |
| technology | `pg_cron` + `pg_net`, Vault-stored secret (staging only) |
| invocation target | `POST /fx-rate-sync/sync` Edge Function route (**not** a direct SQL call to `fx_upsert_reference_rate`) |
| authorization model | scheduler principal (see §17); least privilege |
| daily cadence | once daily (§16) |
| timezone | Asia/Singapore (SGT, UTC+8) — proposed (§16) |
| provider publication timing | run after expected publication; `[VERIFY]` (§6/§16) |
| weekend behavior | latest-prior / noop, no fabrication (§9) |
| holiday behavior | same as weekend; no fabrication (§9) |
| overlap interaction | reuse `fx_sync_leases`; `FX_SYNC_ALREADY_RUNNING` on overlap (§18) |
| retries | shared bounded retry (§11) |
| missed-run handling | next daily run reconciles via latest-date request + versioned upsert; no catch-up storm |
| manual trigger interaction | shares the same lease scope; whichever holds the lease wins, the other gets overlap rejection |
| observability | every scheduled invocation recorded in `fx_sync_runs` |
| disable/containment | drop/disable the `pg_cron` job (§31) |
| activation | **staging only**; production activation deferred to **9D-E** |

**Explicit prohibition:** the scheduler must **invoke sync orchestration**; a scheduler job that
**directly mutates FX tables** (e.g., `pg_cron` calling `fx_upsert_reference_rate` or writing
`fx_reference_rates`) is prohibited. Nothing is activated in this planning task.

---

## 16. Scheduler cadence and timezone (proposed)

- **Timezone:** Asia/Singapore (SGT, UTC+8) — matches the Singapore deployment context.
- **Daily execution time (proposed):** **06:30 SGT** daily, chosen to run after the prior business day's
  provider publication has settled. Marked **proposed pending §6 publication-timing `[VERIFY]`**;
  Frankfurter/ECB publishes ~16:00 CET on TARGET working days, and MAS timing differs — the exact run time
  is locked only once publication timing is verified.
- **Rationale relative to publication:** requesting "latest" at 06:30 SGT captures the most recent
  published effective date without racing publication.
- **Weekend handling:** run still fires; resolves to latest-prior/noop (§9), no fabrication.
- **Retry window:** shared bounded retry (§11), total budget ≪ lease.
- **Previous run still active:** overlap rejection via lease (`FX_SYNC_ALREADY_RUNNING`); the scheduler
  does not force-steal an active lease.

---

## 17. Scheduler authentication (no long-lived secret in repo/SQL/docs/frontend)

Constraints (mandatory): **no** long-lived secret in repository files, SQL text, documentation, or
frontend environment variables.

- **Recommended model:** a **dedicated automation principal per eligible company** holding the minimum
  privileged sync role (`Finance Manager` **or** `System Admin`), whose access token is stored **only in
  Supabase Vault**; `pg_net` reads it from Vault at invocation time and sends it as the `Authorization`
  header to the Edge Function. This reuses the existing role checks unchanged (least surprise, least new
  code) and keeps the secret out of the repo.
- **Alternative (`[VERIFY]`/decide at review):** a service-role internal-invocation path guarded by a
  Vault-stored shared secret header validated inside the Edge Function. Rejected as the default because it
  adds a new auth path; kept as a documented fallback only.
- **Secret storage:** Supabase Vault (staging). **Least privilege:** automation principal limited to the
  sync trigger scope. **Rotation:** rotate the Vault secret without code changes. **Logging redaction:**
  `pg_net`/function logs must never include the Authorization header or token; sanitization enforced.
- No credential is invented, printed, or committed in this plan or in the implementation.

---

## 18. Lease and scheduler interaction (reuse 9D-A; no second locking system)

| Situation | Behavior (existing 9D-A semantics) |
| --- | --- |
| no active lease | `fx_acquire_sync_lease` acquires; run starts |
| active same-scope lease | acquire fails → `FX_SYNC_ALREADY_RUNNING` (409); scheduler skips |
| lease expired | successor reclaims; prior `Running` run terminalized `Failed` (`FX_SYNC_LEASE_EXPIRED`) |
| stale run exists | recovered on next acquire via expiry reclaim |
| provider request slow | lease renewed around fetch; if exceeded, fenced writes fail closed (`FX_SYNC_LEASE_LOST`) |
| retry delay | lease renewed between attempts; budget ≪ lease |
| scheduler fires twice | second acquire loses on the unique lease scope → overlap rejection |
| manual + scheduler overlap | one holds the lease; the other gets `FX_SYNC_ALREADY_RUNNING` |

No scheduler-specific lock is introduced; the `company_id + provider` lease scope is authoritative.

---

## 19. Sync scope and multi-tenant behavior

- **Per-company invocation.** The scheduler enumerates **eligible companies** and invokes **one run per
  company per provider scope** (the lease scope is `company_id + provider`). One company's lease never
  blocks unrelated companies (distinct scopes).
- **Eligible-company source (`[VERIFY]`/decide):** a controlled configuration (either a small
  staging config list or a `fx_sync_schedules`/eligibility table introduced by a forward-only migration —
  see §21). Uncontrolled "all companies" global enumeration is avoided; staging starts with an explicit
  allowlist (likely the single TSH Synergy staging company).
- **Isolation guarantees preserved:** no cross-company rate visibility, no cross-company run visibility
  (RLS + company scoping), no global tenant bypass, no shared lease across companies.
- **Per-company duplication trade-off (recorded, not silently changed):** because the 9D-A schema is
  company-scoped, identical external reference rates are stored **per company**. This is an accepted
  architecture trade-off for tenant isolation; it is **not** re-architected in 9D-B. Any move to a shared/
  global reference table would require explicit approval and is out of 9D-B scope.

---

## 20. Reference-rate history behavior (reuse existing versioning exactly)

Real provider ingestion goes through `fx_upsert_reference_rate` (11-arg, lease-fenced) with no new write
path:

- **First value:** insert `Active`.
- **Duplicate identical value:** `noop`/unchanged; no extra history row.
- **Corrected value:** prior `Active` → `Superseded`; new `Active` inserted; valid `supersedes_rate_id`.
- **Concurrent correction:** existing advisory-lock serialization + unique Active index guarantee exactly
  one Active logical row and a valid Superseded chain.

---

## 21. Database migration assessment

**Reference-rate ingestion needs no schema change.** The 017 schema already carries `provider`,
`source_host`, `provider_rate_type`, `provider_timestamp`, `fetched_at`, `sync_run_id`, versioning, RLS,
and grants sufficient for real provider data. Migrations **017–020 must not be modified.**

A **new forward-only migration (proposed `021_fx_scheduler_staging.sql`)** is likely required **only for
the scheduler**, and only if the scheduler design stores state in the database. Its candidate contents
(each `[VERIFY]`/decide at review):

- enable `pg_cron` and `pg_net` extensions in **staging** (if not already enabled);
- optionally a small `fx_sync_schedules` / eligible-company config table (RLS, `service-role`-only writes,
  SELECT gated by company access) if eligibility is DB-driven;
- the scheduled job definition (or leave the job creation to a controlled staging operational step rather
  than committed SQL, to avoid embedding invocation details);
- **no** secret in SQL text (Vault only);
- backward compatible, additive, forward-only; **no** change to 017–020;
- rollback/containment = drop the job and (if created) the config table (§31).

If review concludes the scheduler can be fully expressed via `config.toml`/Vault without SQL state, then
**no migration is required** and this is stated explicitly in the evidence. Decision is an Open Decision
(§35).

---

## 22. Exact file-level implementation map

| File | Action | Responsibility / reason |
| --- | --- | --- |
| `backend/supabase/functions/fx-rate-sync/frankfurter.ts` | **create** | real `FrankfurterFxProvider` (host allowlist, request builder, fetch+timeout+retry, parser, per-pair mapping) |
| `backend/supabase/functions/fx-rate-sync/provider.ts` | **modify** | add `createFxProvider(providerId)` selection factory; preserve `DeterministicMockFxProvider` unchanged |
| `backend/supabase/functions/fx-rate-sync/validation.ts` | **modify** | add `APPROVED_REAL_PROVIDER_ID`, `APPROVED_PROVIDER_HOSTS`, `assertApprovedProvider`, timeout/retry constants, optional metadata-consistency check; keep all existing validators |
| `backend/supabase/functions/fx-rate-sync/service.ts` | **modify** | add `runProviderSync` reusing the lease lifecycle; extract shared orchestration from `runMockSync`; wrap `fetchRates` with timeout/retry; replace `assertProviderNeutralOnly` with `assertApprovedProvider` |
| `backend/supabase/functions/fx-rate-sync/index.ts` | **modify** | add `POST /fx-rate-sync/sync` route; keep `/mock-sync` |
| `backend/supabase/functions/fx-rate-sync/types.ts` | **modify** | add real-provider/adapter config + retry/timeout + metadata types |
| `backend/supabase/functions/fx-rate-sync/fx_reference_test.ts` | **modify** | add adapter/service unit + integration tests (injected fake fetch); preserve existing tests |
| `backend/supabase/functions/fx-rates/index.ts` | **no change (assess)** | read API is provider-generic; prefer no change |
| `backend/supabase/functions/fx-rates/service.ts` | **no change (assess)** | health already reflects real runs via `fx_sync_runs`; keep `reference_only: true` |
| `database/017–020_*.sql` | **no change (locked)** | must not be modified |
| `database/021_fx_scheduler_staging.sql` | **create (conditional)** | scheduler extensions/config only, forward-only, no secrets (§21) — only if DB state is required |
| `docs/runbooks/BATCH_9D_B_REAL_PROVIDER_STAGING_RUNBOOK.md` | **create (at implementation)** | staging runtime test harness + verification queries + safety boundary |
| `docs/evidence/SPRINT_BATCH_9D_B_*_EVIDENCE.md` | **create (at closure)** | runtime evidence — not now |

Filenames follow existing repo conventions (`provider.ts`/`validation.ts`/`service.ts`; `BATCH_9D_*`
docs). No unnecessary invented filenames.

---

## 23. Testing strategy (separate evidence classes)

**A. Provider adapter unit tests** (`FrankfurterFxProvider` with an injected fake `fetch`): valid
response; direction preservation (`from_to`); supported pair; unsupported pair → per-pair failure;
malformed payload → `FX_PROVIDER_MALFORMED` (non-retryable); zero/negative rate → validation reject;
wrong provider metadata → `FX_PROVIDER_MISMATCH`; timeout → abort + retryable; retryable failure path;
non-retryable failure path; sanitization (no secrets in summary).

**B. Service integration tests** (`runProviderSync` with a fake provider): lease acquire; provider fetch;
normalized upsert; duplicate → noop; correction → Superseded; partial failure; failed run; lease lost;
terminalization + count clamping.

**C. Scheduler tests** (harness-level, staging): successful invocation; duplicate fire → overlap
rejection; overlap with manual; expired-lease recovery; authentication failure; missed-run behavior where
testable; manual-trigger overlap.

**D. Regression tests:** 9D-A mock path still works; helper privilege boundary unchanged (`service-role`
only); RLS unchanged; concurrency fencing unchanged; read APIs remain `reference_only`; **no financial
mutation path introduced**.

Deno test suite must remain green (existing 9D-A tests preserved); new tests added, not replaced.

---

## 24. Mandatory staging runtime matrix

Classification key: **[M]** mandatory real staging proof · **[S]** safely simulated locally where real
external reproduction is unsafe/unreliable · **[R]** runtime regression proof. **A simulated failure class
must never be labeled as real runtime proof.**

1. provider endpoint connectivity **[M]**
2. explicit MAS pinning proven **[M]**
3. no blended/default provider behavior **[M]**
4. supported pair success **[M]**
5. unsupported pair explicit failure **[M/S]**
6. exact pair direction (no inversion) **[M]**
7. requested-date vs effective-date behavior **[M]**
8. weekend behavior **[M/S]**
9. holiday/no-publication-day behavior if safely testable **[S]**
10. provider timestamp handling **[M]**
11. fetched timestamp handling **[M]**
12. duplicate sync noop **[M]**
13. correction creates valid Superseded history **[M/S]**
14. malformed provider response rejection **[S]**
15. timeout behavior **[S]**
16. bounded retry behavior **[S]**
17. provider 4xx handling **[S]**
18. provider 5xx handling where safely reproducible **[S]**
19. error sanitization **[M/S]**
20. overlap rejection regression **[R]**
21. stale lease recovery regression **[R]**
22. zombie-worker fencing regression **[R]**
23. concurrent correction regression where applicable **[R]**
24. scheduler invocation proof **[M]**
25. scheduler duplicate-fire safety **[R]**
26. scheduler/manual-trigger overlap **[R]**
27. reference-only destination proof **[M/R]**
28. zero `public.exchange_rates` mutation **[R]**
29. zero invoice mutation **[R]**
30. zero receipt mutation **[R]**
31. zero allocation mutation **[R]**
32. zero journal mutation **[R]**
33. zero balance mutation **[R]**
34. read API smoke **[M]**
35. health observability reflects real runs **[M]**
36. cleanup of synthetic/manual staging artifacts **[M]**

---

## 25. External dependency testing discipline

Three evidence classes must never be blended in the evidence file:

- **Real staging proof** — actual Frankfurter/MAS call behavior (connectivity, pinning, direction,
  effective date, success).
- **Controlled local/unit simulation** — timeout, malformed payload, selected provider 4xx/5xx, rate
  limit, where triggering the real provider to fail is unsafe/unreliable. Explicitly labeled simulated.
- **Runtime regression proof** — lease, RLS, authorization, scheduler overlap, zero-mutation.

Do not fabricate a real provider failure and label it real runtime proof.

---

## 26. Financial zero-mutation plan

Before/after staging fingerprint/counts (mirroring 9D-A), expecting **NO FINANCIAL CHANGE CAUSED BY 9D-B
PROVIDER/SCHEDULER TESTS**:

- `public.exchange_rates` (row count + content hash);
- invoice FX snapshot fields (`exchange_rate`, `base_total`);
- receipt FX snapshot fields (`exchange_rate`, `base_amount`);
- `invoices`, `receipts` row counts;
- allocation data (`allocation_details`, `cn_allocations`, `import_row_allocations`);
- `journal_entries`, `journal_entry_lines`;
- relevant balances/outstanding fields.

Do not run posting/allocation flows merely to test 9D-B. Only `fx_reference_rates` / `fx_sync_runs` /
`fx_sync_leases` may change.

---

## 27. Cleanup strategy

Distinguish three artifact classes:
- **Synthetic test artifacts** (disposable): manual synthetic sync runs, synthetic reference rates from
  deliberately manufactured corrections/failures, temporary test users/roles, temporary provider test
  config, temporary scheduler test jobs.
- **Legitimate staging provider sync records** (retained): genuine scheduled provider reference rows and
  their runs — **do not delete** unless the test plan explicitly scopes them as disposable.
- **Scheduler configuration** (retained until 9D-E decision): the staging job/config, disabled rather than
  purged where appropriate.

Cleanup scopes only the synthetic class; audit history (Superseded rows) is preserved, not casually
deleted.

---

## 28. Rollback and containment

- **Provider issue:** disable the real `/sync` route (or revert adapter deployment); preserve reference
  history for audit; never mutate booking rates.
- **Bad rate ingestion:** stop the scheduler; stop adapter execution; correct via the approved versioned
  correction path (supersede, not delete); never mutate booked snapshots; never casually delete audit
  history.
- **Scheduler issue:** disable/drop the `pg_cron` job; preserve manual privileged sync if safe; inspect
  active lease/run state; clean only scoped test artifacts.
- **Security issue:** disable provider/scheduler entry point; preserve evidence; rotate any exposed
  credential (Vault); do not proceed to production.

---

## 29. Security review checklist (mandatory)

- SSRF-safe **fixed provider host** (allowlist constant); **no** user-supplied provider URL/host;
- request built only from typed params against the fixed host;
- request timeout (§10); bounded response handling / schema validation before use;
- error redaction; **no** raw payload logging; **no** credential leakage;
- helper RPC execution remains **`service-role`-only**;
- RLS regression (reference/runs/leases SELECT gated by company access);
- tenant isolation (company-scoped runs/rates/leases);
- scheduler authentication via Vault (§17); secret storage least-privilege + rotation;
- replay/duplicate invocation safety via lease overlap rejection;
- no new `anon`/`authenticated`/`PUBLIC` EXECUTE grants on FX helpers (Fix3 lesson);
- any new `CREATE OR REPLACE FUNCTION` migration repeats explicit privilege hardening.

---

## 30. Open decisions

**Must be locked before implementation:**
- exact Frankfurter v2 endpoint/host/path contract (`[VERIFY]` §6);
- exact provider/base query parameter names (`[VERIFY]` §6);
- **whether/how `MAS` is expressible on Frankfurter v2 and how source identity is proven** — highest risk;
  if unprovable, adopt the strongest verifiable contract in §5 and document the limitation
  (recommendation: proceed with transport identity + pinned provider ID + fail-closed metadata check);
- exact approved real provider ID string (`APPROVED_REAL_PROVIDER_ID`) and source-host allowlist;
- real route name — **recommendation: `POST /fx-rate-sync/sync`**;
- currency allowlist policy — **recommendation: explicit `source → base` allowlist narrowed to in-use
  transaction currencies**;
- scheduler technology — **recommendation: `pg_cron` + `pg_net` + Vault**;
- scheduler timezone/cadence — **recommendation: 06:30 SGT daily, pending publication-timing verify**;
- retry numbers + timeout — **recommendation: 3 attempts, expo backoff + jitter, 8 s timeout, ≤~30 s
  budget**;
- multi-company scheduling strategy — **recommendation: per-company invocation over an explicit eligible
  allowlist (single staging company first)**;
- whether a schema migration is needed — **recommendation: none for rate data; conditional forward-only
  `021` for scheduler state only**.

**May be resolved during implementation review (no architecture/security impact):** exact backoff
constants within the stated bounds; log field formatting; test fixture values; health-response cosmetic
fields.

---

## 31. Acceptance criteria

9D-B is complete only when: real provider adapter works against Frankfurter v2; MAS pinning is proven (or
the strongest verifiable contract is proven and its limitation documented); no fallback/substitution
occurs; pair direction is correct with no inversion; date/effective-date/weekend semantics are correct
with no fabrication; timeout/retry semantics work; scheduler staging invocation is proven; scheduler
overlap safety works; 9D-A lease/fencing/RLS/privilege regressions pass; correction history remains valid;
read APIs remain `reference_only`; **zero `exchange_rates` mutation**; **zero financial mutation**;
security boundaries intact; cleanup/retained-staging metadata documented; evidence complete (three
evidence classes not blended); Closure Review passes.

---

## 32. 9D-C handoff boundary

**9D-B may deliver:** trustworthy external reference rates; provider provenance; effective date; fetch
timestamp; sync observability.

**9D-B must NOT decide:** when reference becomes booking rate; who approves promotion; how override affects
booking; manual override policy; booking-rate provenance presentation; booked-snapshot correction. All of
these belong to **9D-C** governance.

---

## 33. Gate discipline (staging deployment sequence)

```text
Implementation
→ Codex Technical Review
→ Staging Readiness Review
→ Explicit User Staging Approval
→ Staging Deployment
→ Provider Connectivity Proof
→ Scheduler Staging Activation
→ Runtime Verification
→ Evidence Consolidation
→ Closure Review
```

Deployment authorization is **separate** from planning approval; passing this plan's Codex second review
does not authorize deployment.

---

## 34. Production boundary

Batch 9D-B must NOT: deploy provider integration to production; activate a production scheduler; perform
production provider calls; run production sync; mutate production reference rows; mutate production booking
rows. **Production provider/scheduler rollout is owned by Batch 9D-E.**

---

## 35. Relationship to the master plan

This sub-plan sits under master `§0.4`/`§0.5` (9D-B scope + the 22-item mandatory verification). The
master plan remains the authoritative phase/order document; this file holds the implementation-ready
detail and expands the master's 22-item matrix into the 36-item runtime matrix (§24). No master-plan
architecture, order, or DG-1 lock is changed by this file.
