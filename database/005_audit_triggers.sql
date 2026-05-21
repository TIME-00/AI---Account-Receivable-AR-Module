-- ============================================================================
-- TSH Synergy ERP — Accounts Receivable Module
-- Database Schema: 005_audit_triggers.sql
-- Target: PostgreSQL 15+ (Supabase)
-- Version: 1.0
-- Date: 2026-04-10
-- Purpose: VULN-A01 FIX — Database-level audit triggers for customer_change_logs
-- ============================================================================
-- EXECUTION ORDER: Run AFTER 001-004 SQL files.
-- ============================================================================

-- ============================================================================
-- SECTION 1: CUSTOMER MASTER DATA CHANGE AUDIT TRIGGER
-- ============================================================================
-- This trigger ensures 100% audit coverage of customer data modifications,
-- regardless of whether changes are made via:
--   • Application API (Edge Functions)
--   • Supabase Dashboard SQL editor
--   • Direct psql / pgAdmin access
--   • Other microservices or ETL pipelines
--
-- PRD Reference: PRD Part 1 §6.1 — "All field changes shall be automatically
-- recorded with changed_by, timestamp, old_value, and new_value."
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1.1 Trigger Function: fn_log_customer_changes
-- ────────────────────────────────────────────────────────────────────────────
-- Tracks changes to all auditable fields on the customers table.
-- Skips the 'updated_at' field (handled by handle_updated_at trigger).
-- Uses EXECUTE + format() for dynamic column introspection.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_log_customer_changes()
RETURNS TRIGGER AS $$
DECLARE
    col         TEXT;
    old_val     TEXT;
    new_val     TEXT;
    changed_by  UUID;
    -- List of fields to audit (matches PRD Part 1 §6.1 sensitive + operational fields)
    audit_cols  TEXT[] := ARRAY[
        -- General fields
        'customer_name', 'short_name', 'customer_type', 'registration_no', 'tax_id',
        'status', 'customer_group_id', 'parent_id', 'is_deleted',
        -- Contact fields
        'bill_addr_line1', 'bill_addr_line2', 'bill_city', 'bill_state',
        'bill_postal', 'bill_country',
        'contact_name', 'contact_phone', 'contact_email',
        -- Finance fields (PRD Part 1 §6.2 — sensitive, require reason)
        'default_currency', 'ar_control_acct_id', 'revenue_acct_id',
        'tax_output_acct_id', 'discount_acct_id', 'bad_debt_acct_id',
        'allowance_acct_id', 'forex_gain_acct_id', 'forex_loss_acct_id',
        'payment_term_id', 'credit_limit', 'credit_rating', 'e_invoice_enabled'
    ];
BEGIN
    -- Resolve the user who made the change:
    -- Priority 1: NEW.updated_by (set by application layer)
    -- Priority 2: current Supabase auth JWT claim (for direct SQL access)
    -- Priority 3: NULL (unknown — should be investigated)
    changed_by := COALESCE(
        NEW.updated_by,
        NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID
    );

    -- Iterate over all auditable columns
    FOREACH col IN ARRAY audit_cols LOOP
        -- Dynamically get old and new values
        EXECUTE format('SELECT ($1).%I::TEXT', col) INTO old_val USING OLD;
        EXECUTE format('SELECT ($1).%I::TEXT', col) INTO new_val USING NEW;

        -- Only log if the value actually changed
        IF old_val IS DISTINCT FROM new_val THEN
            INSERT INTO customer_change_logs (
                customer_id,
                field_name,
                old_value,
                new_value,
                changed_by,
                change_reason
            ) VALUES (
                NEW.id,
                col,
                old_val,
                new_val,
                changed_by,
                -- For DB-level changes, mark as system-generated
                CASE
                    WHEN NEW.updated_by IS NULL THEN '[DB-TRIGGER] Direct SQL modification detected'
                    ELSE NULL  -- Application-layer logChange() provides the reason separately
                END
            );
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_log_customer_changes()
IS 'VULN-A01 FIX: Database-level audit trigger for customer_change_logs. '
   'Ensures 100% audit coverage regardless of data modification source. '
   'PRD Part 1 §6.1 compliance.';


-- ────────────────────────────────────────────────────────────────────────────
-- 1.2 Trigger: trg_customer_audit_log
-- ────────────────────────────────────────────────────────────────────────────
-- Fires AFTER UPDATE on customers table (not BEFORE, to avoid conflicts
-- with the handle_updated_at trigger). Only fires when row data changes.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TRIGGER trg_customer_audit_log
    AFTER UPDATE ON customers
    FOR EACH ROW
    WHEN (OLD.* IS DISTINCT FROM NEW.*)   -- Skip no-op updates
    EXECUTE FUNCTION fn_log_customer_changes();

COMMENT ON TRIGGER trg_customer_audit_log ON customers
IS 'Fires after every UPDATE on customers table. Logs all field-level changes '
   'to customer_change_logs for full audit trail compliance (PRD Part 1 §6).';


-- ────────────────────────────────────────────────────────────────────────────
-- 1.3 Prevent DELETE on customer_change_logs (audit integrity)
-- ────────────────────────────────────────────────────────────────────────────
-- Audit logs must be immutable. No one should be able to delete or modify
-- historical audit records, even with admin access.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit log records cannot be modified or deleted. '
                    'Table: %, Operation: %. '
                    'This is enforced for financial compliance (PRD Part 1 §6.3).',
                    TG_TABLE_NAME, TG_OP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_changelog_delete
    BEFORE DELETE ON customer_change_logs
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_audit_log_modification();

CREATE TRIGGER trg_prevent_changelog_update
    BEFORE UPDATE ON customer_change_logs
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_audit_log_modification();

COMMENT ON FUNCTION fn_prevent_audit_log_modification()
IS 'Prevents any DELETE or UPDATE on audit log tables. '
   'Ensures audit trail immutability for SOX/IFRS compliance.';


-- ────────────────────────────────────────────────────────────────────────────
-- 1.4 Same protection for credit_control_logs
-- ────────────────────────────────────────────────────────────────────────────

CREATE TRIGGER trg_prevent_ccl_delete
    BEFORE DELETE ON credit_control_logs
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_audit_log_modification();

CREATE TRIGGER trg_prevent_ccl_update
    BEFORE UPDATE ON credit_control_logs
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_audit_log_modification();


-- ============================================================================
-- VERIFICATION QUERIES (run after deployment to confirm triggers are active)
-- ============================================================================
-- 
-- -- List all triggers on customers table:
-- SELECT trigger_name, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE event_object_table = 'customers'
-- ORDER BY trigger_name;
--
-- -- Expected output:
-- -- trg_customer_audit_log    | UPDATE | AFTER
-- -- trg_customers_updated_at  | UPDATE | BEFORE
--
-- -- Verify audit log immutability:
-- -- DELETE FROM customer_change_logs WHERE id = '...' ;
-- -- Expected: ERROR: Audit log records cannot be modified or deleted.
--
-- ============================================================================
