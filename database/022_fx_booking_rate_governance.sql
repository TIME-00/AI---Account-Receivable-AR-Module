-- ============================================================================
-- Batch 9D-C: Booking Rate Provenance and Override Governance
-- Migration 022: Governance schema, transaction linkage, RLS, and truthful
-- historical bootstrap backfill.
--
-- Scope:
--   - Add normalized booking-rate decision and append-only event tables.
--   - Add lightweight current-decision pointers to invoices/receipts.
--   - Backfill every in-scope historical invoice/receipt with exactly one
--     bootstrap decision row and LegacyBackfilled event.
--   - Preserve numeric booked snapshots exactly.
--   - Do not mutate exchange_rates, fx_reference_rates, journals, allocations,
--     scheduler configuration, Vault, or production state.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Governance decision table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fx_booking_rate_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,

  invoice_id UUID NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  receipt_id UUID NULL REFERENCES public.receipts(id) ON DELETE RESTRICT,

  root_decision_id UUID NULL,
  decision_version INTEGER NOT NULL DEFAULT 1,
  supersedes_decision_id UUID NULL,

  source_category TEXT NOT NULL,
  exchange_rate_id UUID NULL REFERENCES public.exchange_rates(id) ON DELETE RESTRICT,
  fx_reference_rate_id UUID NULL REFERENCES public.fx_reference_rates(id) ON DELETE RESTRICT,

  baseline_kind TEXT NOT NULL DEFAULT 'NONE',
  baseline_rate NUMERIC(18,8) NULL,
  baseline_exchange_rate_id UUID NULL REFERENCES public.exchange_rates(id) ON DELETE RESTRICT,
  baseline_fx_reference_rate_id UUID NULL REFERENCES public.fx_reference_rates(id) ON DELETE RESTRICT,

  from_currency CHAR(3) NOT NULL,
  to_currency CHAR(3) NOT NULL,
  transaction_date DATE NOT NULL,
  booked_rate NUMERIC(18,8) NOT NULL,
  suggested_rate NUMERIC(18,8) NULL,
  deviation_pct NUMERIC(18,8) NULL,
  stale_reference BOOLEAN NOT NULL DEFAULT false,

  provider TEXT NULL,
  provider_effective_date DATE NULL,
  reference_fetched_at TIMESTAMPTZ NULL,

  approval_status TEXT NOT NULL DEFAULT 'NotRequired',
  lifecycle_status TEXT NOT NULL DEFAULT 'Draft',
  maker_user_id UUID NULL,
  checker_user_id UUID NULL,
  selected_by UUID NULL,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  override_reason TEXT NULL,
  approved_by UUID NULL,
  approved_at TIMESTAMPTZ NULL,
  rejected_by UUID NULL,
  rejected_at TIMESTAMPTZ NULL,
  rejection_reason TEXT NULL,
  posted BOOLEAN NOT NULL DEFAULT false,
  posted_at TIMESTAMPTZ NULL,

  anomaly_marker TEXT NULL,
  import_origin JSONB NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_fx_brd_one_transaction CHECK (
    (invoice_id IS NOT NULL AND receipt_id IS NULL)
    OR (invoice_id IS NULL AND receipt_id IS NOT NULL)
  ),
  CONSTRAINT chk_fx_brd_decision_version_positive CHECK (decision_version > 0),
  CONSTRAINT chk_fx_brd_rate_positive CHECK (booked_rate > 0),
  CONSTRAINT chk_fx_brd_source_category CHECK (
    source_category IN (
      'BASE_PARITY',
      'CATALOG',
      'REFERENCE_SELECTED',
      'MANUAL_OVERRIDE',
      'LEGACY_UNVERIFIED'
    )
  ),
  CONSTRAINT chk_fx_brd_source_fk_shape CHECK (
    (
      source_category = 'CATALOG'
      AND exchange_rate_id IS NOT NULL
      AND fx_reference_rate_id IS NULL
    )
    OR (
      source_category = 'REFERENCE_SELECTED'
      AND exchange_rate_id IS NULL
      AND fx_reference_rate_id IS NOT NULL
    )
    OR (
      source_category IN ('BASE_PARITY', 'MANUAL_OVERRIDE', 'LEGACY_UNVERIFIED')
      AND exchange_rate_id IS NULL
      AND fx_reference_rate_id IS NULL
    )
  ),
  CONSTRAINT chk_fx_brd_baseline_kind CHECK (
    baseline_kind IN ('BASE_PARITY', 'CATALOG', 'REFERENCE', 'NONE', 'MISSING')
  ),
  CONSTRAINT chk_fx_brd_baseline_fk_shape CHECK (
    (
      baseline_kind = 'BASE_PARITY'
      AND baseline_rate = 1.00000000
      AND baseline_exchange_rate_id IS NULL
      AND baseline_fx_reference_rate_id IS NULL
    )
    OR (
      baseline_kind = 'CATALOG'
      AND baseline_rate IS NOT NULL
      AND baseline_exchange_rate_id IS NOT NULL
      AND baseline_fx_reference_rate_id IS NULL
    )
    OR (
      baseline_kind = 'REFERENCE'
      AND baseline_rate IS NOT NULL
      AND baseline_exchange_rate_id IS NULL
      AND baseline_fx_reference_rate_id IS NOT NULL
    )
    OR (
      baseline_kind IN ('NONE', 'MISSING')
      AND baseline_exchange_rate_id IS NULL
      AND baseline_fx_reference_rate_id IS NULL
    )
  ),
  CONSTRAINT chk_fx_brd_approval_status CHECK (
    approval_status IN ('NotRequired', 'Pending', 'Approved', 'Rejected')
  ),
  CONSTRAINT chk_fx_brd_lifecycle_status CHECK (
    lifecycle_status IN ('Draft', 'Pending', 'Approved', 'Rejected', 'Superseded', 'Posted')
  ),
  CONSTRAINT chk_fx_brd_root_shape CHECK (
    (decision_version = 1 AND supersedes_decision_id IS NULL)
    OR (decision_version > 1 AND supersedes_decision_id IS NOT NULL)
  ),
  CONSTRAINT chk_fx_brd_anomaly_marker CHECK (
    anomaly_marker IS NULL
    OR anomaly_marker IN ('BASE_CURRENCY_NON_PARITY_RATE')
  )
);

