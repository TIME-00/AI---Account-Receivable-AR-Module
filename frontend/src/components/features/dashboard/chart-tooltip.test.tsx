// ============================================================================
// Chart tooltip contrast — the Dark-mode black-text regression.
//
// Recharts' `DefaultTooltipContent` styles every item with
// `entry.color || '#000'` and applies `contentStyle` only to the outer wrapper,
// so a themed `contentStyle` produced a dark box containing black text. These
// tests render the real tooltip and assert the actual resolved colours.
// ============================================================================

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UiTheme } from "@/lib/theme/contract";
import { chartThemeFor } from "@/lib/theme/chart-theme";

// Drive the theme directly; the tooltip reads it through `useThemeOrDefault`.
let activeTheme: UiTheme = "dark";
vi.mock("@/providers/theme-provider", () => ({
  useThemeOrDefault: () => activeTheme,
}));

const { ChartTooltip } = await import(
  "@/components/features/dashboard/chart-tooltip"
);

const renderTooltip = (theme: UiTheme, props: Record<string, unknown> = {}) => {
  activeTheme = theme;
  return render(
    <ChartTooltip
      active
      label="A"
      payload={[{ value: 10106, name: "Current Outstanding", color: "#3b82f6" }]}
      currency="MYR"
      {...props}
    />,
  );
};

/** Relative luminance, for asserting light-vs-dark rather than exact hexes. */
function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const styleOf = (el: HTMLElement) => el.getAttribute("style") ?? "";

describe("dark tooltip is readable", () => {
  it("paints an elevated dark surface, not the Recharts white default", () => {
    const { container } = renderTooltip("dark");
    const box = container.querySelector("[data-chart-tooltip]") as HTMLElement;
    expect(box).toBeTruthy();
    expect(styleOf(box)).toContain("background: rgb(18, 27, 47)");
    expect(styleOf(box)).not.toContain("255, 255, 255");
  });

  it("never renders the value in black — the reported regression", () => {
    const { container } = renderTooltip("dark");
    const value = container.querySelector(
      "[data-chart-tooltip-value]",
    ) as HTMLElement;
    expect(value.textContent).toBe("MYR 10,106.00");
    const style = styleOf(value);
    expect(style).not.toContain("rgb(0, 0, 0)");
    expect(style).not.toContain("#000");
    expect(style).toContain("rgb(232, 237, 247)");
  });

  it("does not let a series colour become the value text colour", () => {
    // The old default used `entry.color` for item text. A series colour is
    // chosen for a filled mark, not for small type on the tooltip surface.
    const { container } = renderTooltip("dark");
    const value = container.querySelector(
      "[data-chart-tooltip-value]",
    ) as HTMLElement;
    expect(styleOf(value)).not.toContain("59, 130, 246"); // #3b82f6
  });

  it("keeps the title and caption readable rather than merely dim", () => {
    const { container } = renderTooltip("dark", {
      formatCaption: () => "Customers",
    });
    const title = container.querySelector(
      "[data-chart-tooltip-title]",
    ) as HTMLElement;
    const caption = container.querySelector(
      "[data-chart-tooltip-caption]",
    ) as HTMLElement;
    expect(styleOf(title)).toContain("rgb(163, 176, 201)");
    expect(styleOf(caption)).toContain("rgb(163, 176, 201)");
  });

  it("clears WCAG AA for every line of text", () => {
    const t = chartThemeFor("dark").tooltip;
    expect(contrast(t.valueColor, t.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.titleColor, t.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.captionColor, t.background)).toBeGreaterThanOrEqual(4.5);
    // The value is the point of the tooltip: it should be the strongest line.
    expect(contrast(t.valueColor, t.background)).toBeGreaterThan(
      contrast(t.titleColor, t.background),
    );
  });
});

describe("light tooltip stays professional", () => {
  it("paints a white elevated surface with dark text", () => {
    const { container } = renderTooltip("light");
    const box = container.querySelector("[data-chart-tooltip]") as HTMLElement;
    const value = container.querySelector(
      "[data-chart-tooltip-value]",
    ) as HTMLElement;
    expect(styleOf(box)).toContain("background: rgb(255, 255, 255)");
    expect(styleOf(value)).toContain("rgb(30, 41, 59)");
  });

  it("clears WCAG AA for every line of text", () => {
    const t = chartThemeFor("light").tooltip;
    expect(contrast(t.valueColor, t.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.titleColor, t.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.captionColor, t.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("is visibly different from the dark tooltip", () => {
    const dark = chartThemeFor("dark").tooltip;
    const light = chartThemeFor("light").tooltip;
    expect(dark.background).not.toBe(light.background);
    expect(dark.valueColor).not.toBe(light.valueColor);
    expect(luminance(light.background)).toBeGreaterThan(
      luminance(dark.background),
    );
  });
});

describe("tooltip content behaviour", () => {
  it("renders nothing when inactive, so it cannot cover the chart", () => {
    activeTheme = "dark";
    const { container } = render(
      <ChartTooltip active={false} payload={[{ value: 1 }]} />,
    );
    expect(container.querySelector("[data-chart-tooltip]")).toBeNull();
  });

  it("renders nothing for an empty payload", () => {
    activeTheme = "dark";
    const { container } = render(<ChartTooltip active payload={[]} />);
    expect(container.querySelector("[data-chart-tooltip]")).toBeNull();
  });

  it("falls back to the series name when the chart has no category label", () => {
    // A Pie has no axis label; without this the donut tooltip loses its title.
    const { container } = renderTooltip("dark", { label: undefined });
    expect(
      container.querySelector("[data-chart-tooltip-title]")?.textContent,
    ).toBe("Current Outstanding");
  });

  it("formats monetary values with the supplied currency and never assumes one", () => {
    const { container } = renderTooltip("dark");
    expect(
      container.querySelector("[data-chart-tooltip-value]")?.textContent,
    ).toBe("MYR 10,106.00");

    const { container: noCurrency } = renderTooltip("dark", { currency: null });
    expect(
      noCurrency.querySelector("[data-chart-tooltip-value]")?.textContent,
    ).toBe("10,106.00");
  });

  it("supports non-monetary charts through an explicit value renderer", () => {
    const { container } = renderTooltip("dark", {
      payload: [{ value: 2, name: "count" }],
      formatValue: (v: number) => String(v),
      formatCaption: (v: number) => (v === 1 ? "Customer" : "Customers"),
    });
    expect(
      container.querySelector("[data-chart-tooltip-value]")?.textContent,
    ).toBe("2");
    expect(
      container.querySelector("[data-chart-tooltip-caption]")?.textContent,
    ).toBe("Customers");
  });

  it("renders every entry in a multi-series payload without merging values", () => {
    const { container } = renderTooltip("dark", {
      payload: [
        { value: 1200, name: "Invoiced", dataKey: "invoiced" },
        { value: 800, name: "Collected", dataKey: "collected" },
      ],
      label: "August",
    });
    expect(container.querySelector("[data-chart-tooltip-title]")).toHaveTextContent(
      "August",
    );
    expect(
      [...container.querySelectorAll("[data-chart-tooltip-value]")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["MYR 1,200.00", "MYR 800.00"]);
  });

  it("announces the hovered value rather than showing it visually only", () => {
    renderTooltip("dark");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
