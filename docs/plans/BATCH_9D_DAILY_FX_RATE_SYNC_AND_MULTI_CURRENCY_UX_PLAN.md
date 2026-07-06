# Batch 9D — Daily FX Rate Sync and Multi-Currency UX — Implementation Plan (Amended — Rev 2, Post-9D-A Closure)

- **Batch:** 9D — Daily FX Rate Sync and Multi-Currency UX.
- **Type:** Discovery + implementation plan (planning only; no code, migration, deployment, or provider call).
- **Author:** Claude Code (discovery, plan, frontend UX design).
- **Date:** 2026-07-05 (Rev 1 amendment); **2026-07-06 (Rev 2 — Post-9D-A closure amendment)**.
- **Baseline commit:** `60aeecca007897adee12b3caf2b64dd01619b2bf` (initial Batch 9D plan).
- **Rev 2 baseline commit:** `5740ac7bcc08af0251cda102c2a3fd7af07dd10a` (Batch 9D-A staging runtime pass evidence; `HEAD == origin/main`, clean tree at this amendment start).
- **Amendment drivers:**
  1. **Rev 1 —** Codex Gate 2 review — verdict **PASS WITH REQUIRED PLAN AMENDMENTS**. Locked the 9D-A
     architecture, corrected currency-architecture and report-classification wording, and added override
     governance, correction/idempotency, and weekend semantics.
  2. **Rev 2 —** **Batch 9D-A is now OFFICIALLY CLOSED.** This revision records the 9D-A closure and
     re-orders the provider decision and execution sequence to reflect the current approved architecture:
     the validated reference-only foundation now allows a real provider to be integrated (9D-B) **before**
     the booking-rate governance batch (9D-C). See **§0** (the authoritative current-state section).
- **Predecessor:** Batch 9C — Receipt PDF/Image Import Intake (officially closed at `2e5d86e`).
- **Next gate (Rev 2):** Codex **Batch 9D Plan Amendment Review** → user approval → **DG-1 locked** →
  **9D-B** implementation. Real provider integration remains blocked until **DG-1** is locked.

> This document is planning and discovery only. No backend/frontend code was changed, no migration was
> created, no schema was modified, no Edge Function was deployed, no cron/provider credential was
> configured, no external FX provider was called, and neither staging nor production was mutated while
> producing it. **Daily FX Sync is NOT live in production.** Provider reference rates do **NOT**
> automatically become booking rates. A latest/reference conversion is **NOT** accounting-authoritative.
> Frankfurter/MAS integration is a **proposed DG-1 decision pending review/approval — NOT implemented.**
> Batch 9D-A (provider-neutral foundation) is officially closed; **§0 supersedes the earlier execution
> ordering** in §13 and §20 where they differ.

---

## 0. Rev 2 Post-9D-A Closure Amendment (Provider Decision & Execution Order) — AUTHORITATIVE

> This section is the **current authoritative** statement of Batch 9D-A closure, the revised execution
> order, and the proposed DG-1 provider decision. Where it differs from the earlier ordering in §13 and
> §20, **§0 governs** and the earlier ordering is marked superseded. Earlier content is retained for
> history and is **not** erased.

### 0.1 Batch 9D-A closure status

**Batch 9D-A — Provider-Neutral FX Reference Foundation** — status: **`OFFICIALLY CLOSED`**.

Closure context: closed following the **staging runtime verification PASS** consolidated at commit
`5740ac7bcc08af0251cda102c2a3fd7af07dd10a` (2026-07-06), after the remediation chain
Original → Fix1 → Fix2 → (first staging runtime FAIL) → Fix3 → staging runtime resume PASS.

Final evidence state (concise — see the evidence file, do **not** duplicate it here):

- provider-neutral reference architecture implemented;
- migrations `017`–`020` completed through the approved staging scope;
- staging runtime verification **PASS**;
- privilege matrix **PASS**; RLS runtime **PASS**; role authorization **PASS**;
- mock sync **PASS**; lease lifecycle **PASS**; **seven** true concurrency scenarios **PASS**;
- read APIs **PASS**; financial zero-mutation **PASS**; synthetic cleanup **PASS**;
- **production rollout was not part of 9D-A** (deferred to 9D-E).

Authoritative evidence:
`docs/evidence/SPRINT_BATCH_9D_A_PROVIDER_NEUTRAL_FX_REFERENCE_FOUNDATION_EVIDENCE.md`.

### 0.2 Original execution order (preserved) vs revised canonical order

**Original order (Rev 1 — now superseded where it differs).** Rev 1 §13/§20 sequenced governance (9D-C)
to proceed **in parallel and ahead of** the provider decision (DG-1) and real provider integration
(9D-B), i.e. effectively:

```text
9D-A → 9D-C (governance, parallel/early) → DG-1 → 9D-B → 9D-D → 9D-E
```

This original ordering is **retained for history** and is **superseded** by §0.3 below.

**Revised canonical order (Rev 2 — CURRENT).**

```text
1. Batch 9D-A — Provider-Neutral FX Reference Foundation      Status: CLOSED
2. DG-1        — Formal FX Provider Decision
3. Batch 9D-B  — Real Provider Integration and Scheduler Staging
4. Batch 9D-C  — Booking Rate Provenance and Override Governance
5. Batch 9D-D  — Multi-Currency UX and Monetary Aggregation Correctness
6. Batch 9D-E  — Production Rollout and Verification
```

**Why the order changed.** Batch 9D-A now provides a **validated reference-only foundation** (staging
runtime PASS). A real provider can therefore be integrated into `public.fx_reference_rates` (9D-B)
**without affecting booking-rate financial behavior**, because the reference layer is provably separated
from the `public.exchange_rates` booking layer. **9D-C remains the governance gate** for any future
influence of reference data on the booking-rate path — it is not a prerequisite for merely ingesting a
real provider's *reference* data. Moving DG-1 + 9D-B ahead of 9D-C reflects that the reference/booking
separation is now proven, not assumed.

### 0.3 DG-1 — Formal FX Provider Decision (PROPOSED — pending review & user approval)

> **Status: PROPOSED for Codex/user approval. NOT locked, NOT implemented. No provider API is called in
> this planning task.** Frankfurter/MAS integration is **not** implemented.

- **API / transport:** **Frankfurter v2**.
- **Provider strategy:** **explicit provider pinning is mandatory**. **Initial provider: `MAS`.**
- **Authentication:** **no provider API key** is expected for the selected provider transport model. Do
  **not** add provider-credential infrastructure unless future implementation evidence proves it is
  required.
