# Gate E — Frontend Implementation Evidence

Accounts Receivable Management System for SMEs — Autonomous AR Operations.
This document records the **final** state of the Gate E frontend after the
seven-blocker remediation and the subsequent narrow diagnostics/evidence
cleanup. It is the single authoritative evidence record; there are no historical
or duplicated sections.

## Baseline

- **API contract version:** `gate-e.1` (re-frozen) —
  `docs/contracts/GATE_E_AUTOMATION_API_CONTRACT.md`.
- **Committed baseline:** `main` @ `a40f2952a3fda91823bffa0fb9d6f023c5eb39a1`
  == `origin/main`, ahead/behind **0/0**, staged **0**.
- **Scope:** frontend only. No backend, database, Migration 034/034b, RLS,
  financial-authority, or provider file was modified.
- Nothing was staged, committed, pushed, deployed, migrated, or activated. No
  real provider, OAuth, mailbox, email, document-intelligence, scheduler, or
  Production action occurred.

## Implementation summary

- **Strict live envelope parsing** — the real request path in `use-api.ts`
  strict-parses every `contract_version: "gate-e.1"` response through the frozen
  `successEnvelopeSchema` / `errorEnvelopeSchema` (`.strict()`, version pinned
  via `z.literal`). Version drift, unknown top-level/nested fields, a malformed
  error, a non-JSON body (raw text never surfaced), a `success:true` on a failed
  HTTP status, and a 2xx `success:false` all fail closed; a 2xx `success:false`
  is treated as an error, never success. Non-Gate-E callers are unchanged; every
  Gate E mutation still parses its DTO (including the manual mailbox-sync run).
- **Readiness + permission copy** — the straight-through confirmation states it
  changes only the tenant operating-mode setting and does not prove
  ingestion/delivery/document-intelligence readiness or bypass kill switches
  (workers recheck at runtime, fail closed). `AutomationPermissionDenied` takes
  section-specific copy (neutral default) instead of one inaccurate universal
  role list; direct-URL denial renders a safe surface, never a raw 403.
- **Split readiness** — `provider_ready` is gone; `ingestion_ready`,
  `delivery_ready`, and `document_intelligence_ready` are modelled and shown as
  independent cards; the reminder delivery banner derives from
  `reminder_delivery_enabled` + `delivery_ready` only.
- **Strict DTOs + semantic dates + per-key safe metadata** — every wire object is
  `.strict()`; date/timestamp primitives use semantic validators mirroring the
  backend; `filterSafeMetadata` uses per-key validators plus a credential-shaped
  guard.
- **Role + entity request gating** — operational and detail-page reads are gated
  on the resolved role; `useAuditEvents` is entity-scoped only (disabled until a
  valid `entity_type` and UUID `entity_id` exist), so no unfiltered tenant-wide
  audit request can fire. System Admin may configure automation and set the
  disabled mode only; OAuth authorization URLs are refused unless HTTPS + exact
  allowlisted host + no non-default port + no embedded credentials.
- **Accessible dialogs** — `AutomationDialog` requires a `description` and always
  renders a Radix `Dialog.Description` (linked via `aria-describedby`; no empty
  attribute). Because it is a controlled dialog with no `Dialog.Trigger`, it
  captures the opening element and restores focus to it on close via
  `onCloseAutoFocus` — real focus restoration, verified in Chromium.
- **Deterministic E2E** — a strict in-test router with no success fallback
  (`/auth/me` is GET-only; every route is method-checked; wrong methods reach the
  final `fail()`), a broadened HTTP-error monitor, a pure/unit-tested
  request-failure classifier that structurally excludes BOTH the exact Edge root
  `/functions/v1` and `/functions/v1/**` from the RSC-prefetch exemption, and a
  self-contained empty storage state (details in the Playwright section).

## Changed-file inventory (exact, from Git)

**Tracked, modified (`git diff --name-status`) — frontend:**
- `frontend/src/hooks/use-api.ts`
- `frontend/src/hooks/use-api.test.tsx`
- `frontend/src/lib/feature-status.ts`
- `frontend/src/components/layout/sidebar.tsx`
- `frontend/src/app/(dashboard)/customers/[id]/page.tsx`
- `frontend/src/app/(dashboard)/invoices/[id]/page.tsx`

