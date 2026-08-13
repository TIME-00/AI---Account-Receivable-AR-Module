const AUTOMATION_SERVICE_MODULES = [
  "settings-service.ts",
  "directory-service.ts",
  "mailbox-service.ts",
  "document-service.ts",
  "mailbox-sync-service.ts",
  "reminder-service.ts",
  "allocation-service.ts",
  "scheduler-service.ts",
  "service-base.ts",
] as const;

const IMPORT_SERVICE_MODULES = [
  "intake-service.ts",
  "workflow-service.ts",
  "review-service.ts",
  "validation-service.ts",
  "resolution-service.ts",
  "allocation-service.ts",
  "service-base.ts",
] as const;

const INVOICE_SERVICE_MODULES = [
  "authority-service.ts",
  "draft-service.ts",
  "lifecycle-service.ts",
  "service-base.ts",
] as const;

const CUSTOMER_SERVICE_MODULES = [
  "master-service.ts",
  "credit-service.ts",
  "resolution-service.ts",
  "service-base.ts",
] as const;

async function readFamily(
  _testModuleUrl: string | URL,
  directory: string,
  modules: readonly string[],
): Promise<string> {
  const contents = await Promise.all(
    modules.map((module) =>
      Deno.readTextFile(new URL(`../${directory}/${module}`, import.meta.url))
    ),
  );
  const source = contents.join("\n");
  const legacyFormattingProjection = source
    .replace(/"([^"\r\n]*)"/g, "'$1'");
  const compactLegacyProjection = legacyFormattingProjection
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/,\)/g, ")");
  return `${legacyFormattingProjection}\n${compactLegacyProjection}\n${source}`;
}

export function readAutomationServiceSource(
  testModuleUrl: string | URL,
): Promise<string> {
  return readFamily(testModuleUrl, "automation", AUTOMATION_SERVICE_MODULES);
}

export function readImportServiceSource(
  testModuleUrl: string | URL,
): Promise<string> {
  return readFamily(testModuleUrl, "imports", IMPORT_SERVICE_MODULES);
}

export function readInvoiceServiceSource(
  testModuleUrl: string | URL,
): Promise<string> {
  return readFamily(testModuleUrl, "invoices", INVOICE_SERVICE_MODULES);
}

export function readCustomerServiceSource(
  testModuleUrl: string | URL,
): Promise<string> {
  return readFamily(testModuleUrl, "customers", CUSTOMER_SERVICE_MODULES);
}
