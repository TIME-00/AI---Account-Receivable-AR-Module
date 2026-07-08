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

- **Current state:** Batch 9D-C is in **detailed implementation planning** only. Nothing is implemented,
  no migration is created, no Edge Function/frontend is changed, and no staging/production is mutated by
  this task.
- **Next gate:** **Codex Batch 9D-C Plan Second Review** -> user implementation approval -> implementation
  -> technical review -> staging readiness -> explicit staging approval -> staging deployment -> runtime
  verification -> evidence -> closure review. **Implementation approval has NOT been granted.**
- **Planning-only banner.** No booking-rate logic, migration, RPC, Edge Function, or frontend was changed
  while producing this plan; no posted financial record was touched; the staging scheduler was not
  modified; production was not touched.

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
  `exchange_rate`** (not a fresh lookup). `post_receipt` likewise uses `v_rct.exchange_rate`. **Therefore
  the numeric booked rate is already effectively immutable at posting: later `exchange_rates` catalog
  edits or `fx_reference_rates` corrections do not alter posted rows.**

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
2. Posting reads the **row snapshot**, not a fresh catalog lookup -> posted numeric rate is already
   immutable to later catalog/reference changes.
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
5. **Post-posting correction** via governed reversal/adjustment, never in-place mutation.
6. Full **audit trail** reusing existing append-only audit infrastructure.
7. **Zero regression** to posting, allocation, realized FX, reversal, and bounced-cheque behavior.
8. Company-scoped **RLS** and backend-controlled mutation only.

---

## 8. Non-Goals

- No automatic promotion of reference rates into `exchange_rates` or into a transaction (unless a future,
  explicitly approved governed action).
- No change to the realized-FX formula or same-currency allocation rule.
- No production rollout, migration, provider deploy, scheduler change, or Vault change (that is 9D-E).
- No multi-currency UX aggregation redesign (that is 9D-D).
- No new provider integration (9D-B is closed).
- No retroactive rewrite of historical posted snapshots.

---

## 9. Business Decisions Required (`[BUSINESS DECISION REQUIRED]`)

The plan proposes safe technical defaults but flags the following as business policy to confirm before or
during implementation review:

1. **Source priority** when both catalog and an eligible reference rate exist (default proposal: curated
   catalog is authoritative; reference is suggestion-only). `[BUSINESS DECISION REQUIRED]`
2. **Deviation thresholds** (default proposal below, §14). `[BUSINESS DECISION REQUIRED]`
3. **Stale-reference age** (default 7 calendar days). `[BUSINESS DECISION REQUIRED]`
4. **Who may approve overrides** (default: AR Supervisor for minor band, Finance Manager for major band;
   maker-checker enforced). `[BUSINESS DECISION REQUIRED]`
5. **Whether overrides on imports are permitted without human approval** (default: import overrides beyond
   the informational band are queued for approval; never auto-posted). `[BUSINESS DECISION REQUIRED]`
6. **Whether promotion of a reference rate into the `exchange_rates` catalog is ever allowed** (default:
   optional, Finance-Manager-only, explicit, audited; off by default). `[BUSINESS DECISION REQUIRED]`

---

## 10. Booking Source Model

Each transaction's booked rate must originate from exactly one **source category**, recorded in
provenance:

| Source category | Origin | Eligibility | Approval | Fallback |
| --- | --- | --- | --- | --- |
| `BASE_PARITY` | currency == base | always (rate = 1.0) | none | n/a |
| `CATALOG` | `public.exchange_rates` via `resolveExchangeRate` | catalog entry exists for `currency->base`, `effective_date <= txn_date` | none (curated) | -> `REFERENCE_SUGGESTED` (if enabled) or error |
| `REFERENCE_SELECTED` | Active `fx_reference_rates` chosen through governed selection | §15 eligibility passes; user explicitly selects | required if it deviates from catalog beyond threshold (§14) | -> manual override or error |
| `MANUAL_OVERRIDE` | user-entered rate | operational role; mandatory reason | required per deviation band (§14); maker-checker | none (must resolve) |
| `PROMOTED_CATALOG` (optional, off by default) | reference rate promoted into `exchange_rates` by FM | FM-only, explicit, audited | FM approval | n/a |

**Priority (default):** `BASE_PARITY` > `CATALOG` > (user-initiated) `REFERENCE_SELECTED` /
`MANUAL_OVERRIDE`. Reference is **never** auto-selected; it is suggested and may be selected by a user
subject to governance.

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

