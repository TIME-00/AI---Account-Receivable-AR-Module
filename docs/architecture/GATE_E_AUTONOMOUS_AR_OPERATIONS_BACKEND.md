# Gate E Autonomous AR Operations Backend

## Status and safety posture

Migrations 034 through 038 and Automation v18 are deployed to Production. Gate
E remains open in Draft Only: Gmail ingestion, the scheduler, document
intelligence, and governed Draft Invoice/Receipt creation are proven; delivery,
reminders, Auto-Allocation, and Straight-Through remain off. This document also
describes local prospective Migrations 039 and 040, which have not been
committed, pushed, applied, deployed, or activated.

Every company starts with no `automation_settings` row, which the API interprets
as `disabled` with every derived capability off. Inserted settings also default to
`disabled`. Mailboxes default disabled and disconnected. Straight-through mode
requires a Finance Manager, the exact activation confirmation, an existing
tenant-bound automation actor, and an atomically derived capability profile. No activation is
performed by this implementation.

Changing a mode does not invent provider readiness. Ingestion, reminder
delivery, and document intelligence are independent runtime capabilities; each
remains fail-closed until its profile and prerequisites are satisfied.

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
- Migration 035 uses the project's existing Supabase Vault facility. Three
  service-role-only, tenant/mailbox/provider/capability-bound RPCs write,
  resolve, rotate, and delete the versioned OAuth token bundle. Normal users
  have no table/view/RPC path to decrypted Vault data. Opaque references are
  globally guarded against cross-mailbox and cross-capability reuse.
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
secret reference. The resolved bundle must contain non-blank access and refresh
tokens, a current semantic expiry, and the exact provider scope for that
capability. Missing/unavailable secrets and invalid/expired token metadata
produce `false`; no token, scope list, or reference name is returned.

Migration 035 also binds each Vault record's description to the exact
company-owned mailbox/provider/capability context. A pre-existing unrelated
Vault secret with a colliding name cannot be overwritten, resolved, or deleted
through the Gate E RPCs.

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

Forward-only Migration `database/035_gate_e_secure_oauth_vault.sql` requires the
already-approved `supabase_vault` extension and installs only:

- a cross-capability opaque-reference uniqueness trigger and partial indexes;
- `automation_oauth_secret_write(...)` for initial persistence and rotation;
- `automation_oauth_secret_resolve(...)` for server-side token use; and
- `automation_oauth_secret_delete(...)` for local disconnect/revocation.

All three RPCs are `SECURITY DEFINER`, owned by `postgres`, have an empty fixed
`search_path`, validate the mailbox tenant/provider/capability/reference, and
grant execution only to `service_role`. Tokens remain encrypted in Vault and
never enter `automation_mailboxes`, audit metadata, public DTOs, or logs.
Migration 035 installs no settings, mailbox, provider credential, cron job, or
financial/business DML. `035b` is rollback-only local smoke coverage.

The Edge Function exposes a bounded `POST /worker/run` integration point for a
scheduler. It is protected by a dedicated constant-time-checked worker secret,
does not accept tenant authority in the request, and derives each company and
acting Finance Manager/AR Supervisor from `automation_settings`. The cycle
bounds companies to 100, enabled ingestion mailboxes to 100, attachment work to
200, reminder delivery work to 200, provider pages/messages, and retries. With
no worker secret or no non-disabled tenant settings it fails closed or performs
no work.

Forward-only Migration `database/036_gate_e_secure_scheduler.sql` implements
the repository-owned scheduler infrastructure with Supabase `pg_cron`,
`pg_net`, and Vault. It does **not** provision a secret, install a recurring
job, invoke the worker, or mutate financial/business data when applied. A
postgres-only installer creates or replaces one stable
`gate-e-automation-worker` job on `*/10 * * * *`; a postgres-only remover
unschedules only that name. The job command contains only
`SELECT public.automation_scheduler_invoke();`, never a credential.

