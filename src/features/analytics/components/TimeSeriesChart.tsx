import { formatISTDate } from '@/lib/finance/datetime';

export interface TimeSeriesPoint {
  timestamp: Date;
  value: number;
}

interface TimeSeriesChartProps {
  points: TimeSeriesPoint[];
  color: string;
  formatValue: (value: number) => string;
  ariaLabel: string;
  /** Draw a dashed reference line at 0 when the range spans it. */
  zeroBaseline?: boolean;
}

const WIDTH = 720;
const HEIGHT = 240;
const PADDING = { top: 16, right: 16, bottom: 34, left: 76 };

export function TimeSeriesChart({
  points,
  color,
  formatValue,
  ariaLabel,
  zeroBaseline = false,
}: TimeSeriesChartProps) {
  if (points.length < 2) {
    return (
      <p className="rounded-sm border border-dashed border-hairline px-4 py-8 text-center text-sm text-body-muted">
        Not enough data yet — advance the clock to build this chart.
      </p>
    );
  }

  const values = points.map((point) => point.value);
  const rawMin = Math.min(...values, zeroBaseline ? 0 : Infinity);
  const rawMax = Math.max(...values, zeroBaseline ? 0 : -Infinity);
  const range = Math.max(rawMax - rawMin, 1);
  const min = rawMin - range * 0.08;
  const max = rawMax + range * 0.08;
  const span = max - min;

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const baseline = PADDING.top + plotHeight;
  const xFor = (index: number) => PADDING.left + (index / (points.length - 1)) * plotWidth;
  const yFor = (value: number) => PADDING.top + ((max - value) / span) * plotHeight;

  const coordinates = points.map((point, index) => ({
    x: xFor(index),
    y: yFor(point.value),
  }));
  const linePath = coordinates
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');
  const areaPath = `${linePath} L ${coordinates.at(-1)!.x.toFixed(2)} ${baseline} L ${coordinates[0].x.toFixed(2)} ${baseline} Z`;

  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const value = max - (span * index) / 4;
    return { value, y: PADDING.top + (plotHeight * index) / 4 };
  });
  const xTickIndices = tickIndices(points.length);
  const gradientId = `series-${color.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <figure className="overflow-x-auto pb-1">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full min-w-[520px]"
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.2" />
            <stop offset="1" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {yTicks.map(({ value, y }) => (
          <g key={y}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y}
              y2={y}
              stroke="var(--color-hairline)"
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PADDING.left - 10}
              y={y + 4}
              textAnchor="end"
              fill="var(--color-body-muted)"
              fontSize="11"
            >
              {formatValue(value)}
            </text>
          </g>
        ))}

        {zeroBaseline && min < 0 && max > 0 ? (
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={yFor(0)}
            y2={yFor(0)}
            stroke="var(--color-slate)"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {xTickIndices.map((index) => (
          <text
            key={index}
            x={xFor(index)}
            y={baseline + 20}
            textAnchor="middle"
            fill="var(--color-body-muted)"
            fontSize="11"
          >
            {formatISTDate(points[index].timestamp)}
          </text>
        ))}
      </svg>
    </figure>
  );
}

function tickIndices(count: number): number[] {
  const ticks = Math.min(6, count);
  return Array.from(
    new Set(
      Array.from({ length: ticks }, (_, index) => Math.round((index / (ticks - 1)) * (count - 1))),
    ),
  );
}
