-- ============================================================================
-- 011a_customer_normalized_name_preflight.sql
-- Read-only preflight for customer normalized-name uniqueness.
--
-- Run this before 011_customer_normalized_name.sql. Resolve any returned rows
-- deliberately before applying the unique visible-customer index.
-- ============================================================================

WITH visible_customer_names AS (
  SELECT
    company_id,
    lower(regexp_replace(btrim(customer_name), E'\\s+', ' ', 'g')) AS normalized_customer_name,
    id,
    customer_id,
    customer_name
  FROM public.customers
  WHERE is_deleted = FALSE
    AND is_hidden = FALSE
)
SELECT
  company_id,
  normalized_customer_name,
  COUNT(*) AS visible_customer_count,
  jsonb_agg(
    jsonb_build_object(
      'id', id,
      'customer_id', customer_id,
      'customer_name', customer_name
    )
    ORDER BY customer_id
  ) AS matching_customers
FROM visible_customer_names
GROUP BY company_id, normalized_customer_name
HAVING COUNT(*) > 1
ORDER BY company_id, normalized_customer_name;
