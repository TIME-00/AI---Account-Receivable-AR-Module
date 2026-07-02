# Batch 9B — PDF/Image/OCR Import Intake — Plan Review Evidence

Status: **GATE 2 COMPLETE — verdict `PASS WITH CONDITIONS`.** Conditions locked into the plan
(§18) and mirrored as a checklist below (§12). Gates 3–7 remain to be completed after user approval.
This file records the planning-phase review only. No implementation, deployment, migration, or
staging/production data action has been performed or is permitted here.

- Plan document under review: `docs/plans/BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_PLAN.md`
- Baseline commit: `9a2279d737747abce473990d4990cc3b64a29699` (origin/main)
- Supabase staging ref: `gcdsdyegwjdcskpukqlq`
- Supabase production ref: `kusseuycqgdilychphpq`
- Production frontend: `https://account-receivable-module.vercel.app/`

---

## 1. Scope

Batch 9B adds a **secure PDF/Image/OCR intake and extraction layer** in front of the existing AR
import-draft workflow, for invoices and receipts. OCR output is untrusted suggestion data that must be
human-reviewed and promoted through **existing approved APIs/RPCs** before any financial mutation.

In scope (planning): file intake, provider-agnostic OCR abstraction, security/privacy controls,
auditability, review queue + approval flow, financial-correctness boundaries, staging-first rollout.

Out of scope: direct financial posting/allocation from OCR, re-enabling `/allocations/auto`, direct
protected-field mutation, production sensitive uploads, model training on company documents, public
file access, client-side provider secrets, replacing CSV/XLSX import, dashboard mocks.

---

## 2. Safety Boundaries (must remain true through every gate)

- [ ] `/allocations/auto` remains HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- [ ] No direct insert into `allocation_details`.
- [ ] No direct update of `invoices.outstanding`.
- [ ] No direct update of `receipts.allocated_amount` / `receipts.unallocated_amount`.
- [ ] No direct delete of protected financial records.
- [ ] No bypass of financial RPCs (posting/allocation only via approved APIs/RPCs).
- [ ] OCR path writes only staging/review structures; promotion uses existing import-draft flow.
- [ ] No dashboard mock data reintroduced.
- [ ] Role-based UI driven by real `/auth/me` capabilities, not demo/env assumptions.
- [ ] Private storage only (`ar-imports`, `public = FALSE`); no public file URLs.
- [ ] No client-side OCR provider secrets.
- [ ] Public schema only; no `ar.*`.

---

## 3. Baseline Verification (Codex to confirm before proposing schema)

| Item | Expected baseline | Codex verified? | Notes |
| --- | --- | --- | --- |
| `import_files` table + `ocr_result JSONB` reserved | Exists (008) | ✅ | Extend, do not duplicate |
| `import_batches.file_type` allows `csv`/`xlsx`/`pdf`/`image` | Yes (008 CHECK) | ✅ | |
| `import_files.file_type` allows `csv`/`xlsx`/`pdf`/`image` | Yes (008 CHECK) | ✅ | |
| `ar-imports` private bucket | Exists, `public = FALSE`, 20 MB | ✅ | MIME whitelist currently CSV/XLSX/plain-text only (post-009) |
| Storage RLS tenant-scoped by first folder / `company_id` | Yes (008) | ✅ | No storage UPDATE/DELETE policies defined |
| Current imports runtime path | CSV/XLSX only | ✅ | PDF/image not yet accepted at runtime |
| Import RLS roles (Clerk/Supervisor/FM insert; Auditor read) | Yes (008) | ✅ | |
| Financial mutation boundary | Hardened (015) | ✅ | Must stay intact |
| `/allocations/auto` disabled | 403 `AUTO_ALLOCATION_DISABLED` | ✅ | Hard-coded disabled |
| No `ar.*` schema proposed | public schema only | ✅ | |

---

## 4. Provider Risk Decision

