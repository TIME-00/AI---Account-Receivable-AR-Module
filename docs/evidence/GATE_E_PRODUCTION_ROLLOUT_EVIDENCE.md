# Gate E Production Rollout Evidence

Accounts Receivable Management System for SMEs — Autonomous AR Operations.

## Rollout decision

**ROLLOUT PARTIALLY COMPLETE — EXTERNAL ACTIVATION PREREQUISITE**

The reviewed implementation, database migration, Edge Functions, and frontend
are deployed. Automation remains fail-closed in `disabled` mode. Gate E is not
Live or Closed because authenticated Production UI verification and real
provider activation could not be completed safely.

## Git and reviewed scope

- Baseline: `a40f2952a3fda91823bffa0fb9d6f023c5eb39a1`.
- Unified implementation commit:
  `aec3930fea94df7fb4b30cb670b3c2b534f609e3`.
- Subject: `feat(gate-e): add autonomous AR operations`.
- Scope: 58 reviewed files — 9 tracked modifications and 49 additions.
- Push: `origin/main` accepted the implementation commit; local and remote
  SHAs matched immediately after push.
- No generated build output, Playwright auth state, credential file, stale
  top-level `supabase/` path, or unrelated path was committed.

## Migration 034

- Project: `kusseuycqgdilychphpq`.
- Reviewed source:
  `database/034_gate_e_autonomous_ar_operations.sql`.
- Reviewed SHA-256:
  `5D7F87D34975AC479298794FAB7C0A3A449212B122BD6C888E2D0DBCD47F0ABA`.
- Dry-run result: only
  `20260807000000_gate_e_autonomous_ar_operations.sql` was pending.
- Application: PASS.
- Remote ledger version: `20260807000000`.
- Remote ledger name: `gate_e_autonomous_ar_operations`.
- Ledger entries: exactly one.
- Rollback-only `034b` was not executed in Production.
- The temporary migration workdir was removed after verification.

## Production database verification

Read-only catalog verification after Migration 034 returned:

- Gate E tables: 16.
- RLS enabled: 16/16.
- Tables with explicit policies: 16/16.
- Tables with primary keys: 16/16.
- Foreign keys: 48.
- Indexes across Gate E tables: 52.
- Enabled custom triggers across Gate E tables: 41.
- Reviewed Gate E functions: 14, owned by `postgres`, with fixed empty
  `search_path` and the reviewed invoker/definer and execution grants.
- Settings rows: 0.
- Activated settings rows: 0.
- Mailbox rows: 0.
- Activated mailbox rows: 0.

Migration 034 contains no financial-row backfill. No Production Invoice,
Receipt, allocation, FX, journal, customer, or mailbox mutation was performed
during rollout validation.

## Edge deployments

Only reviewed affected functions were deployed from `backend/supabase`:

| Function | Version | Status | JWT setting |
|---|---:|---|---|
| `automation` | 1 | ACTIVE | platform verification disabled; reviewed in-function user and worker boundaries active |
| `invoices` | 29 | ACTIVE | enabled |
| `receipts` | 22 | ACTIVE | enabled |

Unrelated functions remained unchanged, including `reports` v21 ACTIVE and
`notifications` v6 ACTIVE.

Sanitized fail-closed checks:

- User route with a syntactically valid tenant header but no authentication:
  HTTP 401, `gate-e.1`, `AUTHENTICATION_ERROR`, no data.
- Worker route without configured worker authentication: HTTP 503,
  `gate-e.1`, `AUTOMATION_WORKER_NOT_CONFIGURED`, no work performed.
- Missing tenant context returns a sanitized `gate-e.1` validation error and no
  data.

## Frontend deployment

- Vercel deployment ID: `dpl_HcQTxZgr1h7JW5nEKSejpicKXJM7`.
- Deployment URL:
  `https://account-receivable-module-g66ibp51s-time-00s-projects.vercel.app`.
- Canonical alias: `https://account-receivable-module.vercel.app/`.
- Git commit: `aec3930fea94df7fb4b30cb670b3c2b534f609e3`.
- Status: READY, Production.
- Vercel Git integration created the exact deployment; no duplicate manual
  deployment was created.
- The public application shell and login page loaded successfully.

Authenticated read-only Playwright validation did not reach protected pages:
the existing authorized demo Finance storage state had expired and the app
displayed the normal login page on both desktop and mobile. The auth-state file
was not read, printed, copied, or modified. Failure screenshots, videos, and
traces remain in ignored test output. No Production mutation occurred.

## Provider and capability prerequisites

Supabase secret presence was checked by name only. The following reviewed names
are absent:

- `AUTOMATION_WORKER_SECRET`
- `AUTOMATION_OAUTH_REDIRECT_URI`
- `GMAIL_OAUTH_CLIENT_ID`
- `GMAIL_OAUTH_CLIENT_SECRET`
- `MICROSOFT_OAUTH_CLIENT_ID`
- `MICROSOFT_OAUTH_CLIENT_SECRET`
- optional `MICROSOFT_OAUTH_TENANT`

