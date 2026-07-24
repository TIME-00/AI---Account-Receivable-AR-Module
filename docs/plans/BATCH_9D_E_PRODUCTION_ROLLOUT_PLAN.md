# Batch 9D-E — Production Rollout and Verification — Plan (Rev 4.1, PostCSS Remediation)

- **Batch:** 9D-E — Production Rollout and Verification (final Batch 9D batch).
- **Type:** Production rollout plan and completed execution record. Historical planning-only and gate-specific authorization boundaries remain preserved in their dated sections.
- **Author:** Claude Code (planning). **Rev 2** closed Codex findings **B9DE-PR-001 … B9DE-PR-010**; **Rev 3** closed **B9DE-FPR-001 … B9DE-FPR-006**; **Rev 3.1** corrects the commit-identity **Git self-reference** defect only.
- **Revision:** **Rev 4.1**, 2026-07-24 — records independent review's PostCSS advisory finding, transparent correction of the former audit-zero statement, exact compatible remediation and Production frontend redeployment readiness. Rev 4.0 remains the consolidated rollout checkpoint.
- **Status:** **Gates 9D-E2/E3/E4 were executed and the Production rollout remains deployed. PostCSS remediation is locally complete and awaiting its exact Production redeployment; Batch 9D then awaits final independent remediation closure review.**
- **`BATCH_9D_D_CODE_COMMIT`:** `233005146f7e9551e45fc437fc7fcade678a9f62` (`feat(ar): complete Batch 9D-D multi-currency allocation closure`) — the **immutable accepted implementation**. See §0.1.
- **`BATCH_9D_E_ROLLOUT_HEAD`:** a **symbolic** identity — the clean local `main` HEAD **resolved at Gate 9D-E1 runtime** after the authorized Batch 9D-E planning commit exists. Its concrete SHA is **never written into this document**. See §0.1.
- **`origin/main` at planning time:** `d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d`.
- **Worktree at Rev 2 authoring time (pre-planning-commit):** HEAD at `BATCH_9D_D_CODE_COMMIT`, ahead **1** / behind **0**, 0 staged; **1 modified tracked file** (the Batch 9D master plan) and **1 untracked file** (this plan), plus 18 unrelated untracked paths under `social-media/`.
- **Current F3-document remediation worktree:** HEAD remains `c24249f037164edd8e08b3cf15f7180973a78c4d`, ahead **2** / behind **0**, staged **0**; two tracked plan files are modified and the E1 evidence plus F3 plan are untracked Batch documents; 18 unrelated untracked `social-media/` paths remain untouched. This is not the historical clean E1 entry state.
- **Production Supabase project ref:** `kusseuycqgdilychphpq`.
- **Staging Supabase project ref:** `gcdsdyegwjdcskpukqlq`.
- **Production frontend URL:** `https://account-receivable-module.vercel.app/`.

> ## Authorization statement
>
> **This plan grants NO authorization.** Every gate is a *proposal* requiring separate, explicit user approval before any execution. Reading this document does not permit contacting `kusseuycqgdilychphpq` or `gcdsdyegwjdcskpukqlq`, pushing to GitHub, or deploying anything.

> ## Historical Gate 9D-E1 closure boundary (updated 2026-07-23; superseded by the executed consolidated rollout)
>
> A separately authorized bounded Production operator removed only `public.user_roles."Temp Allow All"`.
> The source-backed `ur_select` policy remains unchanged and provides self-or-active-same-company
> visibility. Rollback-only and installed-state `authenticated` simulations matched exact expected role-row
> sets for all five existing identities; random user and random-company results were zero. The 20-table
> RLS scan now returns unconditional SELECT/write `0/0`, with all other policy, grant and helper
> fingerprints unchanged. Business graph/hash/totals, Storage and identity state remain exact. Findings
> 001–005 are CLOSED and Gate 9D-E1 is **PASS / GO**. At that historical checkpoint Gate E2 still
> required separate authorization; that authorization was later granted and E2/E3/E4 were executed. See
> E1 evidence §27 and the `B9DE-E1-005` runbook.
>
> ## Historical pre-remediation blocking status (Rev 3.8; superseded by the closure above)
>
> Gate 9D-E1 was **executed read-only** and returned **`NO-GO — BATCH 9D-E1 PRODUCTION PREFLIGHT BLOCKED`**. Gate 9D-E1A then returned **`PASS — BATCH 9D-E1A READ-ONLY BLOCKER DIAGNOSIS COMPLETE`**. F3-P4/F3-P5 passed the data reset and financial/integrity certification; the corrected four-identity lifecycle and independent review closed `B9DE-E1-002`. On 2026-07-23 the owner credential-revocation attestation and clean scans closed `B9DE-E1-004`, but fresh catalog inspection found a tenant-unbound authenticated `SELECT` policy on `public.user_roles`; new High finding `B9DE-E1-005` keeps overall E1 at NO-GO. Evidence: `docs/evidence/SPRINT_BATCH_9D_E1_PRODUCTION_READ_ONLY_PREFLIGHT_EVIDENCE.md` §§13–26.
>
> | Finding | Severity | Status |
> |---|---|---|
> | `B9DE-E1-001` — F3 production data defect | **High** | **OPEN by whole-gate closure rule; technically remediated** — F3-P4 removed the defective populations and F3-P5 financial/integrity certification has zero unexplained mismatch; overall E1 remains NO-GO |
> | `B9DE-E1-002` — Production identity/RLS runtime readiness | **Material Medium** | **CLOSED** — corrected ephemeral four-identity create/authenticate/read-only-test/destroy lifecycle passed with zero residue; T1 remains accepted and no second tenant is required |
> | `B9DE-E1-003` — authorized Vercel interface did not expose environment-variable names | **Material Medium** | **CLOSED** — all four required Production environment-variable names manually verified **PRESENT** with Production target **YES** (§4.1.6.1), sanitized name-only, 2026-07-20 18:56 MYT |
> | `B9DE-E1-004` — Supabase personal access token disclosed in conversation before F3-P5 | **High** | **CLOSED** — owner attests PAT revocation and dedicated ephemeral Secret-key deletion; environment/runner removed; credential and full-synthetic-email scan returned zero |
> | `B9DE-E1-005` — authenticated tenant-unbound read policy on `public.user_roles` | **High** | **OPEN** — Production policy `Temp Allow All` grants `authenticated` `SELECT` with `USING (true)`; this read-only gate did not alter it |
>
> **Gate 9D-E1 remains `NO-GO`.** Findings 002–004 are closed, but `B9DE-E1-005` is High/Open and `B9DE-E1-001` remains open by the whole-gate rule. No automatic progression to E2 is permitted.
>
> **Historical stop condition (satisfied and superseded):** Gate 9D-E2 could not begin until
> `B9DE-E1-005` was remediated and E1 passed. Those conditions were later satisfied, the user separately
> authorized the consolidated E2/E3/E4 rollout, and all three gates were executed. This paragraph is not
> a current authorization restriction.

> ## Rev 2 governing principle
>
> **Production state is UNVERIFIED until Gate 9D-E1 observes it.** Every production fact in this plan is *evidence-derived* and carries an `(E1)` marker. Gate 9D-E2 consumes **E1-produced manifests and identities**, never this document's expectations. Where Rev 1 asserted production facts, Rev 2 downgrades them to hypotheses requiring confirmation.

---

## 0.1 Commit Identity Model (B9DE-FPR-001) — AUTHORITATIVE

> **Rev 2 defect corrected.** Rev 2 conflated the accepted *code* commit with the future *rollout* HEAD, and therefore instructed E1/E3 to require `HEAD == 2330051`, "ahead exactly 1", and "push `2330051`". **Creating the Batch 9D-E planning commit necessarily moves `main` beyond `2330051`**, so those instructions would have failed the gate they were meant to protect, or invited someone to push a commit that does not contain this plan. Rev 3 separates the two identities.

### Two distinct identities

| Symbol | Meaning | Value |
|---|---|---|
| **`BATCH_9D_D_CODE_COMMIT`** | The immutable accepted Batch 9D-D implementation. Defines *what code* is being rolled out. | `233005146f7e9551e45fc437fc7fcade678a9f62` — **fixed and known** |
| **`BATCH_9D_E_ROLLOUT_HEAD`** | **Symbolic definition:** the clean local `main` HEAD resolved operationally after the authorized Batch 9D-E planning commit exists. Defines *what commit is pushed and deployed*. | **Symbolic — resolved at E1 runtime, never written into this document** |

**`BATCH_9D_D_CODE_COMMIT` must remain an ancestor of the resolved rollout HEAD.**

> **No future SHA is hardcoded anywhere in this plan.** `BATCH_9D_E_ROLLOUT_HEAD` is a symbolic name whose value is produced by a runtime command, not by a documentation edit.

### The Batch 9D-E planning commit (separately authorized — NOT authorized by this plan)

The planning commit may contain **only**:

1. `docs/plans/BATCH_9D_E_PRODUCTION_ROLLOUT_PLAN.md`;
2. the approved Batch 9D master-plan update (`docs/plans/BATCH_9D_DAILY_FX_RATE_SYNC_AND_MULTI_CURRENCY_UX_PLAN.md`).

**No source, migration, package, environment, or `social-media/` path may enter it.**

### Runtime resolution — no self-referential SHA recording

> **Rev 3.1 defect corrected (self-reference).** Rev 3 required the planning commit's SHA to be written back into the very documents that commit contains. That is unsatisfiable: writing the SHA changes the documents, which requires another commit, which produces a different SHA — an infinite loop. **The concrete rollout HEAD is therefore never written into the commit it identifies.**

**The committed plan contains only the symbolic definition above and the resolution procedure below.**

> The concrete rollout HEAD will be resolved from the clean local Git HEAD and captured in the Gate 9D-E1 execution evidence after the planning commit is complete.

**Resolution procedure — at Gate 9D-E1 entry:**

```
git rev-parse HEAD        →  RESOLVED_BATCH_9D_E_ROLLOUT_HEAD
```

`RESOLVED_BATCH_9D_E_ROLLOUT_HEAD` is stored in:

1. the **E1 execution report**;
2. the **E1 evidence artifact**;
3. the **authorized execution session** (carried forward to E2/E3/E4);
4. **later production rollout evidence**.

**Prohibited:**

- requiring the planning commit's SHA to be written into that same commit;
- editing either plan after the planning commit merely to insert its SHA;
- creating any **additional Git commit** solely to record the identity;
- **E1 rejecting the symbolic definition** — a symbolic `BATCH_9D_E_ROLLOUT_HEAD` in this document is the *correct* committed state, not a blocker;
- hardcoding a concrete future SHA before it exists.

### Gate identity requirements

**Gate E1 must derive and record `RESOLVED_BATCH_9D_E_ROLLOUT_HEAD`, then verify:**

1. Local branch is **`main`**.
2. **Staged tracked paths = 0.**
3. **Unstaged tracked paths = 0.**
4. Only the unrelated untracked `social-media/` paths remain.
5. `BATCH_9D_D_CODE_COMMIT` **is an ancestor of** `RESOLVED_BATCH_9D_E_ROLLOUT_HEAD` (`git merge-base --is-ancestor`).
6. Every commit **after** `BATCH_9D_D_CODE_COMMIT` through `RESOLVED_BATCH_9D_E_ROLLOUT_HEAD` changes **only** `docs/plans/BATCH_9D_E_PRODUCTION_ROLLOUT_PLAN.md` and `docs/plans/BATCH_9D_DAILY_FX_RATE_SYNC_AND_MULTI_CURRENCY_UX_PLAN.md`.
7. **No source, migration, package, configuration, environment or `social-media/` path changed** after the accepted code commit.
8. `origin/main` remains the documented pre-push baseline (`d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d`) unless separately updated by an explicitly authorized Git operation.

**If any condition fails, E1 stops.**

**Gate E3 must use the exact SHA captured by E1** (`RESOLVED_BATCH_9D_E_ROLLOUT_HEAD`) — not `BATCH_9D_D_CODE_COMMIT` alone, which does not contain this plan. Before push, E3 verifies:

- local `HEAD` **still equals** the E1-captured SHA;
- **no new commit** exists;
- **no tracked worktree change** exists;
- `BATCH_9D_D_CODE_COMMIT` remains its ancestor;
- intervening commits remain **documentation-only**.

E3 then pushes the verified current `main` HEAD.

**Vercel deployed SHA must equal `RESOLVED_BATCH_9D_E_ROLLOUT_HEAD`.** Do **not** compare the deployed SHA directly to `BATCH_9D_D_CODE_COMMIT`, because the rollout HEAD also contains the approved planning-documentation commit. E3 must **separately prove** that this deployed SHA:

- contains `BATCH_9D_D_CODE_COMMIT` as an ancestor;
- contains **no source change** after the accepted code commit;
- contains **only approved planning documentation** after it.

> The ahead-count is **not** fixed at 1. It is whatever the authorized planning commit produces (expected ≥ 2 after that commit). E1 verifies the **content** of the intervening commits, not a magic number.

---

## 0. Remediation Index

| Finding | Correction | Sections |
|---|---|---|
| **B9DE-PR-001** | E1 made strictly read-only; **no HTTP invocation of any Edge Function**; all negative runtime probes moved to E2 post-fix | §4.1, §9 |
| **B9DE-PR-002** | `daily-overdue` caller inventory in E1; E2 Branch A / Branch B no-break coordination; STOP path | §4.1.4, §4.2.3 |
| **B9DE-PR-003** | Migrations reframed as *expected candidate set*; E1 produces `PRODUCTION_MISSING_MIGRATION_MANIFEST`; per-file atomicity rule; no blind retry | §2.1, §4.1.3, §4.2.2 |
| **B9DE-PR-004** | Fingerprint Groups A/B/C; expected Migration 022 governance delta specified exactly; discount included in allocation equation | §6 |
| **B9DE-PR-005** | 022 reclassified forward-fix-only; false "additive therefore reversible" claims removed; `daily-overdue` containment rule | §10 |
| **B9DE-PR-006** | All 16 functions mandatory; Option B given a closure path; E4 given two executable branches. *(Historical: the Rev 2 wording "manual sync available and verified" was superseded by B9DE-FPR-003 — see §4.4 Option B1/B2.)* | §2.4, §7, §4.4 |
| **B9DE-PR-007** | Material Medium findings block at every gate | §11.0, §10.5 |
| **B9DE-PR-008** | E1 identity-readiness section; imports smoke row added | §4.1.5, §9 Row F |
| **B9DE-PR-009** | Four required frontend env vars; two demo vars reclassified unused | §2.13, §8.2 |
| **B9DE-PR-010** | Vercel auto-deploy reclassified evidence-derived, E1-confirmed | §2.13, §3.1, §4.1.6 |

### Rev 3 — final consistency remediation

| Finding | Correction | Sections |
|---|---|---|
| **B9DE-FPR-001** | `BATCH_9D_D_CODE_COMMIT` separated from `BATCH_9D_E_ROLLOUT_HEAD`; E1 ancestry verification; E3 pushes and Vercel verifies the rollout HEAD; no future SHA hardcoded | **§0.1**, §3.3, §4.1, §4.3, §5.3, §5.16, §8.5, §10.5, §11.2, §12 |

### Rev 3.1 — commit-identity self-reference correction

| Finding | Correction | Sections |
|---|---|---|
| **Git self-reference defect** | The rollout HEAD is a **symbolic** identity resolved at E1 runtime via `git rev-parse HEAD` and captured in E1 **execution evidence**, never written back into the commit it identifies. All "record the SHA in both plans before E1" and "E1 must not run while it is a placeholder" instructions removed; no second identity-recording commit is required. | **§0.1**, §3.3, §4.1, §4.3, §5.3, §5.16, §8.5, §10.5, §11.2, §12, §13 |
| **B9DE-FPR-002** | Server-secret state `ABSENT`/`PRESENT`/`UNKNOWN`; branch matrix A / B1 / B2 / B3 / C; single canonical `daily-overdue` deployment position | §4.1.4, **§4.2.3**, §4.2.3.1 |
| **B9DE-FPR-003** | Option B split into executable B1 (no production mutation) and B2 (separately authorized sync); FX-scheduler absence distinguished from the approved `daily-overdue` caller baseline | **§4.4 Option B**, §7.3 |
| **B9DE-FPR-004** | "Booking-rate rows unchanged" replaced with precise pre-existing-value wording; expected 022 bootstrap rows explicitly accepted | **§6.6**, §9 Row E/G, §11.3 |
| **B9DE-FPR-005** | Migration-time DML distinguished from stored-function-body DML; `022` identified as the sole migration-time backfill; forward-fix reasons restated accurately | **§2.1**, §10.2 |
| **B9DE-FPR-006** | Master-plan current-state distinguishes pre-planning baseline from the current planning worktree | master plan §0.0 |

---

## 1. Executive Scope

### 1.1 What Batch 9D-E owns

