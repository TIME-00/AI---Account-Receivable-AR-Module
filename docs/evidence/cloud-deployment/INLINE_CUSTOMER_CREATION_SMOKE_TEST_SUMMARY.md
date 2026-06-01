# Inline Customer Creation Smoke Test Summary

## Purpose

This AR module is a client-facing self-service prototype. The client enters business data through the frontend and does not manually create records in Supabase or supply internal UUIDs, customer codes, tenant ownership fields, sequence numbers, or assignment rows.

Inline customer creation was added so a user creating an invoice or receipt can search visible customers and open a compact Quick Create Customer modal when no visible customer has the typed name. The user remains inside the existing financial document form.

The modal collects required customer master data explicitly. It does not silently fake required registration, address, or contact fields.

## Updated Pages

- `/invoices/new`
- `/receipts/new`

Both pages use the shared `CustomerComboboxWithCreate` component. No separate customer creation page was added.

## Backend Path

- The modal calls `POST /customers/inline`.
- The customers Edge Function validates the request with the existing `validateCreateCustomer()` validator.
- `CustomerService.createInlineCustomer()` reuses `CustomerService.createCustomer()`.
- Customer business IDs continue to use the existing `CUST` sequence through `getNextSequence()`.
- Internal customer UUIDs, tenant ownership, generated customer codes, and AR Clerk assignment rows are handled by backend services.
- The frontend submits business-facing customer master data only.
- Invoice and receipt submission paths remain unchanged.

## Visibility And Duplicate Protection

- New customers are created with `is_hidden = false` and `is_deleted = false`.
- Hidden customers are excluded from matching and are never automatically reused.
- Visible customer names are normalized by trimming, collapsing repeated whitespace, and comparing case-insensitively within the authenticated company.
- `database/011_customer_normalized_name.sql` adds a partial unique index for visible, non-deleted customer names.
- AR Clerk creation creates or reactivates only the creator's `user_customer_assignments` row.

## Country-Aware Address Dropdowns

The Quick Create Customer modal uses cascading address dropdowns:

- Country controls the available State / Region options.
- State / Region controls the available City / Area options.
- City / Area controls the available Postal Code options.
- Changing a parent selection resets all dependent selections.
- Malaysia and Singapore options are kept separate so mismatched country data cannot be selected through the modal.

The frontend dataset is intentionally curated for the client prototype. It includes Malaysian states with practical major-city postcode samples and Singapore regions with common-area postcode samples. It is not an exhaustive official postal database. A production-grade follow-up can replace `frontend/src/lib/address-options.ts` with a backend `address_reference` table or an official postal dataset.

## Data Preservation

- No customer, invoice, receipt, allocation, journal entry, or audit record is deleted.
- No financial RPC, journal, allocation, posting, invoice creation, or receipt creation logic is changed.
- Public schema remains in use. No `ar.*` schema is introduced.

## Import Direction

CSV/XLSX invoice import currently remains draft-only and requires a visible existing customer code. That is a documented limitation of the current import phase, not the final client-facing product direction.

The required follow-up import design is review-first:

- Match imported customer data against visible company-scoped customers using normalized names and business identifiers.
- Do not match or reuse hidden historical customers.
- Present unmatched customers for review.
- Create approved new customers through `CustomerService`, with backend-generated UUIDs, `CUST` codes, tenant ownership, and AR Clerk assignment where applicable.
- Create draft invoices only after customer matching or customer creation is confirmed.
- Apply the same principle to receipt import in a later phase.

No import automation behavior was added or changed as part of inline customer creation.

## Automated Checks

- [x] `npm.cmd run build`
- [x] `deno check customers/index.ts`
- [x] `deno check invoices/index.ts`
- [x] `deno check receipts/index.ts`
- [x] `git diff --check`

## Manual Smoke Checklist

Run after applying migrations `010`, `011a` preflight, and `011`, then deploying the updated customers Edge Function to a non-production environment.

- [ ] New Invoice: type a new customer name and choose `Create new customer`.
- [ ] New Invoice: complete the modal and confirm the new customer is auto-selected.
- [ ] Confirm the generated `CUST` code is returned by the backend; the user does not enter it manually.
- [ ] New Invoice: proceed to line items and save a draft invoice.
- [ ] New Receipt: type a new customer name and choose `Create new customer`.
- [ ] New Receipt: complete the modal and confirm the new customer is auto-selected.
- [ ] New Receipt: create a receipt through the existing flow.
- [ ] Repeat a visible customer name with different case and repeated spaces; confirm the existing authorized visible customer is selected.
- [ ] As AR Clerk, confirm a newly created customer is assigned only to the creating clerk.
- [ ] Confirm hidden customers do not appear and are not reused.
- [ ] Confirm dashboard, invoice, receipt, and report visibility filters still exclude hidden test data.
- [ ] Select Malaysia, then Johor and Johor Bahru; confirm only Johor Bahru postcode options appear.
- [ ] Change the country from Malaysia to Singapore; confirm state, city, and postal selections reset.
- [ ] Confirm only Singapore regions, areas, and postcode options appear after selecting Singapore.
- [ ] Repeat the cascading address dropdown check from New Receipt.

## Deployment Status

Implementation is local only. No production deployment was performed as part of this change.
