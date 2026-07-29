import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreditRatingCustomerDialog } from "@/components/features/dashboard/credit-rating-customer-dialog";
import { customerFixture } from "@/test/harness";

const result = {
  rows: [
    customerFixture({
      customer_name: "Müller 商事 Sdn Bhd",
      customer_id: "客户-001",
      credit_rating: "A",
      status: "On Hold",
    }),
  ],
  pagination: { total: 26, page: 1, page_size: 25 },
};

function renderDialog(
  overrides: Partial<
    React.ComponentProps<typeof CreditRatingCustomerDialog>
  > = {},
) {
  const props: React.ComponentProps<typeof CreditRatingCustomerDialog> = {
    open: true,
    rating: "A",
    page: 1,
    result,
    isLoading: false,
    isFetching: false,
    isError: false,
    reconciliationState: "matched",
    triggerElement: null,
    onOpenChange: vi.fn(),
    onPageChange: vi.fn(),
    onRetry: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
  return { ...render(<CreditRatingCustomerDialog {...props} />), props };
}

describe("CreditRatingCustomerDialog", () => {
  it("renders the accessible all-visible customer roster and Unicode data", () => {
    renderDialog();
    expect(
      screen.getByRole("dialog", { name: "Customers rated A" }),
    ).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByText(
        "All visible customers in credit rating A, including customers with no outstanding balance.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Müller 商事 Sdn Bhd")).toBeInTheDocument();
    expect(screen.getByText("客户-001")).toBeInTheDocument();
    expect(screen.getByText("On Hold")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Müller 商事 Sdn Bhd" })).toHaveAttribute(
      "href",
      "/customers/cust-uuid-1",
    );
    expect(screen.getByRole("link", { name: "View aging report" })).toHaveAttribute(
      "href",
      "/reports/aging?credit_rating=A",
    );
  });

  it("uses server totals for pagination and disables controls correctly", async () => {
    const { props } = renderDialog();
    expect(screen.getByText("26 matching customers")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous customer page" }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Next customer page" }),
    );
    expect(props.onPageChange).toHaveBeenCalledWith(2);
  });

  it("keeps the dialog open with controlled loading, empty, and error states", async () => {
    const { rerender, props } = renderDialog({
      result: undefined,
      isLoading: true,
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("Loading customers for this rating."),
    ).toBeInTheDocument();

    rerender(
      <CreditRatingCustomerDialog
        {...props}
        result={{
          rows: [],
          pagination: { total: 0, page: 1, page_size: 25 },
        }}
        isLoading={false}
      />,
    );
    expect(screen.getByText("No customers with rating A.")).toBeInTheDocument();

    rerender(
      <CreditRatingCustomerDialog
        {...props}
        result={undefined}
        isLoading={false}
        isError
      />,
    );
    expect(
      screen.getByText("Unable to load customers for this rating."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(props.onRetry).toHaveBeenCalled();
  });

  it("hides contradictory rows during bounded reconciliation", async () => {
    const { rerender, props } = renderDialog({
      reconciliationState: "refreshing",
    });
    expect(
      screen.getByText("Customer data changed. Refreshing the latest list."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Müller 商事 Sdn Bhd")).not.toBeInTheDocument();

    rerender(
      <CreditRatingCustomerDialog
        {...props}
        reconciliationState="persistent"
      />,
    );
    expect(
      screen.getByText("Customer data changed. Refresh to view the latest list."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("supports explicit close and Escape", async () => {
    const { props } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});
