-- ============================================================================
-- TSH Synergy ERP — Accounts Receivable Module
-- Database Schema: 001_create_tables.sql
-- Target: PostgreSQL 15+ (Supabase)
-- Version: 1.0
-- Date: 2026-03-29
-- ============================================================================
-- EXECUTION ORDER: Run this file FIRST, then 002, then 003.
-- ============================================================================

-- ============================================================================
-- SECTION 0: EXTENSIONS & UTILITY FUNCTIONS
-- ============================================================================

-- UUID generation (already enabled in Supabase, but safe to call)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ────────────────────────────────────────────────────────────────────────────
-- Generic updated_at trigger function
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$   
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION handle_updated_at()
IS 'Generic trigger function to auto-update the updated_at timestamp on row modification.';


-- ============================================================================
-- SECTION 1: BASE CONFIGURATION TABLES
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1.1 companies — Multi-company support (法律实体)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_code    VARCHAR(10)  NOT NULL,
    company_name    VARCHAR(200) NOT NULL,
    registration_no VARCHAR(50),
    tax_id          VARCHAR(20),
    base_currency   CHAR(3)      NOT NULL DEFAULT 'MYR',
    country         CHAR(2)      NOT NULL DEFAULT 'MY',
    address_line1   VARCHAR(100),
    address_line2   VARCHAR(100),
    city            VARCHAR(50),
    state           VARCHAR(50),
    postal_code     VARCHAR(10),
    phone           VARCHAR(20),
    email           VARCHAR(100),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_companies_code UNIQUE (company_code)
);

CREATE TRIGGER trg_companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE companies IS '公司/法律实体主数据。支持多公司共享数据库架构。';

-- ────────────────────────────────────────────────────────────────────────────
-- 1.2 gl_accounts — 总账科目参考表（简化版）
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE gl_accounts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   UUID         NOT NULL REFERENCES companies(id),
    account_code VARCHAR(20)  NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    account_type VARCHAR(20)  NOT NULL,
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_gl_accounts_code UNIQUE (company_id, account_code),
    CONSTRAINT chk_gl_account_type CHECK (
        account_type IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')
    )
);

CREATE INDEX idx_gl_accounts_company ON gl_accounts(company_id);
CREATE INDEX idx_gl_accounts_type    ON gl_accounts(company_id, account_type);

CREATE TRIGGER trg_gl_accounts_updated_at
    BEFORE UPDATE ON gl_accounts
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE gl_accounts IS 'GL 科目参考表（简化版）。完整科目表由 GL 模块管理。AR 模块用于 FK 引用。';

-- ────────────────────────────────────────────────────────────────────────────
-- 1.3 bank_accounts — 银行账户主数据
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE bank_accounts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID         NOT NULL REFERENCES companies(id),
    bank_name     VARCHAR(100) NOT NULL,
    account_name  VARCHAR(100) NOT NULL,
    account_no    VARCHAR(30)  NOT NULL,
    swift_code    VARCHAR(11),
    currency      CHAR(3)      NOT NULL DEFAULT 'MYR',
    gl_account_id UUID         REFERENCES gl_accounts(id),
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_bank_accounts UNIQUE (company_id, account_no)
);

CREATE INDEX idx_bank_accounts_company ON bank_accounts(company_id);
CREATE INDEX idx_bank_accounts_gl      ON bank_accounts(gl_account_id);

CREATE TRIGGER trg_bank_accounts_updated_at
    BEFORE UPDATE ON bank_accounts
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE bank_accounts IS '公司银行账户主数据。收款过账时引用。';

-- ────────────────────────────────────────────────────────────────────────────
-- 1.4 fiscal_periods — 财务期间控制表 (BR-JE-007)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE fiscal_periods (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID        NOT NULL REFERENCES companies(id),
    period_code VARCHAR(7)  NOT NULL,  -- Format: YYYY-MM
    status      VARCHAR(10) NOT NULL DEFAULT 'Open',
    start_date  DATE        NOT NULL,
    end_date    DATE        NOT NULL,
    opened_by   UUID,       -- References auth.users
    opened_at   TIMESTAMPTZ,
    closed_by   UUID,       -- References auth.users
    closed_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_fiscal_periods UNIQUE (company_id, period_code),
    CONSTRAINT chk_fiscal_period_status CHECK (
        status IN ('Open', 'Closed', 'Year-End')
    ),
    CONSTRAINT chk_fiscal_period_dates CHECK (start_date <= end_date)
);

CREATE INDEX idx_fiscal_periods_company ON fiscal_periods(company_id);
CREATE INDEX idx_fiscal_periods_status  ON fiscal_periods(company_id, status);

CREATE TRIGGER trg_fiscal_periods_updated_at
    BEFORE UPDATE ON fiscal_periods
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE fiscal_periods IS '财务期间控制表。仅 Finance Manager 可打开/关闭期间。所有过账须在 Open 期间内。';

-- ────────────────────────────────────────────────────────────────────────────
-- 1.5 payment_terms — 账期配置表 (PRD Part 1 §4)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE payment_terms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID        NOT NULL REFERENCES companies(id),
    term_code   VARCHAR(10) NOT NULL,
    term_name   VARCHAR(50) NOT NULL,
    term_type   VARCHAR(20) NOT NULL,
    days        INT,
    description TEXT,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_payment_terms UNIQUE (company_id, term_code),
    CONSTRAINT chk_payment_term_type CHECK (
        term_type IN ('Fixed Days', 'End of Month', 'Prepaid', 'COD', 'Custom')
    )
);

CREATE INDEX idx_payment_terms_company ON payment_terms(company_id);