**Untracked, new (`git ls-files --others`) — frontend (34):**
- `frontend/e2e/gate-e-automation.spec.ts`
- `frontend/e2e/diagnostics.ts`
- `frontend/src/test/e2e-request-classifier.test.ts`
- `frontend/src/hooks/use-automation.ts`
- `frontend/src/lib/automation/contract.ts`
- `frontend/src/lib/automation/contract.test.ts`
- `frontend/src/lib/automation/oauth.ts`
- `frontend/src/lib/automation/oauth.test.ts`
- `frontend/src/lib/automation/navigation.ts`
- `frontend/src/lib/automation/navigation.test.ts`
- `frontend/src/lib/automation/labels.ts`
- `frontend/src/lib/automation/labels.test.ts`
- `frontend/src/lib/automation/format.ts`
- `frontend/src/lib/automation/query-keys.ts`
- `frontend/src/app/(dashboard)/automation/layout.tsx`
- `frontend/src/app/(dashboard)/automation/page.tsx`
- `frontend/src/app/(dashboard)/automation/automation.test.tsx`
- `frontend/src/app/(dashboard)/automation/settings/page.tsx`
- `frontend/src/app/(dashboard)/automation/mailboxes/page.tsx`
- `frontend/src/app/(dashboard)/automation/runs/page.tsx`
- `frontend/src/app/(dashboard)/automation/documents/page.tsx`
- `frontend/src/app/(dashboard)/automation/commands/page.tsx`
- `frontend/src/app/(dashboard)/automation/exceptions/page.tsx`
- `frontend/src/app/(dashboard)/automation/sales-representatives/page.tsx`
- `frontend/src/components/features/automation/dialog.tsx`
- `frontend/src/components/features/automation/dialog.test.tsx`
- `frontend/src/components/features/automation/states.tsx`
- `frontend/src/components/features/automation/states.test.tsx`
- `frontend/src/components/features/automation/panels.test.tsx`
- `frontend/src/components/features/automation/customer-sales-rep-panel.tsx`
- `frontend/src/components/features/automation/invoice-reminder-panel.tsx`
- `frontend/src/components/features/automation/audit-timeline.tsx`
- `frontend/src/components/features/automation/automation-badge.tsx`
- `frontend/src/components/features/automation/collection.tsx`

**Untracked, new — documentation (4):**
- `docs/evidence/GATE_E_FRONTEND_IMPLEMENTATION_EVIDENCE.md` (this file)
- `docs/gate-e/AUTOMATION_USER_GUIDE.md`
- `docs/contracts/GATE_E_AUTOMATION_API_CONTRACT.md`
- `docs/architecture/GATE_E_AUTONOMOUS_AR_OPERATIONS_BACKEND.md`

**Not part of this frontend work — unchanged (Codex backend/database):** the
tracked diffs `backend/supabase/config.toml`,
`backend/supabase/functions/invoices/service.ts`,
`backend/supabase/functions/receipts/service.ts`; the untracked
`backend/supabase/functions/automation/{contract,document,dto,index,oauth,providers,service,worker-auth}.ts`,
`backend/supabase/functions/gate_e_automation_contract_test.ts`,
`database/034_gate_e_autonomous_ar_operations.sql`, and
`database/034b_gate_e_autonomous_ar_operations_smoke_tests.sql`. The stale
top-level `supabase/` tree, `Poster/`, and `social-media/` are untouched.

Totals: **6** tracked-modified frontend files, **34** untracked-new frontend
files, **4** documentation files.

## Validation results

