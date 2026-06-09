# AR Module — Complete Functional Prototype with Smart Automation / FYP-Ready Plan

**Date**: 2026-06-09 (revised)  
**Author**: Claude (GenAI-assisted development)  
**Status**: 🟢 Codex-approved — Awaiting user approval for Batch 1  
**Audit Source**: Codex full repository technical audit (2026-06-09)  
**Codex Plan Reviews**: 3 reviews completed — approved with minor changes (all corrections applied)  
**Scope**: Complete AR Functional Prototype with Smart Automation / FYP-Ready

---

## 1. Executive Summary

### Project Vision

This AR module is a **Complete AR Functional Prototype with Smart Automation** — a system that demonstrates real AR functions, correct financial behavior, backend APIs, and intelligent automation value for FYP demonstration and controlled client testing.

It is not a fake demo. It is not a minimal CRUD prototype. It is not a full enterprise production deployment. It is a functional prototype with visible smart automation value.

### What Makes This More Than a Basic AR Module

| Layer | Basic AR Module | This Project (Smart Automation) |
|-------|----------------|--------------------------------|
| Invoice/Receipt CRUD | ✅ | ✅ |
| Financial posting via RPCs | ✅ | ✅ |
| CSV/Excel import | ✅ | ✅ |
| Customer auto-creation during import | — | ✅ Implemented (Phase C/D) |
| Receipt auto-post and exact-reference allocation | — | ✅ Implemented (Phase E) |
| Allocation history visibility | — | ✅ Implemented (Phase F) |
| **One receipt → multiple invoices (atomic)** | — | 🟡 Planned (Batch 3) |
| **Overpayment / unapplied cash handling** | — | 🟡 Planned (Batch 4) |
| **Discount handling via existing RPC** | — | 🟡 Planned (Batch 4) |
| **Bank charge detection and classification** | — | 🟡 Planned (Batch 4 — reviewed adjustment) |
| **Fuzzy matching engine with confidence scoring** | — | 🟡 Planned (Batch 5) |
| **Controlled auto-post (exact match first)** | — | 🟡 Planned (Batch 5) |
| **PDF / Image / OCR import with review screen** | — | 🟡 Planned (Batch 5) |

### Audit Findings Summary

Codex full technical audit identified 10 findings: 4 High (AR Clerk scope gaps, non-atomic JE/cancel flows), 5 Medium (exposed auto-allocation, demo bank account, hidden filtering, missing endpoints, import hardening), 1 Low (documentation drift).

### Current System State

- ✅ P0/P1 financial RPCs verified.
- ✅ Sprint F4 import automation production verified.
- ✅ Allocation history display production verified.
- ⚠️ AR Clerk read-scope gaps (invoices, reports).
- ⚠️ `POST /allocations/auto` route exposed.
- ⚠️ Non-atomic cancel/JE flows (service-layer, not RPC).
- 🟡 Smart automation features not yet implemented.

---

## 2. Scope Definition

### What This System Is

> A **Complete AR Functional Prototype with Smart Automation** that demonstrates:
> - Full accounts receivable lifecycle (invoice → receipt → allocation → reporting).
> - Smart import automation (CSV/Excel/future OCR with customer auto-creation).
> - Intelligent multi-invoice allocation with overpayment and discount handling.
> - Fuzzy matching with confidence scoring and explainable suggestions.
> - Controlled auto-posting with conservative safety rules and draft fallback.
> - Correct financial behavior enforced through verified RPCs and service logic.
> - Enterprise-grade security patterns (tenant isolation, role-based access, hidden customer filtering).

### What This System Is Not

- Not a fake demo with mock data.
- Not a minimal CRUD prototype.
- Not a full enterprise production deployment requiring regulatory compliance certification.
- Not a system that needs full bank charge GL account mapping, complete audit framework, or production-grade OCR ML pipeline.

---

## 3. Safety Rules

> [!CAUTION]
> **The following rules are inviolable. Every batch must comply.**

### Financial Mutation Safety

