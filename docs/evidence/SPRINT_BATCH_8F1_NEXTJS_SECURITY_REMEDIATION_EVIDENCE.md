# Sprint Batch 8F1 Next.js Security Remediation Evidence

## 1. Scope and result

- Date: 2026-06-23 (Asia/Kuala_Lumpur).
- Baseline commit: `d9c7ef4ca12751ecdc4a5d688c97efd324ca358d`.
- Baseline subject: `docs(plan): add Batch 8F runtime dependency remediation plan`.
- Batch: 8F1 — Next.js 15 Runtime Security Remediation.
- Result: **PASS WITH DOCUMENTED LINT-TOOLING LIMITATION**.
- Production rollout remains **PAUSED** pending Batch 8F2 XLSX parser remediation and final review.

Only the approved frontend framework dependencies were updated. No application source, backend
function, database migration, financial RPC, SheetJS/XLSX dependency, or production environment was
changed.

## 2. Version changes

| Dependency | Before | After | Classification |
| --- | --- | --- | --- |
| `next` | declared `^15.1.11`, locked `15.1.11` | declared and locked exactly `15.5.19` | Approved direct production dependency update |
| `eslint-config-next` | declared and locked `15.1.0` | declared and locked exactly `15.5.19` | Approved aligned development dependency update |
| `react` | declared `^19.0.0`, locked `19.2.4` | unchanged | No intentional upgrade |
| `react-dom` | declared `^19.0.0`, locked `19.2.4` | unchanged | No intentional upgrade |

Next.js 16 was not installed or introduced.

## 3. Commands run

Baseline/read-only commands:

```text
git status --short --untracked-files=all
git rev-parse HEAD
git rev-parse origin/main
git diff --check
npm ls next eslint-config-next react react-dom postcss js-yaml
npm audit --json
npm audit --json --omit=dev
```

Approved targeted dependency changes:

```text
npm install --save-exact next@15.5.19
npm install --save-dev --save-exact eslint-config-next@15.5.19
```

Validation:

```text
npm audit --json --omit=dev
npm audit --json
npm ls next eslint-config-next react react-dom postcss js-yaml --depth=2
npm run build
npm run lint
npm exec tsc -- --noEmit
git diff --check
```

No `npm audit fix`, `npm audit fix --force`, `npm update`, or unrelated package install was run.

## 4. Files changed

- `frontend/package.json`
- `frontend/package-lock.json`
- `docs/evidence/SPRINT_BATCH_8F1_NEXTJS_SECURITY_REMEDIATION_EVIDENCE.md`

No frontend application page, component, hook, provider, store, or library source file changed.

## 5. Dependency diff

Direct dependency changes are limited to:

- `next` -> exact `15.5.19`;
- `eslint-config-next` -> exact `15.5.19`.

The lockfile changed transitively as required by those packages:

- Next.js environment and SWC platform packages moved to 15.5.19;
- `@next/eslint-plugin-next` moved to 15.5.19;
- Next.js optional Sharp/image packages moved from the 0.33.x / libvips 1.0.x line to the
  0.34.x / libvips 1.2.x line;
- obsolete Next.js transitive packages such as `busboy`, `streamsearch`, and older Sharp color
  helpers were removed;
- additional optional native platform packages required by the newer Sharp release were added.

These are framework-controlled transitive changes. No unrelated direct dependency version changed.

## 6. Security audit

### Before

`npm audit --omit=dev`:

- package nodes: 2;
- critical: 1;
- high: 0;
- moderate: 1;
- low: 0.

The critical aggregate node was the direct Next.js 15.1.11 dependency containing the Batch 8E
critical/high Next.js advisories.

Full `npm audit`:

- package nodes: 3;
- critical: 1;
- high: 0;
- moderate: 2;
- low: 0.

### After

`npm audit --omit=dev`:

- package nodes: 2;
- critical: 0;
- high: 0;
- moderate: 2;
- low: 0.

