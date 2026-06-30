# Batch 9 — Roadmap and Implementation Sequence

**Project:** GenAI-assisted Accounts Receivable (AR) module for a Singapore company (Final Year Project)

**Document type:** Planning / roadmap only — no implementation

**Planning date:** 2026-07-01

**Baseline commit:** `f3c631d docs(evidence): record pre-Batch 9 cleanup baseline audit`

> **Status of this document.** This is a planning artifact only. It does **not** authorize any code
> change, migration, deployment, fixture run, or data mutation. Each batch below requires its own
> plan → Codex pre-review → implementation → Codex post-review → evidence cycle and explicit user
> approval before work begins.

---

## 1. Current baseline summary

| Item | State |
|---|---|
| Production rollout | Usable / FYP demo-ready |
| Batch 8B — Financial Mutation Boundary and Role/Visibility Hardening | **Completed** (RPC-only write boundary enforced, mutation role guards added, RLS hardened, System Admin operational read scope narrowed) |
| Batch 8F1 — Next.js security remediation | Completed, committed, pushed |
| Batch 8F2 — XLSX parser security remediation | Completed, committed, pushed |
| Batch 8D — production rollout | Completed |
| Batch 8D-Fix1 — production RLS policy cleanup | Completed |
| Pre-Batch Cleanup & System Baseline Audit | Completed, committed, pushed |
| Cleanup audit result | **PASS WITH DEFERRED CLEANUP** |
| Cleanup performed | None — no records met the safe cleanup threshold |
| Deferred work | Historical smoke/demo/financial records deferred to a separate final cleanup batch |
| Latest evidence commit | `f3c631d6d32316680d3f4239442f06548535728a` |

**Functional completeness position (from Batch 8A audit).** The core AR backend is credible:
invoice/receipt create + post, manual multi-invoice allocation, reversal RPCs, bounced-cheque
handling, CSV/XLSX import, conservative fuzzy suggestions, customer quick-create, allocation
history, tenant/customer scoping, and the live dashboard are implemented. The module is **not yet
functionally complete**. The remaining gaps map directly onto the Batch 9 batches below.

**Financial-boundary position.** **Batch 8B (plus Batch 8D-Fix1) is complete**: the financial
mutation boundary (RPC-only writes, mutation role guards, hardened RLS, narrowed System Admin read
scope) is already enforced. **No separate prerequisite backend/security batch is required before
Batch 9A or Batch 9D.** Instead, every relevant future financial batch (notably 9D, and the
financial-touching parts of 9A) must **verify that the Batch 8B boundary remains intact** rather than
re-establish it — this verification is a standing Codex safety-boundary checkpoint (see §10).

**Standing safety posture (must be preserved by every Batch 9 batch).**

- `POST /allocations/auto` returns HTTP 403 `AUTO_ALLOCATION_DISABLED` and must stay disabled.
- No direct insert into `allocation_details`.
- No direct update of `invoices.outstanding`.
- No direct update of `receipts.allocated_amount` or `receipts.unallocated_amount`.
- No direct delete of protected financial records.
- No bypass of financial RPCs (`post_invoice`, `post_receipt`, `allocate_receipt`,
  `reverse_allocation`, `handle_bounced_cheque`).
- No mock/seed dashboard data.
- No production fixtures/imports/record creation unless explicitly approval-gated.

---

## 2. Reason for renumbering from 8C–8G to 9A–9E

Previous planning informally referenced a continuing "Batch 8C–8G" sequence. Several Batch 8
identifiers (8A audit, 8D rollout, 8D-Fix1, 8F1, 8F2) are already **committed and pushed with their
own evidence documents**. Continuing to add new functional work under further "8x" labels would:

1. **Collide with existing Batch 8 evidence** — readers and Codex reviewers could not tell completed
   security/rollout work apart from new, unstarted functional work.
2. **Blur the security-vs-feature boundary** — Batch 8 became, in practice, the security and
   production-hardening series. Mixing new feature scope into it weakens the audit trail.
3. **Make the FYP narrative harder to follow** — a clean "Batch 9 = post-rollout functional
   completeness" series tells a clearer story than a sprawling Batch 8.