| # | Owned deliverable |
|---|---|
| 1 | Production rollout of the accepted Batch 9D-A → 9D-D backend delta |
| 2 | Production database migration delta — **as observed by E1**, not as assumed here |
| 3 | Production Edge Function deployment — **all 16 functions, mandatory** |
| 4 | Production modern API-key and Edge-secret provisioning (names only) |
| 5 | FX provider configuration for production (Frankfurter/MAS) |
| 6 | Production scheduler **decision** (Option A or B) and, only under Option A, activation |
| 7 | Frontend production deployment |
| 8 | Production smoke verification (read-only by default) |
| 9 | Rollback / containment plan and stop conditions |
| 10 | Production evidence consolidation |
| 11 | Final Batch 9D closure |

### 1.2 What Batch 9D-E does NOT own

- New features, schema design, business rules, or UX changes.
- Reopening accepted Batch 9D-A → 9D-D findings.
- `social-media/` (unrelated; never staged, edited, moved, deleted, or committed).
- Production disablement of legacy API keys (§2.9 — deliberately not replicated from staging).
- Browser migration from the legacy anon key to a publishable key (§13.3).
- `frontend/.env.local` hygiene — **explicitly separated from production rollout** (§8.1).
- The 9D-C `v_customer_credit_utilization` cross-currency limitation.
- `journal-entries` (exists in source, deployed to neither environment).

---

## 2. Expected Production Delta — Candidate Inventory (Pending E1 Observation)

> **B9DE-PR-003 / B9DE-PR-010.** Nothing in §2 is a verified production fact. Every row is a **candidate** derived from committed evidence. E1 replaces each with an observation. **E2 acts only on E1 output.**
>
> Evidence basis: `PRE_BATCH_CLEANUP_SYSTEM_BASELINE_AUDIT_EVIDENCE.md`, `SPRINT_BATCH_9B_PRODUCTION_BACKEND_ROLLOUT_EVIDENCE.md`, `SPRINT_BATCH_8D_PRODUCTION_ROLLOUT_EXECUTION_EVIDENCE.md`, `BATCH_9A_PRODUCTION_DEPLOYMENT_AND_SMOKE_EVIDENCE.md`, `SPRINT_BATCH_9C_PRODUCTION_*`.

### 2.1 Migrations — EXPECTED CANDIDATE MIGRATION SET, PENDING E1 OBSERVATION

Evidence suggests production's high-water mark is `016` (Batch 9B); Batch 9C recorded "no migration required". **This is a hypothesis, not a manifest.** The candidate set is `017`–`030` (14 files). **E1 must classify each one individually** (§4.1.3) and emit `PRODUCTION_MISSING_MIGRATION_MANIFEST`.

| Order | Migration | Batch | **Migration-time DML** (executes on apply) | DML only inside new function bodies (not executed on apply) | Self-wrapped `BEGIN`/`COMMIT`? | Rollback class (§10) |
|---:|---|---|---|---|---|---|
| 1 | `017_fx_reference_foundation.sql` | 9D-A | **None** | 2 | **Yes** | Definition-replacement — forward-fix |
| 2 | `018_fx_reference_concurrency_hardening.sql` | 9D-A | **None** | 9 | **Yes** | Definition-replacement — forward-fix |
| 3 | `019_fx_reference_transactional_fencing.sql` | 9D-A | **None** | 2 | **NO — wrapper required** | Definition-replacement — forward-fix |
| 4 | `020_fx_helper_rpc_privilege_hardening.sql` | 9D-A | **None** | 0 | **NO — wrapper required** | Privilege-only — reversible |
| 5 | `021_fx_real_provider_identifier_support.sql` | 9D-B | **None** | 0 | **NO — wrapper required** | Constraint-only — reversible |
| 6 | `022_fx_booking_rate_governance.sql` | 9D-C | **YES — 6 statements. The ONLY migration-time governance backfill in the set.** | 0 | **Yes** | **FORWARD-FIX ONLY — NOT REVERSIBLE** |
| 7 | `023_fx_booking_rate_rpcs_and_immutability.sql` | 9D-C | **None** | 42 | **Yes** | Definition-replacement — forward-fix |
| 8 | `024_fx_booking_decision_runtime_fix.sql` | 9D-C | **None** | 11 | **Yes** | Definition-replacement — forward-fix |
| 9 | `025_fx_booking_decision_supersession_validation_fix.sql` | 9D-C | **None** | 0 | **Yes** | Definition-replacement — forward-fix |
| 10 | `026_fx_booking_decision_import_origin_provenance_fix.sql` | 9D-C | **None** | 3 | **Yes** | Definition-replacement — forward-fix |
| 11 | `027_batch_9d_d_authoritative_monetary_aggregation.sql` | 9D-D | **None** | 0 | **Yes** | Definition-replacement — forward-fix |
| 12 | `028_linked_credit_note_reference_integrity.sql` | 9D-D | **None** | 22 | **Yes** | Definition-replacement — forward-fix |
| 13 | `029_batch_9d_d_staging_runtime_defect_remediation.sql` | 9D-D | **None** | 4 | **Yes** | Definition-replacement — forward-fix |
| 14 | `030_batch_9d_d_allocation_candidate_snapshot.sql` | 9D-D | **None** | 0 | **Yes** | Additive + privilege — reversible |

**Ordering is mandatory.** `023`–`026` sequentially correct `022`; `029` corrects `027`/`028`.

**DML classification methodology (B9DE-FPR-005).** The two DML columns above are **not** raw textual counts. They distinguish:

1. **Migration-time DML** — `INSERT`/`UPDATE`/`DELETE` at statement top level, or inside a `DO $$ … $$` block, which **executes while the migration is applied** and therefore mutates production data.
2. **Function-body DML** — `INSERT`/`UPDATE`/`DELETE` appearing only inside the body of a newly defined or replaced stored function/trigger. This is **stored, not executed**, during migration application; it runs later only when the application calls that function.

Derived by parsing dollar-quoted regions, and separately confirming that the `DO $$` blocks present in `022`, `028`, `029` and `030` contain **no** DML (they are guard/validation blocks).

> **Result: `022` is the ONLY migration in the candidate set that mutates data at apply time.** Rev 2 used raw textual counts and wrongly attributed migration-time DML to `017`, `018`, `019`, `023`, `024`, `026`, `028` and `029`. Their DML is entirely inside function bodies.
>
> **This does not relax their handling.** They remain forward-fix, but for the *accurate* reason: they **replace prior function/RPC definitions irrecoverably** — the previous definition cannot be reconstructed from the new file — not because they backfill data. Atomicity requirements are likewise unchanged: `019`, `020`, `021` still require an explicit transaction wrapper, and no single-shot migration may be blindly retried.

**Atomicity rule (B9DE-PR-003).** Migrations `019`, `020`, `021` carry **no** `BEGIN`/`COMMIT` of their own. E2 must wrap each in an explicit transaction. Any statement that cannot run inside a transaction (e.g. `CREATE INDEX CONCURRENTLY`, certain `ALTER TYPE` forms) must be identified by E1 and documented; **if atomicity cannot be assured for a file, stop before executing it.**

**No blind retry.** If a migration fails with an uncertain outcome, **do not re-run it.** Determine the applied state by read-only inspection first. `019`, `020`, `024`, `025`, `029` are thin and largely non-idempotent; a blind second run can corrupt state.

### 2.2 Migrations — MUST NOT be applied to production

| File | Reason |
|---|---|
| `007c_api_staging_fixtures.sql` | Header: *"Staging only. Do not run on production."* Creates persistent synthetic data and COMMITs. |
| `006b`, `007b`, `008b`, `015b` `*_tests.sql` | Test harnesses, not migrations. |

### 2.3 Migrations — HISTORICAL (expected already in production)

`001`–`016`, incl. `007d_production_smoke_fixture.sql` where previously approved. `011a` is a preflight artifact. **E1 confirms; none is reapplied.**

### 2.4 Edge Functions — ALL 16 MANDATORY (B9DE-PR-006)

**Controlling fact (repository-proven):** `_shared/db.ts` now resolves `SUPABASE_SECRET_KEYS[batch_9d_d_edge_admin_20260718]` and `SUPABASE_PUBLISHABLE_KEYS[default]`, both fail-closed; the legacy `SUPABASE_SERVICE_ROLE_KEY` path no longer exists in source. Every function importing it must be redeployed, and **none may deploy before the named production secret key exists**.

**Locked production Edge deployment manifest — all 16 are mandatory for Batch 9D-E backend closure:**

| # | Function | Expected current production state (E1) | Action |
|---:|---|---|---|
| 1 | `allocations` | ACTIVE v13 | Redeploy — adds `GET /allocations/candidates` |
| 2 | `auth` | ACTIVE v1 | Redeploy |
| 3 | `bank-accounts` | ACTIVE v2 | Redeploy |
| 4 | `credit-notes` | ACTIVE v8 | Redeploy |
| 5 | `customers` | ACTIVE v14 | Redeploy |
| 6 | `daily-overdue` | ACTIVE **v6 (pre-fix)** | Redeploy — **security fix**, see §2.5 |
| 7 | `debit-notes` | ACTIVE v8 | Redeploy |
| 8 | `fx-rates` | **NOT PRESENT** | **New deploy** — authenticated reference-rate read API |
| 9 | `fx-rate-sync` | **NOT PRESENT** | **New deploy** — mandatory under Option B; prerequisite for any separately authorized Option B2 manual sync |
| 10 | `imports` | ACTIVE v22 | Redeploy |
| 11 | `invoices` | ACTIVE v19/v20 | Redeploy |
| 12 | `lookups` | ACTIVE v1 | Redeploy |
| 13 | `notifications` | ACTIVE v1 | Redeploy |
| 14 | `receipts` | ACTIVE v13 | Redeploy |
| 15 | `reports` | ACTIVE v12 | Redeploy |
| 16 | `search` | ACTIVE v1 | Redeploy |

**Explicit clarification (resolves the Rev 1 contradiction):**
- All 16 function deployments are **mandatory**.
- Production FX **scheduler activation** is **optional** and separate.
- `fx-rate-sync` **is deployed under Option B** — the deployment itself is mandatory and is **not** conditional on any sync being invoked.
- **Under Option B1, `fx-rate-sync` is deployed and validated through deployed-bundle inspection, authentication and authorization checks, provider-configuration metadata, structural reference-layer verification, and read-only `fx-rates` checks — without invoking a production sync.**
- **A production manual sync is executed only under separately authorized Option B2.** Option B1 may close **without** a production manual sync, and must record: *"Production manual sync was not executed because no production mutation authorization was granted."*
- `fx-rates` is deployed and validated **read-only** as the authenticated reference-rate read API.
- **Option B means: all 16 functions deployed (including `fx-rate-sync` and `fx-rates`), the recurring production FX scheduler DISABLED, and no production mutation under B1.** Gate E4 does **not** silently gain mutation authority; an approved pre-existing `daily-overdue` caller may remain, and **Batch 9D-E creates no new `daily-overdue` schedule**.

`journal-entries` is deployed to neither environment — out of scope.

### 2.5 ⚠ `daily-overdue` version-number collision — CRITICAL

Production `daily-overdue` is recorded ACTIVE **v6**; staging's *fixed* build is **also v6**. **These are different code.**

- **Never** infer from matching version numbers that production has the fix.
- Production v6 predates remediation and carries the fail-open predicate `if (expectedSecret && suppliedSecret !== expectedSecret)`. If production `CRON_SECRET` is unset, the route is reachable unauthenticated and performs **privileged writes**.
- **Therefore the production `daily-overdue` deployment is treated as a suspected fail-open, mutation-capable route.** E1 **must not invoke it over HTTP** (§4.1.1). Its state is determined by bundle inspection and metadata only.
- Post-deployment verification is by **bundle content** — `SCHEDULED_AUTH_NOT_CONFIGURED` present, `"Invalid cron secret"` absent — never by version number.

### 2.6 Shared-helper changes

| File | Change | Blast radius |
|---|---|---|
| `_shared/db.ts` | Named modern-key dictionaries; legacy service-role path removed | **All 16** |
| `daily-overdue/auth.ts` | New fail-closed validator | `daily-overdue` |
| `fx-rate-sync/scheduler_auth.ts` | `constantTimeEqual` exported/reused | `fx-rate-sync`, `daily-overdue` |
| `_shared/cors.ts`, `_shared/errors.ts` | Response/error envelope | All 16 |

### 2.7 `verify_jwt` expectations

`backend/supabase/config.toml` pins only:

```toml
[functions.fx-rate-sync]  verify_jwt = false
[functions.fx-rates]      verify_jwt = false
[functions.daily-overdue] verify_jwt = false
```

The other 13 must remain `verify_jwt = true`. **(E1) confirm no production drift.**

### 2.8 Production secrets and environment variables (names only — never values, in Git, SQL, logs, or evidence)

| Name | Required for | Provisioning | Status |
|---|---|---|---|
| `SUPABASE_URL` | all | Platform auto-injected | Existing |
| `SUPABASE_SECRET_KEYS` | all (`getAdminClient`) | Platform dictionary | **Must contain `batch_9d_d_edge_admin_20260718`** |
| `SUPABASE_PUBLISHABLE_KEYS` | all (`getUserClient`) | Platform dictionary | **Must contain `default`** |
| `BUSINESS_TIME_ZONE` | reports/aging | Edge secret | (E1) confirm |
| `CRON_SECRET` | `daily-overdue` | Edge secret | **(E1) confirm; §4.2.3 branch logic governs when it is set** |
| `FX_SCHEDULER_SECRET` | `fx-rate-sync` scheduled route | Edge secret | Required (function deployed under both options) |
| `FX_SCHEDULER_COMPANY_ID` | `fx-rate-sync` scope | Edge secret (UUID) | Required |
| `OCR_PROVIDER`, `OCR_PROVIDER_ENABLED` | `imports` | Edge secret | Existing; must remain disabled |

**Hard prerequisite:** a **secret**-type production API key named exactly `batch_9d_d_edge_admin_20260718` (the name is compiled into `ADMIN_API_KEY_NAME`). A differently-named key will not resolve.

### 2.9 Legacy API keys — STAGING-ONLY, MUST NOT be copied to production

The staging incident involved a **staging** service-role key. Production was never implicated.

- The production frontend authenticates with `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legacy anon — public by design).
- **Disabling legacy keys in production would immediately break the live frontend** and every not-yet-redeployed function.
- **Decision: production legacy API-key mode remains ENABLED throughout Batch 9D-E.** Deliberate; recorded in §13.3.

Useful safety property: during rollout, not-yet-redeployed functions keep working on the legacy path while redeployed ones use the modern named key — **the rollout is incrementally safe, not all-or-nothing.**

### 2.10 Scheduler jobs

| Environment | Job | Schedule | 9D-E action |
|---|---|---|---|
| Staging | `batch_9d_b_fx_scheduler_staging` | `30 7 * * *`, active | **No change. Must not be touched.** |
| Production | (E1) FX job — expected none | — | §7: default **do not create** |
| Production | **(E1) any `daily-overdue` caller** | — | **§4.1.4 inventory; §4.2.3 branch logic** |

### 2.11 Provider settings

- Provider `MAS` via Frankfurter v2; host pinned `https://api.frankfurter.dev/v2`; source host `api.frankfurter.dev`.
- Every request carries `providers=MAS` and `expand=providers`; missing/mismatched attribution fails closed with `FX_PROVIDER_MISMATCH`.
- **No provider API key exists or is required.**
- Rate type classified `frankfurter-rebased-mas-reference`.
- Approved pairs: `SGD→MYR`, `USD→MYR`, `EUR→MYR`. **Preflight: if the production company base currency is not `MYR`, stop and amend the plan.**

### 2.12 Frontend delta

Frontend backend dependencies (scanned from `frontend/src`): `auth`, `allocations`, `bank-accounts`, `customers`, `imports`, `invoices`, `lookups`, `notifications`, `receipts`, `reports`, `search`.

- The frontend **does not call** `fx-rates` or `fx-rate-sync`. Those are backend/operator surfaces. (They are still deployed — §2.4.)
- The frontend **does call** `GET /allocations/candidates` (`use-allocations.ts`, `allocations/page.tsx`), requiring **Migration 030 + `allocations` redeploy** before the frontend goes live. This is the binding push-ordering constraint (§3.1).

### 2.13 Vercel environment and deployment behavior (B9DE-PR-009, B9DE-PR-010)

**Required production runtime variables — exactly four (consumed by source):**

| Name | Consumed at |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `frontend/src/lib/supabase.ts` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `frontend/src/lib/supabase.ts` |
| `NEXT_PUBLIC_API_BASE_URL` | `frontend/src/lib/supabase.ts` |
| `NEXT_PUBLIC_DEFAULT_COMPANY_ID` | `frontend/src/stores/company-store.ts` |

**Not required — reclassified:**

