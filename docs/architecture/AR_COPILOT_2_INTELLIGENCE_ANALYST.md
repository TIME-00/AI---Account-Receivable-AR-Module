# AR Copilot 2.0 — Gate 1 Intelligence / Analyst Foundation

Status:

- **GATE 1 BACKEND: IMPLEMENTED / VALIDATED LOCALLY**
- **FRONTEND: PENDING CLAUDE IMPLEMENTATION**
- **CONTROLLED EXECUTION: PENDING GATE 2**
- **PRODUCTION: UNCHANGED / PENDING FUTURE ROLLOUT**

This gate extends the deployed read-only AR Copilot with deterministic analysis,
bounded reporting, safe chart specifications, document explainability, recovery
recommendations, and multilingual presentation policy. It does not add a write
tool, financial mutation, scheduler, or Production deployment. Local Migration
046 adds only two bounded read RPCs and supporting indexes for truthful
currency/minimum/top-N report semantics.

## 1. Authority and dependency direction

The dependency direction is one way:

```text
authenticated Edge route
  -> Copilot orchestration and intent/language policy
    -> allow-listed analyst tool executor
      -> deterministic analyst service and engines
        -> existing scoped report services + Edge-only Migration 046 report-row RPCs
          -> PostgreSQL read authority
    -> OpenAI narrative over bounded structured facts
```

Facts, exact monetary strings, derived changes, ordering rules, finding codes,
report rows, and chart data are produced by the backend. OpenAI may select a
registered tool and explain its result. It cannot generate SQL, choose a table or
column, change a chart value, invent a risk score, or execute a financial action.
Retrieved business strings remain untrusted data under the existing server-owned
Copilot policy.

## 2. Role and tenant boundary

All tools receive the existing bearer-derived `AuthContext`; request arguments
cannot contain a company, user, role, model, SQL, URL, or credential.

| Role | Analyst scope |
|---|---|
| AR Clerk | Existing assigned-customer Invoice, Receipt, dashboard, report, and customer scope only; no Automation document/exception analysis |
| AR Supervisor | Company operational analysis, Automation documents/exceptions, reports, and Journal evidence; no Audit authority added |
| Finance Manager | Company operational analysis and the existing Finance read scope |
| Auditor | Read-only company evidence consistent with current service policy; no mutation |
| System Admin | System/how-to knowledge only; every operational analyst tool is denied |

Multi-role access is based on membership in the existing role array, never a
single lexicographically selected role. Scoped report RPCs preserve AR Clerk
assignments, and the customer-risk overdue count independently invokes customer
access authority before counting. Direct source reads use explicit `company_id` predicates and
only occur after the corresponding operational/Automation role guard.

## 3. Analytical tool registry

The deployed v2 registry remains backward compatible and Gate 1 adds these ten
read-only tools:

| Tool | Purpose and input | Role/scope | Bounded result and authority |
|---|---|---|---|
| `get_ar_priority_analysis` | `limit` | operational roles; AR Clerk remains assigned-scope | up to 10 reason-ordered customer, unapplied-cash, and permitted exception items; each has an explicit category and rank within that category, with no false cross-category materiality ranking |
| `get_customer_risk_analysis` | `customer_id` | operational customer authority | stored credit rating, scoped outstanding/overdue facts, and deterministic reason codes; never an AI rating |
| `get_collection_health_analysis` | `months` | operational scope | two to 12 existing dashboard trend points and an exact current/previous difference; insufficient evidence if comparison history is absent |
| `get_exposure_movement_analysis` | `overdue` or `aging` | operational scope | current authoritative exposure plus `insufficient_evidence` until governed historical snapshots exist; no invented movement |
| `get_unapplied_cash_analysis` | `limit` | scoped Receipt authority | up to 10 posted Receipts with authoritative unapplied strings and safe Receipt links |
| `get_root_cause_analysis` | allow-listed target type and UUID | target read authority; Automation targets need supervisory read role | stored balance/allocation or document workflow factors; no inference of customer intent |
| `get_daily_brief` | `limit` | operational scope | up to eight on-demand deterministic insights and fixed internal screens |
| `run_ar_report` | strict report plan | existing report/domain scope | at most 50 rows, exact money strings, coverage metadata, optional validated chart |
| `analyze_automation_document` | `document_id` | AR Supervisor, Finance Manager, Auditor | sanitized classification, validation and allow-listed extracted fields with provenance |
| `analyze_exception_recovery` | `exception_id` | AR Supervisor, Finance Manager, Auditor | up to four human-confirmed review suggestions; `read_only=true`, `executable=false` |

