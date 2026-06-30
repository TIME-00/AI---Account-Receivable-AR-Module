# Batch 9A — UI/API Completeness and Placeholder Removal — Implementation Plan

**Project:** GenAI-assisted Accounts Receivable (AR) module for a Singapore company (Final Year Project)

**Document type:** Standalone implementation plan — planning only, no implementation

**Planning date:** 2026-07-01

**Parent roadmap:** `docs/plans/BATCH_9_ROADMAP_AND_IMPLEMENTATION_SEQUENCE.md` (commit `2bae9a2`)

> **Status of this document.** Planning artifact only. It authorizes **no** code change, migration,
> deployment, fixture run, or data mutation. Implementation begins only after Codex pre-review PASS
> and explicit user approval.

---

## 1. Current baseline

| Item | State |
|---|---|
| Production rollout | Usable / FYP demo-ready |
| Pre-Batch Cleanup & System Baseline Audit | Completed, committed, pushed — `f3c631d` |
| Batch 9 Roadmap and Implementation Sequence | Completed, Codex-reviewed, committed, pushed — `2bae9a2` (`docs/plans/BATCH_9_ROADMAP_AND_IMPLEMENTATION_SEQUENCE.md`) |
| Batch 8B — Financial Mutation Boundary and Role/Visibility Hardening | **Complete** (RPC-only write boundary, mutation role guards, hardened RLS, narrowed System Admin read scope) — must remain **verified intact** by 9A |
| Batch 8D-Fix1 — production RLS policy cleanup | Complete — must remain verified intact |
| `POST /allocations/auto` | **Disabled** — returns HTTP 403 `AUTO_ALLOCATION_DISABLED`; stays disabled |
| Worktree | Clean at task start |

**Standing safety posture (9A must not regress any of these).**

- `/allocations/auto` stays HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- No direct insert into `allocation_details`.
- No direct update of `invoices.outstanding`.
- No direct update of `receipts.allocated_amount` / `receipts.unallocated_amount`.
- No direct delete of protected financial records.
- No bypass of financial RPCs (`post_invoice`, `post_receipt`, `allocate_receipt`,
  `reverse_allocation`, `handle_bounced_cheque`).
- No mock/seed dashboard data.
- No reliance on `NEXT_PUBLIC_DEMO_USER_ROLE` (or similar demo/env value) for honest role-based UI.
- No production fixtures/imports/record creation unless explicitly approval-gated.

The Batch 8B/Fix1 financial mutation boundary is the foundation 9A builds on; 9A **verifies it
remains intact** (see §12) and does not re-establish or modify it.

---

## 2. Batch 9A goals

1. **UI/API completeness** — every visible control either calls a real, supported backend endpoint
   or is intentionally disabled/hidden with a clear reason.
2. **Placeholder / mock removal** — remove or honestly disable placeholder pages, mock data, fake
   static responses, and dead click handlers.
3. **Honest role-based UI behavior** — role-driven hide/disable derives from **authenticated
   backend/user context**, never from a demo/env assumption.
4. **No mock dashboard data** — confirm and keep the dashboard sourced only from
   `GET /reports/dashboard`.
5. **No frontend bypass** — confirm the frontend never bypasses backend/RPC/RLS controls (no
   `supabase.from(...)` financial-table access; `createClient` only for auth/token use).

---

## 3. Scope

The following surfaces are in scope for the completeness audit and cleanup:

- **Dashboard** — live metrics, refresh, trend; confirm real-data source only.
- **Invoices** — list, new/create, detail, actions (post, cancel, import entry, filters,
  pagination, retry).
- **Receipts** — list, new/create, detail, actions (post, cancel, import entry, filters,
  pagination).
- **Customers** — list, detail, quick-create/inline-create behavior, name suggestions.
- **Imports** — upload, parse, validate, execute, and the review queue
  (approve / edit / reject / retry) plus result view, for both invoice and receipt import.
- **Reports** — aging, by-customer, statement/outstanding, and any export controls.
- **Allocations** — Allocation Wizard, allocation history, allocation detail/links; confirm reverse
  is either wired (post role API) or honestly disabled.
- **Credit notes / debit notes** — any UI surfaces (currently placeholder per Batch 8A audit).
- **Bank accounts** — any UI surfaces and the read-only selector; correct stale "API unavailable"
  text.
- **Header / navigation / sidebar / global search** — global search input, notification bell, My
  Profile, AI sidebar shell.
