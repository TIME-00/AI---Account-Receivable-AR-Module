# Batch 9D-E1 `user_roles` RLS Remediation Runbook

## Scope and final state

This runbook records the one-time `B9DE-E1-005` Production remediation on project
`kusseuycqgdilychphpq`. The only permitted mutation was removal of
`public.user_roles."Temp Allow All"`. It did not authorize grants, helper/function changes, other policy
changes, row DML, Auth/Storage operations, migrations, deployment, Git stage/commit/push or Gate E2.

The remediation completed on 2026-07-23 in Mode A (drop-only). `Temp Allow All` is absent; source-backed
`ur_select` remains unchanged; unconditional exposed SELECT/write policy counts are `0/0`; Gate E1 is
closed PASS/GO. Gate E2 remains separately unauthorized.

## Authoritative visibility contract

Migration 006 defines:

```sql
USING (user_id = auth.uid() OR rls_has_company_access(company_id))
```

A caller may read their own role row and, when they hold an active company role, role rows in that same
company. They may not enumerate another company or rows globally without company membership. The existing
`STABLE SECURITY DEFINER` helper performs the membership lookup without recursive `user_roles` RLS
evaluation. Backend authorization context uses the server/admin client, while the frontend consumes
`/auth/me`; neither depends on the removed unconditional policy.

## Operator controls

Run only the reviewed operator:

`database/operators/batch_9d_e1_b9de_e1_005_user_roles_rls_remediation.sql`

It performs, in one short transaction:

1. local lock and statement timeouts plus a narrow transaction advisory lock;
2. exact table, RLS, grant, `ur_select` and legacy-policy signature assertions;
3. fingerprints of all other public policies, `user_roles` grants and accepted RLS helpers;
4. exact drop without `IF EXISTS` when the legacy signature matches;
5. postconditions for target absence, global unconditional SELECT/write `0/0`, unchanged RLS/grants,
   unchanged `ur_select`, policies and helpers;
6. commit only after every assertion passes.

An already-remediated rerun is assertion-only and performs no DDL. Any catalog drift raises an exception,
rolling the transaction back.

## Required validation

Before any future assertion-only rerun:

- verify exact Git/project identity and zero staged paths;
- run the 9-case local contract test and Deno format/type checks;
- verify target count `0`, RLS enabled/not forced and authenticated SELECT grant unchanged;
- compare all-policy, `user_roles` policy/grant and helper fingerprints;
- under effective role `authenticated`, compare each existing identity's exact visible role-row ID set
  against a privileged computation of the source predicate;
- require random user and random company results `0`;
- require 20 reviewed tables enabled/with-policy `20/20`, core helper policies `3/3`, and global
  unconditional SELECT/write `0/0`;
- rerun the governing business, financial, Storage and identity immutable-state checks.

Do not record full user IDs, emails, role rows, JWTs, keys or headers. If the target signature or any
protected fingerprint differs, stop; do not broaden remediation scope.

## Accepted closure evidence

- Local operator contract: `9 passed / 0 failed`; Deno format/check PASS.
- Rollback-only Production candidate: five identity exact-set matches, random user `0`, random company `0`.
- Permanent mutation: one exact policy drop only.
- Installed verification: five identity exact-set matches; cross-company `0`; random user `0`.
- RLS catalog: reviewed/enabled/with-policy `20/20/20`; unconditional SELECT/write `0/0`; core policy/helper
  calls `3/3`; no grant, helper or unrelated-policy drift.
- Immutable state: anchors/hashes `10/10`, graph `179`, accepted database and six-object Storage hashes,
  identities `5/5/2`, ephemeral residue `0/0/0/0`, financial/orphan anomalies `0`.
- Migration 027 remains missing and was not applied; Gate E2 remains unauthorized.
