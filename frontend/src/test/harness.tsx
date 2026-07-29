// ============================================================================
// TSH Synergy AR — Test harness (Batch 9D-D, B9DD-FEIR-010)
//
// Mocks the API/hook BOUNDARY (the `useApi` client and the authenticated
// company context) so tests exercise real hooks, real components and real
// pages against contract-shaped responses — rather than only pure utilities.
// ============================================================================

import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { vi } from "vitest";
import type {
  CurrencyTotal,
  Invoice,
  MonetaryCollectionSummary,
  MonetarySummary,
  Receipt,
  Customer,
  CustomerAgingRow,
  ARSummary,
  FxDecisionReadSummary,
} from "@/types";

// ─── Query client ───────────────────────────────────────────────────────────

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const queryClient = client ?? createTestQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions & { client?: QueryClient },
) {
  const { client, ...rest } = options ?? {};
  return render(ui, {
    wrapper: ({ children }) => <Providers client={client}>{children}</Providers>,
    ...rest,
  });
}

// ─── Fake API client ────────────────────────────────────────────────────────

export interface FakeResponse {
  data: unknown;
  meta?: Record<string, unknown>;
}

/**
 * Matcher: path + params -> response.
 *
 * A handler may return a PROMISE (B9DD-FR-001), which lets a test hold a refetch
 * open and observe the UI while the new filter's response is genuinely in
 * flight — the only way to test placeholder/stale behaviour honestly.
 */
export type RouteHandler = (
  path: string,
  params: Record<string, unknown>,
) => FakeResponse | Promise<FakeResponse> | undefined;

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/** A promise a test resolves by hand, to control response timing precisely. */
export function createDeferred<T = FakeResponse>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface FakeApi {
  get: ReturnType<typeof vi.fn>;
  getWithMeta: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  rawFetch: ReturnType<typeof vi.fn>;
  /** Every getWithMeta call, for asserting the params actually sent. */
  calls: Array<{ path: string; params: Record<string, unknown> }>;
}

/**
 * Build a fake `useApi()` client from a list of route handlers.
 * Unmatched routes throw, so a test can never silently pass on a wrong path.
 */
export function createFakeApi(handlers: RouteHandler[]): FakeApi {
  const calls: FakeApi["calls"] = [];

  const resolve = (
    path: string,
    opts?: { params?: Record<string, unknown> },
  ): FakeResponse | Promise<FakeResponse> => {
    const params = opts?.params ?? {};
    calls.push({ path, params });
    for (const handler of handlers) {
      const result = handler(path, params);
      if (result) return result;
    }
    throw new Error(`No fake route matched: ${path} ${JSON.stringify(params)}`);
  };

  const getWithMeta = vi.fn(async (path: string, opts?: { params?: Record<string, unknown> }) => {
    const r = await resolve(path, opts);
    return { data: r.data, meta: r.meta };
  });
  const get = vi.fn(async (path: string, opts?: { params?: Record<string, unknown> }) => {
    const r = await resolve(path, opts);
    return r.data;
  });

  return {
    get,
    getWithMeta,
    post: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
    rawFetch: vi.fn(),
    calls,
  };
}

/** Route handler for an exact path. */
export function route(
  path: string,
  respond: (params: Record<string, unknown>) => FakeResponse | Promise<FakeResponse>,
): RouteHandler {
  return (p, params) => (p === path ? respond(params) : undefined);
}

/** Route handler matching a path prefix (e.g. "/reports/statement/"). */
export function routePrefix(
  prefix: string,
  respond: (params: Record<string, unknown>, path: string) => FakeResponse | Promise<FakeResponse>,
): RouteHandler {
  return (p, params) => (p.startsWith(prefix) ? respond(params, p) : undefined);
}

// ─── Contract-shaped fixture builders ───────────────────────────────────────

export function currencyTotal(
  currency: string,
  amount: number,
  base_amount: number,
  count = 1,
): CurrencyTotal {
  return { currency, amount, base_amount, count };
}