There is no `execute_sql`, generic RPC, generic table query, generic HTTP, web,
posting, allocation, reminder, retry, customer mutation, role, Gmail, FX, Journal,
or scheduler tool. An individual request may execute at most four analytical
calls within the existing overall eight-tool/four-round Copilot limits.

## 4. Deterministic findings and root causes

Analysis has four provenance categories:

- `AUTHORITATIVE_FACT` — a stored or existing report-authoritative value;
- `DETERMINISTIC_DERIVATION` — a backend calculation from authoritative values;
- `DIRECT_WORKFLOW_EVIDENCE` — a stored allocation, reminder, validation, or
  exception event;
- `HEURISTIC_OBSERVATION` — reserved for explicitly labelled observations and
  not currently used for accounting predictions.

Each root-cause factor has a stable `factor_code`, impact direction, metric,
current/comparison values, exact change where valid, evidence category, and
bounded entity references. Supported findings include overdue exposure,
multiple overdue Invoices, unapplied cash, absence/presence of allocation
evidence, open Automation exceptions, stored validation failures, and exact
collection movement. Missing comparison history returns
`insufficient_evidence`; it does not fabricate a prior period. No generic LLM
confidence percentage or opaque risk score exists.

## 5. Proactive Daily Brief

Gate 1 computes structured insights **on demand**. It does not persist insight
snapshots or run a scheduler. The current database has authoritative present-day
metrics and bounded collection trend data, but no requirement yet warrants a
new long-term insight lifecycle. Avoiding persistence also avoids storing prompts,
answers, or duplicated financial facts.

Each insight contains an on-demand deterministic ID, type, severity, title,
reason codes, bounded facts, entity references, a fixed internal next screen,
and evidence category. No source condition means no insight. If a later product
requires historical Daily Brief snapshots, that must receive a separate schema,
RLS, retention, scheduler, and rollback review; narrative should still be
generated on demand.

## 6. Natural-language reporting DSL

OpenAI can propose only this validated plan:

```ts
{
  report: "aging" | "invoice_summary" | "receipt_summary" |
          "customer_outstanding" | "collections" | "overdue_exposure";
  metrics: Array<
    "invoice_count" | "receipt_count" | "total_amount" |
    "outstanding_amount" | "overdue_amount" |
    "unapplied_amount" | "collection_amount"
  >;
  dimensions: Array<
    "customer" | "aging_bucket" | "period" | "document"
  >;
  filters: Array<{
    field: "status" | "currency" | "credit_rating" | "minimum_amount";
    operator: "eq" | "gte";
    value: string;
  }>;
  period: { date_from: string | null; date_to: string | null;
            as_of_date: string | null };
  sort: { metric: /* one selected metric */; direction: "asc" | "desc" } | null;
  limit: 1..50;
  chart_type: "bar" | "line" | "pie" | null;
}
```

Every report owns one implemented grouping dimension: fixed aging bucket,
document identity, customer, or period. Status, currency, and credit rating
remain filters/row metadata where supported; they are not advertised as grouping
dimensions. Extra fields,
arbitrary columns, unsupported comparators, invalid dates/statuses/currencies,
unselected sort metrics, and limits are rejected. A minimum transaction amount requires an explicit
currency and applies to Invoice outstanding or Receipt unapplied amount,
respectively. Migration 046 applies currency, minimum, allow-listed sort, stable
date/ID tie-breaking, and the maximum 50-row result limit in that order inside
PostgreSQL. Existing Invoice/Receipt collection endpoints and callers are
unchanged. Selected metrics alone determine returned financial/count fields.

Each result distinguishes authoritative row values from set coverage:
`complete`, `bounded_incomplete`, or `insufficient_evidence`, plus source total,
returned rows, and whether a requested top-N is globally proven. A bounded set is
never labelled a complete authoritative report. Existing report services define
as-of, aging, base-currency, assignment, and period semantics; empty results use
the company/report authority and never a hard-coded MYR fallback.

Money is normalized with the existing exact report decimal/minor-unit helpers;
Copilot does not use floating-point financial arithmetic. Multi-currency document
rows retain transaction currency and cannot be combined into a monetary chart.

## 7. Safe chart contract

The optional `chart` artifact contains only `bar`, `line`, or `pie`, a bounded
title, a report-owned x field, report-owned series, formats, and at most 20 data
points. It contains no JSX, HTML, JavaScript, URL, formatter code, or external
resource.