| Check | Command | Result |
|---|---|---|
| Backend Gate E focused (independently verified) | `deno test` (Gate E suite) | **81/81 passed** |
| Full backend (independently verified) | `deno test` (full suite) | **332/332 passed** |
| TypeScript | `npx tsc --noEmit --pretty false` | **0 errors** |
| ESLint (src) | `npx next lint --dir src` | **✔ no warnings or errors** |
| ESLint (E2E) | `npx eslint e2e/gate-e-automation.spec.ts e2e/diagnostics.ts` | **clean (exit 0)** |
| Focused Gate E frontend | `vitest run` (9 automation files) | **9 files, 127 tests passed** |
| E2E request-classifier unit test | `vitest run src/test/e2e-request-classifier.test.ts` | **1 file, 17 tests passed** |
| Full Vitest suite | `npx vitest run` | **65 files, 903 tests passed** |
| Production build | `npx next build` | **success**; all `/automation/*` routes emitted |
| Playwright desktop | `desktop-chromium` | **17 passed** |
| Playwright mobile | `mobile-chromium` | **17 passed** |
| Playwright total | 1 spec, 2 projects | **34 passed, 0 failed, 0 skipped** |
| `git diff --check` | — | **clean** (CRLF warnings only) |
| Secret scan (Gate E frontend) | credential patterns | **no real secrets** (only a credential-*detector* regex) |
| Backend / DB / Migration 034·034b / stale `supabase/` | git | **unchanged** |
| `Poster/` & `social-media/` | git | **untouched** |

### E2E diagnostic counters

Playwright runs the same 17-test matrix in **both** projects
(`desktop-chromium` + `mobile-chromium`) = **34 project executions**. The
deliberate `/auth/me` wrong-method test executes once per project, so 2 of the 34
executions are deliberate-negative and the other 32 are ordinary positive.

**Ordinary positive project executions** (**32 of 34**) — asserted per test and
in an `afterEach` settling gate via `expectClean()`:

| Counter | Value |
|---|---|
| unmatched requests | **0** |
| unexpected HTTP errors (≥ 400) | **0** |
| console errors | **0** |
| page errors | **0** |
| unexpected request failures | **0** |
| external navigations | **0** |
| expected aborts (allowlisted, recorded separately) | Next.js `<Link>` RSC prefetch cancellations only |

**Deliberate `/auth/me` wrong-method negative project executions** (**2 of 34**)
— this test intentionally drives failures, so it uses a precise negative clean
gate (`expectDeliberateAuthMethodFailures`) instead of `expectClean()`. The
counts below are **intended** consequences of the test, not defects.

Per deliberate project execution:

| Counter | Value |
|---|---|
| intentional unmatched requests (`POST`/`PATCH`/`PUT`/`DELETE /auth/me`) | **exactly 4** |
| intentional HTTP 500 responses (one per wrong method) | **exactly 4** |
| browser "Failed to load resource … 500" echoes of those 500s | **exactly 4** |
| unrelated console errors | **0** |
| page errors | **0** |
| unexpected request failures | **0** |
| external navigations | **0** |
| accepted `GET /auth/me` recorded as unexpected or as an HTTP error | **never** |

Aggregate across BOTH deliberate project executions in the complete 34-execution
run: **8** intentional unmatched requests, **8** intentional HTTP 500 responses,
and **8** directly-related "Failed to load resource … 500" console echoes — with
unrelated console errors, page errors, unexpected request failures, and external
navigations all **0**.

## Actual Playwright execution

- **Command:** `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npx playwright test
  e2e/gate-e-automation.spec.ts` (no `PLAYWRIGHT_STORAGE_STATE` supplied).
- **Server:** the repository production build served locally
  (`npx next build` then `npx next start -H 127.0.0.1 -p 3100`).
- **Result:** `desktop-chromium` 17 passed, `mobile-chromium` 17 passed →
  **34 executed, 34 passed, 0 failed, 0 skipped**.
- **Empty storage state:** the spec sets
  `test.use({ storageState: { cookies: [], origins: [] } })`. It requires no
  `PLAYWRIGHT_STORAGE_STATE`, reads no file under `playwright/.auth/`, and
  creates no ad-hoc file. The synthetic authenticated session is injected in-page
  via `addInitScript` (a self-signed, non-secret JWT + seeded company context).
  The override is scoped to this spec; the default suite and Production
  authentication code/guards are unchanged.
