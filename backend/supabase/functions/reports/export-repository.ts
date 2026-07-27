import type { SupabaseClient } from "supabase";
import type { AuthContext } from "../_shared/auth.ts";
import type { Invoice, Receipt } from "../_shared/types.ts";
import { InvoiceService } from "../invoices/service.ts";
import { ReceiptService } from "../receipts/service.ts";
import { type CustomerAgingRow, ReportService } from "./service.ts";
import {
  assertIanaTimeZone,
  EXPORT_PAGE_SIZE,
  type ExportCompany,
} from "./export-contract.ts";

export interface ExportPage<T> {
  rows: T[];
  total: number;
}

export interface ExportCustomerMetadata {
  id: string;
  customer_code: string;
  customer_name: string;
  customer_status: string;
  credit_rating: string;
  credit_limit: unknown;
}

export interface ExportRepository {
  getCompany(auth: AuthContext): Promise<ExportCompany>;
  getAgingPage(
    auth: AuthContext,
    asOfDate: string,
    page: number,
    creditRating?: string,
  ): Promise<ExportPage<CustomerAgingRow>>;
  getInvoicePage(
    auth: AuthContext,
    filters: Record<string, string>,
    page: number,
  ): Promise<ExportPage<Invoice>>;
  getReceiptPage(
    auth: AuthContext,
    filters: Record<string, string>,
    page: number,
  ): Promise<ExportPage<Receipt>>;
  getCustomers(
    auth: AuthContext,
    customerIds: string[],
  ): Promise<Map<string, ExportCustomerMetadata>>;
  getOldestDueDates(
    auth: AuthContext,
    customerIds: string[],
    asOfDate: string,
  ): Promise<Map<string, string | null>>;
}

type CompanyRow = {
  id: string;
  company_name: string;
  base_currency: string;
  country: string;
};

const COUNTRY_TIME_ZONES: Readonly<Record<string, string>> = {
  MY: "Asia/Kuala_Lumpur",
  SG: "Asia/Singapore",
};

