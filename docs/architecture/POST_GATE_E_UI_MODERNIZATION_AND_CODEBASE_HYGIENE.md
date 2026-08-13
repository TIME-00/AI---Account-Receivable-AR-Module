# Post-Gate-E UI Modernization and Codebase Hygiene

Status: IMPLEMENTED / VALIDATED LOCALLY - PENDING CODEX FINAL REVIEW, MIGRATION AND DEPLOYMENT.

The backend foundation and the frontend modernization are both implemented and validated on a local workstation. Migration 045 has NOT been applied to Production, and the modernized UI is NOT Production-live.

This is a presentation and maintainability change. Gate E and the closed mailbox, FX, and Journal/Audit capabilities remain unchanged.

## Theme preference authority

Theme is an account-level preference, independent of company, role, and financial settings. The supported vocabulary is exactly `dark | light`. When no saved row exists, the authenticated API returns `dark` without creating a database row. An explicit selection is upserted for the authenticated user and follows that account across logout/login and company contexts.

Migration `045_post_gate_e_user_ui_preferences.sql` adds `public.user_ui_preferences`:

| Column | Authority |
|---|---|
| `user_id` | Supabase Auth account UUID and primary key |
| `theme_preference` | constrained to `dark` or `light`; default `dark` |
| `created_at`, `updated_at` | server timestamps; `updated_at` uses the existing trigger helper |

The table deliberately has no `company_id`: theme is personal presentation state, not tenant or financial authority. It also deliberately has no foreign key to `auth.users`, consistent with the repository's deployable public-schema identity model. RLS retains owner-only policies as defense in depth, while direct `PUBLIC`, `anon`, and `authenticated` table privileges are revoked. Only the server-side `service_role` may select/insert/update; delete is not granted.

## Auth Edge contract

The existing `auth` function keeps `GET /auth/me` unchanged and adds:

```text
GET   /auth/ui-preferences
PATCH /auth/ui-preferences
```

`GET` response data:

```json
{ "theme": "dark", "source": "default" }
```

or a saved `dark`/`light` value with `source: "saved"`.

`PATCH` accepts one exact JSON key:

```json
{ "theme": "light" }
```

Unknown fields, query parameters, invalid themes, malformed JSON, and anonymous calls fail closed. The user id is derived exclusively from the verified bearer token; the caller cannot supply another user id. The browser never receives or uses a service-role credential.

The frontend may cache the resolved theme to reduce a first-paint flash, but server state is the cross-session authority. Cache state must never expand the two-value vocabulary or affect authorization.

## Backend cohesion refactor

No financial behavior was redesigned.

- The existing import paths remain stable facades: `automation/service.ts`, `imports/service.ts`, `invoices/service.ts`, `customers/service.ts`, and `automation/dto.ts`. Existing routers and consumers keep importing the same symbols and receive the same DTO/HTTP/business-error contracts.
- Domain layers use one-way inheritance only to preserve the existing service API while moving implementation ownership: router -> stable facade -> domain layer -> base dependencies/database/provider services. Abstract base signatures make cross-domain orchestration explicit; there are no dynamic imports, registries, or circular collaborator imports.
- `automation/authority.ts` owns deterministic provider bounds, OAuth/readiness helpers, exact-decimal automatic-allocation planning, and receipt-to-invoice reference authority. `service-base.ts` owns injected clients/providers and OAuth token readiness. Settings, directory/assignment, mailbox/OAuth, document/command, mailbox sync, reminder, allocation/recovery, and scheduler behavior each have a named service layer.
- Imports are separated into secure file/OCR intake, batch workflow/execution, governed review, row validation, customer/bank/reference resolution, and explicit-reference allocation. The original `ImportService` public surface is preserved by the facade.
- Automation DTOs are separated into common strict primitives/metadata redaction, settings/recovery, directory/mailbox, document/command/exception, reminder/allocation/audit, and collection dispatch modules. `automation/dto.ts` remains the six-line compatibility barrel.
- Invoice ownership is separated into read/FX/reference authority, Draft/line mutation, and lifecycle/post/cancel/read operations. Customer ownership is separated into master-data operations, credit control, and import/master-data resolution helpers. PostgreSQL remains the monetary, posting, journal, allocation, and tenant authority.
- Historical migrations, rollback smoke scripts, vendored SheetJS, lockfiles, and large tests are not production-source refactor targets.

