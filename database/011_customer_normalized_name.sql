-- ============================================================================
-- 011_customer_normalized_name.sql
-- Customer normalized-name guard for inline customer creation.
--
-- Prerequisite:
--   Run database/011a_customer_normalized_name_preflight.sql first.
--
-- This migration does not delete or modify financial records. Hidden historical
-- customers remain preserved and intentionally do not block a new visible
-- customer with the same normalized name.
-- ============================================================================

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS normalized_customer_name TEXT
  GENERATED ALWAYS AS (
    lower(regexp_replace(btrim(customer_name), E'\\s+', ' ', 'g'))
  ) STORED;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.customers
    WHERE is_deleted = FALSE
      AND is_hidden = FALSE
    GROUP BY company_id, normalized_customer_name
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add visible-customer normalized-name uniqueness: duplicate visible customer names exist. Run database/011a_customer_normalized_name_preflight.sql.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_visible_normalized_name
  ON public.customers (company_id, normalized_customer_name)
  WHERE is_deleted = FALSE
    AND is_hidden = FALSE;

COMMENT ON COLUMN public.customers.normalized_customer_name IS
  'Lower-cased, trimmed and whitespace-collapsed customer name used to prevent duplicate visible customers within a company.';