The invocation function has no arguments and fixes the trusted HTTPS target to
the deployed `POST /functions/v1/automation/worker/run` route, the JSON body to
`{}`, the timeout to 120 seconds, and the header name to
`X-Automation-Worker-Secret`. It resolves exactly one bounded base64url-style
secret named `AUTOMATION_WORKER_SECRET` with description
`Gate E Automation worker scheduler secret`. A missing, duplicate, blank,
malformed, or incorrectly described secret fails closed before `pg_net` is
called. The same random value must later be provisioned into the Automation
Edge environment and this Vault record; two independent secrets are invalid.

`pg_net` necessarily places request headers briefly in its unlogged internal
request queue. Supabase owns that extension surface and its default SQL ACLs
cannot be safely rewritten by the normal migration role. Migration 036
therefore never queues the reusable worker secret. It derives a three-minute
HMAC-SHA-256 authorization token containing an issuance time and random UUID
nonce, places only that token in `X-Automation-Worker-Secret`, clears local
plaintext variables, and leaves the root value in Vault. The Edge boundary
validates the signature/time window with its copy of the same root secret and
claims the nonce once through a service-role-only RPC before any work. Replay,
expiry, future timestamps, malformed tokens, and signature changes fail closed.

The existing controlled server-side operator path may still present the exact
dedicated Edge secret directly; the database scheduler never does so. A user
JWT cannot substitute for either authentication form.

The reviewed Data API exposes only `public` and `graphql_public`, never `net`,
`cron`, or the API-inaccessible `gate_e_internal` schema. No public RPC returns
pg_net/cron metadata, the response table contains no request header, and no raw
worker response is copied into a public/application table. Production preflight
must verify the exposed-schema list remains exact before scheduler installation.

The worker also acquires a service-role-only database lease before processing.
The lease lives in an API-inaccessible internal schema, expires after eight
minutes, and is released with only a bounded completed/failed outcome. A
concurrent call returns the existing zero-work response shape. The ten-minute
cadence is longer than the lease and hosted Edge maximum request duration,
while remaining sufficient for academic/demo mailbox polling, due reminders,
and retries. Item-level idempotency and database-authoritative financial
commands remain the final duplicate-effect boundary.

`036b_gate_e_secure_scheduler_smoke_tests.sql` is rollback-only and must never
run in Production. It proves catalog/grant contracts, fail-closed missing-secret
behavior, lease exclusion, idempotent installation, scoped removal, and the
exact queued pg_net request. Because the entire smoke transaction rolls back,
the synthetic cron and HTTP-queue rows cannot be executed or leave residue.

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
- `GMAIL_OAUTH_REDIRECT_URI`, exactly the Gmail callback path
- runtime `SUPABASE_URL`; the redirect origin must match it exactly
- fixed HTTPS `AUTOMATION_FRONTEND_ORIGIN` for browser callback return
- deployed Migration 035 Vault RPCs
- a per-mailbox ingestion token reference; Delivery setup provisions its own
  collision-safe opaque reference when absent

The Production Gmail value must be exactly
`https://kusseuycqgdilychphpq.supabase.co/functions/v1/automation/oauth/gmail/callback`.

The Gmail callback accepts Google's exact RFC 9207 authorization-response
issuer `https://accounts.google.com`. A returned Google Workspace `hd` value is
validated only as a bounded DNS domain hint and is never used for tenant,
company, mailbox, customer, or authorization decisions. Arbitrary issuers,
malformed hosted domains, duplicate parameters, and all other unknown callback
parameters remain fail-closed.

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
- `MICROSOFT_OAUTH_REDIRECT_URI`, exactly the Microsoft callback path
- runtime `SUPABASE_URL`; the redirect origin must match it exactly
- the same approved Vault store and per-mailbox token references

The Production Microsoft value must be exactly
`https://kusseuycqgdilychphpq.supabase.co/functions/v1/automation/oauth/microsoft/callback`.

