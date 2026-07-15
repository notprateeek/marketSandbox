import { formatPaise } from '@/lib/finance/currency';
import { formatIST, formatISTDate } from '@/lib/finance/datetime';

export interface HistoricalChartPoint {
  timestamp: Date;
  closePaise: number;
}

interface HistoricalPriceChartProps {
  points: HistoricalChartPoint[];
  interval: 'ONE_MINUTE' | 'ONE_DAY';
  source: string;
}

const WIDTH = 1040;
const HEIGHT = 320;
const PADDING = { top: 18, right: 20, bottom: 44, left: 66 };
const rupeeAxisFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function HistoricalPriceChart({ points, interval, source }: HistoricalPriceChartProps) {
  const sortedPoints = [...points].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
  const closes = sortedPoints.map((point) => point.closePaise);
  const rawMin = Math.min(...closes);
  const rawMax = Math.max(...closes);
  const rawRange = Math.max(rawMax - rawMin, 1);
  const min = Math.max(0, rawMin - rawRange * 0.08);
  const max = rawMax + rawRange * 0.08;
  const range = max - min;
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const xFor = (index: number) =>
    sortedPoints.length === 1
      ? PADDING.left + plotWidth / 2
      : PADDING.left + (index / (sortedPoints.length - 1)) * plotWidth;
  const yFor = (closePaise: number) => PADDING.top + ((max - closePaise) / range) * plotHeight;
  const coordinates = sortedPoints.map((point, index) => ({
    x: xFor(index),
    y: yFor(point.closePaise),
  }));
  const linePath = coordinates
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');
  const baseline = PADDING.top + plotHeight;
  const areaPath = `${linePath} L ${coordinates.at(-1)?.x.toFixed(2)} ${baseline} L ${coordinates[0]?.x.toFixed(2)} ${baseline} Z`;
  const isGain = closes.at(-1)! >= closes[0]!;
  const lineColor = isGain ? 'var(--color-gain)' : 'var(--color-loss)';
  const yTicks = Array.from({ length: 6 }, (_, index) => {
    const ratio = index / 5;
    return {
      value: max - range * ratio,
      y: PADDING.top + plotHeight * ratio,
    };
  });
  const xTickIndices = getTickIndices(sortedPoints.length);
  const intervalLabel = interval === 'ONE_MINUTE' ? 'one-minute' : 'daily';

  return (
    <figure aria-labelledby="price-chart-title">
      <div className="overflow-x-auto pb-1">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto min-w-[680px] w-full"
          role="img"
          aria-labelledby="price-chart-title price-chart-description"
        >
          <title id="price-chart-title">Historical closing prices</title>
          <desc id="price-chart-description">
            {sortedPoints.length} {intervalLabel} closing prices from{' '}
            {formatISTDate(sortedPoints[0]!.timestamp)} to{' '}
            {formatISTDate(sortedPoints.at(-1)!.timestamp)}. Started at {formatPaise(closes[0]!)}{' '}
            and ended at {formatPaise(closes.at(-1)!)}. The range was {formatPaise(rawMin)} to{' '}
            {formatPaise(rawMax)}.
          </desc>

          <defs>
            <linearGradient id="price-chart-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={lineColor} stopOpacity="0.22" />
              <stop offset="1" stopColor={lineColor} stopOpacity="0.01" />
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
                x={PADDING.left - 12}
                y={y + 4}
                textAnchor="end"
                fill="var(--color-body-muted)"
                fontSize="12"
              >
                {rupeeAxisFormatter.format(value / 100)}
              </text>
            </g>
          ))}

          <text
            x="10"
            y={PADDING.top + plotHeight / 2}
            fill="var(--color-body-muted)"
            fontSize="13"
          >
            ₹
          </text>

          <path d={areaPath} fill="url(#price-chart-area)" />
          {sortedPoints.length > 1 ? (
            <path
              d={linePath}
              fill="none"
              stroke={lineColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          <circle
            cx={coordinates.at(-1)!.x}
            cy={coordinates.at(-1)!.y}
            r="4"
            fill={lineColor}
            stroke="white"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />

          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={baseline}
            y2={baseline}
            stroke="var(--color-hairline)"
            vectorEffect="non-scaling-stroke"
          />

          {xTickIndices.map((index) => {
            const point = sortedPoints[index]!;
            const x = xFor(index);
            return (
              <g key={`${point.timestamp.toISOString()}-${index}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={baseline}
                  y2={baseline + 5}
                  stroke="var(--color-hairline)"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={x}
                  y={baseline + 23}
                  textAnchor="middle"
                  fill="var(--color-body-muted)"
                  fontSize="12"
                >
                  {formatTick(point.timestamp, interval)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="mt-1 text-xs text-body-muted">
        Source: {formatSource(source)}
      </figcaption>
    </figure>
  );
}

function getTickIndices(pointCount: number): number[] {
  if (pointCount <= 1) return [0];

  const tickCount = Math.min(7, pointCount);
  return Array.from(
    new Set(
      Array.from({ length: tickCount }, (_, index) =>
        Math.round((index / (tickCount - 1)) * (pointCount - 1)),
      ),
    ),
  );
}

function formatTick(timestamp: Date, interval: 'ONE_MINUTE' | 'ONE_DAY'): string {
  return interval === 'ONE_MINUTE'
    ? formatIST(timestamp, { hour: 'numeric', minute: '2-digit', hour12: true })
    : formatIST(timestamp, { day: '2-digit', month: 'short' });
}

function formatSource(source: string): string {
  return source.replaceAll(/[-_]/g, ' ');
}
