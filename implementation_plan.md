# TSH Synergy AR — Production Architectural Roadmap v2

> **Revised per Senior Backend Architect review. All `ar.*` references corrected to `public` schema.**

---

## 1. Current Architecture & Critical Gaps

| Layer | Current State | Gap |
|-------|--------------|-----|
| Schema | `public` schema, 23 tables | No `ar.*` namespace (confirmed) |
| RLS | **None** | All isolation in Edge Functions only |
| Transactions | `withTransaction()` is a no-op wrapper | No real ACID for multi-table writes |
| Auth | `getAdminClient()` bypasses RLS | Service-role used for all mutations |
| Events | None | No outbox pattern |

> [!CAUTION]
> **The `withTransaction()` in `_shared/db.ts:86` provides zero transactional guarantees.** Allocation inserts `allocation_details` rows then separately updates `invoices.outstanding` with optimistic locking. If the version check fails, orphaned allocation rows remain. This is the highest-risk item.

---

## 2. Phase P0 — Security & Correctness Foundation

### 2.1 RLS Using `auth.uid()` + `user_roles` Table

RLS must derive identity from `auth.uid()` and verify membership via `user_roles`, not JWT claims.

#### [NEW] `database/006_rls_policies.sql`

```sql
-- ═══ Helper: check if current user belongs to a company ═══
CREATE OR REPLACE FUNCTION user_belongs_to_company(p_company_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
      AND company_id = p_company_id
      AND is_active = TRUE
  );
$$;

-- ═══ Helper: check if user has role or above in company ═══
CREATE OR REPLACE FUNCTION user_has_company_role(p_company_id UUID, p_min_role VARCHAR)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT user_has_role_or_above(auth.uid(), p_company_id, p_min_role);
$$;

-- ═══ Helper: AR Clerk customer-level restriction ═══
CREATE OR REPLACE FUNCTION user_can_access_customer(p_customer_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.is_active = TRUE
      AND ur.role IN ('AR Supervisor','Finance Manager','System Admin')
  ) OR EXISTS (
    SELECT 1 FROM user_customer_assignments uca
    WHERE uca.user_id = auth.uid() AND uca.customer_id = p_customer_id
      AND uca.is_active = TRUE
  );
$$;

-- ═══ Enable RLS on ALL tables ═══
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE cn_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_bank_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_change_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_control_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE aging_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar_system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_customer_assignments ENABLE ROW LEVEL SECURITY;

-- ═══ Company-scoped policies (tables WITH company_id) ═══
-- Pattern: user must have active role in that company
CREATE POLICY tenant_read ON invoices FOR SELECT
  USING (user_belongs_to_company(company_id));
CREATE POLICY tenant_write ON invoices FOR INSERT
  WITH CHECK (user_belongs_to_company(company_id));
CREATE POLICY tenant_update ON invoices FOR UPDATE
  USING (user_belongs_to_company(company_id));
-- Repeat for: receipts, customers, journal_entries, gl_accounts,
-- bank_accounts, fiscal_periods, payment_terms, tax_codes,
-- exchange_rates, aging_buckets, ar_system_config, products,
-- document_sequences, credit_control_logs, report_audit_logs

-- ═══ Child table policies (via parent join) ═══
CREATE POLICY tenant_read ON invoice_lines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = invoice_lines.invoice_id
      AND user_belongs_to_company(i.company_id)
  ));
-- Repeat for: journal_entry_lines (via je_id→journal_entries),
-- customer_bank_details (via customer_id→customers),
-- allocation_details (via receipt_id→receipts),
-- cn_allocations (via cn_id→invoices),
-- customer_change_logs (via customer_id→customers)

-- ═══ Auditor: read-only ═══
-- Auditors get SELECT from the tenant policies above.
-- INSERT/UPDATE/DELETE policies require role >= AR Clerk.

-- ═══ user_roles: users see only their own rows ═══
CREATE POLICY own_roles ON user_roles FOR SELECT
  USING (user_id = auth.uid());
```