- **Pair semantics:** preserve explicit direction **`from_currency × rate = to_currency`**; **no silent
  inversion** (consistent with §10.2 and the `exchange_rates` convention).
- **Initial reference destination:** real provider data may write **only** to `public.fx_reference_rates`,
  `public.fx_sync_runs`, and the lifecycle lease/observability infrastructure of the approved foundation.
  It must **not** write `public.exchange_rates`, invoices, receipts, allocations, journals, or balances.

**DG-1 explicitly prohibits:**

1. implicit blended / default provider selection;
2. silent provider fallback;
3. silent provider substitution;
4. silent pair inversion;
5. unsupported-pair fabrication;
6. writing provider results directly to `public.exchange_rates`;
7. automatic promotion from reference rate to booking rate;
8. retroactive mutation of booked **invoice** FX snapshots;
9. retroactive mutation of booked **receipt** FX snapshots;
10. financial posting / allocation mutation from provider sync.

### 0.4 Batch 9D-B — Real Provider Integration and Scheduler Staging

**Provider adapter:** Frankfurter v2 integration; explicit provider parameter/pinning; **initial MAS
source**; exact pair normalization; explicit unsupported-pair handling; explicit **no-silent-fallback**
behavior; response validation; safe provider error mapping; sanitized error handling; request timeout;
bounded retry where appropriate; **no secret/raw-payload leakage**.

**Sync behavior (reuse the closed 9D-A foundation):** scheduled daily reference sync; manual privileged
trigger retained where appropriate; **reuse** the existing lifecycle lease model, overlap protection,
stale recovery, transactional fencing, versioned correction, and duplicate/noop behavior.

**Scheduler (belongs to 9D-B staging scope):** staging-first scheduler activation; timezone explicitly
documented; daily cadence explicitly documented; **no production scheduler activation in 9D-B**;
production activation deferred to **9D-E**.

**Destination:** only `public.fx_reference_rates` (with `fx_sync_runs`/lease observability) for provider
reference data. **Do not promote into `public.exchange_rates` during 9D-B.**

### 0.5 Batch 9D-B — Mandatory staging runtime verification

At minimum, 9D-B staging must verify:

1. provider endpoint connectivity;
2. explicit **MAS** provider pinning;
3. **no** blended/default provider use;
4. supported-pair success;
5. unsupported-pair **explicit failure**;
6. exact pair direction (no inversion);
7. effective-date behavior;
8. provider timestamp / fetched-timestamp handling;
9. duplicate sync **noop**;
10. provider correction creates valid **Superseded** history;
11. provider/network **timeout**;
12. malformed-response rejection;
13. provider-error sanitization;
14. overlap rejection;
15. stale-lease recovery regression;
16. transactional fencing regression;
17. scheduler invocation proof;
18. scheduler duplicate/overlap safety;
19. reference-only destination proof;
20. **zero `public.exchange_rates` mutation**;
21. **zero invoice/receipt/allocation/journal mutation**;
22. cleanup of synthetic/manual staging artifacts where applicable.

### 0.6 Batch 9D-C — Booking Rate Provenance and Override Governance (scope clarification)

9D-C is the **first** batch permitted to *design* controlled governance between `fx_reference_rates` and
`exchange_rates`. Even in 9D-C: **no automatic promotion is assumed**; promotion design requires
**explicit approval**; provenance must be traceable; booking source must be auditable; manual override
governance must be explicit; override reason/audit requirements must be explicit; booked transaction
snapshots remain **immutable after booking** unless a separately approved correction model exists;
realized-FX behavior must remain compatible with existing allocation logic.

Current approved architecture remains:

```text
fx_reference_rates = external / reference rate layer
exchange_rates     = booking-rate source
```

Any bridge between them requires **9D-C governance and explicit approval**. (See §6 for the detailed
override-governance requirements, which remain in force.)

### 0.7 Batch 9D-D — Multi-Currency UX and Monetary Aggregation Correctness (scope)

Clear transaction-currency display; clear company base-currency display; reference-rate vs booking-rate
labeling; rate source/provenance display **where approved**; effective-date display; conversion
explanation; mixed-currency aggregation prevention; base-currency aggregation rules; dashboard/report
correctness; **no summing incompatible currencies without conversion**; safe fallback/empty states;
clear stale-rate indicators where relevant; user-facing override workflow **only if approved by 9D-C**.
(Detailed surface-by-surface design remains in §14–§15; the A–E value distinction still applies.) **No UI
is implemented in this plan-amendment task.**

### 0.8 Batch 9D-E — Production Rollout and Verification (scope)

Production readiness review; migration readiness; provider **production** connectivity; scheduler
**production** activation; production observability; production role/RLS verification; production
reference-sync smoke; production booking-governance verification where applicable; multi-currency UX
production smoke; **zero financial regression** verification; rollback/containment plan; final production
evidence. **No production deployment occurs in this task.**

### 0.9 Architecture invariants (mandatory — reaffirmed)

1. `public` schema only.
2. Explicit `from_currency → to_currency` semantics.
3. No silent inversion.
4. No silent provider fallback.
5. No blended default provider behavior.
6. Reference FX layer is separate from booking FX layer.
7. No automatic write to `public.exchange_rates`.
8. No retroactive mutation of booked **invoice** rate snapshot.
9. No retroactive mutation of booked **receipt** rate snapshot.
10. Allocation realized-FX behavior must remain compatible.
11. `/allocations/auto` remains **disabled** (HTTP 403 `AUTO_ALLOCATION_DISABLED`) and outside FX sync scope.
12. Frontend cannot bypass approved backend financial boundaries.
13. No provider sync may directly mutate invoices, receipts, allocations, journals, or balances.
14. Company/tenant isolation remains mandatory.
15. Privileged sync helper RPCs remain **service-role-only**.
16. Scheduler deployment must be **staging-first and production-gated**.

### 0.10 Non-blocking follow-ups (separate from the provider-integration critical path)

These are **non-blocking** and must **not** be silently folded into 9D-B mandatory scope unless a review
explicitly assigns them:

- `/fx-rates/latest` global `.limit(500)` occurs before application-side grouping (observed in the 9D-A
  staging read-API check) — an efficiency/correctness-at-scale follow-up, **not** a provider-integration
  blocker;
