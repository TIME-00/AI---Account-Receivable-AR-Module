# Sprint Batch 9B-PROD-FE-STATUS — Mark PDF/Image Import Live

## Objective

The Batch 9B production backend rollout is complete: production now supports PDF/Image
Import intake (invoice import only, review/draft-only, no OCR provider). The frontend
Settings → Feature Status table still listed **PDF/Image Import** as
`Planned (Batch 9B)`, which is now stale. Update that single status label to reflect the
feature's true production state (`Live`).

This is a **frontend copy/status polish only**. No backend code, database schema,
migration, deployment, or data action is involved.

- Baseline commit: `81068c93adca50d30cadf78af2309f2916a20445` (origin/main)
- Production rollout verdict: `PASS WITH SYNTHETIC METADATA RETAINED`
- Production `imports` Edge Function: ACTIVE v21

## File changed

| File | Change |
| --- | --- |
| `frontend/src/app/(dashboard)/settings/page.tsx` | Feature Status row "PDF/Image Import" status `Planned (Batch 9B)` → `Live`, restyled with the shared live/success style (`bg-emerald-50 text-emerald-700`). |
| `docs/evidence/SPRINT_BATCH_9B_PROD_FE_STATUS_EVIDENCE.md` | This evidence file (new). |

## Before / after status label

| Surface | Before | After |
| --- | --- | --- |
| Settings → Feature Status → "PDF/Image Import" | `Planned (Batch 9B)` (`bg-slate-50 text-slate-500`) | `Live` (`bg-emerald-50 text-emerald-700`) |

No other feature rows changed. Receipts import copy is untouched — receipts still state
PDF/Image import is not available for receipts (PDF/Image Import is invoice import only).

## Checks run

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS (exit 0) |
| `npm run build` | PASS (exit 0, 25 routes) |
| `git diff --check` | PASS (only benign LF→CRLF notices) |
| User-facing `OCR` reintroduced | NONE (no visible "OCR", "OCR provider", "AI OCR", "automatic extraction") |
| `NEXT_PUBLIC_*OCR` key | NONE |
| `/allocations/auto` call added | NONE |
| `auto-post` / `auto allocate` added | NONE |
| Dashboard mock / static data added | NONE (Feature Status table is a pre-existing static reference list; no new mock data) |
| Secrets / JWTs | NONE |
| Mojibake / encoding | clean |

## Safety confirmations

- Production backend rollout completed (imports Edge Function ACTIVE v21; synthetic smoke
  passed; PDF/PNG/JPG/JPEG/WebP uploads HTTP 201; rejection + review/draft-only flows
  passed).
- Frontend copy/status only; no backend code, database schema, migration, or deployment
  changed.
- No production or staging data action; no file uploads performed.
- No OCR provider enabled; no OCR provider key added.
- No `/allocations/auto` call added (remains backend-disabled, HTTP 403
  `AUTO_ALLOCATION_DISABLED`).
- No auto-posting; no receipt allocation logic or wording.
- PDF/Image import remains **review/draft-only** and **invoice import only**.
- Receipts import behavior unchanged.
- No `ar.*` schema referenced.

## Result

Batch 9B-PROD-FE-STATUS result: PASS. Ready for Codex review.
