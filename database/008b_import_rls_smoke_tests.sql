-- ============================================================================
-- TSH Synergy ERP - AR Module - 008b_import_rls_smoke_tests.sql
-- Sprint F4 Phase A Import Tables RLS Smoke Tests
-- Run AFTER database/008_import_tables.sql on staging.
-- ============================================================================
-- This file runs inside a transaction and ends with ROLLBACK.
-- It verifies:
--   - tenant/company scoped access
--   - inactive role rejection
--   - System Admin cannot read/write import operational data
--   - Auditor read-only access
--   - import_row_allocations allocation_id FK exists
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION f4_smoke_login(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::TEXT, TRUE);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated',
    'sub', p_user_id
  )::TEXT, TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION f4_smoke_assert(p_name TEXT, p_condition BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, FALSE) THEN
    RAISE EXCEPTION 'FAIL: %', p_name;
  END IF;
  RAISE NOTICE 'PASS: %', p_name;
END;
$$;

CREATE OR REPLACE FUNCTION f4_smoke_assert_error(p_name TEXT, p_sql TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'PASS: % (%: %)', p_name, SQLSTATE, SQLERRM;
      RETURN;
  END;

  RAISE EXCEPTION 'FAIL: %, expected an error', p_name;
END;
$$;

DO $$
DECLARE
  v_company_a UUID := '00000000-0000-0000-0000-000000000001';
  v_company_b UUID := '00000000-0000-0000-0000-000000000002';
  v_clerk_a   UUID := '81000000-0000-0000-0000-000000000001';
  v_auditor_a UUID := '81000000-0000-0000-0000-000000000002';
  v_admin_a   UUID := '81000000-0000-0000-0000-000000000003';
  v_inactive  UUID := '81000000-0000-0000-0000-000000000004';
  v_clerk_b   UUID := '81000000-0000-0000-0000-000000000005';
  v_batch_a   UUID := '82000000-0000-0000-0000-000000000001';
  v_batch_b   UUID := '82000000-0000-0000-0000-000000000002';
BEGIN
  INSERT INTO companies (
    id, company_code, company_name, base_currency, country, is_active
  )
  VALUES
    (v_company_a, 'F4A', 'F4 Smoke Company A', 'MYR', 'MY', TRUE),
    (v_company_b, 'F4B', 'F4 Smoke Company B', 'MYR', 'MY', TRUE)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO user_roles (id, user_id, company_id, role, is_active)
  VALUES
    ('83000000-0000-0000-0000-000000000001', v_clerk_a,   v_company_a, 'AR Clerk', TRUE),
    ('83000000-0000-0000-0000-000000000002', v_auditor_a, v_company_a, 'Auditor', TRUE),
    ('83000000-0000-0000-0000-000000000003', v_admin_a,   v_company_a, 'System Admin', TRUE),
    ('83000000-0000-0000-0000-000000000004', v_inactive,  v_company_a, 'AR Clerk', FALSE),
    ('83000000-0000-0000-0000-000000000005', v_clerk_b,   v_company_b, 'AR Clerk', TRUE)
  ON CONFLICT (user_id, company_id, role) DO UPDATE
    SET is_active = EXCLUDED.is_active;

  INSERT INTO import_batches (
    id, company_id, batch_name, import_type, file_type, file_name, file_path, created_by
  )
  VALUES
    (v_batch_a, v_company_a, 'F4 Smoke A', 'invoice', 'csv', 'a.csv', 'ar-imports/a/a.csv', v_clerk_a),
    (v_batch_b, v_company_b, 'F4 Smoke B', 'invoice', 'csv', 'b.csv', 'ar-imports/b/b.csv', v_clerk_b);

  INSERT INTO import_rows (batch_id, row_number, raw_data, status)
  VALUES
    (v_batch_a, 1, '{"customer_name":"A"}', 'Pending'),
    (v_batch_b, 1, '{"customer_name":"B"}', 'Pending');
END $$;

SELECT f4_smoke_login('81000000-0000-0000-0000-000000000001');
SELECT f4_smoke_assert(
  'AR Clerk sees own company batch',
  (SELECT COUNT(*) FROM import_batches WHERE id = '82000000-0000-0000-0000-000000000001') = 1
);
SELECT f4_smoke_assert(
  'AR Clerk cannot see other company batch',
  (SELECT COUNT(*) FROM import_batches WHERE id = '82000000-0000-0000-0000-000000000002') = 0
);
SELECT f4_smoke_assert(
  'AR Clerk sees own company child rows',
  (SELECT COUNT(*) FROM import_rows) = 1
);

SELECT f4_smoke_login('81000000-0000-0000-0000-000000000002');
SELECT f4_smoke_assert(
  'Auditor can read import batches',
  (SELECT COUNT(*) FROM import_batches WHERE company_id = '00000000-0000-0000-0000-000000000001') = 1
);
SELECT f4_smoke_assert_error(
  'Auditor cannot insert import batch',
  $$INSERT INTO import_batches (company_id, batch_name, import_type, file_type, file_name)
    VALUES ('00000000-0000-0000-0000-000000000001', 'Bad', 'invoice', 'csv', 'bad.csv')$$
);

SELECT f4_smoke_login('81000000-0000-0000-0000-000000000003');
SELECT f4_smoke_assert(
  'System Admin cannot read import batches',
  (SELECT COUNT(*) FROM import_batches) = 0
);
SELECT f4_smoke_assert(
  'System Admin cannot read import rows',
  (SELECT COUNT(*) FROM import_rows) = 0
);

SELECT f4_smoke_login('81000000-0000-0000-0000-000000000004');
SELECT f4_smoke_assert(
  'Inactive role cannot read import batches',
  (SELECT COUNT(*) FROM import_batches) = 0
);

RESET ROLE;
SELECT f4_smoke_assert(
  'import_row_allocations allocation_id has FK',
  EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = 'import_row_allocations'
      AND kcu.column_name = 'allocation_id'
  )
);

ROLLBACK;

