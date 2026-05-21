# TSH Synergy — AR 模块功能规格书
# 第四部分：账龄分析与报表 (Aging & Reporting)

| 项目         | 详情                                      |
|-------------|------------------------------------------|
| **文档编号** | PRD-AR-004                               |
| **版本**     | v1.0 Draft                               |
| **日期**     | 2026-03-29                               |
| **关联文档** | PRD-AR-001 ~ PRD-AR-003                  |

---

## 1. 模块概述

账龄分析与报表模块为管理层、信用管理团队和审计师提供关键的应收账款可视化数据。它包括：
- **账龄分析报表 (Aging Report)**：按时间桶分析未结应收的逾期分布
- **客户对账单 (Customer Statement)**：面向客户的交易对账文件
- **AR 汇总报表 (AR Summary)**：总览所有客户应收状况
- **收款分析报表 (Collection Analysis)**：分析收款效率和趋势

### 1.1 设计原则

1. **数据实时性**：所有报表基于 **实时数据** 或 **截至指定日期的快照数据** 生成。
2. **灵活性**：报表支持多维度筛选（客户、客户组、币种、日期范围等）。
3. **可导出性**：所有报表支持 PDF、Excel、CSV 格式导出。
4. **可审计性**：报表数据可追溯至源头凭证。

---

## 2. 账龄分析报表 (Aging Analysis Report)

### 2.1 账龄桶定义

#### 2.1.1 默认账龄桶配置

| 桶序号 | 桶名称              | 天数范围                          | 颜色标识   | 风险级别 |
|-------|--------------------|---------------------------------|-----------|---------|
| 0     | Current (未到期)    | `Aging Days ≤ 0`（即未逾期）       | 🟢 绿色   | 低      |
| 1     | 1-30 Days          | `1 ≤ Aging Days ≤ 30`            | 🟡 黄色   | 关注    |
| 2     | 31-60 Days         | `31 ≤ Aging Days ≤ 60`           | 🟠 橙色   | 中      |
| 3     | 61-90 Days         | `61 ≤ Aging Days ≤ 90`           | 🔴 红色   | 高      |
| 4     | 90+ Days           | `Aging Days > 90`                | ⚫ 深红    | 极高    |

#### 2.1.2 自定义账龄桶

> **BR-AG-001 — 账龄桶可配置**
> System Admin 可在 AR 模块设置中自定义账龄桶：
>
> | 配置字段         | 数据类型 | 说明                              |
> |-----------------|---------|----------------------------------|
> | `bucket_no`     | INT     | 桶序号（0-9）                      |
> | `bucket_name`   | VARCHAR | 显示名称                           |
> | `from_days`     | INT     | 起始天数（含）                      |
> | `to_days`       | INT     | 结束天数（含），最后一桶为 NULL（无上限）|
>
> **示例 — 细粒度账龄桶配置（审计场景）**：
>
> | 桶 | 名称       | 范围        |
> |---|-----------|-------------|
> | 0 | Current   | 未逾期       |
> | 1 | 1-15 Days | 1-15 天      |
> | 2 | 16-30 Days| 16-30 天     |
> | 3 | 31-45 Days| 31-45 天     |
> | 4 | 46-60 Days| 46-60 天     |
> | 5 | 61-90 Days| 61-90 天     |
> | 6 | 91-120 Days| 91-120 天   |
> | 7 | 120+ Days | > 120 天     |

### 2.2 账龄计算逻辑

> **BR-AG-002 — 计算基准：到期日 (Due Date)**
> ```
> Aging Days = Report_Date - Invoice.due_date
>
> 如果 Aging Days ≤ 0：归入 "Current"（未到期）
> 如果 Aging Days > 0：按天数归入对应的逾期桶
> ```
>
> **为什么基于到期日而非发票日期？**
> - 到期日反映了客户的 **付款义务起始点**
> - 同一天开具的两张发票可能有不同的账期（NET30 vs NET60），逾期风险不同
> - 基于到期日的账龄更准确地反映 **实际信用风险**

