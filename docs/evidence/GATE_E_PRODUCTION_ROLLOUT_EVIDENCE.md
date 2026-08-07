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

### Provider, worker, and scheduler status

Production secret-name inspection found all activation-specific configuration
absent:

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

### Remaining prerequisites

1. Provision `OPENAI_API_KEY` through Supabase Edge secret management without
   exposing the value, then run synthetic invoice and receipt smoke tests.
2. Provision provider-specific Google and Microsoft client configuration and
   complete human consent with only the documented least-privilege scopes.
3. Add and independently review the persistent Vault-backed `pg_cron`/`pg_net`
   scheduler installation before provisioning `AUTOMATION_WORKER_SECRET` and the
   job together.
4. Re-authenticate the authorized demo Finance session locally through the
   normal login flow and run the authenticated read-only Production UI/API
   smoke without exposing auth-state content.
5. Configure only controlled synthetic mailbox, customer, representative, and
   recipient data before progressing through `observe_only`, `draft_only`, and
   `straight_through` one phase at a time.

Local validation remains independently accepted: OpenAI 41/41,
activation-prerequisites 21/21, Gate E 81/81, combined focused 143/143, complete
backend 394/394, Deno format/lint PASS, and deployable Edge entrypoints 17/17.

**Gate E remains OPEN and PENDING ACTIVATION.** Production remains deployed and
fail-closed in `disabled` mode. No Production financial/business DML occurred
during this continuation.
