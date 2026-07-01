# Batch 9A - UI/API Completeness and Placeholder Removal Evidence

Status: Part 1 (Codex backend/API foundation) + Part 2 (Claude frontend integration) complete locally — pending Codex post-implementation review.

Date: 2026-07-01

Baseline:

- Current branch: `main`
- Baseline commit checked: `25c186e700db433d71059a15bde04b5949052e7e`
- `origin/main`: `25c186e700db433d71059a15bde04b5949052e7e`
- Worktree at task start: clean

Scope for this Codex step:

- Build backend/API foundation for Batch 9A.
- Start source inventory and UI/API matrices.
- Add minimal frontend API contract hooks/types for Claude handoff.
- Do not perform large visual UI design.
- Do not deploy.
- Do not touch staging or production data.
- Do not run fixtures, imports, or create-record flows.

## Hard safety boundaries

Confirmed as required invariants for this batch:

- `POST /allocations/auto` remains disabled with HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- No direct insert into `allocation_details`.
- No direct update of `invoices.outstanding`.
- No direct update of `receipts.allocated_amount` or `receipts.unallocated_amount`.
- No direct delete of protected financial records.
- No financial RPC bypass.
- No mock dashboard data.
- No role-based UI behavior may rely on `NEXT_PUBLIC_DEMO_USER_ROLE` after Claude frontend wiring.
- No production fixtures/imports/create-record flows.

## Source inventory summary

Inventory was run with conservative scans for:

`mock`, `placeholder`, `TODO`, `FIXME`, `sample`, `dummy`, `hardcoded`, `coming soon`, `not implemented`, `noop`, `alert(`, `console.log`, `href="#"`, `disabled={true}`, `onClick={() => {}}`, `NEXT_PUBLIC_DEMO_USER_ROLE`, `DEMO_USER_ROLE`, static API responses, dashboard static data, `supabase.from(`, and direct frontend financial table references.

Initial findings requiring Batch 9A action or Claude UI handoff:

| Finding | Classification | Evidence / file reference | Required action |
|---|---|---|---|
| Frontend role source uses demo/env fallback | Defect | `frontend/src/hooks/use-user-role.ts` contains `NEXT_PUBLIC_DEMO_USER_ROLE` fallback and comments that no supported role API exists | Replace with `GET /auth/me` in Claude frontend integration |
| Settings role page exposes demo/env role source | Defect | `frontend/src/app/(dashboard)/settings/roles/page.tsx` references `NEXT_PUBLIC_DEMO_USER_ROLE` source text | Replace with authenticated role context |
| Settings page reads demo/env role | Defect | `frontend/src/app/(dashboard)/settings/page.tsx` reads `process.env.NEXT_PUBLIC_DEMO_USER_ROLE` | Replace with authenticated role context or remove display |
| Invoice tax-code list is mock/static | Defect | `frontend/src/hooks/use-invoices.ts` returns mock tax codes and intentionally omits `tax_code_id` from payload | Wire to `GET /lookups/tax-codes` or honestly disable tax selector until wired |
| Invoice payment-term list is mock/static | Defect | `frontend/src/hooks/use-invoices.ts` returns mock payment terms | Wire to `GET /lookups/payment-terms` or honestly disable selector until wired |
| Header global search is placeholder | Defect | `frontend/src/components/layout/header.tsx` comment says search is placeholder for future | Wire to `GET /search` or disable/hide with reason |
| Notification bell/profile menu referenced by header | Needs implementation/handoff | `frontend/src/components/layout/header.tsx` contains global header controls | Notifications can use `GET /notifications`; profile should use `GET /auth/me` |
| AI sidebar is placeholder | Needs honest relabel/handoff | `frontend/src/app/(dashboard)/layout.tsx` says "AI Assistant coming soon" | Convert to local AR Help Sidebar; no external AI/LLM calls in 9A |
| Credit notes page is placeholder | Needs disable/hide or wire later | `frontend/src/app/(dashboard)/credit-notes/page.tsx` describes future module | Hide/disable from operational navigation unless real UI is completed |
| Settings bank-account text is stale | Defect | `frontend/src/app/(dashboard)/settings/page.tsx` says no `GET /bank-accounts` API is available | Update copy because `GET /bank-accounts` exists |
| Normal HTML input placeholders | Benign | Forms and filters use `placeholder` for input affordances | Do not remove as mock data |

