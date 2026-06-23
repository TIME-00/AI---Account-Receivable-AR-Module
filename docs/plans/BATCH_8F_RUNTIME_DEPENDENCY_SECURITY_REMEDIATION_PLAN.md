# Batch 8F Runtime Dependency Security Remediation Plan

## 1. Plan status and hard boundaries

- Plan date: 2026-06-23 (Asia/Kuala_Lumpur).
- Baseline commit: `01a6461027543c31cc0f2da1e2e06b908c183f26`.
- Baseline commit subject: `docs(review): record Batch 8E dependency triage`.
- Local `HEAD` matches `origin/main`.
- Worktree was clean before this plan was created.
- Batch 8D production rollout remains **PAUSED**.
- Batch 8E production blocker remains **YES**.
- Batch 8F-P0 result: **PLAN COMPLETE — IMPLEMENTATION NOT STARTED**.

This document is a plan only. No dependency, source code, package manifest, lockfile, import map, or
runtime configuration has been changed. No package was installed. No `npm install`, `npm update`,
`npm audit fix`, or `npm audit fix --force` command was run. No deployment, migration, staging or
production smoke, fixture, or data mutation was performed.

## 2. Blocker summary

Batch 8E identified two independent production blockers:

1. The public Vercel frontend uses Next.js `15.1.11`, which is affected by critical/high Next.js
   advisories including App Router / React Server Components denial-of-service issues.
2. The imports Edge Function resolves `xlsx` to SheetJS `0.18.5` and directly parses authenticated
   user-supplied XLSX files. Version 0.18.5 is affected by:
   - `GHSA-4r6h-8v6p-xvw6` / `CVE-2023-30533` — prototype pollution;
   - `GHSA-5pgg-2g8v-p4x9` / `CVE-2024-22363` — regular-expression denial of service.

Production rollout remains blocked until both workstreams pass local checks, staging/preview
validation, post-change security audit, and final review.

## 3. Recommended implementation split and order

Split Batch 8F into two separately reviewed implementation batches:

1. **Batch 8F1 — Next.js 15 Runtime Security Remediation**
2. **Batch 8F2 — XLSX Parser Supply-Chain and Runtime Remediation**

Recommended order: **8F1 first, then 8F2**.

Reasons:

- Next.js 15.1.11 is already running on the public Vercel frontend, so reducing that exposure is the
  first priority.
- The Next.js upgrade is a bounded manifest/lockfile change with a clear patched 15.x target.
- XLSX remediation requires a deployment-compatible artifact/provenance decision and potentially
  parser-specific code and tests, so it carries more implementation uncertainty.
- Separate commits and reviews make rollback and fault isolation materially safer.

The coordinated Batch 8D backend production rollout must not be mixed into either remediation
batch.

## 4. Batch 8F1 — Next.js remediation

### 4.1 Current frontend dependency baseline

Current declared packages:

- `next`: `^15.1.11`
- `eslint-config-next`: `15.1.0`
- `react`: `^19.0.0`
- `react-dom`: `^19.0.0`
- `eslint`: `^9.0.0`

Current locked packages:

- Next.js: `15.1.11`
- React / React DOM: `19.2.4`
- eslint-config-next: `15.1.0`
- Next-bundled PostCSS: `8.4.31`

The frontend uses the App Router. No Next.js middleware, custom rewrites, Pages Router i18n,
`next/image`, Cache Components, CSP nonce integration, or WebSocket handling was found.

### 4.2 Target strategy

Primary target:

- `next`: exact `15.5.19`
- `eslint-config-next`: exact `15.5.19`

Read-only npm metadata confirmed:

- 15.5.19 is the newest published stable Next.js 15.x release at planning time;
- it supports Node `^18.18.0 || ^19.8.0 || >=20.0.0`;
- it supports React and React DOM `^19.0.0`;
- eslint-config-next 15.5.19 supports ESLint 9 and the existing TypeScript range.

Do not upgrade to Next.js 16 in Batch 8F1. It is unnecessary to clear the identified Next.js
critical/high advisories and would introduce broader framework and tooling changes.