Minimum provenance fields to explain a booked rate (stored in a normalized decision record, §24):
`company_id`, `transaction_type` (`invoice`|`receipt`), `transaction_id`, `from_currency`, `to_currency`,
`transaction_date`, `booked_rate` (final), `source_category` (§10), `source_record_id` (catalog row or
`fx_reference_rates.id` when applicable), `provider` + `provider_effective_date` + `reference_fetched_at`
(when reference-derived), `suggested_rate` (original suggestion), `deviation_pct` (vs suggestion/catalog),
`selected_by`, `selected_at`, `override_reason`, `approval_status`
(`NotRequired`|`Pending`|`Approved`|`Rejected`), `approved_by`, `approved_at`, `decision_version`
(optimistic-concurrency), `posted` (bool) + `posted_at`.

Placement (see §24 recommendation): the **immutable numeric snapshot** stays on `invoices`/`receipts`
(`exchange_rate`, `base_currency`, `base_total`/`base_amount` — unchanged); a small set of **source
columns** may be added to the transaction for fast display (`fx_source_category`,
`fx_decision_id`); the **full governance/provenance/history** lives in a normalized
`fx_booking_rate_decisions` table + audit log. Avoids duplication while keeping the accounting snapshot
authoritative and immutable.

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

Deviation measured as `abs(entered_rate - reference_baseline) / reference_baseline` where the baseline is
the eligible catalog rate, else the eligible Active reference rate. Proposed **safe default** bands
(all `[BUSINESS DECISION REQUIRED]`):

| Band | Default trigger | Behavior |
| --- | --- | --- |
| Informational | <= 2% | inline warning; reason optional; no approval |
| Minor | > 2% and <= 5% | mandatory reason; AR Supervisor approval; maker-checker |
| Major | > 5% and <= 25% | mandatory reason; Finance Manager approval; maker-checker |
| Blocked | > 25%, or rate <= 0, or both sources missing with no override justification | hard reject |

Additional dimensions to consider: reference staleness (default > 7 days -> escalate one band), and
transaction materiality (default: base_total/base_amount above a company-configured threshold -> escalate
one band). Exact numbers are business policy; implementation stores them as company-scoped configuration
(reuse `ar_system_config` pattern) rather than hard-coded constants.

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

## 17. Posted Transaction Immutability

- Posted `invoices.exchange_rate` / `receipts.exchange_rate` / `base_total` / `base_amount` and their
  journals remain **immutable** (already the case: posting snapshots the row rate).
- Later `fx_reference_rates` corrections and `exchange_rates` catalog edits **do not** mutate posted rows
  (verified: posting does not re-read catalog).
- Scheduler/provider sync **never** touches posted transactions (reaffirmed from 9D-B).
- **Correction after posting** (choose per scenario; never in-place mutation):
  - **Reverse and repost** — reverse the posted transaction (existing reversal path) and repost with the
    corrected governed rate; or
  - **Explicit adjustment / correction journal** — a compensating journal entry capturing the FX
    correction with full provenance and approval.
  - Recommended default: **reverse-and-repost for pre-allocation corrections; compensating adjustment
    journal for post-allocation corrections** (avoids unwinding downstream allocations). Both are audited
    and approval-gated; neither deletes history.

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
consumes the snapshot exactly as today. Regression tests (§33) must prove byte-identical realized-FX
behavior on a fixed dataset.

---

## 21. Import Compatibility

Import flows (CSV/XLSX invoice/receipt imports; receipt PDF/Image intake; auto-create draft; auto-post
boundary from `013_import_enable_auto_post.sql`) must **not bypass** booking-rate governance:
- imported rate absent -> catalog `resolveExchangeRate`; if missing -> row flagged, not silently posted;
- imported rate present and within Informational band -> accepted with provenance `source_category =
  MANUAL_OVERRIDE (import)`;
- imported rate beyond Informational band -> **queued for approval**, never auto-posted;
- batch approval supported via the same approval queue;
- provenance records the import origin (batch id / source file reference) where available.

Auto-post must respect the same approval gate: an import row requiring approval stays Draft/Pending.

---

## 22. Automation Compatibility

For automatic draft creation / posting / allocation:
- **clean candidate** (catalog or base parity, within Informational band) -> may proceed automatically;
- **stale reference** -> warn; do not auto-select reference; fall back to catalog or hold;
- **missing rate** -> hold (no fabrication, no auto-post);
- **override beyond threshold** -> hold for approval; never auto-post;
- **approval pending** -> hold.

Principle: automation may proceed only through the **Informational / NotRequired** path; anything needing
human judgment is queued. A reference rate merely existing never authorizes automatic financial mutation.

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
  **unchanged and authoritative** as the immutable accounting snapshot.
- Add two lightweight display columns to `invoices` and `receipts`: `fx_source_category TEXT`
  (nullable, backfilled to `CATALOG`/`BASE_PARITY` for existing rows) and `fx_decision_id UUID` (nullable
  FK to the decision table).
