# Batch 9D-E1 Production Read-Only Preflight Evidence

**Execution dates:** 2026-07-20 through 2026-07-23 (Asia/Kuala_Lumpur)
**Gate:** Batch 9D-E1 production preflight and bounded RLS-remediation closure
**Current decision:** **PASS / GO** for Gate 9D-E1 only. Gate 9D-E2 remains separately unauthorized.

Sections 1–26 preserve the ordered historical preflight, remediation and NO-GO checkpoints. Section 27
is the authoritative current closure result and supersedes their current-state wording without erasing
their evidence.

## 1. Authorization and boundary record

- Production Supabase project inspected: `kusseuycqgdilychphpq` only.
- Production frontend inspected: `https://account-receivable-module.vercel.app/` using unauthenticated static GETs only.
- Staging project `gcdsdyegwjdcskpukqlq` was not contacted.
- No Edge Function was invoked. In particular, `daily-overdue`, `fx-rate-sync`, `fx-rates`, `allocations`, imports, financial routes, and all other Edge routes were not called.
- All SQL was `SELECT`-only. No migration, DDL, DML, deployment, scheduler action, credential action, user action, Git push, or Vercel mutation occurred.
- No API-key value, JWT, password, Authorization header, secret value, complete credential hash, or user email is recorded here.

## 2. Local Git identity

| Check | Result |
|---|---|
| Branch | `main` |
| `BATCH_9D_D_CODE_COMMIT` | `233005146f7e9551e45fc437fc7fcade678a9f62` |
| `RESOLVED_BATCH_9D_E_ROLLOUT_HEAD` | `c24249f037164edd8e08b3cf15f7180973a78c4d` |
| Code commit is rollout-HEAD ancestor | PASS |
| Intervening commit scope | Only the two approved Batch 9D-E planning documents |
| `origin/main` | `d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d` |
| Ahead / behind | 2 / 0 |
| Staged / unstaged tracked at entry | 0 / 0 |
| Non-social untracked at entry | 0 |
| Unrelated untracked `social-media/` paths | 18, untouched |

## 3. Production target identity

| Field | Sanitized result |
|---|---|
| Project ref | `kusseuycqgdilychphpq` |
| Project name | `Accounts Receivable (AR) module` |
| Organization | `jcbifvjojlzfppvamaas` |
| Region | `ap-southeast-1` |
| Status | `ACTIVE_HEALTHY` |
| PostgreSQL | 17.6.1.084, engine 17, GA |

Every Supabase production read used the literal approved project ref. No alias or staging ref was used.

## 4. Migration classification

Production exposes no application migration-history relation and the Management migration list is empty. Catalog inspection nevertheless made the candidate-set classification deterministic: all distinctive tables, columns, functions, triggers, indexes, constraints, and comments introduced by migrations 017-030 are absent, while older shared functions retain their pre-Batch definitions. No duplicate or partial candidate definition was found.

| Migration | Classification |
|---|---|
| `017_fx_reference_foundation.sql` | MISSING |
| `018_fx_reference_concurrency_hardening.sql` | MISSING |
| `019_fx_reference_transactional_fencing.sql` | MISSING |
| `020_fx_helper_rpc_privilege_hardening.sql` | MISSING |
| `021_fx_real_provider_identifier_support.sql` | MISSING |
| `022_fx_booking_rate_governance.sql` | MISSING |
| `023_fx_booking_rate_rpcs_and_immutability.sql` | MISSING |
| `024_fx_booking_decision_runtime_fix.sql` | MISSING |
| `025_fx_booking_decision_supersession_validation_fix.sql` | MISSING |
| `026_fx_booking_decision_import_origin_provenance_fix.sql` | MISSING |
| `027_batch_9d_d_authoritative_monetary_aggregation.sql` | MISSING |
| `028_linked_credit_note_reference_integrity.sql` | MISSING |
| `029_batch_9d_d_staging_runtime_defect_remediation.sql` | MISSING |
| `030_batch_9d_d_allocation_candidate_snapshot.sql` | MISSING |

No candidate was classified `PARTIAL_OR_DIVERGENT` or `UNKNOWN`.

## 5. PRODUCTION_MISSING_MIGRATION_MANIFEST

This is the immutable ordered E1 manifest. A future E2 may apply only this set, and only after the NO-GO findings in this evidence are resolved and E1 is rerun successfully.

| Order | Exact filename | Self-wrapped | Wrapper required | Non-transactional statement | Migration-time backfill | Compatibility preflight |
|---:|---|---|---|---|---|---|
| 1 | `017_fx_reference_foundation.sql` | yes | no | no | no | PASS — new empty foundation |
| 2 | `018_fx_reference_concurrency_hardening.sql` | yes | no | no | no | PASS — new empty foundation |
| 3 | `019_fx_reference_transactional_fencing.sql` | no | yes | no | no | PASS — wrapper required |
| 4 | `020_fx_helper_rpc_privilege_hardening.sql` | no | yes | no | no | PASS — wrapper required |
| 5 | `021_fx_real_provider_identifier_support.sql` | no | yes | no | no | PASS — provider-identifier violations 0 |
| 6 | `022_fx_booking_rate_governance.sql` | yes | no | no | **yes** | PASS — deterministic write set described below |
| 7 | `023_fx_booking_rate_rpcs_and_immutability.sql` | yes | no | no | no | PASS — DML is inside stored-function bodies |
| 8 | `024_fx_booking_decision_runtime_fix.sql` | yes | no | no | no | PASS — DML is inside stored-function bodies |
| 9 | `025_fx_booking_decision_supersession_validation_fix.sql` | yes | no | no | no | PASS |
| 10 | `026_fx_booking_decision_import_origin_provenance_fix.sql` | yes | no | no | no | PASS — DML is inside stored-function bodies |
| 11 | `027_batch_9d_d_authoritative_monetary_aggregation.sql` | yes | no | no | no | **FAIL — 128 baseline allocation-equation mismatches** |
| 12 | `028_linked_credit_note_reference_integrity.sql` | yes | no | no | no | PASS — all checked violation counts 0 |
| 13 | `029_batch_9d_d_staging_runtime_defect_remediation.sql` | yes | no | no | no | PASS — DML is inside stored-function bodies |
| 14 | `030_batch_9d_d_allocation_candidate_snapshot.sql` | yes | no | no | no | PASS — no pre-existing conflicting signature |

The source scan found no `CREATE/DROP INDEX CONCURRENTLY`, `VACUUM`, concurrent reindex, database creation/drop, or other identified non-transactional statement. Migrations 019-021 require an explicit transaction wrapper. Migration 022 is the only migration with top-level historical DML/backfill; DML text in other listed files is contained in function definitions.

## 6. Data compatibility

### Migration 022 expected governance write set

| Measure | Expected count |
|---|---:|
| Eligible historical invoices | 1,128 |
| Eligible historical receipts | 40 |
| Booking-decision rows | 1,168 |
| Decision-event rows | 1,168 |
| Invoice decision links | 1,128 |
| Receipt decision links | 40 |
| Invalid rate/company/currency/base-currency/date relationships | 0 |
| Duplicate or incompatible decision linkage | 0 |

The migration write set is limited to governance decisions/events and document decision-link fields. It does not rewrite booked monetary values.

### Other compatibility checks

- Migration 021 provider-identifier violations: 0 (the target tables are not yet installed and have no pre-existing rows).
- Migration 028 linked-credit-note violations: 0.
- Migration 028 debit-note-reference violations: 0.
- Active receipt allocations targeting a credit note: 0.
- Duplicate reversal relationships: 0.
- Receipt-version default incompatibilities: 0.
- `cn_allocations`: 0 rows, active count 0, allocated total 0.
- The future Migration 027 financial baseline is **not compatible with the required zero-mismatch gate**; see Finding E1-001.

## 7. Financial baseline fingerprints

All labels and hashes below are sanitized, deterministic evidence. No customer name or document identifier is included.

### Group A — immutable monetary baseline

| Relation | Rows | Sanitized totals | Row-hash prefix |
|---|---:|---|---|
| `invoices` | 1,128 | total 21,567,768.63; outstanding 18,829,604.77; base 21,568,942.95 | `81a24573ec582598` |
| `receipts` | 40 | amount 259,532.95; allocated 50,918.00; unallocated 207,625.95; base 260,697.95 | `c517f7e6ffbab0c6` |
| `allocation_details` | 26 | allocated 50,920.00; discount 10.00; base allocated 51,153.00 | `d728159859245cc6` |
| `cn_allocations` | 0 | allocated 0; active 0 | empty |
| `debit_notes` | 2 | total 2,200.00; outstanding 1,999.00; base 2,200.00 | `17e09e705f5962da` |
| `credit_notes` | — | relation not yet installed | not applicable |
| `journal_entries` | 112 | debit 804,147.95; credit 804,147.95 | `1c20d2bc349b44ec` |

### Group B — pre-Migration-022 governance baseline

The governance tables and document-link columns are not installed. Existing decision rows, event rows, invoice links, receipt links, missing/duplicate links, and relationship mismatches therefore all have a baseline of 0/not installed. The expected non-zero Migration 022 delta is recorded in section 6.

### Group C — tenant integrity baseline

- Active company count: 1; sanitized company label `c96589eefb08`.
- Per-company counts: customers 908, invoices 1,128, receipts 40, journal entries 112, active user roles 5.
- Per-company integrity hash prefix: `13501dd6d483fe07`.
- Invoice/customer, receipt/customer, allocation receipt/invoice, journal-line parent, role/company, and assignment/company ownership anomalies: 0.

### Allocation equation

Checked equation:

`invoice total - active allocation_details.allocated_amount - active allocation_details.discount_amount - active cn_allocations.allocated_amount = invoice outstanding`

Result: 1,116 governed invoice/debit-note rows checked; **128 mismatches**, all on `Paid` invoices. Open (971), Overdue (1), Partially Paid invoices (3), and the Partially Paid debit note (1) had zero mismatches. The 128 unexplained deltas total **2,681,703.31**. This violates the required zero-mismatch preflight.

## 8. Edge Function inventory

No function was invoked. Fourteen functions are ACTIVE; the two FX functions are absent.

