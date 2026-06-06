# ============================================================================
# Sprint F4 Phase E API Smoke Test - Receipt Import Auto-Post/Allocation
# ============================================================================
# Required environment variables:
#   SUPABASE_URL
#   SUPABASE_ANON_KEY
#   AR_TOKEN
#   COMPANY_ID
#   CUSTOMER_CODE
#   BANK_ACCOUNT_CODE
#   INVOICE_REFERENCE
#   WRONG_CUSTOMER_INVOICE_REFERENCE
#   OVER_OUTSTANDING_AMOUNT
# ============================================================================

$ErrorActionPreference = "Stop"

foreach ($name in @(
  "SUPABASE_URL", "SUPABASE_ANON_KEY", "AR_TOKEN", "COMPANY_ID",
  "CUSTOMER_CODE", "BANK_ACCOUNT_CODE", "INVOICE_REFERENCE",
  "WRONG_CUSTOMER_INVOICE_REFERENCE", "OVER_OUTSTANDING_AMOUNT"
)) {
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
  param([string]$Method, [string]$Url, [object]$Body = $null, [switch]$ExpectFailure)
  $headers = @{
    Authorization = "Bearer $env:AR_TOKEN"
    apikey = $env:SUPABASE_ANON_KEY
    "X-Company-Id" = $env:COMPANY_ID
  }
  try {
    if ($null -ne $Body) {
      Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 5)
    } else {
      Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers
    }
  } catch {
    if ($ExpectFailure) { return $_.ErrorDetails.Message | ConvertFrom-Json }
    throw
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
    .Replace("INVOICE-REFERENCE-REPLACE-001", $env:INVOICE_REFERENCE)
    .Replace("WRONG-CUSTOMER-INVOICE-REFERENCE-REPLACE-001", $env:WRONG_CUSTOMER_INVOICE_REFERENCE)
    .Replace("OVER-OUTSTANDING-AMOUNT-REPLACE-001", $env:OVER_OUTSTANDING_AMOUNT)
    .Replace("REPLACERUNID", $runId)
  Set-Content -LiteralPath $target -Value $content -Encoding utf8
  return $target
}

