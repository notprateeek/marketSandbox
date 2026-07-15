/**
 * Pure portfolio analytics over a series of snapshots. No I/O, no wall-clock —
 * every number is derived from the inputs, so results are deterministic and the
 * hard bits (maximum drawdown, contribution split) are directly unit-testable.
 *
 * Money is integer paise; returns/percentages are plain numbers, or null when a
 * denominator is zero or there is not enough data.
 */

import { percentageOrNull } from './portfolio';

export interface SnapshotPoint {
  timestamp: Date;
  portfolioValuePaise: number;
  totalPnlPaise: number;
  cashPaise: number;
  holdingsValuePaise: number;
}

export interface HoldingSlice {
  symbol: string;
  companyName: string;
  sector: string;
  marketValuePaise: number | null;
  unrealizedPnlPaise: number | null;
  allocationPercent: number | null;
}

export interface AnalyticsInput {
  startingBalancePaise: number;
  cashPaise: number;
  portfolioValuePaise: number;
  /** Range-filtered snapshots, ascending by timestamp. */
  snapshots: SnapshotPoint[];
  /** Current holdings (as of the clock). */
  holdings: HoldingSlice[];
}

export interface ValuePoint {
  timestamp: Date;
  portfolioValuePaise: number;
}

export interface CumulativePoint {
  timestamp: Date;
  totalPnlPaise: number;
  returnPercent: number | null;
}

export interface DrawdownPoint {
  timestamp: Date;
  drawdownPercent: number; // <= 0
}

export interface DailyReturn {
  date: Date;
  returnPercent: number;
}

export interface MaxDrawdown {
  magnitudePercent: number; // positive
  peakValuePaise: number;
  troughValuePaise: number;
  peakAt: Date;
  troughAt: Date;
}

export interface Concentration {
  key: string;
  label: string;
  allocationPercent: number;
  count: number;
}

export interface Contribution {
  symbol: string;
  companyName: string;
  pnlPaise: number;
  /** Share of total holding P&L; null when that total is zero. */
  percent: number | null;
}

export interface PortfolioAnalytics {
  hasSeries: boolean;
  hasDailySeries: boolean;
  portfolioReturnPercent: number | null;
  valueSeries: ValuePoint[];
  cumulativeSeries: CumulativePoint[];
  drawdownSeries: DrawdownPoint[];
  dailyReturns: DailyReturn[];
  maxDrawdown: MaxDrawdown | null;
  bestDay: DailyReturn | null;
  worstDay: DailyReturn | null;
  volatilityPercent: number | null;
  holdingConcentration: Concentration[];
  sectorConcentration: Concentration[];
  largestHolding: Concentration | null;
  cashAllocationPercent: number | null;
  contributions: Contribution[];
  totalHoldingPnlPaise: number;
}

export function computeAnalytics(input: AnalyticsInput): PortfolioAnalytics {
  const { snapshots, holdings, startingBalancePaise, portfolioValuePaise, cashPaise } = input;

  const valueSeries: ValuePoint[] = snapshots.map((snapshot) => ({
    timestamp: snapshot.timestamp,
    portfolioValuePaise: snapshot.portfolioValuePaise,
  }));
  const cumulativeSeries: CumulativePoint[] = snapshots.map((snapshot) => ({
    timestamp: snapshot.timestamp,
    totalPnlPaise: snapshot.totalPnlPaise,
    returnPercent: percentageOrNull(snapshot.totalPnlPaise, startingBalancePaise),
  }));

  const lastSnapshot = snapshots.at(-1);
  const portfolioReturnPercent = lastSnapshot
    ? percentageOrNull(lastSnapshot.totalPnlPaise, startingBalancePaise)
    : null;

  const dailyReturns = computeDailyReturns(snapshots);
  const returns = dailyReturns.map((day) => day.returnPercent);

  const priced = holdings.filter(
    (holding): holding is HoldingSlice & { marketValuePaise: number; unrealizedPnlPaise: number } =>
      holding.marketValuePaise !== null && holding.unrealizedPnlPaise !== null,
  );

  const holdingConcentration = priced
    .filter((holding) => holding.allocationPercent !== null)
    .map((holding) => ({
      key: holding.symbol,
      label: holding.symbol,
      allocationPercent: holding.allocationPercent ?? 0,
      count: 1,
    }))
    .sort((a, b) => b.allocationPercent - a.allocationPercent);

  const contributions = buildContributions(priced);
  const totalHoldingPnlPaise = priced.reduce((sum, holding) => sum + holding.unrealizedPnlPaise, 0);

  return {
    hasSeries: snapshots.length > 0,
    hasDailySeries: dailyReturns.length >= 1,
    portfolioReturnPercent,
    valueSeries,
    cumulativeSeries,
    drawdownSeries: computeDrawdownSeries(valueSeries),
    dailyReturns,
    maxDrawdown: computeMaxDrawdown(valueSeries),
    bestDay: pickReturn(dailyReturns, (a, b) => b.returnPercent - a.returnPercent),
    worstDay: pickReturn(dailyReturns, (a, b) => a.returnPercent - b.returnPercent),
    volatilityPercent: sampleStdDev(returns),
    holdingConcentration,
    sectorConcentration: buildSectorConcentration(priced, portfolioValuePaise),
    largestHolding: holdingConcentration[0] ?? null,
    cashAllocationPercent: percentageOrNull(cashPaise, portfolioValuePaise),
    contributions,
    totalHoldingPnlPaise,
  };
}