No dashboard mock-data path was found in the initial source review. Dashboard hooks use `GET /reports/dashboard`.

## Initial UI action completeness matrix

This is the Part 1 starter matrix for Claude to complete with exact screenshots and final UI states.

| Page / component | Visible action/control | Current behavior | Required final behavior | Backend/API support | Role requirement | Status | Owner | Evidence required |
|---|---|---|---|---|---|---|---|---|
| Header | Global search input | Placeholder/inert | Wire to scoped search or disable/hide | `GET /search?q=...` added in this step | Authenticated operational/read role | implement UI wiring | Claude | Search result smoke + empty state |
| Header | Notifications | Referenced global control | Show real derived notifications or honest empty state | `GET /notifications` added in this step | Authenticated operational/read role | implement UI wiring | Claude | Empty/non-empty response smoke |
| Header | My Profile | Referenced global control | Read-only profile/context view | `GET /auth/me` added in this step | Authenticated user with company role | implement UI wiring | Claude | Profile context smoke |
| Layout/sidebar | AI Assistant | Placeholder "coming soon" | Local AR Help Sidebar only; no external AI/provider/data upload | Backend not required | Authenticated user | relabel/implement static guidance | Claude | Copy/screenshot; no network AI call |
| Invoice form | Tax-code selector | Mock static tax codes; IDs not submitted | Wire to real lookup or disable honestly | `GET /lookups/tax-codes` added in this step | Authenticated company role | implement UI wiring | Claude | Lookup payload + no fake IDs |
| Invoice form | Payment-term selector | Mock static payment terms | Wire to real lookup or disable honestly | `GET /lookups/payment-terms` added in this step | Authenticated company role | implement UI wiring | Claude | Lookup payload |
| Settings | Roles/current role display | Demo/env role source | Use authenticated context | `GET /auth/me` added in this step | Authenticated user with company role | implement UI wiring | Claude | No env role source |
| Settings | Audit Trail card/page | Example/static audit-log page from prior audit | Disable/hide or clearly mark unavailable unless real API exists | No new audit-log API in this step | TBD | defer/hide unless implemented later | Claude | UI matrix decision |
| Settings | Bank account API text | Stale text says API unavailable | Correct copy and/or link to real read API state | `GET /bank-accounts` already exists | Authenticated allowed role | update UI copy | Claude | Screenshot |
| Credit notes page/nav | Credit note page | Placeholder module page | Hide/disable until real UI exists | Existing backend credit-notes function, UI incomplete | TBD | hide/disable unless completed separately | Claude/Codex if API work needed | UI matrix decision |
| Allocations page | Reverse allocation | Requires role/context for honest exposure | Wire only if endpoint/role verified, otherwise disable | `POST /allocations/:id/reverse` already exists | AR Supervisor+ | Claude after role wiring | Codex verifies API guard | HTTP role test |

## Initial API completeness matrix

| Frontend flow | API endpoint / function | Method | Auth required | Role/RLS requirement | Financial mutation | Safety boundary | Test evidence |
|---|---|---|---|---|---|---|---|
| Current user context | `/auth/me` | GET | Yes | Active role in `X-Company-Id` company | No | Read-only; no token/secret metadata returned | Deno check; future HTTP 200/401/403 smoke |
| Tax-code lookup | `/lookups/tax-codes` | GET | Yes | Active company role; scoped by company | No | Read-only config lookup; active/effective records only | Deno check; future HTTP smoke |
| Payment-term lookup | `/lookups/payment-terms` | GET | Yes | Active company role; scoped by company | No | Read-only config lookup; active records only | Deno check; future HTTP smoke |
| Global search | `/search?q=...` | GET | Yes | Operational read roles only; AR Clerk assigned-customer filter | No | Read-only; customer visibility and company scope enforced | Deno check; future role/customer smoke |
| Notifications | `/notifications` | GET | Yes | Operational read roles only | No | Derived from real import state; no fake records created | Deno check; future HTTP smoke |
| Dashboard | `/reports/dashboard` | GET | Yes | Existing report guard | No | No static dashboard data; uses backend report API | Source scan |
| Auto allocation negative check | `/allocations/auto` | POST | Yes | N/A | Disabled | Must remain HTTP 403 `AUTO_ALLOCATION_DISABLED` | Source scan; future HTTP smoke |