> **BR-AG-003 — 参与账龄的凭证范围**
> | 凭证类型        | 状态                              | 是否参与 | 使用金额           |
> |----------------|----------------------------------|---------|-------------------|
> | Invoice        | Open / Overdue / Partially Paid  | ✅ 是   | outstanding        |
> | Invoice        | Draft / Paid / Cancelled         | ❌ 否   | —                  |
> | Debit Note     | Open / Overdue / Partially Paid  | ✅ 是   | outstanding        |
> | Credit Note    | 未使用余额                        | ✅ 是*  | 未抵扣金额（负数显示）|
> | Receipt        | 未核销余额                        | ✅ 是*  | unallocated（负数） |
>
> *Credit Note 和 Receipt 的未核销余额以 **负数** 显示在 "Current" 桶中，表示客户的贷方余额。

> **BR-AG-004 — 部分核销发票的账龄处理**
> ```
> 示例：
>   INV-001: total = RM 10,000, outstanding = RM 3,000, due_date = 2026-02-14
>   Report Date = 2026-03-29
>   Aging Days = 43 天
>
>   → RM 3,000 归入 "31-60 Days" 桶
>   （使用 outstanding 金额，非原始 total_amount）
> ```

### 2.3 账龄报表 SQL 查询逻辑

```sql
-- 账龄分析报表核心查询
WITH aging_data AS (
    SELECT
        i.customer_id,
        c.customer_name,
        i.invoice_no,
        i.doc_type,
        i.invoice_date,
        i.due_date,
        i.currency,
        i.outstanding,
        i.outstanding * i.exchange_rate AS outstanding_base,
        DATEDIFF(DAY, i.due_date, :report_date) AS aging_days,
        CASE
            WHEN DATEDIFF(DAY, i.due_date, :report_date) <= 0 THEN 'Current'
            WHEN DATEDIFF(DAY, i.due_date, :report_date) BETWEEN 1 AND 30 THEN '1-30'
            WHEN DATEDIFF(DAY, i.due_date, :report_date) BETWEEN 31 AND 60 THEN '31-60'
            WHEN DATEDIFF(DAY, i.due_date, :report_date) BETWEEN 61 AND 90 THEN '61-90'
            ELSE '90+'
        END AS aging_bucket
    FROM invoices i
    JOIN customers c ON i.customer_id = c.customer_id
    WHERE i.status IN ('Open', 'Overdue', 'Partially Paid')
      AND i.outstanding > 0
      AND i.invoice_date <= :report_date  -- 仅包含报表日期之前的发票
)
SELECT
    customer_id,
    customer_name,
    SUM(CASE WHEN aging_bucket = 'Current' THEN outstanding_base ELSE 0 END) AS current_amt,
    SUM(CASE WHEN aging_bucket = '1-30'    THEN outstanding_base ELSE 0 END) AS bucket_1_30,
    SUM(CASE WHEN aging_bucket = '31-60'   THEN outstanding_base ELSE 0 END) AS bucket_31_60,
    SUM(CASE WHEN aging_bucket = '61-90'   THEN outstanding_base ELSE 0 END) AS bucket_61_90,
    SUM(CASE WHEN aging_bucket = '90+'     THEN outstanding_base ELSE 0 END) AS bucket_90_plus,
    SUM(outstanding_base) AS total
FROM aging_data
GROUP BY customer_id, customer_name
ORDER BY total DESC;
```

### 2.4 账龄报表格式

#### 2.4.1 汇总视图（按客户）