| Rule | Detail |
|------|--------|
| **Never directly INSERT into `allocation_details`** | Use `allocate_receipt` RPC / `AllocationService.manualAllocate()` |
| **Never directly UPDATE `invoices.outstanding`** | Managed by RPCs (`post_invoice`, `allocate_receipt`, `reverse_allocation`) |
| **Never directly UPDATE `receipts.allocated_amount` or `unallocated_amount`** | Managed by `allocate_receipt` and `reverse_allocation` RPCs |
| **Use `post_invoice` / `InvoiceService.postInvoice()`** | For posting invoices |
| **Use `post_receipt` / `ReceiptService.postReceipt()`** | For posting receipts |
| **Use `allocate_receipt` / `AllocationService.manualAllocate()`** | For all allocations — including multi-invoice |
| **Use `reverse_allocation` RPC** | For allocation reversals |
| **Use `handle_bounced_cheque` RPC** | For bounced cheques |
| **New cancel/clearance RPCs must reuse `reverse_journal_entry` semantics** | No duplicate reversal logic |

### Multi-Invoice Allocation Safety

> [!IMPORTANT]
> The existing `AllocationService.manualAllocate()` already accepts an `allocations[]` array. The existing `allocate_receipt` RPC already supports `p_allocations JSONB` array.
>
> **One receipt → multiple invoices must use ONE atomic `manualAllocate()` / `allocate_receipt` call with multiple allocation rows.**
>
> - Do NOT implement multi-invoice allocation as independent per-invoice commits.
> - Do NOT loop with separate RPC calls per invoice.
> - If `POST /allocations/multi` is added, it must call `manualAllocate()` once with all rows.
> - If validation fails for any row, the entire allocation request is rejected (no partial commit).

### Overpayment Safety

> [!WARNING]
> - Do NOT silently cap explicit user-entered allocation amounts.
> - If a user/import explicitly tries to allocate more than invoice outstanding, **reject or require explicit user confirmation**.
> - Auto-suggestion may propose capping to invoice outstanding, but the user must confirm.
> - `invoice.outstanding` must **never** become negative.
> - `receipt.allocated_amount` must **never** exceed `receipt.receipt_amount`.

### Discount vs. Bank Charge

> [!WARNING]
> Bank charge and discount are **not the same accounting event**.
>
> - **Discount**: handled via existing `allocate_receipt` RPC `p_discount_amount` parameter. Can be automated earlier.
> - **Bank charge**: requires separate adjustment design and possibly GL/account mapping. Should be detected and classified, but automatic posting requires configuration/review or documented as later hardening unless GL mapping is clearly designed.
> - Do NOT silently absorb payment differences.
> - Do NOT treat bank charges as discounts automatically.

### Auto-Posting Safety

| Rule | Detail |
|------|--------|
| **Auto-post is OFF by default** | Must be explicitly enabled per import batch |
| **Exact matches only by default** | Only exact customer + exact invoice matches are eligible |
| **High-confidence fuzzy matches require explicit setting** | User must opt in; preferably with review |
| **OCR-derived rows must NEVER auto-post without human review** | Always create as Draft / Pending Review |
| **If any validation fails → Draft / Pending Review** | Never force incorrect posting |
| **Auto-post uses verified RPCs** | `postReceipt()`, `postInvoice()`, `manualAllocate()` |

### Invoice Cancellation Rules

- Status must be **Open** (not Draft, Posted, Partially Paid, Fully Paid, or Cancelled).
- **No active allocations** against the invoice.
- `outstanding` must equal `total_amount` (nothing has been paid).

### Cheque Payment Method

> [!NOTE]
> When referring to cheque payment method in code or RPC logic, use the actual schema code `CHQ`, not the word "Cheque". For example: `payment_method = 'CHQ'`.

### Tenant Isolation

| Rule | Detail |
|------|--------|
| **Enforce `auth.companyId` server-side** | Every query, every endpoint |
| **AR Clerk sees only assigned customers** | Via `getCustomerAccessFilter(auth)` |
| **Hidden/deleted customers excluded from all reads** | Service-layer filtering |
| **Hidden/deleted customer check before all mutations** | Guard on `postReceipt`, `cancelInvoice`, `cancelReceipt`, `clearCheque`, draft update/delete |
| **Role whitelist on all endpoints** | Server-side checking |