## API contracts added in Part 1

### `GET /auth/me`

Returns:

- `user.id`
- `user.email`
- `company.id`
- `company.code`
- `company.name`
- `company.base_currency`
- `company.country`
- `roles`
- `highest_role`
- `capabilities`

Does not return:

- access token
- refresh token
- raw JWT
- service role data
- auth provider metadata
- role mutation controls

### `GET /lookups/tax-codes`

Query params:

- `country` optional, two-letter country code
- `tax_type` optional, e.g. `Output` or `Input`
- `effective_date` optional, `YYYY-MM-DD`; defaults to current date

Returns active company-scoped tax codes effective on the requested date.

### `GET /lookups/payment-terms`

Returns active company-scoped payment terms.

### `GET /search?q=...&limit=...`

Searches safe AR objects:

- customers
- invoices
- receipts

Constraints:

- `q` length 2 to 80 characters
- `limit` 1 to 20, default 10
- System Admin-only users are denied through operational-read guard
- AR Clerk is filtered to assigned visible customers
- hidden/deleted customers are excluded from customer results
- invoice/receipt results are filtered through visible customer verification before being returned
- user search text is passed through individual `.ilike()` filters per field; no user-controlled raw
  PostgREST `.or(...)` filter string is constructed
- read-only only

### `GET /notifications?limit=...`

Returns derived notification items from real import batch state:

- import rows needing review
- import errors

If no real signals exist, returns an honest empty array.

No notification records are created.

Routes currently point to existing frontend import pages:

- invoice notifications: `/invoices/import`
- receipt notifications: `/receipts/import`

No generic `/imports/:id` route is assumed.

## Review hardening fixes applied

During final Codex implementation review, three issues were tightened before Claude handoff:

1. `GET /search` no longer builds raw PostgREST `.or(...)` filters with user-controlled search text.
   It now runs separate `.ilike()` queries per field and deduplicates results by id.
2. `GET /search` now verifies invoice/receipt linked customers are still visible
   (`is_deleted = false`, `is_hidden = false`) before returning transaction results for all
   operational-read roles, not only AR Clerk assignment filtering.
3. Lookup query params are explicitly validated:
   - `country` must be a two-letter uppercase ISO-style code after normalization.
   - `tax_type` must be `Output` or `Input`.
   - `effective_date` must be a valid `YYYY-MM-DD` calendar date.
4. Notification routes were changed from a non-existent generic `/imports/:id` route to existing
   frontend import routes (`/invoices/import`, `/receipts/import`).

## Profile and AI sidebar handoff

- Profile should use `GET /auth/me` as the source of truth.
- Profile must be read-only in Batch 9A unless a separately reviewed safe update path exists.
- Users must not be allowed to edit role, company, or security-sensitive fields.
- AI sidebar should be implemented as a local AR Help Sidebar / workflow guidance surface only.
- No external GenAI/OCR/LLM provider calls are allowed in Batch 9A.
- No company data or documents may be uploaded to an AI provider in Batch 9A.
- UI copy must not pretend that local static help is live AI automation.

## Files changed in Part 1

Backend Edge Functions:

- `backend/supabase/functions/auth/index.ts`
- `backend/supabase/functions/lookups/index.ts`
- `backend/supabase/functions/search/index.ts`
- `backend/supabase/functions/notifications/index.ts`

