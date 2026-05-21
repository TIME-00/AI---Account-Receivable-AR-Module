-- ============================================================================
-- TSH Synergy ERP — Accounts Receivable Module
-- Database Schema: 002_create_views.sql
-- Target: PostgreSQL 15+ (Supabase)
-- Version: 1.0
-- Date: 2026-03-29
-- ============================================================================
-- EXECUTION ORDER: Run AFTER 001_create_tables.sql
-- ============================================================================


-- ============================================================================
-- SECTION 1: UTILITY FUNCTIONS
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1.1 get_next_sequence() — 单据编号生成函数
-- ────────────────────────────────────────────────────────────────────────────
-- 原子性递增序列号并返回格式化编号。
-- 用法: SELECT get_next_sequence('company-uuid', 'INV');
-- 返回: 'INV-202603-00001'
--
-- 客户编号特殊格式: 'CUST-00001' (无月份)
-- 会计凭证格式: 'JE-INV-202603-00001' (含 source_type)

CREATE OR REPLACE FUNCTION get_next_sequence(
    p_company_id UUID,
    p_doc_type   VARCHAR(10),
    p_source_type VARCHAR(3) DEFAULT NULL  -- 仅用于 JE 类型
)
RETURNS VARCHAR(30)
LANGUAGE plpgsql
AS $$
DECLARE
    v_year   INT := EXTRACT(YEAR FROM CURRENT_DATE);
    v_month  INT := EXTRACT(MONTH FROM CURRENT_DATE);
    v_seq    INT;
    v_prefix VARCHAR(10);
    v_result VARCHAR(30);
BEGIN
    -- 尝试更新现有序列记录
    UPDATE document_sequences
    SET last_sequence = last_sequence + 1,
        updated_at = NOW()
    WHERE company_id = p_company_id
      AND doc_type = p_doc_type
      AND current_year = v_year
      AND current_month = v_month
    RETURNING last_sequence, prefix INTO v_seq, v_prefix;

    -- 如果没有找到记录（新月份），创建新记录
    IF NOT FOUND THEN
        -- 确定前缀
        SELECT CASE p_doc_type
            WHEN 'CUST' THEN 'CUST-'
            WHEN 'INV'  THEN 'INV-'
            WHEN 'CN'   THEN 'CN-'
            WHEN 'DN'   THEN 'DN-'
            WHEN 'RCT'  THEN 'RCT-'
            WHEN 'JE'   THEN 'JE-'
            ELSE p_doc_type || '-'
        END INTO v_prefix;

        INSERT INTO document_sequences (company_id, doc_type, prefix, current_year, current_month, last_sequence)
        VALUES (p_company_id, p_doc_type, v_prefix, v_year, v_month, 1)
        ON CONFLICT (company_id, doc_type, current_year, current_month)
        DO UPDATE SET last_sequence = document_sequences.last_sequence + 1, updated_at = NOW()
        RETURNING last_sequence INTO v_seq;
    END IF;

    -- 格式化编号
    IF p_doc_type = 'CUST' THEN
        -- 客户编号: CUST-NNNNN (全局递增，不按月重置)
        -- 需要获取全局最大序列号
        SELECT COALESCE(MAX(last_sequence), 0)
        INTO v_seq
        FROM document_sequences
        WHERE company_id = p_company_id
          AND doc_type = 'CUST';
        v_result := 'CUST-' || LPAD(v_seq::TEXT, 5, '0');
    ELSIF p_doc_type = 'JE' AND p_source_type IS NOT NULL THEN
        -- 会计凭证: JE-{source}-YYYYMM-NNNNN
        v_result := 'JE-' || p_source_type || '-'
                    || v_year::TEXT
                    || LPAD(v_month::TEXT, 2, '0') || '-'
                    || LPAD(v_seq::TEXT, 5, '0');
    ELSE
        -- 标准格式: {PREFIX}YYYYMM-NNNNN
        v_result := v_prefix
                    || v_year::TEXT
                    || LPAD(v_month::TEXT, 2, '0') || '-'
                    || LPAD(v_seq::TEXT, 5, '0');
    END IF;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_next_sequence(UUID, VARCHAR, VARCHAR) IS
