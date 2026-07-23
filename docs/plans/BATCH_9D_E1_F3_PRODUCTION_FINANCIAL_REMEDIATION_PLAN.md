# Batch 9D-E1 — F3 Production Financial Remediation — Plan (Rev 2; P1/P2/P3 implementation checkpoint)

- **Batch:** 9D-E1 remediation track (blocker resolution for Gate 9D-E1).
- **Type:** governing plan plus a local-only F3-P2/P3 implementation checkpoint. This document performs and authorizes **no** production mutation, migration, deployment, Git push, credential action, scheduler action, identity creation, login, or Edge Function invocation.
- **Author:** Claude Code (initial planning), technically remediated and locally implemented by Codex. **Status: owner-attested P1 treatment selected; exact test-data-reset operator implemented locally; independent review and every production gate remain separately unauthorized.**
- **Date:** 2026-07-20.
- **Planning baseline:** `main` at `c24249f037164edd8e08b3cf15f7180973a78c4d`; `origin/main` `d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d`; ahead 2 / behind 0.
- **Upstream inputs:** `docs/evidence/SPRINT_BATCH_9D_E1_PRODUCTION_READ_ONLY_PREFLIGHT_EVIDENCE.md` §13, §14, and §15 (Batch 9D-E1A Read-Only Blocker Diagnosis).
- **Governing decisions:** Gate 9D-E1 = **NO-GO — BATCH 9D-E1 PRODUCTION PREFLIGHT BLOCKED**; Gate 9D-E1A = **PASS — BATCH 9D-E1A READ-ONLY BLOCKER DIAGNOSIS COMPLETE**. Both remain authoritative and are **not** reopened by this plan.
- **Production Supabase project ref:** `kusseuycqgdilychphpq`. **Staging Supabase project ref:** `gcdsdyegwjdcskpukqlq`. Neither is contacted by this planning task.

> ## Authorization statement
>
> **This plan grants NO authorization.** Every gate below is a *proposal* requiring separate, explicit user approval before any execution. Reading, reviewing, or approving *this document* does **not** authorize F3-P1 or any later gate. Production **cohort-data** mutation can occur only at Gate F3-P4, and only after a distinct approval names the treatment and the exact immutable manifest. If a schema prerequisite is required, F3-P3S needs its own earlier production-schema authorization, may not mutate the cohort, and does not authorize F3-P4.

> ## Governing principle
>
> **The 128 rows must be resolved truthfully, or remain blocked.** No path in this plan permits inventing financial history — no fabricated receipts, allocations, discounts, credit notes, journals, actors, or posting timestamps. Where source evidence does not exist, the correct outcome is **continued blockage**, not a manufactured PASS.

> ## Rev 2 technical-remediation map
>
> | Finding | Rev 2 closure |
> |---|---|
> | `B9DE-F3-PR-001` | Canonical exact-ID/company manifest, source-backed fields, exact PostgreSQL `NUMERIC`, canonical serialization and per-row/cohort/dependency SHA-256 fingerprints (§6.2–§6.5) |
> | `B9DE-F3-PR-002` | One short `SERIALIZABLE` P4 transaction, deterministic `FOR UPDATE` locking, local timeouts, post-lock revalidation and all-or-nothing commit (§6.6) |
> | `B9DE-F3-PR-003` | P2 raw/explained/unexplained reporting, no broad exclusion or fabricated settlement, and append-only superseding/correction semantics (§5.2, §6.8, §6.11–§6.12) |
> | `B9DE-F3-PR-004` | Purpose-specific relation/RPC owner, RLS, ACL, grants, safe `search_path`, service-only execution and one-time-artifact constraints (§6.9) |
> | `B9DE-F3-PR-005` | Complete 34-case P3 implementation/security/transaction test matrix plus Codex self-validation and independent review (§6.10) |
> | `B9DE-F3-PR-006` | Optional separately authorized schema-only F3-P3S; F3-P4 is data-remediation-only and cannot carry schema, migrations 017–030 or Edge deployment (§3, §6.1, §6.13) |
>
> **Current local documentation state (not an E1 entry-state claim):** at Rev 2 remediation, staged paths remain 0; the two existing planning files are modified and the E1 evidence plus this F3 plan are untracked Batch documents; the 18 unrelated `social-media/` paths remain untouched. HEAD and `origin/main` are unchanged.

---

## 1. Authoritative finding (carried forward, not re-derived)

### 1.1 The F3 cohort

Gate 9D-E1A diagnosed and classified the blocker as **F3 — PRODUCTION DATA DEFECT**. The diagnosed cohort is:

| Attribute | Value |
|---|---|
| Rows | **128** `Paid` invoices |
| Invoice total | **2,681,703.31** |
| Outstanding | **0.00** |
| Active allocation cash | **0.00** |
| Active settlement discount | **0.00** |
| Active credit-note allocation | **0.00** |
| Equation delta | **2,681,703.31** |
| Document date range | 2026-03-04 → 2026-03-13 |
| Currency / rate | MYR @ `1.000000` |

Failing invariant (§6.5 of the rollout plan):

```
invoices.total_amount
  − Σ (allocation_details.allocated_amount + allocation_details.discount_amount)  [status <> 'Reversed']
  − Σ (cn_allocations.allocated_amount)                                           [status <> 'Reversed']
  = invoices.outstanding
```

### 1.2 Absent evidence (every row, all 128)

- No `invoice_lines`; no posting journal; posting debits and credits both zero.
- `created_by`, `posted_by`, `posted_at` all null; `version` remains `1`.
- No `allocation_details` row of **any** status — active or `Reversed`.
- No `cn_allocations`, linked Credit Note, or journal reversal.
- No `import_rows` / `import_batches` linkage; no normalized import-allocation record.
- No documented opening-balance contract, marker, or fixture reference.
- No FX or rounding explanation (MYR @ 1, base parity passes, each delta equals the full invoice total).
- No duplicate business-signature group, import duplicate link, or supersession evidence.
- A common `updated_at` window **≈ 94.071 ms** wide — deterministic evidence of one bulk privileged/system operation outside the governed lifecycle.
- Production has **no invoice-history trigger** (only `trg_invoices_updated_at`), so the exact pre-update status is **unknowable** from production alone.

### 1.3 Wider cohort context

The 128 belong to a wider **1,050-row header-only system-loaded cohort** in the same company:

| Sub-cohort | Rows | Total | Outstanding |
|---|---:|---:|---:|
| `Open`, full outstanding | **922** | 18,235,664.61 | = `total_amount` |
| `Paid`, zero outstanding | **128** | 2,681,703.31 | 0.00 |
| **Cohort total** | **1,050** | **20,917,367.92** | — |

All 1,050 lack invoice lines, application actors, posting timestamps, import linkage, original posting journals, allocation/CN history, and governed version advancement.

> **Scope note.** Only the **128** `Paid` rows currently fail the settlement equation and block E1 financial certification. The 922 `Open` rows satisfy the equation arithmetically (`outstanding = total_amount`, zero settlement). They are **in scope for provenance discovery** (§4) because they share one cause, but they are **out of scope for remediation** unless discovery proves otherwise — remediating rows that are not defective would itself be an uncontrolled production mutation.

### 1.4 Classification stability

**F3 must not be weakened or relabelled as valid legacy state without authoritative evidence.** Specifically, the following are **prohibited** as resolutions:

- asserting the rows are "legacy opening balances" because they *resemble* one, absent a documented opening-balance contract;
- excluding the 128 rows from the financial gate predicate to obtain a PASS;
- silently grandfathering unsupported balances via a tolerance, allow-list, or exception table created for that purpose;
- narrowing the E1 equation so the cohort no longer falls inside it.

Any of these is a **material Medium or higher** finding and blocks closure (§9).

---

## 2. What this plan is, and is not

**It is** a staged, proportionate route from *diagnosed defect* to *truthful resolution*, with authorization boundaries between each stage.

**It is not** an implementation. No SQL, migration, RPC body, or manifest is executed, generated against production, or approved here. §6 specifies the *contract* that a future implementation must satisfy. The cohort-data implementation is drafted at Gate F3-P3 and can execute only at F3-P4; a genuinely necessary minimum schema prerequisite is separately implemented/reviewed at P3 and may be installed only through F3-P3S.

**Separation of concerns (mandatory):**

| Concern | Gate | Mutates production? |
|---|---|---|
| Provenance discovery | **F3-P1** | **No — read-only** |
| Remediation decision + plan | **F3-P2** | **No — documentation** |
| Implementation + local test | **F3-P3** | **No — local only** |
| Optional schema prerequisite | **F3-P3S** | **Yes — separate schema-only authorization, only when required** |
| Controlled production execution | **F3-P4** | **Yes — separate explicit authorization** |
| Repeated E1 verification | **F3-P5** | **No — read-only** |

Skipping, merging, or reordering these gates is prohibited. In particular, **P3 must not execute against production**, optional **P3S may install only a separately approved minimum schema prerequisite and must not touch the cohort**, and **P4 must not begin without a P2-approved treatment bound to a P3-frozen manifest**.

---

## 3. Gate structure

