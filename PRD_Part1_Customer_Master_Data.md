# TSH Synergy — AR 模块功能规格书
# 第一部分：客户主数据管理 (Customer Master Data)

| 项目         | 详情                                      |
|-------------|------------------------------------------|
| **项目名称** | TSH Synergy ERP — Accounts Receivable Module |
| **文档编号** | PRD-AR-001                               |
| **版本**     | v1.0 Draft                               |
| **作者**     | Business Analyst (AI-Assisted)           |
| **日期**     | 2026-03-29                               |
| **状态**     | 待审批 (Pending Approval)                 |
| **适用准则** | IFRS 15, MFRS 9, MFRS 7                 |

---

## 1. 模块概述

客户主数据（Customer Master Data）是整个 AR 模块的 **数据基础层**。系统中的发票开具、收款处理、账龄分析、信用控制等所有业务活动，均依赖于客户主数据的完整性和准确性。

### 1.1 设计原则

1. **唯一性 (Uniqueness)**：每个法律实体在系统中有且仅有一条客户主记录。
2. **完整性 (Completeness)**：客户记录必须包含完整的财务、税务、信用控制信息方可启用。
3. **可审计性 (Auditability)**：所有字段变更均记录变更日志（Change Log），记录变更人、变更时间、变更前后值。
4. **层级分离 (Separation of Concerns)**：基本信息、联系方式、财务参数、信用控制分 Tab 管理，各自有独立的维护权限。

---

## 2. 数据字段定义

### 2.1 基本信息 (General Tab)

| # | 字段名称              | 字段代码           | 数据类型     | 长度  | 必填 | 默认值    | 校验规则                                                  |
|---|----------------------|-------------------|-------------|-------|------|----------|----------------------------------------------------------|
| 1 | 客户编号              | `customer_id`     | VARCHAR     | 20    | 是   | 自动生成  | 格式：`CUST-NNNNN`，系统自增，不可修改                       |
| 2 | 客户全称              | `customer_name`   | VARCHAR     | 200   | 是   | —        | 不允许纯数字；不允许特殊字符（除 `& . , - ()` ）              |
| 3 | 客户简称              | `short_name`      | VARCHAR     | 50    | 否   | —        | 用于下拉搜索、报表列头                                      |
| 4 | 客户类型              | `customer_type`   | ENUM        | —     | 是   | Corporate| 枚举值：`Corporate`, `Individual`, `Government`, `Intercompany` |
| 5 | 公司注册号            | `registration_no` | VARCHAR     | 50    | 条件 | —        | 当 `customer_type = Corporate` 时必填；格式校验按国家规则     |
| 6 | 税务登记号 (SST/GST) | `tax_id`          | VARCHAR     | 20    | 否   | —        | MY 格式：字母+数字混合；SG 格式：数字 + 校验位                |
| 7 | 客户状态              | `status`          | ENUM        | —     | 是   | Active   | 枚举值：`Active`, `Inactive`, `Blocked`, `On Hold`          |
| 8 | 客户分组              | `customer_group`  | FK          | —     | 否   | —        | 关联 `CustomerGroup` 配置表，用于报表分组和批量策略            |
| 9 | 母公司编号            | `parent_id`       | FK          | 20    | 否   | —        | 自引用，用于集团客户层级关系                                  |
| 10| 创建日期             | `created_date`    | DATETIME    | —     | 是   | 系统时间  | 系统自动，不可修改                                           |
| 11| 最后修改日期          | `modified_date`   | DATETIME    | —     | 是   | 系统时间  | 每次保存自动更新                                             |
| 12| 创建人               | `created_by`      | VARCHAR     | 50    | 是   | 当前用户  | 系统自动，不可修改                                           |
| 13| 修改人               | `modified_by`     | VARCHAR     | 50    | 是   | 当前用户  | 每次保存自动更新                                             |

**状态流转规则**：