**Key principles from Architect feedback:**
- Every policy derives from `auth.uid()` — never JWT claims alone
- Role checks query active `user_roles` rows — revocation takes effect immediately
- AR Clerk customer isolation uses `user_customer_assignments`
- Child tables without `company_id` use parent joins
- Status transition logic does NOT belong in RLS — belongs in stored procedures

### 2.2 Edge Function Client Strategy

| Operation Type | Client | Rationale |
|---------------|--------|-----------|
| Read (lists, detail pages) | `getUserClient()` | RLS enforces tenant + role |
| Financial mutations | `getAdminClient()` → calls RPC | RPC is `SECURITY DEFINER` with internal checks |
| Config/system jobs | `getAdminClient()` | Controlled internal operations only |

### 2.3 pgTAP Test Plan

#### [NEW] `database/tests/rls_tests.sql`

Tests to write:
- Cross-company read attempt → 0 rows returned
- Cross-company write attempt → denied
- AR Clerk cannot see unassigned customer's invoices
- Auditor cannot INSERT/UPDATE/DELETE
- Role revocation (`is_active = FALSE`) → immediate access loss
- Child table isolation (invoice_lines of foreign invoice → 0 rows)

---

## 3. Phase P1 — Financial Integrity (Postgres RPCs)

> [!IMPORTANT]
> **This is the biggest architectural change.** All multi-step financial mutations must become single atomic database operations using `SECURITY DEFINER` stored procedures with `SELECT ... FOR UPDATE` row locks.

### 3.1 RPC: `post_invoice()`

#### [NEW] `database/007_financial_rpcs.sql`

```sql
CREATE OR REPLACE FUNCTION post_invoice(
  p_invoice_id UUID,
  p_user_id UUID,
  p_company_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv RECORD;
  v_period VARCHAR(7);
  v_je_id UUID;
  v_je_no VARCHAR(30);
  v_inv_no VARCHAR(20);
BEGIN
  -- 1. Lock invoice row
  SELECT * INTO v_inv FROM invoices
    WHERE id = p_invoice_id AND company_id = p_company_id
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Invoice not found'; END IF;
  IF v_inv.status != 'Draft' THEN RAISE EXCEPTION 'BR-INV-002: Only Draft invoices can be posted'; END IF;

  -- 2. Validate fiscal period is open
  v_period := to_char(v_inv.invoice_date, 'YYYY-MM');
  IF NOT EXISTS (SELECT 1 FROM fiscal_periods WHERE company_id = p_company_id AND period_code = v_period AND status = 'Open') THEN
    RAISE EXCEPTION 'BR-JE-007: Fiscal period % is not open', v_period;
  END IF;

  -- 3. Generate JE number (locks sequence row)
  SELECT get_next_sequence(p_company_id, 'JE', 'INV') INTO v_je_no;

  -- 4. Create balanced JE header + lines
  INSERT INTO journal_entries (company_id, je_no, je_date, posting_period, source_type, source_doc_id, source_doc_no, ...)
  VALUES (...) RETURNING id INTO v_je_id;
  -- Insert JE lines: Dr AR Control, Cr Revenue, Cr Tax Output...

  -- 5. Update invoice status atomically
  UPDATE invoices SET status = 'Open', posting_period = v_period, posted_by = p_user_id, posted_at = NOW()
    WHERE id = p_invoice_id;

  -- 6. Emit domain event (Transactional Outbox — same transaction)
  INSERT INTO domain_events (company_id, event_type, aggregate_type, aggregate_id, payload)
  VALUES (p_company_id, 'INVOICE_POSTED', 'invoice', p_invoice_id,
    jsonb_build_object('invoice_no', v_inv.invoice_no, 'total', v_inv.total_amount));

  RETURN jsonb_build_object('invoice_no', v_inv.invoice_no, 'je_no', v_je_no, 'status', 'Open');
END;
$$;
```

### 3.2 RPC: `allocate_receipt()`

