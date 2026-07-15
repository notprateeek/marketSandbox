'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { aggregateCandles, TIMEFRAMES, type OhlcCandle, type Timeframe } from '@/lib/finance/candles';
import { formatISTDate } from '@/lib/finance/datetime';
import { HistoricalPriceChart } from './HistoricalPriceChart';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// Keep the visible bar count under this — the auto interval steps coarser once a
// finer one would draw more candles than this.
const MAX_BARS = 110;

type Domain = 'daily' | 'intraday';

// Finest → coarsest within each domain (that's already their order in TIMEFRAMES).
const DAILY_TFS = TIMEFRAMES.filter((tf) => tf.granularity === 'daily');
const INTRADAY_TFS = TIMEFRAMES.filter((tf) => tf.granularity === 'intraday');

/**
 * Dynamic candlestick chart. It holds both base datasets (per-minute for the
 * latest session, daily for the full history) and, from the current zoom span,
 * auto-selects the finest interval that still fits within {@link MAX_BARS} bars
 * — so candles refine as you zoom in and coarsen as you zoom out. Scroll to
 * zoom around the cursor, drag to pan; the buttons cover the same moves.
 */
export function CandlestickChart({
  intraday,
  daily,
  source,
}: {
  intraday: OhlcCandle[];
  daily: OhlcCandle[];
  source: string;
}) {
  const hasDaily = daily.length > 0;
  const [domain, setDomain] = useState<Domain>(hasDaily ? 'daily' : 'intraday');
  const containerRef = useRef<HTMLDivElement>(null);

  const base = domain === 'daily' ? daily : intraday;
  const timeframes = domain === 'daily' ? DAILY_TFS : INTRADAY_TFS;
  const fullStart = base[0]?.timestamp.getTime() ?? 0;
  const fullEnd = base.at(-1)?.timestamp.getTime() ?? 0;
  const minSpan = domain === 'daily' ? 10 * DAY : 15 * MINUTE;

  const defaultRange = useCallback(
    (which: Domain, source0: number, sink: number): [number, number] => {
      // Daily opens on a recent window (so it shows day bars, not the whole
      // multi-year history); intraday opens on the whole session.
      if (which === 'daily') return [Math.max(source0, sink - 90 * DAY), sink];
      return [source0, sink];
    },
    [],
  );

  const [view, setView] = useState<[number, number]>(() =>
    defaultRange(hasDaily ? 'daily' : 'intraday', fullStart, fullEnd),
  );

  const clampRange = useCallback(
    ([start, end]: [number, number]): [number, number] => {
      let span = Math.min(Math.max(end - start, Math.min(minSpan, fullEnd - fullStart)), fullEnd - fullStart);
      if (span <= 0) span = fullEnd - fullStart;
      let s = start;
      if (s < fullStart) s = fullStart;
      if (s + span > fullEnd) s = fullEnd - span;
      return [s, s + span];
    },
    [fullStart, fullEnd, minSpan],
  );

  const [viewStart, viewEnd] = view;

  const { interval, bars } = useMemo(() => {
    const chosen = chooseInterval(timeframes, base, viewStart, viewEnd);
    const all = aggregateCandles(base, chosen);
    const inView = all.filter((bar) => {
      const t = bar.timestamp.getTime();
      return t >= viewStart && t <= viewEnd;
    });
    return { interval: chosen, bars: inView.length >= 2 ? inView : all.slice(-Math.min(all.length, 30)) };
  }, [timeframes, base, viewStart, viewEnd]);

  const setClamped = useCallback((next: [number, number]) => setView(clampRange(next)), [clampRange]);

  const zoomAround = useCallback(
    (fraction: number, factor: number) => {
      const span = viewEnd - viewStart;
      const anchor = viewStart + fraction * span;
      const nextSpan = span * factor;
      setClamped([anchor - fraction * nextSpan, anchor - fraction * nextSpan + nextSpan]);
    },
    [viewStart, viewEnd, setClamped],
  );

  // Non-passive wheel so zooming doesn't scroll the page.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 1) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const fraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
      zoomAround(Math.min(Math.max(fraction, 0), 1), event.deltaY < 0 ? 0.8 : 1.25);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  const drag = useRef<{ pointerX: number; startMs: number } | null>(null);
  function onPointerDown(event: React.PointerEvent) {
    drag.current = { pointerX: event.clientX, startMs: viewStart };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: React.PointerEvent) {
    const state = drag.current;
    const node = containerRef.current;
    if (!state || !node) return;
    const width = node.getBoundingClientRect().width || 1;
    const span = viewEnd - viewStart;
    const shift = ((state.pointerX - event.clientX) / width) * span;
    setClamped([state.startMs + shift, state.startMs + shift + span]);
  }
  function endDrag(event: React.PointerEvent) {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function switchDomain(next: Domain) {
    const nextBase = next === 'daily' ? daily : intraday;
    if (nextBase.length === 0) return;
    setDomain(next);
    setView(defaultRange(next, nextBase[0].timestamp.getTime(), nextBase.at(-1)!.timestamp.getTime()));
  }

  const zoomedOut = viewEnd - viewStart >= fullEnd - fullStart;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-sm bg-soft-stone/55 p-1">
          <DomainButton active={domain === 'intraday'} disabled={intraday.length === 0} onClick={() => switchDomain('intraday')}>
            Intraday
          </DomainButton>
          <DomainButton active={domain === 'daily'} disabled={!hasDaily} onClick={() => switchDomain('daily')}>
            Daily
          </DomainButton>
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 rounded-pill bg-pale-blue/50 px-2.5 py-1 text-xs font-medium text-action-blue">
            {interval.label} bars
          </span>
          <ZoomButton label="Zoom out" onClick={() => zoomAround(0.5, 1.25)} disabled={zoomedOut}>
            −
          </ZoomButton>
          <ZoomButton label="Zoom in" onClick={() => zoomAround(0.5, 0.8)} disabled={viewEnd - viewStart <= minSpan}>
            +
          </ZoomButton>
          <button
            type="button"
            onClick={() => setView(defaultRange(domain, fullStart, fullEnd))}
            className="ml-1 rounded-xs border border-hairline px-2.5 py-1 text-xs font-medium text-body-muted transition-colors hover:border-slate hover:text-primary"
          >
            Reset
          </button>
        </div>
      </div>

      <p className="mb-2 text-xs text-body-muted">
        {bars.length > 0
          ? `${formatISTDate(bars[0].timestamp)} – ${formatISTDate(bars.at(-1)!.timestamp)} · scroll to zoom, drag to pan · detail adjusts automatically`
          : 'No data in range'}
      </p>

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        className="cursor-grab touch-pan-y active:cursor-grabbing"
      >
        {bars.length > 0 ? (
          <HistoricalPriceChart
            candles={bars}
            granularity={interval.granularity}
            label={interval.label}
            source={source}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Finest interval whose bar count over [startMs, endMs] stays within MAX_BARS. */
function chooseInterval(
  timeframes: Timeframe[],
  base: OhlcCandle[],
  startMs: number,
  endMs: number,
): Timeframe {
  for (const tf of timeframes) {
    const keys = new Set<number | string>();
    for (const candle of base) {
      const t = candle.timestamp.getTime();
      if (t >= startMs && t <= endMs) keys.add(tf.bucket(t));
    }
    if (keys.size > 0 && keys.size <= MAX_BARS) return tf;
  }
  return timeframes.at(-1)!; // coarsest
}

function DomainButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-xs px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
        active
          ? 'border border-action-blue bg-canvas text-action-blue'
          : 'border border-transparent text-body-muted hover:text-primary'
      }`}
    >
      {children}
    </button>
  );
}

function ZoomButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="h-7 w-7 rounded-xs border border-hairline text-sm font-medium text-body-muted transition-colors hover:border-slate hover:text-primary disabled:opacity-40"
    >
      {children}
    </button>
  );
}
