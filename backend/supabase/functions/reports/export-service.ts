import type { AuthContext } from "../_shared/auth.ts";
import { requireOperationalReadRole } from "../_shared/auth.ts";
import {
  CREDIT_RATINGS,
  CUSTOMER_STATUSES,
  DOC_TYPES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  RECEIPT_STATUSES,
} from "../_shared/constants.ts";
import {
  compareDecimal,
  compareText,
  decimalString,
  enforcePayloadLimit,
  EXPORT_PAGE_SIZE,
  EXPORT_ROW_LIMIT,
  type ExportCompany,
  type ExportDataset,
  ExportDatasetTooLargeError,
  type ExportQuery,
  type ExportReportType,
  minorToMoney,
  moneyToMinor,
  multiplyMoneyByRate,
  type SortOrder,
} from "./export-contract.ts";
import type { ExportPage, ExportRepository } from "./export-repository.ts";

type ExportRow = Record<string, unknown>;
type ExportSummary = Record<string, unknown>;
type CurrencyAccumulator = {
  rowCount: number;
  nativeMinor: bigint;
  baseMinor: bigint;
};

function requireString(
  value: unknown,
  field: string,
  allowNull = false,
): string | null {
  if (value === null && allowNull) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Malformed authoritative field: ${field}.`);
  }
  return value;
}

function requireDate(
  value: unknown,
  field: string,
  allowNull = false,
): string | null {
  const text = requireString(value, field, allowNull);
  if (text === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`Malformed authoritative date: ${field}.`);
  }
  return text;
}

function requireId(value: unknown, field: string): string {
  const text = requireString(value, field)!;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(text)
  ) {
    throw new Error(`Malformed authoritative identifier: ${field}.`);
  }
  return text;
}

function requireInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Malformed authoritative integer: ${field}.`);
  }
  return parsed;
}

function requireEnum(
  value: unknown,
  allowed: readonly string[],
  field: string,
): string {
  const text = requireString(value, field)!;
  if (!allowed.includes(text)) {
    throw new Error(`Malformed authoritative enum: ${field}.`);
  }
  return text;
}

function requireFxLifecycle(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requireEnum(
    value,
    ["Draft", "Pending", "Approved", "Rejected", "Superseded", "Posted"],
    "fx_lifecycle_status",
  );
}

function addCurrency(
  map: Map<string, CurrencyAccumulator>,
  currencyValue: unknown,
  nativeValue: unknown,
  baseValue: unknown,
  rowCount = 1,
): void {
  const currency = requireString(currencyValue, "currency")!;
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Malformed authoritative currency.");
  }
  const current = map.get(currency) ??
    { rowCount: 0, nativeMinor: 0n, baseMinor: 0n };
  current.rowCount += rowCount;
  current.nativeMinor += moneyToMinor(nativeValue, `${currency}.native`);
  current.baseMinor += moneyToMinor(baseValue, `${currency}.base`);
  map.set(currency, current);
}

function currencySummary(map: Map<string, CurrencyAccumulator>): ExportRow[] {
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, values]) => ({
      currency,
      row_count: values.rowCount,
      native_total: minorToMoney(values.nativeMinor),
      base_total: minorToMoney(values.baseMinor),
    }));
}

function sumMoney(rows: ExportRow[], field: string): bigint {
  return rows.reduce((sum, row) => sum + moneyToMinor(row[field], field), 0n);
}

function sortRows(
  rows: ExportRow[],
  field: string,
  order: SortOrder,
  stableIdField: string,
  monetaryFields: ReadonlySet<string>,
): void {
  rows.sort((left, right) => {
    const primary = monetaryFields.has(field)
      ? compareDecimal(String(left[field]), String(right[field]))
      : compareText(String(left[field] ?? ""), String(right[field] ?? ""));
    if (primary !== 0) return order === "asc" ? primary : -primary;
    return compareText(
      String(left[stableIdField]),
      String(right[stableIdField]),
    );
  });
}

