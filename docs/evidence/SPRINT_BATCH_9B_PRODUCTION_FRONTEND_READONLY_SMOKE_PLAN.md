# Sprint Batch 9B Production Frontend Read-only Smoke Evidence

## Scope

This document records the approved Batch 9B production frontend read-only smoke execution.

The smoke was limited to production frontend availability and non-mutating frontend verification. It did not test production OCR upload because Batch 9B backend migration/deploy has not been approved for production.

## Baseline

- Latest baseline commit: `a362e08c9ebb6e94d22b8eac8923ca4aa7b2788c`
- Branch: `main`
- Local HEAD matched `origin/main`.
- Worktree was clean before the smoke.
- Batch 9B final closure evidence exists:
  - `docs/evidence/SPRINT_BATCH_9B_FINAL_CLOSURE_EVIDENCE.md`

## Production frontend URL

- `https://account-receivable-module.vercel.app/`

## Allowed actions

- HTTP GET production frontend page checks.
- Read-only browser/manual navigation if a safe approved session is available.
- Read-only page rendering checks.
- Console/network observation if available.
- Read-only API calls caused by normal page rendering.

## Forbidden actions

The following were not allowed and were not performed:

- file upload;
- file selection;
- drag/drop;
- OCR start;
- draft approval;
- import execution;
- invoice creation;
- receipt creation;
- invoice posting;
- receipt allocation;
- production data mutation;
- frontend/backend deployment;
- production migration;
- intentional production OCR route execution;
- `/allocations/auto` call;
- use of real company-sensitive documents.

## Preflight result

Preflight result: PASS.

- Branch was `main`.
- HEAD matched `origin/main`.
- Latest commit was `a362e08c9ebb6e94d22b8eac8923ca4aa7b2788c`.
- Worktree was clean.
- Batch 9B final closure evidence file exists.

## Production frontend HTTP checks

Read-only HTTP GET checks:

| Path | Result |
| --- | --- |
| `/` | HTTP 200, server `Vercel` |
| `/invoices` | HTTP 200, server `Vercel` |
| `/receipts` | HTTP 200, server `Vercel` |
| `/invoices/import` | HTTP 200, server `Vercel` |

Result: PASS.

## Import page deployed chunk inspection

Because the production app is client-rendered and no approved authenticated browser session was available in this environment, the deployed production import-page JavaScript chunk was inspected read-only.

Chunk checked:

- `/_next/static/chunks/app/(dashboard)/invoices/import/page-bbf09745a58645e8.js`

Read-only string verification:

| Check | Result |
| --- | --- |
| CSV / Excel channel string present | PASS |
| PDF / Image OCR channel string present | PASS |
| review/draft safety wording present | PASS |
| "does not post invoices" wording present | PASS |
| "does not allocate receipts" wording present | PASS |
| SVG unsupported wording present | PASS |
| `/allocations/auto` string absent from page chunk | PASS |

The deployed page chunk contains OCR route strings (`/imports/ocr/upload`, `/ocr/start`, `/approve-draft`) because the frontend code includes those actions, but no route was invoked during this read-only smoke.

## Browser/manual UI checks

Interactive authenticated browser checks were not run.

Reason:

- no approved logged-in production browser session or credentials were available to the agent;
- no local browser automation tool was available in the workspace;
- running the smoke without an authenticated session avoids risk of accidental upload/create actions.

Not run:

- dashboard authenticated visual load;
- invoice list authenticated visual load;
- receipt list authenticated visual load;
- manual mode switching in the browser;
- browser network tab observation during authenticated navigation.

This is recorded as a limitation, not a failure of the production frontend HTTP availability check.

## Invoice import UI result

Read-only source/deployed-chunk verification confirms that the Batch 9B production frontend bundle contains:

- CSV / Excel import channel;
- PDF / Image OCR channel;
- OCR review/draft-only safety copy;
- no-posting wording;
- no-receipt-allocation wording;
- SVG unsupported wording.

The previous Codex review already verified from source that CSV/OCR modes are mutually exclusive after Batch 9B-FE-Fix1. This production smoke confirmed the corresponding deployed frontend chunk is present on the production frontend.

## Network and mutation safety observation

Performed:

- HTTP GET page checks only.
- Read-only deployed chunk retrieval only.

Not performed:

- no upload;
- no file selection;
- no OCR start;
- no approve-draft;
- no import batch creation;
- no invoice/receipt creation;
- no posting;
- no allocation;
- no production OCR route invocation;
- no `/allocations/auto` invocation.

No mutation request was intentionally triggered.

## Production backend rollout risk

Important condition:

- Batch 9B backend/API/DB was applied to staging only.
- Production backend Batch 9B OCR migration/deploy has not been approved.
- Production OCR provider remains disabled/unapproved.

Risk:

- The Batch 9B OCR frontend UI is present in the production frontend bundle, but production backend OCR routes may not be deployed yet.
- Users must not use OCR upload in production until a separate production backend rollout is reviewed and approved.

Recommended handling:

1. keep OCR UI unused until production backend rollout is approved; or
2. add a production feature flag / disabled state in a future fix; or
3. approve a separate production backend rollout later.

No fix, deployment, migration, upload, or backend rollout was performed during this smoke.

## Screenshots

No screenshots were captured or committed.

Reason:

- avoiding accidental exposure of production business/customer/financial data.

## Safety confirmations

- No production upload occurred.
- No production import batch was created.
- No production invoice was created.
- No production receipt was created.
- No production data was mutated.
- No production OCR route was intentionally called.
- No production OCR provider was called.
- No production backend deployment occurred.
- No production migration occurred.
- No staging data action occurred.
- No `/allocations/auto` request was made or changed.
- No `ar.*` schema was used.
- No tokens, JWTs, cookies, passwords, or secrets were written to this evidence.

## Final verdict

Final verdict: PASS WITH CONDITIONS.

Condition:

- authenticated/manual browser UI verification was not run because no approved logged-in production browser session or browser automation facility was available.

The read-only production frontend HTTP checks passed, and the deployed import-page bundle contains the expected Batch 9B OCR UI/safety copy.