ALTER TABLE public.fx_booking_rate_decisions
  ADD CONSTRAINT fk_fx_brd_root_decision
  FOREIGN KEY (root_decision_id)
  REFERENCES public.fx_booking_rate_decisions(id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.fx_booking_rate_decisions
  ADD CONSTRAINT fk_fx_brd_supersedes_decision
  FOREIGN KEY (supersedes_decision_id)
  REFERENCES public.fx_booking_rate_decisions(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fx_brd_root_version
  ON public.fx_booking_rate_decisions(root_decision_id, decision_version);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fx_brd_supersedes_once
  ON public.fx_booking_rate_decisions(supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fx_brd_invoice_current
  ON public.fx_booking_rate_decisions(invoice_id)
  WHERE invoice_id IS NOT NULL AND lifecycle_status <> 'Superseded';

CREATE UNIQUE INDEX IF NOT EXISTS uq_fx_brd_receipt_current
  ON public.fx_booking_rate_decisions(receipt_id)
  WHERE receipt_id IS NOT NULL AND lifecycle_status <> 'Superseded';

CREATE INDEX IF NOT EXISTS idx_fx_brd_company ON public.fx_booking_rate_decisions(company_id);
CREATE INDEX IF NOT EXISTS idx_fx_brd_invoice ON public.fx_booking_rate_decisions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_fx_brd_receipt ON public.fx_booking_rate_decisions(receipt_id);
CREATE INDEX IF NOT EXISTS idx_fx_brd_source ON public.fx_booking_rate_decisions(company_id, source_category);

COMMENT ON TABLE public.fx_booking_rate_decisions IS
  'Batch 9D-C normalized booking-rate provenance, override, approval, and version lineage table. Does not mutate booking snapshots by itself.';

-- ---------------------------------------------------------------------------
-- 2. Append-only event table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fx_booking_rate_decision_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  invoice_id UUID NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  receipt_id UUID NULL REFERENCES public.receipts(id) ON DELETE RESTRICT,
  decision_id UUID NOT NULL REFERENCES public.fx_booking_rate_decisions(id) ON DELETE RESTRICT,
  decision_version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID NULL,
  actor_role TEXT NULL,
  prior_approval_status TEXT NULL,
  new_approval_status TEXT NULL,
  reason TEXT NULL,
  maker_user_id UUID NULL,
  checker_user_id UUID NULL,
  source_category TEXT NULL,
  exchange_rate_id UUID NULL,
  fx_reference_rate_id UUID NULL,
  baseline_kind TEXT NULL,
  baseline_exchange_rate_id UUID NULL,
  baseline_fx_reference_rate_id UUID NULL,
  selected_rate NUMERIC(18,8) NULL,
  final_rate NUMERIC(18,8) NULL,
  anomaly_marker TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT chk_fx_brde_one_transaction CHECK (
    (invoice_id IS NOT NULL AND receipt_id IS NULL)
    OR (invoice_id IS NULL AND receipt_id IS NOT NULL)
  ),
  CONSTRAINT chk_fx_brde_event_type CHECK (
    event_type IN (
      'LegacyBackfilled',
      'DecisionCreated',
      'BaselineResolved',
      'ReferenceSuggested',
      'CatalogSelected',
      'ReferenceSelected',
      'OverrideSubmitted',
      'ApprovalRequired',
      'Approved',
      'Rejected',
      'ApprovalInvalidated',
      'DecisionSuperseded',
      'Posted'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_fx_brde_company ON public.fx_booking_rate_decision_events(company_id);
CREATE INDEX IF NOT EXISTS idx_fx_brde_decision ON public.fx_booking_rate_decision_events(decision_id, event_at);
CREATE INDEX IF NOT EXISTS idx_fx_brde_invoice ON public.fx_booking_rate_decision_events(invoice_id);
CREATE INDEX IF NOT EXISTS idx_fx_brde_receipt ON public.fx_booking_rate_decision_events(receipt_id);

COMMENT ON TABLE public.fx_booking_rate_decision_events IS
  'Batch 9D-C append-only booking-rate governance event log. Mutation prevention is installed in migration 023.';

-- ---------------------------------------------------------------------------
-- 3. Lightweight transaction pointers
-- ---------------------------------------------------------------------------

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS fx_source_category TEXT NULL,
  ADD COLUMN IF NOT EXISTS fx_decision_id UUID NULL;

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS fx_source_category TEXT NULL,
  ADD COLUMN IF NOT EXISTS fx_decision_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_invoices_fx_source_category'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT chk_invoices_fx_source_category
      CHECK (
        fx_source_category IS NULL
        OR fx_source_category IN (
          'BASE_PARITY',
          'CATALOG',
          'REFERENCE_SELECTED',
          'MANUAL_OVERRIDE',
          'LEGACY_UNVERIFIED'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_receipts_fx_source_category'
      AND conrelid = 'public.receipts'::regclass
  ) THEN
    ALTER TABLE public.receipts
      ADD CONSTRAINT chk_receipts_fx_source_category
      CHECK (
        fx_source_category IS NULL
        OR fx_source_category IN (
          'BASE_PARITY',
          'CATALOG',
          'REFERENCE_SELECTED',
          'MANUAL_OVERRIDE',
          'LEGACY_UNVERIFIED'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_fx_decision ON public.invoices(fx_decision_id);
CREATE INDEX IF NOT EXISTS idx_receipts_fx_decision ON public.receipts(fx_decision_id);
CREATE INDEX IF NOT EXISTS idx_invoices_fx_source ON public.invoices(company_id, fx_source_category);
CREATE INDEX IF NOT EXISTS idx_receipts_fx_source ON public.receipts(company_id, fx_source_category);

-- ---------------------------------------------------------------------------
-- 4. Transaction pointer foreign keys
-- ---------------------------------------------------------------------------
-- These FKs must be installed before historical backfill DML. PostgreSQL keeps
-- deferred trigger events pending after backfill inserts/updates; adding FKs
-- that reference fx_booking_rate_decisions after those writes can fail with
-- SQLSTATE 55006 ("cannot ALTER TABLE ... because it has pending trigger
-- events").

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_invoices_fx_decision'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT fk_invoices_fx_decision
      FOREIGN KEY (fx_decision_id)
      REFERENCES public.fx_booking_rate_decisions(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_receipts_fx_decision'
      AND conrelid = 'public.receipts'::regclass
  ) THEN
    ALTER TABLE public.receipts
      ADD CONSTRAINT fk_receipts_fx_decision
      FOREIGN KEY (fx_decision_id)
      REFERENCES public.fx_booking_rate_decisions(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Integrity trigger for decision rows
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fx_validate_booking_rate_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_base CHAR(3);
  v_invoice RECORD;
  v_receipt RECORD;
  v_exchange RECORD;
  v_ref RECORD;
  v_base_exchange RECORD;
  v_base_ref RECORD;
  v_prior RECORD;
BEGIN
  SELECT base_currency::CHAR(3)
    INTO v_company_base
  FROM public.companies
  WHERE id = NEW.company_id;

  IF v_company_base IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: company % not found for booking-rate decision', NEW.company_id;
  END IF;

  IF NEW.to_currency <> v_company_base THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: to_currency must equal company base currency';
  END IF;

  IF NEW.invoice_id IS NOT NULL THEN
    SELECT *
      INTO v_invoice
    FROM public.invoices
    WHERE id = NEW.invoice_id;

    IF v_invoice.id IS NULL OR v_invoice.company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invoice decision company mismatch';
    END IF;
    IF v_invoice.currency <> NEW.from_currency OR v_invoice.base_currency <> NEW.to_currency THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invoice decision currency mismatch';
    END IF;
  END IF;

  IF NEW.receipt_id IS NOT NULL THEN
    SELECT *
      INTO v_receipt
    FROM public.receipts
    WHERE id = NEW.receipt_id;

    IF v_receipt.id IS NULL OR v_receipt.company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: receipt decision company mismatch';
    END IF;
    IF v_receipt.currency <> NEW.from_currency OR v_receipt.base_currency <> NEW.to_currency THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: receipt decision currency mismatch';
    END IF;
  END IF;

  IF NEW.decision_version = 1 THEN
    IF NEW.root_decision_id <> NEW.id THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: root decision must self-reference root_decision_id';
    END IF;
    IF NEW.supersedes_decision_id IS NOT NULL THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: root decision must not supersede another row';
    END IF;
  ELSE
    SELECT *
      INTO v_prior
    FROM public.fx_booking_rate_decisions
    WHERE id = NEW.supersedes_decision_id;

    IF v_prior.id IS NULL THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: superseded decision not found';
    END IF;
    IF v_prior.root_decision_id <> NEW.root_decision_id
      OR v_prior.company_id <> NEW.company_id
      OR COALESCE(v_prior.invoice_id, '00000000-0000-0000-0000-000000000000'::uuid)
         <> COALESCE(NEW.invoice_id, '00000000-0000-0000-0000-000000000000'::uuid)
      OR COALESCE(v_prior.receipt_id, '00000000-0000-0000-0000-000000000000'::uuid)
         <> COALESCE(NEW.receipt_id, '00000000-0000-0000-0000-000000000000'::uuid)
      OR v_prior.decision_version <> NEW.decision_version - 1 THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invalid supersession lineage';
    END IF;
  END IF;

  IF NEW.source_category = 'CATALOG' THEN
    SELECT *
      INTO v_exchange
    FROM public.exchange_rates
    WHERE id = NEW.exchange_rate_id;

    IF v_exchange.id IS NULL
      OR v_exchange.company_id <> NEW.company_id
      OR v_exchange.from_currency <> NEW.from_currency
      OR v_exchange.to_currency <> NEW.to_currency
      OR v_exchange.effective_date > NEW.transaction_date THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invalid catalog source';
    END IF;
  ELSIF NEW.source_category = 'REFERENCE_SELECTED' THEN
    SELECT *
      INTO v_ref
    FROM public.fx_reference_rates
    WHERE id = NEW.fx_reference_rate_id;

    IF v_ref.id IS NULL
      OR v_ref.company_id <> NEW.company_id
      OR v_ref.from_currency <> NEW.from_currency
      OR v_ref.to_currency <> NEW.to_currency
      OR v_ref.effective_date > NEW.transaction_date
      OR v_ref.status <> 'Active' THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invalid reference source';
    END IF;
  END IF;

  IF NEW.baseline_kind = 'CATALOG' THEN
    SELECT *
      INTO v_base_exchange
    FROM public.exchange_rates
    WHERE id = NEW.baseline_exchange_rate_id;

    IF v_base_exchange.id IS NULL
      OR v_base_exchange.company_id <> NEW.company_id
      OR v_base_exchange.from_currency <> NEW.from_currency
      OR v_base_exchange.to_currency <> NEW.to_currency
      OR v_base_exchange.effective_date > NEW.transaction_date
      OR ROUND(v_base_exchange.rate::numeric, 8) <> ROUND(NEW.baseline_rate, 8) THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invalid catalog baseline';
    END IF;
  ELSIF NEW.baseline_kind = 'REFERENCE' THEN
    SELECT *
      INTO v_base_ref
    FROM public.fx_reference_rates
    WHERE id = NEW.baseline_fx_reference_rate_id;

    IF v_base_ref.id IS NULL
      OR v_base_ref.company_id <> NEW.company_id
      OR v_base_ref.from_currency <> NEW.from_currency
      OR v_base_ref.to_currency <> NEW.to_currency
      OR v_base_ref.effective_date > NEW.transaction_date
      OR v_base_ref.status <> 'Active'
      OR ROUND(v_base_ref.rate::numeric, 8) <> ROUND(NEW.baseline_rate, 8) THEN
      RAISE EXCEPTION 'BR-FX-GOVERNANCE: invalid reference baseline';
    END IF;
  END IF;

  IF NEW.source_category = 'BASE_PARITY' AND ROUND(NEW.booked_rate, 8) <> 1.00000000 THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: BASE_PARITY requires booked_rate = 1.0';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fx_validate_booking_rate_decision
  ON public.fx_booking_rate_decisions;
CREATE TRIGGER trg_fx_validate_booking_rate_decision
BEFORE INSERT OR UPDATE ON public.fx_booking_rate_decisions
FOR EACH ROW
EXECUTE FUNCTION public.fx_validate_booking_rate_decision();

-- ---------------------------------------------------------------------------
-- 6. RLS and privileges
-- ---------------------------------------------------------------------------
-- Enable RLS and define privileges before backfill writes so no later ALTER
-- TABLE operation touches the DML-affected governance tables while deferred
-- trigger events are pending.

ALTER TABLE public.fx_booking_rate_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_booking_rate_decision_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_brd_select ON public.fx_booking_rate_decisions;
CREATE POLICY fx_brd_select ON public.fx_booking_rate_decisions
FOR SELECT
USING (public.rls_has_company_access(company_id));

DROP POLICY IF EXISTS fx_brde_select ON public.fx_booking_rate_decision_events;
CREATE POLICY fx_brde_select ON public.fx_booking_rate_decision_events
FOR SELECT
USING (public.rls_has_company_access(company_id));

REVOKE ALL ON public.fx_booking_rate_decisions FROM PUBLIC;
REVOKE ALL ON public.fx_booking_rate_decision_events FROM PUBLIC;
REVOKE ALL ON public.fx_booking_rate_decisions FROM anon;
REVOKE ALL ON public.fx_booking_rate_decision_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.fx_booking_rate_decisions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fx_booking_rate_decision_events FROM authenticated;
GRANT SELECT ON public.fx_booking_rate_decisions TO authenticated;
GRANT SELECT ON public.fx_booking_rate_decision_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.fx_booking_rate_decisions TO service_role;
GRANT SELECT, INSERT ON public.fx_booking_rate_decision_events TO service_role;

-- Trigger function is internal.
REVOKE ALL ON FUNCTION public.fx_validate_booking_rate_decision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_validate_booking_rate_decision() FROM anon;
REVOKE ALL ON FUNCTION public.fx_validate_booking_rate_decision() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fx_validate_booking_rate_decision() TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Historical bootstrap backfill
-- ---------------------------------------------------------------------------

WITH invoice_bootstrap AS (
  SELECT
    gen_random_uuid() AS decision_id,
    i.id AS invoice_id,
    i.company_id,
    i.currency::CHAR(3) AS from_currency,
    i.base_currency::CHAR(3) AS to_currency,
    i.invoice_date AS transaction_date,
    i.exchange_rate::numeric(18,8) AS booked_rate,
    CASE
      WHEN i.currency = i.base_currency AND ROUND(i.exchange_rate::numeric, 8) = 1.00000000
        THEN 'BASE_PARITY'
      ELSE 'LEGACY_UNVERIFIED'
    END AS source_category,
    CASE
      WHEN i.currency = i.base_currency AND ROUND(i.exchange_rate::numeric, 8) <> 1.00000000
        THEN 'BASE_CURRENCY_NON_PARITY_RATE'
      ELSE NULL
    END AS anomaly_marker,
    CASE WHEN i.status = 'Draft' THEN 'Draft' ELSE 'Posted' END AS lifecycle_status
  FROM public.invoices i
  WHERE i.fx_decision_id IS NULL
),
insert_invoice_decisions AS (
  INSERT INTO public.fx_booking_rate_decisions (
    id,
    company_id,
    invoice_id,
    root_decision_id,
    decision_version,
    supersedes_decision_id,
    source_category,
    baseline_kind,
    baseline_rate,
    from_currency,
    to_currency,
    transaction_date,
    booked_rate,
    approval_status,
    lifecycle_status,
    posted,
    posted_at,
    anomaly_marker,
    metadata
  )
  SELECT
    decision_id,
    company_id,
    invoice_id,
    decision_id,
    1,
    NULL,
    source_category,
    CASE WHEN source_category = 'BASE_PARITY' THEN 'BASE_PARITY' ELSE 'NONE' END,
    CASE WHEN source_category = 'BASE_PARITY' THEN 1.00000000 ELSE NULL END,
    from_currency,
    to_currency,
    transaction_date,
    booked_rate,
    'NotRequired',
    lifecycle_status,
    lifecycle_status = 'Posted',
    CASE WHEN lifecycle_status = 'Posted' THEN now() ELSE NULL END,
    anomaly_marker,
    jsonb_build_object('bootstrap', true, 'transaction_type', 'invoice')
  FROM invoice_bootstrap
  RETURNING id, company_id, invoice_id, source_category, decision_version, booked_rate, anomaly_marker
),
update_invoices AS (
  UPDATE public.invoices i
  SET
    fx_decision_id = d.id,
    fx_source_category = d.source_category
  FROM insert_invoice_decisions d
  WHERE i.id = d.invoice_id
  RETURNING d.*
)
INSERT INTO public.fx_booking_rate_decision_events (
  company_id,
  invoice_id,
  decision_id,
  decision_version,
  event_type,
  source_category,
  selected_rate,
  final_rate,
  anomaly_marker,
  metadata
)
SELECT
  company_id,
  invoice_id,
  id,
  decision_version,
  'LegacyBackfilled',
  source_category,
  booked_rate,
  booked_rate,
  anomaly_marker,
  jsonb_build_object('bootstrap', true, 'transaction_type', 'invoice')
FROM update_invoices;

WITH receipt_bootstrap AS (
  SELECT
    gen_random_uuid() AS decision_id,
    r.id AS receipt_id,
    r.company_id,
    r.currency::CHAR(3) AS from_currency,
    r.base_currency::CHAR(3) AS to_currency,
    r.receipt_date AS transaction_date,
    r.exchange_rate::numeric(18,8) AS booked_rate,
    CASE
      WHEN r.currency = r.base_currency AND ROUND(r.exchange_rate::numeric, 8) = 1.00000000
        THEN 'BASE_PARITY'
      ELSE 'LEGACY_UNVERIFIED'
    END AS source_category,
    CASE
      WHEN r.currency = r.base_currency AND ROUND(r.exchange_rate::numeric, 8) <> 1.00000000
        THEN 'BASE_CURRENCY_NON_PARITY_RATE'
      ELSE NULL
    END AS anomaly_marker,
    CASE WHEN r.status = 'Draft' THEN 'Draft' ELSE 'Posted' END AS lifecycle_status
  FROM public.receipts r
  WHERE r.fx_decision_id IS NULL
),
insert_receipt_decisions AS (
  INSERT INTO public.fx_booking_rate_decisions (
    id,
    company_id,
    receipt_id,
    root_decision_id,
    decision_version,
    supersedes_decision_id,
    source_category,
    baseline_kind,
    baseline_rate,
    from_currency,
    to_currency,
    transaction_date,
    booked_rate,
    approval_status,
    lifecycle_status,
    posted,
    posted_at,
    anomaly_marker,
    metadata
  )
  SELECT
    decision_id,
    company_id,
    receipt_id,
    decision_id,
    1,
    NULL,
    source_category,
    CASE WHEN source_category = 'BASE_PARITY' THEN 'BASE_PARITY' ELSE 'NONE' END,
    CASE WHEN source_category = 'BASE_PARITY' THEN 1.00000000 ELSE NULL END,
    from_currency,
    to_currency,
    transaction_date,
    booked_rate,
    'NotRequired',
    lifecycle_status,
    lifecycle_status = 'Posted',
    CASE WHEN lifecycle_status = 'Posted' THEN now() ELSE NULL END,
    anomaly_marker,
    jsonb_build_object('bootstrap', true, 'transaction_type', 'receipt')
  FROM receipt_bootstrap
  RETURNING id, company_id, receipt_id, source_category, decision_version, booked_rate, anomaly_marker
),
update_receipts AS (
  UPDATE public.receipts r
  SET
    fx_decision_id = d.id,
    fx_source_category = d.source_category
  FROM insert_receipt_decisions d
  WHERE r.id = d.receipt_id
  RETURNING d.*
)
INSERT INTO public.fx_booking_rate_decision_events (
  company_id,
  receipt_id,
  decision_id,
  decision_version,
  event_type,
  source_category,
  selected_rate,
  final_rate,
  anomaly_marker,
  metadata
)
SELECT
  company_id,
  receipt_id,
  id,
  decision_version,
  'LegacyBackfilled',
  source_category,
  booked_rate,
  booked_rate,
  anomaly_marker,
  jsonb_build_object('bootstrap', true, 'transaction_type', 'receipt')
FROM update_receipts;

-- Backfill invariants.
DO $$
DECLARE
  v_invoice_gap INTEGER;
  v_receipt_gap INTEGER;
  v_invoice_mismatch INTEGER;
  v_receipt_mismatch INTEGER;
BEGIN
  SELECT count(*) INTO v_invoice_gap
  FROM public.invoices
  WHERE fx_decision_id IS NULL OR fx_source_category IS NULL;

  SELECT count(*) INTO v_receipt_gap
  FROM public.receipts
  WHERE fx_decision_id IS NULL OR fx_source_category IS NULL;

  SELECT count(*) INTO v_invoice_mismatch
  FROM public.invoices i
  JOIN public.fx_booking_rate_decisions d ON d.id = i.fx_decision_id
  WHERE d.invoice_id <> i.id
     OR d.receipt_id IS NOT NULL
     OR d.source_category <> i.fx_source_category
     OR d.company_id <> i.company_id;

  SELECT count(*) INTO v_receipt_mismatch
  FROM public.receipts r
  JOIN public.fx_booking_rate_decisions d ON d.id = r.fx_decision_id
  WHERE d.receipt_id <> r.id
     OR d.invoice_id IS NOT NULL
     OR d.source_category <> r.fx_source_category
     OR d.company_id <> r.company_id;

  IF v_invoice_gap <> 0 OR v_receipt_gap <> 0
    OR v_invoice_mismatch <> 0 OR v_receipt_mismatch <> 0 THEN
    RAISE EXCEPTION 'BR-FX-GOVERNANCE: historical bootstrap linkage invariant failed (invoice_gap %, receipt_gap %, invoice_mismatch %, receipt_mismatch %)',
      v_invoice_gap, v_receipt_gap, v_invoice_mismatch, v_receipt_mismatch;
  END IF;
END $$;

COMMIT;