### Gate F3-P1 — Provenance discovery *(read-only)*

**Purpose:** establish, from evidence, which of P1–P5 (§4.3) applies.
**Permitted:** read-only production `SELECT`; local repository inspection; local Git history inspection; review of prior evidence documents; receipt of a project-owner declaration; review of external accounting records supplied by the owner.
**Prohibited:** any `INSERT`/`UPDATE`/`DELETE`/DDL; migration application; Edge Function invocation; deployment; credential, identity, or scheduler action; any staging mutation.
**Exit:** a sanitized provenance report naming exactly one outcome P1–P5, or a STOP condition (§4.5).

### Gate F3-P2 — Remediation-plan approval *(documentation + independent review)*

**Purpose:** convert the P1 outcome into one approved, specific treatment.
**Permitted:** authoring the treatment plan; independent review; revision.
**Prohibited:** all execution, local or remote.
**Exit:** an approved treatment naming the outcome, the mechanism, the expected delta, and the rollback/containment classification — or a return to P1 for more evidence.

### Gate F3-P3 — Controlled implementation *(local only)*

**Purpose:** build and prove the remediation artifact **without touching production**.
**Permitted:** authoring the reviewed remediation artifact and, if technically necessary, a separate minimum schema-prerequisite artifact; local database application; local tests; local idempotency and rerun proof; drafting the row manifest **from the P1 read-only extract**.
**Prohibited:** production or staging execution unless **separately authorized** (a staging rehearsal is *recommended* but requires its own approval); any push, deployment, or credential action.
**Exit:** a reviewed artifact plus a frozen, immutable manifest and per-row before-fingerprints.

### Gate F3-P3S — Optional production schema prerequisite *(separate authorization; no cohort mutation)*

**Purpose:** install only a minimum protected provenance/audit relation or narrowly governed RPC when P2 and P3 prove that the approved treatment cannot be represented truthfully with existing protected schema.
**Permitted only after:** P2 selects the treatment; P3 implements and locally verifies the exact prerequisite; one independent read-only review passes; the user separately authorizes the named schema artifact against production.
**Prohibited:** mutation of any of the 128 invoices or their financial dependencies; Migrations 017–030; any unrelated migration; Edge deployment; credential, scheduler, identity, Git or Gate 9D-E2 action. This gate is not hidden inside F3-P4 and does not imply F3-P4 authorization.
**Exit:** the exact schema object, owner, RLS, ACL, grants, append-only guards and function signature are installed and verified, with **zero cohort-row mutation**; otherwise STOP.

### Gate F3-P4 — Production data execution *(separate explicit authorization — the only cohort-data mutating gate)*

**Purpose:** apply the approved treatment to exactly the approved rows.
**Requires — all of:** P2-approved treatment; P3-frozen manifest; a production recovery checkpoint; explicit user authorization that **names the treatment and the manifest**; and confirmation that no unrelated rollout step is bundled into the same operation.
**Prohibited:** schema or DDL work; Migrations 017–030; Edge deployment; ad-hoc dashboard SQL; any mutation outside the manifest; deletion of audit evidence; bundling with Gate 9D-E2 backend rollout.
**Exit:** before/after reconciliation with zero unexpected Group A delta and the exact expected delta for the chosen treatment.

### Gate F3-P5 — Repeated E1 *(read-only)*

**Purpose:** re-certify the financial baseline.
**Permitted:** the full read-only Gate 9D-E1 procedure, unchanged.
**Exit:** a fresh E1 result. `B9DE-E1-001` closes only when the F3 financial criteria in §6.12 pass. `B9DE-E1-002` account ownership/credential custody remains an independent prerequisite; `B9DE-E1-003` is already closed. F3-P5 does not authorize Gate 9D-E2.

> **No hidden micro-gates.** P3S is a named optional prerequisite solely because schema mutation and financial-data mutation require different authorizations. A staging rehearsal inside P3 also requires separate explicit authorization. Neither authorizes P4.

---

## 4. Gate F3-P1 — Provenance discovery (read-only)

### 4.1 Objective

Determine **why 128 rows say `Paid` with zero outstanding**, using authoritative evidence rather than inference. The E1A diagnosis established *what is absent*; P1 must establish *what actually happened*.

### 4.2 Evidence sources to interrogate

Each source is read-only. Each yields a **finding**, not a conclusion; §4.3 maps findings to outcomes.

| # | Source | What to establish | Access |
|---|---|---|---|
| 1 | **Original source dataset** | Does an original invoice dataset exist for 2026-03-04 → 2026-03-13? Who produced it? Does it mark these 128 as settled? | Project owner |
| 2 | **Source ledger / export** | An external AR ledger, trial balance, or aged-debtors report covering the cohort, showing status and settlement dates | Project owner / external |
| 3 | **Historical CSV / XLSX / PDF import source** | Any file whose row count, invoice numbers, customer set, totals, or date range matches the cohort | Owner + local repo |
| 4 | **Repository seed / generation scripts** | Whether a committed script can produce header-only invoices with no lines and no posting metadata | **Local — see §4.4** |
| 5 | **Previous production-load evidence** | Any prior `docs/evidence/**` record of a production data load, backfill, migration, or demo population in that window | Local repo |
| 6 | **Local Git history** | Commits, scripts, or evidence dated near 2026-03-04 → 2026-03-13 describing a production load | Local repo |
| 7 | **Approved project-owner declaration** | A signed, dated statement of what the data is and where it came from, with the owner's authority to declare it | Project owner |
| 8 | **External accounting records** | Where the business genuinely operates, real settlement records for the 128 documents | External, if applicable |

### 4.3 Read-only production queries permitted at P1

All `SELECT`-only, all scoped to the affected company, all results sanitized before recording:

1. **Cohort identity extract** — for the 128 rows: `id`, `invoice_no`, `doc_type`, `invoice_date`, `due_date`, `customer_id`, `currency`, `exchange_rate`, `total_amount`, `base_total`, `outstanding`, `status`, `posting_period`, `reference_no`, `version`, `created_at`, `updated_at`. **This extract becomes the candidate manifest** (§6.2).
2. **`invoice_no` pattern analysis** — prefix, numbering density, gaps, and whether numbering interleaves with the 922 `Open` rows or forms a separate block. A contiguous machine-generated series is a P1 signal; interleaving with genuine documents is not.
3. **Customer-set analysis** — the 106 customers: do they carry the same header-only, actorless shape? Are they themselves system-loaded, or pre-existing?
4. **Field-nullity profile** — which optional header fields (`reference_no`, `internal_remarks`, `invoice_remarks`, `posting_period`, `ar_acct`, `due_date`) are populated versus null across the cohort. Uniform nullity indicates generation; varied realistic content indicates transcription from a source.
5. **Temporal profile** — full `created_at` distribution versus the ≈94 ms `updated_at` window; whether creation was also bulk, and whether the 922 `Open` rows share the same windows.
6. **Boundary confirmation** — that **no** row outside the 128 fails the equation, and that the cohort is confined to one company.
7. **Dependency pre-scan** — read-only confirmation that nothing references the 128 rows (§6.4). At P1 this is diagnostic; at P3 it is re-run as a gating check.

**Prohibited at P1:** writing anything; invoking any Edge Function; authenticating as any application user; touching staging; retrieving or recording any credential value.

### 4.4 Repository leads already identified (planning-time, local, read-only)

Local inspection at planning time surfaced three committed artifacts that P1 must evaluate. **None is yet evidence of anything** — they are leads:

| Artifact | Why it matters |
|---|---|
| `database/003_seed_data.sql` | Seed data. Planning-time inspection found **no invoice inserts**, so it is unlikely to explain the cohort — P1 should confirm and then discount it. |
| `database/007c_api_staging_fixtures.sql` | Staging fixtures. Must be checked for whether it was ever applied to **production**. |
| `database/007d_production_smoke_fixture.sql` | **The strongest structural lead.** It inserts an invoice header **directly**, bypassing `post_invoice` — no lines, no posting journal, no `posted_by`/`posted_at`, `version` unchanged. That is precisely the F3 shape. It creates **one** row with a distinctive `PROD-SMOKE-I-` prefix and a `'PROD SMOKE TEST CUSTOMER - DO NOT USE'` customer name, so it does **not** by itself explain 128 rows across 106 customers. |

**Required P1 determinations from this lead:**

- Do any of the 128 carry the `PROD-SMOKE-I-` prefix or the smoke customer name? *(If yes, those specific rows have proven synthetic provenance.)*
- Does the committed repository contain **any other** direct-header-insert path capable of producing 128 rows? If not, the load came from **outside** the repository, and only the project owner can identify it.
- Is there a committed generator, notebook, script, or documented manual procedure matching the cohort's size and shape?

> **Interpretive discipline.** That the repository *contains* a header-only insert pattern proves the pattern is *possible*, not that it *was used* for these 128 rows. Structural resemblance alone yields **P5**, not P1.

### 4.5 Provenance outcomes

P1 must conclude with **exactly one** outcome. **Do not assume which applies.**

