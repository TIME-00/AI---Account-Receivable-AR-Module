# ============================================================================
# Sprint F4 Phase B API Smoke Test - XLSX Invoice Import, Draft Only
# ============================================================================
# Required environment variables:
#   SUPABASE_URL
#   SUPABASE_ANON_KEY
#   AR_TOKEN
#   COMPANY_ID
#   CUSTOMER_CODE
# Optional:
#   IMPORT_CURRENCY   default: SGD
#
# Before running:
#   1. Run database/009_import_excel_storage_update.sql on staging.
#   2. Deploy the updated imports Edge Function to staging.
#   3. Set CUSTOMER_CODE to a real customer visible to the AR user.
# ============================================================================

$ErrorActionPreference = "Stop"

if (-not $env:SUPABASE_URL) { throw "SUPABASE_URL is required" }
if (-not $env:SUPABASE_ANON_KEY) { throw "SUPABASE_ANON_KEY is required" }
if (-not $env:AR_TOKEN) { throw "AR_TOKEN is required" }
if (-not $env:COMPANY_ID) { throw "COMPANY_ID is required" }
if (-not $env:CUSTOMER_CODE) { throw "CUSTOMER_CODE is required" }

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$generatedDir = Join-Path $root "tests\fixtures\generated"
$generator = Join-Path $root "tests\fixtures\phase-b-generate-xlsx-fixtures.ps1"
$currency = if ($env:IMPORT_CURRENCY) { $env:IMPORT_CURRENCY } else { "SGD" }

& $generator -OutputDir $generatedDir -CustomerCode $env:CUSTOMER_CODE -Currency $currency | Out-Host

$baseUrl = "$($env:SUPABASE_URL.TrimEnd('/'))/functions/v1/imports"
$restUrl = "$($env:SUPABASE_URL.TrimEnd('/'))/rest/v1"

function Invoke-ImportApi {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Url
  )

  $headers = @{
    Authorization = "Bearer $env:AR_TOKEN"
    apikey = $env:SUPABASE_ANON_KEY
    "X-Company-Id" = $env:COMPANY_ID
  }

  Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers
}

function Invoke-RestGet {
  param([Parameter(Mandatory = $true)][string]$Path)

  $headers = @{
    Authorization = "Bearer $env:AR_TOKEN"
    apikey = $env:SUPABASE_ANON_KEY
  }

  Invoke-RestMethod -Method GET -Uri "$restUrl/$Path" -Headers $headers
}