No secret value or digest was displayed or recorded.

### Gmail / Google Workspace

- Ingestion scope: `https://www.googleapis.com/auth/gmail.readonly`.
- Delivery scope: `https://www.googleapis.com/auth/gmail.send`.
- Status: not configured; no consent performed and no mailbox connected.

### Microsoft Outlook / Microsoft 365

- Ingestion scopes: `offline_access Mail.Read`.
- Delivery scopes: `offline_access Mail.Send`.
- Status: not configured; no consent performed and no mailbox connected.

The deployed callback routes are:

- `https://kusseuycqgdilychphpq.supabase.co/functions/v1/automation/oauth/gmail/callback`
- `https://kusseuycqgdilychphpq.supabase.co/functions/v1/automation/oauth/microsoft/callback`

The current runtime exposes one shared `AUTOMATION_OAUTH_REDIRECT_URI` setting
while the router requires provider-specific callback paths. In addition,
Production constructs `DisabledOAuthSecretWriter`. OAuth completion therefore
remains intentionally fail-closed; client credentials alone cannot safely
activate both providers.

### Document intelligence

Production constructs `DisabledDocumentIntelligenceProvider`. The deterministic
fixture provider is test-only. No concrete Production document-intelligence
adapter or credential contract exists, so `document_intelligence_ready` remains
false and no AI provider was called.

### Reminder delivery and scheduling

No mailbox exists, no delivery token reference exists, and no outbound provider
was activated. No email was sent. No `AUTOMATION_WORKER_SECRET` or external
scheduler job was installed. Worker authentication remains fail-closed.

## Readiness and activation

Derived Production readiness is:

- `ingestion_ready`: false.
- `delivery_ready`: false.
- `document_intelligence_ready`: false.

Activation results:

| Phase | Result |
|---|---|
| `disabled` | PASS — zero settings rows, zero enabled mailboxes, worker not configured |
| `observe_only` | NOT STARTED — ingestion and document-intelligence readiness are false |
| `draft_only` | NOT STARTED — prior phase and required readiness are incomplete |
| `straight_through` | NOT STARTED — prohibited while readiness is false |

No operating mode was forced and no kill switch was enabled.

## Required continuation

Gate E remains open and pending activation. No credential value should be
pasted into chat, logs, evidence, or Git.

## Activation-prerequisite Production continuation

The independently reviewed activation implementation was committed and pushed:

- commit: `9f4d358e00740c6309f22d1bdea7a4f67e97a6b3`;
- parent: `fbed6b6ff23be577834f6fdbc7ccfa358c93c249`;
- subject: `feat(gate-e): add secure provider activation`;
- scope: exactly 12 reviewed files, comprising seven modifications and five
  additions; and
- push: `HEAD == origin/main`, ahead/behind `0/0` immediately after push.

The reviewed implementation includes the Supabase Vault OAuth store,
provider-specific redirect contract, refresh/rotation lifecycle, bounded worker
boundary, and the direct OpenAI Responses API document-intelligence adapter.
The OpenAI adapter uses strict Structured Outputs, bounded Base64 PDF/image
input, no tools, a 25-second whole-response timeout, at most one transient
retry, and the default server-side model `gpt-5.6-luna`. OpenAI supplies only
untrusted classification/extraction candidates; tenant, customer, arithmetic,
FX, posting, and allocation remain deterministic backend/PostgreSQL authority.

### Migration 035

- reviewed source: `database/035_gate_e_secure_oauth_vault.sql`;
- reviewed SHA-256:
  `5EAA0F78822F036D0535BDD41751D39C8F802E83CC432872B5AD08296E234BB3`;
- preflight: the existing four remote migrations matched the isolated local
  ledger and only `20260808000000_gate_e_secure_oauth_vault.sql` was pending;
- Vault prerequisite: `vault.secrets`, `vault.decrypted_secrets`,
  `vault.create_secret(text,text,text,uuid)`, and
  `vault.update_secret(uuid,text,text,text,uuid)` were present;
- application: PASS, exactly once;
- remote ledger version: `20260808000000`;
- remote ledger name: `gate_e_secure_oauth_vault`;
- rollback-only `035b` was not executed in Production;
- `automation_oauth_secret_write`, `automation_oauth_secret_resolve`, and
  `automation_oauth_secret_delete` are owned by `postgres`, are security
  definers with fixed empty `search_path`, and are executable by `service_role`
  but not `anon`, `authenticated`, or `PUBLIC`;
- both OAuth-reference unique indexes and the enabled collision-guard trigger
  exist;
- Gate E RLS and policy coverage remains 16/16; and
- settings, mailboxes, OAuth states, and Gate E Vault metadata rows remain zero.