export function monetarySummary(
  by: CurrencyTotal[],
  baseTotal: number,
  baseCurrency = "MYR",
  amountBasis: MonetarySummary["amount_basis"] = "current_outstanding",
  normalizationBasis?: MonetarySummary["meta"]["normalization_basis"],
): MonetarySummary {
  const resolvedNormalizationBasis =
    normalizationBasis ??
    (amountBasis === "original_document_total"
      ? "original_booked_base_snapshot"
      : "current_balance_x_booked_rate");
  return {
    row_count: by.reduce((s, c) => s + c.count, 0),
    amount_basis: amountBasis,
    base_total: baseTotal,
    base_currency: baseCurrency,
    by_currency: by,
    meta: {
      base_currency: baseCurrency,
      multi_currency: by.length > 1,
      normalization_basis: resolvedNormalizationBasis,
    },
  };
}

export function collectionSummary(
  balance: MonetarySummary,
  document: MonetarySummary,
): MonetaryCollectionSummary {
  return { current_balance_summary: balance, document_total_summary: document };
}

export type V2SummaryVariant =
  | "complete"
  | "partial"
  | "all-unavailable"
  | "empty";

function v2Summary(
  amountBasis: "current_outstanding" | "current_unallocated" | "original_document_total",
  normalizationBasis: "current_balance_x_booked_rate" | "original_booked_base_snapshot",
  variant: V2SummaryVariant,
) {
  const groups =
    variant === "empty"
      ? []
      : variant === "all-unavailable"
        ? [
            {
              currency: "USD",
              amount: "100.00",
              base_amount: null,
              count: 2,
              authoritative_document_count: 0,
              unavailable_count: 2,
              base_available: false,
            },
          ]
        : [
            {
              currency: "MYR",
              amount: "125.50",
              base_amount: "125.50",
              count: 1,
              authoritative_document_count: 1,
              unavailable_count: 0,
              base_available: true,
            },
            {
              currency: "USD",
              amount: "100.00",
              base_amount: variant === "complete" ? "450.00" : null,
              count: 2,
              authoritative_document_count: variant === "complete" ? 2 : 0,
              unavailable_count: variant === "complete" ? 0 : 2,
              base_available: variant === "complete",
            },
          ];
  const matching = groups.reduce((sum, group) => sum + group.count, 0);
  const authoritative = groups.reduce(
    (sum, group) => sum + group.authoritative_document_count,
    0,
  );
  const unavailable = matching - authoritative;
  const baseTotal =
    variant === "empty"
      ? "0.00"
      : variant === "all-unavailable"
        ? null
        : variant === "complete"
          ? "575.50"
          : "125.50";

  return {
    row_count: matching,
    matching_document_count: matching,
    authoritative_document_count: authoritative,
    unavailable_count: unavailable,
    base_available: unavailable === 0,
    amount_basis: amountBasis,
    base_currency: "MYR",
    base_total: baseTotal,
    by_currency: groups,
    unavailable_by_currency: groups
      .filter((group) => group.unavailable_count > 0)
      .map((group) => ({
        currency: group.currency,
        document_count: group.unavailable_count,
      })),
    meta: {
      contract_version: 2,
      base_currency: "MYR",
      multi_currency: groups.length > 1,
      normalization_basis: normalizationBasis,
      authority_basis: "current_consistent_booked_fx_decision",
    },
  };
}

/** Exact Gate D v2 wire fixture for Invoice/Receipt collection tests. */
export function collectionSummaryV2(
  currentAmountBasis: "current_outstanding" | "current_unallocated",
  variant: V2SummaryVariant = "complete",
) {
  return {
    current_balance_summary: v2Summary(
      currentAmountBasis,
      "current_balance_x_booked_rate",
      variant,
    ),
    document_total_summary: v2Summary(
      "original_document_total",
      "original_booked_base_snapshot",
      variant,
    ),
  };
}

export function fxDecision(overrides: Partial<FxDecisionReadSummary> = {}): FxDecisionReadSummary {
  return {
    id: "dec-1",
    source_category: "CATALOG",
    approval_status: "Approved",
    lifecycle_status: "Posted",
    decision_version: 1,
    root_decision_id: "dec-1",
    supersedes_decision_id: null,
    import_origin: null,
    booked_rate: 4.45,
    deviation_pct: 0.1,
    stale_reference: false,
    fx_posting_eligible: true,
    ...overrides,
  };
}

