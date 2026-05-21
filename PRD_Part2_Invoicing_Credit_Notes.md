# TSH Synergy — AR 模块功能规格书
# 第二部分：发票与凭证管理 (Invoicing & Credit Notes)

| 项目         | 详情                                      |
|-------------|------------------------------------------|
| **文档编号** | PRD-AR-002                               |
| **版本**     | v1.0 Draft                               |
| **日期**     | 2026-03-29                               |
| **关联文档** | PRD-AR-001 (客户主数据)                    |

---

## 1. 模块概述

发票与凭证管理是 AR 模块的 **核心交易层**。该模块负责管理从发票创建到最终清账的完整生命周期，以及 Credit Note（贷项通知单）等调整凭证的处理。

### 1.1 设计原则

1. **不可篡改性 (Immutability)**：已过账的凭证不可修改金额、日期等关键字段，确保审计合规。
2. **完整轨迹 (Full Audit Trail)**：所有状态变更和操作均有完整的审计日志。
3. **自动化驱动 (Automation-First)**：状态流转（如 Open → Overdue, Open → Paid）由系统自动处理，减少人为干预。
4. **税务合规 (Tax Compliance)**：发票必须满足马来西亚 SST 和新加坡 GST 的法定要求。

---

## 2. 发票数据模型

### 2.1 发票头 (Invoice Header — `invoices` 表)

| # | 字段名称              | 字段代码            | 数据类型       | 必填 | 默认值    | 校验/说明                                            |
|---|----------------------|--------------------|--------------:|------|----------|------------------------------------------------------|
| 1 | 发票编号              | `invoice_no`       | VARCHAR(20)   | 是   | 自动生成  | 格式：`INV-YYYYMM-NNNNN`，全局唯一，不可修改            |
| 2 | 凭证类型              | `doc_type`         | ENUM          | 是   | Invoice  | `Invoice` / `Debit Note`                              |
| 3 | 发票日期              | `invoice_date`     | DATE          | 是   | 当天     | 不可早于上一个已关闭财务期间；不可晚于当天 + 7 天          |
| 4 | 到期日                | `due_date`         | DATE          | 是   | 自动计算  | 根据 Payment Term 自动计算，可被授权用户覆盖             |
| 5 | 客户编号              | `customer_id`      | FK            | 是   | —        | 引用 `customers.customer_id`                          |
| 6 | 客户名称（冗余存储）   | `customer_name`    | VARCHAR(200)  | 是   | 自动带入  | 过账时快照，不随客户主数据后续变更而改变                   |
| 7 | 交易币种              | `currency`         | CHAR(3)       | 是   | 客户默认  | ISO 4217                                              |
| 8 | 汇率                  | `exchange_rate`    | DECIMAL(12,6) | 是   | 1.000000 | 当 `currency = 本位币` 时固定为 1；否则手动输入或从汇率表取 |
| 9 | 本位币                | `base_currency`    | CHAR(3)       | 是   | 系统设置  | 公司本位币（如 MYR）                                    |
| 10| 税前总额              | `subtotal`         | DECIMAL(18,2) | 是   | 0.00     | 系统计算：`SUM(line_items.line_amount)`                 |
| 11| 税额合计              | `tax_total`        | DECIMAL(18,2) | 是   | 0.00     | 系统计算：`SUM(line_items.tax_amount)`                  |
| 12| 发票总额              | `total_amount`     | DECIMAL(18,2) | 是   | 0.00     | 系统计算：`subtotal + tax_total`                        |
| 13| 本位币发票总额         | `base_total`       | DECIMAL(18,2) | 是   | 0.00     | 系统计算：`total_amount × exchange_rate`                |
| 14| 未结金额              | `outstanding`      | DECIMAL(18,2) | 是   | 0.00     | 初始 = `total_amount`；核销后递减                       |
| 15| 发票状态              | `status`           | ENUM          | 是   | Draft    | 见第 3 节状态机                                        |
| 16| 过账期间              | `posting_period`   | VARCHAR(7)    | 是   | 自动     | 格式 `YYYY-MM`，取自 `invoice_date`                     |
| 17| 外部参考号            | `reference_no`     | VARCHAR(50)   | 否   | —        | 客户 PO号、合同号等                                     |
| 18| 内部备注              | `internal_remarks` | TEXT          | 否   | —        | 内部可见，不打印在发票上                                  |
| 19| 发票备注              | `invoice_remarks`  | TEXT          | 否   | —        | 打印在发票上的备注                                       |
| 20| 创建人                | `created_by`       | VARCHAR(50)   | 是   | 当前用户  | 系统自动                                               |
| 21| 创建时间              | `created_date`     | DATETIME      | 是   | 系统时间  | 系统自动                                               |
| 22| 过账人                | `posted_by`        | VARCHAR(50)   | 否   | —        | 过账时自动填入                                          |
| 23| 过账时间              | `posted_date`      | DATETIME      | 否   | —        | 过账时自动填入                                          |
| 24| 作废人                | `cancelled_by`     | VARCHAR(50)   | 否   | —        | 作废时自动填入                                          |
| 25| 作废时间              | `cancelled_date`   | DATETIME      | 否   | —        | 作废时自动填入                                          |
| 26| 作废原因              | `cancel_reason`    | TEXT          | 否   | —        | 作废时必填                                              |
| 27| AR 控制科目           | `ar_acct`          | VARCHAR(20)   | 是   | 客户默认  | 过账时快照，确定过账科目                                  |
| 28| 版本号                | `version`          | INT           | 是   | 1        | 乐观并发控制                                            |

