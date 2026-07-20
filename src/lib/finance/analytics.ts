/**
 * Pure portfolio analytics over a series of snapshots. No I/O, no wall-clock —
 * every number is derived from the inputs, so results are deterministic and the
 * hard bits (maximum drawdown, contribution split) are directly unit-testable.
 *
 * Money is integer paise; returns/percentages are plain numbers, or null when a
 * denominator is zero or there is not enough data.
 */

import { istDayKey } from './datetime';
import { percentageOrNull } from './portfolio';

export interface SnapshotPoint {
  timestamp: Date;
  portfolioValuePaise: bigint;
  totalPnlPaise: bigint;
  cashPaise: bigint;
  holdingsValuePaise: bigint;
}

export interface HoldingSlice {
  symbol: string;
  companyName: string;
  sector: string;
  marketValuePaise: bigint | null;
  unrealizedPnlPaise: bigint | null;
  allocationPercent: number | null;
}

/**
 * One filled execution, in chronological order. Tags come from the order's
 * journal entry and are only meaningful on the closing SELL (which is where a
 * round-trip's realized P&L lands).
 */
export interface TradeExecutionInput {
  instrumentId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  pricePaise: bigint;
  timestamp: Date;
  strategyTag?: string | null;
  emotionTag?: string | null;
}

export interface AnalyticsInput {
  startingBalancePaise: bigint;
  cashPaise: bigint;
  portfolioValuePaise: bigint;
  /** Range-filtered snapshots, ascending by timestamp. */
  snapshots: SnapshotPoint[];
  /** Current holdings (as of the clock). */
  holdings: HoldingSlice[];
  /** All filled executions for the account, chronological. Lifetime, not range-filtered. */
  trades?: TradeExecutionInput[];
}

export interface ValuePoint {
  timestamp: Date;
  portfolioValuePaise: bigint;
}

export interface CumulativePoint {
  timestamp: Date;
  totalPnlPaise: bigint;
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
  peakValuePaise: bigint;
  troughValuePaise: bigint;
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
  pnlPaise: bigint;
  /** Share of total holding P&L; null when that total is zero. */
  percent: number | null;
}

/** Realized round-trip: a SELL closing some shares against their average cost. */
export interface ClosedTrade {
  symbol: string;
  quantity: number;
  proceedsPaise: bigint;
  costPaise: bigint;
  realizedPnlPaise: bigint;
  strategyTag: string | null;
  emotionTag: string | null;
  closedAt: Date;
}

export interface TagPerformance {
  tag: string;
  trades: number;
  wins: number;
  losses: number;
  netPnlPaise: bigint;
  avgPnlPaise: bigint;
  winRatePercent: number;
}

export interface TradeStats {
  closedTradeCount: number;
  wins: number;
  losses: number;
  winRatePercent: number | null;
  /** Gross profit ÷ gross loss magnitude; null when there are no losing trades. */
  profitFactor: number | null;
  avgWinPaise: bigint | null;
  /** Positive magnitude of the average losing trade; null when none. */
  avgLossPaise: bigint | null;
  grossProfitPaise: bigint;
  /** Positive magnitude of total losses. */
  grossLossPaise: bigint;
  netRealizedPnlPaise: bigint;
  /** Average realized P&L per closed trade; null when none. */
  expectancyPaise: bigint | null;
  byStrategy: TagPerformance[];
  byEmotion: TagPerformance[];
}

export interface PortfolioAnalytics {
  hasSeries: boolean;
  hasDailySeries: boolean;
  tradeStats: TradeStats;
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
  totalHoldingPnlPaise: bigint;
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
    (holding): holding is HoldingSlice & { marketValuePaise: bigint; unrealizedPnlPaise: bigint } =>
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
  const totalHoldingPnlPaise = priced.reduce(
    (sum, holding) => sum + holding.unrealizedPnlPaise,
    0n,
  );

