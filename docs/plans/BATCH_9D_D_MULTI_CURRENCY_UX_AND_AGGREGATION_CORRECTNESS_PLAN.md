# Batch 9D-D — Multi-Currency UX and Monetary Aggregation Correctness (Implementation Plan)

> **Status:** PLANNING COMPLETE — CODEX PLAN RE-REVIEW PASSED — IMPLEMENTATION NOT STARTED. Review history:
> Codex Batch 9D-D Plan Review returned *FIX REQUIRED — PLAN AMENDMENT REQUIRED*; Claude Code amendments
> completed; Codex Batch 9D-D Plan Re-Review returned *PASS — BATCH 9D-D PLAN RE-REVIEW PASSED* (see §A
> Amendment Record). **Batch 9D-D implementation approval: NOT GRANTED.**
> **Type:** Detailed implementation plan (planning only — no source/frontend/migration/database/Edge-Function
> change; no staging mutation; no production action; no deploy; no scheduler/Vault/provider change).
> **Predecessors:** Batch 9D-A (provider-neutral FX reference foundation) — CLOSED; DG-1 — LOCKED; Batch 9D-B
> (real provider integration + scheduler staging) — CLOSED; Batch 9D-C (booking-rate provenance and override
> governance) — CLOSED at staging-verification level.
> **Current next gate:** **User Batch 9D-D Implementation Approval Decision.**
> **Production rollout:** reserved for Batch 9D-E. Batch 9D-D performs **no** production action.
> **Environment:** staging Supabase `gcdsdyegwjdcskpukqlq`; production Supabase `kusseuycqgdilychphpq` (untouched);
> production frontend `https://account-receivable-module.vercel.app/` (untouched).

---

## A. Amendment record (Codex Plan Review response)

Codex Plan Review returned **FIX REQUIRED — PLAN AMENDMENT REQUIRED**. This revision resolves all ten required
amendments, grounded in read-only repository inspection:

1. Draft vs Posted base-amount semantics corrected (§3.3, §3.4) + regression test.
2. Aggregation inventory expanded beyond `reports/service.ts` and classified per site (§1.5, §6.3).
3. Original booked totals separated from current mutable balances; current base balance made a
   backend-authoritative derived/stored contract (§6.1, §6.2).
4. Allocation wording replaced with the confirmed backend invariant (`BR-REC-003`, `forex_gain_loss`) (§7).
5. Import UX and provenance restored as an independent section (§5A); currency precision / supported-currency
   policy resolved (§5B); old open question R-5 replaced by a concrete Codex validation item (§15).
6. Existing canonical DB/decision fields mapped vs proposed additive response fields (§9).
7. Decision-action ownership clarified — read-only aggregation vs governed 9D-C mutation reuse (§2, §13).
8. Security/tenancy requirements strengthened for every new read/view/RPC (§10).
9. Testing matrix expanded across all confirmed/ambiguous surfaces (§12), retaining the USD/SGD/MYR anchor.
10. Risks/open questions updated — confirmed items resolved; only genuine unknowns remain (§15).

**Review outcome (history):** after the amendments above (and a subsequent targeted boundary cleanup), Codex
Batch 9D-D **Plan Re-Review returned `PASS — BATCH 9D-D PLAN RE-REVIEW PASSED`**. Batch 9D-D planning is
therefore **complete**; the reviewed technical design below is final and unchanged. Implementation has **not**
started and implementation approval is **not** granted; the current next gate is the **User Batch 9D-D
Implementation Approval Decision**.

---

## 0. Purpose and one-paragraph summary

Batches 9D-A through 9D-C built the FX *data and governance* substrate: a provider-neutral reference layer
(`public.fx_reference_rates`), a real provider + scheduler foundation, and a full booking-rate provenance /
override / approval governance model (`public.fx_booking_rate_decisions` with decision lineage, immutable posted
snapshots, and import origin). **Batch 9D-D delivers the presentation and aggregation layer**: every monetary
surface (invoices, receipts, allocations, customers, imports, receipt PDF/Image review, reports, dashboard) must
display multi-currency amounts *correctly, unambiguously, and auditably*, and every total must be *financially
correct* — never summing mixed transaction currencies as if they were one number. The work is predominantly
**frontend UX + read-only backend aggregation contracts**, plus **reuse of existing Batch 9D-C governed
mutation paths** for any financial-decision action. It introduces **no** new posting path, mutates **no** posted
snapshot, recomputes **no** authoritative money on the client, and enables **no** automation.

---

## 1. Current-state repository assessment (requirement §1)

> **Legend:** **[CONFIRMED]** = observed in the repository at planning time (HEAD `ae50aed`). **[PROPOSED]** =
> a change intended for a later approved implementation phase. Only observed files/routes are named; no file or
> API is invented.

### 1.1 Shared monetary formatting — [CONFIRMED]

- `frontend/src/lib/utils.ts`
  - `formatCurrency(amount, currency = "MYR")` (`utils.ts:16`) — fixed 2 decimals; **MYR default hazard** (a
    call site omitting currency labels a foreign amount MYR).
  - `formatAmount(amount)` (`utils.ts:27`) — renders money with **no currency code** — a direct "amount without
    currency" ambiguity §3 must prohibit at monetary call sites.
- **[PROPOSED]** shared money module (`formatMoney`, `MoneyCell`/`MoneyText`, `useBaseCurrency()`) requiring
  explicit currency and standard base-line / provenance / null / zero / negative handling.

### 1.2 Types and schemas — [CONFIRMED]

- `frontend/src/types/index.ts` — `Invoice` carries `currency, exchange_rate, base_currency, total_amount,
  base_total, outstanding` (`:177-184`); `Receipt` carries `currency, exchange_rate, base_currency,
  receipt_amount, base_amount, allocated_amount, unallocated_amount` (`:237-243`); customer summary carries
  `base_currency` (`:57`) and `default_currency` (`:139`); dashboard contract base-normalised with
  `meta.base_currency`, deprecated txn-currency aliases (`:406-429`, `:509-511`).
  - **Gap [CONFIRMED]:** frontend types do not yet surface 9D-C governance fields (`fx_source_category`,
    `fx_decision_id`, decision status/version). **[PROPOSED]** additive read-only display fields (§9).
- `frontend/src/lib/invoice-schema.ts` — captures `currency`/`exchange_rate` (`:76-81`), defaults `MYR`/`1`
  (`:137-138`); **no** governed override field. `frontend/src/lib/receipt-schema.ts` — same (`:38-51`,
  `:98-101`). Manual create accepts a raw `exchange_rate` with no captured justification; §4/§8/§13 route
  governed overrides through the existing 9D-C decision path.