| Outcome | Definition | Minimum evidence to claim it |
|---|---|---|
| **P1 — Synthetic / demo data** | The rows were generated or loaded for demonstration, testing, or population purposes and represent no real transaction | A named authoritative generation/load source plus proof tying its output to each row (or deterministic subgroup) and confirmation by the responsible owner/data custodian. Repository resemblance, timing, null fields or a similar fixture alone are insufficient. |
| **P2 — Truthful historical `Paid` snapshot** | The rows represent real invoices genuinely settled before the system was adopted, whose settlement occurred outside this system | An authenticated external ledger/export/statement plus an owner adoption/cutover declaration, mapped to every row or to a deterministic, complete subgroup by stable business keys. |
| **P3 — Incorrectly marked `Paid`** | The rows are real and **not** settled; the `Paid` status and zero outstanding are wrong | Authoritative source evidence giving the correct status, exact outstanding and effective date per row or deterministic approved subgroup. |
| **P4 — Mixed population** | Different subsets fall under different outcomes | A complete, non-overlapping exact-ID partition in which every row maps to P1/P2/P3/P5 and each partition has independent authoritative evidence. |
| **P5 — Provenance cannot be established** | No source, script, declaration, or external record explains the rows | Discovery completed across §4.2 sources 1–8 with no authoritative match |

### 4.6 Sanitized evidence requirements

The P1 report must record, and must **not** exceed:

- **Included:** row counts; monetary aggregates; date ranges; `invoice_no` **patterns** (not necessarily full lists, unless the manifest is attached as a controlled artifact); customer **counts**; field-nullity profiles; the named source consulted and its custodian's **role**; the outcome and its justification; every STOP condition encountered.
- **Excluded — never recorded:** any credential, token, key, or secret value; any password; any personally identifying customer detail beyond what the manifest strictly requires; any screenshot containing a value; any hash of a credential.
- **Attribution:** each finding cites its source (repository path + line, evidence document + section, or "project-owner declaration dated *X* by role *Y*").
- **Honesty requirement:** absence of evidence is recorded as **absence**, never as a negative finding that supports a convenient outcome.

### 4.7 P1 STOP conditions

P1 stops and reports immediately if any of the following occurs:

1. Any write, DDL, or Edge Function invocation is attempted or occurs accidentally.
2. The cohort boundary proves unstable — the failing-row count is **not** 128, or extends beyond the diagnosed company.
3. Additional rows outside the 1,050-row cohort are found to fail the equation.
4. Evidence is found that the 922 `Open` rows are **also** financially incorrect (this enlarges scope and requires a fresh decision).
5. Conflicting authoritative sources disagree on provenance.
6. Any source offered as evidence cannot be authenticated or attributed.
7. The project owner declines to declare provenance, or declares it without supporting evidence *(→ P5, not P2)*.
8. Any production credential or value is exposed during discovery.

---

## 5. Gate F3-P2 — Remediation decision tree

Each outcome maps to **one** deterministic treatment. The treatment is proposed at P2 and executed only at P4.

### 5.1 P1 — Synthetic / demo data

**Precondition: synthetic provenance is *proved*, not inferred.** Absent proof, the outcome is P5.

> **Do not automatically choose hard deletion.** Deletion is the most destructive option and is irreversible in place. Evaluate all three candidate treatments and justify the selection.

| Candidate treatment | What it does | When it is safest | Risks |
|---|---|---|---|
| **T-A — Governed archival** | Mark provably synthetic rows as archived while retaining them and their provenance | Rows may need later inspection; audit continuity matters; a truthful archival business rule exists or is separately reviewed | Requires a schema mechanism; archival must not become an E1-only allow-list or silently remove real documents from monetary/reporting populations |
| **T-B — Governed cancellation** | Transition rows to a terminal non-financial lifecycle state (e.g. Cancelled/Void) with reason and actor | The lifecycle already models cancellation and the transition is legitimate for never-real documents | Must not imply a real document was voided; must not distort cancellation reporting |
| **T-C — Controlled cleanup (deletion)** | Remove the rows and their dependents entirely | Rows are provably synthetic, provably unreferenced, and retention has no value | Irreversible in place; recovery depends wholly on the checkpoint; any missed dependency breaks referential integrity |

**Repository-target lifecycle feasibility boundary.** Gate E1 classified Migration 028 as missing in production, but its accepted target lifecycle contract permits a `Paid` Invoice/Debit Note to move only to `Open`, `Overdue` or `Partially Paid`, and permits deletion only for `Draft` documents. F3 must not exploit the current absence of a future accepted guard to create a state that the approved lifecycle rejects. Therefore **direct `Paid → Cancelled` and deletion of these `Paid` rows are not valid ordinary target-state paths**. T-B and T-C start as **INELIGIBLE**. They may be selected only if P3 proves, and independent review accepts, a narrowly governed exact-manifest mechanism installed through separately authorized P3S that remains compatible with the later 028 contract and preserves its general protections. Disabling the trigger, adding a generic bypass flag, fabricating intermediate lifecycle transitions, or relying on table-owner power as an undocumented bypass is prohibited. If no narrow mechanism is safe, those options remain unavailable.

**Selection rule.** Prefer **T-A** when it is truthful and supported by a reviewed archival/reporting contract. T-B may be considered only under the feasibility boundary above. Choose **T-C** only when archival/cancellation would leave misleading artifacts, the dependency scan (§6.5) is clean, retention is not required, the checkpoint is verified, and the same feasibility boundary is satisfied. **Record the reasoning for every rejected or ineligible option**, not only the chosen one.

**Mandatory for any P1 treatment:** exact immutable row manifest; company scope; source proof of synthetic origin; dependency scan; recovery checkpoint; **no unrelated row touched**; idempotent execution; append-only audit evidence; before/after reconciliation.

**Scope question P2 must answer explicitly:** if the 128 are synthetic, are the 922 `Open` rows synthetic too? If yes, remediating only 128 leaves 18,235,664.61 of synthetic receivables in production — arithmetically consistent but financially misleading. **Record that as a separate finding; do not resolve it by silence.** This F3 execution remains bounded to the diagnosed 128. Any 922-row remediation requires a new, separately reviewed and authorized scope/manifest track; no F3-P4 operation under this plan may expand from 128 to 1,050 rows.

### 5.2 P2 — Truthful historical `Paid` snapshot

> **Absolute constraint: do not invent receipts, allocations, discounts, credit notes, journals, or users.** The system must never claim that a receipt allocation occurred when none did. Fabricating an `allocation_details` row — even a "synthetic" or "opening-balance" one — to make the equation balance is **prohibited**, because it would make a false statement about how the money arrived and would corrupt allocation reporting, reversal logic, and audit history.

**Objective:** record the *minimum* immutable provenance that truthfully explains the state.

**Required explanatory content:**

| Field | Meaning |
|---|---|
| Settlement basis | That settlement occurred **outside this system**, before adoption |
| `Paid` status justification | Why the document is closed |
| Zero-outstanding justification | Why no balance remains |
| Historical source reference | The external ledger/export/document identifier |
| Effective settlement date | Where known; explicitly `unknown` where not |
| Source system | The system or process of record |
| Reason | Free-text remediation rationale |
| Actor | The human authorizing and the process executing |
| Audit event | Append-only record of the remediation itself |

**Mechanism options — P2 must choose one and justify it:**

| Option | Shape | Assessment |
|---|---|---|
| **M-1 — Dedicated provenance relation** | A new narrow table, e.g. one row per remediated invoice carrying the fields above, FK to `invoices`, append-only | **Recommended default when no suitable existing structure exists.** Truthful, additive and isolated; cannot be mistaken for settlement. It explains a narrowly scoped historical state but **does not remove the invoice from document totals, receivable history, customer statements or other monetary populations**. It requires the separate F3-P3S schema gate before P4. |
| **M-2 — Narrowly scoped document lifecycle event** | Reuse an existing audit/history/event mechanism to record a `LEGACY_SETTLEMENT_RECORDED` event | Adequate **if** a suitable append-only event mechanism already exists for invoices. E1A recorded that production has **no invoice-history trigger**, so this may require new infrastructure — verify before choosing. |
| **M-3 — Header annotation only** | Populate `reference_no` / `internal_remarks` with provenance text | **Insufficient alone.** Mutable, unstructured, not append-only, not queryable as a contract. May accompany M-1 or M-2; may not replace them. |
| **M-4 — Synthetic allocation/receipt rows** | Create balancing settlement records | **PROHIBITED.** Violates the absolute constraint above. |

**Equation reconciliation under P2.** The ordinary internal settlement equation will still not balance for these rows, because no internal allocation exists — and it must not be made to appear balanced. P2 therefore uses a strict, separately reported explained-state contract:

1. Compute and report the **raw arithmetic mismatch count and exact `NUMERIC(18,2)` amount** without exclusions.
2. Identify only row-scoped P2 invoices whose approved authoritative external evidence is bound to an immutable provenance record.
3. Report the **externally explained historical-state count and amount** separately; do not subtract those invoices from document totals, revenue-related reporting, receivable history, customer statements or general financial populations.
4. Report the remaining **unexplained count and amount**.