Migration 035 performed no Invoice, Receipt, allocation, FX, journal, customer,
mailbox, provider-credential, or other financial/business backfill.

### Automation Edge deployment

- function: `automation`;
- deployed version: 2;
- status: ACTIVE;
- platform JWT verification: disabled, with the reviewed in-function user and
  dedicated worker boundaries active;
- deployment bundle SHA-256:
  `d47291b8f44d17e817338bb483c5329aaaae3e4d4dafbbf1c35ce75ac9fc083a`.

Post-deployment fail-closed checks passed:

- unauthenticated Overview request: HTTP 401, `gate-e.1`, sanitized
  `AUTHENTICATION_ERROR`;
- worker request without a configured worker secret: HTTP 503, `gate-e.1`,
  sanitized `AUTOMATION_WORKER_NOT_CONFIGURED`; and
- no worker cycle or provider request was executed.

### Frontend deployment status

The push triggered one Vercel Git Production deployment for the activation
commit; no manual duplicate was created:

- GitHub deployment ID: `5794696394`;
- deployment URL:
  `https://account-receivable-module-l6mu8dz7q-time-00s-projects.vercel.app`;
- status: success, Production;
- canonical alias: `https://account-receivable-module.vercel.app/`;
- canonical public health: HTTP 200.

No frontend source changed in the activation commit. Authenticated protected-page
smoke remains pending because the previously authorized demo Finance session is
expired; its auth-state file was not read, printed, copied, or modified.

### Provider, worker, and scheduler status at the pre-scheduler checkpoint

Production secret-name inspection at that checkpoint found all
activation-specific configuration absent:

- `OPENAI_API_KEY`: missing;
- `OPENAI_DOCUMENT_MODEL`: missing; the deployed default remains
  `gpt-5.6-luna`;