| Field | Value (to be completed) |
| --- | --- |
| Provider category chosen | ☐ local / ☐ cloud / ☐ hybrid / ☐ OCR-disabled-first |
| Provider name | _TBD_ |
| Data residency confirmed | ☐ |
| No-retention confirmed | ☐ |
| No-training-on-our-data confirmed | ☐ |
| Encryption in transit + at rest | ☐ |
| Keys stored backend-only (no `NEXT_PUBLIC_*`) | ☐ |
| Disable switch available | ☐ |
| Staging-only + synthetic docs first | ☐ |

Decision summary: _TBD at Gate 2/3._

---

## 5. RLS / Security Review (Codex)

- [ ] Tenant-scoped SELECT/INSERT/UPDATE on all new/extended OCR tables.
- [ ] Role-aware access (upload/review/approve) matches the Batch 9A role model.
- [ ] No cross-tenant file or OCR-result access (RLS + signed-URL issue-time tenant check).
- [ ] Signed URLs short-lived; no public URLs.
- [ ] MIME + magic-number + extension validation planned.
- [ ] Malware/scan gate before OCR planned.
- [ ] Audit tables append-only where feasible.
- [ ] Financial mutation boundary and RPC-only posting confirmed intact.

Findings: _TBD._

---

## 6. Staging Smoke Result (Gate 5 — after approval only)

| Check | Result |
| --- | --- |
| Upload valid PDF | ☐ |
| Upload valid image | ☐ |
| Reject unsupported extension | ☐ |
| Reject MIME/magic-number mismatch | ☐ |
| Reject oversized file | ☐ |
| Malware/quarantine simulation | ☐ (if scanner available) |
| Cross-tenant file/OCR access denied | ☐ |
| OCR creates review item only | ☐ |
| Low-confidence requires review | ☐ |
| Approval creates draft import only | ☐ |
| `/allocations/auto` → 403 | ☐ |
| No direct protected-field mutation | ☐ |
| Audit trail written (upload/OCR/review/approve/reject) | ☐ |
| Retention/deletion behavior (if implemented) | ☐ |
| Dashboard real-data only | ☐ |

---

## 7. Production Readiness Gate (Gate 6/7 — after approval only)

- [ ] Read-only production deployment checks defined.
- [ ] Edge Function active versions verified.
- [ ] Frontend build verified.
- [ ] API health verified.
- [ ] `/allocations/auto` remains 403 in production.
- [ ] No production upload/import/create-record smoke unless explicitly approved.
- [ ] OCR disabled-by-default in production until explicitly enabled (recommended).

---

## 8. `/allocations/auto` Verification

- Planning stance: remains disabled; not enabled by Batch 9B.
- Staging smoke (Gate 5): must return HTTP 403 `AUTO_ALLOCATION_DISABLED`.
- Production smoke (Gate 7): must return HTTP 403 `AUTO_ALLOCATION_DISABLED`.

Result: _TBD._

---

## 9. No-Direct-Financial-Mutation Verification

- [ ] Source/schema review confirms OCR path never writes `allocation_details`,
      `invoices.outstanding`, `receipts.allocated_amount`, or `receipts.unallocated_amount`.
- [ ] All posting/allocation continues through existing approved APIs/RPCs.

Result: _TBD._

---

## 10. Worktree / Commit Summary

| Item | Value |
| --- | --- |
| Gate | 2 (Codex Review — verdict PASS WITH CONDITIONS; conditions locked) |
| Files created (Gate 1) | `docs/plans/BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_PLAN.md`, `docs/evidence/SPRINT_BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_PLAN_REVIEW.md` |
| Files modified (Gate 2 revision) | Both files above (added plan §18 conditions; added evidence §12 + baseline confirmations) |
| Code changed | None (documentation only) |
| Migrations added | None |
| Edge Functions changed | None |
| Deployment performed | None |
| Production/staging data touched | None |
| Worktree status | to be confirmed at commit time (currently uncommitted docs only) |

---

## 11. Open Questions (carried from plan §16)

