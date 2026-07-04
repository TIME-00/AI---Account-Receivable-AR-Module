# Sprint Batch 9C Production Auto-Allocation Disabled Recheck Evidence

## Scope

Batch 9C P2-Fix1 production `/allocations/auto` runtime invariant recheck only.

This task resolved the Gate P2 limitation where the first production runtime check returned HTTP 401 because the available token was not accepted as a production application-user JWT.

No upload, import action, review save, draft approval, receipt creation, invoice creation, allocation creation, journal entry creation, migration, deployment, or production synthetic smoke was performed.

## Baseline

- Baseline commit: `0c19294de579216fe1309e0c2c2d767c06c28d8f`
- Branch: `main`
- Production Supabase project ref: `kusseuycqgdilychphpq`
- Staging Supabase project ref not targeted: `gcdsdyegwjdcskpukqlq`
- Prior P2 evidence: `docs/evidence/SPRINT_BATCH_9C_PRODUCTION_READ_ONLY_VERIFICATION_EVIDENCE.md`

## Source invariant confirmation

Before the production runtime call, source was verified in:

- `backend/supabase/functions/allocations/index.ts`

Confirmed source behavior:

- `POST /allocations/auto` returns HTTP 403.
- Error code is `AUTO_ALLOCATION_DISABLED`.
- The route returns before any allocation service logic.

## Production authentication sanity check

Production `/auth/me` was called with an existing approved production application-user token and production company context.

Result:

- HTTP status: 200
- Safe role: Finance Manager

No token, password, refresh token, cookie, Authorization header, service-role key, or private credential was printed or recorded.

## Production runtime invariant check

Exactly one production runtime invariant check was performed:

```text
POST /allocations/auto
```

Target:

- Production project ref: `kusseuycqgdilychphpq`

Result:

- HTTP status: 403
- Error code: `AUTO_ALLOCATION_DISABLED`
- Safe message: automatic allocation route is disabled until reviewed; use manual allocation for verified allocation flows.

No allocation workaround was attempted. No alternate allocation endpoint was called.

## Safety confirmation

This recheck performed:

- No file upload.
- No import batch creation.
- No import row creation.
- No review save.
- No draft approval.
- No receipt creation.
- No invoice creation.
- No allocation creation.
- No journal entry creation.
- No migration.
- No backend deployment.
- No frontend deployment.
- No production synthetic smoke.
- No real customer document usage.
- No direct protected financial-table mutation.
- No `/allocations/auto` source modification.

## Limitation resolution

The Gate P2 limitation is resolved.

Production runtime now confirms:

- HTTP 403
- `AUTO_ALLOCATION_DISABLED`

## Final verdict

PASS

Batch 9C may proceed to final closure evidence and completion.
