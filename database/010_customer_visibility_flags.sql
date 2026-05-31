-- ============================================================================
-- Client demo data visibility flags
-- ============================================================================
-- Audit-preserving soft-hide metadata for historical test and smoke-test data.
-- This migration does not hide any customer automatically and does not modify
-- invoices, receipts, allocations, journal entries, or audit logs.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hidden_reason TEXT,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_customers_visible
  ON public.customers(company_id, customer_id)
  WHERE is_deleted = FALSE AND is_hidden = FALSE;

COMMENT ON COLUMN public.customers.is_hidden IS
  'Client prototype visibility flag. Hidden customers and their financial records remain stored for audit evidence.';

COMMENT ON COLUMN public.customers.hidden_reason IS
  'Reason the customer is hidden from client-facing prototype views.';

COMMENT ON COLUMN public.customers.hidden_at IS
  'Timestamp when the customer was hidden from client-facing prototype views.';

CREATE OR REPLACE FUNCTION public.fn_protect_customer_visibility_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    OLD.is_hidden IS DISTINCT FROM NEW.is_hidden
    OR OLD.hidden_reason IS DISTINCT FROM NEW.hidden_reason
    OR OLD.hidden_at IS DISTINCT FROM NEW.hidden_at
  ) AND CURRENT_USER IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Customer visibility flags can only be changed by an authorized database operator.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_customer_visibility_flags ON public.customers;

CREATE TRIGGER trg_protect_customer_visibility_flags
  BEFORE UPDATE OF is_hidden, hidden_reason, hidden_at ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_customer_visibility_flags();
