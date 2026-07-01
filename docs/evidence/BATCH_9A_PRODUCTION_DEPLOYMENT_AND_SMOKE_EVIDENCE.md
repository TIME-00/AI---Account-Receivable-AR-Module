# Batch 9A Production Deployment and Smoke Evidence

Date/time: 2026-07-01 19:18:27 +08:00  
Baseline commit deployed: `3d48fd03b433f0ac7c825b2a15d22fcad7f8baeb`  
Readiness plan commit: `3d48fd03b433f0ac7c825b2a15d22fcad7f8baeb`  
Production project ref: `kusseuycqgdilychphpq`  
Production URL: `https://kusseuycqgdilychphpq.supabase.co`  
Staging project ref explicitly not targeted: `gcdsdyegwjdcskpukqlq`

Final verdict: **PASS**

Batch 9A production Edge Function deployment completed for the approved scope only. Production
read-only / negative-only smoke passed. No production financial records were created, posted,
cancelled, reversed, allocated, imported, or deleted.

## Approved scope

Production Edge Functions deployed:

- `auth`
- `lookups`
- `search`
- `notifications`
- `invoices`

No unrelated Edge Functions were deployed.

Out of scope and not performed:

- production financial mutation smoke;
- invoice `tax_code_id` create/post/cancel smoke;
- production fixtures;
- production import upload/parse/validate/execute;
- direct protected financial-table mutation;
- frontend/Vercel manual deployment;
- staging deployment.

## Local preflight

Repository baseline:

| Check | Result |
| --- | --- |
| Branch | `main` |
| Local HEAD | `3d48fd03b433f0ac7c825b2a15d22fcad7f8baeb` |
| `origin/main` | `3d48fd03b433f0ac7c825b2a15d22fcad7f8baeb` |
| Worktree before deployment | clean |

Commands/checks run:

```text
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git rev-parse origin/main
git status --short --untracked-files=all
deno check auth/index.ts lookups/index.ts search/index.ts notifications/index.ts allocations/index.ts reports/index.ts imports/index.ts customers/index.ts invoices/index.ts receipts/index.ts
npm.cmd exec tsc -- --noEmit
npm.cmd run build
git diff --check
secret/JWT scan
/allocations/auto source scan
dashboard mock/static scan
frontend direct financial-table access scan
generated artifact tracked-file scan
```

Results:

| Check | Result | Notes |
| --- | --- | --- |
| Deno Edge Function check | PASS | changed and relevant existing functions checked |
| TypeScript check | PASS | first pre-build run hit stale `.next/types`; after `npm.cmd run build`, rerun passed |
| Next build | PASS | Next.js 15.5.19; 25 routes |
| `git diff --check` | PASS | no whitespace errors |
| Secret/JWT scan | PASS | no token/JWT/password/key values found; source/documentation placeholders only |
| `/allocations/auto` source scan | PASS | `AUTO_ALLOCATION_DISABLED` remains in source |
| Dashboard mock/static scan | PASS | no dashboard mock/static source path found; historical docs mention prior remediation |
| Frontend direct financial table access scan | PASS | no frontend direct protected financial-table access found |
| Generated artifact scan | PASS | no generated runtime/build artifacts selected for commit |

## Production targeting preflight

Process/session environment was set to production for this run only:

- `SUPABASE_URL` exactly `https://kusseuycqgdilychphpq.supabase.co`
- staging ref `gcdsdyegwjdcskpukqlq` absent from active process URL
- `SUPABASE_ANON_KEY` present
- `COMPANY_ID` present
- Finance Manager / operational token present
- optional Auditor token absent
- optional System Admin token absent

Token/read endpoint readiness:

| Check | HTTP | Result |
| --- | ---: | --- |
| `GET /reports/dashboard?trend_months=6` with Finance Manager token | 200 | PASS |

No token values, raw JWT values, or secrets were printed or written.

## Pre-deploy production function inventory

Read-only command:

```text
supabase functions list --project-ref kusseuycqgdilychphpq -o json
```

| Function | Pre-deploy status | Pre-deploy version |
| --- | --- | ---: |
| `auth` | absent | n/a |
| `lookups` | absent | n/a |
| `search` | absent | n/a |
| `notifications` | absent | n/a |
| `invoices` | ACTIVE | 19 |
| `allocations` | ACTIVE | 13 |
| `reports` | ACTIVE | 12 |
| `imports` | ACTIVE | 20 |
| `customers` | ACTIVE | 14 |
| `receipts` | ACTIVE | 13 |
| `bank-accounts` | ACTIVE | 2 |
| `credit-notes` | ACTIVE | 8 |
| `debit-notes` | ACTIVE | 8 |
| `daily-overdue` | ACTIVE | 6 |

## Production deployment

Working directory: `backend`

Commands run:

```text
supabase functions deploy auth --project-ref kusseuycqgdilychphpq --use-api --yes
supabase functions deploy lookups --project-ref kusseuycqgdilychphpq --use-api --yes
supabase functions deploy search --project-ref kusseuycqgdilychphpq --use-api --yes
supabase functions deploy notifications --project-ref kusseuycqgdilychphpq --use-api --yes
supabase functions deploy invoices --project-ref kusseuycqgdilychphpq --use-api --yes
```

Deployment result:

| Function | Result |
| --- | --- |
| `auth` | deployed |
| `lookups` | deployed |
| `search` | deployed |
| `notifications` | deployed |
| `invoices` | deployed |

