# Batch 9D — Daily FX Rate Sync and Multi-Currency UX — Implementation Plan

- **Batch:** 9D — Daily FX Rate Sync and Multi-Currency UX.
- **Type:** Discovery + implementation plan (planning only; no code, migration, deployment, or provider call).
- **Author:** Claude Code (discovery, plan, frontend UX design).
- **Date:** 2026-07-05.
- **Baseline commit:** `2e5d86e3ad2f0e3139e20e67cde0c4a3e4952118` (Batch 9C closed; `HEAD == origin/main`, clean tree).
- **Predecessor:** Batch 9C — Receipt PDF/Image Import Intake (officially closed).
- **Next gate:** Codex second review (Gate 2) → provider-decision gate → user approval (Gate 3) before any implementation.

> This document is planning and discovery only. No backend/frontend code was changed, no migration was
> created, no schema was modified, no Edge Function was deployed, no cron was configured, no external FX
> provider was called, and neither staging nor production was mutated while producing it.

---

## 1. Executive Summary

Batch 9D adds a **daily FX reference-rate sync** capability and improves the AR module's
**multi-currency UX**. The central discovery finding that shapes the entire batch is:

> **The AR module already has a live, financially authoritative multi-currency core.** An
> `exchange_rates` table exists in the `public` schema, is read at invoice/receipt creation to book the
> transaction `exchange_rate` / `base_total` / `base_amount`, and drives **realized FX gain/loss
> journal entries at allocation/settlement**. It is currently **maintained manually** (Finance Manager /
> config-write role); nothing populates it automatically.

Therefore Batch 9D is **not** greenfield multi-currency accounting. It is:

- **9D-A — FX data foundation:** introduce a **provider-sourced daily reference-rate** capability with
  full provenance (source, fetched_at, effective_date), an idempotent daily sync service modelled on
  the existing `daily-overdue` scheduled function, a read API, and observability — **without silently
  becoming the authoritative booking source** unless a controlled promotion path is explicitly approved.
- **9D-B — Multi-Currency UX:** make original vs. base amounts, the rate used, its effective date, and
  its source clearly and consistently visible, add stale/missing-rate states, and remove display
  fragilities (e.g. a hard-coded `MYR` base-currency check in the invoice detail page).

Two decisions cannot be made from repository evidence alone and are raised as **explicit gates**:
(1) the **FX provider** selection, and (2) whether/how provider rates may **promote into the
authoritative `exchange_rates` booking table** vs. remain reference-only. Default recommendation is
**reference-only with a separate table**, with a role-gated promotion path offered as an option for
Codex/user decision.

---

## 2. Current-State Discovery

Files inspected (read-only):

- **Database:** `database/001_create_tables.sql`, `003_seed_data.sql`, `006_rls_policies.sql`,
  `007_financial_rpcs.sql`, plus the migration index (`002`–`016`, `README.md`).
- **Backend Edge Functions:** `invoices/service.ts`, `invoices/validators.ts`, `receipts/service.ts`,
  `reports/service.ts`, `daily-overdue/index.ts`, and the function inventory under
  `backend/supabase/functions/`.
- **Frontend:** `lib/utils.ts` (money formatting), `app/(dashboard)/invoices/[id]/page.tsx`,
  `stores/company-store.ts`, plus the currency-touching file inventory (51 files reference
  currency/formatting).

Headline findings:

| # | Finding | Evidence |
| --- | --- | --- |
| F1 | `exchange_rates` table already exists (`public` schema). | `001_create_tables.sql:248` |
| F2 | It is **booking-authoritative**: invoice/receipt creation resolves the rate from it. | `invoices/service.ts:127,768`; `receipts/service.ts:89,500` |
| F3 | Prior-business-day fallback is **already implemented** (most recent `effective_date <= date`). | `invoices/service.ts:788-791` |
| F4 | If no rate exists, creation **throws** `ValidationError` ("maintain the exchange rate table"). | `invoices/service.ts:793-797` |
| F5 | The client **may override** `exchange_rate` on create (accepted as a positive number). | `invoices/validators.ts:98-99`; `invoices/service.ts:127` |
| F6 | **Realized FX gain/loss accounting already exists** at allocation; same-currency enforced. | `007_financial_rpcs.sql:833-912` |
| F7 | `exchange_rates` has **no provider/source metadata and no `fetched_at`**. | `001_create_tables.sql:248-260` |
| F8 | The table is **manually maintained**; no scheduled/automated writer exists. | table comment `001:265`; no cron migration in repo |
| F9 | A **scheduled-function pattern already exists** (`daily-overdue`) with a cron-secret guard. | `daily-overdue/index.ts:9-15,48-52` |
| F10 | Reports/dashboard **aggregate `outstanding` in transaction currency**, not base. | `reports/service.ts:218,303` |
| F11 | Frontend already shows currency + rate + base equivalent on invoice detail, but with a **hard-coded `MYR`** base check. | `invoices/[id]/page.tsx:204,308-311` |
| F12 | Demo base currency is **MYR**, entity "TSH Synergy Sdn Bhd"; SGD is a **foreign** seeded currency. | `companies.base_currency DEFAULT 'MYR'` (`001:46`); seed `003:231-239`; `company-store.ts:29` |

---

## 3. Existing Currency / Data Model

### 3.1 `exchange_rates` (authoritative booking source — already exists)

```
exchange_rates (
  id             UUID PK,
  company_id     UUID NOT NULL REFERENCES companies(id),
  from_currency  CHAR(3) NOT NULL,
  to_currency    CHAR(3) NOT NULL,
  rate           DECIMAL(12,6) NOT NULL,
  effective_date DATE NOT NULL,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, from_currency, to_currency, effective_date),
  CHECK (rate > 0)
)
-- idx_exchange_rates_company; idx_exchange_rates_lookup(company, from, to, effective_date DESC)
-- RLS: SELECT = rls_has_company_access; INSERT/UPDATE/DELETE = rls_has_config_write_access
```

- **Authoritative:** read by `resolveExchangeRate()` at invoice **and** receipt creation.
- **No provenance:** cannot record which provider supplied a rate or when it was fetched.
- **Manually maintained** today (config-write role); Batch 9C Settings labels "Daily FX Sync" as
  *Planned (Batch 9D)*.

### 3.2 Transaction-level FX (booked snapshots — financially authoritative)

- `invoices`: `currency`, `exchange_rate DEFAULT 1.0`, `base_currency`, `base_total = total × rate`
  (`001:516-525`). `CHECK (exchange_rate > 0)`.
- `receipts`: `currency`, `exchange_rate DEFAULT 1.0`, `base_currency`, `base_amount = amount × rate`
  (`001:674-681`).
- `journal_entries` / `journal_entry_lines`: carry `currency`, `exchange_rate`, `base_currency`,
  `base_debit`, `base_credit`, `original_amount` (`001:842-844`, `007` JE inserts).
- `allocation_details`: `invoice_rate`, `receipt_rate`, `base_allocated`, `forex_gain_loss` (`007:846-856`).

These booked values are **immutable financial snapshots** — they must never be rewritten by a daily
sync (see §17 Non-Goals).

### 3.3 What is display-only vs. authoritative

| Data | Classification |
| --- | --- |
| `exchange_rates.rate` (curated) | **Authoritative** — sets the booked rate on new transactions |
| `invoices.exchange_rate` / `base_total` | **Authoritative** — booked snapshot at posting |
| `receipts.exchange_rate` / `base_amount` | **Authoritative** — booked snapshot |
| `allocation_details.forex_gain_loss` + ADJ JE | **Authoritative** — realized FX G/L |
| Invoice-detail "MYR equivalent" render | **Display** of the authoritative `base_total` |
| Aging/report `outstanding` totals | **Display**, but currently **currency-naive** (see F10) |
| A new provider daily reference rate (proposed) | **Reference/display only by default** (see §5, §7) |

### 3.4 Missing / ambiguous

