# ============================================================================
# Sprint F4 Phase A API Smoke Test - CSV Invoice Import, Draft Only
# ============================================================================
# Required environment variables:
#   SUPABASE_URL
#   AR_TOKEN
#   COMPANY_ID
# Optional:
#   VALID_CSV_PATH   default: tests/fixtures/import-phase-a-valid.csv
#   INVALID_CSV_PATH default: tests/fixtures/import-phase-a-invalid.csv
#
# Before running:
#   1. Replace CUST-REPLACE-001 in tests/fixtures/import-phase-a-valid.csv
#      with a real customer_code visible to the AR user.
#   2. Ensure database/008_import_tables.sql has run on staging.
#   3. Deploy the imports Edge Function to staging.
# ============================================================================

$ErrorActionPreference = "Stop"

if (-not $env:SUPABASE_URL) { throw "SUPABASE_URL is required" }
if (-not $env:AR_TOKEN) { throw "AR_TOKEN is required" }
if (-not $env:COMPANY_ID) { throw "COMPANY_ID is required" }

$baseUrl = "$($env:SUPABASE_URL.TrimEnd('/'))/functions/v1/imports"
$validCsv = if ($env:VALID_CSV_PATH) { $env:VALID_CSV_PATH } else { "tests/fixtures/import-phase-a-valid.csv" }
$invalidCsv = if ($env:INVALID_CSV_PATH) { $env:INVALID_CSV_PATH } else { "tests/fixtures/import-phase-a-invalid.csv" }

function Invoke-ImportApi {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Url
  )

  $headers = @{
    Authorization = "Bearer $env:AR_TOKEN"
    "X-Company-Id" = $env:COMPANY_ID
  }

  Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers
}

function Upload-Csv {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$BatchName
  )

  curl.exe -sS -X POST "$baseUrl/upload" `
    -H "Authorization: Bearer $env:AR_TOKEN" `
    -H "X-Company-Id: $env:COMPANY_ID" `
    -F "file=@$Path;type=text/csv" `
    -F "import_type=invoice" `
    -F "file_type=csv" `
    -F "batch_name=$BatchName" | ConvertFrom-Json
}

Write-Host "Uploading valid CSV..."
$upload = Upload-Csv -Path $validCsv -BatchName "F4 Phase A Smoke Valid"
if (-not $upload.success) { throw "Valid upload failed" }
$batchId = $upload.data.id
Write-Host "Batch: $batchId"

Write-Host "Parsing valid CSV..."
$parse = Invoke-ImportApi -Method POST -Url "$baseUrl/$batchId/parse"
if (-not $parse.success) { throw "Parse failed" }

Write-Host "Validating valid CSV..."
$validate = Invoke-ImportApi -Method POST -Url "$baseUrl/$batchId/validate"
if (-not $validate.success) { throw "Validate failed" }
if ($validate.data.batch.valid_rows -lt 1) { throw "Expected at least one valid row" }

Write-Host "Executing draft-only invoice creation..."
$execute = Invoke-ImportApi -Method POST -Url "$baseUrl/$batchId/execute"
if (-not $execute.success) { throw "Execute failed" }
if ($execute.data.batch.created_count -lt 1) { throw "Expected at least one draft invoice created" }
if ($execute.data.batch.posted_count -ne 0) { throw "Phase A must not post invoices" }
if ($execute.data.batch.allocated_count -ne 0) { throw "Phase A must not allocate" }

Write-Host "Fetching row-level results..."
$rows = Invoke-ImportApi -Method GET -Url "$baseUrl/$batchId/rows"
if (-not $rows.success) { throw "Rows fetch failed" }
if (-not ($rows.data | Where-Object { $_.status -eq "Created" -and $_.invoice_id })) {
  throw "Expected a Created row with invoice_id"
}

Write-Host "Uploading invalid CSV..."
$badUpload = Upload-Csv -Path $invalidCsv -BatchName "F4 Phase A Smoke Invalid"
if (-not $badUpload.success) { throw "Invalid upload failed" }
$badBatchId = $badUpload.data.id

Write-Host "Parsing invalid CSV..."
$badParse = Invoke-ImportApi -Method POST -Url "$baseUrl/$badBatchId/parse"
if (-not $badParse.success) { throw "Invalid parse failed" }

Write-Host "Validating invalid CSV..."
$badValidate = Invoke-ImportApi -Method POST -Url "$baseUrl/$badBatchId/validate"
if (-not $badValidate.success) { throw "Invalid validate failed" }
if ($badValidate.data.batch.error_rows -lt 1) { throw "Expected validation errors for invalid CSV" }

Write-Host "PASS: Sprint F4 Phase A import API smoke test completed."