```
┌──────────────────────────────────────────────────────────────────────────────┐
│          ACCOUNTS RECEIVABLE AGING REPORT — As at 2026-03-29                │
│          TSH Synergy Sdn Bhd                                                │
│          Currency: MYR (Base Currency)                                       │
├──────────┬──────────────┬──────────┬──────────┬──────────┬──────────┬────────┤
│ Customer │ Customer     │ Current  │ 1-30     │ 31-60    │ 61-90    │ 90+    │
│ ID       │ Name         │          │ Days     │ Days     │ Days     │ Days   │
├──────────┼──────────────┼──────────┼──────────┼──────────┼──────────┼────────┤
│ CUST-001 │ ABC Sdn Bhd  │ 15,000   │  5,000   │    —     │  2,000   │    —   │
│ CUST-002 │ XYZ Pte Ltd  │    —     │    —     │  8,000   │    —     │ 12,000 │
│ CUST-003 │ DEF Corp     │  3,000   │  7,500   │  4,200   │    —     │    —   │
├──────────┼──────────────┼──────────┼──────────┼──────────┼──────────┼────────┤
│ TOTAL    │              │ 18,000   │ 12,500   │ 12,200   │  2,000   │ 12,000 │
├──────────┴──────────────┴──────────┴──────────┴──────────┴──────────┴────────┤
│ Grand Total: RM 56,700.00                                                   │
│ Overdue Amount: RM 38,700.00 (68.3% of total)                              │
│ Overdue > 90 Days: RM 12,000.00 (21.2% of total)                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### 2.4.2 明细视图（按发票）

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Customer: CUST-002 — XYZ Pte Ltd                                            │
├──────────────────┬──────────┬──────────┬──────────┬────────┬────────┬────────┤
│ Invoice No.      │ Inv Date │ Due Date │ Amount   │ Paid   │ O/S    │ Aging  │
├──────────────────┼──────────┼──────────┼──────────┼────────┼────────┼────────┤
│ INV-202601-00010 │ 01-10    │ 02-09    │ 12,000   │  0     │ 12,000 │ 48 d   │
│ INV-202602-00018 │ 02-15    │ 03-17    │  8,000   │  0     │  8,000 │ 12 d   │
├──────────────────┼──────────┼──────────┼──────────┼────────┼────────┼────────┤
│ Subtotal         │          │          │ 20,000   │  0     │ 20,000 │        │
└──────────────────┴──────────┴──────────┴──────────┴────────┴────────┴────────┘
```

### 2.5 报表筛选参数

| 参数               | 类型        | 必填 | 说明                                    |
|-------------------|------------|------|-----------------------------------------|
| Report Date       | DATE       | 是   | 报表截止日期（默认今天）                    |
| Customer ID       | FK (多选)   | 否   | 筛选特定客户，空=全部                      |
| Customer Group    | FK (多选)   | 否   | 按客户分组筛选                             |
| Currency          | ENUM       | 否   | 筛选币种，空=全部（以本位币汇总）            |
| Salesperson       | FK         | 否   | 按业务员筛选                               |
| Minimum Amount    | DECIMAL    | 否   | 最低金额门槛（过滤小额应收）                |
| Include CN/Advance| BOOLEAN    | 否   | 是否显示 Credit Note 和预收款余额（负数行）  |
| Aging Basis       | ENUM       | 否   | `Due Date`（默认）/ `Invoice Date`         |

---

## 3. 客户对账单 (Customer Statement)

### 3.1 对账单类型

| 类型              | 代码     | 说明                                                     |
|------------------|---------|----------------------------------------------------------|
| Open Item        | `OPEN`  | 仅列出截至对账日期的 **所有未结项目**                        |
| Activity Report  | `ACTIVITY`| 列出指定期间内的 **全部交易活动**（含已结清）                |
| Balance Forward  | `BALFWD`| 以期初余额开始，列出本期交易，计算期末余额                    |

### 3.2 对账单完整数据模型

#### 3.2.1 对账单头 (Statement Header)

| 字段                    | 说明                                    |
|------------------------|-----------------------------------------|
| Company Name & Address | 出具对账单的公司信息                       |
| Company Registration No| 公司注册号                                |
| Company SST/GST No.   | 税务登记号                                |
| Statement Type         | Open Item / Activity / Balance Forward  |
| Statement Date         | 对账单截止日期                             |
| Statement Period       | 起止日期（Activity 和 Balance Forward 类型）|
| Customer ID            | 客户编号                                  |
| Customer Name          | 客户全称                                  |
| Customer Address       | 客户账单地址                               |
| Currency               | 交易币种（多币种客户分币种出具）             |
| Page No.               | 页码                                     |

#### 3.2.2 对账单行项 (Statement Lines)

| 字段                         | 说明                                    |
|-----------------------------|-----------------------------------------|
| Transaction Date            | 交易日期                                 |
| Document No.                | 凭证编号（INV/CN/DN/RCT）                |
| Document Type               | Invoice / Credit Note / Debit Note / Receipt / Opening Balance |
| Reference No.               | 外部参考号                               |
| Description                 | 交易描述                                 |
| Due Date                    | 到期日（仅发票/DN）                       |
| Debit Amount (借方发生额)    | 增加应收（发票、DN）                       |
| Credit Amount (贷方发生额)   | 减少应收（收款、CN）                       |
| Running Balance (滚动余额)   | 每笔交易后的累计余额                       |
| Aging Status                | Current / 1-30 / 31-60 / 61-90 / 90+   |

