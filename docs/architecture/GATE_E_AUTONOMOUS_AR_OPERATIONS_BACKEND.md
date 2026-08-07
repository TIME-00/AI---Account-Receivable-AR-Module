# Gate E Autonomous AR Operations Backend

## Status and safety posture

This document describes the local, undeployed Gate E backend foundation. It does
not claim that Migration 034 has been applied, a mailbox has been connected,
OAuth consent has completed, a document-intelligence provider is active, an
email has been sent, a scheduler is active, or Production automation is enabled.

Every company starts with no `automation_settings` row, which the API interprets
as `disabled` with every kill switch off. Inserted settings also default to
`disabled`. Mailboxes default disabled and disconnected. Straight-through mode
requires a Finance Manager, the exact activation confirmation, an existing
tenant-bound automation actor, and compatible kill switches. No activation is
performed by this implementation.

Changing that setting does not certify provider readiness. Ingestion, reminder
delivery, and document intelligence are independent runtime capabilities; each
remains fail-closed until its own switch and prerequisites are satisfied.

## Trust boundaries

- The authenticated company and user come from the existing Edge authentication
  boundary. Request bodies never select a tenant or acting user.
- A sales representative is a tenant-scoped business contact, not an AR user,
  `auth.users` identity, password holder, or financial role.
- Mailboxes map explicitly to one company. Email domains and document content
  never select a tenant.
- OAuth token values are not stored in application tables. Tables store only
  uppercase secret-reference names plus separate non-secret ingestion/delivery
  expiry and readiness metadata.
- Document provider output is untrusted candidate data. It cannot issue SQL,
  select a tenant, create a customer, select an ambiguous customer, calculate
  authoritative FX, allocate a receipt, or perform a financial write.
- Invoice and receipt commands call the existing governed creation and posting
  services through service-role-only command RPCs. Creation, optional posting,
  command-result linkage, and lifecycle audit are one PostgreSQL transaction.
  Base values and FX decisions remain database-authoritative.
- Automatic allocation is accepted only by
  `automation_allocate_receipt(...)`. The database locks the receipt and target
  invoices, checks tenant/customer/currency, validates current booked-FX
  provenance, enforces evidence and idempotency, then calls the existing atomic
  `allocate_receipt(...)` RPC. A pending allocation-decision UUID, created in
  that same locked transaction, authorizes the insert-time `Auto_Amount`
  attribution; allocation evidence is never relabelled after insertion. FIFO
  remains preview/manual assistance only.
- Unknown failures use the shared sanitized `INTERNAL_ERROR`; provider tokens,
  response bodies, SQL, schema names, stack traces, raw document text, and email
  bodies are not returned to clients.

## Re-frozen API boundary

`backend/supabase/functions/automation/dto.ts` is the only database-row to
public-DTO boundary. The service never returns undocumented `select("*")`
records directly. It validates UUID/date/timestamp/decimal/contact primitives,
normalizes PostgreSQL numeric settings to JSON numbers, aliases internal
classification/attachment fields, derives extraction document type from the
classification, and fails closed with `AUTOMATION_RESPONSE_INVALID` when a
database/provider result cannot satisfy `gate-e.1`.

Date validation checks Gregorian month/day and leap-year rules. Timestamp
validation separately checks the lexical form, Gregorian components, clock and
timezone-offset bounds, and a finite parse before canonicalizing to UTC; it
never relies on JavaScript's date normalization to accept impossible input.

Mailbox DTOs reveal only configured/readiness booleans, cursor presence, cursor
kind, expiry metadata, and redacted codes. They never expose secret-reference
names or raw history/delta cursors. Sync-run cursor values are represented only
as `[redacted]` or `null`. Command payloads and raw extraction fields are not
part of read DTOs. Overview readiness is split into `ingestion_ready` and
`delivery_ready`. Each requires an enabled connected mailbox, its matching
capability switch, no reconnect state, current semantic expiry metadata, a
capable provider adapter, and successful resolution of the matching opaque
secret reference. Missing/unavailable secrets and invalid/expired token
metadata produce `false`; no token or reference name is returned.

Audit/exception metadata passes through an explicit per-key validator map.
Identifiers must be UUIDs, lifecycle/provider/action fields must be known enums,
codes must be bounded uppercase snake case, stage values must be bounded
integers, and changed fields must use a fixed field vocabulary. A second
credential-shape filter removes JWTs, bearer/OAuth material, PEM data,
connection strings, long encoded secrets, provider bodies, stacks, SQL, and
other sensitive values even when supplied under an otherwise safe key. Unsafe
entries are omitted without breaking the surrounding DTO.

