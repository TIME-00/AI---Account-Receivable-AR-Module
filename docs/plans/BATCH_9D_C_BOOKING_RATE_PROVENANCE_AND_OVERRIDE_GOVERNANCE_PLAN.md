# Batch 9D-C — Booking Rate Provenance and Override Governance — Detailed Implementation Plan

- **Batch:** 9D-C — Booking Rate Provenance and Override Governance.
- **Type:** Detailed, implementation-ready sub-plan (planning/documentation only; **no** code, migration, deployment, provider call, scheduler change, or data mutation in this task).
- **Author:** Claude Code (discovery + implementation plan).
- **Parent plan:** `docs/plans/BATCH_9D_DAILY_FX_RATE_SYNC_AND_MULTI_CURRENCY_UX_PLAN.md` (authoritative phase/order document).
- **Baseline commit at authoring:** `5c3a3d7302407f2d87edd5e3a25eaef1bed57266` (`docs(plan): align Batch 9D-B closure status`; `HEAD == origin/main`, clean tree).

---

## 1. Status / Gate

> **Predecessors:** Batch **9D-A OFFICIALLY CLOSED**; DG-1 **FORMALLY APPROVED AND LOCKED**; Batch **9D-B
> OFFICIALLY CLOSED** (Codex Closure Re-Review: `PASS - OFFICIAL CLOSURE`). Batch **9D-C** is the next
> batch in the canonical order `9D-A (CLOSED) -> DG-1 -> 9D-B (CLOSED) -> 9D-C -> 9D-D -> 9D-E`.

- **Current state:** Batch 9D-C is in **detailed implementation planning / plan amendment** only. Nothing
  is implemented, no migration is created, no Edge Function/frontend is changed, and no staging/production
  is mutated by this task. The Codex Batch 9D-C Plan Second Review returned `AMENDMENT REQUIRED — RETURN TO
  CLAUDE CODE`; this revision applies the required amendments (see §1A).
- **Next gate:** **Codex Batch 9D-C Plan Amendment Confirmation Review** -> user implementation approval ->
  implementation -> technical review -> staging readiness -> explicit staging approval -> staging
  deployment -> runtime verification -> evidence -> closure review. **Implementation approval has NOT been
  granted; 9D-C implementation has NOT started.**
- **Planning-only banner.** No booking-rate logic, migration, RPC, Edge Function, or frontend was changed
  while producing/amending this plan; no posted financial record was touched; the ACTIVE Batch 9D-B
  staging scheduler was not modified; production was not touched. `POST /allocations/auto` remains
  `AUTO_ALLOCATION_DISABLED`.

---

## 1A. Codex Batch 9D-C Plan Second Review — Amendment Resolutions (recorded)

**Verdict:** `AMENDMENT REQUIRED — RETURN TO CLAUDE CODE`. All eight blocking findings are resolved in
this revision as summarized below and detailed in the referenced sections. No locked architectural
boundary (§5) is changed.

| Finding | Resolution summary | Sections |
| --- | --- | --- |
| **B9DC-001** Master-plan status consistency | Stale "9D-B closure pending / 9D-C not started" wording in master §0.3/§0.4/§18 corrected to `9D-B OFFICIALLY CLOSED` and `9D-C detailed implementation planning / plan amendment`; next gate = Codex Batch 9D-C Plan Amendment Confirmation Review. | master §0.0/§0.3/§0.4/§0.6/§18 |
| **B9DC-002** Truthful historical provenance | Blanket historical `CATALOG` backfill removed. Deterministic same-currency-to-base rows -> `BASE_PARITY`; unprovable historical foreign-currency rows -> `LEGACY_UNVERIFIED` (snapshot preserved; no recompute; no re-resolve; no catalog link on numeric match; source FKs null). | §10, §11, §11A, §24, §31, §34 |
| **B9DC-003** DB-level posted FX immutability | Corrected the "already immutable" claim; require a narrowly scoped DB-level `BEFORE UPDATE` immutability trigger blocking protected FX/governance fields once `status` is non-Draft; txn-date protection decision documented. | §3.3, §4, §17, §17A, §28, §31, §33, §34 |
| **B9DC-004** Transaction-safe post-time authorization | Check-then-post across a separate Edge Function boundary is explicitly rejected (TOCTOU). Authoritative governance verification runs **inside** the `post_invoice`/`post_receipt` transaction after a row lock; `fx_assert_booking_decision_postable` is an internal in-transaction helper and/or non-authoritative preflight only. | §25, §28, §28A |
| **B9DC-005** Remove new posted-FX correction mutation from scope | Prevention/immutability/audit kept; any **new** reverse-and-repost / compensating FX adjustment / post-allocation FX correction mutation is **DEFERRED** to a separate, reviewed, approved batch. Posted rate correction attempts are rejected in 9D-C. | §7, §17, §26, §34, §37, §39 |
| **B9DC-006** Lock initial authorization defaults | Deviation bands, stale threshold (7 days), source/default policy (`PROMOTED_CATALOG` OFF), and import/unattended auto-post defaults locked as **initial configurable technical defaults** (not final client accounting policy). | §9, §14, §10, §21, §22 |
| **B9DC-007** Explicit append-only governance audit design | Do not rely on `005` for coverage. Add append-only `fx_booking_rate_decision_events`; explicit event set; append-only enforcement via mutation-prevention triggers + privilege revocation + RLS; reconstruction tests. | §29, §24, §31, §32, §34 |
| **B9DC-008** Strong referential integrity | Polymorphic `source_record_id` replaced by explicit nullable `exchange_rate_id` + `fx_reference_rate_id` with per-source-category CHECK; polymorphic `transaction_type/id` replaced by nullable `invoice_id` + `receipt_id` with exactly-one CHECK; cross-company / mismatch / wrong-`to_currency` protections. | §11, §11A, §24, §31, §32 |

---

## 2. Executive Summary

Today the AR module already snapshots a booking exchange rate onto each invoice and receipt at
create/edit time and uses that snapshot immutably at posting. However, the **manual override path is
ungoverned** (any caller may pass an arbitrary `exchange_rate` with no reason, no approval, and no
provenance) and there is **no recorded provenance** explaining where a booked rate came from (curated
catalog, reference provider, or human override), who chose it, why, and whether it was approved.

Batch 9D-C introduces a **governance layer** between the FX reference layer (9D-A/9D-B,
`public.fx_reference_rates`), the curated booking catalog (`public.exchange_rates`), and the
**immutable transaction booked snapshot** (`invoices.exchange_rate` / `receipts.exchange_rate`). It adds:
(a) an explicit **booking-rate source model** with priority and eligibility; (b) a **normalized
booking-rate decision + provenance record** per transaction; (c) **maker-checker override governance**
with deviation thresholds; (d) **post-posting correction via governed reversal/adjustment** (never
in-place mutation); and (e) audit events reusing existing append-only audit infrastructure.

**9D-C does not** automatically promote reference rates into booking rates, does not mutate posted
snapshots, does not change realized-FX math, and does not roll anything out to production (9D-E).

---

## 3. Current-System Discovery (verified from source)

All findings below were read directly from the repository at the baseline commit. File/line references are
indicative anchors for the implementation team.

### 3.1 Where `public.exchange_rates` is defined and read

- **Definition** (`database/001_create_tables.sql:246-265`): columns `id, company_id, from_currency
  CHAR(3), to_currency CHAR(3), rate, effective_date, created_by, created_at`; `UNIQUE (company_id,
  from_currency, to_currency, effective_date)`; `CHECK (rate > 0)`; lookup index on `(company_id,
  from_currency, to_currency, effective_date DESC)`. Table comment: *"Finance Manager maintains daily;
  invoice posting takes the rate from this table (BR-INV-007)."*
