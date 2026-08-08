# Gate E Automation API Contract

Base Edge Function path: `/automation`

All user routes except the provider callback require the normal bearer token
plus `X-Company-Id`. The authenticated role binding is authoritative; a
body/query `company_id` or `user_id` is not accepted as business authority.
The provider callback is instead authorized by the provider-specific route and
the hashed, 256-bit, one-time state created by an authenticated OAuth-start
request. The frozen contract version is `gate-e.1`. Success responses use:

```json
{
  "success": true,
  "data": {},
  "contract_version": "gate-e.1"
}
```

Errors use the same versioned boundary:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body does not match the automation contract.",
    "details": {}
  },
  "contract_version": "gate-e.1"
}
```

Collections add:

```json
{
  "meta": {
    "page": 1,
    "page_size": 25,
    "total": 0,
    "has_more": false
  }
}
```

`page_size` defaults to 25 and is capped at 100. Ordering is descending
`created_at, id` except sales representatives (`name, id` ascending), ownership
history (`assigned_at, id` descending), and reminders (`scheduled_for, id`
descending). Empty collections return `data: []`, `total: 0`.

## Frozen routes

| Route | Method | Permission | Request / filters | Response |
|---|---|---|---|---|
| `/overview` | GET | AR Supervisor, Finance Manager, Auditor | none | bounded counts plus settings |
| `/settings` | GET | operational roles, Auditor, System Admin | none | complete settings; absent row returns disabled defaults |
| `/settings` | PATCH | Finance Manager or System Admin; Finance Manager for non-disabled modes | supported settings only; `straight_through` requires exact `activation_confirmation` | settings row with server-bound automation actor |
| `/sales-representatives` | GET | operational roles, Auditor, System Admin | `page`, `page_size`, optional `is_active` | sales representatives |
| `/sales-representatives` | POST | AR Supervisor or Finance Manager | `name`, normalized `email`, E.164 `phone`, optional `is_active` | created representative |
| `/sales-representatives/:id` | PATCH | AR Supervisor or Finance Manager | mutable contact/active fields | updated representative |
| `/customers/:id/sales-representative` | GET | AR Clerk, AR Supervisor, Finance Manager, Auditor with existing customer-access scope | none | current assignment or `null` |
| `/customers/:id/sales-representative/assign` | POST | AR Supervisor or Finance Manager | `sales_representative_id`, exact `assignment_source`, mandatory `reason` | `{changed,current}` where `current` is the normalized current-owner DTO |
| `/customers/:id/sales-representative/history` | GET | AR Clerk, AR Supervisor, Finance Manager, Auditor with existing customer-access scope | pagination | immutable assignment history |
| `/mailboxes` | GET | Finance Manager, Auditor, System Admin | pagination; optional exact `provider_type`/`connection_status` | redacted mailbox metadata; never tokens |
| `/mailboxes` | POST | Finance Manager or System Admin | provider, mailbox address, secret-reference names, optional default bank account | disabled mailbox |
| `/mailboxes/:id` | PATCH | Finance Manager or System Admin | bank mapping, opaque secret-reference names, and enable switches only | updated readiness; enablement fails until the capability is connected |
| `/mailboxes/:id/oauth/start` | POST | Finance Manager or System Admin | `{capability:"ingestion"|"delivery"}` | `{provider,authorization_url,expires_at,capability}` with a fixed provider origin |
| `/mailboxes/:id/oauth/disconnect` | POST | Finance Manager or System Admin | `{capability:"ingestion"|"delivery"|"all"}` | redacted mailbox DTO after Vault deletion and capability disablement |
| `/oauth/:provider/callback` | GET | one-time state created by Finance Manager or System Admin | provider `code` and `state`, or bounded provider `error` and `state`; browser bearer/company headers are not required | readiness metadata or sanitized denial; never token values |
| `/mailboxes/:id/sync` | POST | AR Supervisor or Finance Manager | no body authority | completed run or fail-closed provider error |
| `/runs` | GET | AR Supervisor, Finance Manager, Auditor | pagination and exact `status`/`provider_type` | sync runs |
| `/documents` | GET | AR Supervisor, Finance Manager, Auditor | pagination and exact `document_type`/`status` | classifications with bounded attachment metadata and nullable extraction |
| `/documents/:attachmentId/process` | POST | AR Supervisor or Finance Manager | none | classification/extraction decision |
| `/extractions/:id/command` | POST | AR Clerk or higher operational role | none | idempotent proposed/completed/refused command |
| `/commands` | GET | AR Supervisor, Finance Manager, Auditor | pagination and exact `status`/`command_type` | commands |
| `/commands/:id/allocate` | POST | AR Clerk, AR Supervisor, Finance Manager | exact empty JSON object; receipt, evidence, and allocations are re-derived from the immutable command/extraction | DB-authoritative allocation result |
| `/exceptions` | GET | AR Supervisor, Finance Manager, Auditor | pagination and exact `lifecycle_status`/`reason_code` | exception queue |
| `/exceptions/:id/retry` | POST | AR Supervisor or Finance Manager | none | re-opened retryable exception |
| `/exceptions/:id/resolve` | POST | AR Supervisor or Finance Manager | `{resolution_note}` | resolved exception |
| `/exceptions/:id/dismiss` | POST | AR Supervisor or Finance Manager | `{resolution_note}` | dismissed exception |
| `/reminders/evaluate` | POST | AR Supervisor or Finance Manager | `{evaluation_date:"YYYY-MM-DD"}` | created/exception counts; no send |
| `/reminders/:id/deliver` | POST | AR Supervisor or Finance Manager | `{mailbox_id}` | delivery attempt; all kill switches/readiness enforced |
| `/reminders` | GET | AR Supervisor, Finance Manager, Auditor | pagination; exact `status`; optional exact `invoice_id` | tenant- and Invoice-bound reminders |
| `/reminder-attempts` | GET | AR Supervisor, Finance Manager, Auditor | pagination; exact `status`/`provider_type`; optional exact `reminder_id` | bounded attempts for one authorized reminder or the tenant list |
| `/audit` | GET | AR Supervisor, Finance Manager, Auditor | pagination; optional bounded `event_type`, `entity_type`, UUID `entity_id`, and `actor_type=user|system|provider` | immutable, entity-scoped, allowlisted audit timeline |
| `/worker/run` | POST | dedicated `X-Automation-Worker-Secret` only | scheduler sends exact `{}`; no tenant/body authority is consumed | one bounded scheduled cycle governed by each tenant's actor, lease, and kill switches |

No route accepts raw OAuth tokens, access/refresh tokens, provider authorization
headers, client-computed financial totals, SQL, tenant inference, or AI-selected
customer IDs.

## Worker scheduler contract

The repository-owned scheduler boundary is installed by unapplied local
Migration 036 and does not change `gate-e.1` user DTOs. Migration application
alone does not create a cron job or Vault credential. Later activation requires
one operator-generated 48-byte random base64url value to be stored under the
same `AUTOMATION_WORKER_SECRET` identity in both secure locations:

- Automation Edge secret name: `AUTOMATION_WORKER_SECRET`;
- Vault name: `AUTOMATION_WORKER_SECRET`;
- Vault description: `Gate E Automation worker scheduler secret`.

The postgres-only `automation_scheduler_install()` operation fails unless the
single Vault value exists and is 43–128 base64url characters. It serializes
installation, removes only prior jobs named `gate-e-automation-worker`, and
creates exactly one active `*/10 * * * *` job whose command contains no secret.
`automation_scheduler_remove()` unschedules only that stable job name and does
not delete the Vault record or business data. Neither operation is executable
by `PUBLIC`, `anon`, `authenticated`, or `service_role`.

Each tick calls the no-argument postgres-only
`automation_scheduler_invoke()`. Its target, method, headers, body, and timeout
are fixed server-side: HTTPS Automation worker URL, `POST`, JSON content type,
`X-Automation-Worker-Secret`, `{}`, and 120 seconds. It accepts no caller URL,
header, secret name, tenant, company, or payload. Missing/ambiguous/blank/
malformed Vault material fails before a network request.

The pg_net request queue never contains the reusable Vault/Edge root secret.
The header carries `v1.<issued_epoch>.<uuid_v4_nonce>.<hmac_sha256_hex>`, where
the HMAC message is the fixed Gate E worker context plus issuance time and
nonce. Tokens older than three minutes, more than 30 seconds in the future,
malformed/tampered signatures, and reused nonces are rejected before work. The
nonce is claimed through a service-role-only RPC in an API-inaccessible schema.
The reviewed Supabase Data API exposes only `public` and `graphql_public`, not
`net`, `cron`, or `gate_e_internal`; no public function returns scheduler,
request-queue, root-secret, or raw-response data.

For compatibility with the already-reviewed worker boundary, a controlled
server-side operator invocation may authenticate with the exact dedicated Edge
secret. The database scheduler never uses that form: it always sends the
short-lived signed token above. Neither form is a user JWT or browser contract.

The Edge worker uses service-role-only `automation_worker_nonce_claim(uuid,
timestamptz)`, `automation_worker_lease_acquire(uuid)`, and
`automation_worker_lease_release(uuid,boolean)` RPCs. One eight-minute lease
exists in an API-inaccessible internal schema. An overlapping call performs no
work and returns the normal bounded zero-count worker data; stale leases expire.
The request still derives all eligible tenants and actors from stored settings.
It accepts no company parameter and the worker secret is never returned in a
success/error envelope, DTO, audit event, or log.

System Admin is configuration-only. It may read/update settings within the
limits above, read/create/update mailbox configuration, start/disconnect OAuth,
and read the sales-representative directory. A callback completes only a state
that one of those authorized users already created. System Admin cannot read overview, runs,
documents, commands, exceptions, reminders, attempts, audit, or customer
ownership. AR Clerk access remains limited to the explicitly documented
customer-scoped reads and command/allocation operations.

## Operating settings

Exact values:

```text
operating_mode:
  disabled | observe_only | draft_only | straight_through