- Add a normalized, append-mostly `fx_booking_rate_decisions` table holding the full provenance + override
  + approval fields (§11), with `decision_version` for optimistic concurrency and a `status` lifecycle
  (`Draft` -> `Pending` -> `Approved`/`Rejected` -> `Posted`).
- Record governance events in the **existing append-only audit log** (005 pattern), not a new store.
- Selection/override/approval/posting-gate logic lives in **PostgreSQL RPCs** (transaction-safe, service
  role) invoked by Edge Functions; reads via company-scoped RLS.

This satisfies all 20 acceptance questions (§34) while preserving backward compatibility and immutability.

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
  `fx_reject_booking_decision(...)`, and a posting-time guard used by `post_invoice`/`post_receipt`
  (`fx_assert_booking_decision_postable(...)`).

**No direct financial-table mutation API is exposed.** All mutations go through RPCs that own the
transaction boundary; frontend hooks call Edge Functions only.

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
| Post-posting correction workflow | no | initiate | initiate+approve per band | no | no |

`*` subject to existing posting permissions. **System Admin is intentionally NOT a financial approver**
(config-only), and Auditor is read-only. Maker-checker: the submitter is excluded from approving their own
decision. Items dependent on business policy are `[BUSINESS DECISION REQUIRED]` (see §9).

---

## 27. RLS / Tenant Isolation

- `fx_booking_rate_decisions`: SELECT gated by `rls_has_company_access` (company-scoped); no direct
  client INSERT/UPDATE/DELETE (writes only via service-role RPC).
- New transaction display columns inherit existing invoice/receipt RLS.
- Audit rows: append-only (existing triggers), company-scoped reads.
- Cross-company access denied; anon denied; authenticated direct writes denied.
- Helper RPCs `service-role`-only (repeat the 020 privilege-hardening pattern for any new
  `SECURITY DEFINER` function; explicit `REVOKE ... FROM PUBLIC/anon/authenticated`).

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

## 29. Audit Trail

Reuse the existing append-only audit infrastructure (005). Events:
`rate_suggested`, `source_selected`, `override_requested`, `override_edited`, `override_approved`,
`override_rejected`, `booking_rate_finalized`, `transaction_posted`, `correction_requested`,
`correction_approved`, `correction_rejected`, `adjustment_created`. Each event records:
actor, role, company_id, transaction_type+id, source_category, source_rate/suggested_rate, selected_rate,
before/after, deviation, reason, approval linkage, timestamp. Audit rows are immutable (UPDATE/DELETE
prevented by existing triggers).

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

- Next available number is **022** (017-021 exist; **do not edit 017-021**).
- Proposed sequence:
  - `database/022_fx_booking_rate_governance.sql` — create `fx_booking_rate_decisions`; add
    `fx_source_category` + `fx_decision_id` to `invoices` and `receipts`; indexes; RLS policies; backfill
    existing rows to `CATALOG`/`BASE_PARITY`; **no change to posted numeric snapshots**.
  - `database/023_fx_booking_rate_rpcs.sql` (optional split) — `SECURITY DEFINER` RPCs
    (select/override/approve/reject/postable-guard) with explicit privilege hardening; update
    `post_invoice`/`post_receipt` to call the postable-guard.
  - Optional `024` — company-scoped deviation/materiality config (or extend `ar_system_config`).
- All forward-only, additive; no financial recomputation of existing posted rows; no `exchange_rates` /
  `fx_reference_rates` schema change; no privilege weakening.

---

## 32. File-Level Change Map (indicative; implementation task only)

| File | Action | Responsibility |
| --- | --- | --- |
| `database/022_fx_booking_rate_governance.sql` | create | decision table + txn display columns + RLS + backfill |
| `database/023_fx_booking_rate_rpcs.sql` | create | governed RPCs + posting guard integration + privilege hardening |
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
- **Posting:** booked snapshot created; provenance stored; later reference correction does not mutate
  posted snapshot; later `exchange_rates` edit does not mutate posted snapshot.
- **Allocation regression:** realized FX byte-identical on a fixed dataset; same-currency rule preserved;
  reversal preserved; bounced cheque preserved; discount/short-payment branches unaffected.
- **Security:** cross-company denied; direct client mutation denied; new RPCs `service-role`-only.
- **Financial zero-regression:** existing posting/allocation/journal semantics preserved (fingerprint
  before/after).

Separate evidence classes: synthetic test data vs real reference-rate data vs financial before/after
fingerprints (do not blend).

---

## 34. Mandatory Staging Runtime Matrix