'原子性单据编号生成函数。线程安全（利用 UPDATE ... RETURNING 行锁）。
CUST => CUST-00001; INV => INV-202603-00001; JE+INV => JE-INV-202603-00001';

-- ────────────────────────────────────────────────────────────────────────────
-- 1.2 calculate_due_date() — 到期日计算函数
-- ────────────────────────────────────────────────────────────────────────────
-- 根据账期类型和发票日期计算到期日 (PRD Part 1 §4.2)

CREATE OR REPLACE FUNCTION calculate_due_date(
    p_invoice_date DATE,
    p_term_type    VARCHAR(20),
    p_days         INT
)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    CASE p_term_type
        WHEN 'Fixed Days' THEN
            -- NET7, NET30, NET60 等
            RETURN p_invoice_date + p_days;

        WHEN 'End of Month' THEN
            IF p_days IS NULL OR p_days = 0 THEN
                -- EOM: 当月最后一天
                RETURN (DATE_TRUNC('MONTH', p_invoice_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
            ELSE
                -- EOM+N: 当月最后一天 + N 天
                RETURN (DATE_TRUNC('MONTH', p_invoice_date) + INTERVAL '1 month' - INTERVAL '1 day')::DATE + p_days;
            END IF;

        WHEN 'COD' THEN
            -- Cash on Delivery: 到期日 = 发票日
            RETURN p_invoice_date;

        WHEN 'Prepaid' THEN
            -- 预付: 到期日 = NULL
            RETURN NULL;

        WHEN 'Custom' THEN
            -- 自定义: 默认按 Fixed Days 处理
            RETURN p_invoice_date + COALESCE(p_days, 0);

        ELSE
            RETURN p_invoice_date + COALESCE(p_days, 30);
    END CASE;
END;
$$;

COMMENT ON FUNCTION calculate_due_date(DATE, VARCHAR, INT) IS
'到期日计算函数。按日历日计算，不排除周末/假日 (BR-PT-003)。
支持: Fixed Days, End of Month, COD, Prepaid, Custom。';

-- ────────────────────────────────────────────────────────────────────────────
-- 1.3 get_effective_tax_rate() — 获取生效税率
-- ────────────────────────────────────────────────────────────────────────────
-- 根据税码和发票日期查找适用税率 (BR-TAX-003)

CREATE OR REPLACE FUNCTION get_effective_tax_rate(
    p_company_id   UUID,
    p_tax_code     VARCHAR(10),
    p_invoice_date DATE
)
RETURNS DECIMAL(5,2)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_rate DECIMAL(5,2);
BEGIN
    SELECT rate INTO v_rate
    FROM tax_codes
    WHERE company_id = p_company_id
      AND tax_code = p_tax_code
      AND effective_from <= p_invoice_date
      AND (effective_to IS NULL OR effective_to >= p_invoice_date)
      AND is_active = TRUE
    ORDER BY effective_from DESC
    LIMIT 1;

    IF v_rate IS NULL THEN
        RAISE EXCEPTION 'Tax code % not found or not effective on %', p_tax_code, p_invoice_date;
    END IF;

    RETURN v_rate;
END;
$$;

COMMENT ON FUNCTION get_effective_tax_rate(UUID, VARCHAR, DATE) IS
'获取指定日期的生效税率。同一税码有多条有效记录时取 effective_from 最近的一条 (BR-TAX-003)。';


-- ============================================================================
-- SECTION 2: VIEWS
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 2.1 v_customer_credit_utilization — 客户信用使用率实时视图
-- ────────────────────────────────────────────────────────────────────────────
-- 实现 BR-CUS-005 和 BR-CM-005: 不持久化存储，实时计算
-- credit_utilization = 未结发票/DN - 未核销收款 - 未使用CN余额

CREATE OR REPLACE VIEW v_customer_credit_utilization AS
SELECT
    c.id,
    c.company_id,
    c.customer_id,
    c.customer_name,
    c.short_name,
    c.customer_type,
    c.status,
    c.credit_limit,
    c.credit_rating,
    c.default_currency,

    -- 未结发票和 Debit Note 总额
    COALESCE(inv_dn.total_outstanding, 0.00) AS total_outstanding,

    -- 未核销收款余额
    COALESCE(rct.total_unallocated, 0.00) AS total_unallocated_receipts,

    -- 未使用 Credit Note 余额
    COALESCE(cn.total_unused_cn, 0.00) AS total_unused_cn,

    -- 信用使用率 (BR-CM-005)
    GREATEST(
        COALESCE(inv_dn.total_outstanding, 0.00)
        - COALESCE(rct.total_unallocated, 0.00)
        - COALESCE(cn.total_unused_cn, 0.00),
        0.00
    ) AS credit_utilization,

    -- 可用信用余额
    c.credit_limit - GREATEST(
        COALESCE(inv_dn.total_outstanding, 0.00)
        - COALESCE(rct.total_unallocated, 0.00)
        - COALESCE(cn.total_unused_cn, 0.00),
        0.00
    ) AS available_credit

FROM customers c

-- 子查询: 所有 Open/Overdue/Partially Paid 的 Invoice + Debit Note
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(i.outstanding), 0.00) AS total_outstanding
    FROM invoices i
    WHERE i.customer_id = c.id
      AND i.doc_type IN ('Invoice', 'Debit Note')
      AND i.status IN ('Open', 'Overdue', 'Partially Paid')
) inv_dn ON TRUE