### 1.3 Frontend routes / pages — [CONFIRMED]

Invoices `invoices/page.tsx` (list), `/invoices/new`, `/invoices/[id]` (`[id]/page.tsx:204` shows
`Currency (Rate: …)`, `:308-311` base only when `currency !== "MYR"`), `/invoices/import`; Receipts `/receipts`,
`/receipts/new`, `/receipts/[id]`, `/receipts/import`; `/allocations`; `/customers`, `/customers/[id]`;
`/credit-notes`; `/journal-entries`; Reports `/reports/aging`, `/reports/outstanding`, `/reports/invoices`,
`/reports/receipts`; Dashboard `app/(dashboard)/page.tsx`.

### 1.4 Frontend components / hooks — [CONFIRMED]

Feature components `components/features/invoices/*`, `.../receipts/*`, `.../allocations/*`
(`allocation-table.tsx`, `invoice-panel.tsx`, `receipt-panel.tsx`), `components/allocation-history-table.tsx`,
`.../customers/*`, `.../imports/*` (`ocr-import-flow.tsx`, `review-actions.tsx`), `.../dashboard/*`
(`aging-chart.tsx`, `collection-trend-chart.tsx`, `composition-chart.tsx`, `credit-risk-chart.tsx`,
`top-customers.tsx`, `quick-stats.tsx`, `chart-tooltip.tsx`). Hooks `use-invoices`, `use-invoice-form`,
`use-invoice-calculator`, `use-receipts`, `use-allocations`, `use-allocation-logic`, `use-dashboard`,
`use-import`, `use-ocr-import`, `use-lookups`, `use-f2-data`, `use-user-role`.

### 1.5 Aggregation inventory — [CONFIRMED sites, PRELIMINARY classification]

> **This classification is preliminary and does not authorise any change.** The implementation plan
> **requires an exhaustive Codex-owned aggregation audit** (backend + SQL views + frontend) before any
> aggregation path is modified. Each site is classified as: **(1) confirmed mixed-currency defect**,
> **(2) safe — single-currency context guaranteed**, **(3) ambiguous — needs Codex contract/runtime
> verification**, **(4) deprecated/legacy — bypass/retire during implementation.**

**`database/002_create_views.sql`**
| Site | Observed | Class |
| --- | --- | --- |
| Invoice outstanding sum (`SUM(i.outstanding)`, `:245`, `:438`) | Sums txn-currency `outstanding` across invoices, ungrouped | **(3) ambiguous** — mixes currencies if multi-currency; Codex to confirm/redefine as grouped or base-derived |
| Receipt unapplied sum (`SUM(r.unallocated_amount)`, `:254`, `:449`) | Sums txn-currency unallocated, ungrouped | **(3) ambiguous** |
| Credit-note outstanding sum (`SUM(i.outstanding)` for CN, `:263`, `:457`) | Sums txn-currency CN outstanding | **(3) ambiguous** |
| Current base-outstanding (`ROUND(i.outstanding * i.exchange_rate, 2) AS outstanding_base`, `:310`, `:554`) | Derives current base via **immutable booked rate × current outstanding** | **(2) safe pattern** — this is the required current-base derivation model (§6.2) |
| Aging buckets (`SUM(CASE … outstanding_base …)`, `:357-362`) | Sums the **base** column | **(2) safe** — base-normalised |
| Company AR balance (`total_outstanding − total_unallocated`, `:399-423`) | Mixes txn-currency subtotals | **(3) ambiguous** — Codex to confirm basis |

**`backend/supabase/functions/reports/service.ts`**
| Site | Observed | Class |
| --- | --- | --- |
| Aging summary (`reduce(... total_ar_balance ...)`, `:191-192`) | Sums view output | **(3) ambiguous** — inherits view basis; verify base vs txn |
| Aging detail buckets (`total_amount`, `:234`, `:238`) | Sums txn-currency `total_amount` | **(1) confirmed defect** if multi-currency |
| By-customer aging | Per-customer roll-up | **(3) ambiguous** — confirm per-currency vs base |
| Statement opening balance / running balance (`:431-459`) | Sequential txn-amount arithmetic | **(3) ambiguous** — running balance across currencies needs Codex-defined basis |
| Invoice / CN / receipt totals (`invTotal`/`cnTotal`/`rctTotal`, `:396-398`) | Sums txn-currency amounts | **(1) confirmed defect** if multi-currency |

**Frontend**
| Site | Observed | Class |
| --- | --- | --- |
| Invoice report totals (`/reports/invoices`) | Client roll-up of amounts | **(3) ambiguous** — must consume grouped/base contract, not re-sum |
| Receipt report totals (`/reports/receipts`) | Client roll-up | **(3) ambiguous** |
| Outstanding report totals (`/reports/outstanding`) | Client roll-up | **(3) ambiguous** |
| Customer outstanding map/display (`/customers`, `/customers/[id]`) | Client display of balances | **(3) ambiguous** — confirm per-currency/base source |
| Receipt customer-outstanding preview | Client preview | **(3) ambiguous** — preview only, backend authoritative |
| Allocation-history active totals (`allocation-history-table.tsx`) | Client active totals | **(3) ambiguous** — same-currency per allocation; confirm |
| Import result summaries | Client summary | **(3) ambiguous** — group by currency |

**Rule:** the frontend must **not** re-sum authoritative money; it consumes the backend grouped/base contract.
No site above is treated as final until the Codex audit confirms its class.

### 1.6 Backend financial invariants — [CONFIRMED]

- Allocation currency equality enforced: `allocate_receipt` candidate query filters `.eq('currency', currency)`
  (`allocations/service.ts:445`); mismatch surfaces `BR-REC-003` = "Receipt currency does not match invoice
  currency. Cross-currency allocation requires manual processing." (`frontend/src/lib/error-messages.ts:37`).
- Realized FX authoritative source: backend `allocation_details.forex_gain_loss`, computed by
  `calculateForexGainLoss(allocAmount, invoice.exchange_rate, receiptRate)` (`allocations/algorithms.ts:75-88`;
  formula = allocation amount × booked-rate difference).
- Journal postings use row-snapshotted rate/base (`database/007_financial_rpcs.sql`).
- Migrations `022`–`026` (booking governance) applied+verified in staging; next free number `027`.

---

## 2. Design principles (locked for 9D-D)

1. **Never sum across currencies without normalisation.** Multi-currency totals are per-currency subtotals
   and/or base-normalised from **backend-authoritative** base values. Never a bare mixed sum.
