# Batch 9D-D — Multi-Currency UX and Monetary Aggregation Correctness (Implementation Plan)

> **Status:** PLANNING / NOT IMPLEMENTED.
> **Type:** Detailed implementation plan (planning task only — no source/migration/Edge-Function/scheduler change; no staging mutation; no production action).
> **Predecessors:** Batch 9D-A (provider-neutral FX reference foundation) — CLOSED; DG-1 — LOCKED; Batch 9D-B (real provider integration + scheduler staging) — CLOSED; Batch 9D-C (booking-rate provenance and override governance) — CLOSED at staging-verification level.
> **Current next gate:** Codex Batch 9D-D Plan Review.
> **Production rollout:** reserved for Batch 9D-E. Batch 9D-D performs **no** production action.

---

## 0. Purpose and one-paragraph summary

Batches 9D-A through 9D-C built the FX *data and governance* substrate: a provider-neutral reference layer
(`public.fx_reference_rates`), a real provider + scheduler foundation, and a full booking-rate provenance /
override / approval governance model (`public.fx_booking_rate_decisions`, decision lineage, immutable posted
snapshots, import origin). **Batch 9D-D closes the loop on the presentation and aggregation layer**: it makes
every monetary surface (invoices, receipts, allocations, customers, imports, receipt PDF/Image review, reports,
and dashboard) display multi-currency amounts *correctly and auditably*, and it makes every total *financially
correct* by never summing mixed transaction currencies as if they were one number. The work is predominantly
**frontend + read-only backend aggregation**; it introduces **no** new posting path, mutates **no** posted
snapshot, and enables **no** automation.

---

## 1. Discovery baseline (as-found, grounding this plan)

The plan is grounded in the current `main` codebase (HEAD `86abd7c` at authoring time). Key observed facts:

### 1.1 Data model already carries the fields we need to display

- `frontend/src/types/index.ts` — `Invoice` and `Receipt` already carry `currency`, `exchange_rate`,
  `base_currency`, `total_amount` / `receipt_amount`, and `base_total` / `base_amount`
  (`types/index.ts:177-183`, `:237-241`). Customer summary carries `base_currency` (`:57`) and
  `default_currency` (`:139`).
- The DB governance columns from Batch 9D-C — `fx_source_category`, `fx_decision_id` on transaction rows, plus
  the `fx_booking_rate_decisions` decision record (status, `decision_version`, `booked_rate`, source category,
  import origin) — **exist in the database and Edge layer but are NOT yet surfaced in the frontend types or
  API display contracts.** Surfacing them (read-only) is a primary 9D-D deliverable.

### 1.2 Transaction detail UX is currency-aware but shallow

- `frontend/src/app/(dashboard)/invoices/[id]/page.tsx` shows `Currency (Rate: <exchange_rate>)`
  (`:204`) and shows the base-currency total **only when `currency !== "MYR"`** (`:308-311`). It does **not**
  show FX source category, booking-decision status, or decision version.
- `frontend/src/lib/utils.ts` exposes `formatCurrency(amount, currency = "MYR")` via `Intl.NumberFormat`
  (`utils.ts:16`). The **MYR default is a latent correctness hazard**: any call site that omits the currency
  argument silently renders a foreign amount with an "MYR" label. 9D-D will require explicit currency at every
  monetary call site (see §1.6, lint rule below).

### 1.3 Aggregation gap: reports sum transaction currency across rows

- `backend/supabase/functions/reports/service.ts` computes report totals by summing **transaction-currency**
  columns directly across heterogeneous rows, with **no currency grouping**:
  - Aging summary: `rows.reduce((s, r) => s + Number(r.total_ar_balance ?? 0), 0)` (`service.ts:191-192`).
  - Aging detail buckets: sum of `total_amount` per bucket (`:234`, `:238`).
  - Statement / activity: `invTotal`, `cnTotal`, `rctTotal` reduce over `total_amount` / `receipt_amount`
    (`:396-398`, `:431-459`).
  This is correct **only** for a single-currency company. For a multi-currency company it silently adds
  `USD + SGD + MYR` into one meaningless number. **This is the central correctness defect Batch 9D-D fixes.**