Supabase CLI emitted fallback import-map warnings for the deployed functions. This matches the current
repository layout using the shared root import map and did not block deployment or activation.

## Post-deploy production function inventory

Read-only command:

```text
supabase functions list --project-ref kusseuycqgdilychphpq -o json
```

| Function | Post-deploy status | Post-deploy version |
| --- | --- | ---: |
| `auth` | ACTIVE | 1 |
| `lookups` | ACTIVE | 1 |
| `search` | ACTIVE | 1 |
| `notifications` | ACTIVE | 1 |
| `invoices` | ACTIVE | 20 |
| `allocations` | ACTIVE | 13 |
| `reports` | ACTIVE | 12 |
| `imports` | ACTIVE | 20 |
| `customers` | ACTIVE | 14 |
| `receipts` | ACTIVE | 13 |
| `bank-accounts` | ACTIVE | 2 |
| `credit-notes` | ACTIVE | 8 |
| `debit-notes` | ACTIVE | 8 |
| `daily-overdue` | ACTIVE | 6 |

`invoices` increased from v19 to v20. Unrelated functions were not deployed.

## Production read-only / negative-only smoke

All smoke calls used:

```text
https://kusseuycqgdilychphpq.supabase.co/functions/v1
```

Token values and response bodies containing business data were not printed or written.

### Auth context

| Check | HTTP | Result | Notes |
| --- | ---: | --- | --- |
| `GET /auth/me` with Finance Manager token | 200 | PASS | response body length 885; safe context returned |
| Unsafe field scan | n/a | PASS | no access token, refresh token, raw JWT, provider token, service role, app metadata, or user metadata field names found |
| `GET /auth/me` without auth | 401 | PASS | unauthenticated request rejected |

### Lookups

| Check | HTTP | Result | Notes |
| --- | ---: | --- | --- |
| `GET /lookups/tax-codes` | 200 | PASS | endpoint body non-empty; production REST count confirmed 9 active/effective tax codes |
| `GET /lookups/payment-terms` | 200 | PASS | endpoint body non-empty; production REST count confirmed 13 active payment terms |
| invalid `country=XXX` | 400 | PASS | validation error |
| invalid `effective_date=2026-02-30` | 400 | PASS | validation error |

Lookup counts are recorded as safe summaries only. No tax-code or payment-term record contents were
written.

### Search

| Check | HTTP | Result | Notes |
| --- | ---: | --- | --- |
| `GET /search?q=INV&limit=10` | 200 | PASS | response body non-empty |
| Safe type/route scan | n/a | PASS | no disallowed result type or route pattern found |
| `GET /search?q=a&limit=10` | 400 | PASS | short query rejected |
| `GET /search?q=ar&limit=99` | 400 | PASS | invalid limit rejected |

Search result bodies were not printed or written.

### Notifications

| Check | HTTP | Result | Notes |
| --- | ---: | --- | --- |
| `GET /notifications?limit=10` | 200 | PASS | response body non-empty |
| Notification route scan | n/a | PASS | no route outside `/invoices/import` or `/receipts/import` found |
| `GET /notifications?limit=10` without auth | 401 | PASS | unauthenticated request rejected |

No notification records were created. The endpoint derives signals from existing production state.
Notification response bodies were not printed or written.

### Auto-allocation negative smoke

| Check | HTTP | Result | Notes |
| --- | ---: | --- | --- |
| `POST /allocations/auto` | 403 | PASS | response contained `AUTO_ALLOCATION_DISABLED` |

### Optional role checks

| Check | Result | Reason |
| --- | --- | --- |
| Auditor report read | skipped | optional `AUDITOR_TOKEN` absent |
| System Admin operational denial | skipped | optional `SYSTEM_ADMIN_TOKEN` absent |

### Frontend production verification

No manual Vercel production deployment was run.

| Check | HTTP | Result |
| --- | ---: | --- |
| `GET https://account-receivable-module.vercel.app/` | 200 | PASS |

Exact Vercel deployment commit was not verified in this task. The production frontend should now be
able to call the newly deployed production Edge Functions when Vercel serves the Batch 9A frontend
commit or later.

## Safety confirmations

- Production deployment was limited to `auth`, `lookups`, `search`, `notifications`, and `invoices`.
- No staging deployment occurred.
- No production SQL or migration was applied.
- No production data was created, updated, deleted, imported, posted, cancelled, reversed, or
  allocated.
- No production financial mutation smoke was run.
- No production fixtures/imports/create-record flows were run.
- No direct insert into `allocation_details` occurred.
- No direct update to `invoices.outstanding` occurred.
- No direct update to `receipts.allocated_amount` or `receipts.unallocated_amount` occurred.
- No direct delete of protected financial records occurred.
- No financial RPC business logic was modified.
- `/allocations/auto` remained HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- No token values, raw JWT values, service-role values, or secrets were printed or written.
- No external AI/LLM/OCR provider was connected.
- No commit or push was performed during deployment/smoke.

## Skipped checks and caveats

- Optional Auditor and System Admin role checks were skipped because their production tokens were not
  present in the active process environment.
- Manual Vercel deployment was not performed.
- Exact Vercel production commit metadata was not verified.
- Production invoice `tax_code_id` mutation smoke was not run because it remains separately
  approval-gated.

## Conclusion

Batch 9A production deployment and read-only / negative-only smoke result: **PASS**.

The approved production Edge Functions are active, `invoices` advanced to v20, read-only API smoke
passed, and the auto-allocation negative check remained blocked with `AUTO_ALLOCATION_DISABLED`.