System Admin is configuration-only: settings, mailbox/OAuth configuration, and
the sales-contact directory. Operational financial automation reads remain AR
Supervisor/Finance Manager/Auditor. Customer-owner reads retain the established
operational customer/assignment scope. Mutation and allocation roles remain
narrower as frozen in the API contract; frontend navigation must implement this
split rather than treating every Automation tab as System Admin-readable.

## Database model

Migration `database/034_gate_e_autonomous_ar_operations.sql` creates:

- `sales_representatives`
- `customer_sales_representative_assignments`
- `automation_settings`
- `automation_mailboxes`
- `automation_oauth_states`
- `mailbox_sync_runs`
- `automation_source_messages`
- `automation_source_attachments`
- `automation_document_classifications`
- `automation_extraction_results`
- `automation_commands`
- `automation_exceptions`
- `automation_allocation_decisions`
- `invoice_reminders`
- `reminder_delivery_attempts`
- `automation_audit_events`

All tables include tenant keys, RLS, explicit service-role-only table grants, and
indexes for tenant lists, queues, foreign keys, and idempotency. Cross-table
tenant consistency is enforced by triggers. Classification and audit history are
immutable. The current sales-representative assignment is unique per customer;
reassignment supersedes the old row and requires a reason. Assignment history
cannot be deleted or rewritten; its only permitted update is the one-way,
audited current-to-superseded transition.

`mailbox_sync_runs` persists four additional measured counters:
`attachments_processed`, `commands_processed`, `allocations_completed`, and
`failures`. Tenant-linked triggers attribute terminal attachment/command/
allocation transitions and non-duplicate open/retryable exceptions back to the
originating sync run. Combined with the existing discovery/persistence and
duplicate counters, the API can report run progress without fabricated zeroes.
Entity-filter indexes support Invoice reminder, reminder-attempt, and audit
timeline integrations without tenant-wide client filtering.

Safe lifecycle triggers append audit events for sales contacts, settings,
mailboxes, OAuth state, sync runs, source messages and attachments,
classification/extraction, commands, exceptions, allocations, reminders, and
delivery attempts. Audit metadata contains only bounded lifecycle/provider
labels; it never copies tokens, document content, email bodies, or financial
payloads.

Classification records cannot be updated or deleted. Extraction records cannot
be deleted or rewritten; their only permitted update is the narrow
invalid/ambiguous-to-valid transition that adds a later deterministic customer
resolution while preserving the original provider output and trace metadata.

Migration `034b_gate_e_autonomous_ar_operations_smoke_tests.sql` is rollback-only
and must never run in Production. It verifies tables, RLS, browser-denied and
service-role table grants, RPC catalog/grant contracts, unique invariants,
OAuth-expiry readiness, retention metadata/indexing, default-off posture,
assignment/reassignment, lifecycle-audit coverage, reminder idempotency,
measured run-counter attribution and entity-filter indexes,
transactional rollback of failed Invoice and Receipt straight-through commands,
cross-currency automatic-allocation refusal, allocation reconciliation and
idempotent replay, fixture rollback, and absence of a Gate E cron job.

Migration 034 performs no invoice, receipt, allocation, journal, reminder,
mailbox, or customer data backfill and installs no scheduler.

The Edge Function exposes a bounded `POST /worker/run` integration point for an
external scheduler. It is protected by a dedicated constant-time-checked worker
secret, does not accept tenant authority in the request, and derives each
company and acting Finance Manager/AR Supervisor from `automation_settings`.
The cycle bounds companies, mailboxes, provider pages, attachments, reminders,
and retries. With no worker secret or no non-disabled tenant settings it fails
closed or performs no work.

## Provider setup

### Gmail / Google Workspace

Ingestion uses the Gmail API with
`https://www.googleapis.com/auth/gmail.readonly`. It stores `historyId`, calls
`users.history.list`, follows `nextPageToken`, retrieves messages and attachments,
handles both attachment-ID and inline MIME-part bytes, and advances the cursor
only after all required persistence succeeds. An expired history cursor becomes
`MAILBOX_RECONNECT_REQUIRED`; it never silently advances. A bounded,
operator-approved resynchronization is required.

