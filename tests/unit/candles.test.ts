import { describe, expect, it } from 'vitest';

import { aggregateCandles, timeframeFor, type OhlcCandle } from '@/lib/finance/candles';

// A minute candle at `ist` minutes past 2026-07-15T09:15 IST.
function minute(offset: number, o: number, h: number, l: number, c: number, v = 10): OhlcCandle {
  const base = new Date('2026-07-15T09:15:00+05:30').getTime();
  return {
    timestamp: new Date(base + offset * 60_000),
    openPaise: o,
    highPaise: h,
    lowPaise: l,
    closePaise: c,
    volume: v,
  };
}

describe('aggregateCandles', () => {
  it('collapses minute candles into 5-minute OHLCV bars', () => {
    const candles = [
      minute(0, 100, 110, 95, 105, 10),
      minute(1, 105, 108, 102, 103, 20),
      minute(4, 103, 120, 90, 118, 30), // still in the first 5m bucket (0–4)
      minute(5, 118, 119, 117, 117, 40), // next bucket
    ];

    const bars = aggregateCandles(candles, timeframeFor('5m'));

    expect(bars).toHaveLength(2);
    // First bar: open of first, high/low across the group, close of last, summed volume.
    expect(bars[0]).toMatchObject({ openPaise: 100, highPaise: 120, lowPaise: 90, closePaise: 118, volume: 60 });
    expect(bars[1]).toMatchObject({ openPaise: 118, closePaise: 117, volume: 40 });
  });

  it('is order-independent and returns bars ascending by time', () => {
    const bars = aggregateCandles([minute(5, 118, 119, 117, 117), minute(0, 100, 110, 95, 105)], timeframeFor('5m'));
    expect(bars.map((bar) => bar.timestamp.getTime())).toEqual([...bars.map((bar) => bar.timestamp.getTime())].sort((a, b) => a - b));
    expect(bars[0].openPaise).toBe(100);
  });

  it('returns one bar per candle at 1× (1m)', () => {
    const candles = [minute(0, 100, 110, 95, 105), minute(1, 105, 108, 102, 103)];
    expect(aggregateCandles(candles, timeframeFor('1m'))).toHaveLength(2);
  });

  it('falls back to the default timeframe for an unknown key', () => {
    expect(timeframeFor('bogus').key).toBe('1D');
  });

  it('anchors intraday bars to the 09:15 session open (Zerodha/Groww/Upstox convention)', () => {
    // 120 one-minute candles from 09:15 IST → session runs 09:15–11:14.
    const candles = Array.from({ length: 120 }, (_, m) => minute(m, 100, 100, 100, 100, 1));
    const bars = aggregateCandles(candles, timeframeFor('1h'));

    // Full hours measured from the 09:15 open: 09:15–10:14 and 10:15–11:14 —
    // NOT clock hours (09:15–09:59, 10:00…), which is the Western-venue style.
    expect(bars).toHaveLength(2);
    expect(bars[0].timestamp.getTime()).toBe(candles[0].timestamp.getTime()); // 09:15
    expect(bars[1].timestamp.getTime()).toBe(candles[60].timestamp.getTime()); // 10:15
    expect(bars[0].volume).toBe(60); // 60 one-minute candles per full hour

    // 30-min bars also break off the 09:15 open (09:15/09:45/10:15/10:45).
    const halfHours = aggregateCandles(candles, timeframeFor('30m'));
    expect(halfHours[0].timestamp.getTime()).toBe(candles[0].timestamp.getTime()); // 09:15
    expect(halfHours[1].timestamp.getTime()).toBe(candles[30].timestamp.getTime()); // 09:45
  });

  it('groups daily candles into IST weeks (Mon–Fri) and calendar months', () => {
    const day = (iso: string, close: number): OhlcCandle => ({
      timestamp: new Date(`${iso}T15:30:00+05:30`),
      openPaise: close,
      highPaise: close,
      lowPaise: close,
      closePaise: close,
      volume: 1,
    });
    // 2026-07-13 is a Monday; 07-17 Friday; 07-20 the next Monday.
    const daily = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-20'].map(
      (iso, index) => day(iso, index + 1),
    );

    const weeks = aggregateCandles(daily, timeframeFor('1W'));
    expect(weeks).toHaveLength(2); // Mon–Fri together, then the next Monday
    expect(weeks[0].closePaise).toBe(5); // Friday's close
    expect(weeks[0].volume).toBe(5); // five trading days
    expect(weeks[1].closePaise).toBe(6);

    // Spanning a month boundary splits into two monthly bars.
    const months = aggregateCandles([day('2026-07-31', 1), day('2026-08-03', 2)], timeframeFor('1M'));
    expect(months).toHaveLength(2);
  });
});
