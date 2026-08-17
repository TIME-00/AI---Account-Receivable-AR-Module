# AR Copilot 2.0 Gate 1 Production Closure Evidence

## Rollout identity

- Project: `TIME-00/AI---Account-Receivable-AR-Module`
- Supabase Production project: `kusseuycqgdilychphpq`
- Production frontend: `https://account-receivable-module.vercel.app/`
- Acceptance completed: 2026-08-17 (Asia/Kuala_Lumpur)
- Gate: AR Copilot 2.0 Gate 1 — read, analyze, explain, prioritize,
  recommend, report, and visualize
- Gate 2: **NOT STARTED**

Production closure was completed under Codex implementation and self-review
because Claude Code was temporarily unavailable. A retrospective independent
Claude review is pending. Earlier local implementation, frontend integration,
and provider-compatibility boundaries had already received independent review.

## Committed implementation

| Revision | Purpose |
|---|---|
| `e7fbbc5293f0541d02f96188a2fd4843e81d34d1` | Gate 1 deterministic analyst backend, Migration 046, strict artifact frontend, tests |
| `bcc5a5a3f7d316eb0c3d7a98593e5a6fc98625e1` | OpenAI strict tool-schema compatibility remediation |
| `0720903a7a4aacc9f5bac99c8897b3b2de266d68` | Supported collection-health/document intent authorization and content-free phase diagnostics |
| `27d6432df63bd7af7d3b4660ecbe63ef118a501d` | Trusted report execution boundary, report-plan retry, and bounded chart availability |

All revisions were pushed to `origin/main` before the corresponding Production
deployment. `Poster/` and `social-media/` were excluded and untouched.

## Production deployment state

- Migration 046 ledger entry:
  `20260817040206_post_ar_copilot_2_reporting_currency_filter` — **APPLIED**.
- Migration 046b — **NOT APPLIED / ROLLBACK-ONLY**.
- `ar-copilot` — version **7**, `ACTIVE`.
- Edge gateway `verify_jwt` — `false` by reviewed design; the function performs
  its own authenticated company/user authorization. A structurally valid
  request without a bearer token returned HTTP 401.
- Automation — version **24**, `ACTIVE`; not redeployed by these remediations.
- Vercel — Production deployment `READY`; Gate 1 frontend from `e7fbbc5` remains
  live. The two later remediations were backend-only, so no redundant frontend
  deployment occurred.

## Migration 046 live acceptance

Migration 046 remains Edge-only, service-role invoked, tenant scoped, and role
governed. Production read-only probes established:

- Finance Manager company scope: **PASS**.
- AR Clerk assigned scope: **PASS**.
- AR Clerk company scope: **PASS (denied with SQLSTATE 42501)**.
- Every returned assigned-scope report row belonged to an active assignment:
  **PASS**.
- Every returned company-scope row belonged to the selected tenant: **PASS**.
- MYR currency and positive minimum-amount filtering: **PASS**.
- Descending sort applied before the Top-N limit: **PASS**.
- Result limit and filter metadata: **PASS**.
- SGD live rows: **NOT EXERCISED — NO SAFE PRODUCTION EVIDENCE**. Production
  contains SGD documents, but no visible positive SGD invoice row was available
  in the selected authorized Finance Manager scope. No data was fabricated.
- No model-side FX conversion was used.

## Production defects and remediation

### Initial Gate 1 HTTP 503

The first Gate 1 bundle registered `run_ar_report` strict function schemas that
contained provider-unsupported `uniqueItems: true` for metrics and dimensions.
OpenAI rejected the entire 26-tool registry before tool selection, so even
`Hi` failed. The safe rollback restored v2 while the schema was corrected.
Duplicate dimensions/metrics remain rejected by the deterministic backend
parser. The corrected registry retains 26 read-only tools, `tool_choice: auto`,
`parallel_tool_calls: false`, and `store: false`.

### Collection Health and Document Copilot HTTP 502

Both failures occurred before tool execution at the live-tool intent
authorization boundary:

- `How are collections performing?` lacked the bounded `performing` collection
  health wording.
- `Analyze this automation document ...` did not match the existing
  `this document` form.

The classifier was extended only for those supported semantic forms. The
deterministic tool services, evidence verifier, role scope, and DTO authority
were unchanged. Both natural Production prompts now return HTTP 200 and their
reviewed artifacts.