kill switches:
  mailbox_sync_enabled
  document_intelligence_enabled
  invoice_automation_enabled
  receipt_automation_enabled
  auto_allocation_enabled
  reminder_evaluation_enabled
  reminder_delivery_enabled
```

Changing to any non-disabled mode binds `automation_actor_user_id` to the
authenticated Finance Manager. `straight_through` additionally requires:

```json
{
  "operating_mode": "straight_through",
  "activation_confirmation": "ENABLE_STRAIGHT_THROUGH"
}
```

Migration 034 creates no settings rows and activates no mode, provider,
scheduler, allocation, or delivery switch.

Accepting the Finance Manager's exact `straight_through` confirmation changes
only the tenant operating-mode setting. It does not prove ingestion, delivery,
or document-intelligence readiness and it does not bypass a kill switch. Every
worker operation rechecks its own capability at runtime and fails closed when
its enabled mailbox, opaque token, expiry metadata, adapter, or provider is not
ready.

Confidence values are JSON numbers in both the synthetic default object and a
persisted row. Reminder offsets and `extraction_schema_version` are JSON
integers; switches are JSON booleans.

## Overview readiness

`ingestion_ready` and `delivery_ready` are independent tenant-scoped booleans;
there is no generic `provider_ready` field. A capability is `true` only when at
least one mailbox is enabled, connected, not reconnect-required, has that exact
capability enabled, has current semantically valid token-expiry metadata, has a
ready provider adapter, and its matching opaque secret reference resolves to a
strict, unexpired `gate-e-oauth.1` token set through the service-role-only Vault
resolver. That resolved set must contain non-blank access and refresh tokens and
the exact provider scope required for the requested capability. A missing mailbox, disabled
switch, absent/unresolvable secret, expired or invalid timestamp, reconnect
state, unknown provider, disabled adapter, or resolver failure returns `false`.
The readiness calculation never returns the token, reference name, provider
response, scope list, cursor, or resolver error.

`document_intelligence_ready` is separate and reports only whether the bounded
server-side document provider adapter is concretely configured and enabled. The
selected local adapter is OpenAI Responses API. It is enabled only when the
Edge-only `OPENAI_API_KEY` is present and passes bounded validation and the
server-side `OPENAI_DOCUMENT_MODEL` value (default `gpt-5.6-luna`) is valid.
Missing or malformed configuration selects the disabled adapter. Overview does
not call OpenAI merely to calculate readiness. No readiness field activates a
mode or kill switch.

## Document-intelligence provider boundary

The selected Production-minded provider contract is:

- endpoint: `POST https://api.openai.com/v1/responses`;
- default model: `gpt-5.6-luna`;
- required Supabase Edge secret: `OPENAI_API_KEY`;
- optional server-side override: `OPENAI_DOCUMENT_MODEL`;
- supported intake: already-validated PDF, PNG, JPEG/JPG, and WebP only;
- transport: bounded direct Base64 `input_file` or `input_image`, never a
  user-controlled URL;
