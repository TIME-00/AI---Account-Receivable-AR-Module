# Post-Gate-E Journal and Audit Read Viewers

Status: IMPLEMENTED / VALIDATED LOCALLY — PENDING CODEX REVIEW AND DEPLOYMENT. The backend/database read side passed independent review, and the frontend Journal Entries and Audit Trail viewers are implemented and validated locally. Migration 044 is **not applied**, the `journal-entries` and `audit-trail` Edge Functions are **not deployed**, and the frontend is **not deployed**. This work is not part of Gate E and does not change journal generation, posting, allocations, Automation, Gmail, FX authority, or historical evidence.

The current Journal Entries and Settings > Audit Trail pages are no longer reference-only: they are read-only operational viewers over these APIs (list, filters, keyset pagination, and detail). The paragraph below describes the pre-implementation state that motivated the feature.

## Purpose and boundary

Before this feature, the Journal Entries and Settings > Audit Trail pages were reference-only pages and requested no journal or audit data. This feature introduces authenticated, company-scoped, read-only APIs that expose existing authoritative evidence. It does not create a manual Journal Entry path or a universal synthetic audit table.

The read boundary has four layers:

1. The Edge Function validates JWT identity and the requested company.
2. An endpoint-specific role check is applied before any service call.
3. The service passes only the authenticated company and actor identity to private PostgreSQL read RPCs.
4. Each `SECURITY DEFINER` RPC repeats company and role checks because the service-role client bypasses RLS.

All monetary values cross the API as exact decimal strings. PostgreSQL `NUMERIC` remains authoritative.

## Roles

| Surface | Finance Manager | AR Supervisor | Auditor | AR Clerk | System Admin |
|---|---:|---:|---:|---:|---:|
| Global Journal Entries | Yes | Yes | Yes | No | No |
| Global Audit Trail | Yes | No | Yes | No | No |

AR Clerk is excluded from both global surfaces. Journal headers do not uniformly carry a customer identifier, so a complete assigned-customer filter cannot be safely derived for every source type. System Admin remains configuration-only. The global Audit Trail is narrower than ordinary operational reading because it consolidates customer-master, credit-control, financial, import, Automation, reminder, and FX evidence.

## Journal source of truth

Headers come from `public.journal_entries`; lines come from `public.journal_entry_lines`; account display fields come from the same-company row in `public.gl_accounts`. The API neither recalculates journal values nor infers missing lines.

The database constraint vocabulary is returned unchanged:

`INV`, `RCT`, `CN`, `DN`, `REV`, `ADJ`, `WO`.

Source links are allow-listed:

- `INV`, `CN`, and `DN` link only when `source_doc_id` resolves to a same-company Invoice-family row. The actual stored `doc_type` determines `invoice`, `credit_note`, or `debit_note`.
- `RCT` links only when `source_doc_id` resolves to a same-company Receipt.
- `REV`, `ADJ`, `WO`, and unresolved legacy sources are deliberately non-linkable.

No database table name, URL, or arbitrary route fragment is returned as source authority.

## Journal API

### `GET /journal-entries`

Authorized roles: AR Supervisor, Finance Manager, Auditor.

Filters:

- `q`: bounded search over JE number, source-document number, and journal description;
- `date_from`, `date_to`: JE date;
- `source_type`: exact database vocabulary;
- `currency`: three-letter code;
- `account_code`: exact account code on a same-company journal line;
- `limit`: 1–50, default 25;
- `cursor`: unpadded base64url JSON.

Ordering is stable: `created_at DESC, id DESC`. The cursor contains exactly those fields. PostgreSQL fetches at most `limit + 1` rows and returns only `limit`.

List records contain:

- JE identity, number, date, period, description;
- stored source type/document identity;
- document and base currencies;
- stored debit and credit totals as decimal strings;
- balance state based on stored authoritative totals;
- reversal marker;
- creation actor UUID or null, and timestamp;
- line count;
- bounded source entity metadata or null.

