"use client";

import { cn } from "@/lib/utils";
import { COMPOSABLE_FOCUS_RING } from "@/lib/focus-styles";

interface FilterChipGroupProps<T extends string> {
  /** Visible label for the group, e.g. "Status". Also names the group for AT. */
  label: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  /** Rendered chip text when the raw value is not what should be shown. */
  renderOption?: (option: T) => string;
  disabled?: boolean;
  className?: string;
}

/**
 * The single visual authority for segmented filter choices.
 *
 * Both the Status and Rating filters render through this, so the two can never
 * drift apart, and a future filter gets the same behaviour for free.
 *
 * Two deliberate decisions:
 *
 * 1. Selected uses `--brand-fill`, not `bg-blue-600`. Under the dark theme the
 *    chromatic ramps are reversed so a filled `blue-600` resolves to a *pale*
 *    blue, which is how the old chips became large bright pills carrying
 *    low-contrast white text. `--brand-fill` is the token specifically tuned to
 *    be a filled surface that white text can sit on in both themes.
 *
 * 2. Chips are deliberately not colour-coded by meaning. "Blocked" is a filter
 *    choice here, not a customer state, so painting it red would turn the
 *    filter bar into a status legend and compete with the real status badges in
 *    the table below. The only thing colour communicates here is which filter
 *    is active.
 */
export function FilterChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  renderOption,
  disabled = false,
  className,
}: FilterChipGroupProps<T>) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="mr-1 text-xs font-medium text-slate-500">{label}:</span>
      <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
        {options.map((option) => {
          const isSelected = option === value;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              disabled={disabled}
              // Selection is exposed semantically, not by colour alone.
              aria-pressed={isSelected}
              data-selected={isSelected ? "true" : "false"}
              className={cn(
                "ds-press rounded-full border px-3 py-1 text-xs font-medium",
                // The chip carries its own focus ring rather than inheriting
                // the global one. The global `*:focus-visible` rule lives in
                // Tailwind's base layer, so any `shadow-*` utility on the
                // element wins over it and silently erases the ring — which is
                // exactly what the selected chip's glow did. A `ring-*` utility
                // composes into the same box-shadow chain as the glow, so both
                // render, and it cannot be overridden by layer order.
                COMPOSABLE_FOCUS_RING,
                isSelected
                  ? // Controlled brand-toned surface with a restrained ring —
                    // clearly the active choice without shouting.
                    "border-accent-fill bg-accent-fill text-white shadow-glow-subtle"
                  : // Sits above the panel so inactive options stay scannable.
                    "border-chip-border bg-chip-bg text-chip-text hover:border-chip-border-hover hover:bg-chip-hover",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              {renderOption ? renderOption(option) : option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