```sql
CREATE OR REPLACE FUNCTION allocate_receipt(
  p_receipt_id UUID,
  p_user_id UUID,
  p_company_id UUID,
  p_allocations JSONB  -- [{invoice_id, amount, discount_amount}]
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rct RECORD; v_inv RECORD; v_alloc JSONB;
  v_total_alloc NUMERIC := 0; v_forex NUMERIC;
BEGIN
  -- 1. Lock receipt
  SELECT * INTO v_rct FROM receipts WHERE id = p_receipt_id AND company_id = p_company_id FOR UPDATE;
  IF v_rct.status NOT IN ('Posted','Fully Allocated') THEN RAISE EXCEPTION 'BR-REC-001'; END IF;

  -- 2. Process each allocation line
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    -- Lock invoice row
    SELECT * INTO v_inv FROM invoices
      WHERE id = (v_alloc->>'invoice_id')::UUID FOR UPDATE;

    -- Validate: amount <= outstanding
    IF (v_alloc->>'amount')::NUMERIC > v_inv.outstanding + 0.005 THEN
      RAISE EXCEPTION 'BR-REC-002: Allocation exceeds outstanding for %', v_inv.invoice_no;
    END IF;

    -- Calculate forex G/L from locked rows
    v_forex := round(((v_alloc->>'amount')::NUMERIC * (v_rct.exchange_rate - v_inv.exchange_rate))::NUMERIC, 2);

    -- Insert allocation_details
    INSERT INTO allocation_details (...) VALUES (...);

    -- Update invoice outstanding
    UPDATE invoices SET outstanding = outstanding - (v_alloc->>'amount')::NUMERIC,
      status = CASE WHEN outstanding - (v_alloc->>'amount')::NUMERIC <= 0.005 THEN 'Paid'
                    ELSE 'Partially Paid' END,
      version = version + 1
    WHERE id = (v_alloc->>'invoice_id')::UUID;

    v_total_alloc := v_total_alloc + (v_alloc->>'amount')::NUMERIC;
  END LOOP;

  -- 3. Update receipt balances
  UPDATE receipts SET allocated_amount = allocated_amount + v_total_alloc,
    unallocated_amount = unallocated_amount - v_total_alloc,
    status = CASE WHEN unallocated_amount - v_total_alloc <= 0.005 THEN 'Fully Allocated' ELSE status END
  WHERE id = p_receipt_id;

  -- 4. Create allocation JE (Dr Bank/Cr AR + forex entries)
  -- ... (balanced JE with forex gain/loss lines)

  -- 5. Emit outbox event
  INSERT INTO domain_events (...) VALUES (p_company_id, 'RECEIPT_ALLOCATED', 'receipt', p_receipt_id, ...);

  RETURN jsonb_build_object('allocated_count', jsonb_array_length(p_allocations), 'total', v_total_alloc);
END;
$$;
```

### 3.3 Full RPC List

| RPC | Locks | Emits Event |
|-----|-------|-------------|
| `post_invoice(id, user, company)` | invoice FOR UPDATE | `INVOICE_POSTED` |
| `post_receipt(id, user, company)` | receipt FOR UPDATE | `RECEIPT_POSTED` |
| `allocate_receipt(receipt, user, company, lines[])` | receipt + each invoice FOR UPDATE | `RECEIPT_ALLOCATED` |
| `reverse_allocation(alloc_id, user, company, reason)` | allocation + invoice + receipt FOR UPDATE | `ALLOCATION_REVERSED` |
| `post_write_off(invoice, user, company, amount, reason)` | invoice FOR UPDATE | `WRITE_OFF_POSTED` |
| `reverse_journal_entry(je_id, user, company, reason)` | JE FOR UPDATE | `JE_REVERSED` |

### 3.4 Database Constraints to Add

#### [NEW] `database/008_financial_constraints.sql`

```sql
-- Prevent negative outstanding
ALTER TABLE invoices ADD CONSTRAINT chk_invoice_outstanding_nonneg CHECK (outstanding >= 0);
-- (already exists at line 574)

-- Prevent negative unallocated
-- (already exists via chk_receipt_unallocated)

-- Unique non-reversed JE per source document
CREATE UNIQUE INDEX uq_je_source_active
  ON journal_entries (company_id, source_type, source_doc_id)
  WHERE is_reversed = FALSE;

-- Idempotency key for POST endpoints
ALTER TABLE invoices ADD COLUMN idempotency_key UUID UNIQUE;
ALTER TABLE receipts ADD COLUMN idempotency_key UUID UNIQUE;
```

