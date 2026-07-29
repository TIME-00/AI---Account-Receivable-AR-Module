import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import {
  collectionSummaryV2,
  createFakeApi,
  receiptFixture,
  renderWithProviders,
  route,
  type FakeApi,
} from "@/test/harness";

let fakeApi: FakeApi;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

vi.mock("@/hooks/use-auth-context", () => ({
  useAuthContext: () => ({
    data: {
      user: { id: "user-1", email: null },
      capabilities: { can_read_reports: true },
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/reports/receipts",
}));

import ReceiptSummaryPage from "@/app/(dashboard)/reports/receipts/page";

beforeEach(() => {
  vi.clearAllMocks();
  fakeApi = createFakeApi([
    route("/receipts", (params) => ({
      data: [receiptFixture()],
      meta: {
        total: 2,
        page: 1,
        page_size: Number(params.page_size),
        summary: collectionSummaryV2(
          "current_unallocated",
          "all-unavailable",
        ),
      },
    })),
  ]);
});

describe("ReceiptSummaryPage Gate D", () => {
  it("renders all-unavailable v2 totals without a false base-currency zero", async () => {
    renderWithProviders(<ReceiptSummaryPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Not available").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("USD 100.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("MYR 0.00")).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Company-base total excludes 2 documents without verified booked FX.",
      ).length,
    ).toBeGreaterThan(0);
  });
});
