# Batch 9A Staging Deployment and Smoke Evidence

Date/time: 2026-07-01 16:27:19 +08:00  
Baseline commit: `c1e0ae19254543d840e03648a95405ff3f5ee664`  
Commit message: `feat(ui): complete Batch 9A API-backed UI foundation`  
Environment: Supabase staging only  
Staging project ref: `gcdsdyegwjdcskpukqlq`  
Production project ref explicitly not targeted: `kusseuycqgdilychphpq`

Final verdict: **PASS**

Initial condition closed: the first staging smoke found zero active/effective tax codes, so a
staging-only config tax code was created and the invoice `tax_code_id` create/post/cancel smoke was
rerun successfully through supported API paths.

## Scope

Batch 9A deployed only the changed Edge Functions to staging:

- `auth`
- `lookups`
- `search`
- `notifications`
- `invoices`

No unrelated Edge Function was deployed.

No production deployment, production smoke, production fixture/import execution, or production data
action was performed.

## Pre-deployment local checks

Repository baseline:

- Branch: `main`
- Local `HEAD`: `c1e0ae19254543d840e03648a95405ff3f5ee664`
- `origin/main`: `c1e0ae19254543d840e03648a95405ff3f5ee664`
- Worktree before deployment: clean

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
generated artifact tracked-file scan
```

Results:

| Check | Result | Notes |
| --- | --- | --- |
| Git branch / commit / origin alignment | PASS | `main`, local HEAD matched `origin/main` |
| Worktree clean | PASS | clean before deployment |
| Deno Edge Function check | PASS | all listed functions checked |
| TypeScript check | PASS | initial `tsc` failed before build due stale/missing `.next/types`; `npm run build` regenerated Next types and rerun `tsc` passed |
| Next build | PASS | Next.js 15.5.19; 25 routes generated |
| `git diff --check` | PASS | no whitespace errors |
| Secret/JWT scan | PASS | no token/JWT/password/key values found; benign source-code terms only |
| `/allocations/auto` source scan | PASS | route remains hard-coded disabled with `AUTO_ALLOCATION_DISABLED` |
| Dashboard mock/static scan | PASS | no dashboard mock/static data found |
| Frontend direct financial-table access scan | PASS | no frontend `supabase.from(...)` / direct financial table writes found |
| Generated artifact tracked-file scan | PASS | no generated build/runtime artifacts tracked |

## Staging targeting

Required environment variables were present without printing values:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_ACCESS_TOKEN`
- `COMPANY_ID`
- `FINANCE_MANAGER_TOKEN`

Optional staging role tokens were also present:

- `AR_CLERK_TOKEN`
- `AR_SUPERVISOR_TOKEN`
- `AUDITOR_TOKEN`
- `SYSTEM_ADMIN_TOKEN`

Targeting verification:

- `SUPABASE_URL` was exactly `https://gcdsdyegwjdcskpukqlq.supabase.co`
- production ref `kusseuycqgdilychphpq` was not present in active environment values checked
- Supabase CLI was linked to `gcdsdyegwjdcskpukqlq`
- final local CLI project-ref file recorded `gcdsdyegwjdcskpukqlq`

## Deployment

Correct CLI working directory: `backend`

Commands run:

```text
supabase link --project-ref gcdsdyegwjdcskpukqlq
supabase functions list --project-ref gcdsdyegwjdcskpukqlq -o json
supabase functions deploy auth --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
supabase functions deploy lookups --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
supabase functions deploy search --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
supabase functions deploy notifications --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
supabase functions deploy invoices --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
supabase functions list --project-ref gcdsdyegwjdcskpukqlq -o json
```

Deployment result:

| Function | Before | After | Status |
| --- | ---: | ---: | --- |
| `auth` | not deployed | v1 | ACTIVE |
| `lookups` | not deployed | v1 | ACTIVE |
| `search` | not deployed | v1 | ACTIVE |
| `notifications` | not deployed | v1 | ACTIVE |
| `invoices` | v6 | v7 | ACTIVE |

Existing unrelated staging functions were not redeployed.

Supabase CLI emitted fallback import-map warnings for the deployed functions. This matches the current
repository layout using the shared root import map and did not block deploy or boot.

## Staging API smoke

All smoke calls used staging URL `https://gcdsdyegwjdcskpukqlq.supabase.co/functions/v1`.
Token values were not printed or written.

### Auth context

| Check | HTTP | Result | Notes |
| --- | ---: | --- | --- |
| `GET /auth/me` with Finance Manager token | 200 | PASS | returned safe user/company/role/capability context |
| Sensitive field check | n/a | PASS | no access token, refresh token, raw JWT, service-role data, provider metadata, or auth metadata found in response |
| `GET /auth/me` without auth | 401 | PASS | unauthenticated request rejected |

