# Batch 9D-E1 Ephemeral Production Smoke Identities Runbook

## Purpose and boundary

This runbook defines the approved replacement for long-lived Production smoke-account credential custody. Each authorized gate creates exactly four temporary Auth users, authenticates each independently, performs only read requests, destroys every exact run-bound identity/session/application row, and proves that the old access tokens cannot read protected AR data after cleanup.

The runbook does not authorize its own execution. Every Production run needs a separate authorization naming project `kusseuycqgdilychphpq` and company `00000000-0000-0000-0000-000000000001`. It never authorizes Gate E2, a second tenant, a fifth identity, migrations, schema/RLS/grant changes, business-data or Storage mutation, Edge deployment, credential changes, staging, Git stage, commit or push.

## Mandatory execution interface

Use the supported server-side Supabase Auth Admin interface. The Admin credential must be non-compromised, injected directly into one bounded process by an approved secret manager, and never printed, returned, written to a file, placed in shell history or included in evidence. Do not use a disclosed PAT. Do not write directly to `auth.users`.

Create Admin and per-user clients with persistent session storage, automatic refresh and URL-session detection disabled. Generate each password cryptographically in process memory with at least 32 characters. Evidence records only the identity category, a sanitized user-ID hash, query category, status, row count and expected/actual outcome.

## Exact identity set

1. General authenticated user: Auth user only; no role and no assignment.
2. Finance Manager: one active `Finance Manager` role for the target company; no Clerk assignment.
3. Assigned AR Clerk: one active `AR Clerk` role and exactly one active assignment. Select the customer deterministically from the first approved retained scenario anchor.
4. Unassigned AR Clerk: one active `AR Clerk` role and zero assignments.

The application has no separate profile table. If later schema inspection finds one, stop and review rather than inventing a row shape.

## Recovery-safe lifecycle

1. Verify Git identity, project ref, company count, retained database/Storage hashes, existing identity fingerprints and zero prior ephemeral residue.
2. Generate one unique run ID in memory and derive four non-personal synthetic addresses deterministically from the run and category. Store the run ID in Auth `app_metadata`, not user-editable authorization metadata.
3. Before create, scan Admin Auth for an unfinished prior run. If one exists, do not start a new run; validate its metadata and exact user IDs and clean only that run.
4. Create exactly four confirmed-email users. Capture exact user IDs in the in-memory recovery manifest. Provision only the roles/assignment listed above.
5. Recheck exact counts, company/customer consistency and identity orphans. Any difference transfers immediately to `finally` cleanup.
6. Authenticate all four users separately. Retain access/refresh tokens only in memory. Discard passwords immediately after the last sign-in attempt.
7. Use Auth plus PostgREST/read APIs only. Verify: general user sees no protected AR rows; Finance Manager sees the complete retained company and all ten scenarios; assigned Clerk sees its one customer and only that customer's documents; unassigned Clerk sees no protected customer/document rows. Query an out-of-company predicate and a known unassigned customer as negative controls. Never invoke a mutation route.
8. Recompute the business graph/hash/totals, Storage hash, former cohorts, audit fingerprint and existing-identity fingerprint.
9. In `finally`, globally sign out each session, delete the exact assignment, delete the exact roles, delete any exact run-bound application identity row discovered through reviewed topology, and permanently delete each exact Auth user through Admin Auth. Never delete by prefix, role or date alone.
10. After application authorization rows and Auth users are gone, issue one harmless protected read with each old access token and require denial or zero rows. Attempt refresh once and require failure. Then erase every token from memory.
11. Require zero Auth users, roles, assignments, sessions capable of refresh, old tokens capable of protected reads, and Storage objects for the run. Existing identity/business/Storage fingerprints must match the pre-run values.

Any cleanup failure is a gate FAIL. Do not create replacement users in the same gate. Record only the exact sanitized recovery scope.

## 2026-07-22 execution checkpoint

The first authorized attempt stopped before mutation. Git, Production project/company, existing identity topology and retained business/Storage baselines passed; no prior ephemeral run existed. The available connector did not expose supported Auth Admin create/delete/revoke operations, no safely injected non-compromised Admin credential was available to the bounded runner, and browser automation was unavailable. Direct Auth-table DML, secret export and use of the disclosed PAT were rejected.

Users, roles, assignments, sessions, tokens and Storage objects created were all zero. Final aggregate scans found zero ephemeral residue and unchanged Production business/identity state. `B9DE-E1-002` remains partially resolved; `B9DE-E1-004` remains separately High/Open; Gate E2 remains unauthorized.