CREATE TRIGGER trg_payment_terms_updated_at
    BEFORE UPDATE ON payment_terms
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE payment_terms IS '账期配置表。定义 NET30/EOM/COD/PREPAID 等账期类型及计算参数。仅 System Admin 可维护 (BR-PT-005)。';

-- ────────────────────────────────────────────────────────────────────────────
-- 1.6 tax_codes — 税码配置表 (PRD Part 2 §5)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE tax_codes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id     UUID         NOT NULL REFERENCES companies(id),
    tax_code       VARCHAR(10)  NOT NULL,
    tax_name       VARCHAR(50)  NOT NULL,
    tax_type       VARCHAR(10)  NOT NULL,
    rate           DECIMAL(5,2) NOT NULL,
    effective_from DATE         NOT NULL,
    effective_to   DATE,          -- NULL = 永久有效
    country        CHAR(2)      NOT NULL,
    gl_account_id  UUID         REFERENCES gl_accounts(id),
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_tax_codes UNIQUE (company_id, tax_code, effective_from),
    CONSTRAINT chk_tax_type CHECK (tax_type IN ('Output', 'Input')),
    CONSTRAINT chk_tax_effective_dates CHECK (
        effective_to IS NULL OR effective_to >= effective_from
    )
);

CREATE INDEX idx_tax_codes_company   ON tax_codes(company_id);
CREATE INDEX idx_tax_codes_effective ON tax_codes(company_id, tax_code, effective_from, effective_to);
CREATE INDEX idx_tax_codes_gl        ON tax_codes(gl_account_id);

CREATE TRIGGER trg_tax_codes_updated_at
    BEFORE UPDATE ON tax_codes
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE tax_codes IS '税码配置表。支持 MY SST / SG GST 多税率体系，按 effective_from/to 管理税率时效性 (BR-TAX-003)。';

-- ────────────────────────────────────────────────────────────────────────────
-- 1.7 customer_groups — 客户分组配置表
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE customer_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID        NOT NULL REFERENCES companies(id),
    group_code  VARCHAR(20) NOT NULL,
    group_name  VARCHAR(50) NOT NULL,
    description TEXT,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_customer_groups UNIQUE (company_id, group_code)
);

CREATE INDEX idx_customer_groups_company ON customer_groups(company_id);

CREATE TRIGGER trg_customer_groups_updated_at
    BEFORE UPDATE ON customer_groups
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE customer_groups IS '客户分组配置表。用于报表分组和批量策略。';

-- ────────────────────────────────────────────────────────────────────────────
-- 1.8 exchange_rates — 汇率表 (BR-INV-007)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE exchange_rates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id     UUID           NOT NULL REFERENCES companies(id),
    from_currency  CHAR(3)        NOT NULL,
    to_currency    CHAR(3)        NOT NULL,
    rate           DECIMAL(12,6)  NOT NULL,
    effective_date DATE           NOT NULL,
    created_by     UUID,          -- References auth.users
    created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_exchange_rates UNIQUE (company_id, from_currency, to_currency, effective_date),
    CONSTRAINT chk_exchange_rate_positive CHECK (rate > 0)
);

CREATE INDEX idx_exchange_rates_company ON exchange_rates(company_id);
CREATE INDEX idx_exchange_rates_lookup  ON exchange_rates(company_id, from_currency, to_currency, effective_date DESC);

COMMENT ON TABLE exchange_rates IS '每日汇率表。Finance Manager 每日维护。发票过账时从此表取汇率 (BR-INV-007)。';

-- ────────────────────────────────────────────────────────────────────────────
-- 1.9 aging_buckets — 账龄桶配置表 (PRD Part 4 §2.1)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE aging_buckets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID        NOT NULL REFERENCES companies(id),
    bucket_no   INT         NOT NULL,
    bucket_name VARCHAR(30) NOT NULL,
    from_days   INT         NOT NULL,
    to_days     INT,          -- NULL = 无上限（最后一桶）
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_aging_buckets UNIQUE (company_id, bucket_no),
    CONSTRAINT chk_aging_bucket_days CHECK (
        to_days IS NULL OR to_days >= from_days
    )
);

CREATE INDEX idx_aging_buckets_company ON aging_buckets(company_id);

CREATE TRIGGER trg_aging_buckets_updated_at
    BEFORE UPDATE ON aging_buckets
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE aging_buckets IS '账龄桶配置表。默认 5 桶 (Current/1-30/31-60/61-90/90+)，System Admin 可自定义。';

-- ────────────────────────────────────────────────────────────────────────────
-- 1.10 ar_system_config — AR 模块系统配置
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE ar_system_config (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   UUID        NOT NULL REFERENCES companies(id),
    config_key   VARCHAR(50) NOT NULL,
    config_value TEXT        NOT NULL,
    description  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_ar_system_config UNIQUE (company_id, config_key)
);

CREATE INDEX idx_ar_system_config_company ON ar_system_config(company_id);

CREATE TRIGGER trg_ar_system_config_updated_at
    BEFORE UPDATE ON ar_system_config
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE ar_system_config IS 'AR 模块系统级配置。包括核销容差、默认税码、默认科目映射等。';

-- ────────────────────────────────────────────────────────────────────────────
-- 1.11 products — 商品/服务主数据（简化占位表）
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE products (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   UUID         NOT NULL REFERENCES companies(id),
    product_code VARCHAR(30)  NOT NULL,
    product_name VARCHAR(200) NOT NULL,
    default_uom  VARCHAR(10),
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_products UNIQUE (company_id, product_code)
);

CREATE INDEX idx_products_company ON products(company_id);

CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE products IS '商品/服务主数据（简化占位表）。完整商品管理由 Inventory 模块负责。';

-- ────────────────────────────────────────────────────────────────────────────
-- 1.12 document_sequences — 单据编号序列表
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE document_sequences (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID        NOT NULL REFERENCES companies(id),
    doc_type      VARCHAR(10) NOT NULL,   -- CUST, INV, CN, DN, RCT, JE
    prefix        VARCHAR(10) NOT NULL,   -- CUST-, INV-, CN-, DN-, RCT-, JE-
    current_year  INT         NOT NULL,
    current_month INT         NOT NULL,
    last_sequence INT         NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_document_sequences UNIQUE (company_id, doc_type, current_year, current_month),
    CONSTRAINT chk_doc_sequence_month CHECK (current_month BETWEEN 1 AND 12)
);

CREATE TRIGGER trg_document_sequences_updated_at
    BEFORE UPDATE ON document_sequences
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE document_sequences IS '单据编号序列表。应用层调用 get_next_sequence() 生成格式化编号 (BR-INV-006)。';


-- ============================================================================
-- SECTION 2: CUSTOMER MASTER DATA TABLES
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 2.1 customers — 客户主数据 (PRD Part 1 §2)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE customers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID          NOT NULL REFERENCES companies(id),

    -- ── 基本信息 (General Tab) ──
    customer_id         VARCHAR(20)   NOT NULL,   -- 格式: CUST-NNNNN
    customer_name       VARCHAR(200)  NOT NULL,
    short_name          VARCHAR(50),
    customer_type       VARCHAR(20)   NOT NULL DEFAULT 'Corporate',
    registration_no     VARCHAR(50),              -- Corporate 类型必填 (应用层校验)
    tax_id              VARCHAR(20),
    status              VARCHAR(10)   NOT NULL DEFAULT 'Active',
    customer_group_id   UUID          REFERENCES customer_groups(id),
    parent_id           UUID          REFERENCES customers(id),    -- 自引用: 集团客户层级
    is_deleted          BOOLEAN       NOT NULL DEFAULT FALSE,      -- 逻辑删除 (BR-CUS-003)

    -- ── 联系信息 (Contact Tab) ──
    bill_addr_line1     VARCHAR(100)  NOT NULL,
    bill_addr_line2     VARCHAR(100),
    bill_city           VARCHAR(50)   NOT NULL,
    bill_state          VARCHAR(50)   NOT NULL,
    bill_postal         VARCHAR(10)   NOT NULL,
    bill_country        CHAR(2)       NOT NULL,   -- ISO 3166-1 (MY, SG 等)
    contact_name        VARCHAR(100)  NOT NULL,
    contact_phone       VARCHAR(20)   NOT NULL,
    contact_email       VARCHAR(100)  NOT NULL,

    -- ── JSONB 子数据 ──
    shipping_addresses  JSONB         NOT NULL DEFAULT '[]'::JSONB,
    /*
     * 结构: [{
     *   "addr_line1": "...", "addr_line2": "...",
     *   "city": "...", "state": "...", "postal": "...",
     *   "country": "MY", "is_default": true
     * }, ...]
     */
    alt_contacts        JSONB         NOT NULL DEFAULT '[]'::JSONB,
    /*
     * 结构: [{
     *   "contact_name": "...", "phone": "...",
     *   "email": "...", "position": "..."
     * }, ...]
     */

    -- ── 财务信息 (Finance Tab) ──
    default_currency    CHAR(3)       NOT NULL DEFAULT 'MYR',
    ar_control_acct_id  UUID          REFERENCES gl_accounts(id),
    revenue_acct_id     UUID          REFERENCES gl_accounts(id),
    tax_output_acct_id  UUID          REFERENCES gl_accounts(id),
    discount_acct_id    UUID          REFERENCES gl_accounts(id),
    bad_debt_acct_id    UUID          REFERENCES gl_accounts(id),
    allowance_acct_id   UUID          REFERENCES gl_accounts(id),
    forex_gain_acct_id  UUID          REFERENCES gl_accounts(id),
    forex_loss_acct_id  UUID          REFERENCES gl_accounts(id),
    payment_term_id     UUID          REFERENCES payment_terms(id),
    credit_limit        DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    credit_rating       VARCHAR(3)    NOT NULL DEFAULT 'A',
    e_invoice_enabled   BOOLEAN       NOT NULL DEFAULT FALSE,

    -- ── 审计字段 ──
    created_by          UUID,         -- References auth.users
    updated_by          UUID,         -- References auth.users
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- ── 约束 ──
    CONSTRAINT uq_customers_id     UNIQUE (company_id, customer_id),
    CONSTRAINT chk_customer_type   CHECK (
        customer_type IN ('Corporate', 'Individual', 'Government', 'Intercompany')
    ),
    CONSTRAINT chk_customer_status CHECK (
        status IN ('Active', 'Inactive', 'Blocked', 'On Hold')
    ),
    CONSTRAINT chk_credit_rating   CHECK (
        credit_rating IN ('AAA', 'AA', 'A', 'B', 'C', 'D')
    ),
    CONSTRAINT chk_credit_limit    CHECK (credit_limit >= 0)
);