### 2.2 发票行项 (Invoice Line Items — `invoice_lines` 表)

| # | 字段名称          | 字段代码           | 数据类型       | 必填 | 校验/说明                                         |
|---|------------------|-------------------|--------------:|------|--------------------------------------------------|
| 1 | 发票编号          | `invoice_no`      | FK            | 是   | 引用 `invoices.invoice_no`                        |
| 2 | 行号              | `line_no`         | INT           | 是   | 系统自动递增（10, 20, 30...），支持插入行            |
| 3 | 商品/服务描述     | `description`     | VARCHAR(200)  | 是   | 不允许为空                                         |
| 4 | 商品代码          | `item_code`       | VARCHAR(30)   | 否   | 关联商品主数据（如有）                               |
| 5 | 数量              | `quantity`        | DECIMAL(12,3) | 是   | > 0                                               |
| 6 | 计量单位          | `uom`             | VARCHAR(10)   | 否   | 如：PCS, KG, LOT, HR                              |
| 7 | 单价              | `unit_price`      | DECIMAL(18,4) | 是   | ≥ 0（允许零价行项，如赠品）                          |
| 8 | 折扣率            | `discount_pct`    | DECIMAL(5,2)  | 否   | 0-100%，默认 0                                    |
| 9 | 折扣金额          | `discount_amt`    | DECIMAL(18,2) | 否   | 系统计算或手动输入（互斥）                           |
| 10| 行项净额          | `line_amount`     | DECIMAL(18,2) | 是   | `= qty × unit_price × (1 - discount_pct/100)`     |
| 11| 税码              | `tax_code`        | FK            | 是   | 引用 `tax_codes` 配置表                            |
| 12| 税率              | `tax_rate`        | DECIMAL(5,2)  | 是   | 从 `tax_codes` 自动带入（基于生效日期）               |
| 13| 税额              | `tax_amount`      | DECIMAL(18,2) | 是   | `= line_amount × tax_rate / 100`，四舍五入到 2 位   |
| 14| 行项总额          | `line_total`      | DECIMAL(18,2) | 是   | `= line_amount + tax_amount`                      |
| 15| 收入科目          | `gl_account`      | VARCHAR(20)   | 是   | 默认取客户 `revenue_acct`，可在行项层面覆盖           |
| 16| 成本中心          | `cost_center`     | VARCHAR(20)   | 否   | 用于管理会计的成本归集                               |
| 17| 备注              | `line_remarks`    | VARCHAR(200)  | 否   | 行项级别备注                                        |

### 2.3 发票金额计算规则

> **BR-INV-CALC-001 — 行项级计算**
> ```
> line_amount   = ROUND(quantity × unit_price × (1 - discount_pct/100), 2)
> tax_amount    = ROUND(line_amount × tax_rate / 100, 2)
> line_total    = line_amount + tax_amount
> ```

> **BR-INV-CALC-002 — 汇总级计算**
> ```
> subtotal     = SUM(所有行项 line_amount)
> tax_total    = SUM(所有行项 tax_amount)      ← 注意：不是 subtotal × tax_rate
> total_amount = subtotal + tax_total
> base_total   = ROUND(total_amount × exchange_rate, 2)
> ```
>
> **重要**：税额在行项级别四舍五入后汇总，**不在汇总级别重新计算**。这确保了与税务机关逐行计税要求的一致性，避免因汇总计税产生的分/仙差异。