### Production source line-count result

The acceptance inventory counts physical source lines after formatting. All maintainable backend production TypeScript/JavaScript files are below 1,000 lines.

| Original production source | Before | Stable facade | Largest resulting implementation module | Responsibility map |
|---|---:|---:|---:|---|
| `automation/service.ts` | 5,000 at the committed baseline; 4,569 after the preserved first authority extraction | 4 | 856 (`document-service.ts`) | base/OAuth, settings, directory, mailbox, documents/commands, sync, reminders, allocation/recovery, scheduler |
| `imports/service.ts` | 2,970 | 4 | 851 (`review-service.ts`) | base/contracts, intake/OCR, workflow, review, validation, resolution, allocation |
| `automation/dto.ts` | 1,367 | 6 | 411 (`dto/common.ts`) | strict primitives/redaction, settings, directory, documents, reminders, collection dispatch |
| `invoices/service.ts` | 1,247 | 4 | 567 (`lifecycle-service.ts`) | base contract, read/FX authority, Draft/lines, lifecycle |
| `customers/service.ts` | 1,178 | 4 | 693 (`master-service.ts`) | base contract, master data, credit control, resolution/audit helpers |

The largest changed backend production module is 856 lines. A regression test recursively inventories maintainable Edge source and fails if any non-test, non-vendored production source exceeds 1,000 lines. Source-contract regression tests inspect the complete cohesive module family through a test-only compatibility reader, so their security and authority assertions continue to cover the real implementation rather than only a facade.

## Frontend modernization (delivered)

### Design System

Colour is expressed entirely through CSS custom properties declared in `src/app/globals.css`, and `tailwind.config.ts` only *names* them. A utility such as `text-slate-600` therefore resolves to whichever theme is active instead of to a fixed hex.

This matters because of what the codebase already looked like. The product expressed structure through `slate-*` and state through `red/amber/emerald/blue/...`, with roughly 1,400 `text-slate-*`, 350 `border-slate-*`, 280 `bg-slate-*` and 110 `bg-white` occurrences spread over about 200 files - and zero `dark:` variants. Rewriting those call sites would have been a very large, very risky diff across every financial page. Instead the *scales themselves* are tokenised:

- **Structural (`slate`)** - dark uses a hand-tuned graphite ramp running the other way, from a `#0d1424` panel ground up to a cool near-white. `bg-slate-50` is consequently a dark surface in dark and a light surface in light; `text-slate-900` is near-white in dark and near-black in light.
- **Chromatic (`red`, `amber`, `emerald`, `blue`, `purple`, `gray`, `indigo`, `sky`, `orange`, `teal`, `violet`, `green`)** - the tint steps (50-300) are re-blended into the dark ground so `bg-red-50` becomes a dark wash; steps 400/500 stay vivid so status dots and icons keep their identity; steps 600-900 flip to light shades so `text-red-700` stays legible on that wash. The product's `bg-red-50 text-red-700` status idiom therefore inverts correctly with no markup change.
- **Brand** - `brand-600/700` are deliberately *not* part of the reversal. They are dual-role: the filled primary-button surface (carrying white text) and the accent-text colour on dark panels. A pure reversal satisfies the second role and destroys the first, dropping white-on-button contrast to about 2.3:1. Both steps are hand-tuned to a saturated azure clearing AA in both directions.

On top of the ramps sits the semantic layer, defined identically in both themes: `--app-bg`, `--surface{,-elevated,-muted,-glass}`, `--border{,-muted,-strong}`, `--text-{primary,secondary,muted,inverse}`, `--brand{,-hover,-muted,-contrast}`, `--success/--warning/--danger/--info`, `--nav-*`, `--table-*`, `--input-*`, `--focus-ring`, `--scrim{,-alpha}`, `--shadow-{sm,card,elevated}`, `--glow-{brand,subtle}`, and the motion scale `--motion-{fast,normal,slow}` / `--ease-{standard,emphasized,exit}`.

