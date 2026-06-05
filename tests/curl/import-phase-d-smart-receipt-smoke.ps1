# ============================================================================
# Sprint F4 Phase D API Smoke Test - Smart Receipt Import, Draft Only
# ============================================================================
# Required environment variables:
#   SUPABASE_URL
#   SUPABASE_ANON_KEY
#   AR_TOKEN
#   COMPANY_ID
#   CUSTOMER_CODE        visible existing customer code for regression coverage
#   BANK_ACCOUNT_CODE    active bank_accounts.account_no in the same company
#
# Before running:
#   1. Apply Phase C migration 012 if not already applied.
#   2. Deploy the updated imports, customers, and receipts Edge Functions to staging.
# ============================================================================

$ErrorActionPreference = "Stop"

foreach ($name in @("SUPABASE_URL", "SUPABASE_ANON_KEY", "AR_TOKEN", "COMPANY_ID", "CUSTOMER_CODE", "BANK_ACCOUNT_CODE")) {
  if (-not (Get-Item "env:$name" -ErrorAction SilentlyContinue).Value) { throw "$name is required" }
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$generatedDir = Join-Path $root "tests\fixtures\generated"
$runId = Get-Date -Format "yyyyMMddHHmmss"
$baseUrl = "$($env:SUPABASE_URL.TrimEnd('/'))/functions/v1/imports"
$restUrl = "$($env:SUPABASE_URL.TrimEnd('/'))/rest/v1"

New-Item -ItemType Directory -Force -Path $generatedDir | Out-Null

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Invoke-ImportApi {
  param([string]$Method, [string]$Url)
  Invoke-RestMethod -Method $Method -Uri $Url -Headers @{
    Authorization = "Bearer $env:AR_TOKEN"
    apikey = $env:SUPABASE_ANON_KEY
    "X-Company-Id" = $env:COMPANY_ID
  }
}

function Invoke-RestGet {
  param([string]$Path)
  Invoke-RestMethod -Method GET -Uri "$restUrl/$Path" -Headers @{
    Authorization = "Bearer $env:AR_TOKEN"
    apikey = $env:SUPABASE_ANON_KEY
  }
}

function New-GeneratedCsv {
  param([string]$TemplateName)
  $template = Join-Path $root "tests\fixtures\$TemplateName"
  $target = Join-Path $generatedDir $TemplateName
  $content = (Get-Content -LiteralPath $template -Raw)
    .Replace("CUST-REPLACE-001", $env:CUSTOMER_CODE)
    .Replace("BANK-ACCOUNT-REPLACE-001", $env:BANK_ACCOUNT_CODE)
    .Replace("REPLACE-RUN-ID", $runId)
    .Replace("REPLACERUNID", $runId)
  Set-Content -LiteralPath $target -Value $content -Encoding utf8
  return $target
}

function Upload-File {
  param([string]$Path, [string]$FileType, [string]$BatchName)
  $mime = if ($FileType -eq "xlsx") {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  } else {
    "text/csv"
  }
  curl.exe -sS -X POST "$baseUrl/upload" `
    -H "Authorization: Bearer $env:AR_TOKEN" `
    -H "apikey: $env:SUPABASE_ANON_KEY" `
    -H "X-Company-Id: $env:COMPANY_ID" `
    -F "file=@$Path;type=$mime" `
    -F "import_type=receipt" `
    -F "file_type=$FileType" `
    -F "batch_name=$BatchName" | ConvertFrom-Json
}

function Parse-And-Validate {
  param([object]$Upload)
  Assert-True $Upload.success "Upload failed"
  $batchId = $Upload.data.id
  $parse = Invoke-ImportApi -Method POST -Url "$baseUrl/$batchId/parse"
  Assert-True $parse.success "Parse failed for batch $batchId"
  $validate = Invoke-ImportApi -Method POST -Url "$baseUrl/$batchId/validate"
  Assert-True $validate.success "Validate failed for batch $batchId"
  return $validate
}

function Assert-DraftOnlyReceiptRows {
  param([object[]]$Rows)
  foreach ($row in @($Rows | Where-Object { $_.status -eq "Created" -and $_.receipt_id })) {
    $receipt = @(Invoke-RestGet -Path "receipts?id=eq.$($row.receipt_id)&select=id,status,posted_at,receipt_amount,allocated_amount,unallocated_amount")
    Assert-True ($receipt.Count -eq 1) "Created receipt not visible: $($row.receipt_id)"
    Assert-True ($receipt[0].status -eq "Draft") "Imported receipt must remain Draft"
    Assert-True ($null -eq $receipt[0].posted_at) "Imported draft receipt posted_at must be null"
    Assert-True ([decimal]$receipt[0].allocated_amount -eq 0) "Imported receipt allocated_amount must remain 0"
    Assert-True ([decimal]$receipt[0].unallocated_amount -eq [decimal]$receipt[0].receipt_amount) "Imported receipt unallocated_amount must equal receipt_amount"

    $allocRaw = Invoke-RestGet -Path "allocation_details?receipt_id=eq.$($row.receipt_id)&select=id"
    $allocations = @($allocRaw | Where-Object { $_ })
    Assert-True ($allocations.Count -eq 0) "Phase D must not create allocation_details"

    $jesRaw = Invoke-RestGet -Path "journal_entries?source_type=eq.RCT&source_doc_id=eq.$($row.receipt_id)&select=id"
    $jes = @($jesRaw | Where-Object { $_ })
    Assert-True ($jes.Count -eq 0) "Imported draft receipt must not create journal entries"
    Assert-True ($null -eq $row.invoice_id) "Phase D must not set invoice_id"
  }
}

$existingCsv = New-GeneratedCsv "import-phase-d-existing-customer.csv"
$newCsv = New-GeneratedCsv "import-phase-d-new-customer.csv"
$invalidCsv = New-GeneratedCsv "import-phase-d-invalid-missing-customer.csv"
$unknownCodeCsv = New-GeneratedCsv "import-phase-d-unknown-customer-code.csv"
$duplicateCsv = New-GeneratedCsv "import-phase-d-duplicate-new-customer.csv"
$chqCsv = New-GeneratedCsv "import-phase-d-chq-new-customer.csv"

Write-Host "Checking existing customer_code receipt CSV..."
$existingValidation = Parse-And-Validate (Upload-File $existingCsv "csv" "F4 Phase D Existing Receipt CSV $runId")
Assert-True ($existingValidation.data.rows[0].mapped_data.customer_resolution.action -eq "Matched Existing") "Expected Matched Existing action"
$existingExecute = Invoke-ImportApi -Method POST -Url "$baseUrl/$($existingValidation.data.batch.id)/execute"
Assert-True ($existingExecute.data.batch.matched_customers_count -ge 1) "Expected matched customer count"
Assert-DraftOnlyReceiptRows @($existingExecute.data.rows)

Write-Host "Checking new customer receipt CSV..."
$newValidation = Parse-And-Validate (Upload-File $newCsv "csv" "F4 Phase D New Receipt CSV $runId")
Assert-True ($newValidation.data.rows[0].mapped_data.customer_resolution.action -eq "Create New") "Expected Create New action"
$newExecute = Invoke-ImportApi -Method POST -Url "$baseUrl/$($newValidation.data.batch.id)/execute"
Assert-True ($newExecute.data.batch.created_customers_count -eq 1) "Expected one created customer"
Assert-True ($newExecute.data.batch.created_count -eq 1) "Expected one draft receipt"
Assert-True ($newExecute.data.batch.posted_count -eq 0) "Phase D must not post"
Assert-True ($newExecute.data.batch.allocated_count -eq 0) "Phase D must not allocate"
Assert-DraftOnlyReceiptRows @($newExecute.data.rows)

Write-Host "Checking duplicate new customer receipt CSV..."
$duplicateValidation = Parse-And-Validate (Upload-File $duplicateCsv "csv" "F4 Phase D Duplicate Receipt CSV $runId")
Assert-True ($duplicateValidation.data.batch.valid_rows -eq 2) "Expected two valid duplicate-name rows"
$duplicateExecute = Invoke-ImportApi -Method POST -Url "$baseUrl/$($duplicateValidation.data.batch.id)/execute"
Assert-True ($duplicateExecute.data.batch.created_customers_count -eq 1) "Duplicate-name rows must create one customer"
Assert-True ($duplicateExecute.data.batch.created_count -eq 2) "Duplicate-name rows must create two draft receipts"
Assert-DraftOnlyReceiptRows @($duplicateExecute.data.rows)

Write-Host "Checking CHQ receipt CSV..."
$chqValidation = Parse-And-Validate (Upload-File $chqCsv "csv" "F4 Phase D CHQ Receipt CSV $runId")
Assert-True ($chqValidation.data.rows[0].mapped_data.payment_method -eq "CHQ") "Expected CHQ payment method"
$chqExecute = Invoke-ImportApi -Method POST -Url "$baseUrl/$($chqValidation.data.batch.id)/execute"
Assert-True ($chqExecute.data.batch.created_count -eq 1) "Expected one draft CHQ receipt"
Assert-DraftOnlyReceiptRows @($chqExecute.data.rows)

Write-Host "Checking invalid missing-customer receipt CSV..."
$invalidValidation = Parse-And-Validate (Upload-File $invalidCsv "csv" "F4 Phase D Invalid Receipt CSV $runId")
Assert-True ($invalidValidation.data.batch.error_rows -ge 1) "Expected missing-customer validation error"

Write-Host "Checking unknown customer_code receipt CSV..."
$unknownCodeValidation = Parse-And-Validate (Upload-File $unknownCodeCsv "csv" "F4 Phase D Unknown Code Receipt CSV $runId")
Assert-True ($unknownCodeValidation.data.batch.error_rows -ge 1) "Expected unknown customer_code validation error"

Write-Host "Generating and checking new customer XLSX receipt..."
$generator = Join-Path $root "tests\fixtures\phase-b-generate-xlsx-fixtures.ps1"
& $generator -OutputDir $generatedDir -CustomerCode $env:CUSTOMER_CODE -BankAccountCode $env:BANK_ACCOUNT_CODE -Currency "SGD" -RunId $runId | Out-Host
$newXlsx = Join-Path $generatedDir "phase-d-new-customer.xlsx"
$xlsxValidation = Parse-And-Validate (Upload-File $newXlsx "xlsx" "F4 Phase D New Receipt XLSX $runId")
Assert-True ($xlsxValidation.data.rows[0].mapped_data.customer_resolution.action -eq "Create New") "Expected XLSX Create New action"
$xlsxExecute = Invoke-ImportApi -Method POST -Url "$baseUrl/$($xlsxValidation.data.batch.id)/execute"
Assert-True ($xlsxExecute.data.batch.created_customers_count -eq 1) "Expected one XLSX-created customer"
Assert-DraftOnlyReceiptRows @($xlsxExecute.data.rows)

Write-Host "Checking invalid missing-customer XLSX receipt..."
$invalidXlsx = Join-Path $generatedDir "phase-d-invalid-missing-customer.xlsx"
$invalidXlsxValidation = Parse-And-Validate (Upload-File $invalidXlsx "xlsx" "F4 Phase D Invalid Receipt XLSX $runId")
Assert-True ($invalidXlsxValidation.data.batch.error_rows -ge 1) "Expected XLSX missing-customer validation error"

Write-Host "PASS: Sprint F4 Phase D smart customer receipt import smoke test completed."