Renumbering to a fresh **Batch 9** series gives the remaining functional work its own clean,
non-overlapping evidence namespace while leaving all committed Batch 8 history intact.

| New label | Title | Maps to former intent |
|---|---|---|
| Batch 9A | UI/API Completeness and Placeholder Removal | former "8C" completeness work |
| Batch 9B | PDF/Image/OCR Import Intake | former "8D/8E" OCR intent |
| Batch 9C | Daily FX Rate Sync and Multi-Currency UX | former FX-sync intent |
| Batch 9D | Bank Charge Handling | former bank-charge GL intent |
| Batch 9E | Auto-Approval Policy (only if really needed) | former optional auto-approve intent |

---

## 3. Batch 9A — UI/API Completeness and Placeholder Removal

**Objective.** Make every visible surface truthful: each control either has real backend logic or is
intentionally disabled/hidden, and no placeholder/mock data masquerades as live data.

**In scope.**

- **UI/API completeness audit.** Enumerate every page, primary action, and header control; map each
  to its backing API route (or mark it as intentionally inert). Reuse the Batch 8A button inventory
  (§4) as the starting checklist.
- **Placeholder / mock removal.** Replace or remove the confirmed placeholders from the Batch 8A
  audit:
  - mock tax codes and payment terms in `use-invoices.ts` → real read-only lookup APIs (or, if the
    security batch must stay minimal, defer the API portion and disable the selectors honestly);
  - example audit-log rows in `settings/audit-log/page.tsx`;
  - static journal-entry example cards;
  - credit-notes placeholder page;
  - global search input, notification bell, and My Profile in `components/layout/header.tsx`;
  - AI sidebar placeholder shell;
  - stale "bank-account API unavailable" settings text (the GET API exists).
- **Button/action truthfulness.** Every clickable primary/header action must do one of: (a) call a
  real API, (b) be visibly disabled with a clear reason, or (c) be removed/hidden from operational
  navigation.
- **Confirm frontend cannot bypass backend.** Re-verify there is no `supabase.from(...)` or direct
  financial-table access; `createClient` remains only in `frontend/src/lib/supabase.ts` (auth/token
  use). Recommend a CI grep/lint guard.
- **Confirm no mock dashboard data.** Re-verify the dashboard is sourced only from
  `GET /reports/dashboard` and that no seed/mock metrics path exists.

**Required prerequisite / deliverable — authenticated role/context endpoint.** A real authenticated
role/context endpoint (`/auth/me` or equivalent) is a **mandatory prerequisite or in-batch
deliverable** of Batch 9A. Role-based hiding/disabling of any control may be treated as **honest
only once this endpoint exists and is the source of the current user's role**.

- If the endpoint already exists from prior work, 9A must **verify** it and wire role-gated UI to it.
- If it does not exist, 9A must **deliver** it (read-only, authenticated) before any role-specific UI
  hide/disable is shipped.
- Until the endpoint is in place, role-specific UI hiding/disabling **must not rely on demo/env
  assumptions** (e.g. `NEXT_PUBLIC_DEMO_USER_ROLE`). In that interim, role-gated controls must be
  conservatively disabled/hidden rather than shown/hidden based on an unauthenticated env value.

**Out of scope.** New financial mutations; any change to the Batch 8B mutation boundary; reverse-
allocation / bounce frontend actions (these depend on the role endpoint above and are sequenced once
it is in place).

---

## 4. Batch 9B — PDF/Image/OCR Import Intake

**Objective.** Add a user-facing intake path for PDF/image documents that extracts data into the
**existing review queue** — never directly into posted financial records.

**In scope.**

- **Upload intake flow.** Accept PDF/image file types in addition to CSV/XLSX, with explicit file
  validation (type, size, and malware/safety checks) before any processing.
- **Parse/extract path.** OCR/extraction (GenAI or OCR engine) produces structured candidate rows
  with **per-field extraction confidence** and a retained source reference.
- **Review queue path.** Extracted rows enter the same human-review flow used by fuzzy import
  (`review_required` → approve / edit / retry). Low-confidence fields are flagged for review.