1. OCR provider category preference?
2. File retention period (original vs raw OCR text vs reviewed values)?
3. Maximum file size?
4. Invoices first, receipts first, or both?
5. Multi-page PDF in first implementation?
6. Which roles approve low-confidence results?
7. Real company documents in staging, or synthetic only?
8. Original files deletable after review, and by which role?
9. Raw OCR text retained after approval, and for how long?
10. OCR disabled by default in production until explicitly enabled?

---

## 12. Gate 2 Codex Review Conditions

**Codex Gate 2 verdict: `PASS WITH CONDITIONS`.** All conditions below are locked into the plan at
`docs/plans/BATCH_9B_PDF_IMAGE_OCR_IMPORT_INTAKE_PLAN.md` §18. "Revised into plan?" confirms each
condition was written into the plan during this documentation revision.

| # | Condition | Revised into plan? | Plan ref |
| --- | --- | --- | --- |
| 1 | **SVG excluded from v1** — raster only (PNG/JPEG/JPG/WebP); reject SVG, double extensions, MIME/extension mismatch, unsupported types; SVG needs separate security review | ✅ Yes | §18.1 |
| 2 | **Production OCR disabled by default** — no prod provider keys until approval; separate provider/legal/data-residency gate; prod smoke read-only; no prod create-record OCR test unless approved | ✅ Yes | §18.2 |
| 3 | **Staging synthetic documents only** — no real company-sensitive docs unless approved; synthetic files carry no real financial data; fixtures committable only if no secrets/real/sensitive data | ✅ Yes | §18.3 |
| 4 | **Reuse-first table disposition** — §6 names are candidates only; verify schema again before migration; extend existing tables before adding new; avoid duplicate lifecycle tables (per-table dispositions) | ✅ Yes | §18.4 |
| 5 | **Signed URL tenant/role check** — verify tenant + role at request time; not RLS-only; service-role in Edge Functions still applies explicit tenant checks | ✅ Yes | §18.5 |
| 6 | **Malware/file-scan gate before OCR** — scan/validate before OCR; failures → rejected/quarantined; no OCR on quarantined/rejected/unsupported/oversized/MIME-spoofed/failed-scan files; conservative fallback + residual-risk note if scanner unavailable in v1 | ✅ Yes | §18.6 |
| 7 | **Raw OCR retention limit** — time-limited; delete/redact/minimize raw OCR after review + expiry; hashes/metadata/reviewed values/audit diffs may persist longer; originals follow retention policy (originals 7–30d; raw OCR shorter; metadata/audit longer) | ✅ Yes | §18.7 |
| 8 | **v1 implementation recommendation** — abstraction + manual fallback first; prod OCR off; staging synthetic; backend-only keys; cloud only after residency approval; invoice OCR first; receipts later; multi-page PDF capped or deferred; low-confidence approval requires Supervisor/Finance Manager | ✅ Yes | §18.8 |
| 9 | **Testing additions** — cross-tenant signed-URL/OCR-result denial; unsupported/MIME-spoof/oversized/double-extension/SVG rejection; malware/quarantine sim; OCR review/draft only; low-confidence not auto-promoted; `/allocations/auto` 403; no direct protected DML; no prod create-record test unless approved | ✅ Yes | §18.9, §11 |

### Gate 2 safety attestations

- [x] Codex Gate 2 verdict recorded: **PASS WITH CONDITIONS**.
- [x] All conditions integrated into the plan (§18) and mirrored here.
- [x] **No implementation** was performed (documentation only).
- [x] **No deployment** was performed.
- [x] **No migration** was created or applied.
- [x] **No staging or production data action** was performed.
- [x] `/allocations/auto` remains disabled by plan requirement (HTTP 403 `AUTO_ALLOCATION_DISABLED`).
- [x] **No `ar.*` schema** proposed; public schema only.

---

_This template is completed progressively as Batch 9B advances through its gates. Gate 1 records the
plan; Gate 2 records the Codex review verdict and locked conditions; Gates 3–7 are filled in only
after explicit user approval._
