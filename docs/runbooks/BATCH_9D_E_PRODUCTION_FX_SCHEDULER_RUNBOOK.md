# Batch 9D-E Production FX Scheduler Runbook

Status: active in Production from 2026-07-23.

## Installed contract

- Project: `kusseuycqgdilychphpq`.
- Job: `batch_9d_e_fx_scheduler_production`.
- Schedule: `30 7 * * *` UTC (`15:30` Asia/Kuala_Lumpur).
- Route: `POST /fx-rate-sync/scheduled-sync`.
- Provider: `MAS` through the locked Frankfurter/MAS adapter contract.
- Pairs: the approved SGD, USD and EUR reference pairs into company base currency MYR.
- Authentication: dedicated secret stored in Supabase Vault under the name
  `batch_9d_e_fx_scheduler_secret`; raw value must never be printed or persisted.
- Company scope: the single approved Production company only.

The job body and caller cannot override company, provider, pairs or route. The Edge function validates the
scheduler secret and fails closed. A user JWT and the database admin key are not scheduler credentials.

## Health checks

1. Confirm exactly one active job with the installed name and cadence.
2. Confirm no competing job calls `fx-rate-sync`.
3. Confirm the command resolves the named Vault secret and targets `/scheduled-sync`.
4. Confirm the latest `fx_sync_runs` row is terminal; investigate stale `Running` state.
5. Confirm the lease table has no expired/stuck active lease.
6. Confirm each successful run reports three attempted pairs and no failed pair.
7. Confirm one Active reference version per company/pair/effective-date key.
8. Confirm no booked invoice, receipt, journal, allocation or `exchange_rates` row changed.

The Production activation proof recorded two successful paths—one manual and one controlled
scheduler-path invocation—with aggregate pairs `6/6/0`, three active rates, zero duplicate active
versions and zero live leases.

## Failure containment

- Provider or attribution failure: disable the scheduler job; retain last valid reference rows.
- Repeated partial failure: disable the job, inspect sanitized run category, then retry manually only after
  the provider contract is healthy.
- Lease/concurrency failure: do not bypass fencing; resolve the stale lease using the accepted recovery
  contract.
- Bad reference: disable scheduler and supersede through the versioned reference correction path. Never
  rewrite booked rates.
- Secret failure: rotate the scheduler secret in Edge configuration and Vault together; never record the
  value in evidence.

There is intentionally no Production `daily-overdue` cron job. Do not repurpose this scheduler or its
secret for `daily-overdue`.