/**
 * Maximum peak-to-trough decline across the value series. Walks the series once
 * tracking the running peak; the deepest fraction below a prior peak is the
 * drawdown. Returns a positive magnitude and the peak/trough it spanned.
 */
export function computeMaxDrawdown(series: ValuePoint[]): MaxDrawdown | null {
  if (series.length === 0) return null;

  let peak = series[0];
  let worst: { fraction: number; peak: ValuePoint; trough: ValuePoint } | null = null;

  for (const point of series) {
    if (point.portfolioValuePaise > peak.portfolioValuePaise) peak = point;
    if (peak.portfolioValuePaise <= 0) continue;

    const fraction =
      (point.portfolioValuePaise - peak.portfolioValuePaise) / peak.portfolioValuePaise; // <= 0
    if (worst === null || fraction < worst.fraction) {
      worst = { fraction, peak, trough: point };
    }
  }

  if (!worst) return null;
  return {
    magnitudePercent: Math.abs(worst.fraction) * 100, // fraction <= 0; abs avoids -0
    peakValuePaise: worst.peak.portfolioValuePaise,
    troughValuePaise: worst.trough.portfolioValuePaise,
    peakAt: worst.peak.timestamp,
    troughAt: worst.trough.timestamp,
  };
}

function computeDrawdownSeries(series: ValuePoint[]): DrawdownPoint[] {
  let peak = Number.NEGATIVE_INFINITY;
  return series.map((point) => {
    peak = Math.max(peak, point.portfolioValuePaise);
    return {
      timestamp: point.timestamp,
      drawdownPercent: peak > 0 ? ((point.portfolioValuePaise - peak) / peak) * 100 : 0,
    };
  });
}

function computeDailyReturns(snapshots: SnapshotPoint[]): DailyReturn[] {
  // One closing value per IST calendar day (the day's last snapshot).
  const byDay = new Map<string, SnapshotPoint>();
  for (const snapshot of snapshots) {
    byDay.set(istDayKey(snapshot.timestamp), snapshot);
  }
  const dailyCloses = [...byDay.values()].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );

  const returns: DailyReturn[] = [];
  for (let index = 1; index < dailyCloses.length; index += 1) {
    const previous = dailyCloses[index - 1].portfolioValuePaise;
    const current = dailyCloses[index].portfolioValuePaise;
    const percent = percentageOrNull(current - previous, previous);
    if (percent !== null)
      returns.push({ date: dailyCloses[index].timestamp, returnPercent: percent });
  }
  return returns;
}

function buildContributions(
  priced: (HoldingSlice & { unrealizedPnlPaise: number })[],
): Contribution[] {
  const total = priced.reduce((sum, holding) => sum + holding.unrealizedPnlPaise, 0);
  return priced
    .map((holding) => ({
      symbol: holding.symbol,
      companyName: holding.companyName,
      pnlPaise: holding.unrealizedPnlPaise,
      percent: percentageOrNull(holding.unrealizedPnlPaise, total),
    }))
    .sort((a, b) => a.pnlPaise - b.pnlPaise); // biggest losses first
}

function buildSectorConcentration(
  priced: (HoldingSlice & { marketValuePaise: number })[],
  portfolioValuePaise: number,
): Concentration[] {
  const bySector = new Map<string, { value: number; count: number }>();
  for (const holding of priced) {
    const entry = bySector.get(holding.sector) ?? { value: 0, count: 0 };
    entry.value += holding.marketValuePaise;
    entry.count += 1;
    bySector.set(holding.sector, entry);
  }

  return [...bySector.entries()]
    .map(([sector, entry]) => ({
      key: sector,
      label: sector,
      allocationPercent: percentageOrNull(entry.value, portfolioValuePaise) ?? 0,
      count: entry.count,
    }))
    .sort((a, b) => b.allocationPercent - a.allocationPercent);
}

function pickReturn(
  returns: DailyReturn[],
  compare: (a: DailyReturn, b: DailyReturn) => number,
): DailyReturn | null {
  return returns.length === 0 ? null : [...returns].sort(compare)[0];
}

function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

const istDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function istDayKey(date: Date): string {
  return istDayFormatter.format(date);
}