-- 子查询: 所有已过账但有未核销余额的收款
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(r.unallocated_amount), 0.00) AS total_unallocated
    FROM receipts r
    WHERE r.customer_id = c.id
      AND r.status IN ('Posted', 'Fully Allocated')
      AND r.unallocated_amount > 0
) rct ON TRUE

-- 子查询: 所有已过账但有剩余额度的 Credit Note
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(i.outstanding), 0.00) AS total_unused_cn
    FROM invoices i
    WHERE i.customer_id = c.id
      AND i.doc_type = 'Credit Note'
      AND i.status IN ('Open', 'Partially Paid')
      AND i.outstanding > 0
) cn ON TRUE

WHERE c.is_deleted = FALSE;

COMMENT ON VIEW v_customer_credit_utilization IS
'客户信用使用率实时视图 (BR-CUS-005, BR-CM-005)。
credit_utilization = 未结发票/DN - 未核销收款 - 未使用CN。
用于发票过账信用检查 (BR-CM-001) 和客户概览展示。';

-- ────────────────────────────────────────────────────────────────────────────
-- 2.2 v_invoice_aging — 发票账龄分析视图
-- ────────────────────────────────────────────────────────────────────────────
-- 实现 PRD Part 4 §2: 基于到期日 (due_date) 计算账龄

CREATE OR REPLACE VIEW v_invoice_aging AS
SELECT
    i.id,
    i.company_id,
    i.invoice_no,
    i.doc_type,
    i.invoice_date,
    i.due_date,
    i.customer_id,
    c.customer_id AS customer_code,
    i.customer_name,
    c.customer_type,
    c.customer_group_id,
    i.currency,
    i.exchange_rate,
    i.total_amount,
    i.outstanding,
    i.status,

    -- 账龄天数: 以到期日为基准 (BR-AG-002)
    -- 使用 CURRENT_DATE 作为报表日期（实际报表可传参覆盖）
    CASE
        WHEN i.due_date IS NULL THEN 0  -- PREPAID 类型
        ELSE (CURRENT_DATE - i.due_date)
    END AS aging_days,

    -- 本位币未结金额
    ROUND(i.outstanding * i.exchange_rate, 2) AS outstanding_base,

    -- 默认账龄桶分类 (BR-AG-002)
    CASE
        WHEN i.due_date IS NULL OR (CURRENT_DATE - i.due_date) <= 0
            THEN 'Current'
        WHEN (CURRENT_DATE - i.due_date) BETWEEN 1 AND 30
            THEN '1-30 Days'
        WHEN (CURRENT_DATE - i.due_date) BETWEEN 31 AND 60
            THEN '31-60 Days'
        WHEN (CURRENT_DATE - i.due_date) BETWEEN 61 AND 90
            THEN '61-90 Days'
        ELSE '90+ Days'
    END AS aging_bucket,

    -- 桶序号（用于排序）
    CASE
        WHEN i.due_date IS NULL OR (CURRENT_DATE - i.due_date) <= 0 THEN 0
        WHEN (CURRENT_DATE - i.due_date) BETWEEN 1 AND 30  THEN 1
        WHEN (CURRENT_DATE - i.due_date) BETWEEN 31 AND 60 THEN 2
        WHEN (CURRENT_DATE - i.due_date) BETWEEN 61 AND 90 THEN 3
        ELSE 4
    END AS bucket_no