`B9DE-E1-001` may close only when unexplained count and amount are both zero and every explained row has approved authoritative provenance. A non-zero raw mismatch under P2 remains truthfully visible. This is a narrow explanation of state, **not** a claim that the allocation equation balances and not a broad financial exclusion.

> **Guard against abuse.** This path is legitimate only because provenance is *proved and recorded per row, company and source*. It must **not** become a general escape hatch, apply by status or date range, or absorb a P5 row. Creating provenance without authoritative source evidence is equivalent to inventing history and is blocking.

**Avoid unnecessary enterprise infrastructure.** M-1 is one table, one migration, and one insert per row. No workflow engine, approval service, event bus, or reconciliation platform is warranted at FYP scale.

### 5.3 P3 — Incorrectly marked `Paid`

**Required before any change — authoritative source evidence for each row:**

- the correct **status**;
- the correct **outstanding**;
- the correct **effective date**;
- the correct **financial balance** (and whether `total_amount` itself is correct).

> **Do not infer that every row should become `Open`, and do not restore `outstanding = total_amount` by default.** That is itself an invention. A row whose correct state is unknown is a **P5 row**, not an `Open` row.

**Mechanism:** a reviewed, exact-manifest one-time data artifact or a narrowly governed remediation RPC, with explicit actor, reason, source reference, company scope, and append-only audit evidence. Any required schema/RPC installation occurs only through F3-P3S; **F3-P4 itself performs data remediation only**. **No ad-hoc dashboard DML.**

**Additional requirements:**

- Per-row target values come from the source evidence, never from a formula applied uniformly.
- Status transitions must respect the lifecycle enforcement added by Migration 028 (prospective enforcement — verify the remediation path is compatible before execution).
- If restoring balances materially changes AR totals, aging, or dashboard aggregates, that delta is **expected** and must be stated **exactly** in advance (§6.9).
- Rows whose correct state cannot be sourced are **carved out into P5** and remain blocked; they do not receive a guessed value.

### 5.4 P4 — Mixed population

1. Produce an **immutable row-by-row classification manifest**: every one of the 128 rows assigned to exactly one of P1/P2/P3/P5, with its supporting evidence cited.
2. Apply the P1/P2/P3 treatments **separately**, as distinct operations with distinct manifests, distinct expected deltas, and distinct P4 approvals. Optional P3S schema prerequisites must already be complete and independently verified.
3. Do **not** apply a blended treatment, and do not let a majority classification absorb a minority subset.
4. Any row classified **P5** keeps the whole gate blocked for that subset (§5.5) — the remainder may proceed only if the P5 subset is explicitly carved out, documented as still-defective, and **the E1 financial gate continues to fail for it**.
5. Reconcile: the sum of subset row counts and subset monetary totals must equal 128 and 2,681,703.31 exactly.

### 5.5 P5 — Provenance unavailable

**Production remediation remains BLOCKED.** No treatment is authorized.

Explicitly prohibited as a workaround:

- excluding the rows from the financial gate to obtain PASS;
- silently grandfathering unsupported balances;
- creating provenance records that assert what is not known;
- lowering the E1 financial criterion, adding a tolerance, or narrowing the predicate;
- proceeding to Gate 9D-E2 on the basis that the defect is "understood".

**Permitted under P5:**

- recording the state honestly as an **open, unresolved production data defect**, with its full diagnosis;
- documenting it as a known limitation in the project's evidence and final report;
- continuing provenance discovery if new sources become available;
- **the user may separately and explicitly record awareness of the risk** — but that record does **not** convert P5 into P2, does not permit remediation, does not remove the E1 blocker, and does not authorize Gate 9D-E2. F3 remains NO-GO until authoritative evidence supports P1, P2 or P3 for every row.

---

## 6. Implementation safety contract (binds Gates F3-P3, optional F3-P3S and F3-P4)

Any future implementation **must** satisfy every clause. A treatment that cannot satisfy a clause is not approved. The repository-backed field model below comes from `database/001_create_tables.sql`: invoice identity is `invoices.id`; document type is `doc_type`; document/base amounts are `total_amount`/`base_total`; outstanding is `outstanding`; lifecycle concurrency is `version`; money uses `DECIMAL(18,2)` and booked rates use `DECIMAL(12,6)`. No plan or implementation may invent an `outstanding_amount`, generic `document_type`, or other non-existent column.

### 6.1 Existing-schema decision and production recovery checkpoint

Repository inspection found no existing relation that is both semantically correct for historical invoice-settlement provenance and structurally row-scoped:

- `customer_change_logs` is customer-master field history;
- `credit_control_logs` is credit-control history (although existing governed RPCs use it for narrowly related corrections, it has no typed `invoice_id` provenance contract);
- `report_audit_logs` records report generation;
- `import_batches`, `import_rows` and `import_row_allocations` describe actual imports and must not be used when no import occurred;
- FX decision/event tables describe booked-rate governance, not settlement provenance.

P3 must re-check the **installed** schema before deciding. It may reuse an existing structure only if P2 and independent review prove that the structure truthfully represents the selected treatment, has typed company/invoice scope, is append-only and meets §6.9. It must not misuse an unrelated audit table to avoid P3S. P2/M-1 therefore normally requires the separate **F3-P3S** gate.

Before any P3S or P4 write, capture a verified production recovery point with identifier, timestamp and restore procedure. Recovery is potentially destructive to concurrent legitimate work and is a last-resort containment mechanism, not the normal rollback. Creating or restoring it requires the applicable separate authorization.

### 6.2 Company-scoped canonical selector and immutable manifest

There are two distinct selectors; conflating them is prohibited:

1. **P1 diagnostic candidate selector.** A `SELECT`-only, exact-company query identifies the diagnosed shape using all relevant conditions: `company_id = :approved_company_id`, `doc_type = 'Invoice'`, `status = 'Paid'`, `outstanding = 0.00::NUMERIC(18,2)`, positive document amount, raw settlement-equation mismatch, the diagnosed dependency/provenance absence profile, and the recorded bulk-load context. It must return **exactly 128 IDs** and exact `total_amount` **2,681,703.31**. These predicates establish the candidate population but are not sufficient execution authority because status and dependencies are mutable.
2. **Approved execution selector.** The frozen manifest is an explicit set of exact `(company_id, invoice_id)` primary-key pairs approved at P2 and implemented at P3. P4 joins `public.invoices` to that exact set and never regenerates the target by `status`, date, amount or a broad predicate. The exact production company UUID is captured in the controlled manifest at P1; this plan does not guess or publish it.

Canonical ordering is **`ORDER BY company_id, invoice_id`** for discovery output, manifest generation, dry run, lock acquisition, execution and post-execution verification. A different order is a test failure. The manifest also records the 922 Open-context IDs or an ordered fingerprint over those exact IDs. The 128 target IDs and 922 context IDs must be disjoint, their union must match the diagnosed 1,050-row cohort, and **no Open-context ID may be mutated**.

The manifest is derived from the separately authorized P1 extract, classified and approved at P2, frozen at P3, and never silently regenerated. At P4 the operation aborts before mutation if the exact-ID join returns a different row count, company, ordered fingerprint, monetary total, provenance outcome or dependency vector. Missing rows, extra rows, duplicate manifest keys and cross-company entries all abort.

### 6.3 Exact `NUMERIC`/`DECIMAL` and canonical serialization contract

All financial decisions and sums execute inside PostgreSQL with exact `NUMERIC`/`DECIMAL` arithmetic:

- header, allocation, discount, credit-note and base amounts retain the schema's `DECIMAL(18,2)` contract;
- booked rates retain `DECIMAL(12,6)`;
- `ROUND(value, 2)` is used only where the existing financial contract already requires a two-decimal result;
- no JavaScript `Number`, binary floating point, approximate comparison, tolerance, client-side monetary sum or float-derived hash input is allowed.

The canonical fingerprint payload is an ordered `jsonb_build_array(...)::text` whose elements are already normalized strings or JSON nulls. Serialization rules are fixed and locally tested:

- UUID: lowercase canonical `uuid::text`;
- `DECIMAL(18,2)`: `to_char(value, 'FM9999999999999990.00')`;
- `DECIMAL(12,6)`: `to_char(value, 'FM999990.000000')`;
- integer/version: base-10 text without padding;
- date: `YYYY-MM-DD`;
- `TIMESTAMPTZ`: UTC `YYYY-MM-DDTHH24:MI:SS.USZ`;
- `CHAR(3)`: `upper(btrim(value::text))`;
- text: exact stored text as a JSON string (no locale-sensitive transformation);
- SQL null: JSON null, never empty string or a magic financial value.

Per-row and dependency hashes use `encode(digest(canonical_payload, 'sha256'), 'hex')`. `pgcrypto` is repository-required by `database/001_create_tables.sql`; P3 must verify the installed/local PostgreSQL version produces the same payload and digest before approval. Cohort hashing uses `string_agg(row_fingerprint, '' ORDER BY company_id, invoice_id)` and SHA-256 over that ordered sequence. Money is serialized from exact `NUMERIC`, never through a float.

### 6.4 Required manifest fields and fingerprints