### 3.3 对账单完整格式

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│                        TSH SYNERGY SDN BHD                               │
│                   (Company No. 123456-A)                                 │
│              Level 15, Menara TSH, Jalan Sultan Ismail                   │
│                    50250 Kuala Lumpur, Malaysia                           │
│                     SST No: W10-1234-56789012                            │
│                                                                          │
│ ──────────────────────────────────────────────────────────────────────── │
│                                                                          │
│                     CUSTOMER STATEMENT                                   │
│                   Statement Type: Activity                               │
│                                                                          │
│  To:                                    Statement Date: 2026-03-31       │
│  ABC SDN BHD (CUST-001)                Period: 2026-03-01 to 2026-03-31 │
│  No 88, Jalan Industri 5               Currency: MYR                    │
│  Taman Perindustrian                    Page: 1 of 1                     │
│  43300 Seri Kembangan                                                    │
│                                                                          │
│ ──────────────────────────────────────────────────────────────────────── │
│                                                                          │
│  Date    │ Doc No.          │ Type     │ Ref      │ Debit    │ Credit   │
│          │                  │          │          │          │          │
│  ─────── │ ──────────────── │ ──────── │ ──────── │ ──────── │ ──────── │
│          │                  │ B/F      │          │          │          │
│          │ Opening Balance  │          │          │          │          │
│  ─────── │ ──────────────── │ ──────── │ ──────── │ ──────── │ ──────── │
│  03-01   │ (Brought Fwd)    │ Opening  │          │          │          │
│          │                  │          │          │          │          │
│  03-05   │ INV-202603-00005 │ Invoice  │ PO-8812  │ 5,300.00 │          │
│  03-10   │ RCT-202603-00008 │ Receipt  │ TT-REF01 │          │ 8,000.00 │
│  03-12   │ INV-202603-00012 │ Invoice  │          │ 4,770.00 │          │
│  03-15   │ CN-202603-00002  │ Cr Note  │ RMA-003  │          │ 1,060.00 │
│  03-20   │ INV-202603-00020 │ Invoice  │ PO-8830  │ 3,180.00 │          │
│  03-25   │ DN-202603-00001  │ Db Note  │          │   530.00 │          │
│  03-28   │ RCT-202603-00015 │ Receipt  │ CHQ-4421 │          │ 5,300.00 │
│          │                  │          │          │          │          │
│  ─────── │ ──────────────── │ ──────── │ ──────── │ ──────── │ ──────── │
│                                                                          │
│          Opening Balance:                              RM  10,000.00     │
│          Total Debits   (本期借方):                    RM  13,780.00     │
│          Total Credits  (本期贷方):                    RM  14,360.00     │
│          ──────────────────────────────────────────────────────          │
│          Closing Balance (期末余额):                   RM   9,420.00     │
│                                                                          │
│ ──────────────────────────────────────────────────────────────────────── │
│                                                                          │
│  AGING SUMMARY (as at 2026-03-31):                                       │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐     │
│  │ Current  │ 1-30     │ 31-60    │ 61-90    │ 90+      │ TOTAL    │     │
│  ├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤     │
│  │ 3,710.00 │ 4,770.00 │    —     │   940.00 │    —     │ 9,420.00 │     │
│  └──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘     │
│                                                                          │
│  NOTE: This statement is computer-generated and does not require a       │
│  signature. Please verify and notify us of any discrepancies within      │
│  7 days of receipt.                                                      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.4 对账单业务规则

> **BR-ST-001 — 期初余额计算**
> ```
> Opening Balance =
>     SUM(所有在 Period Start 之前过账的、且截至 Period Start 仍有 Outstanding 的发票/DN)
>   - SUM(所有在 Period Start 之前过账的、且截至 Period Start 仍有 Unallocated 的收款/CN)
>
> 简化计算：
>   = 截至 (Period Start - 1 day) 的客户应收余额快照
> ```

> **BR-ST-002 — 期末余额自平衡校验**
> ```
> Closing Balance = Opening Balance + SUM(本期 Debits) - SUM(本期 Credits)
>
> 系统必须校验此等式成立。如不成立，报表不可生成，系统报错并记录异常日志。
> ```

> **BR-ST-003 — 交易排序规则**
> 对账单内交易按以下规则排序：
> ```
> ORDER BY transaction_date ASC, doc_type_priority ASC, doc_no ASC
>
> doc_type_priority:
>   Opening Balance = 0
>   Invoice = 1
>   Debit Note = 2
>   Credit Note = 3
>   Receipt = 4
> ```