Frontend API contracts:

- `frontend/src/types/index.ts`
- `frontend/src/hooks/use-auth-context.ts`
- `frontend/src/hooks/use-lookups.ts`
- `frontend/src/hooks/use-global-search.ts`
- `frontend/src/hooks/use-notifications.ts`

Evidence:

- `docs/evidence/BATCH_9A_UI_API_COMPLETENESS_PLACEHOLDER_REMOVAL_EVIDENCE.md`

## Validation log

- `deno check auth/index.ts lookups/index.ts search/index.ts notifications/index.ts allocations/index.ts reports/index.ts`
  - Result: PASS.
- `deno check auth/index.ts lookups/index.ts search/index.ts notifications/index.ts allocations/index.ts reports/index.ts imports/index.ts customers/index.ts invoices/index.ts receipts/index.ts`
  - Result: PASS after final hardening review.
- `npm.cmd exec tsc -- --noEmit`
  - Result: PASS.
- `npm.cmd run build`
  - Result: PASS on Next.js 15.5.19.
- `git diff --check`
  - Result: PASS. Git reported a line-ending warning for `frontend/src/types/index.ts` only.
- Source scan for `/allocations/auto`
  - Result: PASS. `backend/supabase/functions/allocations/index.ts` still returns
    `AUTO_ALLOCATION_DISABLED` for `POST /allocations/auto`.
- Dashboard mock/static scan
  - Result: PASS for dashboard. Findings were limited to import-page `SAMPLE_CSV` templates, not
    dashboard mock metrics.
- Frontend direct financial-table access scan
  - Result: PASS. No `supabase.from(` or direct frontend `.from('invoices')`, `.from('receipts')`,
    `.from('allocation_details')`, `.from('invoice_lines')`, `.from('journal_entries')`, or
    `.from('journal_entry_lines')` found.
- Secret/JWT scan over changed files
  - Result: PASS. No token/JWT/password/key values found.
- Mojibake scan over changed docs/code
  - Result: PASS. No literal `U+00E2`, `U+00C2`, or `U+FFFD` found in changed files.
- Generated artifact scan
  - Result: PASS. `frontend/.next` may exist from local build but is ignored/untracked; no
    generated build artifact is staged/tracked.

## Safety confirmations

- No production action performed.
- No staging action performed.
- No deployment performed.
- No SQL migration created or applied.
- No fixture/import/create-record flow executed.
- No production or staging data touched.
- No financial RPC business logic modified.
- No direct financial-table mutation added.
- `/allocations/auto` remains disabled in source.

---

# Part 2 — Claude Frontend Integration

Date: 2026-07-01. Owner: Claude. Scope: frontend wiring + placeholder removal against the Part 1 API
contracts. No backend/SQL/migration/Edge/RPC change; no fixture/import/create-record execution; no
deploy/commit/push.

## Final UI action completeness matrix