- timeout: 25 seconds;
- attempts: at most two total, with one fixed bounded retry only for `429`,
  selected `5xx`, or a transient network failure;
- output cap: 12,000 tokens and a 1 MiB HTTP response-body limit;
- tools: none;
- provider storage request: `store: false`.

The request uses Responses API `text.format` Structured Outputs with
`type=json_schema`, `strict=true`, required fields, nested
`additionalProperties=false`, and only the frozen document types `invoice`,
`receipt`, `payment_advice`, `unsupported`, and `ambiguous`. The schema contains
candidate customer text but no `company_id`, `tenant_id`, authoritative
`customer_id`, FX rate, SQL, posting status, allocation, or payment-application
authority.

OpenAI does not provide a calibrated probability for this structured
extraction. The internal provider result therefore uses conservative
model-declared policy gates, not probability claims:

- `classification_confident=true` maps to internal confidence `1`; false maps
  to `0`;
- `critical_fields_confident=true` maps to internal critical confidence `1`;
  false maps to `0`;
- each declared uncertain field maps to field confidence `0`.

These values feed the existing fail-closed threshold contract. They never
override strict parsing, semantic date/decimal validation, arithmetic
reconciliation, deterministic customer resolution, duplicate checks, operating
mode, kill switches, PostgreSQL posting, FX, or allocation authority.

The provider response is not a public API DTO. Only the existing normalized
document-decision DTO is returned to clients. Raw file bytes, prompts, provider
responses, response IDs, API keys, authorization headers, and document text are
never returned or included in audit/error metadata. Provider refusals,
incomplete results, malformed output, authentication failures, timeouts, and
exhausted retries use fixed sanitized errors.

## Automatic allocation request

```json
{}
```

The authenticated client supplies no receipt, invoice, amount, evidence, tenant,
or user authority. The service loads the completed automated Receipt command
and its immutable extraction, re-derives the candidate invoices, and constructs
the internal allocation request. Any additional request-body field is rejected.

The command must be `command_type=create_receipt`, `status=completed`, have a
non-null `resulting_receipt_id`, and retain a valid stored Receipt extraction.
`allocate_receipt` commands, proposed/pending/failed `create_receipt` commands,
and completed commands without a resulting Receipt are refused with
`ALLOCATION_EVIDENCE_INSUFFICIENT`. An idempotent replay returns the same
database result without duplicating allocation rows.

Successful allocation data is exactly:

```json
{
  "command_id": "10000000-0000-4000-8000-000000000001",
  "receipt_id": "10000000-0000-4000-8000-000000000002",
  "allocated_count": 1,
  "total_allocated": "100.00",
  "receipt_status": "Fully Allocated"
}
```

The internally derived `evidence_type` is exactly
`exact_invoice_reference | exact_amount_single_invoice |
explicit_partial_reference | explicit_multi_invoice_references`. The Edge layer
does not calculate FX or authoritative financial totals. The database verifies
the immutable extraction linkage, derives the idempotency key, locks the receipt
and target invoices, validates the source command and booked-FX authority,
proves the reference or unique exact-amount evidence, enforces same
customer/currency and full amount reconciliation, and then invokes the existing
authoritative allocation transaction.

