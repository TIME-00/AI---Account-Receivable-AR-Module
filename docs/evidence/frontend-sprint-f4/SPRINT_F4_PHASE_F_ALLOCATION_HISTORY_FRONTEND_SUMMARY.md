# Sprint F4 Phase F Allocation History Frontend Summary

## Scope

Sprint F4 Phase F adds read-only allocation visibility to the client-facing AR prototype.

Implemented display areas:
- Allocation Wizard allocation history
- Receipt Detail allocation details
- Invoice Detail payment allocations

Phase F does not add allocation creation, reversal, cancellation, auto-allocation controls, posting, receipt import changes, invoice import changes, or financial RPC changes.

## Backend API Safety

`GET /allocations` was updated to return denormalized allocation history rows for frontend display.

Security and visibility rules enforced by the API:
- allowed read roles are `AR Clerk`, `AR Supervisor`, `Finance Manager`, and `Auditor`
- `System Admin` is denied for operational allocation history reads
- results are scoped to `auth.companyId`
- AR Clerk users are restricted to assigned customers only
- hidden and deleted customers are excluded
- response data is built through the existing Edge Function/API layer

No direct frontend Supabase table queries were added.

## Frontend Changes

Added:
- `AllocationDetailFull` frontend type
- `useAllocations()` read-only hook
- reusable `AllocationHistoryTable`

Updated pages:
- `/allocations`
- `/receipts/[id]`
- `/invoices/[id]`

The table supports status and method filters on the Allocation Wizard page and filtered detail views on receipt and invoice pages.

## Read-Only Guarantee

Phase F only calls `GET /allocations`.

No UI controls were added for:
- creating allocations
- reversing allocations
- enabling `/allocations/auto`
- updating receipts
- updating invoices
- updating allocation records

## Local Verification

Completed:
- `deno check allocations/index.ts`
- `npm.cmd run build`
- `git diff --check`
- no frontend `supabase.from` direct table query found

Pending before staging sign-off:
- staging deploy of `allocations` Edge Function
- API smoke test for `GET /allocations`
- role smoke tests for Auditor, System Admin, and AR Clerk assignment filtering
- hidden customer allocation exclusion smoke test
- frontend smoke test on Allocation Wizard, Receipt Detail, and Invoice Detail

## Known Limitations

- The current allocation RPC records imported exact-reference allocations as `Manual`, so method badges may show `Manual` for allocations that originated from import auto-allocation.
- Phase F does not implement `GET /allocations/:id`; the UI uses filtered list queries only.
- Phase F does not add allocation export or customer-detail allocation tabs.
