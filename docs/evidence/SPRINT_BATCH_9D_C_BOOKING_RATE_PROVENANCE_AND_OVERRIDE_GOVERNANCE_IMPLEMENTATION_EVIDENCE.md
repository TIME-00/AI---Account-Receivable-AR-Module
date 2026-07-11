# Batch 9D-C - Booking Rate Provenance and Override Governance - Implementation Evidence

## Status (CONSOLIDATED - authoritative)

> This Status block and the consolidated section immediately below are the **current authoritative state**
> of Batch 9D-C after completed staging runtime verification. The detailed chronological remediation
> sections later in this document are retained as **historical record** for Closure Review; where an
> earlier interim section says an item was "NOT YET PERFORMED" or names an interim next gate, it describes
> the state at that point in time and is **superseded** by this consolidated status.

```text
Batch 9D-C staging runtime verification:   PASS - BATCH 9D-C STAGING RUNTIME VERIFICATION COMPLETED
Migrations 022-026:                        APPLIED + VERIFIED
Focused decision versioning:               PASS
Focused import-origin provenance:          PASS
RT-01 through RT-19:                        COMPLETE
Cleanup:                                    COMPLETE
Controlled Storage cleanup:                COMPLETE
Temporary Auth cleanup:                    COMPLETE
Post-cleanup financial comparison:         NO UNEXPECTED PRE-EXISTING DRIFT
Batch 9D-B scheduler:                      UNCHANGED AND ACTIVE
Production action:                         NONE
```

Authoritative commit / deployment state:

```text
branch:              main
HEAD/origin:         b891fdd442ec3b83c47caf081ac2ce7889d98e50
commit subject:      fix(fx): preserve import origin in booking decisions
staging target:      gcdsdyegwjdcskpukqlq
production target:   kusseuycqgdilychphpq (NOT touched)
production action:   NONE
staging Edge Functions deployed in the final remediation pass:
  - imports
  - invoices
  - receipts
```

Only `imports`, `invoices`, and `receipts` were (re)deployed to staging in the final remediation pass; no
unrelated Edge Function was redeployed in the final pass.

**Batch 9D-C is NOT officially closed.** Next gate: **Codex Batch 9D-C Closure Review**.

## Baseline

Original implementation baseline:

```text
branch: main
HEAD/origin: 4c268b67c2368390d028c9fa34a46ef683c1e216
```

Technical Review remediation baseline:

```text
branch: main
HEAD/origin: eb925606d1462c13917e8ccc6dd512a2f7b5e063
```

Second narrow remediation baseline:

```text
branch: main
HEAD/origin: 1fc103cb13aa74432347bf989143cbf2d98bd0b2
```

Targeted migration 022 ordering-fix baseline:

```text
branch: main
HEAD/origin: 2de54552da240c592536ea611dda28fc39fd3478
```

Targeted runtime-fix baseline:

```text
branch: main
HEAD/origin: d6d212cfceacf8769ed05e5471266d81a418d96a
```

Targeted decision-versioning fix baseline:

```text
branch: main
HEAD/origin: 2e333eba706cb107427c881d17018aad07195ef3
```

Targeted import-governance fix baseline:

```text
branch: main
HEAD/origin: 06bff1cfca1dd2917d72de8aa87f115bdd0c4322
```

Targeted import-origin provenance fix baseline:

```text
branch: main
HEAD/origin: 229280058f8781c4b9fdda7b1b79367401fcd7c2
```

Final consolidated evidence baseline:

```text
branch: main
HEAD/origin: b891fdd442ec3b83c47caf081ac2ce7889d98e50
commit subject: fix(fx): preserve import origin in booking decisions
```

## Batch 9D-C Staging Runtime Verification - CONSOLIDATED (FINAL, PASS)

This section consolidates the completed staging runtime verification. It is the authoritative outcome; the
detailed chronological remediation sections that follow are retained as historical record.

### Final verdict

```text
PASS - BATCH 9D-C STAGING RUNTIME VERIFICATION COMPLETED
```

### Summary

```text
Migrations 022-026:                  APPLIED + VERIFIED
RT-01 through RT-19:                  COMPLETE
Cleanup:                             COMPLETE
Controlled Storage cleanup:         COMPLETE
Temporary Auth cleanup:             COMPLETE
Post-cleanup financial comparison:  NO UNEXPECTED PRE-EXISTING DRIFT
Batch 9D-B scheduler:               UNCHANGED AND ACTIVE
Production action:                  NONE
```

### Migration path (022-026, applied + verified in staging)

- **022 - initial Batch 9D-C booking-rate governance migration.** The first staging attempt failed due to
  pending trigger events during incompatible DDL/backfill ordering (SQLSTATE 55006). The local fix
  reordered DDL/FKs/RLS/privileges before backfill DML. The final staging apply succeeded.
- **023 - booking-rate governance RPCs, immutability, and posting guard migration.** Applied and verified
  in staging.
- **024 - runtime fix for `fx_record_booking_decision` source provenance scalar handling.** Reason: the
  BASE_PARITY path hit unassigned generic `RECORD` `v_exchange` / `v_reference` risk. Fix: scalar
  `source_exchange_rate_id` and scalar `source_fx_reference_rate_id`. Applied and verified.
