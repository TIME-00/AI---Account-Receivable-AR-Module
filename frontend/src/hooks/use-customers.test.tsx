import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  Providers,
  createFakeApi,
  customerFixture,
  route,
  type FakeApi,
} from "@/test/harness";
import { useCompanyStore } from "@/stores/company-store";

let fakeApi: FakeApi;
let userId = "user-1";

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

vi.mock("@/hooks/use-auth-context", () => ({
  useAuthContext: () => ({
    data: { user: { id: userId, email: null } },
    isSuccess: true,
  }),
}));

import { useRatingCustomers } from "@/hooks/use-customers";

beforeEach(() => {
  vi.clearAllMocks();
  userId = "user-1";
  useCompanyStore.getState().setCompany("co-1", "Company One", "MYR");
});

describe("useRatingCustomers", () => {
  it("sends only rating and server pagination parameters", async () => {
    fakeApi = createFakeApi([
      route("/customers", (params) => ({
        data: [customerFixture()],
        meta: { total: 26, page: params.page, page_size: params.page_size },
      })),
    ]);
    const { result } = renderHook(
      () => useRatingCustomers({ rating: "A", page: 2, open: true }),
      { wrapper: Providers },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fakeApi.calls).toEqual([
      {
        path: "/customers",
        params: { credit_rating: "A", page: 2, page_size: 25 },
      },
    ]);
    expect(fakeApi.calls[0].params).not.toHaveProperty("company_id");
    expect(fakeApi.calls[0].params).not.toHaveProperty("user_id");
    expect(fakeApi.calls[0].params).not.toHaveProperty("outstanding");
  });

  it("does not fetch until the dialog and authenticated identity are ready", () => {
    fakeApi = createFakeApi([
      route("/customers", () => ({ data: [], meta: { total: 0 } })),
    ]);
    renderHook(
      () => useRatingCustomers({ rating: "A", page: 1, open: false }),
      { wrapper: Providers },
    );
    expect(fakeApi.calls).toHaveLength(0);
  });

  it("does not reuse rows after a company, user, or rating change", async () => {
    fakeApi = createFakeApi([
      route("/customers", (params) => ({
        data: [
          customerFixture({
            id: `${useCompanyStore.getState().companyId}-${userId}-${params.credit_rating}`,
            customer_name: `${useCompanyStore.getState().companyId} ${userId} ${params.credit_rating}`,
            credit_rating: params.credit_rating as "A" | "B",
          }),
        ],
        meta: { total: 1, page: 1, page_size: 25 },
      })),
    ]);
    const props = { rating: "A" as const, page: 1, open: true };
    const { result, rerender } = renderHook(
      ({ rating }: { rating: "A" | "B" }) =>
        useRatingCustomers({ ...props, rating }),
      { wrapper: Providers, initialProps: { rating: "A" as "A" | "B" } },
    );
    await waitFor(() =>
      expect(result.current.data?.rows[0].customer_name).toBe("co-1 user-1 A"),
    );

    rerender({ rating: "B" });
    await waitFor(() =>
      expect(result.current.data?.rows[0].customer_name).toBe("co-1 user-1 B"),
    );
    useCompanyStore.getState().setCompany("co-2", "Company Two", "SGD");
    await waitFor(() =>
      expect(result.current.data?.rows[0].customer_name).toBe("co-2 user-1 B"),
    );
    userId = "user-2";
    rerender({ rating: "B" });
    await waitFor(() =>
      expect(result.current.data?.rows[0].customer_name).toBe("co-2 user-2 B"),
    );
  });
});
