// ============================================================================
// Theme authority — resolution order, persistence and cross-user safety.
//
// Exercises the real provider, the real toggle and the real storage module
// against a mocked API boundary and a mocked auth session.
// ============================================================================

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "@/test/harness";
import { themeKeyForUser } from "@/lib/theme/storage";

// ── Boundary mocks ──────────────────────────────────────────────────────────

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

let currentUser: { id: string } | null = null;
vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: currentUser }),
}));

const apiGet = vi.fn();
const apiPatch = vi.fn();
vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({
    get: apiGet,
    patch: apiPatch,
    getWithMeta: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
    rawFetch: vi.fn(),
  }),
}));

// Imported after the mocks so the provider picks them up.
const { ThemeProvider, useTheme } = await import("@/providers/theme-provider");
const { ThemeToggle } = await import("@/components/ui/theme-toggle");

// ── Probe ───────────────────────────────────────────────────────────────────

function ThemeProbe() {
  const { theme, isSaving } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="saving">{String(isSaving)}</span>
    </div>
  );
}

function renderTheme(ui: ReactNode = null) {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ThemeProbe />
        <ThemeToggle />
        {ui}
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const themeOf = () => screen.getByTestId("theme").textContent;
const isLightDocument = () => document.documentElement.classList.contains("light");

beforeEach(() => {
  currentUser = { id: "user-a" };
  window.localStorage.clear();
  document.documentElement.className = "dark";
  apiGet.mockReset();
  apiPatch.mockReset();
  toastError.mockReset();
  apiGet.mockResolvedValue({ theme: "dark", source: "default" });
  apiPatch.mockImplementation(async (_path: string, body: { theme: string }) => ({
    theme: body.theme,
    source: "saved",
  }));
});

afterEach(() => {
  document.documentElement.className = "";
});

// ── 1–3: resolution of the stored preference ────────────────────────────────

describe("stored preference resolution", () => {
  it("defaults to dark when the account has saved no theme", async () => {
    apiGet.mockResolvedValue({ theme: "dark", source: "default" });
    renderTheme();
    await waitFor(() => expect(themeOf()).toBe("dark"));
    expect(isLightDocument()).toBe(false);
  });

  it("restores a saved dark preference as dark", async () => {
    apiGet.mockResolvedValue({ theme: "dark", source: "saved" });
    renderTheme();
    await waitFor(() => expect(themeOf()).toBe("dark"));
    expect(isLightDocument()).toBe(false);
  });

  it("restores a saved light preference as light", async () => {
    apiGet.mockResolvedValue({ theme: "light", source: "saved" });
    renderTheme();
    await waitFor(() => expect(themeOf()).toBe("light"));
    expect(isLightDocument()).toBe(true);
  });

  it("requests the preference from the reviewed auth route", async () => {
    renderTheme();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet.mock.calls[0][0]).toBe("/auth/ui-preferences");
  });

  it("falls back to dark when the backend returns a malformed theme", async () => {
    apiGet.mockResolvedValue({ theme: "neon", source: "saved" });
    renderTheme();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await waitFor(() => expect(themeOf()).toBe("dark"));
    expect(isLightDocument()).toBe(false);
  });

  it("stays on the dark default when the preference cannot be loaded", async () => {
    apiGet.mockRejectedValue(new Error("network down"));
    renderTheme();
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(themeOf()).toBe("dark");
    expect(isLightDocument()).toBe(false);
  });
});

// ── 4–7: switching and persistence ──────────────────────────────────────────