- **No unsafe auto-posting.** Extraction never auto-posts or auto-allocates. It may only feed the
  **existing** guarded draft-creation / review flow. Receipt auto-post remains the existing
  explicit, user-executed path; OCR does not introduce a new automatic posting route.

**Out of scope.** Any new automatic financial mutation; bypassing the review queue; provider billing
decisions beyond what the plan documents.

**Mandatory gates (all must be resolved in the 9B plan before implementation).**

1. **OCR/GenAI provider data residency.** The chosen provider's processing/storage region must be
   identified and approved against the Singapore company's data-residency obligations before any
   document is sent to it.
2. **Document confidentiality.** Uploaded AR documents are confidential financial records;
   transport and at-rest handling (encryption, access scope, tenant isolation) must be defined and
   approved.
3. **Uploaded-document retention / deletion policy.** Define how long source documents and extracted
   artifacts are retained, where, and how/when they are deleted; no indefinite silent retention.
4. **Malware / content scanning policy.** Every uploaded file is scanned/validated (type, size,
   malware, content safety) before parsing or forwarding to any provider.
5. **No production document processing without explicit approval.** Running real production
   documents through OCR/GenAI requires an explicit approval gate (environment, provider, document
   set, retention). Building the intake flow does **not** authorize processing production documents.

**Safety notes.** Treat uploaded documents as untrusted input. Store/handle extracted PII per the
company's data rules. Extraction confidence and source document must be auditable. OCR output never
reaches posted financial records without human review.

---

## 5. Batch 9C — Daily FX Rate Sync and Multi-Currency UX

**Objective.** Replace static/hardcoded currency handling with an auditable daily market FX rate
feed and a base-currency-driven multi-currency UX.

**In scope.**

- **Daily FX rate sync.** External provider selection, scheduled daily ingestion into the existing
  `exchange_rates` schema, retry/backoff, and weekend/holiday fallback behavior.
- **Source / date / rate handling.** Persist provider source, fetched-at timestamp, effective date,
  and rate provenance. Add a stale-rate / freshness guard.
- **Read API.** A read-only rates / currency-catalog API so the frontend stops relying on hardcoded
  MYR/SGD/USD lists and hardcoded MYR labels.
- **Multi-currency UX.** Base-currency-driven display; show the applied exchange rate, its source,
  and effective date on invoices/receipts/allocations; support a broader currency catalog rather
  than three hardcoded options.
- **Auditability.** Existing transaction-level exchange-rate snapshots and forex gain/loss JEs are
  preserved; the new feed must not retroactively alter historical snapshots.

**Database migration (likely; separately reviewed).** Persisting provider/source/provenance metadata
will **most likely require an additive database migration** to `exchange_rates` (and possibly a small
sync-log table). This migration must be **drafted and submitted for separate Codex review before
implementation**, must be additive (no destructive change to existing rate data), and must be applied
to staging first. Likely audit fields / tables:

| Field / column | Purpose |
|---|---|
| `provider` | External rate provider identifier |
| `fetched_at` | Timestamp the rate was retrieved from the provider |
| `effective_date` | Business effective date of the rate |
| `currency_pair` (base/quote, or `base_currency` + `quote_currency`) | The pair the rate applies to |
| `rate` | The numeric exchange rate |
| `source` | Source classification (e.g. live feed, manual override, fallback) |
| `fallback_reason` | Why a fallback rate was used (weekend/holiday/provider outage), null when live |
| `sync_status` | Outcome of the sync run (success / failed / stale / fallback) |

**Stale-rate behavior (must be defined).** The plan must define explicit behavior when no fresh rate
is available: which prior effective rate is reused, how staleness is surfaced in the UI, when a
transaction is blocked vs allowed with a stale-rate warning, and the freshness threshold.

**Transaction FX snapshots must not be retroactively mutated.** Existing per-transaction
exchange-rate snapshots on invoices/receipts/allocations/journal entries are immutable historical
records. The daily feed only supplies rates for **new** lookups; it must never rewrite snapshots on
already-recorded transactions.

