// ============================================================================
// Scroll reveal — behaviour, efficiency and accessibility.
// ============================================================================

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Reveal } from "@/components/ui/reveal";
import { __resetRevealObserver } from "@/hooks/use-reveal";

// ── A controllable IntersectionObserver ─────────────────────────────────────

interface Instance {
  callback: IntersectionObserverCallback;
  observed: Element[];
  unobserved: Element[];
}

let instances: Instance[] = [];
let constructed = 0;

class FakeObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number>;
  private readonly self: Instance;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    constructed += 1;
    this.rootMargin = String(options?.rootMargin ?? "");
    this.thresholds = [Number(options?.threshold ?? 0)];
    this.self = { callback, observed: [], unobserved: [] };
    instances.push(this.self);
  }
  observe(el: Element) { this.self.observed.push(el); }
  unobserve(el: Element) { this.self.unobserved.push(el); }
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

function intersect(el: Element) {
  for (const inst of instances) {
    if (!inst.observed.includes(el)) continue;
    inst.callback(
      [{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  }
}

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as typeof window.matchMedia;
}

beforeEach(() => {
  instances = [];
  constructed = 0;
  __resetRevealObserver();
  setReducedMotion(false);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  __resetRevealObserver();
  vi.unstubAllGlobals();
});

describe("Reveal", () => {
  it("starts hidden and reveals when the section enters the viewport", async () => {
    render(<Reveal><p>Aging summary</p></Reveal>);
    const section = screen.getByText("Aging summary").parentElement!;

    expect(section).toHaveAttribute("data-revealed", "false");
    expect(section).toHaveClass("ds-reveal");

    intersect(section);

    await waitFor(() =>
      expect(section).toHaveAttribute("data-revealed", "true"),
    );
  });

  it("reveals once and then stops observing, so scrolling past does not re-animate", async () => {
    render(<Reveal><p>Collection trend</p></Reveal>);
    const section = screen.getByText("Collection trend").parentElement!;

    intersect(section);
    await waitFor(() =>
      expect(section).toHaveAttribute("data-revealed", "true"),
    );

    expect(instances[0].unobserved).toContain(section);
  });

  it("shares a single observer across many sections", () => {
    render(
      <>
        <Reveal><p>one</p></Reveal>
        <Reveal><p>two</p></Reveal>
        <Reveal><p>three</p></Reveal>
        <Reveal><p>four</p></Reveal>
      </>,
    );

    // One observer for the whole page, not one per section.
    expect(constructed).toBe(1);
    expect(instances[0].observed).toHaveLength(4);
  });

  it("attaches no scroll listener", () => {
    const addListener = vi.spyOn(window, "addEventListener");
    render(<Reveal><p>section</p></Reveal>);
    const scrollListeners = addListener.mock.calls.filter(([type]) => type === "scroll");
    expect(scrollListeners).toHaveLength(0);
    addListener.mockRestore();
  });

  it("reveals immediately under prefers-reduced-motion", () => {
    setReducedMotion(true);
    render(<Reveal><p>Reduced</p></Reveal>);
    const section = screen.getByText("Reduced").parentElement!;

    expect(section).toHaveAttribute("data-revealed", "true");
    // Never observed at all — no motion is scheduled.
    expect(instances[0]?.observed ?? []).not.toContain(section);
  });

  it("reveals immediately when IntersectionObserver is unavailable", () => {
    vi.unstubAllGlobals();
    // @ts-expect-error deliberately removing the API to model an old browser
    delete window.IntersectionObserver;
    __resetRevealObserver();

    render(<Reveal><p>Fallback</p></Reveal>);
    expect(screen.getByText("Fallback").parentElement!).toHaveAttribute(
      "data-revealed",
      "true",
    );
  });

  it("does not block clicks or focus while still hidden", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Reveal>
        <button type="button" onClick={onClick}>Export</button>
      </Reveal>,
    );

    const button = screen.getByRole("button", { name: "Export" });
    expect(button.closest("[data-revealed]")).toHaveAttribute("data-revealed", "false");

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    button.focus();
    expect(button).toHaveFocus();
  });

  it("renders as a semantic element when asked", () => {
    render(<Reveal as="section"><p>semantic</p></Reveal>);
    expect(screen.getByText("semantic").parentElement!.tagName).toBe("SECTION");
  });

  it("applies a stagger delay without changing layout", () => {
    render(<Reveal delayMs={60}><p>staggered</p></Reveal>);
    const section = screen.getByText("staggered").parentElement!;
    expect(section.style.transitionDelay).toBe("60ms");
    expect(section.style.height).toBe("");
    expect(section.style.position).toBe("");
  });
});