| Name | Classification |
|---|---|
| `NEXT_PUBLIC_DEMO_USER_ROLE` | **Comment-only / behaviorally unused.** `use-user-role.ts` derives role and capabilities from `GET /auth/me` and defaults to read-only; the variable name survives only in a comment stating it is no longer read. |
| `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID` | **Currently unused by source.** No runtime read exists. |

**No fixture validation is required for either unused variable.** They may remain set or be removed; neither affects production behavior.

**Vercel deployment behavior — EVIDENCE-DERIVED, HIGH-RISK, UNCONFIRMED (B9DE-PR-010).** The repository contains no `vercel.json` and no `.github/workflows`. The *absence* of CI config is **not proof** that pushing `main` auto-deploys production; it only means the repository does not itself configure deployment. Prior evidence records a Vercel-served production site. **Treat "push to `main` triggers a production deployment" as a high-risk hypothesis until E1 confirms it** (§4.1.6). **Backend-before-push ordering is retained regardless**, because it is the safest compatible sequence under either answer.

### 2.14 Optional for an FYP deployment

- Production FX **scheduler activation** (§7 — recommended against).
- Browser migration to a publishable key.
- Row G controlled-mutation smoke (§9).

---

## 3. Compatibility and Deployment Order

### 3.1 The binding constraint

The committed frontend calls `GET /allocations/candidates`, absent from production until Migration 030 is applied **and** `allocations` redeployed. If pushing `main` auto-deploys production (§2.13, E1-confirmed), pushing first would ship a frontend whose allocation workbench fails.

> ### **The production backend rollout MUST complete and pass its go/no-go checks BEFORE the Batch 9D-D commit is pushed.**
>
> This holds **whether or not** E1 confirms auto-deploy. If auto-deploy is off, the ordering costs nothing; if it is on, the ordering prevents a broken production frontend.

### 3.2 Ordering constraints inside the backend gate

1. **Named production secret key `batch_9d_d_edge_admin_20260718` must exist and both dictionaries must resolve BEFORE any function deploy** — otherwise every redeployed function hard-500s.
2. **Migrations before functions** — Migration 030 must precede the `allocations` redeploy.
3. **`daily-overdue` secret/caller coordination (§4.2.3) must complete BEFORE its redeploy** — the fixed bundle fails closed.

### 3.3 Approved sequence

| # | Step | Gate | Reversible? |
|---:|---|---|---|
| 1 | Read-only production inventory: migration manifest, function versions, key/secret metadata, scheduler + **caller** inventory, schema/RPC state, fingerprints, **identities**, Vercel metadata | **9D-E1** | N/A (read-only) |
| 2 | Read-only data-compatibility preflight: backfill population for `022`; constraint validation for `021`, `027`, `028` and any E1-discovered equivalent | **9D-E1** | N/A |
| 3 | Recovery-point confirmation | 9D-E2 entry | N/A |
| 4 | Create production secret key; confirm dictionaries; set FX secrets | **9D-E2** | Reversible |
| 5 | `daily-overdue` caller/secret coordination — Branch A or B (§4.2.3) | **9D-E2** | Reversible |
| 6 | Apply **only** `PRODUCTION_MISSING_MIGRATION_MANIFEST`, in order, atomically, one at a time | **9D-E2** | Mixed (§10) |
| 7 | Deploy all 16 functions, cheapest-failure-first | **9D-E2** | Mixed (§10.3 excludes `daily-overdue`) |
| 8 | Backend runtime verification, incl. post-fix negative auth probes | **9D-E2** | N/A |
| 9 | **Backend GO/NO-GO** | 9D-E2 exit | — |
| 10 | Push `RESOLVED_BATCH_9D_E_ROLLOUT_HEAD` (E1-captured); frontend production deployment | **9D-E3** | Push not revertible; deploy rollback via Vercel |
| 11 | Frontend + end-to-end read-only smoke | **9D-E3** | N/A |
| 12 | Scheduler decision — Option A activate, or Option B record-disabled | **9D-E4** | Reversible |
| 13 | Evidence and final Batch 9D closure | **9D-E4** | N/A |

### 3.4 Function deployment order within step 7

1. `lookups`, `search`, `notifications`, `auth` — lowest financial risk.
2. **Checkpoint:** `GET /auth/me` → 200 proves modern-key resolution. If it 500s, **stop and roll back before touching any financial function.**
3. `bank-accounts`, `customers`, `credit-notes`, `debit-notes`.
4. `invoices`, `receipts`, `reports`, `imports`.
5. `allocations` (Migration 030 present).
6. `fx-rates`, then `fx-rate-sync`.
7. `daily-overdue` **last** (caller/secret coordination complete).

Deliberately ordered so the **cheapest possible failure** exposes a misconfigured key before anything financial or security-sensitive is touched.

---

## 4. Future Authorization Gates

## 4.1 Gate 9D-E1 — Production Read-Only Preflight

> ### **E1 is read-only and invokes no mutation-capable custom-auth route.**

**Purpose:** replace every `(E1)` hypothesis with an observation, and emit the manifests E2 consumes.

**Prerequisites:** user approval naming Gate 9D-E1; Supabase Management access to `kusseuycqgdilychphpq`; Vercel read access.

**Entry criteria:** the authorized Batch 9D-E planning commit exists; branch is `main`; clean tracked tree (0 staged, 0 unstaged tracked; only untracked `social-media/` remains); this plan independently reviewed. E1 **resolves** `RESOLVED_BATCH_9D_E_ROLLOUT_HEAD` from `git rev-parse HEAD` (§0.1) and verifies ancestry and documentation-only intervening commits. **A symbolic `BATCH_9D_E_ROLLOUT_HEAD` in this document is the expected committed state and is not a blocker; no prior SHA-recording commit or plan edit is required.**

### 4.1.1 E1 HTTP invocation boundary (B9DE-PR-001)

**E1 issues NO HTTP request to ANY production Edge Function** — not even an unauthenticated negative probe.

**Explicitly prohibited in E1:**
- `daily-overdue` — any method, any headers, including missing/blank/invalid `X-Cron-Secret`.
- `fx-rate-sync` `scheduled-sync`, `sync`, `mock-sync`.
- Any cron or custom-scheduler route.
- Any import, allocation, posting, or financial mutation route.
- **Any endpoint whose deployed bundle is suspected fail-open** — which, per §2.5, includes production `daily-overdue`.

**Rationale:** an unauthenticated probe against a *suspected fail-open* deployment is not a safe negative test — if the fail-open predicate is live, the probe **executes the privileged task and mutates production**. Rev 1's "safe negative probes in E1" was exactly this defect.

**All missing/invalid-header runtime probes move to Gate 9D-E2**, executed only **after** the fixed fail-closed bundle is deployed (§9 Row A, E2-phase).

**Permitted E1 HTTP:** unauthenticated `GET` of production **frontend** pages (static Vercel content, no backend mutation), for availability and deployed-asset inspection only.

### 4.1.2 Permitted E1 inspection (all read-only)

- Supabase Management API `GET`: function list (slug, status, version, `verify_jwt`), API-key metadata (`reveal=false`), Edge secret **names**, project metadata.
- Read-only SQL (`SELECT` only): migration history, catalog state, ACLs, `has_function_privilege`, `cron.job`, fingerprints, identity metadata.
- **Download deployed function bundles** for content/hash inspection — a Management read, not a function invocation.
- Logs and durable state **already produced before E1**.
- Vercel read-only metadata (§4.1.6).

### 4.1.3 Migration manifest derivation (B9DE-PR-003)

E1 derives an exact, immutable manifest by inspecting:
- the migration history table;
- installed functions, tables, constraints, indexes, triggers, and comments;
- known migration names/versions;
- the evidence-derived high-water mark;
- partially or manually applied definitions;
- schema drift.

**Classify every candidate `017`–`030` as exactly one of:**

| Class | Meaning | E2 action |
|---|---|---|
| `INSTALLED_COMPATIBLE` | Present and definition-compatible | Skip |
| `MISSING` | Absent | Apply |
| `PARTIAL_OR_DIVERGENT` | Partially/differently installed | **STOP** |
| `UNKNOWN` | Cannot be determined | **STOP** |

**E1 stops on any partial, divergent, duplicated, or ambiguous state.**

**Output artifact:** `PRODUCTION_MISSING_MIGRATION_MANIFEST` — an ordered list of `MISSING` files only, each annotated with: self-wrapped transaction (yes/no), required explicit wrapper (yes/no), any non-transactional statement, and top-level DML presence.

> **E2 may apply only this manifest. E2 contains NO hardcoded instruction to apply `017`–`030`.**

### 4.1.4 Data-compatibility and caller preflights

**Data compatibility (read-only, before E2 gains mutation authority).** Two distinct risks require preflighting, and E1 must cover both:

| Risk | Applies to | Preflight |
|---|---|---|
| **Migration-time backfill** touching existing rows | **`022` only** (§2.1 methodology) | Confirm the backfill selectors match the expected eligible row population; confirm no monetary field is in the write set; pre-compute the expected Group B counts |
| **Constraint / trigger validation against existing rows** | **`021`, `027`, `028`**, and any file E1 discovers to add or validate constraints, `NOT NULL`, foreign keys, or triggers over pre-existing data | Confirm every existing production row already satisfies the new constraint |

Run read-only preflights for all manifest entries in either category. **A constraint that would fail against legacy production data is a stop condition**, and so is a backfill population that does not match the expected eligible set.

> `027` and `028` contain **no migration-time DML** (§2.1), so they carry no backfill risk — but they remain in the preflight set because they introduce integrity/aggregation constraints evaluated against existing rows. The reason is stated accurately rather than by assuming they mutate data.

> ### Migration 027 and the F3 cohort — CORRECTED (Gate 9D-E1A, evidence §15.5)
>
> The earlier label **"Migration 027 compatibility FAIL"** is **superseded** and must not be used. The precise position is:
>
> - Migration 027 **does not validate** and does not depend on the settlement equation.
> - It **does not rewrite** the 128 historical `Paid` rows; it contains no migration-time update of invoices or settlement rows and does not recompute `Paid` invoices.
> - Its aging/dashboard paths select stored `outstanding` **only** for Open/Overdue/Partially Paid Invoice/Debit Note rows with **positive** outstanding (`database/027_batch_9d_d_authoritative_monetary_aggregation.sql:136-155`), so the zero-outstanding cohort never enters those totals. Its invoice-report aggregation separately reports stored current outstanding and stored document totals (same file, `495-544`).
> - Migration 028 adds lifecycle enforcement **prospectively** without rewriting historical status or financial data (`database/028_linked_credit_note_reference_integrity.sql:41-55`).
> - **Therefore the 128 rows do NOT technically block Migration 027 application**, and Migration 027 would install successfully assuming its ordinary schema prerequisites pass.
> - **The 128 rows nevertheless BLOCK overall Gate 9D-E1 financial certification** as **F3 — PRODUCTION DATA DEFECT** (finding `B9DE-E1-001`, High).
>
> **This correction authorizes nothing.** Applying Migration 027 remains unauthorized, and a wording-only preflight correction is **insufficient** under F3 — controlled data-resolution planning is required first. See `docs/plans/BATCH_9D_E1_F3_PRODUCTION_FINANCIAL_REMEDIATION_PLAN.md`.

**`daily-overdue` caller inventory (B9DE-PR-002).** E1 must determine whether **any** production caller currently invokes `daily-overdue`, checking: `pg_cron`, `pg_net`, Database Webhooks, external schedulers, Vercel cron, CI/automation, manual runbooks, and any other caller.

Record for each:

| Field | Values |
|---|---|
| Caller status | `EXISTS` / `DOES_NOT_EXIST` / `CANNOT_BE_CONFIRMED` |
| Caller type | pg_cron / pg_net / webhook / external / Vercel cron / CI / manual / other |
| Header capability | Can it send a custom `X-Cron-Secret` header? yes / no / unknown |
| Current schedule | cron expression or trigger description |
| Secret source | **by name only** |
| Authorization | Would modifying the caller need separate authorization? |

**Server secret state (B9DE-FPR-002).** E1 must independently classify production `CRON_SECRET` **metadata** as exactly one of:

| State | Meaning |
|---|---|
| `ABSENT` | No `CRON_SECRET` exists in the production Edge secret set |
| `PRESENT` | A `CRON_SECRET` exists (**name only — the value is never read, printed, logged, or compared in output**) |
| `UNKNOWN` | Presence cannot be determined |

**If `PRESENT`,** E1 must additionally determine — from caller **metadata/definition inspection** only — whether the existing caller is already configured to use the corresponding secret. Permitted signals: whether the caller definition sets an `X-Cron-Secret` header at all; whether it references a Vault entry or environment variable **by name**; and whether the caller's historical runs succeeded before E1. **Values are never printed and never compared in output.** If the match cannot be established from metadata alone, the state is `CALLER_MATCH_UNKNOWN`, which routes to Branch B3 or Branch C, never to the normal path.

**The caller record and the server-secret state *together* select the E2 branch (§4.2.3).** Neither alone is sufficient.

### 4.1.5 Production identity readiness and tenant assurance — **T1 (AMENDED, Gate 9D-E1A §15.6)**

> **Accepted model: T1 — STRUCTURAL PRODUCTION + STAGING RUNTIME PROOF.**
>
> **Production legitimately has one active company.** Creating a second production tenant solely for testing would add disproportionate production identity and financial-data risk for this project. **A second production company must NOT be created to satisfy this gate.** This supersedes the earlier "cross-tenant isolation pair" production requirement.

**T1 required E1 criteria — structural (production, read-only):**

| # | Criterion | Evidence |
|---|---|---|
| 1 | **Production RLS and ACL inspection** — RLS enabled on companies, customers, invoices, receipts, allocation details, CN allocations, journals, imports, roles, assignments | Catalog inspection |
| 2 | **Production company-scope predicates** — `rls_has_operational_read_access` checks authenticated active company membership | `database/015_financial_mutation_boundary_hardening.sql:25-90` |
| 3 | **Production AR Clerk assignment predicates** — `rls_can_access_customer` additionally checks company ownership, visible/non-deleted state, and AR Clerk assignment; read policies compose those helpers | `database/015_financial_mutation_boundary_hardening.sql:127-148` |
| 4 | **Service-only financial mutation boundaries** — direct authenticated `INSERT`/`UPDATE`/`DELETE` remains removed from protected financial tables | Catalog inspection |
| 5 | **Zero production ownership anomalies**, recorded **per relationship** — invoice/customer, receipt/customer, allocation receipt/invoice/customer, assignment/customer | Read-only counts |

**T1 required — runtime (substituted, not skipped):**

| # | Criterion | Source |
|---|---|---|
| 6 | **Accepted staging two-company runtime evidence** reused as the cross-tenant runtime proof (candidate/RPC tenant-negative matrix; assigned/unassigned Clerk rules) | `docs/evidence/SPRINT_BATCH_9D_D_MULTI_CURRENCY_UX_AND_MONETARY_AGGREGATION_EVIDENCE.md:1644-1648,1677-1685` |
| 7 | **Later approved production Finance Manager smoke** | Deferred to an authorized authenticated smoke |
| 8 | **Assigned and unassigned AR Clerk smoke within the existing company** | Deferred to the same authorized smoke |
| 9 | **Explicit account-owner and credential-custody approval before any login** | Recorded before the smoke |

**Authoritative production smoke identity set under T1 — exactly four, existing accounts only, all within the single production company:**

| # | Identity | Purpose |
|---|---|---|
| 1 | Authenticated general user | Row B smoke |
| 2 | Finance Manager | Row C smoke |
| 3 | AR Clerk **assigned** to a customer | Row D smoke |
| 4 | AR Clerk **unassigned** to that customer | Row D negative smoke |

> **No fifth "cross-tenant isolation pair" identity is required.** *(Superseded: the earlier production cross-tenant identity-pair row is removed as an active requirement.)* Cross-tenant assurance is supplied instead by production **structural** RLS/ACL/company-scope proof, **zero production ownership anomalies**, and the **accepted staging two-company runtime evidence** — which remains **staging runtime evidence and must never be described as production runtime evidence**.

For each, confirm: the account **already exists**; it is safe for smoke testing; expected company and role metadata; the token acquisition method; token lifetime.

**Constraints — unchanged and reinforced:**
- Credentials and tokens are **never** printed, logged, or stored in Git or evidence.
- **No production account is created under E1.**
- **No login, no password reset, no user creation, and no identity mutation** is authorized by this plan.
- **No real customer-facing user is used without approval.**

**T1 boundary.** T1 resolves the need for a second production tenant. It does **not** itself authorize authenticated smoke, and it does **not** establish custody of an existing account. **Missing account custody may remain a readiness blocker** (`B9DE-E1-002`, material Medium): if custody cannot be approved, E1 records the gap honestly rather than reducing coverage. **Tenant/role smoke coverage must not be silently reduced**, and structural proof must not be presented as runtime proof.

### 4.1.6 Vercel readiness (B9DE-PR-010)

