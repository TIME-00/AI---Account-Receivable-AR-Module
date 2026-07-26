-- Gate B rollback-only database smoke tests.
-- Run on a disposable local database after migrations through 032.

BEGIN;

CREATE FUNCTION pg_temp.gateb_assert(p_name TEXT, p_condition BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION 'FAIL: %', p_name;
  END IF;
  RAISE NOTICE 'PASS: %', p_name;
END;
$$;

INSERT INTO public.companies (
  id, company_code, company_name, base_currency, country
)
VALUES
  ('b0320000-0000-4000-8000-000000000001', 'GATEB32A', 'Gate B Company A', 'MYR', 'MY'),
  ('b0320000-0000-4000-8000-000000000002', 'GATEB32B', 'Gate B Company B', 'MYR', 'MY');

INSERT INTO public.user_roles (
  id, user_id, company_id, role, is_active
)
VALUES
  ('b0321000-0000-4000-8000-000000000001', 'b0322000-0000-4000-8000-000000000001',
   'b0320000-0000-4000-8000-000000000001', 'Finance Manager', true),
  ('b0321000-0000-4000-8000-000000000002', 'b0322000-0000-4000-8000-000000000002',
   'b0320000-0000-4000-8000-000000000001', 'AR Clerk', true),
  ('b0321000-0000-4000-8000-000000000003', 'b0322000-0000-4000-8000-000000000003',
   'b0320000-0000-4000-8000-000000000002', 'Finance Manager', true);

INSERT INTO public.customers (
  id, company_id, customer_id, customer_name, customer_type,
  bill_addr_line1, bill_city, bill_state, bill_postal, bill_country,
  contact_name, contact_phone, contact_email, credit_rating, is_hidden
)
VALUES
  ('b0323000-0000-4000-8000-000000000001', 'b0320000-0000-4000-8000-000000000001',
   'GB-A1', 'Gate B Alpha One', 'Corporate', '1 Test Road', 'KL', 'KL', '50000',
   'MY', 'Contact A1', '60000001', 'gateb-a1@example.test', 'A', false),
  ('b0323000-0000-4000-8000-000000000002', 'b0320000-0000-4000-8000-000000000001',
   'GB-A2', 'Gate B Alpha Two', 'Corporate', '2 Test Road', 'KL', 'KL', '50000',
   'MY', 'Contact A2', '60000002', 'gateb-a2@example.test', 'A', false),
  ('b0323000-0000-4000-8000-000000000003', 'b0320000-0000-4000-8000-000000000001',
   'GB-B1', 'Gate B Beta', 'Corporate', '3 Test Road', 'KL', 'KL', '50000',
   'MY', 'Contact B1', '60000003', 'gateb-b1@example.test', 'B', false),
  ('b0323000-0000-4000-8000-000000000004', 'b0320000-0000-4000-8000-000000000001',
   'GB-AH', 'Gate B Hidden Alpha', 'Corporate', '4 Test Road', 'KL', 'KL', '50000',
   'MY', 'Contact AH', '60000004', 'gateb-ah@example.test', 'A', true);

-- These rollback-only report fixtures model existing posted/open history. They
-- are not created through financial mutation routes, so bypass lifecycle
-- triggers only for this exact fixture insert and restore them immediately.
SET LOCAL session_replication_role = replica;

INSERT INTO public.invoices (
  id, company_id, invoice_no, doc_type, invoice_date, due_date,
  customer_id, customer_name, currency, exchange_rate, base_currency,
  subtotal, total_amount, base_total, outstanding, status
)
VALUES
  ('b0324000-0000-4000-8000-000000000001', 'b0320000-0000-4000-8000-000000000001',
   'GB-INV-A1', 'Invoice', '2026-01-10', '2026-01-20',
   'b0323000-0000-4000-8000-000000000001', 'Gate B Alpha One',
   'MYR', 1, 'MYR', 100, 100, 100, 100, 'Open'),
  ('b0324000-0000-4000-8000-000000000002', 'b0320000-0000-4000-8000-000000000001',
   'GB-DN-A2', 'Debit Note', '2026-01-11', '2026-01-15',
   'b0323000-0000-4000-8000-000000000002', 'Gate B Alpha Two',
   'SGD', 2, 'MYR', 50, 50, 100, 50, 'Overdue'),
  ('b0324000-0000-4000-8000-000000000003', 'b0320000-0000-4000-8000-000000000001',
   'GB-INV-B1', 'Invoice', '2026-01-12', '2026-01-20',
   'b0323000-0000-4000-8000-000000000003', 'Gate B Beta',
   'MYR', 1, 'MYR', 999, 999, 999, 999, 'Open'),
  ('b0324000-0000-4000-8000-000000000004', 'b0320000-0000-4000-8000-000000000001',
   'GB-INV-FUT', 'Invoice', '2026-02-01', '2026-02-10',
   'b0323000-0000-4000-8000-000000000001', 'Gate B Alpha One',
   'MYR', 1, 'MYR', 777, 777, 777, 777, 'Open'),
  ('b0324000-0000-4000-8000-000000000005', 'b0320000-0000-4000-8000-000000000001',
   'GB-INV-HID', 'Invoice', '2026-01-10', '2026-01-20',
   'b0323000-0000-4000-8000-000000000004', 'Gate B Hidden Alpha',
   'MYR', 1, 'MYR', 888, 888, 888, 888, 'Open');

SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  'b0322000-0000-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"b0322000-0000-4000-8000-000000000001"}',
  true
);

