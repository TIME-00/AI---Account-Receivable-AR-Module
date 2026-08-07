# Autonomous AR Operations — User Guide (Gate E)

Accounts Receivable Management System for SMEs — Automation area.

> **Status:** Frontend implemented against the re-frozen `gate-e.1` contract.
> The backend is **implemented locally, pending deployment** and is
> **fail-closed**: no real document-intelligence provider, mailbox connection,
> email delivery, or scheduler is active, and Production straight-through
> processing is disabled. Nothing in this area processes real documents or sends
> real email today.

## Where to find it

**Sidebar → Automation.** The area has sub-tabs: Overview, Mailboxes, Runs,
Documents, Commands, Exceptions, Sales Representatives, Settings. Two features
live on existing detail screens: **customer assignment** (Customer detail) and
**invoice reminders** (Invoice detail).

Navigation is **role-aware** and mirrors the backend permission matrix exactly:

- **Finance Manager** — every tab.
- **AR Supervisor** — operational tabs (Overview, Runs, Documents, Commands,
  Exceptions) plus Settings and Sales Representatives.
- **Auditor** — every tab, **read-only**.
- **System Admin** — **configuration-only**: Settings, Mailboxes, and Sales
  Representatives. Operational tabs are hidden, and opening one by URL shows a
  safe permission-denied message (never a raw 403). System Admin may configure
  automation and turn it **off (Disabled)**, but **cannot arm** a non-disabled
  operating mode (Observe Only, Draft Only, Straight-Through) — those non-disabled
  mode controls are shown disabled and only a Finance Manager can select them.
- **AR Clerk** — Settings and Sales Representatives (read) plus a customer's
  responsible representative on the customer page.

Tabs a role cannot use are never shown, and direct-URL access to a disallowed
page fails closed with the same permission-denied surface.

## Automation Overview

A truthful, read-only dashboard: current operating mode, ingestion / delivery /
document-intelligence readiness (each independent),
each kill switch (enabled/disabled), connected/reconnect-required mailbox counts,
last successful/failed sync, and counters for runs, documents processed,
accepted/rejected documents, invoices/receipts created, allocations completed,
reminders evaluated/sent, and open/retryable exceptions. Counters reflect only
what has actually run.

## Operating modes

- **Disabled** — nothing runs; no records are created.
- **Observe Only** — documents may be classified, but no invoices, receipts,
  allocations, or reminder deliveries are created.
- **Draft Only** — valid documents create **unposted Draft** invoices/receipts
  for human review. Nothing is posted or allocated automatically.
- **Straight-Through** — valid documents are created **and posted**, and
  eligible receipts are auto-allocated by the database. Highest financial
  impact. Requires explicit confirmation (`ENABLE_STRAIGHT_THROUGH`) from a
  Finance Manager. Accepting that confirmation changes **only** the tenant
  operating-mode setting — it does **not** prove ingestion/delivery/document
  intelligence readiness and does not bypass any kill switch. Every capability
  worker independently rechecks its own readiness and kill switches at runtime
  and fails closed. Only a Finance Manager can select this (or any non-disabled)
  mode; System Admin cannot.

## Kill switches

Seven independent switches, all default **off**: Mailbox Synchronization,
Document Intelligence, Invoice Automation, Receipt Automation, Auto-Allocation,
Reminder Evaluation, Reminder Delivery. The backend remains authoritative and
may reject an unsafe combination.

## Gmail and Microsoft mailboxes

Configure Gmail / Google Workspace or Microsoft Outlook / 365 mailboxes. New
mailboxes are created **disabled**. Connecting a capability opens the provider's
own consent screen; ingestion and delivery are connected and toggled
independently. **Tokens, refresh tokens, authorization codes, secret values, and
raw cursor/delta values are never shown** — not even the secret-reference
*names*. The card shows only whether a secret is **Configured** (a yes/no
indicator), token expiry dates, cursor presence, and a redacted error code.
Before navigating to a provider consent screen the app re-validates the
authorization URL (HTTPS + exact allowlisted provider host, no embedded
credentials) and refuses any other URL. Connection states: Disabled, Pending
Consent, Connected, Reconnect Required, Error. When a provider is not configured,
actions return "Provider Configuration Required".

## Provider readiness

Readiness is reported per capability — there is **no** generic "provider ready"
flag:

- **Ingestion Readiness** — whether mailbox document ingestion is ready.
- **Delivery Readiness** — whether reminder-email delivery is ready. This is
  **independent** of ingestion; the reminder panel never claims delivery is ready
  because ingestion happens to be.
- **Document Intelligence** — whether the bounded classification/extraction
  provider is enabled.

Each is derived fail-closed on the server (an enabled, connected, non-reconnect
mailbox with that capability enabled, a valid future token expiry, a ready
adapter, and a resolvable non-blank opaque secret). "Provider Configuration
Required" means the real provider/secret has not been provisioned. None of these
readiness flags is shown as Live or Active, and none of them arms a mode or a
kill switch.

## Processing runs

Each mailbox synchronization run: provider, status, start/end, cursor presence
(shown as "Set (hidden)"/"None" — never the raw token), messages/attachments
discovered, attachments processed, commands processed, allocations completed,
failures, and a redacted error code.

## Document decisions

Every classified attachment shows three clearly separated stages:

1. **AI Candidate** — classification type, confidence, and provider/model/version.
   A candidate only — *never* a financial approval.
2. **Deterministic Validation** — schema/arithmetic/currency/date/customer checks
   and validation codes performed by the backend.
3. **Authoritative Result** — the classification outcome and any resulting record.

Raw document bytes, raw email bodies, prompts, hidden reasoning, tokens, and
unrestricted extraction payloads are never shown.

## Automation commands

Monitors `create_invoice`, `create_receipt`, and `allocate_receipt` commands
with status and links to the resulting invoice/receipt. The allocation action
sends an **empty request** — the database re-derives the receipt, invoices,
amounts, evidence, tenant, customer, and FX. The frontend supplies no financial
authority and performs no FX or allocation calculation.

## Exception queue

Documents that cannot be processed safely become exceptions (Open, Retryable,
Resolved, Dismissed) with a safe reason code and redacted details. Authorized
users can Retry (re-enters the backend's authoritative path), Resolve, or Dismiss
(both require a note). **Exceptions never create financial records** — a rejected
or duplicate document is stored as evidence and never becomes an invoice,
receipt, or allocation.

## Sales representatives

Tenant business contacts (name, email, international phone, active state) who
receive invoice due reminders. They **do not log in**, have **no password**, and
have **no financial role**. An active representative must have an email address.
Authorized users can **add** a representative and **edit** an existing one
(the form is prefilled with the current values); the directory is paginated and
supports Unicode names.

## Customer assignment / reassignment

On the customer page, a customer has **exactly one current responsible
representative** (enforced by the backend). Assignment records a source
(acquisition, onboarding, manual, import) and a required reason; reassignment is
explicit and keeps a full, immutable history. Visiting a customer never silently
changes ownership. There is no GPS, check-in, attendance, or visit tracking.

## Invoice reminders

On the invoice page, reminder status is shown for **Invoices only** (no Debit
Notes). Policy: evaluated 3 days before and on the due date for invoices with an
outstanding balance and a current active representative. States include no
representative, inactive representative, missing/invalid email, disabled,
delivery disabled, provider not configured, pending, sending, delivered,
retryable failure, permanent failure, and unconfirmed provider outcome. The
delivery banner is **derived** from the tenant settings and **delivery
readiness** specifically (never ingestion readiness, and never a hard-coded
"disabled"). Reminder status is an operational read — it is available to AR
Supervisor, Finance Manager, and Auditor; other roles see a safe unavailable
notice and no reminder request is issued. Each reminder can be expanded to show its
delivery attempts (attempt number, status, timestamps, and a safe provider
message id) and an entity-scoped audit timeline. There is no "send real email"
action on this panel.

## Audit timeline

A reusable timeline shows safe audit events (settings, mailbox, representative,
assignment, run, decision, command, exception, and reminder transitions) with
event, actor/system, timestamp, entity, and a safe summary. Secrets, tokens, raw
provider bodies, raw documents, and stack traces are never shown.

## Why fail-closed matters

Financial correctness is mandatory. AI output is only a candidate; the database
performs deterministic validation and is the sole authority for creating,
posting, and allocating records. Anything ambiguous, invalid, unsafe, duplicate,
low-confidence, or financially inconsistent fails closed to the exception queue
and creates no financial record.

## What still requires configuration before real operation

A concrete document-intelligence provider, secure OAuth token storage and
refresh, real mailbox connections, and reminder delivery must be provisioned and
enabled (and the backend deployed) before any real autonomous processing. All of
these are disabled by default today.
