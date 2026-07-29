# POST-BATCH-9D Gate D Local Implementation Validation Evidence

## Scope and baseline

- Branch: `main`
- Baseline HEAD and `origin/main`: `5c3b70208c355b55ff7e386a55be8881405aada3`
- Ahead/behind: `0/0`
- This evidence covers local, unstaged implementation only.
- No migration was applied, no Edge Function or frontend was deployed, and Production was not accessed or mutated during this frontend gate.

## Approved backend/database files

The eight approved files remained byte-identical throughout the frontend implementation:

| File | SHA-256 |
| --- | --- |
| `backend/supabase/functions/reports/dashboard-types.ts` | `FEDE76610A89A6832B26A6A2294F8AA735B1CBBE5D875DCB5863FD35C117C8D9` |
| `backend/supabase/functions/reports/monetary-contracts.ts` | `7BB6DE1B0738E6345EBA5AA7F27E862C8E468B8D519506C344FD27F9F898EC76` |
| `backend/supabase/functions/invoices/service.ts` | `204232F49003C59811AEDDD5596957F283F81685B350AAE96C02389E2E819F6A` |
| `backend/supabase/functions/receipts/service.ts` | `33234A6C0608CFEAE2E7D83E9FB6FAEC6DCA9E8483B917A49109DEFEDB241DEB` |
| `backend/supabase/functions/reports/multi_currency_contract_test.ts` | `523DA1DA82241F50C946530259AF5E964593DD3AB87F3FE9ED0F6D4D0451A77A` |
| `backend/supabase/functions/gate_d_dashboard_monetary_summary_contract_test.ts` | `5F30F24E909F5D7EF38249FD2503359C92CE5364AA6F29E16FF5BCF67312DDF4` |
| `database/033_post_batch_9d_gate_d_dashboard_customer_distribution_and_monetary_summary_authority.sql` | `A810E5657184F98B476259115A654120B58119D7FB38AC14D6443BA1C527CE1A` |
| `database/033b_post_batch_9d_gate_d_dashboard_customer_distribution_and_monetary_summary_authority_smoke_tests.sql` | `E06D7ED64253D3C6FD29F08FCB541B21C3B6588EC5ABDE5EC37B9DA1C17FABC2` |

The approved migration contains no financial-row backfill. This frontend gate made no database changes and did not alter financial, provenance, journal, or allocation rows.

## Exact frontend/docs manifest

Modified:

- `frontend/e2e/gate-b-credit-rating-drilldown.spec.ts`
- `frontend/src/app/(dashboard)/credit-notes/credit-notes.test.tsx`
- `frontend/src/app/(dashboard)/credit-notes/page.tsx`
- `frontend/src/app/(dashboard)/dashboard.test.tsx`
- `frontend/src/app/(dashboard)/detail-pages.test.tsx`
- `frontend/src/app/(dashboard)/invoices/page.tsx`
- `frontend/src/app/(dashboard)/page.tsx`
- `frontend/src/app/(dashboard)/pages.test.tsx`
- `frontend/src/app/(dashboard)/receipts/page.tsx`
- `frontend/src/app/(dashboard)/reports/invoices/page.tsx`
- `frontend/src/app/(dashboard)/reports/receipts/page.tsx`
- `frontend/src/components/features/dashboard/credit-rating-drilldown.test.tsx`
- `frontend/src/components/features/dashboard/credit-risk-chart.tsx`
- `frontend/src/components/ui/currency-subtotals.tsx`
- `frontend/src/components/ui/money-summary.test.tsx`
- `frontend/src/components/ui/money-summary.tsx`
- `frontend/src/hooks/use-customers.ts`
- `frontend/src/hooks/use-f2-data.test.tsx`
- `frontend/src/hooks/use-f2-data.ts`
- `frontend/src/hooks/use-invoices.test.tsx`
- `frontend/src/hooks/use-invoices.ts`
- `frontend/src/hooks/use-receipts.test.tsx`
- `frontend/src/hooks/use-receipts.ts`
- `frontend/src/test/harness.tsx`
- `frontend/src/types/index.ts`
- `frontend/src/types/monetary.ts`

New:

