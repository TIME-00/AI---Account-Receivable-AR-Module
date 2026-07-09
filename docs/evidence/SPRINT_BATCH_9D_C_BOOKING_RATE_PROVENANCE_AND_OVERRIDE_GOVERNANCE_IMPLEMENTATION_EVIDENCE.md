# Batch 9D-C - Booking Rate Provenance and Override Governance - Implementation Evidence

## Status

Local implementation: **COMPLETED**

Technical Review remediation: **COMPLETED LOCALLY**

Staging migration apply: **NOT PERFORMED**

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
- governed decision creation/versioning RPC
- governed invoice Draft FX mutation RPC
- governed receipt Draft FX mutation RPC
- DB-side actor role membership helper using `user_roles`
- approval/rejection RPCs with database-derived role checks
- 7-calendar-day stale-reference handling
- postability guard rejecting stale, missing-baseline, invalid, superseded, rejected, pending, and legacy-unverified decisions
- early journal-entry posting guard before `INV`/`CN`/`DN`/`RCT` journal insertion
- final status-transition posting guards as defense-in-depth
- service-role-only privilege hardening

## Service Integration

### Invoices

Updated:

- `backend/supabase/functions/invoices/validators.ts`
- `backend/supabase/functions/invoices/service.ts`

Coverage:

- invoice create records a booking-rate decision;
- if decision creation fails during invoice create, the created Draft invoice/lines are cleaned up;
- material Draft FX edits use `fx_update_governed_invoice_fx`, which owns protected snapshot mutation and decision supersession in one database RPC;
- non-FX Draft edits remain normal service updates.

### Receipts

Updated:

- `backend/supabase/functions/receipts/validators.ts`
- `backend/supabase/functions/receipts/service.ts`

Coverage:

- receipt create records a booking-rate decision;
- if decision creation fails during receipt create, the created Draft receipt is cleaned up;
- `updateDraftReceiptFx` provides a governed backend receipt Draft FX mutation path using `fx_update_governed_receipt_fx`;
- there is still no public receipt Draft edit route in the current API surface.

### Imports / Intake

Updated:

- `backend/supabase/functions/imports/service.ts`

Coverage:

- invoice CSV/XLSX import creates invoices through `InvoiceService.createInvoice`;
- receipt CSV/XLSX import creates receipts through `ReceiptService.createReceipt`;
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
9 passed / 0 failed
```

Covered:

- root lineage and historical bootstrap invariants;
- immutability predicate;
- explicit imported FX auto-post hold;
- governed invoice/receipt FX mutation RPC wiring;
- DB-derived approval role checks;
- stale reference governance;
- early posting guard before journal insertion;
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

- Migrations `022` and `023` were not applied to staging or any remote database.
- SQL compile/runtime behavior still requires an explicitly authorized staging migration/runtime gate.
- No live provider call was made.
- No staging financial baseline or runtime zero-mutation proof was captured in this local implementation gate.
- No frontend UX implementation was included; Batch 9D-D remains separate.

## Safety Boundary

```text
staging migration applied: NO
staging deployment: NO
staging financial data mutation: NO
scheduler change: NO
provider call: NO
production action: NO
POST /allocations/auto: still AUTO_ALLOCATION_DISABLED
```

## Next Gate

`Codex Batch 9D-C Technical Re-Review`

No staging deployment, migration apply, scheduler change, provider call, or production action has been performed.