E1 confirms read-only: Vercel project identity; connected Git repository; production branch; **automatic production deployment setting**; current deployed commit; production environment variable **names**; and — decisively — **whether pushing `main` will trigger a production deployment.**

#### 4.1.6.1 Vercel production environment-variable NAME-ONLY checkpoint (Gate 9D-E1A §15.7)

> **Connector limitation — not variable absence.** Gate 9D-E1A performed exactly one authorized read-only project-metadata retrieval against Vercel project `prj_w67qhKtacmd8QBLstmEhha5V2pcf`. Project identity was confirmed, but **the connected tool response does not expose environment-variable names**, and no Vercel CLI or local Vercel credential is available. **This is a connector-capability limitation. It is NOT evidence that any variable is absent, and must never be recorded as absence.** No repeated retrieval was attempted.

**Manual sanitized name-only procedure:**

1. Open the Vercel Dashboard and select team/project `account-receivable-module` / `prj_w67qhKtacmd8QBLstmEhha5V2pcf`.
2. Open **Settings → Environment Variables**.
3. Filter/inspect the **Production** target only.
4. Verify that each exact name exists and includes Production.
5. **Do not reveal, copy, expand, export, or return any value. Do not provide a screenshot containing a value.**
6. Return only the sanitized checklist below.

**Recorded fields — exactly these, and nothing more:** exact name; `PRESENT`/`ABSENT`; Production target `YES`/`NO`; verification time; sanitized reviewer identity/role.

> **Never** request or record: values, value prefixes or suffixes, screenshots containing values, hashes of values, exports, or any other value-bearing artifact.

**Result table — COMPLETED (sanitized manual verification):**

| # | Variable name | PRESENT / ABSENT | Production target YES / NO |
|---|---|---|---|
| 1 | `NEXT_PUBLIC_SUPABASE_URL` | **PRESENT** | **YES** |
| 2 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **PRESENT** | **YES** |
| 3 | `NEXT_PUBLIC_API_BASE_URL` | **PRESENT** | **YES** |
| 4 | `NEXT_PUBLIC_DEFAULT_COMPANY_ID` | **PRESENT** | **YES** |

| Attestation field | Value |
|---|---|
| Vercel project name | `account-receivable-module` |
| Target filter inspected | **Production** |
| Verification time | **2026-07-20 18:56 MYT** |
| Reviewer identity / role (sanitized) | **Project owner** |
| Value handling | **No value was opened, copied, expanded, exported or recorded.** |

The Vercel UI displayed the required variables with **Production** included in their target configuration.

> **Scope note.** `NEXT_PUBLIC_DEMO_USER_ROLE` and `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID` are **outside** this four-variable required-runtime checkpoint (§2.13). They are neither verified nor changed here, and **must not be modified or removed**.

**Closure rule — SATISFIED.** All four names are recorded `PRESENT` with Production target `YES`. **`B9DE-E1-003` is CLOSED by sanitized manual name-only verification.** *(Had any been `ABSENT` or `NO`, it would have been a stop condition requiring provisioning under separate authorization before Gate 9D-E3.)*

> **This closure does NOT change the overall Gate 9D-E1 decision.** `B9DE-E1-001` (F3) remains **OPEN** and Gate 9D-E1 remains **`NO-GO`**. Sanitized evidence: `docs/evidence/SPRINT_BATCH_9D_E1_PRODUCTION_READ_ONLY_PREFLIGHT_EVIDENCE.md` § *Batch 9D-E1 Manual Vercel Name-Only Verification*.

### 4.1.7 E1 governance

**Prohibited:** any `INSERT`/`UPDATE`/`DELETE`/DDL; migration application; function deployment; secret set/unset; key creation/rotation/deletion; scheduler or caller change; user creation or mutation; Git push; Vercel deployment; any staging mutation; **any Edge Function HTTP invocation**; printing any credential value.

**Validations:** every `(E1)` marker resolved; `PRODUCTION_MISSING_MIGRATION_MANIFEST` emitted; caller record complete; identity record complete; Vercel behavior confirmed; `CRON_SECRET` presence known **by name only**.

**Rollback:** none required (no mutation).

**Stop conditions:** wrong project ref; `PARTIAL_OR_DIVERGENT` or `UNKNOWN` migration state; data-compatibility preflight failure; active credential exposure; missing required identities; **any Critical, High, or material Medium finding (§11.0)**.

**Verdict:** `PASS — BATCH 9D-E1 PRODUCTION READ-ONLY PREFLIGHT COMPLETE` / `NO-GO — …` / `BLOCKED — …`.

**Exact next gate:** "Batch 9D-E2 production backend rollout authorization. Push and frontend deployment remain unauthorized."

---

## 4.2 Gate 9D-E2 — Production Backend Rollout

**Prerequisites:** E1 PASS with all artifacts; §11.1 GO criteria; explicit user approval enumerating which of {key creation, secrets, caller-header configuration, migrations, function deployments} are authorized.

**Entry criteria:** recovery point confirmed; `PRODUCTION_MISSING_MIGRATION_MANIFEST` accepted; caller branch determined; identities confirmed; **no unresolved Critical, High, or material Medium finding**.

### 4.2.1 Permitted actions (only if explicitly named in the approval)

- Create production secret API key `batch_9d_d_edge_admin_20260718`.
- Set Edge secrets by name: `FX_SCHEDULER_SECRET`, `FX_SCHEDULER_COMPANY_ID`, and `CRON_SECRET` **subject to §4.2.3**.
- **Branch B only:** narrowly scoped configuration of the existing `daily-overdue` caller to send the `X-Cron-Secret` header — permitted **only** when Branch B was confirmed in E1 **and** this action is explicitly authorized.
- Apply **only** the E1 manifest, in order, one file at a time, atomically.
- Deploy all 16 functions in the §3.4 order.
- Backend runtime verification, including post-fix negative auth probes.
- Roll back / contain on confirmed failure (§10).

**Prohibited:** Git push, merge, pull, rebase, reset, checkout, stash, clean; any Vercel action; scheduler creation/activation; **disabling production legacy API keys**; any staging action; creating production financial records; applying any migration not in the manifest; redeploying the **vulnerable pre-fix `daily-overdue` source** (§10.3); printing credential values.

### 4.2.2 Migration execution rules

- Apply **only** manifest entries, in ascending order, **one at a time**, verifying after each.
- Each file executes **atomically**: self-wrapped files rely on their own `BEGIN`/`COMMIT`; `019`, `020`, `021` (and any other E1-flagged file) receive an **explicit transaction wrapper**.
- Any statement that cannot run transactionally is documented by E1; **if atomicity cannot be assured, stop before executing that file.**
- **Never blindly retry a failed single-shot migration.** Determine applied state by read-only inspection first.
- After each migration: verify expected objects; for `030` verify `get_allocation_candidates` is STABLE + SECURITY DEFINER + `search_path=""`, EXECUTE granted to `service_role`/`postgres` only, and `anon`/`authenticated` = false.
- After `022`: verify the **Group B expected governance delta** (§6.3) exactly, and **Group A immutable monetary fields unchanged** (§6.2).

### 4.2.3 `daily-overdue` caller/secret coordination (B9DE-PR-002, B9DE-FPR-002)

> **Governing requirement: there must be NO period in which an existing legitimate caller is unexpectedly broken by server-secret activation, NO period in which an unauthenticated request can execute the privileged task, and NO accidental replacement of an already-working production secret.**

**Branch selection matrix.** The branch is a function of **both** E1-recorded states:

| Caller status | Server `CRON_SECRET` | Branch |
|---|---|---|
| `DOES_NOT_EXIST` | `ABSENT` | **A** |
| `DOES_NOT_EXIST` | `PRESENT` | **A** (preserve the existing secret — do **not** rotate; skip provisioning) |
| `EXISTS` | `ABSENT` | **B1** |
| `EXISTS` | `PRESENT` **and** caller confirmed matching | **B2** |
| `EXISTS` | `PRESENT` but caller not matching, `CALLER_MATCH_UNKNOWN`, or rotation required | **B3** (separately authorized) |
| `CANNOT_BE_CONFIRMED` | any | **C — STOP** |
| any | `UNKNOWN` | **C — STOP** |

#### Branch A — no caller

1. Confirm no caller exists.
2. Provision `CRON_SECRET` **only if `ABSENT`**; if `PRESENT`, **preserve it and do not rotate**.
3. Deploy the fixed fail-closed `daily-overdue` bundle **at the single canonical deployment step (§4.2.3.1)**.
4. Run post-fix negative probes (missing / blank / invalid header → 401 ×3).
5. **No `daily-overdue` cron is created.**

#### Branch B1 — caller exists, server secret `ABSENT`

1. Select one new secret securely (never printed, logged, or committed).
2. Configure the caller to send `X-Cron-Secret` **while the old function still tolerates the extra header** — with no server secret set, the pre-fix predicate ignores it entirely, so this step is inert and safe.
3. Verify the caller definition **without invoking the old route**.
4. Set the same server-side `CRON_SECRET`.
5. Continue to the **single canonical deployment step (§4.2.3.1)**.
6. Deploy the fixed bundle.
7. Verify the caller succeeds and run the negative matrix.

#### Branch B2 — caller exists, server secret `PRESENT` and caller confirmed matching

1. **Preserve the existing server secret.**
2. **Do not rotate it.** No new secret is generated or set.
3. **Preserve the matching caller configuration** unchanged.
4. Deploy the fixed bundle **at the canonical deployment step (§4.2.3.1)**.
5. Verify the caller succeeds and run the negative matrix.

> Branch B2 is the lowest-risk branch: the fixed bundle enforces the *same* secret the caller already sends, so the deployment is behaviour-preserving for the legitimate caller and closes the fail-open hole for everyone else. **Rotation here would be gratuitous risk and is prohibited.**

#### Branch B3 — caller exists, secret `PRESENT` but caller not matching, or rotation required

**This must NOT use the normal branch.** It requires **separately authorized coordinated rotation**:

1. Pause the caller, or use an atomic overlap strategy where technically supported.
2. Update the caller configuration and the server secret **under one explicitly approved operation**.
3. Deploy the fixed, **known-secure** bundle **at the single canonical deployment step (§4.2.3.1)**.
4. Resume the caller and verify it succeeds.
5. Preserve containment throughout — at no point may an unauthenticated request reach a privileged write path.

**If safe coordination cannot be guaranteed: STOP. Do not rotate. Do not deploy `daily-overdue`. Return NO-GO.**

#### Branch C — caller or secret state `UNKNOWN` / `CANNOT_BE_CONFIRMED`

**STOP.**

- **Do not set or rotate any secret.**
- **Do not deploy `daily-overdue`.**
- Return a production **NO-GO** for the `daily-overdue` component and escalate for a separate decision.

The other 15 functions may still proceed if otherwise GO; `daily-overdue` is deferred with its pre-existing state left untouched.

#### 4.2.3.1 Single canonical deployment position (B9DE-FPR-002)

> **`daily-overdue` is deployed exactly once, as the FINAL function in the 16-function deployment sequence (§3.4 step 7). There is no earlier deployment of it.**

Rules:

- **All caller/secret preparation occurs before that step.**
- **No server-secret activation may occur early** where that would leave the old bundle active in an incompatible state. Concretely: in Branch B1, setting the server secret arms the pre-fix comparison, so steps 4 (set secret) and 6 (deploy fixed bundle) must be executed as **one adjacent controlled sub-step at the final `daily-overdue` position** — not separated by the other 15 deployments. Branch B1 step 2 (caller already sending the header) is what makes even that brief interval safe.
- In Branches A and B2 no new secret is armed, so no adjacency constraint applies beyond ordinary care.
- The word **"immediately"** in these branches means **"immediately adjacent within the final `daily-overdue` sub-step"**. It does **not** mean `daily-overdue` is deployed before the other 15 functions.


### 4.2.4 Deployment validations

- Each function ACTIVE, version incremented, `verify_jwt` matching §2.7.
- `auth` checkpoint (§3.4 step 2) before financial functions.
- `daily-overdue` **bundle content**: contains `SCHEDULED_AUTH_NOT_CONFIGURED`; does **not** contain `"Invalid cron secret"`.
- Negative auth matrix (§9 Row A) — **executed here, not in E1**.
- Group A / B / C fingerprints (§6) re-evaluated.

**Rollback / containment:** §10.

**Stop conditions:** §10.5 (stop-immediately list), plus the §4.2.3 STOP path for `daily-overdue`.

**Verdict:** `PASS — BATCH 9D-E2 PRODUCTION BACKEND ROLLOUT COMPLETE` / `ROLLED BACK — …` / `NO-GO — …` / `BLOCKED — …`.

**Exact next gate:** "Batch 9D-E3 Git push and frontend production deployment authorization."

---

## 4.3 Gate 9D-E3 — Git Push and Frontend Production Deployment

**Prerequisites:** E2 PASS; §11.2 GO criteria; explicit user approval to push; E1-confirmed Vercel behavior.

**Entry criteria:** production serving `GET /allocations/candidates`; local `HEAD` **still exactly the E1-captured `RESOLVED_BATCH_9D_E_ROLLOUT_HEAD`**; no new commit since E1; no tracked worktree change; `BATCH_9D_D_CODE_COMMIT` confirmed an ancestor; intervening commits documentation-only; behind 0; 0 staged, 0 unstaged tracked; clean except untracked `social-media/`.

**Permitted:** push the verified current `main` HEAD (`RESOLVED_BATCH_9D_E_ROLLOUT_HEAD`) to `origin/main`; allow or trigger the Vercel production deployment; verify the deployed commit SHA and its ancestry; frontend and end-to-end **read-only** smoke (§9 Rows A–F).

**Prohibited:** staging or including any `social-media/` path; amending, rebasing, or force-pushing; new commits; any backend deployment or migration; scheduler activation; Row G controlled mutation unless separately approved.

**Validations:** Vercel deployment SUCCESS; **deployed SHA `== RESOLVED_BATCH_9D_E_ROLLOUT_HEAD`** (the E1-captured value — **not** compared directly to `BATCH_9D_D_CODE_COMMIT`); deployed SHA **separately** proven to contain `BATCH_9D_D_CODE_COMMIT` as an ancestor, with no source change and only approved planning documentation after it; Rows A–F pass; browser console free of uncaught errors and of 4xx/5xx on core routes; Group A fingerprints unchanged.

**Rollback:** Vercel instant rollback to the previous production deployment. **A Git push is not revertible** — remediate at the deployment layer, optionally with a forward revert commit. **Never force-push `main`.**

**Stop conditions:** deployed commit mismatch; allocation workbench failing; any 5xx on a core route; tenant leakage; any Critical, High, or material Medium finding.

**Verdict:** `PASS — BATCH 9D-E3 FRONTEND PRODUCTION DEPLOYMENT COMPLETE` / `ROLLED BACK — …` / `NO-GO — …`.

**Exact next gate:** "Batch 9D-E4 scheduler decision and final Batch 9D closure."

---

## 4.4 Gate 9D-E4 — Scheduler Decision and Final Production Closure

**Why E4 is separate from E2:** it is the only step that could create **recurring autonomous production writes**; it is only meaningful after the frontend is live; and the recommended outcome is **not** to activate, so folding it into E2 would pre-authorize an action the plan advises against.

E4 has **two executable branches**. **Option B is the recommendation.**

### Option A — Production scheduler ACTIVATED

**Prerequisites:** E3 PASS; **§11.3 Option A GO criteria**; explicit approval of Option A **over** the recommended Option B.

**Entry criteria:** all Option B **B1** entry criteria, **plus** production company base currency confirmed `MYR`, provider attribution verified `MAS`, and a **separately authorized** production manual sync executed under Option B2. **This manual-sync requirement belongs to Option A (and to B2) alone — it is never a condition of Option B1 closure.**

**Permitted:** create **one** production cron job invoking `POST /fx-rate-sync/scheduled-sync`, with the scheduler secret sourced from Vault **by name**; verify exactly one scheduled run; verify §6 FX invariants; final smoke; evidence; closure.

**Prohibited:** touching the staging scheduler; any secret value in SQL, Git, logs, or evidence; service-role key or user JWT as scheduler credential.

**Validations:** exactly one production job created; approved cadence (`15:30 Asia/Singapore`); one successful run; reference-layer rows only; **zero** change to booked rates or Group A monetary fields.

**Rollback:** delete the cron job — fully reversible. Reference rows are additive reference data, not financial records.

**Stop conditions:** a scheduled run mutates any booked rate or any Group A monetary field; provider attribution is not exactly `MAS`; repeated 5xx from the scheduled route; more than one production job created; the staging job is altered; **any Critical, High, or material Medium finding (§11.0)**.

**Verdict:** `PASS — BATCH 9D-E4 OPTION A COMPLETE — PRODUCTION SCHEDULER ACTIVATED — BATCH 9D CLOSED`.

### Option B — Production scheduler REMAINS DISABLED (RECOMMENDED)

