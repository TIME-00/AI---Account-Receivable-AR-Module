import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Providers, createFakeApi, route, type FakeApi } from "@/test/harness";
import { useCompanyStore } from "@/stores/company-store";

let fakeApi: FakeApi;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

import { useAuthContext } from "@/hooks/use-auth-context";

describe("useAuthContext tenant cache identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCompanyStore.getState().setCompany("co-1", "Company One", "MYR");
  });

  it("re-fetches tenant authority and base currency after company selection changes", async () => {
    let call = 0;
    fakeApi = createFakeApi([
      route("/auth/me", () => {
        call += 1;
        return {
          data: {
            user: { id: `user-${call}`, email: null },
            company: {
              id: call === 1 ? "co-1" : "co-2",
              company_name: call === 1 ? "Company One" : "Company Two",
              base_currency: call === 1 ? "MYR" : "SGD",
            },
            role: "Finance Manager",
            capabilities: {},
          },
        };
      }),
    ]);

    const { result } = renderHook(() => useAuthContext(), { wrapper: Providers });
    await waitFor(() => expect(result.current.data?.company?.base_currency).toBe("MYR"));

    act(() => useCompanyStore.getState().setCompany("co-2", "Company Two", "SGD"));
    await waitFor(() => expect(result.current.data?.company?.base_currency).toBe("SGD"));
    expect(call).toBe(2);
  });

  it("does not query tenant authority while no company is selected", () => {
    fakeApi = createFakeApi([route("/auth/me", () => ({ data: {} }))]);
    act(() => useCompanyStore.getState().setCompany("", "", null));
    const { result } = renderHook(() => useAuthContext(), { wrapper: Providers });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fakeApi.calls).toHaveLength(0);
  });
});