- **Missing:** provider/source metadata, `fetched_at`, sync run history/health, a read API for rates,
  any automated writer, any UI surfacing rate source/effective date beyond a bare number.
- **Dangerous ambiguity #1 (F10):** report/dashboard totals sum `outstanding` across currencies without
  base conversion. Safe only if data is effectively single-currency; incorrect for genuine
  multi-currency portfolios.
- **Dangerous ambiguity #2 (F5):** the client can supply `exchange_rate` on invoice create, overriding
  the authoritative table lookup. Needs a Codex ruling on role-gating / acceptance bounds.
- **Dangerous ambiguity #3 (F12):** "Singapore company" framing vs. demo base = MYR / "Sdn Bhd" entity.
  Base-currency and SGD-relevance must be confirmed before choosing provider currency coverage.

---

## 4. Financial Correctness Findings

1. **An approved, verified FX accounting path already exists.** Realized FX gain/loss is computed at
   allocation as `alloc_amount × (receipt_rate − invoice_rate)` and posted as a separate `ADJ` journal
   entry (Dr/Cr Forex Gain/Loss vs AR), only when the invoice and receipt share the same transaction
   currency (`BR-REC-003` enforces same-currency allocation). Batch 9D **must not alter, re-trigger, or
   duplicate** this path.
2. **The `exchange_rates` table is on the authoritative booking path**, not a display cache. Any writer
   into it (including a daily sync) directly changes the rate that future invoices/receipts will book.
   This is the crux of the provider/promotion decision gate (§5).
3. **Booked rates are immutable.** No Batch 9D component may update `invoices.exchange_rate`,
   `receipts.exchange_rate`, `base_total`, `base_amount`, `allocation_details.*`, or any posted JE.
4. **No revaluation exists today** (no unrealized/month-end FX remeasurement). Batch 9D must not add one
   implicitly.
5. **Reporting is currency-naive (F10).** Batch 9D-B should, at minimum, make this visible (currency
   labels / mixed-currency caveat) and must not present naive cross-currency sums as authoritative base
   totals. A true base-currency aggregation is a **larger financial change** and is flagged as an open
   decision, not assumed in scope.

---

## 5. Provider Strategy and Decision Gate

No FX provider is selected, and **no provider can be chosen from repository evidence alone.** This plan
does **not** commit to a provider.

### 5.1 Provider evaluation criteria

Reliability / uptime SLA; supported currency coverage (must cover the confirmed base + all in-use
transaction currencies — at minimum MYR, USD, SGD per seed); **SGD/MYR relevance** for the real entity;
rate update frequency (daily sufficient); availability of **historical dated rates** (for backfill and
audit); licensing/terms suitability for a commercial AR context; authentication model (API key vs.
open); rate limits; a **fixed, documentable host** (SSRF-safe); source transparency (central-bank vs.
aggregated mid-market); and staging/testing practicality (mockable, deterministic fixtures).

### 5.2 Decision Gate DG-1 — Provider selection (BLOCKING for 9D-A implementation)

Implementation of the sync writer may not begin until DG-1 is resolved by Codex/user, recording:
provider name, host, auth model, currency coverage vs. confirmed base, licensing suitability, and how
credentials (if any) are stored (backend-only secret — never `NEXT_PUBLIC`).

### 5.3 Decision Gate DG-2 — Reference vs. authoritative (BLOCKING; financial)

Choose the write target for synced rates:

- **Option B (recommended default):** synced rates land in a **new reference table** (`fx_reference_rates`),
  **display/reference-only**. `exchange_rates` stays manually curated and authoritative. Lowest financial
  risk; matches the "reference-rate infrastructure" default.
- **Option C (opt-in, role-gated promotion):** synced rates land in the reference table, and a
  **separate, explicit, role-gated action** (Finance Manager) promotes a chosen daily rate into
  `exchange_rates` with recorded provenance. Reduces manual toil while keeping a human control point.
- **Option A (not recommended without strong approval):** sync writes directly into `exchange_rates`,
  making provider mid-market rates the booking rate automatically. Highest financial risk; requires
  adding provenance columns to the authoritative table and removes human curation.