- **Read at transaction creation** (`backend/supabase/functions/invoices/service.ts:764-798`,
  `backend/supabase/functions/receipts/service.ts:503-527`) via `resolveExchangeRate(companyId, currency,
  date)`:
  - if `company.base_currency === currency` -> returns `1.0`;
  - else selects `rate` from `exchange_rates` where `from_currency = currency`, `to_currency = base`,
    `effective_date <= txn_date`, ordered by `effective_date DESC`, limit 1;
  - if none found -> throws `ValidationError` ("Exchange rate not found ... Please maintain the exchange
    rate table.").
- **Other reads:** reporting views (`database/002_create_views.sql`), live dashboard metrics
  (`database/014_live_dashboard_metrics.sql`), staging/production fixtures (`007c`, `007d`). These are
  read-only reporting/fixtures.

### 3.2 How the invoice/receipt booking rate is selected

- **Invoice** (`invoices/service.ts:125-146`): `const exchangeRate = data.exchange_rate ??
  resolveExchangeRate(...)`. A caller-supplied `data.exchange_rate` is used **verbatim** (this is the
  current *de facto* manual override); otherwise the catalog lookup applies. The invoice header stores
  `currency`, `exchange_rate`, `base_currency` (= company base), and `base_total` (recalculated as
  `total_amount * exchange_rate`).
- **Invoice edit** (`invoices/service.ts:636`, `368/393`): `data.exchange_rate` can be updated directly on
  a draft; totals recalculated from the row's `exchange_rate`.
- **Receipt** (`receipts/service.ts:87-111`): identical pattern; stores `exchange_rate`, `base_currency`,
  and `base_amount` (= `receipt_amount * exchange_rate`).

### 3.3 How booked rates are snapshotted and used at posting

- **Snapshot fields** (`001_create_tables.sql`): `invoices.exchange_rate DECIMAL(12,6) DEFAULT 1.000000`,
  `invoices.base_currency`, `invoices.base_total` (`CHECK exchange_rate > 0`); `receipts.exchange_rate`,
  `receipts.base_currency`, `receipts.base_amount` (`CHECK > 0`); `journal_entries.currency,
  exchange_rate, base_currency`.
- **Posting** (`database/007_financial_rpcs.sql`): `post_invoice` computes `v_base_total =
  ROUND(v_total_amount * v_inv.exchange_rate, 2)` and writes journal lines using **the invoice row's own
  `exchange_rate`** (not a fresh lookup). `post_receipt` likewise uses `v_rct.exchange_rate`. **Accurate
  current condition (B9DC-003):** later `exchange_rates` catalog edits and `fx_reference_rates`
  corrections **do not automatically mutate** posted snapshots (posting does not re-read them), and
  service-layer draft guards exist — **but full DB-level posted-FX immutability is not yet sufficiently
  enforced.** A direct/authenticated or service-path UPDATE to a posted row's FX fields is not currently
  blocked at the database layer. 9D-C must add DB-level enforcement (§17A).

### 3.4 Allocation / realized FX

- **Realized FX** (`007_financial_rpcs.sql:843`): `v_forex := ROUND(v_alloc_amt * (v_rct.exchange_rate -
  v_inv.exchange_rate), 2)` — realized gain/loss = allocation amount x (receipt booked rate - invoice
  booked rate).
- **Same-currency rule** (`allocations/service.ts:196-205, 436-438`): allocation candidates are filtered
  to the **receipt currency**; allocation runs within a single transaction currency, but invoice and
  receipt may carry different booked rates (that difference is the realized FX).
- **Cheque clearance / reversal** (`receipts/service.ts:240-243`): clearance and reversal journals reuse
  the stored `receipt.exchange_rate` / `receipt.base_currency`.

### 3.5 Existing provenance / override / audit state

- **Provenance persisted today:** only the numeric `exchange_rate` + `base_currency` snapshot. There is
  **no** source category, no provider link, no "selected by", no reason, and no approval status.
- **Override validation today:** only the DB `CHECK (exchange_rate > 0)` and positive-number validation in
  the service validators. No role gating, no reason, no deviation check, no approval.
- **Audit infrastructure exists** (`database/005_audit_triggers.sql`): an append-only changelog with
  `fn_prevent_audit_log_modification()` triggers that reject UPDATE/DELETE on audit rows. 9D-C should
  reuse this pattern rather than invent a new audit store.

### 3.6 Roles (verified)

`backend/supabase/functions/_shared/auth.ts` + `constants.ts`: role hierarchy **Finance Manager >
AR Supervisor > AR Clerk > System Admin > Auditor**. `requireOperationalRole` = {AR Clerk, AR Supervisor,
Finance Manager} (System Admin is config-only; Auditor is read-only). `requireOperationalReadRole` adds
Auditor. Company scope enforced via `extractCompanyId` (UUID-validated) + `getAuthContext`; RLS uses
`rls_has_company_access`.

---

## 4. Existing Booking-Rate Behavior (summary invariants to preserve)

1. Booking rate is chosen at **create/edit** and snapshotted on the transaction row.
2. Posting reads the **row snapshot**, not a fresh catalog lookup -> later catalog/reference changes do
   **not** automatically mutate posted rows. (Full DB-level immutability against direct/service UPDATE is
   **not** yet enforced and is added by 9D-C, §17A.)
3. `resolveExchangeRate` = latest curated `exchange_rates` with `effective_date <= txn_date`, direction
   `currency -> base`, `1.0` when currency == base, hard error when missing.
4. A caller-supplied rate silently overrides the catalog lookup (the ungoverned override to be governed).
5. Realized FX = `alloc x (receipt_rate - invoice_rate)`; allocation is same-currency.
6. `exchange_rates` is a curated **catalog** (FM-maintained), unique per `(company, from, to,
   effective_date)`.

**9D-C must not break invariants 1-3, 5, 6, and must convert invariant 4 into a governed path without
changing the numeric posting/realized-FX math.**

---

## 5. Locked Architectural Boundaries

```text
Layer 1  Reference        public.fx_reference_rates   (provider/reference data; corrections/versioning;
                                                        NOT accounting-authoritative by itself)
Layer 2  Booking decision governed selection/override + provenance + approval (NEW in 9D-C)
Layer 3  Transaction      invoices.exchange_rate / receipts.exchange_rate  (immutable booked snapshot)
         snapshot
   plus  Booking catalog  public.exchange_rates       (existing curated FM catalog; a Layer-2 source)
```

Prohibited (carried from DG-1/DG-2 and reaffirmed):
- silent reference-to-booking promotion;
- silent automatic linkage of reference to a transaction;
- retroactive mutation of posted booked snapshots;
- implicit provider substitution / silent inversion / reciprocal;
- any financial mutation triggered by provider/reference sync;
- collapsing Layers 1/2/3 into one another.

---

## 6. Problem Statement

The booked rate is snapshotted but its **origin and authorization are invisible and ungoverned**. A user
(or import) can set any positive rate with no reason, no approval, and no record of whether it matched the
curated catalog or an approved reference rate. This is an audit and financial-control gap: realized FX,
base totals, and journals all depend on a rate whose provenance cannot be explained or challenged.

---

## 7. Goals

1. Explicit, prioritized **booking-rate source model** (catalog / reference / manual override).
2. Per-transaction **booking-rate decision + provenance** record (auditable, immutable once posted).
3. **Maker-checker override governance** with role gating, mandatory reason, and deviation thresholds.
4. **Reference-rate suggestion** surfaced to users (read-only) without automatic promotion.
5. **DB-level posted-FX immutability** (§17A) and the rule that posted snapshots are never mutated in
   place; **any new correction-mutation workflow is deferred** to a separate approved batch (B9DC-005).
6. Full **append-only governance audit trail** via a dedicated event table (§29), not reliance on `005`.
7. **Zero regression** to posting, allocation, realized FX, reversal, and bounced-cheque behavior.
8. Company-scoped **RLS** and backend-controlled (service-role RPC) mutation only.
9. **Strong referential integrity** for provenance (explicit FKs + CHECKs; no weak polymorphic columns).

---

## 8. Non-Goals

- No automatic promotion of reference rates into `exchange_rates` or into a transaction (unless a future,
  explicitly approved governed action).
- No change to the realized-FX formula or same-currency allocation rule.
- No production rollout, migration, provider deploy, scheduler change, or Vault change (that is 9D-E).
- No multi-currency UX aggregation redesign (that is 9D-D).
- No new provider integration (9D-B is closed).
- No retroactive rewrite of historical posted snapshots; no fabricated historical provenance.
- **No new posted-FX correction-mutation workflow** (reverse-and-repost / compensating FX adjustment /
  post-allocation FX correction) — deferred to a separate reviewed, approved batch (B9DC-005).
- No enabling of `POST /allocations/auto` (stays `AUTO_ALLOCATION_DISABLED`).

---

## 9. Locked Initial Authorization Defaults (B9DC-006)

To keep 9D-C implementation planning unblocked, the following are **locked as initial technical
implementation defaults**. They are **configuration-driven** (stored company-scoped, see §14) and are
**explicitly not claimed to be final client-approved accounting policy**; a future reviewed business-policy
change may adjust the configured values without re-architecting. Production rollout of any values remains
owned by Batch 9D-E.

1. **Source priority:** `BASE_PARITY` > `CATALOG` > user-initiated `REFERENCE_SELECTED` /
   `MANUAL_OVERRIDE`. Curated catalog is the authoritative governed booking source where eligible;
   reference is suggestion + explicit governed selection only; **never auto-selected**. **LOCKED (default).**
2. **Deviation bands** (absolute % from the governance baseline): Informational `<= 0.50%`; Minor
   `> 0.50%` and `<= 2.00%`; Major `> 2.00%` and `<= 5.00%`; Blocked `> 5.00%`. See §14. **LOCKED (default).**
3. **Stale-reference threshold:** `7 calendar days`; a reference older than this is stale and cannot
   silently authorize booking or posting. **LOCKED (default).**
4. **Approver roles:** Minor -> AR Supervisor (or higher); Major -> Finance Manager; maker-checker
   mandatory (the maker cannot approve their own decision); System Admin is **not** a financial approver
   merely due to administrative access; Auditor is read-only. **LOCKED (default).**
5. **Import / unattended auto-post:** may proceed only when ALL of {`source_category in
   {BASE_PARITY, CATALOG}`, decision valid, `approval_status = NotRequired`, no stale condition, no missing
   baseline, no pending approval, no rejection, no decision-version mismatch}. All other conditions HOLD
   (never auto-post). See §21/§22. **LOCKED (default).**
6. **`PROMOTED_CATALOG`:** behavior **OFF / not implemented in 9D-C**. No scheduler or sync process may
   select or promote a rate automatically. **LOCKED (default).**

*(These defaults are configurable for future reviewed business-policy changes; they are safe initial
values, not a claim of final accounting sign-off.)*

---

## 10. Booking Source Model

Each transaction's booked rate must originate from exactly one **source category**, recorded in
provenance:

| Source category | Origin | Eligibility | Approval | Source FKs (B9DC-008) |
| --- | --- | --- | --- | --- |
| `BASE_PARITY` | currency == base (rate = 1.0, deterministic) | always | none | both null |
| `CATALOG` | `public.exchange_rates` via `resolveExchangeRate` | catalog entry exists for `currency->base`, `effective_date <= txn_date` | none (curated) | `exchange_rate_id` required; `fx_reference_rate_id` null |
| `REFERENCE_SELECTED` | Active `fx_reference_rates` chosen through governed selection | §15 eligibility passes; user explicitly selects | required if it deviates beyond band (§14) | `fx_reference_rate_id` required; `exchange_rate_id` null |
| `MANUAL_OVERRIDE` | user-entered rate | operational role; mandatory reason | required per deviation band (§14); maker-checker | both null; baseline reference recorded as provenance context only |
| `LEGACY_UNVERIFIED` | historical foreign-currency row predating governance where the source path is unprovable | backfill only (§11A) | none (historical) | both null |
| `PROMOTED_CATALOG` | reference promoted into `exchange_rates` by FM | **OFF / not implemented in 9D-C** | n/a | n/a |

**Priority (default, LOCKED §9):** `BASE_PARITY` > `CATALOG` > (user-initiated) `REFERENCE_SELECTED` /
`MANUAL_OVERRIDE`. Reference is **never** auto-selected; it is suggested and may be selected by a user
subject to governance. `LEGACY_UNVERIFIED` is a **backfill-only** category (never chosen for a new
decision). `PROMOTED_CATALOG` is **off** in 9D-C; no scheduler/sync process may auto-select or auto-promote
any rate.

### Architecture option decision (A/B/C/D)

- **A. Suggestion only** — reference shown, catalog still the only booked source. Safe but limited.
- **B. Controlled selection from reference layer** — user may select an eligible reference rate into the
  transaction snapshot under governance.
- **C. Approved promotion into booking source** — reference promoted into `exchange_rates`.
- **D. Other.**

**Recommendation: A + B (suggestion baseline plus governed selection into the transaction snapshot),
with C available only as an optional, FM-only, off-by-default governed action.** Rationale: preserves the
curated catalog as the authoritative Layer-2 source, keeps `exchange_rates` backward compatible, gives
users a governed way to use approved reference data on a specific transaction, and never performs silent
or automatic promotion. Tradeoffs: (A) alone under-delivers governance value; (C) as default risks
polluting the curated catalog and blurring Layers 1/2; (B) localizes the decision to the transaction with
full provenance and immutability.

---

## 11. Provenance Model

Minimum provenance fields on `fx_booking_rate_decisions` (§24). **Referential integrity is explicit
(B9DC-008): no weak polymorphic columns.**

- **Transaction ownership (exactly one):** `invoice_id UUID` nullable FK -> `invoices(id)`, `receipt_id
  UUID` nullable FK -> `receipts(id)`, with a CHECK enforcing **exactly one** is non-null. (Replaces the
  weak `transaction_type`/`transaction_id` pair.)
- **Source identity (per category):** `exchange_rate_id UUID` nullable FK -> `exchange_rates(id)`,
  `fx_reference_rate_id UUID` nullable FK -> `fx_reference_rates(id)`, governed by a CHECK tied to
  `source_category`: `CATALOG` -> `exchange_rate_id` NOT NULL and `fx_reference_rate_id` NULL;
  `REFERENCE_SELECTED` -> `fx_reference_rate_id` NOT NULL and `exchange_rate_id` NULL; `BASE_PARITY`,
  `MANUAL_OVERRIDE`, `LEGACY_UNVERIFIED` -> both NULL. (Replaces the weak polymorphic `source_record_id`.)
- **Core provenance:** `company_id`, `from_currency`, `to_currency`, `transaction_date`, `booked_rate`
  (final), `source_category` (§10), `baseline_rate` + `baseline_kind` (catalog/reference/none, provenance
  context for `MANUAL_OVERRIDE`), `suggested_rate`, `deviation_pct`.
- **Reference provenance (when reference-derived):** `provider`, `provider_effective_date`,
  `reference_fetched_at` (mirrored from the referenced `fx_reference_rates` row; the FK is authoritative).
- **Governance/lifecycle:** `selected_by`, `selected_at`, `override_reason`, `approval_status`
  (`NotRequired`|`Pending`|`Approved`|`Rejected`), `approved_by`, `approved_at`, `maker_user_id`,
  `checker_user_id`, `decision_version` (optimistic concurrency), `status`
  (`Draft`->`Pending`->`Approved`/`Rejected`->`Superseded`/`Posted`), `posted` + `posted_at`.

**Integrity protections (trigger/CHECK/FK-enforced, B9DC-008):** the referenced `exchange_rate`/
`fx_reference_rate` must belong to the **same company**; the source currency pair must match the
decision's `from_currency`/`to_currency`; a reference source's `to_currency` must equal the **company base
currency**; a decision's `invoice_id`/`receipt_id` must belong to the same company; an invoice decision
cannot attach to a receipt (and vice-versa); a decision cannot attach to a different transaction after
creation.

Placement (see §24): the **immutable numeric snapshot** stays on `invoices`/`receipts` (`exchange_rate`,
`base_currency`, `base_total`/`base_amount` — unchanged); the transaction carries two display pointers
`fx_source_category` and `fx_decision_id` (the **current/final** decision for the booked snapshot); the
**full governance/provenance history** lives in `fx_booking_rate_decisions` + the append-only event table
(§29). `fx_decision_id` changes only while the transaction is Draft.

---

## 11A. Truthful Historical Provenance / Backfill (B9DC-002)

The pre-governance code allowed the booked rate to come from **either** a caller-supplied `exchange_rate`
**or** the catalog `resolveExchangeRate` lookup, and the stored numeric snapshot **does not prove which
path produced it**. Therefore the backfill must be deterministic and truthful — it **must not** label
historical foreign-currency rows as `CATALOG`.

Locked backfill rules:

- **`BASE_PARITY`** — where the transaction currency equals the company base currency and the booked rate
  is deterministically `1.0`: set `source_category = BASE_PARITY`; both source FKs null.
- **`LEGACY_UNVERIFIED`** — every historical foreign-currency transaction whose source path cannot be
  independently proven: set `source_category = LEGACY_UNVERIFIED`. For these rows:
  - preserve the existing numeric booked snapshot **unchanged**;
  - **do not** recompute the rate;
  - **do not** re-resolve from `exchange_rates`;
  - **do not** link to a catalog row merely because the numeric value matches;
  - **do not** claim provider/reference provenance;
  - record explicitly that the transaction **predates booking-rate governance**;
  - `exchange_rate_id` and `fx_reference_rate_id` remain **null**;
  - deterministic, idempotent migration/backfill semantics (re-running yields the same classification).

A numeric match against a historical catalog row may be surfaced **for analysis only** and must **never**
be recorded as proof of source origin. The backfill emits a `LegacyBackfilled` audit event (§29).

Mandatory migration + staging verification (see §31/§34): prove that same-currency historical rows are
classified `BASE_PARITY`; that historical foreign-currency rows are classified `LEGACY_UNVERIFIED` with
null source FKs and unchanged numeric snapshot; and that **no** historical row receives fabricated
`CATALOG`/provider provenance.

---

## 12. Override Governance

- **Who may enter an override:** operational roles able to edit the draft transaction (AR Clerk on
  assigned customers; AR Supervisor; Finance Manager). Auditor: never (read-only). System Admin: never
  for financial values (config-only).
- **Mandatory reason:** any `MANUAL_OVERRIDE` (and any `REFERENCE_SELECTED` that deviates beyond the
  informational band) requires a non-empty `override_reason`.
- **Maker-checker:** the user who enters/edits an override that requires approval **may not approve it**
  (self-approval prohibited). Approver role per deviation band (§14).
- **Permissible rate range:** `rate > 0`, within safe numeric bounds; deviation bands drive
  warning/approval/rejection (§14).
- **Stale/missing handling:** stale reference -> warning + mandatory reason; missing reference -> catalog
  or governed manual override; missing catalog **and** missing reference -> hard block (must resolve).
- **Audit:** every enter/edit/submit/approve/reject emits an audit event (§29).

---

## 13. Approval Workflow

```text
Draft txn -> enter rate (catalog default | select reference | manual override)
   -> compute deviation vs suggestion/catalog (§14)
   -> band = Informational | Minor | Major | Blocked
        Informational -> no approval; provenance recorded
        Minor         -> mandatory reason; AR Supervisor (or higher) approval; maker != checker
        Major         -> mandatory reason; Finance Manager approval; maker != checker
        Blocked       -> hard reject (out of allowed range / missing both sources)
   -> Pending overrides appear in an approval/review queue
   -> Approve -> approval_status=Approved (locks the decision for posting)
      Reject  -> approval_status=Rejected (must revise before posting)
   -> Posting allowed only when approval_status in {NotRequired, Approved}
```

Posting must **re-verify** the approval state inside the posting transaction boundary (§28) to prevent an
edit-after-approval or post-during-pending race.

---

## 14. Deviation / Materiality Policy

Deviation measured as `abs(entered_rate - governance_baseline) / governance_baseline` where the baseline is
the eligible catalog rate, else the eligible Active reference rate. **LOCKED initial default bands**
(configurable; not final accounting policy — see §9):

| Band | Trigger (default) | Behavior |
| --- | --- | --- |
| Informational | `<= 0.50%` | inline warning; reason optional; `approval_status = NotRequired` |
| Minor | `> 0.50%` and `<= 2.00%` | mandatory reason; AR Supervisor (or higher) approval; maker-checker |
| Major | `> 2.00%` and `<= 5.00%` | mandatory reason; Finance Manager approval; maker-checker |
| Blocked | `> 5.00%`, or rate `<= 0`, or missing baseline with no justification | reject / cannot proceed |

Maker-checker is **mandatory**; the maker cannot approve their own decision. **Stale-reference threshold:
7 calendar days** (a stale reference cannot silently authorize booking/posting; it escalates and requires
reason). Optional additional dimension (materiality): a company-configured base-amount threshold may
escalate one band. All values are stored as **company-scoped configuration** (reuse the `ar_system_config`
pattern) rather than hard-coded constants, so a future reviewed business-policy change adjusts config only.

---

## 15. Rate Selection Semantics (reference candidate)

Selecting a candidate from `public.fx_reference_rates` (governed, user-initiated only):
- exact pair direction `from_currency -> to_currency` with `to_currency == company base` (mirrors 9D-A);
- company scope (`company_id`); provider scope (pinned provider, e.g. MAS);
- `status = 'Active'` only (exclude `Superseded`);
- `effective_date <= transaction_date`;
- choose the **latest eligible** `effective_date`; never a future rate;
- stale-age check (§14) -> warn + require reason;
- unsupported pair / missing reference -> no fabrication; surface explicitly;
- **no silent inversion; no silent reciprocal** (only `from_to` direction, consistent with 9D-A/9D-B).

Catalog selection reuses the existing `resolveExchangeRate` semantics unchanged.

---

## 16. Draft vs Posted Lifecycle

- **Draft:** may refresh suggestion, change selected source, submit/edit override, and await approval. The
  booked snapshot is provisional until posting.
- **Posted:** booked snapshot immutable; no refresh from reference/catalog; no silent change. Any change
  requires a governed correction (§17).
- **Transition:** posting is permitted only when `approval_status in {NotRequired, Approved}`, re-checked
  transactionally at post time.

---

## 16A. Hybrid Decision Lifecycle (clarified)

```text
baseline/suggestion resolved -> decision created -> selection or override
  -> approval routing (band, §14) -> approval / rejection
  -> (material FX edit) invalidates prior approval + new decision_version
  -> current/final decision selected (fx_decision_id on the txn)
  -> transaction booked snapshot remains the numeric authority
  -> post-time in-transaction validation (§28A) -> posting
  -> decision + event history remain immutable and queryable
```

Locked clarifications:
- **Editing** a material FX value (rate/source/currency) does **not** overwrite history: it creates a
  **new `decision_version`** (prior version marked `Superseded` in the decision lineage) and emits
  `DecisionSuperseded` + `DecisionCreated` events.
- **Prior approval is invalidated** on any material FX change (status returns to `Pending`, `Approved`
  cleared, `ApprovalInvalidated` event) so a stale approval can never apply to a changed rate.
- **`fx_decision_id` on the transaction changes only while the transaction is Draft**; once posted it is
  frozen by the §17A trigger.
- The **post-time RPC verifies the decision's final rate equals the transaction booked snapshot** (§28A);
  a mismatch aborts posting.
- **Posted transactions cannot switch to a different decision.**
- Full prior decision history remains queryable from `fx_booking_rate_decisions` (versioned lineage) and
  `fx_booking_rate_decision_events` (append-only).

---

## 17. Posted Transaction Immutability

- Posted `invoices.exchange_rate` / `receipts.exchange_rate` / `base_total` / `base_amount` and their
  journals must remain **immutable**, enforced at the **DB level** by 9D-C (§17A) — not merely by the fact
  that posting snapshots the row rate.
- Later `fx_reference_rates` corrections and `exchange_rates` catalog edits **do not** mutate posted rows
  (verified: posting does not re-read catalog).
- Scheduler/provider sync **never** touches posted transactions (reaffirmed from 9D-B).
- **Post-posting correction scope (B9DC-005):** the **governance rule is kept** — *posted booked FX
  snapshots are never mutated in place.* However, **9D-C does not implement any new correction-mutation
  workflow.** Building new reverse-and-repost FX-correction flows, compensating FX adjustment journals, or
  post-allocation FX-correction mutation is **DEFERRED to a separately planned, technically reviewed,
  explicitly approved batch**, unless the workflow is already an existing, proven-safe primitive.
  - In 9D-C: a posted-transaction rate-correction attempt **must be rejected**; there is **no in-place
    posted FX mutation**; governance/audit **may record** that a correction was requested or rejected; the
    actual accounting-correction mutation is **out of scope**.
  - Executing a compensating-journal workflow is **not** a 9D-C closure condition.

---

## 17A. DB-Level Posted FX Immutability Enforcement (B9DC-003)

Service-layer / Edge-Function validation is **not sufficient**. 9D-C adds a narrowly scoped DB-level
enforcement — a `BEFORE UPDATE` trigger (or equivalent DB constraint mechanism) on `invoices` and
`receipts` — that **blocks changes to protected FX/governance fields once the row is no longer Draft**
(`OLD.status` is non-Draft).

**Protected fields (where applicable):** `currency`, `exchange_rate`, `base_currency`,
`base_total` / `base_amount`, `fx_source_category`, `fx_decision_id`.

**Transaction-date fields:** the trigger **also protects the booking-rate-eligibility date field**
(`invoice_date` / `receipt_date`) after the row leaves Draft, because that date determines rate
eligibility; changing it post-posting would invalidate provenance. **Decision documented and locked:
protect these date fields after posting.**

**Behavioral requirements:**
- allow legitimate **Draft** editing of all fields;
- allow the **Draft -> Posted** transition itself;
- when `OLD.status` is non-Draft, **reject** any UPDATE that changes a protected field (raise a clear
  error);
- **preserve** legitimate financial-RPC updates to unrelated fields (status transitions, balances,
  allocated/unallocated amounts, timestamps) — the trigger checks only the protected column set, not the
  whole row;
- apply **even where broad operational UPDATE RLS policies exist** (a trigger fires regardless of RLS);
- **not** rely on frontend or Edge Function validation alone.

**Mandatory tests (see §33/§34):**
- direct authenticated UPDATE attempt on a posted row's FX fields -> **rejected**;
- ordinary service-path UPDATE attempt on a posted row's FX fields -> **rejected**;
- approved financial RPC changing unrelated permitted fields (e.g. balance/status) -> **remains
  functional**.

---

## 18. Invoice Behavior

- Draft create/edit: source model (§10) applies; default = catalog (`resolveExchangeRate`); reference
  suggestion surfaced; override governed (§12-14). `base_total = total_amount * booked_rate` unchanged.
- Posting: unchanged math; approval re-verified transactionally.
- Provenance record created/updated on each rate decision; snapshot columns unchanged.

---

## 19. Receipt Behavior

- Symmetric to invoices by default (same governance, same source model, same provenance), because the
  discovered implementation is parallel (`receipts/service.ts` mirrors invoices) and realized FX depends
  on both rates.
- **Transaction-date semantics:** receipt uses `receipt_date`; invoice uses `invoice_date` — selection
  eligibility (`effective_date <= txn_date`) uses the respective date. Verify no other asymmetry at
  implementation.
- Cheque clearance / reversal continue to reuse the receipt's booked snapshot (no re-lookup).

---

## 20. Allocation / Realized FX Compatibility (mandatory)

Invariants that **must not change**:
- realized FX formula `alloc x (receipt_rate - invoice_rate)` (007:843) unchanged;
- same-currency allocation rule unchanged;
- allocation uses the **booked snapshot** rates of the already-created invoice/receipt, not any new
  governance lookup;
- reversal, bounced-cheque, cancel/reversal journals keep using the stored booked snapshot;
- discount/short-payment/bank-charge branches (007) unaffected.

9D-C only governs how the snapshot rate is **chosen and recorded before posting**; once posted, allocation
consumes the snapshot exactly as today. Regression tests (§33) must prove **exact deterministic
database-value equality and/or scoped financial fingerprints** for a fixed regression dataset, proving no
change to: realized FX amount; journal amounts; allocation amounts; reversal outcome; bounced-cheque
outcome; and discount/bank-charge behavior where applicable. Existing financial semantics are unchanged.

---

## 21. Import Compatibility

Current receipt import **can create and auto-post** through service paths (auto-create draft; auto-post
boundary from `013_import_enable_auto_post.sql`). Governance must be integrated at **all** relevant paths
so none can bypass it:

```text
invoice create | invoice draft edit | invoice post
receipt create | receipt draft edit | receipt post
CSV import | XLSX import | PDF/Image receipt intake | review queue | receipt import auto-post
future approved automation paths
```

Locked import behavior (per §9 defaults):
- imported rate absent -> catalog `resolveExchangeRate`; if missing -> row flagged, **not** silently posted;
- imported rate present and within Informational band with a clean `CATALOG`/`BASE_PARITY` posture ->
  accepted with provenance and may auto-post;
- imported rate beyond the Informational band, or `MANUAL_OVERRIDE`/`REFERENCE_SELECTED` posture ->
  **queued for approval**, never auto-posted;
- batch approval supported via the same approval queue;
- provenance records the import origin (batch id / source file reference) where available.

Auto-post respects the same gate: an import row requiring approval stays Draft/Pending. **`POST
/allocations/auto` remains `AUTO_ALLOCATION_DISABLED` and is not enabled by 9D-C.**

---

## 22. Automation Compatibility

Unattended auto-post may proceed **only when ALL** of these hold (locked default, §9):
`source_category in {BASE_PARITY, CATALOG}`; current decision valid; `approval_status = NotRequired`; no
stale condition; no missing baseline; no pending approval; no rejection; no decision-version mismatch.

The following **must HOLD** (never auto-post):
`REFERENCE_SELECTED` requiring user action; `MANUAL_OVERRIDE`; pending approval; rejected decision; stale
baseline/reference; missing governed rate; invalidated approval; decision-version mismatch.

Principle: automation may proceed only through the **Informational / NotRequired** path; anything needing
human judgment is queued. A reference rate merely existing never authorizes automatic financial mutation.
These are safe initial implementation defaults and remain configurable for future reviewed business-policy
changes. Production rollout remains owned by Batch 9D-E.

---

## 23. Data Model Options

- **Option A — provenance columns directly on `invoices`/`receipts`.** Simple joins/queries; but bloats
  financial tables, mixes mutable governance with the immutable snapshot, and complicates history/versioning.
- **Option B — dedicated `fx_booking_rate_decisions` table linked to the transaction.** Clean separation,
  full history/versioning, easy audit; requires joins for display and careful lifecycle linkage.
- **Option C — hybrid:** keep the immutable numeric snapshot on the transaction, add a **small set of
  denormalized display columns** (`fx_source_category`, `fx_decision_id`) to the transaction, and hold the
  **full decision/provenance/approval history** in a normalized `fx_booking_rate_decisions` table + audit
  log.

Comparison:

| Criterion | A | B | C |
| --- | --- | --- | --- |
| Auditability | medium | high | high |
| Immutable-snapshot safety | low (mixes mutable+immutable) | high | high |
| Query performance (display) | high | medium | high |
| Complexity | low | medium | medium |
| Migration risk | medium (wide table changes) | low-medium | medium |
| Existing RPC compatibility | medium | high | high |
| Frontend simplicity | high | medium | high |

---

## 24. Recommended Architecture

**Adopt Option C (hybrid).**

- Keep `invoices.exchange_rate`, `receipts.exchange_rate`, `base_currency`, `base_total`/`base_amount`
  **unchanged and authoritative** as the immutable accounting snapshot; enforce posted-FX immutability at
  the **DB level** (§17A).
- Add two lightweight display columns to `invoices` and `receipts`: `fx_source_category TEXT` and
  `fx_decision_id UUID` (nullable FK to the decision table; points to the current/final decision, changes
  only while Draft). **Historical backfill is truthful (B9DC-002, §11A): `BASE_PARITY` for deterministic
  same-currency rows; `LEGACY_UNVERIFIED` for unprovable historical foreign-currency rows; never a
  fabricated `CATALOG` label.**
- Add a normalized `fx_booking_rate_decisions` table with the full provenance + override + approval fields
  and **explicit source/transaction FKs + CHECK constraints** (B9DC-008, §11), `decision_version` for
  optimistic concurrency, and a `status` lifecycle (`Draft` -> `Pending` -> `Approved`/`Rejected` ->
  `Superseded`/`Posted`).
- Add an **append-only `fx_booking_rate_decision_events`** table (B9DC-007, §29) for the governance event
  log — this is a **new dedicated store**, not a claim that `005` auto-covers it.
- Selection/override/approval logic and the **in-transaction posting guard** (§28A) live in **PostgreSQL
  RPCs** (transaction-safe, service role) invoked by Edge Functions; reads via company-scoped RLS.

This satisfies all 20 acceptance questions (§39/§34) while preserving backward compatibility and
DB-enforced immutability.

---

## 25. API / RPC Design

Edge Function surface (under existing `invoices` / `receipts` functions, plus a small `fx-booking`
capability where cross-cutting):
- `GET .../booking-rate/options` — eligible sources for a draft txn (catalog rate, eligible reference
  candidate, base parity), with deviation preview. **Read-only.**
- `POST .../booking-rate/select` — choose a source (catalog/reference/base) for a draft txn; records a
  decision; computes band; sets `approval_status`.
- `POST .../booking-rate/override` — submit/edit a manual override with mandatory reason.
- `POST .../booking-rate/approve` / `.../reject` — approver action (maker-checker enforced).
- `GET .../booking-rate/provenance` — read provenance/history for a txn (Auditor-readable).

PostgreSQL RPCs (service-role, transaction boundaries):
- `fx_record_booking_decision(...)`, `fx_submit_override(...)`, `fx_approve_booking_decision(...)`,
  `fx_reject_booking_decision(...)`.
- `fx_assert_booking_decision_postable(...)` exists **only** as (1) an internal helper executed **inside**
  the `post_invoice`/`post_receipt` transaction **after** the transaction-row lock, and/or (2) a
  non-authoritative UI/preflight check. It is **never** the sole financial authorization boundary in a
  separate check-then-post call sequence (B9DC-004; see §28A).

**No direct financial-table mutation API is exposed.** All mutations go through RPCs that own the
transaction boundary; frontend hooks call Edge Functions only. The authoritative booking-governance
verification is performed inside the same PostgreSQL transaction as posting (§28A), never as a separate
Edge Function "assert postable -> then post" sequence.

---

## 26. Authorization Matrix (proposed; business-policy items flagged)

| Capability | AR Clerk | AR Supervisor | Finance Manager | Auditor | System Admin |
| --- | --- | --- | --- | --- | --- |
| View reference suggestion | yes (assigned) | yes | yes | yes (read) | no |
| Select catalog / base parity | yes (assigned) | yes | yes | no | no |
| Select reference rate (governed) | yes (assigned) | yes | yes | no | no |
| Enter / edit manual override | yes (assigned) | yes | yes | no | no |
| Submit override for approval | yes (assigned) | yes | yes | no | no |
| Approve/reject Minor band | no | yes | yes | no | no |
| Approve/reject Major band | no | no | yes | no | no |
| Post with approved override | yes (assigned)* | yes | yes | no | no |
| View provenance | yes (assigned) | yes | yes | yes | no |
| View audit history | yes (assigned) | yes | yes | yes | no |
| Request/record a correction (mutation deferred, B9DC-005) | no | request | request | no | no |

`*` subject to existing posting permissions. **System Admin is intentionally NOT a financial approver**
(config-only, never a financial approver merely due to administrative access), and Auditor is read-only.
Maker-checker: the submitter is excluded from approving their own decision; the approver role is derived
from the authenticated **server-side** identity (no caller-supplied role trust). The actual post-posting
correction **mutation** is **out of 9D-C scope** (deferred, §17/B9DC-005); 9D-C may only record/reject a
correction request. Initial authorization defaults are **locked** in §9 (configurable, not final client
accounting policy).

---

## 27. RLS / Tenant Isolation

- `fx_booking_rate_decisions` and `fx_booking_rate_decision_events`: SELECT gated by
  `rls_has_company_access` (company-scoped); **no direct client INSERT/UPDATE/DELETE** (privileged mutation
  only through controlled service-role RPC paths).
- New transaction display columns inherit existing invoice/receipt RLS; posted-FX fields additionally
  protected at the DB layer (§17A) even where broad operational UPDATE RLS exists.
- Event table is append-only (mutation-prevention triggers, §29); company-scoped reads.
- Cross-company access denied; anon denied; authenticated direct writes denied.
- Every new `SECURITY DEFINER` function repeats the **020 privilege-hardening pattern**: fixed safe
  `search_path`; explicit `REVOKE EXECUTE FROM PUBLIC/anon/authenticated`; explicit intended grants only.
- Server-side company/transaction/source ownership validation; **no caller-supplied role trust**; the
  maker-checker role is derived from the authenticated server-side identity; direct posted-FX mutation is
  rejected at the DB layer.

---

## 28. Concurrency / Idempotency

Prevent the inconsistent sequence `approve override | concurrent edit | post`:
- `fx_booking_rate_decisions.decision_version` (optimistic concurrency): edit/approve/post must pass the
  expected version; a stale version fails closed.
- Approve and post operate under **row locks** (`SELECT ... FOR UPDATE`) on the decision + transaction
  rows inside the RPC transaction boundary.
- Editing an override **invalidates** any prior `Approved` state (returns to `Pending`), so an approval
  cannot silently apply to a changed rate.
- Posting re-verifies `approval_status` and `decision_version` transactionally; a race with an edit or a
  pending approval aborts the post.
- Idempotency: duplicate approve/submit is a no-op on an already-final state; duplicate posting guarded by
  existing posting-status checks.

---

## 28A. Transaction-Safe Post-Time Authorization (B9DC-004)

**Rejected design (TOCTOU-unsafe):** an Edge Function that calls "assert postable -> PASS" and then calls
a **separate** post RPC. Between the check and the post, the decision could be edited, invalidated,
superseded, or the rate changed — producing inconsistent provenance. This is explicitly **not** an
acceptable authorization boundary.

**Locked authoritative design:** authoritative governance verification occurs **inside the same
PostgreSQL transaction** as `post_invoice` / `post_receipt`:

```text
post_invoice / post_receipt transaction
  -> SELECT ... FOR UPDATE the transaction row (lock)
  -> identify current fx_decision_id on the locked row
  -> verify the decision belongs to the same company and this exact transaction
  -> verify current decision_version (no stale version)
  -> verify approval_status in {NotRequired, Approved}
  -> verify the decision is not invalidated or superseded
  -> verify the decision's final selected rate EQUALS the current transaction booked snapshot
  -> verify source eligibility and governance status (band/stale/source-FK integrity)
  -> perform the posting mutation
  -> COMMIT
```

**Concurrency expectations:** the transaction-row `FOR UPDATE` lock serializes posting against concurrent
edit/approve on the same transaction; a concurrent editor must wait or fail the version check; posting
aborts (whole transaction rolls back) if any verification fails. `fx_assert_booking_decision_postable` may
encapsulate these checks but only when invoked **after** the lock **within** the posting transaction (or
as a non-authoritative preflight). A posted transaction can never switch to a different decision.

---

## 29. Audit Trail (B9DC-007) — explicit append-only governance events

**Do not rely on `database/005_audit_triggers.sql` to automatically cover the new governance tables.**
9D-C adds an explicit, append-only event table:

```text
fx_booking_rate_decisions        (current decision state per lifecycle)
fx_booking_rate_decision_events  (append-only event log)
```

**Event semantics to reconstruct** (exact names may follow repo conventions):
`LegacyBackfilled`, `DecisionCreated`, `BaselineResolved`, `ReferenceSuggested`, `CatalogSelected`,
`ReferenceSelected`, `OverrideSubmitted`, `ApprovalRequired`, `Approved`, `Rejected`,
`ApprovalInvalidated`, `DecisionSuperseded`, `Posted`.

**Each event records (where relevant):** actor identity, actor role, `company_id`, transaction identity
(`invoice_id`/`receipt_id`), `decision_id`, `decision_version`, `event_type`, `timestamp`, prior and
resulting `approval_status`, reason/comment, maker/checker identity, provenance source identity
(`source_category` + `exchange_rate_id`/`fx_reference_rate_id`), and selected/final rate.

**Append-only enforcement (combination):**
- **no** client direct INSERT (writes only via controlled service-role RPC paths);
- **no** UPDATE and **no** DELETE (mutation-prevention triggers, mirroring the `005`
  `fn_prevent_audit_log_modification()` pattern, applied to the new event table);
- **privilege revocation** (`REVOKE ... FROM PUBLIC/anon/authenticated`) + explicit intended grants only;
- **RLS** company-scoped reads.

**Mandatory tests / staging evidence:** full **audit reconstruction** of a decision's lifecycle from the
event table; and rejection of UPDATE/DELETE/direct-INSERT against the event table (§33/§34).

---

## 30. Frontend UX Scope (design only; no implementation now)

- **Invoice create/edit** and **Receipt create/edit:** show transaction currency, company base currency,
  suggested reference rate + effective date, catalog rate, chosen source, selected rate, override
  indicator, approval status, and a reason field when required; inline deviation warning.
- **Posted transaction detail:** final booked rate, source category, provenance, approval info, and an
  immutable-status indicator.
- **Approval / review queue:** pending overrides with deviation, amount/materiality, requested-by, reason,
  and approve/reject actions (respecting maker-checker + band-based approver role).

---

## 31. Migration Plan (forward-only; do not create now)

- Next available number is **022** (017-021 exist; **do not edit 017-021**). Forward-only.
- Proposed sequence (split for reviewability):
  - `database/022_fx_booking_rate_governance.sql` — create `fx_booking_rate_decisions` with explicit
    nullable source FKs (`exchange_rate_id`, `fx_reference_rate_id`) and transaction FKs (`invoice_id`,
    `receipt_id`), per-source-category CHECK constraints, exactly-one-transaction CHECK, and
    same-company/currency-pair/`to_currency==base` integrity (CHECK/trigger); create append-only
    `fx_booking_rate_decision_events`; add `fx_source_category` + `fx_decision_id` to `invoices`/`receipts`;
    indexes; RLS policies; **truthful legacy backfill** (`BASE_PARITY` for deterministic same-currency
    rows; `LEGACY_UNVERIFIED` for unprovable foreign-currency rows; null source FKs; no fabricated
    `CATALOG`; §11A); **no change to posted numeric snapshots**.
  - `database/023_fx_booking_rate_rpcs_and_immutability.sql` — DB-level posted-FX immutability triggers on
    `invoices`/`receipts` (§17A); append-only mutation-prevention triggers on
    `fx_booking_rate_decision_events`; `SECURITY DEFINER` governed RPCs
    (select/override/approve/reject) and the in-transaction posting guard (§28A) integrated into
    `post_invoice`/`post_receipt`; explicit privilege hardening (fixed `search_path`;
    `REVOKE EXECUTE FROM PUBLIC/anon/authenticated`; intended grants only — 020 pattern).
  - Optional `024` — company-scoped deviation/materiality/stale config (or extend `ar_system_config`).
- All forward-only, additive; **no historical rate recomputation; no posted snapshot mutation; no
  fabricated provenance**; no `exchange_rates` / `fx_reference_rates` schema change; no privilege
  weakening. Ordering: 022 (schema/backfill) before 023 (triggers/RPCs/posting integration).

---

## 32. File-Level Change Map (indicative; implementation task only)

| File | Action | Responsibility |
| --- | --- | --- |
| `database/022_fx_booking_rate_governance.sql` | create | decision table + event table + explicit FKs/CHECKs + txn display columns + RLS + truthful legacy backfill |
| `database/023_fx_booking_rate_rpcs_and_immutability.sql` | create | DB posted-FX immutability triggers + append-only event triggers + governed RPCs + in-transaction posting guard + privilege hardening |
| `backend/supabase/functions/invoices/service.ts` | modify | route rate selection/override through governance; record decision |
| `backend/supabase/functions/receipts/service.ts` | modify | symmetric governance |
| `backend/supabase/functions/invoices/validators.ts` / `receipts/validators.ts` | modify | reason/deviation validation |
| `backend/supabase/functions/_shared/*` (auth/types) | modify | roles/types for approval + provenance |
| `backend/supabase/functions/fx-booking/*` (assess) | create (maybe) | shared options/provenance/approval routes |
| `backend/supabase/functions/imports/*` | modify | import governance + approval queue integration |
| `frontend/*` | later | UX per §30 (not in first implementation slice) |
| `database/007_financial_rpcs.sql` | no change to math | only add a postable-guard call (via 023) |
| `database/017-021_*.sql` | no change (locked) | must not be modified |

---

## 33. Testing Strategy

- **Selection:** exact eligible catalog rate; latest reference `effective_date <= txn_date`; no future
  rate; missing pair; Superseded excluded; stale reference escalation.
- **Override:** allowed vs denied roles; mandatory reason; each deviation band; approval workflow;
  self-approval rejected; edit-after-approval returns to Pending and blocks stale approval.
- **Concurrency:** approve-vs-edit race; approve-vs-post race; duplicate approval; duplicate submission;
  stale `decision_version` rejected.
- **Posting:** booked snapshot created; provenance stored; in-transaction post-time revalidation (§28A);
  later reference correction does not mutate posted snapshot; later `exchange_rates` edit does not mutate
  posted snapshot.
- **DB-level immutability (§17A):** direct authenticated UPDATE on a posted row's FX fields -> rejected;
  ordinary service-path UPDATE on posted FX fields -> rejected; approved financial RPC changing unrelated
  permitted fields -> still functional; posted `invoice_date`/`receipt_date` change -> rejected.
- **Historical backfill (§11A):** same-currency rows -> `BASE_PARITY`; foreign-currency unprovable rows ->
  `LEGACY_UNVERIFIED` (snapshot unchanged, null source FKs); no fabricated `CATALOG`/provider provenance.
- **Referential integrity (§11):** per-source-category FK CHECK; exactly-one-transaction CHECK;
  cross-company source/transaction association rejected; source currency-pair mismatch rejected; reference
  `to_currency != base` rejected.
- **Audit (§29):** full lifecycle reconstruction from the event table; UPDATE/DELETE/direct-INSERT against
  the event table rejected.
- **Allocation regression:** **exact deterministic database-value equality and/or scoped financial
  fingerprints** on a fixed dataset — no change to realized FX, journal amounts, allocation amounts,
  reversal outcome, bounced-cheque outcome, discount/bank-charge behavior; same-currency rule preserved.
- **Security:** cross-company denied; direct client mutation denied; new RPCs `service-role`-only;
  maker-checker derived from server-side identity (no caller-supplied role trust).
- **Financial zero-regression:** existing posting/allocation/journal semantics preserved (scoped
  fingerprint before/after).

Separate evidence classes: synthetic test data vs real reference-rate data vs financial before/after
fingerprints (do not blend).

---

## 34. Mandatory Staging Runtime Matrix

Includes at least the following mandatory cases (B9DC amendment additions explicit):

1. truthful `BASE_PARITY` historical backfill [S]
2. truthful `LEGACY_UNVERIFIED` foreign-currency backfill (snapshot unchanged, null source FKs) [S]
3. no fabricated `CATALOG` provenance on historical rows [S]
4. DB-level posted **invoice** FX-field update rejection [S]
5. DB-level posted **receipt** FX-field update rejection [S]
6. permitted unrelated financial RPC update still works [S]
7. same-transaction post-time decision revalidation (§28A) [S]
8. approve-vs-edit race [S]
9. edit-vs-post race [S]
10. stale decision-version rejection [S]
11. import receipt auto-post HOLD when governance is not eligible [M]
12. pending-approval HOLD [M]
13. rejected-decision HOLD [M]
14. stale-reference HOLD [M]
15. missing rate/baseline HOLD [M]
16. audit event completeness / lifecycle reconstruction [M]
17. append-only audit mutation rejection (UPDATE/DELETE/direct-INSERT) [S]
18. cross-tenant decision association rejection [S]
19. cross-tenant / mismatched source-FK rejection [S]
20. exact allocation/realized-FX financial fingerprints (no change) [S]
21. role matrix (all capabilities in §26) [S]
22. catalog rate selection [M]
23. reference suggestion surfaced (read-only) [M]
24. governed reference selection [M]
25. manual override + mandatory reason [M]
26. deviation band computation (Informational/Minor/Major/Blocked) [S]
27. approval (Minor -> AR Supervisor) [M]
28. approval (Major -> Finance Manager) [M]
29. rejection path [M]
30. maker-checker (self-approval blocked) [S]
31. edit-after-approval returns to Pending / invalidates approval [S]
32. posted snapshot immutable to later reference correction [M/S]
33. posted snapshot immutable to later catalog edit [M/S]
34. posted-transaction rate-correction attempt rejected (no in-place mutation; §17/§B9DC-005) [S]
35. tenant isolation / RLS (cross-company denied) [S]
36. RPC privilege (`service-role`-only) [S]
37. MYR base-currency preflight for reference selection (mirror 9D-B) [M]

Evidence classes (kept distinct; do **not** blend):
- **[M]** mock/synthetic governance behavior;
- **[S]** staging system/database behavior;
- **[R]** real provider/reference evidence — **only where genuinely necessary**. Purely governance-behavior
  tests must **not** use real-provider calls; a controlled reference fixture in `fx_reference_rates`
  suffices for selection/eligibility tests.

---

## 35. Rollback / Containment

- **Disable 9D-C behavior** via a company-scoped feature flag (default off until approved): reverts to the
  current catalog/`resolveExchangeRate` path; the existing booking path is preserved.
- **Partially approved overrides:** left in `Pending`/`Approved` state; posting gate still enforced; no
  data deleted.
- **Revert frontend exposure** without deleting provenance (hide UI; keep decision/audit rows).
- **Never touch posted snapshots**; never delete audit/provenance history.
- Migration is additive/forward-only; containment = disable flag + (if needed) stop routing through the
  new RPCs, not dropping data.

---

## 36. Evidence Plan

Evidence file at closure:
`docs/evidence/SPRINT_BATCH_9D_C_BOOKING_RATE_PROVENANCE_AND_OVERRIDE_GOVERNANCE_IMPLEMENTATION_EVIDENCE.md`
covering: implementation proof; migration apply proof (live object/constraint verification, incl. FKs +
CHECKs); truthful backfill proof (`BASE_PARITY`/`LEGACY_UNVERIFIED`, no fabricated `CATALOG`); role matrix;
selection/override/approval/rejection; DB-level posted-FX immutability proof (direct + service UPDATE
rejected; permitted RPC still works); allocation regression (deterministic value equality / scoped
fingerprints); financial before/after fingerprints; audit-event lifecycle reconstruction + append-only
mutation rejection; referential-integrity rejection cases; import + automation compatibility; concurrency
(post-time revalidation, races, stale version); cleanup; deviations/limitations. Separate synthetic /
staging-database / real-reference evidence classes (real-provider calls only where genuinely necessary).

---

## 37. Risks

| ID | Risk | Disposition |
| --- | --- | --- |
| C1 | Governance changes silently alter realized FX. | Byte-identical allocation regression is mandatory (§33). |
| C2 | Ungoverned override path remains reachable (imports/legacy callers). | Route all rate entry through governance; import path explicitly covered (§21). |
| C3 | Approval race produces inconsistent provenance. | Optimistic version + row locks + transactional post gate (§28). |
| C4 | Business thresholds not yet client-signed-off. | Locked safe **configurable** initial defaults (§9, §14); final values are a later policy step, not an implementation blocker. |
| C5 | Catalog/reference confusion (Layer collapse). | Source model + provenance categories; no auto-promotion (§5, §10). |
| C6 | Backward compatibility break for existing invoice/receipt creation. | Additive migration; feature flag; catalog default unchanged (§31, §35). |
| C7 | Posted-record correction misused as in-place mutation. | Posted-FX immutability enforced at DB level (§17A); correction attempts rejected; new correction-mutation workflow deferred (§17/B9DC-005). |
| C8 | TOCTOU between "assert postable" and posting. | Authoritative verification inside the posting transaction after row lock (§28A); separate check-then-post rejected. |
| C9 | Fabricated historical provenance. | Truthful `BASE_PARITY`/`LEGACY_UNVERIFIED` backfill; no `CATALOG` fabrication; null source FKs (§11A). |
| C10 | Weak polymorphic references corrupt integrity. | Explicit FKs + per-category CHECK + exactly-one-transaction CHECK + cross-company/pair guards (§11). |

---

## 38. Open Decisions

**Now LOCKED by this amendment (no longer open):** deviation bands + stale threshold + approver roles +
import/auto-post posture (§9/§14, as configurable initial defaults); `PROMOTED_CATALOG` OFF (§9/§10);
migration split 022/023 (§31); explicit FK/CHECK integrity model (§11); DB-level posted-FX immutability
(§17A); transaction-safe post-time authorization (§28A); append-only event table (§29); post-posting
correction-mutation deferral (§17/B9DC-005).

**Remaining genuinely open (non-architecture, non-security-critical; safe to resolve at implementation):**
- final client-approved accounting **values** for the deviation bands / stale threshold (defaults are safe
  and configurable; business sign-off is a later policy step, not a blocker);
- whether a shared `fx-booking` Edge Function is warranted vs extending `invoices`/`receipts`;
- exact company-config storage for thresholds (`ar_system_config` extension vs a new config table);
- event-name string conventions (semantics are fixed in §29).

None of these change the locked architectural boundaries (§5) or the immutability / integrity /
zero-regression guarantees.

---

## 39. Acceptance Criteria

9D-C is complete only when: booking-rate source hierarchy is explicit and enforced; reference selection is
governed and never automatic; per-transaction provenance is stored with **explicit FKs + CHECK
integrity** (§11); historical backfill is **truthful** (`BASE_PARITY`/`LEGACY_UNVERIFIED`, no fabricated
`CATALOG`, §11A); overrides are role-gated with mandatory reason, **locked deviation bands** (§9/§14), and
maker-checker approval; posted snapshots are immutable to later catalog/reference changes **and enforced
at the DB level** (§17A); **post-posting correction mutation is out of scope** (deferred, B9DC-005) and
correction attempts are rejected; **post-time authorization is transaction-safe** (§28A, no TOCTOU
check-then-post); concurrency races are prevented; invoice/receipt/import/automation flows all route
through governance and `POST /allocations/auto` stays `AUTO_ALLOCATION_DISABLED`; realized-FX and
allocation behavior show **exact deterministic value equality / scoped fingerprints** (regression proven);
the **append-only governance event table** reconstructs the lifecycle and rejects mutation (§29);
RLS/tenant isolation and `service-role`-only RPC privilege hold; staging matrix (§34) passes; evidence
classes are not blended; Closure Review passes. No production action occurs.

---

## 40. Explicit Non-Goals / Production Boundary

Batch 9D-C must NOT: deploy to production; run a production migration; change the staging/production
scheduler, Vault, or pg_cron/pg_net; perform a production provider call; roll out booking governance to
production; or mutate production financial data. **Production rollout is owned by Batch 9D-E.** Multi-
currency UX aggregation is **9D-D**. This plan authorizes only detailed planning; implementation requires
**Codex Batch 9D-C Plan Amendment Confirmation Review** followed by explicit user implementation approval.

---

## 41. Relationship to the master plan

This sub-plan sits under master `§0` (authoritative order `9D-A (CLOSED) -> DG-1 -> 9D-B (CLOSED) -> 9D-C
-> 9D-D -> 9D-E`). The master plan remains the authoritative phase/order document; this file holds the
implementation-ready detail for 9D-C. No master-plan architecture, order, or DG-1 lock is changed by this
file.
