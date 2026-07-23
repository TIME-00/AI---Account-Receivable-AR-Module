# Batch 9D-E Consolidated Production Rollout Evidence

- Date: 2026-07-23
- Production project: `kusseuycqgdilychphpq`
- Production company: `00000000-0000-0000-0000-000000000001`
- Data classification: `P1 SYNTHETIC / DEMO DATA`
- Rollout candidate: `c978bce5a14cc020ddbc349f7f91d08855006f2a`
- Scope: consolidated Gates 9D-E2, 9D-E3 and 9D-E4

No credential value, authorization header, JWT, password, complete temporary email or raw user ID is
recorded here.

## 1. Entry freeze and local candidate

The gate entered from `main` at `c24249f037164edd8e08b3cf15f7180973a78c4d`, with
`origin/main` at `d5c9c0a0125b7ab0cb0b767424a4a2b8e01ab87d`, ahead/behind `2/0` and
zero staged paths. Gate 9D-E1 and findings `B9DE-E1-001` through `B9DE-E1-005` were already closed.

Local validation passed before remote mutation:

- `B9DE-E1-005` remediation contract: `9/9`;
- F3 operator contract: `40/40`;
- backend Deno tests: `190/190`, including allocation candidate contract `12/12`;
- Deno check for all 16 deployable functions;
- frontend lint, type-check, `28` test files / `530` tests, and Production build;
- migration structural checks, secret/key/JWT/private-key scans, conflict scan and `git diff --check`.

Only reviewed Batch 9D artifacts were committed. `social-media/`, `Poster/`, local environment files and
credential material were excluded. The immutable rollout candidate commit is:

`c978bce5a14cc020ddbc349f7f91d08855006f2a` — `feat(prod): deploy Batch 9D production rollout`

## 2. Production inventory and secret configuration

The target was `ACTIVE_HEALTHY` in `ap-southeast-1` on PostgreSQL 17. The pre-mutation state matched:
company `1`, Auth/users/roles/assignments `5/5/2`, ephemeral residue zero, retained graph `179`, exact
business counts and monetary totals, and six retained Storage objects with the accepted Storage hash.

Catalog inspection classified all of `017` through `030` as missing and found no partial or conflicting
object. This exact ascending set became the Production missing-migration manifest. Existing Edge
inventory contained 14 of the 16 target functions; `fx-rates` and `fx-rate-sync` were absent. No Production
FX scheduler or `daily-overdue` caller existed.

The required modern Secret API key was created with name
`batch_9d_d_edge_admin_20260718`. Name-only checks proved that
`SUPABASE_SECRET_KEYS.batch_9d_d_edge_admin_20260718` and
`SUPABASE_PUBLISHABLE_KEYS.default` resolved before deployment. Edge configuration also contains the
name-only contracts `CRON_SECRET`, `FX_SCHEDULER_SECRET` and `FX_SCHEDULER_COMPANY_ID`. The scheduler
secret is stored in Vault under `batch_9d_e_fx_scheduler_secret`. The browser remains on the accepted
legacy anon-key mode; no credential was written to a file or Git.

Because no `daily-overdue` caller existed, no caller and no cron job were created. The function was
deployed fail-closed after `CRON_SECRET` configuration; missing, blank and invalid credentials each
returned HTTP 401.

## 3. Migration execution

Recovery metadata, catalog fingerprints, retained-state fingerprints and incoming-constraint checks were
frozen before execution. The exact missing manifest was applied in ascending order:

| Migration | Final result |
| --- | --- |
| `017_fx_reference_foundation.sql` | installed and verified |
| `018_fx_reference_concurrency_hardening.sql` | installed and verified |
| `019_fx_reference_transactional_fencing.sql` | installed and verified |
| `020_fx_helper_rpc_privilege_hardening.sql` | installed and verified |
| `021_fx_real_provider_identifier_support.sql` | installed and verified |
| `022_fx_booking_rate_governance.sql` | installed; expected governance backfill verified |
| `023_fx_booking_rate_rpcs_and_immutability.sql` | installed and verified |
| `024_fx_booking_decision_runtime_fix.sql` | installed and verified |
| `025_fx_booking_decision_supersession_validation_fix.sql` | installed and verified |
| `026_fx_booking_decision_import_origin_provenance_fix.sql` | installed and verified |
| `027_batch_9d_d_authoritative_monetary_aggregation.sql` | installed; six routines present |
| `028_linked_credit_note_reference_integrity.sql` | installed and verified |
| `029_batch_9d_d_staging_runtime_defect_remediation.sql` | installed and verified |
| `030_batch_9d_d_allocation_candidate_snapshot.sql` | installed; service-only boundary verified |

Migration 022 created the approved `27` decisions and `27` events and attached pointers to `16` invoices
and `11` receipts. The pointer updates also triggered `updated_at` on those same 27 documents. This is the
authorized governance backfill, not a business-amount change.

That backfill changes the old schema's full-row JSONB hash because the old algorithm includes both the
new columns and `updated_at`. The accepted pre-migration hash
`36bb2ba7de358e3c0f2401db804d16ebfd7d400d7b099bbb964171ed626b90e0` was verified before mutation;
it is not directly comparable after Migration 022. The final new-schema full-row fingerprint is
`746a1480d54fb3ba8c6e2d18c5864a691808dabbf3df8fabf20f020616b76cc9`. Business immutability is instead
certified below by graph membership, exact counts, `NUMERIC` totals, relationships and anomaly checks.

No migration outside `017`–`030` was applied. Migration 027 exposes exactly six named routines.
Migration 030 exposes one `get_allocation_candidates(uuid,uuid,uuid)` routine: anon/authenticated execute
are false and service-role execute is true.

## 4. Edge Function deployment

All functions were deployed from the frozen rollout candidate and are `ACTIVE`:

| Function | Version |
| --- | ---: |
| `allocations` | 17 |
| `auth` | 5 |
| `bank-accounts` | 6 |
| `credit-notes` | 12 |
| `customers` | 18 |
| `daily-overdue` | 10 |
| `debit-notes` | 12 |
| `fx-rates` | 1 |
| `fx-rate-sync` | 1 |
| `imports` | 26 |
| `invoices` | 24 |
| `lookups` | 5 |
| `notifications` | 5 |
| `receipts` | 17 |
| `reports` | 16 |
| `search` | 5 |

`journal-entries` was correctly excluded because it has no deployable `index.ts`. No mixed old/new target
bundle remained.

## 5. Backend runtime and FX verification

Missing/invalid authorization was rejected, random-company queries were isolated, `/auth/me` worked for
authorized identities, and all required read routes passed. Customers, invoices, debit/credit notes,
receipts, imports, bank accounts, notifications, search, reports, statements, aging, allocations and FX
reads were exercised. The governed allocation candidate route passed; the direct authenticated candidate
RPC remained denied. `POST /allocations/auto` returned `AUTO_ALLOCATION_DISABLED`.

The locked MAS provider performed one manual three-pair reference sync. The controlled scheduler-path
invocation performed the same approved three-pair contract. Final sync state is two succeeded runs,
attempted/succeeded/failed pairs `6/6/0`, three active reference rates, zero duplicate active versions,
zero live leases and no booked invoice, receipt or journal rate change.

## 6. Git, Vercel and end-to-end smoke

The rollout commit was pushed non-force to `origin/main`. Vercel Production deployment
`dpl_J3g9cnk6LWPs6VgumHi6zqMnixWr` reached `READY`, target `production`, branch `main`, with source SHA
`c978bce5a14cc020ddbc349f7f91d08855006f2a`. The canonical URL and deployment URL were healthy; the
four required Production environment names were present and no value was inspected or recorded. Vercel
reported no runtime error cluster in the rollout verification window.

A fresh four-identity run used one run ID; its sanitized run hash was
`3fd3c3806374aa2bfa6cc18545d11848070da54751e4757d3e7476d5f233c086`. Exactly four confirmed users,
three roles and one assignment were provisioned. All four authenticated.