The daily sync itself performs **no posting, no allocation, no JE, and no booked-rate mutation** under
any option.

---

## 6. Proposed Architecture

```
                    ┌────────────────────────┐
  pg_cron / cron ──▶│  fx-rate-sync (Edge Fn) │  (mirrors daily-overdue)
  (X-Cron-Secret)   │  service-role admin     │
                    │  - fetch provider (BE)  │──▶ external FX provider (fixed host, BE-only key)
                    │  - validate/normalize   │
                    │  - idempotent upsert     │──▶ public.fx_reference_rates (+ fx_sync_runs)
                    └────────────────────────┘
                                 │
   authenticated read           ▼
  ┌───────────────┐     ┌─────────────────────────┐
  │ frontend hooks │───▶│ read API (lookups/reports│──▶ SELECT (RLS company-scoped)
  │ (no provider)  │     │  or new fx-rates GET)    │
  └───────────────┘     └─────────────────────────┘

  exchange_rates (authoritative booking table) — unchanged by default (Option B).
  Optional role-gated promotion path (Option C) is a separate privileged action.
```

- **Frontend never calls the provider.** Only the backend sync function does, using a backend-only key.
- **Read and write are separated:** authenticated company-scoped reads vs. a privileged
  service-role/cron-guarded sync writer.

---

## 7. Proposed Database Design (recommendation only — no migration in this task)

Default (Option B). Final shape pending DG-2 and Codex review.

### 7.1 `fx_reference_rates` (new, `public` schema)

```
fx_reference_rates (
  id             UUID PK DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id),   -- tenant isolation
  from_currency  CHAR(3) NOT NULL,
  to_currency    CHAR(3) NOT NULL,
  rate           DECIMAL(12,6) NOT NULL CHECK (rate > 0),
  effective_date DATE NOT NULL,                            -- provider quote date
  source         VARCHAR(40) NOT NULL,                     -- provider identifier (no secret)
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),       -- when sync retrieved it
  sync_run_id    UUID REFERENCES fx_sync_runs(id),         -- provenance link
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, from_currency, to_currency, effective_date, source)  -- idempotency
)
-- index (company_id, from_currency, to_currency, effective_date DESC)
```

Design constraints honoured: `public` schema only; company-scoped (tenant isolation); **UNIQUE**
supports idempotent daily upsert (`ON CONFLICT DO NOTHING`/update-if-changed); **historical rows
preserved** (dated, never overwritten across dates); it **does not touch** `exchange_rates` or any
booked transaction rate.

### 7.2 `fx_sync_runs` (new, observability)