### 1.4 Dashboard is already base-normalized (partial precedent to follow)

- `getDashboardMetrics` calls the `get_ar_dashboard_metrics` RPC and returns a **base-currency contract** with
  explicit `meta.base_currency` (`service.ts:507-545`; `types/index.ts:406-429` documents that all `*_base`
  fields are in company base currency). Deprecated transaction-currency aliases still exist
  (`types/index.ts:509-511`). 9D-D adopts this base-normalized pattern as the model for the *other* reports and
  formally documents/deprecates the mixed-currency aliases rather than removing them (no breaking change).

### 1.5 Frontend surface inventory (routes that render money)

`invoices` (list/new/[id]/import), `receipts` (list/new/[id]/import), `allocations`, `customers` (list/[id]),
`credit-notes`, `journal-entries`, `reports/aging`, `reports/outstanding`, `reports/invoices`,
`reports/receipts`, dashboard (`(dashboard)/page.tsx` + `components/features/dashboard/*` charts), and import
review flows (`components/features/imports/*`, `hooks/use-import.ts`, `hooks/use-ocr-import.ts`).

### 1.6 Edge Functions in scope for read-contract review

`invoices`, `receipts`, `allocations`, `reports`, `imports`, `customers`, `lookups` (currency list),
`journal-entries`. FX-specific functions (`fx-rates`, `fx-rate-sync`) are **reference/governance** surfaces and
are **not** re-architected here (read-only display reuse only).

---

## 2. Design principles (locked for 9D-D)

1. **Never sum across currencies without normalization.** Any total spanning more than one transaction currency
   MUST be presented either (a) as per-currency subtotals (grouped), or (b) as a base-currency normalized total
   with an explicit base-currency label and an explicit "normalized at booked rate" annotation. Never a bare
   mixed sum.
2. **Base normalization uses the transaction's own booked snapshot rate — never a live/current rate.** Base
   amounts already stored (`base_total`, `base_amount`) are the immutable snapshot values from posting; 9D-D
   displays those, and derives group/report base totals by summing those *stored base amounts*. 9D-D does **not**
   recompute base from any current reference rate.
3. **Read-only.** All new backend work is read-only aggregation (views / read RPCs / response shaping). No
   write, no posting, no snapshot mutation, no decision-state change.
4. **Auditability without noise.** Surface FX provenance (source category, decision status/version, rate) where
   it aids the user's decision or audit; keep raw internal JSON / event logs behind an audit/admin affordance,
   not on every row.
5. **Explicit currency at every money render.** No implicit-MYR formatting. `formatCurrency` call sites must
   pass the row's own currency; add a lint/guard to prevent regressions.
6. **Role-aware, isolation-preserving.** Every new read path enforces existing company isolation, role
   visibility, AR-Clerk assignment filtering, and Auditor read-only. No client-side-only gating of financial
   truth.
7. **No breaking API changes.** Extend response contracts additively; keep deprecated aliases; version nothing
   destructively.

---

## 3. Currency display correctness (requirement §1)

### 3.1 Canonical monetary cell

Introduce a single presentational contract for a monetary value, reused everywhere:

```
MoneyCell {
  amount            // transaction-currency amount
  currency          // ISO code of the transaction
  base_amount?      // company base-currency snapshot amount (when currency != base)
  base_currency?    // company base ISO code
  exchange_rate?    // booked snapshot rate (from→to)
  fx_source_category?   // BASE_PARITY | CATALOG | REFERENCE_SELECTED | MANUAL_OVERRIDE | LEGACY_UNVERIFIED
  fx_decision_status?   // NotRequired | Pending | Approved | Rejected | Blocked | Superseded | Posted
  decision_version?
}
```

- **Primary line:** `formatCurrency(amount, currency)` — always explicit currency.
- **Secondary line (only when `currency != base_currency`):** `≈ formatCurrency(base_amount, base_currency)`
  with a tooltip: `Booked at <rate> (<from>→<to>), source <fx_source_category>`.