Shared class primitives (`.ds-surface`, `.ds-surface-elevated`, `.ds-surface-muted`, `.ds-glass`, `.ds-scrim`, `.input-premium`, `.chart-container`) plus the `Reveal` and `ThemeToggle` components consume those tokens. `Surface`/`TableShell`/`PageShell`/`PageHeader` React wrappers were built and then deliberately removed: the class primitives already deliver that reuse at every call site, so shipping both would have been the overengineered abstraction this phase was told to avoid - and an unused component is dead code like any other. A regression test keeps them absent. The legacy `.glass-card` helper is retained as an alias because roughly 100 call sites still use it, but it now resolves to tokens instead of hard-coded white.

Recharts is the one place tokens cannot reach, because it writes SVG presentation attributes rather than classes. `src/lib/theme/chart-theme.ts` supplies themed chart *chrome* (grid, axes, tooltip) while keeping series colour theme-independent - an aging bucket or credit rating means the same thing in both themes, and an operator should not have to relearn the palette when switching appearance.

### Dark mode

Deep blue-black graphite foundation (`--app-bg: #070b16`) with layered panels, an inset rim-light hairline that gives panels a machined edge, restrained luminous azure accents, a small glow on the active navigation item and brand marks, and a single static radial wash behind the dashboard metric band. The wash is a plain gradient, not an animated layer, and is dark-only. Depth comes from luminance and rim light rather than drop shadow. Financial values remain the hero: metric tiles stay on the neutral surface in every variant rather than being washed in colour.

### Light mode

Independently designed, not an inversion. A disciplined neutral canvas (`#f6f8fc`) against genuinely white elevated surfaces, a clear three-step border hierarchy, soft tightly-controlled shadows, strong near-black typography, and restrained brand colour. Glow resolves to a crisper ring rather than a halo, and the modal scrim is lighter than in dark because the ground is already light.

### Theme persistence and first paint

Resolution order is: dark always paints first while identity is unresolved; after authentication resolves, that account's keyed cache may accelerate reconciliation; the authenticated server preference supersedes both.

The document is server-rendered with `class="dark"` and the dark tokens are defined on `:root`, so the first paint is dark even with JavaScript disabled - white is never painted. The synchronous `<head>` bootstrap (`src/lib/theme/bootstrap.ts`) enforces Dark and deliberately reads no cache because authenticated account identity is unresolved at that point.

`ThemeProvider` then reconciles against `GET /auth/ui-preferences`. An explicit choice applies immediately for responsiveness and is persisted with `PATCH /auth/ui-preferences`; the resolved value written back is the server's echo, not the optimistic local value. If persistence fails, the theme and the browser cache are rolled back together and an explicit toast is shown - local and server state never disagree, and the failure is never silent.

### Cross-user isolation

A single `localStorage.theme` or global active-user pointer would leak one operator's preference into a later operator's first paint on a shared finance workstation, especially when the first operator closes the browser without logging out. Instead each cached theme is filed only under the account that chose it (`ar.ui.theme.u.<userId>`). No unbound pointer exists. The cache is read only after AuthProvider resolves that exact user id; until then Dark is mandatory. The cache is strictly a paint accelerator with no authorization role, and the authenticated server response remains authoritative.

### Motion

One centralized scale drives everything: `.ds-page-enter` (route content entry, re-keyed on pathname so the shell never re-animates), `.ds-reveal` (section reveal), `.ds-overlay-enter` and `.ds-menu-enter` (dialogs and dropdowns), `.ds-press` (buttons and navigation), `.ds-lift` (cards), and `.ds-brand-edge` (the growing active-navigation indicator). Navigation adds icon scale on hover and a width transition on collapse.

No animation dependency was added - Framer Motion and equivalents are explicitly absent and guarded by test. CSS transitions, CSS keyframes, IntersectionObserver and the existing Radix primitives were sufficient. Only opacity and transform are animated, so work stays on the compositor. An always-on shimmer overlay that previously ran on every KPI card was removed.

### Scroll reveal

`Reveal` / `useReveal` share **one** IntersectionObserver across the whole page, so a hundred sections cost one observer rather than a hundred, and no scroll listener is attached anywhere. Each element reveals once and is then unobserved, so content does not re-animate every time it drifts past the fold. The reveal unit is deliberately coarse - page sections, never individual table rows. Where observation is impossible (no IntersectionObserver, or reduced motion) content renders already-revealed, and a `.no-js` rule guarantees it is never left transparent.