- future helper `CREATE OR REPLACE FUNCTION` migrations must **repeat explicit privilege hardening**
  (revoke `PUBLIC`/`anon`/`authenticated`, grant `service_role`) — lesson from Fix3;
- a broader **repository-wide function `EXECUTE` / default-privilege audit** may be advisable as a
  separately-scoped task (non-blocking; not a claim that other functions are currently vulnerable).

### 0.11 Gate discipline

**Before 9D-B implementation:**

```text
Claude Plan Amendment → Codex Amendment Review → User Approval → DG-1 Locked → 9D-B Implementation
```

**9D-B lifecycle:**

```text
Implementation → Technical Review → Staging Readiness → Explicit Staging Approval
→ Staging Deployment → Runtime Verification → Evidence → Closure Review
```

**Production:** no production provider/scheduler rollout before **9D-E** approval.

### 0.12 Historical accuracy statement

- **Original order (Rev 1):** `9D-A → 9D-C (parallel/early) → DG-1 → 9D-B → 9D-D → 9D-E` (retained in
  §13/§20, now marked superseded).
- **Reason for amendment:** 9D-A closed with a validated reference-only foundation, so real-provider
  ingestion (9D-B) can safely precede booking-rate governance (9D-C); the reference/booking separation is
  proven, not assumed.
- **New canonical order (Rev 2):** `9D-A (CLOSED) → DG-1 → 9D-B → 9D-C → 9D-D → 9D-E` (§0.2).
- **9D-A closure context:** evidence consolidated at `5740ac7bcc08af0251cda102c2a3fd7af07dd10a`
  (2026-07-06), staging runtime PASS.
- **DG-1:** **proposed** decision (Frankfurter v2, MAS pinning) **pending Codex review and user
  approval** — **not** locked and **not** implemented. Frankfurter/MAS integration does **not** exist yet.

---

## 1. Executive Summary

Batch 9D adds a **daily FX reference-rate sync** capability and improves the AR module's
**multi-currency UX**, on top of an **existing, live, path-dependent authoritative multi-currency core**.

Key discovery (unchanged and re-confirmed): a `public.exchange_rates` table already exists, is read at
invoice/receipt creation (when no client override is supplied) to book the transaction `exchange_rate` /
`base_total` / `base_amount`, and those booked snapshots then drive posting and **realized FX gain/loss
at allocation**. It is **manually curated** today; nothing populates it automatically.

**Codex-locked decisions in this amendment:**

- **DG-2 is LOCKED to Option B for 9D-A.** Synced provider rates live in **new** `public.fx_reference_rates`
  (reference-only) with run records in **new** `public.fx_sync_runs`. The sync **never** writes
  `exchange_rates`, never auto-promotes reference rates to booking rates, and triggers no financial
  mutation. Option C (controlled promotion) is recorded as a **future, separately-approved** capability
  only — **not** in 9D-A.
- **DG-1 is refined.** The **provider-neutral foundation** (schema, RLS, adapter interface, deterministic
  mock provider, normalization, validation, read API, observability, tests) may proceed **after Codex
  confirmation of this amendment and explicit user implementation approval**. **Real provider
  integration** (external host, credentials, real adapter, provider-specific retry, real cron/production
  scheduling) remains **blocked** until provider selection.
- **Report/dashboard aggregation is not uniformly currency-naive.** The newer live-dashboard RPC is
  **base-normalized**; several older views/aliases/report paths use **raw transaction-currency** sums. A
  full classification matrix is added (§5). Mixed-currency invalid totals must be **corrected or grouped
  by currency**, not merely disclaimed.

The batch is re-sequenced into **five sub-batches (9D-A … 9D-E)** (§13, §20).

---

## 2. Current-State Discovery

Files inspected (read-only) in the original plan and this amendment:

- **Database:** `001_create_tables.sql`, `002_create_views.sql`, `003_seed_data.sql`,
  `006_rls_policies.sql`, `007_financial_rpcs.sql`, `007c_api_staging_fixtures.sql`,
  `014_live_dashboard_metrics.sql`, migration index (`002`–`016`, `README.md`).
- **Backend Edge Functions:** `invoices/service.ts`, `invoices/validators.ts`, `receipts/service.ts`,
  `reports/service.ts`, `imports/service.ts`, `daily-overdue/index.ts`, `_shared/constants.ts`,
  `_shared/validators.ts`, `_shared/errors.ts`, function inventory.
- **Frontend:** `lib/utils.ts`, `app/(dashboard)/invoices/[id]/page.tsx`, `stores/company-store.ts`,
  currency-touching file inventory (51 files).

Headline findings (updated):

| # | Finding | Evidence |
| --- | --- | --- |
| F1 | `exchange_rates` table exists (`public`). | `001_create_tables.sql:248` |
| F2 | Booking-authoritative **when no client override**: invoice/receipt create resolves the rate from it. | `invoices/service.ts:127,768`; `receipts/service.ts:89,500` |
| F3 | Prior-business-day fallback already implemented (latest `effective_date <= date`). | `invoices/service.ts:788-791` |
| F4 | Missing rate → `ValidationError` ("maintain the exchange rate table"). | `invoices/service.ts:793-797` |
| F5 | Client **may override** `exchange_rate` on create; **draft update** can change it; validation is numeric positivity only; no role/reason/provenance/audit. | `invoices/validators.ts:98-99`; `invoices/service.ts:127,636` |
| F6 | Realized FX gain/loss exists at allocation; **same-currency enforced**. | `007_financial_rpcs.sql:833-912` |
| F7 | `exchange_rates` has **no provider/source/fetched metadata**. | `001:248-260` |
| F8 | Manually maintained; no automated writer; no cron migration in repo. | `001:265`; repo scan |
| F9 | Scheduled-function pattern exists (`daily-overdue`, cron-secret + admin client). | `daily-overdue/index.ts:9-15,48-52` |
| F10 | **Report/dashboard aggregation is MIXED** (see §5): live-dashboard RPC base-normalized; older views/aliases raw. | `014:164-336` vs `002:377-462`, `reports/service.ts:218,303` |
| F11 | Frontend shows currency+rate+base on invoice detail but with **hard-coded `MYR`** base check. | `invoices/[id]/page.tsx:204,308-311` |
| F12 | Per-company base via `companies.base_currency`; default/demo **MYR**; **staging fixture has an SGD-base company**; backend reads base dynamically; SGD must **not** be inferred from "Singapore" framing. | `001:46`; `007c:143-177`; `company-store.ts:29` |
| F13 | Posting RPC uses the **stored booked** `exchange_rate`, not a fresh `exchange_rates` lookup. | `007_financial_rpcs.sql:243,366,650` |
| F14 | `imports/service.ts` contains **no** `exchange_rate` handling — imported docs resolve the rate from the table today; but the create validator accepts `exchange_rate`, so a future import mapping could inject one. | `imports/service.ts` (no match); `invoices/validators.ts:98` |
| F15 | Currency validation is ISO-4217 shape only (**no allowlist**); constants map MY→MYR, SG→SGD, US→USD, GB→GBP; seed exercises MYR/SGD/USD. | `_shared/validators.ts:159`; `_shared/constants.ts:95-98`; `003:231-239` |