function Upload-File {
  param([string]$Path, [string]$ImportType, [string]$BatchName)
  curl.exe -sS -X POST "$baseUrl/upload" `
    -H "Authorization: Bearer $env:AR_TOKEN" `
    -H "apikey: $env:SUPABASE_ANON_KEY" `
    -H "X-Company-Id: $env:COMPANY_ID" `
    -F "file=@$Path;type=text/csv" `
    -F "import_type=$ImportType" `
    -F "file_type=csv" `
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

function Execute-Batch {
  param([string]$BatchId, [bool]$AutoPost)
  Invoke-ImportApi -Method POST -Url "$baseUrl/$BatchId/execute" -Body @{ auto_post = $AutoPost }
}

function Assert-ReceiptState {
  param([string]$ReceiptId, [string]$ExpectedStatus)
  $receipt = @(Invoke-RestGet -Path "receipts?id=eq.$ReceiptId&select=id,status,posted_at,receipt_amount,allocated_amount,unallocated_amount")
  Assert-True ($receipt.Count -eq 1) "Receipt not found: $ReceiptId"
  Assert-True ($receipt[0].status -eq $ExpectedStatus) "Expected receipt $ReceiptId status $ExpectedStatus, got $($receipt[0].status)"
  return $receipt[0]
}

function Assert-NoImportAllocation {
  param([string]$RowId)
  $linksRaw = Invoke-RestGet -Path "import_row_allocations?import_row_id=eq.$RowId&select=id"
  $links = @($linksRaw | Where-Object { $_ })
  Assert-True ($links.Count -eq 0) "Expected no import_row_allocations row for $RowId"
}

$draftCsv = New-GeneratedCsv "import-phase-e-draft-only.csv"
$postOnlyCsv = New-GeneratedCsv "import-phase-e-post-only.csv"
$validAllocCsv = New-GeneratedCsv "import-phase-e-valid-allocation.csv"
$badRefCsv = New-GeneratedCsv "import-phase-e-invalid-invoice-ref.csv"
$wrongCustomerCsv = New-GeneratedCsv "import-phase-e-wrong-customer-ref.csv"
$amountNoRefCsv = New-GeneratedCsv "import-phase-e-allocation-without-ref.csv"
$overOutstandingCsv = New-GeneratedCsv "import-phase-e-over-outstanding.csv"
$invoiceRegressionCsv = New-GeneratedCsv "import-phase-c-existing-customer.csv"

Write-Host "Checking auto_post=false draft-only regression..."
$draftValidation = Parse-And-Validate (Upload-File $draftCsv "receipt" "F4 Phase E Draft Only $runId")
$draftExecute = Execute-Batch $draftValidation.data.batch.id $false
$draftRow = @($draftExecute.data.rows)[0]
Assert-True ($draftRow.status -eq "Created") "Expected Created row for auto_post=false"
$draftReceipt = Assert-ReceiptState $draftRow.receipt_id "Draft"
Assert-True ([decimal]$draftReceipt.allocated_amount -eq 0) "Draft receipt must not be allocated"
Assert-NoImportAllocation $draftRow.id

Write-Host "Checking auto_post=true with no invoice_reference..."
$postValidation = Parse-And-Validate (Upload-File $postOnlyCsv "receipt" "F4 Phase E Post Only $runId")
$postExecute = Execute-Batch $postValidation.data.batch.id $true
$postRow = @($postExecute.data.rows)[0]
Assert-True ($postRow.status -eq "Posted") "Expected Posted row when no invoice_reference"
$postReceipt = Assert-ReceiptState $postRow.receipt_id "Posted"
Assert-True ([decimal]$postReceipt.allocated_amount -eq 0) "Post-only receipt must remain unallocated"
Assert-True ($postRow.mapped_data.allocation_status -eq "Skipped") "Expected allocation_status Skipped"
Assert-NoImportAllocation $postRow.id

Write-Host "Checking valid invoice_reference allocation..."
$allocValidation = Parse-And-Validate (Upload-File $validAllocCsv "receipt" "F4 Phase E Valid Allocation $runId")
$allocExecute = Execute-Batch $allocValidation.data.batch.id $true
$allocRow = @($allocExecute.data.rows)[0]
Assert-True ($allocRow.status -eq "Allocated") "Expected Allocated row"
Assert-True ($allocExecute.data.batch.posted_count -eq 1) "Expected posted_count=1"
Assert-True ($allocExecute.data.batch.allocated_count -eq 1) "Expected allocated_count=1"
$linksRaw = Invoke-RestGet -Path "import_row_allocations?import_row_id=eq.$($allocRow.id)&select=id,allocation_id,invoice_id,allocated_amount"
$links = @($linksRaw | Where-Object { $_ })
Assert-True ($links.Count -eq 1) "Expected one import_row_allocations row"
Assert-True ($null -ne $links[0].allocation_id) "Expected real allocation_id"

Write-Host "Checking invalid invoice_reference becomes Unmatched..."
$badRefValidation = Parse-And-Validate (Upload-File $badRefCsv "receipt" "F4 Phase E Bad Ref $runId")
$badRefExecute = Execute-Batch $badRefValidation.data.batch.id $true
$badRefRow = @($badRefExecute.data.rows)[0]
Assert-True ($badRefRow.status -eq "Unmatched") "Expected Unmatched row for invalid invoice_reference"
Assert-True ($badRefRow.mapped_data.allocation_status -eq "Error") "Expected allocation_status Error"
Assert-True ($badRefRow.mapped_data.allocation_error) "Expected allocation_error"
Assert-NoImportAllocation $badRefRow.id

Write-Host "Checking wrong-customer invoice_reference is rejected..."
$wrongValidation = Parse-And-Validate (Upload-File $wrongCustomerCsv "receipt" "F4 Phase E Wrong Customer $runId")
$wrongExecute = Execute-Batch $wrongValidation.data.batch.id $true
$wrongRow = @($wrongExecute.data.rows)[0]
Assert-True ($wrongRow.status -eq "Unmatched") "Expected Unmatched row for wrong customer reference"
Assert-NoImportAllocation $wrongRow.id

Write-Host "Checking allocation_amount without invoice_reference validation error..."
$amountNoRefValidation = Parse-And-Validate (Upload-File $amountNoRefCsv "receipt" "F4 Phase E Amount No Ref $runId")
Assert-True ($amountNoRefValidation.data.batch.error_rows -ge 1) "Expected validation error for allocation_amount without invoice_reference"

Write-Host "Checking allocation amount greater than outstanding..."
$overValidation = Parse-And-Validate (Upload-File $overOutstandingCsv "receipt" "F4 Phase E Over Outstanding $runId")
$overExecute = Execute-Batch $overValidation.data.batch.id $true
$overRow = @($overExecute.data.rows)[0]
Assert-True ($overRow.status -eq "Unmatched") "Expected Unmatched row for over-outstanding allocation"
Assert-NoImportAllocation $overRow.id

Write-Host "Checking invoice import auto_post=true remains blocked..."
$invoiceUpload = Upload-File $invoiceRegressionCsv "invoice" "F4 Phase E Invoice AutoPost Block $runId"
$invoiceValidation = Parse-And-Validate $invoiceUpload
$blocked = Invoke-ImportApi -Method POST -Url "$baseUrl/$($invoiceValidation.data.batch.id)/execute" -Body @{ auto_post = $true } -ExpectFailure
Assert-True ($blocked.success -eq $false) "Expected invoice auto_post=true to fail"

Write-Host "PASS: Sprint F4 Phase E receipt import auto-allocation smoke test completed."
