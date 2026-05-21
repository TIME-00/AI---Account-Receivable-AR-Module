# TSH Synergy — AR 模块功能规格书
# 第三部分：收款与核销逻辑 (Receipt & Reconciliation)

| 项目         | 详情                                      |
|-------------|------------------------------------------|
| **文档编号** | PRD-AR-003                               |
| **版本**     | v1.0 Draft                               |
| **日期**     | 2026-03-29                               |
| **关联文档** | PRD-AR-001 (客户主数据), PRD-AR-002 (发票管理) |

---

## 1. 模块概述

收款与核销是 AR 模块中 **业务逻辑最复杂** 的子模块。它负责：
- 录入和管理客户付款记录
- 将收款精确分配至一张或多张发票（核销/冲账）
- 处理部分收款、溢缴款、预收款等复杂场景
- 支持手动和自动两种核销模式
- 处理多币种收款的汇兑损益

### 1.1 设计原则

1. **总账与子账分离**：收款过账在总账（GL）层面完成会计分录（Dr. Bank, Cr. AR）。核销（Allocation）是 **子账簿**（Subledger）操作，仅更新发票和收款的状态/余额，**不产生额外总账分录**。
2. **灵活性**：支持一笔收款核销多张发票（1:N）、多笔收款核销一张发票（N:1）、以及 N:M 的复杂核销。
3. **可逆性**：所有核销操作可反核销（De-allocate），但需审批权限。
4. **实时性**：核销完成后，发票 Outstanding、客户信用使用率、账龄数据 **实时更新**。

---

## 2. 收款数据模型

### 2.1 收款头 (Receipt Header — `receipts` 表)

| # | 字段名称              | 字段代码              | 数据类型       | 必填 | 默认值    | 说明                                              |
|---|----------------------|----------------------|---------------|------|----------|--------------------------------------------------|
| 1 | 收款编号              | `receipt_no`         | VARCHAR(20)   | 是   | 自动生成  | 格式：`RCT-YYYYMM-NNNNN`，不可修改                  |
| 2 | 收款日期              | `receipt_date`       | DATE          | 是   | 当天     | 实际收款日期，须在已开放的财务期间内                    |
| 3 | 入账日期              | `value_date`         | DATE          | 否   | 同收款日  | 银行实际入账日期（支票可能有清算日差异）                |
| 4 | 客户编号              | `customer_id`        | FK            | 是   | —        | 引用客户主数据                                      |
| 5 | 客户名称（快照）       | `customer_name`      | VARCHAR(200)  | 是   | 自动带入  | 过账时快照                                          |
| 6 | 收款方式              | `payment_method`     | ENUM          | 是   | —        | 见 2.2 收款方式详情                                  |
| 7 | 收款币种              | `currency`           | CHAR(3)       | 是   | 客户默认  | ISO 4217                                           |
| 8 | 汇率                  | `exchange_rate`      | DECIMAL(12,6) | 是   | 1.000000 | 外币收款时的汇率                                     |
| 9 | 本位币                | `base_currency`      | CHAR(3)       | 是   | 系统设置  | 公司本位币                                          |
| 10| 收款金额（交易币种）   | `receipt_amount`     | DECIMAL(18,2) | 是   | —        | 客户支付的金额（交易币种）                             |
| 11| 收款金额（本位币）     | `base_amount`        | DECIMAL(18,2) | 是   | 自动计算  | `= receipt_amount × exchange_rate`                  |
| 12| 已核销金额            | `allocated_amount`   | DECIMAL(18,2) | 是   | 0.00     | 系统维护，已分配至发票的金额合计                       |
| 13| 未核销金额            | `unallocated_amount` | DECIMAL(18,2) | 是   | 同收款额  | `= receipt_amount - allocated_amount`               |
| 14| 入账银行账户          | `bank_account_id`    | FK            | 是   | —        | 引用银行账户主数据                                    |
| 15| 银行账户名称（快照）   | `bank_account_name`  | VARCHAR(100)  | 是   | 自动带入  | 过账时快照                                           |
| 16| 参考号                | `reference_no`       | VARCHAR(50)   | 否   | —        | 支票号 / 电汇参考号 / 交易凭证号                      |
| 17| 支票到期日            | `cheque_date`        | DATE          | 否   | —        | 仅支票方式必填                                       |
| 18| 收款状态              | `status`             | ENUM          | 是   | Draft    | 见 2.3 状态机                                       |
| 19| 过账期间              | `posting_period`     | VARCHAR(7)    | 是   | 自动     | 格式 `YYYY-MM`                                      |
| 20| 备注                  | `remarks`            | TEXT          | 否   | —        | 内部备注                                             |
| 21| 创建人                | `created_by`         | VARCHAR(50)   | 是   | 系统     | 系统自动                                             |
| 22| 创建时间              | `created_date`       | DATETIME      | 是   | 系统     | 系统自动                                             |
| 23| 过账人                | `posted_by`          | VARCHAR(50)   | 否   | —        | 过账时填入                                           |
| 24| 过账时间              | `posted_date`        | DATETIME      | 否   | —        | 过账时填入                                           |

