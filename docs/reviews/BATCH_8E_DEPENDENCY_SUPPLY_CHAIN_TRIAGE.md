# Batch 8E Dependency and Supply-Chain Security Triage

## 1. Scope and result

- Review date: 2026-06-23 (Asia/Kuala_Lumpur).
- Commit reviewed: `74c3710151578dfa140e52e035a759cbfcad439d`.
- Commit subject: `docs(review): record Batch 8D production rollout readiness`.
- Review mode: read-only dependency and supply-chain triage.
- Batch 8E result: **BLOCKS PRODUCTION ROLLOUT**.
- Recommended disposition: **NEEDS SEPARATE FIX BATCH**.

The coordinated Batch 8D production rollout should pause until the direct Next.js runtime and
SheetJS upload-parser findings are remediated and staging-regression tested.

No dependency was changed. No lockfile was modified. No package was installed. No `npm audit fix`,
`npm audit fix --force`, `npm update`, or dependency upgrade was run. No production action,
deployment, migration, smoke, fixture, or data mutation was performed.

## 2. Repository and dependency baseline

Local `HEAD` and `origin/main` both matched the reviewed commit, and the worktree was clean before
this review.

Dependency files reviewed:

| File | Role |
| --- | --- |
| `frontend/package.json` | Frontend direct runtime and development dependencies. |
| `frontend/package-lock.json` | npm lockfile version 3; 643 locked package entries. |
| `backend/supabase/functions/package.json` | Metadata only; no npm dependency declarations. |
| `backend/supabase/functions/deno.json` | Root Deno configuration using `import_map.json`. |
| `backend/supabase/functions/import_map.json` | Shared Supabase JS and legacy SheetJS import mappings. |
| `backend/supabase/functions/imports/deno.json` | Imports-function override for Supabase JS and SheetJS. |
| `backend/supabase/functions/deno.lock` | Tracked remote dependency integrity/version lock. |

Relevant resolved versions:

- Next.js: `15.1.11`, direct production dependency.
- React / React DOM: `19.2.4`, direct production dependencies.
- Supabase JS: `2.100.1`, frontend production dependency and resolved Deno remote dependency.
- Next-bundled PostCSS: `8.4.31`, transitive production dependency.
- js-yaml: `4.1.1`, transitive development dependency through ESLint.
- Imports-function SheetJS: `xlsx@0.18.5` through
  `https://esm.sh/xlsx@0.18.5?target=deno`.

The shared root import map still names SheetJS `0.20.3`, but the deployed `imports` function has a
function-level Deno configuration that overrides it with `0.18.5`. The function-level mapping is
the relevant parser dependency for production import deployment.

## 3. Read-only commands run

Commands included:

- `git status --short --untracked-files=all`
- `git rev-parse HEAD`
- `git rev-parse origin/main`
- `git diff --check`
- dependency manifest/lockfile inventory with `rg --files`
- `npm ls --depth=0`
- `npm audit --json`
- `npm audit --json --omit=dev`
- `npm audit --omit=dev`
- `npm outdated --long`
- `npm explain js-yaml`
- `npm explain postcss`
- `npm explain next`
- `deno info --no-lock --config imports/deno.json imports/index.ts`
- source searches for middleware, App Router, image optimization, rewrites, CSP nonces,
  `beforeInteractive`, Cache Components, WebSockets, i18n, file upload, and XLSX parsing
- dependency-file SHA-256 and Git status checks

Temporary npm audit JSON was written only beneath the operating-system temporary directory and was
deleted immediately after parsing. No workspace artifact was created.

## 4. Vulnerability count

The 22 GitHub/Dependabot alerts reconcile exactly to individual advisories returned by npm:

| Severity | GitHub/npm advisories |
| --- | ---: |
| Critical | 1 |
| High | 6 |
| Moderate | 12 |
| Low | 3 |
| **Total** | **22** |

`npm audit` aggregates those 22 advisories into three vulnerable package nodes:

- `next`: direct production dependency, aggregate severity critical;
- `postcss`: transitive production dependency under Next.js, moderate;
- `js-yaml`: transitive development dependency under ESLint, moderate.

Production-only `npm audit --omit=dev` reports two vulnerable package nodes: `next` and its
transitive `postcss`.

The npm/Dependabot count does **not** include Deno remote imports. Two additional high-severity
SheetJS advisories apply to `xlsx@0.18.5`. The combined triage therefore covers 24 known advisories:
1 critical, 8 high, 12 moderate, and 3 low.