---

## 3. Existing Currency / Data Model (corrected wording)

### 3.1 Base currency

- Schema supports **per-company base currency** via `companies.base_currency CHAR(3)` (`001:46`).
- Default/demo value is **MYR**; frontend `company-store` default is also `MYR` (`company-store.ts:29`).
- **Staging fixtures include an SGD-base company** (`007c:143-177`, e.g. P1 API company).
- Backend creation paths read the company base currency **dynamically** (`resolveExchangeRate` selects
  `companies.base_currency`).
- Frontend still has **hard-coded `MYR`** assumptions (e.g. invoice detail base check, `formatCurrency`
  default) — a 9D-D fix.
- **Do not infer SGD** as the base from the "Singapore company" business framing; the actual base is a
  per-company configuration value (MYR in the primary demo, SGD in a staging fixture).

### 3.2 `exchange_rates` (path-dependent authoritative)

```
exchange_rates (
  id, company_id, from_currency CHAR(3), to_currency CHAR(3),
  rate DECIMAL(12,6) CHECK (rate > 0), effective_date DATE, created_by, created_at,
  UNIQUE (company_id, from_currency, to_currency, effective_date)
)
-- RLS: SELECT = rls_has_company_access; INSERT/UPDATE/DELETE = rls_has_config_write_access
-- Direction: from_currency (transaction/foreign) → to_currency (company base)
```

Precise classification — **`exchange_rates` is path-dependent authoritative**:

1. It is the **default booking-rate resolution source** at invoice/receipt creation **when no client
   override is present**.
2. It is **bypassable** by a client/import `exchange_rate` override (F5, F14).
3. Once creation/posting stores the booked snapshot (`invoices.exchange_rate` / `base_total`,
   `receipts.exchange_rate` / `base_amount`), **that snapshot becomes authoritative** for all downstream
   posting and allocation.
4. It has **no provider/source/fetched metadata**, and it is **not re-read directly by the posting RPC**
   (posting uses the stored booked rate, F13).

### 3.3 Transaction-level booked snapshots (authoritative, immutable)

- `invoices`: `currency`, `exchange_rate` (DEFAULT 1.0, `CHECK > 0`), `base_currency`, `base_total` (`001:516-525`).
- `receipts`: `currency`, `exchange_rate`, `base_currency`, `base_amount` (`001:674-681`).
- `journal_entries`/`_lines`: `currency`, `exchange_rate`, `base_currency`, `base_debit`, `base_credit`,
  `original_amount`.
- `allocation_details`: `invoice_rate`, `receipt_rate`, `base_allocated`, `forex_gain_loss` (`007:846-856`).

These are immutable financial snapshots; Batch 9D must never rewrite them (§4).

---

## 4. Financial Correctness Findings and Mandatory Invariants

### 4.1 Existing behavior to be recorded and preserved

- Invoice posting uses the **stored booked** `exchange_rate` (F13).
- Receipt posting uses the **stored booked** `exchange_rate`.
- Allocation enforces **same transaction currency** (`BR-REC-003`).
- **Realized FX** = `alloc_amount × (receipt_rate − invoice_rate)`; a **material** realized FX amount
  posts a **separate ADJ journal entry** (Dr/Cr Forex Gain/Loss vs AR).
- Batch 9D must **not disturb** any of this logic.

### 4.2 Mandatory financial invariants (FX sync is explicitly PROHIBITED from)

The FX sync (and any 9D component) must **NOT**:

1. update posted `invoices.exchange_rate`;
2. update posted `invoices.base_total`;
3. update `receipts.exchange_rate`;
4. update `receipts.base_amount`;
5. update `invoices.outstanding`;
6. update `receipts.allocated_amount`;
7. update `receipts.unallocated_amount`;
8. insert `allocation_details`;
9. create journal entries;
10. trigger allocation;
11. change `/allocations/auto` (must remain HTTP 403 `AUTO_ALLOCATION_DISABLED`);
12. remeasure posted transactions;
13. create unrealized FX accounting;
14. change realized FX settlement logic;
15. **write `exchange_rates` in 9D-A** (Option B lock).

Reference FX data and booked/accounting base amounts must remain **distinct** at all times.

---

## 5. Report / Dashboard Aggregation Classification (corrected)

**Correction:** the original plan's blanket "reports are currency-naive" claim is inaccurate. The newer
live-dashboard RPC normalizes to base; several older paths do not. A disclaimer **must not** be used to
hide mathematically invalid totals — 9D-D must **correct** them (using authoritative booked base values)
**or group by transaction currency** where base normalization is not semantically appropriate. Latest/
reference FX rates must **never** be used to rewrite historical accounting report totals.

Classification codes: **(1)** transaction-currency safe · **(2)** base-currency normalized · **(3)**
single-currency assumption · **(4)** mixed-currency incorrect · **(5)** ambiguous.