OAuth initiation and completion validate the same exact provider-specific
redirect. The callback is authorized by the hashed, 256-bit, ten-minute,
single-use state created by the authenticated start route; it does not depend
on browser authorization headers that Google or Microsoft will not return.
Wrong-provider, changed-redirect, expired/reused-state, missing code/state,
provider-denial, exchange, and Vault-write failures are sanitized and fail
closed. A refresh within five minutes of expiry uses the refresh token, rotates
the Vault bundle, and updates only safe expiry metadata. A revoked credential
sets reconnect-required; a transient provider/Vault outage does not expose or
erase token material. Disconnect deletes the Vault value before disabling and
clearing expiry metadata.

Post-Gate-E Delivery onboarding adds a server-authored OAuth intent. The single
`Enable delivery` business action resolves an existing valid token directly or
starts consent with `enable_delivery`; `Reconnect delivery` uses the distinct
`reconnect_delivery` intent. Both remain actor-, company-, mailbox-, provider-,
capability-, scope-, expiry-, and single-use-bound. After token exchange, the
service-only Migration 042 finalizer atomically writes the versioned Vault
bundle and enables Delivery. The browser callback redirects only to the fixed
Mailboxes page. Delivery reconnect health is separate from ingestion reconnect
health, so a revoked send credential fails Reminder Delivery closed without
resetting Gmail history or disabling mailbox ingestion.

Microsoft consent requests `offline_access`, while the returned access-token
scope is checked independently for `Mail.Read` or `Mail.Send`. Initial
completion proves offline authority from the returned refresh token and only
then adds the normalized `offline_access` marker to the Vault bundle; it does
not incorrectly require the access-token scope string to echo that marker.

Concrete Gmail/Microsoft HTTP adapters are wired behind secure environment and
Vault resolution. No real provider is called until the relevant company and
mailbox switches are deliberately enabled and the exact token bundle resolves.

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

Only invoice and receipt candidates may continue. The fixture provider remains
deterministic and test-only. The selected Production-minded provider is the
OpenAI Responses API at `POST https://api.openai.com/v1/responses`, using
`gpt-5.6-luna` by default. The Edge-only `OPENAI_API_KEY` secret is mandatory;
`OPENAI_DOCUMENT_MODEL` may supply a defensively validated server-side model
override. Neither value is accepted from a browser request or persisted in an
application table.

The direct HTTPS adapter sends only already-validated PDF, PNG, JPEG, or WebP
bytes as bounded Base64 `input_file`/`input_image` data. It never supplies an
arbitrary provider-fetchable URL. PDF detail and image detail are `low`, output
is capped at 12,000 tokens, the response body is capped at 1 MiB, and one
request has a 25-second timeout. At most one retry is permitted for `429`,
selected `5xx`, or a transient network failure; timeout, authentication,
malformed input, refusal, incomplete output, and schema failure fail closed.
No tools are enabled and `store` is false.

The request uses Responses API Structured Outputs with `strict: true`, a root
object, required fields, nested `additionalProperties: false`, bounded arrays,
and the existing document-class enum. Provider output cannot contain tenant,
customer-ID, FX, SQL, posting, or allocation authority. Fixed instructions say
that file/OCR content is untrusted data and that embedded directions must never
be followed. The validated normalized candidate alone is persisted; raw OpenAI
requests, file bytes, response bodies, API response IDs, and authorization data
are not logged, audited, or stored.

OpenAI does not expose a calibrated probability for this structured extraction.
The adapter therefore does not invent one: it maps conservative model-declared
`classification_confident` and `critical_fields_confident` policy gates to the
legacy internal numeric values `1` or `0`. Uncertain fields similarly map to
`0`. These are explicitly non-probabilistic gates, after which the existing
threshold, schema, date, decimal, arithmetic, customer-resolution, duplicate,
and financial-authority checks remain mandatory.

The provider is instantiated only when `OPENAI_API_KEY` is nonblank and bounded
and the configured model name passes deterministic validation. Overview makes
no OpenAI request. Missing or invalid configuration selects
`DisabledDocumentIntelligenceProvider`, so `document_intelligence_ready` stays
false. Production is still running the prior disabled deployment because this
adapter is local and unreviewed.