function buildBreakdown(
  rows: ExportRow[],
  dimension: string,
  baseFields: readonly string[],
): ExportRow[] {
  const grouped = new Map<string, { count: number; totals: bigint[] }>();
  for (const row of rows) {
    const value = requireString(row[dimension], dimension)!;
    const current = grouped.get(value) ?? {
      count: 0,
      totals: baseFields.map(() => 0n),
    };
    current.count += 1;
    baseFields.forEach((field, index) => {
      current.totals[index] += moneyToMinor(row[field], field);
    });
    grouped.set(value, current);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, result]) => ({
      [dimension]: value,
      count: result.count,
      ...Object.fromEntries(
        baseFields.map((
          field,
          index,
        ) => [`${field}_total`, minorToMoney(result.totals[index])]),
      ),
    }));
}

async function collectPages<T>(
  fetchPage: (page: number) => Promise<ExportPage<T>>,
  acceptAndMap: (
    rows: T[],
  ) =>
    | Promise<Array<{ id: string; row: ExportRow }>>
    | Array<{ id: string; row: ExportRow }>,
): Promise<ExportRow[]> {
  const accepted: ExportRow[] = [];
  const acceptedIds = new Set<string>();
  let expectedTotal: number | null = null;
  let received = 0;

  for (let page = 1;; page += 1) {
    const result = await fetchPage(page);
    const total = requireInteger(result?.total, "total");
    if (!Array.isArray(result?.rows) || result.rows.length > EXPORT_PAGE_SIZE) {
      throw new Error("Authoritative export page is malformed.");
    }
    if (expectedTotal === null) expectedTotal = total;
    if (expectedTotal !== total) {
      throw new Error("Authoritative export total changed during traversal.");
    }
    if (total === 0 && result.rows.length !== 0) {
      throw new Error("Authoritative export page contradicts its total.");
    }

    received += result.rows.length;
    const mapped = await acceptAndMap(result.rows);
    for (const item of mapped) {
      const id = item.id;
      if (acceptedIds.has(id)) {
        throw new Error(
          "Authoritative export traversal produced a duplicate row.",
        );
      }
      acceptedIds.add(id);
      accepted.push(item.row);
      if (accepted.length > EXPORT_ROW_LIMIT) {
        throw new ExportDatasetTooLargeError(accepted.length);
      }
    }

    if (received >= total) {
      if (received !== total) {
        throw new Error("Authoritative export traversal exceeded its total.");
      }
      break;
    }
    if (result.rows.length !== EXPORT_PAGE_SIZE) {
      throw new Error(
        "Authoritative export traversal ended before its declared total.",
      );
    }
    if (page > Math.ceil(total / EXPORT_PAGE_SIZE)) {
      throw new Error("Authoritative export traversal did not terminate.");
    }
  }
  return accepted;
}

function assertCompanyCurrency(
  rowCurrency: unknown,
  company: ExportCompany,
): string {
  const currency = requireString(rowCurrency, "base_currency")!.trim();
  if (currency !== company.base_currency) {
    throw new Error(
      "Authoritative row base currency does not match the authenticated company.",
    );
  }
  return currency;
}

function normalizeCompany(
  company: ExportCompany,
  auth: AuthContext,
): ExportCompany {
  if (
    company.id !== auth.companyId ||
    !company.name?.trim() ||
    !/^[A-Z]{3}$/.test(company.base_currency) ||
    !company.timezone?.trim()
  ) {
    throw new Error("Authenticated company metadata is malformed.");
  }
  return { ...company, name: company.name.trim() };
}