- **Provenance chip (where relevant):** small badge showing `fx_source_category` and, when the decision is not
  `Posted`/`NotRequired`, the `fx_decision_status`. Chip is suppressed for same-currency `BASE_PARITY` rows to
  avoid noise.

### 3.2 Per-surface display rules

| Surface | Txn amount | Base amount | Snapshot rate | Source category | Decision status |
| --- | --- | --- | --- | --- | --- |
| Invoice detail | Yes | Yes (when ≠ base) | Yes | Yes (chip) | Yes (chip, when not Posted/NotReq) |
| Invoice list rows | Yes | Optional column (toggle) | Tooltip | Chip | Chip when actionable |
| Receipt detail | Yes | Yes (when ≠ base) | Yes | Yes | Yes |
| Receipt list rows | Yes | Optional column | Tooltip | Chip | Chip when actionable |
| Allocation view | Both invoice & receipt legs in their own currencies; realized-FX line in base | Yes | Yes (both legs) | — | — |
| Customer balance / [id] | Per-currency subtotals + base rollup | Yes | — | — | — |
| Reports (all) | Per §4 grouping | Yes | — | Summarized | Summarized |
| Import review rows | Yes | Derived preview only | Explicit CSV rate shown | Yes (esp. MANUAL_OVERRIDE) | Hold/HeldGovernance state |
| Receipt PDF/Image review | Draft fields only | Preview only | Draft | Draft | Draft (no post) |

### 3.3 Allocation-specific rule

Allocations are same-currency by construction (per locked 9D boundary: allocation currency = invoice currency =
receipt currency). The allocation UI must therefore:
- Render invoice leg and receipt leg each in **their own** transaction currency.
- Render **realized FX gain/loss** (`alloc × (receipt_rate − invoice_rate)`) as a distinct **base-currency**
  line, explicitly labeled "Realized FX (base)", never mixed into a transaction-currency subtotal.

---

## 4. Aggregation correctness (requirement §2)

### 4.1 The rule

For any total that can span multiple transaction currencies, the response and the UI MUST distinguish:

1. **Transaction-currency group totals** — one subtotal per currency (`{ currency, subtotal, count }[]`).
2. **Base-currency normalized total** — a single number in company base currency, summed from the **stored
   snapshot base amounts** (`base_total` / `base_amount`), with `base_currency` label and a "normalized at
   booked rate" annotation.
3. **Display labels** — every total carries its currency; a base-normalized total is visibly marked as such.
4. **Filters** — a currency filter (All / specific ISO) on every multi-currency report and list.
5. **Drilldowns** — clicking a group subtotal drills into the rows of that currency only; clicking the base
   total drills into all contributing rows with their per-row base amounts shown.

### 4.2 Backend shape (read-only aggregation contract)

Extend report responses additively to a grouped shape, e.g.:

```
{
  by_currency: [ { currency, subtotal, count }, ... ],
  base_total:  { base_currency, amount, normalization: "booked_snapshot" },
  meta: { multi_currency: boolean, base_currency }
}
```

Single-currency companies get a `by_currency` array of length 1 and an equal `base_total` — UI can collapse the
grouping when `multi_currency === false` so existing single-currency screens look unchanged.

### 4.3 Reports requiring this change (from §1.3)

`reports/service.ts` aging summary (`:191`), aging detail buckets (`:234-238`), statement/activity totals
(`:396-398`, `:431-459`), plus the outstanding and receipts report paths. Each mixed `reduce` over a
transaction-currency column is replaced by grouped accumulation keyed by currency **plus** a parallel sum over
the stored base column. **No** row-level financial value is recomputed; only the aggregation shape changes.

### 4.4 Explicit worked example (acceptance anchor)

Given invoices `USD 100` (rate 1.35, base MYR 135), `SGD 100` (rate 3.10, base MYR 310), `MYR 100` (base MYR
100): the report MUST show `by_currency = [USD 100, SGD 100, MYR 100]` and `base_total = MYR 545`, and MUST
**never** render `300` as a single "total". This exact case is a required staging test (see §12).