React and React DOM should remain on their current compatible locked versions unless the lockfile
operation proves a specific security or peer-dependency requirement. Do not bundle unrelated React
or UI-library upgrades into 8F1.

Use exact framework versions rather than caret ranges for the remediated Next.js and
eslint-config-next entries, so the reviewed build and lockfile remain reproducible.

### 4.3 PostCSS and development advisory handling

Next.js 15.5.19 npm metadata still declares nested `postcss@8.4.31`, which is below the patched
version for `GHSA-qx2v-qp2m-jg93`. Therefore:

- do not assume the Next.js upgrade will automatically clear every moderate advisory;
- run the actual production-only audit after lockfile regeneration;
- acceptance for the production blocker is zero critical/high production advisories;
- if the nested PostCSS moderate advisory remains, assess a narrowly scoped npm `overrides`
  resolution to a compatible patched PostCSS version in a separate reviewed substep;
- do not force an override without build and rendering regression tests.

The js-yaml advisory is development-only through ESLint. It may be cleared by the aligned
eslint-config/toolchain lockfile update. If it remains, document it separately; it does not block
production runtime once confirmed absent from `npm audit --omit=dev`.

### 4.4 Expected files

Expected changes:

- `frontend/package.json`
- `frontend/package-lock.json`

Conditional changes only if required by verified tooling behavior:

- ESLint configuration file, if one is introduced to replace or stabilize the existing lint command;
- the `lint` script in `frontend/package.json`, if `next lint` is deprecated or nonfunctional under
  the selected Next.js release.

No application page/component/hook change is expected. If application source changes become
necessary, stop and review the compatibility issue before broadening scope.

### 4.5 Approved dependency operation for implementation

Implementation should use a targeted package-manager command that updates only the intended direct
packages and lockfile, for example:

```text
npm install --save-exact next@15.5.19
npm install --save-dev --save-exact eslint-config-next@15.5.19
```

The exact command must be recorded in evidence. Do not run `npm audit fix`, `npm update`, or a broad
install intended to refresh all declared ranges.

Afterward, inspect `package-lock.json` to confirm unrelated direct dependencies did not move
unexpectedly. Transitive changes required by Next.js/eslint-config-next are acceptable only when
explained by the dependency graph.

### 4.6 Local validation

Required checks:

- `npm audit --omit=dev`
- `npm audit`
- `npm ls next eslint-config-next react react-dom postcss js-yaml`
- `npm run lint`
- `npm run build`
- TypeScript check using the installed compiler, for example `npx tsc --noEmit` with package
  installation disabled or `npm exec tsc -- --noEmit`
- `git diff --check`
- secret/JWT scan over changed files
- generated artifact scan
- inspect package and lockfile diff for unintended upgrades

Acceptance:

- no critical/high production runtime advisory remains;
- Next.js direct advisories identified by Batch 8E are absent;
- build and TypeScript checks pass;
- lint either passes or reports only explicitly reviewed pre-existing findings;
- no application behavior change is introduced.

### 4.7 Preview/staging regression

Use a Vercel preview deployment or equivalent non-production frontend environment. Verify:

- login and logout;
- auth session restoration;
- dashboard render, refresh, scope, and reports API call;
- customer list/detail;
- invoices list/detail/create/import page;
- receipts list/detail/create/import page;
- allocations page and history;
- aging and other reports;
- no browser runtime errors;
- no failed critical network requests;
- no direct browser financial-table access;
- no request to `POST /allocations/auto`;
- existing production backend is not mutated by preview testing.

No production Vercel release occurs in 8F1 without separate approval.

### 4.8 Rollback

- Preserve the pre-upgrade `frontend/package.json` and `frontend/package-lock.json` in Git history.
- If local or preview validation fails, restore both files together from the prior reviewed commit.
- Do not restore only one of the manifest/lockfile pair.
- Remove generated `.next` output before re-validating the restored baseline.
- Do not solve compatibility failures by upgrading to Next.js 16 without a new plan/review.

## 5. Batch 8F2 — XLSX parser remediation options