| Function | State | Version | `verify_jwt` | Bundle identity prefix |
|---|---|---:|---|---|
| allocations | ACTIVE | 13 | true | `fe3d...a789` |
| auth | ACTIVE | 1 | true | `d79a...a9` |
| bank-accounts | ACTIVE | 2 | true | `de4b...ddf` |
| credit-notes | ACTIVE | 8 | true | `f035...8f3` |
| customers | ACTIVE | 14 | true | `b602...56c` |
| daily-overdue | ACTIVE | 6 | **false** | `4168...06f` |
| debit-notes | ACTIVE | 8 | true | `5a68...beb` |
| fx-rates | ABSENT | — | — | — |
| fx-rate-sync | ABSENT | — | — | — |
| imports | ACTIVE | 22 | true | `bd12...ff6` |
| invoices | ACTIVE | 20 | true | `dc99...d18` |
| lookups | ACTIVE | 1 | true | `e19a...a25` |
| notifications | ACTIVE | 1 | true | `94de...f72` |
| receipts | ACTIVE | 13 | true | `25d9...38e` |
| reports | ACTIVE | 12 | true | `5b20...f7a` |
| search | ACTIVE | 1 | true | `9dfe...e0` |

`journal-entries` is not a deployable Edge Function. Bundle inspection found the legacy shared database-key fallback in the deployed bundles; production does not yet contain the accepted modern-key-only deployment set.

## 9. Key and Edge-secret metadata

Values were not revealed or recorded.

- Legacy API-key mode: enabled; legacy anon and service-role keys remain enabled and were not changed.
- Modern publishable key named `default`: present.
- Modern secret key named `default`: present.
- Required dedicated secret key `batch_9d_d_edge_admin_20260718`: **absent**.
- Edge dictionary names `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS`: present.
- `BUSINESS_TIME_ZONE`: present.
- `CRON_SECRET`: absent.
- `FX_SCHEDULER_SECRET`: absent.
- `FX_SCHEDULER_COMPANY_ID`: absent.
- `OCR_PROVIDER`: absent.
- `OCR_PROVIDER_ENABLED`: absent.

These are expected E2 provisioning prerequisites, not authorization to create or change any key or secret.

## 10. `daily-overdue` caller and secret classification

- Server `CRON_SECRET`: **ABSENT**.
- Deployed bundle: historical pre-fix implementation. It contains the conditional `expectedSecret && suppliedSecret !== expectedSecret` behavior and the historical invalid-secret response; it does not contain `SCHEDULED_AUTH_NOT_CONFIGURED` or the accepted fail-closed validator.
- Function metadata: ACTIVE v6, `verify_jwt=false`.
- `pg_cron`: extension/job table absent; no caller.
- `pg_net`: extension absent; no caller.
- Database Webhooks/triggers: no caller.
- Database function references: no caller.
- Repository CI: no active workflow caller; the deployment document contains only generic setup examples.
- Vercel project metadata and repository configuration: no Vercel cron caller found.
- Pre-existing Edge logs (available 24-hour window): no `daily-overdue` invocation and no 5xx entry.
- External/manual caller: no active caller evidence was found in the authorized metadata and repository inventory.

**Selected future E2 branch: A (no caller, server secret absent).** E2 must provision the secret and deploy the accepted fail-closed bundle at the single canonical final-function step before any runtime probe. This selection authorizes nothing in E1. The vulnerable pre-fix bundle must never be restored after remediation.

## 11. Production smoke-identity readiness

Sanitized candidate metadata found five active password-provider users in the single production company:

| Label | Role | Assignment state | Readiness |
|---|---|---|---|
| `user-81ea375399` | AR Clerk | unassigned | candidate only; owner/use approval and credential custody unconfirmed |
| `user-d1f5942fa5` | AR Clerk | assigned to 2 customers | candidate only; owner/use approval and credential custody unconfirmed |
| `user-93b93a28e1` | AR Supervisor | general authenticated role candidate | candidate only; owner/use approval and credential custody unconfirmed |
| `user-8c2afc364c` | Finance Manager | Finance Manager | candidate only; owner/use approval and credential custody unconfirmed |
| `user-98e2897187` | Finance Manager | Finance Manager | candidate only; owner/use approval and credential custody unconfirmed |

Both AR Clerk candidates have an unassigned customer available for assignment-boundary smoke. Token acquisition would require existing, separately approved credential custody; no password reset, token minting, or login occurred in E1. Token lifetime was not exercised.

Only one active company exists, so an existing cross-tenant isolation pair cannot be supplied. Required identity readiness is therefore **NO-GO**.

> **SUPERSEDED (T1, §15.6).** The cross-tenant identity-pair requirement recorded above is **no longer an active production requirement**. Production legitimately has one active company, and **no second production company or user is created**. The authoritative production smoke identity set is **exactly four**: authenticated general user, Finance Manager, assigned AR Clerk, unassigned AR Clerk. Cross-tenant assurance is supplied by production structural RLS/ACL/company-scope proof, zero production ownership anomalies, and the accepted **staging** two-company runtime evidence — which remains staging evidence and is **never** described as production runtime evidence. **Still outstanding:** existing-account ownership and credential-custody approval before any later authorized Finance Manager and assigned/unassigned AR Clerk smoke. **No login is authorized.** `B9DE-E1-002` is therefore **PARTIALLY RESOLVED**, not closed.

## 12. Vercel readiness and static availability

| Check | Result |
|---|---|
| Project | `account-receivable-module` (`prj_w67qhKtacmd8QBLstmEhha5V2pcf`) |
| Team | `team_rbU2zHUrl9kvXl78tdSJnG3a` |
| Connected repository | `TIME-00/AI---Account-Receivable-AR-Module` |
| Production branch | `main` |
| Main-push production behavior | Confirmed from production deployment history |
| Current production deployment | `dpl_AV76EfprqNRdMChHHKpE1LPhDJJc`, READY |
| Current deployed Git SHA | `d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d` |
| Production URL | `https://account-receivable-module.vercel.app/` |
| Root static GET | HTML/Next assets available |
| Login shell static GET | HTML/Next assets and login content available |