---

## 5. Base currency handling (requirement §3)

- **Company base currency** is a company-level attribute already threaded as `base_currency` on transactions and
  as `meta.base_currency` on the dashboard contract. 9D-D treats it as the single source of truth for
  normalization and never infers base from row data.
- **Consistency requirement:** base currency is displayed identically across invoices, receipts, allocations,
  journal views, dashboard, reports, and imports — same ISO label, same formatting via `formatCurrency`, same
  "normalized at booked rate" annotation wording. A shared `useBaseCurrency()` hook / context supplies it so no
  screen hardcodes `"MYR"`.
- **Parity case:** when `currency === base_currency`, `exchange_rate` is `1.0` and no secondary base line or FX
  chip is shown (avoids noise; consistent with `BASE_PARITY`).
- **The MYR-default hazard (§1.2) is retired:** `formatCurrency`'s default remains for backward-compat but 9D-D
  adds a guard requiring explicit currency at monetary call sites; base-currency rendering goes through the
  shared hook, not the literal `"MYR"`.

---

## 6. FX snapshot UX (requirement §4)

Users see booked FX snapshot information as follows:

- **Always available (on detail views):** `booked_rate` (= `exchange_rate`), `from_currency`, `to_currency`,
  `source_category`, `approval_status`, `decision_version`.
- **State surfacing:** stale / missing / reference-selected / manual-override / pending / rejected states are
  shown as a labeled chip + tooltip, using the 9D-C source categories and decision statuses. Posted immutable
  snapshots are labeled "Booked (immutable)".
- **Noise control:** on list rows, only the source-category chip and (if actionable) the decision-status chip
  appear; full rate/decision lineage is on the detail view or behind an "FX details" disclosure.
- **Auditability preserved:** the decision id / version and the append-only decision events remain reachable
  from the detail view's "FX details" / audit affordance (read-only), so an Auditor can trace provenance without
  the row grid being cluttered.
- **Read-only guarantee:** none of these surfaces can mutate a snapshot or a decision; posted-FX immutability
  (9D-C trigger) remains the DB-level backstop.

---

## 7. Override and approval UX (requirement §5)

### 7.1 Status treatment (visual)

| Decision status | Visual | User meaning |
| --- | --- | --- |
| NotRequired | Neutral / hidden chip | Same-currency or within informational band; no approval needed |
| Pending | Amber "Pending approval" | Awaiting maker-checker approval; not postable |
| Approved | Green "Approved" | Approved booking rate; postable |
| Rejected | Red "Rejected" | Cannot post with this decision |
| Blocked | Red "Blocked (>5%)" | Deviation beyond max band; hard-stop |
| Superseded | Grey "Superseded (v<n>)" | Replaced by a later decision version (lineage link) |
| Posted | Slate "Booked (immutable)" | Snapshot locked to a posted transaction |

### 7.2 Role-aware actions (display + affordance only; enforcement stays server-side)

| Role | Can see | Can act (approve/reject) | Notes |
| --- | --- | --- | --- |
| AR Clerk | Own-assigned txns + FX chips | Propose/submit for approval only | Cannot approve own override |
| AR Supervisor | Company txns | Approve Minor band (>0.50–2.00%) | Maker-checker enforced |
| Finance Manager | Company txns | Approve Major band (>2.00–5.00%) | Highest financial approver |
| Auditor | All (read-only) | None | Read-only; sees full lineage |
| System Admin | Config surfaces | None (config-only) | Not a financial approver |

- The UI **renders** the action buttons only for roles/bands the server would accept, but the server remains the
  authority (transaction-safe post-time authorization from 9D-C §28A). No client-only gate is trusted.
- Band thresholds and stale threshold are the 9D-C locked defaults (Informational ≤0.50%, Minor >0.50–2.00% →
  AR Supervisor, Major >2.00–5.00% → Finance Manager, Blocked >5.00%; stale reference 7 calendar days).