export function invoiceFixture(overrides: Partial<Invoice> = {}): Invoice {
  const base = {
    id: "inv-1",
    company_id: "co-1",
    customer_id: "cust-1",
    customer_name: "Acme Sdn Bhd",
    invoice_no: "INV-0001",
    doc_type: "Invoice",
    invoice_date: "2026-07-01",
    due_date: "2026-07-31",
    currency: "USD",
    exchange_rate: 4.45,
    base_currency: "MYR",
    total_amount: 100,
    base_total: 445,
    outstanding: 100,
    status: "Open",
    base_available: true,
    fx_posting_eligibility: { gate: "fx_governance", eligible: true, reason: "approved" },
    fx_decision: fxDecision(),
    fx_decision_id: "dec-1",
  };
  return { ...base, ...overrides } as unknown as Invoice;
}

export function receiptFixture(overrides: Partial<Receipt> = {}): Receipt {
  const base = {
    id: "rcp-1",
    company_id: "co-1",
    customer_id: "cust-1",
    customer_name: "Acme Sdn Bhd",
    receipt_no: "RCP-0001",
    receipt_date: "2026-07-02",
    payment_method: "TT",
    currency: "USD",
    exchange_rate: 4.45,
    base_currency: "MYR",
    receipt_amount: 100,
    base_amount: 445,
    allocated_amount: 0,
    unallocated_amount: 100,
    status: "Posted",
    base_available: true,
    fx_posting_eligibility: { gate: "fx_governance", eligible: true, reason: "approved" },
    fx_decision: fxDecision(),
    fx_decision_id: "dec-1",
  };
  return { ...base, ...overrides } as unknown as Receipt;
}

export function customerFixture(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-uuid-1",
    company_id: "co-1",
    customer_id: "C0001",
    customer_name: "Acme Sdn Bhd",
    short_name: null,
    customer_type: "Corporate",
    registration_no: null,
    tax_id: null,
    status: "Active",
    customer_group_id: null,
    parent_id: null,
    is_deleted: false,
    is_hidden: false,
    hidden_reason: null,
    hidden_at: null,
    normalized_customer_name: "acme sdn bhd",
    bill_addr_line1: "",
    bill_addr_line2: null,
    bill_city: "",
    bill_state: "",
    bill_postal: "",
    bill_country: "MY",
    contact_name: "",
    contact_phone: "",
    contact_email: "",
    shipping_addresses: [],
    alt_contacts: [],
    default_currency: "MYR",
    ar_control_acct_id: null,
    revenue_acct_id: null,
    payment_term_id: null,
    credit_limit: 0,
    credit_rating: "A",
    e_invoice_enabled: false,
    created_by: null,
    updated_by: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

export function agingRowFixture(overrides: Partial<CustomerAgingRow> = {}): CustomerAgingRow {
  return {
    customer_id: "cust-1",
    customer_name: "Acme Sdn Bhd",
    customer_code: "CUST-001",
    credit_limit: 100000,
    credit_rating: "A",
    total_outstanding: 545,
    base_total: 545,
    base_currency: "MYR",
    by_currency: [currencyTotal("MYR", 100, 100, 1), currencyTotal("USD", 100, 445, 1)],
    meta: { base_currency: "MYR", multi_currency: true, normalization_basis: "current_balance_x_booked_rate" },
    current_amount: 545,
    bucket_1_30: 0,
    bucket_31_60: 0,
    bucket_61_90: 0,
    bucket_over_90: 0,
    ...overrides,
  };
}

export function arSummaryFixture(overrides: Partial<ARSummary> = {}): ARSummary {
  return {
    total_customers: 1,
    total_outstanding: 545,
    total_overdue: 0,
    overdue_percentage: 0,
    base_total: 545,
    base_currency: "MYR",
    by_currency: [currencyTotal("MYR", 100, 100, 1), currencyTotal("USD", 100, 445, 1)],
    meta: { base_currency: "MYR", multi_currency: true, normalization_basis: "current_balance_x_booked_rate" },
    aging_summary: [],
    ...overrides,
  };
}

/** The accepted MYR 545 multi-currency acceptance anchor. */
export const ANCHOR_BY_CURRENCY: CurrencyTotal[] = [
  currencyTotal("MYR", 100, 100, 1),
  currencyTotal("USD", 100, 445, 1),
];
export const ANCHOR_BASE_TOTAL = 545;