**Out of scope.** Changing forex JE math inside financial RPCs without separate explicit approval;
manual rate overrides without an audit trail (if needed, gate them).

---

## 6. Batch 9D — Bank Charge Handling

**Objective.** Provide GL-safe, audited bank-charge handling on receipts, distinct from discounts
and short payments, without any direct balance updates.

**In scope.**

- **Bank charge handling.** A separately approved, GL-safe RPC/service flow for bank charges
  (currently `imports/service.ts` records bank charges as diagnostic only — not accounted).
- **Receipt shortfall logic.** Define and document how a receipt that falls short of the matched
  invoice outstanding is classified and recorded.
- **Discount / bank-charge classification.** Clear, mutually exclusive classification rules so a
  shortfall is correctly attributed to discount vs bank charge vs genuine short payment, each with
  its own GL treatment.
- **Financial correctness and audit trail.** All bank-charge / shortfall postings flow through a
  verified RPC/service boundary with journal entries; no direct update of `invoices.outstanding`,
  `receipts.allocated_amount`, or `receipts.unallocated_amount`.

**Mandatory design + evidence requirements (must be in the 9D plan and proven in evidence).**

1. **Dedicated RPC/service design.** Bank-charge / shortfall posting goes through a new, explicitly
   designed RPC/service flow — never direct balance updates and never a bypass of existing financial
   RPCs.
2. **GL / account mapping.** Define the GL accounts for bank charges (and shortfall/discount
   variants), including how the mapping is configured per company.
3. **Journal entry examples.** Provide worked JE examples (debits/credits) for each case: bank
   charge on receipt, short payment, discount, and combinations.
4. **Reversal / cancel behavior.** Define what happens to bank-charge JEs when the underlying
   receipt or allocation is reversed/cancelled, with worked examples.
5. **Interaction with existing discount allocation behavior.** Specify exactly how the new flow
   composes with the existing `allocate_receipt` discount handling so charges and discounts are not
   double-counted or misclassified.
6. **Accounting acceptance matrix.** Provide a matrix of input scenarios → expected
   classification (discount vs bank charge vs short payment) → expected GL postings → expected
   resulting balances, signed off as accounting-correct.
7. **Financial correctness evidence.** Smoke/SQL evidence demonstrating balanced JEs, correct
   outstanding/unallocated effects, and that the Batch 8B boundary (RPC-only writes) is verified
   intact.

**Out of scope.** Direct balance mutation; reusing the unused `updateAllocationAmounts()` helper
without an impact review; changing `allocate_receipt` discount behavior without separate approval.

**Dependency.** The Batch 8B financial-mutation-boundary (RPC-only writes, role guards) is **already
complete**; 9D builds on that enforced boundary. 9D must **verify the boundary remains intact** as
part of its evidence (see §10), not re-establish it.

---

## 7. Batch 9E — Auto-Approval Policy (only if really needed)

**Objective.** *Only if a genuine requirement is confirmed*, introduce a constrained,
policy-driven auto-approval for fuzzy suggestions. Default position: **do not build this.**

**9E remains optional.** Default position: **do not build it.** Implement only if a genuine,
documented business requirement justifies automation over human review.

**Minimum controls — all mandatory if 9E is ever implemented.**

1. **Off by default** — disabled until explicitly enabled.
2. **Role-gated configuration** — only an authorized role may view/change the policy.
3. **Threshold policy** — auto-approval only above a clearly defined confidence/score threshold.
4. **Deterministic tie-breaks** — ties resolve by explicit deterministic rules, never randomly.
5. **Audit log** — every auto-approval records who/what/threshold/inputs/timestamp and is reviewable.
6. **Kill switch** — an easy global switch immediately reverts to full human review.
7. **No financial mutation** — auto-approval never writes financial records outside the verified
   RPC/service flow; it only advances a row through the existing reviewed path.
8. **No `/allocations/auto`** — must never re-enable or route around `POST /allocations/auto`
   (stays HTTP 403 `AUTO_ALLOCATION_DISABLED`).