### 2.2 收款方式详情 (Payment Methods)

| 代码   | 名称                  | 附加必填字段                     | 会计处理说明                               |
|-------|-----------------------|--------------------------------|-------------------------------------------|
| CHQ   | Cheque (支票)          | `reference_no` (支票号), `cheque_date` (支票到期日) | 入账科目：待清算支票科目 → 支票清算后转银行科目 |
| TT    | Telegraphic Transfer   | `reference_no` (汇款参考号)     | 直接入账银行科目                             |
| CASH  | Cash (现金)            | —                              | 入账现金科目                                 |
| CC    | Credit Card (信用卡)   | `reference_no` (授权号)         | 入账信用卡待结算科目                          |
| GIRO  | Direct Debit / GIRO    | `reference_no` (GIRO 参考号)    | 直接入账银行科目                             |
| OFST  | Offset / Contra (对冲) | 关联 AP 凭证号                   | 不涉及银行，AR/AP 直接对冲                    |
| ONLN  | Online Payment         | `reference_no` (交易 ID)        | 入账第三方支付待结算科目                      |

### 2.2.1 支票特殊处理

> **BR-RCT-CHQ-001 — 支票两阶段入账**
>
> 支票收款采用两阶段入账模式：
>
> **阶段一：收到支票（过账时）**
> ```
> Dr. 1050-001 Cheques on Hand (待清算支票)    RM xx,xxx
>     Cr. 1100-001 AR Control Account          RM xx,xxx
> ```
>
> **阶段二：支票入账银行（清算时）**
> ```
> Dr. 1000-001 Bank Account                   RM xx,xxx
>     Cr. 1050-001 Cheques on Hand             RM xx,xxx
> ```
>
> **支票退票（Dishonoured Cheque）：**
> ```
> Dr. 1100-001 AR Control Account             RM xx,xxx
>     Cr. 1050-001 Cheques on Hand             RM xx,xxx
> ```
> 退票后：收款状态 → `Bounced`，已核销的发票自动反核销；客户信用状态触发复审。

### 2.3 收款状态机

```
┌──────────┐    过账 (Post)    ┌──────────┐
│  Draft   │ ────────────────►│  Posted  │
│  (草稿)  │                  │ (已过账)  │
└────┬─────┘                  └──┬───┬───┘
     │                           │   │
     │ 删除                 核销  │   │ 全额核销
     ▼                      部分  │   │
  [物理删除]                      │   │
                                 │   ▼
                                 │  ┌──────────────┐
                                 │  │ Fully        │
                                 │  │ Allocated    │
                                 │  │ (全额已分配)   │
                                 │  └──────────────┘
                                 │
                                 │  作废（需审批）
                                 ▼
                          ┌────────────┐
                          │ Cancelled  │
                          │ (已作废)    │
                          └────────────┘

  ※ 支票专用状态：
  Posted ──► Bounced (退票) ──► [自动反核销 + 恢复发票余额]
```

| # | 源状态    | 目标状态          | 触发条件                          | 操作角色       |
|---|----------|------------------|----------------------------------|---------------|
| 1 | Draft    | Posted           | 用户过账，通过校验                  | AR Clerk+     |
| 2 | Draft    | [物理删除]        | 用户删除                           | AR Clerk+     |
| 3 | Posted   | Fully Allocated  | `unallocated_amount = 0`          | 系统自动       |
| 4 | Posted   | Cancelled        | 用户作废（无核销记录时）             | AR Supervisor+|
| 5 | Posted   | Bounced          | 支票退票处理                        | AR Supervisor+|
| 6 | Bounced  | —                | 终态                               | —             |

### 2.4 收款过账校验

> **BR-RCT-001 — 过账前校验清单**
>
> | 校验项               | 校验逻辑                                        | 失败行为 |
> |---------------------|------------------------------------------------|---------|
> | 收款金额             | `receipt_amount > 0`                            | 硬阻断   |
> | 客户存在性           | `customer_id` 在客户表中存在且状态 ≠ Inactive     | 硬阻断   |
> | 银行账户             | `bank_account_id` 存在且状态 Active               | 硬阻断   |
> | 财务期间             | `posting_period` 在已开放的财务期间内              | 硬阻断   |
> | 收款日期             | `receipt_date ≤ CURRENT_DATE`（不允许未来日期）    | 硬阻断   |
> | 支票附加字段          | 如 `payment_method = CHQ`：`reference_no` 和 `cheque_date` 必填 | 硬阻断 |
> | 币种匹配             | `currency` 须为系统支持的币种                     | 硬阻断   |
> | 外币汇率             | 如 `currency ≠ base_currency`：`exchange_rate > 0` | 硬阻断  |

---

## 3. 核销数据模型 (Allocation Detail)

### 3.1 核销明细表 (`allocation_details`)

