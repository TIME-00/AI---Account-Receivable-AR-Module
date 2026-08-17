"use client";

import { BarChart3 } from "lucide-react";
import { Badge } from "./copilot-artifact-shell";
import { cellText, type CopilotChartPayload } from "@/lib/ar-copilot/artifacts";
import {
  AGING_COLORS,
  DONUT_COLORS,
  useChartTheme,
} from "@/lib/theme/chart-theme";

// Fixed, local presentation only. Artifact data can select one of the three
// closed chart kinds and supply bounded labels/values, but it cannot supply
// markup, styles, callbacks, component names, or navigation.

const SERIES_COLORS = DONUT_COLORS;
const SVG_WIDTH = 320;
const SVG_HEIGHT = 112;
const SVG_PADDING = 12;

function numericValue(
  value: string | number | null | undefined,
): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
    ? Number(value.replaceAll(",", ""))
    : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function SeriesLegend({ chart }: { chart: CopilotChartPayload }) {
  return (
    <ul
      className="mt-2 flex flex-wrap gap-x-3 gap-y-1"
      aria-label="Chart series"
    >
      {chart.series.map((series, index) => (
        <li
          key={series.field}
          className="flex items-center gap-1 text-[10px] text-content-secondary"
        >
          <span
            className="h-2 w-2 rounded-sm"
            style={{
              backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length],
            }}
            aria-hidden="true"
          />
          <span>{series.label} ({series.format})</span>
        </li>
      ))}
    </ul>
  );
}