## Frozen response records

All database identifiers are canonical PostgreSQL UUID strings: exactly
8-4-4-4-12 hexadecimal characters with hyphen separators, without imposing an
application-level RFC version or variant nibble. The scheduler authorization
nonce remains a separately defined UUIDv4 security token. Timestamp inputs use
an exact ISO-8601 date/time with `Z` or an offset no greater than `+/-14:00`; the DTO
validates Gregorian date components, 00-23 hours, 00-59 minutes/seconds, and
offset bounds before returning canonical UTC. Dates are real `YYYY-MM-DD`
Gregorian calendar dates, including leap-year validation. Impossible values
are rejected rather than normalized. Decimal values are base-10 strings
matching `^-?(?:0|[1-9][0-9]*)(?:\.\d+)?$`; currency is `^[A-Z]{3}$`;
SHA-256/idempotency keys are 64 lowercase hexadecimal characters; email is a
normalized bounded address; phone is nullable E.164. OAuth authorization URLs
are HTTPS and use only `accounts.google.com/o/oauth2/v2/auth` or
`login.microsoftonline.com/{configured-tenant}/oauth2/v2.0/authorize`.
Reminder monetary snapshots are normalized to decimal strings by the Edge
contract. Nullable fields are returned as JSON `null`; fields are not fabricated
by the Edge Function.

- Settings: `company_id`, `automation_actor_user_id`, `operating_mode`, all
  seven kill-switch booleans, `reminder_stage_offsets`, `reminder_timezone`,
  `extraction_schema_version`, both confidence thresholds, audit timestamps and
  actor IDs.
- Sales representative: `id`, `company_id`, `name`, normalized `email`, E.164
  `phone`, `is_active`, audit timestamps and actor IDs. It has no auth-user or
  financial-role field.
- Assignment: `id`, `company_id`, `customer_id`,
  `sales_representative_id`, `assignment_source`, `assigned_by`,
  `assigned_at`, `assignment_reason`, `superseded_at`, `superseded_by`,
  `created_at`. Current-owner responses add the nested sales representative.
- Mailbox: identity/provider/address, tenant bank mapping,
  `connection_status`, `ingestion_secret_configured` and
  `delivery_secret_configured`, separate token expiries, `cursor_kind` and
  `cursor_present`, sync timestamps, reconnect state, three enable flags, and
  redacted error code. Secret-reference names, raw cursors, and tokens never
  appear.
- Sync run: identity/provider, `[redacted]`/null cursor-presence indicators,
  lifecycle timestamps, `messages_discovered`, `messages_persisted`,
  `attachments_discovered`, `attachments_persisted`, duplicate counts,
  trigger-measured `attachments_processed`, `commands_processed`,
  `allocations_completed`, `failures`, bounded attempt counts, and redacted
  error code. `attachments_discovered` is persisted plus duplicate attachments;
  unmeasured counters are never synthesized.
- Document decision: classification identity, schema/provider/model versions,
  exact type/confidence/status/trace and timestamp, plus a bounded nested
  `attachment` metadata record with `pending | retryable | processed`
  processing status, and nullable nested `extraction`. Attachment content is
  never returned. Extraction records add schema-bound fields,
  confidence map, deterministic validation codes, resolved customer/method,
  trace, and validation time. API aliases are `critical_field_confidence`,
  `file_name`, `content_mime_type`, `provider`, and `model`. Extraction
  `document_type` is deterministically copied from its authoritative
  classification. A nullable bounded command reference and linked exception
  UUIDs are returned; raw extraction fields never are.
- Command: source lineage IDs, exact command/mode/schema, SHA-256 idempotency
  key, lifecycle, resulting invoice or receipt ID, safe
  failure code, actor, and timestamps. Draft creation or atomic create/post and
  this command-result transition commit together inside the database.
- Exception: source lineage IDs, bounded `reason_code`, optional SHA-256
  idempotency key, lifecycle, safe redacted details, retry counters, actor,
  resolution note, and lifecycle timestamps.
- Reminder: invoice/customer/sales-representative IDs, stage and scheduled
  date, lifecycle, recipient/customer/invoice/due/outstanding/currency
  snapshots, and timestamps. Attempts add mailbox/provider, attempt number,
  SHA-256 idempotency key, provider message ID when returned, error class,
  redacted code, and timestamps.
- Audit event: event/entity identity, normalized actor type
  (`user|system|provider`), actor user, trace ID, explicitly allowlisted scalar
  metadata, and timestamp. Each metadata key has its own validator; an
  allowlisted key never authorizes an arbitrary value. Unknown or invalid
  values, object values, arrays of objects, credential-shaped strings, and
  token, secret, authorization, provider body/response, cursor, raw
  document/prompt, stack, SQL, private-key, or bank keys are suppressed.
  Lifecycle triggers cover contacts, settings,
  provider connections, ingestion, decisions, commands, exceptions,
  allocations, reminders, and delivery attempts without copying source content
  or secrets.

The public safe-metadata vocabulary is exact:

- UUID values: `assignment_id`, `superseded_assignment_id`,
  `classification_id`, `extraction_id`, `attachment_id`, `command_id`,
  `invoice_id`, `mailbox_id`, `message_id`, `receipt_id`, `reminder_id`,
  `sales_representative_id`, `sync_run_id`;