| # | 字段名称             | 字段代码             | 数据类型       | 说明                                        |
|---|---------------------|---------------------|---------------|---------------------------------------------|
| 1 | 核销ID              | `allocation_id`      | BIGINT (PK)   | 系统自增                                     |
| 2 | 收款编号             | `receipt_no`         | FK            | 引用收款表                                    |
| 3 | 发票编号             | `invoice_no`         | FK            | 引用发票表（含 Invoice / CN / DN）             |
| 4 | 凭证类型             | `doc_type`           | ENUM          | `Invoice` / `Credit Note` / `Debit Note`     |
| 5 | 核销金额（交易币种）  | `allocated_amount`   | DECIMAL(18,2) | 本次核销金额                                  |
| 6 | 核销金额（本位币）    | `base_allocated`     | DECIMAL(18,2) | `= allocated_amount × receipt.exchange_rate`  |
| 7 | 发票原始汇率          | `invoice_rate`       | DECIMAL(12,6) | 发票过账时的汇率                               |
| 8 | 收款汇率             | `receipt_rate`       | DECIMAL(12,6) | 收款过账时的汇率                               |
| 9 | 汇兑损益金额          | `forex_gain_loss`    | DECIMAL(18,2) | 系统计算，正数=收益，负数=损失                  |
| 10| 折扣金额             | `discount_amount`    | DECIMAL(18,2) | 核销时给予的现金折扣（如有）                    |
| 11| 核销日期             | `allocation_date`    | DATETIME      | 核销操作时间                                  |
| 12| 核销人               | `allocated_by`       | VARCHAR(50)   | 操作人                                       |
| 13| 核销方式             | `allocation_method`  | ENUM          | `Manual` / `Auto_FIFO` / `Auto_Amount`       |
| 14| 状态                 | `status`             | ENUM          | `Active` / `Reversed`                        |
| 15| 反核销人             | `reversed_by`        | VARCHAR(50)   | 反核销操作人                                  |
| 16| 反核销日期            | `reversed_date`      | DATETIME      | 反核销时间                                    |
| 17| 反核销原因            | `reverse_reason`     | TEXT          | 反核销原因（必填）                             |

### 3.2 核销关系说明

```
receipts (1) ──────┐
                   │  1:N
                   ▼
          allocation_details
                   ▲
                   │  N:1
invoices (1) ──────┘

即：一笔收款通过 allocation_details 表与多张发票关联。
    一张发票也可被多笔收款通过此表核销。
    整体为 N:M 关系。
```

---

## 4. 手动核销 (Manual Allocation)

### 4.1 核销界面 (UI) 设计规格

```
┌─────────────────────────────────────────────────────────────────────┐
│ 收款核销 — Receipt Allocation                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌── 收款信息 ─────────────────────────────────────────────────────┐ │
│  │ Receipt No.: RCT-202603-00042    Date: 2026-03-15              │ │
│  │ Customer:    CUST-001 ABC Sdn Bhd                              │ │
│  │ Currency:    MYR                                               │ │
│  │ Receipt Amount:    RM 50,000.00                                │ │
│  │ Already Allocated: RM  0.00                                    │ │
│  │ Available to Allocate: RM 50,000.00   ← 实时更新               │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌── 操作按钮 ────────────────────────────────────────────────────┐ │
│  │ [自动分配 FIFO] [自动分配 金额匹配] [清除所有分配] [确认核销]    │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌── 待核销发票列表 ──────────────────────────────────────────────┐ │
│  │ ☐ │ Invoice No.      │ Date     │ Due Date │ Total    │ Out-  │ │
│  │   │                  │          │          │          │standing│ │
│  │───┼──────────────────┼──────────┼──────────┼──────────┼────────│ │
│  │ ☑ │ INV-202601-00015 │ 01-15    │ 02-14    │ 10,000   │ 10,000│ │
│  │   │  └─ 本次核销: [   10,000.00  ] 折扣: [    0.00   ]       │ │
│  │ ☑ │ INV-202602-00023 │ 02-10    │ 03-12    │ 25,000   │ 20,000│ │
│  │   │  └─ 本次核销: [   20,000.00  ] 折扣: [    0.00   ]       │ │
│  │ ☑ │ INV-202603-00005 │ 03-01    │ 03-31    │ 30,000   │ 30,000│ │
│  │   │  └─ 本次核销: [   20,000.00  ] 折扣: [    0.00   ]       │ │
│  │ ☐ │ INV-202603-00012 │ 03-10    │ 04-09    │ 15,000   │ 15,000│ │
│  │   │  └─ 本次核销: [        0.00  ] 折扣: [    0.00   ]       │ │
│  │───┴──────────────────┴──────────┴──────────┴──────────┴────────│ │
│  │ 本次核销合计: RM 50,000.00    折扣合计: RM 0.00                │ │
│  │ 剩余可分配:   RM      0.00                                    │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌── 其他可用贷方项目 ────────────────────────────────────────────┐ │
│  │ （此区域显示客户名下的 Credit Note / 预收款余额，可一并处理）    │ │
│  │ CN-202602-00003  │ Credit Note │ RM 2,000 │ Available          │ │
│  │ RCT-202601-00010 │ 预收款余额   │ RM 5,000 │ Available          │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 手动核销操作流程

```
1. 用户进入核销界面，选择一笔已过账收款（或从收款列表双击进入）
2. 系统自动加载该客户所有 Open / Overdue / Partially Paid 状态的发票
3. 发票按到期日升序排列（最旧的在最上方）
4. 用户勾选要核销的发票
5. 在每张发票的"本次核销金额"输入框中输入金额：
   - 默认值 = MIN(invoice.outstanding, receipt.unallocated_remaining)
   - 用户可手动修改金额（但不可超过 invoice.outstanding）