1. role matrix (all capabilities in §26) [R]
2. catalog rate selection [M]
3. reference suggestion surfaced (read-only) [M]
4. governed reference selection [M]
5. manual override + mandatory reason [M]
6. deviation band computation (Informational/Minor/Major/Blocked) [M/S]
7. approval (Minor -> Supervisor) [M]
8. approval (Major -> Finance Manager) [M]
9. rejection path [M]
10. maker-checker (self-approval blocked) [R]
11. edit-after-approval returns to Pending [R]
12. posting gate re-verifies approval transactionally [R]
13. posted snapshot immutable to later reference correction [M/R]
14. posted snapshot immutable to later catalog edit [M/R]
15. post-posting correction (reverse-repost / adjustment journal) [M]
16. audit trail completeness (all §29 events) [M]
17. tenant isolation / RLS (cross-company denied) [R]
18. RPC privilege (`service-role`-only) [R]
19. import compatibility (governance not bypassed; approval queue) [M]
20. automation compatibility (holds on stale/missing/over-threshold/pending) [M]
21. allocation realized-FX regression (byte-identical) [R]
22. reversal / bounced-cheque regression [R]
23. financial before/after fingerprint (no unintended mutation) [R]
24. concurrency races (approve/edit/post) [R]
25. MYR base-currency preflight for reference selection (mirror 9D-B) [M]

Key: [M] mandatory real staging proof, [S] safely simulated, [R] runtime regression proof.

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
covering: implementation proof; migration apply proof (live object/constraint verification); role matrix;
selection/override/approval/rejection; immutability proofs (2 kinds); allocation regression; financial
before/after fingerprints; import + automation compatibility; concurrency; cleanup; deviations/limitations.
Separate synthetic / real-reference / financial evidence classes.

---

## 37. Risks

| ID | Risk | Disposition |
| --- | --- | --- |
| C1 | Governance changes silently alter realized FX. | Byte-identical allocation regression is mandatory (§33). |
| C2 | Ungoverned override path remains reachable (imports/legacy callers). | Route all rate entry through governance; import path explicitly covered (§21). |
| C3 | Approval race produces inconsistent provenance. | Optimistic version + row locks + transactional post gate (§28). |
| C4 | Business thresholds unknown. | Safe defaults + `[BUSINESS DECISION REQUIRED]` flags (§9, §14). |
| C5 | Catalog/reference confusion (Layer collapse). | Source model + provenance categories; no auto-promotion (§5, §10). |
| C6 | Backward compatibility break for existing invoice/receipt creation. | Additive migration; feature flag; catalog default unchanged (§31, §35). |
| C7 | Posted-record correction misused as in-place mutation. | Only reverse-repost / adjustment journal; snapshots immutable (§17). |

---

## 38. Open Decisions

- All `[BUSINESS DECISION REQUIRED]` items in §9 and §14.
- Whether to split migrations 022/023 or combine (default: split for reviewability).
- Whether promotion into `exchange_rates` (Option C) is enabled at all in 9D-C (default: off).
- Whether a shared `fx-booking` Edge Function is warranted vs extending `invoices`/`receipts` (assess at
  implementation).
- Exact company-config storage for thresholds (`ar_system_config` extension vs new table).

None of these change the locked architectural boundaries (§5) or the immutability/zero-regression
guarantees.

---

## 39. Acceptance Criteria

9D-C is complete only when: booking-rate source hierarchy is explicit and enforced; reference selection is
governed and never automatic; per-transaction provenance is stored; overrides are role-gated with
mandatory reason, deviation bands, and maker-checker approval; posted snapshots are immutable to later
catalog/reference changes; post-posting corrections are governed (reverse-repost/adjustment, never
in-place); concurrency races are prevented; invoice/receipt/import/automation flows all route through
governance; realized-FX and allocation behavior is byte-identical (regression proven); RLS/tenant
isolation and `service-role`-only RPC privilege hold; staging matrix (§34) passes; evidence classes are
not blended; Closure Review passes. No production action occurs.

---

## 40. Explicit Non-Goals / Production Boundary

Batch 9D-C must NOT: deploy to production; run a production migration; change the staging/production
scheduler, Vault, or pg_cron/pg_net; perform a production provider call; roll out booking governance to
production; or mutate production financial data. **Production rollout is owned by Batch 9D-E.** Multi-
currency UX aggregation is **9D-D**. This plan authorizes only detailed planning; implementation requires
Codex Batch 9D-C Plan Second Review followed by explicit user implementation approval.

---

## 41. Relationship to the master plan

This sub-plan sits under master `§0` (authoritative order `9D-A (CLOSED) -> DG-1 -> 9D-B (CLOSED) -> 9D-C
-> 9D-D -> 9D-E`). The master plan remains the authoritative phase/order document; this file holds the
implementation-ready detail for 9D-C. No master-plan architecture, order, or DG-1 lock is changed by this
file.
