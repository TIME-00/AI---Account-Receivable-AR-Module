# Batch 5-Fix-B — Manual Invoice Submit Double-Click Prevention Summary

**Date**: 2026-06-13  
**Batch**: 5-Fix-B (Manual invoice "Create Draft" / "Create & Post" duplicate-submission prevention)  
**Status**: ✅ Implemented · ✅ `npm run build` verified · ✅ Local + Vercel production tested · ✅ Committed & pushed  
**Commit**: `b3fe84a` — "Strengthen invoice submit duplicate prevention"  
**Plan Reference**: `docs/plans/batch-5-fix-import-preflight-idempotency-plan.md` §C (Batch 5-Fix-B — frontend submit lock)

---

## 1. Purpose

Batch 5-Fix-B fixes a data-integrity defect in the manual **New Invoice** workbench: clicking **Create Draft** or **Create & Post** rapidly created **duplicate invoices** (e.g. 6 clicks → 6 invoices). The fix introduces a layered frontend submission lock that holds across the **entire** create→post→navigate flow, plus click-suppression at the button level, so repeated/queued clicks can no longer trigger a second submission.

This is a **frontend-only** change. Backend idempotency (a `client_request_id` / server-side dedupe) remains documented as **future hardening** (Batch 5-Fix-C) and was intentionally not implemented.

---

## 2. Root Cause (Confirmed)

| Layer | Pre-fix behavior | Why it allowed duplicates |
|-------|------------------|---------------------------|
| `invoice-review.tsx` | Create & Post disabled only when `isCreating && isPosting` | `handleCreateAndPost` runs **create first**, so during the create window `isCreating=true` but `isPosting=false` → the **AND was false** → button stayed clickable. |
| First lock attempt | Lock released in `finally` | Released **too early** after `router.push("/invoices")`; queued rapid clicks could fire before the page unmounted. |
| `LoadingButton` | Relied on the native `disabled` attribute only | A click already queued in the same tick could still invoke `onClick`. |

The Batch 5-Fix-B implementation addresses all three.

---

## 3. Scope Completed

| # | Item | Status |
|---|------|--------|
| 1 | Stronger frontend submit lock for manual invoice creation | ✅ Done |
| 2 | Per-hook **synchronous** `submissionLockRef` guard | ✅ Done |
| 3 | **Module-level** `invoiceSubmissionInFlight` guard | ✅ Done |
| 4 | `submittingAction` state driving UI loading behavior | ✅ Done |
| 5 | Derived `isSubmitting` state | ✅ Done |
| 6 | Both buttons disabled while **any** invoice submission is in progress | ✅ Done |
| 7 | `LoadingButton` suppresses click events while disabled/loading | ✅ Done |
| 8 | Create & Post lock covers the **full** flow (validate → create → post → success/error → navigation) | ✅ Done |
| 9 | On success, lock **not** released before navigation | ✅ Done |
| 10 | On validation/API error, lock **resets** for retry | ✅ Done |
| 11 | Rapid repeated clicks no longer create duplicates | ✅ Done |

---

## 4. Files Changed

| File | Change | Lines |
|------|--------|-------|
| `frontend/src/hooks/use-invoice-form.ts` | Module-level `invoiceSubmissionInFlight`; `submissionLockRef`; `submittingAction` state; derived `isSubmitting`; `beginSubmission()` / `endSubmission()` helpers; reworked `handleCreateDraft` / `handleCreateAndPost` with `shouldUnlock` navigation guard; mount/unmount reset effect | 90 changed |
| `frontend/src/components/features/invoices/invoice-review.tsx` | Accept `isSubmitting` + `submittingAction`; disable both buttons on `isSubmitting`; corrected `isLoading` conditions and loading labels | +12 / −2 |
| `frontend/src/components/ui/loading-button.tsx` | Compute `isDisabled = isLoading \|\| disabled`; intercept `onClick` to `preventDefault`/`stopPropagation` when disabled; add `aria-disabled` | +17 |
| `frontend/src/app/(dashboard)/invoices/new/page.tsx` | Pass `isSubmitting` + `submittingAction` into `InvoiceReview` | +2 |

**Total: 4 files, +94 / −27.** No backend, no migration, no RPC, no import/receipt/allocation logic.

---

## 5. Logic Implemented

### 5.1 Three-layer lock (`use-invoice-form.ts`)

```ts
// Module scope — survives re-renders, shared across the hook instance for this route
let invoiceSubmissionInFlight = false;

// Inside the hook:
const submissionLockRef = useRef(false);                                  // synchronous, same-tick guard
const [submittingAction, setSubmittingAction] = useState<"draft" | "post" | null>(null);  // drives UI
const isSubmitting =
  submittingAction !== null || createMutation.isPending || postMutation.isPending;          // derived OR-lock
```

- **`invoiceSubmissionInFlight` (module-level)** and **`submissionLockRef` (ref)** are set **synchronously** before any `await`, so a second click in the same tick — before React re-renders the disabled state — is rejected immediately.
- **`isSubmitting`** is an **OR** of `submittingAction` and both mutation pending flags. This replaces the old fragile **AND** (`isCreating && isPosting`) that left the create window unguarded.
- A mount/unmount `useEffect` resets `invoiceSubmissionInFlight` so the module-level flag cannot leak a stuck-locked state across navigations.

### 5.2 Begin / end gate (`use-invoice-form.ts:190`)