```
                    手动激活
    ┌──────────────────────────────────────┐
    │                                      │
    ▼         手动停用                      │
 Active ──────────────► Inactive           │
    │                      │               │
    │  BR-CM-004           │ 手动激活       │
    │ (系统自动)            ▼               │
    ├──────► On Hold ──► Active ───────────┘
    │           │
    │           │ 升级阻断
    │           ▼
    └──────► Blocked
              (仅 Finance Manager 可解除)
```

> **BR-CUS-001**: 客户状态为 `Inactive` 时，不允许创建新发票或销售订单，但允许收款和核销（处理历史未结事项）。

> **BR-CUS-002**: 客户状态为 `Blocked` 时，**禁止所有新交易**（包括发票、收款、Credit Note），仅允许查看历史数据。

> **BR-CUS-003**: 客户删除采用 **逻辑删除（Soft Delete）**，标记 `status = Inactive` 并设置 `is_deleted = true`。有未结余额的客户 **不允许删除**。

### 2.2 联系信息 (Contact Tab)

| # | 字段名称          | 字段代码             | 数据类型     | 必填 | 说明                                          |
|---|------------------|---------------------|-------------|------|-----------------------------------------------|
| 1 | 账单地址 - 行1    | `bill_addr_line1`   | VARCHAR(100)| 是   | 街道/门牌                                      |
| 2 | 账单地址 - 行2    | `bill_addr_line2`   | VARCHAR(100)| 否   | 补充地址                                       |
| 3 | 账单地址 - 城市   | `bill_city`         | VARCHAR(50) | 是   | 城市                                           |
| 4 | 账单地址 - 州/省  | `bill_state`        | VARCHAR(50) | 是   | 州属/省份                                       |
| 5 | 账单地址 - 邮编   | `bill_postal`       | VARCHAR(10) | 是   | 邮政编码                                       |
| 6 | 账单地址 - 国家   | `bill_country`      | ENUM        | 是   | ISO 3166-1 国家代码（MY, SG, ID 等）             |
| 7 | 送货地址          | `ship_addresses`    | JSON/子表    | 否   | 支持多条送货地址，结构同账单地址                   |
| 8 | 主要联络人姓名     | `contact_name`      | VARCHAR(100)| 是   | 主要联络人（用于对账单发送）                      |
| 9 | 联系电话          | `contact_phone`     | VARCHAR(20) | 是   | 含国家区号                                      |
| 10| 电子邮箱          | `contact_email`     | VARCHAR(100)| 是   | 邮箱格式校验；用于电子帐单和对账单发送              |
| 11| 备用联络人        | `alt_contacts`      | JSON/子表    | 否   | 支持多个备用联络人（姓名、电话、邮箱、职务）        |

> **BR-CUS-004**: `bill_country` 字段值决定：
> - 默认税码的选择（MY → SST 体系，SG → GST 体系）
> - 默认币种的建议值（MY → MYR，SG → SGD）
> - 公司注册号的格式校验规则

### 2.3 财务信息 (Finance Tab)

| # | 字段名称                    | 字段代码              | 数据类型       | 必填 | 说明                                                    |
|---|----------------------------|----------------------|---------------|------|---------------------------------------------------------|
| 1 | 默认交易币种                | `default_currency`   | CHAR(3)       | 是   | ISO 4217（MYR, SGD, USD, EUR 等）                        |
| 2 | 应收账款控制科目             | `ar_control_acct`    | VARCHAR(20)   | 是   | 关联总账科目表（Chart of Accounts）                        |
| 3 | 默认收入科目                | `revenue_acct`       | VARCHAR(20)   | 是   | 发票行项默认取此科目                                       |
| 4 | 默认账期                   | `payment_term_id`    | FK            | 是   | 关联 PaymentTerms 配置表                                  |
| 5 | 信用额度                   | `credit_limit`       | DECIMAL(18,2) | 是   | 以 `default_currency` 计量                                |
| 6 | 信用评级                   | `credit_rating`      | ENUM          | 是   | `AAA`, `AA`, `A`, `B`, `C`, `D`                          |
| 7 | 信用额度使用率（系统计算）   | `credit_utilization` | DECIMAL(18,2) | —    | 实时计算，不持久化存储。仅在查询/校验时动态计算               |
| 8 | 可用信用余额（系统计算）     | `available_credit`   | DECIMAL(18,2) | —    | = `credit_limit` - `credit_utilization`                   |
| 9 | 银行账户信息               | `bank_details`       | JSON/子表      | 否   | 银行名称、户名、账号、Swift Code（退款场景用）               |
| 10| 电子发票标记               | `e_invoice_enabled`  | BOOLEAN       | 是   | 是否启用电子发票（马来西亚 e-Invoice 合规要求）              |

