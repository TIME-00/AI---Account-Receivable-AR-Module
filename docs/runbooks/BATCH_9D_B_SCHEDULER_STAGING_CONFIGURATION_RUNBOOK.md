# Batch 9D-B Scheduler Staging Configuration Runbook

Status: prepared for a later explicit staging deployment / scheduler activation gate. Do not execute during
implementation.

## Scope

This runbook records the approved Batch 9D-B scheduler configuration approach without committing raw
secrets or activating cron.

- Staging only.
- No production action.
- No real provider call during implementation.
- No service-role key in cron.
- No user JWT as a permanent scheduler credential.
- Scheduler invokes Edge Function orchestration only: `POST /fx-rate-sync/scheduled-sync`.
- Scheduler must not call helper RPCs directly and must not mutate FX tables directly.

## Runtime secrets

Create these only during the later authorized staging deployment / activation gate:

- Supabase Vault secret holding the scheduler invocation secret.
- Edge Function runtime secret `FX_SCHEDULER_SECRET` with the matching value.
- Edge Function runtime secret `FX_SCHEDULER_COMPANY_ID` containing the approved staging company UUID.

Never write secret values to Git, SQL migration text, logs, evidence, or terminal output.

## Approved scheduler cadence

```text
15:30 Asia/Singapore daily
```

Same-day freshness is not guaranteed. The provider-returned effective date is authoritative.

## Approved provider and pairs

Provider:

```text
MAS
```

Initial staging allowlist:

```text
SGD -> MYR
USD -> MYR
EUR -> MYR
```

Preflight rule: if the approved staging company base currency is not `MYR`, stop and require a plan
amendment. Do not silently change the destination currency or auto-expand pairs.

## Scheduler artifact decision

No scheduler cron migration is created in the implementation commit because scheduler activation remains a
separate staging gate and the final cron/Vault wiring is environment-specific. This runbook is the
approved scheduler artifact for implementation. If the later staging gate requires SQL-managed cron setup,
create a forward-only migration or staging SQL artifact at that gate using Vault secret references by name
only.

Note: Batch 9D-B implementation does include `database/021_fx_real_provider_identifier_support.sql` for
the database provider identifier constraint update required by the locked uppercase provider key `MAS`.
That migration is not a scheduler activation artifact and does not create cron jobs or store secrets.

## Later staging activation verification

Before activation:

1. Confirm target project is staging, not production.
2. Confirm migrations 017-021 are applied, including
   `database/021_fx_real_provider_identifier_support.sql`. Migration 021 is required before real MAS
   provider sync because it widens the FX provider identifier constraints to accept the locked uppercase
   provider key `MAS`. Migration 021 is FX real provider identifier compatibility support only: it does not
   configure the scheduler, does not create pg_cron jobs, does not store secrets, does not configure Vault,
   does not activate the scheduler, does not call Frankfurter, and does not mutate `public.exchange_rates`
   or any financial tables.
3. Deploy `fx-rate-sync`.
4. Configure `FX_SCHEDULER_SECRET` and `FX_SCHEDULER_COMPANY_ID` as runtime secrets.
5. Store the matching scheduler secret in Supabase Vault.
6. Confirm no raw secret is visible in SQL, logs, or evidence.
7. Verify manual `POST /fx-rate-sync/sync` still requires Finance Manager or System Admin user JWT.
8. Verify `POST /fx-rate-sync/scheduled-sync` rejects missing and invalid scheduler secret.
9. Verify valid scheduler secret invokes only the configured company and fixed pair allowlist.
10. Verify scheduler/manual overlap uses `fx_sync_leases` and returns safe overlap behavior.

Do not activate production scheduler in Batch 9D-B.