### Lookups

| Check | HTTP | Result | Notes |
| --- | ---: | --- | --- |
| `GET /lookups/tax-codes` | 200 | PASS WITH CONDITION | returned active company-scoped array; row count `0` |
| `GET /lookups/payment-terms` | 200 | PASS | returned active company-scoped array; row count `1` |
| invalid `country=XXX` | 400 | PASS | `VALIDATION_ERROR` |
| invalid `effective_date=2026-02-30` | 400 | PASS | `VALIDATION_ERROR` |

### Search

| Check | HTTP | Result | Notes |
| --- | ---: | --- | --- |
| `GET /search?q=<known-term>&limit=10` | 200 | PASS | first pass used a known staging customer-derived term; returned 10 safe customer/invoice/receipt results with valid frontend routes |
| `GET /search?q=a&limit=10` | 400 | PASS | short query rejected with `VALIDATION_ERROR` |
| `GET /search?q=ar&limit=99` | 400 | PASS | invalid limit rejected with `VALIDATION_ERROR` |

Hidden/deleted customer leak checks and AR Clerk assignment filtering were not separately forced with
custom fixture data. They remain covered by static review and existing code path review: search uses
operational read auth, assignment filtering, and linked-customer visibility verification.

### Notifications

| Check | HTTP | Result | Notes |
| --- | ---: | --- | --- |
| `GET /notifications?limit=10` | 200 | PASS | returned derived import review/error signals; row count `10` |
| Notification route check | n/a | PASS | routes were constrained to `/invoices/import` or `/receipts/import` |
| `GET /notifications?limit=10` without auth | 401 | PASS | unauthenticated request rejected |

No notification records were created. The endpoint is read-only and derives signals from existing import
state.

### Optional role checks

| Check | HTTP | Result | Notes |
| --- | ---: | --- | --- |
| Auditor `GET /reports/aging` | 200 | PASS | optional token was valid |
| System Admin `GET /invoices` | 403 | PASS | operational read denial preserved |

### Auto-allocation negative smoke

| Check | HTTP | Result | Notes |
| --- | ---: | --- | --- |
| `POST /allocations/auto` | 403 | PASS | `AUTO_ALLOCATION_DISABLED` |

## Invoice `tax_code_id` smoke

Static/API review:

- frontend submits only lookup-backed real `tax_code_id` values from `GET /lookups/tax-codes`
- empty "No Tax" selector submits no tax code
- backend validates `tax_code_id` against authenticated company, active status, and invoice-date
  effective window before resolving the rate server-side
- invalid or wrong-tenant tax codes return validation errors rather than silently becoming no-tax lines

Mutation smoke:

- skipped
- reason: staging `GET /lookups/tax-codes` returned zero active/effective tax codes
- no invoice, invoice line, journal entry, receipt, allocation, or customer record was created
- no cleanup was required

## Frontend staging/local smoke

Frontend deployment was not performed in this task. No Vercel staging/preview deployment was available
or changed during this smoke.

Local frontend verification:

- `npm.cmd run build`: PASS
- profile/search/notifications/lookups integration compiled successfully
- route generation included `/notifications`, `/profile`, `/credit-notes`, and existing AR routes
- AI sidebar implementation remains a local AR Help panel; no external AI/LLM/OCR calls were added
- settings bank-account copy no longer says `GET /bank-accounts` is unavailable

Manual browser smoke against a staging frontend was not run because this task did not deploy frontend
changes or start a browser session.

## Staging test data and cleanup

Created staging records: none

Cleanup performed: none required

No protected financial tables were directly mutated. No direct insert into `allocation_details` was
performed. No direct update to `invoices.outstanding`, `receipts.allocated_amount`, or
`receipts.unallocated_amount` was performed. No direct delete of protected financial records was
performed.

## Safety boundary verification

- Production was not targeted.
- Production project ref `kusseuycqgdilychphpq` was not used.
- No production deployment occurred.
- No production smoke occurred.
- No production data was touched.
- No fixtures/imports/create-record flows were run.
- No staging import execution was run.
- No staging records were created.
- No token values were printed or written.
- No service-role data or raw JWT was exposed by `/auth/me`.
- `/allocations/auto` remained HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- No dashboard mock data was reintroduced.
- No frontend direct protected financial-table writes were found.
- No external AI/LLM/OCR calls were added.

## Tax-code condition closure