## 5. Application architecture relevant to reachability

Frontend:

- The application uses the Next.js App Router under `frontend/src/app`.
- Most pages and the dashboard layout are client components.
- No Next.js middleware file was found.
- No custom rewrites, redirects, WebSocket handling, Pages Router i18n, Cache Components, CSP nonce
  usage, `next/script` `beforeInteractive`, or `next/image` usage was found.
- `next.config.ts` has `images.remotePatterns: []`.
- Production is hosted on Vercel.
- Authentication rendering/redirect logic is client-side, while financial authorization remains in
  Supabase Edge Functions and database policies.

Backend import path:

- Authenticated users can upload CSV/XLSX through the `imports` Edge Function.
- XLSX files up to 10 MB are accepted.
- `parseXlsx()` passes the complete untrusted workbook buffer to SheetJS `read()`.
- This is a direct parser path for user-supplied files, so SheetJS parser vulnerabilities are
  reachable by an authenticated import user.

## 6. GitHub/npm advisory triage

| Advisory | Package | Severity | Dependency / affected path | Reachability in this module | Fix and recommendation |
| --- | --- | --- | --- | --- | --- |
| `GHSA-3h52-269p-cp9r` | Next.js | Low | Direct production package; development server | Development-only. Production uses Vercel, not `next dev`. | Upgrade with Next.js remediation; does not independently block. |
| `GHSA-g5qg-72qw-gw5v` | Next.js | Moderate | Direct production package; image optimizer cache | No `next/image` use and remote patterns are empty. Low observed reachability. | Upgrade with Next.js remediation. |
| `GHSA-xv57-4mr9-wg8v` | Next.js | Moderate | Direct production package; image optimization | No `next/image` use found. Low observed reachability. | Upgrade with Next.js remediation. |
| `GHSA-4342-x723-ch2f` | Next.js | Moderate | Direct production package; middleware redirect SSRF | No middleware or custom redirect/rewrites found. Not currently observed as reachable. | Upgrade with Next.js remediation. |
| `GHSA-9g9p-9gw9-jx7f` | Next.js | Moderate | Direct production package; self-hosted image optimizer | Vercel-hosted, no image use, and no remote patterns. Low observed reachability. | Upgrade with Next.js remediation. |
| `GHSA-h25m-26qc-wcjf` | Next.js | High | Direct production package; React Server Components/App Router | **Potential production runtime exposure.** The application uses App Router on an affected version. No explicit Server Actions were found, which reduces but does not conclusively remove framework-generated RSC exposure. Crafted unauthenticated requests can cause CPU, memory, or process exhaustion on affected endpoints. | **Production blocker.** Upgrade to a fully patched supported Next.js 15 release and regression test. |
| `GHSA-f82v-jwr5-mffw` | Next.js | Critical | Direct production package; middleware authorization | No middleware authorization exists, and the advisory states Vercel-hosted deployments are automatically protected. Not directly reachable in the current design. | Upgrade regardless; not the deciding blocker by itself. |
| `GHSA-ggv3-7p47-pfv8` | Next.js | Moderate | Direct production package; rewrite request smuggling | No custom rewrites found. Low observed reachability. | Upgrade with Next.js remediation. |
| `GHSA-3x4c-7xq6-9pq8` | Next.js | Moderate | Direct production package; image cache storage exhaustion | No `next/image` use; Vercel manages hosting storage. Low observed reachability. | Upgrade with Next.js remediation. |
| `GHSA-q4gf-8mx6-v5v3` | Next.js | High | Direct production package; App Router/RSC | **Potential production runtime exposure.** A crafted request to an affected App Router Server Function endpoint can consume excessive CPU. Next.js 15.1.11 is below patched 15.5.15. | **Production blocker.** Upgrade to at least the newest patched 15.x release, not merely 15.5.15. |
| `GHSA-8h8q-6873-q5fj` | Next.js | High | Direct production package; App Router/RSC | **Potential production runtime exposure.** Similar unauthenticated RSC deserialization DoS. Next.js 15.1.11 is below patched 15.5.16. | **Production blocker.** Upgrade to the current patched 15.x release. |
| `GHSA-3g8h-86w9-wvmq` | Next.js | Low | Direct production package; middleware/proxy redirect cache poisoning | No middleware/proxy route found. Low observed reachability. | Upgrade with Next.js remediation. |
| `GHSA-ffhc-5mcf-pf4q` | Next.js | Moderate | Direct production package; App Router CSP nonce XSS | No CSP nonce use found. Not currently observed as reachable. | Upgrade with Next.js remediation. |
| `GHSA-vfv6-92ff-j949` | Next.js | Low | Direct production package; RSC cache-busting collision | App Router is used, but no application cache customization was found. Potential framework exposure is low but not disproven. | Upgrade with Next.js remediation. |
| `GHSA-gx5p-jg67-6x7h` | Next.js | Moderate | Direct production package; `beforeInteractive` script XSS | No `next/script` or `beforeInteractive` use found. Not currently observed as reachable. | Upgrade with Next.js remediation. |
| `GHSA-mg66-mrh9-m8jx` | Next.js | High | Direct production package; Cache Components connection exhaustion | No Cache Components configuration or `"use cache"` use found. Not currently observed as reachable. | Upgrade with Next.js remediation; high severity but not the deciding blocker. |
| `GHSA-h64f-5h5j-jqjh` | Next.js | Moderate | Direct production package; image optimization DoS | No `next/image` use found. Low observed reachability. | Upgrade with Next.js remediation. |
| `GHSA-c4j6-fc7j-m34r` | Next.js | High | Direct production package; self-hosted WebSocket upgrade SSRF | Advisory states Vercel-hosted deployments are not affected; no WebSocket handling was found. | Upgrade with Next.js remediation; not directly applicable to current hosting. |
| `GHSA-wfc6-r584-vfw7` | Next.js | Moderate | Direct production package; RSC response cache poisoning | App Router is used. No custom RSC caching was found, but framework-level exposure cannot be fully excluded by source search. | Upgrade with Next.js remediation. |
| `GHSA-36qx-fr4f-26g5` | Next.js | High | Direct production package; Pages Router i18n middleware bypass | No Pages Router, i18n configuration, or middleware found. Not currently observed as reachable. | Upgrade with Next.js remediation; not directly applicable to current routes. |
| `GHSA-qx2v-qp2m-jg93` | PostCSS | Moderate | Transitive production dependency: `next@15.1.11 -> postcss@8.4.31` | No untrusted CSS input or runtime CSS-stringification path was found. Primary exposure is framework/build processing. | Upgrade Next.js so its nested PostCSS resolves to a patched version. |
| `GHSA-h67p-54hq-rp68` | js-yaml | Moderate | Transitive development dependency: ESLint -> `@eslint/eslintrc` -> `js-yaml@4.1.1` | Development/lint tooling only; absent from `npm audit --omit=dev`. No production runtime exposure. | Fix in the dependency-remediation batch through a reviewed toolchain/lockfile update. |