6. 系统实时校验：
   - SUM(所有行的本次核销金额) ≤ receipt.unallocated_amount
   - 每行核销金额 > 0 且 ≤ 该发票 outstanding
7. 如需给予现金折扣，在"折扣"列输入折扣金额
8. 用户点击"确认核销"
9. 系统执行核销事务（见 4.3）
```

### 4.3 核销事务处理（伪代码）

```python
def execute_allocation(receipt, allocation_lines):
    """
    receipt: 收款记录
    allocation_lines: [{invoice, amount, discount}, ...]
    """
    # ===== 前置校验 =====
    validate_receipt_is_posted(receipt)
    total_allocating = sum(line.amount + line.discount for line in allocation_lines)
    assert total_allocating <= receipt.unallocated_amount, "核销总额超过可分配金额"
    
    BEGIN TRANSACTION
    try:
        for line in allocation_lines:
            invoice = line.invoice
            amount  = line.amount
            discount = line.discount
            
            # 校验发票状态
            assert invoice.status in ('Open', 'Overdue', 'Partially Paid')
            assert amount <= invoice.outstanding
            assert amount > 0
            
            # 1. 写入核销明细表
            allocation = AllocationDetail(
                receipt_no      = receipt.receipt_no,
                invoice_no      = invoice.invoice_no,
                allocated_amount = amount,
                discount_amount  = discount,
                allocation_date  = NOW(),
                allocated_by     = CURRENT_USER,
                allocation_method = 'Manual',
                status           = 'Active'
            )
            
            # 2. 计算汇兑损益（多币种时）
            if receipt.currency != receipt.base_currency:
                base_at_invoice_rate = amount * invoice.exchange_rate
                base_at_receipt_rate = amount * receipt.exchange_rate
                allocation.forex_gain_loss = base_at_receipt_rate - base_at_invoice_rate
                # 正数 = 汇兑收益，负数 = 汇兑损失
            
            INSERT allocation
            
            # 3. 更新发票 outstanding
            invoice.outstanding = invoice.outstanding - amount - discount
            
            # 4. 更新发票状态
            if invoice.outstanding == 0:
                invoice.status = 'Paid'
            elif invoice.outstanding < invoice.total_amount:
                invoice.status = 'Partially Paid'
            
            UPDATE invoice
            
            # 5. 如有折扣，生成折扣分录
            if discount > 0:
                create_journal_entry(
                    Dr = customer.discount_acct,  amount = discount,
                    Cr = customer.ar_control_acct, amount = discount,
                    description = f"Cash discount on {invoice.invoice_no}"
                )
        
        # 6. 更新收款已核销/未核销金额
        receipt.allocated_amount += sum(line.amount for line in allocation_lines)
        receipt.unallocated_amount = receipt.receipt_amount - receipt.allocated_amount
        
        # 7. 更新收款状态
        if receipt.unallocated_amount == 0:
            receipt.status = 'Fully Allocated'
        
        UPDATE receipt
        
        # 8. 汇兑损益分录（如有）
        total_forex = sum(a.forex_gain_loss for a in allocations if a.forex_gain_loss)
        if total_forex != 0:
            if total_forex > 0:
                create_journal_entry(
                    Dr = 'AR Forex Clearing',    amount = total_forex,
                    Cr = forex_gain_acct,        amount = total_forex
                )
            else:
                create_journal_entry(
                    Dr = forex_loss_acct,        amount = abs(total_forex),
                    Cr = 'AR Forex Clearing',    amount = abs(total_forex)
                )
        
        COMMIT TRANSACTION
        
    except Exception:
        ROLLBACK TRANSACTION
        raise
