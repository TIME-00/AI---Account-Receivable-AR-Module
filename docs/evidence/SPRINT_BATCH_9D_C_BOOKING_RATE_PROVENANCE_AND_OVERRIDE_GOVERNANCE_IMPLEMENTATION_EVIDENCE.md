# Batch 9D-C — Booking Rate Provenance and Override Governance — Implementation Evidence

## Status

Local implementation: **COMPLETED**

Staging migration apply: **NOT PERFORMED**

Staging deployment: **NOT PERFORMED**

Staging runtime verification: **PENDING SEPARATE AUTHORIZATION**

Production action: **NOT PERFORMED**

## Baseline

Starting branch: `main`

Starting HEAD / origin: `4c268b67c2368390d028c9fa34a46ef683c1e216`

Starting commit: `docs(plan): finalize Batch 9D-C decision lineage and backfill linkage`

Starting worktree: clean

## Implementation Scope

Implemented local repository changes for Batch 9D-C only:

- booking-rate governance schema;
- decision lineage and transaction linkage;
- append-only governance event table;
- truthful historical bootstrap backfill;
- posted FX/governance immutability triggers;
- governed service-role RPCs;
- transaction-safe postability guard;
- invoice/receipt creation and draft-edit integration;
- receipt import auto-post hold for explicit imported FX rates;
- local static/structural tests.

No staging configuration, Vault secret, scheduler, provider, or production change was performed.

## Database Artifacts

### `database/022_fx_booking_rate_governance.sql`

Creates:

- `public.fx_booking_rate_decisions`;
- `public.fx_booking_rate_decision_events`;
- `invoices.fx_source_category`;
- `invoices.fx_decision_id`;
- `receipts.fx_source_category`;
- `receipts.fx_decision_id`;
- explicit source FKs;
- explicit baseline FKs;
- decision lineage fields:
  - `root_decision_id`;
  - `decision_version`;
  - `supersedes_decision_id`;
- RLS policies for company-scoped reads;
- historical bootstrap decision rows;
- `LegacyBackfilled` events.

Backfill rules preserve booked numeric snapshots and do not re-resolve or fabricate provenance:

- same-currency `exchange_rate = 1.0` -> `BASE_PARITY`;
- same-currency `exchange_rate != 1.0` -> `LEGACY_UNVERIFIED` + `BASE_CURRENCY_NON_PARITY_RATE`;
- foreign-currency historical rows -> `LEGACY_UNVERIFIED`.

### `database/023_fx_booking_rate_rpcs_and_immutability.sql`

Creates:

- append-only mutation-prevention trigger for event rows;
- invoice posted-FX/governance immutability trigger;
- receipt posted-FX/governance immutability trigger;
- `fx_record_booking_decision`;
- `fx_submit_override`;
- `fx_select_reference_booking_rate`;
- `fx_approve_booking_decision`;
- `fx_reject_booking_decision`;
- `fx_assert_booking_decision_postable`;
- invoice/receipt posting status-transition guards that execute postability checks in the same database transaction.

All new mutation RPCs are hardened for service-role execution only.

## Service Integration

### Invoices

Updated:

- `backend/supabase/functions/invoices/validators.ts`
- `backend/supabase/functions/invoices/service.ts`

Invoice create and material draft FX edits now record/supersede booking-rate decisions via `fx_record_booking_decision`.

Explicit caller-provided rates are classified for governance through `p_explicit_rate_supplied`.

### Receipts

Updated:

- `backend/supabase/functions/receipts/validators.ts`
- `backend/supabase/functions/receipts/service.ts`

Receipt create now records booking-rate decisions via `fx_record_booking_decision`.

### Imports

Updated:

- `backend/supabase/functions/imports/service.ts`

Receipt import auto-post now holds explicit imported FX rates as governed manual overrides instead of silently auto-posting them.

`POST /allocations/auto` remains disabled and was not modified.

## Local Tests / Verification

### Deno check

Command:

```bash
cd backend/supabase/functions
deno check fx-rate-sync/index.ts fx-rates/index.ts invoices/index.ts receipts/index.ts imports/index.ts
```

Result:

```text
PASS
```

### Batch 9D-C governance structural tests

Command:

```bash
cd backend/supabase/functions
deno test --no-lock --allow-read=../../.. --config deno.json fx_booking_governance_test.ts
```

Result:

```text
4 passed / 0 failed
```

Covered:

- migration root-lineage and bootstrap invariants;
- immutable protected-field predicate;
- import explicit-rate auto-post hold;
- invoice/receipt service governance RPC wiring.

### Existing Batch 9D-A/B FX regression tests

Command:

```bash
cd backend/supabase/functions
deno test --no-lock --allow-read=../../.. --config fx-rate-sync/deno.json fx-rate-sync/fx_reference_test.ts
```

Result:

```text
30 passed / 0 failed
```

## Local Limitations

- Migrations `022` and `023` were not applied to staging or any remote database.
- SQL runtime behavior requires later Staging Readiness Review and explicitly authorized staging migration/runtime verification.
- No live provider call was made.
- No staging financial baseline or runtime financial zero-mutation proof was captured in this local implementation gate.
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

`Codex Batch 9D-C Technical Review`

No staging deployment, migration apply, scheduler change, provider call, or production action has been performed.