2. **Base normalisation uses the transaction's own immutable booked rate — never a live/current provider or
   reference rate.**
3. **Aggregation/reporting work is read-only.** New views/RPCs for display are read-only.
4. **Financial-decision actions are governed, not read-only, and reuse existing paths.** Manual override,
   reference selection, submit, approve, reject, revise, supersession are governed mutations and MUST reuse the
   existing Batch 9D-C governed RPC/Edge paths (§13). The frontend introduces **no** direct table writes, no
   parallel mutation logic, and no frontend-authoritative decision transitions.
5. **Server-authoritative money.** The frontend never computes an authoritative booked base amount, an
   authoritative current base balance, or authoritative realized FX; never mutates a posted snapshot; never
   bypasses posting/maker-checker/band/role/lineage/immutability/post-time controls.
6. **Explicit currency at every money render.** No implicit-MYR, no codeless money at monetary call sites; add a
   lint/guard.
7. **Auditability without noise; role-aware; isolation-preserving; additive/non-breaking.**

---

## 3. Currency display model (requirement §2)

### 3.1 Canonical monetary presentation contract

```
MoneyCell {
  amount              // transaction-currency amount (backend-authoritative)
  currency            // ISO code (always required)
  base_amount?        // company base SNAPSHOT amount (backend-authoritative)
  base_currency?
  exchange_rate?      // booked snapshot rate (from -> to)
  fx_source_category? // BASE_PARITY | CATALOG | REFERENCE_SELECTED | MANUAL_OVERRIDE | LEGACY_UNVERIFIED
  fx_decision_status? // NotRequired | Pending | Approved | Rejected | Blocked | Superseded | Posted
  decision_version?
  record_state        // Draft | Posted
  base_kind           // 'estimated' (draft/preview)  |  'booked' (posted snapshot)
  base_available      // boolean
}
```

### 3.2 Edge-case display rules

| Case | Rule |
| --- | --- |
| Transaction currency | Always shown with ISO code; never codeless. |
| Company/base currency | From `useBaseCurrency()`; never hardcoded `"MYR"`. |
| Booked FX rate | `1 <from> = <rate> <to>`; no silent inversion. |
| Currency-code visibility | Adjacent to every monetary value on lists/details/forms/reports/exports. |
| Decimal precision / rounding | Presentation uses 2 fraction digits (matches DB `DECIMAL(18,2)` and backend `roundTo2`); **display rounding is presentation-only, never written back** (§5B). |
| Negative values | Explicit leading minus; screen-reader "negative"; credit/debit labelled, not colour-only. |
| Zero values | `<CODE> 0.00` — distinguishable from unavailable. |
| Null / unavailable base | When `base_available == false`, explicit "base not available" (never `0.00`, never fabricated). |
| Immutable posted snapshot | Read-only + "immutable" indicator; no edit affordance. |
| Decision states | Labelled chip + text (§8); never colour-only; postability reflected. |

### 3.3 Draft vs Posted base-amount semantics (Amendment 1) — MANDATORY

- **Draft / unsaved / calculated conversion (`base_kind = 'estimated'`):** a non-authoritative approximation.
  It **may** use an approximation indicator (e.g. `≈`) and **must** be labelled with non-authoritative wording:
  **`Estimated base`**, **`Draft preview`**, or equivalent. It is explicitly *not* a booked snapshot.
- **Posted transaction stored `base_total` / `base_amount` (`base_kind = 'booked'`):**
  - **MUST NOT** use `≈` or any approximation symbol.
  - **MUST** be labelled **`Booked base`**, **`Stored booked base`**, or **`Immutable booked base`**.
  - Is presented as an **authoritative historical snapshot**, not an estimate — the value stored at posting
    time using the immutable booked rate.

### 3.4 Anti-ambiguity guarantees

- No monetary value renders without its currency code.
- A converted/base value is always visually distinct from and secondary to the original transaction amount and
  never substituted for it.
- "Unavailable" is never rendered as `0.00`.
- A **Posted booked base never shows an approximation symbol or "estimated" wording** (test: §12 T-Posted-Base).

---

## 4. Invoice and receipt UX (requirement §3)

### 4.1 Before posting (Draft) vs after posting (Posted)

- **Before posting:** currency + entered amount + (if foreign) proposed rate and an **Estimated base / Draft
  preview** value (§3.3); FX decision state and posting blockers shown; rate editable only through the governed
  flow.
- **After posting:** booked snapshot (currency, `exchange_rate`, **Booked base** `base_total`/`base_amount`)
  shown read-only + immutable; decision `Posted`; no FX edit affordance.

### 4.2 Per-surface behaviour

| Surface | Behaviour |
| --- | --- |
| List | Primary amount + ISO code per row; optional base column when multi-currency; source-category chip; decision-status chip only when actionable. |
| Detail | Full MoneyCell; posted → immutable "Booked base"; draft → "Estimated base". |
| Create form | Currency selector; amount; if foreign, rate + **Estimated base** preview; a deviating manual rate **must** route to the governed 9D-C decision flow (backend classifies/authorises, §8/§13.1) — never snapshot-only, never a direct transaction-field write; no client-authoritative base. |
| Edit (where permitted) | Only Draft exposes FX edits; edits re-enter the governed decision flow; Posted FX non-editable (DB immutability backstop). |
| Posted | Read-only booked snapshot + immutable indicator. |
| Draft | "Draft — not booked"; blockers surfaced. |
| Import review | See §5A (governed, provenance-labelled). |
| Reference-rate selection | `REFERENCE_SELECTED` + reference date/staleness; stale warned (§8). |
| Manual FX override | `MANUAL_OVERRIDE` + captured reason + approval state; band drives approver. |
| Approval/rejection | Pending/Approved/Rejected/Blocked reflected with permitted/prohibited actions. |
| Booked snapshot | Authoritative stored values only; never recomputed on client. |
| Validation & blockers | Missing/stale/rejected/blocked/pending → explicit non-postable message + required approver/band. |

---

## 5A. Import UX and provenance (requirement §4)

> **OCR capability honesty:** the repository has an OCR-capable *manual-review/draft* intake
> (`components/features/imports/ocr-import-flow.tsx`, `hooks/use-ocr-import.ts`, Batch 9C intake path). This plan
> treats PDF/image intake strictly as **manual review / draft** and makes **no claim** of automatic OCR
> extraction, auto-post, allocation, or journal mutation. Silent OCR provider expansion is out of scope.

Import review/results (CSV, XLSX, and PDF/image manual-review flows) must display, per row:

- **Detected transaction currency** — the currency detected from the imported file, shown explicitly.
- **Imported FX source fields (CSV/XLSX)** — the explicit `exchange_rate` supplied in the imported file,
  labelled "from import".
- **Imported booked-rate / override information** — the imported rate and, when present, override details.
- **`fx_override_reason`** — shown when present.
- **Governance-hold state** — the canonical governance-hold state (`HeldGovernance`, i.e. a `MANUAL_OVERRIDE`
  row parked pending governance); the row is visibly held, not silently accepted.
- **Import-origin provenance** — a compact origin tag (source file / batch / `import_origin`) reachable for
  audit.
- **Row-level decision state** — the governed decision state per row (e.g. Pending / Approved / Rejected /
  Blocked / HeldGovernance).
- **Review requirements** — held/blocked rows require explicit review before any posting.
- **Posting eligibility** — clearly stated per row (postable vs held/blocked/pending).
- **Fail-closed validation errors** — out-of-band, missing decision, non-parity base anomaly, etc.; the row is
  shown blocked and is never silently dropped.
- **Warnings** — e.g. stale reference, near-band-edge deviation.
- **User correction / revalidation flow** — the user corrects/justifies within the governed path; a correction
  re-enters validation (revalidation), never a direct write.
- **Origin distinction** — the UI visibly distinguishes an **imported** value from a **user-entered** value from
  a **provider-reference** value (three distinct origin labels) so the authority of each number is unambiguous.
- **Raw JSON hidden from normal users** — raw internal JSON is available only behind an audit/admin disclosure,
  never on normal review rows.

**Boundary [CONFIRMED]:** import display is read/preview + governance-hold only. PDF/Image intake is
**manual-review / draft only**; there is **no** unsupported OCR automation claim, and **no** automatic posting,
allocation, or journal mutation. Batch 9D-D preserves the 9D-C import-origin provenance and fail-closed
semantics and adds no new import posting behaviour.

---

## 5B. Currency precision and supported-currency policy (Amendment 5)

**Repository facts [CONFIRMED]:** transaction money is `NUMERIC/DECIMAL(18,2)`; exchange rates stored at higher
precision; decision rates/deviations stored at higher governance precision; UI currently exposes MYR, SGD, USD,
EUR, GBP, CNY; backend validators currently accept any uppercase three-letter code.

**Adopted Batch 9D-D policy:**

- Batch 9D-D formally supports the currently exposed operational currencies: **MYR, SGD, USD, EUR, GBP, CNY**.
- These transaction currencies use **two** monetary decimal places under the current DB contract.
- Transaction/document money is authoritative at the backend/database **two-decimal** scale.
- Exchange rates retain their existing **higher backend precision**.
- Decision rates and deviations retain their existing **governance precision**.
- **Frontend formatting/rounding is presentation-only** and is never written back as authoritative money.
- Aggregation uses **backend-defined rounding order**.
- Non-two-decimal currencies (e.g. JPY, KWD) are **out of Batch 9D-D scope** because the current
  transaction-money schema/contracts are two-decimal; supporting them requires a **separately approved
  schema/API/rounding batch**.

**Non-breaking currency-validation rollout (staging-only in Batch 9D-D):**
- Batch 9D-D formally supports **new operational transactions** in **MYR, SGD, USD, EUR, GBP, CNY**.
- Any authoritative backend validation tightening is **implemented and verified in staging only** during
  Batch 9D-D (staging project `gcdsdyegwjdcskpukqlq`).
- New **unsupported** currency writes must **fail closed** through a **backend-authoritative** validation
  contract; **frontend-only filtering is insufficient**.
- **Existing historical records** containing other valid or legacy three-letter currency codes **must remain
  readable**. **No destructive rewrite, deletion, normalisation, or silent substitution** of historical
  currency codes is permitted.
- **Any production enforcement** of the supported-currency allowlist is **deferred to Batch 9D-E**.
- **Batch 9D-E** must perform the **production currency inventory and compatibility preflight** before enabling
  production enforcement.
- Batch 9D-D must **not** query, inspect, mutate, migrate, deploy to, or otherwise act on **production**;
  production currency-code inventory and compatibility preflight are **Batch 9D-E** responsibilities requiring
  **separate explicit user approval**, and **no production assumption may be inferred from staging results**.

*(This section resolves and replaces the former open question "R-5"; it is now a concrete, staging-scoped Codex
validation item — see §15 V-1 — not an unresolved general question.)*

---

## 6. Monetary aggregation correctness (requirement §5) — original totals vs current balances

### 6.1 Authoritative-basis table (original vs current separated — Amendment 3)

**Original transaction/document amounts (immutable at posting):**
| Value | Basis |
| --- | --- |
| Invoice `total_amount` | Transaction currency (original document amount). |
| Invoice `base_total` | **Original authoritative booked base snapshot** (immutable). |
| Receipt `receipt_amount` | Transaction currency (original document amount). |
| Receipt `base_amount` | **Original authoritative booked base snapshot** (immutable). |

**Current mutable balances (change over time):**
| Value | Basis |
| --- | --- |
| Invoice `outstanding` | Transaction currency; current balance. |
| Receipt `unallocated_amount` | Transaction currency; current balance. |
| Customer outstanding / exposure | Current balance. |
| Aging balances | Current balance. |
| Statement running balances | Current derived balance. |

**Hard rule:** current balances **must not** be represented by summing original `base_total` / `base_amount`.
Original booked base is a historical snapshot; a current balance is a different quantity.

### 6.2 Current base-currency balance — backend-authoritative default rule (Amendment 3 + O-1 closed)

**Default authoritative rule (locked):** current **base-currency** balances are **backend-authoritatively
derived** from the **authoritative current transaction balance** using the transaction's **immutable booked
exchange rate**, with **backend-defined rounding**. The existing view pattern
`outstanding_base = ROUND(outstanding * exchange_rate, 2)` (`002_create_views.sql:310`) is the **repository
precedent** for this derivation.

- A **separately stored current-base field may be used only if Codex proves** that it already exists **and** is
  transactionally maintained correctly; absent such proof, the derived read contract above is authoritative.
- **No live / reference / provider rate** may ever be used for a current base balance.
- The **frontend must not calculate an authoritative current-base balance** — it renders the backend value only;
  any client-side conversion is a labelled non-authoritative preview at most.
- Rounding order is **explicitly backend-defined**.

*(This resolves former open question O-1 into a default rule; only a narrow Codex validation item remains —
§15 V-3 — to confirm whether any existing stored current-base field should supersede the derived contract.)*

