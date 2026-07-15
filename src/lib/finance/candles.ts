import { CandleInterval } from '@/server/market-data/types';

/** The minimum a chart candle needs: an OHLCV bar at a point in time. */
export interface OhlcCandle {
  timestamp: Date;
  openPaise: number;
  highPaise: number;
  lowPaise: number;
  closePaise: number;
  volume: number;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// India Standard Time is UTC+05:30, no DST. All bucketing is done in IST-local
// time so boundaries land on the IST clock/calendar, matching the exchange.
const IST_OFFSET = (5 * 60 + 30) * MINUTE;
// NSE opens 09:15 IST. Zerodha Kite / Groww / Upstox anchor intraday candles to
// the session open (so the first hourly bar is a full 09:15–10:15 and the
// 15:15–15:30 bar is the short one), not to clock :00/:30 like Western venues.
const SESSION_OPEN_MS = (9 * 60 + 15) * MINUTE;

/**
 * A selectable chart timeframe. `base` is the stored interval it aggregates
 * from; `bucket` maps a candle's epoch-ms to a group key so consecutive base
 * candles collapse into one higher-timeframe bar.
 */
export interface Timeframe {
  key: string;
  label: string;
  base: CandleInterval;
  granularity: 'intraday' | 'daily';
  bucket: (timestampMs: number) => number | string;
}

// Intraday buckets measured from the 09:15 IST session open (Kite/NSE
// convention). Every supported width divides the 1440-minute day, so the grid
// re-anchors to 09:15 each session with no drift.
const sessionWidth = (ms: number) => (timestampMs: number) =>
  Math.floor((timestampMs + IST_OFFSET - SESSION_OPEN_MS) / ms);
// IST calendar day index (days since 1970-01-01 IST).
const istDay = (timestampMs: number) => Math.floor((timestampMs + IST_OFFSET) / DAY);
// Monday-start week, keyed by its start day — groups a full Mon–Fri IST week.
const istWeek = (timestampMs: number) => {
  const day = istDay(timestampMs);
  const weekday = (((day + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday → 0=Sun … 6=Sat
  return day - ((weekday + 6) % 7);
};
// IST calendar month index (year * 12 + month).
const istMonth = (timestampMs: number) => {
  const date = new Date(timestampMs + IST_OFFSET);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
};

export const TIMEFRAMES: Timeframe[] = [
  { key: '1m', label: '1 min', base: CandleInterval.ONE_MINUTE, granularity: 'intraday', bucket: sessionWidth(MINUTE) },
  { key: '3m', label: '3 min', base: CandleInterval.ONE_MINUTE, granularity: 'intraday', bucket: sessionWidth(3 * MINUTE) },
  { key: '5m', label: '5 min', base: CandleInterval.ONE_MINUTE, granularity: 'intraday', bucket: sessionWidth(5 * MINUTE) },
  { key: '10m', label: '10 min', base: CandleInterval.ONE_MINUTE, granularity: 'intraday', bucket: sessionWidth(10 * MINUTE) },
  { key: '15m', label: '15 min', base: CandleInterval.ONE_MINUTE, granularity: 'intraday', bucket: sessionWidth(15 * MINUTE) },
  { key: '30m', label: '30 min', base: CandleInterval.ONE_MINUTE, granularity: 'intraday', bucket: sessionWidth(30 * MINUTE) },
  { key: '1h', label: '1 hour', base: CandleInterval.ONE_MINUTE, granularity: 'intraday', bucket: sessionWidth(60 * MINUTE) },
  { key: '1D', label: '1 day', base: CandleInterval.ONE_DAY, granularity: 'daily', bucket: istDay },
  { key: '1W', label: '1 week', base: CandleInterval.ONE_DAY, granularity: 'daily', bucket: istWeek },
  { key: '1M', label: '1 month', base: CandleInterval.ONE_DAY, granularity: 'daily', bucket: istMonth },
];

export const DEFAULT_TIMEFRAME = TIMEFRAMES.find((tf) => tf.key === '1D')!;

export function timeframeFor(key: string | undefined): Timeframe {
  return TIMEFRAMES.find((tf) => tf.key === key) ?? DEFAULT_TIMEFRAME;
}

/**
 * Collapses base candles into `timeframe` bars: first open, running max high,
 * min low, last close, summed volume. Input need not be sorted; output is
 * ascending by time. A 1× timeframe (1m/1D) returns one bar per input candle.
 */
export function aggregateCandles(candles: OhlcCandle[], timeframe: Timeframe): OhlcCandle[] {
  const sorted = [...candles].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const groups = new Map<number | string, OhlcCandle>();

  for (const candle of sorted) {
    const key = timeframe.bucket(candle.timestamp.getTime());
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...candle });
    } else {
      existing.highPaise = Math.max(existing.highPaise, candle.highPaise);
      existing.lowPaise = Math.min(existing.lowPaise, candle.lowPaise);
      existing.closePaise = candle.closePaise;
      existing.volume += candle.volume;
    }
  }

  return [...groups.values()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