---

## 4. Smart Automation Result Fields

For import, matching, and automation results, the following fields should be available per row/document:

| Field | Type | Purpose |
|-------|------|---------|
| `match_confidence` | `number` (0–100) | Fuzzy matching confidence score |
| `match_explanation` | `string` | Human-readable match reason |
| `allocation_suggestion` | `object[]` | Proposed allocations with amounts |
| `unapplied_amount` | `number` | Remaining receipt amount after all allocations |
| `overpayment_detected` | `boolean` | Whether receipt > sum of matched invoice outstanding |
| `overpayment_action` | `string` | 'capped' / 'rejected' / 'user_review' |
| `auto_post_eligible` | `boolean` | Whether row passes all auto-post safety conditions |
| `auto_post_block_reason` | `string \| null` | Why auto-post was blocked |
| `review_required` | `boolean` | Whether human review is needed |
| `document_status` / `row_status` | `string` | 'Draft' / 'Pending Review' / 'Posted' / 'Allocated' / 'Error' |
| `discount_amount` | `number` | Detected/applied discount amount |
| `bank_charge_detected` | `boolean` | Whether a bank charge difference was detected |
| `bank_charge_amount` | `number` | Detected bank charge amount (requires review) |

---

## 5. Implementation Batches

### Safe Phase Ordering

The following order ensures each batch builds safely on verified foundations:

```
1. Access control and exposed route fixes
2. Backend/API completeness for visible UI
3. Hidden/deleted mutation guards
4. Multi-invoice allocation using existing RPC array support
5. Overpayment/unapplied cash display and safe allocation proposal
6. Discount handling using existing discount_amount
7. Bank charge/adjustment only after GL/accounting design
8. Fuzzy matching read-only suggestions
9. Controlled auto-post only after exact/high-confidence rules are tested
10. OCR import with review screen before any auto-post behavior
```

---

### Batch 1 — Access Control and Demo Safety

**Category**: Must Have  
**Goal**: Close access control gaps and disable unsafe routes.

| ID | Issue | Owner |
|----|-------|-------|
| REM-001 | Add `getCustomerAccessFilter(auth)` to `listInvoices()` for AR Clerk | Codex |
| REM-002 | Add `getCustomerAccessFilter(auth)` to `getAgingSummary()` and `getDashboardSummary()` for AR Clerk | Codex |
| REM-005 | Disable `POST /allocations/auto` route — return 403 (does NOT affect `POST /allocations/manual` or Phase E import allocation via `manualAllocate()`) | Codex |
| REM-010 | Reconcile Phase C/D/E/F evidence files with production state | Claude |

**Smoke tests**:
- AR Clerk `GET /invoices` returns only assigned customer invoices.
- AR Clerk dashboard/aging shows only assigned customer data.
- `POST /allocations/auto` returns 403.
- `POST /allocations/manual` still works (regression).
- Phase E import auto-allocation (via `manualAllocate()`) still works (regression).

**Acceptance criteria**:
- [ ] AR Clerk invoice list scoped to assigned customers.
- [ ] AR Clerk reports scoped to assigned customers.
- [ ] `POST /allocations/auto` returns 403.
- [ ] Manual allocation unchanged.
- [ ] Import allocation unchanged.
- [ ] Evidence files reconciled.
- [ ] `deno check` passes.
- [ ] `npm.cmd run build` passes.

---

### Batch 2 — Backend/API Completeness and Mutation Guards

**Category**: Must Have  
**Goal**: Ensure all visible frontend functions have backend support. Add mutation guards.

| ID | Issue | Owner |
|----|-------|-------|
| REM-006 | Add read-only `GET /bank-accounts` (company-scoped, active only, role-checked) | Codex |
| REM-006b | Replace `NEXT_PUBLIC_DEMO_BANK_ACCOUNT_ID` with real bank account selector in receipt form | Claude |
| REM-008 | Implement `GET /allocations/:id` or remove route declaration | Codex |
| REM-015 | Add hidden/deleted customer guards to `postReceipt`, `cancelInvoice`, `cancelReceipt`, `clearCheque`, draft update/delete | Codex |
| REM-011 | Replace journal entry page placeholder with real data | Claude + Codex |