The available read-only Vercel connector and deployment logs do not expose environment-variable names, and no local Vercel token/CLI is available. The required production names could not be independently confirmed:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_DEFAULT_COMPANY_ID`

No value was requested or revealed. This metadata gap blocks E1 readiness rather than being converted into an assumption.

## 13. Findings and decision at original E1 execution (historical status snapshot)

> The table below records the original E1 exit state. Individual finding statuses are superseded by the later E1A/T1 and manual Vercel checkpoints in §§15–16 and the current-status checkpoint in §17. The overall E1 `NO-GO` remains authoritative.

| ID | Severity | Evidence | Consequence | Required next action |
|---|---|---|---|---|
| B9DE-E1-001 | High | 128 `Paid` invoices fail the required allocation equation; unexplained delta 2,681,703.31 | Financial baseline cannot be certified before migration/backend rollout | Separately authorize a read-only financial-data diagnosis and, if needed, an explicitly controlled production remediation plan; then rerun E1 |
| B9DE-E1-002 | Material Medium | Production has one active company and no existing cross-tenant identity pair; candidate account use/credential custody is also unconfirmed | Required tenant-isolation smoke identities are unavailable | Separately authorize identity-readiness setup/approval without using customer-facing accounts, then rerun E1 |
| B9DE-E1-003 | Material Medium | Authorized Vercel metadata interfaces did not expose the four required production environment-variable names | Frontend deployment prerequisites cannot be certified | Provide a read-only Vercel environment-name inspection capability or independently record sanitized name-only proof, then rerun E1 |

Expected rollout deltas (14 missing migrations, two missing FX functions, modern-key provisioning, FX secrets, and the known vulnerable `daily-overdue` bundle) were recorded but not changed. The current vulnerable `daily-overdue` bundle remains a mandatory first-order E2 security remediation; E2 is not authorized while this E1 decision is NO-GO.

## 14. Final decision

**NO-GO — BATCH 9D-E1 PRODUCTION PREFLIGHT BLOCKED.**

No production or staging state was modified. At original E1 exit all three findings blocked progress. The governing prerequisites at that historical exit were: `B9DE-E1-001` had to close through a separately authorized F3-P5 PASS; `B9DE-E1-002` account ownership/credential custody had to be satisfied; `B9DE-E1-003` had to close; and the repeated E1 had to produce PASS. Later checkpoints supersede those individual statuses; §20 is authoritative. Gate 9D-E2 remains unauthorized.

## 15. Batch 9D-E1A Read-Only Blocker Diagnosis

**Diagnosis date:** 2026-07-20 (Asia/Kuala_Lumpur)
**Scope:** the three E1 blockers only. Production SQL remained `SELECT`-only; no Edge Function was invoked; staging was not contacted; no production or Vercel state was changed. The original E1 **NO-GO** above remains authoritative.

### 15.1 Financial reproduction

The E1 result reproduced independently with the same governed predicate and pre-aggregated active settlement evidence:

| Measure | Reproduced result |
|---|---:|
| Governed Invoice/Debit Note rows | 1,116 |
| Equation mismatches | 128 |
| Mismatch status | 128 `Paid`; every other status 0 |
| Invoice total | 2,681,703.31 |
| Outstanding | 0.00 |
| Active receipt allocations | 0.00 |
| Active settlement discounts | 0.00 |
| Active credit-note allocations | 0.00 |
| Equation delta | 2,681,703.31 |
| Oldest/newest document dates | 2026-03-04 / 2026-03-13 |

Equation reproduced:

`invoice total - active allocation cash - active allocation discount - active credit-note allocation = outstanding`

### 15.2 Deterministic mismatch classification

All 128 rows share one mutually exclusive primary classification:

| Primary category | Invoice count | Invoice total | Outstanding | Active allocations | Active discounts | Active CN allocations | Delta | Date range |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| **Unsupported system-loaded `Paid` header snapshot** | **128** | **2,681,703.31** | **0.00** | **0.00** | **0.00** | **0.00** | **2,681,703.31** | 2026-03-04 to 2026-03-13 |

Diagnostic dimensions below overlap that one primary population; they are not additional invoices:

| Required diagnostic | Count | Sanitized conclusion |
|---|---:|---|
| Paid with no `allocation_details` rows | 128 | All rows |
| Paid with reversed-only allocations | 0 | No allocation history of either status |
| Valid repository-supported alternative settlement | 0 | No qualifying evidence found |
| Historical/import row linkage | 0 | No `import_rows` or `import_batches` linkage |
| Documented opening-balance/fixture provenance | 0 | No documented opening-balance contract, marker, or fixture reference |
| Status persisted outside governed posting/allocation evidence | 128 | System/privileged load is the only evidence-compatible path; the exact earlier status is unknowable because invoice status history was not recorded |
| Receipt/allocation evidence absent | 128 | No receipt link can exist without an allocation record |
| Credit-note/debit-note settlement relationship | 0 | All are Invoices; no linked or standalone credit-note allocation |
| FX or rounding explanation | 0 | All are MYR at rate 1.000000; base parity passes and each delta equals the full invoice total |
| Duplicate/superseded explanation | 0 | No duplicate business-signature group, import duplicate link, or supersession evidence |
| Genuine unsupported financial-history state | 128 | Current header balance says settled, but no governed evidence supports how it was settled |

### 15.3 Settlement provenance trace

The following aggregate evidence applies to every mismatching row:

- `created_by`, `posted_by`, and `posted_at` are null; `version` remains 1.
- No invoice line exists. Consequently the governed `post_invoice` RPC could not have posted these rows: it requires at least one line, recalculates header totals from lines, creates the posting journal, sets `posted_by`/`posted_at`, advances the version, and initially sets status `Open` with `outstanding = total_amount` (`database/007_financial_rpcs.sql:218-250,455-465`).
- No original Invoice/Debit Note journal exists; posting debits and credits for the population are both zero.
- No receipt allocation, reversed allocation, discount, `cn_allocations` row, linked Credit Note, journal reversal, import row, import batch, or normalized import-allocation record exists.
- The allocation RPC always inserts `allocation_details` before reducing outstanding by cash plus discount and selecting `Paid` (`database/007_financial_rpcs.sql:818-874`). Reversal preserves that row as `Reversed` and restores cash plus discount (`database/007_financial_rpcs.sql:1030-1054`; hardened form at `database/028_linked_credit_note_reference_integrity.sql:2210-2236`). Neither evidence path exists here.
- Receipt import accepts only Open/Overdue/Partially Paid invoices with positive outstanding and executes settlement through the allocation service/RPC (`backend/supabase/functions/imports/service.ts:2574-2641,2733-2755`). It cannot explain these rows.
- All 128 were created on their document date and later share an `updated_at` window only **94.071 ms** wide. Production has no invoice-history trigger; its only invoice trigger is `trg_invoices_updated_at`. Therefore the exact pre-update status is unavailable, but the shape is deterministic evidence of a bulk privileged/system operation outside the governed lifecycle.
- They are part of a wider 1,050-row header-only system-loaded cohort: 922 Open invoices totaling 18,235,664.61 have `outstanding = total_amount`; the 128 Paid invoices totaling 2,681,703.31 have outstanding 0. All 1,050 lack invoice lines, application actors, posting timestamps, import linkage, original posting journals, allocation/CN history, and governed version advancement.
- The 128 cover 106 customers, have no duplicate business-signature group, use one currency (MYR), use exchange rate 1.000000, and have zero booked-base rounding anomaly.

This evidence supports one common cause: an undocumented historical/header snapshot was loaded or bulk-updated by a privileged/system path. It does **not** establish a valid opening-balance or legacy-settlement contract.

### 15.4 Financial classification — F3 PRODUCTION DATA DEFECT

**F3 — PRODUCTION DATA DEFECT.** The current monetary header values are internally simple (`Paid`, outstanding 0, MYR rate 1), but their settlement and posting provenance is unsupported. No repository contract authorizes a Paid invoice with no lines, posting metadata, posting journal, allocation/discount/CN evidence, import provenance, or immutable historical-settlement record. Treating the cohort as valid merely because it resembles a legacy snapshot would weaken the invariant without documentation.

Minimum future controlled-remediation-plan requirements:

1. Preserve a recovery checkpoint and the per-row/company financial fingerprints before any write.
2. Obtain authoritative external/source-ledger evidence for the 128 rows; do not invent receipts, allocations, discounts, credit notes, actors, or journals.
3. Define one reviewed, idempotent treatment per row: either record truthful immutable legacy-settlement provenance, or restore the document to the balance/status supported by source evidence.
4. Use a forward migration or governed remediation RPC with explicit actor, reason, source reference, company scope, and append-only audit evidence; no ad-hoc dashboard DML.
5. Reconcile invoice totals, outstanding, AR/control-ledger impact, status, customer/company ownership, and any linked journal evidence before and after.
6. Prove rerun safety, zero unexpected Group A delta, and zero unexplained rows before repeating E1.

No remediation was performed or authorized by E1A.

### 15.5 Migration 027 impact

The earlier manifest label “Migration 027 compatibility FAIL” is superseded by this more precise diagnosis:

- Migration 027 does **not** validate or depend on the settlement equation.
- It contains no migration-time update of invoices or historical settlement rows and does not recompute Paid invoices.
- Its aging/dashboard paths select stored `outstanding` only for Open/Overdue/Partially Paid Invoice/Debit Note rows with positive outstanding (`database/027_batch_9d_d_authoritative_monetary_aggregation.sql:136-155`).
- Its invoice-report aggregation separately reports stored current outstanding and stored document totals (`database/027_batch_9d_d_authoritative_monetary_aggregation.sql:495-544`).
- Therefore Migration 027 would install successfully, assuming its ordinary schema prerequisites, and the 128 Paid rows would not enter current-outstanding/aging totals.
- Migration 028 explicitly adds lifecycle enforcement prospectively without rewriting historical status or financial data (`database/028_linked_credit_note_reference_integrity.sql:41-55`).

**Conclusion:** the 128 rows do not technically block Migration 027 application and do not by themselves make Migration 027's current-balance RPC arithmetic incorrect. They remain a production financial-provenance defect that blocks E1 financial certification. A wording-only preflight correction is insufficient under F3; controlled data-resolution planning is required before E1 can pass.

### 15.6 Tenant-isolation recommendation — T1

**T1 — STRUCTURAL PRODUCTION + STAGING RUNTIME PROOF ACCEPTABLE.** Creating a second production tenant solely for testing would add disproportionate production identity and financial-data risk for this FYP.

Production structural evidence:

- RLS is enabled on companies, customers, invoices, receipts, allocation details, CN allocations, journals, imports, roles, and assignments.
- Production `rls_has_operational_read_access` checks authenticated active company membership; `rls_can_access_customer` additionally checks company ownership, visible/non-deleted state, and AR Clerk assignment. The source contract is explicit at `database/015_financial_mutation_boundary_hardening.sql:25-90`.
- Invoice/receipt/customer read policies compose those helpers (`database/015_financial_mutation_boundary_hardening.sql:127-148`), and direct authenticated INSERT/UPDATE/DELETE remains removed from protected financial tables.
- Production ownership-anomaly counts are zero for invoice/customer, receipt/customer, allocation receipt/invoice/customer, and assignment/customer company relationships.
- Accepted staging runtime evidence already covers the candidate/RPC tenant-negative matrix and assigned/unassigned Clerk rules (`docs/evidence/SPRINT_BATCH_9D_D_MULTI_CURRENCY_UX_AND_MONETARY_AGGREGATION_EVIDENCE.md:1644-1648,1677-1685`).

Exact E1 criterion amendment required:

1. Do not require creation of a second production company or user while production remains legitimately single-tenant.
2. Require production catalog proof of RLS, ACLs, company predicates, customer-assignment predicates, and service-only financial mutation boundaries.
3. Require zero production ownership anomalies, recorded per relationship.
4. Reuse the accepted staging cross-tenant runtime matrix as the runtime proof for two-company isolation.
5. In a later authorized authenticated smoke, use approved existing production identities to prove Finance Manager access plus assigned and unassigned AR Clerk behavior within the existing company.
6. Record account ownership/credential-custody approval before that smoke; do not create or reset users merely to satisfy the gate.

T1 resolves the need for a second production tenant, but it does not itself authorize authenticated smoke or establish custody of an existing account.

### 15.7 Vercel production environment-name verification

Exactly one E1A read-only project-metadata retrieval was attempted against Vercel project `prj_w67qhKtacmd8QBLstmEhha5V2pcf`. Project identity was confirmed, but the connected tool response does not expose environment-variable names. No Vercel CLI or local Vercel credential is available. This is a connector-capability limitation, **not evidence that any variable is absent**. No repeated retrieval was attempted.

Manual name-only verification procedure:

1. Open the Vercel Dashboard and select team/project `account-receivable-module` / `prj_w67qhKtacmd8QBLstmEhha5V2pcf`.
2. Open **Settings → Environment Variables**.
3. Filter/inspect the **Production** target only.
4. Verify that each exact name exists and includes Production: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL`, and `NEXT_PUBLIC_DEFAULT_COMPANY_ID`.
5. Do not reveal, copy, expand, export, or return any value. Do not provide a screenshot containing a value.
6. Return only a sanitized text checklist containing: project id/name, each variable name, `PRESENT`/`ABSENT`, Production target `YES`/`NO`, verification time, and reviewer identity/role. No value, prefix, hash, or screenshot is required.

### 15.8 Remaining blockers and exact next gate

1. **Financial:** F3 remains blocking. The 128-row cohort requires an explicitly authorized controlled production remediation plan based on truthful source-ledger evidence.
2. **Tenant readiness:** T1 is acceptable; the plan/E1 criteria must record the structural-production plus staging-runtime substitute, and existing production-account custody must be approved before later authenticated smoke.
3. **Vercel:** the four required Production environment names still need the sanitized manual name-only checklist above.

**Historical E1A next gate (completed and superseded by §§17–18):** request explicit authorization for a controlled production remediation plan for the F3 cohort. That planning gate incorporated the T1 criteria amendment and sanitized Vercel name-only checkpoint without mutating production; its then-proposed independent Rev 2 review and subsequent F3-P1/P2/P3 work have completed. The current next action is the independent read-only review recorded in §18. Gate 9D-E2 remains unauthorized, and the original E1 decision remains **NO-GO** until a repeated E1 passes.

## 16. Batch 9D-E1 Manual Vercel Name-Only Verification

**Method:** manual sanitized inspection performed by the project owner in the Vercel Dashboard, following the §15.7 procedure. **No connector, CLI, API call, or automated retrieval was used by this record, and no Vercel state was changed.**

| Attestation field | Value |
|---|---|
| Vercel project name | `account-receivable-module` |
| Target filter inspected | **Production** |
| Verification time | **2026-07-20 18:56 MYT** |
| Reviewer role | **Project owner** |

**Name-only results — authoritative:**

| # | Variable name | Presence | Production target |
|---|---|---|---|
| 1 | `NEXT_PUBLIC_SUPABASE_URL` | **PRESENT** | **YES** |
| 2 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **PRESENT** | **YES** |
| 3 | `NEXT_PUBLIC_API_BASE_URL` | **PRESENT** | **YES** |
| 4 | `NEXT_PUBLIC_DEFAULT_COMPANY_ID` | **PRESENT** | **YES** |