> **BR-INV-CALC-003 — 折扣互斥规则**
> 每行只能选择一种折扣方式：
> - `discount_pct`（按百分比），或
> - `discount_amt`（按固定金额）
>
> 两者不可同时填写。如选择 `discount_amt`，则 `line_amount = qty × unit_price - discount_amt`。

---

## 3. 发票状态机 (Invoice Status Machine)

### 3.1 状态定义

| 状态码           | 显示名称      | 说明                                               |
|-----------------|-------------|---------------------------------------------------|
| `Draft`         | 草稿         | 新创建，可自由编辑和删除                               |
| `Open`          | 已过账/未结   | 已过账至总账，等待收款核销                              |
| `Partially Paid`| 部分已付       | 已有部分核销，但 Outstanding > 0                      |
| `Paid`          | 已清账        | Outstanding = 0，终态                                |
| `Overdue`       | 逾期          | 已过到期日且 Outstanding > 0                          |
| `Cancelled`     | 已作废        | 已被冲销，终态                                        |

### 3.2 状态流转图

```
                                    ┌─────────────────────────────┐
                                    │          定时任务             │
┌──────────┐    过账 (Post)     ┌───┴──────┐   (日期>Due Date)    │
│          │ ──────────────────►│          │──────────────────►┌──┴───────┐
│  Draft   │                   │   Open   │                   │ Overdue  │
│  (草稿)  │                   │ (已过账)  │◄─────────────────│  (逾期)   │
└────┬─────┘                   └─┬──┬──┬──┘  收到付款/CN抵扣   └──┬──┬────┘
     │                           │  │  │                        │  │
     │ 删除                      │  │  │                        │  │
     ▼                           │  │  └────────────────────┐   │  │
 [物理删除]                      │  │       作废             │   │  │
                                │  │  (Supervisor+审批)     │   │  │
                                │  │         │              │   │  │
                     部分核销     │  │         ▼              │   │  │ 作废
                  ┌─────────────┘  │   ┌───────────┐        │   │  │
                  │                │   │ Cancelled  │◄───────┼───┘  │
                  ▼                │   │  (已作废)   │        │      │
          ┌───────────────┐       │   └───────────┘        │      │
          │ Partially     │       │                         │      │
          │ Paid (部分付)  │───┐   │                         │      │
          └───────────────┘   │   │  全额核销                │      │
                              │   │                         │      │
               Outstanding=0 │   │  Outstanding=0           │      │
                              ▼   ▼                         ▼      │
                          ┌──────────┐                             │
                          │   Paid   │◄────────────────────────────┘
                          │ (已清账)  │    (Overdue 全额核销)
                          └──────────┘
```

### 3.3 状态转换规则（详细）

| # | 源状态          | 目标状态         | 触发条件                                    | 操作角色       | 前置检查                                              |
|---|----------------|-----------------|-------------------------------------------|---------------|------------------------------------------------------|
| 1 | Draft          | Open            | 用户执行"过账"操作                           | AR Clerk+      | ① 至少 1 行行项 ② 客户状态 Active ③ 信用检查 ④ 期间开放 |
| 2 | Draft          | [物理删除]       | 用户执行"删除"操作                           | AR Clerk+      | 无（Draft 可自由删除）                                  |
| 3 | Open           | Partially Paid  | 核销后 `0 < outstanding < total_amount`     | 系统自动        | 收款/CN 核销完成                                       |
| 4 | Open           | Paid            | 核销后 `outstanding = 0`                    | 系统自动        | 收款/CN 核销完成                                       |
| 5 | Open           | Overdue         | `CURRENT_DATE > due_date AND outstanding > 0`| 定时任务       | 每日凌晨 01:00 执行                                    |
| 6 | Open           | Cancelled       | 用户执行"作废"操作                           | AR Supervisor+ | ① outstanding = total_amount（无核销记录）② 填写原因     |
| 7 | Overdue        | Partially Paid  | 核销后 `0 < outstanding < total_amount`     | 系统自动        | 收款/CN 核销完成                                       |
| 8 | Overdue        | Paid            | 核销后 `outstanding = 0`                    | 系统自动        | 收款/CN 核销完成                                       |
| 9 | Overdue        | Cancelled       | 用户执行"作废"操作                           | AR Supervisor+ | ① outstanding = total_amount ② 填写原因                |
| 10| Partially Paid | Paid            | 核销后 `outstanding = 0`                    | 系统自动        | 收款/CN 核销完成                                       |
| 11| Paid           | ——              | **终态，不可变更**                           | ——             | ——                                                    |
| 12| Cancelled      | ——              | **终态，不可变更**                           | ——             | ——                                                    |