- **025 - supersession validation fix.** Reason: a Draft FX update mutated the transaction currency first,
  then the old-decision lifecycle update to `Superseded` triggered a current-snapshot mismatch. Fix: a
  narrow lifecycle-only `Superseded` validation exception while preserving material immutability and Posted
  protection. Applied and verified.
- **026 - import-origin provenance fix.** Reason: CSV/XLSX import-created decisions had relational import
  traceability, but `decision.import_origin` was not directly populated. Fix: trusted server-side
  `import_origin` payload from import batch/row context; import-aware governed create overloads;
  `import_origin` pass-through to `fx_record_booking_decision`; supersession `import_origin` inheritance
  trigger. Applied and verified.

### Remediation history (staging blockers resolved)

1. **RT-01 / 024 runtime blocker** - problem: `record "v_exchange" is not assigned yet`; resolution:
   migration 024 scalarized source FK handling.
2. **RT-05 / 025 runtime blocker** - problem: `BR-FX-GOVERNANCE: invoice decision currency mismatch`
   during Draft FX update / decision supersession; resolution: migration 025 narrow lifecycle-only
   supersession validation fix.
3. **RT-16E explicit foreign imported FX blocker** - problem: CSV/XLSX import mapping dropped
   `exchange_rate` and `fx_override_reason`. Observed old bad behavior: input `currency = USD`,
   `exchange_rate = 1.42`, `fx_override_reason` supplied, yet actual decision source = `CATALOG`, catalog
   rate = 1.35, `approval_status = NotRequired`, receipt status = Posted, import row posting_status =
   Posted. Resolution: import mapping now preserves `exchange_rate` and `fx_override_reason`; invoice and
   receipt paths both covered; invalid/non-positive rates fail closed; explicit foreign rates no longer
   silently fall back to catalog.
4. **Import-origin provenance gap** - problem:
   `fx_booking_rate_decisions.import_origin` remained NULL for CSV/XLSX-created decisions; resolution:
   migration 026 + service propagation (trusted `import_origin` payload created from batch/row backend
   context).
5. **Auth runtime caller blocker** - problem: no usable authenticated staging JWT was available; direct
   SQL auth-user construction failed and was abandoned; resolution: a temporary staging Auth user was
   created through the supported Auth Admin flow, assigned the Finance Manager role, used to verify the
   authenticated Edge runtime, and cleaned after verification.

### Focused decision-versioning proof

```text
RT-05 Invoice Versioning: PASS
RT-06 Receipt Versioning: PASS
```

```text
v1 Superseded
v2 new UUID
same root
supersedes v1
transaction pointer moved to v2
v1 material provenance unchanged
approval facts preserved
```

### Focused import-origin provenance proof

```text
P-01 Invoice import provenance:                 PASS
P-02 Receipt import provenance:                 PASS
P-03 Manual invoice import_origin NULL:         PASS
P-04 Manual receipt import_origin NULL:         PASS
P-05 Imported decision supersession inheritance: PASS
```

```text
imported v1 import_origin populated
v2 inherited import_origin exactly after governed FX edit
manual non-import create path keeps import_origin NULL
```

### RT-16 Import Matrix (PASS)

```text
Invoice CSV BASE_PARITY:            PASS
Invoice XLSX CATALOG:               PASS
Receipt CSV BASE_PARITY:            PASS
Receipt XLSX CATALOG:               PASS
Explicit foreign invoice FX:        PASS
Explicit foreign receipt FX:        PASS
Missing override reason:            PASS (fail-closed)
Invalid non-numeric explicit rate:  PASS (fail-closed)
Non-positive explicit rate:         PASS (fail-closed)
Missing governed rate:              PASS (fail-closed)
Stale reference:                    NOT APPLICABLE - current CSV/XLSX import contract exposes no
                                    reference-selection field
```

Historical RT-16E fix proof (the previously failing 1.42 explicit receipt fixture, now fail-closed):

```text
historical 1.42 explicit receipt fixture:
no silent catalog substitution
no receipt created
no decision created
no posting
created_count = 0
posted_count = 0
failure = booked rate deviation exceeds blocked threshold
```

Within-band explicit foreign receipt proof:

```text
within-band explicit foreign receipt:
decision source = MANUAL_OVERRIDE
booked_rate = 1.36000000
approval_status = Pending
receipt status = Draft
created_count = 1
posted_count = 0
import_origin populated
```

### RT-17 PDF/Image Intake Matrix (PASS)

```text
Synthetic PDF: PASS
Synthetic PNG: PASS
```

```text
status = ApprovedDraft
created_count = 0
posted_count = 0
allocated_count = 0
OCR/provider call = NO
```

PDF/Image intake remains a review/metadata boundary only: no silent posting, no allocation, no journal
mutation, no OCR/provider expansion.

### RT-18 Allocation / Financial Regression Matrix (COMPLETE)