> **BR-CUS-005**: `credit_utilization` **不存储在数据库表中**，而是在以下场景 **实时计算**：
> ```sql
> credit_utilization = (
>     SELECT COALESCE(SUM(outstanding_amount), 0)
>     FROM invoices
>     WHERE customer_id = :customer_id
>       AND status IN ('Open', 'Overdue', 'Partially Paid')
> ) - (
>     SELECT COALESCE(SUM(unallocated_amount), 0)
>     FROM receipts
>     WHERE customer_id = :customer_id
>       AND status = 'Posted'
>       AND unallocated_amount > 0
> )
> ```
> 这样确保数据始终一致，避免缓存不同步的问题。

---

## 3. 信用管理 (Credit Management)

### 3.1 信用评级体系

| 评级 | 名称      | 建议信用额度上限   | 账期限制          | 信用审查频率 | 标准描述                                    |
|-----|----------|------------------|------------------|------------|---------------------------------------------|
| AAA | Excellent| RM 1,000,000+    | 无限制            | 年度        | 上市公司/政府实体，过去 24 个月零逾期记录        |
| AA  | Very Good| RM 500,000       | 最长 NET90        | 半年度      | 信誉优良，偶有短期逾期（≤ 7 天），逾期率 < 2%    |
| A   | Good     | RM 200,000       | 最长 NET60        | 季度        | 一般企业客户，逾期率 < 5%                      |
| B   | Fair     | RM 50,000        | 最长 NET30        | 月度        | 中小企业，有逾期记录但未超过 60 天              |
| C   | Poor     | RM 10,000        | 仅 COD 或 PREPAID | 每笔交易    | 频繁逾期或有坏账历史                           |
| D   | Blocked  | RM 0             | 禁止交易          | N/A        | 信用冻结，存在重大信用风险或法律纠纷             |

### 3.2 信用控制业务规则（完整）

> **BR-CM-001 — 信用额度硬控制**
>
> **触发点**：发票过账（`Invoice.Post()`）
>
> **控制逻辑**：
> ```
> IF (credit_utilization + new_invoice_total) > credit_limit THEN
>     BLOCK invoice posting
>     DISPLAY error: "客户 {customer_name} 信用额度不足。
>         当前使用: {credit_utilization}
>         信用额度: {credit_limit}
>         本次发票: {new_invoice_total}
>         超额金额: {overrun_amount}"
>     LOG attempted_overrun to credit_control_log
> END IF
> ```
>
> **例外处理**：Finance Manager 可通过"信用额度豁免审批"一次性放行单笔交易。系统记录豁免人、豁免原因、豁免金额。

> **BR-CM-002 — 信用额度修改审批**
>
> | 操作角色          | 权限范围                                         |
> |------------------|------------------------------------------------|
> | AR Clerk         | 不可修改信用额度                                  |
> | AR Supervisor    | 可在当前额度的 ±20% 范围内调整（单次调整上限）       |
> | Finance Manager  | 无金额限制，但须在系统中填写调整理由                 |
> | System Admin     | 仅可修改系统级默认额度，不可修改单个客户额度          |
>
> **审批流程**：
> ```
> AR Supervisor 提交调整申请
>     → 如调整幅度 ≤ 20%：自动批准，记录日志
>     → 如调整幅度 > 20%：路由至 Finance Manager 审批
>         → Finance Manager 批准/驳回
>         → 系统记录审批结果
> ```

