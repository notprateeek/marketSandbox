export interface AllocationSegment {
  label: string;
  /** Share of total portfolio value, 0–100. */
  percent: number;
  /** Any CSS color (token var or literal). */
  color: string;
}

interface AllocationDonutProps {
  segments: AllocationSegment[];
  centerLabel: string;
  centerValue: string;
}

/**
 * Presentational donut chart. Consumes pre-computed allocation percentages
 * (no portfolio math here) and maps them to arc lengths via SVG pathLength.
 * Scales to its container, so it works on mobile.
 */
export function AllocationDonut({ segments, centerLabel, centerValue }: AllocationDonutProps) {
  const visible = segments.filter((segment) => segment.percent > 0.05);

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
      <svg
        viewBox="0 0 42 42"
        className="h-40 w-40 shrink-0"
        role="img"
        aria-label={`Allocation: ${visible.map((s) => `${s.label} ${s.percent.toFixed(1)}%`).join(', ')}`}
      >
        <circle
          cx="21"
          cy="21"
          r="15.915"
          fill="none"
          stroke="var(--color-card-border)"
          strokeWidth="4"
        />
        {visible.map((segment, index) => {
          const dashArray = `${segment.percent} ${100 - segment.percent}`;
          // Offset by the sum of prior segments so the first starts at 12 o'clock.
          const priorTotal = visible.slice(0, index).reduce((sum, prior) => sum + prior.percent, 0);
          const dashOffset = 25 - priorTotal;
          return (
            <circle
              key={segment.label}
              cx="21"
              cy="21"
              r="15.915"
              fill="none"
              stroke={segment.color}
              strokeWidth="4"
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
              pathLength={100}
              transform="rotate(-90 21 21)"
            />
          );
        })}
        <text x="21" y="20" textAnchor="middle" fontSize="2.6" fill="var(--color-muted)">
          {centerLabel}
        </text>
        <text
          x="21"
          y="24.5"
          textAnchor="middle"
          fontSize="4"
          fontWeight="500"
          fill="var(--color-primary)"
        >
          {centerValue}
        </text>
      </svg>

      <ul className="w-full space-y-2">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-3 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: segment.color }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-body-muted">{segment.label}</span>
            <span className="font-mono text-primary">{segment.percent.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