FROM invoices i
JOIN customers c ON i.customer_id = c.id
WHERE i.status IN ('Open', 'Overdue', 'Partially Paid')
  AND i.outstanding > 0
  AND i.doc_type IN ('Invoice', 'Debit Note');

COMMENT ON VIEW v_invoice_aging IS
'发票账龄分析视图 (PRD Part 4 §2)。基于到期日计算账龄 (BR-AG-002)。
使用 CURRENT_DATE 实时计算。报表可通过函数传入截止日期。';

-- ────────────────────────────────────────────────────────────────────────────
-- 2.3 v_customer_aging_summary — 客户维度账龄汇总视图
-- ────────────────────────────────────────────────────────────────────────────
-- 实现 PRD Part 4 §2.4.1: 按客户汇总的账龄报表

CREATE OR REPLACE VIEW v_customer_aging_summary AS
SELECT
    a.company_id,
    a.customer_id,
    a.customer_code,
    a.customer_name,
    a.currency,

    SUM(CASE WHEN a.bucket_no = 0 THEN a.outstanding_base ELSE 0 END) AS current_amt,
    SUM(CASE WHEN a.bucket_no = 1 THEN a.outstanding_base ELSE 0 END) AS bucket_1_30,
    SUM(CASE WHEN a.bucket_no = 2 THEN a.outstanding_base ELSE 0 END) AS bucket_31_60,
    SUM(CASE WHEN a.bucket_no = 3 THEN a.outstanding_base ELSE 0 END) AS bucket_61_90,
    SUM(CASE WHEN a.bucket_no = 4 THEN a.outstanding_base ELSE 0 END) AS bucket_90_plus,
    SUM(a.outstanding_base) AS total_outstanding,

    COUNT(*) AS invoice_count

FROM v_invoice_aging a
GROUP BY a.company_id, a.customer_id, a.customer_code, a.customer_name, a.currency;

COMMENT ON VIEW v_customer_aging_summary IS
'客户维度账龄汇总视图 (PRD Part 4 §2.4.1)。Pivot 为 Current/1-30/31-60/61-90/90+ 五列。';

-- ────────────────────────────────────────────────────────────────────────────
-- 2.4 v_customer_ar_summary — 客户 AR 财务摘要视图
-- ────────────────────────────────────────────────────────────────────────────
-- 实现 PRD Part 3 §6.3 (BR-OP-003): 客户财务摘要

CREATE OR REPLACE VIEW v_customer_ar_summary AS
SELECT
    c.id,
    c.company_id,
    c.customer_id,
    c.customer_name,
    c.default_currency,
    c.credit_limit,
    c.credit_rating,

    -- 总应收余额 (Invoice + DN)
    COALESCE(inv.total_outstanding, 0.00) AS total_ar_balance,

    -- 逾期应收余额
    COALESCE(inv.overdue_outstanding, 0.00) AS overdue_ar_balance,

    -- 预收款/贷方余额 (未核销收款 + 未使用CN)
    COALESCE(rct.total_unallocated, 0.00) + COALESCE(cn.total_unused_cn, 0.00)
        AS credit_balance,

    -- 信用使用率
    GREATEST(
        COALESCE(inv.total_outstanding, 0.00)
        - COALESCE(rct.total_unallocated, 0.00)
        - COALESCE(cn.total_unused_cn, 0.00),
        0.00
    ) AS credit_utilization,

    -- 信用使用率百分比
    CASE
        WHEN c.credit_limit > 0 THEN
            ROUND(
                GREATEST(
                    COALESCE(inv.total_outstanding, 0.00)
                    - COALESCE(rct.total_unallocated, 0.00)
                    - COALESCE(cn.total_unused_cn, 0.00),
                    0.00
                ) / c.credit_limit * 100,
                1
            )
        ELSE 0
    END AS credit_utilization_pct,

    -- 可用信用余额
    c.credit_limit - GREATEST(
        COALESCE(inv.total_outstanding, 0.00)
        - COALESCE(rct.total_unallocated, 0.00)
        - COALESCE(cn.total_unused_cn, 0.00),
        0.00
    ) AS available_credit,

    -- 未结发票笔数
    COALESCE(inv.open_invoice_count, 0) AS open_invoice_count,

    -- 逾期发票笔数
    COALESCE(inv.overdue_invoice_count, 0) AS overdue_invoice_count