For every target row the controlled manifest records or hashes the following actual `public.invoices` fields:

- identity and tenant: `id`, `company_id`, `customer_id`, `invoice_no`;
- document/lifecycle: `doc_type`, `invoice_date`, `due_date`, `status`, `posting_period`, `version`;
- currency and exact monetary state: `currency`, `exchange_rate`, `base_currency`, `subtotal`, `tax_total`, `total_amount`, `base_total`, `outstanding`;
- references relevant to drift/provenance: `reference_no`, `internal_remarks`, `invoice_remarks`, `ref_invoice_id`, `cn_type`, `reason_code`, `reason_desc`, `ar_acct`;
- lifecycle attribution and timestamps: `created_by`, `created_at`, `posted_by`, `posted_at`, `cancelled_by`, `cancelled_at`, `cancel_reason`, `updated_at`;
- installed-schema extension fields such as `fx_source_category` and `fx_decision_id`, when the catalog shows they exist. Catalog absence is recorded explicitly rather than treating a non-existent column as null.

Unnecessary personal data, including `customer_name`, is not copied into general evidence. If P3 proves a stored snapshot field is needed for drift detection, it may be included only inside the controlled hash payload, not printed in the sanitized report.

The immutable artifact contains:

- one per-row invoice fingerprint;
- one ordered full-128 cohort fingerprint;
- exact row count `128` and exact `NUMERIC(18,2)` total `2681703.31`;
- a disjoint 922-row Open-context fingerprint and exact totals;
- exact per-branch P1/P2/P3/P5 partition counts/totals when P4 mixed-population treatment applies;
- one installed-catalog fingerprint and one dependency count/fingerprint vector per source-known dependency family;
- the authoritative provenance evidence reference and approved outcome for each row;
- expected before/after values and expected deltas for every field the selected treatment may change.

Any mismatch against any per-row hash, cohort hash, total, count, catalog state, dependency vector or provenance classification aborts.

### 6.5 Dependency and tenant checks

P1 and P3 must discover the installed dependency graph from the PostgreSQL catalog and then check the source-known relations below. P4 repeats the exact checks after locks are held:

- `invoice_lines.invoice_id`, including `discount_amt`, line amounts and taxes;
- `allocation_details.invoice_id` in **every** status, including `allocated_amount`, `discount_amount`, linked `receipt_id` and reversal metadata;
- `cn_allocations.invoice_id` and `cn_allocations.cn_id` in every status;
- linked Credit Notes through `invoices.ref_invoice_id`; related Invoice/Credit Note/Debit Note headers in the unified `invoices` table;
- `journal_entries.source_doc_id` and related `journal_entry_lines`;
- `import_rows.invoice_id`, its `import_batches` parent and `import_row_allocations.invoice_id`;
- relevant typed audit/history/provenance records;
- installed FX decision/event references if those schema objects exist at the time of execution;
- every additional FK, trigger or typed reference discovered from the installed catalog.

Each vector records exact counts, exact monetary sums where applicable and ordered row fingerprints. Every target invoice's `customer_id` must resolve to a customer in the same expected `company_id`; every dependent receipt/journal/import/provenance row must be company-consistent through its authoritative parent. **Zero ownership anomaly is a precondition.** E1A's prior absence result is never assumed current.

### 6.6 One bounded serializable transaction and deterministic locking

Each separately approved exact-manifest P4 operation first repeats the complete manifest/company/count/amount/fingerprint/provenance/dependency preflight using `SELECT` only. Any drift stops before a transaction is opened. A passing preflight is not mutation authority and is not trusted across the gap: the operation then runs as **one short transaction** and repeats the same checks after locks. Mixed P4 partitions remain separate approved operations. The transaction contract is:

1. `BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE`.
2. Set `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '30s'` (or stricter values proved at P3). A timeout is a complete abort, never a retry inside the same transaction.
3. Load only the approved manifest input and assert uniqueness and exact company scope.
4. For every installed dependency relation whose relevant invoice reference is **not** protected by an FK/locking writer contract (for example `journal_entries.source_doc_id`), acquire the minimum necessary table lock that conflicts with concurrent writes—normally `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE`—in one documented schema/table order. P3 must identify and justify this finite list. These locks are held only for the bounded transaction; failure to acquire within `lock_timeout` aborts.
5. Lock every exact target invoice with `SELECT ... FROM public.invoices ... ORDER BY company_id, id FOR UPDATE`. A row-count mismatch aborts. This parent lock also blocks new FK references that require a conflicting key-share lock.
6. Lock existing dependency rows that are read or changed in the same documented global table order and primary-key order (`ORDER BY ... id FOR UPDATE`). `SERIALIZABLE` remains an additional fail-closed check; it is **not** claimed as the sole phantom barrier for unguarded non-FK references. Any serialization failure aborts and requires a fresh separately reviewed rerun from the precondition step.
7. **After all locks are held**, recompute the installed-catalog state, row count, company/customer scope, per-row fingerprints, full cohort fingerprint, exact monetary totals, provenance classification, 922-row context fingerprint and every dependency count/fingerprint. Any mismatch rolls back before mutation.
8. Apply only the P2-approved treatment to exact manifest IDs. No broad status/date update is permitted.
9. Insert append-only remediation/provenance evidence in the same transaction where applicable, using the exact actor/reason/source/manifest references.
10. Execute treatment-specific postconditions, unchanged-unrelated-row checks, exact expected-delta checks, raw/explained/unexplained reconciliation and idempotency-key checks inside the transaction.
11. On any assertion failure, timeout, exception or serialization failure, roll back the **complete** transaction. No partial commit or best-effort continuation exists.
12. Commit only when all target mutations, evidence inserts and postconditions succeed. Record the sanitized transaction result after commit, never while locks are held.

No network/external API call, manual interaction, credential lookup, logging of sensitive row content or waiting for human input is permitted inside the transaction. Lock acquisition in inconsistent order, mutation of an out-of-manifest row, direct client-role DML and retrying against a changed manifest are prohibited. This closes the identified TOCTOU window because authority is exact-ID bound, FK-protected references are fenced by parent row locks, unguarded relevant writers are fenced by the predeclared short-lived table locks, target/dependency state is revalidated after all locks, and all data/evidence changes commit atomically or not at all.

### 6.7 Actor, reason, source and idempotency

Every operation records truthfully: the authorizing human's approved identity/role, executing database role/process, reason, source-evidence reference, P2 decision, manifest SHA-256 and an idempotency key derived from treatment + manifest fingerprint. An application `auth.users` UUID is recorded only when it is genuinely the actor; it must not be fabricated to fill a nullable field.

The same idempotency key may produce at most one successful remediation/evidence event per row. A second apply verifies the existing final state and returns a no-op result: no duplicate financial effect, no duplicate provenance assertion and no new audit event. A changed manifest or treatment needs a new P2 decision and authorization, not an automatic retry.

### 6.8 Treatment-specific delta and explained-state control

Zero **unexpected** Group A monetary delta remains mandatory. The approved P2 decision declares exact per-row before/after values and one of these treatment classes:

| Treatment | Exact expected behavior |
|---|---|
| **P1 / T-A archival** | Only if synthetic provenance is proved and a truthful archival mechanism exists; exact flag/provenance delta declared. Synthetic rows may be omitted only by an established archival business rule, never by an E1-only exception. |
| **P1 / T-B cancellation** | Exact lifecycle transition and audit delta declared; `total_amount` is not rewritten merely to remove the mismatch. Existing lifecycle constraints must be satisfied by the governed path. |
| **P1 / T-C cleanup** | Exact proven-synthetic IDs deleted only if dependencies are absent and retention is unjustified; document-population total reduces by exactly the manifest total. Not reversible in place. |
| **P2 / M-1 or M-2** | Invoice financial/lifecycle fields unchanged; exact append-only provenance rows/events added. Raw mismatch remains reported; only externally explained count/amount changes. No invoice is removed from monetary/reporting populations. |
| **P3 forward-fix** | Exact sourced status/outstanding (and only other explicitly sourced fields) per row; resulting accounting/reporting delta declared in exact `NUMERIC` amounts. |

No branch creates receipts, allocations, discounts, credit notes, journals, actors, import rows or posting timestamps that did not occur. Any unexpected field or aggregate delta aborts.

### 6.9 RLS, ACL and privileged execution contract

Any persistent provenance/audit relation installed through P3S must be purpose-specific and company/invoice scoped. Its required contract is:

- owned by the exact approved owner (normally `postgres`), with `company_id NOT NULL`, a typed `invoice_id` FK, source/treatment/manifest identifiers and append-only event/supersession fields;
- RLS **enabled** (and `FORCE ROW LEVEL SECURITY` when compatible with the approved owner/executor design);
- `REVOKE ALL` from `PUBLIC`, `anon` and `authenticated`; no anonymous/authenticated write and no client read unless P2 independently justifies a narrow company-scoped read policy;
- least-privilege grants; mutation only by `service_role` and/or `postgres` as explicitly justified;
- database-enforced rejection of `UPDATE` and `DELETE`; a mistake is corrected by a new superseding/revocation/correction event referencing the original record, which remains visible;
- no generic text-only allow-list that automatically legitimizes unrelated invoices.

