# POST-BATCH-9D Gate D Production Rollout Evidence

## Scope and reviewed commits

- Original Gate D implementation:
  `463d4b75807d81fc045ac2c0c3ae8971cf44296a`
- Reviewed v1 wire-compatibility remediation:
  `6b1ed17eb49bb355b778220ee8696926b5ab8c80`
- Remediation parent:
  `463d4b75807d81fc045ac2c0c3ae8971cf44296a`
- Remediation subject:
  `fix(gate-d): preserve legacy v1 summary wire shape`
- Production Supabase project: `kusseuycqgdilychphpq`
- Production URL: `https://account-receivable-module.vercel.app/`

The first Gate D rollout stopped before Migration 033 because the then-reviewed
Edge mapper serialized `meta.contract_version = 1` into legacy summaries. The
frontend failed closed, all three affected functions were restored, Migration
033 remained absent, and all protected data fingerprints remained unchanged.
The five-file remediation was independently reviewed before this retry.

## Repository closure

The remediation was committed and pushed as one five-file commit. Its diff was
`272 insertions, 24 deletions`. After push, `HEAD` and `origin/main` both
resolved to `6b1ed17eb49bb355b778220ee8696926b5ab8c80`, with ahead/behind
`0/0`, staged files `0`, and no tracked source diff.

## Frontend deployment

- Active deployment: `dpl_9NTihMpZMtRVXWKqFcEPBJPXSV87`
- Active commit: `6b1ed17eb49bb355b778220ee8696926b5ab8c80`
- Source: automatic Git deployment
- State: `READY`
- Production alias: `account-receivable-module.vercel.app`
- Previous rollback candidate: `dpl_CdV181Bxgy5cpysTvA4rGDZS3VCr`
- Previous deployment commit:
  `463d4b75807d81fc045ac2c0c3ae8971cf44296a`

The remediation changed backend contract/tests/evidence rather than frontend
application output. The automatic deployment nevertheless associated
Production with the reviewed remediation commit, so no duplicate explicit
frontend deployment was performed.

## Edge Function deployment

Only the reviewed Reports, Invoices, and Receipts functions were deployed from
the clean remediation commit.

| Function | Previous | Deployed | Final state |
| --- | ---: | ---: | --- |
| Reports | 20 | 21 | ACTIVE |
| Invoices | 27 | 28 | ACTIVE |
| Receipts | 20 | 21 | ACTIVE |
| Notifications | 6 | 6 | ACTIVE, unchanged |

No Imports, Allocations, Notifications, or unrelated Edge Function was
deployed.

## Pre-Migration-033 compatibility gate

Migration 033 was confirmed absent before the corrected function deployment
and remained absent throughout this compatibility gate.

Authenticated structural checks proved, for both Invoice and Receipt
collections:

- both monetary summaries were present;
- neither public v1 summary contained `meta.contract_version`;
- neither public summary contained the internal `contractVersion` tag;
- no v2 authority/completeness field was serialized;
- Invoice retained `current_outstanding` and
  `original_document_total`;
- Receipt retained `current_unallocated` and
  `original_document_total`;
- the Production frontend displayed `Not verified`;
- the exact legacy verification-unavailable message was displayed;
- `Summary data is unavailable.` was absent.

Dashboard and both report pages remained operational. Report export controls
remained available and no export was initiated. The authenticated Production
Playwright smoke passed desktop and mobile with zero retries after the
automatic Vercel deployment reached `READY`.

## Migration 033

Only
`database/033_post_batch_9d_gate_d_dashboard_customer_distribution_and_monetary_summary_authority.sql`
from the original reviewed implementation commit was applied. Its SHA-256 was
`A810E5657184F98B476259115A654120B58119D7FB38AC14D6443BA1C527CE1A`.

An initial connector handoff inserted a truncation marker into the submitted
text and PostgreSQL rejected that transaction before any DDL committed.
Immediate verification proved ledger absence, index absence, unchanged RPC
catalog properties, and unchanged protected fingerprints. The same reviewed
1,558-line file was then transferred in bounded chunks and applied
transactionally without changing its contents.

- Migration ledger version: `20260729131331`
- Migration ledger name:
  `post_batch_9d_gate_d_dashboard_customer_distribution_and_monetary_summary_authority`
- Ledger entries for Migration 033: exactly one
- Rollback-only Migration 033b: not executed against Production

## Catalog and index verification

All three replaced RPCs retain owner `postgres`, `SECURITY INVOKER`, `STABLE`,
and fixed empty `search_path`.

- `get_ar_dashboard_metrics(uuid, uuid, text, date, integer)` retains date and
  trend defaults and service-role-only execution.
- `ar_invoice_collection(uuid, uuid, text, text, text, uuid, text, date, date,
  text, integer, integer)` retains all defaults and authenticated execution.
- `ar_receipt_collection(uuid, uuid, text, text, uuid, text, text, date, date,
  text, integer, integer)` retains all defaults and authenticated execution.

Exactly one Gate D customer index exists:

- name: `idx_customers_company_credit_rating_visible`
- columns: `company_id, credit_rating, customer_id`
- predicate: `is_deleted = false AND is_hidden = false`

The Invoice and Receipt lifecycle, booked-FX immutability, and posting-decision
guard triggers were all enabled. No helper privilege, dynamic SQL object, or
additional Gate D index was introduced.

## Protected Production data

The same deterministic opaque fingerprint method was used before function
deployment, immediately before Migration 033, after the failed truncated
transaction, and after the successful migration. Every count and hash matched
at all checkpoints.

