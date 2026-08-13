// ============================================================================
// AR Copilot — entity registration lifecycle.
//
// `applyEntityRegistration` is unit-tested in `lib/ar-copilot/context.test.ts`.
// What is tested HERE is the lifecycle around it: a detail screen publishes the
// record it shows, and that registration must disappear again when the user
// navigates away, when the id changes, and when the record turns out to be
// unavailable. A registration that outlives its screen would let the Copilot
// label the next page with the previous page's invoice.
// ============================================================================

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let currentPath = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
}));

const {
  CopilotEntityProvider,
  useCopilotEntityRegistration,
  useRegisterCopilotEntity,
} = await import("./copilot-entity-provider");
const { useCopilotContext } = await import("@/hooks/use-copilot-context");
import type { CopilotEntityRegistration } from "@/lib/ar-copilot/context";

const INVOICE_A = "11111111-2222-4333-8444-555555555555";
const INVOICE_B = "99999999-8888-4777-8666-555555555555";

/** A detail screen: publishes what it is showing, and nothing else. */
function DetailScreen({
  registration,
}: {
  registration: CopilotEntityRegistration | null;
}) {
  useRegisterCopilotEntity(registration);
  return <p>detail screen</p>;
}

/** Reads back what the Copilot would actually use. */
function Observer() {
  const registration = useCopilotEntityRegistration();
  const context = useCopilotContext();
  return (
    <>
      <p data-testid="registered">
        {registration
          ? `${registration.entityType}:${registration.entityId}:${registration.displayNumber}`
          : "none"}
      </p>
      <p data-testid="hint">
        {`${context.hint.page}|${context.hint.entity_type ?? "-"}|${
          context.hint.entity_id ?? "-"
        }`}
      </p>
      <p data-testid="label">{context.label}</p>
    </>
  );
}

const registered = () => screen.getByTestId("registered").textContent;
const hint = () => screen.getByTestId("hint").textContent;

beforeEach(() => {
  currentPath = `/invoices/${INVOICE_A}`;
});

describe("entity registration lifecycle", () => {
  it("publishes the record a detail screen is showing", () => {
    render(
      <CopilotEntityProvider>
        <DetailScreen
          registration={{
            entityType: "credit_note",
            entityId: INVOICE_A,
            displayNumber: "CN-202608-00003",
          }}
        />
        <Observer />
      </CopilotEntityProvider>,
    );
    expect(registered()).toBe(`credit_note:${INVOICE_A}:CN-202608-00003`);
    // The Invoice-family route claims `invoice`; the screen refines it.
    expect(hint()).toBe(`invoice_detail|credit_note|${INVOICE_A}`);
    expect(screen.getByTestId("label").textContent).toBe("CN-202608-00003");
  });

  it("clears the registration when the detail screen unmounts", () => {
    const registration: CopilotEntityRegistration = {
      entityType: "invoice",
      entityId: INVOICE_A,
      displayNumber: "INV-202608-00012",
    };
    const { rerender } = render(
      <CopilotEntityProvider>
        <DetailScreen registration={registration} />
        <Observer />
      </CopilotEntityProvider>,
    );
    expect(registered()).toContain(INVOICE_A);

    // Navigate to a list screen: the detail component goes away.
    currentPath = "/receipts";
    rerender(
      <CopilotEntityProvider>
        <Observer />
      </CopilotEntityProvider>,
    );
    expect(registered()).toBe("none");
    expect(hint()).toBe("receipts|-|-");
  });

  it("replaces the registration when the id changes", () => {
    const { rerender } = render(
      <CopilotEntityProvider>
        <DetailScreen
          registration={{
            entityType: "invoice",
            entityId: INVOICE_A,
            displayNumber: "INV-202608-00012",
          }}
        />
        <Observer />
      </CopilotEntityProvider>,
    );
    expect(registered()).toContain(INVOICE_A);

    currentPath = `/invoices/${INVOICE_B}`;
    rerender(
      <CopilotEntityProvider>
        <DetailScreen
          registration={{
            entityType: "debit_note",
            entityId: INVOICE_B,
            displayNumber: "DN-202608-00004",
          }}
        />
        <Observer />
      </CopilotEntityProvider>,
    );
    expect(registered()).toBe(`debit_note:${INVOICE_B}:DN-202608-00004`);
    expect(hint()).toBe(`invoice_detail|debit_note|${INVOICE_B}`);
  });

  it("clears the registration when the record becomes unavailable", () => {
    const { rerender } = render(
      <CopilotEntityProvider>
        <DetailScreen
          registration={{
            entityType: "invoice",
            entityId: INVOICE_A,
            displayNumber: "INV-202608-00012",
          }}
        />
        <Observer />
      </CopilotEntityProvider>,
    );
    expect(registered()).toContain(INVOICE_A);

    // The query errored or the record was cancelled out from under the page.
    rerender(
      <CopilotEntityProvider>
        <DetailScreen registration={null} />
        <Observer />
      </CopilotEntityProvider>,
    );
    expect(registered()).toBe("none");
    // The route still identifies the record, so page context survives; only
    // the refinement and the display number are gone.
    expect(hint()).toBe(`invoice_detail|invoice|${INVOICE_A}`);
    expect(screen.getByTestId("label").textContent).toBe("Invoice Detail");
  });

  it("never lets a registration from another record relabel the page", () => {
    // A registration that outlived its screen: the route is now Invoice B.
    currentPath = `/invoices/${INVOICE_B}`;
    render(
      <CopilotEntityProvider>
        <DetailScreen
          registration={{
            entityType: "credit_note",
            entityId: INVOICE_A,
            displayNumber: "CN-202608-00003",
          }}
        />
        <Observer />
      </CopilotEntityProvider>,
    );
    expect(hint()).toBe(`invoice_detail|invoice|${INVOICE_B}`);
    expect(screen.getByTestId("label").textContent).toBe("Invoice Detail");
  });

  it("does not crash when a detail screen renders outside the provider", () => {
    // A page rendered in isolation simply has no Copilot to inform.
    expect(() =>
      render(
        <DetailScreen
          registration={{
            entityType: "invoice",
            entityId: INVOICE_A,
            displayNumber: "INV-202608-00012",
          }}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText("detail screen")).toBeInTheDocument();
  });
});