- **Strict router:** an explicit method+path allowlist answers every expected
  route; the final unmatched branch is `fail()` — there is no `return
  collection([])` catch-all. `GET /auth/me` is the only accepted `/auth/me`
  method; `POST`/`PATCH`/`PUT`/`DELETE /auth/me` fall through to `fail()`. Every
  route (including host-detail routes) is method-checked, so any wrong method is
  recorded as unexpected and returns a deliberate 500 test error. Enforced query
  contracts: `reminders?invoice_id`, `reminder-attempts?reminder_id`,
  `audit?entity_type&entity_id`, and `…/sales-representative/history?page&page_size`.
  An executable negative test drives `POST`/`PATCH`/`PUT`/`DELETE /auth/me` from
  the page and asserts (via `expectDeliberateAuthMethodFailures`) exactly four
  intentional unmatched requests, exactly four deliberate HTTP 500s, exactly four
  browser "Failed to load resource … 500" console echoes of those 500s, zero
  unrelated console errors, and zero page errors / request failures / external
  navigations — while `GET /auth/me` stays accepted. (This strict router genuinely
  caught an unenumerated `GET /allocations` call, which was then made explicit.)
- **HTTP-error monitor:** `page.on("response")` records any status ≥ 400 on BOTH
  the same-origin local application and the `/functions/v1/` Edge surface (method,
  pathname, status, resource type). Provider origins are intercepted before any
  HTTP response, so they never appear. Unexpected HTTP errors = 0.
- **Request-failure classification:** delegated to a pure, unit-tested helper
  (`e2e/diagnostics.ts` → `classifyRequestFailure` + `isEdgeFunctionPath`, 17
  Vitest cases). The Edge predicate excludes BOTH the exact root `/functions/v1`
  and `/functions/v1/**`, so `http://127.0.0.1:3100/functions/v1?_rsc=x` (GET,
  `ERR_ABORTED`) classifies as `unexpected`, never as an RSC prefetch. There is no
  blanket `ERR_ABORTED` exemption. Exactly two deterministic aborts are classified
  as expected and recorded separately from unexpected failures: (1) an abort of
  the OAuth provider consent origins (`https://accounts.google.com`,
  `https://login.microsoftonline.com`) by the guard route; and (2) a same-origin
  Next.js `<Link>` RSC prefetch GET cancellation (`?_rsc=`) that is **not** an
  Edge path (neither `/functions/v1` nor `/functions/v1/**`). A same-origin
  `/functions/v1?_rsc=…` or `/functions/v1/…?_rsc=…` abort, a
  non-GET, a same-origin GET without `_rsc`, an external origin, or any non-abort
  error can never enter the expected bucket — all proven by the unit test. In
  practice only (2) occurs, because the client refuses the non-allowlisted OAuth
  URL before any provider request is made. Unexpected request failures = 0.
- **Focus restoration (real browser):** a Chromium flow (both projects) focuses
  the Straight-Through trigger, opens the confirmation dialog, verifies focus is
  trapped inside it, presses Escape, and asserts focus is restored to the
  original trigger — proving the restoration that jsdom cannot.

## Security / safety

- Every backend call in the E2E is answered by the in-test router; no real
  provider, OAuth, mailbox, email, document-intelligence, scheduler, migration,
  deployment, or Production action can occur.
- No file under `playwright/.auth/` is read, copied, modified, or committed; no
  credentials are hard-coded (the only credential-shaped strings are the
  detector regexes and synthetic non-secret test JWT builder).
- The spec stays gated `test.skip(!isLocal, …)`, so a default production run
  (no loopback base URL) still skips rather than touching Production.

## Remaining activation dependencies (backend-side, unchanged)

A concrete document-intelligence provider; secure OAuth token writer + secret
provisioning + refresh; real mailbox connections; reminder delivery; a scheduler;
Migration 034 applied remotely; and the controlled
disabled→observe→draft→straight-through Production rollout. All remain
disabled/fail-closed and are surfaced truthfully in the UI.

## Truthful final status

- Gate E is **not** Live, Closed, Production-Active, or Provider-Connected.
  Feature Status uses "Frontend Implemented — Pending Backend Deployment",
  "Implemented — Disabled by Default", "Provider Configuration Required", and
  "Frontend Implemented — Delivery Disabled".
- The live path genuinely strict-parses the success/error envelopes.
- The E2E router has no broad success fallback, and `Failed to load resource`
  console errors are not broadly ignored (predictable subresources are stubbed
  at the source).
- No settings mutation is represented as proving provider readiness; readiness is
  per capability and rechecked fail-closed by the backend at runtime.
- The empty Playwright storage state is owned by the spec; no real or ad-hoc
  auth-state file is required or read.