FROM customers c

LEFT JOIN LATERAL (
    SELECT
        COALESCE(SUM(i.outstanding), 0.00) AS total_outstanding,
        COALESCE(SUM(CASE WHEN i.status = 'Overdue' THEN i.outstanding ELSE 0 END), 0.00) AS overdue_outstanding,
        COUNT(*) FILTER (WHERE i.status IN ('Open', 'Overdue', 'Partially Paid')) AS open_invoice_count,
        COUNT(*) FILTER (WHERE i.status = 'Overdue') AS overdue_invoice_count
    FROM invoices i
    WHERE i.customer_id = c.id
      AND i.doc_type IN ('Invoice', 'Debit Note')
      AND i.status IN ('Open', 'Overdue', 'Partially Paid')
) inv ON TRUE

LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(r.unallocated_amount), 0.00) AS total_unallocated
    FROM receipts r
    WHERE r.customer_id = c.id
      AND r.status IN ('Posted', 'Fully Allocated')
      AND r.unallocated_amount > 0
) rct ON TRUE

LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(i.outstanding), 0.00) AS total_unused_cn
    FROM invoices i
    WHERE i.customer_id = c.id
      AND i.doc_type = 'Credit Note'
      AND i.status IN ('Open', 'Partially Paid')
      AND i.outstanding > 0
) cn ON TRUE

WHERE c.is_deleted = FALSE;

COMMENT ON VIEW v_customer_ar_summary IS
'客户 AR 财务摘要视图。包含总应收、逾期应收、信用使用率、可用信用余额等关键指标 (BR-OP-003)。';

-- ────────────────────────────────────────────────────────────────────────────
-- 2.5 v_receipt_summary — 收款状态汇总视图
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_receipt_summary AS
SELECT
    r.id,
    r.company_id,
    r.receipt_no,
    r.receipt_date,
    r.value_date,
    r.customer_id,
    c.customer_id AS customer_code,
    r.customer_name,
    r.payment_method,
    r.currency,
    r.receipt_amount,
    r.allocated_amount,
    r.unallocated_amount,
    r.status,
    r.reference_no,
    r.cheque_date,
    r.posting_period,

    -- 核销笔数
    COALESCE(alloc.allocation_count, 0) AS allocation_count,

    -- 是否为预收款 (BR-OP-001)
    CASE
        WHEN r.status IN ('Posted', 'Fully Allocated')
             AND r.unallocated_amount > 0
        THEN TRUE
        ELSE FALSE
    END AS has_advance_balance

FROM receipts r
JOIN customers c ON r.customer_id = c.id
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS allocation_count
    FROM allocation_details ad
    WHERE ad.receipt_id = r.id
      AND ad.status = 'Active'
) alloc ON TRUE;

COMMENT ON VIEW v_receipt_summary IS
'收款汇总视图。包含核销笔数和预收款标识。';


-- ============================================================================
-- SECTION 3: REPORTING FUNCTIONS
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 3.1 fn_aging_report() — 账龄报表函数（支持自定义截止日期）
-- ────────────────────────────────────────────────────────────────────────────
-- 视图使用 CURRENT_DATE，此函数支持传入任意截止日期

