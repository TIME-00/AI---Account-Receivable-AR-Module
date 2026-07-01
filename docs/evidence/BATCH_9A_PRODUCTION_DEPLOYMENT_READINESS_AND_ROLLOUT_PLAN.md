# Batch 9A Production Deployment Readiness and Rollout Plan

Date/time: 2026-07-01 16:53:43 +08:00  
Baseline commit reviewed: `e88f51cf893c3ce1596a1a147ba149912ba12ab1`  
Batch 9A implementation commit: `c1e0ae19254543d840e03648a95405ff3f5ee664`  
Batch 9A staging deployment/smoke evidence commit: `e88f51cf893c3ce1596a1a147ba149912ba12ab1`  
Production project ref: `kusseuycqgdilychphpq`  
Staging project ref: `gcdsdyegwjdcskpukqlq`

Final readiness verdict: **READY FOR PRODUCTION DEPLOYMENT**

Batch 9A is ready for a controlled production Edge Function rollout. The production rollout should
use read-only / negative-only smoke by default. Any production invoice `tax_code_id`
create/post/cancel smoke remains separately approval-gated and is not approved by this plan.

Condition-closure update: 2026-07-01 16:57:38 +08:00  
Updated readiness verdict: **READY WITH CONDITIONS**

The production read-only condition closure could not be completed because the active environment still
targets staging. Production API/config readiness must not be marked complete until the active
production-readiness environment is corrected.

Condition-closure update: 2026-07-01 +08:00  
Updated readiness verdict: **READY FOR PRODUCTION DEPLOYMENT**

The active process environment was retargeted to production for read-only checks only. Production
token/read endpoint readiness, tax-code readiness, payment-term readiness, fiscal-period readiness,
search-data readiness, and function inventory were verified without printing secrets or record
contents.

## Scope

This document covers production readiness and rollout planning only for Batch 9A UI/API completeness
foundation.

Planned production Edge Function deployment scope:

- `auth`
- `lookups`
- `search`
- `notifications`
- `invoices`

No unrelated Edge Function is included in the planned Batch 9A production rollout.

## Local baseline and preflight

Repository checks:

| Check | Result | Notes |
| --- | --- | --- |
| Branch | PASS | `main` |
| Local HEAD | PASS | `e88f51cf893c3ce1596a1a147ba149912ba12ab1` |
| `origin/main` | PASS | matched local HEAD |
| Worktree before plan creation | PASS | clean |

Commands run:

```text
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git rev-parse origin/main
git status --short --untracked-files=all
deno check auth/index.ts lookups/index.ts search/index.ts notifications/index.ts allocations/index.ts reports/index.ts imports/index.ts customers/index.ts invoices/index.ts receipts/index.ts
npm.cmd exec tsc -- --noEmit
npm.cmd run build
git diff --check
secret/JWT scan over tracked files
/allocations/auto source scan
dashboard mock/static scan
frontend direct financial-table access scan
```

Results:

| Check | Result | Notes |
| --- | --- | --- |
| Deno Edge Function check | PASS | changed and relevant existing functions checked |
| TypeScript check | PASS | `npm.cmd exec tsc -- --noEmit` |
| Next build | PASS | `npm.cmd run build`; Next.js 15.5.19; 25 routes |
| `git diff --check` | PASS | no whitespace errors |
| Secret/JWT scan | PASS | no token/JWT/password/key values found; benign source-code terms only |
| `/allocations/auto` source scan | PASS | source still contains `AUTO_ALLOCATION_DISABLED` disabled path |
| Dashboard mock/static scan | PASS | no dashboard mock/static data found |
| Frontend direct financial-table access scan | PASS | no frontend `supabase.from(...)` or direct protected financial table writes found |

## Production targeting readiness

Environment inspection did not print secret values.

| Variable / target | Readiness | Notes |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | PRESENT | sufficient for read-only Supabase function inventory |
| Active `SUPABASE_URL` | PASS | process environment retargeted to `https://kusseuycqgdilychphpq.supabase.co` for read-only checks |
| Production role token | PASS | Finance Manager token was present and accepted by an existing production read endpoint |
| Staging ref in active URL | PASS | staging ref was absent after process-level retargeting |

Condition before execution:

- `SUPABASE_URL` must be exactly `https://kusseuycqgdilychphpq.supabase.co`.
- Active environment values must not contain `gcdsdyegwjdcskpukqlq`.
- Production `SUPABASE_ANON_KEY`, `COMPANY_ID`, and Finance Manager or other allowed operational role
  token must be present without printing values.

### Production read-only condition closure

Attempted on: 2026-07-01 16:57:38 +08:00

Result: **NOT CLOSED**

Safe environment check results:

| Check | Result | Notes |
| --- | --- | --- |
| `SUPABASE_URL` present | PASS | value was not printed |
| `SUPABASE_URL` exactly production | FAIL | active value is not `https://kusseuycqgdilychphpq.supabase.co` |
| Production ref present in active `SUPABASE_URL` | FAIL | production ref was not present |
| Staging ref absent from active `SUPABASE_URL` | FAIL | staging ref `gcdsdyegwjdcskpukqlq` was present |
| `SUPABASE_ANON_KEY` present | PASS | value was not printed |
| `COMPANY_ID` present | PASS | value was not printed |
| Finance Manager / operational token present | PASS | value was not printed |

Because active targeting was not production-clean, no production REST/API config checks were run in
this condition-closure attempt. Specifically, no production `tax_codes`, `payment_terms`,
`fiscal_periods`, customer, invoice, receipt, or report data was queried through role-token API calls.

Remaining readiness blocker:

- retarget the active environment so `SUPABASE_URL` is exactly
  `https://kusseuycqgdilychphpq.supabase.co`;
- confirm active environment values do not contain `gcdsdyegwjdcskpukqlq`;
- re-run production read-only config checks before production deployment execution.

### Production read-only condition closure - completed

Completed on: 2026-07-01 +08:00

Result: **CLOSED**

Environment retargeting:

| Check | Result | Notes |
| --- | --- | --- |
| Process `SUPABASE_URL` set to production | PASS | exactly `https://kusseuycqgdilychphpq.supabase.co` |
| Staging ref absent | PASS | `gcdsdyegwjdcskpukqlq` absent from retargeted process URL |
| `SUPABASE_ANON_KEY` present | PASS | value was not printed |
| `COMPANY_ID` present | PASS | value was not printed |
| Finance Manager / operational token present | PASS | value was not printed |

Production read-only readiness checks:

| Area | Result | Safe summary |
| --- | --- | --- |
| Existing read endpoint token check | PASS | `GET /reports/dashboard?trend_months=6` returned HTTP 200 |
| Active/effective tax codes | PASS | 9 active/effective company-scoped tax codes found |
| Active/effective output tax codes | PASS | 9 active/effective company-scoped output tax codes found |
| Active payment terms | PASS | 13 active payment terms found |
| Current open fiscal period | PASS | 1 open current fiscal period found |
| Search data readiness | PASS | at least one customer, invoice, and receipt category was readable by count-only/existence probes |

No production record contents, customer names, token values, raw JWTs, or secrets were printed or
written. No production data was created, updated, deleted, imported, posted, cancelled, reversed, or
allocated.

## Production current Edge Function inventory

Read-only command run:

```text
supabase functions list --project-ref kusseuycqgdilychphpq -o json
```

Current production function state:

| Function | Status | Current version | Batch 9A action |
| --- | --- | ---: | --- |
| `auth` | absent | n/a | deploy |
| `lookups` | absent | n/a | deploy |
| `search` | absent | n/a | deploy |
| `notifications` | absent | n/a | deploy |
| `invoices` | ACTIVE | 19 | deploy updated Batch 9A version |
| `allocations` | ACTIVE | 13 | no deploy in Batch 9A |
| `reports` | ACTIVE | 12 | no deploy in Batch 9A |
| `imports` | ACTIVE | 20 | no deploy in Batch 9A |
| `customers` | ACTIVE | 14 | no deploy in Batch 9A |
| `receipts` | ACTIVE | 13 | no deploy in Batch 9A |
| `bank-accounts` | ACTIVE | 2 | no deploy in Batch 9A |
| `credit-notes` | ACTIVE | 8 | no deploy in Batch 9A |
| `debit-notes` | ACTIVE | 8 | no deploy in Batch 9A |
| `daily-overdue` | ACTIVE | 6 | outside Batch 9A scope |

Production `invoices` pre-rollout version: **v19**.

## Production data/config readiness

| Area | Readiness | Notes |
| --- | --- | --- |
| Tax codes | PASS | 9 active/effective company-scoped tax codes; 9 output tax codes |
| Payment terms | PASS | 13 active payment terms |
| Fiscal periods | PASS | 1 current open fiscal period; this supports optional mutation-smoke readiness only if separately approved |
| Role/token readiness | PASS | Finance Manager token worked against existing production dashboard read endpoint |
| Search data readiness | PASS | at least one customer, invoice, and receipt category was readable by count-only/existence probes |

These checks clear the readiness conditions for read-only / negative-only Batch 9A production rollout.
Production financial mutation smoke is still not approved and must remain separately approval-gated.

## Exact production deployment scope

Deploy only these reviewed Batch 9A Edge Functions:

```text
supabase functions deploy auth --project-ref kusseuycqgdilychphpq --use-api --yes
supabase functions deploy lookups --project-ref kusseuycqgdilychphpq --use-api --yes
supabase functions deploy search --project-ref kusseuycqgdilychphpq --use-api --yes
supabase functions deploy notifications --project-ref kusseuycqgdilychphpq --use-api --yes
supabase functions deploy invoices --project-ref kusseuycqgdilychphpq --use-api --yes
```