> **BR-CM-003 — 信用冻结 (Rating D)**
>
> 当客户 `credit_rating = D` 时：
> - ❌ 禁止创建新发票
> - ❌ 禁止确认新销售订单
> - ✅ 允许收款和核销（清理历史欠款）
> - ✅ 允许发行 Credit Note（处理退货/折让）
> - 仅 **Finance Manager** 可将评级从 D 调整为其他级别

> **BR-CM-004 — 逾期自动降级**
>
> 系统每日定时任务检查：
> ```
> IF EXISTS (
>     SELECT 1 FROM invoices
>     WHERE customer_id = :id
>       AND status = 'Overdue'
>       AND DATEDIFF(DAY, due_date, GETDATE()) > 90
> ) THEN
>     UPDATE customers SET status = 'On Hold' WHERE customer_id = :id
>     SEND email_notification TO ar_supervisor
>         SUBJECT: "客户 {customer_name} 因逾期超90天已被系统自动挂起"
>     INSERT INTO credit_control_log (action, reason, ...)
> END IF
> ```

> **BR-CM-005 — 信用使用率计算公式**
> ```
> Utilization = SUM(所有 Open/Overdue/Partially Paid 发票的 Outstanding Amount)
>             - SUM(所有已过账但未核销的收款 Unallocated Amount)
>             - SUM(所有已过账但未使用的 Credit Note 余额)
> ```
> **注意**：公式中扣除了预收款和未使用 CN，因为这些实质上减轻了客户的信用占用。

### 3.3 信用检查触发点矩阵

| 触发场景                   | 检查条件                                          | 阻断类型    | 可豁免 |
|---------------------------|--------------------------------------------------|-----------|--------|
| 发票过账                   | `utilization + invoice_total ≤ credit_limit`      | 硬阻断     | 是*    |
| 销售订单确认               | `utilization + order_total ≤ credit_limit`        | 软警告     | 是     |
| 客户状态 = Blocked         | `status ≠ 'Blocked'`                              | 硬阻断     | 否     |
| 客户状态 = On Hold         | `status ≠ 'On Hold'`                              | 硬阻断     | 是*    |
| 信用评级 = D               | `credit_rating ≠ 'D'`                             | 硬阻断     | 否     |
| 逾期超过 60 天的客户新增交易 | 无逾期 > 60 天的发票                                | 软警告     | 是     |

*（需 Finance Manager 一次性豁免审批）

---

## 4. 账期管理 (Payment Terms)

### 4.1 账期配置表 (PaymentTerms)

| 字段               | 数据类型    | 说明                                        |
|-------------------|------------|---------------------------------------------|
| `term_code`       | VARCHAR(10)| 唯一标识码                                    |
| `term_name`       | VARCHAR(50)| 显示名称                                      |
| `term_type`       | ENUM       | `Fixed Days` / `End of Month` / `Prepaid` / `COD` / `Custom` |
| `days`            | INT        | 天数参数（Fixed Days 和 EOM+N 使用）            |
| `description`     | TEXT       | 详细描述                                      |
| `is_active`       | BOOLEAN    | 是否启用                                      |

### 4.2 支持的账期类型及计算逻辑