It must never be framed as autonomous AI approval, and never auto-approves where zero candidates
exist (that remains auto-reject / correction-only). If the requirement is not clearly established,
**9E is skipped.**

---

## 8. Recommended implementation order

1. **Batch 9A — UI/API Completeness and Placeholder Removal.** Lowest risk, highest demo value;
   makes the module honest and establishes the completeness baseline the later batches build on.
2. **Batch 9B — PDF/Image/OCR Import Intake.** Self-contained intake feature reusing the existing
   review queue; high FYP "GenAI" value; no new mutation surface.
3. **Batch 9C — Daily FX Rate Sync and Multi-Currency UX.** Backend feed + read API + UX; depends on
   nothing above but benefits from 9A's honest UI.
4. **Batch 9D — Bank Charge Handling.** Most financially sensitive; sequence after the financial
   mutation boundary is enforced and after 9A/9C clean up surrounding UX.
5. **Batch 9E — Auto-Approval Policy — only if really needed.** Last and conditional; built only if
   a requirement is confirmed, otherwise dropped.

> **No separate prerequisite backend/security batch is required before 9A or 9D.** Batch 8B is
> complete; the financial mutation boundary (RPC-only writes, role guards, hardened RLS) is already
> enforced. Each relevant future financial batch must **verify that the Batch 8B boundary remains
> intact** as part of its evidence — not re-establish it.

---

## 9. Claude vs Codex responsibilities

| Activity | Owner |
|---|---|
| Drafting batch plans, scope, evidence docs | Claude |
| Repository inventory / audit (read-only) | Claude |
| Implementation (UI, APIs, parsers, sync jobs) | Claude |
| Writing migrations (when a batch is approved for one) | Claude (drafts) → Codex review mandatory |
| Pre-implementation plan review | **Codex** (gate) |
| Post-implementation code review | **Codex** (gate) |
| Independent verification of safety boundaries | **Codex** |
| Final sign-off before commit/push | User (after Codex PASS) |
| Production deployment decision | User |

Principle: **Claude proposes and implements; Codex independently reviews; the user approves.** No
batch moves from plan to code, or from code to commit, without a Codex checkpoint and explicit user
approval.

---

## 10. Required Codex re-review checkpoints (before implementation)

For **every** Batch 9 batch:

1. **Plan pre-review** — Codex reviews the batch plan; must reach PASS (or PASS WITH CHANGES fully
   applied) before any code is written.
2. **Post-implementation review** — Codex reviews the diff before commit; must reach PASS (or PASS
   WITH CHANGES fully applied).
3. **Safety-boundary re-review** — explicit Codex confirmation that the standing safety posture
   (§1) and the **completed Batch 8B financial mutation boundary remain intact**: `/allocations/auto`
   still 403; no direct `allocation_details` insert; no direct `invoices.outstanding` /
   `receipts.*_amount` update; no RPC bypass; mutation role guards present; no mock dashboard data.

Batch-specific extra checkpoints:

- **9B**: Codex confirms OCR output cannot reach posted records without human review.
- **9C**: Codex confirms the FX feed cannot retroactively mutate historical rate snapshots.
- **9D**: Codex confirms all bank-charge/shortfall postings go through a verified RPC/service flow.
- **9E**: Codex confirms safe-by-default, threshold gating, kill-switch, and full audit logging.

---

## 11. Evidence required per batch

Common to all batches (stored under `docs/evidence/…`):

- Scope + files-changed manifest and final `git status --short` / `git diff --check`.
- Build result (`npm.cmd run build`) and any test/smoke output.
- Safety-grep results (`supabase.from`, financial-table `.from(...)`, `createClient` location,
  `POST /allocations/auto` usage).
- Codex pre- and post-review outcomes.