SELECT pg_temp.gateb_assert(
  'old six-argument aging caller remains callable',
  jsonb_typeof(public.ar_aging_by_customer(
    'b0320000-0000-4000-8000-000000000001',
    'b0322000-0000-4000-8000-000000000001',
    'company',
    '2026-01-31',
    1,
    20
  )) = 'object'
);

WITH result AS (
  SELECT public.ar_aging_by_customer(
    'b0320000-0000-4000-8000-000000000001',
    'b0322000-0000-4000-8000-000000000001',
    'company',
    '2026-01-31',
    1,
    20,
    'A'
  ) AS value
)
SELECT pg_temp.gateb_assert(
  'A-rating outstanding-only count and amount reconcile',
  (value->>'total')::INTEGER = 2
    AND (
      SELECT SUM((row->>'base_total')::NUMERIC)
      FROM jsonb_array_elements(value->'rows') row
    ) = 200
)
FROM result;

RESET ROLE;

INSERT INTO public.import_batches (
  id, company_id, batch_name, import_type, file_type, file_name,
  status, error_rows, unmatched_count, created_by, created_at, updated_at
)
VALUES (
  'b0325000-0000-4000-8000-000000000001',
  'b0320000-0000-4000-8000-000000000001',
  'Gate B Import 01', 'invoice', 'csv', 'gate-b-01.csv',
  'Completed', 2, 3,
  'b0322000-0000-4000-8000-000000000001',
  '2026-07-26 12:00:00+00', '2026-07-26 12:00:00+00'
);

INSERT INTO public.import_batches (
  id, company_id, batch_name, import_type, file_type, file_name,
  status, error_rows, unmatched_count, created_by, created_at, updated_at
)
SELECT
  md5('gate-b-alert-' || gs::TEXT)::UUID,
  'b0320000-0000-4000-8000-000000000001',
  'Gate B Import ' || (gs + 1)::TEXT,
  'invoice', 'csv', 'gate-b-' || (gs + 1)::TEXT || '.csv',
  'Completed', 1, 1,
  'b0322000-0000-4000-8000-000000000001',
  '2026-07-26 12:00:00+00', '2026-07-26 12:00:00+00'
FROM generate_series(1, 10) gs;

SET LOCAL ROLE service_role;

SELECT pg_temp.gateb_assert(
  '22 actionable conditions exist and unread count is page-independent',
  public.notification_unread_import_alert_count(
    'b0320000-0000-4000-8000-000000000001',
    'b0322000-0000-4000-8000-000000000001'
  ) = 22
);

WITH page AS (
  SELECT public.notification_list_import_alerts(
    'b0320000-0000-4000-8000-000000000001',
    'b0322000-0000-4000-8000-000000000001',
    20,
    NULL,
    NULL,
    'all',
    NULL
  ) AS value
)
SELECT pg_temp.gateb_assert(
  'first cursor page is bounded and reports another page',
  jsonb_array_length(value->'rows') = 20
    AND (value->>'has_more')::BOOLEAN
)
FROM page;