> **B9DE-FPR-003.** Rev 2 made Option B closure depend unconditionally on "one controlled manual FX sync path has been verified" — but a production manual sync is a **production mutation** requiring separate authorization that Option B does not grant. Option B was therefore not executable as written. Rev 3 splits it into two executable paths.

**Option B always means:** all 16 functions deployed; `fx-rates` read API verified; `fx-rate-sync` source, deployment, authentication and provider configuration verified; **recurring production FX scheduler not created**; and **production manual sync optional, requiring separate mutation authorization**.

**Prerequisites (both paths):** E3 PASS; explicit user decision to keep the production scheduler disabled.

**Entry criteria (self-contained — does NOT depend on Option A-only §11.3 criteria):**
- E3 PASS.
- All frontend/backend smoke checks (Rows A–F) pass.
- `fx-rates` and `fx-rate-sync` deployed and verified per §2.4.
- Financial and reference-rate invariants (§6) pass.
- Explicit user decision recorded: keep the production scheduler disabled.
- Path B1 or B2 selected (below).

#### Option B1 — no production manual sync authorized (DEFAULT)

Batch 9D closure is permitted on the following evidence, **without any production mutation**:

1. Staging scheduled-sync and manual-sync evidence, **already accepted** in Batch 9D-B.
2. Production deployed-bundle inspection for `fx-rate-sync` and `fx-rates` (content, not version number).
3. Production provider configuration **metadata** (host pinning, `providers=MAS`, `expand=providers`, no provider key required).
4. Production `fx-rates` **read-only** health/read checks where data exists (§9 Row E).
5. Authentication and authorization verification for both FX functions.
6. **Structural proof** that the sync path writes only reference-layer data — distinct tables and RPCs from the booking layer, verified from source and migration definitions.
7. **Group A** booked/financial values unchanged.
8. Production FX scheduler absent.

**Required record:**

> "Production manual sync not executed because no production mutation authorization was granted."

**This is acceptable under the proportionate FYP standard** (§13) and is the default path.

#### Option B2 — production manual sync separately authorized

The manual sync is a **mutation** and **must execute in Gate 9D-E2, or in a separately authorized sub-gate before E4** — **never silently inside Option B closure**.

Requirements:

- Explicit user authorization **naming one controlled manual FX sync**.
- MYR base-company precondition confirmed.
- Provider attribution exactly `MAS`.
- Approved pair list only (`SGD→MYR`, `USD→MYR`, `EUR→MYR`).
- **Reference-layer-only write** — verified, not assumed.
- **Group A** financial and booked-rate **zero unexpected delta**.
- Exact reference rows / sync-run evidence captured.
- **No scheduler creation.**

**E4 then consumes that result as evidence; E4 does not independently gain mutation authority under Option B.**

**Permitted actions (both paths):**
- Record scheduler state as **disabled / not created**.
- Perform final read-only verification.
- Create the final evidence file.
- Close Batch 9D.

**Prohibited:** any scheduler mutation; any production mutation not already authorized and executed under B2. **No scheduler mutation occurs under Option B.**

**Validations (B9DE-FPR-003 — FX scheduler absence is distinct from the `daily-overdue` caller baseline):**
- **Zero unauthorized production FX scheduler**; the production FX scheduler is **disabled / not created**.
- **`daily-overdue` caller state unchanged from the E1-approved baseline**, except for the explicitly authorized header/security coordination performed in §4.2.3. **An existing legitimate `daily-overdue` caller and its schedule MAY remain** where Branch B1/B2/B3 was approved.
- **No new `daily-overdue` schedule is created by Batch 9D-E.**
- Staging job unchanged at `30 7 * * *`.
- `fx-rate-sync` and `fx-rates` deployed and verified.
- Group A fingerprints unchanged.

**Rollback:** none required under B1 — no mutation performed. Under B2, the authorized sync wrote reference-layer rows only; these are additive reference data, not financial records.

**Stop conditions:**
- An **unauthorized production FX scheduler** exists.
- The staging job has been altered.
- Group A monetary fields changed since E3.
- The `daily-overdue` caller state differs from the E1-approved baseline beyond the authorized coordination, **or a new `daily-overdue` schedule was created**.
- Under B2 only: the authorized sync wrote outside the reference layer, or provider attribution was not `MAS`.
- **Any Critical, High, or material Medium finding (§11.0).**

> **Not a stop condition:** the mere existence of a legitimate, pre-existing, E1-baselined `daily-overdue` caller. Option B does **not** require zero `daily-overdue` caller universally.

**Verdict:** `PASS — BATCH 9D-E4 OPTION B COMPLETE — PRODUCTION SCHEDULER INTENTIONALLY DISABLED — BATCH 9D CLOSED`.


**Exact next gate (both branches):** "Batch 9D closed. No further gate."

---

## 5. Production Readiness Checklist

| # | Item | Check | Gate |
|---:|---|---|---|
| 5.1 | Recovery point | Backup/PITR window covers the rollout; timestamp recorded | E2 entry |
| 5.2 | Project ref | Every command's explicit ref is `kusseuycqgdilychphpq` | every |
| 5.3 | Commit identity | `RESOLVED_BATCH_9D_E_ROLLOUT_HEAD` resolved at E1 from `git rev-parse HEAD` and captured in E1 evidence (not in Git); `BATCH_9D_D_CODE_COMMIT` an ancestor; only planning docs after it; behind 0; deployed SHA compared to the E1-captured value after E3 (§0.1) | E1/E3 |
| 5.4 | Migration manifest | Only `PRODUCTION_MISSING_MIGRATION_MANIFEST` applied, in order, atomically, once | E1/E2 |
| 5.5 | Data compatibility | Read-only preflights pass: `022` backfill population; `021`/`027`/`028` constraint validation against existing rows. **Migration 027 is not blocked by the F3 cohort (§4.2.2)** | **E1** |
| 5.5a | **F3 financial defect** | The 128-row `Paid` cohort (raw delta 2,681,703.31) is **resolved truthfully** per the F3 plan. P1/P3 treatment requires the ordinary equation to reconcile; strict P2 treatment reports raw mismatch, externally explained state and unexplained state separately. In every branch, unexplained count/amount must be zero and no unsupported exclusion is allowed. **Currently FAILING** | **E1 (repeat)** |
| 5.6 | RPC ownership & grants | `get_allocation_candidates`: STABLE, SECURITY DEFINER, `search_path=""`, EXECUTE to `service_role`/`postgres` only | E2 |
| 5.7 | RLS & tenant isolation | RLS on 9D tables; `cust_select`/`inv_select` intact. **T1 (§4.1.5):** cross-tenant assurance = production structural proof + zero ownership anomalies + accepted **staging** two-company runtime evidence. **No production cross-company probe is required, because production has one legitimate company** | E2/E3 |
| 5.8 | Edge `verify_jwt` | Matches §2.7 exactly | E1/E2 |
| 5.9 | Modern key dictionaries | Both resolve; **legacy mode stays ENABLED** | E2 |
| 5.10 | Function secrets | FX secrets set; `CRON_SECRET` per §4.2.3 branch | E2 |
| 5.11 | Provider & host pinning | No provider key; host pinned; `providers=MAS` + `expand=providers` | E2/E4 |
| 5.12 | `daily-overdue` caller | Inventory complete; branch selected; no-break coordination executed | E1/E2 |
| 5.13 | Identities & tenant assurance | **T1 model (§4.1.5):** production structural RLS/ACL/predicate/boundary proof + zero ownership anomalies + accepted staging two-company runtime evidence; four existing single-company smoke identities safe; **no second production tenant created**; custody approved before any login | **E1** |
| 5.14 | Frontend API URL & key | `NEXT_PUBLIC_API_BASE_URL` → production functions host; anon key valid | E1/E3 |
| 5.15 | Vercel production env | The **four** required names present; auto-deploy behavior confirmed | **E1** |
| 5.16 | Production build | `tsc --noEmit`, ESLint, `next build`, full Vitest pass locally at `RESOLVED_BATCH_9D_E_ROLLOUT_HEAD` (source identical to `BATCH_9D_D_CODE_COMMIT`) | E3 entry |
| 5.17 | npm advisories | Reviewed; only accepted non-material advisories remain | E3 entry |
| 5.18 | No exposed credential | No credential value in repo, plan, evidence, logs, or output | every |
| 5.19 | Rollback capability | Class known per step (§10); Vercel previous deployment available | E2/E3 |
| 5.20 | User-visible impact | Function deploys are atomic per function; brief cross-function inconsistency possible between first and last deploy — schedule a low-use window; no maintenance page required | E2 |

---

## 6. Data and Financial Safety (B9DE-PR-004)

> **Rev 1 defect corrected.** Rev 1 demanded "all fingerprints unchanged", which would have **failed the rollout on Migration 022's intended behavior**. Rev 2 separates *unexpected monetary delta* (must be zero) from *expected governance delta* (must match an exact contract).

### 6.1 Principle

- **Zero unexpected monetary delta.**
- **Exact expected governance/backfill delta**, matching the migration's contract.
- **Deterministic proof that immutable monetary fields are unchanged.**

Global aggregates alone are **insufficient** — offsetting row-level or cross-tenant changes can hide defects. All groups use **per-company, per-row deterministic hashing** in addition to counts and sums.

### 6.2 Group A — Immutable monetary fields (MUST show zero unexpected change)

Captured in E1, re-verified after every migration, after E2, and after E3. Per company **and** per row, deterministically hash and aggregate:

| Domain | Fields |
|---|---|
| Invoice | `total_amount`, `outstanding`, booked exchange rate, base amount, `status` (where the migration is not expected to change it) |
| Receipt | `receipt_amount`, `allocated_amount`, `unallocated_amount`, booked exchange rate, base amount, `status` |
| Allocation (`allocation_details`) | `allocated_amount`, **`discount_amount`**, `base_allocated`, `invoice_rate`, `receipt_rate`, `forex_gain_loss`, `status` |
| Credit-note allocation (`cn_allocations`) | `allocated_amount`, `status` |
| Credit/Debit notes | document amounts |
| Journal entries | debit/credit totals |

Suggested shape (per company, ordered deterministically):

```sql
SELECT company_id,
       count(*),
       sum(total_amount), sum(outstanding),
       md5(string_agg(id::text || ':' || total_amount || ':' || outstanding || ':' || status,
                      '|' ORDER BY id)) AS row_hash
FROM invoices GROUP BY company_id ORDER BY company_id;
```

**Any unexplained change to Group A is a stop condition.**

### 6.3 Group B — Expected Migration 022 governance delta (verified, not failed)

Migration 022 is **expected** to (repository-verified from `database/022_fx_booking_rate_governance.sql`):

- `INSERT` booking-rate decision records into `public.fx_booking_rate_decisions` (invoice-sourced and receipt-sourced);
- `INSERT` decision **event** records into `public.fx_booking_rate_decision_events`;
- link historical invoices via `UPDATE public.invoices SET fx_decision_id, fx_source_category`;
- link historical receipts via `UPDATE public.receipts SET fx_decision_id, fx_source_category`.

> **Critical scope fact:** the invoice/receipt `UPDATE`s touch **only** `fx_decision_id` and `fx_source_category`. **No monetary field is written.** Therefore Group A must remain unchanged **through** Migration 022 — this is a strong, checkable separation, not an exemption.

Verify exactly:

| Check | Expectation |
|---|---|
| Booking decision count | matches the eligible invoice + receipt population |
| Decision event count | matches the decision contract |
| Invoice link count | every eligible invoice has `fx_decision_id` |
| Receipt link count | every eligible receipt has `fx_decision_id` |
| Missing links | **0** |
| Duplicate links | **0** |
| Company mismatch | **0** — decision `company_id` = document `company_id` |
| Currency mismatch | **0** |
| Document relationship mismatch | **0** |
| Old-row → governance-row mapping | deterministic and reproducible |

A delta matching this contract **must not cause automatic failure**. A delta *not* matching it is a stop condition.

### 6.4 Group C — Tenant / company integrity

Company-scoped counts, sums, and deterministic row hashes for every financial table. Verify:
- no row moved between companies;
- no company gained or lost rows unexpectedly;
- per-company totals reconcile independently.

**Global totals alone are never accepted as proof.**

### 6.5 Allocation arithmetic — the real financial contract (B9DE-PR-004)

**Repository-verified contract.** Allocation reversal in `database/007_financial_rpcs.sql` (lines 1039, 1272) and `database/028_linked_credit_note_reference_integrity.sql` (line 2218) restores:

```
new_outstanding = ROUND(invoice.outstanding + allocation.allocated_amount + allocation.discount_amount, 2)
```

and the `028` guard (line 1375) tests `NEW.allocated_amount + NEW.discount_amount` against invoice outstanding.

**Therefore the allocated financial effect on an invoice is:**

```
allocated financial effect = active allocated_amount + active discount_amount
```

**Discount is NOT always zero and MUST NOT be omitted.** The verification equation is:

```
invoices.total_amount
  − Σ (allocation_details.allocated_amount + allocation_details.discount_amount)   [status <> 'Reversed']
  − Σ (cn_allocations.allocated_amount)                                            [status <> 'Reversed']
  = invoices.outstanding
```

for every invoice with `status NOT IN ('Cancelled','Draft')`. This is always computed as the **raw arithmetic result**. Ordinarily its expected mismatch count is 0. The sole planned exception is a separately approved F3/P2 historical snapshot whose internal settlement detail truthfully never existed: those rows remain raw mismatches and are reported separately as externally explained only when each exact company/invoice row has authoritative, immutable provenance. The repeated E1 must report:

- raw mismatch count and exact amount;
- externally explained historical-state count and exact amount;
- unexplained count and exact amount.

`B9DE-E1-001` can close only when unexplained count and amount are both zero. Explained rows remain in invoice/document totals, revenue-related reporting, receivable history, customer statements and all other truthful financial populations; the P2 contract is not an aggregate exclusion or a claim that the equation balances.

> `cn_allocations` has no discount column (schema-verified, `database/001_create_tables.sql` line 801) — only `allocation_details` carries `discount_amount`. Rev 1's equation omitted `discount_amount` entirely and would have produced false mismatches wherever a settlement discount exists.

### 6.6 Additional invariants

1. **Booked FX rate values immutable (B9DE-FPR-004).** Stated precisely, so this rule cannot be read as forbidding Migration 022's expected bootstrap rows:
   - **Pre-existing invoice and receipt booked numeric values remain unchanged** — booked exchange rate, base amount, and every Group A monetary field show **zero unexpected change**.
   - **Pre-existing decision rows, if any, remain immutable** unless the migration contract explicitly maps or supersedes them.
   - **Migration 022 is EXPECTED to create new `fx_booking_rate_decisions` rows.**
   - **Migration 022 is EXPECTED to create new `fx_booking_rate_decision_events` rows.**
   - **Migration 022 is EXPECTED to link eligible historical invoices and receipts** (writing only `fx_decision_id` and `fx_source_category`).
   - **Those expected new governance rows are accepted only when Group B (§6.3) matches exactly.**
   - Immutability enforcement from `023` is proven by read-only inspection, never by attempting a write.

   > A non-zero row count in `fx_booking_rate_decisions` or `fx_booking_rate_decision_events` after Migration 022 is **expected and correct**, not a violation. The violation condition is a **Group A** numeric change, or a **Group B** delta that does not match the contract.
2. **Reference and booking layers separated** — a reference sync must never write a booking rate; verified structurally and, if a sync runs, by fingerprint.
3. **Direct RPC privileges restricted** — `has_function_privilege('anon'|'authenticated', 'public.get_allocation_candidates(uuid,uuid,uuid)', 'EXECUTE')` = **false**.
4. **Auto allocation disabled** — `POST /allocations/auto` → **403 `AUTO_ALLOCATION_DISABLED`** (already confirmed in production in Batch 9C P2-Fix1; re-confirm after redeploy). This is a *rejected* call that creates nothing.
5. **Tenant isolation** — cross-company reads return 404/403.
6. **No controlled test records in production** unless separately approved; if ever approved, minimal, clearly reversible, immediately reversed, and recorded. **Default: none.**

### 6.7 Read-only preference

Every check in §6 except invariant #4 (a rejected 403) is verifiable read-only. **No production financial record is created by this plan.**

---

## 7. Provider and Scheduler Strategy

### 7.1 Intended production provider behavior

| Aspect | Production intent |
|---|---|
| Provider | `MAS` via Frankfurter v2 |
| Host | `https://api.frankfurter.dev/v2` (pinned) |
| Credentials | None required |
| Attribution | `providers=MAS` + `expand=providers`; mismatch → `FX_PROVIDER_MISMATCH` (fail closed) |
| Routes | `POST /fx-rate-sync/sync` (manual), `/scheduled-sync` (scheduler), `/mock-sync` (deterministic mock) |
| Read API | `fx-rates` — `GET /latest`, `/lookup`, `/history`, `/health`, authenticated via `getAuthContext` |
| Scheduler auth | Dedicated `FX_SCHEDULER_SECRET` header; never a user JWT, never a service-role key |
| Company scope | `FX_SCHEDULER_COMPANY_ID` |
| Failure behavior | Lease-based, fail-closed; a failed run writes no partial rates |
| Retry | None automatic; manual re-run available |
| Staging coexistence | `batch_9d_b_fx_scheduler_staging` `30 7 * * *` — **untouched** |
| Manual fallback | `POST /fx-rate-sync/sync`, operator-invoked |