- `frontend/e2e/gate-d-dashboard-monetary-summary.spec.ts`
- `frontend/src/app/(dashboard)/reports/invoices/page.test.tsx`
- `frontend/src/app/(dashboard)/reports/receipts/page.test.tsx`
- `frontend/src/components/features/dashboard/credit-rating-customer-dialog.test.tsx`
- `frontend/src/components/features/dashboard/credit-rating-customer-dialog.tsx`
- `frontend/src/components/ui/currency-subtotals.test.tsx`
- `frontend/src/hooks/use-customers.test.tsx`
- `frontend/src/lib/monetary-summary.test.ts`
- `frontend/src/lib/monetary-summary.ts`
- `docs/evidence/POST_BATCH_9D_GATE_D_IMPLEMENTATION_VALIDATION_EVIDENCE.md`

`frontend/src/app/(dashboard)/detail-pages.test.tsx` is the one additional frontend file required by the existing test architecture. Its prior Receipt report fixture used the Invoice amount basis and asserted that a legacy v1 base total was authoritative. The test was corrected to the Receipt basis and the locked unverified-v1 presentation; no application scope was added.

No package manifest or lockfile changed.

## Contract implementation

### Parser and API boundaries

- Raw collection summaries are validated only through `frontend/src/lib/monetary-summary.ts`.
- V1 and v2 are explicitly discriminated.
- V1 retains native subtotals but never receives fabricated authority or completeness fields.
- V2 enforces exact keys, decimal strings, nullable base totals, count invariants, amount and normalization bases, authority metadata, ascending unique currencies, and unavailable-group reconciliation.
- Mixed, malformed, or contradictory structures fail closed to a sanitized summary-unavailable state.
- Invoice, Receipt, and F2 report hooks parse at the API boundary; raw summaries do not reach pages.
- Valid list rows remain usable when a collection summary is unavailable.
- No client-side monetary aggregation or FX conversion was added.

### Monetary presentation

- V1 company-base totals display `Not verified` with the locked legacy-verification message.
- V2 complete, partial, all-unavailable, and empty states use the exact locked labels, null semantics, exclusion warnings, and base-currency presentation.
- Native per-currency subtotals and counts remain visible without adding different currencies.
- Invoice, Receipt, Credit Note, Debit Note, and collection-backed report pages share the same authority presentation.
- The committed Reports Edge Function does not expose separate `/reports/invoices` or `/reports/receipts` routes. Existing report pages use the collection hooks and therefore accept strict v1/v2 collection summaries. Legacy v1 values are never presented as verified.
- Gate C PDF/XLSX export behavior was not modified.

### Dashboard and customer drill-down

- The chart reads `customer_credit_rating_distribution.rows`, while the Gate B `credit_rating_distribution` contract remains available for compatibility.
- Ratings are exactly `AAA`, `AA`, `A`, `B`, `C`, and `D`, and all labels and tooltips describe customer counts.
- Each rating is a native accessible button with pointer, Enter, Space, focus, pressed-state, and touch behavior.
- The dialog lists all visible customers for the selected rating, including zero-outstanding customers, with name, code, rating, status, customer-detail link, and the retained aging-report link.
- The query uses only `credit_rating`, `page`, and `page_size=25`; company and user identity are cache scope only and are not sent as request authority.
- The cache key includes authenticated company, authenticated user, rating, page, and page size.
- Loading hides stale rows, pagination is disabled while fetching, and empty/error/retry states use fixed English copy.
- Radix Dialog provides modal semantics, focus trapping, Escape/outside-click behavior, background blocking, and exact trigger-focus restoration. The bounded layout and sticky controls were exercised on desktop and mobile.

### Count reconciliation

- Matching chart and list counts render normally.
- A first mismatch performs one synchronized dashboard/customer refetch and hides contradictory totals.
- A persistent mismatch stops automatic refetch and exposes one manual `Refresh` action.
- Manual refresh starts one new bounded cycle without mutating customer data.
- Rating, company, and user identity changes reset the cycle and page.
- Unit and browser tests cover match, refresh success, persistence, manual recovery, and the no-loop bound.

## Validation results

| Validation | Result |
| --- | --- |
| Monetary parser focused tests | `23/23` passed |
| Full frontend Vitest | `56 files`, `764/764` passed |
| ESLint | Passed, zero warnings/errors |
| TypeScript `npx tsc --noEmit` | Passed |
| Next.js production build | Passed; `27 routes`, `25 static pages` |
| `npm audit --package-lock-only` | `0 vulnerabilities` |
| `npm audit` | `0 vulnerabilities` |
| Backend regression (`deno test --no-check --allow-read --no-lock`) | `12 files`, `249/249` passed |