- collection time series may use `line`;
- categorical comparisons may use `bar`;
- only the reconciled five-bucket aging outstanding partition may use `pie`;
  any missing bucket, coverage truncation, currency incompatibility, or total
  mismatch rejects the pie;
- unsuitable or empty results fall back to the report table or fail validation.

The backend builds chart data by copying the validated report rows and then
asserts field-for-field equality. A chart capped below the report size exposes
`is_truncated`, `displayed_points`, and `total_available_points`. The model
cannot supply or alter values.

## 8. Document Copilot and provenance

Document analysis may expose classification, processing status, validation codes,
duplicate/match status, linked safe evidence, and at most 10 extracted fields:
Invoice/Receipt number and date, due/value date, currency, total/receipt amount,
and reference number. Values are bounded to 120 characters.

Field provenance is explicit:

- `EXTRACTED` — Document Intelligence output, not booked authority;
- `VALIDATED` — accepted by deterministic validation;
- `MATCHED` — matched to an authoritative master/entity;
- `AUTHORITATIVE` — read from the booked AR domain.

Gate 1 never exposes raw OCR, Gmail body, recipient/contact data, attachment
content/path, provider payload, prompts, tokens, credentials, bank/contact PII,
or free-form raw extraction payload.

## 9. Exception Recovery Assistant

Recovery output contains the stored exception ID, reason/lifecycle status,
sanitized explanation, supporting validation codes, and at most four candidate
review steps. Candidate types are fixed server vocabulary such as review a
customer match, Invoice reference, extracted amount, currency, classification,
or open the Allocation Wizard. Every candidate requires human confirmation.

No retry command, allocation, customer assignment, document transition, reminder,
or other mutation is registered or invoked. Recovery plans are advisory
navigation/read artifacts only.

## 10. Multilingual presentation

Official presentation languages are English (`en`), Simplified Chinese
(`zh-CN`), and Bahasa Melayu (`ms`). Selection is deterministic:

1. explicit request in the current user message;
2. clear recent user-language continuity;
3. current-message detection;
4. English default.

Canonical guide entries, tool names, report identifiers, statuses, document
numbers, currencies, amounts, roles, and authorization remain untranslated
internal contracts. A server-owned instruction asks OpenAI to render the narrative
in the selected language while preserving those identifiers. Encoding-stable
Chinese and Malay definition/live/write signals supplement model planning.
Definitions such as `什么是未分配收款？` and `Apa maksud unapplied cash?` use
canonical system knowledge, while current/how-many/largest/today/comparison
phrases require authorized live evidence. Reminder/post/allocation requests stay
read-only in every supported language. Bounded Malay vocabulary detection keeps
sentences such as `Pelanggan mana paling banyak outstanding?` in Malay even when
financial identifiers are English. Language never changes permission or tenant scope.

Intent precedence distinguishes explanation/how-to, explicit read requests, and
object-bound action requests; a bare word such as `post`, `allocate`, or `hantar`
does not itself create write intent. Separately, a final-answer verifier examines
the question, answer claim, validated context, and actual tool outcomes. Current
company claims accumulate fact-family requirements (for example overdue,
collections, unapplied cash, or workflow exceptions), while entity claims require
the matching entity type and exact validated ID. Every detected requirement must
be satisfied: workflow-exception evidence cannot authorize an overdue total, a
mixed Invoice/company answer needs both authorities, and an unresolved entity ID
never acts as a wildcard. This postcondition remains active even when the intent
classifier misses a phrase.

## 11. Privacy, performance, failure and telemetry

Multi-tool aggregation occurs server-side and only bounded DTOs reach OpenAI.
The current `store: false` provider request, no-chat-retention posture, recursive
result guard, safe evidence/link mapping, and content-free request/phase telemetry
remain in force. Telemetry records request ID, phase, tool name, round, latency,
provider/status category, and success only—never prompt, response, tool arguments,
or financial DTOs.

The service uses bounded concurrent reads for independent dashboard/exception and
customer/outstanding facts, existing aggregate report services, and no entity
N+1 loops. Limits are 10 priority/Receipt items, 50 report rows, 12 comparison
months, 20 chart points, eight brief items, 10
document fields, four recovery candidates, and 20 evidence items.

Insufficient comparison evidence is a valid structured result. Unsupported plans,
invalid tool arguments, forbidden roles, unavailable context, provider failure,
and tool/request limits retain separate existing sanitized error categories.
General conversation remains available when no requested analytical fact depends
on a failed tool.