### `GET /journal-entries/:id`

Returns the list header fields plus:

- stored exchange-rate snapshot as a decimal string;
- original/reversal JE links;
- reversal lifecycle fields;
- lines ordered by `line_no`, then line UUID;
- same-company GL account code, name, and type;
- stored debit/credit/base amounts and original amount as decimal strings.

A missing or cross-company UUID returns the same safe not-found contract. No mutation method exists.

## Audit source-of-truth matrix

Production was inspected read-only before implementation. Counts are inventory evidence, not fixed product assumptions.

| Source | Included authoritative events | Timestamp / actor authority | Before/after | Production rows/events at inspection | Privacy handling |
|---|---|---|---|---:|---|
| `invoices` | created, posted, cancelled for Invoice/CN/DN | stored lifecycle timestamps and actor UUIDs | No fabricated status transition | 22 created, 17 posted, 2 cancelled | document identifiers/status; cancellation reason bounded |
| `receipts` | created, posted, cancelled when present | stored lifecycle timestamps and actor UUIDs | No fabricated status transition | 14 created, 13 posted, 0 cancelled | receipt identifier/status; cancellation reason bounded |
| `allocation_details` | allocated, reversed when present | allocation/reversal timestamps and actors | No invented prior state | 15 allocations, 2 reversals | amount/method/status and document numbers only |
| `cn_allocations` | allocated, reversed when present | allocation/reversal timestamps and actors | No invented prior state | 0 | amount/status and document numbers only |
| `journal_entries` | journal generated | stored `created_at`/`created_by` | Not applicable | 33 | journal/source identifiers and exact totals |
| `customer_change_logs` | field changed | stored `changed_at`/`changed_by` | Yes, only because old/new are stored | 7 | safe field allow-list; other values redacted |
| `credit_control_logs` | credit-control action recorded | stored creation actor/time | No | 1 | excludes free-form details/reason |
| `report_audit_logs` | report generated | stored generated actor/time | No | 0 | excludes parameters and recipient |
| selected `automation_audit_events` | command/exception lifecycle audit, governed recovery/matching, sales assignment | stored actor type/user and timestamp | No | 71 included events from 1,444 total audit rows at final inspection | six allow-listed metadata keys only |
| `invoice_reminders` | reminder evaluated/created | stored creation time; actor unavailable | No | 1 | no recipient name/email/phone |
| `reminder_delivery_attempts` | delivery attempted | stored attempt times/status; actor unavailable | No | 1 | no provider message id or recipient data |
| `fx_booking_rate_decision_events` | stored decision event | stored event time, actor UUID/role | stored prior/new approval states only | 52 | exact stored rate/provenance fields only |
| `import_batches` | created, completed, cancelled when timestamps exist | stored creation/cancellation actors; completion actor unavailable | No | 6 batches | UUID and bounded counts; no filename/path/error JSON |

### Deliberately excluded sources

- Raw OAuth, mailbox, source-message, attachment, OCR, classification, extraction, and provider payloads are excluded. They can contain tokens, email content, document text, or operational noise.
- `automation_commands.command_payload`, exception raw details, trace ids, import filenames/paths/error summaries, report parameters/recipients, reminder recipient snapshots, provider message ids, and free-form credit-control details are excluded.
- User/customer assignment tables are not emitted as generic audit events unless an explicit stored audit event proves the action and actor.
- No event is created from a current status alone when no authoritative event timestamp exists.
- No historical row is synthesized or backfilled for this viewer.

## Normalized Audit event

Each row contains:

```text
event_id       stable source-kind prefix + authoritative source UUID
occurred_at    authoritative stored timestamp
actor          type, user UUID or null, display name or null, stored role or null
action         bounded normalized action
entity         bounded entity type, authoritative UUID, safe number when available
result         stored status/result when available
summary        bounded business summary assembled from safe identifiers
metadata       strict source-specific allow-list
source_kind    authoritative evidence source family
```

Actor rules:

- `user` requires a stored user UUID;
- `system` is used only when `automation_audit_events.actor_type` explicitly proves a non-user worker/provider-fixture origin;
- null actors are `unknown`, not “System Automation”;
- user email is never returned;
- a role is returned only when the source stored that role at event time (currently FX decision events). A current role lookup is not misrepresented as historical role authority.

## Audit API

### `GET /audit-trail`

Authorized roles: Finance Manager and Auditor.

Filters:

- `date_from`, `date_to`;
- `action`;
- `entity_type`;
- `actor_type` (`user`, `system`, `unknown`);
- `actor_user_id` UUID;
- `result`;
- `q`, limited to safe entity/document identifiers;
- `limit` 1–50, default 25;
- stable cursor.

Ordering is `occurred_at DESC, event_id DESC`. Event IDs are unique by source-kind prefix plus the authoritative source UUID. The cursor contains exactly those two ordering keys.

### `GET /audit-trail/:eventId`

Returns exactly the normalized event that list would return. Cross-company or unknown event IDs return safe not-found. No mutation method exists.

The list representation deliberately contains the complete safe normalized event DTO, so the first-party Dialog can render the selected list row without a second request. The detail endpoint remains the canonical direct lookup for clients that start from an event id; both paths use the same strict frontend event parser so their normalized semantics cannot drift.

The first-party filter UI omits `actor_user_id` because the application has no privacy-safe user directory for this surface, and it omits a universal Result dropdown because stored result vocabularies differ by source. Both bounded backend filters remain available to authorized API clients; the UI does not invent a user directory or a misleading cross-source result enum.

## Metadata redaction

The database creates source-specific JSON objects. The Edge service independently rejects any key outside its source-kind allow-list. This double boundary prevents a future schema or RPC mistake from leaking arbitrary row JSON.

The browser independently strict-parses list, detail, actor, cursor, exact-decimal, and source-specific metadata contracts. An unexpected field, monetary number, inconsistent cursor envelope, incomplete journal detail, or unknown metadata key fails closed into the viewer's bounded error state.

Customer change values are visible only for this safe operational field set:

- status;
- customer type;
- default currency;
- credit rating;
- e-Invoice enabled;
- hidden flag;
- payment-term identifier;
- customer-group identifier.

Every other field returns `value_redacted: true`; the raw old/new values are omitted. Change-reason presence is represented as a boolean rather than returning a potentially sensitive reason.

## Migration 044

`database/044_post_gate_e_journal_audit_read_viewers.sql` adds:

- one journal keyset index `(company_id, created_at DESC, id DESC)`;
- private source helpers;
- four service-role-only list/detail RPCs.

All functions are PostgreSQL-owned, `STABLE`, `SECURITY DEFINER`, and use `search_path=''` with fully-qualified objects. `PUBLIC`, `anon`, and `authenticated` have no execution privilege. Private source helpers also deny `service_role`; only the guarded list/detail RPCs form the backend boundary.

The migration contains no financial or audit-source DML. The single new index is on the 33-row journal header table at the read-only Production inventory checkpoint, so its lock duration is expected to be minimal; rollout must still verify the live catalog before application.

`database/044b_post_gate_e_journal_audit_read_viewers_smoke_tests.sql` is rollback-only. It validates ownership, security mode, search path, grants, list envelopes, unauthorized refusal, cross-company detail behavior when a second tenant fixture exists, and unchanged source-row counts.

## Known evidence limitations

- No safe application display-name directory currently exists for this read model. User UUID is returned honestly; email is not exposed.
- Invoice and Receipt lifecycle fields prove create/post/cancel events, but do not prove arbitrary field-by-field before/after state.
- Reminder and import completion rows do not store an acting user; the viewer shows `unknown`.
- Existing source tables vary in audit richness. The viewer exposes that evidence faithfully rather than claiming universal event completeness.

Accurate product wording is: “Authoritative financial lifecycle events and audit fields are recorded and exposed through the Audit Trail.”
