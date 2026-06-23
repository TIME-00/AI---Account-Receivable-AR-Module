# Batch 8D Production Rollout Readiness Review

## 1. Review scope and result

- Review date: 2026-06-23 (Asia/Kuala_Lumpur).
- Commit reviewed: `e75b95803ea565d9b69819b3b2be16aaaef36d76`.
- Commit subject: `fix(functional): complete Batch 8C staging smoke`.
- Production project: `kusseuycqgdilychphpq`.
- Staging project: `gcdsdyegwjdcskpukqlq`.
- Batch 8B staging result: **PASS**.
- Batch 8C final staging result: **PASS**.
- Production rollout readiness: **READY WITH CONDITIONS**.

No production action was performed during this review. No deployment, migration, production smoke,
fixture execution, user change, or data mutation was performed.

## 2. Evidence reviewed

The following evidence files exist and record the completed staging validation:

- `docs/evidence/SPRINT_BATCH_8B_FINANCIAL_BOUNDARY_HARDENING_EVIDENCE.md`
  - migration 015 applied successfully to staging;
  - rollback-only SQL smoke passed;
  - API/security smoke passed;
  - read-only core regression passed;
  - `POST /allocations/auto` returned HTTP 403 `AUTO_ALLOCATION_DISABLED`;
  - no production action or persistent staging financial record resulted.
- `docs/evidence/SPRINT_BATCH_8C_FULL_STAGING_FUNCTIONAL_SMOKE_EVIDENCE.md`
  - initial Batch 8C result was PARTIAL;
  - Batch 8C-Fix1 passed;
  - Batch 8C-Fix2 passed;
  - final Batch 8C status is PASS;
  - invoice and receipt CSV/XLSX import passed;
  - core invoice, receipt, allocation, reversal, cancellation, dashboard, and reporting flows passed;
  - all test financial balances ended at zero in cancelled/reversed audit-safe states.

The Batch 8B evidence is append-only and its opening local-implementation status is historical. Its
final staging verification section records the authoritative PASS result.

## 3. Production rollout requirements

### 3.1 Database migration

Production requires:

- `database/015_financial_mutation_boundary_hardening.sql`

Migration 015 is required because production otherwise retains the pre-Batch 8B database boundary:

- authenticated direct financial-table DML privileges are not hardened;
- protected financial RPCs are not restricted to `service_role`;
- System Admin remains included in legacy broad operational access paths;
- hidden/deleted customer filtering is not enforced by the hardened RLS helper;
- journal-entry child access still depends on the older company-access boundary.

Migration 015 is transactional and changes helper functions, policies, grants, and revokes. It does
not change table shape, stored financial data, or financial RPC business logic.

Production must first verify that migrations through 014 are present and that migration 015 has not
already been applied. A broad migration push must not be used; apply only the reviewed migration.

### 3.2 Production use of 015b

Do **not** run `database/015b_financial_mutation_boundary_smoke_tests.sql` unchanged in production.

Although 015b runs inside a transaction and ends with `ROLLBACK`, it is explicitly marked for a
disposable/staging database. It inserts synthetic companies, users, customers, invoices, accounts,
and journals, and calls `post_invoice`. Transaction rollback was verified in staging, but executing
synthetic financial workflows in production is unnecessary risk and can still create operational
noise, lock contention, trigger/audit effects, or numbering gaps if future sequence behavior is not
fully transactional.

Use a separately reviewed production-safe verification script containing only:

- catalog checks for helper functions and policy definitions;
- `has_table_privilege` checks proving authenticated DML is revoked;
- `has_function_privilege` checks proving protected RPC execution is denied to `authenticated` and
  retained by `service_role`;
- read-only checks of existing role/policy metadata;
- negative API/REST checks against nonexistent UUIDs where no record can be changed.

Any transaction wrapper used in production must end with `ROLLBACK`, but rollback alone does not
make the full staging fixture script appropriate for production.

### 3.3 Edge Function rollout matrix

| Function | Production action | Reason |
| --- | --- | --- |
| `customers` | Required deploy | Bundles the changed shared authorization helper and contains hardened visible/non-deleted customer listing. |
| `invoices` | Required deploy | Contains draft mutation guards, correct missing-record handling, import-safe creation cleanup, and imported-draft delete protection. |
| `receipts` | Required deploy | Contains explicit operational read guards that deny System Admin while preserving allowed read roles. |
| `allocations` | Required deploy | Contains hardened preview authorization and missing-receipt handling; executable auto-allocation remains removed. |
| `reports` | Required deploy | Contains the operational read guard that permits Auditor and denies System Admin for aging and statement reads. |
| `imports` | Required deploy | Bundles invoice, receipt, allocation, customer, and shared-auth services; includes the staging-verified SheetJS dependency mapping. |
| `bank-accounts` | Verify, then deploy if absent or not at reviewed source | The frontend requires its read API. It was absent in staging until deployed. Production availability/version must be confirmed before release. |
| `credit-notes` | Deploy if currently deployed or externally reachable | Its bundle imports the changed `InvoiceService`; an old bundle would not contain the reviewed invoice guards and creation cleanup. |
| `debit-notes` | Deploy if currently deployed or externally reachable | Its bundle imports the changed `InvoiceService`; an old bundle would not contain the reviewed invoice guards and creation cleanup. |