- exact enums: `action`, `capability`, `command_type`, `document_type`,
  `from_status`, `lifecycle_status`, `operating_mode`, `operation`,
  `processing_status`, `provider_type`, `reason_code`, `source`, `status`,
  `to_status`, `validation_status`;
- `error_code`: uppercase snake-case code, at most 80 characters;
- `stage_offset_days`: integer from -90 through 0;
- `retry_blocked`, `duplicate_no_op`, `provider_attachment_present`: booleans;
- `changed_fields`: at most 20 values from the documented mutable contact,
  settings, mailbox-state, and capability field-name vocabulary.

The enum vocabularies are:

```text
action:
  create | update | activate | deactivate | assign | reassign | retry |
  resolve | resolved | dismiss | dismissed | process | evaluate | deliver |
  allocate
capability:
  ingestion | delivery
command_type:
  create_invoice | create_receipt | allocate_receipt
document_type:
  invoice | receipt | payment_advice | unsupported | ambiguous
lifecycle_status:
  open | retryable | resolved | dismissed
operating_mode:
  disabled | observe_only | draft_only | straight_through
operation:
  insert | update | delete
provider_type:
  gmail | microsoft
source:
  customer_acquisition | customer_onboarding | manual_assignment | import
validation_status:
  pending | valid | invalid | ambiguous | unsupported
```

`status`, `from_status`, and `to_status` accept only the union of the lifecycle
values installed by Migration 034: `disabled`, `pending_consent`, `connected`,
`reconnect_required`, `error`, `pending`, `running`, `completed`, `failed`,
`received`, `attachments_persisted`, `classified`, `validated`, `commanded`,
`exception`, `ignored`, `retryable`, `processed`, `proposed`, `accepted`,
`rejected`, `valid`, `invalid`, `ambiguous`, `unsupported`, `refused`, `open`,
`resolved`, `dismissed`, `sending`, `delivered`, `cancelled`, `sent`,
`retryable_failure`, and `permanent_failure`. `processing_status` uses that same
closed union; it is not a free-form slug.

`reason_code` accepts only Migration 034's bounded exception vocabulary:
`mailbox_not_configured`, `mailbox_reconnect_required`, `provider_unavailable`,
`message_duplicate`, `attachment_duplicate`, `unsupported_file`, `unsafe_file`,
`encrypted_document`, `oversized_document`, `ambiguous_classification`,
`unsupported_document`, `low_confidence`, `extraction_schema_invalid`,
`arithmetic_mismatch`, `currency_unsupported`, `customer_unresolved`,
`customer_ambiguous`, `invoice_conflict`, `receipt_conflict`,
`missing_salesman`, `invalid_salesman_email`,
`allocation_evidence_insufficient`, `allocation_currency_mismatch`,
`allocation_conflict`, `concurrency_conflict`, `provider_delivery_failed`, and
`internal_processing_failure`.

`changed_fields` accepts only: `name`, `email`, `phone`, `is_active`,
`operating_mode`, the seven kill-switch names, `reminder_stage_offsets`,
`reminder_timezone`, `minimum_overall_confidence`,
`minimum_critical_confidence`, `default_bank_account_id`, `is_enabled`,
`ingestion_enabled`, `delivery_enabled`, and `connection_status`.

Unsafe entries are omitted without suppressing the containing audit event or
exception. The same serializer governs audit `safe_metadata` and exception
`safe_details`.

## Canonical DTO examples

The objects below are the exact `data` shapes inside the common success
envelope. UUIDs and timestamps are synthetic.

Overview:

```json
{
  "settings": {
    "company_id": "10000000-0000-4000-8000-000000000001",
    "automation_actor_user_id": null,
    "operating_mode": "disabled",
    "mailbox_sync_enabled": false,
    "document_intelligence_enabled": false,
    "invoice_automation_enabled": false,
    "receipt_automation_enabled": false,
    "auto_allocation_enabled": false,
    "reminder_evaluation_enabled": false,
    "reminder_delivery_enabled": false,
    "reminder_stage_offsets": [-3, 0],
    "reminder_timezone": "UTC",
    "extraction_schema_version": 1,
    "minimum_overall_confidence": 0.95,
    "minimum_critical_confidence": 0.99,
    "created_at": null,
    "updated_at": null,
    "created_by": null,
    "updated_by": null
  },
  "ingestion_ready": false,
  "delivery_ready": false,
  "document_intelligence_ready": false,
  "connected_mailbox_count": 0,
  "reconnect_required_mailbox_count": 0,
  "last_successful_sync_at": null,
  "last_failed_sync_at": null,
  "processing_runs": 0,
  "documents_processed": 0,
  "accepted_documents": 0,
  "rejected_documents": 0,
  "invoices_created": 0,
  "receipts_created": 0,
  "allocations_completed": 0,
  "reminders_evaluated": 0,
  "reminders_sent": 0,
  "open_exceptions": 0,
  "retryable_exceptions": 0
}
```

Sales representative and current assignment:

```json
{
  "id": "10000000-0000-4000-8000-000000000002",
  "company_id": "10000000-0000-4000-8000-000000000001",
  "name": "Representative Name",
  "email": "representative@example.test",
  "phone": "+60123456789",
  "is_active": true,
  "created_at": "2026-08-06T04:05:06.000Z",
  "updated_at": "2026-08-06T04:05:06.000Z",
  "created_by": "10000000-0000-4000-8000-000000000003",
  "updated_by": "10000000-0000-4000-8000-000000000003"
}
```