-- ── 索引 ──
CREATE INDEX idx_customers_company      ON customers(company_id);
CREATE INDEX idx_customers_status       ON customers(company_id, status) WHERE is_deleted = FALSE;
CREATE INDEX idx_customers_type         ON customers(company_id, customer_type);
CREATE INDEX idx_customers_group        ON customers(customer_group_id);
CREATE INDEX idx_customers_parent       ON customers(parent_id);
CREATE INDEX idx_customers_country      ON customers(company_id, bill_country);
CREATE INDEX idx_customers_name         ON customers(company_id, customer_name);
CREATE INDEX idx_customers_short_name   ON customers(company_id, short_name) WHERE short_name IS NOT NULL;
CREATE INDEX idx_customers_deleted      ON customers(company_id) WHERE is_deleted = TRUE;

CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE customers IS '客户主数据表。AR 模块数据基础层。包含基本信息、联系方式、财务参数。信用使用率不在此存储，实时计算 (BR-CUS-005)。';
COMMENT ON COLUMN customers.customer_id IS '业务编号，格式 CUST-NNNNN，系统自增不可修改。';
COMMENT ON COLUMN customers.shipping_addresses IS 'JSONB: 多条送货地址。结构: [{addr_line1, addr_line2, city, state, postal, country, is_default}]';
COMMENT ON COLUMN customers.alt_contacts IS 'JSONB: 备用联络人。结构: [{contact_name, phone, email, position}]';
COMMENT ON COLUMN customers.is_deleted IS '逻辑删除标记 (BR-CUS-003)。有未结余额时不允许删除。';

