# Batch 9D-A Fix2 Staging Concurrency Test Harness

Status: `PREPARED BUT NOT YET RUNTIME-EXECUTED`

Purpose: deterministic staging-only checks for Batch 9D-A Fix2 after migrations `017`, `018`, and `019` are applied to staging and the `fx-rate-sync` / `fx-rates` functions are deployed to staging.

Do not run this against production. Use staging project `gcdsdyegwjdcskpukqlq` only, with synthetic company/test data and no real provider credentials.

## Preconditions

- `public.fx_sync_leases` exists.
- `public.fx_upsert_reference_rate(..., p_lease_token uuid)` is the Fix2 version from `database/019_fx_reference_transactional_fencing.sql`.
- The test company has base currency `MYR`.
- Test provider is `mock_batch_9d_a`.
- All test rates are synthetic reference rates only.

## Required runtime checks

1. Stale owner versus successor reclaim

   - Session A acquires a lease and obtains `run_id` + `lease_token`.
   - Session A starts a transaction and calls `fx_upsert_reference_rate` so it locks the matching `fx_sync_leases` row.
   - Session B attempts expired-lease reclaim for the same `company_id + provider`.
   - Expected: Session B cannot establish successor ownership until Session A commits/rolls back.

2. Successor reclaim wins first

   - Allow the original lease to expire.
   - Session B reclaims the lease and obtains a new `run_id` + `lease_token`.
   - Session A calls `fx_upsert_reference_rate` using the old owner values.
   - Expected: Session A receives `FX_SYNC_LEASE_LOST` and no reference-rate write occurs.

3. Old owner cannot write after successor ownership

   - After successor ownership is established, retry all old-owner protected RPCs:
     - `fx_renew_sync_lease`
     - `fx_upsert_reference_rate`
     - `fx_complete_sync_run`
   - Expected: all old-owner attempts fail closed or return non-owner results; no lease release or protected write is performed.

4. Concurrent first insert

   - Two sessions concurrently call `fx_upsert_reference_rate` for the same logical key and same rate under the same valid owner.
   - Expected: one insert and one noop/equivalent result; exactly one Active row remains.

5. Concurrent duplicate retry

   - Repeat the same logical key/rate concurrently after Active row exists.
   - Expected: no new history row; exactly one Active row remains.

6. Concurrent correction

   - Start from Active `R0`.
   - Concurrently submit different corrected rates `R1` and `R2`.
   - Expected: valid serialized history chain, exactly one Active row, Superseded rows retain `supersedes_rate_id` linkage.

7. Retry versus correction

   - Start from Active `R0`.
   - Concurrently retry `R0` and correct to `R1`.
   - Expected: final state matches a valid serial ordering; no duplicate Active row and no broken history.

## Verification queries

Use read-only checks scoped to the synthetic test company/provider/key:

```sql
SELECT company_id, provider, owner_run_id, lease_expires_at
FROM public.fx_sync_leases
WHERE company_id = :'company_id'
  AND provider = 'mock_batch_9d_a';

SELECT id, from_currency, to_currency, rate, effective_date, provider,
       provider_rate_type, status, supersedes_rate_id, sync_run_id
FROM public.fx_reference_rates
WHERE company_id = :'company_id'
  AND provider = 'mock_batch_9d_a'
  AND from_currency = 'SGD'
  AND to_currency = 'MYR'
  AND effective_date = DATE '2026-07-03'
ORDER BY created_at, id;

SELECT id, status, attempted_pair_count, succeeded_pair_count,
       failed_pair_count, error_category, completed_at
FROM public.fx_sync_runs
WHERE company_id = :'company_id'
  AND provider = 'mock_batch_9d_a'
ORDER BY started_at DESC;
```

## Safety boundary

These checks must not:

- call a real FX provider;
- configure provider credentials;
- write `public.exchange_rates`;
- mutate invoices, receipts, allocations, journal entries, or balances;
- call or modify `/allocations/auto`;
- run against production.
