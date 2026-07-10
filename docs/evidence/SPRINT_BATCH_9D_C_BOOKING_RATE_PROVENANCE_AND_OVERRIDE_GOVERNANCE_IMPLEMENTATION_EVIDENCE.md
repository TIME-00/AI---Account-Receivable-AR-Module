# Batch 9D-C - Booking Rate Provenance and Override Governance - Implementation Evidence

## Status

Local implementation: **COMPLETED**

Technical Review remediation: **COMPLETED LOCALLY**

Second narrow Technical Re-Review remediation: **COMPLETED LOCALLY**

First authorized staging migration 022 attempt: **FAILED AND STOPPED**

Targeted migration 022 ordering remediation: **COMPLETED LOCALLY**

Resumed staging migration/deployment execution: **COMPLETED THROUGH EDGE DEPLOYMENT**

Staging runtime verification: **STOPPED AT RT-05**

Targeted runtime remediation: **COMPLETED LOCALLY**

Forward corrective migration 024 staging apply: **APPLIED + VERIFIED PASS**

Targeted decision-versioning remediation: **COMPLETED LOCALLY**

Forward corrective migration 025 staging apply: **NOT YET PERFORMED**

Production action: **NOT PERFORMED**

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
12 passed / 0 failed
```

Covered:

- root lineage and historical bootstrap invariants;
- immutability predicate and trusted governed mutation guard;
- explicit imported FX auto-post hold;
- atomic governed invoice/receipt create RPC wiring;
- governed invoice/receipt FX mutation RPC wiring;
- DB-derived approval role checks;
- stale reference governance;
- direct postability guard ordering inside forward-safe `post_invoice` / `post_receipt` replacements, before posting mutations;
- migration 022 ordering so transaction-pointer FKs and RLS/privilege ALTERs occur before historical backfill DML;
- migration 024 optional source provenance hardening for `fx_record_booking_decision`;
- migration 025 narrow lifecycle-only supersession validation for historical decision versions;
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
- Corrective migration `025` has not yet been applied to staging.
- SQL compile/runtime behavior of corrective migration `025` still requires a targeted technical re-review and explicit resumed staging execution.
- Local Batch 9D-C tests are structural/source-order checks, not a substitute for staging SQL runtime proof.
- No live provider call was made.
- The RT-05 runtime stop preserved controlled Batch 9D-C branch-smoke evidence records and captured no pre-existing financial fingerprint drift.
- No frontend UX implementation was included; Batch 9D-D remains separate.

## Safety Boundary

```text
staging corrective migration 025 apply: NO
022 rerun during local decision-versioning fix: NO
023 rerun during local decision-versioning fix: NO
024 rerun during local decision-versioning fix: NO
Edge redeployment during local decision-versioning fix: NO
new staging test data during local decision-versioning fix: NO
preserved staging failure evidence deleted: NO
staging financial data mutation: NO
scheduler change: NO
Vault change: NO
provider call: NO
production action: NO
POST /allocations/auto: still AUTO_ALLOCATION_DISABLED
```

## Next Gate

`Codex targeted decision-versioning fix Technical Re-Review`

Do not apply corrective migration 025 to staging until that targeted re-review passes.