```

### 4.4 核销业务规则（完整）

> **BR-REC-001 — 核销前提条件**
> - 收款状态必须为 `Posted`（已过账）
> - 发票状态必须为 `Open`、`Overdue` 或 `Partially Paid`
> - 收款和发票必须属于 **同一客户**
>
> 违反以上任何条件，系统阻止核销操作。

> **BR-REC-002 — 金额校验**
> ```
> 对于每一行核销：
>     0 < allocated_amount ≤ invoice.outstanding
>     0 ≤ discount_amount（可为零）
>     allocated_amount + discount_amount ≤ invoice.outstanding
>
> 对于整笔核销：
>     SUM(allocated_amount) ≤ receipt.unallocated_amount
>     
>     注意：折扣金额不占用收款金额。
>     即：如发票 RM 10,000，收款 RM 9,500，折扣 RM 500
>         allocated_amount = 9,500（从收款扣）
>         discount_amount  = 500（走折扣科目）
>         发票 outstanding = 10,000 - 9,500 - 500 = 0 → Paid
> ```

> **BR-REC-003 — 币种匹配规则**
> | 场景                               | 处理方式                          |
> |-----------------------------------|----------------------------------|
> | 收款币种 = 发票币种 = 本位币         | 直接核销，无汇兑损益                |
> | 收款币种 = 发票币种 ≠ 本位币         | 核销时计算汇兑损益（汇率变动）       |
> | 收款币种 ≠ 发票币种                  | **禁止自动核销**，须手动处理并明确汇率 |

> **BR-REC-004 — 核销后实时更新**
> 核销完成后，以下数据立即更新：
> 1. `invoice.outstanding`（发票未结金额）
> 2. `invoice.status`（发票状态）
> 3. `receipt.allocated_amount` / `receipt.unallocated_amount`
> 4. `receipt.status`（如全额分配则更新为 Fully Allocated）
> 5. `customer.credit_utilization`（实时重算，见 BR-CM-005）

> **BR-REC-005 — 反核销 (De-allocation)**
>
> **权限**：AR Supervisor+
>
> **操作流程**：
> 1. 用户在核销明细界面选择要反核销的记录
> 2. 系统检查：如果该反核销会导致收款状态从 `Fully Allocated` 变回 `Posted`，系统提示确认
> 3. 填写反核销原因（`reverse_reason`，必填，最少 10 字符）
> 4. 系统执行：
>    ```
>    allocation.status = 'Reversed'
>    allocation.reversed_by = CURRENT_USER
>    allocation.reversed_date = NOW()
>    
>    invoice.outstanding += allocation.allocated_amount + allocation.discount_amount
>    invoice.status = recalculate_status(invoice)  // 可能从 Paid → Open/Overdue
>    
>    receipt.allocated_amount -= allocation.allocated_amount
>    receipt.unallocated_amount += allocation.allocated_amount
>    receipt.status = 'Posted'  // 重新变为可分配状态
>    
>    // 如有折扣分录，生成反转折扣分录
>    // 如有汇兑损益分录，生成反转汇兑分录
>    ```

---

## 5. 部分收款处理 (Partial Payment) — 详细规则

### 5.1 概述

部分收款是指客户支付的金额 **小于** 其未结发票总额的情形。这是日常业务中最常见的场景之一。

### 5.2 场景分类与处理

#### 场景 A：单张发票的部分付款

```
发票：INV-001, Total = RM 10,000, Outstanding = RM 10,000
收款：RCT-001, Amount = RM 7,000

核销操作：
  将 RM 7,000 核销至 INV-001

结果：
  INV-001.outstanding = RM 3,000
  INV-001.status = 'Partially Paid'
  RCT-001.allocated = RM 7,000
  RCT-001.unallocated = RM 0
  RCT-001.status = 'Fully Allocated'
```

#### 场景 B：多张发票的部分付款（收款不足以覆盖所有发票）

```
发票列表：
  INV-001: Outstanding = RM 10,000 (Due: Feb 15)
  INV-002: Outstanding = RM  8,000 (Due: Mar 01)
  INV-003: Outstanding = RM 12,000 (Due: Mar 15)

收款：RCT-002, Amount = RM 15,000

手动分配方案（用户决定）：
  INV-001: 核销 RM 10,000（全额清账）
  INV-002: 核销 RM  5,000（部分）
  INV-003: 核销 RM      0（不分配）

结果：
  INV-001.outstanding = RM 0     → status = 'Paid'
  INV-002.outstanding = RM 3,000 → status = 'Partially Paid'
  INV-003.outstanding = RM 12,000 → status 不变
  RCT-002.unallocated = RM 0    → status = 'Fully Allocated'
```

#### 场景 C：分多次收款清账同一张发票

```
发票：INV-005, Total = RM 30,000

第一次付款（3月10日）：
  RCT-010, Amount = RM 10,000
  核销 RM 10,000 至 INV-005
  → INV-005.outstanding = RM 20,000, status = 'Partially Paid'

第二次付款（3月20日）：
  RCT-015, Amount = RM 12,000
  核销 RM 12,000 至 INV-005
  → INV-005.outstanding = RM 8,000, status = 'Partially Paid'

第三次付款（3月28日）：
  RCT-020, Amount = RM 8,000
  核销 RM 8,000 至 INV-005
  → INV-005.outstanding = RM 0, status = 'Paid'