Follow-up date/time: 2026-07-01 +08:00  
Environment: staging only (`gcdsdyegwjdcskpukqlq`)

### Tax code setup

Initial `GET /lookups/tax-codes` returned zero active/effective rows. A minimal staging config tax
code was created because no safe config API exists for tax-code administration.

Method used:

- REST insert into staging `tax_codes` using an existing System Admin token.
- This was a configuration-table insert only, not a protected financial transaction-table mutation.
- First attempted code `B9A-SMOKE-6` was rejected by schema validation because `tax_code` is
  `VARCHAR(10)`. No row was created by that failed attempt.
- Retried with schema-compliant code `B9A6`.

Tax code retained for future staging smoke:

| Field | Value |
| --- | --- |
| `id` | `d3a9f7f1-9d77-4cb5-b409-16cd5d91ca66` |
| `tax_code` | `B9A6` |
| `tax_name` | `Batch 9A Staging Smoke Tax 6%` |
| `rate` | `6` |
| `tax_type` | `Output` |
| `company_id` | `81000000-0000-0000-0000-000000000001` |
| `effective_from` | `2026-06-01` |
| `effective_to` | `NULL` |
| `gl_account_id` | `83000000-0000-0000-0000-000000000004` (`P1API Output Tax`) |
| Retention | retained intentionally for future staging smoke because cancelled invoice lines reference the tax code |

Additional staging config prerequisite:

- `fiscal_periods` had open periods for `2026-05` and `2026-06`, but no `2026-07` period.
- First successful post used invoice date `2026-06-15`, but cancellation uses the current business
  period and failed while `2026-07` was missing.
- Inserted staging config period `2026-07` as `Open` using System Admin REST access so the supported
  cancel API could complete cleanup.
- This was a configuration-table insert only; no protected financial table was directly mutated.

### Positive invoice `tax_code_id` smoke

Several controlled attempts were made. Drafts from failed post attempts were deleted through the
supported invoice API before the final successful post/cancel run.

Final successful smoke:

| Check | Result |
| --- | --- |
| Invoice reference | `B9A-STAGING-SMOKE-20260701164400` |
| Invoice id | `ec03b20f-baae-4b28-99b4-5a166b3f825c` |
| Create invoice | HTTP 201 |
| Invoice date | `2026-06-15` |
| Real `tax_code_id` used | `d3a9f7f1-9d77-4cb5-b409-16cd5d91ca66` |
| Line amount | `100` |
| Server-calculated tax amount | `6` |
| Server-calculated total | `106` |
| Post invoice | HTTP 200 |
| Cancel invoice cleanup | HTTP 200 |
| Final invoice status | `Cancelled` |
| Final outstanding | `0` |

This confirms:

- frontend/API payload can carry a real lookup-backed `tax_code_id`;
- backend accepts a valid company-scoped, active, effective tax code;
- backend resolves the tax rate server-side;
- invoice create, post, and cancel remain operational through supported API/RPC-backed paths.

### Negative invalid `tax_code_id` smoke

Negative payload:

- syntactically valid but nonexistent `tax_code_id`: `ffffffff-ffff-4fff-8fff-ffffffffffff`

Result:

| Check | Result |
| --- | --- |
| Create invoice with invalid tax code | HTTP 400 |
| Error code | `VALIDATION_ERROR` |
| Persistent financial data from negative test | none |

### Cleanup result

Created financial smoke records:

- `INV-202607-00001`: draft create succeeded during a script-status handling issue; safely deleted
  through `DELETE /invoices/{id}` before posting.
- `INV-202607-00003`: draft create succeeded; post failed due missing GL/fiscal config; safely
  deleted through `DELETE /invoices/{id}`.
- `INV-202607-00004`: draft create succeeded; post failed due fiscal-period prerequisite; safely
  deleted through `DELETE /invoices/{id}`.
- `INV-202607-00005`: posted successfully and then cancelled successfully through supported APIs.

Final active financial balance from B9A staging smoke: none known; the final posted invoice is
`Cancelled` with `outstanding = 0`, and failed-post drafts were deleted through the supported invoice
API.

### Auto-allocation recheck

`POST /allocations/auto` returned HTTP 403 with `AUTO_ALLOCATION_DISABLED` after the tax-code smoke.

## Skips / conditions

- Browser-level frontend staging smoke was skipped because no staging/preview frontend deployment was
  performed in this task.

## Conclusion

Batch 9A staging deployment and API smoke result: **PASS**

The deployed staging Edge Functions are active, the read-only / negative smoke passed, and the
tax-code condition is closed. Batch 9A is ready for production deployment planning.