/** Exact backend labels and values, independent of visual chart geometry. */
function ChartValueList({ chart }: { chart: CopilotChartPayload }) {
  return (
    <ol className="mt-2 space-y-1" aria-label="Chart values">
      {chart.data.map((point, pointIndex) => {
        const label = cellText(point[chart.x_field] ?? null);
        return (
          <li
            key={`${label}:${pointIndex}`}
            data-chart-point={pointIndex}
            className="grid gap-1 rounded border border-line/60 px-2 py-1 sm:grid-cols-[8rem_1fr]"
          >
            <span className="text-[10px] font-medium text-content-secondary">
              {label}
            </span>
            <dl className="flex flex-wrap gap-x-3 gap-y-0.5">
              {chart.series.map((series) => (
                <div key={series.field} className="flex gap-1">
                  <dt className="text-[10px] text-content-secondary">
                    {series.label}:
                  </dt>
                  <dd className="text-[10px] font-medium tabular-nums text-content">
                    {cellText(point[series.field] ?? null)}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        );
      })}
    </ol>
  );
}

function BarGeometry({ chart }: { chart: CopilotChartPayload }) {
  const peaks = chart.series.map((series) => {
    let peak = 0;
    for (const point of chart.data) {
      const value = numericValue(point[series.field]);
      if (value !== null) peak = Math.max(peak, Math.abs(value));
    }
    return peak;
  });

  return (
    <div
      data-chart-geometry="bar"
      className="mt-2 space-y-2 rounded border border-line/60 p-2"
      aria-hidden="true"
    >
      {chart.data.map((point, pointIndex) => {
        const label = cellText(point[chart.x_field] ?? null);
        return (
          <div key={`${label}:${pointIndex}`}>
            <p className="truncate text-[9px] text-content-secondary">
              {label}
            </p>
            <div className="mt-0.5 space-y-0.5">
              {chart.series.map((series, seriesIndex) => {
                const value = numericValue(point[series.field]);
                const peak = peaks[seriesIndex];
                const width = peak > 0 && value !== null
                  ? Math.max(2, Math.round((Math.abs(value) / peak) * 100))
                  : 0;
                return (
                  <div
                    key={series.field}
                    data-bar-series={series.field}
                    className="h-1.5 rounded bg-surface-muted"
                  >
                    <span
                      data-bar=""
                      className="block h-1.5 rounded"
                      style={{
                        width: `${width}%`,
                        backgroundColor:
                          SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function linePoints(
  chart: CopilotChartPayload,
  field: string,
): Array<{ x: number; y: number; index: number }> {
  const values = chart.data.map((point) => numericValue(point[field]));
  const finite = values.filter((value): value is number => value !== null);
  if (finite.length === 0) return [];
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  const range = maximum - minimum;
  const drawableWidth = SVG_WIDTH - SVG_PADDING * 2;
  const drawableHeight = SVG_HEIGHT - SVG_PADDING * 2;

  return values.flatMap((value, index) => {
    if (value === null) return [];
    const x = chart.data.length <= 1
      ? SVG_WIDTH / 2
      : SVG_PADDING + (index / (chart.data.length - 1)) * drawableWidth;
    const y = range === 0
      ? SVG_HEIGHT / 2
      : SVG_PADDING + ((maximum - value) / range) * drawableHeight;
    return [{ x, y, index }];
  });
}

function LineGeometry({ chart }: { chart: CopilotChartPayload }) {
  const theme = useChartTheme();
  return (
    <div
      data-chart-geometry="line"
      className="mt-2 space-y-2"
      aria-hidden="true"
    >
      {chart.series.map((series, seriesIndex) => {
        const points = linePoints(chart, series.field);
        const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length];
        return (
          <div key={series.field} data-line-series={series.field}>
            <p className="text-[9px] font-medium text-content-secondary">
              {series.label}
            </p>
            <svg
              viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
              className="h-28 w-full"
              preserveAspectRatio="none"
            >
              <line
                x1={SVG_PADDING}
                x2={SVG_WIDTH - SVG_PADDING}
                y1={SVG_HEIGHT - SVG_PADDING}
                y2={SVG_HEIGHT - SVG_PADDING}
                stroke={theme.grid}
              />
              <polyline
                data-line-path=""
                points={points.map(({ x, y }) => `${x},${y}`).join(" ")}
                fill="none"
                stroke={color}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              {points.map(({ x, y, index }) => (
                <circle
                  key={index}
                  cx={x}
                  cy={y}
                  r="3"
                  fill={color}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </div>
        );
      })}
    </div>
  );
}

function PieGeometry({
  chart,
  partitionTotal,
}: {
  chart: CopilotChartPayload;
  partitionTotal: string | number | boolean | null | undefined;
}) {
  const series = chart.series[0];
  const total = typeof partitionTotal === "boolean"
    ? null
    : numericValue(partitionTotal);
  let offset = 0;
  const slices = chart.data.map((point, index) => {
    const value = numericValue(point[series.field]);
    const percentage = total !== null && total > 0 && value !== null
      ? Math.max(0, Math.min(100 - offset, (Math.max(0, value) / total) * 100))
      : 0;
    const slice = { percentage, offset, index };
    offset += percentage;
    return slice;
  });

  return (
    <div
      data-chart-geometry="pie"
      className="mt-2 flex justify-center rounded border border-line/60 p-2"
      aria-hidden="true"
    >
      <svg viewBox="0 0 120 120" className="h-32 w-32">
        <circle
          cx="60"
          cy="60"
          r="42"
          fill="none"
          strokeWidth="28"
          className="stroke-surface-muted"
        />
        {slices.map(({ percentage, offset: sliceOffset, index }) => (
          <circle
            key={index}
            data-pie-slice=""
            cx="60"
            cy="60"
            r="42"
            pathLength="100"
            fill="none"
            stroke={AGING_COLORS[index % AGING_COLORS.length]}
            strokeWidth="28"
            strokeDasharray={`${percentage} ${100 - percentage}`}
            strokeDashoffset={-sliceOffset}
            transform="rotate(-90 60 60)"
          />
        ))}
      </svg>
    </div>
  );
}

export function ChartFigure({
  chart,
  partitionTotal,
}: {
  chart: CopilotChartPayload;
  partitionTotal?: string | number | boolean | null;
}) {
  return (
    <figure className="mt-3">
      <figcaption className="flex flex-wrap items-center gap-2">
        <BarChart3
          className="h-3.5 w-3.5 text-content-muted"
          aria-hidden="true"
        />
        <span className="text-[11px] font-semibold text-content">
          {chart.title}
        </span>
        <Badge tone="neutral">{chart.chart_type}</Badge>
        {chart.is_truncated
          ? (
            <Badge tone="warn">
              {chart.displayed_points} of {chart.total_available_points} points
            </Badge>
          )
          : null}
      </figcaption>
      <SeriesLegend chart={chart} />
      {chart.chart_type === "bar" ? <BarGeometry chart={chart} /> : null}
      {chart.chart_type === "line" ? <LineGeometry chart={chart} /> : null}
      {chart.chart_type === "pie"
        ? <PieGeometry chart={chart} partitionTotal={partitionTotal} />
        : null}
      <ChartValueList chart={chart} />
    </figure>
  );
}