```

### 5.3 部分收款业务规则

> **BR-PP-001 — 发票状态判定**
> ```
> IF outstanding = 0:
>     status = 'Paid'
> ELIF outstanding = total_amount:
>     status = 'Open' (或 'Overdue' 如已逾期)
> ELIF 0 < outstanding < total_amount:
>     status = 'Partially Paid'
> ```

> **BR-PP-002 — 账龄基准不变**
> 部分核销 **不影响** 发票的到期日（`due_date`）。
> 剩余 outstanding 的账龄仍以 **原始到期日** 计算。
> ```
> 示例：INV-001, due_date = 2026-02-14, outstanding = RM 3,000
> 报表日 = 2026-03-29
> Aging Days = 2026-03-29 - 2026-02-14 = 43 天 → 归入 "31-60 Days" 桶
> ```

> **BR-PP-003 — 对账单显示**
> 部分核销的发票在对账单中显示为：
> ```
> INV-001 | Invoice  | RM 10,000 |           | RM 10,000  (原始发票)
> RCT-001 | Receipt  |           | RM 7,000  | RM  3,000  (部分收款)
> ```
> 即完整展示交易流水，不隐藏已核销部分。

> **BR-PP-004 — 信用额度实时释放**
> 每次部分核销完成后，客户信用使用率 **实时减少**：
> ```
> 核销 RM 7,000 → utilization 减少 RM 7,000 → available_credit 增加 RM 7,000
> ```

> **BR-PP-005 — 部分核销的折扣处理**
> 如果账期条款包含提前付款折扣（如 "2/10 Net 30"），部分付款时：
> - 折扣仅适用于 **本次核销的金额**，而非发票全额
> - 折扣须在到期日前的折扣期内才有效
> ```
> 示例：2/10 Net 30（10 天内付款享 2% 折扣）
> INV-001: Total = RM 10,000, Due = 30 天, 折扣期 = 10 天内
>
> 第 8 天收到 RM 7,000：
>   折扣 = RM 7,000 × 2% = RM 140
>   核销金额 = RM 7,000（从收款扣）
>   折扣金额 = RM 140（走折扣科目）
>   发票 outstanding = 10,000 - 7,000 - 140 = RM 2,860
>
> 第 25 天收到剩余：
>   已超过折扣期，无折扣
>   核销金额 = RM 2,860
>   发票 outstanding = 0 → Paid
> ```

---

## 6. 溢缴款处理 (Overpayment)

### 6.1 场景与处理方案

**场景**：客户应付 RM 10,000，实际汇款 RM 12,000。

```
┌─────────────────────────────────────────────────────┐
│ 溢缴款处理决策流程                                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  收款 RM 12,000 过账                                 │
│       │                                             │
│  核销 RM 10,000 至 INV-001（发票清账）                │
│       │                                             │
│  剩余 RM 2,000 → 溢缴款                             │
│       │                                             │
│  ┌────┴────────┐                                    │
│  │ 用户选择处理方式                                   │
│  ├─────────────┼─────────────────────────────────┐  │
│  │             │                                 │  │
│  ▼             ▼                                 ▼  │
│ 方案 A        方案 B                           方案 C│
│ 保留为        退款给客户                        抵扣  │
│ 预收款                                         下一张│
│ (Credit       (创建 AP                         发票  │
│  Balance)      退款单)                              │
│  │             │                                 │  │
│  ▼             ▼                                 ▼  │
│ unallocated   创建 AP                          直接  │
│ = RM 2,000    Payment                          核销  │
│ 挂在客户       RM 2,000                        至另  │
│ 名下          退回客户                          一张  │
│               银行账户                          发票  │
└─────────────────────────────────────────────────────┘
```

### 6.2 方案 A — 保留为预收款（最常见）

> **BR-OP-001 — 预收款自动识别**
> 当收款 `unallocated_amount > 0` 且收款状态为 `Posted` 时，该余额自动视为客户 **预收款 / 贷方余额**。
> 系统无需额外操作即可将其用于后续核销。

> **BR-OP-002 — 预收款在核销界面的展示**
> 用户对该客户执行新的核销操作时，核销界面 **同时展示**：
> - ✅ 该客户所有有余额的收款单（`unallocated_amount > 0`）
> - ✅ 该客户所有未使用的 Credit Note
>
> 用户可选择用预收款余额来核销新发票。

> **BR-OP-003 — 预收款余额显示**
> 客户主数据界面的"财务摘要"区域实时显示：
> ```
> ┌── 客户财务摘要 ────────────────────────────┐
> │ 总应收余额:       RM 45,000.00              │
> │ 逾期应收余额:     RM 12,000.00              │
> │ 预收款/贷方余额:  RM  2,000.00  ← 预收款     │
> │ 信用额度:         RM 100,000.00             │
> │ 信用使用率:       RM  43,000.00 (43%)       │
> │ 可用信用余额:     RM  57,000.00             │
> └─────────────────────────────────────────────┘
> ```

### 6.3 方案 B — 退款处理

> **BR-OP-004 — 退款流程**
> 1. 用户在收款界面发起"退款申请"
> 2. 系统生成一笔 **AR 退款单**（`Refund`），关联原始收款
> 3. 退款需 Finance Manager 审批
> 4. 审批通过后，系统生成会计分录：
>    ```
>    Dr. 1100-001 AR Control Account      RM 2,000
>        Cr. 1000-001 Bank Account        RM 2,000
>    ```
> 5. 收款的 `unallocated_amount` 相应减少

### 6.4 预收款对信用额度的影响

> **BR-OP-005 — 预收款减轻信用占用**
> 预收款余额 **减少** 客户的信用使用率：
> ```
> credit_utilization =
>     SUM(outstanding invoices)
>   - SUM(unallocated receipts)    ← 预收款在此扣减
>   - SUM(unused Credit Notes)
>
> 示例：
>   未结发票: RM 50,000
>   预收款:   RM  2,000
>   →  utilization = RM 48,000 （而非 RM 50,000）
> ```

---

## 7. 自动核销算法 (Auto-Allocation Algorithms)

系统提供两种自动核销算法，用户可在核销界面通过按钮选择：

### 7.1 算法一：FIFO（先到期先核销）

**原理**：按发票到期日从早到晚排列，优先核销最先到期（最老）的发票。

**排序规则**：
```
ORDER BY due_date ASC, invoice_date ASC, invoice_no ASC
```

**完整伪代码**：
```python
def auto_allocate_fifo(receipt):
    """
    FIFO 自动核销算法
    """
    # 1. 获取可核销的发票列表
    invoices = query("""
        SELECT * FROM invoices
        WHERE customer_id = :receipt.customer_id
          AND currency = :receipt.currency          -- 同币种限制
          AND status IN ('Open', 'Overdue', 'Partially Paid')
          AND outstanding > 0
        ORDER BY due_date ASC, invoice_date ASC, invoice_no ASC
    """)
    
    remaining = receipt.unallocated_amount
    allocations = []
    
    # 2. 循环分配
    for inv in invoices:
        if remaining <= 0:
            break
        
        # 计算本次可核销金额
        allocate_amount = min(remaining, inv.outstanding)
        
        allocations.append({
            'invoice': inv,
            'amount': allocate_amount,
            'discount': 0  # FIFO 模式不自动计算折扣
        })
        
        remaining -= allocate_amount
    
    # 3. 返回分配方案（不直接执行，等待用户确认）
    return {
        'allocations': allocations,
        'total_allocated': sum(a['amount'] for a in allocations),
        'remaining_unallocated': remaining,
        'method': 'Auto_FIFO'
    }
