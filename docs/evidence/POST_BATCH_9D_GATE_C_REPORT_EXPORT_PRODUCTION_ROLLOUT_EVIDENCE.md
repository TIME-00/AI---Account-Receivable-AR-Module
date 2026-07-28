# Post-Batch-9D Gate C Report Export Production Rollout Evidence

## Scope and deployed sources

- Gate C backend commit: `6c7b2585cee4f9a2e6e83d60276767319f6bab51`
- Gate C frontend commit: `f1c15ff0de999aa70b7891ba8d8b59146c1968e4`
- Supabase project: `kusseuycqgdilychphpq`
- Reports Edge Function: version 18, `ACTIVE`
- Reports deployment timestamp: `2026-07-28T13:06:02.143Z`
- Pending-status frontend verification deployment:
  `dpl_6nGhDtBXth5C2dQR7VACiVCiaJkf`
- Deployment URL:
  `https://account-receivable-module-avzq0ym6i-time-00s-projects.vercel.app`
- Canonical Production alias:
  `https://account-receivable-module.vercel.app/`
- Frontend deployment ready at: `2026-07-28T13:39:08.912Z`

The pending-status frontend deployment used the reviewed frontend commit plus
the Production-proven PostgreSQL UUID parser correction recorded in the Gate C
closure commit. The correction accepts canonical PostgreSQL UUID syntax for the
fixed P1 demo company identifier while retaining strict malformed-ID rejection.

## Production export verification

Authenticated, read-only verification used the existing Synthetic/Demo Finance
session through Playwright configuration. No authentication state or credential
content was inspected or logged.

Each route returned HTTP 200 with schema version 1, authenticated company
metadata, matching `row_count` and rows, decimal-string monetary values,
normalized filters and the applied sort:

- `GET /reports/export/aging`
- `GET /reports/export/invoices`
- `GET /reports/export/receipts`
- `GET /reports/export/customer-outstanding`

Only each page's approved date filter parameters were sent. No request included
`page`, `page_size`, `cursor`, `company_id`, `user_id`, client totals or a
request body.

All four reports generated both formats in Production:

- PDF: four of four valid, non-empty `%PDF-` files
- XLSX: four of four valid, non-empty `PK` workbooks
- Desktop Chrome: eight of eight report/format checks passed
- Mobile Chrome: eight of eight report/format checks passed

PDF verification opened every file, extracted its English report heading,
summary and company metadata, and checked any non-ASCII business values present
in the response. XLSX verification reopened every workbook, confirmed the
English `Report`, `Summary` and `Info` sheets, exact data-row count, preserved
Unicode business strings, and zero formula or hyperlink cells.

System-generated report headings, worksheet names, metadata, labels, feedback
and filenames remained English. Unicode business data remains supported without
translation or stripping; the reviewed generator regression suite also covers
Simplified Chinese, Traditional Chinese, Japanese and accented Latin data.

## Browser, security and isolation evidence

- The authenticated Dashboard and affected report pages loaded successfully on
  desktop and mobile Chrome.
- Final complete desktop and mobile export runs had no uncaught page error,
  unexplained console error or unexplained HTTP failure.
- The only permitted Production 404 was the exact optional
  `GET /favicon.ico` request with resource type `other`; the diagnostic
  allow-list remains path, origin, method, status and resource-type specific.
- An unauthenticated export request failed closed with HTTP 401 and the
  sanitized code `AUTHENTICATION_ERROR`.
- The authenticated Finance context succeeded. Cross-company, user-override,
  role and assignment isolation remain covered by the executable backend
  contract suite; no second Production identity or Production data mutation was
  introduced to fabricate additional evidence.
- No response or UI error exposed SQL, schema, stack, service-role or
  credential details.

## Validation and closure

- Gate C focused backend contract tests: 17 passed
- Strict Deno checks for all six Gate C backend files: passed
- Gate C Deno lint: passed
- Next.js 15.5.21 Production build: passed
- Application routes: 27
- Generated static pages: 25
- `npm audit --package-lock-only`: zero vulnerabilities
- `npm audit`: zero vulnerabilities

Report Export is promoted from `Implemented — Pending Deployment` to `Live`
only after the Production checks above. No database migration was created or
applied. No Edge Function other than Reports was deployed; Notifications
remained version 6 `ACTIVE`. No scheduler, cron, secret, Auth, Storage or
Production financial data changed. Gate A and Gate B remained deployed and
closed throughout.