| Identity | Backend/RLS result | Production frontend result |
| --- | --- | --- |
| General | customers/invoices/receipts/roles `0/0/0/0` | login and protected-data denial passed |
| Finance Manager | eligible customers/invoices/receipts/anchors `2/7/7/5`; out-of-company and hidden controls zero | full authorized route/report/workbench matrix and logout passed |
| Assigned AR Clerk | assigned scope `1/6/7/4`; role/assignment `1/1`; outside and hidden controls zero | assigned customers/invoices/receipts isolation passed |
| Unassigned AR Clerk | customers/invoices/receipts `0/0/0`; role/assignment `1/0` | empty/denied operational surfaces passed |

The deployed frontend covered dashboard, customers, invoice and receipt list/detail/new/import rendering,
debit/credit notes, imports/OCR surfaces, allocations and candidate results, all required reports, search,
notifications, profile, settings/audit/roles, expected error/empty/loading behavior and a critical mobile
allocation layout. No financial form was submitted. No blocking browser exception or 5xx was observed.

Early smoke-run retries were caused by verifier field assumptions, Auth rate limiting, browser-profile
teardown and expected-denial signal classification. Each affected exact run was fully recovered before a
retry: exact metadata was checked, roles/assignments removed, sessions revoked, users deleted and residue
returned to zero. No replacement run was created before cleanup.

The final run cleanup removed the exact assignment and three roles, proved all four extant access tokens
could read zero protected rows, globally revoked sessions, deleted all four Auth users, rejected all four
refresh-token reuse attempts and removed the complete temporary runner. Final identity state is company /
Auth users / roles / assignments `1/5/5/2`; ephemeral users/sessions/roles/assignments and temporary
Storage ownership are all zero.

## 7. Scheduler and final certification

The one approved Production job is `batch_9d_e_fx_scheduler_production`, active at `30 7 * * *` UTC,
calling only `/fx-rate-sync/scheduled-sync` with the Vault-backed authentication contract. A controlled
invocation returned success. Conflicting FX jobs are zero. `daily-overdue` jobs are zero.

Final read-only certification:

- principal anchors present `10`; retained graph `179`;
- customers/invoices/lines `11/16/14`; receipts/allocations `11/13`; journals/lines `25/50`;
- imports `6/6/20/7`; OCR `0`; former defective/header populations `0/0`;
- invoices `314889.16 / 262792.16 / 316054.16`;
- receipts `50587.00 / 50386.00 / 200.00`;
- allocations `50388.00 / 10.00 / 50621.00`;
- active invoice and unexplained receipt mismatches `0 / 0.00`; Draft `2 / 1700.00`, Cancelled
  `1 / 1.00` and Bounced `1 / 1.00` remain the accepted explained lifecycle cases;
- allocation orphan/rate/base/FX/reversal and journal header/line anomalies `0`; allocation status remains
  11 Active and two Reversed;
- Storage objects `6`, approved-delete and temporary ownership `0`, hash
  `b5f58c7c85358da973280bf4e59f5862944e451f50cd521cd6f7c05139468620`;
- reviewed/enabled/with-policy RLS tables `20/20/20`; unconditional SELECT/write `0/0`;
- `Temp Allow All` absent, `ur_select` present, three core customer policies unchanged, and
  `rls_can_access_customer` hash
  `981bd4c89eaba0783efc92bd0deac2112a3b00e6d8f31fcc0f349c430affbf48`;
- Auth/role/assignment and Storage dependency orphans `0`.

## 8. Closure

Gates 9D-E2, 9D-E3 and 9D-E4 are complete. Batch 9D-E is closed. Batch 9D is fully deployed to
Production, pending only an independent closure review. No Critical, High or material Medium blocker
remains. No second company, permanent smoke identity, automatic allocation, `daily-overdue` cron,
staging action, unrelated feature or credential artifact was introduced.

`PASS  BATCH 9D-E CONSOLIDATED PRODUCTION ROLLOUT AND FINAL VERIFICATION COMPLETE`