```text
manual allocation:  PASS
reverse allocation: PASS
cancel invoice:     PASS
bounced cheque:     PASS
realized FX:        PASS
discount:           PASS
bank charge:        NOT APPLICABLE - authoritative contract does not implement this capability
short payment:      PASS
```

Realized FX proof:

```text
formula: forex_gain_loss = allocated_amount x (receipt_rate - invoice_rate)
allocated_amount = 100.00
invoice_rate = 1.360000
receipt_rate = 1.340000
expected: 100.00 x (1.34 - 1.36) = -2.00
actual:   -2.00
journal: Dr Forex Loss 2.00 / Cr Forex adjustment 2.00 ; balanced = YES
invoice booked FX snapshot: UNCHANGED at 1.360000
receipt booked FX snapshot: UNCHANGED at 1.340000
```

Discount proof:

```text
invoice outstanding before = 100.00
cash allocation = 95.00
discount_amount = 5.00
invoice outstanding after = 0.00
receipt allocated_amount = 95.00
receipt unallocated_amount = 0.00
journal: Dr Discount 5.00 / Cr AR discount 5.00 ; balanced = YES
```

Short payment proof:

```text
allocation amount = 40.00
invoice outstanding after = 60.00
invoice status = Partially Paid
receipt allocated_amount = 40.00
receipt unallocated_amount = 0.00
receipt status = Fully Allocated
discount_amount = 0.00
forex_gain_loss = 0.00
```

Bank charge classification (precise wording): Bank charge was classified as NOT APPLICABLE for Batch 9D-C
runtime regression because the current authoritative backend/API/RPC contract does not implement or expose
a bank-charge path. This is not evidence that bank-charge handling is supported. It is a documented current
capability gap / not-implemented capability outside the executable 9D-C regression contract.

### RT-19 Auto-Allocation

```text
POST /allocations/auto: AUTO_ALLOCATION_DISABLED
```

Final note (honest): a final post-cleanup live Edge call could not authenticate after the temporary Auth
cleanup, but RT-19 had already passed at runtime and the allocation source/deployment was unchanged
afterward. The final post-cleanup call itself is **not** claimed to have succeeded.

### Cleanup (COMPLETE)

Cleanup was completed for: controlled DB rows; controlled Storage objects; temporary Auth user; temporary
role; local fixtures; local credentials/tokens.

Storage cleanup:

```text
bucket: ar-imports
controlled objects before: 20
deleted: 20
remaining: 0
```

DB cleanup final categories:

```text
allocation_details:     4 deleted,   0 remaining
credit_control_logs:    1 deleted,   0 remaining
customer_change_logs:   1 deleted,   0 remaining
customers:              1 deleted,   0 remaining
decision_events:      127 deleted,   0 remaining
decisions:             45 deleted,   0 remaining
import_batches:        20 deleted,   0 remaining
import_files:          20 deleted,   0 remaining
import_rows:           20 deleted,   0 remaining
invoice_lines:         20 deleted,   0 remaining
invoices:              20 deleted,   0 remaining
journal_entries:       18 deleted,   0 remaining
journal_lines:         36 deleted,   0 remaining
ocr_review_decisions:   4 deleted,   0 remaining
receipts:              16 deleted,   0 remaining
user_roles:             1 deleted,   0 remaining
```

Immutable/audit trigger handling during cleanup (transparent for Closure Review):

```text
Only the exact affected immutability/audit triggers were transactionally disabled and re-enabled for the
exact controlled cleanup.
No broad trigger suppression.
No session_replication_role.
No unrelated record deletion.
Trigger state verified restored afterward.
```

### Financial and scheduler verification

```text
pre-cleanup financial comparison:      matched continuation baseline
post-cleanup financial comparison:     matched continuation baseline
unexpected pre-existing financial drift: NONE
```

Scheduler (Batch 9D-B, unchanged and active):

```text
pg_cron = 1.6.4
pg_net = 0.20.0
supabase_vault = 0.3.1
job = batch_9d_b_fx_scheduler_staging
schedule = 30 7 * * *
active = true
target = staging only
production ref = absent
Vault secret metadata present
secret value exposed = NO
```

### Final safety

```text
production migration:          NO
production Edge deployment:     NO
production Auth user:           NO
production financial mutation:  NO
production scheduler change:     NO
production Vault change:         NO
staging scheduler change:        NO
provider config change:          NO
raw Auth schema manipulation:    NO
JWT secret extraction:           NO
fixture committed:               NO
credential committed:            NO
repo worktree:                   clean
```

## Staging RT-16 Import Governance Failure and Local Remediation

The resumed authorized Batch 9D-C staging runtime verification had already
verified:

```text
migrations 022-025: APPLIED + VERIFIED PASS
Focused RT-05 Invoice Versioning: PASS
Focused RT-06 Receipt Versioning: PASS
RT-01 through RT-15: PASS
RT-19 Auto-Allocation Disabled: PASS
```

RT-16 then stopped on explicit foreign imported FX governance:

```text
RT-16A Invoice CSV BASE_PARITY: PASS
RT-16B Invoice XLSX CATALOG: NOT EXECUTED - local fixture-generation issue
RT-16C Receipt CSV BASE_PARITY: PASS
RT-16D Receipt XLSX CATALOG: NOT EXECUTED - local fixture-generation issue
RT-16E Explicit Foreign Imported FX: FAIL
RT-16F Missing Governed Rate: PASS
RT-16G Stale Reference: NOT EXECUTED - stopped after RT-16E failure
RT-17: NOT EXECUTED
RT-18 remaining flows: NOT EXECUTED in this continuation
cleanup: NOT PERFORMED
```

Exact RT-16E staging input:

```text
currency: USD
exchange_rate: 1.42
fx_override_reason: B9DC explicit imported rate
```

Actual RT-16E staging result:

```text
import batch: eec33350-5fa0-4afc-820f-88e88e3d38d3
import row: c0c47ccf-5b95-4c73-ad76-4ee2eef02e4d
receipt: e54c89bd-43cd-4ba6-8b4f-6069c84fa0a7
decision: 8bc6d0ee-1b24-4e10-8b20-12e32ae76e5d
decision source: CATALOG
catalog rate used: 1.35
approval_status: NotRequired
receipt status: Posted
import row posting_status: Posted
```

Source root cause confirmed locally:

- `validateCreateInvoice(...)` and `validateCreateReceipt(...)` already accept
  `exchange_rate` and `fx_override_reason`.
- `executeImport(...)` already builds invoice/receipt create inputs from
  `mapped_data`.
- receipt import auto-post already contains a downstream
  `explicitRateSupplied` / `HeldGovernance` guard.
- normal CSV/XLSX import validation omitted `exchange_rate` and
  `fx_override_reason` when transforming `raw_data` into `mapped_data`, so
  `receiptInput.exchange_rate` / `invoiceInput.exchange_rate` were undefined
  during execute.
- the downstream explicit-rate hold was therefore unreachable for normal
  explicit-rate imports, allowing catalog substitution and unattended posting.

Local remediation:

- `backend/supabase/functions/imports/service.ts` now maps optional
  `exchange_rate` and `fx_override_reason` from import `raw_data` into both
  invoice and receipt `mapped_data`, including review-required branches.
- supplied `exchange_rate` is parsed as numeric and must be positive.
- supplied `fx_override_reason` is preserved and length-checked consistently
  with the create validators.
- execute input construction remains unchanged: `validateCreateInvoice` and
  `validateCreateReceipt` receive the mapped values and pass them to the
  existing governed create paths.
- receipt import auto-post hold logic remains the existing downstream
  `HeldGovernance` boundary.

No staging cleanup was performed after the RT-16E failure because the controlled
records remain failure evidence.

## Import-Origin Provenance Gap and Local Remediation

The targeted import-governance mapping fix commit:

```text
229280058f8781c4b9fdda7b1b79367401fcd7c2
fix(imports): preserve explicit FX governance fields
```

was source-reviewed as closing the explicit FX field-loss defect:

```text
exchange_rate: preserved from raw_data into mapped_data
fx_override_reason: preserved from raw_data into mapped_data
invoice normal/review-required paths: source review PASS
receipt normal/review-required paths: source review PASS
spread-order overwrite risk: none found
receipt explicit non-parity FX HeldGovernance path: reachable
missing override reason: fail closed
invalid / non-positive explicit rate: fail closed
```

The same review identified a remaining provenance gap:

```text
fx_booking_rate_decisions.import_origin was not directly populated by CSV/XLSX
governed create paths.
```

Relational traceability was already present through:

```text
import_batches.id
  -> import_rows.batch_id
  -> import_rows.invoice_id / receipt_id
  -> transaction.fx_decision_id
  -> fx_booking_rate_decisions.id
```

However, direct governance provenance was missing because:

- `fx_record_booking_decision(... p_import_origin ...)` already writes
  `p_import_origin` into `fx_booking_rate_decisions.import_origin`;
- the already-applied governed create RPCs
  `fx_create_governed_invoice_draft(...)` and
  `fx_create_governed_receipt_draft(...)` did not expose an import-origin
  parameter and passed `NULL` to `fx_record_booking_decision`;
- CSV/XLSX import execution therefore could not directly populate decision
  import-origin metadata even though batch/row relational traceability existed.

Local import-origin remediation:

- `backend/supabase/functions/imports/service.ts` now constructs a trusted
  server-side import-origin payload from the loaded import batch and row
  context. It does not trust spreadsheet/user-provided `import_origin` fields.
- The payload includes batch id, row id, row number, batch name, import type,
  file type, file name, file path/source reference, and a fixed
  `csv_xlsx_import` source marker.
- `InvoiceService.createInvoice(...)` and `ReceiptService.createReceipt(...)`
  now accept an optional internal `importOrigin` option; non-import callers
  remain source-compatible and continue to omit import provenance.
- Import execution passes the trusted payload into the service create calls for
  both invoices and receipts.
- Forward migration
  `database/026_fx_booking_decision_import_origin_provenance_fix.sql` adds
  import-aware governed create overloads that pass `p_import_origin` through to
  `fx_record_booking_decision`.