function Upload-Xlsx {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$BatchName
  )

  curl.exe -sS -X POST "$baseUrl/upload" `
    -H "Authorization: Bearer $env:AR_TOKEN" `
    -H "apikey: $env:SUPABASE_ANON_KEY" `
    -H "X-Company-Id: $env:COMPANY_ID" `
    -F "file=@$Path;type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" `
    -F "import_type=invoice" `
    -F "file_type=xlsx" `
    -F "batch_name=$BatchName" | ConvertFrom-Json
}

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

Write-Host "Uploading valid XLSX..."
$validUpload = Upload-Xlsx -Path (Join-Path $generatedDir "phase-b-valid-invoice.xlsx") -BatchName "F4 Phase B Smoke Valid"
Assert-True $validUpload.success "Valid XLSX upload failed"
$batchId = $validUpload.data.id
Assert-True ($validUpload.data.file_type -eq "xlsx") "Expected batch file_type=xlsx"
Write-Host "Batch: $batchId"

Write-Host "Parsing valid XLSX..."
$parse = Invoke-ImportApi -Method POST -Url "$baseUrl/$batchId/parse"
Assert-True $parse.success "XLSX parse failed"
Assert-True ($parse.data.rows.Count -ge 2) "Expected at least 2 parsed rows"

Write-Host "Validating valid XLSX..."
$validate = Invoke-ImportApi -Method POST -Url "$baseUrl/$batchId/validate"
Assert-True $validate.success "XLSX validate failed"
Assert-True ($validate.data.batch.valid_rows -ge 2) "Expected valid rows"
Assert-True ($validate.data.batch.error_rows -eq 0) "Expected zero validation errors"

Write-Host "Executing draft-only invoice creation..."
$execute = Invoke-ImportApi -Method POST -Url "$baseUrl/$batchId/execute"
Assert-True $execute.success "XLSX execute failed"
Assert-True ($execute.data.batch.created_count -ge 1) "Expected draft invoices created"
Assert-True ($execute.data.batch.posted_count -eq 0) "Phase B must not post invoices"
Assert-True ($execute.data.batch.allocated_count -eq 0) "Phase B must not allocate"

$rows = Invoke-ImportApi -Method GET -Url "$baseUrl/$batchId/rows"
Assert-True $rows.success "Rows fetch failed"
$createdRows = @($rows.data | Where-Object { $_.status -eq "Created" -and $_.invoice_id })
Assert-True ($createdRows.Count -ge 1) "Expected Created rows with invoice_id"
Assert-True (-not ($rows.data | Where-Object { $_.receipt_id })) "Phase B must not set receipt_id"

foreach ($row in $createdRows) {
  $invoice = @(Invoke-RestGet -Path "invoices?id=eq.$($row.invoice_id)&select=id,status,posted_at")
  Assert-True ($invoice.Count -eq 1) "Created invoice not visible through REST: $($row.invoice_id)"
  Assert-True ($invoice[0].status -eq "Draft") "Created invoice must remain Draft"
  Assert-True ($null -eq $invoice[0].posted_at) "Created invoice posted_at must be null"

  $jesRaw = Invoke-RestGet -Path "journal_entries?source_type=eq.INV&source_doc_id=eq.$($row.invoice_id)&select=id"
  $jes = @($jesRaw | Where-Object { $_ })
  Assert-True ($jes.Count -eq 0) "No invoice journal entries should be created for imported draft invoice $($row.invoice_id)"
}

Write-Host "Uploading invalid XLSX..."
$badUpload = Upload-Xlsx -Path (Join-Path $generatedDir "phase-b-invalid-invoice.xlsx") -BatchName "F4 Phase B Smoke Invalid"
Assert-True $badUpload.success "Invalid XLSX upload failed"
$badBatchId = $badUpload.data.id
$badParse = Invoke-ImportApi -Method POST -Url "$baseUrl/$badBatchId/parse"
Assert-True $badParse.success "Invalid XLSX parse failed"
$badValidate = Invoke-ImportApi -Method POST -Url "$baseUrl/$badBatchId/validate"
Assert-True $badValidate.success "Invalid XLSX validate failed"
Assert-True ($badValidate.data.batch.error_rows -ge 1) "Expected validation errors for invalid XLSX"

Write-Host "Checking date serial XLSX..."
$dateUpload = Upload-Xlsx -Path (Join-Path $generatedDir "phase-b-date-serial.xlsx") -BatchName "F4 Phase B Date Serial"
Assert-True $dateUpload.success "Date serial upload failed"
$dateParse = Invoke-ImportApi -Method POST -Url "$baseUrl/$($dateUpload.data.id)/parse"
$dateRows = @($dateParse.data.rows)
Assert-True ($dateRows[0].raw_data.invoice_date -eq "2026-05-28") "Expected date serial 46170 to become 2026-05-28"

Write-Host "Checking numeric cell XLSX..."
$numUpload = Upload-Xlsx -Path (Join-Path $generatedDir "phase-b-numeric-cells.xlsx") -BatchName "F4 Phase B Numeric Cells"
Assert-True $numUpload.success "Numeric cells upload failed"
$numParse = Invoke-ImportApi -Method POST -Url "$baseUrl/$($numUpload.data.id)/parse"
$numRows = @($numParse.data.rows)
Assert-True ($numRows[0].raw_data.quantity -eq "3") "Expected quantity numeric cell to normalize to 3"
Assert-True ($numRows[0].raw_data.unit_price -eq "2.75") "Expected unit_price numeric cell to normalize to 2.75"

Write-Host "PASS: Sprint F4 Phase B XLSX import API smoke test completed."
