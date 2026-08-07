// Gate E — AutomationDialog accessibility contract (Blocker 6).
//
// Every Gate E modal must carry a real, programmatic description (Radix links it
// via `aria-describedby`), trap focus, take initial focus, close on Escape, and
// restore focus to the trigger. We never emit an empty `aria-describedby` or
// point it at a missing element.
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AutomationDialog } from "./dialog";

function Harness({
  description,
  visuallyHidden = false,
}: {
  description: string;
  visuallyHidden?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <AutomationDialog
        open={open}
        onOpenChange={setOpen}
        title="Confirm action"
        description={description}
        visuallyHiddenDescription={visuallyHidden}
        footer={
          <button type="button" onClick={() => setOpen(false)}>
            Confirm
          </button>
        }
      >
        <p>Body content</p>
      </AutomationDialog>
    </>
  );
}

describe("AutomationDialog accessibility", () => {
  it("exposes a real, non-empty accessible description linked by Radix", async () => {
    render(<Harness description="This changes the operating mode." />);
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));

    const dialog = await screen.findByRole("dialog");
    // The description is programmatically associated…
    expect(dialog).toHaveAccessibleDescription("This changes the operating mode.");
    // …via a NON-empty aria-describedby that points at an element that exists.
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).not.toBeNull();
  });

  it("keeps the description element present (and linked) when visually hidden", async () => {
    render(<Harness description="Visually hidden but announced." visuallyHidden />);
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleDescription("Visually hidden but announced.");
    const describedBy = dialog.getAttribute("aria-describedby");
    const el = document.getElementById(describedBy as string);
    expect(el).not.toBeNull();
    // Present in the DOM but visually hidden (screen-reader only).
    expect(el).toHaveClass("sr-only");
  });

  it("has an accessible name from its title", async () => {
    render(<Harness description="desc" />);
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Confirm action");
  });

  it("moves initial focus into the dialog", async () => {
    render(<Harness description="desc" />);
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it("closes on Escape and releases focus (no residual focus trap)", async () => {
    const user = userEvent.setup();
    render(<Harness description="desc" />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Focus is released from the (now removed) dialog — it is never left trapped
    // inside closed dialog content. Radix restores focus to the trigger in a real
    // browser; jsdom's FocusScope resets to <body>, so we assert the verifiable
    // safety property here and cover real restoration in the Chromium E2E.
    expect(dialog.contains(document.activeElement)).toBe(false);
    expect(document.body.contains(document.activeElement)).toBe(true);
  });

  it("keeps focus within the dialog while open (focus trap)", async () => {
    const user = userEvent.setup();
    render(<Harness description="desc" />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    // Tabbing cycles among the dialog's own focusable controls, never escaping
    // to the background trigger.
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