> **BR-ST-004 — 多币种客户**
> - 以同一交易币种为一个对账单
> - 如客户有 MYR 和 USD 交易，生成 **两份独立的对账单**
> - 对账单上仅显示该币种的交易和余额
> - 不做币种转换汇总

> **BR-ST-005 — 对账单输出与发送**
> | 输出方式 | 说明                                             |
> |---------|------------------------------------------------|
> | PDF     | 标准格式，含公司信头和水印                          |
> | Excel   | 含公式的可编辑格式                                 |
> | Email   | 系统直接发送 PDF 至客户 `contact_email`，需用户确认  |
> | Print   | 直接打印                                          |
>
> 批量发送支持：月末可一键生成并发送所有客户对账单。

> **BR-ST-006 — Open Item 类型特殊规则**
> Open Item 对账单仅显示截至 Statement Date 的未结项目：
> - 不显示已 Paid 或 Cancelled 的凭证
> - 不需要 Period 参数（仅需 Statement Date）
> - 没有 Opening / Closing Balance，只有 Total Outstanding

---

## 4. AR 汇总报表 (AR Summary Report)

### 4.1 报表内容

| 指标                          | 计算方式                                    |
|------------------------------|---------------------------------------------|
| Total AR Balance             | SUM(所有客户 outstanding)                    |
| Current (未逾期)              | SUM(aging_bucket = 'Current')                |
| Total Overdue                | SUM(所有逾期桶)                               |
| Overdue Percentage           | Total Overdue / Total AR × 100%              |
| Average Days Outstanding     | AVG(report_date - invoice_date) for open inv  |
| DSO (Days Sales Outstanding) | (AR Balance / Credit Sales) × Days in Period  |
| Top 10 Overdue Customers     | 按逾期金额降序排列前 10                        |
| Credit Note Issued This Period| 本期 CN 总额                                 |
| Receipts This Period         | 本期收款总额                                  |
| Bad Debt Written Off         | 本期坏账核销总额                               |

### 4.2 DSO 计算公式

> **BR-RPT-001 — DSO (Days Sales Outstanding)**
> ```
> DSO = (Average AR Balance / Total Credit Sales) × Number of Days
>
> 其中：
>   Average AR Balance = (Period Start AR + Period End AR) / 2
>   Total Credit Sales = 本期所有发票（不含 CN）的 total_amount 合计
>   Number of Days = 日历天数（如 30 天、90 天、365 天）
>
> 示例（月度报表）：
>   期初 AR = RM 500,000
>   期末 AR = RM 450,000
>   平均 AR = RM 475,000
>   本月销售额 = RM 300,000
>   DSO = (475,000 / 300,000) × 30 = 47.5 天
> ```

---

## 5. 收款分析报表 (Collection Analysis Report)

### 5.1 报表内容

| 指标                        | 说明                                          |
|---------------------------|----------------------------------------------|
| Total Collections          | 本期收款总额                                   |
| Collection by Method       | 按收款方式分组（CHQ / TT / CASH 等）            |
| Collection Rate            | 本期收款 / 期初 AR 余额 × 100%                 |
| Overdue Collection Rate    | 本期收回的逾期金额 / 期初逾期余额 × 100%         |
| Unallocated Receipts       | 期末未核销收款余额                              |
| Bounced Cheques            | 本期退票金额和笔数                              |

---

## 6. 报表权限与审计

### 6.1 报表访问权限

| 报表                | AR Clerk | AR Supervisor | Finance Manager | Auditor (只读) |
|--------------------|----------|---------------|-----------------|----------------|
| Aging Report       | 本人客户  | 全部客户       | 全部客户 + 导出  | 全部客户        |
| Customer Statement | 本人客户  | 全部客户       | 全部客户 + 导出  | 全部客户        |
| AR Summary         | ❌       | ✅ 查看        | ✅ 查看 + 导出   | ✅ 查看         |
| Collection Analysis| ❌       | ✅ 查看        | ✅ 查看 + 导出   | ✅ 查看         |

### 6.2 报表审计日志

每次报表生成记录：
- 报表类型、参数
- 生成人、生成时间
- 导出格式（如有导出）
- 发送对象（如有邮件发送）

---

*— 第四部分完 —*