Final qualifying Playwright runs used the optimized local production build, mocked local function responses, system Chromium projects, and zero retries:

| Run | Desktop | Mobile | Result |
| --- | --- | --- | --- |
| First complete affected run | `5/5` | `5/5` | `10/10` passed, zero retries |
| Repeated complete affected run | `5/5` | `5/5` | `10/10` passed, zero retries |

The browser coverage includes all-visible counts, zero-outstanding data, activation, fields, pagination, detail and aging links, keyboard, Escape, focus restoration, mobile layout, loading, empty, error, reconciliation, v1 Invoice/Receipt unverified states, every v2 authority state, singular/plural exclusions, native values, report safety, and operational list workflows. No unexpected page error, console error, or HTTP failure occurred in either qualifying run.

## Security, language, and final local state

- System-generated copy added by Gate D is English only; Unicode customer data remains supported.
- No company/user authority parameter, JavaScript FX conversion, cross-currency sum, service-role secret, credential, token, authorization header, SQL, schema detail, or stack trace was added to frontend output or logging.
- Browser tests use runtime-generated local synthetic session data and mocked APIs; they do not read, print, copy, or modify Playwright authentication-state files and do not access or mutate Production.
- No tracked authentication state or Playwright output was added.
- Staged files: `0`.
- Commits/amends/pushes: none.
- Migration applications: none during this frontend gate; Migration 033 was not applied remotely.
- Deployments: none.
- Production remains unchanged. Gates A, B, and C remain closed.
- Gate D is complete locally and is not claimed Live; it remains pending independent read-only review and later authorized rollout.

## 2026-07-29 legacy v1 wire-compatibility remediation

The first authorized Production rollout of commit
`463d4b75807d81fc045ac2c0c3ae8971cf44296a` stopped at the required
pre-migration compatibility gate. The shared Edge mapper had added
`meta.contract_version = 1` to legacy v1 summaries, while the strict frontend
parser correctly requires the pre-existing v1 wire contract to omit that
property. The UI therefore failed closed to `Summary data is unavailable.`

Migration 033 was not applied, and rollback-only Migration 033b was not run
against Production. Reports, Invoices, and Receipts were restored from the
exact parent-commit function sources. All 14 protected Production table counts
and opaque hashes matched their pre-rollout values; no financial, provenance,
journal, allocation, or import data changed.

The local correction separates the internal versioned parse result from the
public serializer:

- Internal v1 and v2 results remain explicitly tagged with
  `contractVersion: 1` or `contractVersion: 2`.
- Serialized v1 current-balance and document-total summaries retain the exact
  legacy fields and omit `meta.contract_version` and all v2
  authority/completeness fields.
- Serialized v2 summaries retain `meta.contract_version = 2`, strict decimal
  strings, nullable base totals, authority counts, completeness flags, and
  unavailable-currency reconciliation.
- Invoice, Receipt, and Reports export collection consumers execute the same
  corrected shared boundary.
- The frontend parser remains unchanged. Its focused suite accepts corrected
  v1 and v2 responses and explicitly rejects the non-legacy
  `meta.contract_version = 1` form.

Remediation validation:

| Validation | Result |
| --- | --- |
| Gate D contract tests | `11/11` passed |
| Multi-currency contract tests | `112/112` passed |
| Focused governed FX and Gates A/B/C/D | `174/174` passed |
| Full backend regression | `12 files`, `251/251` passed |
| Frontend monetary parser | `24/24` passed |
| Full frontend Vitest | `56 files`, `765/765` passed |
| Backend Deno lint | Passed for all three changed backend TypeScript files |
| Strict Deno check | Passed for Reports, Invoices, Receipts, and both changed backend test files |
| Frontend ESLint and TypeScript | Passed |
| Next.js production build | Passed; `27 routes`, `25 static pages` |
| Both npm audits | `0 vulnerabilities` |

This remediation made no migration, deployment, or Production call. It remains
local and unstaged, pending a new independent read-only review and a separately
reauthorized Production rollout.