**Acceptance criteria**:
- [ ] `GET /bank-accounts` returns company-scoped active bank accounts.
- [ ] Receipt form uses real selector.
- [ ] `GET /allocations/:id` returns detail or route removed.
- [ ] Mutations against hidden/deleted customers return clear error.
- [ ] Journal entry page shows real data.
- [ ] `deno check` and `npm.cmd run build` pass.

---

### Batch 3 — Multi-Invoice Allocation

**Category**: Must Have (Smart Automation)  
**Goal**: Enable one receipt to allocate to multiple invoices in one atomic operation.

| ID | Issue | Owner |
|----|-------|-------|
| REM-022 | Multi-invoice allocation via existing `manualAllocate()` with `allocations[]` array | Codex (backend) + Claude (frontend) |

**Backend design**:
- Use existing `AllocationService.manualAllocate()` which already accepts `allocations[]`.
- Use existing `allocate_receipt` RPC which already supports `p_allocations JSONB` array.
- One call, one transaction, multiple allocation rows.
- If validation fails for any row → entire request rejected (no partial commit).
- If `POST /allocations/multi` is added, it must still call `manualAllocate()` once.
- Over-allocation rejected: `sum(allocation_amounts) > receipt.unallocated_amount` → error.

**Frontend design**:
- Allocation Wizard: add multi-invoice selection mode.
- Show available invoices for the selected customer with checkboxes.
- Per-invoice amount input (default: invoice outstanding or remaining receipt unallocated).
- Running total: allocated so far vs. receipt unallocated.
- Submit sends one request with all allocation rows.
- Result screen shows per-invoice allocation status.

**Acceptance criteria**:
- [ ] One receipt allocated to 3 invoices in one request.
- [ ] No partial commit if validation fails.
- [ ] Over-allocation rejected (`sum > unallocated`).
- [ ] Each invoice status updates correctly (Open → Partially Paid / Fully Paid).
- [ ] Receipt status updates correctly (Unallocated → Partially Allocated / Fully Allocated).
- [ ] All allocations visible in allocation history.
- [ ] `allocate_receipt` RPC used (not direct INSERT).

---

### Batch 4 — Overpayment, Discount, and Bank Charge Handling

**Category**: Must Have (overpayment, discount) / Should Have (bank charge)  
**Goal**: Handle payment differences safely and transparently.

| ID | Issue | Owner |
|----|-------|-------|
| REM-023 | Overpayment / unapplied cash handling | Codex + Claude |
| REM-024a | Discount handling via existing `p_discount_amount` | Codex + Claude |
| REM-024b | Bank charge detection and classification (reviewed adjustment) | Codex + Claude |

**Overpayment design (REM-023)**:
- If user/import explicitly allocates more than invoice outstanding → **reject or require explicit confirmation**.
- Do NOT silently cap explicit user-entered amounts.
- Auto-suggestion may propose: cap allocation to outstanding, remaining as unapplied cash.
- Backend/import result must include: `unapplied_amount`, `overpayment_detected`, `overpayment_action`, block reason.
- `invoice.outstanding` must never become negative.
- `receipt.allocated_amount` must never exceed `receipt.receipt_amount`.
- Receipt stays `Partially Allocated` if `unallocated_amount > 0`.
- UI clearly shows unapplied amount with label ("Unapplied Cash" / "Available for Allocation").

**Discount design (REM-024a)**:
- Existing `allocate_receipt` RPC supports `p_discount_amount`.
- When payment received is slightly less than invoice outstanding and the difference is within tolerance (e.g., ≤ 2% or configurable), suggest applying as discount.
- User confirms or modifies.
- Allocation completes with `allocated_amount + discount_amount = invoice.outstanding`.
- Invoice becomes Fully Paid.
- Discount JE created by the RPC.

**Bank charge design (REM-024b)**:
- Detect difference that does not match discount pattern.
- Classify as bank charge.
- Bank charge requires GL/account mapping to post correctly.
- For FYP prototype: detect and display, but **automatic bank charge posting requires configuration/review** or is documented as later hardening unless GL mapping is clearly designed.
- Do NOT silently absorb. Do NOT treat as discount automatically.