CREATE OR REPLACE FUNCTION fn_aging_report(
    p_company_id  UUID,
    p_report_date DATE DEFAULT CURRENT_DATE,
    p_customer_id UUID DEFAULT NULL   -- NULL = 所有客户
)
RETURNS TABLE (
    customer_uuid     UUID,
    customer_code     VARCHAR,
    customer_name     VARCHAR,
    currency          CHAR(3),
    current_amt       DECIMAL(18,2),
    bucket_1_30       DECIMAL(18,2),
    bucket_31_60      DECIMAL(18,2),
    bucket_61_90      DECIMAL(18,2),
    bucket_90_plus    DECIMAL(18,2),
    total_outstanding DECIMAL(18,2)
)
LANGUAGE sql
STABLE
AS $$
    WITH aging_data AS (
        SELECT
            i.customer_id,
            c.customer_id AS cust_code,
            i.customer_name AS cust_name,
            i.currency AS curr,
            i.outstanding,
            ROUND(i.outstanding * i.exchange_rate, 2) AS outstanding_base,
            CASE
                WHEN i.due_date IS NULL OR (p_report_date - i.due_date) <= 0 THEN 0
                WHEN (p_report_date - i.due_date) BETWEEN 1 AND 30  THEN 1
                WHEN (p_report_date - i.due_date) BETWEEN 31 AND 60 THEN 2
                WHEN (p_report_date - i.due_date) BETWEEN 61 AND 90 THEN 3
                ELSE 4
            END AS bucket_no
        FROM invoices i
        JOIN customers c ON i.customer_id = c.id
        WHERE i.company_id = p_company_id
          AND i.status IN ('Open', 'Overdue', 'Partially Paid')
          AND i.outstanding > 0
          AND i.doc_type IN ('Invoice', 'Debit Note')
          AND i.invoice_date <= p_report_date
          AND (p_customer_id IS NULL OR i.customer_id = p_customer_id)
    )
    SELECT
        ad.customer_id,
        ad.cust_code,
        ad.cust_name,
        ad.curr,
        SUM(CASE WHEN ad.bucket_no = 0 THEN ad.outstanding_base ELSE 0 END),
        SUM(CASE WHEN ad.bucket_no = 1 THEN ad.outstanding_base ELSE 0 END),
        SUM(CASE WHEN ad.bucket_no = 2 THEN ad.outstanding_base ELSE 0 END),
        SUM(CASE WHEN ad.bucket_no = 3 THEN ad.outstanding_base ELSE 0 END),
        SUM(CASE WHEN ad.bucket_no = 4 THEN ad.outstanding_base ELSE 0 END),
        SUM(ad.outstanding_base)
    FROM aging_data ad
    GROUP BY ad.customer_id, ad.cust_code, ad.cust_name, ad.curr
    ORDER BY SUM(ad.outstanding_base) DESC;
$$;

COMMENT ON FUNCTION fn_aging_report(UUID, DATE, UUID) IS
'账龄报表函数。支持自定义截止日期和客户筛选 (PRD Part 4 §2.3)。
返回按客户汇总的 Current/1-30/31-60/61-90/90+ 账龄分布。';

-- ────────────────────────────────────────────────────────────────────────────
-- 3.2 fn_customer_statement_activity() — 客户对账单（Activity 类型）
-- ────────────────────────────────────────────────────────────────────────────
-- 实现 PRD Part 4 §3: Activity Report 类型对账单