No other function source changed in Batch 8B/8C. Before deployment, inventory production functions
and confirm whether `credit-notes` and `debit-notes` are deployed or routed. If they are not
deployed, leave them undeployed and record that decision. If they are deployed, they are part of
the coordinated rollout.

## 4. Recommended deployment order

Use one approved maintenance/change window with the exact production project ref visibly confirmed
before every command.

1. Verify the local commit, clean worktree, Supabase authentication, and target
   `kusseuycqgdilychphpq`.
2. Capture the current production migration state, affected function versions/bundle hashes, helper
   definitions, RLS policies, and grants.
3. Confirm fresh existing production credentials are available for at least one allowed operational
   role. Use existing Auditor and System Admin credentials only if they already exist; do not create
   or reset users for smoke testing.
4. Inventory production deployment status for `bank-accounts`, `credit-notes`, and `debit-notes`.
5. Deploy the reviewed Edge Function bundles first:
   - `customers`;
   - `invoices`;
   - `receipts`;
   - `allocations`;
   - `reports`;
   - `bank-accounts` if required;
   - `credit-notes` and `debit-notes` if currently exposed;
   - `imports` last.
6. Run function boot/health and read-only route checks before changing the database boundary.
7. Apply only `database/015_financial_mutation_boundary_hardening.sql`.
8. Run production-safe catalog/privilege verification immediately after migration.
9. Run the safe authenticated production smoke checklist in Section 7.
10. Record function versions, migration result, smoke results, and rollback decisions in production
    evidence.

Deploying the functions before migration is recommended because the reviewed services are compatible
with the existing database, while it minimizes the period in which migration 015 is active but old
service-role Edge Function bundles could still expose the previous API authorization behavior.
Migration 015 then atomically closes the direct database/RPC boundary.

Do not release unrelated frontend changes as part of this rollout.

## 5. Risk assessment

| Risk | Level | Production impact and mitigation |
| --- | --- | --- |
| Direct financial mutation boundary | High, intended security change | Authenticated clients lose direct financial DML and protected RPC execution. Confirm all supported mutation APIs use the service-role backend before migration; staging functional smoke already passed these flows. |
| System Admin operational access removal | Medium | Existing System Admin users will receive 403/empty operational access where broad reads previously worked. This is intentional. Notify operators and verify configuration/admin routes remain available. |
| Hidden/deleted customer filtering | Medium | Records linked to hidden/deleted customers will disappear from operational reads. Validate this matches production support procedures and retain admin/config handling separately. |
| Auditor reporting access | Low to medium | Auditor gains intended read-only access to aging/customer-statement reports while remaining denied from mutations. Verify with an existing production Auditor token if available. |
| Invoice draft mutation and delete behavior | Medium | Imported drafts referenced by `import_rows` now return HTTP 409 instead of deleting child lines and failing later. Import operators must post/cancel through the supported audit-safe flow. |
| Invoice creation cleanup | Medium | Failed header-plus-line creation now attempts cleanup before returning failure. Staging CSV/XLSX imports passed; monitor import error logs after rollout. |
| Allocation preview error handling | Low | Missing receipts now return 404 rather than 500. No allocation mutation behavior changed. |
| SheetJS dependency change | Medium | `imports` changes from the inaccessible SheetJS CDN package to pinned `https://esm.sh/xlsx@0.18.5?target=deno`. CSV and XLSX parsing passed staging, but this is an external runtime dependency and should be monitored for boot/fetch failures. |
| Bank account endpoint availability | Medium | Production must have `bank-accounts` deployed and active before receipt/import UI use. Verify rather than assume. |
| Credit/debit note bundle drift | Medium | These functions bundle `InvoiceService`. If deployed but omitted from rollout, their behavior will differ from the reviewed invoice function. Inventory and redeploy or explicitly keep them unavailable. |
| Existing production data compatibility | Medium | Migration 015 does not transform data, but changed visibility and privileges can alter what users see and which unsupported direct clients fail. Confirm there are no external clients using direct table/RPC mutation. |
| Customer-facing interruption | Medium | Coordinated function deployments and privilege changes can cause brief authorization inconsistency. Use a controlled window and complete the sequence without unrelated work. |

## 6. Rollback strategy

### 6.1 Before migration 015

- Record every affected production function version and bundle hash.
- Retain the exact previous production commit/source used for each function.
- If an Edge Function fails boot/read-only checks, redeploy its previous known-good version before
  applying migration 015.
- Do not continue to the database migration while any required function is unhealthy.

### 6.2 Migration execution failure

Migration 015 is wrapped in `BEGIN`/`COMMIT`. An error before `COMMIT` should roll back the migration
transaction. Verify the helper definitions, policies, and grants remain at their prior state before
retrying.

### 6.3 After migration commit