export class ReportExportService {
  constructor(
    private readonly repository: ExportRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async company(auth: AuthContext): Promise<ExportCompany> {
    requireOperationalReadRole(auth);
    return normalizeCompany(await this.repository.getCompany(auth), auth);
  }

  private dataset(
    type: ExportReportType,
    company: ExportCompany,
    query: ExportQuery,
    rows: ExportRow[],
    summary: ExportSummary,
  ): ExportDataset {
    const generatedAt = this.now().toISOString();
    if (new Date(generatedAt).toISOString() !== generatedAt) {
      throw new Error("Unable to create an ISO-8601 UTC generated timestamp.");
    }
    return enforcePayloadLimit({
      schema_version: 1,
      report_type: type,
      generated_at: generatedAt,
      company,
      filters: query.filters,
      sort: query.sort,
      row_count: rows.length,
      summary,
      rows,
    });
  }

  async exportAging(
    auth: AuthContext,
    query: ExportQuery,
  ): Promise<ExportDataset> {
    const company = await this.company(auth);
    const asOfDate = query.filters.as_of_date;
    const search = query.filters.search?.toLocaleLowerCase();
    const currencies = new Map<string, CurrencyAccumulator>();
    const rows = await collectPages(
      (page) => this.repository.getAgingPage(auth, asOfDate, page),
      (sourceRows) => {
        const mapped: Array<{ id: string; row: ExportRow }> = [];
        for (const row of sourceRows) {
          const customerId = requireId(row.customer_id, "customer_id");
          const customerCode = requireString(
            row.customer_code,
            "customer_code",
          )!;
          const customerName = requireString(
            row.customer_name,
            "customer_name",
          )!;
          if (
            search &&
            !customerCode.toLocaleLowerCase().includes(search) &&
            !customerName.toLocaleLowerCase().includes(search)
          ) continue;
          assertCompanyCurrency(row.base_currency, company);
          const current = moneyToMinor(row.current_amount, "current_base");
          const b1 = moneyToMinor(row.bucket_1_30, "bucket_1_30_base");
          const b31 = moneyToMinor(row.bucket_31_60, "bucket_31_60_base");
          const b61 = moneyToMinor(row.bucket_61_90, "bucket_61_90_base");
          const b91 = moneyToMinor(row.bucket_over_90, "bucket_91_plus_base");
          const outstanding = moneyToMinor(row.base_total, "outstanding_base");
          if (current + b1 + b31 + b61 + b91 !== outstanding) {
            throw new Error("Authoritative aging buckets do not reconcile.");
          }
          if (!Array.isArray(row.by_currency)) {
            throw new Error(
              "Authoritative aging currency detail is malformed.",
            );
          }
          for (const item of row.by_currency) {
            addCurrency(
              currencies,
              item.currency,
              item.amount,
              item.base_amount,
              requireInteger(item.count, "by_currency.count"),
            );
          }
          mapped.push({
            id: customerId,
            row: {
              customer_id: customerId,
              customer_code: customerCode,
              customer_name: customerName,
              credit_rating: requireString(row.credit_rating, "credit_rating"),
              current_base: minorToMoney(current),
              bucket_1_30_base: minorToMoney(b1),
              bucket_31_60_base: minorToMoney(b31),
              bucket_61_90_base: minorToMoney(b61),
              bucket_91_plus_base: minorToMoney(b91),
              outstanding_base: minorToMoney(outstanding),
              overdue_base: minorToMoney(b1 + b31 + b61 + b91),
            },
          });
        }
        return mapped;
      },
    );
    sortRows(
      rows,
      query.sort.field,
      query.sort.order,
      "customer_id",
      new Set(["outstanding_base", "overdue_base"]),
    );
    return this.dataset("aging", company, query, rows, {
      base_currency: company.base_currency,
      customer_count: rows.length,
      outstanding_base_total: minorToMoney(sumMoney(rows, "outstanding_base")),
      overdue_base_total: minorToMoney(sumMoney(rows, "overdue_base")),
      current_base_total: minorToMoney(sumMoney(rows, "current_base")),
      bucket_1_30_base_total: minorToMoney(sumMoney(rows, "bucket_1_30_base")),
      bucket_31_60_base_total: minorToMoney(
        sumMoney(rows, "bucket_31_60_base"),
      ),
      bucket_61_90_base_total: minorToMoney(
        sumMoney(rows, "bucket_61_90_base"),
      ),
      bucket_91_plus_base_total: minorToMoney(
        sumMoney(rows, "bucket_91_plus_base"),
      ),
      native_by_currency: currencySummary(currencies),
    });
  }

  async exportInvoices(
    auth: AuthContext,
    query: ExportQuery,
  ): Promise<ExportDataset> {
    const company = await this.company(auth);
    const currencies = new Map<string, CurrencyAccumulator>();
    const rows = await collectPages(
      (page) => this.repository.getInvoicePage(auth, query.filters, page),
      async (sourceRows) => {
        const customerMap = await this.repository.getCustomers(
          auth,
          sourceRows.map((row) => requireId(row.customer_id, "customer_id")),
        );
        const mapped: Array<{ id: string; row: ExportRow }> = [];
        for (const row of sourceRows) {
          if (
            query.filters.currency && row.currency !== query.filters.currency
          ) continue;
          if (row.company_id !== auth.companyId) {
            throw new Error("Invoice row escaped the authenticated company.");
          }
          const customerId = requireId(row.customer_id, "customer_id");
          const customer = customerMap.get(customerId);
          if (!customer) {
            throw new Error("Invoice customer metadata is unavailable.");
          }
          requireString(customer.customer_code, "customer_code");
          requireString(customer.customer_name, "customer_name");
          assertCompanyCurrency(row.base_currency, company);
          const totalNative = moneyToMinor(
            row.total_amount,
            "total_amount_native",
          );
          const outstandingNative = moneyToMinor(
            row.outstanding,
            "outstanding_native",
          );
          const baseTotal = moneyToMinor(row.base_total, "base_total");
          const outstandingBase = multiplyMoneyByRate(
            row.outstanding,
            row.exchange_rate,
            "outstanding_base",
          );
          addCurrency(
            currencies,
            row.currency,
            row.total_amount,
            row.base_total,
          );
          const invoiceId = requireId(row.id, "invoice_id");
          mapped.push({
            id: invoiceId,
            row: {
              invoice_id: invoiceId,
              invoice_no: requireString(row.invoice_no, "invoice_no"),
              doc_type: requireEnum(row.doc_type, DOC_TYPES, "doc_type"),
              invoice_date: requireDate(row.invoice_date, "invoice_date"),
              due_date: requireDate(row.due_date, "due_date", true),
              customer_id: customerId,
              customer_code: customer.customer_code,
              customer_name: customer.customer_name,
              status: requireEnum(row.status, INVOICE_STATUSES, "status"),
              currency: requireString(row.currency, "currency"),
              total_amount_native: minorToMoney(totalNative),
              outstanding_native: minorToMoney(outstandingNative),
              booked_exchange_rate: decimalString(
                row.exchange_rate,
                "booked_exchange_rate",
              ),
              base_currency: company.base_currency,
              base_total: minorToMoney(baseTotal),
              outstanding_base: minorToMoney(outstandingBase),
              fx_source_category: row.fx_source_category === null
                ? null
                : requireString(row.fx_source_category, "fx_source_category"),
              fx_lifecycle_status: requireFxLifecycle(
                row.fx_decision?.lifecycle_status,
              ),
            },
          });
        }
        return mapped;
      },
    );
    sortRows(
      rows,
      query.sort.field === "total_amount"
        ? "total_amount_native"
        : query.sort.field === "outstanding"
        ? "outstanding_native"
        : query.sort.field,
      query.sort.order,
      "invoice_id",
      new Set(["total_amount_native", "base_total", "outstanding_native"]),
    );
    return this.dataset("invoices", company, query, rows, {
      document_count: rows.length,
      base_currency: company.base_currency,
      document_base_total: minorToMoney(sumMoney(rows, "base_total")),
      outstanding_base_total: minorToMoney(sumMoney(rows, "outstanding_base")),
      native_by_currency: currencySummary(currencies),
      status_breakdown: buildBreakdown(rows, "status", [
        "base_total",
        "outstanding_base",
      ]),
      doc_type_breakdown: buildBreakdown(rows, "doc_type", [
        "base_total",
        "outstanding_base",
      ]),
    });
  }

  async exportReceipts(
    auth: AuthContext,
    query: ExportQuery,
  ): Promise<ExportDataset> {
    const company = await this.company(auth);
    const currencies = new Map<string, CurrencyAccumulator>();
    const rows = await collectPages(
      (page) => this.repository.getReceiptPage(auth, query.filters, page),
      async (sourceRows) => {
        const customerMap = await this.repository.getCustomers(
          auth,
          sourceRows.map((row) => requireId(row.customer_id, "customer_id")),
        );
        const mapped: Array<{ id: string; row: ExportRow }> = [];
        for (const row of sourceRows) {
          if (
            query.filters.currency && row.currency !== query.filters.currency
          ) continue;
          if (row.company_id !== auth.companyId) {
            throw new Error("Receipt row escaped the authenticated company.");
          }
          const customerId = requireId(row.customer_id, "customer_id");
          const customer = customerMap.get(customerId);
          if (!customer) {
            throw new Error("Receipt customer metadata is unavailable.");
          }
          requireString(customer.customer_code, "customer_code");
          requireString(customer.customer_name, "customer_name");
          assertCompanyCurrency(row.base_currency, company);
          const receiptNative = moneyToMinor(
            row.receipt_amount,
            "receipt_amount_native",
          );
          const allocatedNative = moneyToMinor(
            row.allocated_amount,
            "allocated_amount_native",
          );
          const unallocatedNative = moneyToMinor(
            row.unallocated_amount,
            "unallocated_amount_native",
          );
          if (allocatedNative + unallocatedNative !== receiptNative) {
            throw new Error(
              "Authoritative receipt allocation values do not reconcile.",
            );
          }
          const baseAmount = moneyToMinor(row.base_amount, "base_amount");
          const unallocatedBase = multiplyMoneyByRate(
            row.unallocated_amount,
            row.exchange_rate,
            "unallocated_base",
          );
          addCurrency(
            currencies,
            row.currency,
            row.receipt_amount,
            row.base_amount,
          );
          const receiptId = requireId(row.id, "receipt_id");
          mapped.push({
            id: receiptId,
            row: {
              receipt_id: receiptId,
              receipt_no: requireString(row.receipt_no, "receipt_no"),
              receipt_date: requireDate(row.receipt_date, "receipt_date"),
              customer_id: customerId,
              customer_code: customer.customer_code,
              customer_name: customer.customer_name,
              status: requireEnum(row.status, RECEIPT_STATUSES, "status"),
              payment_method: requireEnum(
                row.payment_method,
                PAYMENT_METHODS,
                "payment_method",
              ),
              currency: requireString(row.currency, "currency"),
              receipt_amount_native: minorToMoney(receiptNative),
              allocated_amount_native: minorToMoney(allocatedNative),
              unallocated_amount_native: minorToMoney(unallocatedNative),
              booked_exchange_rate: decimalString(
                row.exchange_rate,
                "booked_exchange_rate",
              ),
              base_currency: company.base_currency,
              base_amount: minorToMoney(baseAmount),
              unallocated_base: minorToMoney(unallocatedBase),
              fx_source_category: row.fx_source_category === null
                ? null
                : requireString(row.fx_source_category, "fx_source_category"),
              fx_lifecycle_status: requireFxLifecycle(
                row.fx_decision?.lifecycle_status,
              ),
            },
          });
        }
        return mapped;
      },
    );
    const sortField = query.sort.field === "receipt_amount"
      ? "receipt_amount_native"
      : query.sort.field === "unallocated_amount"
      ? "unallocated_amount_native"
      : query.sort.field;
    sortRows(
      rows,
      sortField,
      query.sort.order,
      "receipt_id",
      new Set([
        "receipt_amount_native",
        "base_amount",
        "unallocated_amount_native",
      ]),
    );
    const receiptBase = sumMoney(rows, "base_amount");
    const unallocatedBase = sumMoney(rows, "unallocated_base");
    return this.dataset("receipts", company, query, rows, {
      receipt_count: rows.length,
      base_currency: company.base_currency,
      receipt_base_total: minorToMoney(receiptBase),
      allocated_base_total: minorToMoney(receiptBase - unallocatedBase),
      unallocated_base_total: minorToMoney(unallocatedBase),
      native_by_currency: currencySummary(currencies),
      status_breakdown: buildBreakdown(rows, "status", [
        "base_amount",
        "unallocated_base",
      ]),
      payment_method_breakdown: buildBreakdown(
        rows,
        "payment_method",
        ["base_amount", "unallocated_base"],
      ),
    });
  }

  async exportCustomerOutstanding(
    auth: AuthContext,
    query: ExportQuery,
  ): Promise<ExportDataset> {
    const company = await this.company(auth);
    const currencies = new Map<string, CurrencyAccumulator>();
    const rows = await collectPages(
      (page) =>
        this.repository.getAgingPage(
          auth,
          query.filters.as_of_date,
          page,
          query.filters.credit_rating,
        ),
      async (sourceRows) => {
        const ids = sourceRows.map((row) =>
          requireId(row.customer_id, "customer_id")
        );
        const [customerMap, oldestDueDates] = await Promise.all([
          this.repository.getCustomers(auth, ids),
          this.repository.getOldestDueDates(
            auth,
            ids,
            query.filters.as_of_date,
          ),
        ]);
        const search = query.filters.search?.toLocaleLowerCase();
        const mapped: Array<{ id: string; row: ExportRow }> = [];
        for (const row of sourceRows) {
          const customerId = requireId(row.customer_id, "customer_id");
          const customer = customerMap.get(customerId);
          if (!customer) {
            throw new Error("Outstanding customer metadata is unavailable.");
          }
          if (customer.credit_rating !== row.credit_rating) {
            throw new Error(
              "Outstanding customer rating metadata is inconsistent.",
            );
          }
          requireString(customer.customer_code, "customer_code");
          requireString(customer.customer_name, "customer_name");
          requireEnum(
            customer.customer_status,
            CUSTOMER_STATUSES,
            "customer_status",
          );
          requireEnum(customer.credit_rating, CREDIT_RATINGS, "credit_rating");
          if (
            query.filters.customer_status &&
            customer.customer_status !== query.filters.customer_status
          ) continue;
          if (
            search &&
            !customer.customer_code.toLocaleLowerCase().includes(search) &&
            !customer.customer_name.toLocaleLowerCase().includes(search)
          ) continue;
          assertCompanyCurrency(row.base_currency, company);
          const current = moneyToMinor(row.current_amount, "current_base");
          const b1 = moneyToMinor(row.bucket_1_30, "bucket_1_30_base");
          const b31 = moneyToMinor(row.bucket_31_60, "bucket_31_60_base");
          const b61 = moneyToMinor(row.bucket_61_90, "bucket_61_90_base");
          const b91 = moneyToMinor(row.bucket_over_90, "bucket_91_plus_base");
          const outstanding = moneyToMinor(row.base_total, "outstanding_base");
          if (current + b1 + b31 + b61 + b91 !== outstanding) {
            throw new Error(
              "Authoritative outstanding buckets do not reconcile.",
            );
          }
          for (const item of row.by_currency) {
            addCurrency(
              currencies,
              item.currency,
              item.amount,
              item.base_amount,
              requireInteger(item.count, "by_currency.count"),
            );
          }
          mapped.push({
            id: customerId,
            row: {
              customer_id: customerId,
              customer_code: customer.customer_code,
              customer_name: customer.customer_name,
              customer_status: customer.customer_status,
              credit_rating: requireString(row.credit_rating, "credit_rating"),
              credit_limit: minorToMoney(
                moneyToMinor(customer.credit_limit, "credit_limit"),
              ),
              base_currency: company.base_currency,
              outstanding_base: minorToMoney(outstanding),
              overdue_base: minorToMoney(b1 + b31 + b61 + b91),
              current_base: minorToMoney(current),
              bucket_1_30_base: minorToMoney(b1),
              bucket_31_60_base: minorToMoney(b31),
              bucket_61_90_base: minorToMoney(b61),
              bucket_91_plus_base: minorToMoney(b91),
              oldest_due_date: oldestDueDates.get(customerId) ?? null,
            },
          });
        }
        return mapped;
      },
    );
    sortRows(
      rows,
      query.sort.field,
      query.sort.order,
      "customer_id",
      new Set(["outstanding_base", "overdue_base"]),
    );
    return this.dataset("customer-outstanding", company, query, rows, {
      customer_count: rows.length,
      base_currency: company.base_currency,
      outstanding_base_total: minorToMoney(sumMoney(rows, "outstanding_base")),
      overdue_base_total: minorToMoney(sumMoney(rows, "overdue_base")),
      current_base_total: minorToMoney(sumMoney(rows, "current_base")),
      bucket_1_30_base_total: minorToMoney(sumMoney(rows, "bucket_1_30_base")),
      bucket_31_60_base_total: minorToMoney(
        sumMoney(rows, "bucket_31_60_base"),
      ),
      bucket_61_90_base_total: minorToMoney(
        sumMoney(rows, "bucket_61_90_base"),
      ),
      bucket_91_plus_base_total: minorToMoney(
        sumMoney(rows, "bucket_91_plus_base"),
      ),
      credit_limit_total: minorToMoney(sumMoney(rows, "credit_limit")),
      native_by_currency: currencySummary(currencies),
    });
  }
}