- Migration `026` also installs a narrow BEFORE INSERT trigger helper that
  preserves the previous decision version's `import_origin` when an imported
  Draft transaction later creates a superseding booking decision and no new
  import-origin payload is supplied.

Staging status for this remediation (interim - SUPERSEDED by the consolidated section above):

```text
imports Edge deployment: NOT YET PERFORMED
migration 026 staging apply: NOT YET PERFORMED
RT-16 rerun after provenance remediation: NOT YET PERFORMED
Batch 9D-C closure: NOT CLAIMED
```

> **Superseded:** the three "NOT YET PERFORMED" items above were subsequently completed - the corrected
> `imports` Edge Function was deployed to staging, migration 026 was applied + verified, and RT-16 (with
> RT-01 through RT-19) was rerun to completion. See "Batch 9D-C Staging Runtime Verification - CONSOLIDATED
> (FINAL, PASS)". Batch 9D-C closure remains **NOT CLAIMED** (next gate: Codex Batch 9D-C Closure Review).

## Staging Migration 022 Failure and Local Remediation

The first authorized Batch 9D-C staging execution targeted only:

```text
staging project: gcdsdyegwjdcskpukqlq
file: database/022_fx_booking_rate_governance.sql
```

The attempt failed before migration 023, Edge deployment, runtime test-data
creation, or runtime verification:

```text
ERROR: 55006:
cannot ALTER TABLE "fx_booking_rate_decisions"
because it has pending trigger events
```

Confirmed post-failure staging state from the execution evidence:

```text
022 visible post-failure state: rolled back; Batch 9D-C objects absent
023: not attempted
Edge deployments: not performed
runtime tests: not started
test data created: 0
financial fingerprint drift: none detected
Batch 9D-B scheduler drift: none detected
production action: none
```

Root cause:

- migration 022 inserted bootstrap rows into `fx_booking_rate_decisions`;
- it updated `invoices.fx_decision_id` / `receipts.fx_decision_id`;
- it inserted `LegacyBackfilled` event rows;
- it then attempted to add transaction-pointer foreign keys referencing
  `fx_booking_rate_decisions`;
- PostgreSQL rejected the later incompatible `ALTER TABLE` because deferred
  trigger events were pending on the affected relation inside the same
  migration transaction.

Local fix:

- transaction-pointer foreign keys are now installed before historical
  backfill DML;
- RLS enablement and privilege setup for the governance tables now also occur
  before historical backfill DML;
- historical classification, bootstrap decision linkage, root/version
  semantics, `LegacyBackfilled` events, and invariant checks are unchanged.

This evidence records the local remediation only. It does not claim staging
migration PASS or staging runtime PASS.

## Resumed Staging Execution RT-01 Stop and Local Runtime Remediation

The resumed authorized staging execution targeted only:

```text
staging project: gcdsdyegwjdcskpukqlq
commit: d6d212cfceacf8769ed05e5471266d81a418d96a
```

Observed staging progress before the runtime stop:

```text
022 second authorized attempt: SUCCESS
022 historical backfill: VERIFIED
invoice counts: 35 in-scope / 35 bootstrap decisions / 35 non-null decision pointers
receipt counts: 13 in-scope / 13 bootstrap decisions / 13 non-null decision pointers
mismatches: 0
023: SUCCESS
required staging Edge Functions: DEPLOYED
  - invoices
  - receipts
  - credit-notes
  - debit-notes
  - imports
```

Runtime matrix stop:

```text
RT-01: FAIL
exact runtime error: 55000 record "v_exchange" is not assigned yet
observed path: BASE_PARITY invoice create -> fx_create_governed_invoice_draft -> fx_record_booking_decision
RT-02 through RT-19: NOT EXECUTED due stop condition
committed Batch 9D-C runtime test rows: 0
pre-existing financial drift: none detected
Batch 9D-B scheduler: unchanged and active
production action: none
```

Root cause:

- `fx_record_booking_decision` used optional generic `RECORD` variables
  `v_exchange` and `v_reference`;
- BASE_PARITY does not assign `v_exchange`;
- the decision/event INSERT expressions still evaluated
  `CASE WHEN v_source_category = 'CATALOG' THEN v_exchange.id ELSE NULL END`;
- PostgreSQL must know the tuple structure to dereference `v_exchange.id`,
  so the BASE_PARITY branch failed with SQLSTATE `55000`.

Local runtime fix:

- `database/024_fx_booking_decision_runtime_fix.sql` forward-replaces only
  `public.fx_record_booking_decision(UUID, TEXT, UUID, UUID, BOOLEAN, TEXT, UUID, TEXT, JSONB)`;
- final source provenance FKs now use scalar UUID variables initialized to
  `NULL` and assigned only after source record resolution;
- BASE_PARITY no longer requires any optional source record dereference;
- the symmetric REFERENCE_SELECTED optional-record CASE expression is also
  removed;
- the migration reasserts the existing service-role-only privilege boundary;
- no data, historical decisions, transaction snapshots, scheduler objects, or
  Edge Functions are mutated by the local fix.

