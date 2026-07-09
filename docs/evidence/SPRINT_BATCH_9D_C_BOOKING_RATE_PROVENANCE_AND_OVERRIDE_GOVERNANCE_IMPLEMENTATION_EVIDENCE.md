# Batch 9D-C - Booking Rate Provenance and Override Governance - Implementation Evidence

## Status

Local implementation: **COMPLETED**

Technical Review remediation: **COMPLETED LOCALLY**

Second narrow Technical Re-Review remediation: **COMPLETED LOCALLY**

First authorized staging migration 022 attempt: **FAILED AND STOPPED**

Targeted migration 022 ordering remediation: **COMPLETED LOCALLY**

Staging deployment: **NOT PERFORMED**

Staging runtime verification: **PENDING SEPARATE AUTHORIZATION**

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
10 passed / 0 failed
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
- Migration `023` was not attempted.
- No staging re-attempt has been performed after the local migration-ordering fix.
- SQL compile/runtime behavior of the corrected migration still requires an explicitly authorized staging migration/runtime gate after targeted re-review.
- Local Batch 9D-C tests are structural/source-order checks, not a substitute for staging SQL runtime proof.
- No live provider call was made.
- The failed staging attempt captured no financial fingerprint drift, but no Batch 9D-C runtime zero-mutation proof was executed.
- No frontend UX implementation was included; Batch 9D-D remains separate.

## Safety Boundary

```text
staging migration re-attempt after fix: NO
023 apply: NO
staging deployment: NO
staging financial data mutation: NO
scheduler change: NO
provider call: NO
production action: NO
POST /allocations/auto: still AUTO_ALLOCATION_DISABLED
```

## Next Gate

`Codex Batch 9D-C Technical Re-Review`

No staging migration re-attempt, deployment, scheduler change, provider call, or production action has been performed after this local fix.