## 12. Frontend handoff

The existing response remains compatible:

```ts
{
  answer: string;
  evidence: CopilotEvidence[];
  links: CopilotLink[];
  status: CopilotStatus;
  artifacts?: Array<
    | { kind: "analysis"; analysis: AnalystAnalysis }
    | { kind: "daily_brief"; daily_brief: DailyBrief }
    | { kind: "report"; report: AnalystReportResult;
        chart: AnalystChartSpec | null }
    | { kind: "document_analysis"; document_analysis: DocumentAnalysis }
    | { kind: "recovery_plan"; recovery_plan: RecoveryPlan }
  >;
}
```

Existing v2 paths omit `artifacts`, so current `answer`, `evidence`, `links`, and
`status` behavior is unchanged. Claude should add a strict discriminated runtime
parser for each artifact, render exact strings without financial recalculation,
use the existing safe-link validator, provide table fallback for every chart,
label provenance/evidence category, and never turn recovery candidates into an
execution control in Gate 1.

## 13. Gate 2 proposal contract — design only

`FutureActionProposal` is a non-runtime design type. A future server-created
proposal needs a server-owned proposal ID, company and actor, allow-listed action
type, target references, display summary, exact parameters, impact/risk summary,
confirmation requirement, expiry, state fingerprint/version, idempotency key, and
audit contract. The model must never generate an executable token.

Gate 2 must validate the role when creating a proposal, re-read and fingerprint
current state on confirmation, reject stale/expired proposals, revalidate role,
enforce one-time idempotent execution, call an existing deterministic service, and
create existing audit evidence. It must never execute arbitrary model text.

| Existing authority | Future classification | Reason |
|---|---|---|
| Prepare a reminder draft/preview | A — possible controlled proposal candidate | reversible preview with explicit recipient/content review; sending remains separate |
| Retry a narrowly retryable Automation exception | A — possible controlled candidate | only for allow-listed retryable state through existing recovery authority and fresh-state check |
| Navigate to Invoice, Receipt, Allocation, Exception, Journal or Audit | A — safe navigation already | no financial mutation; route remains allow-listed |
| Prepare an allocation preview | B — proposal/navigation only | amounts affect financial state; human uses existing governed preview/confirmation flow |
| Send reminder/delivery | B — proposal only pending a dedicated external-side-effect gate | external communication and recipient evidence require explicit confirmation |
| Customer reassignment | B — proposal/navigation only | changes customer ownership and AR Clerk scope |
| Post/cancel Invoice or Receipt; allocate/reverse allocation | C — never implicitly Copilot-executable | financial authority; requires a separate explicit product/security gate if ever considered |
| Create/reverse Journal, change booked FX, roles, Gmail/OAuth, scheduler or Automation mode | C — never Copilot-executable | accounting/security/platform authority, outside Copilot scope |
| Arbitrary SQL/RPC/HTTP/tool creation | C — never | bypasses allow-list, tenant and deterministic authority |

**Nothing is proposed with executable authority, confirmed, or executed in Gate
1.**

## 14. Migration and rollout decision

`046_post_ar_copilot_2_reporting_currency_filter.sql` is required because a
post-pagination TypeScript filter cannot prove complete currency/minimum/top-N
semantics. It adds:

- `ar_copilot_invoice_report_rows` and `ar_copilot_receipt_report_rows`;
- `SECURITY INVOKER` report functions plus an Edge-service-only validator for
  active company, user membership, operational role, and requested scope;
- explicit assigned-customer joins for AR Clerk;
- pre-limit currency/minimum filtering and allow-listed deterministic sorting;
- transaction-currency amount strings plus authoritative company base currency;
- composite company/currency/balance/date/ID indexes;
- execute privilege only for `service_role`, with PUBLIC, anon and
  authenticated execution revoked; the browser cannot invoke these report RPCs;
- an Edge-only validator independently rechecks active company membership, role,
  requested scope, and AR Clerk assignment inputs before every read.

Existing collection RPC signatures and callers are unchanged. The migration adds
no table, financial DML, Data API privilege, snapshot, prompt/answer storage,
cron, or worker. `046b_post_ar_copilot_2_reporting_currency_filter_smoke_tests.sql`
is rollback-only; it proves mixed-currency/minimum/top-N and AR Clerk assignment
behavior, security mode/grants, and zero fixture residue. Migration 046 and 046b
passed locally only. This worktree is intentionally uncommitted, unpushed, and
undeployed; Production remains on the accepted AR Copilot v2 bundle.