Financial/business document bytes are sent server-side to OpenAI after the
existing intake safety checks. OpenAI states that API inputs and outputs are not
used to train its models by default; this integration does not claim zero
retention, Malaysian data residency, or regulatory compliance. See
https://openai.com/business-data/ and the applicable OpenAI API terms/data
controls before activation.

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
The provider-facing candidate remains named `customer_code`, while the legacy
PostgreSQL business-code column is `customers.customer_id`; the runtime query
maps between those two names explicitly and returns the immutable customer UUID
as financial authority. Persisted customer-resolution failures may re-enter
this deterministic resolver without another provider request, including a
sanitized internal failure caused before customer authority was established.
Recovery also re-runs the deterministic financial-identifier conflict check
before the persisted extraction can become valid.

## Financial command modes

- `disabled`: no sync, intelligence, financial mutation, or delivery.
- `observe_only`: may persist proposed decisions; no financial mutation.
- `draft_only`: validated supported candidates may use governed invoice/receipt
  draft creation. No posting or allocation.
- `straight_through`: reserved for separately authorized activation; only
  validated candidates may use governed creation/posting and evidence-backed
  auto-allocation.

Migration 039 makes these modes backend-authoritative profiles. It derives all
five persisted document capability booleans in one row trigger and backs them
with exact CHECK constraints; clients cannot PATCH the raw booleans. Reminder
Automation is a separate `off | evaluate_only | automatic_delivery` profile.
Evaluation is independent from document mode, while Automatic Delivery is
atomically refused unless the delivery mailbox/credential is ready. Finance
Manager authority remains required to arm either active profile; System Admin
can configure policy or turn profiles off but cannot arm financial execution.

Provider-declared confidence is not independent evidence that a financial
identifier was transcribed exactly. Identifier authority is therefore applied
at the decision it can authorize rather than treating every optional reference
as financial identity. `invoices.invoice_no` and `receipts.receipt_no` are
generated by the governed financial services and remain the authoritative
internal identities. Extracted Invoice supplier references and Receipt payment
references are optional external metadata. They remain subject to exact,
company/customer-bound duplicate checks, but do not select the tenant,
customer, internal document number, match, allocation, posting, FX, or journal.

Receipt-to-Invoice candidates first become positive financial authority during
automatic matching/allocation, after the otherwise valid Receipt has been
created. At that stage every explicit candidate must resolve exactly and
uniquely to an eligible PostgreSQL Invoice by either its governed internal
`invoice_no` or external/source `reference_no`, inside the authenticated
company, resolved customer, currency, eligible-status, and positive-outstanding
boundary. The external value is lookup evidence, not a primary key or
provider-selected Invoice id. Zero matches, multiple matches, or distinct
references collapsing onto one Invoice withhold allocation and create one idempotent
`critical_identifier_unverified` exception; it does not undo the safely created
Receipt and no candidate value is copied into exception metadata. An extraction
without explicit Invoice references may use the existing unambiguous exact-
amount allocation rule. Draft Only remains unposted and unchanged. No match
uses fuzzy, edit-distance, subject-line, or provider-confidence authority.

Separate documents processed by the same provider can reveal a deterministic
conflict (for example `GATEE...` in a Receipt candidate versus `GATE...` in an
Invoice candidate), but that comparison is not source-text independence and
cannot authorize either value. It is evidence to fail closed, not evidence to
auto-correct. A clean Receipt reference such as `SUPPLIER-INV-123` may proceed
only when the backend and allocation RPC both resolve it uniquely to the same
eligible Invoice; PostgreSQL rechecks scope and outstanding capacity before
allocating any amount.

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

Duplicate provider messages and attachments create resolved no-op exception
evidence through the partial unique index on `(company_id, idempotency_key)`.
Because PostgREST cannot infer that partial index through a bare `on_conflict`
column list, the runtime performs a normal insert and suppresses only SQLSTATE
`23505` naming `uq_automation_exception_idempotency`. Every other database
error remains fail-closed.

Exception collection reads enrich each tenant-scoped row with a bounded
monitoring projection from its linked attachment and latest classification:
file name, document type, processing status, classification status, and an
explicit manual-review flag. It does not expose document bytes, raw extracted
fields, provider bodies, or credentials.