-- ────────────────────────────────────────────────────────────────────────────
-- 2.2 customer_bank_details — 客户银行账户信息
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE customer_bank_details (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    bank_name    VARCHAR(100) NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    account_no   VARCHAR(30)  NOT NULL,
    swift_code   VARCHAR(11),
    is_default   BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_bank_details_customer ON customer_bank_details(customer_id);

CREATE TRIGGER trg_customer_bank_details_updated_at
    BEFORE UPDATE ON customer_bank_details
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE customer_bank_details IS '客户银行账户信息。用于退款场景 (PRD Part 1 §2.3)。';


-- ============================================================================
-- SECTION 3: TRANSACTION TABLES
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 3.1 invoices — 发票/CN/DN 统一头表 (PRD Part 2 §2.1, §4.2, §7)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE invoices (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID          NOT NULL REFERENCES companies(id),

    -- ── 基本信息 ──
    invoice_no        VARCHAR(20)   NOT NULL,   -- INV-YYYYMM-NNNNN / CN-YYYYMM-NNNNN / DN-YYYYMM-NNNNN
    doc_type          VARCHAR(20)   NOT NULL DEFAULT 'Invoice',
    invoice_date      DATE          NOT NULL,
    due_date          DATE,                     -- PREPAID 类型 = NULL (BR-PT-004)
    customer_id       UUID          NOT NULL REFERENCES customers(id),
    customer_name     VARCHAR(200)  NOT NULL,   -- 过账时快照，不随主数据变更

    -- ── 币种与汇率 ──
    currency          CHAR(3)       NOT NULL,
    exchange_rate     DECIMAL(12,6) NOT NULL DEFAULT 1.000000,
    base_currency     CHAR(3)       NOT NULL,

    -- ── 金额 ──
    subtotal          DECIMAL(18,2) NOT NULL DEFAULT 0.00,  -- SUM(line_amount)
    tax_total         DECIMAL(18,2) NOT NULL DEFAULT 0.00,  -- SUM(tax_amount)
    total_amount      DECIMAL(18,2) NOT NULL DEFAULT 0.00,  -- subtotal + tax_total
    base_total        DECIMAL(18,2) NOT NULL DEFAULT 0.00,  -- total_amount × exchange_rate
    outstanding       DECIMAL(18,2) NOT NULL DEFAULT 0.00,  -- 初始 = total_amount，核销后递减

    -- ── 状态 ──
    status            VARCHAR(20)   NOT NULL DEFAULT 'Draft',
    posting_period    VARCHAR(7),    -- 格式: YYYY-MM

    -- ── 参考与备注 ──
    reference_no      VARCHAR(50),   -- 客户 PO号 / 合同号
    internal_remarks  TEXT,          -- 内部可见
    invoice_remarks   TEXT,          -- 打印在发票上

    -- ── Credit Note 专用字段 (BR-CN-001 ~ BR-CN-006) ──
    ref_invoice_id    UUID          REFERENCES invoices(id),  -- 关联原始发票 (Linked CN)
    cn_type           VARCHAR(20),   -- Linked / Standalone
    reason_code       VARCHAR(30),   -- Return / Discount / Price Adjustment / Error Correction / Other
    reason_desc       TEXT,          -- reason_code = Other 时必填

    -- ── 科目快照 ──
    ar_acct           VARCHAR(20),   -- 过账时从客户主数据快照 (BR-AM-001 Fallback)

    -- ── 审计字段 ──
    created_by        UUID,          -- References auth.users
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    posted_by         UUID,
    posted_at         TIMESTAMPTZ,
    cancelled_by      UUID,
    cancelled_at      TIMESTAMPTZ,
    cancel_reason     TEXT,          -- 作废时必填 (BR-INV-003)
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- ── 并发控制 ──
    version           INT           NOT NULL DEFAULT 1,

    -- ── 约束 ──
    CONSTRAINT uq_invoices_no UNIQUE (company_id, invoice_no),
    CONSTRAINT chk_invoice_doc_type CHECK (
        doc_type IN ('Invoice', 'Credit Note', 'Debit Note')
    ),
    CONSTRAINT chk_invoice_status CHECK (
        status IN ('Draft', 'Open', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled', 'Written Off')
    ),
    CONSTRAINT chk_cn_type CHECK (
        cn_type IS NULL OR cn_type IN ('Linked', 'Standalone')
    ),
    CONSTRAINT chk_reason_code CHECK (
        reason_code IS NULL OR reason_code IN ('Return', 'Discount', 'Price Adjustment', 'Error Correction', 'Other')
    ),
    CONSTRAINT chk_exchange_rate_positive CHECK (exchange_rate > 0),
    CONSTRAINT chk_invoice_outstanding CHECK (outstanding >= 0),
    -- CN 的 ref_invoice_id 校验: Linked CN 必须有关联发票
    CONSTRAINT chk_cn_linked_ref CHECK (
        NOT (doc_type = 'Credit Note' AND cn_type = 'Linked' AND ref_invoice_id IS NULL)
    )
);

-- ── 索引 ──
CREATE INDEX idx_invoices_company        ON invoices(company_id);
CREATE INDEX idx_invoices_customer       ON invoices(customer_id);
CREATE INDEX idx_invoices_status         ON invoices(company_id, status);
CREATE INDEX idx_invoices_doc_type       ON invoices(company_id, doc_type);
CREATE INDEX idx_invoices_due_date       ON invoices(due_date) WHERE status IN ('Open', 'Overdue', 'Partially Paid');
CREATE INDEX idx_invoices_period         ON invoices(company_id, posting_period);
CREATE INDEX idx_invoices_ref            ON invoices(ref_invoice_id) WHERE ref_invoice_id IS NOT NULL;
-- 信用使用率计算专用索引 (BR-CM-005)
CREATE INDEX idx_invoices_credit_util    ON invoices(customer_id, doc_type, status)
    WHERE status IN ('Open', 'Overdue', 'Partially Paid');
-- 逾期定时任务专用索引 (BR-INV-005)
CREATE INDEX idx_invoices_overdue_check  ON invoices(due_date, status, outstanding)
    WHERE status IN ('Open', 'Partially Paid') AND outstanding > 0;

CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE invoices IS '发票/Credit Note/Debit Note 统一头表。doc_type 区分凭证类型。已过账凭证不可修改关键字段 (BR-INV-001)。';
COMMENT ON COLUMN invoices.customer_name IS '过账时快照，不随客户主数据后续变更而改变。';
COMMENT ON COLUMN invoices.outstanding IS '未结金额。初始 = total_amount，每次核销后递减。CN outstanding 代表未使用的贷方余额。';
COMMENT ON COLUMN invoices.version IS '乐观并发控制 (Optimistic Locking)。更新时检查 WHERE version = @old_version。';

-- ────────────────────────────────────────────────────────────────────────────
-- 3.2 invoice_lines — 发票行项表 (PRD Part 2 §2.2)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE invoice_lines (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id   UUID          NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    line_no      INT           NOT NULL,   -- 10, 20, 30...
    description  VARCHAR(200)  NOT NULL,
    item_code    VARCHAR(30),
    product_id   UUID          REFERENCES products(id),
    quantity     DECIMAL(12,3) NOT NULL,
    uom          VARCHAR(10),              -- PCS, KG, LOT, HR
    unit_price   DECIMAL(18,4) NOT NULL,
    discount_pct DECIMAL(5,2)  NOT NULL DEFAULT 0,
    discount_amt DECIMAL(18,2) NOT NULL DEFAULT 0,
    line_amount  DECIMAL(18,2) NOT NULL,   -- qty × unit_price × (1 - discount_pct/100) OR qty × unit_price - discount_amt
    tax_code_id  UUID          REFERENCES tax_codes(id),
    tax_rate     DECIMAL(5,2)  NOT NULL DEFAULT 0,
    tax_amount   DECIMAL(18,2) NOT NULL DEFAULT 0,  -- ROUND(line_amount × tax_rate / 100, 2)
    line_total   DECIMAL(18,2) NOT NULL,   -- line_amount + tax_amount
    gl_account_id UUID         REFERENCES gl_accounts(id),
    cost_center  VARCHAR(20),
    line_remarks VARCHAR(200),
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- ── 约束 ──
    CONSTRAINT uq_invoice_lines UNIQUE (invoice_id, line_no),
    CONSTRAINT chk_line_quantity CHECK (quantity > 0),
    CONSTRAINT chk_line_unit_price CHECK (unit_price >= 0),
    CONSTRAINT chk_line_discount_pct CHECK (discount_pct >= 0 AND discount_pct <= 100),
    CONSTRAINT chk_line_discount_amt CHECK (discount_amt >= 0),
    -- 折扣互斥规则 (BR-INV-CALC-003): 不可同时填写百分比和固定金额
    CONSTRAINT chk_discount_mutual_exclusive CHECK (
        NOT (discount_pct > 0 AND discount_amt > 0)
    )
);

-- ── 索引 ──
CREATE INDEX idx_invoice_lines_invoice    ON invoice_lines(invoice_id);
CREATE INDEX idx_invoice_lines_tax_code   ON invoice_lines(tax_code_id);
CREATE INDEX idx_invoice_lines_gl_account ON invoice_lines(gl_account_id);
CREATE INDEX idx_invoice_lines_product    ON invoice_lines(product_id) WHERE product_id IS NOT NULL;

CREATE TRIGGER trg_invoice_lines_updated_at
    BEFORE UPDATE ON invoice_lines
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE invoice_lines IS '发票行项表。金额按行项级逐行计算 (BR-INV-CALC-001)，税额逐行四舍五入后汇总 (BR-INV-CALC-002)。';
COMMENT ON COLUMN invoice_lines.line_no IS '行号以 10 为间隔递增 (10, 20, 30...)，支持中间插入行。';
COMMENT ON COLUMN invoice_lines.gl_account_id IS '收入科目。默认取客户 revenue_acct，可在行项层面覆盖 (BR-AM-001 Fallback)。';

-- ────────────────────────────────────────────────────────────────────────────
-- 3.3 receipts — 收款头表 (PRD Part 3 §2.1)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE receipts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id         UUID          NOT NULL REFERENCES companies(id),

    -- ── 基本信息 ──
    receipt_no         VARCHAR(20)   NOT NULL,   -- 格式: RCT-YYYYMM-NNNNN
    receipt_date       DATE          NOT NULL,
    value_date         DATE,                     -- 银行实际入账日期
    customer_id        UUID          NOT NULL REFERENCES customers(id),
    customer_name      VARCHAR(200)  NOT NULL,   -- 过账时快照

    -- ── 收款方式 ──
    payment_method     VARCHAR(4)    NOT NULL,

    -- ── 币种与汇率 ──
    currency           CHAR(3)       NOT NULL,
    exchange_rate      DECIMAL(12,6) NOT NULL DEFAULT 1.000000,
    base_currency      CHAR(3)       NOT NULL,

    -- ── 金额 ──
    receipt_amount     DECIMAL(18,2) NOT NULL,   -- 交易币种金额
    base_amount        DECIMAL(18,2) NOT NULL,   -- = receipt_amount × exchange_rate
    allocated_amount   DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    unallocated_amount DECIMAL(18,2) NOT NULL,   -- = receipt_amount - allocated_amount

    -- ── 银行信息 ──
    bank_account_id    UUID          NOT NULL REFERENCES bank_accounts(id),
    bank_account_name  VARCHAR(100)  NOT NULL,   -- 过账时快照

    -- ── 参考 ──
    reference_no       VARCHAR(50),              -- 支票号 / 电汇参考号
    cheque_date        DATE,                     -- 支票方式必填

    -- ── 状态 ──
    status             VARCHAR(20)   NOT NULL DEFAULT 'Draft',
    posting_period     VARCHAR(7),

    -- ── 备注 ──
    remarks            TEXT,

    -- ── 审计 ──
    created_by         UUID,         -- References auth.users
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    posted_by          UUID,
    posted_at          TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- ── 约束 ──
    CONSTRAINT uq_receipts_no UNIQUE (company_id, receipt_no),
    CONSTRAINT chk_receipt_method CHECK (
        payment_method IN ('CHQ', 'TT', 'CASH', 'CC', 'GIRO', 'OFST', 'ONLN')
    ),
    CONSTRAINT chk_receipt_status CHECK (
        status IN ('Draft', 'Posted', 'Fully Allocated', 'Cancelled', 'Bounced')
    ),
    CONSTRAINT chk_receipt_amount_positive CHECK (receipt_amount > 0),
    CONSTRAINT chk_receipt_exchange_rate CHECK (exchange_rate > 0),
    CONSTRAINT chk_receipt_allocated CHECK (allocated_amount >= 0),
    CONSTRAINT chk_receipt_unallocated CHECK (unallocated_amount >= 0)
);

-- ── 索引 ──
CREATE INDEX idx_receipts_company     ON receipts(company_id);
CREATE INDEX idx_receipts_customer    ON receipts(customer_id);
CREATE INDEX idx_receipts_status      ON receipts(company_id, status);
CREATE INDEX idx_receipts_period      ON receipts(company_id, posting_period);
CREATE INDEX idx_receipts_date        ON receipts(receipt_date);
-- 预收款/未核销余额查询专用索引 (BR-OP-001)
CREATE INDEX idx_receipts_unallocated ON receipts(customer_id, status, unallocated_amount)
    WHERE status IN ('Posted', 'Fully Allocated') AND unallocated_amount > 0;

CREATE TRIGGER trg_receipts_updated_at
    BEFORE UPDATE ON receipts
    FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMENT ON TABLE receipts IS '收款头表。支持 7 种收款方式。支票采用两阶段入账 (BR-RCT-CHQ-001)。';
COMMENT ON COLUMN receipts.unallocated_amount IS '未核销余额。> 0 时自动视为预收款 (BR-OP-001)。';
COMMENT ON COLUMN receipts.customer_name IS '过账时快照，不随客户主数据变更。';

-- ────────────────────────────────────────────────────────────────────────────
-- 3.4 allocation_details — 核销明细表 (PRD Part 3 §3.1)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE allocation_details (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id        UUID          NOT NULL REFERENCES receipts(id),
    invoice_id        UUID          NOT NULL REFERENCES invoices(id),
    doc_type          VARCHAR(20)   NOT NULL,   -- 发票侧的凭证类型

    -- ── 金额 ──
    allocated_amount  DECIMAL(18,2) NOT NULL,   -- 本次核销金额（交易币种）
    base_allocated    DECIMAL(18,2) NOT NULL,   -- 本位币核销金额
    invoice_rate      DECIMAL(12,6) NOT NULL,   -- 发票过账时汇率
    receipt_rate      DECIMAL(12,6) NOT NULL,   -- 收款过账时汇率
    forex_gain_loss   DECIMAL(18,2) NOT NULL DEFAULT 0,  -- 正=收益, 负=损失
    discount_amount   DECIMAL(18,2) NOT NULL DEFAULT 0,  -- 核销时现金折扣

    -- ── 核销信息 ──
    allocation_date   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    allocated_by      UUID,         -- References auth.users
    allocation_method VARCHAR(20)   NOT NULL,

    -- ── 状态 ──
    status            VARCHAR(10)   NOT NULL DEFAULT 'Active',

    -- ── 反核销信息 (BR-REC-005) ──
    reversed_by       UUID,
    reversed_at       TIMESTAMPTZ,
    reverse_reason    TEXT,         -- 反核销时必填, ≥ 10 字符

    -- ── 时间戳 ──
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- ── 约束 ──
    CONSTRAINT chk_alloc_doc_type CHECK (
        doc_type IN ('Invoice', 'Credit Note', 'Debit Note')
    ),
    CONSTRAINT chk_alloc_method CHECK (
        allocation_method IN ('Manual', 'Auto_FIFO', 'Auto_Amount')
    ),
    CONSTRAINT chk_alloc_status CHECK (
        status IN ('Active', 'Reversed')
    ),
    CONSTRAINT chk_alloc_amount_positive CHECK (allocated_amount > 0),
    CONSTRAINT chk_alloc_discount CHECK (discount_amount >= 0)
);

-- ── 索引 ──
CREATE INDEX idx_allocations_receipt ON allocation_details(receipt_id);
CREATE INDEX idx_allocations_invoice ON allocation_details(invoice_id);
CREATE INDEX idx_allocations_status  ON allocation_details(status);
CREATE INDEX idx_allocations_date    ON allocation_details(allocation_date);

COMMENT ON TABLE allocation_details IS '收款-发票核销明细表。支持 N:M 核销关系 (1 收款 → N 发票，N 收款 → 1 发票)。';
COMMENT ON COLUMN allocation_details.forex_gain_loss IS '汇兑损益金额。正数=收益 (Cr Forex Gain)，负数=损失 (Dr Forex Loss)。';
COMMENT ON COLUMN allocation_details.status IS 'Active=有效核销, Reversed=已反核销。反核销需 AR Supervisor+ 权限 (BR-REC-005)。';

-- ────────────────────────────────────────────────────────────────────────────
-- 3.5 cn_allocations — Credit Note 核销明细表
-- ────────────────────────────────────────────────────────────────────────────
-- 说明：Linked CN 过账时自动抵减原发票 (BR-CN-003)，通过 invoices.ref_invoice_id 追踪。
-- 本表用于 Standalone CN 手动核销至发票的场景。
CREATE TABLE cn_allocations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cn_id             UUID          NOT NULL REFERENCES invoices(id),    -- Credit Note (doc_type='Credit Note')
    invoice_id        UUID          NOT NULL REFERENCES invoices(id),    -- 被抵扣的发票
    allocated_amount  DECIMAL(18,2) NOT NULL,
    allocation_date   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    allocated_by      UUID,         -- References auth.users
    status            VARCHAR(10)   NOT NULL DEFAULT 'Active',
    reversed_by       UUID,
    reversed_at       TIMESTAMPTZ,
    reverse_reason    TEXT,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_cn_alloc_status CHECK (status IN ('Active', 'Reversed')),
    CONSTRAINT chk_cn_alloc_amount CHECK (allocated_amount > 0)
);