### Analytical report 403/502

Three related report defects were found during wider acceptance:

1. The dashboard report repository received the user client where its reviewed
   trusted execution client was required, causing a role failure.
2. The provider schema offered dimension values that the deterministic report
   parser did not accept.
3. A parser-rejected plan became an infrastructure error instead of receiving
   one bounded correction turn.

The trusted/user clients are now passed in their intended roles; the exposed
dimension enum matches the deterministic parser; parser-tagged invalid plans get
one content-free correction path; and unsupported chart shapes return a valid
report with `chart: null`. Failed calls create no evidence grant or artifact.
Chart integrity checks remain fail-closed for any chart that is emitted.

## Production acceptance matrix

| Capability | Result | Evidence |
|---|---|---|
| `Hi` and follow-up conversation | **PASS** | HTTP 200, no financial tool call, serial multi-turn UI remained usable |
| System knowledge (`What is unapplied cash?`) | **PASS** | system-guide path, HTTP 200 |
| Live overdue count | **PASS** | governed live tool and evidence, HTTP 200 |
| Existing Invoice explanation | **PASS** | entity-bound evidence and safe internal links |
| Existing Receipt explanation | **PASS** | entity-bound evidence and safe internal links |
| Priority / customers needing attention | **PASS** | deterministic analysis or bounded Daily Brief artifact |
| Exact customer-risk analysis | **PASS** | customer context invoked `get_customer_risk_analysis` |
| Collection Health | **PASS** | `get_collection_health_analysis`, analysis artifact, no 502 |
| Supported-period collection comparison | **PASS** | bounded collection-health analysis |
| Unapplied cash analysis | **PASS** | `get_unapplied_cash_analysis` artifact |
| Exact Invoice root cause | **PASS** | invoice context invoked `get_root_cause_analysis` |
| Exposure movement | **PASS** | deterministic analysis; insufficient history stays bounded |
| Daily Brief | **PASS** | on-demand, backend order, exactly 8 items in the live run |
| Customer-outstanding report | **PASS** | report artifact, complete coverage, summary, bar chart |
| Collections report | **PASS** | report artifact, complete coverage, summary, line chart |
| Aging report | **PASS** | report artifact, complete coverage, summary, pie chart |
| Report summary | **PASS** | backend scalar summary rendered; no client-side summation |
| Bar geometry | **PASS** | live DOM `data-chart-geometry="bar"` |
| Line geometry | **PASS** | live DOM `data-chart-geometry="line"` |
| Pie geometry | **PASS** | live DOM `data-chart-geometry="pie"`; emitted only for complete backend partition |
| Live multi-series chart | **NOT EXERCISED — NO SAFE PRODUCTION EVIDENCE** | no naturally returned live multi-series payload; strict local renderer tests cover all three bounded series |
| Document Copilot | **PASS** | accessible existing document invoked `analyze_automation_document`; document artifact rendered, no 502 |
| Exception recovery | **PASS** | `recovery_plan`, `read_only: true`, `executable: false` |
| English analysis | **PASS** | evidence-backed priority analysis |
| Simplified Chinese analysis | **PASS** | same governed analysis family and scope |
| Bahasa Melayu analysis | **PASS** | same governed analysis family and scope |
| Highest-overdue natural prompt | **PASS (bounded)** | HTTP 200 after `run_ar_report`; no unsupported artifact or overclaim was emitted |

The repeatable repository Playwright Production remediation suite passed 2/2,
covering conversation, system knowledge, live overdue data, Invoice context,
Receipt context, and continued message submission. A temporary serial acceptance
probe exercised the additional analyst/artifact cases above and was removed;
no probe, trace, video, screenshot, or auth state was committed.

## Role and tenant acceptance

### Finance Manager

- Authenticated Production UI analytical reads: **PASS**.
- Company-wide report scope and tenant-bound rows: **PASS**.
- No write authority was introduced.

### AR Clerk

An existing active Production AR Clerk actor was exercised through the exact
Production JWT/RLS and Migration 046 scope functions without returning IDs or
business values:

- JWT actor binding: **PASS**.
- Assigned visible customer access: **PASS**.
- Unassigned customer access: **PASS (denied)**.
- Direct unassigned customer-ID lookup: **PASS (not visible)**.
- Assigned report rows: **PASS (all assignment-bound)**.
- Company report scope: **PASS (denied with 42501)**.

An interactive AR Clerk browser session was **NOT EXERCISED — NO SAFE
PRODUCTION CREDENTIAL**. The repository authentication-state files were not
read, printed, copied, or modified. Service-level tests cover priority, Daily
Brief, customer risk, report, and root-cause propagation of the same assigned
scope.

## Read-only, privacy, and mutation proof

- Five Production write-intent prompts (allocate, reminder send, retry,
  reassign, cancel) returned HTTP 200 explanations with zero tool calls and no
  execution.
- The combined registry remains 26 read-only tools; prohibited write/generic
  tools: **0**.
- Before/after cryptographic fingerprints matched exactly for invoices,
  receipts, allocations, journals, reminder delivery attempts, assignments,
  automation exceptions, roles, mailbox metadata, booking FX rates, automation
  settings, AR configuration, and scheduler configuration.
- No new scheduler, monitor, conversation store, or background OpenAI process
  was added.
- `store: false` remains in every Copilot Responses API request.
- Production secret status: `OPENAI_API_KEY` present;
  `OPENAI_COPILOT_MODEL` absent; `OPENAI_DOCUMENT_MODEL` absent. The reviewed
  `gpt-5.6-luna` fallback is therefore active. No secret value was read or
  recorded.
- Client errors remain sanitized. Content-free diagnostics are limited to
  request/phase/round/tool/category/status/latency metadata and exclude prompts,
  arguments, results, identifiers, amounts, provider bodies, credentials, and
  document content.
- Production ar-copilot v7 logs observed HTTP 200 for accepted requests; no
  continuing 502/503 or `invalid_tool_schema` condition was observed.

## Validation baseline

- Provider compatibility: **8/8**.
- Focused Gate 1 remediation: **170/170**.
- Gate 1 intelligence: **126/126**.
- Copilot v2/service: **86/86**.
- Combined focused backend: **390/390**.
- Full backend: **916/916**.
- Edge entrypoints: **20/20** check pass.
- Deno check/fmt/lint: **PASS**.
- Full frontend: **1648/1648**.
- Artifact contract: **30/30**.
- Artifact/chart renderer: **29/29**.
- Legacy Copilot contract: **31/31**.
- TypeScript, Production-source ESLint, and Production build: **PASS**.
- npm audits (`package-lock-only`, full, production-only): **0 / 0 / 0**.
- Dependency graph, fixture runtime isolation, module line budgets, monetary
  literal guard, `git diff --check`, secret/auth scan, generated-state scan,
  and prohibited-tool scan: **PASS**.
- A whole-repository ESLint invocation still encounters the pre-existing
  Playwright-test false positive at `e2e/gate-c-report-export.spec.ts:81`;
  Production-source ESLint is clean and this unrelated test lint condition was
  not modified.

## Known Gate 1 limitations

- Gate 1 is read-only. There is no Propose → Confirm → Execute flow.
- No autonomous financial action, arbitrary SQL, generic RPC/HTTP, or arbitrary
  database query is available to the model.
- Historical overdue/aging explanations can be insufficient where snapshots do
  not exist; that state is surfaced rather than invented.
- OpenAI supplies narrative and presentation. PostgreSQL and deterministic
  backend services remain authoritative for facts and derived metrics.
- Unsupported or incomplete evidence fails closed.

## Closure verdict

**AR COPILOT 2.0 GATE 1 — PRODUCTION CLOSED**

- Backend implementation: CLOSED / independently reviewed before rollout
- Frontend integration: CLOSED / independently reviewed before rollout
- Provider remediation: CLOSED / independently reviewed before deployment
- Production 502 remediations: implemented and self-reviewed by Codex; live
  acceptance passed; retrospective independent Claude review pending
- Migration 046: PRODUCTION APPLIED
- Migration 046b: NOT APPLIED / ROLLBACK-ONLY
- Automation: v24 ACTIVE
- ar-copilot: corrected Gate 1 v7 ACTIVE
- Vercel frontend: LIVE / READY
- Production acceptance: PASS
- Gate 2: NOT STARTED