```json
{
  "assignment": {
    "id": "10000000-0000-4000-8000-000000000004",
    "company_id": "10000000-0000-4000-8000-000000000001",
    "customer_id": "10000000-0000-4000-8000-000000000005",
    "sales_representative_id": "10000000-0000-4000-8000-000000000002",
    "assignment_source": "customer_onboarding",
    "assigned_by": "10000000-0000-4000-8000-000000000003",
    "assigned_at": "2026-08-06T04:05:06.000Z",
    "assignment_reason": "Initial responsible representative",
    "superseded_at": null,
    "superseded_by": null,
    "created_at": "2026-08-06T04:05:06.000Z"
  },
  "sales_representative": {
    "id": "10000000-0000-4000-8000-000000000002",
    "company_id": "10000000-0000-4000-8000-000000000001",
    "name": "Representative Name",
    "email": "representative@example.test",
    "phone": "+60123456789",
    "is_active": true,
    "created_at": "2026-08-06T04:05:06.000Z",
    "updated_at": "2026-08-06T04:05:06.000Z",
    "created_by": "10000000-0000-4000-8000-000000000003",
    "updated_by": "10000000-0000-4000-8000-000000000003"
  }
}
```

No current assignment is JSON `null`. Each assignment-history array element
has exactly the same `{assignment,sales_representative}` shape, including the
historical representative and supersession fields.

Mailbox and OAuth start:

```json
{
  "id": "10000000-0000-4000-8000-000000000006",
  "company_id": "10000000-0000-4000-8000-000000000001",
  "provider_type": "gmail",
  "mailbox_address": "automation@example.test",
  "default_bank_account_id": null,
  "connection_status": "disabled",
  "ingestion_secret_configured": false,
  "delivery_secret_configured": false,
  "ingestion_token_expires_at": null,
  "delivery_token_expires_at": null,
  "cursor_kind": null,
  "cursor_present": false,
  "last_successful_sync_at": null,
  "last_failed_sync_at": null,
  "reconnect_required": false,
  "is_enabled": false,
  "ingestion_enabled": false,
  "delivery_enabled": false,
  "redacted_error_code": null,
  "created_at": "2026-08-06T04:05:06.000Z",
  "updated_at": "2026-08-06T04:05:06.000Z"
}
```

```json
{
  "provider": "gmail",
  "authorization_url": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "expires_at": "2026-08-06T04:15:06.000Z",
  "capability": "ingestion"
}
```

OAuth callback success contains only bounded metadata:

```json
{
  "mailbox_id": "10000000-0000-4000-8000-000000000006",
  "provider": "gmail",
  "capability": "ingestion",
  "connection_status": "connected",
  "token_expires_at": "2026-08-06T05:15:06.000Z",
  "granted_scopes": [
    "https://www.googleapis.com/auth/gmail.readonly"
  ]
}
```

The Google callback must use `GMAIL_OAUTH_REDIRECT_URI` and the Microsoft
callback must use `MICROSOFT_OAUTH_REDIRECT_URI`. Start and completion compare
the exact provider URI, and both URIs must use the exact HTTPS origin supplied
by the Edge runtime's `SUPABASE_URL`. A wrong origin/provider, changed redirect,
expired/reused state, missing code/state, provider denial, token-exchange
failure, or Vault write failure is rejected. Access/refresh tokens, client
secrets, raw provider errors, and Vault payloads never enter this DTO or an
error envelope.

For Microsoft, `offline_access` is requested during consent and is proven at
completion by the presence of a refresh token. Because the token response's
`scope` describes access-token authority and may omit `offline_access`, the
stored scope list adds the `offline_access` marker only after that refresh-token
proof. `Mail.Read` and `Mail.Send` remain exact, independently checked access
scopes.

Disconnect is idempotent at the Vault deletion boundary. It clears expiry
metadata and disables only the requested capability (or both for `all`). It
does not claim to revoke consent at the provider account; operators may also
revoke provider-side consent according to their Google/Microsoft policy.

Sync run:

```json
{
  "id": "10000000-0000-4000-8000-000000000007",
  "company_id": "10000000-0000-4000-8000-000000000001",
  "mailbox_id": "10000000-0000-4000-8000-000000000006",
  "provider_type": "gmail",
  "status": "completed",
  "cursor_before": "[redacted]",
  "cursor_after": "[redacted]",
  "started_at": "2026-08-06T04:05:06.000Z",
  "completed_at": "2026-08-06T04:06:06.000Z",
  "failed_at": null,
  "messages_discovered": 2,
  "messages_persisted": 2,
  "attachments_discovered": 2,
  "attachments_persisted": 2,
  "duplicate_messages": 0,
  "duplicate_attachments": 0,
  "attachments_processed": 2,
  "commands_processed": 1,
  "allocations_completed": 0,
  "failures": 0,
  "attempt_count": 1,
  "max_attempts": 3,
  "redacted_error_code": null,
  "created_at": "2026-08-06T04:05:06.000Z"
}
```

Document decision:

```json
{
  "id": "10000000-0000-4000-8000-000000000008",
  "company_id": "10000000-0000-4000-8000-000000000001",
  "attachment_id": "10000000-0000-4000-8000-000000000009",
  "schema_version": 1,
  "document_type": "invoice",
  "status": "accepted",
  "confidence": 0.99,
  "critical_field_confidence": 0.99,
  "provider": "fixture",
  "model": "fixture-v1",
  "provider_version": "1",
  "trace_id": "trace-safe",
  "created_at": "2026-08-06T04:05:06.000Z",
  "attachment": {
    "id": "10000000-0000-4000-8000-000000000009",
    "file_name": "invoice.pdf",
    "content_mime_type": "application/pdf",
    "size_bytes": 123,
    "page_count": 1,
    "scan_status": "unavailable",
    "safety_status": "accepted",
    "processing_status": "processed",
    "content_purged_at": null
  },
  "extraction": {
    "id": "10000000-0000-4000-8000-000000000010",
    "schema_version": 1,
    "document_type": "invoice",
    "validation_status": "valid",
    "validation_codes": [],
    "field_confidence": {"total": 0.99},
    "customer_id": "10000000-0000-4000-8000-000000000005",
    "customer_resolution_method": "customer_code",
    "trace_id": "trace-safe",
    "validated_at": "2026-08-06T04:05:06.000Z",
    "created_at": "2026-08-06T04:05:06.000Z"
  },
  "command": null,
  "linked_exception_ids": []
}
```

Command and exception:

```json
{
  "id": "10000000-0000-4000-8000-000000000011",
  "command_type": "create_receipt",
  "status": "completed",
  "resulting_invoice_id": null,
  "resulting_receipt_id": "10000000-0000-4000-8000-000000000012",
  "failure_code": null,
  "company_id": "10000000-0000-4000-8000-000000000001",
  "mailbox_id": "10000000-0000-4000-8000-000000000006",
  "message_id": "10000000-0000-4000-8000-000000000013",
  "attachment_id": "10000000-0000-4000-8000-000000000009",
  "extraction_id": "10000000-0000-4000-8000-000000000010",
  "operating_mode": "straight_through",
  "schema_version": 1,
  "idempotency_key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "created_by": "10000000-0000-4000-8000-000000000003",
  "created_at": "2026-08-06T04:05:06.000Z",
  "completed_at": "2026-08-06T04:05:07.000Z",
  "failed_at": null
}
```

```json
{
  "id": "10000000-0000-4000-8000-000000000014",
  "company_id": "10000000-0000-4000-8000-000000000001",
  "mailbox_id": "10000000-0000-4000-8000-000000000006",
  "sync_run_id": null,
  "message_id": null,
  "attachment_id": null,
  "command_id": null,
  "invoice_id": null,
  "receipt_id": null,
  "reason_code": "provider_unavailable",
  "idempotency_key": null,
  "lifecycle_status": "retryable",
  "safe_details": {"error_code": "PROVIDER_UNAVAILABLE"},
  "retry_count": 0,
  "max_retries": 3,
  "actor_user_id": null,
  "resolution_note": null,
  "opened_at": "2026-08-06T04:05:06.000Z",
  "resolved_at": null,
  "dismissed_at": null,
  "created_at": "2026-08-06T04:05:06.000Z",
  "updated_at": "2026-08-06T04:05:06.000Z"
}
```

Invoice reminder and attempt:

```json
{
  "id": "10000000-0000-4000-8000-000000000015",
  "company_id": "10000000-0000-4000-8000-000000000001",
  "invoice_id": "10000000-0000-4000-8000-000000000016",
  "customer_id": "10000000-0000-4000-8000-000000000005",
  "sales_representative_id": "10000000-0000-4000-8000-000000000002",
  "stage_offset_days": -3,
  "scheduled_for": "2026-08-06",
  "status": "pending",
  "recipient_name_snapshot": "Representative Name",
  "recipient_email_snapshot": "representative@example.test",
  "recipient_phone_snapshot": "+60123456789",
  "customer_name_snapshot": "Customer Name",
  "invoice_no_snapshot": "INV-0001",
  "due_date_snapshot": "2026-08-09",
  "outstanding_snapshot": "100.00",
  "currency_snapshot": "MYR",
  "created_at": "2026-08-06T04:05:06.000Z",
  "delivered_at": null
}
```

```json
{
  "id": "10000000-0000-4000-8000-000000000017",
  "company_id": "10000000-0000-4000-8000-000000000001",
  "reminder_id": "10000000-0000-4000-8000-000000000015",
  "mailbox_id": "10000000-0000-4000-8000-000000000006",
  "provider_type": "gmail",
  "attempt_number": 1,
  "idempotency_key": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "status": "sent",
  "provider_message_id": "provider-message-id",
  "error_class": null,
  "redacted_error_code": null,
  "started_at": "2026-08-06T04:05:06.000Z",
  "completed_at": "2026-08-06T04:05:07.000Z",
  "created_at": "2026-08-06T04:05:06.000Z"
}
```

Audit event:

```json
{
  "id": "10000000-0000-4000-8000-000000000018",
  "company_id": "10000000-0000-4000-8000-000000000001",
  "event_type": "automation_commands_update",
  "entity_type": "automation_commands",
  "entity_id": "10000000-0000-4000-8000-000000000011",
  "actor_type": "system",
  "actor_user_id": null,
  "trace_id": "trace-safe",
  "safe_metadata": {"operation": "update", "status": "completed"},
  "created_at": "2026-08-06T04:05:06.000Z"
}
```