Delivery is separately enabled and uses
`https://www.googleapis.com/auth/gmail.send` with
`users.messages.send`. Enabling ingestion never enables delivery.

Provisioning dependencies:

- `GMAIL_OAUTH_CLIENT_ID`
- secret reference `GMAIL_OAUTH_CLIENT_SECRET`
- `AUTOMATION_OAUTH_REDIRECT_URI`
- a secure `OAuthSecretWriter` implementation backed by the approved Vault or
  Edge-secret mechanism
- per-mailbox ingestion and delivery token secret-reference names

### Microsoft Outlook / Microsoft 365

Ingestion uses Microsoft Graph v1.0 with `offline_access Mail.Read`. It starts or
resumes message delta, follows every `@odata.nextLink`, and stores only the final
`@odata.deltaLink` after persistence succeeds. Invalid/expired delta state
becomes `MAILBOX_RECONNECT_REQUIRED`.

Delivery is separate and uses `offline_access Mail.Send` with
`POST /me/sendMail`. Graph returns HTTP 202 without a message resource ID, so
the attempt ledger preserves the request idempotency key and truthfully leaves
`provider_message_id` null rather than fabricating one.

Provisioning dependencies:

- `MICROSOFT_OAUTH_CLIENT_ID`
- secret reference `MICROSOFT_OAUTH_CLIENT_SECRET`
- optional `MICROSOFT_OAUTH_TENANT` (default `common`)
- `AUTOMATION_OAUTH_REDIRECT_URI`
- the same approved secure token writer and per-mailbox token references

Concrete HTTP adapters are wired behind secure environment secret resolution.
No real provider is called until opaque token references resolve and the
relevant company and mailbox switches are deliberately enabled. OAuth token
writing remains fail-closed until an approved Vault/Edge-secret writer is
provisioned.

## Ingestion and storage

The sync cycle is limited to 100 provider pages and 5,000 messages. Provider
message identity is unique per mailbox. Attachments are SHA-256 deduplicated per
company. Cursor advancement occurs after all current-cycle messages,
attachments, and storage objects are durable.

Document processing is a separate durable, oldest-first backlog capped at 200
accepted attachments per worker cycle. Each attachment records
`pending | retryable | processed`; processing is not restricted to the latest
sync run, so a crash or an earlier cycle limit cannot strand already-persisted
content. Purged or unsafe content is never admitted to this backlog.

An already-persisted provider message is reused on retry so a prior crash cannot
prevent its missing attachments from being recovered. Duplicate messages and
attachments become idempotent, resolved audit exceptions and remain no-ops for
financial processing. Existing higher message lifecycle states are never
downgraded during duplicate recovery. A pre-upload SHA-256 check avoids
duplicate storage; a losing concurrent upload removes only its own noncanonical
object and never the canonical path.

Attachments reuse the private `ar-imports` bucket and existing company-first
storage policy. Paths are:

`<company_uuid>/automation/<mailbox_uuid>/<sha256>.<extension>`

The existing intake validator enforces extension allow-lists, MIME magic,
extension/content consistency, double-extension rejection, encrypted PDF
rejection, PDF active-content rejection, size/page limits, SHA-256, and bounded
retention. The persisted scan status is `unavailable` unless a scanner exists.
Gate E does not claim antivirus scanning is active.

The worker deletes at most 100 expired storage objects per cycle, then sets
`content_purged_at`; the source identity, hash, validation metadata, decisions,
commands, and audit lineage remain. A deletion failure is retained as a
retryable, redacted exception and does not mark content as purged.

## Document intelligence and deterministic validation

Classification schema version 1 supports:

- `invoice`
- `receipt`
- `payment_advice`
- `unsupported`
- `ambiguous`

Only invoice and receipt candidates may continue. The fixture provider is
deterministic. The production default provider is disabled. A future real
provider must implement the same schema-bound interface, bounded timeout, and
redacted failure contract.

Validation checks schema version, ISO dates, currencies, decimal strings,
positive/non-negative amounts, database-compatible precision bounds, due-date
order, line and subtotal/tax/total reconciliation, confidence thresholds, and
traceability. Decimal reconciliation uses `BigInt` scaled units, not binary
floating-point aggregation. Provider JSON, message pages, attachment fan-out,
metadata lengths, and OAuth responses are independently bounded before
persistence.