### 3.4 发票核心业务规则

> **BR-INV-001 — 不可修改性**
> 过账后的发票（状态 ≠ Draft），以下字段 **不可修改**：
> - `invoice_date`, `due_date`, `customer_id`, `currency`, `exchange_rate`
> - 所有行项及金额字段
> - `ar_acct`, `posting_period`
>
> 仅允许修改：`internal_remarks`, `invoice_remarks`, `reference_no`

> **BR-INV-002 — 过账前校验清单**
>
> | 校验项                     | 校验逻辑                                          | 失败行为         |
> |---------------------------|--------------------------------------------------|-----------------|
> | 行项数量                   | `COUNT(invoice_lines) ≥ 1`                        | 硬阻断           |
> | 客户状态                   | `customer.status = 'Active'`                      | 硬阻断           |
> | 信用额度                   | `utilization + total ≤ credit_limit`              | 硬阻断（可豁免）  |
> | 财务期间                   | `posting_period` 在已打开的财务期间内               | 硬阻断           |
> | 发票日期                   | `invoice_date ≤ CURRENT_DATE + 7`                 | 硬阻断           |
> | 客户信用评级               | `credit_rating ≠ 'D'`                             | 硬阻断           |
> | 税码有效性                 | 所有行项 `tax_code` 在 `invoice_date` 当日有效      | 硬阻断           |
> | GL 科目有效性              | 所有引用的 GL 科目状态为 Active                      | 硬阻断           |
> | 金额一致性                 | `total_amount = subtotal + tax_total`              | 硬阻断           |

> **BR-INV-003 — 发票作废规则**
>
> 1. 仅 `Open` 或 `Overdue` 状态且 **未发生任何核销** 的发票可以作废
> 2. 作废时必须填写 `cancel_reason`（最少 10 个字符）
> 3. 系统自动生成一笔 **反转凭证（Reversal Journal Entry）**：
>    - 凭证日期 = 作废操作日期
>    - 过账期间 = 作废操作日当前开放的财务期间
>    - 金额 = 与原始发票分录完全相反
> 4. 作废发票 **不物理删除**，保留完整审计轨迹
> 5. 作废后，原发票编号 **不回收重用**

> **BR-INV-004 — Partially Paid 发票不可作废**
>
> 已有核销记录的发票（`outstanding < total_amount`）禁止作废。处理方式：
> - 方案 A：发行 Credit Note 抵减剩余金额
> - 方案 B：先反核销（De-allocate）所有已核销记录，然后再作废
>
> 两种方案均需 AR Supervisor+ 权限。

> **BR-INV-005 — 逾期状态自动更新**
> ```
> 定时任务：每日 01:00 AM 执行
> 
> UPDATE invoices
> SET status = 'Overdue'
> WHERE status IN ('Open', 'Partially Paid')
>   AND due_date < CURRENT_DATE
>   AND outstanding > 0
>
> -- 同步更新客户信用状态（BR-CM-004）
> ```

> **BR-INV-006 — 发票编号规则**
> ```
> 格式：INV-YYYYMM-NNNNN
> 示例：INV-202603-00142
>
> - YYYY：年份
> - MM：月份
> - NNNNN：当月流水号，5 位，从 00001 开始
> - 每月 1 日重置为 00001
> - 跨月的 Draft 发票在过账时取过账月份的编号，而非创建月份
> ```

> **BR-INV-007 — 多币种发票汇率规则**
> - 当发票币种 ≠ 公司本位币时，用户必须输入汇率或从系统汇率表选取
> - 汇率表由 Finance Manager 每日维护
> - 过账后汇率锁定，不可修改（实际汇率差异在收款核销时通过汇兑损益处理）

---

## 4. Credit Note（贷项通知单 / 红字发票）

### 4.1 概述

