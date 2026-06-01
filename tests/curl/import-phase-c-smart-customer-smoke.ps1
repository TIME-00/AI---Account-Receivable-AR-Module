# ============================================================================
# Sprint F4 Phase C API Smoke Test - Smart Invoice Import, Draft Only
# ============================================================================
# Required environment variables:
#   SUPABASE_URL
#   SUPABASE_ANON_KEY
#   AR_TOKEN
#   COMPANY_ID
#   CUSTOMER_CODE       visible existing customer code for regression coverage
#
# Before running:
#   1. Apply database/010, database/011 and database/012 migrations on staging.
#   2. Deploy the updated customers and imports Edge Functions to staging.
# ============================================================================

$ErrorActionPreference = "Stop"

foreach ($name in @("SUPABASE_URL", "SUPABASE_ANON_KEY", "AR_TOKEN", "COMPANY_ID", "CUSTOMER_CODE")) {
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
    -F "import_type=invoice" `
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

function Assert-DraftOnlyRows {
  param([object[]]$Rows)
  foreach ($row in @($Rows | Where-Object { $_.status -eq "Created" -and $_.invoice_id })) {
    $invoice = @(Invoke-RestGet -Path "invoices?id=eq.$($row.invoice_id)&select=id,status,posted_at")
    Assert-True ($invoice.Count -eq 1) "Created invoice not visible: $($row.invoice_id)"
    Assert-True ($invoice[0].status -eq "Draft") "Imported invoice must remain Draft"
    Assert-True ($null -eq $invoice[0].posted_at) "Imported draft invoice posted_at must be null"
    $jesRaw = Invoke-RestGet -Path "journal_entries?source_type=eq.INV&source_doc_id=eq.$($row.invoice_id)&select=id"
    $jes = @($jesRaw | Where-Object { $_ })
    Assert-True ($jes.Count -eq 0) "Imported draft invoice must not create journal entries"
    Assert-True ($null -eq $row.receipt_id) "Phase C must not set receipt_id"
  }
}

$existingCsv = New-GeneratedCsv "import-phase-c-existing-customer.csv"
$newCsv = New-GeneratedCsv "import-phase-c-new-customer.csv"
$invalidCsv = New-GeneratedCsv "import-phase-c-invalid-missing-customer.csv"
$unknownCodeCsv = New-GeneratedCsv "import-phase-c-unknown-customer-code.csv"
$duplicateCsv = New-GeneratedCsv "import-phase-c-duplicate-new-customer.csv"

Write-Host "Checking existing customer_code CSV..."
$existingValidation = Parse-And-Validate (Upload-File $existingCsv "csv" "F4 Phase C Existing CSV $runId")
Assert-True ($existingValidation.data.rows[0].mapped_data.customer_resolution.action -eq "Matched Existing") "Expected Matched Existing action"
$existingExecute = Invoke-ImportApi -Method POST -Url "$baseUrl/$($existingValidation.data.batch.id)/execute"
Assert-True ($existingExecute.data.batch.matched_customers_count -ge 1) "Expected matched customer count"
Assert-DraftOnlyRows @($existingExecute.data.rows)

Write-Host "Checking new customer CSV..."
$newValidation = Parse-And-Validate (Upload-File $newCsv "csv" "F4 Phase C New CSV $runId")
Assert-True ($newValidation.data.rows[0].mapped_data.customer_resolution.action -eq "Create New") "Expected Create New action"
$newExecute = Invoke-ImportApi -Method POST -Url "$baseUrl/$($newValidation.data.batch.id)/execute"
Assert-True ($newExecute.data.batch.created_customers_count -eq 1) "Expected one created customer"
Assert-True ($newExecute.data.batch.created_count -eq 1) "Expected one draft invoice"
Assert-True ($newExecute.data.batch.posted_count -eq 0) "Phase C must not post"
Assert-True ($newExecute.data.batch.allocated_count -eq 0) "Phase C must not allocate"
Assert-DraftOnlyRows @($newExecute.data.rows)

Write-Host "Checking duplicate new customer CSV..."
$duplicateValidation = Parse-And-Validate (Upload-File $duplicateCsv "csv" "F4 Phase C Duplicate CSV $runId")
Assert-True ($duplicateValidation.data.batch.valid_rows -eq 2) "Expected two valid duplicate-name rows"
$duplicateExecute = Invoke-ImportApi -Method POST -Url "$baseUrl/$($duplicateValidation.data.batch.id)/execute"
Assert-True ($duplicateExecute.data.batch.created_customers_count -eq 1) "Duplicate-name rows must create one customer"
Assert-True ($duplicateExecute.data.batch.created_count -eq 2) "Duplicate-name rows must create two draft invoices"
Assert-DraftOnlyRows @($duplicateExecute.data.rows)

Write-Host "Checking invalid missing-customer CSV..."
$invalidValidation = Parse-And-Validate (Upload-File $invalidCsv "csv" "F4 Phase C Invalid CSV $runId")
Assert-True ($invalidValidation.data.batch.error_rows -ge 1) "Expected missing-customer validation error"

Write-Host "Checking unknown customer_code CSV..."
$unknownCodeValidation = Parse-And-Validate (Upload-File $unknownCodeCsv "csv" "F4 Phase C Unknown Code CSV $runId")
Assert-True ($unknownCodeValidation.data.batch.error_rows -ge 1) "Expected unknown customer_code validation error"

Write-Host "Generating and checking new customer XLSX..."
$generator = Join-Path $root "tests\fixtures\phase-b-generate-xlsx-fixtures.ps1"
& $generator -OutputDir $generatedDir -CustomerCode $env:CUSTOMER_CODE -Currency "SGD" -RunId $runId | Out-Host
$newXlsx = Join-Path $generatedDir "phase-c-new-customer.xlsx"
$xlsxValidation = Parse-And-Validate (Upload-File $newXlsx "xlsx" "F4 Phase C New XLSX $runId")
Assert-True ($xlsxValidation.data.rows[0].mapped_data.customer_resolution.action -eq "Create New") "Expected XLSX Create New action"
$xlsxExecute = Invoke-ImportApi -Method POST -Url "$baseUrl/$($xlsxValidation.data.batch.id)/execute"
Assert-True ($xlsxExecute.data.batch.created_customers_count -eq 1) "Expected one XLSX-created customer"
Assert-DraftOnlyRows @($xlsxExecute.data.rows)

Write-Host "Checking invalid missing-customer XLSX..."
$invalidXlsx = Join-Path $generatedDir "phase-c-invalid-missing-customer.xlsx"
$invalidXlsxValidation = Parse-And-Validate (Upload-File $invalidXlsx "xlsx" "F4 Phase C Invalid XLSX $runId")
Assert-True ($invalidXlsxValidation.data.batch.error_rows -ge 1) "Expected XLSX missing-customer validation error"

Write-Host "PASS: Sprint F4 Phase C smart customer invoice import smoke test completed."