Before the existing governed Invoice/Receipt creation services receive a
numeric field, the automation boundary also proves that the validated decimal
string round-trips at its declared scale. Values that JavaScript would round
are rejected without creating a financial record.

Customer resolution is deterministic in this order:

1. exact customer code;
2. exact registration/tax identifier;
3. exact known customer email;
4. exact existing invoice reference;
5. exact normalized company name only when unique.

Ambiguous and unresolved candidates fail closed. Customers are never
auto-created and fuzzy matching never provides final authority. Resolution uses
bounded targeted database queries rather than a truncated customer roster.

## Financial command modes

- `disabled`: no sync, intelligence, financial mutation, or delivery.
- `observe_only`: may persist proposed decisions; no financial mutation.
- `draft_only`: validated supported candidates may use governed invoice/receipt
  draft creation. No posting or allocation.
- `straight_through`: reserved for separately authorized activation; only
  validated candidates may use governed creation/posting and evidence-backed
  auto-allocation.

An invoice candidate maps only to `doc_type=Invoice`; Gate E does not infer Debit
Notes. Tax-bearing invoice automation fails with `TAX_MAPPING_REQUIRED` until an
exact configured tax-code mapping exists. A receipt requires the mailbox's
tenant-validated `default_bank_account_id`. Both paths reuse existing governed
FX resolution. `automation_execute_invoice_command(...)` and
`automation_execute_receipt_command(...)` lock the idempotent command and
atomically create the governed draft, optionally post it, link the result, and
complete the command. A posting failure rolls the whole statement back; no
compensating draft deletion is used. A worker crash before that RPC leaves no
financial record and the stale claim becomes reclaimable after fifteen
minutes. Commands are SHA-256 idempotent across company, mailbox, provider
message, attachment hash, command type, and schema version.

The scheduled worker can synchronize ready mailboxes, process a bounded set of
accepted attachments, persist decisions, execute the same mode-governed command
path, evaluate reminders in each configured timezone, and deliver only through
a separately ready delivery mailbox. No scheduler job is installed.

## Reminders

The default stage offsets are `-3` and `0` calendar days. Only Invoice documents
with positive outstanding and an eligible non-terminal status are evaluated.
The current active sales representative and recipient email are mandatory.
Missing ownership/email produces `missing_salesman` or
`invalid_salesman_email`; no substitute employee is selected.

The logical reminder key is `(company_id, invoice_id, stage_offset_days)`.
Recipient, customer, invoice, due date, outstanding, and currency are snapshotted.
Attempts have unique idempotency keys, bounded retries, provider message IDs
where the provider returns one, and redacted retryable/permanent outcomes.

An attempt left in `sending` has an unconfirmed external outcome and blocks
automatic retry. This prevents a crash after provider acceptance from causing a
blind duplicate delivery.

Reminder content is text-only:

- customer name
- invoice number
- due date
- outstanding amount and currency
- instruction to contact the customer

It contains no attachment, bank credentials, statement, secret, or unnecessary
personal data. Evaluation and delivery have independent kill switches.

## Rollout prerequisites

1. Independent code/security/financial review.
2. Isolated database application of Migration 034 and rollback-only 034b smoke.
3. Provision approved secret resolver/writer without placing token values in
   application tables or Git.
4. Provision a dedicated `AUTOMATION_WORKER_SECRET` only when an external
   scheduler is separately authorized.
5. Deploy only the reviewed `automation` function.
6. Keep mode disabled; validate read APIs and fixture providers.
7. Configure one synthetic mailbox and observe-only mode in a separately
   authorized environment.
8. Validate cursor recovery, deduplication, exceptions, and zero financial DML.
9. Separately authorize draft-only, reminder evaluation, delivery, and
   straight-through activation. No activation is part of this implementation.

## Local validation

From `backend/supabase/functions`:

```powershell
deno test --node-modules-dir=auto --allow-read --allow-env gate_e_automation_contract_test.ts
deno check automation/index.ts gate_e_automation_contract_test.ts
deno lint automation gate_e_automation_contract_test.ts
deno fmt --check automation gate_e_automation_contract_test.ts
```

The same checks should be followed by every backend test file and strict checks
for all deployable Edge Function entry points. Local database verification
installs Migration 034 in repository order, executes 034b with
`ON_ERROR_STOP=1`, and proves zero fixture residue after its final `ROLLBACK`.