Any RPC/function installed through P3S must have an exact owner; use `SECURITY DEFINER` only when necessary; set `search_path = ''` and fully qualify all objects; `REVOKE ALL ... FROM PUBLIC`, `anon` and `authenticated`; grant execute only to the justified `service_role`/`postgres`; validate exact `company_id`, approved actor metadata, treatment, idempotency key and manifest fingerprint; accept no broad predicate or unrestricted update input; return sanitized deterministic errors; and insert its audit event atomically. No client-authenticated role may execute the financial mutation.

If P3 chooses a one-time privileged transaction artifact instead of a retained RPC, only the named production executor (`postgres` or another separately approved privileged role) may run it; its literal/controlled input is pinned to the manifest hash; P3 verifies the exact artifact hash; it creates no callable endpoint; and the execution session retains only sanitized evidence afterward. A retained helper must be inaccessible after use or removed only through separately authorized schema action—never by silently leaving a broad mutation surface.

### 6.10 Complete F3-P3 local implementation and test matrix

P3 is not complete until the **production implementation itself** (not a duplicate test-only algorithm) passes all applicable local/static SQL, security/grant, transaction and failure-path checks:

1. Exact PostgreSQL `NUMERIC`/`DECIMAL` arithmetic and canonical two-/six-decimal serialization.
2. Canonical diagnostic selector correctness.
3. Deterministic per-row SHA-256 fingerprint.
4. Deterministic ordered full-manifest SHA-256 fingerprint.
5. Exact 128-row target selection and `2681703.31` total.
6. All exact 922 Open-context rows remain unchanged.
7. Every unrelated invoice remains unchanged.
8. Expected-company mismatch aborts before mutation.
9. A cross-company manifest entry aborts before mutation.
10. Row-count drift aborts.
11. Exact amount or base/rate drift aborts.
12. Version, status, lifecycle timestamp, catalog or dependency drift aborts.
13. Dry-run and apply select the identical ordered exact-ID set.
14. Dry-run performs zero mutation and emits no persistent audit/provenance record.
15. Repeated execution is idempotent.
16. A second apply creates no duplicate financial effect or duplicate evidence.
17. An injected failure causes complete transaction rollback.
18. Failures after an internal target update or evidence insert still commit zero partial mutation.
19. Stable invoice/dependency lock ordering is asserted; conflicting execution times out/serializes safely.
20. P4 mixed-population partition is complete, disjoint and totals exactly 128 / `2681703.31`.
21. Every P5 subset remains blocked and cannot enter an apply manifest.
22. Provenance/audit rows are append-only.
23. Incorrect provenance is superseded/corrected by a linked new event, never deleted or overwritten.
24. `anon` execution/DML is denied.
25. `authenticated` execution/DML is denied.
26. Wrong-company execution is denied even with a valid-looking manifest.
27. Only the approved `service_role`/`postgres` path can mutate.
28. Treatment-specific settlement or P2 explained-state postconditions hold.
29. Raw mismatch and unexplained mismatch counts/amounts are separately and exactly reported.
30. Migration 027 compatibility remains truthful: F3 does not claim 027 validates the equation or rewrites the cohort, and the F3 artifact introduces no false 027 prerequisite.
31. `/allocations/auto` remains disabled with `AUTO_ALLOCATION_DISABLED` by retained source/contract tests.
32. Existing immutable financial-record triggers and mutation boundaries are not weakened; direct `Paid → Cancelled`, non-Draft deletion and any generic bypass remain denied unless a separately reviewed exact-manifest P3S contract proves the narrow exception.
33. No fabricated receipt, allocation, discount, credit-note, journal, actor, import or posting evidence is created.
34. Uncommitted rollback and post-commit compensating behavior match §6.11.

P3 also requires Codex implementation/self-validation, every relevant repository test, SQL/static parsing, RLS/ACL/owner/grant assertions, transaction/concurrency/failure tests, `git diff --check`, secret scans, and one later independent read-only review before any P3S or P4 production authorization is requested. A local PASS grants no production access.

### 6.11 Append-only correction, rollback and forward containment

Append-only means append-only. Provenance and remediation audit records are never deleted, overwritten, physically reversed or truncated as a normal rollback. An incorrect record is addressed only by a new superseding, revocation or correction event that references it and preserves the original defect and all subsequent history.

Inside the initial P4 transaction, any failed assertion or exception triggers full rollback, including target changes and evidence inserts. After commit:

- a mutable lifecycle correction can be changed only by a separately planned, approved and audited compensating operation;
- a P2 provenance mistake is superseded, never erased;
- T-B/P3 corrections are forward-fix history, not direct SQL undo;
- T-C deletion is not reversible in place and relies on the separately verified recovery checkpoint as last resort;
- checkpoint restoration is never described as a casual row-level rollback.

Every compensation preserves the original defect, remediation, correction, actor, reason, timestamps, source reference and before/after fingerprints. No committed financial remediation is casually reversed by dashboard SQL.

### 6.12 Repeated E1 and closure rule

Gate F3-P5 requires separate read-only authorization and re-runs the complete E1 financial baseline without unsupported exclusions:

- For P1/P3 treatments, the ordinary settlement equation must have zero unexplained rows after the exact expected lifecycle/data delta.
- For P2, E1 reports **raw arithmetic mismatch count/amount**, **externally explained historical-state count/amount**, and **unexplained count/amount** separately. Raw mismatch may be non-zero; unexplained count and amount must both be zero and every explained row must map to approved authoritative provenance.
- P5 rows can never be explained, excluded, grandfathered or accepted through tolerance. Any P5 row keeps `B9DE-E1-001` open.
- All unrelated Group A/B/C fingerprints and company ownership checks must pass.

`B9DE-E1-001` closes **only** after this repeated E1 passes. F3-P5 does not close `B9DE-E1-002`; account ownership and credential custody remain a separate governing prerequisite. `B9DE-E1-003` remains closed. A repeated E1 result does not itself authorize Gate 9D-E2.

### 6.13 Authorization map

| Step | Authorization |
|---|---|
| Read-only provenance discovery | **Separate Gate F3-P1 approval** |
| Treatment selection and plan | **Gate F3-P2 approval** + independent review |
| Local implementation and tests | **Gate F3-P3 approval** |
| Staging rehearsal *(optional)* | **Separate explicit staging authorization** |
| Optional production schema prerequisite | **Separate F3-P3S production schema authorization; zero cohort mutation** |
| Production recovery checkpoint | **Separate explicit authorization associated with P4 preparation** |
| **Production data remediation** | **Separate explicit authorization naming treatment + exact manifest** (P4) |
| Repeated E1 | **Separate Gate F3-P5 read-only approval** |
| Gate 9D-E2 backend rollout | **Unchanged and still unauthorized** — not granted by any F3 gate |

---

## 7. Rollout-plan corrections carried by this track

Two corrections to `BATCH_9D_E_PRODUCTION_ROLLOUT_PLAN.md` are required by the E1A diagnosis and are applied alongside this plan.

### 7.1 Migration 027 (rollout plan §2.1 / §4.2.2 / §5.5)

**Corrected position (per evidence §15.5):**

- Migration 027 does **not** validate or depend on the settlement equation.
- It does **not** rewrite these historical `Paid` rows and contains no migration-time update of invoices or settlement rows.
- Its aging/dashboard paths select stored `outstanding` only for Open/Overdue/Partially Paid Invoice/Debit Note rows with **positive** outstanding, so the 128 zero-outstanding rows never enter those totals.
- It **may install successfully** when its ordinary schema prerequisites pass.
- **The 128 rows do not technically block Migration 027 application.**
- **They still block overall E1 financial certification.**

Any active wording classifying Migration 027 as *incompatible solely because of these 128 rows* is removed. **Applying Migration 027 is not authorized** by this correction; the correction is descriptive accuracy only, and the blocker remains F3.

### 7.2 T1 tenant-isolation criteria (rollout plan §4.1.5 / §5.13)

**Accepted model: T1 — STRUCTURAL PRODUCTION + STAGING RUNTIME PROOF.** Production legitimately has one active company; **a second production company must not be created solely for testing**, which would add disproportionate production identity and financial-data risk.

Amended E1 criteria:

1. Production **RLS and ACL inspection** (catalog-level).
2. Production **company-scope predicates** verified.
3. Production **AR Clerk assignment predicates** verified.
4. **Service-only financial mutation boundaries** verified (no direct authenticated INSERT/UPDATE/DELETE on protected financial tables).
5. **Zero production ownership anomalies**, recorded per relationship.
6. **Accepted staging two-company runtime evidence** reused as the cross-tenant runtime proof.
7. A **later approved production Finance Manager smoke**.
8. **Assigned and unassigned AR Clerk smoke within the existing company**.
9. **Explicit account-owner and credential-custody approval before any login.**