- `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, and
  `GMAIL_OAUTH_REDIRECT_URI`: missing;
- `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`,
  `MICROSOFT_OAUTH_REDIRECT_URI`, and optional
  `MICROSOFT_OAUTH_TENANT`: missing; and
- `AUTOMATION_WORKER_SECRET`: missing.

No OpenAI request, document upload, Google/Microsoft consent, Vault token write,
mailbox connection, token refresh, reminder email, or scheduler execution
occurred. The worker secret was not provisioned alone: the reviewed repository
defines the `pg_cron`/`pg_net` design but contains no reviewed installable cron
DDL or operator script. Installing persistent scheduler SQL would therefore
require a separately reviewed forward implementation rather than rollout-time
improvisation.

The actual derived readiness remains:

- `ingestion_ready`: false;
- `delivery_ready`: false;
- `document_intelligence_ready`: false.

The operating mode remains `disabled`. Disabled fail-closed deployment checks
passed, but activation Phase 0 is incomplete because provider credentials,
controlled provider smoke, worker/scheduler installation, and authenticated UI
smoke are not yet available. `observe_only`, `draft_only`, and
`straight_through` were not started.

### Remaining prerequisites at that checkpoint

1. Provision `OPENAI_API_KEY` through Supabase Edge secret management without
   exposing the value, then run synthetic invoice and receipt smoke tests.
2. Provision provider-specific Google and Microsoft client configuration and
   complete human consent with only the documented least-privilege scopes.
3. Re-authenticate the authorized demo Finance session locally through the
   normal login flow and run the authenticated read-only Production UI/API
   smoke without exposing auth-state content.
4. Configure only controlled synthetic mailbox, customer, representative, and
   recipient data before progressing through `observe_only`, `draft_only`, and
   `straight_through` one phase at a time.

Pre-scheduler local validation remained independently accepted: OpenAI 41/41,
activation-prerequisites 21/21, Gate E 81/81, combined focused 143/143, complete
backend 394/394, Deno format/lint PASS, and deployable Edge entrypoints 17/17.

**Gate E remains OPEN and PENDING ACTIVATION.** Production remains deployed and
fail-closed in `disabled` mode. No Production financial/business DML occurred
during this continuation.

## Local secure-scheduler remediation — independently reviewed

On 2026-08-08 the missing repository-owned scheduler contract was implemented
locally. The independently reviewed scheduler commit contains:

- `database/036_gate_e_secure_scheduler.sql`;
- rollback-only `database/036b_gate_e_secure_scheduler_smoke_tests.sql`;
- `backend/supabase/functions/gate_e_scheduler_contract_test.ts`;
- the minimum Automation service integration for an eight-minute
  service-role-only worker lease; and
- corresponding architecture/API/evidence documentation.

Migration 036 requires Supabase `pg_cron`, `pg_net`, and Vault, but applying it
does not provision a secret, install a job, invoke the worker, or mutate
financial/business data. Later postgres-only installation creates one stable
`gate-e-automation-worker` job every ten minutes. Its command contains only a
call to a no-argument invocation function. That function resolves the fixed
Vault identity `AUTOMATION_WORKER_SECRET` with the fixed description
`Gate E Automation worker scheduler secret`, then queues the fixed HTTPS
Automation worker request with exact `{}` and the reviewed
`X-Automation-Worker-Secret` header.

The same single random value must be placed in the Automation Edge secret and
Vault. No value was generated or provisioned during the local implementation
phase.
Disposable Supabase validation confirmed that pg_net's extension-owned SQL
ACLs cannot be safely revoked by the normal migration role. The implementation
therefore queues only a three-minute HMAC authorization token with a one-time
UUID nonce—not the reusable worker secret. Edge validates the signature/time
window and claims the nonce through a service-role-only RPC before work. The
reviewed Data API schema list excludes `net`, `cron`, and `gate_e_internal`; no
public RPC exposes their metadata. The worker lease prevents overlapping cycles
while existing database idempotency remains authoritative.

Claude Code independently reviewed this remediation and returned PASS with no
blocking defect. At the end of that local review Migration 036 was not remotely
applied, the cron job was not installed, and no credential had been
provisioned. The subsequent authorized Production continuation is recorded
below.

Local scheduler-remediation validation is complete: scheduler-focused tests
26/26, activation-prerequisite tests 21/21, OpenAI document-provider tests
41/41, existing Gate E tests 81/81, combined focused tests 169/169, and the
complete backend suite 420/420 passed. All 17 deployable Edge entrypoints
type-checked. The exact changed Gate E scope passes Deno format and lint checks;
the disposable PostgreSQL 17.6/Supabase chain applied forward migrations
001-036, and rollback-only 034b, 035b, and 036b all passed with no scheduler,
Vault-secret, queue, lease, nonce, or financial/business fixture residue.

## Production secure-scheduler continuation

The independently reviewed scheduler implementation was committed and pushed:

- commit: `5aa8aae443ce5b2a0f0e7e5e195db05b9eca7591`;
- parent: `d263f916168ad6c4b23a2a19a6260ef49eee981d`;
- subject: `feat(gate-e): add secure automation scheduler`;
- scope: exactly nine reviewed files, comprising six modifications and three
  additions; and
- push: `HEAD == origin/main`, ahead/behind `0/0` immediately after push.

### Migration 036 and database verification

- reviewed source: `database/036_gate_e_secure_scheduler.sql`;
- reviewed SHA-256:
  `DA62BDDFED318A8736CD0BADE2274DC3EE4DFA2517E17CD843B9983AF5ABF468`;
- preflight: the five existing remote ledger versions matched comment-only
  local placeholders and only
  `20260808030000_gate_e_secure_scheduler.sql` was pending;
- application: PASS, exactly once;
- remote ledger version: `20260808030000`;
- remote ledger name: `gate_e_secure_scheduler`;
- rollback-only `036b` was not executed in Production;
- the internal schema contains the two reviewed lease/nonce tables;
- all seven scheduler functions are owned by `postgres`, are security
  definers, and have fixed empty `search_path`;
- only the three lease/nonce functions are executable by `service_role`;
  scheduler assertion/invocation/install/removal remain postgres-only;
- `PUBLIC`, `anon`, and `authenticated` cannot execute any of the seven
  functions or access `gate_e_internal`;
- Gate E RLS and policy coverage remains 16/16; and
- migration application created no cron job, Vault credential, pg_net request,
  settings row, mailbox row, or financial/business row.

The hosted PostgREST Management configuration is exactly
`public,graphql_public`; `net`, `cron`, and `gate_e_internal` are not exposed by
the Data API. No public/browser RPC exposes pg_net, cron, nonce, lease, or Vault
material.

### Automation and scheduler activation

- current Automation Edge platform version: 10 (rechecked at
  `2026-08-08T05:19:07Z`; the reviewed bundle and source commit below are
  unchanged);
- status: ACTIVE;
- platform JWT verification: disabled, with reviewed in-function user and
  dedicated worker authentication active;
- deployed bundle SHA-256:
  `1114b87288fa7c8b5c721be479d142624f8b3b4583a6d6b2002306cf621fcc6b`;
- deployment source commit:
  `5aa8aae443ce5b2a0f0e7e5e195db05b9eca7591`;
- unauthenticated worker before provisioning: sanitized HTTP 503
  `AUTOMATION_WORKER_NOT_CONFIGURED`;
- unauthenticated worker after provisioning: sanitized HTTP 401
  `AUTHENTICATION_ERROR`; and
- unauthenticated Overview with a syntactically valid synthetic company header:
  sanitized HTTP 401 `AUTHENTICATION_ERROR`.

The first compatible 48-byte/384-bit generation attempt reached Edge only after
PowerShell treated a normal Supabase CLI status line as a terminating error
before the Vault operation. Presence checks proved Edge count one and Vault
count zero; that orphaned Edge secret was immediately removed and its value was
erased. A new 48-byte/384-bit random base64url root was then generated without
printing it and the same new value was provisioned as the Edge
`AUTOMATION_WORKER_SECRET` and as exactly one Vault record named
`AUTOMATION_WORKER_SECRET` with description
`Gate E Automation worker scheduler secret`. Final presence and identity were
verified by name/count only. Locked temporary secret files were zeroed and
removed after each attempt; no value entered Git, documentation, application
tables, cron metadata, pg_net metadata, logs, or user-facing responses.

The Edge/Vault same-secret challenge returned HTTP 200 with `gate-e.1` and a
successful object response. Direct controlled security smokes returned:

- valid signed invocation: PASS;
- replay of the same nonce: sanitized HTTP 401, PASS;
- tampered signature: sanitized HTTP 401, PASS;
- token older than three minutes: sanitized HTTP 401, PASS; and
- token more than 30 seconds in the future: sanitized HTTP 401, PASS.

Lease smoke proved first acquisition, overlap rejection, release/reacquisition,
stale-lease recovery, and a final released state. No business record was used.

The postgres-only installer was run twice to verify idempotency. Final state:

- active Gate E jobs: exactly one;
- job name: `gate-e-automation-worker`;
- cadence: `*/10 * * * *`;
- command: only `SELECT public.automation_scheduler_invoke();`;
- root/signed-token material in command: none; and
- unrelated cron jobs before/after: one/one.

The first real cron tick started at `2026-08-08 03:20:00.127503+00`, completed
with cron status `succeeded`, and received HTTP 200, `gate-e.1`, success true,
with no timeout or transport error.

### Frontend and remaining activation prerequisites

The backend-only push triggered one Vercel Production deployment; no manual
duplicate was created:

- GitHub deployment ID: `5804901600`;
- deployment URL:
  `https://account-receivable-module-ks1nmpe1p-time-00s-projects.vercel.app`;