### Accessibility and reduced motion

`prefers-reduced-motion: reduce` removes entry animations, reveal translation, hover lift, press scale and the ambient wash outright rather than shortening them. State remains legible: the active-navigation indicator stays drawn, only its growth animation is dropped. The theme control is a labelled group of real buttons, keyboard operable with no custom key handling, reporting the active theme through `aria-pressed` rather than colour alone, and available in the header on wide viewports and in the account menu on narrow ones. Active navigation carries `aria-current="page"`; the sidebar collapse control is labelled and reports `aria-expanded`.

### Frontend architecture and cleanup

Theme authority is split into `lib/theme/contract.ts` (vocabulary and fail-safe parsing), `lib/theme/storage.ts` (per-account cache), `lib/theme/bootstrap.ts` (first paint and class application), `lib/theme/chart-theme.ts` (chart palette), `hooks/use-theme-preference.ts` (server access), and `providers/theme-provider.tsx` (resolution). Motion is split into `hooks/use-reveal.ts` and `components/ui/reveal.tsx`. No combined theme-and-animation utility module was created; every new module is under 250 lines and single-purpose.

Removed as proven unused (no importer in `src`, `e2e` or configuration): `src/hooks/use-lookups.ts`, `src/components/features/invoices/customer-search-overlay.tsx`, the unadopted `Surface`/`TableShell`/`PageShell`/`PageHeader` wrappers introduced during this phase, the `.card-interactive` and bare `.glass` CSS helpers, and the `shimmer` / `pulseSubtle` Tailwind animations. Tests, Playwright specs, role policy, Journal/Audit read behaviour, historical currency support and Production assets were not touched.

Role-gated navigation is unchanged and is now covered directly: Journal Entries remains visible only to AR Supervisor, Finance Manager and Auditor; Audit Trail only to Finance Manager and Auditor; both stay hidden while the authenticated context is unresolved. Theme is available to every authenticated user independently of AR role.

### Frontend line-count result

No production frontend TypeScript/TSX file exceeds 1,000 lines; the largest is `src/lib/automation/contract.ts` at 995. Near-threshold files were reviewed and left intact where already cohesive rather than split for the sake of a number. A regression test enforces the boundary.

## Repository hygiene classification

| Class | Treatment | Current examples |
|---|---|---|
| A - safe generated cleanup | Remove locally; never commit | `.next/`, `test-results/`, `playwright-report/`, `tsconfig.tsbuildinfo`, debug logs |
| B - engineering quality asset | Retain | Deno/Vitest/Playwright tests, fixtures, contract tests, lint/type/build configuration, rollback smoke SQL |
| C - production runtime required | Retain | Edge source, frontend source/assets, vendored SheetJS runtime, package lockfile |
| D - historical/migration authority | Never rewrite/delete for hygiene | numbered migrations, rollout evidence, runbooks, controlled historical evidence |
| E - user decision | Do not delete automatically | ignored repository ZIP snapshots and `backups/*.sql`; unrelated `Poster/` and `social-media/` |

No `.env`, browser authentication state, provider token, Vault payload, or other secret belongs in source control. Files under `frontend/playwright/.auth/` are locally held test state and must never be read, copied, modified, logged, or committed.

## Production-data cleanup boundary

This phase performs inventory only and no Production deletion. Posted, journaled, allocated, reminded, imported, or automated records are authoritative evidence and are protected. Two current draft Invoices with no observed downstream authority may be candidates for a future separately governed cleanup, but they are not deleted here. The historical Gate E Draft Invoice/Receipt carry Automation evidence and remain protected. Any future cleanup must revalidate current state immediately before mutation, use explicit identifiers, preserve audit requirements, and never treat marker-like names as deletion authority.

## Migration smoke

`045b_post_gate_e_user_ui_preferences_smoke_tests.sql` is rollback-only and must never be entered in the migration ledger. It verifies the constrained default, idempotent saved preference, account isolation, grants/RLS, invalid-value rejection, and zero Invoice/Receipt/Journal/Automation-settings delta before ending with `ROLLBACK`.
