# Batch 9D-E1 F3 Production Test-Data Reset Runbook

Status: **local implementation only — production mutation is not authorized**.

## Purpose and fixed decision

The project owner/data custodian has classified all current production AR
business rows as `P1 — SYNTHETIC / DEMO DATA`. A future separately authorized
F3-P4 may retain exactly ten principal demo scenarios and remove the remaining
test business graph. This runbook does not authorize that execution.

The exact company is `00000000-0000-0000-0000-000000000001`. The ten principal
anchors and their scenario hashes are fixed in
`database/operators/batch_9d_e1_f3_test_data_reset_manifest.sql`. Shared receipt,
journal and import relationships expand those anchors to 16 retained physical
documents; that closure does not create additional principal scenarios.

## Artifacts

- `batch_9d_e1_f3_test_data_reset_manifest.sql`: read-only dry run; always rolls
  back and returns the exact in-session scenario/dependency manifest plus
  hashes, counts and NUMERIC totals. Raw IDs stay in the controlled execution
  session and are not copied into Git evidence.
- `batch_9d_e1_f3_test_data_reset_apply.sql`: postgres-only, exact-hash-bound,
  serializable database phase. Do not run before a distinct F3-P4 authorization.
- `batch_9d_e1_f3_test_data_reset_contract_test.ts`: source and behavioral
  contract tests.

Neither SQL file is a numbered migration. Neither installs an RPC, function,
table, policy, grant or reusable financial mutation surface.

## Required future authorization sequence

1. Obtain explicit F3-P4 production data-mutation authorization naming the
   production project and both full manifest hashes.
2. Reconfirm branch, reviewed commit, target project ref and postgres executor.
3. Execute the dry run only. Require `state = READY`, principal count 10,
   scenario-hash matches 10, retained settlement mismatch count 0,
   unclassified FK count 0 and lifecycle-trigger count 0.
4. Capture the sanitized dry-run JSON and the exact 63 Storage object names in
   secure session memory. Do not put object names or source rows in Git.
5. Confirm the 63 ordered `bucket|name` values hash to
   `f77add7cc35df009832237db3083c1db63a65eb0d8477aa1b5fd0e6fa7551094`;
   confirm the six retained objects hash to
   `b5f58c7c85358da973280bf4e59f5862944e451f50cd521cd6f7c05139468620`.
6. In the same approved postgres session, set the non-secret authorization
   binding documented in the apply file and execute the database phase. No
   network call or human interaction is permitted while its locks are held.
7. Capture the database-phase success notices and committed after-state hash.
8. In a separately bounded part of the same expressly authorized F3-P4 gate,
   remove only the captured 63 object names through the supported Supabase
   Storage API. This cross-system step is necessarily outside the PostgreSQL
   transaction. It is retryable and must not touch the six retained objects.
9. Re-list Storage metadata read-only. Require delete-object count 0 and the six
   retained object hash unchanged. An orphaned object is a failed cleanup, not
   a PASS.
10. Run F3-P5 as a fresh read-only Gate E1. F3-P4 never authorizes E2.

## Fail-closed conditions

Stop without mutation if any of these occurs:

- project ref, company, branch, reviewed commit or executor differs;
- dry-run state is not `READY` (except `ALREADY_APPLIED` during an idempotency
  check);
- any principal, per-scenario, retained, deletion or Storage hash differs;
- any count or NUMERIC total differs;
- the 128 defective Paid or 922 header-only Open population differs;
- an unknown dependent FK/table appears;
- a target Migration 028 lifecycle trigger is already installed;
- an auth/customer assignment or immutable audit dependency is unclassified;
- Storage object keys cannot be held and verified securely;
- lock or statement timeout occurs;
- any assertion, delete count, settlement equation or protected hash fails.

## Transaction model

The database phase is one short `SERIALIZABLE` transaction. It authenticates the
exact authorization binding before table locks, fences writers using deterministic
`SHARE ROW EXCLUSIVE` table locks, locks company rows in stable UUID order,
recomputes full-row hashes after locks, and deletes only UUID arrays derived from
the approved manifest. Every statement checks its affected-row count. Any error
aborts the transaction; there is no partial commit or best-effort continuation.