### 5.1 Current parser behavior

The imports function:

- accepts CSV and XLSX;
- limits XLSX upload size to 10 MB;
- downloads the private uploaded file and passes its complete `ArrayBuffer` to `read()`;
- uses `utils.sheet_to_json`, `SSF.parse_date_code`, and the first workbook sheet;
- supports both invoice and receipt imports;
- has already passed functional CSV/XLSX staging smoke.

The functional parser contract must be preserved unless the chosen fallback deliberately disables
XLSX.

### 5.2 Option comparison

| Option | Security coverage | Supabase/Deno compatibility | Integrity and provenance | Licensing | Complexity | UX effect | Rollout status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A. Direct official SheetJS 0.20.3 URL** | Clears the two known `<0.20.2` / `<0.19.3` findings. | Official SheetJS docs provide a Deno ESM URL, but this repository already experienced Supabase remote-bundling failure against `cdn.sheetjs.com`. Must prove deployment before selection. | Versioned official CDN; Deno lock can record integrity if bundling succeeds. Runtime/build availability still depends on the remote host. | Apache 2.0 with required attribution. | Low code change, medium deployment risk. | No intended UX change. | Acceptable only if isolated Supabase bundle/deploy proof succeeds. Not primary. |
| **B. Vendor official SheetJS 0.20.3 ESM artifact** | Clears the two known parser findings when the official 0.20.3 artifact is used unchanged. | Local module import avoids the prior remote-CDN bundling dependency. Supabase bundles local function files. Must verify module and type imports under Deno Edge runtime. | Download only from authoritative SheetJS CDN/source, record SHA-256, retain artifact/version/license/NOTICE, and review the artifact diff. Git provides content integrity after commit. | Apache 2.0; attribution and license/NOTICE retention required. | Medium; repository size increases and vendor review is required. | No intended UX change. | **Primary recommendation.** |
| **C. Replace with maintained parser** | Depends on selected parser and advisory history; may improve maintainability. | Requires proof of Deno/Supabase compatibility and mapping of workbook/date/cell behavior. | Prefer npm/JSR package with exact version and lock integrity. | Requires separate license review. | High; parser behavior and test surface change. | Potential formatting/date compatibility differences. | Longer-term fallback if SheetJS vendoring is rejected. Not the first implementation. |
| **D. Disable XLSX, retain CSV only** | Removes XLSX parser exposure entirely. | Simplest and most reliable deployment path; SheetJS can be removed from the imports bundle. | Eliminates the third-party XLSX runtime dependency. | No SheetJS redistribution if fully removed. | Low backend complexity, moderate UI/docs/template changes. | Users lose XLSX import and must use CSV. | **Operational fallback** if no safe parser can be deployed promptly. Clears the blocker only when XLSX is actually rejected server-side and removed from the bundle. |

### 5.3 Primary strategy: vendor official SheetJS 0.20.3 ESM

Use Option B as the primary implementation.

Planning requirements:

1. Retrieve `xlsx.mjs` and matching type definitions only from the authoritative versioned SheetJS
   0.20.3 distribution.
2. Record source URLs, retrieval date, SHA-256 hashes, version, and license.
3. Store the minimum required files under a clearly versioned path such as:
   `backend/supabase/functions/imports/vendor/sheetjs-0.20.3/`.
4. Include the Apache-2.0 license and required SheetJS attribution.
5. Point the imports function's `deno.json` mapping or `xlsx.ts` import to the local vendored ESM
   module.
6. Remove the vulnerable 0.18.5 mapping.
7. Reconcile the stale root `import_map.json` SheetJS mapping. Because Supabase recommends
   function-specific `deno.json` and the imports function is the only XLSX consumer, the preferred
   outcome is to remove the global `xlsx` alias rather than maintain two sources.
8. Regenerate and review `backend/supabase/functions/deno.lock` as needed, removing obsolete remote
   SheetJS entries. Local vendored source integrity is provided by Git; remote remaining
   dependencies must stay locked.
9. Preserve the public parser API and normalization behavior in `xlsx.ts`.

