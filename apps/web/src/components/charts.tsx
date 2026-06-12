'use client';

/**
 * The shared chart kit: one premium visual language for every plot.
 * Recharts stays the engine; these pieces carry the finish — token-driven
 * colors, a raised card tooltip, quiet axes, and gradient meter bars for
 * the report views.
 */

export const CHART_AXIS = {
  fontSize: 11,
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
  stroke: 'var(--muted-foreground)',
} as const;

/** The slice of the recharts tooltip contract this renderer reads —
 *  declared locally because the library's TooltipProps hides the
 *  injected fields behind internal types. */
interface ChartTooltipProps {
  active?: boolean;
  label?: unknown;
  payload?: ReadonlyArray<{
    dataKey?: string | number;
    name?: string | number;
    value?: string | number;
    color?: string;
  }>;
}

/** A raised, token-themed tooltip replacing the recharts default. */
export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="surface-raised bg-popover/95 min-w-36 rounded-lg border px-3 py-2 backdrop-blur-sm">
      {label !== undefined && (
        <p className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase">
          {String(label)}
        </p>
      )}
      <div className="grid gap-1">
        {payload.map((entry) => (
          <div key={String(entry.dataKey)} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: entry.color ?? 'var(--primary)' }}
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-semibold tabular-nums">
              {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Gradient defs for area charts; render once inside the chart. */
export function ChartGradients({
  series,
}: {
  series: ReadonlyArray<{ id: string; color: string }>;
}) {
  return (
    <defs>
      {series.map(({ id, color }) => (
        <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      ))}
    </defs>
  );
}

/** The gold meter: a gradient progress bar for funnel/attribution rows. */
export function MeterBar({ ratio, label }: { ratio: number; label?: string }) {
  const width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  return (
    <div className="bg-muted h-2.5 overflow-hidden rounded-full">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{
          width,
          background:
            'linear-gradient(90deg, color-mix(in oklab, var(--primary) 70%, var(--background)), var(--primary))',
        }}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      />
    </div>
  );
}
