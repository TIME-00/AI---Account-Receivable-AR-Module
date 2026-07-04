# Sprint Batch 9C Production Backend Deployment Evidence

## Scope

Batch 9C Receipt PDF/Image Import Intake production backend deployment.

This gate was production backend deployment only. It deployed the existing `imports` Supabase Edge Function to production so the Batch 9C backend/API changes can be used by the production backend after the prior staging deployment and synthetic smoke evidence.

## Approval

User explicitly approved Batch 9C Gate P1A production backend deployment only.

Approved action:

- Deploy `imports` Edge Function to production project `kusseuycqgdilychphpq`.

Forbidden actions for this gate:

- No production smoke.
- No production upload.
- No import batch or import row creation.
- No receipt, invoice, allocation, or journal record creation.
- No production data mutation.
- No migration.
- No frontend deployment.
- No unrelated Edge Function deployment.
- No real customer documents.
- No OCR provider, key, or worker.
- No `/allocations/auto` change.

## Baseline

- Baseline commit: `e0b9153ba1575fe07d921f3672c537bb75be0b4d`
- Branch: `main`
- Production Supabase project ref: `kusseuycqgdilychphpq`
- Staging Supabase project ref not targeted: `gcdsdyegwjdcskpukqlq`
- Batch 9C migration status: no migration required
- Deployment scope: `imports` Edge Function only

## Pre-deployment function inventory

Read-only production function inventory before deployment:

| Function | Status | Version |
| --- | --- | ---: |
| allocations | ACTIVE | 13 |
| auth | ACTIVE | 1 |
| imports | ACTIVE | 21 |
| invoices | ACTIVE | 20 |
| lookups | ACTIVE | 1 |
| notifications | ACTIVE | 1 |
| receipts | ACTIVE | 13 |
| reports | ACTIVE | 12 |
| search | ACTIVE | 1 |

## Deployment command

```text
supabase functions deploy imports --project-ref kusseuycqgdilychphpq --use-api --yes
```

Result:

- Deployment succeeded.
- Supabase CLI reported: `Deployed Functions on project kusseuycqgdilychphpq: imports`.
- Shared source files were packaged as dependencies of the `imports` function. No other Edge Function was deployed as a separate deployment target.

## Post-deployment function inventory

Read-only production function inventory after deployment:

| Function | Status | Version |
| --- | --- | ---: |
| allocations | ACTIVE | 13 |
| auth | ACTIVE | 1 |
| imports | ACTIVE | 22 |
| invoices | ACTIVE | 20 |
| lookups | ACTIVE | 1 |
| notifications | ACTIVE | 1 |
| receipts | ACTIVE | 13 |
| reports | ACTIVE | 12 |
| search | ACTIVE | 1 |

Deployment verification:

- `imports` changed from ACTIVE v21 to ACTIVE v22.
- Unrelated function versions remained unchanged.
- Production target was `kusseuycqgdilychphpq`.
- Staging target `gcdsdyegwjdcskpukqlq` was not targeted.

## Safety confirmations

- No migration was created or applied.
- No frontend deployment was performed.
- No production smoke was run.
- No PDF/Image/CSV file was uploaded.
- No import batch or import row was created.
- No receipt record was created.
- No invoice record was created.
- No allocation record was created.
- No journal entry or journal entry line was created.
- No financial mutation was performed.
- No real customer document was used.
- No OCR provider, key, or worker was enabled or added.
- No production OCR provider was configured.
- No `/allocations/auto` change was made.
- `/allocations/auto` runtime verification was intentionally left for a separately approved production verification gate.
- No `ar.*` schema was used.

## Next gate

Next recommended gate: Gate P1B production frontend rollout/verification.

Gate P1B should verify the production frontend state and copy/read-only UI behavior without uploads or production data mutation.

## Final verdict

PRODUCTION BACKEND DEPLOYED