---

## 8. Import UX (requirement §6)

Import review/results must display:
- **Explicit `exchange_rate` from CSV/XLSX** — shown verbatim as the user-supplied rate, clearly labeled
  "from import".
- **`fx_override_reason`** — shown when present.
- **`MANUAL_OVERRIDE` hold state / `HeldGovernance`** — a distinct held banner/row state indicating the import
  row is parked pending governance (not posted, not silently accepted).
- **Fail-closed validation errors** — surfaced as explicit per-row errors (e.g., out-of-band, missing decision,
  non-parity base rate anomaly) with the row shown as blocked, not silently dropped.
- **`import_origin` traceability** — shown as a compact provenance tag (source file / batch) where it aids
  audit, on the review/detail view.
- **Noise control:** raw internal JSON is **not** shown on normal review rows; it is available only behind an
  audit/admin disclosure.
- **Boundary:** import display is read/preview + governance-hold only; 9D-D adds **no** new import posting
  behavior and preserves 9D-C import-origin provenance and fail-closed semantics.

---

## 9. Receipt PDF/Image UX (requirement §7)

- PDF/Image intake/review shows multi-currency fields (currency, entered/estimated amount, draft rate, draft
  base preview) **within the existing manual-review / draft boundary only**.
- **Batch 9C boundary preserved:** manual review / draft only; **no** silent OCR provider expansion; **no**
  auto-post; **no** allocation; **no** journal mutation. All rate/base values on this surface are draft previews
  and carry a "Draft — not booked" label until the normal (manual) posting path is used.
- No provider call is added; no OCR capability is expanded; this is display-only alignment with the multi-currency
  presentation contract.

---

## 10. Reports and dashboard (requirement §8)

All items below adopt the §4 grouped + base-normalized contract:

- **AR aging** — buckets show per-currency subtotals and a base-normalized grand total; currency filter added.
- **Outstanding balance** — per-currency and base rollup; drilldown by currency.
- **Receipts summary** — per-currency receipt totals + base rollup.
- **Allocation reports** — legs shown in own currency; realized FX summarized in base.
- **Customer exposure** — per-customer, per-currency exposure with base rollup (a customer holding USD + MYR
  invoices shows both, plus base total).
- **Dashboard KPIs** — already base-normalized (`get_ar_dashboard_metrics`); 9D-D formalizes the base label,
  documents/deprecates mixed aliases, and ensures no KPI silently mixes currencies.
- **Charts** — value axes normalized to base currency with an explicit base-currency axis label; per-currency
  breakdown available on hover/drilldown where meaningful.
- **Filters** — currency filter across multi-currency reports.
- **Exports** — CSV/print exports carry currency columns and both per-currency and base totals; an export must
  never emit a bare mixed-currency total.

---

## 11. API contracts (requirement §9)

Changes are **additive, read-only, non-breaking**:

| Edge Function | Change | Breaking? |
| --- | --- | --- |
| `reports` | Add grouped `by_currency` + `base_total` + `meta.multi_currency` to aging/outstanding/receipts/statement responses | No (additive; keep existing fields) |
| `invoices` | Add read-only `fx_source_category`, `fx_decision_status`, `decision_version` to detail/list read contract | No (additive) |
| `receipts` | Same additive FX display fields | No |
| `allocations` | Expose realized-FX (base) and both-leg currency fields in read contract | No |
| `imports` | Surface `fx_override_reason`, hold/`HeldGovernance` state, `import_origin`, fail-closed errors in review payload | No (display of existing governance state) |
| `customers` | Add per-currency exposure grouping + base rollup to balance read | No |
| `lookups` | Confirm currency list source for filters (reuse) | No |
| dashboard (`reports`) | Formalize base contract, mark mixed aliases deprecated (kept) | No |

No endpoint is removed or renamed; deprecated transaction-currency aliases remain for backward compatibility.

---

## 12-boundary. Database / RPC boundaries (requirement §10)