### Second 2026-07-22 checkpoint

A second bounded attempt received both named process environment variables and created the prescribed
temporary server-side runner. The runner passed syntax and credential-literal scans and the immutable
Production preconditions matched. Its normalized credential classification was nevertheless
`unsupported`; the mandatory read-only `auth.admin.listUsers` capability probe failed locally before a
network request could be issued. The lifecycle therefore stopped before run-ID allocation, password
generation or identity creation. Users, roles, assignments, sessions/tokens and Storage mutations were
again all zero. The path-validated outer `finally` removed the complete temporary runner directory.

Operational lesson: variable presence is necessary but not sufficient. Before any create call, require
both a recognized supported Secret/service-role credential shape and a successful server-side Admin
`listUsers` probe against the exact project. Never attempt to repair an invalid credential by exporting,
printing or guessing its value. `B9DE-E1-002` remains not closed; `B9DE-E1-004` remains separately
High/Open; Gate E2 remains unauthorized.

### Third 2026-07-22 checkpoint — lifecycle cleanup passed, positive RLS contract failed

The modern dedicated Secret key passed the capability gate. Exactly four run-bound users, three roles
and one assignment were created; all four users authenticated. General and unassigned denial behaved as
required. Finance Manager returned only `2/7/7` protected customer/invoice/receipt rows and five of ten
anchors; the assigned first-anchor Clerk returned `0/0/0` rather than `1/2/2`.

The installed `rls_can_access_customer` contract filters out hidden/deleted customers before evaluating
the Finance Manager or Clerk branch. Only `2/7/7` retained rows and five anchors currently satisfy that
filter, and the required first anchor does not. Future runs must freeze both the gate's expected
visibility contract and scenario policy eligibility before user creation. Do not change retained flags
or RLS merely to make a smoke test pass; such a change needs separate review and authorization.

Mandatory cleanup fully succeeded: exact authorization rows and users were removed, refresh reuse failed,
old tokens returned zero protected rows, the temporary runner was removed, and independent scans found
zero identity/session/Storage residue with unchanged business, Storage and existing-identity
fingerprints. This checkpoint remains a gate FAIL because runtime positive-access expectations did not
pass. `B9DE-E1-002` is not closed; `B9DE-E1-004` remains High/Open; Gate E2 remains unauthorized.

### Corrected 2026-07-22 closure checkpoint

The authoritative operational contract excludes hidden/deleted customers before role or assignment
evaluation. Future ephemeral runs must first distinguish the physical retained graph from policy-eligible
operational visibility. Derive eligible customer coverage inside the bounded process and select the
assigned Clerk customer deterministically by: highest retained-anchor count, then invoice count, then
receipt count, then UUID ascending. Do not select the first anchor blindly and never change flags or RLS
to satisfy a test.

The corrected Production run verified eligible aggregates `2/7/7/5` and selected coverage `1/6/7/4`.
Exactly four identities authenticated. Finance saw `2/7/7` plus five anchors; the assigned Clerk saw
`1/6/7` plus four anchors; general and unassigned users saw zero protected rows. Finance and Clerk
hidden/deleted controls, outside assignment and out-of-company controls all returned zero.

Exact authorization rows and users were removed, refresh reuse failed, old tokens returned zero protected
rows, the runner was removed, and independent scans proved zero residue with unchanged existing identity,
business and Storage fingerprints. This closes `B9DE-E1-002`. `B9DE-E1-004` remains separately High/Open
and Gate E2 remains unauthorized.

### 2026-07-23 post-lifecycle credential closure checkpoint

The owner attests that the previously disclosed PAT was revoked without reuse or retransmission, the
dedicated ephemeral Secret key was deleted, both temporary environment variables were cleared and the
bounded PowerShell session was closed. The final count-only repository/Batch scan found zero credential,
JWT, private-key, Authorization-header or full synthetic-email values; the runner directory remains
absent. This closes `B9DE-E1-004` without requesting or testing the old credential.

A separate final read-only RLS catalog check found an authenticated unconditional SELECT policy on
`public.user_roles`. That finding is outside the lifecycle cleanup itself: `B9DE-E1-002` remains closed
and zero-residue proof remains valid, while new High finding `B9DE-E1-005` keeps overall Gate E1 at
NO-GO. A future run must not weaken or work around this policy; remediation requires separate explicit
authorization and independent catalog/RLS verification. Gate E2 remains unauthorized.