```

**示例：**
```
收款 RM 25,000

发票列表（按 due_date 排序）：
  INV-001: due 02-14, outstanding RM 10,000 → 分配 RM 10,000 (全额)
  INV-002: due 03-01, outstanding RM  8,000 → 分配 RM  8,000 (全额)
  INV-003: due 03-15, outstanding RM 12,000 → 分配 RM  7,000 (部分，余额用尽)
  INV-004: due 04-01, outstanding RM  5,000 → 分配 RM      0 (无余额)

结果：RM 25,000 全额分配，INV-003 remaining = RM 5,000
```

### 7.2 算法二：金额匹配（Amount Matching / Best Fit）

**原理**：尝试找到一张或一组发票，其 outstanding 金额之和 **精确匹配** 收款金额，实现"零差异"核销。

**排序规则**：
```
优先级 1：精确匹配单张发票（outstanding = receipt_amount）
优先级 2：精确匹配两张发票组合
优先级 3：精确匹配三张发票组合（最多三张，避免组合爆炸）
优先级 4：如无精确匹配，回退到 FIFO 逻辑
```

**完整伪代码**：
```python
def auto_allocate_amount_match(receipt):
    """
    金额匹配自动核销算法
    尝试找到精确匹配收款金额的发票组合
    """
    target = receipt.unallocated_amount
    
    invoices = query("""
        SELECT * FROM invoices
        WHERE customer_id = :receipt.customer_id
          AND currency = :receipt.currency
          AND status IN ('Open', 'Overdue', 'Partially Paid')
          AND outstanding > 0
        ORDER BY due_date ASC
    """)
    
    # === 优先级 1：单张精确匹配 ===
    for inv in invoices:
        if inv.outstanding == target:
            return {
                'allocations': [{'invoice': inv, 'amount': target, 'discount': 0}],
                'total_allocated': target,
                'remaining_unallocated': 0,
                'method': 'Auto_Amount',
                'match_type': 'Exact_Single'
            }
    
    # === 优先级 2：两张组合精确匹配 ===
    for i in range(len(invoices)):
        for j in range(i + 1, len(invoices)):
            if invoices[i].outstanding + invoices[j].outstanding == target:
                return {
                    'allocations': [
                        {'invoice': invoices[i], 'amount': invoices[i].outstanding, 'discount': 0},
                        {'invoice': invoices[j], 'amount': invoices[j].outstanding, 'discount': 0}
                    ],
                    'total_allocated': target,
                    'remaining_unallocated': 0,
                    'method': 'Auto_Amount',
                    'match_type': 'Exact_Pair'
                }
    
    # === 优先级 3：三张组合精确匹配 ===
    for i in range(len(invoices)):
        for j in range(i + 1, len(invoices)):
            for k in range(j + 1, len(invoices)):
                total = (invoices[i].outstanding + 
                         invoices[j].outstanding + 
                         invoices[k].outstanding)
                if total == target:
                    return {
                        'allocations': [
                            {'invoice': invoices[i], 'amount': invoices[i].outstanding, 'discount': 0},
                            {'invoice': invoices[j], 'amount': invoices[j].outstanding, 'discount': 0},
                            {'invoice': invoices[k], 'amount': invoices[k].outstanding, 'discount': 0}
                        ],
                        'total_allocated': target,
                        'remaining_unallocated': 0,
                        'method': 'Auto_Amount',
                        'match_type': 'Exact_Triple'
                    }
    
    # === 优先级 4：无精确匹配，回退 FIFO ===
    return auto_allocate_fifo(receipt)  # 回退到 FIFO