- **Prefer read-only aggregation views / read RPCs.** Where grouped currency totals are cheaper/cleaner in SQL,
  add **read-only** views or `SECURITY INVOKER`-respecting read RPCs that (a) group by currency and (b) sum the
  **stored** base columns. These do not write and do not touch posted snapshots.
- **No mutation of existing posted snapshots.** Aggregation reads `base_total` / `base_amount` /
  `exchange_rate` as already stored; never recomputes or rewrites them.
- **No production migrations yet.** Any candidate view/RPC is specified in this plan and, if approved,
  authored/applied by Codex in staging during implementation — **not** created in this planning task. Migration
  numbering would continue after `026` (next free is `027`), staging-first, per the established gate flow.
- **RLS parity:** new views/RPCs must enforce the same company-isolation and role filters as existing report
  paths (see §11-sec). Prefer functions that run under the caller's context and reuse existing helper predicates
  rather than bypassing RLS.

---

## 11-sec. Security / RLS (requirement §11)

Every new read endpoint / view / RPC preserves:
- **Company isolation** — all reads filtered by `company_id = auth.companyId`; no cross-tenant leakage in grouped
  aggregates (group keys never span companies).
- **Role visibility** — reuse existing `requireAnyRole` / dashboard scope roles; grouped reports honor the same
  `company` vs `assigned` scope split already used by `get_ar_dashboard_metrics` (`service.ts:524-527`).
- **AR Clerk assignment filtering** — clerks see only assigned customers' rows in both per-currency subtotals and
  base totals (aggregates computed over the filtered set, not the full company set).
- **Auditor read-only** — Auditor can view all provenance/lineage but no action affordance renders and no write
  path exists.
- **No client-side bypass** — currency grouping/normalization is computed server-side (view/RPC/Edge), not
  reconstructed from an unfiltered client payload; the client only renders what the authorized read returns.

---

## 12. Testing plan — staging test matrix (requirement §12)

All tests are **staging-only, read-oriented**, and must assert **no financial mutation** results from viewing.
(No production. No auto-post. No allocation enablement.)

| # | Scenario | Expected |
| --- | --- | --- |
| T-01 | Single-currency company data | Grouping collapses; screens visually unchanged; totals correct |
| T-02 | Multi-currency invoices (USD+SGD+MYR) | Per-currency subtotals + base total; no bare mixed sum (§4.4 anchor) |
| T-03 | Multi-currency receipts | Per-currency receipt subtotals + base rollup |
| T-04 | Base-currency parity txn | Rate 1.0; no secondary base line; no FX chip |
| T-05 | Foreign currency with CATALOG decision | Source chip = CATALOG; base line shown; rate correct |
| T-06 | Foreign currency with MANUAL_OVERRIDE | Override chip; base line; decision status surfaced |
| T-07 | Pending approval display | Amber "Pending"; not postable; correct role affordance |
| T-08 | Rejected / Blocked display | Red state; no post affordance; band label correct |
| T-09 | Superseded decision | Grey "Superseded (v_n)"; lineage link to current version |
| T-10 | Imports with explicit FX | CSV rate shown "from import"; override reason; HeldGovernance state |
| T-11 | Import fail-closed error | Row blocked with explicit error; not silently dropped |
| T-12 | Reports grouped vs base totals | Both present; drilldown by currency works; export carries both |
| T-13 | Dashboard aggregation correctness | KPIs base-normalized; no mixed-currency KPI |
| T-14 | Allocation realized FX | Legs in own currency; realized FX shown as base line only |
| T-15 | Role-based visibility | Clerk assignment filter; Supervisor/FM bands; Auditor read-only; Admin config-only |
| T-16 | No-mutation proof on read-only pages | Before/after row + decision snapshots identical after viewing all surfaces |
| T-17 | Receipt PDF/Image multi-currency draft | Draft fields only; "Draft — not booked"; no OCR expansion, no post, no allocation |
| T-18 | Explicit-currency render guard | No monetary cell renders a foreign amount with an MYR label (§1.2 hazard retired) |