CREATE INDEX idx_cn_allocations_cn      ON cn_allocations(cn_id);
CREATE INDEX idx_cn_allocations_invoice ON cn_allocations(invoice_id);
CREATE INDEX idx_cn_allocations_status  ON cn_allocations(status);

COMMENT ON TABLE cn_allocations IS 'Standalone Credit Note 核销明细表。Linked CN 在过账时自动抵减原发票，不通过此表。';


-- ============================================================================
-- SECTION 4: JOURNAL ENTRY TABLES
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 4.1 journal_entries — 会计凭证头表 (PRD Part 5)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE journal_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID        NOT NULL REFERENCES companies(id),
    je_no           VARCHAR(30) NOT NULL,   -- JE-{source}-YYYYMM-NNNNN
    je_date         DATE        NOT NULL,
    posting_period  VARCHAR(7)  NOT NULL,   -- YYYY-MM
    source_type     VARCHAR(3)  NOT NULL,   -- INV/RCT/CN/DN/REV/ADJ/WO
    source_doc_no   VARCHAR(30),            -- 源凭证编号
    source_doc_id   UUID,                   -- 源凭证 UUID
    description     TEXT,
    currency        CHAR(3),
    exchange_rate   DECIMAL(12,6) DEFAULT 1.000000,
    base_currency   CHAR(3),
    total_debit     DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    total_credit    DECIMAL(18,2) NOT NULL DEFAULT 0.00,

    -- ── 反转凭证关联 (BR-JE-008) ──
    is_reversal     BOOLEAN     NOT NULL DEFAULT FALSE,
    original_je_id  UUID        REFERENCES journal_entries(id),
    is_reversed     BOOLEAN     NOT NULL DEFAULT FALSE,
    reversal_je_id  UUID        REFERENCES journal_entries(id),

    -- ── 审计 ──
    created_by      UUID,       -- References auth.users
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ── 约束 ──
    CONSTRAINT uq_journal_entries_no UNIQUE (company_id, je_no),
    CONSTRAINT chk_je_source_type CHECK (
        source_type IN ('INV', 'RCT', 'CN', 'DN', 'REV', 'ADJ', 'WO')
    ),
    -- 借贷平衡校验 (应用层双重校验)
    CONSTRAINT chk_je_balanced CHECK (total_debit = total_credit)
);