The Vercel UI displayed the required variables with **Production** included in their target configuration.

**Value-handling attestation.** **No environment-variable value was inspected, opened, copied, expanded, exported or recorded.** This record contains no value, no value prefix or suffix, no hash, no screenshot, no token, no key, and no URL contained inside any value.

**Scope.** This checkpoint covers exactly the four required runtime variables. `NEXT_PUBLIC_DEMO_USER_ROLE` and `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID` are **outside** it; they were neither verified nor changed, and must not be modified or removed.

**Finding status:** **`B9DE-E1-003` — CLOSED by sanitized manual name-only verification.** The §15.7 result remains correctly characterised as a **connector-capability limitation**, never as variable absence.

> **This closure does NOT change the Gate 9D-E1 decision.** `B9DE-E1-001` (**F3 — PRODUCTION DATA DEFECT**, High) remains **OPEN**; `B9DE-E1-002` is **PARTIALLY RESOLVED** (T1 accepted; existing-account ownership and credential custody still pending). **Gate 9D-E1 remains `NO-GO — BATCH 9D-E1 PRODUCTION PREFLIGHT BLOCKED`. Gate 9D-E2 remains unauthorized. No production mutation occurred during this Vercel name-only checkpoint; the later separately authorized F3-P4 reset is recorded in §19.**

## 17. F3 remediation-plan technical correction checkpoint (historical; superseded by §§19–20)

**Date:** 2026-07-20 (Asia/Kuala_Lumpur)
**Scope:** local documentation only. No production/staging/Vercel/Git remote was contacted; no SQL, Edge Function, migration, login or remediation was executed.

The Rev 2 F3 plan at `docs/plans/BATCH_9D_E1_F3_PRODUCTION_FINANCIAL_REMEDIATION_PLAN.md` now requires:

- an exact company + invoice-ID manifest, deterministic ordering, exact PostgreSQL `NUMERIC` arithmetic and canonical SHA-256 row/cohort/dependency fingerprints;
- one short `SERIALIZABLE` P4 transaction with local timeouts, deterministic `FOR UPDATE` locks, post-lock revalidation and all-or-nothing commit;
- strict P2 separation of raw mismatch, externally explained historical state and unexplained mismatch, with no fabricated settlement and no broad exclusion from monetary populations;
- append-only correction by superseding/revocation events rather than deletion;
- purpose-specific RLS/ACL/owner/grant/search-path constraints for any new relation or RPC;
- a 34-case local P3 implementation/security/transaction test matrix;
- optional, separately authorized schema-only F3-P3S where needed; F3-P4 remains data-remediation-only.

**Status at this historical checkpoint:** `B9DE-E1-001` **OPEN** until a separately authorized F3-P5 repeated E1 passed; `B9DE-E1-002` **PARTIALLY RESOLVED** (T1 accepted; account ownership/credential custody pending); `B9DE-E1-003` **CLOSED**. Gate E1 remained **NO-GO** and Gate E2 remained unauthorized.

**Current local documentation worktree:** branch `main`; HEAD `c24249f037164edd8e08b3cf15f7180973a78c4d`; `origin/main` `d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d`; ahead 2 / behind 0; staged 0; two tracked plan files modified; this evidence and the F3 plan are untracked Batch documents; 18 unrelated `social-media/` paths remain untouched. The original E1 entry-state row in §2 remains a historical entry snapshot and is not a claim that the current worktree is clean.

## 18. F3-P1 provenance decision and F3-P2/P3 local reset implementation (historical; superseded by §§19–20)

**Date:** 2026-07-20 (Asia/Kuala_Lumpur)

**Authority boundary:** Production `SELECT`-only discovery and local implementation/tests were authorized. No Production mutation, staging/Vercel/frontend/Edge contact, migration, deployment, credential, scheduler, identity, commit, push or stage action occurred.

### 18.1 Provenance decision

F3-P1 completed read-only. Together with the deterministic discovery, the owner/data custodian attests that all current Production AR business records are synthetic test/demo/smoke data and not real customer receivables or settlements. The formal outcome is **P1 — SYNTHETIC / DEMO DATA**. It is not P2 historical-state treatment or P3 lifecycle correction.

### 18.2 Exact retention and deletion manifests

The fixed retention policy has exactly ten principal scenario anchors. Dependency closure retains 179 database rows: 11 customers, 16 invoices, 14 invoice lines, 11 receipts, 13 allocations, 25 journal entries, 50 journal lines, six import batches, six import files, 20 import rows and seven import-row allocations. No CN allocation exists to preserve; none was fabricated. The full ordered retention SHA-256 is `36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0`.

The deletion manifest contains 2,651 database rows with full ordered SHA-256 `cfa7d6d7bc739bd190fb14a2e8bb680dc473fbe1e678db1b1235f07e9b75cb7d`. It contains all 128 defective `Paid` invoices (total `2681703.31`, outstanding `0.00`) and all 922 separately authorized non-retained header-only `Open` invoices (total/outstanding `18235664.61`). It also contains every non-retained receipt and every reviewed non-retained dependency by exact ID.

Six Storage objects are retained. Sixty-three non-retained objects have ordered `bucket|name` SHA-256 `f77add7cc35df009832237db3083c1db63a65eb0d8477aa1b5fd0e6fa7551094`; names were not copied into this evidence. Storage deletion is not transactionally coupled to PostgreSQL and therefore remains a separately bounded, exact-manifest, retryable post-database step in a future authorized F3-P4.

### 18.3 Source-file dry-run result

The actual `database/operators/batch_9d_e1_f3_test_data_reset_manifest.sql` was executed against Production with an explicit read-only transaction and final rollback. It returned:

- state `READY`;
- principal scenarios 10; matching per-scenario hashes 10;
- retained rows 179; deletion rows 2,651;
- defective `Paid` count 128 and header-only `Open` count 922;
- retained settlement-equation mismatch count 0;
- unclassified FK count 0;
- target lifecycle trigger count 0;
- exact database and Storage hashes equal to the local approved constants.

An earlier malformed file-transfer attempt was rejected by PostgreSQL at line 1 with a syntax error before any statement ran; it did not enter a transaction and changed nothing. The corrected invocation passed only the SQL file content. Every successful Production statement in this gate was read-only.

### 18.4 Local implementation and governing status

The dry-run SQL, unexecuted apply SQL, 40-case Deno contract suite and execution runbook are local artifacts only. The apply artifact is not a migration, installs no RPC, accepts no generic predicate, requires postgres plus the exact manifest binding, uses a bounded `SERIALIZABLE` transaction and deterministic locks, and aborts if lifecycle triggers, company scope, counts, monetary values, hashes, dependencies or protected-state hashes drift.

No P3S is presently required because the target lifecycle triggers are not installed. The apply operator does not disable triggers and becomes unusable if they appear; that outcome requires STOP and separate P3S authorization. The operator has not been executed.

At this historical checkpoint, `B9DE-E1-001` remained **OPEN** until Production cleanup and F3-P5; `B9DE-F3-P1-001` was incorporated into the expanded reset but not yet closed. `B9DE-E1-002` remained **PARTIALLY RESOLVED** under T1; `B9DE-E1-003` was **CLOSED**. Gate E1 remained `NO-GO — BATCH 9D-E1 PRODUCTION PREFLIGHT BLOCKED`; Gate E2 remained unauthorized. §§19–20 record the later execution and current result.

## 19. F3-P4 controlled Production test-data reset execution

**Date:** 2026-07-21 (Asia/Kuala_Lumpur)

**Target:** Production project `kusseuycqgdilychphpq`, company `00000000-0000-0000-0000-000000000001` only.
**Supersession:** this section is the authoritative post-execution checkpoint and supersedes only the unexecuted/future-state wording in §18; the historical P1 discovery and implementation evidence remains valid.

### 19.1 Entry and dry-run evidence

The reviewed local artifacts passed the 40-case contract suite, Deno check, Deno format check for the TypeScript contract, `git diff --check`, integrity, conflict and secret scans. The mandatory Production manifest execution ran inside an explicit read-only transaction and returned exact state `READY`: ten principal anchors, ten matching scenario hashes, 179 retained rows, 2,651 deletion rows, zero retained settlement mismatches, zero unclassified FKs and zero target lifecycle triggers. Counts, exact `NUMERIC` totals and all approved database/Storage hashes matched before mutation.

### 19.2 Database transaction and deletion evidence

The approved postgres-only apply operator ran exactly once using its exact non-secret authorization binding. Its guarded `SERIALIZABLE` transaction committed successfully; no assertion, lock, timeout, hash, count, financial, dependency or protected-state check failed. It was not rerun during recovery.

| Relation | Deleted rows |
|---|---:|
| Customers | 897 |
| Invoices/documents | 1,112 |
| Invoice lines | 61 |
| Receipts | 29 |
| Allocation details | 13 |
| Journal entries | 87 |
| Journal entry lines | 174 |
| Import batches | 63 |
| Import files | 63 |
| Import rows | 139 |
| Import-row allocations | 3 |
| OCR decisions | 10 |
| CN allocations | 0 |
| Customer-bank rows | 0 |

The full deletion manifest row count was 2,651 with approved SHA-256 `cfa7d6d7bc739bd190fb14a2e8bb680dc473fbe1e678db1b1235f07e9b75cb7d`. It removed all 128 defective `Paid` invoices (pre-reset total `2681703.31`, outstanding `0.00`) and all 922 non-retained header-only `Open` invoices (pre-reset total/outstanding `18235664.61`). Both populations have zero rows remaining.

### 19.3 Database after-state

Fresh read-only checks after commit and again after Storage cleanup returned `ALREADY_APPLIED` and confirmed:

| Retained state | Count |
|---|---:|
| Principal scenario anchors | 10 |
| Full retained graph | 179 |
| Customers | 11 |
| Invoices/documents | 16 |
| Invoice lines | 14 |
| Receipts | 11 |
| Allocation details | 13 |
| Journal entries / lines | 25 / 50 |
| Import batches / files / rows / row allocations | 6 / 6 / 20 / 7 |

