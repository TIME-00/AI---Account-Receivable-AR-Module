// ============================================================================
// TSH Synergy AR — Customer list / detail / exposure hooks (B9DD-RR-002)
//
// Replaces the fake "all customers" authority (`useAllCustomers`, which fetched
// page 1 with page_size=100 and treated it as the complete set) with:
//
//   • useCustomerList  — a genuinely server-paginated list that pushes `search`
//     and `status` to the backend (customers/service.ts::listCustomers applies
//     `.eq('status', …)` and an ilike across customer_name/short_name/customer_id).
//   • useCustomer      — the GOVERNED detail endpoint `GET /customers/:id`
//     (customers/service.ts::getCustomerById), which enforces is_deleted /
//     is_hidden / assignment scope and 404s rather than silently omitting.
//   • useCustomerExposureMap — bounded, authoritative aging exposure for exactly
//     the customer IDs visible on the current page.
//
// No hook here derives a monetary figure. Exposure comes from
// `ar_aging_by_customer`; nothing is summed in the browser.
// ============================================================================

"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useApi } from "@/hooks/use-api";
import { fetchAgingRowsForCustomerIds } from "@/lib/aging-lookup";
import { useAuthContext } from "@/hooks/use-auth-context";
import { useCompanyStore } from "@/stores/company-store";
import {
  CREDIT_RATINGS,
  type CreditRating,
  type Customer,
  type CustomerAgingRow,
} from "@/types";
import type { ListPagination } from "@/hooks/use-invoices";

/** Server page size for the Customer list (backend clamps to MAX_PAGE_SIZE=100). */
export const CUSTOMER_PAGE_SIZE = 25;

/**
 * Every filter here is supported SERVER-side by `GET /customers`
 * (customers/index.ts ~101). None is a client-side filter over a capped page.
 */
export interface CustomerListFilters {
  search?: string;
  /** `undefined`/"All" means all statuses. */
  status?: string;
  /** `undefined`/"All" means all ratings. */
  creditRating?: string;
}

export interface CustomerListResult {
  rows: Customer[];
  pagination: ListPagination;
}

export interface RatingCustomerQueryOptions {
  rating: CreditRating | null;
  page: number;
  open: boolean;
}

/**
 * Server-paginated customer roster for the dashboard rating dialog.
 * Tenant/user identity participates in cache identity but is never sent as
 * request authority; `useApi` supplies the authenticated context.
 */
export function useRatingCustomers({
  rating,
  page,
  open,
}: RatingCustomerQueryOptions) {
  const api = useApi();
  const companyId = useCompanyStore((state) => state.companyId);
  const { data: auth, isSuccess: authReady } = useAuthContext();
  const userId = auth?.user.id ?? "";
  const validRating =
    rating !== null && CREDIT_RATINGS.includes(rating);
  const enabled =
    open &&
    authReady &&
    companyId.trim().length > 0 &&
    userId.trim().length > 0 &&
    validRating;

  return useQuery<CustomerListResult>({
    queryKey: [
      "customers",
      "rating-dialog",
      companyId,
      userId,
      rating,
      page,
      CUSTOMER_PAGE_SIZE,
    ],
    queryFn: async () => {
      if (!rating) throw new Error("A valid credit rating is required.");
      const response = await api.getWithMeta<Customer[]>("/customers", {
        params: {
          credit_rating: rating,
          page,
          page_size: CUSTOMER_PAGE_SIZE,
        },
      });
      return {
        rows: response.data,
        pagination: {
          total: response.meta?.total ?? response.data.length,
          page: response.meta?.page ?? page,
          page_size: response.meta?.page_size ?? CUSTOMER_PAGE_SIZE,
        },
      };
    },
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * One SERVER page of customers, with backend-supported filters applied server-side.
 *
 * The rows are already visibility-scoped by the backend (is_hidden / is_deleted
 * and assignment scope), so no client-side re-filter is applied.
 */
export function useCustomerList(
  page: number,
  pageSize: number = CUSTOMER_PAGE_SIZE,
  filters: CustomerListFilters = {},
) {
  const api = useApi();
  const search = filters.search?.trim() || undefined;
  const status = filters.status && filters.status !== "All" ? filters.status : undefined;
  const creditRating =
    filters.creditRating && filters.creditRating !== "All" ? filters.creditRating : undefined;

  return useQuery<CustomerListResult>({
    queryKey: ["customers", "list", page, pageSize, search ?? null, status ?? null, creditRating ?? null],
    queryFn: async () => {
      const res = await api.getWithMeta<Customer[]>("/customers", {
        params: {
          page,
          page_size: pageSize,
          ...(search ? { search } : {}),
          ...(status ? { status } : {}),
          ...(creditRating ? { credit_rating: creditRating } : {}),
        },
      });
      const rows = res.data ?? [];
      return {
        rows,
        pagination: {
          total: res.meta?.total ?? rows.length,
          page: res.meta?.page ?? page,
          page_size: res.meta?.page_size ?? pageSize,
        },
      };
    },
    // Keep the previous page/filter result on screen while the next one loads,
    // so the page (and its search box) is not torn down and re-mounted on every
    // keystroke or page change. `isFetching` drives the busy affordances.
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

/**
 * One customer, via the GOVERNED detail endpoint.
 *
 * B9DD-RR-002: the customer is NOT located inside a capped list response. A
 * valid customer beyond the first page resolves correctly here, and a genuinely
 * inaccessible one produces the backend's 404 rather than a fabricated
 * "Customer not found" caused by client-side paging.
 */
export function useCustomer(customerId: string | undefined) {
  const api = useApi();

  return useQuery<Customer>({
    queryKey: ["customers", "detail", customerId],
    queryFn: () => api.get<Customer>(`/customers/${customerId}`),
    enabled: Boolean(customerId),
    retry: false,
    staleTime: 60_000,
  });
}

export interface CustomerExposureMap {
  /** Authoritative aging rows for the requested customers, keyed by id. */
  rows: Map<string, CustomerAgingRow>;
  /**
   * True only when the aging result set was fully exhausted. Absence from
   * `rows` may be presented as ZERO exposure only when this is true.
   */
  exhausted: boolean;
}

/**
 * Authoritative aging exposure for exactly the customer IDs supplied (i.e. the
 * current visible page). Bounded: it fails explicitly rather than returning a
 * partial map that would read as false zeroes.
 */
export function useCustomerExposureMap(customerIds: string[]) {
  const api = useApi();
  // Stable key: order of the visible page must not cause refetch churn.
  const key = [...customerIds].sort().join(",");

  return useQuery<CustomerExposureMap>({
    queryKey: ["customers", "exposure-map", key],
    queryFn: () => fetchAgingRowsForCustomerIds(api, customerIds),
    enabled: customerIds.length > 0,
    retry: false,
    staleTime: 60_000,
  });
}