```

### 7.3 算法对比

| 特性                | FIFO                        | Amount Matching              |
|--------------------|-----------------------------|------------------------------|
| 适用场景            | 通用，适合定期大额付款        | 适合客户按发票付款的场景        |
| 排序依据            | 到期日（最旧优先）            | 金额匹配度                    |
| 时间复杂度          | O(n) — 线性遍历              | O(n³) — 最多三重组合          |
| 剩余金额处理        | 可能产生部分核销              | 优先精确匹配，减少部分核销      |
| 自动折扣处理        | 否                          | 否                           |
| 跨币种支持          | 否（同币种限制）              | 否（同币种限制）               |
| 用户确认            | 需要                        | 需要                          |

### 7.4 自动核销业务规则

> **BR-AA-001 — 自动核销为可选功能**
> 用户可在核销界面选择"自动分配（FIFO）"或"自动分配（金额匹配）"，也可完全手动分配。系统不强制使用自动核销。

> **BR-AA-002 — 预览与确认**
> 自动核销算法执行后，结果 **仅显示在界面上**，不直接保存。用户可以：
> - ✅ 直接确认：按算法结果保存
> - ✏️ 手动调整：修改任意行的核销金额后再保存
> - ❌ 清除：清除所有自动分配结果，重新手动操作

> **BR-AA-003 — 同币种限制**
> 自动核销 **仅匹配相同交易币种** 的收款和发票。跨币种的核销涉及汇率转换和汇兑损益计算，必须手动处理以确保汇率准确。

> **BR-AA-004 — Credit Note 不纳入自动核销**
> 自动核销算法 **不自动处理** CN 的抵扣。原因：
> - CN 通常需要人工判断是否抵扣及抵扣到哪张发票
> - CN 可能涉及退货验收等业务确认
> - 避免自动错误抵扣导致的对账困难
>
> CN 抵扣必须由用户在核销界面的"其他贷方项目"区域手动操作。

> **BR-AA-005 — 容差阈值 (Tolerance)**
> 系统支持配置核销容差（Write-off Tolerance），用于处理微小差异：
> ```
> 系统配置：write_off_tolerance = RM 1.00（可配置）
>
> 如果自动核销后发票 outstanding ≤ tolerance：
>     系统提示："发票 {invoice_no} 剩余 RM {outstanding}，
>               是否将 RM {outstanding} 作为微小差异自动冲销？"
>     用户确认后：
>         outstanding = 0
>         status = 'Paid'
>         生成分录：Dr. Write-off Expense / Cr. AR Control（金额 = outstanding）
> ```

> **BR-AA-006 — 批量自动核销**
> 系统支持批量自动核销模式（月结时使用）：
> 1. 选择日期范围内的所有已过账未核销收款
> 2. 对每笔收款执行 FIFO 自动核销
> 3. 生成核销预览报告
> 4. 用户逐笔或批量确认
> 5. 需 AR Supervisor+ 权限

---

## 8. 收款作废与退票处理

### 8.1 收款作废

> **BR-RCT-CANCEL-001**: 仅 **无核销记录** 的收款可以作废。已有核销的收款须先全部反核销再作废。

> **BR-RCT-CANCEL-002**: 作废时须填写原因（最少 10 字符）。

> **BR-RCT-CANCEL-003**: 作废后系统自动生成反转分录：
> ```
> Dr. 1100-001 AR Control Account      RM xx,xxx
>     Cr. 1000-001 Bank Account        RM xx,xxx
> ```

### 8.2 支票退票 (Dishonoured Cheque)

> **BR-RCT-BOUNCE-001**: 支票退票处理流程：
> 1. AR Supervisor 标记收款为 `Bounced`
> 2. 系统自动反转原始收款分录
> 3. 系统自动反核销所有关联的核销记录
> 4. 被反核销的发票 outstanding 恢复，状态可能从 Paid → Open/Overdue
> 5. 系统自动触发客户信用复审标记
> 6. 发送邮件通知 Finance Manager

> **BR-RCT-BOUNCE-002**: 退票手续费处理：
> 如果银行收取退票手续费，系统支持录入手续费：
> ```
> Dr. 1100-001 AR Control Account (或 6300 退票费用)   RM 50
>     Cr. 1000-001 Bank Account                      RM 50
> ```
> 手续费可选择：
> - 转嫁给客户（计入 AR，向客户收取）
> - 公司自行承担（计入费用科目）

---

*— 第三部分完 —*