Credit Note 用于冲减已开具发票的金额，适用场景包括：
- **退货 (Return)**：客户退回商品
- **折让 (Allowance/Discount)**：事后给予客户价格折让
- **价格调整 (Price Adjustment)**：调整已开票的价格错误
- **错误更正 (Error Correction)**：更正发票错误

### 4.2 Credit Note 数据模型

Credit Note 使用与 Invoice 相同的 `invoices` 表，通过 `doc_type = 'Credit Note'` 区分，附加以下字段：

| # | 字段名称              | 字段代码              | 数据类型    | 必填 | 说明                                            |
|---|----------------------|----------------------|------------|------|------------------------------------------------|
| 1 | CN 编号              | `invoice_no`         | VARCHAR(20)| 是   | 格式：`CN-YYYYMM-NNNNN`                         |
| 2 | 关联发票编号          | `ref_invoice_no`     | FK         | 条件 | 关联原始发票。独立 CN 时可为 NULL                   |
| 3 | CN 类型              | `cn_type`            | ENUM       | 是   | `Linked`（关联发票）/ `Standalone`（独立）         |
| 4 | 原因代码              | `reason_code`        | ENUM       | 是   | `Return`/`Discount`/`Price Adjustment`/`Error Correction`/`Other` |
| 5 | 原因说明              | `reason_desc`        | TEXT       | 条件 | 当 `reason_code = Other` 时必填                  |

### 4.3 Credit Note 处理流程

