# TSH Synergy AR — Supabase Edge Functions 部署指南

## 前提条件

### 1. 安装 Supabase CLI

```powershell
# Windows (PowerShell) — 推荐 scoop
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# 或使用 npm
npm install -g supabase
```

### 2. 登录 Supabase

```powershell
supabase login
```

浏览器会打开 Supabase 授权页面。完成后终端会显示 "Token saved."

### 3. 关联项目

```powershell
cd "c:\Users\kelvi\OneDrive - Raffles Education Corporation\S4\Project 1\Accounts Receivable (AR) module\backend\supabase"

# 用你的 Supabase Project Reference ID（在 Settings > General 中找到）
supabase link --project-ref <your-project-ref>
```

---

## 一键部署全部 Functions

### 方法 A：批量部署（推荐）

```powershell
# 在 backend/supabase 目录下执行
cd "c:\Users\kelvi\OneDrive - Raffles Education Corporation\S4\Project 1\Accounts Receivable (AR) module\backend\supabase"

# 部署全部 10 个 Edge Functions（一条命令）
supabase functions deploy customers
supabase functions deploy invoices
supabase functions deploy credit-notes
supabase functions deploy debit-notes
supabase functions deploy receipts
supabase functions deploy allocations
supabase functions deploy journal-entries
supabase functions deploy reports
supabase functions deploy daily-overdue
```

### 方法 B：PowerShell 一键脚本

```powershell
# 一键部署所有函数
$functions = @(
    "customers",
    "invoices",
    "credit-notes",
    "debit-notes",
    "receipts",
    "allocations",
    "reports",
    "daily-overdue"
)

foreach ($fn in $functions) {
    Write-Host "Deploying $fn..." -ForegroundColor Cyan
    supabase functions deploy $fn --no-verify-jwt
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: $fn" -ForegroundColor Red
    } else {
        Write-Host "OK: $fn" -ForegroundColor Green
    }
}
Write-Host "`nAll functions deployed!" -ForegroundColor Green
```

> **注意**：`--no-verify-jwt` 标志可在测试阶段跳过 JWT 验证。生产环境请移除此标志！

---

## 设置环境变量（Secrets）

```powershell
# 这些变量由 Supabase 自动注入，通常无需手动设置：
# - SUPABASE_URL
# - SUPABASE_ANON_KEY
# - SUPABASE_SERVICE_ROLE_KEY

# 如有自定义变量（如 CRON_SECRET），手动设置：
supabase secrets set CRON_SECRET=your-cron-secret-here
```

---

## 设置定时任务 (daily-overdue)

### 方法 A：使用 pg_cron（推荐 — Supabase 内置）

在 Supabase Dashboard > SQL Editor 中执行：

```sql
-- 启用 pg_cron 扩展（如果尚未启用）
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 每天 UTC 01:00 (MYT 09:00) 执行逾期检查
SELECT cron.schedule(
    'daily-overdue-check',           -- 任务名称
    '0 1 * * *',                     -- Cron 表达式: 每天 01:00 UTC
    $$
    SELECT net.http_post(
        url := current_setting('app.settings.service_url') || '/functions/v1/daily-overdue',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
            'X-Cron-Secret', current_setting('app.settings.cron_secret')
        ),
        body := '{}'::jsonb
    );
    $$
);
```

### 方法 B：外部 Cron（如 GitHub Actions）

```yaml
# .github/workflows/daily-overdue.yml
name: Daily Overdue Check
on:
  schedule:
    - cron: '0 1 * * *'  # 每天 UTC 01:00
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST \
            "${{ secrets.SUPABASE_URL }}/functions/v1/daily-overdue" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            -H "X-Cron-Secret: ${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json" \
            -d '{}'
```

---

## API 测试快速入门

### 基本测试格式

```powershell
# 设置变量
$BASE = "https://<your-project-ref>.supabase.co/functions/v1"
$TOKEN = "<your-anon-key-or-user-jwt>"
$COMPANY_ID = "<your-company-uuid>"

