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
4. Implement and independently review the concrete Production document-
   intelligence adapter.
5. Provision a dedicated worker secret together with the reviewed external
   scheduler, never one without the other.
6. Configure a controlled synthetic mailbox/recipient, then progress through
   `observe_only`, `draft_only`, and `straight_through` only after each preceding
   phase passes.

No credential value should be pasted into chat, logs, evidence, or Git.
