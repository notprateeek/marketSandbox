import type { OhlcCandle } from '@/lib/finance/candles';
import { formatPaise } from '@/lib/finance/currency';
import { formatIST, formatISTDate } from '@/lib/finance/datetime';

interface HistoricalPriceChartProps {
  candles: OhlcCandle[];
  granularity: 'intraday' | 'daily';
  label: string;
  source: string;
}

const WIDTH = 1040;
const HEIGHT = 320;
const PADDING = { top: 18, right: 20, bottom: 44, left: 66 };
const MAX_BODY_WIDTH = 16;
const rupeeAxisFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function HistoricalPriceChart({
  candles,
  granularity,
  label,
  source,
}: HistoricalPriceChartProps) {
  const sorted = [...candles].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );

  const rawMin = Math.min(...sorted.map((candle) => candle.lowPaise));
  const rawMax = Math.max(...sorted.map((candle) => candle.highPaise));
  const rawRange = Math.max(rawMax - rawMin, 1);
  const min = Math.max(0, rawMin - rawRange * 0.08);
  const max = rawMax + rawRange * 0.08;
  const range = max - min;
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const baseline = PADDING.top + plotHeight;

  const slotWidth = plotWidth / sorted.length;
  const bodyWidth = Math.max(1, Math.min(slotWidth * 0.7, MAX_BODY_WIDTH));
  const centerX = (index: number) => PADDING.left + (index + 0.5) * slotWidth;
  const yFor = (paise: number) => PADDING.top + ((max - paise) / range) * plotHeight;

  const first = sorted[0]!.closePaise;
  const last = sorted.at(-1)!.closePaise;

  const yTicks = Array.from({ length: 6 }, (_, index) => {
    const ratio = index / 5;
    return { value: max - range * ratio, y: PADDING.top + plotHeight * ratio };
  });
  const xTickIndices = getTickIndices(sorted.length);

  return (
    <figure aria-labelledby="price-chart-title">
      <div className="overflow-x-auto pb-1">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto min-w-[680px] w-full"
          role="img"
          aria-labelledby="price-chart-title price-chart-description"
        >
          <title id="price-chart-title">{label} candlestick chart</title>
          <desc id="price-chart-description">
            {sorted.length} {label} candles from {formatISTDate(sorted[0]!.timestamp)} to{' '}
            {formatISTDate(sorted.at(-1)!.timestamp)}. Opened at {formatPaise(sorted[0]!.openPaise)}{' '}
            and closed at {formatPaise(last)}. The range was {formatPaise(rawMin)} to{' '}
            {formatPaise(rawMax)}.
          </desc>

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

          <text x="10" y={PADDING.top + plotHeight / 2} fill="var(--color-body-muted)" fontSize="13">
            ₹
          </text>

          {sorted.map((candle, index) => {
            const up = candle.closePaise >= candle.openPaise;
            const color = up ? 'var(--color-gain)' : 'var(--color-loss)';
            const cx = centerX(index);
            const bodyTop = yFor(Math.max(candle.openPaise, candle.closePaise));
            const bodyBottom = yFor(Math.min(candle.openPaise, candle.closePaise));
            const bodyHeight = Math.max(1, bodyBottom - bodyTop);
            return (
              <g key={candle.timestamp.toISOString()}>
                <title>
                  {formatTitle(candle.timestamp, granularity)} · O {formatPaise(candle.openPaise)} · H{' '}
                  {formatPaise(candle.highPaise)} · L {formatPaise(candle.lowPaise)} · C{' '}
                  {formatPaise(candle.closePaise)} · Vol {candle.volume.toLocaleString('en-IN')}
                </title>
                <line
                  x1={cx}
                  x2={cx}
                  y1={yFor(candle.highPaise)}
                  y2={yFor(candle.lowPaise)}
                  stroke={color}
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x={cx - bodyWidth / 2}
                  y={bodyTop}
                  width={bodyWidth}
                  height={bodyHeight}
                  fill={color}
                />
              </g>
            );
          })}

          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={baseline}
            y2={baseline}
            stroke="var(--color-hairline)"
            vectorEffect="non-scaling-stroke"
          />

          {xTickIndices.map((index) => {
            const candle = sorted[index]!;
            const x = centerX(index);
            return (
              <g key={`${candle.timestamp.toISOString()}-tick`}>
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
                  {formatTick(candle.timestamp, granularity)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="mt-1 flex items-center justify-between text-xs text-body-muted">
        <span>Source: {formatSource(source)}</span>
        <span className={last >= first ? 'text-gain' : 'text-loss'}>
          {last >= first ? '▲' : '▼'} {formatPaise(Math.abs(last - first))} over range
        </span>
      </figcaption>
    </figure>
  );
}

function getTickIndices(candleCount: number): number[] {
  if (candleCount <= 1) return [0];
  const tickCount = Math.min(7, candleCount);
  return Array.from(
    new Set(
      Array.from({ length: tickCount }, (_, index) =>
        Math.round((index / (tickCount - 1)) * (candleCount - 1)),
      ),
    ),
  );
}

function formatTick(timestamp: Date, granularity: 'intraday' | 'daily'): string {
  return granularity === 'intraday'
    ? formatIST(timestamp, { hour: 'numeric', minute: '2-digit', hour12: true })
    : formatIST(timestamp, { day: '2-digit', month: 'short' });
}

function formatTitle(timestamp: Date, granularity: 'intraday' | 'daily'): string {
  return granularity === 'intraday'
    ? formatIST(timestamp, {
        day: '2-digit',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : formatISTDate(timestamp);
}

function formatSource(source: string): string {
  return source.replaceAll(/[-_]/g, ' ');
}