**Acceptance criteria**:
- [ ] Overpayment: $1000 receipt against $800 invoice → allocates $800, $200 unapplied, UI shows clearly.
- [ ] Over-allocation: explicit $900 allocation against $800 outstanding → rejected with clear error.
- [ ] Discount: $990 receipt against $1000 invoice, $10 within tolerance → suggest as discount, user confirms, invoice Fully Paid.
- [ ] Bank charge: detected and classified, not silently absorbed, requires review before posting.
- [ ] No negative outstanding on any invoice.
- [ ] `allocate_receipt` RPC used for all allocations.

---

### Batch 5 — Fuzzy Matching, Controlled Auto-Post, and OCR Import

**Category**: Must Have (fuzzy matching, auto-post) / Should Have (OCR)  
**Goal**: Add intelligent matching, safe auto-posting, and PDF/image import with review.

| ID | Issue | Owner |
|----|-------|-------|
| REM-025 | Read-only fuzzy matching service with confidence/explanations | Codex + Claude |
| REM-026 | Controlled auto-post (exact match first) | Codex + Claude |
| REM-027 | PDF / Image / OCR import with mandatory review screen | Codex + Claude |

**Fuzzy matching design (REM-025)**:
- New `MatchingService.findMatches(auth, criteria)` — read-only, no mutations.
- Matching criteria: invoice number, customer name, registration number, payment reference, amount, date, customer code.
- Confidence levels:
  - **Exact** (100%): eligible for auto-action.
  - **High** (80–99%): eligible with explicit opt-in.
  - **Medium** (50–79%): requires user review.
  - **Low** (20–49%): requires user review.
  - **Unmatched** (< 20%): manual entry required.
- Returns: `matchType`, `matchedEntityId`, `confidence`, `explanation`.
- All matching runs server-side.
- Never auto-commit low/medium confidence matches.

**Review queue UI**:
- Import preview shows match results per row.
- Color-coded confidence badges (green/yellow/red/grey).
- Expandable match explanation.
- Medium/low matches have "Confirm" / "Reject" / "Manual Select" actions.
- Only confirmed matches proceed to allocation.

**Controlled auto-post design (REM-026)**:
- Auto-post is **OFF by default**.
- Default eligible level: **exact match only**.
- High-confidence fuzzy matches require explicit setting by user and preferably review.
- OCR-derived rows **NEVER auto-post** without human review.
- All safety conditions must pass (see §3).
- If any condition fails → `Draft` / `Pending Review` with `auto_post_block_reason`.
- Auto-post uses `postReceipt()`, `postInvoice()`, `manualAllocate()` via service layer.

**OCR import design (REM-027)**:
- Upload PDF or image files (PNG, JPG, TIFF).
- OCR extracts: customer name, registration number, invoice number, receipt/payment reference, amount, date, bank account, remarks.
- OCR results go into **mandatory review screen** — never directly posted.
- User corrects any incorrect OCR values.
- After review, corrected data enters normal import flow (validation → matching → draft/post).
- File validation: size limits, format checks, page count limits.
- Per-field confidence indicators.
- OCR output is untrusted data until human-reviewed.

**Acceptance criteria**:
- [ ] Exact invoice number match returns 100% confidence.
- [ ] Similar customer name (e.g., "ABC Sdn Bhd" vs "ABC SDN BHD") returns high confidence.
- [ ] Unrelated data returns < 20%.
- [ ] Medium/low matches require user review — not auto-allocated.
- [ ] Match explanations visible in UI.
- [ ] No financial mutation during matching phase.
- [ ] Auto-post OFF by default; only exact matches eligible by default.
- [ ] Auto-post blocked rows become Draft with clear reason.
- [ ] OCR rows always enter review screen before any financial action.
- [ ] PDF upload extracts key fields for clean documents.
- [ ] Corrected OCR data processed through normal import flow.
- [ ] `allocate_receipt` RPC used for any resulting allocations.

---

### Batch 6 — Testing, Evidence, and FYP Documentation