- **Login / auth / role display** — sign-in/out, displayed role/context, role-gated visibility.
- **State coverage** — empty states, disabled states, error states, and loading states across all
  the above.

---

## 4. Out of scope

Explicitly excluded from Batch 9A (each is its own later batch or a standing prohibition):

- **Batch 9B** — PDF/Image/OCR import implementation.
- **Batch 9C** — FX rate sync / multi-currency implementation (and its additive migration).
- **Batch 9D** — bank charge financial mutation implementation.
- **Batch 9E** — auto-approval policy.
- **Re-enabling `/allocations/auto`** — stays HTTP 403.
- **Production data cleanup** — the deferred historical smoke/demo/financial cleanup batch.
- Any change to the Batch 8B/Fix1 financial mutation boundary or financial RPC behavior.

If any 9A finding appears to require work in the above areas, **stop and re-scope** rather than
expand 9A.

---

## 5. Required source inventory

Plan a read-only repository scan (no edits during inventory). Search terms / targets:

| Target | Intent |
|---|---|
| `mock` | Mock data / mock responses |
| `placeholder` | Placeholder UI/data (distinguish from legitimate input `placeholder` attrs) |
| `TODO` | Unfinished work markers |
| `FIXME` | Known-broken markers |
| `sample` | Sample/example data shown as real |
| `dummy` | Dummy data/handlers |
| `hardcoded` / hardcoded literals (e.g. currency labels) | Static values masquerading as dynamic |
| `NEXT_PUBLIC_DEMO_USER_ROLE` | Demo/env role reliance |
| `disabled` buttons | Inert/disabled controls needing a decision |
| Empty/`() => {}` / no-op `onClick` | Unimplemented click handlers |
| `console.log` / `console.*`-only actions | Console-only (fake) actions |
| Static arrays returned as API data | Fake/static API responses |
| Dashboard constant/seed arrays | Dashboard static data |
| `supabase.from(`, `.from("invoices"/"receipts"/"allocation_details")`, `createClient` | Direct frontend financial-table writes/reads |

Output of the inventory: a categorized list with exact `file:line` references, each classified as
**defect**, **intentional/benign** (e.g. real input placeholders), or **needs-decision**.

---

## 6. `/auth/me` (or equivalent) authenticated context requirement — first-class prerequisite

Role-based hide/disable is a **first-class Batch 9A prerequisite/deliverable**, not optional polish.

- **Honesty rule.** Role-based hiding/disabling is **not honest** unless it derives from
  authenticated backend/user context (the server's view of the current user's role/permissions).
- **No demo/env reliance.** The frontend must **not** rely on `NEXT_PUBLIC_DEMO_USER_ROLE` or any
  similar demo/env assumption for role-gated behavior.
- **If `/auth/me` (or equivalent) already exists:** Codex verifies and documents the contract
  (shape, auth, roles returned, company/tenant context); Claude then wires role-gated UI to it.
- **If it does not exist:** implementation must add a **safe, read-only authenticated** endpoint or
  context flow (e.g. `/auth/me`) that returns the user's role/company context — **Codex-owned**
  backend/API/security work.
- **Ownership.** Codex reviews/owns the backend/API/security change; **Claude may own frontend
  integration only after Codex confirms the API contract**.
- **Interim behavior (until the endpoint is in place).** Role-gated controls must be conservatively
  disabled/hidden rather than shown/hidden based on an unauthenticated env value.

This requirement gates 9A.4 (UI role behavior cleanup) and any reverse/bounce UI exposure.

---

## 7. UI action completeness matrix (required format)

The implementation must produce this matrix for every in-scope control. Columns:

| Page / component | Visible action/button/control | Current behavior | Required final behavior | Backend/API support | Role requirement | Status (implement / disable / hide / keep) | Owner (Claude / Codex) | Evidence required |
|---|---|---|---|---|---|---|---|---|
| _(example)_ Header (`components/layout/header.tsx`) | Global search input | Inert placeholder, no submit/API | Disable with tooltip, or implement scoped search API | None today | Any authenticated | disable (or implement) | Claude (Codex if new API) | Screenshot + grep of removed handler |
| _(example)_ Allocations page | Reverse allocation | No frontend action | Wire to `POST /allocations/:id/reverse` after role API | `reverse_allocation` RPC exists | AR Supervisor+ | implement (post-9A.2) | Codex (API/guard) + Claude (UI) | HTTP test + role test |

Every in-scope row from §3 must appear. No control may be left "unknown"; each resolves to
implement / disable / hide / keep.

---

## 8. API completeness matrix (required format)