| Endpoint / widget | Source | Basis | Class |
| --- | --- | --- | --- |
| Live dashboard KPIs — total outstanding AR | `014:164` `SUM(outstanding_base)` | base-normalized | **2** |
| Live dashboard — overdue outstanding | `014:167-173` `SUM(outstanding_base) FILTER` | base-normalized | **2** |
| Live dashboard — unapplied/unallocated cash | `014:184` `SUM(unallocated_base)` | base-normalized | **2** |
| Live dashboard — current-month collections | `014:188,297` `SUM(base_amount)` | base-normalized | **2** |
| Live dashboard — top customers | `014:328-361` `outstanding_base`/`overdue_base` | base-normalized | **2** |
| Live dashboard — aging composition | `014:250-269` `outstanding_base` | base-normalized | **2** |
| Dashboard **compatibility aliases** (raw) | `014:460,468,477` `SUM(i.outstanding)`, `SUM(r.unallocated_amount)` | raw txn ccy | **4** (if multi-ccy) |
| `v_customer_ar_summary` monetary sums | `002:377-462` `SUM(i.outstanding)`, `SUM(r.unallocated_amount)` | raw txn ccy | **4** (if multi-ccy) |
| Aging Summary (reports service) | `reports/service.ts:218` `Number(inv.outstanding)` | raw txn ccy | **4** (if multi-ccy) |
| Aging by Customer (reports service) | `reports/service.ts:303` raw `outstanding` | raw txn ccy | **4** (if multi-ccy) |
| `v_aging_by_customer` view | `002:355-367` `SUM(outstanding_base)` grouped incl. `currency` | base-normalized, currency-grouped | **2** |
| Invoice/Receipt list amounts | transaction currency, per-row | transaction-currency safe | **1** |

> Classes marked **4 (if multi-ccy)** are correct for a single-currency company but produce invalid
> cross-currency sums for a genuinely multi-currency company. 9D-D must remediate these (correct to
> booked base, or group by currency), never mask them.

---

## 6. Exchange Rate Override Governance → Batch 9D-C

Codex-verified facts (F5, F14): Invoice Create and Receipt Create accept a client `exchange_rate`; draft
Invoice Update can change it; import paths could map an `exchange_rate` into the create validators;
validation today is numeric positivity only; **no** role distinction, override reason, provenance, or FX
override audit exists; the override **affects booked base values**.

**9D-C — Booking Rate Provenance and Override Governance** (plan-level requirements):

- **A. Role/capability.** Candidate policy for Codex review, aligned to the existing role architecture
  (AR Clerk / AR Supervisor / Finance Manager / System Admin / Auditor): **AR Clerk — no silent
  arbitrary override**; **AR Supervisor / Finance Manager — controlled override capability**. Final rule
  set by Codex to match current capability enforcement.
- **B. Override reason.** Require **bounded reason text** for any manual override.
- **C. Provenance model.** A booking-rate `rate_source` recorded on the transaction, from an explicit
  enumeration (subject to Codex confirmation): `exchange_rates_resolved`, `manual_override`,
  `import_supplied`, `base_currency_identity`, or another explicitly defined source. **Do not imply
  provider provenance** unless the booked rate genuinely came from an approved provider→promotion (Option
  C, future).
- **D. Auditability.** Record: actor; timestamp; previous value (where applicable); new value; reason;
  currency pair; effective transaction date; source/provenance.
- **E. Import handling.** Imports must **not** silently supply authoritative FX overrides without:
  explicit field handling; a review state; a role/capability decision; and provenance. (Today imports do
  **not** map an FX field — F14 — so the safe default is preserved; 9D-C governs any future mapping.)
- **F. Posted snapshot immutability.** No post-booking/post-posting retroactive mutation.

---

## 7. Historical Reference-Rate Correction Semantics

Chosen model for `fx_reference_rates`: **immutable / versioned correction** (preferred).

- One **Active** row per intended key (company, pair, effective_date, provider). A correction inserts a
  new Active row and marks the prior row **Superseded** via `supersedes_rate_id`, preserving history and
  the originating `sync_run_id`.
- Same provider/pair/effective_date re-ingestion with an unchanged value is idempotent (no new version);
  a changed value creates a new version (audit-preserving).
- If an audited upsert is chosen instead, prior values must remain **auditable** (history table or run
  linkage) — versioning is preferred for clarity.

Explicit statements:

- Reference-rate correction **does not modify booked invoice/receipt snapshots**.
- `exchange_rates` correction is a **separate accounting/configuration workflow** (config-write role),
  not part of reference sync.
- A **provider correction is not automatically an accounting-rate correction**.

---

## 8. Weekend / Holiday and Effective-Date Semantics

- **Preserve the provider `effective_date`.** Do **not** synthesize fake weekend/holiday rows.
- If the provider publishes **business-day rates only**, store **business-day dates only**.
- Reference lookup may use **latest `effective_date <= requested date`** (consistent with the existing
  booking fallback, F3).
- The UI must show the **actual effective date used** (so a weekend/holiday fallback is visible).
- The **scheduler run date must never be conflated** with the provider rate effective date; the
  provider's effective date is authoritative for the reference record.

---

## 9. Idempotency, Overlap, Partial Failure, and Retry Semantics

- **A. Duplicate execution.** Re-running the same company/provider/effective_date/pair yields **no
  duplicate Active rows** (versioned uniqueness), deterministically idempotent.
- **B. Overlap protection.** Use a **DB advisory lock** or a strong **Running-run lease/uniqueness
  guard**. Abandoned `Running` runs are recovered by a lease timeout: a stale `Running` past its lease
  is treated as failed and may be superseded by a fresh run (recorded in `fx_sync_runs`).
- **C. Partial failure.** Successful pairs remain recorded; failed pairs are recorded in the run summary;
  run status = **PartialFailure**; retry targets only failed/missing work; **no rollback** of successful
  unrelated pairs.
- **D. Manual retry.** Privileged only; idempotent; produces no duplicate Active rates.
- **E. Scheduler retry.** **Bounded** retries; bounded **timeout**; **backoff**; **rate-limit aware**;
  **no unbounded loops**.

---

## 10. Proposed Database Design (planning-level; NO migration in this task)

Locked to Option B. Final shape pending Codex review. `public` schema only; RLS on both tables.

### 10.1 `public.fx_sync_runs`

```
fx_sync_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  provider              text NOT NULL,
  source_host           text NOT NULL,
  effective_date        date NOT NULL,                 -- provider quote date (not run date)
  started_at            timestamptz NOT NULL,
  completed_at          timestamptz NULL,
  status                text NOT NULL,                 -- Running | Succeeded | PartialFailure | Failed
  attempted_pair_count  integer,
  succeeded_pair_count  integer,
  failed_pair_count     integer,
  error_category        text NULL,                     -- coarse, secret-free
  error_summary         text NULL,                     -- sanitized/bounded
  created_by            uuid NULL,                     -- actor for manual retry, where appropriate
  created_at            timestamptz NOT NULL DEFAULT now()
)
-- CHECK status IN ('Running','Succeeded','PartialFailure','Failed')
-- index (company_id, provider, effective_date DESC)
-- index (company_id, started_at DESC)
```

### 10.2 `public.fx_reference_rates`