## 7. Additional Deno/SheetJS findings

These findings are not included in the 22 npm/Dependabot alerts because SheetJS is loaded through a
Deno remote import rather than `frontend/package-lock.json`.

| Advisory | Package | Severity | Reachability | Fix and recommendation |
| --- | --- | --- | --- | --- |
| `GHSA-4r6h-8v6p-xvw6` / `CVE-2023-30533` | `xlsx@0.18.5` | High | **Directly reachable.** The imports Edge Function reads authenticated user-supplied XLSX files with `read(buffer)`. The affected range is `<0.19.3`; workflows reading arbitrary files are explicitly affected. | **Production blocker.** Replace 0.18.5 with a deployable patched SheetJS release or a maintained alternative. GitHub notes patched SheetJS releases are not available from the stale npm package. |
| `GHSA-5pgg-2g8v-p4x9` / `CVE-2024-22363` | `xlsx@0.18.5` | High | **Directly reachable.** Crafted XLSX content can trigger parser ReDoS. The affected range is `<0.20.2`; the upload route accepts files up to 10 MB and parsing occurs in the Edge Function. | **Production blocker.** Use SheetJS 0.20.2 or newer from a verified source, vendor a reviewed build with integrity controls, or replace the parser. |

The current `esm.sh/xlsx@0.18.5` mapping was introduced to solve Supabase bundling/runtime
compatibility and passed functional XLSX smoke. Functional success does not mitigate the known
parser vulnerabilities.

The root import map's `cdn.sheetjs.com` 0.20.3 entry is not sufficient because:

- the imports function overrides it with 0.18.5;
- the SheetJS CDN source previously failed Supabase remote bundling;
- dependency provenance, integrity locking, and deployability must be solved together rather than
  switching URLs without validation.