WITH first_page AS (
  SELECT public.notification_list_import_alerts(
    'b0320000-0000-4000-8000-000000000001',
    'b0322000-0000-4000-8000-000000000001',
    20,
    NULL,
    NULL,
    'all',
    NULL
  ) AS value
),
cursor_tuple AS (
  SELECT
    (value->'rows'->19->>'created_at')::TIMESTAMPTZ AS created_at,
    value->'rows'->19->>'notification_key' AS notification_key
  FROM first_page
),
second_page AS (
  SELECT public.notification_list_import_alerts(
    'b0320000-0000-4000-8000-000000000001',
    'b0322000-0000-4000-8000-000000000001',
    20,
    cursor_tuple.created_at,
    cursor_tuple.notification_key,
    'all',
    NULL
  ) AS value
  FROM cursor_tuple
),
combined AS (
  SELECT row->>'notification_key' AS notification_key
  FROM first_page, LATERAL jsonb_array_elements(first_page.value->'rows') row
  UNION ALL
  SELECT row->>'notification_key'
  FROM second_page, LATERAL jsonb_array_elements(second_page.value->'rows') row
)
SELECT pg_temp.gateb_assert(
  'equal-timestamp cursor pages contain all 22 keys without duplicates or skips',
  (SELECT jsonb_array_length(value->'rows') FROM second_page) = 2
    AND (SELECT COUNT(*) FROM combined) = 22
    AND (SELECT COUNT(DISTINCT notification_key) FROM combined) = 22
);

DO $cross_company$
BEGIN
  PERFORM public.notification_unread_import_alert_count(
    'b0320000-0000-4000-8000-000000000002',
    'b0322000-0000-4000-8000-000000000001'
  );
  RAISE EXCEPTION 'FAIL: cross-company notification request was accepted';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' OR SQLERRM NOT LIKE 'AUTH:%' THEN
      RAISE;
    END IF;
    RAISE NOTICE 'PASS: cross-company notification request fails closed';
END;
$cross_company$;

SELECT public.notification_mark_import_read(
  'b0320000-0000-4000-8000-000000000001',
  'b0322000-0000-4000-8000-000000000002',
  'import:b0325000-0000-4000-8000-000000000001:import_review',
  'b0325000-0000-4000-8000-000000000001',
  'import_review'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  'b0322000-0000-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"b0322000-0000-4000-8000-000000000001"}',
  true
);
SELECT pg_temp.gateb_assert(
  'acknowledgement RLS hides another user in the same company',
  NOT EXISTS (
    SELECT 1
    FROM public.notification_acknowledgements
    WHERE user_id = 'b0322000-0000-4000-8000-000000000002'
  )
);
RESET ROLE;
SET LOCAL ROLE service_role;

DO $inaccessible_source$
BEGIN
  PERFORM public.notification_mark_import_read(
    'b0320000-0000-4000-8000-000000000002',
    'b0322000-0000-4000-8000-000000000003',
    'import:b0325000-0000-4000-8000-000000000001:import_error',
    'b0325000-0000-4000-8000-000000000001',
    'import_error'
  );
  RAISE EXCEPTION 'FAIL: inaccessible notification source was acknowledged';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' OR SQLERRM NOT LIKE 'NOT_FOUND:%' THEN
      RAISE;
    END IF;
    RAISE NOTICE 'PASS: inaccessible notification source is not disclosed';
END;
$inaccessible_source$;

SELECT public.notification_mark_import_read(
  'b0320000-0000-4000-8000-000000000001',
  'b0322000-0000-4000-8000-000000000001',
  'import:b0325000-0000-4000-8000-000000000001:import_error',
  'b0325000-0000-4000-8000-000000000001',
  'import_error'
);
SELECT public.notification_mark_import_read(
  'b0320000-0000-4000-8000-000000000001',
  'b0322000-0000-4000-8000-000000000001',
  'import:b0325000-0000-4000-8000-000000000001:import_error',
  'b0325000-0000-4000-8000-000000000001',
  'import_error'
);

SELECT pg_temp.gateb_assert(
  'read-one is idempotent',
  (
    SELECT COUNT(*)
    FROM public.notification_acknowledgements
    WHERE notification_key =
      'import:b0325000-0000-4000-8000-000000000001:import_error'
  ) = 1
);

