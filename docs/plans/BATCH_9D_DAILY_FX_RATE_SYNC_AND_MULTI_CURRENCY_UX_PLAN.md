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
- **Current gate state (2026-07-18):** Migration 030 and `GET /allocations/candidates` are installed,
  deployed and runtime-verified in the explicitly approved staging project only. During that gate an
  enabled privileged legacy staging service-role key was exposed by malformed output redaction. It was
  treated as compromised: all 16 affected Edge consumers were migrated to hosted named secret and
  publishable key dictionaries, the legacy anon/service-role pair was disabled and proven rejected,
  and the complete affected runtime matrix passed. A subsequent independent review found that
  `daily-overdue` still failed open when its separate `CRON_SECRET` server configuration was absent.
  That custom-auth boundary is now fail closed before admin-client creation, uses constant-time
  comparison, has 12 permanent focused tests, and is deployed/runtime-verified as staging v6. The
  approved staging project had no `CRON_SECRET`, so one staging-only value was configured without
  repository/output exposure. There is no `daily-overdue` cron job to rewire; the Batch 9D-B FX job
  remains unchanged. No credential value is retained in this plan.
  See the authoritative current-state block in Section 0.0. Batch 9D-A is CLOSED, DG-1 is FORMALLY APPROVED
  AND LOCKED, Batch 9D-B is **OFFICIALLY CLOSED**, and Batch 9D-C is **OFFICIALLY CLOSED** (Codex Batch 9D-C
  Closure Re-Review: `PASS  -  BATCH 9D-C CLOSURE RE-REVIEW PASSED`; closed at staging-verification level;
  production rollout reserved for Batch 9D-E). Batch 9D-D (Multi-Currency UX and Monetary Aggregation
  Correctness) has its **backend and staging scope CLOSED (PASS)** at baseline `d5c9c0a`
  (`fix(ar): close Batch 9D-D staging runtime defects`; migrations 027-029 applied + verified in staging),
  and its **frontend Multi-Currency UX IMPLEMENTED** in the consolidated frontend gate  -  **subject to
  independent Codex frontend/backend integration review** (not review-passed). Commit and push remain
  pending separate authorization after review; production rollout reserved for Batch 9D-E.
  - *(Historical, 2026-07-07: the then-remaining flow was Codex DG-1 Lock Confirmation Review → 9D-B
    detailed implementation planning → 9D-B implementation approval → 9D-B implementation; all of these
    have since occurred. Earlier still, the Rev 2 gate was "Codex Batch 9D Plan Amendment Review → user
    approval → DG-1 locked → 9D-B implementation"; the amendment review and DG-1 lock are complete.)*

> This document is planning and discovery only. No backend/frontend code was changed, no migration was
> created, no schema was modified, no Edge Function was deployed, no cron/provider credential was
> configured, no external FX provider was called, and neither staging nor production was mutated while
> producing it. **Daily FX Sync is NOT live in production.** Provider reference rates do **NOT**
> automatically become booking rates. A latest/reference conversion is **NOT** accounting-authoritative.
> Frankfurter/MAS is a **formally approved and LOCKED DG-1 decision** (see §0.3). *(Historical note: this
> banner describes the planning/authoring context of this document. Batch 9D-B has since been implemented
> and staging-verified (PASS) under approved staging scope — see the authoritative current-state block in
> §0.0. Production remains untouched.)*
> Batch 9D-A (provider-neutral foundation) is officially closed; **§0 supersedes the earlier execution
> ordering** in §13 and §20 where they differ.

---

## 0. Rev 2 Post-9D-A Closure Amendment (Provider Decision & Execution Order) — AUTHORITATIVE

> This section is the **current authoritative** statement of Batch 9D-A closure, the revised execution
> order, and the proposed DG-1 provider decision. Where it differs from the earlier ordering in §13 and
> §20, **§0 governs** and the earlier ordering is marked superseded. Earlier content is retained for
> history and is **not** erased.

### 0.0 AUTHORITATIVE CURRENT STATE (updated 2026-07-20 - Batch 9D-D source implementation, local validation, Migration 030 staging runtime, allocations candidate route staging runtime, credential remediation, daily-overdue fail-closed remediation, Codex self-validation, Claude independent source review, and Claude independent staging closure confirmation are PASS. No Critical or High finding remains. The sole Medium documentation undercount is corrected to exactly three controlled `0.01` records, all `Reversed` with reversal timestamp, reason, and actor; zero active gate allocation remains and financial arithmetic reconciles. Production and Batch 9D-E are NOT STARTED. Frontend production deployment is NOT AUTHORIZED. Commit is NOT YET AUTHORIZED; push is NOT AUTHORIZED because GitHub main may trigger a Vercel production deployment.)

> **This block is the single authoritative current-state statement for Batch 9D and supersedes any
> "9D-B not yet implemented / pending plan review / implementation approval not granted" wording elsewhere
> in this document, which is retained only as clearly labeled Historical / Superseded record.**
>
> | Item | Current status |
> | --- | --- |
> | Batch 9D-A | **OFFICIALLY CLOSED** |
> | DG-1 (provider decision) | **FORMALLY APPROVED AND LOCKED** |
> | Batch 9D-B | **OFFICIALLY CLOSED** (Codex Closure Re-Review: `PASS — OFFICIAL CLOSURE`) |
> | Batch 9D-C | **OFFICIALLY CLOSED** (Codex Closure Re-Review: `PASS — BATCH 9D-C CLOSURE RE-REVIEW PASSED`; closed at staging-verification level; migrations 022-026 applied+verified; RT-01..RT-19 complete; cleanup complete; no production action) |
> | Batch 9D-D history | **The following long row is a pre-FNC historical snapshot. Its pending-Codex status, validation counts, and five-dimension lifecycle description are superseded by the current FNC correction immediately after it.** |
> | Batch 9D-D | **BACKEND/STAGING BASELINE THROUGH MIGRATION 029 CLOSED (PASS); FINAL CLOSURE DELTA (PHASE A SOURCE-LEVEL BACKEND + PHASE B FRONTEND) IMPLEMENTED LOCALLY - PENDING ONE FINAL INDEPENDENT CODEX CONSOLIDATED SOURCE-LEVEL REVIEW** (baseline `d5c9c0a` `fix(ar): close Batch 9D-D staging runtime defects`; migrations 027-029 applied + verified in staging. The frontend passed through multiple implementation, independent review and remediation cycles: (1) FE/BE integration - 13 findings B9DD-FEIR-001 ... B9DD-FEIR-013; (2) remediation re-review - 7 findings B9DD-RR-001 ... B9DD-RR-007; (3) focused re-review - **CLOSED B9DD-RR-001 (Aging pagination) and B9DD-RR-003 (form currency/MYR)**, returned 6 findings B9DD-FR-001 ... B9DD-FR-006; (4) delta re-review - **CLOSED B9DD-FR-001 (customer placeholder state), B9DD-FR-003 (real OCR composition) and B9DD-FR-005 (credit_rating coverage)** and returned 3 findings B9DD-DR-001 ... B9DD-DR-003 (the allocation candidate scan was still not fail-closed under mutable offset pagination - it overwrote the collection total each page and accepted short/empty pages, so a shrinking collection returned success while skipping invoices that appeared on no page, and the page discarded the error so instability rendered as "no outstanding invoices"; the monetary guard's hand-rolled comment stripper did not model regex literals and could DELETE real code, an UNDER-scan/false-negative; documentation overstated both). B9DD-DR-001 ... B9DD-DR-003 were remediated; the micro-delta review then concluded that the frontend-only OFFSET scan could DETECT instability but never PROVE coverage; and the consolidated source-level review that followed ACCEPTED Phase A and returned four frontend findings, B9DD-CDR-001 ... B9DD-CDR-004 (the candidate parser applied the six-code NEW-WRITE currency list to an existing-document READ contract, so a legacy JPY receipt would have been impossible to allocate; allocation actions still hung off a RENDER-TIME verification boolean that a captured callback could carry into the window after the query cache had moved but before React re-rendered; the monetary AST guard still missed nullish/logical fallbacks, destructuring, aliases, callback-local variables, accumulator assignment, reduceRight and JSX static text; and the evidence contained contradictory or overstated statements). All four were remediated; the focused re-review that followed then returned four further findings, B9DD-CRR-001 ... B9DD-CRR-004 (the live authorization binding was CONTENT-based, so a BYTE-IDENTICAL background refetch settled a new authoritative generation whose content compared EQUAL and silently RE-AUTHORIZED stale callbacks before React rebound - reproduced, with `dataUpdateCount` 1 -> 2, the same data reference retained by structural sharing, and a stale payload buildable; the receipt A -> B selection handler scheduled state without SYNCHRONOUSLY revoking authority, so receipt A's captured callbacks stayed authorized inside the selection event itself; the monetary AST guard missed RETURNED accumulator assignments (`return (sum += row.outstanding)`), which were inside its own documented callback-local scope; and the evidence still carried an active present-tense OFFSET section asserting that only mutable offset pagination existed and that a backend fix was unactioned future work - a world Phase A had already replaced). All four were remediated; the focused re-review that followed then returned two further findings, B9DD-FRR-001 ... B9DD-FRR-002 (the React rebind effect observed `dataUpdatedAt`, a MILLISECOND timestamp, so two successful byte-identical reads completing in the same millisecond were invisible to it - `dataUpdateCount` advanced 1 -> 2 while structural sharing preserved the data reference, the fingerprint and the timestamp, so the effect never re-ran, the workbench stayed bound to the OLD generation, invocation-time authorization then denied every action FOREVER, and the stale `canSubmit` memo still rendered the Confirm button enabled - a permanently bricked workbench; and the documentation asserted that `dataUpdatedAt` 'defeats structural sharing' and made 'every authoritative read rebind', which was false). SAFETY had held throughout; LIVENESS had not. Both were remediated; the consolidated review that followed then returned four further findings, B9DD-FDR-001 ... B9DD-FDR-004 - including one PRODUCTION-REACHABLE tenant defect: the candidate Query key was receipt-only, so switching company via the header's real `setCompany` path left Company A's cached candidate contract displayed and locally actionable under Company B (no refetch, `boundCustomerName: "Company A"`, `canSubmit: true`); `dataUpdateCount` was treated as globally collision-free when it is monotonic only WITHIN one Query instance, so a removed-and-recreated Query with identical count/timestamp/content revived an old binding; old callbacks read the newest mutable bound ref and could pass under a LATER binding while acting on their own captured rows; and the Confirm button could paint ENABLED while every action denied. All four were remediated; a further review then returned B9DD-FCR-001 ... B9DD-FCR-003 (a permanent regression was missing for `resetQueries()`, which reuses the SAME Query object so the WeakMap epoch does NOT change and every token field can repeat - safety there rests on the reset/pending revision, layout revocation and binding-session rollover, not the epoch; React lifecycle warnings were still present under `--reporter=verbose` (39 act, 23 act-environment, 3 setState-in-render) and an earlier gate had wrongly reported them clean because it read the default reporter and used a pattern React's interpolated component name could never match; and the documentation overstated epoch/HMR/layout/warning coverage). All three are now remediated in place. Allocation authority binds FIVE dimensions - current company, Query INSTANCE epoch (a WeakMap keyed on the public Query object), Query generation, contract content, and the local binding SESSION a callback was created in - compared in that order; the candidate Query key is company-scoped; the current tenant is read from the store at INVOCATION time; the rebind is driven by a collision-free QueryCache revision built on the public `dataUpdateCount`, observed via `useSyncExternalStore` over the public `queryClient.getQueryCache().subscribe(...)`, and now runs in the LAYOUT phase so no enabled-but-inert control paints. The remedy is the **Final Closure Delta**: **Phase A** adds Migration 030 `public.get_allocation_candidates(...)` (STABLE, SECURITY DEFINER, `search_path = ''`, service_role-only, read-only, non-paginated, capped at 5,000, deterministically ordered by due_date/invoice_no/id) exposed as `GET /allocations/candidates`, returning ONE complete candidate set from ONE PostgreSQL statement snapshot; **Phase B** consumes it, DELETES the OFFSET scan with no fallback, validates the contract client-side with Zod (accepting any `^[A-Z]{3}$` code, matching the backend's existing-document READ boundary rather than its NEW-WRITE list), binds the workbench to the governed receipt, and clears all candidate/allocation state unless the contract is currently verified. Every mutating action, `buildPayload` and submission re-verify against the LIVE TanStack query cache at INVOCATION time (default-deny). Authority binds BOTH the contract content fingerprint AND the authoritative query fetch generation (`dataUpdateCount` + `dataUpdatedAt`, from the public `QueryState` shape), so a stale callback is denied during a refetch in flight, after a failed refetch that retains data, before a changed-content rebind, AND before a BYTE-IDENTICAL-content rebind (which content comparison alone cannot see). Receipt-ID transitions revoke authority SYNCHRONOUSLY before scheduling the new selection, closing the pre-commit window that no cache check can close. Separately from that invocation-time SAFETY, React rebind LIVENESS is driven by a collision-free QueryCache revision (`dataUpdateCount`, never `dataUpdatedAt` alone), so a byte-identical refetch settling in the SAME millisecond still rebinds, clears the previous generation's lines and restores actionability - proven by a deterministic test that freezes `Date.now`. The monetary guard becomes a bounded AST dataflow analysis over `reduce`/`reduceRight` (parameter binding, destructuring/aliasing, callback-local taint, fallbacks, accumulator updates and RETURNED accumulator assignments) plus JSX static text, with its non-interprocedural boundary documented and asserted. **Migration 030 is NOT applied to staging or production; the allocations Edge Function is NOT deployed; PostgreSQL runtime behaviour for Migration 030 is NOT proven; staging has NOT verified the route.** B9DD-RR-008 is informational local `node_modules` state only and required no tracked-file change. Local validation: 28 test files / 526 tests, 0 failed, 0 skipped (verbose reporter: zero React lifecycle warnings); TypeScript, ESLint and the production build (26 application routes) all pass; npm audit 0 high / 0 critical; `deno check` passes and the Phase A source-contract test passes 12/12 via the existing non-install `--no-check` path. **Not** review-passed; **not** closed; commit/push **not authorized** (GitHub main may trigger a Vercel production deploy)); Multi-Currency UX and Monetary Aggregation Correctness; reviewed plan `docs/plans/BATCH_9D_D_MULTI_CURRENCY_UX_AND_AGGREGATION_CORRECTNESS_PLAN.md`; frontend evidence `docs/evidence/SPRINT_BATCH_9D_D_MULTI_CURRENCY_UX_AND_MONETARY_AGGREGATION_EVIDENCE.md` |
> **Final FNC lifecycle and gate-status correction (CURRENT; supersedes the pending-Codex status,
> validation counts, and lifecycle/reset/warning wording in the long Batch 9D-D history row above):** allocation authority now binds six independent dimensions:
> current company, Query-object epoch, a synchronous per-company/receipt QueryCache lifecycle epoch,
> QueryState generation, contract content, and local callback binding session. `resetQueries()` keeps
> the same Query object and may repeat its final count/timestamp/content; matching QueryCache events
> therefore advance the lifecycle epoch synchronously before `notifyManager.batchCalls` schedules the
> React notification. Invocation-time checks deny immediately, and layout rebind rolls the session
> before paint. Fast Refresh may preserve hook state while module trackers reset, so safety fails
> closed on mismatches and does not assume HMR destroys bindings. Testing Library 16.3.2 already
> configures the React act environment and cleanup; warning remediation is attributed to correct
> `act`/`waitFor` boundaries, removal of invalid probes, and safe QueryCache-to-React scheduling - not
> to an allegedly absent global flag. See evidence Section 3.12.
> Final local validation for this Codex implementation: **28 test files / 530 tests, 0 failed, 0
> skipped; 26 application routes; verbose React warning scan zero; TypeScript, ESLint, and build
> pass; npm audit remains 3 moderate overall / 2 moderate production with 0 high / 0 critical.**
> Pre-credential-remediation worktree at that validation: **58 modified tracked files, 53 untracked
> files, staged 0; tracked diff 5,991 insertions / 1,202 deletions.**
>
> **Staging credential incident correction (CURRENT; supersedes all source-only/unapplied status in
> the historical row):** Migration 030 and the candidate route are staging-installed/deployed and
> runtime-verified. A privileged legacy staging service-role key exposed by malformed output redaction
> was treated as compromised. The 16 Edge Functions sharing `_shared/db.ts` were migrated to a named
> modern server secret plus the hosted default publishable-key dictionary, then redeployed to staging
> only. The legacy anon/service-role pair is disabled and both keys return 401. Replacement-backed
> candidate, manual-allocation, tenant/Clerk, all affected user/read routes, scheduler and disabled-auto
> checks pass. The Batch 9D-B scheduler retained its separate credential and schedule. No JWT signing
> rotation, Vault change, production action, commit, or push occurred.
> Final credential-remediation worktree: **60 modified tracked files, 54 untracked files, staged 0;
> tracked diff 6,060 insertions / 1,231 deletions.** Local frontend validation remains **28 files /
> 530 tests**, with 0 failed, 0 skipped, 26 application routes and zero verbose lifecycle warnings.
>
> **Daily-overdue security correction (CURRENT; supersedes the historical fail-open pattern and the
> credential-gate record that treated it as accepted):** `daily-overdue` remains `verify_jwt=false`
> because its function-level boundary now fails closed before any admin client or privileged query.
> Missing/blank server configuration returns a sanitized 500; missing/blank/incorrect callers return
> sanitized 401; the supplied value is checked with the accepted constant-time helper. Twelve permanent
> tests and two mutation checks prove the configuration, comparison, zero-privileged-call, ordering and
> response invariants. Staging lacked `CRON_SECRET`, so one staging-only secret was configured and only
> `daily-overdue` was explicitly deployed (v6, ACTIVE). Missing/empty/incorrect/anonymous/ordinary-user
> calls return 401; the correct caller returns 200. The bounded positive invocation moved exactly three
> pre-counted invoices to `Overdue`, held no customer, wrote no customer/credit logs, and is idempotent.
> No `daily-overdue` cron job exists; the separate Batch 9D-B FX job and schedule are unchanged.
> Exactly three controlled `0.01` allocation records remain as reversed audit history:
> `B9DD runtime gate emergency cleanup`, `B9DD staging runtime negative-matrix reversal`, and
> `Batch 9D-D credential rotation regression reversal`. All three are `Reversed` with reversal timestamp, reason, and actor;
> no active `0.01` gate allocation remains and the associated receipt/invoice arithmetic reconciles.
> `frontend/.env.local` still resolves to production, was not edited or used for network traffic, and
> must be replaced by an explicitly configured staging frontend environment before interactive local
> staging UI tests. Claude Code subsequently completed its separately configured independent read-only
> staging confirmation with `PASS - INDEPENDENT STAGING CLOSURE CONFIRMATION COMPLETE`.
> Final daily-overdue-remediation worktree: **62 modified tracked files, 56 untracked files, staged 0;
> tracked diff 6,225 insertions / 1,313 deletions.**
> Final closure-documentation worktree contains **62 modified tracked files and 74 untracked files:
> 56 Batch 9D-D files plus 18 unrelated `social-media/` files that are excluded from the proposed Batch
> commit; tracked diff 6,231 insertions / 1,313 deletions; staged 0**.
>
> | Batch 9D-E | **NOT STARTED** (owns production rollout) |
>
> **Current staging gate state (authoritative):** Migration 030 and the allocations candidate route are
> installed/deployed and runtime-verified in the approved staging project only. The credential incident
> discovered during that gate is remediated: an exposed privileged legacy staging service-role key was
> replaced for every affected Edge consumer, the legacy anon/service-role pair is disabled and rejected,
> and replacement-backed candidate, manual-allocation, tenant/Clerk, scheduler and disabled-auto paths
> pass. The `daily-overdue` custom-auth follow-up is also deployed and runtime-verified fail closed; its
> staging secret is present, its negative/positive matrix passes, and no daily-overdue cron invocation
> exists. Exactly three controlled `0.01` allocation records remain in `Reversed` audit state with
> reversal timestamp, reason, and actor; no active gate allocation remains and receipt/invoice arithmetic
> reconciles. Claude independent staging closure confirmation is **PASS**. Batch 9D-C remains closed at
> staging-verification level. The first frontend attempt **FAILED** the
> independent Codex frontend/backend integration review (13 confirmed findings: list row/summary scope;
> reports capped at 100 rows; missing Customer Statement UI; allocation-history and receipt-exposure
> cross-currency defects; residual MYR defaults; undirected FX presentation; missing import/OCR governance;
> contract requiredness mismatch; missing integration tests; lint not configured; vulnerable test stack;
> inaccurate evidence). **All 13 have been remediated in the uncommitted worktree**. One **backend contract limitation was
> recorded, not modified** (`v_customer_credit_utilization` sums outstanding across currencies without FX
> normalization  -  the frontend routes around it via `ar_aging_by_customer`). Commit and push are **not yet
> approved**. No production action has occurred; production rollout remains **NOT STARTED**, reserved for
> Batch 9D-E. 9D-C evidence:
> `docs/evidence/SPRINT_BATCH_9D_C_BOOKING_RATE_PROVENANCE_AND_OVERRIDE_GOVERNANCE_IMPLEMENTATION_EVIDENCE.md`.
>
> The 9D-B staging scheduler **remains ACTIVE and unchanged** for continued staging observation under approved staging
> scope. **No production deployment, no production provider call, no production scheduler activation, and
> no production mutation occurred.** Canonical execution order is unchanged:
> `9D-A (CLOSED) → DG-1 → 9D-B (CLOSED) → 9D-C (CLOSED) → 9D-D → 9D-E` (§0.2).

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

This original ordering is **retained for history** and is **superseded by the revised canonical order below** (§0.2).

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

### 0.3 DG-1 — Formal FX Provider Decision (FORMALLY APPROVED AND LOCKED)

> **Status: FORMALLY APPROVED BY THE USER AND LOCKED (2026-07-07).** The provider decision below is now
> the authoritative, locked DG-1 outcome. *(Historical, as at the 2026-07-07 lock: DG-1 was then **NOT
> implemented** — no backend code, migration, or Edge Function had been written for it, no scheduler/cron
> was configured, and **no provider API had been called** — and the lock authorized detailed 9D-B
> implementation planning only.)* Batch 9D-B has since been implemented and staging-verified (PASS) under
> approved staging scope; see the authoritative current-state block in §0.0. Production remains untouched.
>
> **History (preserved):** DG-1 was previously recorded here as **PROPOSED — pending Codex review and
> user approval** (Rev 2 amendment). The Codex Batch 9D Plan Amendment Review returned **PASS WITH
> REQUIRED DOCUMENTATION CORRECTIONS**, the corrections were applied (commit `ee976a2`), and the user then
> gave **explicit formal approval** of the decision below. This section is now upgraded from PROPOSED to
> LOCKED; the earlier proposed/pending status is retained above for historical accuracy.
>
> **Authoritative current state (see §0.0):** Batch 9D-A — **OFFICIALLY CLOSED**; DG-1 — **FORMALLY
> APPROVED AND LOCKED**; Batch 9D-B — **OFFICIALLY CLOSED** (Codex Closure Re-Review `PASS — OFFICIAL
> CLOSURE`); Batch 9D-C — **OFFICIALLY CLOSED** (Codex Closure Re-Review `PASS — BATCH 9D-C CLOSURE
> RE-REVIEW PASSED`; closed at staging-verification level; production reserved for 9D-E); Batch 9D-D —
> **MIGRATIONS THROUGH 030 AND THE ALLOCATIONS CANDIDATE ROUTE ARE INSTALLED/DEPLOYED AND RUNTIME-VERIFIED
> IN THE APPROVED STAGING PROJECT; THE LEGACY STAGING API-KEY INCIDENT IS REMEDIATED** (baseline `d5c9c0a`; migrations 027-029 applied + verified in staging; the
> first frontend attempt failed the independent FE/BE integration review and findings
> B9DD-FEIR-001 ... B9DD-FEIR-013 were remediated; that remediation FAILED the re-review, producing
> B9DD-RR-001 ... B9DD-RR-007; those were remediated, and the focused re-review CLOSED B9DD-RR-001
> and B9DD-RR-003 but returned B9DD-FR-001 ... B9DD-FR-006; those were remediated, and the delta
> re-review CLOSED B9DD-FR-001/FR-003/FR-005 but returned B9DD-DR-001 ... B9DD-DR-003; those were
> remediated, and the micro-delta review then concluded the frontend-only OFFSET scan could not
> prove coverage - so the Final Closure Delta adds a governed backend candidate contract
> (Phase A, Migration 030, now staging-installed/verified) and its frontend consumption (Phase B).
> All affected Edge consumers now use modern named key dictionaries; the compromised legacy pair is
> disabled and rejected. Commit/push remain **not authorized**; production remains untouched).

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

> **Detailed sub-plan (documentation-only pointer):** the implementation-ready 9D-B plan lives in
> `docs/plans/BATCH_9D_B_REAL_PROVIDER_INTEGRATION_AND_SCHEDULER_STAGING_PLAN.md` (adapter design,
> provider-contract verification, scheduler design, file-level change map, expanded mandatory runtime
> matrix). Batch 9D-B is now **OFFICIALLY CLOSED** (Codex Closure Re-Review `PASS — OFFICIAL CLOSURE`).
> This master section remains the authoritative scope/order summary.

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

> **Detailed sub-plan (documentation-only pointer):** the implementation-ready 9D-C plan lives in
> `docs/plans/BATCH_9D_C_BOOKING_RATE_PROVENANCE_AND_OVERRIDE_GOVERNANCE_PLAN.md` (current-system
> discovery, booking-source model, provenance model, override/approval governance, deviation policy,
> immutability + governed post-posting correction, allocation/import/automation compatibility, data-model
> options with a recommended hybrid, API/RPC + RLS + concurrency design, migration direction from `022`,
> testing + mandatory staging matrix). The plan was fully amended and confirmed, then implemented; Batch
> 9D-C has since **completed staging runtime verification (PASS)** with migrations 022-026 applied+verified
> and evidence consolidated, and is now **OFFICIALLY CLOSED** at staging-verification level (Codex Batch
> 9D-C Closure Re-Review: `PASS`). Batch 9D-D backend and staging scope are now **CLOSED (PASS)** (baseline
> `d5c9c0a` `fix(ar): close Batch 9D-D staging runtime defects`; migrations 027-029 applied + verified in
> staging), and the Batch 9D-D **frontend Multi-Currency UX**  -  implemented in the consolidated
> frontend gate, then **failed** the independent Codex FE/BE integration review  -  has been
> **remediated in place** against findings B9DD-FEIR-001 ... B9DD-FEIR-013; then, after the
> remediation re-review also failed, against B9DD-RR-001 ... B9DD-RR-007; then, after the focused
> re-review, against B9DD-FR-001 ... B9DD-FR-006; then, after the delta re-review, against
> B9DD-DR-001 ... B9DD-DR-003; then, after the micro-delta review, via the Final Closure Delta
> (Phase A governed candidate contract, source-level only + Phase B frontend consumption); and
> finally, after the consolidated source-level review ACCEPTED Phase A, against
> B9DD-CDR-001 ... B9DD-CDR-004; and finally, after the focused source-level re-review, against
> B9DD-CRR-001 ... B9DD-CRR-004; and finally, after the focused re-review, against
> B9DD-FRR-001 ... B9DD-FRR-002; and finally, after the consolidated review, against
> B9DD-FDR-001 ... B9DD-FDR-004; and finally, after the closure review, against
> B9DD-FCR-001 ... B9DD-FCR-003 (frontend evidence
> `docs/evidence/SPRINT_BATCH_9D_D_MULTI_CURRENCY_UX_AND_MONETARY_AGGREGATION_EVIDENCE.md`); Migration 030
> and the governed candidate route are now staging-installed/deployed/runtime-verified, and the
> privileged legacy staging-key exposure is remediated with the legacy pair disabled and rejected.
> Commit/push remain **not approved**; production rollout remains **NOT STARTED**, reserved for Batch 9D-E. This master section
> remains the authoritative scope/order summary.

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
  `reports/service.ts`, `imports/service.ts`, `daily-overdue/auth.ts`, `daily-overdue/index.ts`, `_shared/constants.ts`,
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

> **Lock update (2026-07-07):** DG-1 is now **FORMALLY APPROVED BY THE USER AND LOCKED** — **Frankfurter
> v2** transport, mandatory explicit provider pinning, **initial provider `MAS`**, no API key expected,
> reference-only destination (see the authoritative record in **§0.3** and the current-state block in
> **§0.0**). *(Historical at the 2026-07-07 lock: DG-1 was then not implemented and no provider API had
> been called, and the lock authorized 9D-B detailed implementation planning only.)* Batch 9D-B has since
> been implemented and staging-verified (PASS); the staging MAS provider was called under approved staging
> scope, while **no production provider call occurred**. The historical Rev 2 note below is retained for
> accuracy.
>
> **Rev 2 update (historical — now superseded by the lock above):** a **proposed** DG-1 decision existed
> in **§0.3** — **Frankfurter v2** transport with mandatory explicit provider pinning, **initial provider
> `MAS`**, no API key expected, reference-only destination. It was **PROPOSED pending Codex review and
> user approval — not locked, not implemented, and no provider API called.** The evaluation criteria below
> still document how that decision was reached.

**DG-1 remains a dedicated gate before 9D-B.** As of 2026-07-07 the DG-1 provider decision is now
**formally approved and LOCKED** (Frankfurter v2 / initial provider `MAS`; authoritative record in §0.3).
The decision is locked; Batch 9D-B has since been implemented, staging-verified (PASS), and is now
**OFFICIALLY CLOSED** (Codex Closure Re-Review `PASS — OFFICIAL CLOSURE`; see §0.0). *(Historical
at the 2026-07-07 lock: the decision was then not implemented and no provider API had been called; and at
the earlier Rev 2 amendment it was still proposed and pending approval, with no provider decision formally
locked in that amendment.)*

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
  `reports/service.ts:218,303`, `imports/service.ts` (no FX handling), `daily-overdue/auth.ts`,
  `daily-overdue/index.ts`,
  `_shared/constants.ts:95-98`, `_shared/validators.ts:159`.
- Frontend: `lib/utils.ts:12-28`, `app/(dashboard)/invoices/[id]/page.tsx:204,308-311`,
  `stores/company-store.ts:29`.

## Appendix B — Scope boundary (one line)

Batch 9D delivers **provider-neutral daily FX reference-rate infrastructure, booking-rate override
governance, and multi-currency visibility + aggregation correctness**; it is **not** an FX revaluation
engine, it does **not** change any booked rate or existing FX accounting, and in 9D-A it does **not**
write `exchange_rates` or auto-promote reference rates.