**Category**: Must Have  
**Goal**: Comprehensive testing, evidence, and FYP documentation.

**Smoke tests per batch**:

| Batch | Tests |
|-------|-------|
| 1 | AR Clerk scope, auto-allocation route disabled, manual allocation regression |
| 2 | Bank account API, mutation guards for hidden customers, JE page |
| 3 | Multi-invoice allocation (1→3), over-allocation rejection, status updates |
| 4 | Overpayment display, discount application, bank charge detection |
| 5 | Fuzzy matching confidence, review queue, auto-post exact only, OCR review screen |

**Regression tests (run after every batch)**:

| Test | Expected |
|------|----------|
| `deno check` on all Edge Functions | No type errors |
| `npm.cmd run build` | No TypeScript errors |
| Invoice CRUD + post + cancel | Unchanged behavior |
| Receipt CRUD + post + cancel + bounce | Unchanged behavior |
| Manual single-invoice allocation + reversal | Unchanged behavior |
| CSV/XLSX invoice/receipt import | Unchanged behavior |
| Phase E auto-post + exact-reference allocation | Unchanged behavior |
| Allocation history read | Unchanged behavior |

**Evidence documents to create/update per batch**:

| Batch | Evidence Document |
|-------|-------------------|
| 1 | Access control fix verification summary |
| 2 | API completeness and mutation guard verification |
| 3 | Multi-invoice allocation verification |
| 4 | Overpayment and discount handling verification |
| 5 | Fuzzy matching and auto-post verification |
| Final | Complete FYP evidence compilation |

**FYP appendix documents**:

| Document | Contents |
|----------|----------|
| System architecture | Tech stack, component diagram, data flow |
| GenAI development workflow | Claude + Codex roles, plan-review-implement cycle |
| Security approach | RLS, tenant isolation, role-based access, hidden customer filtering |
| Smart automation design | Fuzzy matching, confidence scoring, auto-post rules |
| Client testing guide | How to test, what to test, known limitations |

---

### Future Enterprise Enhancements (Document Only)

These items are documented as future work in the FYP report. NOT required for submission.

| Enhancement | Description |
|-------------|-------------|
| Full transactional accounting RPC redesign | Standalone `create_journal_entry` RPC, complete JE atomicity for all flows |
| Complete cheque clearance hardening | Full `clear_cheque` RPC with idempotency if not used in demo |
| Full bank charge GL/account mapping and auto-posting | Production bank charge posting with configured GL accounts |
| RLS-level hidden customer filtering | Database-enforced visibility beyond service-layer |
| Enterprise import hardening | MIME sniffing, dedup, malware scanning |
| Production OCR ML pipeline | Multi-language, handwriting, high-accuracy extraction |
| Credit note / debit note full workflow | Complete credit note lifecycle |
| Audit log, settings, role management | Full admin UI |
| Advanced concurrency/idempotency | Row-level locking at scale, retry-safe operations |
| Multi-company switching | Company selector, cross-company reporting |
| Large-scale automated test suite | CI/CD integration |

---

## 6. Updated Fix Backlog