-- ── 索引 ──
CREATE INDEX idx_je_company    ON journal_entries(company_id);
CREATE INDEX idx_je_period     ON journal_entries(company_id, posting_period);
CREATE INDEX idx_je_date       ON journal_entries(je_date);
CREATE INDEX idx_je_source     ON journal_entries(source_type, source_doc_id);
CREATE INDEX idx_je_original   ON journal_entries(original_je_id) WHERE original_je_id IS NOT NULL;
CREATE INDEX idx_je_reversal   ON journal_entries(reversal_je_id) WHERE reversal_je_id IS NOT NULL;

COMMENT ON TABLE journal_entries IS '会计凭证头表 (双式记账)。由系统自动生成，借贷必须平衡 (BR-JE-006)。';
COMMENT ON COLUMN journal_entries.je_no IS '凭证号格式: JE-{source}-YYYYMM-NNNNN。source: INV/RCT/CN/DN/REV/ADJ/WO。';

-- ────────────────────────────────────────────────────────────────────────────
-- 4.2 journal_entry_lines — 会计凭证行项表
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE journal_entry_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    je_id           UUID          NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    line_no         INT           NOT NULL,
    gl_account_id   UUID          NOT NULL REFERENCES gl_accounts(id),
    description     VARCHAR(200),
    debit_amount    DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    credit_amount   DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    base_debit      DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    base_credit     DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    currency        CHAR(3),
    original_amount DECIMAL(18,2) DEFAULT 0.00,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_je_lines UNIQUE (je_id, line_no),
    -- 每行只能是借方或贷方之一
    CONSTRAINT chk_jel_debit_or_credit CHECK (
        (debit_amount >= 0 AND credit_amount >= 0)
        AND NOT (debit_amount > 0 AND credit_amount > 0)
    )
);

