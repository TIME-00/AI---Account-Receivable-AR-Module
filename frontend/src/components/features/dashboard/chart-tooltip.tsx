"use client";

import { formatAmount } from "@/lib/utils";
import { useChartTheme } from "@/lib/theme/chart-theme";

/**
 * One tooltip entry as Recharts hands it to a custom `content` component.
 * `color` is the series colour and is used only for the leading swatch — never
 * for text, because a series colour is chosen for a filled mark on a chart, not
 * for legibility as small type on the tooltip surface.
 */
export interface ChartTooltipEntry {
  value: number;
  name?: string | number;
  color?: string;
  dataKey?: string | number;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipEntry[];
  label?: string | number;
  /**
   * Explicit currency code for the plotted values (Batch 9D-D). Dashboard
   * charts plot company-base amounts, so callers pass the company base
   * currency. Never hard-code a currency here.
   */
  currency?: string | null;
  /**
   * Non-monetary charts (counts, percentages) supply their own value renderer.
   * When omitted the value is formatted as an amount in `currency`.
   */
  formatValue?: (value: number, entry: ChartTooltipEntry) => string;
  /** Optional caption under the value, e.g. "Customers" or "Collected". */
  formatCaption?: (value: number, entry: ChartTooltipEntry) => string | null;
}

/**
 * The single tooltip used by every chart in the product.
 *
 * It exists because Recharts' built-in `DefaultTooltipContent` hard-codes
 * `color: entry.color || '#000'` on each item and applies `contentStyle` only to
 * the outer wrapper. Passing a themed `contentStyle` therefore styles the box
 * but leaves the value text black — unreadable on the dark theme. Rendering our
 * own content removes that fallback entirely and puts every colour under the
 * shared `chart-theme` authority.
 *
 * Colours are applied inline rather than through Tailwind classes because the
 * tooltip is rendered into Recharts' own positioned wrapper; inline values are
 * the robust option there, and they keep the exact contrast unit-testable.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  currency,
  formatValue,
  formatCaption,
}: ChartTooltipProps) {
  const chart = useChartTheme();

  if (!active || !payload?.length) return null;

  const code = currency && currency.trim().length > 0 ? currency.toUpperCase() : null;

  const renderValue = (entry: ChartTooltipEntry): string => {
    if (formatValue) return formatValue(entry.value, entry);
    return `${code ? `${code} ` : ""}${formatAmount(entry.value)}`;
  };

  // A category axis supplies `label`; a Pie has none, so the slice name is the
  // title instead. Without this, donut tooltips would render with no heading.
  const hasLabel = label !== undefined && label !== null && String(label).trim() !== "";
  const title = hasLabel ? String(label) : String(payload[0]?.name ?? "").trim();

  return (
    <div
      // `role="status"` matches Recharts' own accessibility layer so the hovered
      // value is announced rather than being a purely visual affordance.
      role="status"
      data-chart-tooltip=""
      style={{
        background: chart.tooltip.background,
        border: chart.tooltip.border,
        borderRadius: chart.tooltip.borderRadius,
        boxShadow: chart.tooltip.shadow,
        color: chart.tooltip.color,
        fontSize: chart.tooltip.fontSize,
        padding: "8px 12px",
        minWidth: "120px",
      }}
    >
      {title && (
        <p
          data-chart-tooltip-title=""
          style={{ margin: 0, color: chart.tooltip.titleColor, fontWeight: 500 }}
        >
          {title}
        </p>
      )}

      {payload.map((entry, i) => {
        const caption = formatCaption?.(entry.value, entry) ?? null;
        return (
          <div key={`${entry.dataKey ?? entry.name ?? i}`} style={{ marginTop: 2 }}>
            <p
              data-chart-tooltip-value=""
              style={{
                margin: 0,
                color: chart.tooltip.valueColor,
                fontWeight: 600,
                fontSize: "14px",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {renderValue(entry)}
            </p>
            {caption && (
              <p
                data-chart-tooltip-caption=""
                style={{ margin: 0, color: chart.tooltip.captionColor }}
              >
                {caption}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