The remaining production advisory is the transitive Next.js-bundled
`postcss@8.4.31` `GHSA-qx2v-qp2m-jg93` moderate advisory. npm reports it both as the vulnerable
`postcss` node and as an aggregate `next` node; this is one underlying advisory, not two separate
critical/high findings.

Full `npm audit`:

- package nodes: 3;
- critical: 0;
- high: 0;
- moderate: 3;
- low: 0.

The additional full-tree advisory is development-only `js-yaml@4.1.1`
`GHSA-h67p-54hq-rp68` through ESLint.

Result:

- all Batch 8E Next.js critical/high production runtime advisories are absent;
- no critical/high production advisory remains;
- two underlying moderate advisories remain: production-transitive PostCSS and development-only
  js-yaml;
- no audit fix was applied.

## 7. Build, lint, and TypeScript

### Production build

`npm run build`: **PASS**

- Next.js reported version 15.5.19.
- Production compilation succeeded.
- Integrated lint/type validity stage completed.
- All 23 application routes were generated successfully.

### TypeScript

`npm exec tsc -- --noEmit`: **PASS**

An initial invocation was run concurrently with `next build` and encountered transient missing
`.next/types` files while Next.js regenerated that directory. The command was rerun after the build
completed and passed with exit code 0. This was validation-command interference, not an application
type error.

### Lint

`npm run lint`: **NOT EXECUTABLE NON-INTERACTIVELY WITH CURRENT REPOSITORY CONFIGURATION**

The script still runs `next lint`. Next.js 15.5.19 reports that `next lint` is deprecated and, because
the repository has no ESLint configuration file, opens an interactive prompt asking to create one.
The command stopped before linting source.

No lint script or ESLint configuration was changed because Batch 8F1 required reporting this
condition before expanding scope. This is a tooling/configuration limitation, not a discovered
application lint failure. The successful Next.js production build and standalone TypeScript check
remain the executable code-quality validations for this batch.

A separate, explicitly approved tooling follow-up may migrate the script to the ESLint CLI and add
a reviewed configuration.

## 8. Repository safety checks

- `git diff --check`: PASS.
- Only the two approved frontend dependency files and this evidence file changed.
- `.next/` remained ignored and untracked.
- `tsconfig.tsbuildinfo` remained ignored and untracked.
- No npm debug log was generated or tracked.
- Secret/JWT scan: PASS.
- No generated CSV/XLSX/runtime fixture was added.
- Backend Supabase dependency/config files remained unchanged:
  - `backend/supabase/functions/package.json`;
  - `backend/supabase/functions/deno.json`;
  - `backend/supabase/functions/import_map.json`;
  - `backend/supabase/functions/imports/deno.json`;
  - `backend/supabase/functions/deno.lock`.
- `database/007_financial_rpcs.sql` remained unchanged.
- Migration 015 and 015b remained unchanged.
- No backend Supabase function source changed.
- `POST /allocations/auto` remains hard-coded disabled.

## 9. Safety confirmations

- No Next.js 16 upgrade occurred.
- No SheetJS/XLSX dependency or parser change occurred.
- No backend dependency or Edge Function changed.
- No database, migration, RLS policy, or financial RPC business logic changed.
- No production or staging deployment occurred.
- No staging or production smoke was run.
- No fixture was executed.
- No user, customer, invoice, receipt, allocation, or other financial record was created or
  mutated.
- No token or secret value was printed or written to evidence.
- No commit or push was performed.

## 10. Remaining work and readiness

Batch 8F1 satisfies the runtime-security acceptance criteria:

- Next.js is exactly 15.5.19;
- eslint-config-next is exactly 15.5.19;
- no critical/high production npm advisory remains;
- build passes;
- TypeScript passes;
- dependency changes are restricted to the approved scope.

The remaining moderate PostCSS and development-only js-yaml findings should be reviewed separately
without using automatic audit fixes. The lint command requires an explicitly approved tooling
configuration follow-up.

Batch 8F1 is ready for final review before commit. Production rollout remains paused because Batch
8F2 XLSX parser remediation is still required.