### 3.5 Edge Function Refactoring

Edge Functions become thin orchestrators that validate input → call RPC → return result:

```typescript
// AFTER: invoices/service.ts — postInvoice()
async postInvoice(invoiceId: string, userId: string, companyId: string) {
  const { data, error } = await this.client.rpc('post_invoice', {
    p_invoice_id: invoiceId,
    p_user_id: userId,
    p_company_id: companyId,
  });
  if (error) throw this.mapRpcError(error);
  return data;
}
```

---

## 4. Phase P2 — Transactional Outbox Pattern

### 4.1 Outbox Tables

#### [NEW] `database/009_domain_events.sql`

```sql
CREATE TABLE domain_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id),
  event_type      TEXT NOT NULL,
  aggregate_type  TEXT NOT NULL,
  aggregate_id    UUID NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  schema_version  INT NOT NULL DEFAULT 1,
  idempotency_key UUID NOT NULL DEFAULT gen_random_uuid(),
  correlation_id  UUID,
  causation_id    UUID,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_de_type ON domain_events (event_type, occurred_at);
CREATE INDEX idx_de_aggregate ON domain_events (aggregate_type, aggregate_id);

-- Separate delivery tracking per consumer
CREATE TABLE domain_event_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES domain_events(id),
  consumer        TEXT NOT NULL,  -- 'e-invoice', 'bad-debt-evaluator', 'genai-scorer'
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','completed','failed','dead_letter')),
  attempt_count   INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error      TEXT,
  locked_at       TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,

  CONSTRAINT uq_delivery UNIQUE (event_id, consumer)
);

CREATE INDEX idx_ded_pending ON domain_event_deliveries (consumer, next_attempt_at)
  WHERE status IN ('pending','failed');
```

### 4.2 Processing Pattern

```sql
-- Consumer picks up events with SKIP LOCKED
WITH next_event AS (
  SELECT ded.id, ded.event_id FROM domain_event_deliveries ded
  WHERE ded.consumer = 'e-invoice' AND ded.status IN ('pending','failed')
    AND ded.next_attempt_at <= NOW() AND ded.attempt_count < ded.max_attempts
  ORDER BY ded.next_attempt_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
UPDATE domain_event_deliveries SET status = 'processing', locked_at = NOW(), attempt_count = attempt_count + 1
WHERE id = (SELECT id FROM next_event) RETURNING *;
```

### 4.3 Auto-Register Consumers via Trigger

```sql
-- When a domain_event is inserted, auto-create delivery rows for registered consumers
CREATE OR REPLACE FUNCTION register_event_deliveries()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO domain_event_deliveries (event_id, consumer)
  SELECT NEW.id, unnest(ARRAY['audit-log','notification'])  -- base consumers
  UNION ALL
  SELECT NEW.id, 'e-invoice' WHERE NEW.event_type = 'INVOICE_POSTED'
  UNION ALL
  SELECT NEW.id, 'bad-debt-evaluator' WHERE NEW.event_type = 'OVERDUE_DETECTED';
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_domain_event_deliveries
  AFTER INSERT ON domain_events FOR EACH ROW EXECUTE FUNCTION register_event_deliveries();
```

---

## 5. Phase P3 — Performance

### 5.1 Keyset (Cursor) Pagination

Replace `OFFSET/LIMIT` in all list endpoints:

```sql
-- Constant-time regardless of depth
SELECT * FROM invoices
WHERE company_id = $1 AND (created_at, id) < ($last_created_at, $last_id)
ORDER BY created_at DESC, id DESC LIMIT 15;
```

### 5.2 Composite Indexes