SELECT public.notification_mark_all_import_read(
  'b0320000-0000-4000-8000-000000000001',
  'b0322000-0000-4000-8000-000000000001',
  NULL
);
SELECT public.notification_mark_all_import_read(
  'b0320000-0000-4000-8000-000000000001',
  'b0322000-0000-4000-8000-000000000001',
  NULL
);

SELECT pg_temp.gateb_assert(
  'read-all is idempotent and unread becomes zero',
  public.notification_unread_import_alert_count(
    'b0320000-0000-4000-8000-000000000001',
    'b0322000-0000-4000-8000-000000000001'
  ) = 0
    AND (
      SELECT COUNT(*)
      FROM public.notification_acknowledgements
      WHERE company_id = 'b0320000-0000-4000-8000-000000000001'
        AND user_id = 'b0322000-0000-4000-8000-000000000001'
    ) = 22
);

RESET ROLE;

UPDATE public.import_batches
SET error_rows = 0, unmatched_count = 0,
    updated_at = '2026-07-27 12:00:00+00'
WHERE id = 'b0325000-0000-4000-8000-000000000001';

SET LOCAL ROLE service_role;
SELECT pg_temp.gateb_assert(
  'resolved conditions disappear immediately',
  NOT EXISTS (
    SELECT 1
    FROM public.notification_import_alerts(
      'b0320000-0000-4000-8000-000000000001'
    )
    WHERE import_batch_id = 'b0325000-0000-4000-8000-000000000001'
  )
);
RESET ROLE;

DELETE FROM public.import_batches
WHERE id = 'b0325000-0000-4000-8000-000000000001';
SELECT pg_temp.gateb_assert(
  'source deletion cascades exact acknowledgements',
  NOT EXISTS (
    SELECT 1
    FROM public.notification_acknowledgements
    WHERE import_batch_id = 'b0325000-0000-4000-8000-000000000001'
  )
);

INSERT INTO public.import_batches (
  id, company_id, batch_name, import_type, file_type, file_name,
  status, error_rows, unmatched_count, created_by, created_at, updated_at
)
SELECT
  md5('gate-b-prune-' || gs::TEXT)::UUID,
  'b0320000-0000-4000-8000-000000000001',
  'Resolved ' || gs::TEXT,
  'invoice', 'csv', 'resolved-' || gs::TEXT || '.csv',
  'Completed', 0, 0,
  'b0322000-0000-4000-8000-000000000001',
  clock_timestamp() - INTERVAL '100 days',
  clock_timestamp() - INTERVAL '100 days'
FROM generate_series(1, 501) gs;

INSERT INTO public.notification_acknowledgements (
  company_id, user_id, notification_key, source_type, source_entity_id,
  notification_type, import_batch_id, condition_type, read_at, created_at, updated_at
)
SELECT
  'b0320000-0000-4000-8000-000000000001',
  'b0322000-0000-4000-8000-000000000001',
  'import:' || ib.id::TEXT || ':import_error',
  'import_batch', ib.id, 'import_error', ib.id, 'import_error',
  clock_timestamp() - INTERVAL '100 days',
  clock_timestamp() - INTERVAL '100 days',
  clock_timestamp() - INTERVAL '100 days'
FROM public.import_batches ib
WHERE ib.batch_name LIKE 'Resolved %';

SET LOCAL ROLE service_role;
SELECT pg_temp.gateb_assert(
  'first prune call is capped at 500',
  public.notification_prune_import_acknowledgements(
    'b0320000-0000-4000-8000-000000000001',
    'b0322000-0000-4000-8000-000000000001',
    500
  ) = 500
);
SELECT pg_temp.gateb_assert(
  'second prune call deterministically removes the final eligible row',
  public.notification_prune_import_acknowledgements(
    'b0320000-0000-4000-8000-000000000001',
    'b0322000-0000-4000-8000-000000000001',
    500
  ) = 1
);
SELECT pg_temp.gateb_assert(
  'bounded pruning never deletes acknowledgements for active conditions',
  (
    SELECT COUNT(*)
    FROM public.notification_acknowledgements ack
    JOIN public.import_batches ib ON ib.id = ack.import_batch_id
    WHERE ack.company_id = 'b0320000-0000-4000-8000-000000000001'
      AND ack.user_id = 'b0322000-0000-4000-8000-000000000001'
      AND (ib.error_rows > 0 OR ib.unmatched_count > 0)
  ) = 20
);
RESET ROLE;

ROLLBACK;