| Batch | Additional evidence |
|---|---|
| 9A | Authenticated role/context endpoint (`/auth/me` or equivalent) verified or delivered, with role-gated UI wired to it (no demo/env role reliance); button/action inventory with each control's backing API or disabled/hidden status; confirmation of no mock dashboard data and no frontend bypass |
| 9B | Supported file types; extraction-confidence handling; proof OCR rows enter the review queue (not posted); file-validation evidence |
| 9C | Separately Codex-reviewed additive migration (provider/fetched_at/effective_date/currency_pair/rate/source/fallback_reason/sync_status); provider/source; scheduled-sync run log; defined stale-rate behavior; rate-snapshot immutability check; read-API contract |
| 9D | Dedicated RPC/service design; GL/account mapping; worked JE examples; reversal/cancel behavior; discount-interaction rules; accounting acceptance matrix; financial-correctness evidence; Batch 8B boundary-intact verification |
| 9E | Policy/threshold config, audit-log samples, kill-switch demonstration, requirement justification |

---

## 12. Production safety and deployment gates

1. No batch touches staging or production data during planning or implementation review.
2. Migrations (only when a batch is explicitly approved for one) are reviewed by Codex, applied to
   **staging first**, then smoke-tested before any production consideration.
3. Backend-first deployment for any backend change; frontend released only after backend smoke
   passes.
4. Role/tenant/direct-DML regression matrix must pass before production for any batch touching
   guards or financial flows.
5. Production deployment is a separate, explicitly approved step — never bundled into
   implementation.
6. The standing safety posture (§1) is a release gate: any regression blocks deployment.
7. Fixtures / imports / record creation against any shared environment require an explicit
   approval gate identifying environment, company, customer(s), scenarios, and expected persistent
   records.

---

## 13. Open questions / assumptions

**Resolved (no longer open).**

- **Financial-mutation-boundary batch.** **Batch 8B is complete**; future financial batches must
  verify its boundary remains intact (they do not need to re-establish it). No separate prerequisite
  security batch precedes 9A or 9D.

**Open questions (need user input before the relevant batch starts).**

1. **`/auth/me` endpoint status** — does the authenticated role/context endpoint (`/auth/me` or
   equivalent) already exist for 9A to verify and consume, or must 9A deliver it? Until it is in
   place, role-specific UI hiding/disabling must not rely on demo/env assumptions.
2. **9B OCR provider** — preferred extraction engine/provider, **data-residency** region,
   **document-confidentiality** handling, **retention/deletion** policy, **malware-scanning**
   approach, and budget for a Singapore company's documents?
3. **9C FX provider** — which market-rate provider, which currency catalog scope beyond MYR/SGD/USD,
   and the agreed stale-rate threshold/behavior?
4. **9E necessity** — is there an actual requirement for auto-approval, or should 9E be formally
   dropped?
5. **Deferred cleanup** — when does the deferred historical smoke/demo/financial cleanup batch run
   relative to Batch 9?

**Assumptions (stated; correct me if wrong).**

- The existing review-queue flow can absorb OCR-extracted rows without contract changes.
- The `exchange_rates` schema can store provider/source/fetched-at provenance via an **additive,
  separately Codex-reviewed migration** (9C is expected to require one; see §5).
- No Batch 9 batch requires re-enabling any disabled financial automation.
- All Batch 8 security/rollout work remains the committed baseline and is not revisited here.

---

## 14. Final recommendation — start with Batch 9A

Begin with **Batch 9A — UI/API Completeness and Placeholder Removal**:

- It is the **lowest-risk** batch (UI/API truthfulness, no new financial mutation surface) and the
  most directly demo-improving for the FYP.
- It **closes the most visible audit gaps** from Batch 8A (mock tax/payment data, placeholder pages,
  inert header controls, stale settings text).
- It **re-verifies and documents the safety baseline** (the completed Batch 8B boundary intact, no
  frontend bypass, no mock dashboard data) that every later batch must preserve.
- It **delivers/verifies the `/auth/me` role endpoint** (Open Question 1) so role-based hide/disable
  is honest, unblocking the reverse/bounce UI and informing 9D sequencing — with no separate
  prerequisite security batch needed, since Batch 8B is complete.

**Recommended next action:** on approval, produce the standalone **Batch 9A plan** (objective, exact
scope, out-of-scope, files affected, risk checklist, smoke checklist, evidence plan), submit it for
Codex pre-review, and only then implement. No code, migration, deployment, or data change occurs
under this roadmap document itself.