| 代码     | 类型         | 计算公式                                           | 发票日 2026-03-15 示例         |
|---------|-------------|--------------------------------------------------|-------------------------------|
| NET7    | Fixed Days  | `due_date = invoice_date + 7`                     | 2026-03-22                    |
| NET14   | Fixed Days  | `due_date = invoice_date + 14`                    | 2026-03-29                    |
| NET30   | Fixed Days  | `due_date = invoice_date + 30`                    | 2026-04-14                    |
| NET45   | Fixed Days  | `due_date = invoice_date + 45`                    | 2026-04-29                    |
| NET60   | Fixed Days  | `due_date = invoice_date + 60`                    | 2026-05-14                    |
| NET90   | Fixed Days  | `due_date = invoice_date + 90`                    | 2026-06-13                    |
| EOM     | End of Month| `due_date = LAST_DAY(invoice_date)`               | 2026-03-31                    |
| EOM+15  | EOM + Days  | `due_date = LAST_DAY(invoice_date) + 15`          | 2026-04-15                    |
| EOM+30  | EOM + Days  | `due_date = LAST_DAY(invoice_date) + 30`          | 2026-04-30                    |
| EOM+60  | EOM + Days  | `due_date = LAST_DAY(invoice_date) + 60`          | 2026-05-30                    |
| COD     | Cash        | `due_date = invoice_date`                         | 2026-03-15                    |
| PREPAID | Prepaid     | `due_date = NULL`（须在发货前收款）                  | N/A                          |
| CIA     | Cash in Adv.| `due_date = invoice_date - days` (提前 N 天)       | 视配置而定                     |

### 4.3 账期业务规则

> **BR-PT-001 — 默认账期**
> 每个客户 **有且仅有一个** 默认账期（`payment_term_id`）。发票创建时自动带入此账期并计算到期日。

> **BR-PT-002 — 发票层面覆盖**
> 用户可在发票层面覆盖默认账期（需 `AR Supervisor+` 权限）。系统记录覆盖动作到审计日志：
> - 覆盖人
> - 覆盖原因（必填文本）
> - 原始账期 vs 新账期

> **BR-PT-003 — 日历日规则**
> 到期日按 **日历日（Calendar Days）** 计算，**不排除** 周末或公共假期。
> 理由：应收账款的到期日是合同义务日期，不受工作日影响。

> **BR-PT-004 — PREPAID 特殊处理**
> - `PREPAID` 账期的客户，发票过账时系统自动检查：
>   ```
>   IF customer.payment_term = 'PREPAID' THEN
>       available_advance = SUM(receipts.unallocated_amount WHERE customer_id = :id)
>       IF available_advance < invoice_total THEN
>           DISPLAY warning: "该客户为预付账期，当前预收款余额不足。
>               预收余额: {available_advance}
>               发票金额: {invoice_total}
>               差额: {shortfall}"
>           // 允许过账但强制弹出警告
>       END IF
>   END IF
>   ```

> **BR-PT-005 — 账期维护权限**
> PaymentTerms 配置表仅由 **System Admin** 维护。任何新增、修改、停用操作均记录审计日志。

---

## 5. 会计映射 (Account Mapping)

### 5.1 客户-科目关联模型

每个客户须关联以下总账科目（General Ledger Accounts）。这些科目在发票过账、收款过账、坏账核销等场景中自动引用：

| # | 映射科目                 | 字段代码             | 用途                                 | 默认值示例                  |
|---|------------------------|---------------------|-------------------------------------|-----------------------------|
| 1 | 应收账款控制科目          | `ar_control_acct`   | 发票过账 Dr / 收款过账 Cr             | 1100-001 (Trade Receivable)  |
| 2 | 默认收入科目              | `revenue_acct`      | 发票过账 Cr（发票行项可覆盖）           | 4000-001 (Sales Revenue)     |
| 3 | 销项税科目               | `tax_output_acct`   | 发票过账 Cr（SST/GST Output）         | 2200-001 (SST/GST Payable)   |
| 4 | 折扣科目                 | `discount_acct`     | 核销时的现金折扣/商业折扣处理           | 6100-001 (Sales Discount)    |
| 5 | 坏账费用科目              | `bad_debt_acct`     | 坏账核销 Dr                          | 6200-001 (Bad Debt Expense)  |
| 6 | 坏账准备科目              | `allowance_acct`    | 计提坏账准备 Cr（MFRS 9 ECL 模型）    | 1100-099 (Allowance for Doubtful) |
| 7 | 汇兑损益科目 - 收益       | `forex_gain_acct`   | 多币种核销时的汇兑收益 Cr              | 7000-001 (Forex Gain)        |
| 8 | 汇兑损益科目 - 损失       | `forex_loss_acct`   | 多币种核销时的汇兑损失 Dr              | 7100-001 (Forex Loss)        |