```
fx_reference_rates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  base_currency      char(3) NOT NULL,                 -- see direction note below
  quote_currency     char(3) NOT NULL,
  rate               numeric(18,8) NOT NULL CHECK (rate > 0),
  effective_date     date NOT NULL,                    -- provider quote date
  provider           text NOT NULL,
  provider_rate_type text NULL,                        -- e.g. mid/close, where provided
  provider_timestamp timestamptz NULL,
  fetched_at         timestamptz NOT NULL,
  sync_run_id        uuid REFERENCES fx_sync_runs(id),
  status             text NOT NULL DEFAULT 'Active',   -- Active | Superseded
  supersedes_rate_id uuid NULL REFERENCES fx_reference_rates(id),
  created_at         timestamptz NOT NULL DEFAULT now()
)
-- CHECK status IN ('Active','Superseded')
-- Exactly one Active row per (company_id, quote_currency, base_currency, effective_date, provider)
--   (enforced via partial UNIQUE index WHERE status = 'Active')
-- index (company_id, quote_currency, base_currency, effective_date DESC)
```

**Pair-direction (must be explicit to avoid inversion bugs).** The existing `exchange_rates` direction is
**transaction/foreign currency → company base currency** (`from_currency → to_currency`, e.g. USD→MYR
means "1 USD = rate MYR"). `fx_reference_rates` **must document its direction unambiguously** and align
its interpretation to that same convention: `rate` expresses **how many units of `base_currency` equal
one unit of `quote_currency`** (i.e. `quote_currency` = foreign/transaction, `base_currency` = company
base), matching `from_currency=quote_currency`, `to_currency=base_currency`. The exact column
naming/semantics are to be finalized with Codex; **required pair-direction tests** (§16) must assert no
inversion. If provider payloads use the opposite convention, normalization must invert explicitly and be
unit-tested.

**Storage policy.** Store **normalized data + sanitized metadata only**; **do not** store raw provider
payloads by default (revisit only if a future audit requirement justifies it).

### 10.3 RLS

- Both tables: `ENABLE ROW LEVEL SECURITY`.
- **SELECT:** authenticated **company-scoped** read (`rls_has_company_access(company_id)`).
- **No client write** to either table.
- **Writes:** service-role/backend sync path only (the cron-guarded Edge Function via admin client, as
  `daily-overdue`).
- **Manual retry:** role-checked, via the Edge Function — **not** a broad client table grant.

---

## 11. Proposed Backend / API Design

### 11.1 `fx-rate-sync` Edge Function

- Purpose: cron/manual **privileged** sync; **mock provider mode** (9D-A) and real **provider adapter**
  (9D-B); normalization; validation; **sync-run lifecycle** (`Running → Succeeded/PartialFailure/Failed`);
  **reference-rate writes only**; **no financial DML**; **no `exchange_rates` writes in 9D-A**.
- Security: `CRON_SECRET` required in production; privileged **manual-retry role**; **fixed provider
  host** (no user-controlled URL, SSRF-safe); bounded timeout; bounded retries; response-size limits;
  strict schema validation; safe logging (counts/status/coarse category — never secrets).
- Modeled on `daily-overdue/index.ts` (`Deno.serve`, `X-Cron-Secret` vs `CRON_SECRET`, admin client,
  structured JSON result).

### 11.2 `fx-rates` read API (authenticated, company-scoped GET)

Dedicated routes (not hidden inside generic public lookups):

- latest reference rates;
- historical reference rate;
- reference-rate lookup for a requested date (latest `effective_date <=` date, with the actual effective
  date returned);
- sync **health/status** (last successful run, latest effective date, provider label, last failure
  category, staleness).

### 11.3 Future promotion path (Option C) — documented, NOT implemented

`fx_reference_rates` → controlled promotion into `exchange_rates`, as a **future, separately-approved**
gate requiring: explicit user/business approval; a restricted role/capability; a promotion reason; the
source rate; the source effective date; before/after values; an audit event; and **no retroactive booked
transaction mutation**. Out of scope for 9D-A.

---

## 12. Scheduler Architecture

- Reuse the existing operational scheduler pattern; the scheduler **calls the protected `fx-rate-sync`
  Edge Function**. `CRON_SECRET` mandatory in production. The service-role/admin client stays **inside**
  the backend sync path.
- **Timezone explicitly defined** and aligned with `daily-overdue` conventions; schedule timing must
  consider **provider publication timing** — do **not** assume midnight is correct. The **provider
  effective date (not the scheduler run date)** is authoritative for the reference record.
- Partial failure observable; manual retry safe/idempotent; overlap protected (§9).
- No scheduler is configured in this task, and none is committed to the repo (scheduling is an
  operational Supabase config step). **The exact real production schedule remains blocked by DG-1** and
  observed provider behavior.

---

## 13. Sub-Batch Structure (replaces the prior 2-part split)

> **`⚠ ORDERING SUPERSEDED BY §0 (Rev 2).`** The sub-batch *definitions* below remain valid, but the
> **dependency/execution ordering** stated at the end of this section (9D-C parallel/early, before DG-1
> and 9D-B) is **superseded** by the revised canonical order in **§0.2**:
> `9D-A (CLOSED) → DG-1 → 9D-B → 9D-C → 9D-D → 9D-E`. Also note **9D-A is now OFFICIALLY CLOSED** (§0.1).

- **9D-A — Provider-Neutral FX Reference Foundation.** Architecture lock; schema/RLS; provider adapter
  **interface**; deterministic **mock** provider; sync observability; reference-rate **read API**;
  validation/idempotency; **no real provider**; **no production schedule**; **no `exchange_rates` write**.
- **9D-B — Real Provider Integration and Scheduler Staging.** Provider selection completed (DG-1);
  real provider adapter; staging credentials; fixed provider host; staging sync; retry/rate-limit
  behavior; correction behavior; scheduler/manual-trigger staging tests.
- **9D-C — Booking Rate Provenance and Override Governance.** Role/capability; override reason;
  provenance; audit; import FX handling; draft-update restrictions; **no posted snapshot mutation**.
- **9D-D — Multi-Currency UX and Monetary Aggregation Correctness.** Remove hard-coded `MYR`; dynamic
  company base currency; **booked vs. reference** distinction; original amount; booked rate; booked base
  amount; latest/reference rate; latest/reference converted amount; stale/missing states; report/
  dashboard endpoint classification (§5); **fix mixed-currency invalid totals**; preserve authoritative
  booked base accounting semantics.
