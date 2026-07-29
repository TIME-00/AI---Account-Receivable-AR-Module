// ============================================================================
// Gate B — Credit / Debit Note visibility and truthful empty states.
//
// Visibility (hidden-customer exclusion, assignment/cross-company scoping) is a
// SERVER property of ar_invoice_collection; the page must therefore rely on the
// server-filtered list (send the doc_type, render exactly what is returned) and
// never re-filter client-side. These tests assert that contract plus the
// truthful populated/empty presentation.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  createFakeApi,
  route,
  invoiceFixture,
  collectionSummary,
  monetarySummary,
  currencyTotal,
  type FakeApi,
} from "@/test/harness";
import { useCompanyStore } from "@/stores/company-store";

let fakeApi: FakeApi;

vi.mock("@/hooks/use-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-api")>();
  return { ...actual, useApi: () => fakeApi };
});

vi.mock("@/hooks/use-auth-context", () => ({
  useAuthContext: () => ({
    data: { user: { id: "user-1", email: null }, company: { id: "co-1", base_currency: "MYR" } },
    isLoading: false,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

import CreditNotesPage from "@/app/(dashboard)/credit-notes/page";

const summary = collectionSummary(
  monetarySummary([currencyTotal("MYR", 100, 100, 1)], 100, "MYR"),
  monetarySummary([currencyTotal("MYR", 100, 100, 1)], 100, "MYR", "original_document_total"),
);

beforeEach(() => {
  vi.clearAllMocks();
  useCompanyStore.getState().setCompany("co-1", "Company One", "MYR");
});

describe("Credit / Debit Notes page", () => {
  it("requests the Credit Note doc_type server-side and renders the returned rows verbatim", async () => {
    fakeApi = createFakeApi([
      route("/invoices", (params) => ({
        data:
          params.doc_type === "Credit Note"
            ? [
                invoiceFixture({ id: "cn-1", invoice_no: "CN-001", doc_type: "Credit Note", currency: "MYR", base_currency: "MYR", exchange_rate: 1 }),
                invoiceFixture({ id: "cn-2", invoice_no: "CN-002", doc_type: "Credit Note", currency: "MYR", base_currency: "MYR", exchange_rate: 1 }),
              ]
            : [],
        meta: { total: 2, page: 1, page_size: 20, summary },
      })),
    ]);
    renderWithProviders(<CreditNotesPage />);

    await waitFor(() => expect(screen.getByText("CN-001")).toBeInTheDocument());
    expect(screen.getByText("CN-002")).toBeInTheDocument();
    expect(screen.getAllByText("Not verified")).toHaveLength(2);
    const call = fakeApi.calls.find((c) => c.path === "/invoices");
    expect(call?.params.doc_type).toBe("Credit Note");
  });

  it("switches to Debit Note as a server-side filter", async () => {
    fakeApi = createFakeApi([
      route("/invoices", (params) => ({
        data:
          params.doc_type === "Debit Note"
            ? [invoiceFixture({ id: "dn-1", invoice_no: "DN-001", doc_type: "Debit Note", currency: "MYR", base_currency: "MYR", exchange_rate: 1 })]
            : [invoiceFixture({ id: "cn-1", invoice_no: "CN-001", doc_type: "Credit Note", currency: "MYR", base_currency: "MYR", exchange_rate: 1 })],
        meta: { total: 1, page: 1, page_size: 20, summary },
      })),
    ]);
    renderWithProviders(<CreditNotesPage />);
    await waitFor(() => expect(screen.getByText("CN-001")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Debit Notes" }));
    await waitFor(() => expect(screen.getByText("DN-001")).toBeInTheDocument());
    expect(fakeApi.calls.some((c) => c.params.doc_type === "Debit Note")).toBe(true);
  });

  it("shows a truthful empty state (no authorized visible documents), not a failure", async () => {
    fakeApi = createFakeApi([
      route("/invoices", () => ({ data: [], meta: { total: 0, page: 1, page_size: 20, summary } })),
    ]);
    renderWithProviders(<CreditNotesPage />);
    await waitFor(() =>
      expect(screen.getByText(/no visible credit notes/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/empty result, not an error/i)).toBeInTheDocument();
    expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument();
  });
});