```
┌───────────────────────────────────────────────────────────────────┐
│                Credit Note 创建与过账流程                          │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. 用户选择"新建 Credit Note"                                    │
│     │                                                             │
│  2. 选择 CN 类型：                                                │
│     ├── Linked（关联发票）──► 选择原始发票 ──► 自动带入客户信息      │
│     │                         └──► 行项可从原发票复制或手动输入      │
│     │                                                             │
│     └── Standalone（独立）──► 选择客户 ──► 手动输入行项              │
│     │                                                             │
│  3. 填写行项明细（描述、数量、单价、税码）                           │
│     │                                                             │
│  4. 系统校验金额（Linked 类型：CN ≤ 原发票 Outstanding）            │
│     │                                                             │
│  5. 过账：                                                        │
│     ├── 生成会计分录（反向发票分录）                                 │
│     ├── Linked 类型：自动扣减原发票 Outstanding                     │
│     └── Standalone：生成客户贷方余额                                │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

### 4.4 Credit Note 业务规则

> **BR-CN-001 — 金额上限控制（Linked CN）**
> ```
> 校验：cn_total_amount ≤ ref_invoice.outstanding
>
> 如果违反：
>     DISPLAY error: "Credit Note 金额 ({cn_total}) 超过原发票未结金额 ({outstanding})。
>         原发票：{ref_invoice_no}
>         原发票总额：{ref_total}
>         已核销金额：{ref_total - ref_outstanding}
>         当前未结：{ref_outstanding}
>         本次 CN：{cn_total}"
> ```

> **BR-CN-002 — 累积金额控制**
> 一张 Invoice 可关联多张 CN，但：
> ```
> SUM(所有关联 CN 的 total_amount) ≤ ref_invoice.total_amount
> ```
> 系统在创建新 CN 时自动校验累积金额。

> **BR-CN-003 — CN 过账自动处理**
>
> **Linked CN 过账时**：
> 1. 生成会计分录（见第五章 Credit Note 分录）
> 2. 更新原发票：
>    ```
>    ref_invoice.outstanding = ref_invoice.outstanding - cn_total_amount
>    ```
> 3. 如 `ref_invoice.outstanding = 0`：
>    - 原发票状态 → `Paid`
> 4. 如 `ref_invoice.outstanding > 0` 且原来状态为 `Open`：
>    - 原发票状态 → `Partially Paid`
>
> **Standalone CN 过账时**：
> 1. 生成会计分录
> 2. 在该客户名下产生一笔 **贷方余额（Credit Balance）**
> 3. 该贷方余额可在后续核销界面中用于抵扣其他发票

> **BR-CN-004 — CN 不可逆性**
> Credit Note 一旦过账：
> - ❌ 不可删除
> - ❌ 不可修改金额
> - ✅ 如需冲回，须发行 **Debit Note**（与 CN 金额相等的正向凭证）

> **BR-CN-005 — Standalone CN 使用场景**
> | 场景                     | 说明                                          |
> |-------------------------|----------------------------------------------|
> | 预收款退回               | 客户要求退还预收款，CN 冲减客户贷方余额           |
> | 跨发票折让               | 折让不针对特定发票，而是客户总体价格调整           |
> | 期初余额调整             | 系统上线时的客户余额调整                         |

> **BR-CN-006 — CN 与税务镜像**
> Credit Note 的税务处理必须与原始交易 **完全镜像**：
> - 原发票行项税码 SR-6 → CN 行项也必须使用 SR-6
> - 不允许在 CN 中使用与原交易不同的税码
> - 独立 CN 的税码按正常发票规则处理

---

## 5. 税务逻辑 (Tax Logic)

### 5.1 税码配置表 (`tax_codes`)

| 字段               | 数据类型     | 说明                              |
|-------------------|-------------|----------------------------------|
| `tax_code`        | VARCHAR(10) | 唯一标识                           |
| `tax_name`        | VARCHAR(50) | 显示名称                           |
| `tax_type`        | ENUM        | `Output`（销项）/ `Input`（进项）   |
| `rate`            | DECIMAL(5,2)| 税率（%）                          |
| `effective_from`  | DATE        | 生效日期                           |
| `effective_to`    | DATE        | 失效日期（NULL = 永久有效）          |
| `country`         | CHAR(2)     | 适用国家                           |
| `gl_account`      | VARCHAR(20) | 关联的税务 GL 科目                  |
| `is_active`       | BOOLEAN     | 是否启用                           |

### 5.2 预设税码

| 税码   | 名称                     | 税率   | 国家 | GL 科目   | 说明                                |
|-------|-------------------------|-------|------|----------|-------------------------------------|
| SR-6  | Sales Tax 6%            | 6.00% | MY   | 2200-001 | 马来西亚 SST — 销售税                |
| ST-10 | Service Tax 10%         | 10.00%| MY   | 2200-002 | 马来西亚 SST — 服务税（2024年起）     |
| SR-8  | GST Standard Rate       | 8.00% | SG   | 2200-010 | 新加坡 GST — 标准税率（2024年起 8%）  |
| SR-9  | GST Standard Rate (Future)| 9.00%| SG  | 2200-010 | 新加坡 GST — 未来税率（预留）         |
| ZRL   | Zero Rated (Local)      | 0.00% | MY   | 2200-001 | 零税率 — 本地供应                     |
| ZRE   | Zero Rated (Export)     | 0.00% | MY   | 2200-001 | 零税率 — 出口                        |
| ES    | Exempt Supply           | 0.00% | MY/SG| —        | 免税供应                              |
| OS    | Out of Scope            | 0.00% | MY/SG| —        | 税务范围外                            |
| AJS   | Adjustment (Special)    | N/A   | MY/SG| 2200-099 | 税务调整专用                          |

### 5.3 税务业务规则

> **BR-TAX-001 — 税码默认值优先级**
> ```
> 1. 商品/服务主数据上配置的默认税码
>        ↓ 未设置时
> 2. 客户所在国家的默认标准税码（MY → SR-6, SG → SR-8）
>        ↓ 未设置时
> 3. 系统全局默认税码（AR 模块设置中配置）
> ```

> **BR-TAX-002 — 逐行计税规则**
> ```
> 对于每一个行项：
>     tax_amount = ROUND(line_amount × tax_rate / 100, 2)
>
> 发票税额合计 = SUM(所有行项的 tax_amount)
>
> ❌ 错误做法：tax_total = ROUND(subtotal × tax_rate / 100, 2)
>    （这种方式会因四舍五入产生差异）
> ```

> **BR-TAX-003 — 税率时效性**
> 系统根据 **发票日期** 确定适用税率：
> ```sql
> SELECT rate FROM tax_codes
> WHERE tax_code = :input_code
>   AND effective_from <= :invoice_date
>   AND (effective_to IS NULL OR effective_to >= :invoice_date)
>   AND is_active = TRUE
> ```
> 如果同一税码在发票日期有多条有效记录，取 `effective_from` 最近的一条。

> **BR-TAX-004 — 税率变更过渡期处理**
> 当税率变更时（如 GST 7% → 8%），系统行为：
> - 变更日期前的发票：自动适用旧税率
> - 变更日期起的发票：自动适用新税率
> - 跨期交易（如发票日在旧税率期间但发货日在新税率期间）：以 **发票日期** 为准

> **BR-TAX-005 — 免税与零税率区分**
> | 类型        | 税率 | 是否显示在税务报告 | 说明                              |
> |------------|------|------------------|----------------------------------|
> | Zero Rated | 0%   | 是               | 税率为零但仍属应税供应，须申报        |
> | Exempt     | 0%   | 否               | 免税供应，不参与进项税抵扣            |
> | Out of Scope| N/A | 否               | 完全不在税务范围内                   |

> **BR-TAX-006 — 马来西亚 e-Invoice 合规**
> 对于马来西亚客户（`bill_country = MY`），发票必须满足 LHDN（马来西亚税务局）e-Invoice 要求：
> - 必须包含供应商和买方的 TIN（Tax Identification Number）
> - 必须包含有效的 MSIC 代码
> - 发票格式需符合 MyInvois 平台规范

---

## 6. 发票打印与输出

### 6.1 发票模板要素

发票打印输出必须包含以下法定要素（马来西亚/新加坡合规）：

| # | 要素                      | 说明                                  | 法规要求 |
|---|--------------------------|---------------------------------------|---------|
| 1 | 公司名称及注册号           | 开票方法定全称及公司注册号               | SST/GST |
| 2 | 公司 SST/GST 注册号       | 如适用                                 | SST/GST |
| 3 | 发票编号                  | 连续流水号                              | SST/GST |
| 4 | 发票日期                  | 出票日期                                | SST/GST |
| 5 | 客户名称及地址             | 买方信息                                | SST/GST |
| 6 | 客户 SST/GST 号           | 如适用                                 | GST     |
| 7 | 商品/服务描述              | 明细描述                                | SST/GST |
| 8 | 数量及单价                | 每行明细                                | SST/GST |
| 9 | 税前金额                  | 每行及合计                               | SST/GST |
| 10| 税额                     | 每行及合计，需标注税码和税率               | SST/GST |
| 11| 含税总额                  | 发票总额                                | SST/GST |
| 12| 币种                     | 交易币种                                 | IFRS    |
| 13| 账期/到期日               | 付款条件                                 | 商业惯例 |

### 6.2 输出格式

| 格式   | 用途                      | 说明                        |
|-------|--------------------------|----------------------------|
| PDF   | 打印和电子邮件发送          | 标准输出格式                  |
| Excel | 数据分析和批量处理          | 含公式的明细报表              |
| XML   | e-Invoice 提交（MyInvois） | 马来西亚电子发票合规格式        |
| Print | 直接打印                   | 连接打印机输出                |

---

## 7. Debit Note（借项通知单）

### 7.1 概述

Debit Note 用于 **增加** 客户的应收金额，适用场景：

| 场景              | 说明                                             |
|------------------|------------------------------------------------|
| 补充收费          | 原发票漏记的费用或追加收费                          |
| 冲回 Credit Note  | 用 DN 冲回错误发行的 CN                            |
| 利息/滞纳金       | 向逾期客户收取逾期利息                              |

### 7.2 Debit Note 规则

> **BR-DN-001**: Debit Note 的数据结构与 Invoice 完全相同（`doc_type = 'Debit Note'`），编号格式 `DN-YYYYMM-NNNNN`。

> **BR-DN-002**: DN 过账时的会计分录与 Invoice 过账 **完全相同**（Dr. AR, Cr. Revenue/Other Income）。

> **BR-DN-003**: DN 的到期日和信用检查规则与 Invoice 一致。DN 金额纳入客户信用使用率计算。

---

## 8. 接口与集成点

| 集成点                    | 方向         | 说明                                          |
|--------------------------|-------------|----------------------------------------------|
| 销售订单 (SO) → 发票      | Inbound     | SO 确认后可批量生成 AR 发票草稿                  |
| 发货单 (DO) → 发票        | Inbound     | 发货确认后触发发票生成                           |
| 发票 → 总账 (GL)          | Outbound    | 过账时推送 Journal Entry 至 GL 模块              |
| 发票 → e-Invoice (LHDN)  | Outbound    | 过账后提交至 MyInvois 平台（马来西亚）            |
| 发票 → 邮件系统            | Outbound    | 支持将 PDF 发票通过邮件发送给客户                 |

---

*— 第二部分完 —*

> **下一部分预告**：第三部分将涵盖 **收款与核销逻辑（Receipt & Reconciliation）**、**账龄分析与报表（Aging & Reporting）** 以及 **会计分录逻辑（Journal Entries）**。待您确认后继续。
