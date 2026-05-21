-- ============================================================================
-- TSH Synergy ERP — Accounts Receivable Module
-- Database Schema: 004_auth_tables.sql
-- Target: PostgreSQL 15+ (Supabase)
-- Version: 1.0
-- Date: 2026-03-29
-- ============================================================================
-- EXECUTION ORDER: Run AFTER 003_seed_data.sql
-- ============================================================================
-- 本文件创建用户角色和客户分配表，支持 PRD Part 5 §5.1 权限矩阵。
-- 用户身份由 Supabase Auth (auth.users) 管理，本表仅存储角色映射。
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. user_roles — 用户角色映射表
-- ────────────────────────────────────────────────────────────────────────────
-- 一个用户可以在不同公司拥有不同角色。
-- 一个用户在同一公司可以拥有多个角色（如同时是 AR Clerk 和 AR Supervisor）。

CREATE TABLE user_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL,   -- References auth.users (no direct FK to avoid Supabase schema coupling)
    company_id  UUID        NOT NULL REFERENCES companies(id),
    role        VARCHAR(20) NOT NULL,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_roles UNIQUE (user_id, company_id, role),
    CONSTRAINT chk_user_role CHECK (
        role IN ('AR Clerk', 'AR Supervisor', 'Finance Manager', 'System Admin', 'Auditor')
    )
);

CREATE INDEX idx_user_roles_user    ON user_roles(user_id);
CREATE INDEX idx_user_roles_company ON user_roles(company_id);
CREATE INDEX idx_user_roles_role    ON user_roles(company_id, role);

CREATE TRIGGER trg_user_roles_updated_at
    BEFORE UPDATE ON user_roles
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE user_roles IS '用户角色映射表 (PRD Part 5 §5.1)。每个用户在每个公司可拥有一个或多个角色。';
COMMENT ON COLUMN user_roles.role IS '角色: AR Clerk / AR Supervisor / Finance Manager / System Admin / Auditor';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. user_customer_assignments — 用户-客户分配表
-- ────────────────────────────────────────────────────────────────────────────
-- 用于 AR Clerk 的数据权限隔离 (PRD Part 5 §5.2):
-- AR Clerk 仅可查看/操作分配给自己的客户。
-- AR Supervisor+ 无需此表（可访问所有客户）。

CREATE TABLE user_customer_assignments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL,          -- References auth.users
    customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    company_id   UUID NOT NULL REFERENCES companies(id),
    assigned_by  UUID,                    -- References auth.users
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active    BOOLEAN     NOT NULL DEFAULT TRUE,

    CONSTRAINT uq_user_customer_assign UNIQUE (user_id, customer_id)
);

CREATE INDEX idx_uca_user     ON user_customer_assignments(user_id);
CREATE INDEX idx_uca_customer ON user_customer_assignments(customer_id);
CREATE INDEX idx_uca_company  ON user_customer_assignments(company_id);

COMMENT ON TABLE user_customer_assignments IS '用户-客户分配表 (PRD Part 5 §5.2)。AR Clerk 仅可访问分配给自己的客户数据。';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Helper function: 获取用户最高角色
-- ────────────────────────────────────────────────────────────────────────────
-- 角色优先级: Finance Manager > AR Supervisor > AR Clerk > System Admin > Auditor

CREATE OR REPLACE FUNCTION get_user_highest_role(
    p_user_id    UUID,
    p_company_id UUID
)
RETURNS VARCHAR(20)
LANGUAGE sql
STABLE
AS $$
    SELECT role
    FROM user_roles
    WHERE user_id = p_user_id
      AND company_id = p_company_id
      AND is_active = TRUE
    ORDER BY
        CASE role
            WHEN 'Finance Manager'  THEN 1
            WHEN 'AR Supervisor'    THEN 2
            WHEN 'AR Clerk'         THEN 3
            WHEN 'System Admin'     THEN 4
            WHEN 'Auditor'          THEN 5
        END
    LIMIT 1;
$$;

COMMENT ON FUNCTION get_user_highest_role(UUID, UUID) IS
'返回用户在指定公司中的最高权限角色。优先级: Finance Manager > AR Supervisor > AR Clerk > System Admin > Auditor。';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Helper function: 检查用户是否有指定角色或更高权限
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION user_has_role_or_above(
    p_user_id      UUID,
    p_company_id   UUID,
    p_required_role VARCHAR(20)
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM user_roles
        WHERE user_id = p_user_id
          AND company_id = p_company_id
          AND is_active = TRUE
          AND CASE role
                  WHEN 'Finance Manager'  THEN 1
                  WHEN 'AR Supervisor'    THEN 2
                  WHEN 'AR Clerk'         THEN 3
                  WHEN 'System Admin'     THEN 4
                  WHEN 'Auditor'          THEN 5
              END
              <=
              CASE p_required_role
                  WHEN 'Finance Manager'  THEN 1
                  WHEN 'AR Supervisor'    THEN 2
                  WHEN 'AR Clerk'         THEN 3
                  WHEN 'System Admin'     THEN 4
                  WHEN 'Auditor'          THEN 5
              END
    );
$$;

COMMENT ON FUNCTION user_has_role_or_above(UUID, UUID, VARCHAR) IS
'检查用户在指定公司中是否拥有 p_required_role 或更高权限。用于 API 层权限校验。';