**Test authoring/execution ownership:** per the project's division of labor, Codex authors and runs backend/RPC
and staging tests during implementation; Claude produces the frontend manual smoke evidence and the evidence
document. This plan defines the matrix; it does **not** create tests now.

---

## 13. Evidence requirements (requirement §13)

On implementation (later gate, not now), create/update:
- `docs/evidence/SPRINT_BATCH_9D_D_MULTI_CURRENCY_UX_AND_AGGREGATION_CORRECTNESS_IMPLEMENTATION_EVIDENCE.md` —
  primary evidence file: migration/RPC list (if any), the §4.4 worked-example proof, the full §12 matrix results,
  role-visibility proofs, no-mutation before/after proofs, and a final safety block.
- **Frontend manual smoke:** screenshots of invoice/receipt detail (FX chip + base line), a multi-currency
  report showing per-currency + base totals, dashboard KPIs with base label, and an import review row showing
  HeldGovernance + CSV rate.
- Update the master plan §0.0 current-state and this sub-plan's status on each gate transition.

---

## 14. Out of scope (requirement §14 — explicit)

- **Production rollout** (reserved for Batch 9D-E).
- **Provider replacement / provider re-architecture** (9D-B foundation stays as-is).
- **Scheduler redesign** (the ACTIVE 9D-B staging scheduler is untouched).
- **Automatic allocation enablement** (`POST /allocations/auto` stays `AUTO_ALLOCATION_DISABLED`).
- **OCR provider expansion** (9C manual-review/draft boundary preserved).
- **Bank charge implementation** (documented capability gap; not implemented unless separately approved).
- **Any mutation of posted transaction snapshots or booking decisions** (posted-FX immutability preserved).
- **Recomputing base amounts from current/live rates** (display stored snapshot base only).

---

## 15. Locked boundaries carried forward (must remain true)

- `fx_reference_rates` (reference-only) ≠ `exchange_rates` (booking/catalog source) ≠ invoice/receipt booked
  snapshots (immutable transaction truth). 9D-D changes none of these; it only *reads and displays* them.
- Reference corrections MUST NOT mutate posted transaction snapshots.
- Scheduler MUST NOT silently populate booking rates.
- Posted booked-FX snapshots are immutable (DB trigger backstop).
- Reference-selected / manual-override / stale / missing / pending / rejected decisions MUST NOT auto-post.
- `/allocations/auto` remains disabled.
- Production rollout remains Batch 9D-E.

---

## 16. Acceptance criteria (Plan Review checklist)

1. Every monetary surface displays transaction amount + (when ≠ base) base amount + snapshot rate + source
   category + decision status where relevant (§3).
2. No total ever sums mixed transaction currencies as one number; all multi-currency totals are grouped and/or
   base-normalized from stored snapshot base amounts (§4, §4.4 anchor).
3. Base currency is shown consistently across all eight surface families via a shared source of truth (§5).
4. FX snapshot info is auditable without row-grid noise; posted snapshots labeled immutable (§6).
5. Override/approval statuses and role-aware affordances match 9D-C governance and remain server-enforced (§7).
6. Import review surfaces explicit CSV rate, override reason, HeldGovernance, fail-closed errors, and origin —
   no raw JSON on normal rows (§8).
7. PDF/Image review respects the 9C draft boundary (§9).
8. Reports/dashboard/charts/exports are financially correct and never emit a bare mixed total (§10).
9. All API changes are additive and non-breaking (§11).
10. New DB work (if any) is read-only, RLS-preserving, snapshot-non-mutating, and not created during planning
    (§12-boundary, §11-sec).
11. Staging test matrix (§12) is complete and includes explicit no-mutation and explicit-currency-render proofs.
12. Out-of-scope items (§14) and locked boundaries (§15) are honored.

---

## 17. Next gate

**Codex Batch 9D-D Plan Review.** No implementation, migration, deployment, provider, scheduler, or production
action is authorized by this document. Batch 9D-D is **PLANNING / NOT IMPLEMENTED**.