CREATE OR REPLACE FUNCTION fn_customer_statement_activity(
    p_company_id   UUID,
    p_customer_id  UUID,
    p_period_start DATE,
    p_period_end   DATE,
    p_currency     CHAR(3) DEFAULT NULL  -- NULL = 所有币种
)
RETURNS TABLE (
    transaction_date DATE,
    doc_no           VARCHAR,
    doc_type         VARCHAR,
    reference_no     VARCHAR,
    description      TEXT,
    due_date         DATE,
    debit_amount     DECIMAL(18,2),
    credit_amount    DECIMAL(18,2),
    running_balance  DECIMAL(18,2)
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_opening_balance DECIMAL(18,2);
BEGIN
    -- 计算期初余额 (BR-ST-001)
    SELECT
        COALESCE(SUM(
            CASE
                WHEN i.doc_type IN ('Invoice', 'Debit Note') THEN i.outstanding
                WHEN i.doc_type = 'Credit Note' THEN -i.outstanding
            END
        ), 0)
    INTO v_opening_balance
    FROM invoices i
    WHERE i.customer_id = p_customer_id
      AND i.company_id = p_company_id
      AND i.status NOT IN ('Draft', 'Cancelled')
      AND i.invoice_date < p_period_start
      AND i.outstanding > 0
      AND (p_currency IS NULL OR i.currency = p_currency);

    -- 扣除期初已有的未核销收款
    v_opening_balance := v_opening_balance - COALESCE((
        SELECT SUM(r.unallocated_amount)
        FROM receipts r
        WHERE r.customer_id = p_customer_id
          AND r.company_id = p_company_id
          AND r.status IN ('Posted', 'Fully Allocated')
          AND r.receipt_date < p_period_start
          AND r.unallocated_amount > 0
          AND (p_currency IS NULL OR r.currency = p_currency)
    ), 0);

    RETURN QUERY
    WITH transactions AS (
        -- 发票 / Debit Note (借方)
        SELECT
            i.invoice_date AS txn_date,
            i.invoice_no AS txn_doc_no,
            i.doc_type::VARCHAR AS txn_doc_type,
            i.reference_no AS txn_ref,
            ('Invoice: ' || COALESCE(i.invoice_remarks, ''))::TEXT AS txn_desc,
            i.due_date AS txn_due_date,
            i.total_amount AS txn_debit,
            0.00::DECIMAL(18,2) AS txn_credit,
            1 AS sort_priority
        FROM invoices i
        WHERE i.customer_id = p_customer_id
          AND i.company_id = p_company_id
          AND i.doc_type IN ('Invoice', 'Debit Note')
          AND i.status NOT IN ('Draft', 'Cancelled')
          AND i.invoice_date BETWEEN p_period_start AND p_period_end
          AND (p_currency IS NULL OR i.currency = p_currency)

        UNION ALL

        -- Credit Note (贷方)
        SELECT
            i.invoice_date,
            i.invoice_no,
            i.doc_type::VARCHAR,
            i.reference_no,
            ('Credit Note: ' || COALESCE(i.reason_desc, i.reason_code::TEXT, ''))::TEXT,
            NULL,
            0.00,
            i.total_amount,
            3
        FROM invoices i
        WHERE i.customer_id = p_customer_id
          AND i.company_id = p_company_id
          AND i.doc_type = 'Credit Note'
          AND i.status NOT IN ('Draft', 'Cancelled')
          AND i.invoice_date BETWEEN p_period_start AND p_period_end
          AND (p_currency IS NULL OR i.currency = p_currency)

        UNION ALL

        -- 收款 (贷方)
        SELECT
            r.receipt_date,
            r.receipt_no,
            'Receipt'::VARCHAR,
            r.reference_no,
            ('Payment: ' || r.payment_method || ' ' || COALESCE(r.reference_no, ''))::TEXT,
            NULL,
            0.00,
            r.receipt_amount,
            4
        FROM receipts r
        WHERE r.customer_id = p_customer_id
          AND r.company_id = p_company_id
          AND r.status IN ('Posted', 'Fully Allocated')
          AND r.receipt_date BETWEEN p_period_start AND p_period_end
          AND (p_currency IS NULL OR r.currency = p_currency)
    ),
    ordered_txns AS (
        SELECT
            t.*,
            SUM(t.txn_debit - t.txn_credit)
                OVER (ORDER BY t.txn_date, t.sort_priority, t.txn_doc_no
                      ROWS UNBOUNDED PRECEDING)
                + v_opening_balance AS balance
        FROM transactions t
    )
    SELECT
        ot.txn_date,
        ot.txn_doc_no,
        ot.txn_doc_type,
        ot.txn_ref,
        ot.txn_desc,
        ot.txn_due_date,
        ot.txn_debit,
        ot.txn_credit,
        ot.balance
    FROM ordered_txns ot
    ORDER BY ot.txn_date, ot.sort_priority, ot.txn_doc_no;
END;
$$;

COMMENT ON FUNCTION fn_customer_statement_activity(UUID, UUID, DATE, DATE, CHAR) IS
'客户对账单函数 (Activity 类型)。返回指定期间的全部交易活动及滚动余额 (PRD Part 4 §3)。
排序规则: 日期 → 凭证类型优先级 → 凭证号 (BR-ST-003)。';
