# ============================================================================
# Sprint F4 Phase B XLSX Fixture Generator
# Creates minimal XLSX files for Excel Invoice Import smoke tests.
# ============================================================================

param(
  [string]$OutputDir = "tests/fixtures/generated",
  [string]$CustomerCode = "CUST-REPLACE-001",
  [string]$Currency = "SGD",
  [string]$RunId = (Get-Date -Format "yyyyMMddHHmmss")
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Xml-Escape {
  param([AllowNull()][object]$Value)
  return [System.Security.SecurityElement]::Escape([string]$Value)
}

function Cell-Ref {
  param([int]$ColumnIndex, [int]$RowIndex)
  $letters = ""
  $n = $ColumnIndex
  while ($n -gt 0) {
    $rem = ($n - 1) % 26
    $letters = [char](65 + $rem) + $letters
    $n = [math]::Floor(($n - 1) / 26)
  }
  return "$letters$RowIndex"
}

function New-CellXml {
  param(
    [int]$ColumnIndex,
    [int]$RowIndex,
    [object]$Value,
    [switch]$Number
  )

  $ref = Cell-Ref -ColumnIndex $ColumnIndex -RowIndex $RowIndex
  if ($Number) {
    return "<c r=""$ref""><v>$Value</v></c>"
  }

  $escaped = Xml-Escape $Value
  return "<c r=""$ref"" t=""inlineStr""><is><t>$escaped</t></is></c>"
}

function New-WorksheetXml {
  param([object[][]]$Rows)

  $rowXml = New-Object System.Collections.Generic.List[string]
  for ($r = 0; $r -lt $Rows.Count; $r++) {
    $cells = New-Object System.Collections.Generic.List[string]
    $row = $Rows[$r]
    for ($c = 0; $c -lt $row.Count; $c++) {
      $value = $row[$c]
      if ($null -eq $value -or [string]$value -eq "") { continue }
      $isNumber = $value -is [int] -or $value -is [long] -or $value -is [double] -or $value -is [decimal]
      $cells.Add((New-CellXml -ColumnIndex ($c + 1) -RowIndex ($r + 1) -Value $value -Number:$isNumber))
    }
    if ($cells.Count -gt 0) {
      $rowXml.Add("<row r=""$($r + 1)"">$($cells -join '')</row>")
    }
  }

  return @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    $($rowXml -join "`n    ")
  </sheetData>
</worksheet>
"@
}

function Add-ZipEntry {
  param(
    [System.IO.Compression.ZipArchive]$Zip,
    [string]$Path,
    [string]$Content
  )
  $entry = $Zip.CreateEntry($Path)
  $stream = $entry.Open()
  $writer = New-Object System.IO.StreamWriter($stream, [System.Text.UTF8Encoding]::new($false))
  $writer.Write($Content)
  $writer.Dispose()
  $stream.Dispose()
}

function New-Xlsx {
  param(
    [string]$Path,
    [object[][]]$Rows
  )

  if (Test-Path $Path) { Remove-Item -LiteralPath $Path -Force }

  $zip = [System.IO.Compression.ZipFile]::Open($Path, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Add-ZipEntry $zip "[Content_Types].xml" @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>
"@
    Add-ZipEntry $zip "_rels/.rels" @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
"@
    Add-ZipEntry $zip "xl/workbook.xml" @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Invoices" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>
"@
    Add-ZipEntry $zip "xl/_rels/workbook.xml.rels" @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>
"@
    Add-ZipEntry $zip "xl/worksheets/sheet1.xml" (New-WorksheetXml -Rows $Rows)
  } finally {
    $zip.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$headers = @("customer_code", "invoice_date", "currency", "description", "quantity", "unit_price", "tax_rate", "reference_no")

New-Xlsx -Path (Join-Path $OutputDir "phase-b-valid-invoice.xlsx") -Rows @(
  $headers,
  @($CustomerCode, "2026-05-28", $Currency, "Phase B valid line 1", 1, 1.00, 0, "F4B-VALID-$RunId-001"),
  @($CustomerCode, "2026-05-28", $Currency, "Phase B valid line 2", 2, 1.50, 0, "F4B-VALID-$RunId-002"),
  @("", "", "", "", "", "", "", "")
)

New-Xlsx -Path (Join-Path $OutputDir "phase-b-invalid-invoice.xlsx") -Rows @(
  $headers,
  @("NO-SUCH-CUSTOMER", "2026-05-28", $Currency, "Phase B invalid customer", 1, 1.00, 0, "F4B-INVALID-$RunId-001"),
  @($CustomerCode, "bad-date", $Currency, "Phase B invalid date", 1, 1.00, 0, "F4B-INVALID-$RunId-002")
)

# Excel 1900 date serial 46170 = 2026-05-28.
New-Xlsx -Path (Join-Path $OutputDir "phase-b-date-serial.xlsx") -Rows @(
  $headers,
  @($CustomerCode, 46170, $Currency, "Phase B date serial", 1, 1.00, 0, "F4B-DATE-$RunId-001")
)

New-Xlsx -Path (Join-Path $OutputDir "phase-b-numeric-cells.xlsx") -Rows @(
  $headers,
  @($CustomerCode, "2026-05-28", $Currency, "Phase B numeric cells", 3, 2.75, 0, "F4B-NUM-$RunId-001")
)

$phaseCHeaders = @(
  "customer_code", "customer_name", "registration_no",
  "bill_addr_line1", "bill_city", "bill_state", "bill_postal", "bill_country",
  "contact_name", "contact_phone", "contact_email",
  "invoice_date", "currency", "description", "quantity", "unit_price", "tax_rate", "reference_no"
)

New-Xlsx -Path (Join-Path $OutputDir "phase-c-existing-customer.xlsx") -Rows @(
  $phaseCHeaders,
  @($CustomerCode, "", "", "", "", "", "", "", "", "", "", "2026-05-28", $Currency, "Phase C existing customer XLSX", 1, 1.00, 0, "F4C-XLSX-EXISTING-$RunId")
)

New-Xlsx -Path (Join-Path $OutputDir "phase-c-new-customer.xlsx") -Rows @(
  $phaseCHeaders,
  @("", "F4C XLSX Customer $RunId", "F4CXLSX$RunId", "10 Anson Road", "Downtown Core", "Central", "079903", "SG", "Phase C Contact", "+6561234567", "phase-c-xlsx-$RunId@example.com", "2026-05-28", $Currency, "Phase C new customer XLSX", 1, 1.00, 0, "F4C-XLSX-NEW-$RunId")
)

New-Xlsx -Path (Join-Path $OutputDir "phase-c-invalid-missing-customer.xlsx") -Rows @(
  $phaseCHeaders,
  @("", "", "", "", "", "", "", "", "", "", "", "2026-05-28", $Currency, "Phase C invalid missing customer XLSX", 1, 1.00, 0, "F4C-XLSX-INVALID-$RunId")
)

New-Xlsx -Path (Join-Path $OutputDir "phase-c-duplicate-new-customer.xlsx") -Rows @(
  $phaseCHeaders,
  @("", "F4C XLSX Duplicate Customer $RunId", "F4CXLSXDUP$RunId", "10 Anson Road", "Downtown Core", "Central", "079903", "SG", "Phase C Contact", "+6561234567", "phase-c-xlsx-duplicate-$RunId@example.com", "2026-05-28", $Currency, "Phase C XLSX duplicate row one", 1, 1.00, 0, "F4C-XLSX-DUP-$RunId-1"),
  @("", "  f4c   xlsx   duplicate   customer   $RunId  ", "F4CXLSXDUP$RunId", "10 Anson Road", "Downtown Core", "Central", "079903", "SG", "Phase C Contact", "+6561234567", "phase-c-xlsx-duplicate-$RunId@example.com", "2026-05-28", $Currency, "Phase C XLSX duplicate row two", 1, 2.00, 0, "F4C-XLSX-DUP-$RunId-2")
)

Get-ChildItem -Path $OutputDir -Filter "phase-b-*.xlsx" | Select-Object FullName, Length
Get-ChildItem -Path $OutputDir -Filter "phase-c-*.xlsx" | Select-Object FullName, Length