| Page / component | Visible control | Previous behavior | Final behavior | Backend support | Role requirement | Status | Owner |
|---|---|---|---|---|---|---|---|
| Header (`components/layout/header.tsx`) | Global search | Inert placeholder input | Live dropdown (customers/invoices/receipts); min 2 chars; loading/empty/error states; navigates to API-supplied `route` | `GET /search` | Operational/read (server-scoped) | implemented | Claude |
| Header | Notifications bell | Hardcoded badge `3`, no action | Real count from API; dropdown lists derived items; empty state; links to `/notifications` | `GET /notifications` | Operational/read | implemented | Claude |
| Header | My Profile | Inert menu item | Navigates to `/profile` (read-only context) | `GET /auth/me` | Authenticated | implemented | Claude |
| Header | Role label | `useUserRole` (env demo role) | Authenticated role; shows "Loading…" then real role | `GET /auth/me` | Authenticated | implemented | Claude |
| Notifications page (`/notifications`) | Full list | Did not exist | New read-only page; severity styling; empty/loading/error states | `GET /notifications` | Operational/read | implemented (new) | Claude |
| Profile page (`/profile`) | Profile view | Did not exist | New read-only page: email, user id, company, roles, capability flags; no edit controls | `GET /auth/me` | Authenticated | implemented (new) | Claude |
| Layout/sidebar | "AI Assistant" | Placeholder "coming soon" shell | Local **AR Help & Workflow Guide** panel (static guidance); button relabeled "AR Help"; no external AI/LLM/OCR, no data upload | none (local) | Authenticated | relabeled/implemented | Claude |
| Invoice form | Tax-code selector | Mock static codes; `tax_code_id` stripped from payload | Real lookup options; selected **real** `tax_code_id` submitted (backend validates + resolves rate) | `GET /lookups/tax-codes` | Operational | implemented | Claude (flagged for Codex — see Financial-behavior note) |
| Invoice form | Payment-term selector | Mock static terms | Real lookup options; honest empty hint when none configured | `GET /lookups/payment-terms` | Operational | implemented | Claude |
| Settings (`/settings`) | Role display | Read `process.env.NEXT_PUBLIC_DEMO_USER_ROLE` | Authenticated "Session Context" (email + role from `/auth/me`) | `GET /auth/me` | Authenticated | implemented | Claude |
| Settings | Bank account section | Stale "No GET /bank-accounts API is available" + demo env id | Real read-only bank-accounts table; stale copy removed | `GET /bank-accounts` | Allowed read role | implemented | Claude |
| Settings | Demo environment section | Showed demo role / demo bank env vars | Removed; replaced by authenticated Session Context | n/a | n/a | removed | Claude |
| Settings | Feature Status table | "Sprint Fx" + "Coming Soon" rows | Honest current statuses (Live / Read-Only / Reference / Disabled / Planned-Batch-9x) | n/a | n/a | relabeled | Claude |
| Settings → Roles (`/settings/roles`) | Current-role source text | "Source: NEXT_PUBLIC_DEMO_USER_ROLE…" | "Source: authenticated context (GET /auth/me)" | `GET /auth/me` | Authenticated | implemented | Claude |
| Settings → Audit Trail | Example audit rows | Fabricated example table | Removed fabricated rows; honest "no viewer yet" note; capability cards retained as reference | none (no audit read API in 9A) | n/a | fabricated data removed / relabeled | Claude |
| Journal Entries (`/journal-entries`) | Page | "Prototype Placeholder" + "API not verified" note | Relabeled "Reference Guide"; honest note that a listing/drill-down needs a future read API | none (no JE read API in 9A) | n/a | relabeled | Claude |
| Credit Notes (`/credit-notes`) | Page | "Coming Soon" placeholder | Real **read-only list** of Credit/Debit Notes (filtered `GET /invoices`); rows link to invoice detail; empty/loading/error states | `GET /invoices` (doc_type) | Operational/read | implemented (read-only) | Claude |
| Invoice/Receipt detail | JE note | "Journal Entry detail pages are coming soon" | Reworded to reference the Journal Entries guide | n/a | n/a | relabeled | Claude |
| Reports export buttons | Export | Disabled, `title="Coming Soon"` | Retained as **honestly disabled** (no export API in 9A) | none | n/a | kept (disabled w/ reason) | Claude |
| Allocations | Reverse allocation | No frontend action | Deferred (depends on guarded reverse exposure); not added in 9A | `POST /allocations/:id/reverse` exists | AR Supervisor+ | deferred | — |

## Final API completeness matrix (frontend wiring)