For every frontend flow, document the backing API. Columns:

| Frontend flow | API endpoint / Edge Function / RPC | Required method | Auth required | Role / RLS requirement | Financial mutation involved (yes/no) | Safety boundary | Test evidence |
|---|---|---|---|---|---|---|---|
| _(example)_ Post invoice | `POST /invoices/:id/post` → `InvoiceService.postInvoice()` → `post_invoice` RPC | POST | Yes | AR Clerk+, company/customer/visibility | yes | RPC-only write; no direct `invoices.outstanding` update | HTTP 200 happy + 403 wrong-role |
| _(example)_ Dashboard metrics | `GET /reports/dashboard` → `get_ar_dashboard_metrics` | GET | Yes | role/scope guards; service-role-only RPC | no | read-only; no mock data | Live-data screenshot + payload check |

Flows touching financial mutation must show the verified RPC path and the relevant safety boundary,
and must be Codex-led.

---

## 9. Known baseline observations to verify

Carry these forward from the cleanup audit and Batch 8A; **verify exact `file:line` during
implementation** (do not assume):

1. **No mock dashboard data found** — re-confirm the dashboard has no static/seed metrics path.
2. **Non-dashboard placeholders/mocks** were noted in **invoice tax-code / payment-term option
   fallback comments/data** (e.g. in `frontend/src/hooks/use-invoices.ts`) — verify and resolve
   (real read-only lookup API, or honest disable if the API is deferred).
3. **Header search remains a placeholder / future UI element** — decide implement vs disable/hide.
4. **Login / form input placeholders are normal** — legitimate HTML `placeholder` attributes are
   **not** bugs and must not be removed as "mock."
5. **Exact file/path references must be verified** during implementation; this plan's example paths
   are indicative, not authoritative.

---

## 10. Implementation approach (safe sub-phases)

- **9A.1 — Source inventory and UI/API matrix.** Run the §5 scan; build the §7 and §8 matrices with
  exact paths. (Read-only.)
- **9A.2 — Authenticated role/context endpoint.** Verify `/auth/me` (or equivalent) or plan/define
  its addition; Codex owns/reviews the contract before any UI wiring. Gates 9A.4.
- **9A.3 — Remove / replace / hide placeholders.** Apply the §7 decisions: remove dead handlers,
  hide unfinished pages from operational nav, disable inert controls with clear reasons, replace
  mock lookups with real read-only APIs or honest disables.
- **9A.4 — UI role behavior cleanup.** Wire role-gated visibility to the authenticated context from
  9A.2; remove `NEXT_PUBLIC_DEMO_USER_ROLE` reliance.
- **9A.5 — API wiring verification.** Confirm every kept control hits a real, guarded endpoint;
  confirm no frontend financial-table access.
- **9A.6 — Local / staging smoke.** Typecheck/lint/build; route walkthrough; role-based UI checks;
  API status checks; dashboard real-data check; `/allocations/auto` 403 check.
- **9A.7 — Evidence and production-readiness gate.** Write the evidence doc; pass Codex review;
  obtain user approval before any production step.

Each sub-phase is independently reviewable; financial-touching steps pause for Codex.

---

## 11. Claude vs Codex split

| Activity | Owner |
|---|---|
| This plan, evidence writing, UX copy | Claude |
| Frontend UI cleanup, disabled/hidden states, role-gated UI wiring | Claude (after Codex confirms any API contract) |
| Source inventory / matrices (read-only) | Claude |
| Backend/API endpoint review or implementation (`/auth/me` etc.) | **Codex leads** |
| Security / RLS review, financial boundary verification | **Codex leads** |
| Backend tests, technical deployment checks | **Codex** |
| Final sign-off before commit/push | User (after Codex PASS) |

**Rule:** if a change involves financial mutation or RLS behavior, **Codex must lead**; Claude does
the frontend integration only after the contract/guards are confirmed.

---

## 12. Testing and smoke plan

- **Local typecheck / lint / build** (`npm.cmd run build`) — must pass.
- **UI route walkthrough** — every in-scope route loads without console errors; states (empty /
  loading / error / disabled) render correctly.
- **Role-based UI verification** — UI reflects the authenticated role from 9A.2; no behavior driven
  by `NEXT_PUBLIC_DEMO_USER_ROLE`.
- **API HTTP status verification** — kept controls return expected statuses; wrong-role returns
  403/forbidden.
