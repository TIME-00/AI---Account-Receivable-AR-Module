"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/providers/theme-provider";
import { UI_THEMES, type UiTheme } from "@/lib/theme/contract";

const OPTIONS: Array<{ value: UiTheme; label: string; Icon: typeof Moon }> = [
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "light", label: "Light", Icon: Sun },
];

interface ThemeToggleProps {
  className?: string;
  /** `segmented` for the header rail, `menu` for the profile dropdown. */
  variant?: "segmented" | "menu";
}

/**
 * The application's only theme control. Exactly two choices, matching the
 * backend vocabulary — there is deliberately no "System" option.
 *
 * Implemented as real buttons in a labelled group so it is reachable and
 * operable by keyboard with no extra key handling, and `aria-pressed` reports
 * which theme is active rather than relying on colour alone.
 */
export function ThemeToggle({ className, variant = "segmented" }: ThemeToggleProps) {
  const { theme, setTheme, isSaving } = useTheme();

  if (variant === "menu") {
    return (
      <div className={cn("px-3 py-2", className)}>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          Appearance
        </p>
        <div
          role="group"
          aria-label="Appearance"
          className="grid grid-cols-2 gap-1"
        >
          {OPTIONS.map(({ value, label, Icon }) => {
            const isActive = theme === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                aria-pressed={isActive}
                aria-label={`${label} theme`}
                className={cn(
                  "ds-press flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium",
                  isActive
                    ? "border-accent/40 bg-accent-muted text-nav-text-active shadow-glow-subtle"
                    : "border-line bg-surface-muted text-slate-500 hover:border-line-strong hover:text-slate-700",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Appearance"
      data-saving={isSaving ? "true" : "false"}
      className={cn(
        "relative flex items-center gap-0.5 rounded-lg border border-line bg-surface-muted p-0.5",
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const isActive = theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={isActive}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            className={cn(
              "ds-press relative flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
              isActive
                ? "bg-surface text-slate-800 shadow-card"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {/* The label is the accessible name on every viewport; it is only
                visually collapsed on narrow screens to protect the header. */}
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Exported for tests that assert the control offers exactly dark and light. */
export const THEME_TOGGLE_OPTIONS = UI_THEMES;