| ID | Category | Priority | Feature Area | Issue / Requirement | Why It Matters | Backend/API | RPC/Service Impact | Frontend/UI | Owner | Acceptance Criteria |
|----|----------|----------|-------------|---------------------|----------------|-------------|-------------------|-------------|-------|---------------------|
| REM-001 | **Must Have** | P0 | Access Control | Invoice list lacks AR Clerk assignment filtering | AR Clerk sees unassigned invoices | Yes | None — read filter | None | Codex | AR Clerk GET /invoices scoped |
| REM-002 | **Must Have** | P0 | Access Control | Reports/dashboard lack AR Clerk filtering | AR Clerk sees unassigned aggregates | Yes | None — read filter | None | Codex | Reports scoped to assigned customers |
| REM-005 | **Must Have** | P0 | API Safety | POST /allocations/auto exposed | Unverified endpoint callable | Yes — return 403 | None — manualAllocate unaffected | None | Codex | 403 returned; manual + import unaffected |
| REM-010 | **Must Have** | P1 | Documentation | Evidence files drift | Incomplete FYP evidence | No | No | No | Claude | All evidence reconciled |
| REM-006 | **Must Have** | P1 | API Completeness | Bank account uses demo env var | Hardcoded config visible | Yes — GET /bank-accounts | None | Yes — real selector | Codex + Claude | Real bank account from API |
| REM-008 | **Must Have** | P1 | API Completeness | GET /allocations/:id no handler | Dead route | Yes — implement or remove | None | None | Codex | Endpoint works or removed |
| REM-015 | **Must Have** | P1 | Financial Safety | No hidden customer mutation guards | Hidden customer docs mutatable | Yes — add guards | Guards before RPC calls | None | Codex | Mutations rejected for hidden customers |
| REM-011 | **Must Have** | P1 | Frontend | JE page placeholder | Demo gap | Verify backend | None | Yes — real page | Claude + Codex | JE page shows real data |
| REM-022 | **Must Have** | P1 | Smart Automation | One receipt → multiple invoices | Core allocation gap | Yes — use existing allocations[] | One manualAllocate() call | Yes — multi-select UI | Codex + Claude | 1 receipt → 3 invoices, atomic, no partial commit |
| REM-023 | **Must Have** | P1 | Smart Automation | Overpayment / unapplied cash | Excess incorrectly allocated | Minimal — rejection + result fields | Existing RPC validates | Yes — unapplied display | Codex + Claude | Over-allocation rejected; unapplied shown |
| REM-024a | **Must Have** | P2 | Smart Automation | Discount via existing discount_amount | Payment differences ignored | Minimal — tolerance logic | Uses existing p_discount_amount | Yes — discount suggestion | Codex + Claude | $10 discount suggested, user confirms, Fully Paid |
| REM-024b | **Should Have** | P2 | Smart Automation | Bank charge detection + classification | Differences silently absorbed | Design required — GL mapping | Possibly new adjustment logic | Yes — classification display | Codex + Claude | Detected, classified, requires review |
| REM-025 | **Must Have** | P1 | Smart Automation | Fuzzy matching engine | Only exact matching exists | Yes — MatchingService | Read-only, no mutations | Yes — confidence + explanation | Codex + Claude | Multi-criteria with confidence scores |
| REM-026 | **Must Have** | P1 | Smart Automation | Controlled auto-post | No safe auto-post framework | Yes — eligibility logic | Uses existing post/allocate RPCs | Yes — eligibility display | Codex + Claude | Exact match auto-posts; failures → Draft |
| REM-027 | **Should Have** | P2 | Smart Automation | PDF / Image / OCR import | No document image import | Yes — OCR integration | Feeds into existing import | Yes — review screen | Codex + Claude | OCR extracts, user reviews, corrected data imported |
| REM-003 | **Future** | P3 | Financial Safety | JE creation not atomic | Orphan headers possible | New RPC migration | New create_journal_entry RPC | None | Codex | Documented as future hardening |
| REM-004 | **Future** | P3 | Financial Safety | Cancel/clearance not atomic | Partial corruption possible | New RPC migrations | cancel_invoice, cancel_receipt, clear_cheque RPCs | None | Codex | Documented as future hardening |
| REM-007 | **Future** | P3 | Security | Hidden filtering service-layer only | Not RLS-enforced | No (document) | No | No | Claude | Documented as limitation |
| REM-009 | **Future** | P3 | Import | Enterprise import hardening | Not enterprise-grade | No (document) | No | No | Claude | Documented as limitation |

---

## 7. Codex Implementation Handoff Notes

> [!WARNING]
> **Codex must read these notes before implementing any batch.**

### Batch 1: Access Control

- **REM-001/002**: Use `getCustomerAccessFilter(auth)` — pattern exists in `ReceiptService.listReceipts()`. Only AR Clerk is affected.
- **REM-005**: Return 403 from `POST /allocations/auto` handler. Do NOT delete route, do NOT modify `autoAllocate()`. Confirm `POST /allocations/manual` and Phase E import allocation (via `manualAllocate()`) are unaffected.

### Batch 2: API Completeness and Mutation Guards