Before implementation, confirm the artifact size is acceptable for the repository and Supabase
function bundle. If not, stop and use the fallback decision process.

### 5.4 Fallback strategy: disable XLSX and keep CSV

Use Option D if the vendored official ESM artifact cannot pass local Deno checks, Supabase staging
bundling, license/provenance review, or runtime smoke within the approved scope.

Required behavior:

- backend rejects `file_type=xlsx` before upload/storage processing;
- allowed MIME/types and user-facing validation permit CSV only;
- SheetJS imports and dependency mappings are removed from the deployed function;
- invoice and receipt import pages clearly state CSV-only support;
- masked demo fixture documentation is updated consistently;
- existing historical XLSX import records remain readable; no old records are mutated;
- CSV invoice/receipt import behavior remains unchanged.

Disabling only the frontend file picker is insufficient. Server-side XLSX rejection and removal of
the vulnerable parser from the deployed bundle are mandatory.

### 5.5 Expected files

Primary vendoring path:

- `backend/supabase/functions/imports/deno.json`
- `backend/supabase/functions/imports/xlsx.ts`
- `backend/supabase/functions/import_map.json`
- `backend/supabase/functions/deno.lock`
- new vendored SheetJS ESM/type/license/NOTICE files beneath
  `backend/supabase/functions/imports/vendor/sheetjs-0.20.3/`
- parser security tests under an existing or new imports test location
- Batch 8F2 evidence document

Conditional fallback files if XLSX is disabled:

- `backend/supabase/functions/imports/index.ts`
- `backend/supabase/functions/imports/service.ts`
- `frontend/src/hooks/use-import.ts`
- `frontend/src/app/(dashboard)/invoices/import/page.tsx`
- `frontend/src/app/(dashboard)/receipts/import/page.tsx`
- `docs/demo/fixtures/README.md` and relevant import documentation/templates if wording changes

No database migration or financial RPC change is expected or permitted.

### 5.6 Local validation

Required:

- verify vendored artifact hashes against the recorded authoritative source;
- review license and attribution files;
- `deno check --no-lock --config imports/deno.json imports/index.ts`;
- lock-aware Deno check after the tracked lock is deliberately regenerated;
- Deno checks for invoices, receipts, allocations, customers, and reports because imports bundles
  their services;
- parser unit/fixture checks for valid invoice and receipt XLSX files;
- valid CSV regression;
- malformed/truncated workbook rejection;
- oversized XLSX rejection before parse;
- workbook with no sheet rejection;
- empty/duplicate headers rejection;
- extreme worksheet dimensions / sparse-cell abuse test;
- parser execution-time and memory observation for malicious/degenerate test files;
- `git diff --check`;
- secret/JWT scan;
- generated runtime artifact cleanup;
- confirm no runtime upload files are committed;
- confirm financial RPC files and migrations are unchanged;
- confirm `POST /allocations/auto` remains disabled.

Security tests must use non-sensitive local fixtures specifically created for parser validation.
They must not execute imports against production.

### 5.7 Staging validation

Deploy only the `imports` function to staging after local review.

Required staging smoke:

- imports function is ACTIVE and has no boot error;
- authenticated imports list/read routes return HTTP 200;
- invoice CSV upload/parse/validate/execute creates correct draft lines;
- invoice XLSX upload/parse/validate/execute creates correct draft lines;
- receipt CSV flow works;
- receipt XLSX flow works;
- review queue behavior remains unchanged;
- malformed XLSX returns a controlled validation error and creates no financial record;
- oversized XLSX is rejected;
- cleanup leaves only cancelled/reversed/audit-safe staging records with zero active balance;
- dashboard, reports, invoices, receipts, and allocation history remain readable;
- `POST /allocations/auto` returns HTTP 403 `AUTO_ALLOCATION_DISABLED`.

Use unique staging-only prefixes and remove local generated runtime files afterward. Do not create
or mutate production data.

### 5.8 Rollback

For vendoring:

- restore the prior imports source/config/lockfile as one unit only for local or staging rollback;
- redeploy the previous staging imports version if the new function fails;
- do not deploy the vulnerable 0.18.5 configuration to production;
- retain CSV functionality during rollback.

If no safe XLSX parser is available, roll forward to the CSV-only fallback rather than accepting
the vulnerable parser.

## 6. Production rollout impact and gates

### 6.1 Coordinated Batch 8D rollout

The Batch 8D rollout remains blocked until:

- Batch 8F1 passes and removes all critical/high production Next.js advisories;
- Batch 8F2 passes and removes the vulnerable SheetJS 0.18.5 parser from the imports bundle;
- both implementations pass final review and are committed;
- staging/preview regression evidence is complete;
- Batch 8D readiness is re-evaluated against the new dependency state.

### 6.2 Partial rollout

- Do not partially execute the Batch 8D database/Edge Function rollout before both remediations pass.
- The production `imports` function must not be deployed from the current main branch while it
  resolves SheetJS 0.18.5.
- A separate, explicitly approved Next.js-only security release may be considered after 8F1 passes,
  because it reduces an already-live frontend exposure and does not require the Batch 8D backend
  rollout. It must still receive its own production deployment approval and smoke test.
- No XLSX-related production deployment is safe until 8F2 passes or the CSV-only fallback is
  implemented.

## 7. Evidence and review plan

Create separate evidence files during implementation:

- `docs/evidence/SPRINT_BATCH_8F1_NEXTJS_SECURITY_REMEDIATION_EVIDENCE.md`
- `docs/evidence/SPRINT_BATCH_8F2_XLSX_PARSER_SECURITY_REMEDIATION_EVIDENCE.md`

Each evidence file must record:

- baseline and resulting commit;
- exact dependency/source versions;
- exact commands;
- manifest/lock/vendor files changed;
- advisory results before and after;
- build/type/lint results;
- staging/preview deployment and smoke results;
- rollback readiness;
- no financial RPC or migration change;
- no production action unless separately approved;
- no tokens or secrets written.

After both pass, update or create a Batch 8D rollout addendum confirming the blockers are cleared.

## 8. Implementation acceptance checklist

### Batch 8F1

- [ ] Next.js is exactly the approved patched 15.x version.
- [ ] eslint-config-next is aligned.
- [ ] No Next.js 16 upgrade occurred.
- [ ] Production-only npm audit has zero critical/high findings.
- [ ] Full npm audit findings are classified.
- [ ] Build, TypeScript, and lint checks pass or have reviewed pre-existing-only findings.
- [ ] Vercel preview regression passes.
- [ ] No unrelated frontend dependency or application behavior changed.

### Batch 8F2

- [ ] SheetJS 0.18.5 is absent from the imports dependency graph.
- [ ] The chosen parser source is patched, versioned, attributable, and integrity-verified.
- [ ] Root and function-level dependency configuration are consistent.
- [ ] Supabase staging deployment has no bundling or boot error.
- [ ] CSV and XLSX invoice/receipt staging smoke passes, or CSV-only fallback is fully enforced.
- [ ] Malformed and oversized workbook tests fail safely.
- [ ] Runtime files are removed and no sensitive/generated fixture is committed.
- [ ] No financial RPC, migration, allocation mutation, or auto-allocation behavior changed.

## 9. Final plan recommendation

- Batch 8F-P0 plan result: **PASS**.
- Recommended split: **8F1 Next.js remediation**, followed by **8F2 XLSX parser remediation**.
- Next.js target: exact Next.js `15.5.19` with eslint-config-next `15.5.19`, subject to the
  post-lockfile audit acceptance criteria.
- Primary XLSX strategy: vendor the authoritative official SheetJS `0.20.3` ESM artifact with
  hashes, versioned source, Apache-2.0 attribution, local import, and staging deployment proof.
- XLSX fallback: disable XLSX server-side and preserve CSV-only imports.
- Production rollout gate: Batch 8D remains paused until both blockers are cleared and reviewed.

No dependency change has started. No lockfile or import map changed. No package-management mutation
command was run. No production action was performed.
