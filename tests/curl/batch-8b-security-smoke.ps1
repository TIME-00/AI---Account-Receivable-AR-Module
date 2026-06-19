# ============================================================================
# Batch 8B staging-only, read-only/negative API smoke
# ============================================================================
# This script creates no users, customers, invoices, receipts, allocations, or
# fixtures. It uses random non-existent UUIDs for mutation guard checks, so a
# guard regression cannot alter an existing record.
#
# Required environment variables:
#   SUPABASE_URL
#   SUPABASE_ANON_KEY
#   COMPANY_ID
#   AR_CLERK_TOKEN
#   AR_SUPERVISOR_TOKEN
#   FINANCE_MANAGER_TOKEN
#   AUDITOR_TOKEN
#   SYSTEM_ADMIN_TOKEN
#
# Optional existing staging IDs for deeper read-only preview checks:
#   ASSIGNED_RECEIPT_ID
#   UNASSIGNED_RECEIPT_ID
#   HIDDEN_RECEIPT_ID
#   HIDDEN_CUSTOMER_ID
#   DELETED_CUSTOMER_ID
# ============================================================================

$ErrorActionPreference = "Stop"

$required = @(
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "COMPANY_ID",
  "AR_CLERK_TOKEN",
  "AR_SUPERVISOR_TOKEN",
  "FINANCE_MANAGER_TOKEN",
  "AUDITOR_TOKEN",
  "SYSTEM_ADMIN_TOKEN"
)

foreach ($name in $required) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$name is required"
  }
}

$baseUrl = "$($env:SUPABASE_URL.TrimEnd('/'))/functions/v1"
$restUrl = "$($env:SUPABASE_URL.TrimEnd('/'))/rest/v1"
$missingId = "ffffffff-ffff-4fff-8fff-ffffffffffff"

function Invoke-Status {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Token,
    [object]$Body = $null
  )

  $headers = @{
    Authorization = "Bearer $Token"
    apikey = $env:SUPABASE_ANON_KEY
    "X-Company-Id" = $env:COMPANY_ID
  }

  try {
    $params = @{
      Method = $Method
      Uri = $Url
      Headers = $headers
    }
    if ($null -ne $Body) {
      $params.ContentType = "application/json"
      $params.Body = $Body | ConvertTo-Json -Depth 6
    }
    $response = Invoke-WebRequest @params
    return @{
      Status = [int]$response.StatusCode
      Body = if ($response.Content) { $response.Content | ConvertFrom-Json } else { $null }
    }
  } catch {
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      $content = $_.ErrorDetails.Message
      return @{
        Status = $status
        Body = if ($content) { $content | ConvertFrom-Json } else { $null }
      }
    }
    throw
  }
}

function Assert-Status {
  param(
    [hashtable]$Response,
    [int[]]$Expected,
    [string]$Message
  )
  if ($Response.Status -notin $Expected) {
    throw "$Message. Expected HTTP $($Expected -join '/'), got $($Response.Status)"
  }
}

function Assert-ErrorCode {
  param(
    [hashtable]$Response,
    [string]$Expected,
    [string]$Message
  )
  if ($Response.Body.error.code -ne $Expected) {
    throw "$Message. Expected $Expected, got $($Response.Body.error.code)"
  }
}

Write-Host "Checking System Admin operational API denial..."
foreach ($path in @("/customers", "/invoices", "/receipts", "/allocations")) {
  $response = Invoke-Status GET "$baseUrl$path" $env:SYSTEM_ADMIN_TOKEN
  Assert-Status $response @(403) "System Admin must not read $path"
}

Write-Host "Checking allowed operational/read role regressions..."
foreach ($case in @(
  @{ Token = $env:AR_CLERK_TOKEN; Path = "/customers" },
  @{ Token = $env:AR_SUPERVISOR_TOKEN; Path = "/invoices" },
  @{ Token = $env:FINANCE_MANAGER_TOKEN; Path = "/receipts" },
  @{ Token = $env:AUDITOR_TOKEN; Path = "/allocations" }
)) {
  $response = Invoke-Status GET "$baseUrl$($case.Path)" $case.Token
  Assert-Status $response @(200) "Allowed role read failed for $($case.Path)"
}

if ($env:HIDDEN_CUSTOMER_ID) {
  $hiddenCustomer = Invoke-Status GET "$baseUrl/customers/$($env:HIDDEN_CUSTOMER_ID)" $env:AR_SUPERVISOR_TOKEN
  Assert-Status $hiddenCustomer @(404) "Hidden customer must not be exposed through operational API"
}
if ($env:DELETED_CUSTOMER_ID) {
  $deletedCustomer = Invoke-Status GET "$baseUrl/customers/$($env:DELETED_CUSTOMER_ID)" $env:AR_SUPERVISOR_TOKEN
  Assert-Status $deletedCustomer @(404) "Deleted customer must not be exposed through operational API"
}