Migration 040 adds an immutable, service-role-only recovery authority for
`critical_identifier_unverified`. A Finance Manager can either correct only a
posted Invoice external `reference_no` through the existing governed/audited
correction RPC, or confirm one eligible Invoice as the intended Receipt match.
Neither action changes the immutable extraction. The restricted recovery read
uses current same-company/customer/currency/status/outstanding records and
authenticated no-store source-document streams; the generic exception DTO
stays redacted. Retry Matching acquires deterministic locks, revalidates the
selected financial records and Straight-Through profile, derives the amount as
the lesser of current Receipt unallocated and Invoice outstanding, invokes the
existing allocator, and resolves the Exception idempotently. Human review may
supply relationship authority, but never tenant, amount, FX, posting, journal,
or SQL authority.

The scheduled worker can synchronize ready mailboxes, process a bounded set of
accepted attachments, persist decisions, execute the same mode-governed command
path, evaluate reminders in each configured timezone, and deliver only through
a separately ready delivery mailbox. No Gate E scheduler job is installed yet.

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
personal data. Evaluation and delivery are derived from the single high-level
Reminder Automation mode, not independently editable kill switches.

## Rollout prerequisites

1. Independently review this local Migration 035 and Edge remediation.
2. Apply Migration 035 once and deploy only the reviewed `automation` function.
3. Independently review the selected local OpenAI Responses API document
   adapter, then provision `OPENAI_API_KEY` through Supabase Edge secrets only.
4. Provision mailbox provider client IDs/secrets and the exact provider-specific
   callback URIs, then perform human consent with least-privilege scopes.
5. Independently review Migration 036 and its rollback-only 036b smoke, then
   apply only 036. Generate one 48-byte random base64url secret in an approved
   secret manager without terminal output; place that same value in the
   Automation Edge secret `AUTOMATION_WORKER_SECRET` and the Vault record named
   `AUTOMATION_WORKER_SECRET` with description
   `Gate E Automation worker scheduler secret`.
6. As postgres, call `public.automation_scheduler_install()` only after both
   secure stores hold the same value; verify exactly one active named job and
   confirm the Production Data API still excludes `net`, `cron`, and
   `gate_e_internal`. Use
   `public.automation_scheduler_remove()` to disable scheduling without deleting
   the Vault secret or any business/audit data.
7. Keep mode disabled; validate read APIs and authenticated Production UI.
8. Configure one synthetic mailbox and observe-only mode in a separately
   authorized environment.
9. Validate cursor recovery, deduplication, exceptions, and zero financial DML.
10. Separately authorize draft-only, reminder evaluation, delivery, and
   straight-through activation. No activation is part of this implementation.

## Local validation

From `backend/supabase/functions`:

```powershell
deno test --node-modules-dir=auto --allow-read --allow-env gate_e_automation_contract_test.ts
deno test --node-modules-dir=auto --allow-read --allow-env gate_e_activation_prerequisites_test.ts
deno test --node-modules-dir=auto --allow-read --allow-env gate_e_openai_document_test.ts
deno test --node-modules-dir=auto --allow-read --allow-env gate_e_scheduler_contract_test.ts
deno check automation/index.ts gate_e_automation_contract_test.ts gate_e_activation_prerequisites_test.ts gate_e_openai_document_test.ts gate_e_scheduler_contract_test.ts
deno lint automation gate_e_automation_contract_test.ts gate_e_activation_prerequisites_test.ts gate_e_openai_document_test.ts gate_e_scheduler_contract_test.ts
deno fmt --check automation gate_e_automation_contract_test.ts gate_e_activation_prerequisites_test.ts gate_e_openai_document_test.ts gate_e_scheduler_contract_test.ts
```

The same checks should be followed by every backend test file and strict checks
for all deployable Edge Function entry points. Local database verification
installs through Migration 036 in repository order, executes the 034b, 035b,
and 036b rollback-only smokes with `ON_ERROR_STOP=1`, and proves zero fixture
residue after their final `ROLLBACK`.
