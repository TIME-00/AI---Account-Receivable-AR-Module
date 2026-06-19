# Batch 7B — Demo CSV Fixture Kit (masked templates)

**Status:** Templates only — **not executed**. Creating these files does **not** create any
invoice, receipt, allocation, or other persistent financial record.

> **Production-mutation approval gate (mandatory).** Before any of these templates is generated
> into an upload-ready file **and** uploaded, you must obtain explicit user approval identifying:
> target **environment**, **company**, **demo customer(s)**, **scenarios to execute**, and the
> **expected persistent financial records**. Authoring/committing templates does **not** authorize
> running them. See `docs/plans/BATCH_7_DEMO_READINESS_UI_POLISH_PLAN.md` §5.6.

---

## What is committed vs. generated

- **Committed = masked templates only.** Every file in this folder is a `*.template.csv` containing
  `REPLACE`/`RUN_ID` **tokens**, not real identifiers. They are inert and not directly uploadable.
- **Generated = untracked.** Upload-ready files (with a real run id and real in-demo invoice
  numbers substituted in) are written to `docs/demo/fixtures/generated/`, which is **gitignored**
  (see `.gitignore` in this folder). Do not commit generated files.
- **No production identifiers** (real customer codes, invoice numbers, bank account numbers, names,
  registration numbers, contacts) may be committed without explicit review.

## Tokens

| Token | Replace with | Notes |
| --- | --- | --- |
| `CUST-REPLACE-001` | An existing **visible demo** customer code | Read-only verify it belongs to the demo company first |
| `CUSTOMER-NAME-FUZZY-REPLACE` | A name **close but not exact** to a demo customer's name | Drives the customer-suggestion review path |
| `BANK-ACCOUNT-REPLACE-001` | A valid bank account code (`bank_accounts.account_no`) in the demo company | |
| `INVOICE-REFERENCE-A` | A **posted** in-demo invoice number with outstanding ≥ 100.00 | Happy-path full allocation |
| `INVOICE-REFERENCE-B` | A **posted** in-demo invoice number with outstanding ≥ 100.00 | Used to derive the fuzzy near-miss below |
| `INVOICE-REFERENCE-B-FUZZY` | `INVOICE-REFERENCE-B` with **one character changed** | Must be close enough to suggest B, not an exact match |
| `INVOICE-REFERENCE-C` | A **posted** in-demo invoice number with outstanding **exactly** 100.00 | Overpayment scenario |
| `REPLACERUNID` | A unique run id per demo session (e.g. timestamp) | Prevents reference collisions across runs |
| `DATE-REPLACE` | A valid demo `invoice_date` / `receipt_date` (`YYYY-MM-DD`) | Substitute **only after** confirming the date is valid for the target environment and **not in a closed accounting period** |
| `CURRENCY-REPLACE` | The target company/customer currency (3-letter ISO) | Substitute **only after read-only verification** of the demo company/customer currency; invoice and receipt currencies must match for allocation |

> **Date and currency are tokens, not literals.** Templates intentionally do **not** hardcode a date
> or currency. `DATE-REPLACE` must be substituted only after confirming the target demo date is valid
> for the environment and not in a closed accounting period. `CURRENCY-REPLACE` must be substituted
> only after read-only verification of the target company/customer currency. Until these (and the
> other tokens) are substituted at runtime, the templates remain **masked and not upload-ready**.
> Generated upload-ready runtime files remain **untracked**, and fixture **execution remains
> separately gated and not authorized** (see §5.6 / the approval gate above).

## Repeatable workflow (no manual DB edits)

1. **Seed draft invoices.** Generate `demo-invoices-seed.template.csv` (substitute `CUST-REPLACE-001`,
   `REPLACERUNID`) and import it on **Invoices → Import**. This creates **draft invoices only**.
2. **Post the seeded invoices** from the invoice list/detail so they have real outstanding balances.
3. **Capture each posted invoice number** and substitute it for `INVOICE-REFERENCE-A/-B/-C` (and derive
   `INVOICE-REFERENCE-B-FUZZY`).
4. **Generate the receipt scenario files** (substitute the remaining tokens) and run them on
   **Receipts → Import**, one scenario at a time, **only after the approval gate above is satisfied**.

The existing token-substitution harness pattern (`tests/curl/import-phase-e-*.ps1` →
`tests/fixtures/generated/`) can be reused; this kit simply keeps demo templates separate under
`docs/demo/fixtures/`.

## Scenarios (5 required; optional editable-customer scenario omitted)

| File | Scenario | Expected outcome |
| --- | --- | --- |
| `demo-invoices-seed.template.csv` | Seed draft invoices for the demo | Draft invoices created (none posted by import) |
| `demo-receipt-happy-path.template.csv` | Exact customer code + valid invoice ref + exact allocation | All rows Valid → Create, Post & Allocate cleanly |
| `demo-customer-fuzzy-match.template.csv` | `customer_name` close-but-not-exact | `review_required` (customer_suggestion) → Approve → auto-retry → Valid |
| `demo-invoice-fuzzy-match.template.csv` | Valid customer + near-miss invoice ref | `review_required` (invoice_suggestion) → Approve → auto-retry → Valid |
| `demo-fake-invoice-autoreject.template.csv` | Invoice ref that does not exist (zero candidates) | Auto-rejected (`invoice_not_found`), correction-only state |
| `demo-overpayment-unapplied-cash.template.csv` | Receipt amount > matched invoice outstanding | Posts; remaining balance surfaced as **unapplied cash** (backend handles balances) |

> **Editable-customer scenario omitted.** Plan §5.4 #4 is optional and only included once a *safe,
> deterministic* trigger for an editable review row is confirmed against staging. That confirmation
> requires execution (out of scope for this implementation pass), so the scenario is intentionally
> not shipped. "No match + no suggestion" is **not** a reliable trigger — it may cause customer
> auto-creation instead.

> **Multi-invoice allocation is not a receipt-import scenario.** Receipt import maps one receipt row
> to one exact invoice reference. Demonstrate Batch 3 multi-invoice allocation via the manual
> **Allocation Wizard** (`POST /allocations/manual`), not via import.

## Safety constraints

- Amounts are small, round, and clearly "demo"; remarks are prefixed `DEMO`.
- Do not place real client names/registration/contact/bank data into any committed file.
- Running generated files creates **real** demo financial records via verified flows — they are not
  inert. No deletion/cleanup is permitted; prefer dedicated demo-company/customer scoping. `RUN_ID`
  records may remain as clearly marked demo records.