Retained exact monetary totals are: invoices `314889.16` total, `262792.16` outstanding and `316054.16` base; receipts `50587.00` received, `50386.00` allocated and `200.00` unallocated; allocation details `50388.00` cash, `10.00` discount and `50621.00` base. The retained database hash is exactly `36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0`. Retained settlement mismatches, unclassified FKs and target lifecycle triggers are zero. The transaction's protected-state before/after assertions passed; company, auth, role, assignment and immutable audit state were outside the deletion surface or explicitly fingerprint-protected. No RLS, grant, schema or configuration mutation occurred.

### 19.4 Storage execution and recovery

The approved Storage delete set contained 63 exact objects with manifest hash `f77add7cc35df009832237db3083c1db63a65eb0d8477aa1b5fd0e6fa7551094`. Following interruption of an earlier overlong client process, recovery first reconfirmed the committed database after-state and re-listed Storage read-only. It then deleted only remaining approved exact keys in bounded batches of at most five, with an explicit HTTP timeout and immediate read-only count/hash verification after each batch. Missing approved keys were treated as already successful. No prefix, wildcard, folder or bucket-wide delete was used.

Final Storage verification found zero approved delete objects remaining. Exactly six retained objects remain with approved hash `b5f58c7c85358da973280bf4e59f5862944e451f50cd521cd6f7c05139468620`. Because the pre-delete bucket held exactly the approved 63-delete plus six-retain sets, and the final listing is exactly the six retained objects with the unchanged hash, no unapproved object was deleted. Full object names and credentials are not recorded.

### 19.5 Authorization boundary and governing status

Only the exact Production project was mutated. No staging, Vercel, frontend, Edge Function or GitHub remote was contacted; no migration, DDL, scheduler, credential, key, secret, identity, company, role, assignment, Git stage, commit or push action occurred. Local HEAD and `origin/main` remained unchanged.

`B9DE-F3-P1-001` is **CLOSED** by the exact expanded reset. `B9DE-E1-001` remains **OPEN** until F3-P5 repeats Gate E1 successfully. `B9DE-E1-002` remains **PARTIALLY RESOLVED** under T1 and `B9DE-E1-003` remains **CLOSED**. Gate E1 remains `NO-GO — BATCH 9D-E1 PRODUCTION PREFLIGHT BLOCKED`; Gate E2 remains unauthorized. F3-P5 did not begin.

> **Historical F3-P4 exit status, superseded by §20.** The statement above was accurate when F3-P4 exited. F3-P5 has since completed read-only; §20 is the authoritative current result.

---

## 20. F3-P5 repeated Production read-only preflight — 2026-07-21

### 20.1 Authorization, target and safeguards

The authorized target was Production project `kusseuycqgdilychphpq`, company `00000000-0000-0000-0000-000000000001`. Every SQL execution was preceded by exact project-ref confirmation and ran inside an explicit read-only transaction with a local statement timeout. Statements were catalog or data `SELECT` queries only and ended with `ROLLBACK`; no RPC, stored procedure, Edge Function or application route was invoked. Staging, Vercel, the frontend and GitHub remotes were not contacted.

The local rollout identity remained `c24249f037164edd8e08b3cf15f7180973a78c4d` on `main`, ahead 2 / behind 0 from unchanged `origin/main` `d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d`. No stage, commit or push occurred.

### 20.2 Fresh F3-P4 after-state

Fresh, independent recomputation returned `AFTER_STATE_MATCH`:

| Check | Result |
|---|---:|
| Principal anchors / matching scenario hashes | 10 / 10 |
| Full retained graph | 179 |
| Customers | 11 |
| Invoices / invoice lines | 16 / 14 |
| Receipts / allocation details | 11 / 13 |
| Journal entries / lines | 25 / 50 |
| Import batches / files / rows / row allocations | 6 / 6 / 20 / 7 |
| OCR decisions | 0 |
| Deletion-manifest rows remaining | 0 |
| Former defective `Paid` cohort count / amount | 0 / `0.00` |
| Former non-retained header-only `Open` cohort | 0 |
| Approved Storage delete objects remaining | 0 |
| Retained Storage objects | 6 |
| Retained settlement mismatches | 0 |

The retained database hash remains exactly `36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0`. Retained Storage remains exactly six objects with approved hash `b5f58c7c85358da973280bf4e59f5862944e451f50cd521cd6f7c05139468620`. Full object names are not recorded.

Exact `NUMERIC` retained totals also match the F3-P4 contract: invoices `314889.16` total, `262792.16` outstanding and `316054.16` base; receipts `50587.00` received, `50386.00` allocated and `200.00` unallocated; allocation details `50388.00` cash, `10.00` discount and `50621.00` base.

### 20.3 Full financial certification

All 16 retained documents were included in the raw settlement equation without a broad status exclusion or tolerance. All active and settled document rows balance exactly. Raw lifecycle differences are:

| Lifecycle class | Rows | Absolute amount | Classification |
|---|---:|---:|---|
| Draft | 2 | `1700.00` | Explained pre-posting: outstanding zero, no posting/settlement activity, line/subtotal/tax/total/base arithmetic consistent |
| Cancelled | 1 | `1.00` | Explained reversal: cancellation metadata present, no active settlement, original/reversal journals linked and balanced |
| Bounced receipt | 1 | `1.00` | Explained reversal: allocated and unallocated zero, no active allocation, reversal journal and credit-control evidence present |

Unexplained document mismatch count and amount are `0 / 0.00`; unexplained receipt mismatch count and amount are `0 / 0.00`. This is lifecycle classification backed by installed schema and dependency evidence, not an exclusion used to manufacture PASS.

Receipt stored/active/base arithmetic, active-versus-reversed allocation handling, discounts, credit-note allocations, journal debit/credit and base-currency equality, exchange-rate precision and invoice/receipt base calculations all pass. Allocation details comprise 11 active and two reversed rows; reversed rows have complete reversal metadata. All reviewed allocation amount/rate/base/forex and company/customer/document checks have zero anomaly.

### 20.4 Dependency, tenant and security integrity

The aggregate orphan count is zero across invoice lines, allocations, credit-note allocations, journal lines and accounts, journal reversal links, invoice references, import rows/allocations/files/batches, duplicate links, OCR decisions, customers and assignment relationships. The Production project contains exactly one active company and no scoped AR row outside the expected company.

All 16 reviewed company-scoped tables have RLS enabled and tenant-bound policies; missing RLS, missing-policy and unconditional-policy counts are zero. T1 — **STRUCTURAL PRODUCTION + STAGING RUNTIME PROOF ACCEPTABLE** — therefore remains accepted. The staging two-company proof remains described only as staging evidence. No second Production tenant, fifth identity or login was introduced.

Sanitized metadata shows existing candidates for all four required Production smoke identity types (general authenticated user, Finance Manager, assigned AR Clerk and unassigned AR Clerk), with zero company/assignment linkage anomaly. Metadata cannot prove credential custody, and no explicit project-owner custody attestation was supplied. `B9DE-E1-002` therefore remains **PARTIALLY RESOLVED**.

### 20.5 Migration 027 and Batch 9D-D readiness

Production migration-history metadata is unavailable as an installed relation, so the 027 classification is catalog-derived rather than history-derived. The six Migration 027 routines are absent, no conflicting routine or blocking relation exists, all required tables and columns are present, data-assumption violation count is zero, and the required database role and `auth.uid()` dependency exist. Migration 027 is deterministically **MISSING** and technically installable at a later separately authorized gate. It was not installed here and it does not rewrite historical invoices.

The four accepted Phase A file hashes remain exact. The 12-case allocation candidate contract passed locally, and accepted source still returns `AUTO_ALLOCATION_DISABLED` for `/allocations/auto`. No accepted Batch 9D-D source file changed.

### 20.6 Vercel checkpoint and credential finding

`B9DE-E1-003` remains **CLOSED** from the previously accepted sanitized name-only verification of the four required Production environment names. Vercel was not contacted and no value was inspected in F3-P5.

A Supabase personal access token was disclosed in conversation immediately before this gate. It was treated as compromised, was not used for F3-P5, and is not reproduced or stored in repository evidence. Its revocation/replacement and old-token rejection have not been verified. New finding `B9DE-E1-004` is therefore **High / OPEN** and requires a separately authorized credential-incident action.

### 20.7 Current finding matrix and decision

| Finding | Severity | Current state | Basis / next requirement |
|---|---|---|---|
| `B9DE-F3-P1-001` | Expanded cleanup concern | **CLOSED** | Exact F3-P4 reset complete; F3-P5 after-state exact |
| `B9DE-E1-001` | High | **OPEN by whole-gate closure rule; technically remediated** | Financial/data checks pass with zero unexplained mismatch; formal closure waits for a complete repeated E1 PASS |
| `B9DE-E1-002` | Material Medium | **PARTIALLY RESOLVED** | T1 and four metadata candidates pass; sanitized owner credential-custody attestation remains absent |
| `B9DE-E1-003` | Material Medium | **CLOSED** | Prior sanitized Vercel name-only checkpoint preserved |
| `B9DE-E1-004` | High | **OPEN** | Disclosed personal access token has no verified revocation/replacement or rejection proof |

Financial and data-integrity certification passes, but the complete gate cannot pass while a High credential finding remains open and identity custody is unattested. Final decision:

`NO-GO — BATCH 9D-E1 F3-P5 REPEATED PRODUCTION PREFLIGHT BLOCKED`

Gate E2 remains unauthorized. This evidence grants no authority for credential action, identity action, migration, deployment, production mutation, stage, commit or push.

---

## 21. Ephemeral Production smoke identity closure attempt — 2026-07-22

### 21.1 Authorization and Git/Production baseline

The owner explicitly authorized one Production-only create/authenticate/read-only-test/destroy lifecycle for exactly four temporary identity categories. The authorization excluded Gate E2, migrations, business-data mutation, Storage writes, deployment, credential/key/secret changes, staging, Git stage, commit and push.

The verified local baseline was `main` at `c24249f037164edd8e08b3cf15f7180973a78c4d`, with unchanged `origin/main` `d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d`, ahead/behind `2/0` and staged paths `0`. Status checks excluded `social-media/**`; those paths were not inspected or modified. The connected project was exactly Production `kusseuycqgdilychphpq`, healthy in `ap-southeast-1`; the sole company was exactly `00000000-0000-0000-0000-000000000001`.

### 21.2 Recovery scan and application identity topology

Sanitized aggregate inspection before any proposed creation returned:

| Check | Result |
|---|---:|
| Prior `b9de-e1-ephemeral-*` Auth runs | 0 |
| Existing non-ephemeral Auth users | 5 |
| Existing roles / assignments | 5 / 2 |
| Profile-like application tables | 0 |
| Roles without Auth user | 0 |
| Assignments without Auth user/customer | 0 / 0 |
| Assignment/company mismatch | 0 |
| Companies / target company | 1 / 1 |