- **Dashboard real-data verification** — metrics come from `GET /reports/dashboard`; no static data.
- **`/allocations/auto` remains HTTP 403** `AUTO_ALLOCATION_DISABLED`.
- **No direct financial DML** — confirm no direct `allocation_details` insert, no direct
  `invoices.outstanding` / `receipts.*_amount` update, no protected-record delete.
- **No direct frontend financial-table writes** — grep confirms no `supabase.from(...)` financial
  access; `createClient` only in the auth client.
- **Imports flow still works** — upload/validate/execute/review path intact (no execution against
  production data).
- **Invoices / receipts / reports still load** — no regressions to existing working flows.
- **Batch 8B boundary intact** — Codex confirms RPC-only writes and mutation role guards unchanged.

---

## 13. Evidence requirements

Plan an evidence file: `docs/evidence/BATCH_9A_UI_API_COMPLETENESS_PLACEHOLDER_REMOVAL_EVIDENCE.md`.

It must include:

- Source inventory results (categorized, with `file:line`).
- The UI action completeness matrix (§7).
- The API completeness matrix (§8).
- Placeholders/mocks removed vs intentionally retained (with reasons).
- Role/auth context verification (which endpoint, contract, how UI consumes it; confirmation no
  demo/env role reliance remains).
- Files changed.
- Tests run (typecheck/lint/build, route walkthrough, API status, smoke results).
- Screenshots / manual smoke notes if applicable.
- Safety-boundary verification (`/allocations/auto` 403; no direct financial DML; no frontend
  financial-table writes; Batch 8B boundary intact; no mock dashboard data).
- Final status.

---

## 14. Deployment and production gate

Production deployment must **not** happen until **all** of the following hold:

1. Local checks pass (typecheck/lint/build + smoke).
2. Codex review passes (frontend cleanup + any backend/API/RLS change).
3. Evidence file is written.
4. User approves.
5. Production smoke is **approval-gated** (no production data touched without explicit approval).

Backend-first for any backend change (e.g. `/auth/me`); frontend released only after backend smoke
passes. The standing safety posture (§1) is a release gate — any regression blocks deployment.

---

## 15. Risks and assumptions

**Risks (with mitigations).**

1. **Role context mismatch** — the authenticated role/context shape may differ from current UI
   expectations. _Mitigation:_ Codex confirms the contract in 9A.2 before any UI wiring.
2. **Accidentally hiding valid controls** — over-aggressive hiding could remove legitimate actions.
   _Mitigation:_ every hide/disable decision is recorded in the §7 matrix with rationale and
   smoke-verified.
3. **Breaking demo flows** — cleanup could disrupt the FYP demo path. _Mitigation:_ full route
   walkthrough and existing-flow regression checks in 9A.6 before sign-off.
4. **Treating normal form placeholders as bugs** — input `placeholder` attributes are legitimate.
   _Mitigation:_ inventory classifies benign placeholders explicitly; not removed.
5. **Over-scoping into 9B/9C/9D** — temptation to implement OCR/FX/bank-charge while "cleaning up."
   _Mitigation:_ §4 out-of-scope is binding; such findings are logged for the owning batch, not
   built here.
6. **Touching financial mutation logic unnecessarily** — UI cleanup must not alter financial paths.
   _Mitigation:_ Codex leads anything touching RPC/RLS; 9A defaults to UI-only changes; boundary
   verified intact.

**Assumptions (state; correct if wrong).**

- Existing working flows (invoice/receipt/allocation/import/dashboard) remain functional and are not
  being redesigned — 9A makes them honest/complete, not different.
- A real authenticated role/context source is reachable or can be added safely (9A.2 resolves which).
- The Batch 8B/Fix1 boundary is committed and stable and only needs verification, not change.
- Example file paths in this plan are indicative; exact references are confirmed during 9A.1.

---

## 16. Final recommendation

**Recommended: proceed to implementation only after Codex pre-review PASS of this plan.**

Batch 9A is the correct, lowest-risk first functional batch: it makes the module honest and
demo-safe, closes the most visible Batch 8A audit gaps, and establishes the `/auth/me` authenticated
role context that later batches (reverse/bounce UI, 9D) depend on — all without introducing new
financial mutation surface and while verifying the completed Batch 8B boundary remains intact.

**Recommended next action:** on approval, submit this plan for Codex pre-review. After PASS, begin
with sub-phase **9A.1 (source inventory and matrices)** — read-only — and pause at **9A.2** for
Codex to own/confirm the authenticated role/context contract before any role-gated UI wiring. No
code, migration, deployment, or data change occurs under this plan document itself.