```ts
const beginSubmission = (action: "draft" | "post") => {
  if (invoiceSubmissionInFlight || submissionLockRef.current
      || createMutation.isPending || postMutation.isPending) {
    return false;            // already submitting → reject re-entry
  }
  invoiceSubmissionInFlight = true;
  submissionLockRef.current = true;
  setSubmittingAction(action);
  return true;
};

const endSubmission = () => {
  invoiceSubmissionInFlight = false;
  submissionLockRef.current = false;
  setSubmittingAction(null);
};
```

Each handler begins with `if (!beginSubmission(...)) return;` — the **one-submit guard**.

### 5.3 Lock held through navigation (`use-invoice-form.ts:206`,`240`)

```ts
let shouldUnlock = true;
try {
  // validate → createMutation.mutateAsync → (post) → toast
  shouldUnlock = false;       // success path: DO NOT unlock before leaving the page
  router.push("/invoices");
} catch (error) {
  handleApiError(error);      // error path: shouldUnlock stays true
} finally {
  if (shouldUnlock) endSubmission();
}
```

- **Success:** `shouldUnlock = false`, so `endSubmission()` does **not** run; the lock stays engaged through `router.push` until the component unmounts. This closes the "unlock-too-early-after-push" window from the first attempt.
- **Validation failure / API error:** `shouldUnlock` remains `true`, so `finally` calls `endSubmission()` and the user can correct and retry.

### 5.4 Button-level click suppression (`loading-button.tsx:46`)

```ts
const isDisabled = isLoading || disabled;
const handleClick = (event) => {
  if (isDisabled) { event.preventDefault(); event.stopPropagation(); return; }
  onClick?.(event);
};
// <button disabled={isDisabled} aria-disabled={isDisabled} onClick={handleClick} ... >
```

Even if a click is dispatched while disabled (e.g. a queued event), `onClick` is intercepted and never reaches the submit handler. `aria-disabled` is added for accessibility.

### 5.5 Button wiring (`invoice-review.tsx`)

```ts
// Save Draft
isLoading={submittingAction === "draft" || (isCreating && !isPosting)}
disabled={isSubmitting}
loadingText="Saving..."

// Create & Post
isLoading={submittingAction === "post" || isPosting}
disabled={isSubmitting}
loadingText={isPosting ? "Posting..." : "Processing..."}
```

Both buttons are disabled whenever `isSubmitting` is true, so starting either action locks **both**. The Create & Post label shows "Processing…" during the create phase and "Posting…" during the post phase.

---

## 6. Commands / Checks Run

| Check | Result |
|-------|--------|
| `npm.cmd run build` (frontend) | ✅ Passed |
| `git diff --check` | ✅ Passed (Windows CRLF warnings only — not errors) |
| `git commit` | ✅ Committed as `b3fe84a` |
| `git push` | ✅ Pushed |
| Vercel production deploy | ✅ Deployed |

---

## 7. Smoke Test Checklist and Results

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1 | Local `npm run dev` run | Lock behaves correctly | ✅ PASSED |
| 2 | Vercel **production** run | Lock behaves correctly in prod build | ✅ PASSED |
| 3 | **Create Draft** rapid repeated clicks | Only **one** Draft invoice created | ✅ PASSED |
| 4 | **Create & Post** rapid repeated clicks | Only **one** posted invoice created | ✅ PASSED |
| 5 | Toast count on Create & Post | Only **one** "Invoice Posted" toast | ✅ PASSED |
| 6 | Buttons during pending request | Both disabled | ✅ PASSED |
| 7 | Loading state during pending request | Loading label/spinner shown | ✅ PASSED |
| 8 | Validation / API error | Form unlocks for correction & retry | ✅ PASSED |

**All smoke tests passed (local + production).**

---

## 8. What Was Intentionally NOT Changed

- ❌ **No backend change** — no invoices service, no endpoint change.
- ❌ **No migration** — no `client_request_id` column, no idempotency table.
- ❌ **No financial RPC change** — `post_invoice` / posting logic untouched.
- ❌ **No import logic change.**
- ❌ **No receipt / allocation logic change.**
- ❌ **Backend idempotency not implemented** — remains future hardening (Batch 5-Fix-C).

---

## 9. Risks and Follow-Up Items

| # | Item | Notes | Priority |
|---|------|-------|----------|
| 1 | Frontend-only guarantee | The lock prevents duplicates from the **UI**. A direct API caller (script/replay) could still POST twice; that is the domain of backend idempotency | Documented |
| 2 | Backend idempotency (`client_request_id`) | **Batch 5-Fix-C** — future hardening; would require a migration (new column + unique index or idempotency table); out of scope | Future |
| 3 | Pattern reuse | The same `beginSubmission`/`endSubmission` + `isSubmitting` pattern could harden other create/post forms (e.g. manual receipt, allocation) if duplicate-submit risk is found there | Recommended |
| 4 | Automated regression tests | Double-click behavior is verified manually; consider a component/E2E test in the testing batch | Recommended |

---

## 10. Relationship to Sibling / Future Batches

> [!IMPORTANT]
> Batch 5-Fix-B delivers **frontend manual-invoice submit duplicate prevention** only.
>
> - **Batch 5-Fix-A** — receipt-import allocation preflight (✅ completed, commit `d18b19f`).
> - **Batch 5-Fix-C** — backend idempotency review / `client_request_id` (future hardening; migration-gated; documented only).
>
> Backend idempotency, OCR, fuzzy matching, and fully automatic posting remain separate future work.

---

*Document created: 2026-06-13*  
*Batch 5-Fix-B status: ✅ Implemented · ✅ build verified · ✅ Local + Vercel production tested · ✅ Committed & pushed (`b3fe84a`)*  
*Author: Claude (GenAI-assisted development)*
