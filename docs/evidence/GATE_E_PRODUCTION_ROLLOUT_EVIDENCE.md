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

Gate E remains open and pending activation. Continuation requires:

1. Re-authenticate the existing authorized demo Finance Playwright session
   locally without exposing credentials or auth-state content, then repeat the
   authenticated read-only Production UI/API smoke.
2. Implement and independently review an approved secure OAuth token writer and
   an unambiguous per-provider or generic callback contract.
3. Provision Google and Microsoft client configuration and perform human OAuth
   consent with only the documented least-privilege scopes.
4. Independently review the now-selected local OpenAI Responses API document-
   intelligence adapter, then provision its Edge secret only after deployment
   authorization.
5. Provision a dedicated worker secret together with the reviewed external
   scheduler, never one without the other.
6. Configure a controlled synthetic mailbox/recipient, then progress through
   `observe_only`, `draft_only`, and `straight_through` only after each preceding
   phase passes.

No credential value should be pasted into chat, logs, evidence, or Git.

## Local activation-prerequisite remediation (pending independent review)

The Production facts above remain unchanged. A local, unstaged and uncommitted
remediation now addresses the repository-owned OAuth and scheduling
prerequisites but has not been applied or deployed:

- forward-only `035_gate_e_secure_oauth_vault.sql` adds service-role-only,
  tenant/mailbox/provider/capability-bound Supabase Vault write, resolve,
  rotate, and delete RPCs plus opaque-reference collision guards;
- the Production composition is changed locally from
  `DisabledOAuthSecretWriter` to `VaultOAuthSecretStore`;
- OAuth redirects are split into `GMAIL_OAUTH_REDIRECT_URI` and
  `MICROSOFT_OAUTH_REDIRECT_URI`, each constrained to its exact callback path
  and the Edge runtime's exact `SUPABASE_URL` HTTPS origin;
- callback completion is bound to the hashed, expiring, single-use state rather
  than browser authentication headers that providers do not return;
- Gmail/Microsoft access-token refresh rotates the Vault bundle and persists
  only safe expiry/reconnect metadata;
- Microsoft offline authority is proven from the returned refresh token rather
  than incorrectly requiring `offline_access` in the access-token scope string;
- local disconnect deletes the Vault credential and disables the requested
  capability without exposing token or secret-reference values;
- Vault operations verify the exact Gate E context description, so an unrelated
  pre-existing Vault name cannot be overwritten, resolved, or deleted; and
- the scheduler design is frozen to the project's established Supabase
  `pg_cron` + `pg_net` invocation with a dedicated Vault-backed
  `AUTOMATION_WORKER_SECRET`, provisioned together only during a later
  authorized activation; and
- the approved document-intelligence provider is implemented locally as a
  direct OpenAI Responses API adapter using strict Structured Outputs, bounded
  Base64 PDF/image input, no tools, a 25-second timeout, at most one transient
  retry, and the default server-side model `gpt-5.6-luna`.

The OpenAI adapter requires the Supabase Edge secret `OPENAI_API_KEY` and
optionally accepts the server-side `OPENAI_DOCUMENT_MODEL` override. Neither is
provisioned in this local phase. Missing or invalid configuration selects
`DisabledDocumentIntelligenceProvider`; no dashboard read performs a provider
request, and `document_intelligence_ready` therefore remains false in the
currently deployed Production version. No real OpenAI request or document
upload occurred during implementation or tests.

OpenAI structured output supplies conservative boolean uncertainty gates rather
than a provider-calibrated probability. The adapter maps these to the existing
internal `0`/`1` confidence policy, after which semantic dates, exact decimal
arithmetic, customer resolution, duplicates, FX, posting, and allocation remain
deterministic backend/PostgreSQL authority. Document content is explicitly
untrusted data and cannot alter the fixed model instructions.

Local validation is complete: the OpenAI document-intelligence suite is 41/41,
the activation-prerequisite suite remains 21/21, and the existing Gate E suite
remains 81/81, for a combined focused result of 143/143. The complete recursive
backend suite is 394/394. The full Automation scope passes Deno format and lint,
and all 17 deployable Edge entry points type-check.
A disposable PostgreSQL 17.6 database rebuilt the project public schema through
Migration 035 from the explicit 001-035 manifest; both rollback-only 034b and
035b completed with `ROLLBACK`, all 16 Gate E tables retained RLS and policies,
all three Vault RPCs were service-role-only with fixed empty `search_path`, and
mailbox/OAuth-state/Vault smoke residue was zero.

This section is not activation or closure evidence. Gate E remains **OPEN**,
the deployed operating mode remains **disabled**, no provider or scheduler is
configured, and the local remediation requires one Claude Code independent
read-only review before any source commit, push, migration, or deployment.