**Authoritative production smoke identity set under T1 — exactly four:** (1) authenticated general user; (2) Finance Manager; (3) assigned AR Clerk; (4) unassigned AR Clerk. **No production cross-tenant identity pair is required** — that active requirement is removed. Cross-tenant assurance comes from production structural RLS/ACL/company-scope proof, zero production ownership anomalies, and the accepted **staging** two-company runtime evidence, which **must never be described as production runtime evidence**.

**Missing account custody may remain a readiness blocker.** T1 resolves the second-tenant requirement; it does **not** authorize authenticated smoke, and it does **not** establish custody. **No second production company or user is created. No login, user creation, password reset, or identity mutation is authorized.**

### 7.3 Vercel name-only checkpoint (rollout plan §2.13 / §4.1.6)

The E1A Vercel result was a **connector-capability limitation** — the authorized metadata interface does not expose environment-variable names. **This must not be described as variable absence.**

A manual sanitized checkpoint was added, requiring **only**: exact name; `PRESENT`/`ABSENT`; Production target `YES`/`NO`; verification time; sanitized reviewer identity/role. **Never** request or record values, prefixes, screenshots containing values, hashes, or exports.

**STATUS: COMPLETE — `B9DE-E1-003` CLOSED by sanitized manual name-only verification.** The project owner inspected Vercel project `account-receivable-module`, Production target filter, at **2026-07-20 18:56 MYT**:

| Variable name | Presence | Production target |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **PRESENT** | **YES** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **PRESENT** | **YES** |
| `NEXT_PUBLIC_API_BASE_URL` | **PRESENT** | **YES** |
| `NEXT_PUBLIC_DEFAULT_COMPANY_ID` | **PRESENT** | **YES** |

**No value was opened, copied, expanded, exported or recorded.** `NEXT_PUBLIC_DEMO_USER_ROLE` and `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID` are outside this four-variable checkpoint and were neither verified nor changed. Evidence: `SPRINT_BATCH_9D_E1_PRODUCTION_READ_ONLY_PREFLIGHT_EVIDENCE.md` § *Batch 9D-E1 Manual Vercel Name-Only Verification*.

---

## 8. Interaction with the wider Batch 9D-E rollout

| Item | Status |
|---|---|
| Gate 9D-E1 decision | **NO-GO** — unchanged |
| Gate 9D-E2 (backend rollout) | **Unauthorized** — must not begin until a repeated E1 passes |
| Gate 9D-E3 (push + frontend deploy) | **Unauthorized** |
| Gate 9D-E4 (scheduler + closure) | **Unauthorized** |
| `daily-overdue` vulnerable production bundle | Remains a **mandatory first-order E2 security remediation**; **not** advanced by this track |
| `B9DE-E1-001` (financial, High) | **OPEN** — **F3 — PRODUCTION DATA DEFECT**. The 128-row remediation/provenance track remains **blocking**. Addressed by this plan; **closes only at Gate F3-P5** |
| `B9DE-E1-002` (tenant, material Medium) | **PARTIALLY RESOLVED** — T1 tenant-assurance model accepted (§7.2); **a second production tenant is not required**; existing-account ownership and credential custody remain **PENDING** before any later authenticated smoke |
| `B9DE-E1-003` (Vercel, material Medium) | **CLOSED by sanitized manual name-only verification** — all four required Production environment-variable names verified **PRESENT** with Production target **YES** (2026-07-20 18:56 MYT, project owner). Evidence: `SPRINT_BATCH_9D_E1_PRODUCTION_READ_ONLY_PREFLIGHT_EVIDENCE.md` § *Batch 9D-E1 Manual Vercel Name-Only Verification*; rollout plan §4.1.6.1 |

> **Gate 9D-E1 remains `NO-GO — BATCH 9D-E1 PRODUCTION PREFLIGHT BLOCKED`.** Closing `B9DE-E1-003` and partially resolving `B9DE-E1-002` does **not** convert the gate decision, because `B9DE-E1-001` (**F3**, High) remains open. **Gate 9D-E2 remains unauthorized. No production mutation occurred during that plan-remediation checkpoint; the later separately authorized F3-P4 reset is recorded in §12.**

**Sequencing rule.** F3 remediation is a **prerequisite to** the rollout, not a part of it. The F3-P4 production operation must **not** be bundled with any Gate 9D-E2 migration or function deployment: they have different risk profiles, different rollback classifications, and different authorizations.

---

## 9. Quality standard (proportionate FYP production standard)

This is a high-quality, production-minded Final Year Project, **not** a full enterprise production platform.

**Blocking — any of these stops the gate:**

- unsupported financial values;
- invented settlement evidence;
- tenant leaks;
- money errors;
- uncontrolled production mutation;
- missing audit trail;
- non-idempotent remediation;
- no recovery or containment path;
- any **Critical**, **High**, or **material Medium** finding.

**Explicitly not required — do not add:**

- enterprise incident-management infrastructure;
- on-call systems or paging;
- mutation testing;
- redundant review cycles beyond one independent plan review and the one required independent implementation/security review after P3;
- a second production tenant solely for testing;
- architecture for unreachable scale.

**Proportionality guidance.** Prefer the smallest mechanism that is truthful and auditable. One narrow table (M-1) beats an event-sourcing subsystem. One reviewed migration beats a remediation framework. Complexity that does not reduce financial risk is not justified here.

---

## 10. Plan status

- **Status:** **REV 2 ACCEPTED; F3-P1/P2/P3/P4 COMPLETE; F3-P5 FINANCIAL AND INTEGRITY RECHECK PASSED, OVERALL E1 REMAINS NO-GO.** The exact-manifest reset remains verified, but account-custody attestation and a newly disclosed personal-access-token incident remain blocking.
- **Authorization granted by this document: NONE.** Production mutation, Gate 9D-E2, push, deployment, migrations, credentials, identities, and schedulers all remain unauthorized.
- **Gate 9D-E1 remains NO-GO.** Gate 9D-E1A remains PASS. Neither is reopened here.
- **F3 classification stands** and is not weakened, relabelled, or excluded.
- **Next action:** resolve the two non-financial blockers under separate authority, then repeat Gate E1 read-only. Gate E2, push, deployment, migrations, credentials, identities and schedulers remain unauthorized.

---

## 11. Authoritative F3-P1/P2/P3 test-data-reset checkpoint

### 11.1 Formal provenance and treatment decision

F3-P1 completed read-only and the project owner/data custodian attested that the current Production AR business population is synthetic test/demo/smoke data and represents no real customer, legal receivable or settlement transaction. The formal outcome is therefore **P1 — SYNTHETIC / DEMO DATA**. This is not P2 historical-state treatment and not P3 lifecycle correction. The approved treatment design is an exact-manifest Production test-data reset retaining exactly ten principal demo scenario anchors and deleting the remaining synthetic AR graph. This decision does not itself authorize Production mutation.

The original 128 `Paid`/zero-outstanding/no-settlement invoices were all in the deletion manifest. The separately expanded scope also placed all 922 non-retained header-only `Open` invoices in that manifest. Exact F3-P4 execution removed both populations, so `B9DE-F3-P1-001` is **CLOSED by the completed reset**. The later F3-P5 result is authoritative in §13: `B9DE-E1-001` is technically remediated but remains **OPEN by the governing whole-gate closure rule** while the repeated E1 is NO-GO.

### 11.2 Fixed ten-scenario manifest

The selection has ten ordered invoice anchors and ten rationale labels: paid allocation reversal; partially paid plus debit note; overdue receipt allocation; paid SGD multi-receipt; open EUR FX; open SGD import; paid discount import; partially paid import; open USD FX; and open MYR posted. No Credit Note exists in the installed population, so the manifest does not invent one. Exact UUIDs remain confined to the uncommitted one-time operator; documentation records only labels, counts and hashes.

Dependency closure expands the ten anchors to 16 retained invoice documents because shared receipts/import batches/journal chains must remain coherent. It retains 179 rows across the bounded AR graph: 11 customers, 16 invoices, 14 invoice lines, 11 receipts, 13 allocation details, 25 journal entries, 50 journal lines, six import batches, six import files, 20 import rows and seven import-row allocations. It retains zero CN allocations, customer-bank rows and OCR decisions. Eleven customers are retained rather than ten because two existing protected customer assignments and immutable audit dependencies are preserved and one such customer is not otherwise reachable from the ten scenario anchors.

The ordered full-retention SHA-256 is `36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0`; row count is 179. Retained invoice totals are `314889.16` total, `262792.16` outstanding and `316054.16` base. Retained receipt totals are `50587.00` receipt, `50386.00` allocated and `200.00` unallocated. Retained allocation totals are `50388.00` cash, `10.00` discount and `50621.00` base. All arithmetic is PostgreSQL `NUMERIC`; no JavaScript `Number`, float summation or approximate equality is used.

### 11.3 Exact deletion manifest and expected after-state

The ordered full-deletion SHA-256 is `cfa7d6d7bc739bd190fb14a2e8bb680dc473fbe1e678db1b1235f07e9b75cb7d`; row count is 2,651. It includes 897 customers, 1,112 invoices, 61 invoice lines, 29 receipts, 13 allocations, 87 journal entries, 174 journal lines, 63 import batches, 63 import files, 139 import rows, three import-row allocations and ten OCR decisions. It includes no CN allocations or customer-bank rows. Exact table hashes, IDs and totals are generated by `database/operators/batch_9d_e1_f3_test_data_reset_manifest.sql`; mutation is bound to the approved arrays and full hash in `database/operators/batch_9d_e1_f3_test_data_reset_apply.sql`.