Source and Production topology agree: the application has no separate profile table. The minimum application identity is the Auth user; company authorization is represented only by `public.user_roles`, and Clerk scope only by `public.user_customer_assignments`. The intended synthetic identity design remained exactly: general user with no business role; one active Finance Manager role; two active AR Clerk roles; exactly one assignment on the assigned Clerk and zero on the unassigned Clerk.

### 21.3 Supported Admin-interface availability and safe stop

Current Supabase guidance was checked before execution: Admin user creation/deletion requires the server-side Admin interface; server clients must disable session persistence/refresh; global sign-out revokes refresh sessions but does not immediately invalidate an already-issued access JWT. The cleanup design therefore preserved old access tokens only for bounded post-cleanup negative reads.

The available Supabase connector exposed project/database metadata, SQL and publishable-key operations, but no Auth Admin create/delete/session-revocation operation. Production exposed no supported database-side Auth Admin function, no safely usable transient server-side Admin credential was available to the runner, and browser automation was unavailable. Direct writes to `auth.users`, retrieval/export of a service secret, use of the previously disclosed PAT, an Edge deployment, or a schema workaround would have violated the gate. The workflow therefore stopped before generating credentials, allocating a Production run ID, or creating any Auth/application identity.

This is a failed-safe pre-mutation stop, not an implementation defect in the application and not an RLS result.

### 21.4 Fresh immutable Production baseline

Read-only recomputation matched the retained F3-P4 state exactly:

| Check | Result |
|---|---:|
| Principal anchors present | 10 |
| Retained graph | 179 |
| Customers | 11 |
| Invoices / lines | 16 / 14 |
| Receipts / allocations | 11 / 13 |
| Journals / lines | 25 / 50 |
| Imports: batches / files / rows / row allocations | 6 / 6 / 20 / 7 |
| Former 128 / 922 cohorts | 0 / 0 |
| Invoice / journal unexplained mismatches | 0 / 0 |
| Receipt unexplained mismatch | 0 |
| Storage objects | 6 |

The database hash remained `36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0`; Storage remained `b5f58c7c85358da973280bf4e59f5862944e451f50cd521cd6f7c05139468620`. Monetary totals remained invoices `314889.16 / 262792.16 / 316054.16`, receipts `50587.00 / 50386.00 / 200.00`, and allocations `50388.00 / 10.00 / 50621.00`. One raw receipt arithmetic difference was the previously accepted Bounced lifecycle; its two allocations remained reversed with complete reversal evidence, producing zero unexplained receipt mismatch. No temporary user owned a Storage object.

### 21.5 Identity/test/cleanup result and finding decision

| Lifecycle item | Result |
|---|---:|
| Temporary Auth users created | 0 |
| Temporary roles created | 0 |
| Temporary assignments created | 0 |
| Temporary sessions/tokens created | 0 |
| Authenticated role/RLS requests executed | 0 |
| Temporary rows requiring cleanup | 0 |
| Ephemeral Auth/profile/role/assignment residue | 0 / 0 / 0 / 0 |
| Ephemeral Storage residue | 0 |
| Existing identity rows changed | 0 |
| Business/Storage rows changed | 0 / 0 |

Because all four identities were not created and authenticated, no general-user denial, Finance Manager visibility, Clerk isolation, global sign-out, Admin deletion or old-token negative-access proof exists. `B9DE-E1-002` therefore remains **PARTIALLY RESOLVED**, not closed. The approved ephemeral strategy supersedes long-lived credential custody in principle, but only a later fresh run through a supported Admin interface can supply the missing runtime proof.

`B9DE-E1-004` remains **High / OPEN**. The disclosed PAT was not used, inspected, copied, revoked or modified. Gate E2 remains unauthorized. No staging, Vercel, Edge Function, migration, scheduler, deployment, GitHub remote, stage, commit or push action occurred.

Final decision:

`FAIL  B9DE-E1-002 EPHEMERAL PRODUCTION SMOKE IDENTITY LIFECYCLE INCOMPLETE`

## 23. Corrected ephemeral Production RLS lifecycle — PASS (2026-07-22)

This section supersedes the historical records in §24 as the current `B9DE-E1-002` outcome while retaining every earlier attempt
as historical evidence. The Production target, Git identity and mutation boundary were unchanged.

### 23.1 Authoritative visibility contract

Fresh read-only reconciliation covered installed `public.rls_can_access_customer`, `cust_select`,
`inv_select`, `rct_select`, Migration 015, its 015b contract tests, backend shared visibility helpers,
customer/invoice/receipt services and current plans. Every authoritative current source agrees:
`is_deleted = true` and `is_hidden = true` customers are excluded from normal operational reads before
the Finance Manager or AR Clerk branch; an assignment does not override that exclusion. Migration 010
defines hidden rows as retained audit evidence that is absent from client-facing prototype visibility.

Physical retention and operational RLS visibility are therefore separate contracts:

| Contract | Customers | Invoices | Receipts | Principal anchors |
|---|---:|---:|---:|---:|
| Physical retained graph | 11 | 16 | 11 | 10 |
| Policy-eligible operational visibility | 2 | 7 | 7 | 5 |

The two eligible customer coverage vectors were exactly `1/6/7/4` and `1/1/0/1`. Deterministic
ordering by anchors, invoices, receipts and UUID selected anonymized customer hash
`cdb24c3bfeae8c95796397752131de8f42c0c9a894d45bf87da545d512584c1b`, with exact selected coverage
`1/6/7/4`. No customer name or complete record is retained.

### 23.2 Capability, provisioning and authentication

Both process variables were present, the credential type was supported, and server-side Admin
`listUsers` passed. No credential material is recorded. Git was `main` at
`c24249f037164edd8e08b3cf15f7180973a78c4d`, origin/main
`d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d`, ahead/behind `2/0`, staged `0`.

Sanitized run-ID hash:
`bff6dff0bdb4c8c8c2c19994d598911cde05f1d359943da0ff9fe70991732c03`.
Exactly four users were created: general `4081e2d9e164`, Finance Manager `e747ab85ac7f`, assigned Clerk
`c14691c802c5`, unassigned Clerk `c818a74e5b54` (sanitized user-ID hash prefixes). Pre-login counts were
users/Finance roles/Clerk roles/assignments/profiles/companies `4/1/2/1/0/1`. All four password logins
returned HTTP 200 and one valid identity.

### 23.3 Corrected authenticated RLS matrix

| Identity / request | Status | Expected | Actual | Result |
|---|---:|---:|---:|---|
| General customers / invoices / receipts / roles | 200 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | PASS |
| Finance customers / invoices / receipts / anchors | 200 | 2 / 7 / 7 / 5 | 2 / 7 / 7 / 5 | PASS |
| Finance self-role / out-of-company | 200 | 1 / 0 | 1 / 0 | PASS |
| Finance hidden/deleted customers / invoices / receipts | 200 | 0 / 0 / 0 | 0 / 0 / 0 | PASS |
| Assigned Clerk customers / invoices / receipts / anchors | 200 | 1 / 6 / 7 / 4 | 1 / 6 / 7 / 4 | PASS |
| Assigned customer / outside eligible customer and documents | 200 | 1 / 0 / 0 / 0 | 1 / 0 / 0 / 0 | PASS |
| Assigned hidden/deleted customer / invoices / receipts | 200 | 0 / 0 / 0 | 0 / 0 / 0 | PASS |
| Assigned self-role / assignment | 200 | 1 / 1 | 1 / 1 | PASS |
| Unassigned customers / invoices / receipts | 200 | 0 / 0 / 0 | 0 / 0 / 0 | PASS |
| Unassigned self-role / assignment | 200 | 1 / 0 | 1 / 0 | PASS |

The prior FAIL was a stale smoke expectation: it compared user-visible RLS output to the entire physical
retained graph and selected an ineligible first anchor. No Production security rule or retained row was
defective or weakened.

### 23.4 Cleanup, immutable state and decision

The exact assignment and three roles were deleted. All four existing tokens then returned zero protected
customers/invoices/receipts. Global Admin sign-out passed; all four users were permanently deleted; all
four refresh attempts failed; all twelve old-token reads returned zero. Passwords and tokens were erased,
and the complete temporary runner directory was removed.

Independent verification returned ephemeral Auth users/sessions/roles/assignments and temporary Storage
ownership `0/0/0/0/0`, orphans `0/0`, existing Auth/roles/assignments `5/5/2` with frozen fingerprints
unchanged, company count `1`, graph `179`, and all business counts/totals unchanged. The accepted database
hash remains `36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0`.
Storage remains six objects with hash
`b5f58c7c85358da973280bf4e59f5862944e451f50cd521cd6f7c05139468620`; former 128/922 cohorts remain
`0/0`. No second tenant, fifth identity, business mutation or Storage mutation occurred.

`B9DE-E1-002` is **CLOSED**. `B9DE-E1-004` remains **High / OPEN** and separate. Gate E2 remains
unauthorized. No staging, Vercel, Edge, migration, RLS, grant, schema, deployment, GitHub remote, stage,
commit or push action occurred.

`PASS  B9DE-E1-002 CORRECTED EPHEMERAL PRODUCTION RLS LIFECYCLE COMPLETE`

## 24. Historical third ephemeral Production identity attempt — runtime lifecycle executed (2026-07-22)

This section supersedes the historical failed-safe records in §21 and §22.5 as the current execution
outcome while retaining both prior attempts as evidence. The dedicated modern Secret key passed type validation and
the server-side `auth.admin.listUsers` capability probe. No key, prefix, length, fragment, hash, header,
password, email, JWT or refresh token is recorded.

### 24.1 Baseline and sanitized run

Git remained `main` at `c24249f037164edd8e08b3cf15f7180973a78c4d`, with local `origin/main`
`d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d`, ahead/behind `2/0`, staged `0`.
Production had one company, zero prior ephemeral users/sessions, 179 business rows, six Storage objects
and existing identity counts `5/5/2`. Frozen fingerprints and all table counts/monetary totals matched
the accepted F3-P4 state.

The sanitized run-ID hash is
`2d3a0bf73f9d0da6f198549d3a6a2ae37010acb13a975e2e62b85837d39ba676`.
Exactly four confirmed users were created; sanitized user-ID hash prefixes were general
`530556c8b662`, Finance Manager `85afbb6bea7f`, assigned AR Clerk `5f53147562de`, and unassigned AR
Clerk `7e52ce7d54f2`. Pre-login assertions returned users `4`, Finance roles `1`, Clerk roles `2`,
assignments `1`, profiles `0`, companies `1`.