### 7.2 Is production scheduler activation necessary for the final demonstration?

**No.**

- The **frontend never calls the FX functions**, so the multi-currency UX demonstration is unaffected by whether a scheduler runs.
- Scheduled sync is already **proven in staging** with an active job and runtime evidence.
- A production cron is the only element writing **autonomously and recurrently** outside any observed window — the worst risk-to-value ratio in the batch for a project with no on-call.
- Manual sync exercises the **identical code path** on demand, under observation — better demo control.

### 7.3 Recommendation

> ## **Option B — production FX scheduler DISABLED; `fx-rate-sync` deployed; controlled manual sync OPTIONAL.**

**Option B explicitly means:** all 16 functions deployed (including `fx-rate-sync` and `fx-rates`); `fx-rates` read API verified; `fx-rate-sync` source, deployment, authentication and provider configuration verified; **recurring production FX scheduler not created**; and **production manual sync OPTIONAL, requiring separate mutation authorization** (§4.4 Option B, paths B1/B2). It does **not** mean the FX functions are skipped, and it does **not** require a production sync to be executed.

Option A remains available in one reversible step via §4.4 Option A.

### 7.4 `daily-overdue` scheduling — separate and more urgent

Independent of FX. Governed by the §4.2.3 branch logic.

**Recommendation: redeploy `daily-overdue` with `CRON_SECRET` set (per branch), and create NO production cron job for it in 9D-E.** The redeploy is a security improvement that closes the fail-open hole; a new recurring job is not needed for the demonstration.

---

## 8. Frontend Production Strategy

### 8.1 `frontend/.env.local` — hygiene, kept SEPARATE from rollout (B9DE-PR-009)

`frontend/.env.local` resolves to **production**. It was not edited, not used for network access, and not started in this planning task, and **it is not an execution step of Batch 9D-E**.

**This is a development-hygiene concern, explicitly out of the production rollout scope.** Recommended future handling (separate task, not authorized here): keep `.env.local` for deliberate production-read work only and add an explicitly selected `.env.staging.local` for staging development. Never commit either.

Severity: **Medium, non-material to production release** — it risks accidental production traffic from a dev server but exposes no credential beyond a public anon key, and it does not affect the deployed artifact.

### 8.2 Required Vercel production environment (B9DE-PR-009)