## 8. Supabase JS and other backend remote dependencies

- npm audit reported no advisory for `@supabase/supabase-js@2.100.1`.
- Deno resolves the shared `@supabase/supabase-js@2` import to 2.100.1 in the tracked lockfile.
- The import-map specifier is a floating major (`@2`) even though the current lock resolves it.
- No known critical/high Supabase JS issue was identified by the audit data used in this review.
- A remediation batch should still consider exact-version pinning and confirm that every function
  uses the tracked lock consistently, but this is supply-chain reproducibility hardening rather
  than the current production blocker.

CSV parsing is implemented locally in `backend/supabase/functions/imports/csv.ts`; no third-party
CSV parser dependency was identified.

## 9. Production blocker assessment

### Critical/high runtime exposure

The critical Next.js middleware bypass is not directly applicable because:

- the repository has no Next.js middleware authorization;
- the deployment is Vercel-hosted, which the advisory states is protected.

Production rollout is nevertheless blocked by:

1. direct use of vulnerable Next.js 15.1.11 with multiple App Router/RSC denial-of-service
   advisories that cannot be conclusively excluded from the public framework runtime; and
2. direct parsing of untrusted XLSX uploads with SheetJS 0.18.5, which is inside the affected range
   for high-severity prototype-pollution and ReDoS advisories.

The SheetJS issue is especially relevant to Batch 8D because the planned production rollout
includes redeploying `imports` with the 0.18.5 dependency mapping. That would knowingly deploy the
vulnerable parser configuration.

### Decision

**Production blocker: YES.**

Do not proceed with the coordinated Batch 8D production rollout until the direct runtime blockers
are fixed and staging validated, unless the user explicitly accepts the documented security risk
through a separate decision. Risk acceptance is not recommended while patched Next.js 15.x
versions exist and the XLSX parser processes user-supplied files.

## 10. Recommended next batch

Create **Batch 8F - Runtime Dependency Security Remediation** with two controlled workstreams.

### 10.1 Next.js remediation

- Upgrade Next.js from 15.1.11 to the latest patched 15.x release. At triage time npm reports
  15.5.19 as the wanted 15.x version.
- Align `eslint-config-next` where required.
- Do not move to Next.js 16 as part of the minimal security fix unless compatibility analysis
  requires it.
- Regenerate the npm lockfile only through the reviewed package-manager operation.
- Re-run `npm audit --omit=dev`, full `npm audit`, build, login, dashboard, import UI, and Vercel
  staging/preview smoke.
- Confirm the RSC, middleware, image, PostCSS, and related Next.js advisories are absent from the
  resulting audit.

### 10.2 XLSX parser remediation

- Remove `esm.sh/xlsx@0.18.5`.
- Select one reviewed option:
  - a deployment-compatible SheetJS 0.20.2+ build from the official SheetJS distribution with
    verified integrity/provenance;
  - a vendored and reviewed official ESM artifact where licensing and repository size are
    acceptable; or
  - a maintained XLSX parser replacement after compatibility review.
- Reconcile or remove the conflicting root and function-level SheetJS mappings.
- Add parser abuse tests for malformed workbooks, resource exhaustion, oversized dimensions,
  repeated aliases/structures where applicable, and time/memory limits.
- Preserve the existing 10 MB upload limit, but do not treat file size alone as a ReDoS mitigation.
- Re-run invoice and receipt CSV/XLSX import staging smoke and cleanup.

### 10.3 Secondary remediation

- Resolve the nested PostCSS advisory through the Next.js upgrade.
- Resolve the development-only js-yaml advisory through a reviewed ESLint/toolchain lockfile
  update.
- Pin Supabase JS remote imports to an exact reviewed version and ensure Deno lock coverage is
  consistent across function-level configs.

Do not use an unreviewed `npm audit fix --force`; it can introduce broad dependency and framework
changes unrelated to the minimal security remediation.

## 11. Final recommendation

- Batch 8E triage result: **BLOCKS PRODUCTION ROLLOUT**.
- GitHub/npm alerts: 22 total — 1 critical, 6 high, 12 moderate, 3 low.
- Additional Deno remote dependency findings: 2 high-severity SheetJS advisories.
- Production blocker: **YES**.
- Required next action: complete and staging-validate Batch 8F before resuming Batch 8D production
  rollout.

No dependency changes were made. No package or lockfile changed. No `npm audit fix` was run. No
production action, deployment, migration, smoke, fixture, or data mutation was performed.