### 6.3 Aggregation basis per metric

| Aggregate | Required basis |
| --- | --- |
| Dashboard totals / KPIs | Base-currency (already via `get_ar_dashboard_metrics`); never mixed sum. |
| Aging totals | Grouped by currency **and** base via `outstanding_base` (immutable-rate derived); both present. |
| Reports (aging/outstanding/receipts/statement) | Grouped by currency **and** base-normalised; both present. |
| Single invoice/receipt totals | Native transaction currency. |
| Outstanding balances | Grouped by currency **and** base rollup (derived per §6.2); no bare mixed sum. |
| Allocations | Same-currency (§7); realized FX in base as a distinct line. |
| Unapplied receipt balances | Native receipt currency; cross-currency rollups only base-normalised. |
| Customer balances / exposure | Per-currency subtotals **and** backend-authoritative current-base rollup (derived per §6.2). |
| DSO / derived metrics | Single consistent **company-base-currency** basis for numerator and denominator; never mixed. |
| Trend charts | Base-currency axis, labelled; per-currency on drilldown. |
| Credit-risk / exposure | Per-currency **and** base rollup. |
| Import result summaries | Grouped by currency; counts + subtotals; base rollup where meaningful. |

**Customer exposure and DSO — locked monetary basis (O-2 tightened):**
- **Customer exposure** must provide **transaction-currency grouping plus a backend-authoritative current-base
  rollup** (per §6.2); it must never be a bare mixed-currency sum.
- **DSO** numerator and denominator must use **one consistent company-base-currency basis**.
- Transaction-currency values and base-currency values **must not be mixed in a single formula**.
- The **frontend must not calculate authoritative DSO or exposure**.
- **Codex must identify and document the exact authoritative SQL/RPC fields** for exposure and DSO during the
  implementation audit **before any code change** (§15 V-2 audit scope; exact-field confirmation is validation,
  not an open design choice).

### 6.4 Prohibition, worked example, and required audit

- **Prohibited:** naïve mixed-currency summation (e.g. `USD 100 + SGD 100 + MYR 100 → 300`).
- **Required:** `by_currency = [USD 100, SGD 100, MYR 100]` **and** `base_total = MYR 545` (booked rates
  1.35 / 3.10 / 1.00), base total explicitly labelled "normalised at booked rate". Required test (§12).
- **Exhaustive audit gate:** before modifying **any** aggregation path (SQL view, Edge, or frontend), Codex
  performs an exhaustive audit confirming each site's class from §1.5 and the correct basis; the frontend must
  not re-sum authoritative money in the interim.

---

## 7. Allocation UX correctness (requirement §6) — confirmed backend invariant (Amendment 4)

**Same-currency enforcement — three layers, SQL RPC authoritative [CONFIRMED]:**

1. **UI pre-block (usability only).** The frontend pre-blocks incompatible currency selections for a good user
   experience. This is a convenience, **not** a financial control.
2. **Edge candidate filtering (early filtering only).** The allocations Edge function filters candidate invoices
   by receipt currency (`.eq('currency', currency)`, `allocations/service.ts:445`). This narrows candidates
   early; it is **not** presented as the primary financial enforcement.
3. **SQL financial RPC enforcement (final authoritative control).** The financial `allocate_receipt` RPC in
   `database/007_financial_rpcs.sql` (function at `:706`) **explicitly rejects** an invoice/receipt currency
   mismatch: `IF v_inv.currency != v_rct.currency THEN RAISE EXCEPTION 'BR-REC-003: Currency mismatch …'`
   (`007_financial_rpcs.sql:833-834`). This RPC-level check is the **authoritative** guarantee; the UI and Edge
   layers are convenience/early-exit only and must never be treated as the control of record.

Additional constraints:
- **Cross-currency allocation is unsupported in the approved AR system.**
- The error text "requires manual processing" (`frontend/src/lib/error-messages.ts:37`) is a user-facing message
  only; it **does not authorise** any alternative in-system cross-currency conversion or allocation path.
- **No silent FX conversion** is permitted at any layer.
- **`/allocations/auto` remains disabled**; the UI must not imply automation.

**Realized FX — SQL RPC is the authoritative calculator and writer [CONFIRMED]:**
- The financial `allocate_receipt` RPC is the **authoritative calculator and writer**: it computes
  `v_forex := ROUND(v_alloc_amt * (v_rct.exchange_rate - v_inv.exchange_rate), 2)`
  (`007_financial_rpcs.sql:843`) and **persists** it to `allocation_details.forex_gain_loss`
  (`007_financial_rpcs.sql:846-855`), also posting the forex JE.
- The authoritative posted/history value is **read from `allocation_details.forex_gain_loss`**.
- `backend/supabase/functions/allocations/algorithms.ts` (`calculateForexGainLoss`, `:75-88`) and any frontend
  calculation are **preview/helper logic only** and must be labelled **non-authoritative**.
- **Posted / history UI must display the backend-stored RPC result**, never a recomputed value.
- **No frontend or Edge preview calculation may replace or overwrite the authoritative stored value.**
- Allocation must **not** rewrite invoice or receipt booked FX snapshots (realized FX is derived and stored by
  the RPC, not re-booked onto the transaction snapshots).

**Display:** each leg in its own currency; realized FX as a distinct **base-currency** line "Realized FX (base)";
allocation amounts and remaining balances always show currency + amount basis (`allocation-table.tsx`,
`allocation-history-table.tsx`, `invoice-panel.tsx`, `receipt-panel.tsx`).

---

## 8. FX decision-state UX (requirement §7)

Status is **never communicated by colour alone** — every state has icon/shape + text label + (where useful)
tooltip.

| State | Badge (shape+text) | Explanatory text | Severity | Permitted | Prohibited | Postable? |
| --- | --- | --- | --- | --- | --- | --- |
| `CATALOG` | ◧ "Catalog" | Rate from curated catalog | info | View | — | Yes (if approved/not required) |
| `BASE_PARITY` | ● "Base" | Same currency; rate 1.0 | none | View | — | Yes |
| `REFERENCE_SELECTED` | ◆ "Reference" | Selected reference (date shown) | info | View / (re)select | Post while stale/unapproved | If approved & fresh |
| `MANUAL_OVERRIDE` | ▲ "Override" | Manual rate; reason + approver | warning | Submit/approve per band | Approve own | If approved |
| Pending | ◐ "Pending" | Awaiting maker-checker | warning | Submit/approve per role | Post | No |
| Approved | ✓ "Approved" | Approved booking rate | ok | Post | — | Yes |
| Rejected | ✕ "Rejected" | Decision rejected | error | Revise/resubmit | Post | No |
| Stale | ⚠ "Stale (>7d)" | Reference older than 7 days | warning | Refresh/reselect | Post while stale | No until refreshed |
| Missing | ⚠ "Missing" | No reference/rate | error | Provide/select rate | Post | No |
| Superseded | ⊘ "Superseded (v_n)" | Replaced by later version | info | View lineage | Act on old version | No (historical) |
| Posted | 🔒 "Booked" | Locked to posted txn | none | View | Edit | Already posted |