**Four required** (§2.13): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_DEFAULT_COMPANY_ID`.

**Two not required:** `NEXT_PUBLIC_DEMO_USER_ROLE` (comment-only / behaviorally unused) and `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID` (currently unused by source). **No fixture validation is required for either.**

`NEXT_PUBLIC_SUPABASE_ANON_KEY` remains a legacy anon key and remains valid because production legacy mode stays enabled (§2.9).

### 8.3 Publishable-key usage

Backend `getUserClient()` uses `SUPABASE_PUBLISHABLE_KEYS.default` server-side. The **browser** still uses the legacy anon key. Migrating the browser is a clean follow-up, **not** required for 9D-E (§13.3).

### 8.4 Backend compatibility before release

Hard precondition (§3.1): `GET /allocations/candidates` live in production before the push. Enforced as a §11.2 GO criterion.

### 8.5 Expected deployed commit

**`RESOLVED_BATCH_9D_E_ROLLOUT_HEAD`** (§0.1) — the value E1 resolved from the clean local `main` HEAD and recorded in E1 evidence, which carries `BATCH_9D_D_CODE_COMMIT` as an ancestor. Any other SHA on the production deployment is a **stop condition**. Note the deployed SHA is **not** `BATCH_9D_D_CODE_COMMIT` itself, because that commit does not contain this plan; ancestry is proven **separately**.

### 8.6 Cache and revalidation

Next.js 15.5.19; the build produces 25 static pages plus dynamic routes, rebuilt per deployment — no stale-cache action required. Verify a hard-reloaded session picks up the new build and that no service worker retains old assets.

### 8.7 No fake fixtures in production

- `use-user-role.ts` derives role from `GET /auth/me`; no demo env value drives real behavior.
- `007c_api_staging_fixtures.sql` must never be applied to production.
- The two demo variables are unused by source (§2.13); no fixture validation needed.

---

## 9. Smoke Test Matrix

> **B9DE-PR-001:** every runtime probe below executes in **E2 or E3**. **None executes in E1.** Row A specifically requires the **fixed** `daily-overdue` bundle to be deployed first.
>
> **Rows A–F are read-only. Row G requires separate explicit authorization and is NOT in default scope.**

### Row A — Anonymous / public (E2, post-`daily-overdue`-fix only)

| # | Check | Expected |
|---|---|---|
| A1 | `GET /` (frontend) | 200 |
| A2 | Core routes unauthenticated | login redirect; no data leak |
| A3 | Edge function without `Authorization` | 401 |
| A4 | `daily-overdue` missing / blank / invalid `X-Cron-Secret` | **401 ×3 — ONLY after the fixed bundle is deployed** |
| A5 | Deployed `daily-overdue` bundle content | contains `SCHEDULED_AUTH_NOT_CONFIGURED`; **not** `"Invalid cron secret"` |
| A6 | Direct RPC `get_allocation_candidates` as `anon` | denied |

### Row B — Authenticated general user (E3)

| # | Check | Expected |
|---|---|---|
| B1 | Login | success |
| B2 | `GET /auth/me` | 200, correct role |
| B3 | Dashboard KPIs and charts | render; no console error |
| B4 | Invoice list + detail | correct amounts and currency |
| B5 | Receipt list + detail | correct amounts and currency |
| B6 | Reports (aging, invoices, receipts, outstanding) | render; no 100-row cap regression |
| B7 | Multi-currency display | directed FX presentation; no residual MYR default |
| B8 | Notifications + profile overlays | render |
| B9 | Empty and error states | graceful |
| B10 | Console / network | no uncaught errors; no 4xx/5xx on core routes |

### Row C — Finance Manager (E3)

| # | Check | Expected |
|---|---|---|
| C1 | Elevated capabilities in `/auth/me` | correct |
| C2 | Allocation workbench loads candidates | 200, complete non-paginated contract, deterministic order |
| C3 | Customer statement | renders |
| C4 | Settings / audit log / roles | render |
| C5 | `POST /allocations/auto` | **403 `AUTO_ALLOCATION_DISABLED`** |

### Row D — AR Clerk and tenant isolation (E3)

| # | Check | Expected | Environment |
|---|---|---|---|
| D1 | Assigned Clerk sees only assigned scope | correct | **Production** (within the single company) |
| D2 | Unassigned Clerk → receipt candidates | 404 | **Production** (within the single company) |
| D3 | Cross-tenant receipt id | 404 — never another tenant's data | **Staging** — accepted two-company runtime evidence (T1) |
| D4 | Cross-company report request | 403/404 | **Staging** — accepted two-company runtime evidence (T1) |
| D5 | Direct RPC as `authenticated` | denied | **Production** (structural / privilege inspection) |

> **T1 (§4.1.5).** D3 and D4 require two tenants and are therefore **not executed in production** — production has one legitimate active company and **no second production company or user is created**. They are satisfied by the accepted **staging** two-company runtime evidence, which is recorded as staging evidence and **never** presented as production runtime evidence. D1, D2 and D5 remain production checks and require approved existing-account custody plus separate authorization before any login.

### Row E — FX read surface (E2/E3, read-only)

| # | Check | Expected |
|---|---|---|
| E1 | `fx-rates` `GET /health` (authenticated) | 200 |
| E2 | `fx-rates` `GET /latest` / `/lookup` / `/history` | 200, reference-layer data only |
| E3 | `fx-rates` unauthenticated | 401 |
| E4 | Pre-existing booked numeric rate values unchanged after any `fx-rates` read | Group A unchanged |

### Row F — Imports (E3, READ-ONLY by default) (B9DE-PR-008)

| # | Check | Expected |
|---|---|---|
| F1 | `/invoices/import` loads | 200, UI renders |
| F2 | `/receipts/import` loads | 200, UI renders |
| F3 | Accepted file types and validation copy | matches Batch 9B/9C contract (PDF/PNG/JPG/WebP accepted; SVG/SVGZ rejected) |
| F4 | OCR provider state | disabled / manual-fallback copy only |
| F5 | **No upload performed; no import batch, import row, or persistent record created** | **verified — requires separate mutation authorization to do otherwise** |

### Row G — Controlled mutation (REQUIRES SEPARATE AUTHORIZATION — not in default scope)

| # | Check | Precondition |
|---|---|---|
| G1 | Minimal reversible allocation, immediately reversed | explicit approval; reversal reason recorded; Group A restored |
| G2 | Manual FX sync `POST /fx-rate-sync/sync` | explicit approval (Option B2, §4.4); reference layer only; pre-existing booked numeric rate values unchanged; Group A zero unexpected delta |
| G3 | `daily-overdue` controlled positive invocation | explicit approval; §4.2.3 branch complete |

**Default: Row G is not executed.** Rows A–F provide sufficient assurance for this release.

---

## 10. Rollback and Containment (B9DE-PR-005)

### 10.1 Reversible

| Scenario | Rollback |
|---|---|
| Migration fails **before** commit (atomic wrapper) | Transaction aborts; no state change; investigate, then re-run **only if the applied state is confirmed unchanged** |
| Edge deployment regression — **all functions except `daily-overdue`** | Redeploy previous source; version increments forward, behavior returns |
| Credential misconfiguration | Delete/recreate the named production key; correct the secret; redeploy |
| Frontend regression | **Vercel instant rollback** to the previous production deployment |
| Scheduler failure (Option A only) | Delete the cron job |
| Provider failure | Lease-based fail-closed; no partial rates; nothing to roll back |
| Migrations `020`, `021` | Privilege/constraint-only, no DML — genuinely reversible |
| Migration `030` | Additive + privilege — reversible |

### 10.2 Forward-fix required

| Scenario | Why |
|---|---|
| **Migration `022` after successful application** | **Creates historical governance data (`fx_booking_rate_decisions`, `fx_booking_rate_decision_events`) and updates linkage metadata on invoices and receipts. NOT safely reversible by generic rollback.** Forward-fix only. |
| Migrations `017`, `018`, `019`, `023`, `024`, `025`, `026`, `027`, `028`, `029` | **Replace prior function/RPC/trigger definitions irrecoverably** — the previous definition cannot be reconstructed from the new file. (Corrected: these contain **no migration-time DML**; their DML lives in function bodies. Forward-fix is required for definition-replacement reasons, not backfill.) |
| Migration succeeded but a later Edge deploy fails | Schema is committed; roll **forward** by fixing the function |
| Any defect found after data is written under the new schema | Reverting schema would orphan real rows |

> **Correction history:** Rev 1 labelled `017`, `018`, `022` and `030` "additive — reversible", which understated the risk. Rev 2 over-corrected by attributing migration-time DML to eight migrations on raw textual counts. **Rev 3 states the verified position:** `022` is the sole migration-time data-mutating migration and is not reversible; `017`, `018`, `019`, `023`–`029` are forward-fix because they irrecoverably replace definitions; `020`, `021` and `030` are genuinely reversible (privilege, constraint, and additive respectively, with no data mutation).

### 10.3 `daily-overdue` containment rule — rollback PROHIBITED

> **The generic "redeploy the previous function version" rollback EXPLICITLY EXCLUDES `daily-overdue`**, because the previous production bundle is the **known-vulnerable fail-open** build.

- **Never redeploy the known vulnerable pre-fix `daily-overdue` source.**
- **Never "roll back" to the conditional fail-open predicate.**
- If the fixed deployment fails: **preserve `CRON_SECRET` and caller containment**; **disable or pause the caller** if necessary; **deploy a corrected forward fix** built from a **known-secure bundle** only.
- Reducing availability of `daily-overdue` is always preferable to restoring an unauthenticated privileged write path.

### 10.4 Rollback PROHIBITED (general)

- Dropping or reverting manifest migrations once production data references the new objects — **forward-fix only**.
- **Un-pushing a Git commit.** Remediate with Vercel rollback plus, if needed, a forward revert commit. **Never force-push `main`.**
- Deleting audit or evidence rows to "clean up" a failed run.
- Restoring any vulnerable code (§10.3).

> **Honesty statement:** this plan does **not** claim full migration rollback. `019`, `020`, `021` are unwrapped and thin; `022` backfills history; several files replace RPC bodies irrecoverably from the file alone. The genuine safety net is the §5.1 recovery point plus forward-fix — not a reverse migration.

### 10.5 Stop immediately (halt, do not continue, report)

1. Any command resolved to a project ref other than `kusseuycqgdilychphpq` during E2–E4.
2. Migration state classified `PARTIAL_OR_DIVERGENT` or `UNKNOWN`.
3. A data-compatibility preflight failure against existing production rows.
4. Active secret exposure.
5. Tenant leakage.
6. **Group A** monetary change without an approved explanation, **or** a **Group B** delta not matching the Migration 022 contract.
7. Anonymous privileged access.
8. Deployed Vercel commit SHA ≠ the E1-captured `RESOLVED_BATCH_9D_E_ROLLOUT_HEAD`, or that SHA does not carry `BATCH_9D_D_CODE_COMMIT` as an ancestor, or a source change appears after the accepted code commit.
9. `daily-overdue` caller `CANNOT_BE_CONFIRMED` or unable to send the header (§4.2.3 STOP path).
10. Required smoke identities missing, or account custody unapproved before an authenticated smoke (§4.1.5, T1).
11. **Any row failing the §6.5 settlement equation without an approved, evidence-backed explanation** — including the F3 cohort until its remediation track completes (§4.2.2; `BATCH_9D_E1_F3_PRODUCTION_FINANCIAL_REMEDIATION_PLAN.md`). **Excluding failing rows from the predicate to obtain PASS is itself a stop condition.**
12. Any Critical, High, **or material Medium** finding (§11.0).

### 10.6 Non-blocking

Only **non-material** Medium and Low findings are recorded and deferred (§11.0).

---

## 11. Go / No-Go Criteria

### 11.0 Blocking threshold (B9DE-PR-007) — applies to E1, E2, E3, E4 and final closure

**The release STOPS for:**

- **All Critical findings.**
- **All High findings.**
- **Material Medium findings** — any Medium touching:
  - authentication;
  - authorization;
  - tenant isolation;
  - credential safety;
  - financial correctness;
  - migration compatibility;
  - deployment ordering;
  - rollback / containment honesty;
  - core demonstration functionality.

**Only non-material Medium and Low findings may be documented and deferred.** A Medium finding may never be deferred merely because it is labelled Medium — materiality, not severity label, governs. This threshold is applied identically at every gate.

### 11.1 Backend rollout GO (entering E2)

- ✅ E1 PASS; `PRODUCTION_MISSING_MIGRATION_MANIFEST` emitted with no `PARTIAL_OR_DIVERGENT` / `UNKNOWN`.
- ✅ Data-compatibility preflights pass: `022` backfill population matches the expected eligible set; `021`/`027`/`028` constraint validation holds against existing production rows.
- ✅ `daily-overdue` caller record complete; branch A or B determined (not `CANNOT_BE_CONFIRMED`).
- ✅ **F3 cohort resolved:** §6.5 raw/explained/unexplained results are reported exactly; ordinary arithmetic reconciles for P1/P3-treated rows, every P2-explained row has approved immutable external provenance, unexplained count/amount are zero, and no row is excluded from monetary populations to obtain PASS (`B9DE-E1-001` closed only after F3-P5).
- ✅ **T1 tenant assurance satisfied** (§4.1.5): production structural proof + zero ownership anomalies + accepted staging two-company runtime evidence; the four existing single-company smoke identities confirmed to exist and be safe; custody approved before any authenticated smoke (`B9DE-E1-002` closed).
- ✅ **Vercel name-only checklist complete** — all four Production variable names `PRESENT` / target `YES` (§4.1.6.1, `B9DE-E1-003` closed).
- ✅ Recovery point confirmed and recorded.
- ✅ `SUPABASE_PUBLISHABLE_KEYS.default` confirmed resolvable; plan for the named secret key approved.
- ✅ Group A/B/C baseline fingerprints captured.
- ✅ Vercel behavior confirmed.
- ❌ NO-GO: wrong project; ambiguous migration state; preflight failure; missing identities; active credential exposure; **any Critical, High, or material Medium finding**.

### 11.2 Frontend push GO (entering E3)

- ✅ E2 PASS; **all 16 functions** ACTIVE with correct `verify_jwt`.
- ✅ **`GET /allocations/candidates` live and returning the complete contract.**
- ✅ `POST /allocations/auto` → 403.
- ✅ `daily-overdue` Row A4 401 ×3 and Row A5 bundle content confirmed.
- ✅ Group A unchanged; Group B matches the 022 contract; Group C per-company integrity holds.
- ✅ Allocation equation (§6.5, **including `discount_amount`**) has zero **unexplained** mismatch count/amount; any P2 raw mismatch remains explicitly reported and fully mapped to approved immutable provenance.
- ✅ Local `tsc --noEmit`, ESLint, `next build`, full Vitest pass at `RESOLVED_BATCH_9D_E_ROLLOUT_HEAD`.
- ✅ Local `HEAD` still exactly the E1-captured `RESOLVED_BATCH_9D_E_ROLLOUT_HEAD`; no new commit since E1; no tracked worktree change; `BATCH_9D_D_CODE_COMMIT` an ancestor; intervening commits documentation-only; behind 0; 0 staged, 0 unstaged tracked.
- ❌ NO-GO: candidate contract unavailable; any core function failing; Group A delta; tenant-isolation failure; **any Critical, High, or material Medium finding**.

### 11.3 Scheduler activation GO — **OPTION A ONLY**

> These criteria gate **Option A exclusively**. **Option B does not depend on them** (§4.4 Option B has self-contained entry criteria).

- ✅ E3 PASS.
- ✅ Production company base currency confirmed `MYR`.
- ✅ `FX_SCHEDULER_SECRET` + `FX_SCHEDULER_COMPANY_ID` set; Vault reference by name.
- ✅ `fx-rate-sync` deployed; a **separately authorized** Option B2 production manual sync executed and verified; provider attribution `MAS`. *(Option A criterion only — Option B1 requires no production sync.)*
- ✅ Explicit user approval of **Option A over the recommended Option B**.
- ❌ NO-GO: base currency ≠ MYR; attribution mismatch; **any change to a pre-existing booked numeric rate value or any Group A monetary field**; **any Critical, High, or material Medium finding**.

### 11.4 Final Batch 9D closure GO

- ✅ E1–E3 PASS; E4 completed under Option A, or under Option B path B1 **or** B2 (§4.4).
- ✅ Rows A–F smoke pass.
- ✅ Zero unexpected monetary delta proven; expected 022 delta verified.
- ✅ Production evidence file complete and accurate.
- ✅ Master plan current-state accurate.
- ✅ **No unresolved Critical, High, or material Medium finding.**

---

## 12. Evidence Plan

Create at closure: **`docs/evidence/SPRINT_BATCH_9D_E_PRODUCTION_ROLLOUT_EVIDENCE.md`**

1. Production target `kusseuycqgdilychphpq`; explicit statement that staging was not mutated.
2. `BATCH_9D_D_CODE_COMMIT` = `233005146f7e9551e45fc437fc7fcade678a9f62` and the E1-resolved `RESOLVED_BATCH_9D_E_ROLLOUT_HEAD` (captured in the E1 execution report and evidence artifact — **not** written back into either plan); ancestry proof; Vercel deployment id and verified deployed SHA; E1-confirmed auto-deploy behavior.
3. `PRODUCTION_MISSING_MIGRATION_MANIFEST` as observed, with per-migration result, atomicity method, and classification.
4. Edge Function pre/post version table for **all 16**, with `verify_jwt`.
5. **Key and secret NAMES only** — `batch_9d_d_edge_admin_20260718`, `CRON_SECRET`, `FX_SCHEDULER_SECRET`, `FX_SCHEDULER_COMPANY_ID`, dictionary names. **No values, no hashes.**
6. `daily-overdue`: caller record, branch taken (A / B / STOP), coordination steps, bundle-content proof.
7. Scheduler state: staging unchanged; production Option A or B with resulting job list.
8. Smoke results Rows A–F, sanitized status codes; identities referenced by role, never by credential.
9. **Financial proof:** Group A zero unexpected delta; Group B expected 022 delta verified against contract; Group C per-company integrity; allocation equation including `discount_amount`.
10. Rollback readiness: recovery point timestamp; Vercel previous deployment id; forward-only migrations named; `daily-overdue` containment rule restated.
11. Production limitations: legacy keys intentionally enabled; browser on anon key; `.env.local` hygiene deferred; deferred non-material findings; Row G not executed.
12. Final verdict.

**Prohibited in evidence:** any PAT, anon/service-role/publishable/secret key value, `CRON_SECRET`, scheduler credential, user JWT, Authorization header, password, or complete credential hash.

---

## 13. Proportionate FYP Production Standard

### 13.1 Controls RETAINED

- Read-only preflight that **invokes no Edge Function**.
- E2 consuming E1-produced manifests and identities, never assumptions.
- Verified production project ref on every command.
- Recovery point before schema change.
- Observed migration manifest; strict ordering; per-file atomicity; no blind retry.
- Read-only data-compatibility preflights before mutation.
- Secret/key provisioning before dependent deployment.
- No-break `daily-overdue` caller coordination with an explicit STOP path.
- Cheapest-failure-first deployment order.
- Backend-complete-before-push ordering under either Vercel answer.
- Group A/B/C fingerprinting distinguishing corruption from intended backfill.
- Allocation arithmetic using the **real** contract including `discount_amount`.
- Tenant-isolation and RPC-privilege verification.
- Fail-closed verification by **bundle content**, never version number.
- Containment rule forbidding rollback to vulnerable code.
- Material Medium findings blocking at every gate.
- Secret-free evidence.

### 13.2 Enterprise-only controls INTENTIONALLY OMITTED

| Omitted | Why disproportionate here |
|---|---|
| Blue-green / canary infrastructure | Single small deployment; Vercel instant rollback suffices |
| Multi-region disaster recovery | Single-region FYP; PITR adequate |
| Formal change-advisory board | Sole approver; gates already provide control |
| Chaos engineering | No resilience claim is being made |
| Universal zero-downtime guarantee | Brief per-function inconsistency acceptable in a low-use window |
| Large-scale load/performance testing | No throughput requirement; the 5,000-candidate cap bounds the heaviest read |
| Long-running observability infrastructure | Supabase + Vercel logs sufficient at this scale |
| Deployment orchestration platform | A short ordered command list is clearer and less error-prone |
| Automated migration rollback tooling | Would be a false promise for these forward-only migrations |

### 13.3 Known non-blocking limitations ACCEPTED

1. **Production legacy API keys remain enabled** — required for the live frontend; production keys were never exposed. Deliberate.
2. **Browser still uses the legacy anon key** — publishable-key migration deferred.
3. **Several migrations are forward-only** — mitigated by recovery point and forward-fix; stated honestly rather than papered over.
4. **Edge log retention is short** — time-sensitive evidence must be captured at the moment of action.
5. **`frontend/.env.local` points at production** — development hygiene, explicitly separated from rollout (§8.1).
6. **`v_customer_credit_utilization` cross-currency summation** — pre-existing 9D-C limitation; frontend routes around it; unchanged by 9D-E.
7. **Row G controlled mutation not executed by default** — Rows A–F judged sufficient.
8. **`journal-entries` deployed nowhere** — pre-existing; out of scope.

### 13.4 Why the result remains high quality and professionally defensible

The plan preserves every control protecting **money, tenants, credentials, and recoverability**, and orders them from the actual code: the shared key-resolution dependency, the migration→RPC→function chain, the fail-closed authentication boundary, and the push-triggers-deploy risk. It refuses to verify production from documentation, refuses to probe a suspected fail-open route, refuses to break an existing caller, refuses to confuse an intended backfill with corruption, refuses to omit discount from a financial equation, and refuses to claim reversibility it does not have. What it declines to build is infrastructure justified only by scale, team size, or uptime obligations this project does not have. That is proportionate engineering judgment, not a shortcut.

---

## 14. Cross-References

- Master plan: `docs/plans/BATCH_9D_DAILY_FX_RATE_SYNC_AND_MULTI_CURRENCY_UX_PLAN.md` §0.0, §0.8.
- Scheduler runbook: `docs/runbooks/BATCH_9D_B_SCHEDULER_STAGING_CONFIGURATION_RUNBOOK.md`.
- Production readiness runbook: `docs/deployment/P0_P1_PRODUCTION_READINESS_RUNBOOK.md`.
- Evidence chain: `SPRINT_BATCH_9D_A/B/C/D_*`, `SPRINT_BATCH_9B_PRODUCTION_BACKEND_ROLLOUT_EVIDENCE.md`, `SPRINT_BATCH_9C_PRODUCTION_*`, `BATCH_9A_PRODUCTION_DEPLOYMENT_AND_SMOKE_EVIDENCE.md`, `PRE_BATCH_CLEANUP_SYSTEM_BASELINE_AUDIT_EVIDENCE.md`.
- Financial contract sources: `database/007_financial_rpcs.sql` (1039, 1272), `database/022_fx_booking_rate_governance.sql` (573–728), `database/028_linked_credit_note_reference_integrity.sql` (1375, 2218), `database/001_create_tables.sql` (801).

---

## 15. Historical Rev 3.8 Plan Status — superseded by §20 and the Rev 4.1 header

- **Historical status:** **Rev 3.8 — FINAL REPEATED READ-ONLY PREFLIGHT `NO-GO`.** Business/financial/Storage/identity after-state passed and the credential incident closed; one Production RLS blocker then remained. This dated checkpoint is retained as evidence and does not describe current rollout state.
- **Blocker status:** `B9DE-E1-001` **OPEN by whole-gate closure rule (High)**, with financial remediation technically verified; `B9DE-E1-002` **CLOSED**; `B9DE-E1-003` **CLOSED**; `B9DE-E1-004` **CLOSED** by owner attestation plus clean scans; `B9DE-E1-005` **OPEN (High)** for the authenticated unconditional `public.user_roles` SELECT policy.
- **Gate 9D-E2 remains UNAUTHORIZED** until `B9DE-E1-005` is separately remediated, another authorized read-only E1 passes, and all prior closed findings remain closed.
- **Financial remediation track:** `docs/plans/BATCH_9D_E1_F3_PRODUCTION_FINANCIAL_REMEDIATION_PLAN.md`; F3-P4 is complete, while the document authorizes no further action.
- **Not implementation-ready** until the repeated E1 passes.
- **Authorization granted by this document: NONE.** Production, push, migration, deployment, credentials, and schedulers all remain unauthorized. **The Batch 9D-E planning commit itself is not authorized by this document.**
- **`BATCH_9D_E_ROLLOUT_HEAD` remains symbolic by design.** Its concrete value is resolved at Gate 9D-E1 entry from `git rev-parse HEAD` and captured in the E1 execution evidence (§0.1). It is deliberately **never** written back into this plan, because a commit cannot contain its own SHA. No additional identity-recording commit is required.
- **Next action:** separately authorize a bounded Production RLS remediation/review for only the `public.user_roles` unconditional SELECT policy, then independently repeat the affected catalog/RLS checks and whole E1 gate. E2, push, deployment, migrations, identities and schedulers remain unauthorized.

---

## 16. F3-P1/P2/P3 test-data-reset checkpoint (authoritative current state)

- F3-P1 completed read-only with verdict `PASS  BATCH 9D-E1 F3-P1 PRODUCTION READ-ONLY PROVENANCE DISCOVERY COMPLETE`.
- The owner/data custodian attests that the current Production AR business population is synthetic test/demo/smoke data; formal outcome **P1 — SYNTHETIC / DEMO DATA**.
- F3-P2 selects an exact-manifest test-data reset: retain exactly ten principal coherent demo scenario anchors and their complete dependency graph; delete every other Production AR test-data row reachable within the reviewed graph.
- The exact deletion manifest includes all 128 defective `Paid` invoices and, under the separately expanded owner-authorized reset scope, all 922 non-retained header-only `Open` invoices. The 922 rows were not silently folded into the original 128-row F3 diagnosis.
- Local F3-P3 artifacts exist only under `database/operators/` and `docs/runbooks/`. Under the later separate F3-P4 authorization, the Production dry run returned `READY`, the database operator committed exactly once, and the bounded exact-key Storage phase completed.
- No ordinary Batch 9D-E migration carries this cleanup. No P3S is presently required; the operator aborts if the future lifecycle triggers are installed. Any changed trigger state requires STOP and separate P3S review/authorization.
- F3-P4 remained isolated from Migrations 017–030, Edge deployment, scheduler, credential, identity, push and Gate E2 work. Storage object deletion was executed as the separately bounded post-database phase.
- `B9DE-F3-P1-001` is closed by the completed reset. The later F3-P5 result is recorded in §18.

---

## 17. Historical F3-P4 controlled Production reset checkpoint — superseded

- **Date and target:** 2026-07-21, Production project `kusseuycqgdilychphpq`, company `00000000-0000-0000-0000-000000000001` only.
- **Database phase:** exact read-only dry run `READY`; the approved 2,651-row deletion manifest with SHA-256 `cfa7d6d7bc739bd190fb14a2e8bb680dc473fbe1e678db1b1235f07e9b75cb7d` committed exactly once in the guarded `SERIALIZABLE` operator. No assertion failed and recovery did not rerun the apply SQL.
- **Database after-state:** ten principal anchors; 179 retained graph rows; 11 customers; 16 invoices; 14 invoice lines; 11 receipts; 13 allocations; 25 journal entries; 50 journal lines; import batches/files/rows/row allocations `6/6/20/7`; retained hash `36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0`; zero retained settlement mismatches. The defective 128 `Paid` and non-retained 922 header-only `Open` populations both have zero remaining rows.
- **Storage phase:** all 63 approved exact keys were removed in bounded batches of at most five. The six retained objects remain and hash to `b5f58c7c85358da973280bf4e59f5862944e451f50cd521cd6f7c05139468620`; approved delete objects remaining are zero. No full object names are retained in Git evidence.
- **Boundary:** no staging, Vercel, frontend, Edge Function, migration, DDL, credential, scheduler, identity, stage, commit or push action occurred. F3-P4 does not authorize F3-P5 or Gate E2.
- **Historical exit status of F3-P4 (superseded by §18):** `B9DE-F3-P1-001` closed; `B9DE-E1-001` remained open pending the then-future F3-P5; Gate E1 remained `NO-GO`; Gate E2 remained unauthorized.

---

## 18. Historical F3-P5 repeated Production read-only preflight — superseded

- **After-state:** `AFTER_STATE_MATCH`; ten principal anchors, ten matching scenario hashes, 179 retained rows, exact retained database hash, zero deletion-manifest rows, zero former 128/922 rows, Storage `6 retained / 0 approved-delete` with exact retained hash.
- **Financial certification:** all active/settled documents balance. Raw lifecycle differences are fully explained and independently validated: two Draft documents (`1700.00`) are pre-posting, one Cancelled document (`1.00`) has complete journal reversal, and one Bounced receipt (`1.00`) has complete allocation/journal/credit-control reversal. Document and receipt unexplained counts and amounts are zero.
- **Integrity/security:** receipt, allocation, discount, CN, journal, FX and base-currency checks pass; orphan count is zero; one active company owns every scoped row; all 16 reviewed tables have RLS and tenant-bound policies with no unconditional policy.
- **Migration 027:** deterministically `MISSING` and technically installable later: six named routines absent, no catalog conflicts, required objects present, data-assumption violations zero. It was not applied. Phase A hashes remain exact, its 12-case contract passes, and `/allocations/auto` remains disabled with `AUTO_ALLOCATION_DISABLED`.
- **Identity/T1:** four required identity types have existing candidates and zero metadata anomalies; T1 remains accepted. No owner credential-custody attestation was supplied, so `B9DE-E1-002` remains partially resolved.
- **Credential incident:** a Supabase personal access token was disclosed in conversation before this gate. It was not used or recorded in Git evidence. Revocation/replacement and old-token rejection are unverified, so `B9DE-E1-004` is High/Open.
- **Decision:** `NO-GO — BATCH 9D-E1 F3-P5 REPEATED PRODUCTION PREFLIGHT BLOCKED`. `B9DE-E1-001` stays open under the whole-gate closure rule despite technical financial remediation; `B9DE-E1-003` remains closed. Gate E2 remains unauthorized.

---

## 19. Historical Ephemeral Production smoke identity closure chronology — 2026-07-22

This section preserves the Rev 3.6 identity-readiness chronology. It is superseded by §20 and the Rev 4.1
header and does not describe the current authorization or rollout state.

- **Approved strategy:** exactly four temporary users — general authenticated, Finance Manager, assigned AR Clerk and unassigned AR Clerk — created with one run ID, authenticated independently, exercised only through read endpoints, globally signed out, stripped of exact application-identity rows, deleted with the supported Auth Admin interface and checked with the old access tokens after cleanup.
- **Supersession boundary:** this strategy replaces the earlier long-lived existing-account credential-custody requirement for `B9DE-E1-002`; it does not relax any role/RLS assertion and does not authorize a second tenant or a fifth identity.
- **Pre-mutation result:** Git and Production target matched. Production contained one target company, five pre-existing Auth users, five roles and two assignments; there was no prior ephemeral run, profile table or identity orphan. The retained 179-row business graph and six Storage objects matched the approved hashes and totals.
- **Safe stop:** the available connector had no Auth Admin create/delete/revoke operation; the runner had no safely injected non-compromised server-side Admin credential; browser automation was unavailable. Direct DML to `auth.users`, use of the disclosed PAT, schema changes and secret export were prohibited and not attempted.
- **Mutation/cleanup result:** temporary users, roles, assignments, sessions and old smoke tokens created: `0`. Consequently no cleanup mutation or old-token request existed to perform. A final aggregate scan confirmed zero ephemeral identity or Storage residue and unchanged existing identity/business hashes.
- **Decision:** `B9DE-E1-002` remains **PARTIALLY RESOLVED**. A later gate must start a new run and complete the full lifecycle; it may not claim this read-only failed-safe attempt as runtime identity proof. `B9DE-E1-004` remains separate High/Open and Gate E2 remains unauthorized.
- **Next safe action:** expose supported Supabase Auth Admin lifecycle operations to a bounded runner using a non-compromised credential injected only into volatile process memory, then separately authorize a fresh lifecycle. Do not use the disclosed PAT.
- **Runbook/evidence:** `docs/runbooks/BATCH_9D_E1_EPHEMERAL_PRODUCTION_SMOKE_IDENTITIES_RUNBOOK.md`; `docs/evidence/SPRINT_BATCH_9D_E1_PRODUCTION_READ_ONLY_PREFLIGHT_EVIDENCE.md` §21.

### 19.1 Second bounded attempt — injected variables present, Admin capability rejected

- Both authorized process environment variables were present. No value, prefix, length, hash, partial value or header was printed or persisted.
- The runner used the installed server-side Supabase client, disabled persistence/automatic refresh/URL detection, and obtained the publishable key only from existing local configuration in memory. Its source contained no credential literal and was removed by the outer cleanup guard.
- Git and Production preconditions still matched: one company, 179 retained business rows, exact retained table counts and monetary totals, five existing non-ephemeral Auth users, five roles, two assignments and zero prior ephemeral Auth residue.
- Static normalized classification returned `credential_type: unsupported`. The mandatory read-only `auth.admin.listUsers` capability probe then failed in local HTTP request construction. No Auth Admin request reached Production, so the create phase was not entered.
- Temporary run IDs/users/roles/assignments/sessions/tokens/Storage objects created were all `0`; no general, Finance Manager, assigned-Clerk or unassigned-Clerk RLS request or old-token request existed. The runner directory was deleted.
- **Decision remains:** `B9DE-E1-002` **PARTIALLY RESOLVED / NOT CLOSED**. A later newly authorized attempt requires a valid supported Production Secret/service-role credential. `B9DE-E1-004` remains **High / OPEN**; Gate E2 remains unauthorized.

### 19.2 Third bounded attempt — full lifecycle executed; positive RLS contract failed

This checkpoint was the then-current `B9DE-E1-002` execution result. The two earlier attempts remain
historical fail-safe evidence; later subsections supersede it.

- **Capability/baseline:** both process variables were present; the credential was a supported modern Secret key; server-side `auth.admin.listUsers` passed. Git and Production matched. Prior ephemeral users/sessions were zero; company/business/Storage and existing identity baselines matched and were frozen.
- **Sanitized run:** run-ID SHA-256 `2d3a0bf73f9d0da6f198549d3a6a2ae37010acb13a975e2e62b85837d39ba676`. Exactly four confirmed users were created and authenticated: general `530556c8b662`, Finance Manager `85afbb6bea7f`, assigned AR Clerk `5f53147562de`, and unassigned AR Clerk `7e52ce7d54f2` (sanitized user-ID hash prefixes only). No fifth identity or second tenant was created.
- **Provisioning:** one active Finance Manager role, two active AR Clerk roles and exactly one active first-anchor customer assignment passed all pre-login assertions. The general user had no role; the unassigned Clerk had no assignment; no profile table/row exists.
- **Passing runtime controls:** all four password logins returned success. General customers/invoices/receipts and roles were `0/0/0/0`. The unassigned Clerk returned protected rows `0/0/0`, self-role `1` and assignment `0`. Finance out-of-company rows were `0`. Assigned-Clerk outside-customer/customer-document rows were all `0`, and its self-role/assignment were `1/1`.
- **Required positive RLS failures:** Finance Manager returned customers/invoices/receipts `2/7/7`, not `11/16/11`, and principal anchors `5`, not `10`. Assigned Clerk returned customers/invoices/receipts `0/0/0`, not `1/2/2`; its assigned-customer query was also `0`.
- **Source-backed cause:** installed `rls_can_access_customer` requires the customer to have both `is_deleted = false` and `is_hidden = false` before either Finance Manager or assigned-Clerk access is considered. The retained data has only `2` eligible customers, `7` eligible invoices, `7` eligible receipts and `5` eligible anchors. The mandatory first retained anchor is not policy-eligible. Meeting the gate's positive expectations would require a separately reviewed contract decision plus an unauthorized data or RLS change; neither was attempted.
- **Mandatory cleanup:** all four tokens returned zero protected rows after exact role/assignment deletion. Global sign-out produced no failure; all four exact Auth users were permanently deleted; all four refresh attempts failed and all twelve old-token protected reads returned zero. Passwords/tokens were erased and the runner directory was removed.
- **Independent postcheck:** ephemeral users/sessions/roles/assignments and temporary Storage ownership are all zero; existing Auth/role/assignment fingerprints match; company count is one; business graph/counts/totals and Storage count/fingerprint match the pre-run state.
- **Decision:** `B9DE-E1-002` remains **PARTIALLY RESOLVED / NOT CLOSED** because eight required positive RLS assertions failed. `B9DE-E1-004` remains **High / OPEN**. Gate E2 remains unauthorized. No source, schema, policy, data, Storage, migration, deployment, stage, commit or push change was made.

### 19.3 Corrected visibility-contract lifecycle — PASS and closure

This checkpoint supersedes §19.2 as the current `B9DE-E1-002` decision while retaining prior attempts as historical fail-safe and stale-expectation evidence.

- **Authoritative contract:** installed `rls_can_access_customer`, `cust_select`, `inv_select`, `rct_select`, Migration 015, 015b tests, backend visibility helpers and current requirements agree that hidden/deleted customers are excluded before Finance Manager or Clerk authorization. Assignment never overrides that boundary.
- **Physical versus operational state:** physical retained state remains 179 rows with the accepted database hash. Operational policy eligibility is customers/invoices/receipts/anchors `2/7/7/5`. The two eligible-customer coverage vectors are `1/6/7/4` and `1/1/0/1`.
- **Deterministic assignment:** ordering by anchor count, invoice count, receipt count, then UUID selected customer hash `cdb24c3bfeae8c95796397752131de8f42c0c9a894d45bf87da545d512584c1b`, with exact coverage `1/6/7/4`.
- **Sanitized run:** run-ID SHA-256 `bff6dff0bdb4c8c8c2c19994d598911cde05f1d359943da0ff9fe70991732c03`; four sanitized user-ID hash prefixes: general `4081e2d9e164`, Finance `e747ab85ac7f`, assigned Clerk `c14691c802c5`, unassigned Clerk `c818a74e5b54`. Exactly four users, three roles and one assignment were created; all pre-login assertions passed.
- **Runtime:** all four logins passed. General returned `0/0/0` and role `0`. Finance returned `2/7/7`, five anchors, role `1`, out-of-company `0`, and all hidden/deleted customer/document controls `0`. Assigned Clerk returned `1/6/7`, four anchors, assigned customer `1`, outside eligible customer/documents `0`, hidden/deleted controls `0`, role/assignment `1/1`. Unassigned Clerk returned `0/0/0`, role/assignment `1/0`.
- **Cleanup:** exact assignment and roles were deleted; all four existing tokens then returned zero protected rows. Global sign-out passed, all four users were permanently deleted, four refresh attempts failed, and twelve old-token protected reads returned zero. Passwords/tokens were erased and the temporary runner directory was removed.
- **Independent postcheck:** ephemeral users/sessions/roles/assignments/temporary Storage ownership are all zero; existing identity counts/fingerprints remain `5/5/2` and unchanged; company count is one; business graph/hash/counts/totals and Storage count/hash are unchanged; former 128/922 cohorts remain zero.
- **Decision:** `B9DE-E1-002` is **CLOSED**. `B9DE-E1-004` remains **High / OPEN** and Gate E2 remains unauthorized. No RLS, grant, schema, retained-data, Storage, migration, deployment, stage, commit or push change occurred.

### 19.4 Final repeated read-only closure gate — credential incident closed; RLS blocker found

- **Date/target:** 2026-07-23, Production `kusseuycqgdilychphpq`, company `00000000-0000-0000-0000-000000000001`; local `main`/HEAD/origin/ahead/behind/staged remained exact.
- **Credential closure:** the owner attests the disclosed PAT was revoked and not reused, the dedicated ephemeral Secret key was deleted, both temporary environment variables were cleared and the bounded PowerShell session was closed. Repository/relevant-Batch scans found zero PAT/Secret/service-role/JWT/private-key/Authorization/full-synthetic-email values; no runner remains. `B9DE-E1-004` is **CLOSED**.
- **Accepted identity proof:** the corrected lifecycle and its accepted independent evidence-based closure review remain PASS; `B9DE-E1-002` stays **CLOSED**, with Auth/roles/assignments `5/5/2` and ephemeral users/sessions/roles/assignments `0/0/0/0`.
- **Fresh after-state:** anchors/hashes `10/10`, graph `179`, exact database/Storage hashes, business counts and exact monetary totals match; deletion-manifest, former 128/922 and approved Storage-delete populations remain zero. Raw document difference is `3 / 1701.00`, fully explained as Draft `2 / 1700.00` plus Cancelled `1 / 1.00`; raw receipt difference is Bounced `1 / 1.00`; unexplained document/receipt differences are both `0 / 0.00`. All allocation, journal, reversal, rate/base/FX, tenant and orphan anomaly counts are zero.
- **RLS result:** 20 reviewed AR tables have RLS and policies; the three customer/document SELECT policies and `rls_can_access_customer` retain the accepted hidden/deleted and assignment contract, with unchanged function hash. However, `public.user_roles` has policy `Temp Allow All`, applied to `authenticated` for `SELECT` with `USING (true)`, and `authenticated` has table SELECT. Unconditional policy count is therefore `1`, not `0`. New finding `B9DE-E1-005` is **High / OPEN**.
- **Migration/readiness:** Migration 027 remains `MISSING`: all six routines absent, catalog conflicts zero, required columns present and data-assumption violations zero. Four Batch 9D-D Phase A files remain byte-identical to HEAD; the candidate contract passes `12/12`; `/allocations/auto` remains disabled.
- **Decision:** `B9DE-E1-004` closes, but the new High finding prevents whole-gate closure. `B9DE-E1-001` remains open by the whole-gate rule. Gate 9D-E1 remains **NO-GO** and Gate 9D-E2 remains unauthorized. No Production mutation, Auth action, Storage write, migration, deployment, stage, commit or push occurred.

### 19.5 `B9DE-E1-005` bounded RLS remediation and final whole-gate closure — PASS

- **Contract and mode:** Migration 006 and current server/frontend access patterns make `ur_select` the
  authoritative self-or-active-same-company role visibility policy. Mode A removed only
  `public.user_roles."Temp Allow All"`; no replacement or new authorization semantic was introduced.
- **Operator:** one short transaction, local timeouts, transaction advisory lock, exact legacy signature,
  RLS/grant/source-policy guards and before/after policy/grant/helper fingerprints. Catalog drift raises
  and rolls back; a remediated rerun is assertion-only.
- **Local proof:** operator contract `9/9`, Deno format/check PASS. The operator contains no row DML,
  replacement policy, grant change, RLS toggle, other-policy action or wildcard drop.
- **Runtime proof:** rollback-only candidate and installed-state `authenticated` exact-set comparisons
  passed for all five existing identities. Each active member matched the five-row same-company source
  scope; a random user and every random-company predicate returned zero.
- **Catalog after-state:** target `0`; reviewed/enabled/with-policy `20/20/20`; unconditional exposed
  SELECT/write `0/0`; core policy/helper calls `3/3`; `rls_can_access_customer` and all other policy,
  grant and helper fingerprints unchanged.
- **Immutable state:** anchors/hashes `10/10`, graph `179`, exact database and six-object Storage hashes,
  exact monetary totals, unexplained mismatch `0/0.00`, financial/orphan anomalies zero, identity
  companies/Auth/roles/assignments `1/5/5/2`, ephemeral residue `0/0/0/0`, former cohorts `0/0`.
- **Readiness:** Migration 027 remains `MISSING`, routines `0/6`, conflicts/missing columns/assumption
  violations `0/0/0`. Batch 9D-D Phase A files remain byte-identical to HEAD, candidate contract `12/12`,
  and `/allocations/auto` remains disabled.
- **Decision:** `B9DE-E1-005` is **CLOSED**; 002–004 remain CLOSED; `B9DE-E1-001` closes under the
  whole-gate rule. Gate 9D-E1 is **PASS / GO**. Gate 9D-E2 remains **NOT AUTHORIZED — requires separate
  user approval**. Migration 027, deployment, stage, commit and push were not performed.

## 20. Consolidated Gates 9D-E2, 9D-E3 and 9D-E4 execution — PASS

On 2026-07-23 the user separately authorized one end-to-end Production rollout. The immutable rollout
candidate was `c978bce5a14cc020ddbc349f7f91d08855006f2a`.

- Production inventory classified migrations 017–030 as the exact missing manifest; all were installed
  in ascending order and verified. Migration 022 produced only its expected 27-document governance
  backfill; Migration 027 installed six aggregation routines; Migration 030 retained the service-only
  allocation-candidate boundary.
- The required named Secret API key and hosted key dictionaries resolved without exposing values. All 16
  approved Edge Functions are active from the rollout candidate. `daily-overdue` fails closed and has no
  Production cron job.
- The locked MAS provider completed manual and scheduler-path sync verification. Exactly one approved FX
  scheduler is active at the locked cadence; no conflicting job exists.
- `origin/main` and Vercel Production received the rollout candidate. Vercel deployment
  `dpl_J3g9cnk6LWPs6VgumHi6zqMnixWr` reached `READY` from the exact rollout SHA.
- A later push receipt exposed dependency advisories. Historical recovery
  `ab652d57943f9be63c5f3c1d4d21dbb1cfe3ed05` upgraded the Next.js patch line and produced healthy
  Vercel deployment `dpl_G8BMC3UMatggS6Y79WfzgiiBBCyV`, but its `postcss 8.5.10` override remained
  vulnerable. Its audit-zero statement was incorrect and is superseded by the Rev 4.1 remediation
  checkpoint below.
- A fresh four-identity Production run passed the corrected backend/RLS matrix and deployed-frontend
  route matrix. Exact cleanup left Auth/users/roles/assignments `5/5/2`, ephemeral residue zero, refresh
  reuse zero and old-token protected access zero.
- Final graph/count/`NUMERIC`/relationship certification passed; Storage remains six objects with the
  accepted hash; RLS remains `20/20/20` with unconditional SELECT/write `0/0`; automatic allocation
  remains disabled.

### Rev 4.1 PostCSS independent-review remediation checkpoint — 2026-07-24

Independent review reproduced `2 High` findings for `GHSA-6g55-p6wh-862q`; the Rev 4.0 recovery's
`next -> postcss 8.5.10` override was vulnerable, so its audit-zero statement was incorrect. Preferred
Mode A (remove only the override) resolved Next to vulnerable `8.4.31` and was rejected. Mode B pins only
Next's child to compatible `8.5.19`, retains Next `15.5.21` and Sharp `0.35.0`, and leaves all other
PostCSS paths at `8.5.22`.

Lockfile-only and installed-tree audits now report zero at every severity. Lint, type-check, `28/28` test
files, `530/530` tests and Production build pass. No backend, database, migration, RLS, Edge Function,
secret, provider, scheduler, Auth, Storage or business-data operation is part of this remediation. The
exact remediation commit and healthy Vercel Production deployment will be appended as final sanitized
evidence before the independent remediation closure review.

The pre-Migration-022 full-row hash is retained as the verified entry fingerprint, but it is not
schema-comparable after new governance columns and the expected pointer-triggered `updated_at` changes.
The final new-schema fingerprint and all independent business invariants are recorded in
`docs/evidence/SPRINT_BATCH_9D_E_CONSOLIDATED_PRODUCTION_ROLLOUT_EVIDENCE.md`.

**Current decision:** Gates 9D-E2, 9D-E3 and 9D-E4 were executed and remain technically deployed.
Production remains deployed; the frontend dependency remediation is locally complete and pending its
authorized Production redeployment. Batch 9D awaits only the final independent remediation closure
review after that deployment is verified. No new feature batch begins automatically.