| Protected table | Count | Opaque hash |
| --- | ---: | --- |
| allocation_details | 13 | `8370f4b2b73f21062d1739e83056d2ec` |
| cn_allocations | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| exchange_rates | 10 | `20d05f248797aada7e5d212ca19dad4d` |
| fx_booking_rate_decision_events | 27 | `649e6a51572dfd5933903ac534c5a3cc` |
| fx_booking_rate_decisions | 27 | `12df75ad6b66ba288d5ca8733aae7851` |
| fx_reference_rates | 15 | `70ac3d655541269edf96ce12018cda85` |
| import_batches | 6 | `e7b6b487689f4246e14a68520a10a376` |
| import_files | 6 | `e57f475f859cd6e64a036015c597a599` |
| import_row_allocations | 7 | `657d269bf0484704bd013ddb0890cca2` |
| import_rows | 20 | `ffe236301677a1f894e17ab70e673284` |
| invoices | 16 | `1bd61a4e2324697b00a24ca84ba08e07` |
| journal_entries | 25 | `07364298d4e7b6813b177e80e7ef71ba` |
| journal_entry_lines | 50 | `9e8590ebe945d7c554ae991de5ab60de` |
| receipts | 11 | `160558890aef0a6fd99e724efe13e234` |

No Invoice, Receipt, exchange-rate, base snapshot, journal, allocation, FX
decision/event, or import row changed. No financial DML or backfill occurred.

## Post-migration API validation

Dashboard returned `customer_credit_rating_distribution` with population
`VISIBLE_CUSTOMERS`, the four locked included statuses, and exactly the ordered
ratings `AAA, AA, A, B, C, D` with integer counts. The existing Gate B
`credit_rating_distribution` remained present. Under the same authenticated
context, rating `A` reconciled exactly between the chart and
`GET /customers?credit_rating=A&page=1&page_size=25` (`2` and `2`).

Both Invoice summaries returned strict v2 with decimal strings, nullable base
totals, completeness counts, `base_available`, ordered currency groups,
`unavailable_by_currency`, and the required authority metadata. For the
read-only Production filter used during validation, the safe aggregate was
`7` matching, `4` authoritative, and `3` unavailable.

Both Receipt summaries returned strict v2 with the same invariants and the
correct `current_unallocated` and `original_document_total` bases. The safe
aggregate was `7` matching, `5` authoritative, and `2` unavailable.

Production still contains four Posted legacy-unverified Invoice-family
documents and two Posted legacy-unverified Receipts. Both rate-one and
non-rate-one legacy classifications remain represented. Their protected row
fingerprints and numeric snapshots are unchanged; they contribute to native
subtotals but remain unavailable to authoritative company-base completeness.

## Production browser validation

The repository Playwright authenticated smoke passed `4/4` across desktop and
mobile with zero retries after Migration 033. It verified Dashboard, Invoice
Management, Receipt Management, Settings, browser errors, and unexplained HTTP
failures.

Additional read-only structural checks verified:

- six accessible rating controls and the customer dialog;
- chart/server count equality;
- detail and aging links;
- pagination controls;
- Enter, Space, Escape, and originating-focus restoration;
- dialog fit on the mobile viewport;
- Unicode-safe rendering without replacement characters;
- native Invoice and Receipt currency groups;
- partial authoritative labels and exact exclusion warnings;
- safe Credit Note presentation;
- Invoice and Receipt report loading, native-total notices, safe company-base
  presentation, and available export controls;
- no write request to an application Edge Function.

The only browser diagnostic observed during dialog exploration was the
repository's exact allow-listed optional `/favicon.ico` 404. No page error,
unexplained HTTP failure, raw parser/API/SQL/schema detail, authentication
state, token, customer payload, or financial payload was logged.

## No-write boundary, rollback readiness, and limitations

No create, edit, post, cancel, reverse, allocation, import, delete, or export
operation was performed. No synthetic Production fixture was created.
Consequently, Production UI evidence reflects the naturally available partial
management summaries and empty-but-complete report date ranges; complete,
all-unavailable, empty-management, and singular-warning states remain covered
by the reviewed local unit/integration and browser suites rather than
manufactured Production data.

The previous Vercel deployment remains identified for frontend rollback.
Pre-migration function versions were recorded and were usable for recovery
before the database cutover. After Migration 033, no unreviewed database
rollback was attempted or prepared; any future restoration must use a
separately reviewed forward migration.

## Final Production state

- Frontend: reviewed remediation commit active and `READY`
- Reports: v21 ACTIVE
- Invoices: v28 ACTIVE
- Receipts: v21 ACTIVE
- Notifications: v6 ACTIVE, unchanged
- Migration 033: applied exactly once
- Migration 033b: not run remotely
- Protected data: unchanged
- Gate D: `CLOSED`

This evidence and the canonical Feature Status update were intentionally kept
local, unstaged, and uncommitted until Claude Code completed the independent
final read-only Production rollout review.

## Final independent closure review

Claude Code independently completed the final read-only Production rollout
review with the exact verdict:

`PASS  GATE D FINAL PRODUCTION ROLLOUT REVIEW COMPLETE`

The review performed no modification, deployment, migration, or Production
write. It passed the remediation commit, deployed Edge Function versions,
Migration 033 ledger entry, RPC catalog properties and grants, customer index,
Dashboard API, Invoice and Receipt v2 contracts, legacy-unverified exclusion,
desktop and mobile validation, rollout evidence, and canonical Feature Status.

The Vercel control-plane deployment identifiers and exact opaque-hash SQL were
not independently reproduced during that review. No observable contradiction
was found, and equivalent runtime, aggregate-count, and deployment-timestamp
evidence passed.

Gate D is now **CLOSED**. No further Gate D implementation or rollout action is
pending.