function sanitizeReadFailure(
  area: string,
  error: { message?: string } | null,
): never {
  console.error(`[reports/export/${area}] bounded read failed`, {
    message: error?.message ?? "unknown",
  });
  throw new Error("Failed to load authoritative export data.");
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export class SupabaseExportRepository implements ExportRepository {
  private readonly reportService: ReportService;
  private readonly invoiceService: InvoiceService;
  private readonly receiptService: ReceiptService;

  constructor(
    private readonly readClient: SupabaseClient,
    private readonly configuredTimeZone =
      Deno.env.get("BUSINESS_TIME_ZONE")?.trim() || null,
  ) {
    this.reportService = new ReportService(undefined, readClient);
    this.invoiceService = new InvoiceService(undefined, readClient);
    this.receiptService = new ReceiptService(undefined, readClient);
  }

  async getCompany(auth: AuthContext): Promise<ExportCompany> {
    const { data, error } = await this.readClient
      .from("companies")
      .select("id, company_name, base_currency, country")
      .eq("id", auth.companyId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) sanitizeReadFailure("company", error);
    if (!data || typeof data !== "object") {
      throw new Error("Authenticated company metadata is unavailable.");
    }
    const company = data as CompanyRow;
    if (
      company.id !== auth.companyId ||
      typeof company.company_name !== "string" ||
      !/^[A-Z]{3}$/.test(String(company.base_currency).trim())
    ) {
      throw new Error("Authenticated company metadata is malformed.");
    }

    const { data: timeZoneConfig, error: timeZoneError } = await this.readClient
      .from("ar_system_config")
      .select("config_value")
      .eq("company_id", auth.companyId)
      .eq("config_key", "business_time_zone")
      .maybeSingle();
    if (timeZoneError) {
      sanitizeReadFailure("company-timezone", timeZoneError);
    }
    const storedTimeZone = timeZoneConfig &&
        typeof timeZoneConfig === "object" &&
        typeof (timeZoneConfig as Record<string, unknown>).config_value ===
          "string"
      ? String((timeZoneConfig as Record<string, unknown>).config_value).trim()
      : null;
    const timezone = assertIanaTimeZone(
      storedTimeZone ||
        this.configuredTimeZone ||
        COUNTRY_TIME_ZONES[String(company.country)] ||
        "",
    );
    return {
      id: company.id,
      name: company.company_name,
      base_currency: String(company.base_currency).trim(),
      timezone,
    };
  }

  async getAgingPage(
    auth: AuthContext,
    asOfDate: string,
    page: number,
    creditRating?: string,
  ): Promise<ExportPage<CustomerAgingRow>> {
    return await this.reportService.getAgingByCustomer(
      auth,
      asOfDate,
      { page, page_size: EXPORT_PAGE_SIZE },
      creditRating,
    );
  }

  async getInvoicePage(
    auth: AuthContext,
    filters: Record<string, string>,
    page: number,
  ): Promise<ExportPage<Invoice>> {
    const rpcFilters = {
      date_from: filters.date_from,
      date_to: filters.date_to,
      status: filters.status,
      doc_type: filters.doc_type,
      search: filters.search,
    };
    const result = await this.invoiceService.listInvoices(
      auth,
      rpcFilters,
      { page, page_size: EXPORT_PAGE_SIZE },
    );
    return { rows: result.invoices, total: result.total };
  }

  async getReceiptPage(
    auth: AuthContext,
    filters: Record<string, string>,
    page: number,
  ): Promise<ExportPage<Receipt>> {
    const rpcFilters = {
      date_from: filters.date_from,
      date_to: filters.date_to,
      status: filters.status,
      payment_method: filters.payment_method,
      search: filters.search,
    };
    const result = await this.receiptService.listReceipts(
      auth,
      rpcFilters,
      { page, page_size: EXPORT_PAGE_SIZE },
    );
    return { rows: result.receipts, total: result.total };
  }

  async getCustomers(
    auth: AuthContext,
    customerIds: string[],
  ): Promise<Map<string, ExportCustomerMetadata>> {
    const result = new Map<string, ExportCustomerMetadata>();
    for (const idChunk of chunks([...new Set(customerIds)], EXPORT_PAGE_SIZE)) {
      if (idChunk.length === 0) continue;
      const { data, error } = await this.readClient
        .from("customers")
        .select(
          "id, customer_id, customer_name, status, credit_rating, credit_limit",
        )
        .eq("company_id", auth.companyId)
        .eq("is_deleted", false)
        .eq("is_hidden", false)
        .in("id", idChunk);
      if (error) sanitizeReadFailure("customers", error);
      for (const raw of data ?? []) {
        if (!raw || typeof raw !== "object") {
          throw new Error("Customer metadata is malformed.");
        }
        const row = raw as Record<string, unknown>;
        const id = String(row.id ?? "");
        if (!idChunk.includes(id)) {
          throw new Error("Customer metadata escaped the requested scope.");
        }
        result.set(id, {
          id,
          customer_code: String(row.customer_id ?? ""),
          customer_name: String(row.customer_name ?? ""),
          customer_status: String(row.status ?? ""),
          credit_rating: String(row.credit_rating ?? ""),
          credit_limit: row.credit_limit,
        });
      }
    }
    return result;
  }

  async getOldestDueDates(
    auth: AuthContext,
    customerIds: string[],
    asOfDate: string,
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>(
      [...new Set(customerIds)].map((id) => [id, null]),
    );
    for (const idChunk of chunks([...result.keys()], 100)) {
      let offset = 0;
      while (true) {
        const { data, error } = await this.readClient
          .from("invoices")
          .select("id, customer_id, due_date")
          .eq("company_id", auth.companyId)
          .in("customer_id", idChunk)
          .in("status", ["Open", "Overdue", "Partially Paid"])
          .in("doc_type", ["Invoice", "Debit Note"])
          .gt("outstanding", 0)
          .lte("invoice_date", asOfDate)
          .not("due_date", "is", null)
          .order("due_date", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + 999);
        if (error) sanitizeReadFailure("oldest-due-date", error);
        const rows = data ?? [];
        for (const raw of rows) {
          if (!raw || typeof raw !== "object") {
            throw new Error("Invoice due-date metadata is malformed.");
          }
          const row = raw as Record<string, unknown>;
          const customerId = String(row.customer_id ?? "");
          const dueDate = String(row.due_date ?? "");
          if (
            !idChunk.includes(customerId) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)
          ) {
            throw new Error(
              "Invoice due-date metadata escaped the requested scope.",
            );
          }
          if (result.get(customerId) === null) result.set(customerId, dueDate);
        }
        if (rows.length < 1_000) break;
        offset += 1_000;
      }
    }
    return result;
  }
}