### 5.2 科目映射优先级（Fallback 机制）

系统在确定过账科目时，按以下优先级查找：

```
1. 发票行项层面指定的科目（最高优先级）
       ↓ 未设置时
2. 客户主数据层面的默认科目
       ↓ 未设置时
3. 客户类型（Customer Type）对应的默认科目
       ↓ 未设置时
4. AR 模块全局默认科目（最低优先级，系统设置界面配置）
```

### 5.3 按客户类型的科目映射矩阵

| 客户类型        | AR Control Account        | Revenue Account           | 说明                      |
|----------------|--------------------------|--------------------------|---------------------------|
| Corporate      | 1100-001 Trade AR         | 4000-001 Sales Revenue    | 标准贸易应收               |
| Individual     | 1100-001 Trade AR         | 4000-001 Sales Revenue    | 同 Corporate               |
| Government     | 1100-003 Government AR    | 4000-003 Govt Revenue     | 政府客户独立追踪            |
| Intercompany   | 1100-002 Intercompany AR  | 4000-002 IC Revenue       | 关联公司交易需独立披露       |

### 5.4 映射业务规则

> **BR-AM-001**: 如果客户、客户类型、全局默认三个层级均未设置 AR Control Account，系统 **阻止** 该客户的发票过账，并报错："缺少应收账款控制科目配置。"

> **BR-AM-002**: 科目映射变更 **不追溯** 已过账凭证。仅影响变更后的新交易。已过账凭证永久保留原始科目信息。

> **BR-AM-003**: Intercompany 类型客户的所有交易必须使用独立的 AR 控制科目（1100-002），以满足关联方交易披露要求（MFRS 124）。

> **BR-AM-004**: 系统在客户主数据保存时校验所引用的 GL 科目是否存在且状态为 Active。引用已关闭的科目时报错。

---

## 6. 客户主数据变更管理

### 6.1 变更审计日志 (Change Log)

所有客户主数据的字段变更均自动记录：

| 字段               | 说明                          |
|-------------------|-------------------------------|
| `log_id`          | 日志唯一 ID                    |
| `customer_id`     | 被变更的客户                    |
| `field_name`      | 变更字段名                     |
| `old_value`       | 变更前的值                     |
| `new_value`       | 变更后的值                     |
| `changed_by`      | 变更人                         |
| `changed_date`    | 变更时间                       |
| `change_reason`   | 变更原因（敏感字段必填）         |

### 6.2 敏感字段变更审批

以下字段变更须经过审批流程：

| 字段                  | 审批人            | 说明                               |
|----------------------|------------------|------------------------------------|
| `credit_limit`       | AR Supervisor+   | 见 BR-CM-002                       |
| `credit_rating`      | Finance Manager  | 评级变更影响交易权限                  |
| `status` (→ Blocked) | Finance Manager  | 冻结客户影响全部交易                  |
| `ar_control_acct`    | Finance Manager  | 影响会计分录的科目归属                |
| `payment_term_id`    | AR Supervisor+   | 影响到期日计算和信用控制              |

---

## 7. 接口与集成点

| 集成模块                 | 数据流向         | 说明                                        |
|------------------------|-----------------|---------------------------------------------|
| Sales Order (SO)       | SO → AR         | 销售订单确认后自动创建 AR 发票草稿              |
| General Ledger (GL)    | AR → GL         | 发票/收款过账时推送会计分录                     |
| Inventory / Delivery   | Delivery → AR   | 发货确认后触发发票生成                          |
| Bank Reconciliation    | Bank → AR       | 银行对账后自动匹配收款记录                      |
| e-Invoice (MyInvois)   | AR → LHDN       | 马来西亚电子发票合规提交                        |

---

*— 第一部分完 —*
