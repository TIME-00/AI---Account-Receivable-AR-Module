// ============================================================================
// Filter chip group — selected/unselected hierarchy and semantics.
//
// The reported problem was that in Dark mode the selected chip rendered as a
// large pale-blue pill while unselected chips sank into the background. The
// cause was `bg-blue-600 text-white`: the dark theme reverses the chromatic
// ramps, so a filled `blue-600` resolves to a PALE blue.
// ============================================================================

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilterChipGroup } from "@/components/ui/filter-chip-group";
import {
  RATING_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
} from "@/lib/customer-filters";

const STATUS = STATUS_FILTER_OPTIONS;

function renderGroup(
  value = "All",
  onChange = vi.fn(),
  options: readonly string[] = STATUS,
  label = "Status",
) {
  const utils = render(
    <FilterChipGroup
      label={label}
      options={options}
      value={value}
      onChange={onChange}
    />,
  );
  return { ...utils, onChange };
}

const chip = (name: string) => screen.getByRole("button", { name });

describe("selected state", () => {
  it("uses the fill token tuned to carry white text, not a raw hue", () => {
    renderGroup("Active");
    const selected = chip("Active");
    expect(selected.className).toContain("bg-accent-fill");
    expect(selected.className).toContain("text-white");
  });

  it("does not reintroduce the pale-blue treatment", () => {
    renderGroup("Active");
    // `blue-600` is the exact class that inverted to a pale fill in dark.
    for (const c of ["bg-blue-600", "bg-blue-500", "bg-blue-700"]) {
      expect(chip("Active").className).not.toContain(c);
    }
  });

  it("distinguishes itself by border and surface, not colour alone", () => {
    renderGroup("Active");
    const selected = chip("Active");
    const unselected = chip("Blocked");
    expect(selected.className).toContain("border-accent-fill");
    expect(unselected.className).toContain("border-chip-border");
    expect(selected.className).not.toBe(unselected.className);
  });

  it("exposes selection semantically via aria-pressed", () => {
    renderGroup("Active");
    expect(chip("Active")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Blocked")).toHaveAttribute("aria-pressed", "false");
    expect(chip("All")).toHaveAttribute("aria-pressed", "false");
  });

  it("marks exactly one chip as selected", () => {
    renderGroup("Blocked");
    const pressed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveTextContent("Blocked");
  });
});

describe("unselected state", () => {
  it("sits on the chip surface token so inactive options stay scannable", () => {
    renderGroup("All");
    const unselected = chip("Inactive");
    expect(unselected.className).toContain("bg-chip-bg");
    expect(unselected.className).toContain("text-chip-text");
    expect(unselected.className).toContain("border-chip-border");
  });

  it("no longer uses the muted slate treatment that receded in dark", () => {
    renderGroup("All");
    const unselected = chip("Inactive");
    expect(unselected.className).not.toContain("bg-slate-100");
    expect(unselected.className).not.toContain("text-slate-600");
  });

  it("has a visible hover state on both surface and border", () => {
    renderGroup("All");
    const unselected = chip("Inactive");
    expect(unselected.className).toContain("hover:bg-chip-hover");
    expect(unselected.className).toContain("hover:border-chip-border-hover");
  });

  it("stays calm — a status name does not earn a semantic colour here", () => {
    // "Blocked" is a filter choice, not a customer state. Colouring it red
    // would compete with the real status badges in the table below.
    renderGroup("All");
    const blocked = chip("Blocked");
    const inactive = chip("Inactive");
    expect(blocked.className).toBe(inactive.className);
    expect(blocked.className).not.toMatch(/bg-red|text-red|bg-amber|text-amber/);
  });
});

describe("keyboard and focus", () => {
  it("renders real buttons, so tab order works with no custom handling", async () => {
    const user = userEvent.setup();
    renderGroup("All");
    await user.tab();
    expect(chip("All")).toHaveFocus();
    await user.tab();
    expect(chip("Active")).toHaveFocus();
  });

  it("selects with the keyboard alone", async () => {
    const user = userEvent.setup();
    const { onChange } = renderGroup("All");
    chip("Blocked").focus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("Blocked");
  });

  it("carries its own focus ring instead of relying on the global one", () => {
    renderGroup("Active");
    // Verified in a real browser: the global `*:focus-visible` ring lives in
    // Tailwind's base layer, so the selected chip's `shadow-glow-subtle`
    // utility overrode it and left a keyboard user with no visible indicator.
    // A `ring-*` utility composes into the same box-shadow chain as the glow.
    for (const el of [chip("Active"), chip("Blocked")]) {
      expect(el.className).toContain("focus-visible:ring-2");
      expect(el.className).toContain("focus-visible:ring-accent");
      expect(el.className).toContain("focus-visible:ring-offset-2");
    }
  });

  it("does not suppress focus styling without replacing it", () => {
    renderGroup("All");
    const className = chip("All").className;
    // `outline-none` is only acceptable because a ring replaces it.
    expect(className).toContain("outline-none");
    expect(className).toContain("focus-visible:ring-2");
  });
});

describe("group semantics and reuse", () => {
  it("labels the group for assistive technology", () => {
    renderGroup("All");
    expect(screen.getByRole("group", { name: "Status" })).toBeInTheDocument();
  });

  it("drives Rating through the same component and classes", () => {
    const { unmount } = renderGroup("All", vi.fn(), STATUS, "Status");
    const statusUnselected = chip("Inactive").className;
    unmount();

    renderGroup("AAA", vi.fn(), RATING_FILTER_OPTIONS, "Rating");
    expect(screen.getByRole("group", { name: "Rating" })).toBeInTheDocument();
    expect(chip("AAA").className).toContain("bg-accent-fill");
    // Identical unselected treatment across both groups.
    expect(chip("B").className).toBe(statusUnselected);
  });

  it("reports the chosen value verbatim so backend filtering is unchanged", async () => {
    const user = userEvent.setup();
    const { onChange } = renderGroup("All");
    await user.click(chip("On Hold"));
    expect(onChange).toHaveBeenCalledWith("On Hold");
  });

  it("distinguishes a disabled group without hiding it", () => {
    render(
      <FilterChipGroup
        label="Status"
        options={STATUS}
        value="All"
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(chip("Active")).toBeDisabled();
    expect(chip("Active").className).toContain("opacity-50");
  });
});

describe("filter vocabulary is unchanged", () => {
  it("offers All plus every customer status, in order", () => {
    expect([...STATUS_FILTER_OPTIONS]).toEqual([
      "All",
      "Active",
      "Inactive",
      "Blocked",
      "On Hold",
    ]);
  });

  it("offers All plus every credit rating, in order", () => {
    expect([...RATING_FILTER_OPTIONS]).toEqual([
      "All",
      "AAA",
      "AA",
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("renders one chip per option", () => {
    renderGroup("All");
    expect(screen.getAllByRole("button")).toHaveLength(STATUS.length);
  });
});