| Frontend flow | Endpoint | Method | Auth | Financial mutation | Wiring evidence |
|---|---|---|---|---|---|
| Role/permission gating + role label + profile + settings context | `/auth/me` | GET | Yes | No | `use-user-role.ts` (rewritten), `header.tsx`, `profile/page.tsx`, `settings/page.tsx`, `settings/roles/page.tsx` |
| Invoice tax-code selector | `/lookups/tax-codes` | GET | Yes | No (read) | `use-invoices.ts#useTaxCodes` |
| Invoice payment-term selector | `/lookups/payment-terms` | GET | Yes | No (read) | `use-invoices.ts#usePaymentTerms` |
| Header global search | `/search` | GET | Yes | No | `header.tsx` via `use-global-search.ts` |
| Notifications bell + page | `/notifications` | GET | Yes | No | `header.tsx`, `notifications/page.tsx` |
| Credit/debit notes list | `/invoices` (doc_type) | GET | Yes | No | `credit-notes/page.tsx` via `useInvoiceList` |
| Bank accounts (settings) | `/bank-accounts` | GET | Yes | No | `settings/page.tsx` via `useBankAccounts` |
| Invoice create (now carries tax_code_id) | `/invoices` | POST | Yes | Yes (existing RPC/service) | `use-invoices.ts#useCreateInvoice` |
| Auto allocation | `/allocations/auto` | POST | — | Disabled | Source scan: still 403; frontend stub throws, not called |

## Financial-behavior note (for Codex post-review)

One change affects persisted financial data and is flagged explicitly:

- **Invoice line `tax_code_id` is now submitted.** Previously the mock options forced
  `tax_code_id` to be stripped from the create payload, so posted invoices carried **no tax** even
  though the on-screen calculator displayed tax. With real `GET /lookups/tax-codes` IDs, the selected
  `tax_code_id` is now forwarded. During Codex post-review, `invoices/service.ts` was hardened so
  line creation/update validates the selected tax code against the authenticated company, active
  status, and invoice-date effective window before resolving the rate server-side. Invalid or
  wrong-tenant tax codes now return a validation error instead of silently becoming no-tax lines.
  **No financial RPC business logic was changed.** This makes the persisted invoice tax consistent
  with the displayed total (an honesty fix). A staging create/post smoke with a real tax code should
  be run before deployment.

## Placeholders removed vs intentionally retained

Removed / replaced with real behavior:
- Mock tax-code & payment-term arrays in `use-invoices.ts` → real lookups.
- `NEXT_PUBLIC_DEMO_USER_ROLE` real-UI reliance → `/auth/me` (only an explanatory comment remains in `use-user-role.ts`).
- `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID` usage in settings → removed; real bank-accounts table.
- Stale "No GET /bank-accounts API is available" copy → removed.
- Fabricated audit-log example rows → removed.
- Header inert search / static "3" notification badge / inert profile → wired.
- "AI Assistant coming soon" placeholder → local AR Help panel.
- Credit Notes "Coming Soon" placeholder → real read-only list.

Intentionally retained (honest):
- HTML input `placeholder` attributes (affordance only).
- Report export buttons left **disabled with a clear reason** (no export API in 9A).
- Journal Entries / Audit Trail kept as clearly-labeled **reference** content (no fabricated data; real read APIs are future batches).
- `import` pages' `SAMPLE_CSV` download templates (legitimate import templates, not displayed data).
- Disabled `useAutoAllocate` stub (must stay disabled; `/allocations/auto` 403).

## Role / auth context verification

- `useUserRole` now derives `role`, `roles`, and all `can*` flags from `GET /auth/me` capabilities.
- While loading or on error, it returns **conservative read-only** defaults (no mutation controls).
- No frontend file reads `NEXT_PUBLIC_DEMO_USER_ROLE` / `DEMO_USER_ROLE` for behavior (verified by scan; only a descriptive comment remains).

## Files changed in Part 2 (Claude)

