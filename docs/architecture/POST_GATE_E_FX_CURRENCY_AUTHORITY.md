# Post-Gate-E FX and Transaction-Currency Authority

Status: local implementation complete; Migration 043 is not applied and no
Production runtime is changed by this document.

Gate E and the Mailbox Delivery UX rollout remain closed. This additive
boundary governs future AR document creation and FX reference freshness.

## Production root cause

Production already has a real server-side reference-rate architecture:
`fx-rate-sync` obtains MAS-attributed rates through the locked Frankfurter
adapter, records a fenced `fx_sync_runs` lifecycle, versions
`fx_reference_rates`, and books an immutable PostgreSQL snapshot when an
Invoice or Receipt accepts a reference. The reference lookup is already
transaction-date bounded and will not select a future effective date.

The observed `1 USD = 4.0906 MYR` warning was not caused by a missing provider,
failed job, cache, or date-direction bug. The one Production cron job ran only
at `07:30 UTC`. From 8 through 11 August 2026 the provider legitimately returned
the latest published business date, Friday 7 August. A current 11 August rate
was available later that day, after the only scheduled attempt. The existing
calendar-day test then counted Friday to Tuesday as four days and rejected the
otherwise legitimate weekend carry-forward.

Migration 043 retains the same provider, route, company scope, Vault secret and
idempotent job, but changes the canonical Production cadence to
`30 7,12,17 * * *` UTC when exactly one named job exists. Later attempts capture
same-day publication without adding a second provider or a second job.

## Currency vocabularies

- New AR Invoices, Credit/Debit Notes created through the Invoice family, and
  Receipts support only `MYR` and `SGD`.
- The historical operational/reporting vocabulary remains `MYR`, `SGD`, `USD`,
  `EUR`, `GBP`, and `CNY`; retained records therefore remain readable,
  searchable, reportable, and available for non-financial metadata workflows.
- Application validators return the stable sanitized business error
  `UNSUPPORTED_TRANSACTION_CURRENCY`.
- Prospective `BEFORE INSERT OR UPDATE OF currency` triggers independently
  reject any new Invoice or Receipt outside MYR/SGD, including a Draft currency
  edit. Historical rows may still receive unrelated metadata updates because
  the trigger does not fire when their currency is unchanged. No table-wide
  currency CHECK is introduced, and no existing row is rewritten.
- Imports converge on the same Invoice/Receipt services and database triggers.
  Automation maps the same refusal to the bounded `currency_unsupported`
  exception rather than creating or posting the AI candidate.

## Transaction-date reference and booking

MYR company-base transactions use exact `NUMERIC` parity at rate 1 and need no
provider. For SGD, the service selects the latest Active SGDMYR reference whose
effective date is on or before the financial transaction date. PostgreSQL
independently revalidates the company, pair, direction, active status, date,
latest-row identity, and freshness before it snapshots the booked rate and base
amount.

Freshness is bounded at three intervening weekdays. Weekends do not age a rate;
the bound also accommodates short publication holidays without permitting an
old reference indefinitely. Friday-to-Tuesday has age two, Friday-to-Wednesday
age three, and Friday-to-Thursday age four and fails closed. No holiday calendar
or market quote is invented. A missing, provider-failed, future-only, or stale
reference produces `FX_REFERENCE_UNAVAILABLE`. A governed manual override still
requires its existing role and reason authority.

The service returns a reference UUID, not a client-calculated amount. The
authoritative rate and company-base amount remain PostgreSQL `NUMERIC` values.
Later reference publication never changes an existing booked snapshot, journal,
allocation, or report contribution.

## Company-base availability and historical inventory

Company-base totals continue to include only `BASE_PARITY`, verified
`REFERENCE`, and governed `MANUAL_OVERRIDE` booked snapshots. They never
recompute history at a current market rate. New valid MYR documents therefore
have authoritative base parity, and new valid SGD documents have an immutable
SGDMYR booking before creation/posting completes.

The read-only Production inventory found six legacy-unverified records excluded
from base totals:

| Document | Date | Currency | Status | Journal / allocation evidence | Safety category |
|---|---|---:|---|---|---|
| `INV-202606-00003` | 2026-06-04 | SGD | Open | 1 journal / 0 allocations | protected financial history |
| `INV-202606-00005` | 2026-06-12 | SGD | Paid | 1 journal / 2 allocations | protected financial history |
| `INV-202606-00033` | 2026-06-13 | USD | Open | 1 journal / 0 allocations | protected financial history |
| `INV-202606-00059` | 2026-06-13 | EUR | Cancelled | 2 journals / 0 allocations | protected financial history |
| `RCT-202606-00008` | 2026-06-12 | SGD | Posted | 1 journal / 1 allocation | protected financial history |
| `RCT-202606-00015` | 2026-06-12 | SGD | Posted | 1 journal / 1 allocation | protected financial history |

Safe non-posted Draft candidates: **0**. All six are `LEGACY_UNVERIFIED` with
`NotRequired` legacy decision status and have journal and/or allocation
authority. Their stored numeric base fields therefore are not verified booked
FX authority and remain excluded. Although historical provider dates can be
found for the source dates, attaching them now could restate booked monetary
history. Migration 043 performs no such DML. These records remain visible as
`Base amount unavailable` until a
separately governed accounting-restatement design exists. Existing Draft-only
governed FX edit RPCs remain the safe prospective repair mechanism when a future
Draft has no downstream financial authority.

## Security and accounting invariants

- Tenant/company scope precedes reference selection and PostgreSQL revalidates
  the selected reference.
- Provider responses and AI output are candidate inputs, never SQL, FX,
  posting, journal, or allocation authority.
- Private policy/freshness helpers have empty `search_path`, postgres ownership,
  and no direct execute privilege for browser or service roles.
- Migration 043 changes no financial rows and never activates or changes an
  Automation operating mode.
- Migration 043b is rollback-only and must never be registered as a persistent
  migration.