- status: success, Production; and
- canonical frontend health: HTTP 200.

Secret-name metadata was most recently rechecked at `2026-08-08T05:06:52Z`
without retrieving
or displaying any value:

- `OPENAI_API_KEY`: present in Supabase Edge secret management;
- `OPENAI_DOCUMENT_MODEL`: missing, so the reviewed default remains
  `gpt-5.6-luna`;
- Gmail client ID/secret/redirect: all present by name; provider-console
  callback registration and consent remain human checkpoints;
- Microsoft client ID/secret/redirect and optional tenant: missing; and
- `AUTOMATION_WORKER_SECRET`: present in Edge and Vault.

No OpenAI provider request was made during this checkpoint. The reviewed
Production API exposes document processing only through authenticated
`POST /documents/{attachment_id}/process`. That path requires an eligible stored
attachment, `document_intelligence_enabled`, and an operating mode other than
`disabled`. Production has no settings, mailbox, or attachment rows and remains
`disabled`; the reviewed contract has no standalone side-effect-free provider
smoke route. The Production key was not retrieved or copied into the local
operator environment. Advancing a tenant to `observe_only`, introducing
unreviewed Production code, or extracting the Edge secret solely to force this
smoke was rejected as unsafe and outside this checkpoint.

Production still has zero settings, mailboxes, sync runs, source messages,
attachments, classifications, extractions, commands, allocation decisions,
reminders, reminder attempts, and Gate E audit events. Scheduler validation left
only one released lease row and one current claimed nonce. Therefore no Invoice,
Receipt, allocation, FX, journal, customer, reminder-email, or other
financial/business DML occurred.

Capability status after the name-only configuration check is:

- `ingestion_ready`: false;
- `delivery_ready`: false; and
- `document_intelligence_ready`: not independently observed after key
  provisioning because an authenticated Overview session is unavailable. The
  value was not forced or inferred from secret presence alone; the last verified
  pre-key value was false.

The operating mode remains `disabled`. Scheduler infrastructure is PASS, but
Phase 0 remains incomplete pending a controlled OpenAI provider smoke through an
authorized reviewed path, controlled Gmail mailbox consent, Microsoft provider
configuration and consent, and authenticated Production UI/API smoke. The human
operator reported completing a normal Production Finance login. A read-only
Playwright check at `2026-08-08T05:14:22Z` showed that the repository-configured
Playwright context remains unauthenticated and is separate from that interactive
browser session. Its auth-state contents were not read, copied, or modified, so
no authenticated Overview response or mailbox mutation was attempted through
automation. OAuth initiation now requires the controlled mailbox action in the
already authenticated human browser. `observe_only`, `draft_only`, and
`straight_through` were not started.

**Gate E remains OPEN and PENDING ACTIVATION at the controlled provider-smoke,
Gmail consent, Microsoft OAuth, and authenticated-smoke checkpoints.**

## Controlled Gmail mailbox conflict remediation