### 24.2 Authentication and read-only RLS matrix

| Identity / request | Status | Expected | Actual | Result |
|---|---:|---:|---:|---|
| General authentication | 200 | 1 | 1 | PASS |
| General customers / invoices / receipts | 200 | 0 / 0 / 0 | 0 / 0 / 0 | PASS |
| General self-role | 200 | 0 | 0 | PASS |
| Finance Manager authentication | 200 | 1 | 1 | PASS |
| Finance customers / invoices / receipts | 200 | 11 / 16 / 11 | 2 / 7 / 7 | FAIL |
| Finance principal anchors | 200 | 10 | 5 | FAIL |
| Finance out-of-company predicate | 200 | 0 | 0 | PASS |
| Assigned Clerk authentication | 200 | 1 | 1 | PASS |
| Assigned Clerk customers / invoices / receipts | 200 | 1 / 2 / 2 | 0 / 0 / 0 | FAIL |
| Assigned customer | 200 | 1 | 0 | FAIL |
| Outside customer / its invoices / its receipts | 200 | 0 / 0 / 0 | 0 / 0 / 0 | PASS |
| Assigned Clerk self-role / assignment | 200 | 1 / 1 | 1 / 1 | PASS |
| Unassigned Clerk authentication | 200 | 1 | 1 | PASS |
| Unassigned Clerk customers / invoices / receipts | 200 | 0 / 0 / 0 | 0 / 0 / 0 | PASS |
| Unassigned Clerk self-role / assignment | 200 | 1 / 0 | 1 / 0 | PASS |

Installed policy inspection explains the exact positive-access result. `cust_select`, `inv_select` and
`rct_select` call `rls_can_access_customer`; that function first requires the customer to be neither
deleted nor hidden. It then permits the company Finance Manager branch or an exact active Clerk
assignment. Aggregate read-only checks returned policy-eligible customers/invoices/receipts `2/7/7`,
eligible anchors `5`, and mandatory first-anchor eligibility `false`. The observed Finance counts match
those policy-eligible aggregates exactly; the assigned Clerk's correct role and assignment cannot make
the ineligible first-anchor customer visible. Changing retained flags or RLS was outside this gate and
was not attempted.

### 24.3 Mandatory cleanup and zero residue

After deleting the exact assignment and three exact role rows, every existing access token returned zero
customers/invoices/receipts. Global Admin sign-out produced no failure. The four exact users were deleted
through `auth.admin.deleteUser(id, false)`. All four refresh-token reuse attempts failed with zero
sessions; all twelve old-access-token protected reads returned HTTP 200 with zero rows. Passwords and
tokens were erased from memory, and the complete temporary runner directory was removed.

Independent aggregate verification returned ephemeral Auth users/sessions `0/0`, temporary roles and
assignments `0/0`, role/assignment orphans `0/0`, temporary-owned Storage objects `0`, and existing
Auth/role/assignment `5/5/2` with all three frozen fingerprints unchanged. Company count remained `1`.
The business graph remained `179`; table counts, exact monetary totals and the accepted database hash
remained unchanged. Storage remained six objects with the accepted Storage hash. No fifth identity,
second tenant, business mutation or Storage mutation occurred.

### 24.4 Decision

Creation, authentication and complete destruction were proven, but eight required positive RLS
assertions did not meet this gate's stated contract. `B9DE-E1-002` therefore remains **PARTIALLY
RESOLVED / NOT CLOSED**. Resolving the policy-versus-retained-scenario contract requires a separately
authorized review; this gate did not modify application source, data, RLS, grants or schema.

`B9DE-E1-004` remains **High / OPEN** and separate. Gate E2 remains unauthorized. No staging, Vercel,
Edge Function, migration, deployment, GitHub remote, stage, commit or push action occurred.

`FAIL  B9DE-E1-002 EPHEMERAL PRODUCTION SMOKE IDENTITY LIFECYCLE INCOMPLETE`

### 24.5 Historical failed-safe record — second authorized attempt

The second authorization supplied the two named values through the Codex process environment. Presence
was confirmed without exposing a value, prefix, length, hash, partial value, authorization material or
environment dump. Git remained on `main` at
`c24249f037164edd8e08b3cf15f7180973a78c4d`, with `origin/main` at
`d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d`, ahead/behind `2/0` and staged paths `0`.

The bounded runner used installed `@supabase/supabase-js` `2.100.1`; server and user clients disabled
persistent sessions, automatic refresh and URL session detection. It read the Secret and URL only from
the named process variables and obtained the publishable key from existing local configuration in
memory. Syntax validation passed and scans found no credential, JWT, private-key or complete synthetic
email literal. The outer path-validated `finally` removed `frontend/.codex-tmp/`.

The fresh pre-mutation baseline again returned one company, zero prior ephemeral Auth users, 179 retained
business rows and exact counts `11/16/14/11/13/25/50/6/6/20/7`. Exact monetary totals remained invoices
`314889.16 / 262792.16 / 316054.16`, receipts `50587.00 / 50386.00 / 200.00`, and allocations
`50388.00 / 10.00 / 50621.00`. Existing non-ephemeral Auth/role/assignment counts remained `5/5/2`.

The normalized credential classification was `unsupported`. The required read-only
`auth.admin.listUsers` capability probe failed during local HTTP request construction, before a network
request could be issued. The fail-safe stopped before allocating a run ID or generating credentials.

| Lifecycle item | Result |
|---|---:|
| Temporary Auth users created | 0 |
| Temporary roles created | 0 |
| Temporary assignments created | 0 |
| Temporary sessions/access or refresh tokens created | 0 |
| Authenticated RLS requests executed | 0 |
| Old-token negative-access requests executed | 0 |
| Business/Storage mutations | 0 / 0 |
| Temporary runner files remaining | 0 |

The independent post-attempt aggregate scan returned ephemeral Auth users/sessions `0/0`, role and
assignment orphans `0/0`, existing Auth/role/assignment counts `5/5/2` with all three frozen
fingerprints unchanged, company count `1`, business graph `179`, Storage objects `6`, and the same table
counts and exact monetary totals as the pre-attempt snapshot. Because no user or session ever existed,
there was no old token to test; this is correctly recorded as missing runtime proof, not a passing
negative-access result.

This second attempt supplies no runtime RLS evidence and does not close `B9DE-E1-002`, which remains
**PARTIALLY RESOLVED / NOT CLOSED**. `B9DE-E1-004` remains **High / OPEN**; the disclosed PAT was not
used, inspected, copied, revoked or modified. Gate E2 remains unauthorized.

`FAIL  B9DE-E1-002 EPHEMERAL PRODUCTION SMOKE IDENTITY LIFECYCLE INCOMPLETE`

## 25. Historical authoritative identity-closure state (credential status superseded by §26)

At this identity-closure checkpoint, Section 23 was authoritative. `B9DE-E1-002` is **CLOSED** by the
corrected runtime lifecycle. `B9DE-E1-004` was then **High / OPEN**; its later credential-incident
closure and the current whole-gate decision are recorded in §26. Gate E2 remained unauthorized.

`PASS  B9DE-E1-002 CORRECTED EPHEMERAL PRODUCTION RLS LIFECYCLE COMPLETE`

## 26. Final repeated Production read-only preflight and credential-incident closure — NO-GO (2026-07-23)

### 26.1 Authorization, Git and credential governance

The gate accepted the owner attestation that the previously disclosed Supabase PAT was revoked without
reuse or retransmission, the dedicated ephemeral-lifecycle Secret key was deleted, both temporary
environment variables were cleared, and the bounded PowerShell session was closed. This attestation is
governance evidence; no old credential was requested, reconstructed, hashed or tested. The two variables
and `frontend/.codex-tmp/` were absent. A count-only scan of 450 non-`social-media/` tracked files plus
relevant Batch artifacts returned zero PAT/Secret/service-role/JWT/private-key/Authorization-header or
full synthetic-email values. `B9DE-E1-004` is therefore **CLOSED**.

Git remained `main` at `c24249f037164edd8e08b3cf15f7180973a78c4d`, with local `origin/main`
`d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d`, ahead/behind `2/0` and staged paths `0`. The accepted
`B9DE-E1-002` corrected lifecycle and independent evidence-based closure review remain PASS. No identity
lifecycle was rerun.

### 26.2 Fresh immutable Production after-state and financial certification

The governing F3 manifest CTE and original canonical PostgreSQL hash algorithm returned anchors/scenario
hashes `10/10`, retained graph `179`, exact database hash
`36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0`, and counts customers/invoices/
invoice-lines/receipts/allocations/journals/journal-lines/import-batches/files/rows/row-allocations/OCR
`11/16/14/11/13/25/50/6/6/20/7/0`. Deletion-manifest rows, defective Paid rows/amount, header-only Open
rows and approved Storage delete objects are all zero. Storage remains six objects with exact hash
`b5f58c7c85358da973280bf4e59f5862944e451f50cd521cd6f7c05139468620`.

Exact PostgreSQL `NUMERIC` totals remain invoices `314889.16 / 262792.16 / 316054.16`, receipts
`50587.00 / 50386.00 / 200.00`, and allocations `50388.00 / 10.00 / 50621.00`. All 16 retained
documents were included. Raw document difference is `3 / 1701.00`: Draft `2 / 1700.00` and Cancelled
`1 / 1.00`, all explained by valid pre-posting/cancellation/reversal evidence. Raw receipt difference is
Bounced `1 / 1.00`, fully explained by allocation/journal/credit-control reversal evidence. Unexplained
document and receipt differences are both `0 / 0.00`. Active/settled equations and all receipt,
allocation, discount, rate/base/FX, journal header/line/base, reversal-link, company/customer and orphan
checks returned zero anomaly.

Identity counts remain companies/Auth/roles/assignments `1/5/5/2`; ephemeral users/sessions/roles/
assignments are `0/0/0/0`; role, assignment-user, assignment-customer and cross-company assignment
orphans are zero. No Storage owner is orphaned from Auth. `B9DE-E1-002` and `B9DE-E1-003` remain
**CLOSED**; T1 remains the accepted structural Production plus historical staging-runtime proof. Staging
was not contacted.

### 26.3 RLS catalog result and new blocker