Modified:
- `frontend/src/hooks/use-user-role.ts` (rewritten to authenticated context)
- `frontend/src/hooks/use-invoices.ts` (real lookups; submit real `tax_code_id`)
- `frontend/src/components/layout/header.tsx` (search + notifications + profile + role)
- `frontend/src/components/layout/sidebar.tsx` (AI Assistant → AR Help)
- `frontend/src/app/(dashboard)/layout.tsx` (AR Help panel)
- `frontend/src/components/features/invoices/invoice-header-form.tsx` (payment-term empty hint)
- `frontend/src/app/(dashboard)/credit-notes/page.tsx` (real read-only list)
- `frontend/src/app/(dashboard)/journal-entries/page.tsx` (reference relabel)
- `frontend/src/app/(dashboard)/settings/page.tsx` (authenticated context + real bank accounts)
- `frontend/src/app/(dashboard)/settings/roles/page.tsx` (authenticated source text)
- `frontend/src/app/(dashboard)/settings/audit-log/page.tsx` (removed fabricated rows)
- `frontend/src/app/(dashboard)/invoices/[id]/page.tsx` (JE note reword)
- `frontend/src/app/(dashboard)/receipts/[id]/page.tsx` (JE note reword)

Added:
- `frontend/src/components/layout/ar-help-panel.tsx`
- `frontend/src/app/(dashboard)/notifications/page.tsx`
- `frontend/src/app/(dashboard)/profile/page.tsx`

## Codex post-review fixes

- `backend/supabase/functions/search/index.ts`: removed raw user-controlled PostgREST `.or(...)`
  search construction, replaced it with separate parameterized `.ilike(...)` queries per field, and
  verified linked invoice/receipt customer visibility before returning transaction results.
- `backend/supabase/functions/lookups/index.ts`: tightened optional tax-code query validation for
  `country`, `tax_type`, and `effective_date`.
- `backend/supabase/functions/notifications/index.ts`: corrected import notification routes to the
  existing invoice/receipt import pages.
- `backend/supabase/functions/invoices/service.ts`: added company/effective-date validation for
  submitted invoice-line `tax_code_id` values before server-side tax-rate resolution.

## Part 2 validation log

- `npm.cmd exec tsc -- --noEmit` → PASS (exit 0).
- `npm.cmd run build` → PASS (exit 0); 25 routes incl. new `/credit-notes`, `/notifications`, `/profile`.
- `git diff --check` → PASS (only LF→CRLF informational warnings on changed TypeScript/TSX files).
- `NEXT_PUBLIC_DEMO_USER_ROLE` / `DEMO_USER_ROLE` / `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID` scan → PASS (only a descriptive comment in `use-user-role.ts`; no behavioral reads).
- Direct frontend financial-table access scan (`supabase.from`, `.from("invoices"/"receipts"/"allocation_details"/"invoice_lines"/"journal_entries"/"journal_entry_lines")`) → PASS (none). `createClient` only in `frontend/src/lib/supabase.ts` (auth client).
- `/allocations/auto` scan → PASS (only disabled-stub comments in `use-allocations.ts`; not called).
- Dashboard static-data scan → PASS (dashboard uses `useDashboardMetrics(6)` → `GET /reports/dashboard`; no mock metrics).
- Placeholder inventory (`mock`/`dummy`/`TODO`/`FIXME`/`coming soon`/`not implemented`/`noop`/`alert(`/`console.log`/`href="#"`/`onClick={() => {}}`) → PASS (no active source hits in the final scan).
- `sample`/`hardcoded`/non-attribute `placeholder`/`prototype`/`Sprint F` scan → PASS (no matches in `frontend/src`).
- Secret/JWT scan over changed files → PASS (no token/JWT/password/key values found).
- Mojibake scan (`â`/`Â`/`U+FFFD`) over `frontend/src` → PASS (none).
- Generated artifact tracked-file scan → PASS (none tracked).

## Part 2 safety confirmations

- No backend / SQL / migration / Edge Function / financial RPC change in Part 2 (changes are `frontend/src` + this evidence doc only; the Codex Part 1 backend files are left intact, not reverted).
- No fixture / import / create-record flow executed.
- No production or staging data touched.
- No deploy, no commit, no push.
- `/allocations/auto` remains HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- No mock dashboard data reintroduced.
- No external AI/LLM/OCR provider call; no company data/document upload.

## Current conclusion

Batch 9A frontend integration is complete locally and all local checks pass. Ready for Codex
post-implementation review (with attention to the flagged invoice `tax_code_id` financial-behavior
note). No deploy/commit/push until approved.