At `2026-08-08T05:26:03.296894Z`, the authenticated Finance Manager workflow
created one controlled Gmail mailbox for company
`00000000-0000-0000-0000-000000000001`. A subsequent duplicate submission of
the same opaque ingestion-secret reference reached Migration 035's intentional
global collision guard and raised `OAUTH_SECRET_REFERENCE_CONFLICT`; the Edge
boundary incorrectly reduced that safe business conflict to the generic HTTP
500 envelope.

Read-only ownership and state inspection established that the existing row is
the current demo tenant's controlled Gate E mailbox, not another tenant's
mailbox and not disposable stale residue. It is disabled, with ingestion and
delivery disabled, connection status `disabled`, `reconnect_required=false`, no
OAuth state, no sync run, no source message or attachment, and no downstream
classification, extraction, command, allocation, reminder, or delivery-attempt
row. It must be retained and reused; no cleanup or second mailbox is required.
The earlier zero-mailbox evidence predates this successful controlled insert
and remains historically accurate.

The bounded remediation commit is
`a4d4a9f93f911fbf24b2240d96deee26a8413dd2`
(`fix(gate-e): map OAuth reference conflicts`). It changes only the
Automation service, its Gate E contract test, and the Gate E API contract. The
database global-uniqueness trigger and Migrations 035/036 are unchanged. The
live request path now maps the exact database error prefix to HTTP 409 with code
`OAUTH_SECRET_REFERENCE_CONFLICT` and the tenant-safe message `This secret
reference is already in use. Choose another reference.` Unknown persistence
errors remain sanitized HTTP 500 responses.

Validation after the change was Gate E 82/82, activation prerequisites 21/21,
OpenAI 41/41, scheduler 26/26, full recursive backend 421/421, Deno format and
lint PASS, all 17 deployable Edge entrypoints type-checked, `git diff --check`
PASS, and the added-line credential scan PASS. Automation alone was deployed
from the canonical backend source and is ACTIVE as Production version 11. No
migration, scheduler, worker secret, OpenAI configuration, frontend source, or
financial/business data was changed.

The duplicate submission was not repeated in Production after deployment, in
accordance with the instruction not to retry or create another mailbox with the
occupied reference. The executable live-route regression proves the exact 409
envelope, and the deployed source is the validated commit. The next controlled
Production action is to refresh the existing mailbox list and start ingestion
OAuth on that retained row; operating mode remains `disabled`.

## PostgreSQL UUID response-contract remediation

Authenticated Production use subsequently exposed a cross-stack identifier
contract defect. The sole Production company legitimately uses PostgreSQL UUID
`00000000-0000-0000-0000-000000000001`, while the Gate E response DTO and OAuth
secret-context validator incorrectly required RFC version/variant nibbles.
Read-only Production metadata confirmed that company identity and the retained
disabled Gmail mailbox's matching `company_id`. Edge invocation logs confirmed
HTTP 500 for authenticated `GET /automation/settings`, `GET
/automation/mailboxes?page=1&page_size=50`, and `GET /automation/overview`
between `2026-08-08T06:02:55Z` and `2026-08-08T06:12:26Z`.

Commit `e3c755b18507c6d72591d166461e3adf96a9343b`
(`fix(gate-e): accept PostgreSQL UUID identifiers`) defines one
Gate E canonical PostgreSQL UUID primitive: exact 8-4-4-4-12 hexadecimal text,
case-insensitive, without application-level version or variant constraints.
DTO, safe-metadata, primitive-contract, and OAuth secret-context validation now
share it. Malformed, wrong-separator, truncated, overlong, and non-hex values
remain rejected. The scheduler's separately defined UUIDv4 nonce validation is
unchanged, as are every database UUID type, RLS/tenant filter, Vault boundary,
scheduler object, and financial-authority control.

Production-style executable regressions cover synthesized default settings, the
retained mailbox DTO and collection, the Overview envelope, OAuth secret
context, a normal UUIDv4 identifier, and malformed lookalikes. Validation was:
Gate E 84/84, activation prerequisites 21/21, OpenAI 41/41, scheduler 26/26,
combined focused 172/172, full recursive backend 423/423, 17/17 deployable Edge
entrypoints type-checked, and format/lint/diff/added-line secret scans PASS.

Only Automation was redeployed from the canonical backend source. Production
Automation version 12 is ACTIVE. No post-deploy authenticated invocation was
available to the operator tooling without extracting or bypassing the human
browser session, so the three endpoint status codes were not fabricated; the
deployed bundle is proven by the Production-style executable paths and awaits
the frontend mirror plus authenticated UI reread. The frontend still has the
old RFC-constrained pattern and remains pending a separate narrow frontend
repair.

The post-deploy read-only state remains one disabled mailbox, zero settings,
zero enabled mailboxes, and zero OAuth states, sync runs, source messages,
attachments, classifications, extractions, commands, allocations, reminders,
or reminder attempts. Operating mode therefore remains `disabled`; no OAuth or
business/financial DML occurred. Gate E remains OPEN and Gmail OAuth must not
resume until the frontend contract mirror is repaired and the authenticated
Overview/settings/mailbox paths are reread successfully.