$headers = @{
    "Authorization" = "Bearer $TOKEN"
    "Content-Type"  = "application/json"
    "X-Company-Id"  = $COMPANY_ID
}
```

### 测试 1：创建客户

```powershell
$body = @{
    customer_name  = "测试客户 Sdn Bhd"
    customer_type  = "Corporate"
    registration_no = "202301012345"
    bill_addr_line1 = "123 Jalan Test"
    bill_city      = "Kuala Lumpur"
    bill_state     = "Wilayah Persekutuan"
    bill_postal    = "50000"
    bill_country   = "MY"
    contact_name   = "张三"
    contact_phone  = "+60-12-345-6789"
    contact_email  = "test@example.com"
    credit_limit   = 100000
    credit_rating  = "A"
} | ConvertTo-Json

Invoke-RestMethod -Uri "$BASE/customers" -Method POST -Headers $headers -Body $body
```

### 测试 2：创建并过账发票

```powershell
# 创建发票（含行项）
$body = @{
    doc_type     = "Invoice"
    invoice_date = "2026-03-29"
    customer_id  = "<customer-uuid>"
    currency     = "MYR"
    lines = @(
        @{
            description = "咨询服务费"
            quantity    = 10
            unit_price  = 500
            tax_code_id = "<tax-code-uuid>"
        }
    )
} | ConvertTo-Json -Depth 3

$invoice = Invoke-RestMethod -Uri "$BASE/invoices" -Method POST -Headers $headers -Body $body

# 过账
Invoke-RestMethod -Uri "$BASE/invoices/$($invoice.data.id)/post" -Method POST -Headers $headers -Body '{}'
```

### 测试 3：创建收款并核销

```powershell
# 创建收款
$body = @{
    receipt_date   = "2026-03-29"
    customer_id    = "<customer-uuid>"
    payment_method = "TT"
    currency       = "MYR"
    receipt_amount = 5300
    bank_account_id = "<bank-account-uuid>"
    reference_no   = "TT-2026-0001"
} | ConvertTo-Json

$receipt = Invoke-RestMethod -Uri "$BASE/receipts" -Method POST -Headers $headers -Body $body

# 过账
Invoke-RestMethod -Uri "$BASE/receipts/$($receipt.data.id)/post" -Method POST -Headers $headers -Body '{}'

# FIFO 自动核销
$body = @{
    receipt_id = $receipt.data.id
    method     = "FIFO"
} | ConvertTo-Json

Invoke-RestMethod -Uri "$BASE/allocations/auto" -Method POST -Headers $headers -Body $body
```

### 测试 4：查看报表

```powershell
# Dashboard
Invoke-RestMethod -Uri "$BASE/reports/dashboard" -Method GET -Headers $headers

# 账龄
Invoke-RestMethod -Uri "$BASE/reports/aging/summary" -Method GET -Headers $headers

# 客户对账单
Invoke-RestMethod -Uri "$BASE/reports/statement/<customer-uuid>?period_from=2026-01-01&period_to=2026-03-31" -Method GET -Headers $headers
```

---

## 故障排查

### 查看 Function 日志

```powershell
# 实时日志
supabase functions logs customers --tail

# 查看所有函数日志
supabase functions logs --all --tail
```

### 常见错误

| 错误码 | 原因 | 解决方案 |
|--------|------|----------|
| `AUTHENTICATION_ERROR` | JWT 缺失或过期 | 确认 Authorization header 包含有效 Bearer token |
| `AUTHORIZATION_ERROR` | 用户无此角色 | 在 `user_roles` 表中为该用户添加角色 |
| `BR-JE-007` | 财务期间未打开 | 在 `fiscal_periods` 表中确认对应期间 status = 'Open' |
| `VALIDATION_ERROR` | 请求数据格式错误 | 检查 error.details 中的字段信息 |

### 本地开发测试

```powershell
# 本地启动所有函数（需要 Docker）
supabase start
supabase functions serve --env-file .env.local

# .env.local 示例
# SUPABASE_URL=http://localhost:54321
# SUPABASE_ANON_KEY=<local-anon-key>
# SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key>
```
