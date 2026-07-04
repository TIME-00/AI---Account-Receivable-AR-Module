# Sprint Batch 9C Staging Deployment Evidence

## Scope

Batch 9C Gate S1 staging deployment only.

This evidence records deployment of the Batch 9C `imports` Edge Function to staging. It does not include staging synthetic smoke, uploads, import creation, financial mutation testing, production deployment, or production smoke.

## Baseline

- Branch: `main`
- Baseline commit deployed: `4c334cef8e207dc2d30f724405b42d57835898a9`
- Batch: 9C Receipt PDF/Image Import Intake
- Approval: user explicitly approved Gate S1 staging deployment only

## Target confirmation

- Staging Supabase project ref targeted: `gcdsdyegwjdcskpukqlq`
- Production Supabase project ref explicitly not targeted: `kusseuycqgdilychphpq`
- Production frontend not touched: `https://account-receivable-module.vercel.app/`

## Pre-deployment verification

- Current branch confirmed as `main`.
- Local HEAD confirmed equal to `origin/main`.
- Local HEAD and `origin/main`: `4c334cef8e207dc2d30f724405b42d57835898a9`.
- Worktree confirmed clean before deployment.
- No Batch 9C database migration was needed or applied.
- Required backend deployment scope confirmed as the `imports` Edge Function only.
- No frontend staging deployment was triggered manually in this Gate S1 step. Frontend deployment/preview behavior, if any, remains controlled by the existing project/Vercel workflow and was not manually invoked.

## Pre-deploy staging function inventory

Command:

```text
supabase functions list --project-ref gcdsdyegwjdcskpukqlq -o json
```

Relevant result before deployment:

- `imports`: `ACTIVE`, version `8`

Related function versions before deployment included:

- `allocations`: `ACTIVE`, version `5`
- `invoices`: `ACTIVE`, version `7`
- `receipts`: `ACTIVE`, version `3`
- `reports`: `ACTIVE`, version `5`

## Deployment command

Command:

```text
supabase functions deploy imports --project-ref gcdsdyegwjdcskpukqlq --use-api --yes
```

Result:

- Deployment succeeded.
- Deployed function: `imports`
- Target project: `gcdsdyegwjdcskpukqlq`
- Supabase CLI output confirmed:
  - `Deployed Functions on project gcdsdyegwjdcskpukqlq: imports`

Shared dependency files were packaged as assets of the `imports` function. No unrelated Edge Functions were deployed.

## Post-deploy staging function inventory

Command:

```text
supabase functions list --project-ref gcdsdyegwjdcskpukqlq -o json
```

Relevant result after deployment:

- `imports`: `ACTIVE`, version `9`

Related function versions after deployment:

- `allocations`: `ACTIVE`, version `5`
- `invoices`: `ACTIVE`, version `7`
- `receipts`: `ACTIVE`, version `3`
- `reports`: `ACTIVE`, version `5`

No unrelated function version changes were observed.

## Migration status

- No migration was created.
- No migration was applied.
- Batch 9C staging readiness previously confirmed that existing schema supports the required receipt PDF/Image intake shape.

## Smoke and data-action status

Not performed in Gate S1:

- No staging synthetic smoke.
- No upload.
- No PDF/image/CSV file selected or uploaded.
- No import batch created.
- No import row created.
- No receipt created.
- No invoice created.
- No allocation created.
- No journal entry created.
- No financial mutation test.
- No `/allocations/auto` runtime call.

`/allocations/auto` was not modified. Runtime HTTP 403 verification remains for Gate S2 staging synthetic smoke approval.

## Production safety confirmation

- No production deployment.
- No production migration.
- No production smoke.
- No production data mutation.
- Production ref `kusseuycqgdilychphpq` was not targeted.

## Document/data safety confirmation

- No real customer documents were used.
- No synthetic smoke documents were uploaded in Gate S1.
- No records were created in staging or production.

## Next gate

Next gate: Batch 9C Gate S2 staging synthetic smoke approval.

Gate S2 should remain separate and should use only synthetic files. It should verify accepted/rejected file behavior, signed preview, manual review/save, approve draft, zero financial records, and `/allocations/auto` HTTP 403 `AUTO_ALLOCATION_DISABLED`.

## Final Gate S1 verdict

STAGING DEPLOYED