- **REM-006**: `GET /bank-accounts` — read-only, company-scoped, active only, role-checked. No direct Supabase query from frontend.
- **REM-015**: Add hidden/deleted customer check to `postReceipt`, `cancelInvoice`, `cancelReceipt`, `clearCheque`, draft update/delete. Use `payment_method = 'CHQ'` (not "Cheque") in cheque clearance logic.

### Batch 3: Multi-Invoice Allocation

- **Critical**: `manualAllocate()` already accepts `allocations[]`. `allocate_receipt` RPC already supports `p_allocations JSONB`.
- Use ONE call with all allocation rows — not a loop of per-invoice calls.
- If validation fails for any row → entire request rejected (no partial commit).
- `POST /allocations/multi` (if added) must call `manualAllocate()` once.
- Validate: `sum(allocation_amounts) ≤ receipt.unallocated_amount`.

### Batch 4: Overpayment and Discount

- **Overpayment**: Do NOT silently cap explicit user amounts. Reject or require confirmation. Auto-suggestions may propose capping. Include `unapplied_amount`, `overpayment_detected`, `overpayment_action` in results.
- **Discount**: Use existing `p_discount_amount` in `allocate_receipt`. Apply when difference is within tolerance and user confirms.
- **Bank charge**: Detect and classify. Do NOT auto-post as discount. Requires GL design or user review.

### Batch 5: Fuzzy Matching, Auto-Post, OCR

- **Fuzzy matching**: Read-only. No mutations. Server-side. Returns confidence + explanation.
- **Auto-post**: OFF by default. Exact matches only by default. High-confidence requires explicit opt-in. OCR rows NEVER auto-post.
- **OCR**: Mandatory review screen. Untrusted until human-reviewed. After review → normal import flow.

### General Safety

- Never use `getAdminClient()` without explicit `company_id` filtering.
- Always use `auth` parameter (not `_auth`).
- Always `deno check` before committing.
- Always test with AR Clerk role.
- Never duplicate reversal logic — reuse `reverse_journal_entry`.
- Use `payment_method = 'CHQ'` not "Cheque" in code.

---

## 8. Codex Review Checkpoints

### Pre-Batch 1 Review

| # | Item | Status |
|---|------|--------|
| 1 | Batch 1 scope (REM-001, 002, 005, 010) is correct | ✅ Approved |
| 2 | AR Clerk filter approach is feasible | ✅ Approved |
| 3 | Auto-allocation disable approach is safe | ✅ Approved |
| 4 | No conflicts with existing RPCs | ✅ Approved |

### Pre-Batch 2+ Review (Required Before Each Batch)

> [!IMPORTANT]
> Before Batch 2 onwards, Codex must review the corrected plan again to confirm:
> - Batch scope is correct.
> - Implementation approach is feasible.
> - No conflicts with previous batch changes.
> - Safety rules are maintained.

| # | Item | Status |
|---|------|--------|
| 1 | Batch 2 scope and approach | ⬜ Pending |
| 2 | Batch 3 multi-invoice allocation using existing allocations[] | ⬜ Pending |
| 3 | Batch 4 overpayment/discount/bank charge design | ⬜ Pending |
| 4 | Batch 5 fuzzy matching + auto-post + OCR design | ⬜ Pending |
| 5 | All safety rules maintained across batches | ⬜ Pending |

---

## 9. User Approval Gate

> **Implementation must follow this approval process:**
>
> 1. ✅ Claude plan completed (this document).
> 2. ✅ Codex reviewed and approved with corrections (all applied).
> 3. ⬜ **User approves Batch 1 implementation** — only then does Batch 1 begin.
> 4. ⬜ After Batch 1 is verified, Codex re-reviews plan before Batch 2.
> 5. ⬜ User approves Batch 2. Process repeats for each batch.
>
> **Implementation may begin with Batch 1 only after user approval.**  
> **Before Batch 2 onwards, Codex must review the corrected plan again.**

---

*Plan created: 2026-06-09*  
*Codex reviews: 3 rounds (initial, second, smart automation) — all corrections applied*  
*Final revision: 2026-06-09T21:47:42+08:00*  
*Status: Codex-approved — Awaiting user approval for Batch 1*  
*Author: Claude (GenAI-assisted development)*