  return {
    hasSeries: snapshots.length > 0,
    hasDailySeries: dailyReturns.length >= 1,
    tradeStats: computeTradeStats(input.trades ?? []),
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
    if (peak.portfolioValuePaise <= 0n) continue;

    const fraction =
      Number(point.portfolioValuePaise - peak.portfolioValuePaise) /
      Number(peak.portfolioValuePaise); // <= 0
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

/**
 * Realized trade statistics from a chronological execution list. Walks each
 * instrument keeping a running average cost (the same rounded-ratio basis the
 * order engine books), so every SELL yields a realized P&L. A "closed trade" is
 * one such SELL; wins/losses, profit factor and per-tag P&L follow from those.
 */
export function computeTradeStats(trades: TradeExecutionInput[]): TradeStats {
  const held = new Map<string, { quantity: number; totalCostPaise: bigint }>();
  const closed: ClosedTrade[] = [];

  for (const trade of trades) {
    if (trade.quantity <= 0) continue;
    const lot = held.get(trade.instrumentId) ?? { quantity: 0, totalCostPaise: 0n };

    if (trade.side === 'BUY') {
      lot.quantity += trade.quantity;
      lot.totalCostPaise += BigInt(trade.quantity) * trade.pricePaise;
      held.set(trade.instrumentId, lot);
      continue;
    }

    // SELL: realize against average cost, clamped to what is held.
    const soldQuantity = Math.min(trade.quantity, lot.quantity);
    if (soldQuantity <= 0) continue;
    const remaining = lot.quantity - soldQuantity;
    const costPaise =
      remaining === 0
        ? lot.totalCostPaise
        : roundedRatio(lot.totalCostPaise * BigInt(soldQuantity), BigInt(lot.quantity));
    const proceedsPaise = BigInt(soldQuantity) * trade.pricePaise;

    closed.push({
      symbol: trade.symbol,
      quantity: soldQuantity,
      proceedsPaise,
      costPaise,
      realizedPnlPaise: proceedsPaise - costPaise,
      strategyTag: trade.strategyTag ?? null,
      emotionTag: trade.emotionTag ?? null,
      closedAt: trade.timestamp,
    });

    lot.quantity = remaining;
    lot.totalCostPaise = lot.totalCostPaise - costPaise;
    held.set(trade.instrumentId, lot);
  }

  const wins = closed.filter((trade) => trade.realizedPnlPaise > 0n);
  const losses = closed.filter((trade) => trade.realizedPnlPaise < 0n);
  const grossProfitPaise = wins.reduce((sum, trade) => sum + trade.realizedPnlPaise, 0n);
  const grossLossPaise = losses.reduce((sum, trade) => sum - trade.realizedPnlPaise, 0n); // positive
  const netRealizedPnlPaise = closed.reduce((sum, trade) => sum + trade.realizedPnlPaise, 0n);

  return {
    closedTradeCount: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRatePercent: closed.length === 0 ? null : (wins.length / closed.length) * 100,
    profitFactor:
      grossLossPaise === 0n ? null : Number(grossProfitPaise) / Number(grossLossPaise),
    avgWinPaise: wins.length === 0 ? null : grossProfitPaise / BigInt(wins.length),
    avgLossPaise: losses.length === 0 ? null : grossLossPaise / BigInt(losses.length),
    grossProfitPaise,
    grossLossPaise,
    netRealizedPnlPaise,
    expectancyPaise: closed.length === 0 ? null : netRealizedPnlPaise / BigInt(closed.length),
    byStrategy: groupTagPerformance(closed, (trade) => trade.strategyTag),
    byEmotion: groupTagPerformance(closed, (trade) => trade.emotionTag),
  };
}

function groupTagPerformance(
  closed: ClosedTrade[],
  tagOf: (trade: ClosedTrade) => string | null,
): TagPerformance[] {
  const byTag = new Map<string, ClosedTrade[]>();
  for (const trade of closed) {
    const tag = tagOf(trade);
    if (!tag) continue;
    (byTag.get(tag) ?? byTag.set(tag, []).get(tag)!).push(trade);
  }

  return [...byTag.entries()]
    .map(([tag, trades]) => {
      const netPnlPaise = trades.reduce((sum, trade) => sum + trade.realizedPnlPaise, 0n);
      const winCount = trades.filter((trade) => trade.realizedPnlPaise > 0n).length;
      return {
        tag,
        trades: trades.length,
        wins: winCount,
        losses: trades.filter((trade) => trade.realizedPnlPaise < 0n).length,
        netPnlPaise,
        avgPnlPaise: netPnlPaise / BigInt(trades.length),
        winRatePercent: (winCount / trades.length) * 100,
      };
    })
    .sort((a, b) => Number(a.netPnlPaise - b.netPnlPaise)); // worst first
}

/** Nearest-integer bigint division: (n + d/2) / d, for positive d. */
function roundedRatio(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function computeDrawdownSeries(series: ValuePoint[]): DrawdownPoint[] {
  let peak: bigint | null = null;
  return series.map((point) => {
    if (peak === null || point.portfolioValuePaise > peak) peak = point.portfolioValuePaise;
    return {
      timestamp: point.timestamp,
      drawdownPercent:
        peak > 0n ? (Number(point.portfolioValuePaise - peak) / Number(peak)) * 100 : 0,
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
  priced: (HoldingSlice & { unrealizedPnlPaise: bigint })[],
): Contribution[] {
  const total = priced.reduce((sum, holding) => sum + holding.unrealizedPnlPaise, 0n);
  return priced
    .map((holding) => ({
      symbol: holding.symbol,
      companyName: holding.companyName,
      pnlPaise: holding.unrealizedPnlPaise,
      percent: percentageOrNull(holding.unrealizedPnlPaise, total),
    }))
    .sort((a, b) => Number(a.pnlPaise - b.pnlPaise)); // biggest losses first
}

function buildSectorConcentration(
  priced: (HoldingSlice & { marketValuePaise: bigint })[],
  portfolioValuePaise: bigint,
): Concentration[] {
  const bySector = new Map<string, { value: bigint; count: number }>();
  for (const holding of priced) {
    const entry = bySector.get(holding.sector) ?? { value: 0n, count: 0 };
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