The transaction makes no external call and pauses for no operator interaction.
The later Storage phase is isolated because PostgreSQL cannot atomically commit
Supabase object-store deletion. Its exact-key hash and retry requirement are the
containment mechanism.

## Lifecycle and optional P3S conclusion

Production currently predates Migration 028's document lifecycle triggers. No
P3S is required for this one-time pre-hardening reset because:

- the operator is postgres-only and exact-manifest-bound;
- it installs no bypass and never disables a trigger;
- it aborts if the target lifecycle triggers are present;
- F3-P4 must complete before migrations 017–030 are considered by E2;
- after Migration 028 is installed, this operator becomes intentionally unusable.

If the lifecycle triggers are present at execution time, stop. A new, separately
authorized P3S design and independent review are mandatory; do not alter this
operator or the historical migration in place.

## Protected state and additional customers

The closure requires eleven customers. Some are retained solely because two AR
Clerk assignments, seven immutable customer-change logs and one credit-control
audit row make deletion inappropriate. Those customers are technical protected
retentions, not extra principal scenarios. The operator contains no reference to
or DML against `auth.users`. Company, roles, assignments and relevant audit rows
are fingerprinted before/after; RLS, grants, master/reference data and
configuration are outside the operator's executable DML surface.

## Rollback and evidence

Before commit, any failure rolls back the complete database phase. After commit,
direct SQL reversal is prohibited. A correction requires a separately approved,
audited compensating operation. The original defect, owner P1 attestation,
approved hashes, executor, reason, before/after manifests, notices and Storage
results must remain in the F3-P4 evidence. Raw customer data and credentials must
not be recorded.

The original runbook closure rule requires database cleanup, Storage cleanup and
a complete repeated E1 PASS before `B9DE-E1-001` can close. Database and Storage
cleanup passed, and the later F3-P5 technical financial certification passed,
but the whole repeated gate remains NO-GO for independent findings outside the
cleanup operator. Gate E2 remains unauthorized.

## F3-P4 execution record

**Executed:** 2026-07-21 (Asia/Kuala_Lumpur), Production project
`kusseuycqgdilychphpq`, company
`00000000-0000-0000-0000-000000000001` only.

The mandatory dry run returned exact `READY`. The reviewed database operator
then committed exactly once; it was not rerun during recovery. Fresh read-only
verification confirmed ten principal anchors, the 179-row retained graph, the
approved retained database hash, zero retained settlement mismatches, and zero
remaining rows from the 128 defective `Paid` and 922 non-retained header-only
`Open` populations.

The Storage recovery path followed the runbook's exact-key containment rule.
Only still-present approved keys were deleted, in batches of at most five with
an explicit HTTP timeout and an immediate read-only verification after each
batch. Final state is zero approved delete objects and six retained objects with
unchanged retained hash
`b5f58c7c85358da973280bf4e59f5862944e451f50cd521cd6f7c05139468620`.
No prefix, wildcard, folder or bucket-wide deletion was used.

`B9DE-F3-P1-001` is closed. The later F3-P5 result is recorded below. This
execution record grants no further authority.

## F3-P5 read-only recertification record

F3-P5 revalidated the exact F3-P4 database and Storage after-state without
rerunning either cleanup phase. All ten scenario anchors and matching scenario
hashes remain; the retained graph is 179 rows with the exact approved database
hash; the former 128/922 populations and approved Storage delete set remain
empty; and all six retained Storage objects remain with the approved hash.

The full Production financial check used exact PostgreSQL `NUMERIC` arithmetic.
All active and settled documents reconcile. Raw differences consist only of two
pre-posting Draft documents, one fully reversed Cancelled document and one fully
reversed Bounced receipt; each was validated against lifecycle metadata and
dependencies. Unexplained document and receipt mismatch counts and amounts are
zero. Orphan, journal, FX, RLS, company-scope and Migration 027 readiness checks
also pass.

The overall repeated E1 remains NO-GO. `B9DE-E1-001` is technically remediated
but remains open under the whole-gate closure rule; `B9DE-E1-002` remains
partially resolved because no sanitized owner credential-custody attestation was
provided; `B9DE-E1-003` remains closed; and `B9DE-E1-004` is High/Open because a
Supabase personal access token disclosed in conversation has not been proven
revoked. Gate E2 remains unauthorized.