Mutation DTOs are the same normalized resource DTO for settings,
representative, mailbox, exception, command, and reminder attempt mutations.
Assignment returns `{changed,current}`; document processing returns
`{decision_id,attachment_id,document_type,decision_status,extraction_id,validation_status,command_eligible}`;
reminder evaluation returns `{created,exceptions,disabled}`; OAuth completion
returns `{mailbox_id,provider,capability,connection_status,token_expires_at,granted_scopes}`.

## Exception lifecycle and retry

Lifecycle is `open | retryable | resolved | dismissed`. Retry is permitted only
from `retryable`, never exceeds `max_retries`, re-enters the same authoritative
path, and retains source/idempotency references. Resolve and dismiss require a
note. Unknown/inaccessible IDs return sanitized `NOT_FOUND`.

Reason codes:

```text
mailbox_not_configured
mailbox_reconnect_required
provider_unavailable
message_duplicate
attachment_duplicate
unsupported_file
unsafe_file
encrypted_document
oversized_document
ambiguous_classification
unsupported_document
low_confidence
extraction_schema_invalid
arithmetic_mismatch
currency_unsupported
customer_unresolved
customer_ambiguous
invoice_conflict
receipt_conflict
missing_salesman
invalid_salesman_email
allocation_evidence_insufficient
allocation_currency_mismatch
allocation_conflict
concurrency_conflict
provider_delivery_failed
internal_processing_failure
```

`message_duplicate` and `attachment_duplicate` are stored once per deterministic
idempotency key as resolved no-op evidence. They never re-enter a financial
command.

## Frozen enums and filters

```text
provider_type: gmail | microsoft
connection_status: disabled | pending_consent | connected | reconnect_required | error
run.status: pending | running | completed | failed | reconnect_required
document_type: invoice | receipt | payment_advice | unsupported | ambiguous
classification.status: proposed | accepted | rejected
extraction.validation_status: pending | valid | invalid | ambiguous | unsupported
command_type: create_invoice | create_receipt | allocate_receipt
command.status: proposed | pending | running | completed | failed | refused
exception.lifecycle_status: open | retryable | resolved | dismissed
reminder.status: pending | sending | delivered | failed | cancelled
attempt.status: pending | sending | sent | retryable_failure | permanent_failure
attempt.error_class: retryable | non_retryable | null
audit.actor_type: user | system | provider
assignment_source: customer_acquisition | customer_onboarding | manual_assignment | import
```

Unknown and duplicate query parameters fail with `VALIDATION_ERROR`.
`invoice_id`, `reminder_id`, and `entity_id` are UUID filters. `event_type` and
`entity_type` are non-empty bounded strings of at most 80 characters. Every
collection uses `page` and `page_size`; `total` is the complete tenant/filter
count and `has_more` is derived from that count and the returned page.

## Controlled errors

- `AUTHENTICATION_ERROR` — 401
- `AUTHORIZATION_ERROR` — 403
- `VALIDATION_ERROR` — 400
- `NOT_FOUND` — 404
- `CONFLICT` — 409
- `OAUTH_NOT_CONFIGURED` / `SECRET_REFERENCE_UNAVAILABLE` — 503
- `OAUTH_SECRET_WRITE_FAILED` / `OAUTH_SECRET_RESOLUTION_FAILED` /
  `OAUTH_SECRET_DELETE_FAILED` — sanitized 503
- `OAUTH_SECRET_UNAVAILABLE` / `OAUTH_SECRET_INVALID` /
  `OAUTH_RECONNECT_REQUIRED` / `OAUTH_SCOPE_INSUFFICIENT` /
  `OAUTH_STATE_EXPIRED` / `OAUTH_STATE_ALREADY_USED` /
  `OAUTH_STATE_MISMATCH` / `OAUTH_PROVIDER_DENIED` /
  `OAUTH_DISCONNECT_REQUIRED` — sanitized 409
- `OAUTH_SECRET_REFERENCE_CONFLICT` — sanitized 409; the response states only
  that the opaque reference is already in use and never identifies its tenant,
  mailbox, or capability owner
- `MAILBOX_SYNC_DISABLED` / `DOCUMENT_INTELLIGENCE_DISABLED` /
  `REMINDER_DELIVERY_DISABLED` — 409
- `MAILBOX_RECONNECT_REQUIRED` — 409
- `PROVIDER_DELIVERY_RETRYABLE`: 503 only for an explicit pre-acceptance
  provider throttle
- `PROVIDER_DELIVERY_OUTCOME_UNCONFIRMED`: 409; the attempt remains `sending`
  and automatic retry is blocked
- `PROVIDER_DELIVERY_REJECTED`: controlled non-retryable provider rejection
- `LOW_CONFIDENCE`, `EXTRACTION_SCHEMA_INVALID`, `ARITHMETIC_MISMATCH`,
  `CUSTOMER_UNRESOLVED`, `CUSTOMER_AMBIGUOUS` — controlled business rejection
- `STRAIGHT_THROUGH_CONFIRMATION_REQUIRED` — 409
- `AUTOMATION_WORKER_NOT_CONFIGURED` — 503
- `BR-AUTO-ALLOC-EVIDENCE`, `BR-AUTO-ALLOC-MISMATCH`,
  `BR-AUTO-FX-UNAVAILABLE`, `BR-AUTO-ALLOC-DISABLED` — controlled financial
  rejection
- `INTERNAL_ERROR` — 500 with no internal detail

Provider response bodies and tokens are never copied into an error envelope.