CREATE INDEX idx_jel_je         ON journal_entry_lines(je_id);
CREATE INDEX idx_jel_gl_account ON journal_entry_lines(gl_account_id);

COMMENT ON TABLE journal_entry_lines IS '会计凭证行项。每行只能是借方或贷方（不可同时有值）。合并规则见 BR-JE-001。';


-- ============================================================================
-- SECTION 5: AUDIT & LOG TABLES
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 5.1 customer_change_logs — 客户主数据变更日志 (PRD Part 1 §6)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE customer_change_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID        NOT NULL REFERENCES customers(id),
    field_name    VARCHAR(50) NOT NULL,
    old_value     TEXT,
    new_value     TEXT,
    changed_by    UUID,       -- References auth.users
    changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    change_reason TEXT        -- 敏感字段变更时必填 (PRD Part 1 §6.2)
);

CREATE INDEX idx_changelog_customer ON customer_change_logs(customer_id);
CREATE INDEX idx_changelog_date     ON customer_change_logs(changed_at);
CREATE INDEX idx_changelog_field    ON customer_change_logs(field_name);

COMMENT ON TABLE customer_change_logs IS '客户主数据变更审计日志。所有字段变更均自动记录变更人、时间、前后值 (PRD Part 1 §6.1)。';

-- ────────────────────────────────────────────────────────────────────────────
-- 5.2 credit_control_logs — 信用控制操作日志 (PRD Part 1 §3.2)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE credit_control_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID          NOT NULL REFERENCES companies(id),
    customer_id   UUID          NOT NULL REFERENCES customers(id),
    action        VARCHAR(50)   NOT NULL,
    details       TEXT,
    amount        DECIMAL(18,2),
    approved_by   UUID,         -- References auth.users
    approved_at   TIMESTAMPTZ,
    reason        TEXT,
    created_by    UUID,         -- References auth.users
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ccl_company  ON credit_control_logs(company_id);
CREATE INDEX idx_ccl_customer ON credit_control_logs(customer_id);
CREATE INDEX idx_ccl_action   ON credit_control_logs(action);
CREATE INDEX idx_ccl_date     ON credit_control_logs(created_at);

COMMENT ON TABLE credit_control_logs IS '信用控制操作日志。记录信用额度豁免、评级变更、自动挂起等操作 (BR-CM-001 ~ BR-CM-004)。';
COMMENT ON COLUMN credit_control_logs.action IS '操作类型: Credit Override / Rating Change / Limit Adjustment / Auto Hold / Manual Block / Manual Unblock 等。';

-- ────────────────────────────────────────────────────────────────────────────
-- 5.3 report_audit_logs — 报表生成审计日志 (PRD Part 4 §6.2)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE report_audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID        NOT NULL REFERENCES companies(id),
    report_type   VARCHAR(50) NOT NULL,
    parameters    JSONB,       -- 报表参数快照 (日期范围、客户筛选条件等)
    generated_by  UUID,        -- References auth.users
    generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    export_format VARCHAR(10), -- PDF / Excel / CSV
    sent_to       VARCHAR(500) -- 邮件发送地址（如有）
);

CREATE INDEX idx_ral_company ON report_audit_logs(company_id);
CREATE INDEX idx_ral_type    ON report_audit_logs(report_type);
CREATE INDEX idx_ral_date    ON report_audit_logs(generated_at);

COMMENT ON TABLE report_audit_logs IS '报表生成审计日志。每次报表生成/导出/发送都记录 (PRD Part 4 §6.2)。';


-- ============================================================================
-- SECTION 6: TABLE SUMMARY
-- ============================================================================
-- Total tables created: 23
--
-- Base Config (10):
--   companies, gl_accounts, bank_accounts, fiscal_periods, payment_terms,
--   tax_codes, customer_groups, exchange_rates, aging_buckets,
--   ar_system_config
--
-- Product (1):
--   products
--
-- Sequence (1):
--   document_sequences
--
-- Customer (2):
--   customers, customer_bank_details
--
-- Transaction (4):
--   invoices, invoice_lines, receipts, allocation_details, cn_allocations
--
-- Journal (2):
--   journal_entries, journal_entry_lines
--
-- Audit (3):
--   customer_change_logs, credit_control_logs, report_audit_logs
-- ============================================================================