```
fx_sync_runs (
  id             UUID PK DEFAULT gen_random_uuid(),
  company_id     UUID REFERENCES companies(id),   -- nullable if global run
  source         VARCHAR(40) NOT NULL,
  status         VARCHAR(20) NOT NULL,            -- Success | PartialFailure | Failed
  started_at     TIMESTAMPTZ NOT NULL,
  finished_at    TIMESTAMPTZ,
  effective_date DATE,                            -- latest quote date synced
  rates_upserted INT NOT NULL DEFAULT 0,
  error_category VARCHAR(40),                     -- coarse, secret-free (Timeout|HttpError|Validation|...)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

### 7.3 RLS

- Both tables: `ENABLE ROW LEVEL SECURITY`, mirroring existing config-table policies.
- **SELECT:** authenticated company access (`rls_has_company_access(company_id)`).
- **Writes:** service-role sync path only (the cron-guarded Edge Function using the admin client, as
  `daily-overdue` does). No user-facing INSERT/UPDATE/DELETE policy for `fx_reference_rates` under
  Option B; Option C's promotion is a separate privileged RPC/action, not a broad table grant.

Uniqueness semantics, historical preservation, idempotency, and tenant isolation are all explicitly
required of the final migration (which is **not** created here).

---

## 8. Proposed Backend / API Design

### 8.1 Sync writer

- **New Edge Function `fx-rate-sync`** modelled on `daily-overdue/index.ts`: `Deno.serve`,
  `X-Cron-Secret` vs `CRON_SECRET` guard, admin (service-role) client, structured JSON result
  (`rates_upserted`, `status`, `error_category`, `execution_time_ms`), CORS via `_shared/cors.ts`.
- Fetches from the **fixed provider host** with a **bounded timeout** and **bounded retries**;
  validates/normalizes the response; performs an **idempotent upsert** into `fx_reference_rates`;
  records an `fx_sync_runs` row. **Never** posts, allocates, creates a JE, or writes booked rates.

### 8.2 Read API (authenticated)

Prefer **extending an existing convention** over a new function where practical:

- `lookups` (or a small new `fx-rates` GET) exposing: **latest rates** for the company; **historical
  rate for a date/pair**; and **sync health/status** (last successful run, latest effective date,
  source, last failure category, staleness). All company-scoped, read-only, no secrets.

### 8.3 Separation of concerns

| Operation | Path | Auth |
| --- | --- | --- |
| Read latest / historical rates, health | authenticated GET (company-scoped, RLS) | user JWT + `X-Company-Id` |
| Daily sync (write reference rates) | `fx-rate-sync` Edge Function | cron-secret + service role |
| (Option C) promote to `exchange_rates` | separate privileged RPC/action | Finance Manager role |

The frontend calls **only** the authenticated read API; it never contacts the provider and never holds
a provider key.

---

## 9. Scheduler and Idempotency Design

- **Mechanism:** reuse the established pattern — **pg_cron (or external scheduler) POSTing the guarded
  Edge Function daily**, exactly as documented for `daily-overdue`. No scheduler is configured in this
  planning task, and none is committed to the repo (scheduling is an operational Supabase config step).
- **Frequency:** once daily. **Timezone:** align with `daily-overdue` (≈01:00 UTC / 09:00 MYT);
  `effective_date` is the provider's quote date, stored explicitly to decouple from run time.
- **Idempotency:** `UNIQUE (company_id, from_currency, to_currency, effective_date, source)` +
  upsert makes a duplicate same-day run a no-op (or an update-if-changed). No duplicate rows.
- **Overlap protection:** short-circuit if a `Success` run for today's `effective_date` already exists;
  optionally an advisory lock to prevent concurrent runs.
- **Retry:** bounded in-function retries for transient provider errors; the daily schedule is itself the
  outer retry. **Manual retry:** the same guarded endpoint can be invoked on demand (Option C admin UI
  or an operator POST) — safe because it is idempotent.
- **Failure handling:** partial provider failure → write what validated, mark run `PartialFailure`;
  full failure → `Failed` with a coarse `error_category`; missing pairs simply leave the last good
  dated rate in place (readers fall back to most-recent `<=` date, consistent with F3).
- **Staging vs. production:** roll out and verify on staging (`gcdsdyegwjdcskpukqlq`) with a mock/fixture
  provider first; enable the production schedule (`kusseuycqgdilychphpq`) only after staging evidence.

---

## 10. Security and Tenant Isolation

- Provider credential (if any) stored **backend-side only** (Edge Function secret / env); **never**
  `NEXT_PUBLIC`, never in frontend bundles, never in evidence.
- **SSRF-safe:** fixed, hard-coded provider host; no user-controlled URLs.
- **Bounded** timeout, retries, and response size; strict **response validation** (currency codes,
  positive decimal rates, sane bounds) before any upsert.
- **RLS** on both new tables; company/tenant scoping on all reads; writes only via the service-role
  cron path; Option C promotion gated to Finance Manager.
- **Cron-secret guard** on the sync endpoint (as `daily-overdue`).
- **Logging without secrets:** log counts, status, coarse error categories — never keys, tokens, or raw
  provider auth.
- **No direct protected financial mutation**, no financial RPC bypass, no booked-rate rewrite.

---

## 11. Multi-Currency UX Design (9D-B)

Design principle: **enterprise-minimal** — surface FX context where a real user needs to trust a
number, not on every row. Base-currency label must come from **company context** (`company-store`
`baseCurrency` / `GET /auth/me` / company record), never a hard-coded `"MYR"` (fixes F11).

| Surface | What to show | Rationale |
| --- | --- | --- |
| **Invoice detail** | Original currency + amount; **base equivalent** (`base_total`); **booked rate**; effective/booked date; (when Option A/C) source. Reference badge if the shown conversion is display-only. | Already partially present; formalize + de-hardcode base. |
| **Receipt detail** | Same pattern using `base_amount` / receipt `exchange_rate`. | Parity with invoices. |
| **Invoice / Receipt list** | Currency **code** beside amounts; base equivalent only when the row currency ≠ base. | Avoid clutter; disambiguate foreign rows. |
| **Create / Import (invoice & receipt)** | Show the **resolved rate + its effective date + source (reference)** before posting, and a clear **missing-rate** state (maps to F4's `ValidationError`). | Prevents surprise post-time failures; makes the authoritative lookup transparent. |
| **Reports / Dashboard** | Explicit currency labels; a **mixed-currency caveat** wherever totals may combine currencies (F10). Do **not** present naive cross-currency sums as authoritative base totals. | Truthful; avoids implying accounting-grade base conversion that does not exist yet. |
| **Settings** | FX sync status block (see §13). | Operational visibility. |

**Do not** add converted values to every table cell; **do not** imply a displayed reference conversion
is a posted/accounting value.

---

## 12. Error / Missing / Stale Rate UX

- **Missing rate:** at create/import, show a clear "No FX rate available for `CCY→BASE` on `date` —
  maintain/await the rate" state (mirrors the backend `ValidationError`, F4), not a raw 500.
- **Stale rate:** if the latest effective date is older than a configurable threshold (e.g. > N business
  days), show a **stale** badge with the actual effective date and source.
- **Fallback provenance:** when a prior-business-day rate is used (F3), display the **actual effective
  date used**, so users see the rate is not same-day.
- **Sync failure:** Settings/admin shows last failure category and last successful sync — never secrets.

---

## 13. Observability

Surface (read-only, company-scoped), sourced from `fx_sync_runs` + latest `fx_reference_rates`:

- Last **successful** sync timestamp; latest **effective rate date**; **source/provider** label;
  last **failure status + coarse category** (secret-free); **staleness** vs. threshold; and
  scheduler-execution evidence (run history rows). Presented in **Settings** (or an admin panel) as an
  FX Sync status card. No sensitive provider detail exposed.

---

## 14. Testing Strategy

**Unit:** provider response normalization; currency-pair validation; decimal/rate validation & bounds;
duplicate/idempotent upsert; stale-date calculation; prior-business-day fallback logic; malformed
provider response; unsupported/unknown currency; timeout/retry bounds.

**Integration:** scheduled sync happy path; bounded retry on transient error; **duplicate daily run is a
no-op**; tenant isolation (company A cannot read company B's rates); authenticated read permissions;
privileged write boundary (non-cron caller rejected); historical date lookup; **regression: existing
invoice/receipt create + posting + allocation + realized FX G/L unchanged**.

**Staging synthetic smoke (`gcdsdyegwjdcskpukqlq`):** mock/fixture provider (deterministic), **no real
customer documents**, **no protected financial mutation**; verify sync **upserts only reference data**;
verify historical rows preserved; verify UI current/stale/missing states; verify invoice/receipt flows
do not regress; verify `/allocations/auto` still returns HTTP 403 `AUTO_ALLOCATION_DISABLED`.

**Production verification (`kusseuycqgdilychphpq`):** prefer **read-only** verification + scheduler/status
evidence; the only sanctioned production mutation is the approved FX **reference** sync insert — never a
financial mutation.

---

## 15. Staging Rollout Plan

1. Codex Gate 2 review of this plan; resolve **DG-1 (provider)** and **DG-2 (reference vs. authoritative)**.
2. Codex implements migration (new tables + RLS), `fx-rate-sync` function, read API; Claude implements
   9D-B UX.
3. Deploy `fx-rate-sync` (and touched functions) to **staging only**; configure a **staging** schedule
   or manual trigger with a **mock/fixture** provider.
4. Run staging synthetic smoke (§14); capture evidence (matrix, idempotency, zero financial mutation,
   regression, `/allocations/auto` 403).
5. Gate on green staging evidence before any production step.

## 16. Production Rollout Plan

1. Deploy backend to production (`kusseuycqgdilychphpq`); **imports/other functions unrelated** unless
   explicitly required.
2. Configure the **production** daily schedule with the real (DG-1) provider + backend-only secret.
3. Read-only production verification: function ACTIVE, read API healthy, first successful sync run
   recorded, Settings status live, invoice/receipt/report flows unregressed, `/allocations/auto` 403.
4. Update Settings status (§12 below → §17 gate): **Daily FX Sync = Live** only after a verified
   successful production sync.

---

## 17. Explicit Non-Goals

Out of scope for Batch 9D (must **not** be added or altered):

- Automatic FX **gain/loss journal entries beyond the existing allocation-time realized path** (which
  already exists and must remain **untouched**).
- **Unrealized** FX gain/loss, **month-end revaluation**, or **remeasurement** of posted transactions.
- **Changing stored booked FX rates** (`invoices`/`receipts`/`journal_entries`/`allocation_details`)
  after posting.
- **Automatic financial posting** triggered by the daily sync.
- **Direct updates to protected financial balances** or any financial-RPC bypass.
- **Client-side external FX provider calls**; **frontend provider API keys** (`NEXT_PUBLIC` secrets).
- By default (Option B), **auto-writing into the authoritative `exchange_rates` booking table** — only
  via the explicitly approved Option C promotion path if DG-2 selects it.
- A true base-currency **re-aggregation of reports** as an authoritative accounting figure (flagged as a
  separate open decision, not assumed here).

## 18. Risks and Open Decisions

| ID | Risk / Decision | Disposition |
| --- | --- | --- |
| DG-1 | FX provider not selectable from repo evidence. | **Gate** — Codex/user decides before 9D-A impl. |
| DG-2 | Reference-only vs. authoritative promotion into `exchange_rates`. | **Gate** — default Option B; Option C opt-in. |
| R1 | Reports sum `outstanding` across currencies without base conversion (F10). | 9D-B surfaces a caveat; true base aggregation is a separate decision. |
| R2 | Client can override `exchange_rate` on create (F5). | Codex to rule on role-gating/bounds; not silently changed here. |
| R3 | Base currency / SGD relevance ambiguous (MYR demo vs. SG framing, F12). | Confirm real base + in-use currencies before provider coverage. |
| R4 | Provider mid-market rate ≠ acceptable booking/contractual rate. | Reinforces Option B default; promotion needs human control. |
| R5 | Scheduler is operational (not in-repo); risk of un-evidenced config drift. | Capture scheduler config as evidence at rollout. |

## 19. Codex Review Questions

1. What **is** the company's confirmed base currency (MYR per seed, or SGD per "Singapore" framing)?
2. Are invoice **and** receipt posting RPCs multi-currency-safe as written today?
3. Can allocation occur across **different** currencies today? (Discovery: **no** — `BR-REC-003`
   enforces same-currency; realized FX G/L uses the rate **difference** on same currency. Confirm.)
4. Is a stored exchange rate already financially authoritative? (Discovery: **yes** — `exchange_rates`
   feeds booked rates; confirm scope.)
5. Does dashboard/report aggregation convert to base, or assume one currency? (Discovery: **naive sum of
   `outstanding`**, F10. Confirm and rule on remediation scope.)
6. Could displaying converted values accidentally imply accounting-authoritative values? How should
   reference conversions be labelled?
7. Should Batch 9D synced rates be **reference/display-only** (Option B) or promotable into
   `exchange_rates` (Option C)? Under what role/controls?
8. Which historical date should drive FX display for invoice, receipt, and reporting views?
9. How should missing / non-business-day rates be resolved and displayed? (Discovery: backend already
   falls back to most recent `<=` date, F3.)
10. Should the client-supplied `exchange_rate` override on create (F5) be restricted, bounded, or
    role-gated?
11. How should fallback provenance (which effective date/source was actually used) be displayed and
    audited?

These are recorded as **open** — the plan does not invent answers.

## 20. Implementation Sequence

Recommended **staged sub-batches** (discovery supports splitting):

- **9D-A — FX data foundation** (after DG-1 + DG-2): migration (`fx_reference_rates`, `fx_sync_runs`,
  RLS) → `fx-rate-sync` Edge Function → read API → observability → unit/integration tests → staging
  smoke with mock provider → staging evidence.
- **9D-B — Multi-Currency UX** (after 9D-A read API exists): base-currency-aware formatting; invoice/
  receipt detail + list FX display; create/import resolved-rate + missing-rate states; stale/missing
  badges; de-hardcode `MYR`; report/dashboard currency labels + mixed-currency caveat; Settings FX
  status card.

Rationale: 9D-B depends on 9D-A's data/provenance and read API; DG-1 blocks 9D-A's provider fetch but
not the schema/UX design work.

## 21. Acceptance Criteria

**9D-A:** new tables exist in `public` with RLS and idempotency constraints; `fx-rate-sync` performs an
idempotent daily upsert of **reference** rates only, with provenance; duplicate daily runs are no-ops;
tenant isolation holds; reads are authenticated + company-scoped; writes are cron/service-role only; no
posting/allocation/JE/booked-rate mutation occurs; observability rows recorded; staging smoke green
including `/allocations/auto` 403 and no financial mutation.

**9D-B:** original + base amounts, rate, effective date, and (per DG-2) source are clearly shown on
invoice/receipt detail; missing/stale states render truthfully; base label derives from company context
(no hard-coded `MYR`); reports carry currency labels and a mixed-currency caveat; no displayed reference
conversion implies a posted/accounting value.

**Overall:** existing invoice/receipt/posting/allocation/realized-FX-G/L behavior is unchanged;
`public` schema only; no `ar.*`; no frontend provider secret; Settings "Daily FX Sync" flips to **Live**
only after a verified production sync.

## 22. Rollback Strategy

- **Schema:** new tables are additive and isolated; rollback = drop `fx_reference_rates` / `fx_sync_runs`
  (and any Option C promotion RPC). No change to `exchange_rates` or transaction tables under Option B,
  so **no financial data to unwind**.
- **Sync function:** disable the schedule / remove the function; readers degrade to "no reference data"
  (invoice/receipt creation continues to use the manually-curated `exchange_rates` exactly as today).
- **UX (9D-B):** front-end-only; revert the commit. Because 9D-B is display-only, rollback carries no
  financial risk.
- **Option C promotion (if adopted):** promoted rows are ordinary curated `exchange_rates` entries with
  recorded provenance; they affect only **future** transactions and can be corrected via the normal
  config-write path. Already-booked transactions are never retroactively changed.

---

## Appendix A — Evidence pointers (read-only, this task)

- Schema: `database/001_create_tables.sql` (companies `:40`, exchange_rates `:248`, invoices `:509`,
  receipts `:665`), `003_seed_data.sql:231`, `006_rls_policies.sql:251-316`,
  `007_financial_rpcs.sql:833-937`.
- Backend: `invoices/service.ts:127,635,704,768`, `invoices/validators.ts:98`, `receipts/service.ts:89,500`,
  `reports/service.ts:218,303`, `daily-overdue/index.ts:9-15,48-52`.
- Frontend: `lib/utils.ts:12-28`, `app/(dashboard)/invoices/[id]/page.tsx:204,308-311`,
  `stores/company-store.ts:29`.

## Appendix B — Batch 9D scope boundary (one line)

Batch 9D delivers **daily FX reference-rate infrastructure + multi-currency visibility**; it is **not**
an FX revaluation engine and does **not** change any booked rate or existing FX accounting.