There is no reviewed automatic down migration. Prepare a separately reviewed compensating SQL
script before deployment if organizational rollback policy requires one. It must restore the exact
pre-deploy helper definitions, policies, and privileges captured from production.

Preferred response after a post-commit defect:

1. stop additional rollout activity;
2. determine whether the issue is in a function bundle or database privileges/policies;
3. use a forward fix where possible;
4. roll back an Edge Function to its recorded prior version only if that does not restore an
   authorization gap;
5. execute compensating database SQL only with explicit approval.

Blindly granting financial DML or financial RPC execution back to `authenticated` is not an
acceptable rollback. It would reopen the Batch 8A security findings. Database rollback must also
consider that older service-role functions may bypass RLS and reintroduce broad System Admin reads.

### 6.4 Verification evidence

Production evidence must capture:

- exact project ref;
- migration command/result;
- pre/post privilege and policy checks;
- each deployed function and version;
- smoke status by role without credentials;
- any rollback or forward-fix action;
- confirmation that no financial records or imports were created.

## 7. Minimum safe production smoke plan

The initial production smoke must be read-only or a guaranteed negative request. Do not create,
post, allocate, reverse, import, approve, reject, retry, or mutate a financial record without a
separately approved production functional-smoke plan.

Using an existing allowed operational role and the correct production company:

- `GET /reports/dashboard?trend_months=6` returns HTTP 200 and the live nested dashboard contract.
- `GET /invoices` returns HTTP 200.
- `GET /receipts` returns HTTP 200.
- `GET /allocations` or the established allocation-history route returns HTTP 200.
- `GET /reports/aging` returns HTTP 200 for Finance Manager or another allowed role.
- `GET /reports/aging` returns HTTP 200 for Auditor if an existing production Auditor token is
  available.
- `GET /reports/dashboard` and operational list routes return HTTP 403 for System Admin if an
  existing production System Admin token is available.
- `GET /imports` returns HTTP 200. Do not call upload, parse, validate, execute, review, approve,
  reject, or retry routes.
- `GET /bank-accounts` returns HTTP 200.
- `POST /allocations/auto` returns HTTP 403 with `AUTO_ALLOCATION_DISABLED`.

Production-safe boundary verification should additionally confirm:

- authenticated has no `INSERT`, `UPDATE`, or `DELETE` privilege on every protected table;
- authenticated cannot execute the six protected financial RPCs;
- service_role retains execution on those RPCs;
- no test should invoke a financial RPC happy path in production;
- negative REST mutation checks, if used, must target a nonexistent UUID and expect privilege
  denial before any mutation.

If required existing production credentials are unavailable, record those role-specific checks as
pending. Do not create users or reset passwords to satisfy this smoke.

## 8. GitHub dependency vulnerability warning

GitHub currently reports 22 dependency vulnerabilities. They were not investigated or changed in
Batch 8D, and `npm audit fix` must not be run as part of this rollout.

Create a separate **Batch 8E Dependency and Supply-Chain Security Audit** to:

- capture each advisory, severity, affected package, dependency path, and runtime/build exposure;
- distinguish frontend production dependencies from development-only dependencies;
- include Deno/Edge remote dependencies such as SheetJS, Supabase JS, and other pinned URLs;
- determine whether any critical/high advisory is exploitable in the deployed application;
- propose minimal upgrades with build, staging, and regression testing;
- avoid automatic major-version or lockfile rewrites.

Before Batch 8D production approval, perform at least a read-only advisory triage. If any
critical/high vulnerability is directly exploitable in the functions or frontend being rolled out,
resolve or explicitly risk-accept it before deployment. The untriaged count alone does not justify
an automatic dependency change inside Batch 8D.

## 9. Conditions before production deployment approval

Production rollout may proceed only after:

1. explicit user approval for production migration and function deployment;
2. confirmation that the production target is `kusseuycqgdilychphpq`;
3. pre-deploy function-version, RLS/helper, policy, and privilege snapshots are captured;
4. production migration state confirms 015 is pending and prior migrations are present;
5. affected function inventory resolves `bank-accounts`, `credit-notes`, and `debit-notes`;
6. required existing production tokens/company ID are available for read-only smoke, or unavailable
   role-specific checks are explicitly accepted as pending;
7. a production-safe verification script is reviewed instead of running 015b unchanged;
8. rollback/forward-fix commands and decision authority are prepared;
9. the 22 GitHub advisories receive read-only severity/runtime-exposure triage.

## 10. Final recommendation

**READY WITH CONDITIONS**

Batch 8B and Batch 8C have sufficient staging evidence for a controlled production rollout.
Migration 015 is required, the directly affected Edge Functions must be deployed, and any exposed
credit-note/debit-note bundles must be included because they embed the changed invoice service.
The full 015b staging fixture smoke must not be run unchanged in production.

After the conditions in Section 9 are satisfied, the next step is a separately approved production
rollout execution followed immediately by the read-only/negative smoke in Section 7.

No production action was performed during this review. No deployment, migration, smoke, fixture,
user change, or data mutation was performed.