Twenty reviewed exposed AR tables have RLS enabled and at least one policy. `cust_select`, `inv_select`
and `rct_select` still call `rls_can_access_customer`; its definition hash remains
`981bd4c89eaba0783efc92bd0deac2112a3b00e6d8f31fcc0f349c430affbf48`. Hidden/deleted exclusion occurs
before the Finance Manager and Clerk branches, and Clerk access still requires an active assignment and
active role.

Fresh full-policy inspection nevertheless found one unconditional policy: `public.user_roles` policy
`Temp Allow All` applies to `authenticated` for `SELECT` with `USING (true)`. The `authenticated` role
also has table SELECT privilege. This is a real tenant-unbound authorization-data read path and violates
the required unconditional-policy count `0`; it is not a scan false positive. This gate did not alter
the policy or grant. New finding `B9DE-E1-005` is **High / OPEN** and blocks Gate E1.

### 26.4 Migration 027, Batch 9D-D and final decision

Migration history metadata remains unavailable. Catalog inspection found zero of the six Migration 027
routines, zero relation conflicts, all 50 reviewed required columns, zero data-assumption violations,
the active MYR company, the `authenticated` role and `auth.uid()`. Migration 027 remains deterministically
**MISSING**, technically installable later, and was not applied. All four Batch 9D-D Phase A files are
byte-identical to HEAD; the allocation candidate contract passed `12/12`; accepted source still keeps
`/allocations/auto` disabled.

| Finding | Severity | Final state in this gate | Basis |
|---|---|---|---|
| `B9DE-E1-001` | High | **OPEN by whole-gate rule; technically remediated** | Financial/integrity checks pass, but whole Gate E1 cannot close |
| `B9DE-E1-002` | Material Medium | **CLOSED** | Corrected ephemeral lifecycle plus accepted independent review remain PASS |
| `B9DE-E1-003` | Material Medium | **CLOSED** | Prior sanitized Vercel name-only evidence preserved; Vercel not contacted |
| `B9DE-E1-004` | High | **CLOSED** | Owner revocation/key-deletion attestation plus zero credential/residue scan |
| `B9DE-E1-005` | High | **OPEN** | Authenticated unconditional `public.user_roles` SELECT policy |

Because a new High blocker exists, the whole-gate closure rule cannot close `B9DE-E1-001`, and Gate
9D-E1 remains **NO-GO**. Gate E2 remains **NOT AUTHORIZED — requires separate user approval**. Every
Production SQL statement in this checkpoint was a catalog/data `SELECT`; no Auth, Storage, database,
RLS, policy, grant, migration, staging, Vercel, Edge, deployment, Git remote, stage, commit or push
mutation occurred.

`NO-GO  BATCH 9D-E1 FINAL PRODUCTION PREFLIGHT REMAINS BLOCKED`

## 27. B9DE-E1-005 Production `user_roles` RLS remediation and final Gate E1 closure — PASS (2026-07-23)

### 27.1 Authorization, baseline and authoritative contract

The only authorized Production mutation was the exact `public.user_roles` policy action. Git remained
`main` at `c24249f037164edd8e08b3cf15f7180973a78c4d`, with `origin/main` at
`d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d`, ahead/behind `2/0` and zero staged paths. Production was
the exact project `kusseuycqgdilychphpq`; staging, Vercel, Edge, Auth, Storage, deployment and Git remotes
were not contacted. The unrelated `social-media/` tree was not inspected or modified.

Repository Migration 006 defines direct `user_roles` SELECT visibility as the caller's own row or rows
for a company in which the caller has an active role:
`user_id = auth.uid() OR rls_has_company_access(company_id)`. The existing
`rls_has_company_access(uuid)` is a source-backed `STABLE SECURITY DEFINER` policy helper, so its
membership lookup does not recurse through `user_roles` RLS. Current backend role lookup is server/admin
mediated and the frontend consumes `/auth/me`; neither requires unrestricted authenticated enumeration.
No later migration or accepted contract replaces `ur_select`. The contract is therefore unambiguous:
same-company visibility is explicitly allowed to an active company member, but cross-company/global
enumeration is not. Production has one company and all five existing role holders belong to it, so an
authorized member's exact source-permitted result is five same-company rows; this differs from the removed
`USING (true)` path, which admitted users with no company membership.

The final pre-mutation guard matched exactly one permissive `SELECT` policy named `Temp Allow All`, role
exactly `authenticated`, normalized `USING` exactly `true`, absent `WITH CHECK`, RLS enabled/not forced,
and authenticated table SELECT present. Four non-target `user_roles` policies remained. Sanitized policy,
grant, helper, identity, business and Storage fingerprints were frozen before mutation.

### 27.2 Mode A operator, tests and rollback simulation

Mode A (drop-only) was selected because source-backed `ur_select` already supplies the required
self/company-scoped behavior. The bounded operator is
`database/operators/batch_9d_e1_b9de_e1_005_user_roles_rls_remediation.sql`. It uses one short transaction,
local timeouts, a transaction advisory lock, exact catalog-signature checks, an exact non-`IF EXISTS`
drop, and before/after fingerprints for every other public policy, the `user_roles` grants and accepted RLS
helpers. It is idempotent: an already-remediated rerun performs assertions only. Any signature, policy,
grant, helper or RLS-state drift raises an exception and rolls the transaction back.

The local source-contract test passed `9/9`; Deno format and type checks passed. It verifies no replacement
policy, grant mutation, RLS disablement, row DML, second policy mutation or wildcard drop is present.

A Production rollback-only candidate transaction passed before permanent application. Under effective
role `authenticated`, a random nonexistent user saw zero rows. For each of the five existing Auth users,
the exact RLS row-ID set equaled a privileged source-predicate computation; each returned the five
same-company rows and zero rows for a random company. Only sanitized identity hashes were retained. The
candidate action was rolled back and the exact legacy signature reconfirmed before permanent apply.

### 27.3 Exact Production mutation and installed runtime result

The guarded operator committed exactly one catalog action: `DROP POLICY "Temp Allow All" ON
public.user_roles`. It performed no row DML and created no replacement policy.

| Check | Result |
|---|---:|
| Legacy target policy | `0` |
| Global unconditional exposed SELECT / write policies | `0 / 0` |
| Other `user_roles` policies | `4`, definition-equivalent |
| RLS enabled / forced | `true / false` |
| Authenticated table SELECT grant | unchanged / present |
| All-public-policy fingerprint excluding target | unchanged |
| `user_roles` grant and accepted helper fingerprints | unchanged |

Installed-state authenticated SQL verification repeated the exact-set comparison for all five users and
passed. The two AR Clerks, two Finance Managers and one AR Supervisor each matched the explicit
same-company source contract; a random user returned zero and every random-company predicate returned
zero. INSERT/UPDATE/DELETE policies were not executed or changed.

### 27.4 Full RLS, immutable-state and readiness certification

All 20 reviewed exposed AR tables have RLS enabled and at least one applicable policy (`20/20/20`). Core
policies `cust_select`, `inv_select` and `rct_select` remain `3/3` callers of
`rls_can_access_customer`; its definition hash remains
`981bd4c89eaba0783efc92bd0deac2112a3b00e6d8f31fcc0f349c430affbf48`. Hidden/deleted exclusion and the
active Clerk-role-plus-assignment requirement are unchanged. The post-DDL security advisor reports no
always-true-policy lint; remaining items are pre-existing WARN-level catalog posture outside this gate.

The governing manifest returned `AFTER_STATE_MATCH`: anchors/scenario hashes `10/10`, graph `179`, counts
customers/invoices/lines `11/16/14`, receipts/allocations `11/13`, journals/lines `25/50`, imports
`6/6/20/7`, OCR decisions `0`, and database hash
`36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0`. Storage remains six objects,
zero approved-delete/temporary-owned objects, hash
`b5f58c7c85358da973280bf4e59f5862944e451f50cd521cd6f7c05139468620`. Former 128/922 populations remain
`0/0`.

Exact `NUMERIC` totals remain invoices `314889.16 / 262792.16 / 316054.16`, receipts
`50587.00 / 50386.00 / 200.00`, and allocations `50388.00 / 10.00 / 50621.00`. Raw document mismatch is
`3 / 1701.00`, fully explained by Draft `2 / 1700.00` and Cancelled `1 / 1.00`; raw receipt mismatch is
Bounced `1 / 1.00`. Unexplained document/receipt mismatch is `0 / 0.00` for both. Active/settled,
receipt-stored, allocation relation/amount/rate/base/FX/reversal, journal header/line/base/reversal-link,
Cancelled and Bounced reversal anomaly counts are all zero. Allocation status remains 11 Active and two
Reversed.

Companies/Auth users/roles/assignments remain `1/5/5/2`; ephemeral users/sessions/roles/assignments remain
`0/0/0/0`; role, assignment-user/customer/company, cross-company and Storage-owner orphans are all zero.
The operator contains no row DML and the frozen counts/fingerprints and role `updated_at` maximum are
unchanged.

Migration 027 remains `MISSING`: named routines `0/6`, conflicts `0`, missing reviewed required columns
`0/50`, and data-assumption violations `0`. It was not applied. The four accepted Batch 9D-D Phase A files
are byte-identical to HEAD; the allocation-candidate contract passed `12/12`; `/allocations/auto` remains
`AUTO_ALLOCATION_DISABLED`.

### 27.5 Finding matrix and decision

| Finding | Severity | Final state | Basis |
|---|---|---|---|
| `B9DE-E1-001` | High | **CLOSED** | Technical F3 remediation remained exact; whole-gate rule now satisfied |
| `B9DE-E1-002` | Material Medium | **CLOSED** | Corrected ephemeral runtime lifecycle and independent review preserved |
| `B9DE-E1-003` | Material Medium | **CLOSED** | Accepted sanitized Vercel name-only evidence preserved |
| `B9DE-E1-004` | High | **CLOSED** | Owner revocation/key-deletion attestation and clean residue scans preserved |
| `B9DE-E1-005` | High | **CLOSED** | Exact tenant-unbound policy removed; authenticated exact-set and full catalog checks pass |

No new Critical, High or material Medium blocker was found. Gate 9D-E1 is **PASS / GO** and is closed.
Gate 9D-E2 remains **NOT AUTHORIZED — requires separate user approval**. Migration 027, deployment,
commit and push remain unauthorized and were not performed.

`PASS  B9DE-E1-005 PRODUCTION USER_ROLES RLS REMEDIATION AND FINAL GATE E1 CLOSURE COMPLETE`