describe("switching themes", () => {
  it("applies light immediately when the operator chooses it", async () => {
    const user = userEvent.setup();
    renderTheme();
    await waitFor(() => expect(themeOf()).toBe("dark"));

    await user.click(screen.getByRole("button", { name: "Light theme" }));

    expect(themeOf()).toBe("light");
    expect(isLightDocument()).toBe(true);
  });

  it("applies dark immediately when the operator switches back", async () => {
    const user = userEvent.setup();
    apiGet.mockResolvedValue({ theme: "light", source: "saved" });
    renderTheme();
    await waitFor(() => expect(themeOf()).toBe("light"));

    await user.click(screen.getByRole("button", { name: "Dark theme" }));

    expect(themeOf()).toBe("dark");
    expect(isLightDocument()).toBe(false);
  });

  it("persists the choice with a PATCH carrying only the theme", async () => {
    const user = userEvent.setup();
    renderTheme();
    await waitFor(() => expect(themeOf()).toBe("dark"));

    await user.click(screen.getByRole("button", { name: "Light theme" }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    const [path, body] = apiPatch.mock.calls[0];
    expect(path).toBe("/auth/ui-preferences");
    expect(body).toEqual({ theme: "light" });
    // The account is never named by the client; the backend derives it.
    expect(JSON.stringify(body)).not.toContain("user");
  });

  it("does not re-persist when the active theme is chosen again", async () => {
    const user = userEvent.setup();
    renderTheme();
    await waitFor(() => expect(themeOf()).toBe("dark"));

    await user.click(screen.getByRole("button", { name: "Dark theme" }));

    expect(apiPatch).not.toHaveBeenCalled();
  });

  it("reverts and reports when persistence fails, rather than failing silently", async () => {
    const user = userEvent.setup();
    // Hold the request open so the optimistic state is genuinely observable
    // before the failure lands.
    let rejectSave!: (error: Error) => void;
    apiPatch.mockImplementation(
      () => new Promise((_resolve, reject) => { rejectSave = reject; }),
    );
    renderTheme();
    await waitFor(() => expect(themeOf()).toBe("dark"));

    await user.click(screen.getByRole("button", { name: "Light theme" }));
    // Immediate feedback happens while the save is still in flight.
    expect(themeOf()).toBe("light");
    expect(isLightDocument()).toBe(true);

    rejectSave(new Error("save failed"));

    await waitFor(() => expect(themeOf()).toBe("dark"));
    expect(isLightDocument()).toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
    // The cache must not keep asserting a value the server rejected.
    expect(window.localStorage.getItem(themeKeyForUser("user-a"))).toBe("dark");
  });

  it("trusts the server echo over the optimistic value", async () => {
    const user = userEvent.setup();
    // A backend that stores something different must win.
    apiPatch.mockResolvedValue({ theme: "dark", source: "saved" });
    renderTheme();
    await waitFor(() => expect(themeOf()).toBe("dark"));

    await user.click(screen.getByRole("button", { name: "Light theme" }));

    await waitFor(() => expect(themeOf()).toBe("dark"));
  });
});

// ── 8–10: account identity ──────────────────────────────────────────────────

describe("account identity", () => {
  it("caches an explicitly saved preference for the account's next identified session", async () => {
    apiGet.mockResolvedValue({ theme: "light", source: "saved" });
    renderTheme();

    await waitFor(() =>
      expect(window.localStorage.getItem(themeKeyForUser("user-a"))).toBe("light"),
    );
    expect(window.localStorage.getItem(themeKeyForUser("user-a"))).toBe("light");
    expect(window.localStorage.getItem("ar.ui.theme.active")).toBeNull();
  });

  it("does not create a global pointer for an account that never chose a theme", async () => {
    apiGet.mockResolvedValue({ theme: "dark", source: "default" });
    renderTheme();

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await waitFor(() =>
      expect(window.localStorage.getItem("ar.ui.theme.active")).toBeNull(),
    );
  });

  it("does not let a signed-out session keep the previous account's paint", async () => {
    apiGet.mockResolvedValue({ theme: "light", source: "saved" });
    const { rerender } = renderTheme();
    await waitFor(() => expect(themeOf()).toBe("light"));

    // Sign out.
    currentUser = null;
    const client = createTestQueryClient();
    rerender(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <ThemeProbe />
          <ThemeToggle />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(themeOf()).toBe("dark"));
    expect(isLightDocument()).toBe(false);
    expect(window.localStorage.getItem("ar.ui.theme.active")).toBeNull();
  });

  it("does not let one account inherit another account's preference", async () => {
    apiGet.mockResolvedValue({ theme: "light", source: "saved" });
    const { rerender } = renderTheme();
    await waitFor(() => expect(themeOf()).toBe("light"));

    // A different operator signs in on the same workstation and has saved dark.
    currentUser = { id: "user-b" };
    apiGet.mockResolvedValue({ theme: "dark", source: "saved" });
    const client = createTestQueryClient();
    rerender(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <ThemeProbe />
          <ThemeToggle />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(themeOf()).toBe("dark"));
    expect(isLightDocument()).toBe(false);
    expect(window.localStorage.getItem(themeKeyForUser("user-a"))).toBe("light");
  });

  it("does not persist a choice when no account is signed in", async () => {
    const user = userEvent.setup();
    currentUser = null;
    renderTheme();

    await user.click(screen.getByRole("button", { name: "Light theme" }));

    expect(themeOf()).toBe("light");
    expect(apiPatch).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("ar.ui.theme.active")).toBeNull();
  });

  it("resets a stale previous-user paint before a new user's server preference resolves", async () => {
    window.localStorage.setItem("ar.ui.theme.active", "user-a");
    window.localStorage.setItem(themeKeyForUser("user-a"), "light");
    document.documentElement.className = "light";
    currentUser = { id: "user-b" };

    let resolvePreference!: (value: { theme: string; source: string }) => void;
    apiGet.mockImplementation(
      () => new Promise((resolve) => { resolvePreference = resolve; }),
    );
    renderTheme();

    await waitFor(() => expect(themeOf()).toBe("dark"));
    expect(isLightDocument()).toBe(false);

    resolvePreference({ theme: "dark", source: "saved" });
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(themeOf()).toBe("dark");
  });

  it("does not let a late save response from the previous account repaint the new account", async () => {
    const user = userEvent.setup();
    let resolveSave!: (value: { theme: string; source: string }) => void;
    apiPatch.mockImplementation(
      () => new Promise((resolve) => { resolveSave = resolve; }),
    );
    const rendered = renderTheme();
    await waitFor(() => expect(themeOf()).toBe("dark"));

    await user.click(screen.getByRole("button", { name: "Light theme" }));
    expect(themeOf()).toBe("light");

    currentUser = { id: "user-b" };
    apiGet.mockResolvedValue({ theme: "dark", source: "saved" });
    const client = createTestQueryClient();
    rendered.rerender(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <ThemeProbe />
          <ThemeToggle />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(themeOf()).toBe("dark"));

    resolveSave({ theme: "light", source: "saved" });
    await waitFor(() =>
      expect(window.localStorage.getItem(themeKeyForUser("user-a"))).toBe("light"),
    );
    expect(themeOf()).toBe("dark");
    expect(isLightDocument()).toBe(false);
  });
});

// ── Presentational consumers follow the provider ────────────────────────────

describe("chart chrome follows the active theme", () => {
  it("uses the light palette once the account's light preference resolves", async () => {
    const { useChartTheme } = await import("@/lib/theme/chart-theme");
    function ChartProbe() {
      return <span data-testid="grid">{useChartTheme().grid}</span>;
    }

    apiGet.mockResolvedValue({ theme: "light", source: "saved" });
    renderTheme(<ChartProbe />);

    await waitFor(() => expect(themeOf()).toBe("light"));
    expect(screen.getByTestId("grid").textContent).toBe("#e2e8f0");
  });

  it("uses the dark palette on the default theme", async () => {
    const { useChartTheme } = await import("@/lib/theme/chart-theme");
    function ChartProbe() {
      return <span data-testid="grid">{useChartTheme().grid}</span>;
    }

    renderTheme(<ChartProbe />);

    await waitFor(() => expect(themeOf()).toBe("dark"));
    expect(screen.getByTestId("grid").textContent).toBe("#1e293f");
  });

  it("falls back to the dark default outside the provider rather than crashing", async () => {
    const { useChartTheme } = await import("@/lib/theme/chart-theme");
    function ChartProbe() {
      return <span data-testid="grid">{useChartTheme().grid}</span>;
    }

    // A chart rendered in isolation must still draw.
    render(<ChartProbe />);
    expect(screen.getByTestId("grid").textContent).toBe("#1e293f");
  });
});

// ── 11–12: accessibility of the control ─────────────────────────────────────

describe("theme control accessibility", () => {
  it("exposes exactly two named choices in a labelled group", async () => {
    renderTheme();
    const group = screen.getAllByRole("group", { name: "Appearance" })[0];
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dark theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Light theme" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /system/i })).toBeNull();
  });

  it("announces which theme is active via aria-pressed", async () => {
    apiGet.mockResolvedValue({ theme: "light", source: "saved" });
    renderTheme();
    await waitFor(() => expect(themeOf()).toBe("light"));

    expect(screen.getByRole("button", { name: "Light theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("is operable by keyboard alone", async () => {
    const user = userEvent.setup();
    renderTheme();
    await waitFor(() => expect(themeOf()).toBe("dark"));

    const light = screen.getByRole("button", { name: "Light theme" });
    light.focus();
    expect(light).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(themeOf()).toBe("light");

    const dark = screen.getByRole("button", { name: "Dark theme" });
    dark.focus();
    await user.keyboard(" ");
    expect(themeOf()).toBe("dark");
  });

  it("reaches the control by tabbing, so it is not a pointer-only affordance", async () => {
    const user = userEvent.setup();
    renderTheme();
    await waitFor(() => expect(themeOf()).toBe("dark"));

    await user.tab();
    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Light theme" })).toHaveFocus();
  });
});