Write-Host "Checking invoice draft mutation role guards with a non-existent ID..."
$validInvoiceBody = @{
  doc_type = "Invoice"
  invoice_date = (Get-Date -Format "yyyy-MM-dd")
  customer_id = $missingId
  currency = "MYR"
  exchange_rate = 1
}

foreach ($token in @($env:AUDITOR_TOKEN, $env:SYSTEM_ADMIN_TOKEN)) {
  $response = Invoke-Status PATCH "$baseUrl/invoices/$missingId" $token $validInvoiceBody
  Assert-Status $response @(403) "Read-only role must fail invoice draft update before lookup"

  $response = Invoke-Status DELETE "$baseUrl/invoices/$missingId" $token
  Assert-Status $response @(403) "Read-only role must fail invoice draft delete before lookup"

  $response = Invoke-Status POST "$baseUrl/invoices/$missingId/lines" $token @{
    description = "Guard test only"
    quantity = 1
    unit_price = 0
  }
  Assert-Status $response @(403) "Read-only role must fail invoice line mutation before lookup"
}

$clerkMissing = Invoke-Status DELETE "$baseUrl/invoices/$missingId" $env:AR_CLERK_TOKEN
Assert-Status $clerkMissing @(404) "AR Clerk should pass role guard and reach missing-record check"

Write-Host "Checking allocation preview guards..."
$sysPreview = Invoke-Status GET "$baseUrl/allocations/preview?receipt_id=$missingId&method=FIFO" $env:SYSTEM_ADMIN_TOKEN
Assert-Status $sysPreview @(403) "System Admin must fail allocation preview role guard"

$clerkPreview = Invoke-Status GET "$baseUrl/allocations/preview?receipt_id=$missingId&method=FIFO" $env:AR_CLERK_TOKEN
Assert-Status $clerkPreview @(404) "AR Clerk should pass preview role guard and reach missing-record check"

if ($env:ASSIGNED_RECEIPT_ID) {
  $assigned = Invoke-Status GET "$baseUrl/allocations/preview?receipt_id=$($env:ASSIGNED_RECEIPT_ID)&method=FIFO" $env:AR_CLERK_TOKEN
  Assert-Status $assigned @(200) "Assigned visible receipt preview should succeed"
}
if ($env:UNASSIGNED_RECEIPT_ID) {
  $unassigned = Invoke-Status GET "$baseUrl/allocations/preview?receipt_id=$($env:UNASSIGNED_RECEIPT_ID)&method=FIFO" $env:AR_CLERK_TOKEN
  Assert-Status $unassigned @(403, 404) "Unassigned receipt preview must be denied"
}
if ($env:HIDDEN_RECEIPT_ID) {
  $hidden = Invoke-Status GET "$baseUrl/allocations/preview?receipt_id=$($env:HIDDEN_RECEIPT_ID)&method=FIFO" $env:AR_SUPERVISOR_TOKEN
  Assert-Status $hidden @(404) "Hidden-customer receipt preview must be filtered"
}

Write-Host "Checking direct authenticated REST financial DML denial..."
$restHeadersToken = $env:AR_SUPERVISOR_TOKEN
foreach ($case in @(
  @{ Path = "invoices?id=eq.$missingId"; Body = @{ internal_remarks = "Batch 8B guard test" } },
  @{ Path = "receipts?id=eq.$missingId"; Body = @{ remarks = "Batch 8B guard test" } },
  @{ Path = "allocation_details?id=eq.$missingId"; Body = @{ reverse_reason = "Batch 8B guard test" } },
  @{ Path = "journal_entries?id=eq.$missingId"; Body = @{ description = "Batch 8B guard test" } }
)) {
  $response = Invoke-Status PATCH "$restUrl/$($case.Path)" $restHeadersToken $case.Body
  Assert-Status $response @(401, 403) "Direct authenticated DML must be denied for $($case.Path)"
}

Write-Host "Checking auto-allocation remains disabled..."
$auto = Invoke-Status POST "$baseUrl/allocations/auto" $env:AR_CLERK_TOKEN @{
  receipt_id = $missingId
  method = "FIFO"
}
Assert-Status $auto @(403) "POST /allocations/auto must remain disabled"
Assert-ErrorCode $auto "AUTO_ALLOCATION_DISABLED" "Unexpected auto-allocation error code"

Write-Host "PASS: Batch 8B staging security smoke completed without creating records."