This evidence records the local runtime remediation only. It does not claim
corrective migration 024 has been applied to staging, staging runtime PASS, or
Batch 9D-C closure.

## Resumed Staging Execution RT-05 Stop and Local Decision-Versioning Remediation

The resumed authorized staging execution applied and verified corrective
migration 024 on staging:

```text
staging project: gcdsdyegwjdcskpukqlq
commit: 2e333eba706cb107427c881d17018aad07195ef3
024: APPLIED + VERIFIED PASS
```

Effective post-024 function verification:

```text
fx_record_booking_decision:
  scalar source provenance variables present: YES
  unsafe v_exchange/v_reference CASE expressions absent: YES
  SECURITY DEFINER retained: YES
  search_path = public retained: YES
  PUBLIC/anon/authenticated execute: revoked
  service_role execute: granted
```

Branch smoke checkpoint:

```text
BR-01 BASE_PARITY Invoice: PASS
BR-02 BASE_PARITY Receipt: PASS
BR-03 CATALOG: PASS
BR-04 REFERENCE_SELECTED: PASS
BR-05 MANUAL_OVERRIDE: PASS
BR-06 Decision/Event Provenance: PASS
```

Runtime matrix status after 024:

```text
RT-01 first staging attempt under applied 023:
FAIL - old unassigned v_exchange RECORD defect

RT-01 post-024 rerun path:
PASS before RT-05 stop, with independent committed BR-01 proof

RT-02:
PASS inside aborted runtime block; requires clean final rerun for durable evidence

RT-03:
PASS before RT-05 stop, with independent committed BR-02 proof

RT-04:
PASS inside aborted runtime block; requires clean final rerun for durable evidence

RT-05:
FAIL

exact error:
BR-FX-GOVERNANCE: invoice decision currency mismatch

RT-06 through RT-19:
NOT EXECUTED - STOPPED AFTER RT-05 FAILURE
```

RT-05 root cause:

- `fx_update_governed_invoice_fx` mutates the Draft invoice currency/rate;
- `fx_record_booking_decision` then updates the prior current decision row to
  `lifecycle_status = 'Superseded'`;
- `trg_fx_validate_booking_rate_decision` fires on the old decision row
  UPDATE;
- `fx_validate_booking_rate_decision()` validates the historical old decision
  currency pair against the newly edited current invoice snapshot;
- the old decision pair no longer matches the new Draft invoice pair, so the
  trigger raises `BR-FX-GOVERNANCE: invoice decision currency mismatch`.

Local decision-versioning fix:

- `database/025_fx_booking_decision_supersession_validation_fix.sql`
  forward-replaces only `public.fx_validate_booking_rate_decision()`;
- INSERT and material decision UPDATE validation remain fully enforced against
  the linked transaction;
- lifecycle-only transitions to `Superseded` are allowed to skip current
  transaction currency/rate pair matching only after explicit checks prove all
  material decision fields are unchanged;
- the exception is symmetric for invoice and receipt decisions;
- the migration reasserts the existing service-role-only privilege boundary;
- no historical decisions, transaction snapshots, scheduler objects, Vault
  entries, provider configuration, Edge Functions, or production resources are
  mutated by the local fix.

Current staging safety state from the stopped run:

```text
pre-existing financial drift: NONE DETECTED
Batch 9D-B scheduler: UNCHANGED AND ACTIVE
production action: NONE
preserved Batch 9D-C failure evidence: NOT CLEANED
```

This evidence records the local decision-versioning remediation only. It does
not claim corrective migration 025 has been applied to staging, staging runtime
PASS, or Batch 9D-C closure.

## Database Artifacts

### `database/022_fx_booking_rate_governance.sql`

Creates:

- `public.fx_booking_rate_decisions`
- `public.fx_booking_rate_decision_events`
- `invoices.fx_source_category`
- `invoices.fx_decision_id`
- `receipts.fx_source_category`
- `receipts.fx_decision_id`
- explicit source FKs
- explicit baseline FKs
- decision lineage fields
- company-scoped RLS policies
- truthful historical bootstrap decisions
- `LegacyBackfilled` events

Historical backfill preserves booked numeric snapshots:

- same-currency `exchange_rate = 1.0` -> `BASE_PARITY`
- same-currency `exchange_rate != 1.0` -> `LEGACY_UNVERIFIED` + `BASE_CURRENCY_NON_PARITY_RATE`
- foreign-currency historical rows -> `LEGACY_UNVERIFIED`

### `database/023_fx_booking_rate_rpcs_and_immutability.sql`

Creates/remediates:

- append-only event mutation-prevention trigger
- invoice and receipt protected FX/governance immutability triggers
- Draft protected FX/governance field guard requiring the trusted governed RPC context
- governed decision creation/versioning RPC
- atomic governed invoice Draft create RPC
- atomic governed receipt Draft create RPC
- governed invoice Draft FX mutation RPC
- governed receipt Draft FX mutation RPC
- guarded Draft invoice total-recalculation RPC for legitimate invoice-line edits
- DB-side actor role membership helper using `user_roles`
- approval/rejection RPCs with database-derived role checks
- 7-calendar-day stale-reference handling
- postability guard rejecting stale, missing-baseline, invalid, superseded, rejected, pending, and legacy-unverified decisions
- direct forward-safe `post_invoice` replacement that calls `fx_assert_booking_decision_postable` immediately after invoice row lock/status validation and before totals/base-total/journal/status/balance mutations
- direct forward-safe `post_receipt` replacement that calls `fx_assert_booking_decision_postable` immediately after receipt row lock/status validation and before journal/status mutations
- journal-entry and final status-transition posting guards retained as defense-in-depth
- service-role-only privilege hardening

### `database/024_fx_booking_decision_runtime_fix.sql`

Forward corrective migration after staging runtime RT-01.

Contains:

- `CREATE OR REPLACE FUNCTION public.fx_record_booking_decision(...)`
- exact existing signature preservation
- exact return type / PL/pgSQL / `SECURITY DEFINER` / `SET search_path = public`
- scalar final-source provenance variables:
  - `v_source_exchange_rate_id`
  - `v_source_fx_reference_rate_id`
- privilege reassertion:
  - revoke PUBLIC / anon / authenticated
  - grant execute to service_role

Does not contain:

- historical backfill DML
- transaction snapshot mutation outside the governed function behavior
- scheduler/Vault/provider changes
- production changes

### `database/025_fx_booking_decision_supersession_validation_fix.sql`

Forward corrective migration after staging runtime RT-05.

Contains:

- `CREATE OR REPLACE FUNCTION public.fx_validate_booking_rate_decision()`
- exact existing return type / PL/pgSQL / `SECURITY DEFINER` /
  `SET search_path = public`
- narrow lifecycle-only `Superseded` handling for historical decision versions
- explicit material-field immutability checks before the lifecycle-only
  exception is enabled
- invoice and receipt transaction-existence/company checks retained
- current/new decision transaction currency validation retained for INSERT and
  material UPDATE paths
- source, baseline, root/version/lineage, and BASE_PARITY validations retained
- privilege reassertion:
  - revoke PUBLIC / anon / authenticated
  - grant execute to service_role

Does not contain:

- historical backfill DML
- existing decision correction DML
- transaction snapshot rewrite
- journal mutation
- scheduler/Vault/provider changes
- production changes

## Service Integration

### Invoices

Updated:

- `backend/supabase/functions/invoices/validators.ts`
- `backend/supabase/functions/invoices/service.ts`

Coverage:

- invoice create now uses `fx_create_governed_invoice_draft`, which atomically owns header insert, line insert, initial booking-rate decision creation, transaction pointer assignment, and governance events in one PostgreSQL function transaction;
- create failure rolls back invoice header, invoice lines, decision rows, pointer assignment, and events through the database transaction boundary; cleanup compensation is no longer the consistency mechanism;
- material Draft FX edits use `fx_update_governed_invoice_fx`, which owns protected snapshot mutation and decision supersession in one database RPC;
- Draft invoice line edits recalculate protected invoice totals through `fx_recalculate_invoice_draft_totals` under the trusted protected-field guard;
- non-FX Draft edits remain normal service updates.

### Receipts

Updated:

- `backend/supabase/functions/receipts/validators.ts`
- `backend/supabase/functions/receipts/service.ts`

Coverage:

- receipt create now uses `fx_create_governed_receipt_draft`, which atomically owns receipt insert, initial booking-rate decision creation, transaction pointer assignment, and governance events in one PostgreSQL function transaction;
- create failure rolls back receipt, decision rows, pointer assignment, and events through the database transaction boundary; cleanup compensation is no longer the consistency mechanism;
- `updateDraftReceiptFx` provides a governed backend receipt Draft FX mutation path using `fx_update_governed_receipt_fx`;
- there is still no public receipt Draft edit route in the current API surface;
- direct Draft receipt protected-field updates are rejected unless executed within the trusted governed mutation RPC context.

### Imports / Intake

Updated:

- `backend/supabase/functions/imports/service.ts`

Coverage:

- invoice CSV/XLSX import creates invoices through `InvoiceService.createInvoice`, which routes to `fx_create_governed_invoice_draft`;
- receipt CSV/XLSX import creates receipts through `ReceiptService.createReceipt`, which routes to `fx_create_governed_receipt_draft`;
- receipt auto-post holds explicit imported FX rates as governed `MANUAL_OVERRIDE`;
- PDF/Image intake approval remains draft-only review metadata and does not create/post financial records;
- review queue approval remains metadata/retry workflow; financial creation occurs through the governed execute path.

## Audit Events

Implemented event emissions include:

- `LegacyBackfilled`
- `DecisionCreated`
- `BaselineResolved`
- `CatalogSelected`
- `ReferenceSelected`
- `OverrideSubmitted`
- `ApprovalRequired`
- `Approved`
- `Rejected`
- `DecisionSuperseded`
- `Posted`

`ReferenceSuggested` remains declared for a future suggestion UI path and is not claimed as emitted by the current backend implementation.

## Local Tests / Verification

### Deno check

Command:

```bash
cd backend/supabase/functions
deno check fx-rate-sync/index.ts fx-rates/index.ts invoices/index.ts receipts/index.ts imports/index.ts
```

Result after remediation:

```text
PASS
```

### Batch 9D-C governance structural tests

Command:

```bash
cd backend/supabase/functions
deno test --no-lock --allow-read=../../.. --config deno.json fx_booking_governance_test.ts
```

Result after remediation:

```text
14 passed / 0 failed
```

Covered:

- root lineage and historical bootstrap invariants;
- immutability predicate and trusted governed mutation guard;
- explicit imported FX auto-post hold;
- explicit imported FX field preservation from CSV/XLSX raw rows through
  mapped invoice/receipt create inputs;
- trusted import-origin provenance propagation from import batch/row context
  through invoice/receipt create services into import-aware governed create RPCs;
- atomic governed invoice/receipt create RPC wiring;
- governed invoice/receipt FX mutation RPC wiring;
- DB-derived approval role checks;
- stale reference governance;
- direct postability guard ordering inside forward-safe `post_invoice` / `post_receipt` replacements, before posting mutations;
- migration 022 ordering so transaction-pointer FKs and RLS/privilege ALTERs occur before historical backfill DML;
- migration 024 optional source provenance hardening for `fx_record_booking_decision`;
- migration 025 narrow lifecycle-only supersession validation for historical decision versions;
- migration 026 import-aware governed create overloads and import-origin
  supersession preservation;
- journal-entry/status guard defense-in-depth;
- audit event emission vocabulary.

### Existing Batch 9D-A/B FX regression tests

Command:

```bash
cd backend/supabase/functions
deno test --no-lock --allow-read=../../.. --config fx-rate-sync/deno.json fx-rate-sync/fx_reference_test.ts
```

Result after remediation:

```text
30 passed / 0 failed
```

## Local Limitations

- First staging attempt of migration `022` failed safely with SQLSTATE `55006` and rolled back visible Batch 9D-C objects.
- A later authorized staging execution successfully applied and verified `022`, successfully applied and verified `023`, and deployed the required staging Edge Functions.
- A later authorized staging execution successfully applied and verified corrective migration `024`.
- Branch smoke tests BR-01 through BR-06 passed after `024`.
- Staging runtime verification then stopped at RT-05 with `BR-FX-GOVERNANCE: invoice decision currency mismatch`.
- Corrective migration `025` was later applied and verified on staging.
- Focused invoice and receipt decision-versioning checks passed after `025`.
- RT-01 through RT-15 passed; RT-19 passed.
- RT-16 stopped at explicit foreign imported FX because import mapping dropped
  `exchange_rate` and `fx_override_reason`, causing catalog substitution and
  unattended posting.
- Local import-governance remediation has been completed and source-reviewed.
- The same targeted review identified direct governance `import_origin`
  provenance as missing for CSV/XLSX create paths. Local import-origin
  provenance remediation is now completed but has not yet been technically
  re-reviewed, applied to staging, or deployed to staging.
- Local Batch 9D-C tests are structural/source-order checks, not a substitute for staging SQL runtime proof.
- No live provider call was made.
- The RT-05 runtime stop preserved controlled Batch 9D-C branch-smoke evidence records and captured no pre-existing financial fingerprint drift.
- No frontend UX implementation was included; Batch 9D-D remains separate.

## Safety Boundary

```text
staging mutation during local import-governance fix: NO
Edge redeployment during local import-governance fix: NO
migration apply during local import-governance fix: NO
new staging test data during local import-governance fix: NO
preserved RT-16E failure evidence deleted: NO
staging mutation during local import-origin provenance fix: NO
Edge redeployment during local import-origin provenance fix: NO
remote SQL during local import-origin provenance fix: NO
new staging data during local import-origin provenance fix: NO
failure evidence deleted during local import-origin provenance fix: NO
staging financial data mutation: NO
scheduler change: NO
Vault change: NO
provider call: NO
production action: NO
POST /allocations/auto: still AUTO_ALLOCATION_DISABLED
```

## Next Gate

`Codex Batch 9D-C Closure Review`

Final consolidated status:

```text
Batch 9D-C staging runtime verification: PASS
Migrations 022-026:                      APPLIED + VERIFIED
Focused decision versioning:             PASS
Focused import-origin provenance:        PASS
RT-01 through RT-19:                      COMPLETE
Cleanup:                                 COMPLETE
Controlled Storage cleanup:              COMPLETE
Temporary Auth cleanup:                  COMPLETE
Post-cleanup financial comparison:       NO UNEXPECTED PRE-EXISTING DRIFT
Batch 9D-B scheduler:                    UNCHANGED AND ACTIVE
Production action:                       NONE
```

**Batch 9D-C is NOT officially closed.** Official closure requires Codex Batch 9D-C Closure Review.

*(Historical: the earlier interim next gate was "Codex targeted import-origin provenance Technical
Re-Review", which has since been satisfied; migration 026 and the corrected `imports` Edge Function were
subsequently applied/deployed to staging and verified. This is superseded by the consolidated PASS above.)*