Recommended working directory: `backend`.

No database migration is planned for Batch 9A production rollout.

## Deployment order

1. Confirm local HEAD and `origin/main` are at `e88f51cf893c3ce1596a1a147ba149912ba12ab1` or a later
   explicitly approved commit.
2. Confirm worktree is clean.
3. Confirm production environment targeting is clean:
   `SUPABASE_URL=https://kusseuycqgdilychphpq.supabase.co`.
4. Capture pre-deploy function inventory.
5. Deploy `auth`.
6. Deploy `lookups`.
7. Deploy `search`.
8. Deploy `notifications`.
9. Deploy `invoices`.
10. Re-list production functions and confirm all deployed functions are `ACTIVE`.
11. Run read-only / negative-only production smoke.
12. Do not proceed with frontend production verification or any manual Vercel production action until
    Edge Function smoke passes.

## Production smoke plan

Default production smoke is read-only / negative-only:

| Smoke | Expected result |
| --- | --- |
| `GET /auth/me` with valid authenticated operational token | HTTP 200; safe user/company/role/capability fields only |
| `GET /auth/me` without auth | HTTP 401/403 |
| `GET /lookups/tax-codes` | HTTP 200; active/effective company-scoped list or honest empty array |
| `GET /lookups/payment-terms` | HTTP 200; active company-scoped list or honest empty array |
| invalid lookup params | HTTP 400 validation error |
| `GET /search?q=<known-term>&limit=10` | HTTP 200; safe scoped customer/invoice/receipt results only |
| short search query | HTTP 400 validation error |
| invalid search limit | HTTP 400 validation error |
| `GET /notifications?limit=10` | HTTP 200; derived real signals or honest empty array |
| unauthenticated `GET /notifications?limit=10` | HTTP 401/403 |
| `POST /allocations/auto` | HTTP 403 `AUTO_ALLOCATION_DISABLED` |
| optional System Admin operational read check | HTTP 403 if a valid System Admin token is available |

## Production mutation policy

Default policy: no production financial mutation smoke.

Production invoice `tax_code_id` create/post/cancel smoke requires separate explicit approval. If
approved later:

- use minimal records clearly prefixed `B9A-PROD-SMOKE`;
- verify active/effective tax code, payment term, and open fiscal period first;
- use only supported invoice API/RPC-backed paths;
- clean up through supported cancel/reversal paths;
- never directly insert into `allocation_details`;
- never directly update `invoices.outstanding`;
- never directly update `receipts.allocated_amount` or `receipts.unallocated_amount`;
- never directly delete protected financial records.

## Frontend production rollout note

The Batch 9A frontend depends on the new API functions for authenticated role context, lookups, search,
and notifications. Production frontend deployment or verification should wait until production Edge
Functions are deployed and pass smoke.

No manual Vercel production deployment is approved by this plan. If Vercel production is not already
on the approved commit after Edge Function smoke, request explicit user approval before any manual
frontend production deployment.

## Rollback / mitigation plan

Before production deployment, capture current function versions and deployment status.

If an Edge Function deploy fails:

- stop immediately;
- do not deploy remaining functions;
- verify previously deployed production functions remain `ACTIVE`;
- if a partial Batch 9A function is unhealthy, redeploy the previous known-good version where available
  or apply a forward fix after review.

If production smoke fails:

- do not deploy or manually promote frontend production;
- do not run production mutation smoke;
- capture HTTP status/error summaries without token values;
- prefer forward fix for the affected Edge Function;
- keep `/allocations/auto` disabled.

Rollback must not reintroduce unsafe behavior, mock dashboard data, direct financial table mutation, or
any path to `AUTO_ALLOCATION_DISABLED` being bypassed.

## Safety confirmations for this planning step

- No production deployment was performed.
- No Edge Function was deployed.
- No SQL or migration was applied.
- No production data was created, updated, or deleted.
- No production fixture/import/create-record flow was run.
- No production financial mutation smoke was run.
- No token, raw JWT, service-role value, or secret was printed or written.
- No external AI/LLM/OCR provider was connected.
- `/allocations/auto` remains required to return HTTP 403 `AUTO_ALLOCATION_DISABLED`.

## Go / no-go recommendation

Recommendation: **READY FOR PRODUCTION DEPLOYMENT**

Proceed to production deployment only after:

1. user explicitly approves the production deployment execution step;
2. production environment targeting is re-confirmed immediately before deploy;
3. production function inventory is recaptured immediately before deploy.

Use read-only / negative-only production smoke by default. Do not include production invoice mutation
smoke unless separately approved.