Bands/threshold are the 9D-C locked defaults (Informational ≤0.50% → NotRequired; Minor >0.50–2.00% → AR
Supervisor; Major >2.00–5.00% → Finance Manager; Blocked >5.00%; stale = 7 calendar days). The UI reflects them;
the backend enforces them.

---

## 9. API and contract implications (requirement §8) — field mapping (Amendment 6)

> Proposed fields are **not** presented as existing DB columns. Prefer existing canonical DB/RPC names unless a
> consolidated additive response field has a clear compatibility benefit.

### 9.1 Existing transaction fields [CONFIRMED — authoritative, backend]
`currency`, `exchange_rate`, `base_currency`, `base_total` / `base_amount`, `fx_source_category`, `fx_decision_id`.

### 9.2 Existing decision fields [CONFIRMED — authoritative, backend `fx_booking_rate_decisions`]
`source_category`, `approval_status`, `lifecycle_status`, `decision_version`, `root_decision_id`,
`supersedes_decision_id`, `import_origin`, `booked_rate`, `deviation_pct`, `stale_reference`.

### 9.3 Proposed additive fields — classification

| Field | View-model or API field | Source-of-truth mapping | Codex must add? | Frontend may derive (display only)? | Authoritative? |
| --- | --- | --- | --- | --- | --- |
| `fx_decision_status` | API response (consolidated) | Derived server-side from `approval_status` + `lifecycle_status` + `stale_reference` | Yes | No | Yes (server) |
| `base_available` | API response | Server: whether an authoritative base value exists | Yes | No | Yes (server) |
| `by_currency[]` | API response (report) | Server grouping over authorised row set | Yes | No | Yes (server) |
| `meta.multi_currency` | API response (report meta) | Server: >1 currency in scope | Yes | No | Yes (server) |
| Posting-eligibility summary | API response | Server: band/role/state evaluation | Yes | No | Yes (server) |
| Presentation `base_kind` (`estimated`/`booked`) | **View-model only** | Frontend from `record_state` | No | Yes (labelling only) | No |
| Draft base preview value | **View-model only** | Frontend preview | No | Yes (labelled "Estimated base") | No |

**Guardrails:** authoritative booked base amounts, current base balances, realized FX, posting eligibility, and
band classification are **backend-authoritative** and must never be recalculated by the frontend.

---

## 10. Security, tenancy, and auditability (requirement §9) — strengthened (Amendment 8)