- **9D-E — Production Rollout and Verification.** Production schema/API deployment; provider secret
  configuration **only after approval**; scheduler activation **only after approval**; optional first
  production sync as a **separate explicit mutation gate**; post-sync **read-only** verification; no
  accidental financial mutation.

Dependency order: 9D-A → (9D-C can proceed in parallel, governance-only) → 9D-B (needs DG-1) → 9D-D
(needs 9D-A read API) → 9D-E (needs all prior + approvals). **[SUPERSEDED — see §0.2. Current canonical
order: `9D-A (CLOSED) → DG-1 → 9D-B → 9D-C → 9D-D → 9D-E`.]**

---

## 14. Multi-Currency UX Design (9D-D)

Five values must **never be conflated**: **A** original transaction amount · **B** booked exchange rate ·
**C** booked base amount · **D** latest/reference rate · **E** latest/reference converted amount. Base
label derives from **company context**, never a hard-coded `"MYR"` (fixes F11).

| Surface | Requirements |
| --- | --- |
| **Invoice List** | Transaction currency/code; original outstanding; optionally booked-base outstanding **only where backend provides authoritative base-outstanding semantics** (not a client-side reference multiply). |
| **Invoice Detail** | Original total (A); booked rate (B); booked base total (C); booked-rate **provenance**; latest/reference rate (D) only in a **separate, clearly-labelled informational** section. |
| **Invoice Create** | Dynamic company base currency; resolved **booking-rate preview**; override controls **only for authorized roles**; override **reason/provenance** (9D-C). |
| **Invoice Import** | Explicit FX field handling; **no silent authoritative override**; review/provenance (9D-C). |
| **Receipt List** | Transaction currency; original receipt amount; base amount **only where authoritative**. |
| **Receipt Detail** | Booked rate (B); booked base amount (C); provenance; separate optional reference-rate informational view. |
| **Receipt Create / Import** | Same governance as invoice. |
| **Dashboard** | Use **only** mathematically valid base-normalized metrics **or** explicitly grouped-by-currency values (§5). |
| **Reports** | **Correct** mixed-currency invalid aggregation; do **not** use latest reference rate to rewrite historical accounting values. |
| **Settings** | Daily FX Sync status; last successful sync; latest effective rate date; provider/source label; stale/failure state; next scheduled run **only if operationally reliable**; **no provider secrets**. |

## 15. Error / Missing / Stale Rate UX

- **Missing rate** at create/import → clear "no FX rate for `CCY→BASE` on `date`" state (mirrors the
  backend `ValidationError`, F4), not a raw 500.
- **Stale rate** → badge with the actual effective date + source when latest effective date exceeds a
  configurable threshold.
- **Fallback provenance** → show the actual effective date used when a prior-business-day rate is applied.
- **Sync failure** → Settings/admin shows last failure category + last successful sync; never secrets.

---

## 16. Testing Strategy (expanded)

**Unit:** provider normalization; **pair direction**; **inversion handling/rejection**; decimal
precision; **zero/negative rate rejection**; **unsupported/malformed currency**; malformed payload;
duplicate sync idempotency; stale-state calculation; fallback-date logic; **historical
correction/versioning**; sanitized error handling; **provider timestamp/effective-date validation**.

**Integration:** tenant isolation; authenticated read; privileged sync write; **no client table write**;
duplicate scheduler call; **overlap protection**; **abandoned-Running recovery**; partial provider
failure; retry; historical preservation; **transaction booking unaffected by reference-rate changes**;
**no `exchange_rates` write during reference sync**; **no financial-table mutation**.

**9D-C:** Invoice Create override; Receipt Create override; Invoice Draft Update override; Invoice Import
FX override; Receipt Import FX override; role rejection; reason required; provenance recorded; **posted
snapshot immutable**.

**9D-D:** mixed-currency dataset; base-normalized totals; grouped-by-currency alternatives; **no
cross-currency raw addition**; dashboard regression; Aging Summary regression; Aging by Customer
regression; invoice/receipt UI currency display (A–E distinction).

**Staging smoke (`gcdsdyegwjdcskpukqlq`):** controlled **mock/provider fixture** first; **no real
customer documents**; **no protected financial mutation**; verify current/stale/missing reference states;
verify idempotent rerun; verify correction behavior; verify partial failure; verify reports/dashboard
correctness; verify `/allocations/auto` still 403.

**Production (`kusseuycqgdilychphpq`):** production schema/API deployment first; provider secret
configuration separately approved; **first real sync separately approved**; post-sync **read-only**
verification; scheduler activation separately approved.

---

## 17. Explicit Non-Goals

Out of scope for Batch 9D (must not be added/altered): the mandatory invariants in §4.2; automatic FX
gain/loss beyond the existing allocation-time realized path (which must remain **untouched**); unrealized
FX / month-end revaluation / remeasurement; changing stored booked rates after posting; automatic
financial posting from sync; direct protected-balance mutation or financial-RPC bypass; client-side
provider calls; frontend provider API keys (`NEXT_PUBLIC` secrets); **any `exchange_rates` write or
auto-promotion in 9D-A** (Option C is future-only); using latest/reference rates to rewrite accounting
report totals.

## 18. Provider Decision Gate (before 9D-B)

> **Rev 2 update:** a **proposed** DG-1 decision now exists in **§0.3** — **Frankfurter v2** transport
> with mandatory explicit provider pinning, **initial provider `MAS`**, no API key expected,
> reference-only destination. It is **PROPOSED pending Codex review and user approval — not locked, not
> implemented, and no provider API is called.** The evaluation criteria below still apply to that
> decision.

**DG-1 remains a dedicated gate before 9D-B.** No provider is selected in this amendment, and **no
provider API is called.**

- **Blocking for:** real provider integration, external host, real external calls, credentials,
  real-provider adapter, provider-specific retry, cron/scheduled real sync, production provider setup and
  production scheduling.
- **Not blocking (may proceed after Codex amendment confirmation + explicit user implementation
  approval):** schema, RLS, provider adapter **interface**, deterministic mock/fixture provider,
  normalization, validation, read API, sync observability, tests (i.e. all of 9D-A).

**Evaluation criteria:** reliability/uptime; currency coverage vs. confirmed base + in-use currencies;
SGD/MYR relevance; update frequency (daily); **historical dated rates**; licensing/terms suitability;
auth model; rate limits; **fixed documentable host** (SSRF-safe); source transparency; staging/testing
practicality (mockable, deterministic).