```sql
CREATE INDEX idx_invoices_list ON invoices (company_id, status, invoice_date DESC)
  INCLUDE (invoice_no, customer_name, total_amount, outstanding);

CREATE INDEX idx_receipts_allocatable ON invoices (company_id, customer_id, currency, status)
  WHERE status IN ('Open','Overdue','Partially Paid')
  INCLUDE (invoice_no, total_amount, outstanding, due_date, exchange_rate);
```

### 5.3 Materialized View for Dashboard

```sql
CREATE MATERIALIZED VIEW mv_dashboard_summary AS
SELECT company_id,
  COUNT(*) FILTER (WHERE status IN ('Open','Overdue','Partially Paid')) AS open_invoices,
  COALESCE(SUM(outstanding) FILTER (WHERE status = 'Overdue'), 0) AS total_overdue
FROM invoices GROUP BY company_id;

CREATE UNIQUE INDEX ON mv_dashboard_summary (company_id);
-- Refresh via pg_cron every 5 min or trigger-based
```

### 5.4 Frontend Optimizations

| Technique | Implementation |
|-----------|---------------|
| Virtual scrolling | `@tanstack/react-virtual` for lists > 100 rows |
| Code splitting | `dynamic()` import for Recharts (saves ~50KB) |
| Debounced search | 300ms debounce on customer/receipt search inputs |
| Prefetch on hover | `queryClient.prefetchQuery` on table row hover |

---

## 6. Phase P4 — Extensibility

### 6.1 Bad Debt / Write-Off Module

#### [NEW] `database/010_write_off_tables.sql`

```sql
CREATE TABLE write_off_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id),
  invoice_id          UUID NOT NULL REFERENCES invoices(id),
  customer_id         UUID NOT NULL REFERENCES customers(id),
  outstanding_snapshot NUMERIC(18,2) NOT NULL,  -- snapshot at request time
  write_off_amount    NUMERIC(18,2) NOT NULL,   -- supports partial write-off
  reason              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'Pending'
                      CHECK (status IN ('Pending','Approved','Rejected','Posted','Reversed')),
  requested_by        UUID, requested_at TIMESTAMPTZ DEFAULT NOW(),
  approved_by         UUID, approved_at TIMESTAMPTZ,
  rejection_reason    TEXT,
  provision_je_id     UUID REFERENCES journal_entries(id),
  write_off_je_id     UUID REFERENCES journal_entries(id),
  reversal_je_id      UUID REFERENCES journal_entries(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_wo_amount CHECK (write_off_amount > 0 AND write_off_amount <= outstanding_snapshot)
);
```

### 6.2 Multi-Currency Enhancement

Extend the **existing** `exchange_rates` table (line 248 of `001_create_tables.sql`):

```sql
ALTER TABLE exchange_rates ADD COLUMN rate_type TEXT DEFAULT 'spot'
  CHECK (rate_type IN ('spot','closing','budget'));
ALTER TABLE exchange_rates ADD COLUMN source TEXT DEFAULT 'manual';
ALTER TABLE exchange_rates ADD COLUMN updated_by UUID;
```

### 6.3 e-Invoice (LHDN MyInvois)

| Phase | Scope |
|-------|-------|
| A | Add `e_invoice_uuid`, `e_invoice_status` to `invoices` |
| B | New Edge Function `e-invoice-submit/` for UBL 2.1 XML |
| C | Triggered by `INVOICE_POSTED` outbox event |
| D | Frontend status badge + resubmit button |

---

## 7. Phase P5 — GenAI Integration (Advisory Only)

> [!WARNING]
> **All GenAI features are strictly advisory.** AI cannot directly execute mutations. Users must review and confirm all AI suggestions through normal UI flows.

### 7.1 Smart Allocation Suggestions (Highest ROI)

| Aspect | Design |
|--------|--------|
| Trigger | "AI Suggest" button in allocation wizard |
| Input | Receipt + outstanding invoices + payment history |
| Output | Ranked allocation proposals with confidence + reasoning |
| Constraint | Suggestions displayed as pre-filled form — user confirms via existing `allocate_receipt()` RPC |

### 7.2 Natural Language AR Query (Constrained Semantic Layer)

