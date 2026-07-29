import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import {
  collectionSummaryV2,
  createFakeApi,
  invoiceFixture,
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
  usePathname: () => "/reports/invoices",
}));

import InvoiceSummaryPage from "@/app/(dashboard)/reports/invoices/page";

beforeEach(() => {
  vi.clearAllMocks();
  fakeApi = createFakeApi([
    route("/invoices", (params) => ({
      data: [invoiceFixture()],
      meta: {
        total: params.status ? 1 : 3,
        page: 1,
        page_size: Number(params.page_size),
        summary: collectionSummaryV2("current_outstanding", "partial"),
      },
    })),
  ]);
});

describe("InvoiceSummaryPage Gate D", () => {
  it("renders v2 partial authority without formatting it as a complete total", async () => {
    renderWithProviders(<InvoiceSummaryPage />);
    await waitFor(() =>
      expect(
        screen.getAllByText("Authoritative company-base subtotal").length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("MYR 125.50").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Company-base total excludes 2 documents without verified booked FX.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("MYR 575.50")).not.toBeInTheDocument();
  });
});
