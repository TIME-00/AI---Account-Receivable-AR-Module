import type { AuthContext } from "../_shared/auth.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { BusinessError, errorResponse } from "../_shared/errors.ts";
import {
  type ExportDataset,
  ExportDatasetTooLargeError,
  type ExportReportType,
  parseExportQuery,
} from "./export-contract.ts";

export interface ReportExportServiceContract {
  exportAging(
    auth: AuthContext,
    query: ReturnType<typeof parseExportQuery>,
  ): Promise<ExportDataset>;
  exportInvoices(
    auth: AuthContext,
    query: ReturnType<typeof parseExportQuery>,
  ): Promise<ExportDataset>;
  exportReceipts(
    auth: AuthContext,
    query: ReturnType<typeof parseExportQuery>,
  ): Promise<ExportDataset>;
  exportCustomerOutstanding(
    auth: AuthContext,
    query: ReturnType<typeof parseExportQuery>,
  ): Promise<ExportDataset>;
}

const EXPORT_PATHS: Readonly<Record<string, ExportReportType>> = {
  "/export/aging": "aging",
  "/export/invoices": "invoices",
  "/export/receipts": "receipts",
  "/export/customer-outstanding": "customer-outstanding",
};

function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function isExportPath(subPath: string): boolean {
  return normalizePath(subPath).startsWith("/export/");
}

export async function handleReportExportRequest(
  req: Request,
  auth: AuthContext,
  service: ReportExportServiceContract,
  subPath: string,
): Promise<Response> {
  try {
    const normalizedPath = normalizePath(subPath);
    const reportType = EXPORT_PATHS[normalizedPath];
    if (!reportType) {
      throw new BusinessError(
        "ROUTE_NOT_FOUND",
        "Export route not found.",
        404,
      );
    }
    if (req.method !== "GET") {
      throw new BusinessError(
        "METHOD_NOT_ALLOWED",
        "This export route only accepts GET.",
        405,
      );
    }
    const query = parseExportQuery(reportType, new URL(req.url));
    const dataset = reportType === "aging"
      ? await service.exportAging(auth, query)
      : reportType === "invoices"
      ? await service.exportInvoices(auth, query)
      : reportType === "receipts"
      ? await service.exportReceipts(auth, query)
      : await service.exportCustomerOutstanding(auth, query);
    return jsonResponse({ data: dataset });
  } catch (error) {
    if (error instanceof ExportDatasetTooLargeError) {
      return jsonResponse({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      }, 422);
    }
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
}