> **No LLM-generated SQL execution.** Instead, use predefined query intents mapped to parameterized RPCs.

```typescript
// Intent classification → parameterized RPC
const QUERY_INTENTS = {
  'overdue_by_customer': { rpc: 'report_aging_by_customer', params: ['company_id','min_days'] },
  'outstanding_total':   { rpc: 'report_outstanding_summary', params: ['company_id','customer_id'] },
  'unpaid_invoices':     { rpc: 'report_invoice_list', params: ['company_id','status','date_from'] },
};
// LLM classifies user intent → maps to safe RPC → returns formatted results
```

### 7.3 Credit Risk & Cash Flow (Future)

Both use read-only data feeds → GPT analysis → advisory output only.

---

## 8. Priority Matrix & Timeline

| Phase | Items | Priority | Effort | Risk Mitigated |
|-------|-------|----------|--------|----------------|
| **P0** | RLS policies + pgTAP tests | 🔴 Critical | 3 days | Data breach, cross-tenant access |
| **P1** | Financial RPCs (6 procedures) | 🔴 Critical | 4 days | Partial writes, race conditions |
| **P2** | Transactional Outbox | 🟠 High | 2 days | Extensibility foundation |
| **P3** | Perf indexes + keyset pagination | 🟠 High | 2 days | Scale degradation |
| **P4** | Bad Debt + Multi-currency + e-Invoice | 🟡 Medium | 5 days | Feature gaps |
| **P5** | GenAI (advisory) | 🟢 Normal | 3 days | User experience |

```
Week 1: P0 (RLS) + P1 (RPCs)           ← security & correctness
Week 2: P1 (cont.) + P2 (Outbox)       ← transactional integrity
Week 3: P3 (Performance) + P4 (Features)
Week 4: P4 (cont.) + P5 (GenAI)
```

---

## 9. File Change Map

### Database (`database/`)

| File | Action | Phase |
|------|--------|-------|
| `006_rls_policies.sql` | [NEW] RLS on all 25 tables | P0 |
| `006b_rls_tests.sql` | [NEW] pgTAP cross-tenant tests | P0 |
| `007_financial_rpcs.sql` | [NEW] 6 SECURITY DEFINER RPCs | P1 |
| `008_financial_constraints.sql` | [NEW] Unique JE index + idempotency | P1 |
| `009_domain_events.sql` | [NEW] Outbox tables + triggers | P2 |
| `010_performance_indexes.sql` | [NEW] Composite indexes + MV | P3 |
| `011_write_off_tables.sql` | [NEW] Bad debt workflow | P4 |
| `001_create_tables.sql` | [MODIFY] Add e-invoice fields to invoices | P4 |

### Backend (`backend/supabase/functions/`)

| File | Action | Phase |
|------|--------|-------|
| `_shared/db.ts` | [MODIFY] Remove `withTransaction`, add `callRpc()` helper | P1 |
| `invoices/service.ts` | [MODIFY] Replace multi-step logic with `rpc('post_invoice')` | P1 |
| `allocations/service.ts` | [MODIFY] Replace with `rpc('allocate_receipt')` | P1 |
| `receipts/service.ts` | [MODIFY] Replace with `rpc('post_receipt')` | P1 |
| `journal-entries/service.ts` | [MODIFY] Replace with `rpc('reverse_journal_entry')` | P1 |
| `ai-allocation/index.ts` | [NEW] Advisory allocation suggestions | P5 |
| `ai-query/index.ts` | [NEW] Intent classifier → parameterized RPC | P5 |

### Frontend (`frontend/src/`)

| File | Action | Phase |
|------|--------|-------|
| `hooks/use-ai.ts` | [NEW] AI suggestion hooks | P5 |
| `components/features/allocations/ai-suggest-button.tsx` | [NEW] AI button | P5 |
| `components/ui/nl-query-bar.tsx` | [NEW] NL search bar | P5 |

---

> **Handoff to Codex CLI**: Start with `006_rls_policies.sql` (P0), then immediately proceed to `007_financial_rpcs.sql` (P1). These two migrations form the non-negotiable security and correctness foundation.