**Repository currency exposure (grounded):** constants map MY→**MYR**, SG→**SGD**, US→**USD**, GB→**GBP**
(`_shared/constants.ts:95-98`); seed exercises **MYR/SGD/USD** (`003:231-239`); currency validation
accepts **any** ISO-4217 code (no allowlist, `_shared/validators.ts:159`). Codex candidate coverage set
for provider evaluation: **MYR, SGD, USD, EUR, GBP, CNY** (EUR/CNY are prospective — not yet evidenced in
seed/constants). Provider must cover the confirmed base plus all currencies actually in use.

## 19. Risks and Open Decisions

| ID | Risk / Decision | Disposition |
| --- | --- | --- |
| DG-1 | FX provider not selectable from repo evidence. | **Gate** before 9D-B; 9D-A (mock) may proceed after approval. |
| DG-2 | Reference-only vs. authoritative promotion. | **Locked Option B** for 9D-A; Option C future-only. |
| R1 | Mixed-currency raw sums in older views/aliases/reports (§5, class 4). | 9D-D **corrects or groups by currency**; no masking. |
| R2 | Client/import `exchange_rate` override, no governance (F5, F14). | 9D-C governance (role/reason/provenance/audit). |
| R3 | Base currency ambiguity (MYR demo, SGD staging fixture, SG framing). | Confirm real base + in-use currencies; do not infer SGD. |
| R4 | Pair-direction inversion risk in new table. | Explicit direction spec + mandatory inversion tests (§10.2, §16). |
| R5 | Provider mid-market rate ≠ acceptable booking rate. | Reinforces Option B; promotion is future, human-gated. |
| R6 | Scheduler is operational (not in-repo). | Capture scheduler config as evidence at 9D-B/9D-E. |

## 20. Implementation Sequence

> **`⚠ SUPERSEDED BY §0.2 / §0.11 (Rev 2).`** The gate flow below reflects the Rev 1 ordering (9D-C
> before DG-1/9D-B) and is retained for history. **9D-A is now CLOSED.** The current canonical order and
> gate discipline are in **§0.2** and **§0.11**:
> `9D-A (CLOSED) → DG-1 → 9D-B → 9D-C → 9D-D → 9D-E`.

Gate flow: **Codex confirms this amendment → user implementation approval →** 9D-A (provider-neutral) →
9D-C (governance, parallelizable) → **DG-1 →** 9D-B (real provider + staging scheduler) → 9D-D (UX +
aggregation correctness) → **approvals →** 9D-E (production rollout, first sync as a separate mutation
gate). Each backend step is Codex-led; UX (9D-D) is Claude-led; each transitions on green evidence.

## 21. Acceptance Criteria (expanded)

**Foundation / sync (9D-A, 9D-B):** pair-direction correctness; **no inverted-rate bug**; zero/negative
rate rejection; unsupported-currency rejection; malformed-provider-response handling; provider
timestamp/effective-date validation; duplicate scheduler execution idempotency; overlap protection;
abandoned-Running recovery; partial-pair failure handling; safe retry; historical correction behavior;
**only one Active reference version per intended key**; weekend/holiday fallback with **actual effective
date displayed**; **reference correction does not alter booked transactions**; **no write to
`exchange_rates` in 9D-A**; no protected financial DML; no allocation/journal creation from sync; tenant
isolation; **no frontend provider call**; **no client provider secret**.

**Governance (9D-C):** override role enforcement; override reason required; override provenance recorded;
import override governance; posted snapshot immutability.

**UX / aggregation (9D-D):** report aggregation correctness (class-4 items fixed or grouped);
booked-vs-reference UX distinction (A–E); dynamic base currency (no hard-coded `MYR`).

**Overall:** existing invoice/receipt/posting/allocation/realized-FX behavior unchanged; `public` schema
only; no `ar.*`; Settings "Daily FX Sync" flips to **Live** only after a verified production sync.

## 22. Rollback Strategy (expanded)

- **Provider outage:** sync failure only; last known valid reference rates retained; stale state shown;
  **no booking transaction mutation**.
- **Bad rate ingestion:** disable scheduler/provider adapter; **supersede** the bad reference row via
  controlled versioned correction; preserve audit history; booked snapshots unaffected.
- **Inverted pair:** stop ingestion; reject normalization; correct reference data via versioned
  correction; **never** auto-rewrite booked transactions.
- **Wrong effective date:** versioned correction; preserve prior row history; **no fake date rewrite**.
- **Partial sync:** retain successful pairs; retry failed pairs idempotently.
- **Migration rollback:** follow repository migration policy; **no destructive rollback** if reference
  data is already operationally required without explicit review.
- **Frontend rollback:** reference-rate panels can be disabled independently; **booked accounting
  displays remain**.
- **Scheduler rollback:** disable the schedule first; keep read API/data available; **no impact to the
  existing `exchange_rates` booking path**.

---

## Appendix A — Evidence pointers (read-only)

- Schema/views: `001_create_tables.sql` (companies `:40`/`:46`, exchange_rates `:248`, invoices `:509`,
  receipts `:665`), `002_create_views.sql` (`v_aging_by_customer` `:355`, `v_customer_ar_summary` `:377`),
  `003_seed_data.sql:231`, `006_rls_policies.sql:251-316`, `007_financial_rpcs.sql:243,650,833-937`,
  `007c_api_staging_fixtures.sql:143-408`, `014_live_dashboard_metrics.sql:121-336,460-477`.
- Backend: `invoices/service.ts:127,636,768`, `invoices/validators.ts:98`, `receipts/service.ts:89,500`,
  `reports/service.ts:218,303`, `imports/service.ts` (no FX handling), `daily-overdue/index.ts:9-15,48-52`,
  `_shared/constants.ts:95-98`, `_shared/validators.ts:159`.
- Frontend: `lib/utils.ts:12-28`, `app/(dashboard)/invoices/[id]/page.tsx:204,308-311`,
  `stores/company-store.ts:29`.

## Appendix B — Scope boundary (one line)

Batch 9D delivers **provider-neutral daily FX reference-rate infrastructure, booking-rate override
governance, and multi-currency visibility + aggregation correctness**; it is **not** an FX revaluation
engine, it does **not** change any booked rate or existing FX accounting, and in 9D-A it does **not**
write `exchange_rates` or auto-promote reference rates.