For **every** proposed view, RPC, report response, or grouped read contract, require:
- `company_id = auth.companyId` isolation (group keys never span companies).
- The existing role-specific visibility model.
- **AR Clerk assigned-customer filtering applied BEFORE aggregation** (aggregate over the filtered set only).
- Company-vs-assigned scope parity with the existing dashboard pattern (`reports/service.ts:524-527`).
- Auditor read-only visibility (full lineage, no action affordance).
- **No service-role result leakage** (reads run under the caller's authorised context).
- **Grouping performed only AFTER the authorised row set is established** (never group first, filter later).
- Tenant-isolation and role-scope **staging tests** (§12).

**Ownership:** all RLS/security-sensitive backend work (views/RPCs, contract auth, isolation verification) is
**Codex-owned** and subject to Codex security review + staging verification. Claude owns frontend consumption
and authors no RLS.

---

## 11. Accessibility and responsive behaviour (requirement §10)

Desktop & mobile layouts (tables reflow/stack; no page-level horizontal scroll — wide tables scroll in their own
container); long-value overflow (truncate/wrap with full value in accessible description; ISO code stays
adjacent); table headers name the currency basis ("Amount (txn)", "Amount (base)"); grouped subtotals
programmatically associated; rate/provenance via accessible descriptions, not hover-only; full keyboard
operability + visible focus; screen-reader announces currency + sign; status via icon/shape + text (§8); all
monetary rendering flows through the shared money module for cross-page consistency.

---

## 12. Testing strategy (requirement §11) — expanded (Amendment 9)

Runtime tests are **staging-only, read-oriented**, asserting **no financial mutation** from viewing. Every
scenario uses at least **SGD, MYR, USD** where applicable (and MYR/SGD/USD/EUR/GBP/CNY for the currency-policy
tests). Production-readiness checks are reserved for Batch 9D-E.

| Area | Coverage |
| --- | --- |
| Every confirmed/ambiguous aggregation surface (§1.5) | Verify class + correct basis; no mixed sum survives. |
| SQL legacy/current view handling (`002_create_views.sql`) | `outstanding_base` derivation correct; raw txn sums grouped/base per Codex audit. |
| Frontend report totals | `/reports/invoices`, `/reports/receipts`, `/reports/outstanding` consume grouped/base, do not re-sum. |
| Customer outstanding / exposure | Per-currency + base rollup correct. |
| Receipt outstanding preview | Preview only; backend authoritative. |
| Allocation-history totals | Currency-correct; realized FX from backend. |
| Import summaries | Grouped by currency. |
| Original booked base vs current base balance | Original snapshot ≠ current balance; §6 rules hold. |
| Draft estimated-base wording | Draft shows "Estimated base"/"Draft preview" (may use `≈`). |
| **Posted immutable booked-base wording (T-Posted-Base)** | Posted booked base **never** shows `≈` or "estimated"; labelled "Booked/Immutable base". |
| Allocation mismatch | Cross-currency returns `BR-REC-003`; UI pre-block + backend backstop; no snapshot rewrite; no silent conversion. |
| Backend-authoritative realized FX | Display uses `allocation_details.forex_gain_loss`; frontend preview labelled; no client authoritative recompute. |
| Supported currency / precision (staging) | MYR, SGD, USD, EUR, GBP, CNY accepted; exchange-rate precision; `.005` rounding boundaries; aggregation rounding order; display rounding never alters backend values. |
| Unsupported-write fail-closed (staging) | New unsupported-currency writes rejected by the **backend-authoritative** validation contract; **frontend-only bypass insufficient/blocked**; non-two-decimal currency fail-closed if authoritative validation is added. |
| Historical currency readability (staging) | Historical rows with other valid/legacy three-letter codes remain **readable**; **no destructive rewrite/deletion/normalisation/substitution**; no production query or action. |
| Tenant isolation | Two-company data; aggregates never cross `company_id`; grouping after auth row set. |
| AR Clerk assignment filtering | Filter before aggregation. |
| Auditor read-only visibility | Full lineage, no action affordance, no writes. |
| Proposed API-field source mappings | Each §9.3 field resolves to its stated source; no proposed field masquerades as an existing column. |
| No financial mutation from read-only pages | Before/after snapshots identical after viewing all surfaces. |
| **Mixed-currency anchor** | `USD 100`, `SGD 100`, `MYR 100` → per-currency subtotals + correct authoritative base total; **`300` never shown as a single monetary total.** |
| Formatting / component / unit | `formatMoney`, negative/zero/null, decision-state chip (icon+text), MoneyCell. |

**Batch 9D-E production preflight (documented here, NOT performed in Batch 9D-D):** the following are reserved
for Batch 9D-E and require separate explicit user approval — Batch 9D-D must not perform any of them:
- production currency-code inventory;
- production compatibility assessment;
- production rollout decision;
- production validation smoke test.

No production assumption may be inferred from Batch 9D-D staging results.

**Ownership:** Codex authors/runs backend/API/RPC/SQL and **staging-only** tests; Claude authors frontend
unit/component/UI tests and manual smoke evidence. No test in Batch 9D-D queries or acts on production.

---

## 13. Implementation ownership and sequencing (requirement §12)

### 13.1 Read-only vs governed-mutation boundary (Amendment 7)

- New monetary **aggregation/reporting** work in Batch 9D-D is **read-only**.
- **Manual override, reference selection, submit, approve, reject, revise, and supersession are governed
  financial-decision actions.** Batch 9D-D **reuses the existing Batch 9D-C governed RPC/Edge mutation paths**
  where they exist.
- The frontend must **not** introduce direct table writes, parallel mutation logic, or frontend-authoritative
  decision transitions.
- If a required UI action is **not** exposed through an existing governed API contract, it becomes a
  **Codex-owned additive backend contract** requiring explicit implementation scope and review.
- **No action may bypass** maker-checker, band, role, lineage, immutability, or post-time validation.

**Deviating manual overrides — locked rule (O-3 closed):**
- **Any manual exchange rate that deviates from the approved catalog/reference basis MUST enter the existing
  Batch 9D-C governed decision flow.** It must preserve reason capture, deviation-band classification,
  maker-checker approval, role enforcement, decision versioning, lineage, immutability, and post-time validation.
- If the specific frontend action is not exposed through an existing governed Edge/API contract, it becomes a
  **Codex-owned additive backend contract** (never a frontend workaround).
- The system **must not** fall back to **snapshot-only mutation**, **direct transaction-field updates**, or
  **frontend-authoritative decision changes**. Snapshot-only deviating override is **prohibited**.
- A same-currency **`BASE_PARITY`** rate of `1.0` (or another explicitly governance-exempt path) may follow its
  existing approved backend rules, but the **frontend must not invent exemptions**.

### 13.2 Work packages

| Package | Owner | Contents |
| --- | --- | --- |
| WP-A Backend read contracts | **Codex** | Report grouping shape; invoice/receipt FX display fields; customer exposure grouping; import provenance fields; read-only views/RPCs from `027`; RLS/security review; staging verification. |
| WP-B Aggregation audit + correctness | **Codex** | Exhaustive §1.5 audit; fix confirmed/ambiguous sums to grouped + base-derived (§6.2); verify dashboard basis; no row recomputation. |
| WP-C Shared money UX | **Claude** | `formatMoney`, MoneyCell/MoneyText, `useBaseCurrency()`, decision-state chip; retire `formatAmount` at monetary call sites + guard. |
| WP-D Surface integration | **Claude** | Invoices/receipts/allocations/customers/imports/reports/dashboard consuming WP-A/WP-B; governed actions via existing 9D-C paths (§13.1). |
| WP-E Tests & docs | **Claude** (frontend) / **Codex** (backend) | Test matrix (§12); evidence; user docs. |

### 13.3 Sequencing (contract dependency)

- **Codex implements WP-A/WP-B first** (and completes the audit) where the frontend depends on new contract
  fields/shapes; Claude integrates (WP-D) against the agreed contract. WP-C (pure presentation) can proceed in
  parallel. This preserves backend-authoritative money and avoids frontend guessing.

### 13.4 Required gate sequence (must hold)

1. Claude Code prepares the Batch 9D-D plan. **(done)**
2. Codex performs plan review. **(done — returned FIX REQUIRED)**
3. Claude Code amends the plan. **(done)**
4. Codex performs plan re-review. **(done — `PASS — BATCH 9D-D PLAN RE-REVIEW PASSED`)**
5. **User Batch 9D-D Implementation Approval Decision. ← CURRENT NEXT GATE (not yet granted)**
6. Implementation proceeds per approved ownership (Codex-first on contracts).
7. Codex technical review + staging runtime verification.
8. Evidence consolidation + Codex closure review.
9. **Production rollout remains reserved for Batch 9D-E.**

---

## 14. Acceptance criteria and non-goals (requirement §13)

### 14.1 Measurable acceptance criteria

1. Every monetary value renders with an ISO currency code (guard: zero codeless monetary renders).
2. No report/dashboard/customer/exposure total sums mixed transaction currencies; multi-currency totals are
   grouped and/or base-normalised from backend-authoritative base values (`USD100+SGD100+MYR100` never `300`).
3. Base currency shown consistently across invoices, receipts, allocations, journal views, dashboard, reports,
   imports via one shared source.
4. Posted booked base displays as an immutable snapshot with no `≈`/"estimated"; Draft base is labelled
   "Estimated base"/"Draft preview".
5. Current base balances come from a backend-authoritative derived/stored contract using the immutable booked
   rate; the frontend derives no authoritative current base balance.
6. Allocation blocks cross-currency with `BR-REC-003` (UI pre-block + backend backstop); realized FX uses
   backend `forex_gain_loss`.
7. FX decision states render with icon/shape + text (never colour-only) and correct postability.
8. Import review shows currency, imported rate, override reason, `HeldGovernance`, fail-closed errors, and a
   clear imported-vs-entered-vs-reference origin distinction; no raw JSON on normal rows.
9. All API changes additive/non-breaking; governed actions reuse 9D-C paths; frontend computes no authoritative
   money.
10. Security: tenant isolation, RLS, role visibility (clerk-filter-before-aggregate), Auditor read-only,
    no service-role leakage, grouping after authorised row set — all preserved and re-verified.
11. Supported-currency/precision policy (§5B) enforced; accessibility/responsive checks pass; test matrix (§12)
    passes on staging with no financial mutation from read-only pages.

### 14.2 Non-goals (explicit)

No production rollout; **no production data inspection; no production currency inventory; no production
validation enforcement; no production migration/deployment; no production query, read, or action of any kind**
(all production compatibility and currency-inventory work is reserved for Batch 9D-E — see §15 B-E-1..B-E-3 —
and requires separate explicit user approval); no provider change; no scheduler change; no Vault change; no
automatic population of booking rates by the scheduler; no mutation of posted snapshots; no re-enabling
`/allocations/auto`; no silent cross-currency aggregation; no frontend-authoritative financial calculations; no
unrelated AR feature expansion; no claiming unsupported OCR capability as complete; no non-two-decimal currency
support in this batch.

---

## 15. Risks and open questions (requirement §14) — updated (Amendment 10)

**Confirmed by repository inspection (resolved — no longer open questions):**
- Allocation same-currency enforcement authoritative at the SQL RPC — **CONFIRMED**: `allocate_receipt`
  (`007_financial_rpcs.sql:706`) raises `BR-REC-003` on `v_inv.currency != v_rct.currency`
  (`007_financial_rpcs.sql:833-834`); UI pre-block + Edge `.eq('currency', …)` (`service.ts:445`) are
  convenience/early-exit only.
- Realized-FX authoritative calculator **and** writer is the SQL RPC — **CONFIRMED**:
  `v_forex := ROUND(v_alloc_amt * (v_rct.exchange_rate - v_inv.exchange_rate), 2)`
  (`007_financial_rpcs.sql:843`) persisted to `allocation_details.forex_gain_loss`
  (`007_financial_rpcs.sql:846-855`); `algorithms.ts:75-88` and any frontend calc are preview only.
- Existing Batch 9D-C governed mutation paths exist and must be reused — **CONFIRMED** (migrations 022-026).
- PDF/Image review/draft boundary (manual review, no auto-post/allocation/journal) — **CONFIRMED** (Batch 9C).
- Current DB precision (`DECIMAL(18,2)` txn money; higher-precision rates/deviations) — **CONFIRMED**.

**Design decisions now locked in this plan (previously O-1/O-2/O-3 — closed):**
- **O-1 closed:** current base balances are backend-authoritatively **derived** via immutable-rate × current
  balance by default (§6.2); a stored field is used only if Codex proves it exists (→ V-3).
- **O-2 closed:** customer exposure = per-currency + base rollup; DSO = single company-base basis; no mixed
  formula; frontend authoritative-none (§6.3). Exact field identification is a Codex audit item (→ V-4).
- **O-3 closed:** deviating manual overrides **must** enter the governed 9D-C decision flow; snapshot-only
  deviating override is **prohibited**; `BASE_PARITY` follows its existing approved backend exemption only,
  never a frontend-invented one (§13.1).

**Codex-owned validation items (concrete; no open design choice remains):**
- **V-1 (staging-only):** before any tightening of authoritative currency validation, perform — within
  Batch 9D-D — only **repository/schema inspection**, **static code/contract inspection**, a **staging-only
  currency-code inventory**, **staging-only compatibility verification**, and **staging-only new-write
  validation tests**, to ensure supported currencies are accepted, unsupported new writes fail closed
  (backend-authoritative), and historical/legacy currency rows remain readable (§5B). **Batch 9D-D must not
  query, inspect, mutate, migrate, deploy to, or otherwise act on production.** Production currency-code
  inventory and compatibility preflight are **Batch 9D-E** responsibilities requiring **separate explicit user
  approval**; **no production assumption may be inferred from staging results** (see B-E-1).
- **V-2:** exhaustive aggregation audit confirming each §1.5 site's class before any change (§6.4).
- **V-3:** confirm whether any existing stored current-base field should supersede the derived read contract
  (§6.2); absent proof, the derived contract stands.
- **V-4:** identify and document the exact authoritative SQL/RPC fields for customer exposure and DSO before any
  code change (§6.3).

**Reserved for Batch 9D-E (documented, NOT performed in Batch 9D-D; separate explicit user approval required):**
- **B-E-1:** production **currency-code inventory** and **compatibility preflight/assessment**.
- **B-E-2:** production **enforcement** of the supported-currency allowlist.
- **B-E-3:** production rollout decision, production migration/deployment, and production validation smoke test.

**Genuine open items after read-only inspection:** none of *design*; the above are Codex validation/audit
confirmations (staging-scoped in Batch 9D-D) to be completed during implementation, not unresolved design
questions.

**Documentation follow-up (completed):** as part of this user-authorised documentation-consistency update
(after Codex Plan Re-Review passed), the master plan
`docs/plans/BATCH_9D_DAILY_FX_RATE_SYNC_AND_MULTI_CURRENCY_UX_PLAN.md` §0.0 has been aligned to record
Batch 9D-D as **PLANNING COMPLETE — CODEX PLAN RE-REVIEW PASSED — IMPLEMENTATION NOT STARTED** with the current
next gate **User Batch 9D-D Implementation Approval Decision**.

---

## 16. Locked boundaries carried forward (must remain true)

- `fx_reference_rates` (reference-only) ≠ `exchange_rates` (booking/catalog source) ≠ invoice/receipt booked
  snapshots (immutable transaction truth). 9D-D only reads/displays these.
- Reference-rate corrections MUST NOT mutate posted transaction snapshots.
- The scheduler MUST NOT silently populate booking rates; the ACTIVE 9D-B staging scheduler is untouched.
- Posted booked-FX snapshots are immutable (DB trigger backstop).
- Reference-selected / manual-override / stale / missing / pending / rejected decisions MUST NOT auto-post.
- `/allocations/auto` remains disabled.
- No production rollout before Batch 9D-E.

---

## 17. Next gate

**User Batch 9D-D Implementation Approval Decision.** Codex Batch 9D-D Plan Re-Review has returned
`PASS — BATCH 9D-D PLAN RE-REVIEW PASSED`; planning is complete and the reviewed design is final. No
implementation, migration, deployment, provider, scheduler, Vault, or production action is authorised by this
document. Batch 9D-D **implementation has NOT started** and **implementation approval is NOT granted**;
implementation must not begin until the user explicitly grants that approval. Production rollout remains
reserved for Batch 9D-E.