## Gmail OAuth callback metadata compatibility remediation

The first controlled Gmail ingestion-consent attempt reached the reviewed
provider callback but failed before token exchange. Google returned the RFC 9207
issuer parameter `iss=https://accounts.google.com`; the strict callback query
allowlist did not yet include `iss`, so Production returned sanitized HTTP 400
`VALIDATION_ERROR` with field `iss` and reason `unsupported`. OAuth start had
succeeded, but the mailbox remained disconnected and no OAuth token metadata was
created.

Commit `34720116859d349272b1f842fd29c582976550b0`
(`fix(gate-e): accept Google OAuth callback metadata`) contains the bounded
four-file remediation. Gmail `iss` is optional but, when present, must equal
exactly `https://accounts.google.com`; arbitrary and bare issuers remain
rejected. Optional Gmail `hd` is DNS-syntax bounded and ignored after validation:
it carries no tenant, company, mailbox, or authorization authority. Microsoft
continues to reject Gmail-only `iss` and `hd`; duplicate and unknown parameters,
state/capability/redirect binding, one-time consumption, Vault persistence, scope
checks, and token redaction remain fail-closed and unchanged.

Claude Code independently reviewed the exact four-file diff read-only and
returned PASS with no blocking defects. Independently reproduced validation was:
activation prerequisites 23/23, Gate E Automation 84/84, OpenAI 41/41,
scheduler 26/26, combined focused 174/174, full recursive backend 425/425,
Automation entrypoint type-check PASS, and Deno format/lint PASS.

Only Automation was redeployed from the canonical backend source. Production
Automation version 13 is ACTIVE with platform JWT verification disabled as
reviewed; bundle SHA-256 is
`5c59ddfeb7c8e343cb5f7214766003180654ce87a4f7cb9b5ddd5456383b6060`, and the
deployment source was the clean tree at commit
`34720116859d349272b1f842fd29c582976550b0`.

Safe synthetic negative verification used no real authorization code or valid
OAuth state:

- the exact Google issuer was no longer classified as unsupported and proceeded
  to the deliberately invalid-state guard (HTTP 400 `VALIDATION_ERROR` with no
  provider-metadata field/reason);
- an arbitrary issuer returned HTTP 400 `VALIDATION_ERROR`, field `iss`, reason
  `invalid`; and
- an unrelated query parameter returned HTTP 400 `VALIDATION_ERROR`, its field
  name, and reason `unsupported`.

The read-only Production snapshot at `2026-08-08T08:48:47Z` remained
fail-closed: settings 0; non-disabled settings 0; Gmail mailboxes 1; connected,
enabled, ingestion-enabled, and delivery-enabled Gmail mailboxes all 0; Gmail
ingestion/delivery token-expiry metadata rows both 0; OAuth states 2, both
expired and unconsumed, with no live unconsumed state. Sync runs, source
messages, attachments, classifications, extractions, commands, allocations,
reminders, and reminder attempts all remain 0. No migration, scheduler, worker
secret, OpenAI configuration, provider credential, mailbox setting, or
financial/business data was changed.

Gate E remains OPEN, operating mode remains `disabled`, and the exact next human
action is: Production -> Automation -> Mailboxes -> existing Gmail mailbox ->
`Connect ingestion`.

## Mailbox activation CORS and OAuth refresh remediation

After Gmail ingestion consent completed successfully, the retained controlled
mailbox was connected with the reviewed ingestion scope and Vault-backed token
lifecycle. The first enable attempt stopped at the browser preflight: shared
CORS advertised `POST, GET, OPTIONS, PUT, DELETE` but the supported mailbox-item
update route uses `PATCH`. Production returned OPTIONS 204 and the browser sent
no PATCH request. A second bounded sequencing defect was also confirmed before
activation: `updateMailbox()` rejected stale access-token expiry metadata before
it could invoke the already reviewed secure refresh lifecycle. This would have
required unnecessary repeat consent after an ordinary access-token expiry even
when a valid refresh token remained in Vault.

Commit `cda4fe887bb5f2f1851a6cfc6dee47f4a34f1d2a`
(`fix(gate-e): enable secure mailbox activation`) contains the combined four-file
remediation. Shared CORS now advertises exactly `POST, GET, OPTIONS, PUT, PATCH,
DELETE`; the origin and allowed-header policy is unchanged. Mailbox enablement
now calls the existing `resolveOAuthAccessTokenForRuntime()` boundary before the
authoritative enable update. A current renewable token avoids provider refresh.
An expired or near-expiry token must refresh successfully, persist to Vault, and
update safe expiry metadata before enablement. Missing or invalid Vault data,
missing refresh authority, insufficient scope, or provider refresh rejection
remain fail-closed and cannot enable the mailbox. Delivery remains independently
disabled unless its separately consented capability is explicitly enabled.