All 128 diagnosed `Paid` invoices are asserted at exact total `2681703.31` and outstanding `0.00`. All 922 header-only `Open` invoices are asserted at exact total and outstanding `18235664.61`. Neither status nor customer prefix controls deletion; those predicates are diagnosis assertions only after exact IDs have been frozen.

The expected database after-state is exactly the retained graph above. Six retained Storage objects remain. The 63 non-retained Storage objects have ordered `bucket|name` hash `f77add7cc35df009832237db3083c1db63a65eb0d8477aa1b5fd0e6fa7551094` and form a separately bounded, retryable post-database phase because PostgreSQL cannot atomically commit Storage API deletion. Object names are ephemeral execution input and must not be copied into evidence or Git.

### 11.4 Operator, lifecycle and authorization contract

The dry run is `REPEATABLE READ READ ONLY`, returns `READY`, `DRIFT_STOP` or `ALREADY_APPLIED`, reports exact per-table counts/totals/hashes and always rolls back. The apply artifact is not a migration. Under the separately authorized F3-P4 it ran once as `postgres` with the exact non-secret manifest authorization binding. It used one `SERIALIZABLE` transaction, local lock/statement timeouts, deterministic table and `FOR UPDATE` row ordering, complete post-lock re-hashing, exact-ID deletion in FK-safe order, retained settlement/post-state checks and all-or-nothing rollback.

No P3S schema prerequisite is currently required because Production has zero target lifecycle-protection triggers and the reset is intentionally sequenced before Migration 028. This is explicit pre-hardening ordering, not a trigger bypass. The operator never disables triggers and aborts if any target lifecycle trigger is present. If the trigger set changes, execution stops and any P3S requires separate schema authorization; F3-P4 remains data-only.

The operation contains no reference to or DML against `auth.users`; auth identities are therefore outside its executable surface. It protects the company, roles, user-customer assignments and immutable customer/credit-control/report audit rows with before/after hashes. It installs no RPC, grants no role, creates no reusable financial mutation path and cannot be invoked by `anon`, `authenticated` or `service_role`. Storage deletion, if later authorized, occurs only after the database commit and uses the separately captured exact 63-object manifest.

### 11.5 Implementation artifacts and validation status

- `database/operators/batch_9d_e1_f3_test_data_reset_manifest.sql` — read-only exact-manifest dry run.
- `database/operators/batch_9d_e1_f3_test_data_reset_apply.sql` — exact-ID, postgres-only F3-P4 operator; executed once successfully under the approved binding.
- `database/operators/batch_9d_e1_f3_test_data_reset_contract_test.ts` — permanent static/model contract tests.
- `docs/runbooks/BATCH_9D_E1_F3_PRODUCTION_TEST_DATA_RESET_RUNBOOK.md` — authorization, execution, containment and Storage sequencing.

The source-file dry run was executed against the authorized Production project only in `READ ONLY` mode and returned `READY`: ten principal anchors, ten matching scenario hashes, 179 retained rows, 2,651 deletion rows, zero retained settlement-equation mismatches, 0 unclassified FKs and 0 target lifecycle triggers. The apply artifact then committed exactly once under the separate F3-P4 production-mutation authorization. Fresh read-only verification returned `ALREADY_APPLIED` with the approved retained hash and all expected after-state counts.

At this F3-P4 implementation checkpoint Gate E1 remained **NO-GO — BATCH 9D-E1 PRODUCTION PREFLIGHT BLOCKED**. The later F3-P5 result and current four-finding matrix are authoritative in §13. Gate E2 remains unauthorized.

---

## 12. Authoritative F3-P4 execution checkpoint

**Execution date:** 2026-07-21 (Asia/Kuala_Lumpur)
**Authorized target:** Production project `kusseuycqgdilychphpq`, company `00000000-0000-0000-0000-000000000001` only.

The mandatory read-only dry run returned the exact approved `READY` state before mutation. The database operator then committed exactly once as one guarded `SERIALIZABLE` transaction. No assertion failed and the operator was not rerun during recovery. It deleted the exact 2,651-row manifest: 897 customers, 1,112 invoices, 61 invoice lines, 29 receipts, 13 allocation details, 87 journal entries, 174 journal lines, 63 import batches, 63 import files, 139 import rows, three import-row allocations and ten OCR decisions; CN allocations and customer-bank deletions were both zero.

Fresh read-only post-commit checks, repeated after Storage cleanup, confirmed exactly ten principal anchors and the dependency-closed 179-row graph: 11 customers, 16 invoices, 14 invoice lines, 11 receipts, 13 allocation details, 25 journal entries, 50 journal lines, six import batches, six import files, 20 import rows and seven import-row allocations. Retained exact monetary totals remain: invoices `314889.16` total, `262792.16` outstanding and `316054.16` base; receipts `50587.00` received, `50386.00` allocated and `200.00` unallocated; allocation details `50388.00` cash, `10.00` discount and `50621.00` base. The retained database hash remains `36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0`; retained settlement mismatches, unclassified FKs and target lifecycle triggers are all zero. The 128 defective `Paid` invoices and 922 non-retained header-only `Open` invoices both have zero remaining rows.

The separately bounded Storage phase removed all 63 exact approved delete objects in batches of at most five. The final read-only listing contains only the six approved retained objects, with retained hash `b5f58c7c85358da973280bf4e59f5862944e451f50cd521cd6f7c05139468620`; approved delete objects remaining are zero. No prefix, wildcard, folder or bucket-wide deletion was used, and no full object name is recorded here.

This completed F3-P4 only. `B9DE-F3-P1-001` is closed by the exact reset. The later F3-P5 result is recorded in §13. No migration, DDL, Edge Function, scheduler, credential change, identity change, staging, Vercel, Git commit, stage or push action occurred.

---

## 13. Authoritative F3-P5 repeated Gate E1 checkpoint

**Execution date:** 2026-07-21 (Asia/Kuala_Lumpur)
**Mode:** Production SQL/catalog/Storage metadata read-only; no RPC, Edge Function, login or mutation.

Fresh manifest-derived verification returned `AFTER_STATE_MATCH`: ten principal anchors and ten scenario hashes match; the complete retained graph is 179 rows with hash `36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0`; the deletion graph, former 128-row `Paid` cohort and former 922-row header-only `Open` cohort all remain at zero. Storage contains exactly the six retained objects, zero approved delete objects, and retained hash `b5f58c7c85358da973280bf4e59f5862944e451f50cd521cd6f7c05139468620`.

The full Production financial recheck covered all 16 retained documents rather than silently filtering by status. Thirteen active/settled documents balance directly. Two Draft documents have a raw `1700.00` difference and one Cancelled document a raw `1.00` difference; all three satisfy the source-backed pre-posting/cancellation contracts, including line totals, zero active settlement, cancellation metadata and linked journal reversal. The one Bounced receipt has a raw `1.00` difference and satisfies the source-backed bounce contract, including zero active allocation, complete reversal metadata, linked journal reversal and credit-control evidence. Therefore document and receipt unexplained mismatch counts and amounts are both zero.

Receipt active/stored reconciliation, allocation cash/discount/base/FX precision, journal header/line/base equality, reversal links, currency/base arithmetic, company/customer consistency and all reviewed dependency/orphan checks passed. Exactly one active company exists; all scoped rows belong to it. RLS is enabled on all 16 reviewed company/child tables, every table has tenant-bound policies, and no unconditional policy was found. T1 remains accepted.

Migration 027 is deterministically `MISSING`: none of its six named routines exists, no conflicting relation exists, all required tables/columns and the authenticated role/auth helper exist, the Production base company is MYR, and data-assumption violations are zero. The migration is technically ready for a later separately authorized E2 application and was not installed here. The four accepted Phase A hashes remain exact, the 12-case source contract passes, and `/allocations/auto` remains source-disabled with `AUTO_ALLOCATION_DISABLED`.

**Overall decision remains NO-GO.** Database metadata proves that the four required smoke identity types have candidates and zero ownership-link anomalies, but it cannot prove credential custody; no explicit owner attestation was supplied, so `B9DE-E1-002` remains **PARTIALLY RESOLVED**. In addition, a Supabase personal access token was disclosed in the conversation immediately before this gate. Its value was not used or recorded in repository evidence, but revocation has not been verified; new finding `B9DE-E1-004` (**High, OPEN**) requires separate credential-incident authorization, revocation/replacement and old-token rejection proof.

`B9DE-E1-001` remains **OPEN by the governing whole-gate closure rule**, although its financial/data remediation and F3-P5 technical certification passed. `B9DE-F3-P1-001` remains closed; `B9DE-E1-003` remains closed. Gate E1 remains `NO-GO — BATCH 9D-E1 PRODUCTION PREFLIGHT BLOCKED`; Gate E2 remains unauthorized.