Claude Code independently reviewed the exact four-file remediation read-only and
returned PASS with no blocking defects. Independently reproduced validation was:
Gate E Automation 85/85, activation prerequisites 28/28, OpenAI 41/41,
scheduler 26/26, combined focused 180/180, full recursive backend 431/431, all
17 deployable Edge entrypoints type-checked, and Deno check/format/lint PASS.

Only Automation was redeployed from the canonical backend source. Production
Automation version 14 is ACTIVE with the reviewed platform JWT setting; bundle
SHA-256 is
`788c9cba804a2146cda1ded19ce2dbfc351c0ee3c5d9c7870e6c500201ace1e2`, and the
deployment source was the clean tree at commit
`cda4fe887bb5f2f1851a6cfc6dee47f4a34f1d2a`. A safe unauthenticated OPTIONS
request to the mailbox-item route returned HTTP 204 and advertised `PATCH` in
`Access-Control-Allow-Methods`. It performed no mailbox mutation.

The read-only Production snapshot at `2026-08-08T16:49:15Z` records one Gmail
mailbox, one connected Gmail mailbox, zero reconnect-required Gmail mailboxes,
and zero enabled, ingestion-enabled, or delivery-enabled Gmail mailboxes.
Settings remain absent, so the effective operating mode remains `disabled`.
Sync runs, source messages, source attachments, classifications, extractions,
commands, exceptions, allocation decisions, reminders, and reminder attempts
all remain zero. No migration, scheduler, worker secret, provider configuration,
OAuth credential, mailbox setting, or financial/business data was changed by
this deployment and verification.

Gate E remains OPEN. The next bounded implementation is the frontend atomic
ingestion control: replace the separate generic Enable and Enable ingestion
actions with one `Enable ingestion` PATCH containing `is_enabled=true` and
`ingestion_enabled=true`; the matching disable action sets both false. Delivery
must remain a separate capability. No real mailbox enable or synchronization was
performed at this checkpoint.

## Atomic ingestion-control frontend deployment

Claude Code implemented the bounded frontend follow-up in three files: the
Mailboxes page, its real page/hook regression suite, and the deterministic Gate
E Playwright scenario. The standalone generic Enable/Disable mailbox control is
removed. A connected disabled mailbox now exposes one `Enable ingestion` action
that sends exactly one PATCH containing only `is_enabled=true` and
`ingestion_enabled=true`; the corresponding disable action sends both fields as
false. Delivery remains an independent one-field mutation. OAuth connect actions,
manual synchronization, company kill switches, document intelligence, financial
automation switches, reminders, and operating mode are unchanged.

Codex independently reviewed the exact three-file diff read-only and returned
PASS with no blocking defects. Independent validation reproduced the focused
Automation page suite at 22/22, the full frontend suite at 65 files and 949/949
tests, TypeScript PASS, ESLint PASS, and the Next.js Production build PASS. The
modified deterministic Mailboxes browser assertions passed for both desktop and
mobile Chromium with empty in-memory storage. The first local runner subsequently
timed out while tearing down its owned loopback development server; the two test
assertions had already passed, no Production auth state was read, and the loopback
listener was confirmed stopped. This was a local process-teardown issue, not an
application assertion failure.

Commit `7ac02ad2ffd6b9956108c44e46eeffd7f6d506ae`
(`feat(gate-e): simplify ingestion activation`) was pushed to `main`. Vercel's
Git integration created Production deployment record `5812422908` for that exact
commit. The deployment completed successfully at
`https://account-receivable-module-wrqcjbpzu-time-00s-projects.vercel.app`, and
the canonical alias `https://account-receivable-module.vercel.app/` returned
HTTP 200. No duplicate manual Vercel deployment was created.

The read-only Production snapshot at `2026-08-08T20:31:02Z` remains unchanged:
one Gmail mailbox is connected, zero Gmail mailboxes require reconnect, and zero
Gmail mailboxes are enabled, ingestion-enabled, or delivery-enabled. One safe
ingestion-expiry metadata value remains present but is no longer future; this is
the exact condition Automation v14 resolves through secure refresh-on-enable and
does not require repeat consent by itself. Settings remain absent and operating
mode remains `disabled`. Sync runs, source messages, attachments,
classifications, extractions, commands, exceptions, allocation decisions,
reminders, and reminder attempts remain zero. The frontend deployment performed
no OAuth, provider, mailbox, financial, or business mutation.

Gate E remains OPEN. The deployed frontend and Automation v14 are ready for the
single authenticated human checkpoint: Production -> Automation -> Mailboxes ->
existing connected Gmail mailbox -> click `Enable ingestion` once. The operator
must not reconnect Gmail, connect delivery, run Sync now, change operating mode,
or enable another kill switch at this checkpoint.
