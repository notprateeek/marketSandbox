import { describe, expect, it } from 'vitest';

import {
  computeAnalytics,
  computeMaxDrawdown,
  computeTradeStats,
  type AnalyticsInput,
  type HoldingSlice,
  type SnapshotPoint,
  type TradeExecutionInput,
} from '@/lib/finance/analytics';

function valuePoints(values: number[]) {
  return values.map((value, index) => ({
    timestamp: new Date(2026, 5, 1, 10, index), // ascending, same day
    portfolioValuePaise: BigInt(value),
  }));
}

function snapshotsFrom(
  points: { day: string; value: number }[],
  startingBalancePaise: number,
): SnapshotPoint[] {
  return points.map(({ day, value }) => ({
    timestamp: new Date(`${day}T10:00:00.000Z`),
    portfolioValuePaise: BigInt(value),
    totalPnlPaise: BigInt(value - startingBalancePaise),
    cashPaise: 0n,
    holdingsValuePaise: BigInt(value),
  }));
}

describe('computeMaxDrawdown — peak-to-trough', () => {
  it('finds the deepest decline from a prior peak', () => {
    // Peaks: 100 → 120 → 130. Trough 60 sits below the 130 peak → 53.85%.
    const result = computeMaxDrawdown(valuePoints([10_000, 12_000, 9_000, 13_000, 6_000, 8_000]));
    expect(result?.magnitudePercent).toBeCloseTo(53.846, 2);
    expect(result?.peakValuePaise).toBe(13_000n);
    expect(result?.troughValuePaise).toBe(6_000n);
  });

  it('is zero for a monotonically rising series', () => {
    expect(computeMaxDrawdown(valuePoints([100, 110, 120, 130]))?.magnitudePercent).toBe(0);
  });

  it('returns null for an empty series', () => {
    expect(computeMaxDrawdown([])).toBeNull();
  });
});

describe('computeAnalytics — daily series metrics', () => {
  const input: AnalyticsInput = {
    startingBalancePaise: 100_000n,
    cashPaise: 0n,
    portfolioValuePaise: 99_000n,
    snapshots: snapshotsFrom(
      [
        { day: '2026-06-01', value: 100_000 },
        { day: '2026-06-02', value: 110_000 }, // +10%
        { day: '2026-06-03', value: 99_000 }, // -10%
      ],
      100_000,
    ),
    holdings: [],
  };

  it('derives daily returns, best/worst day, volatility and portfolio return', () => {
    const analytics = computeAnalytics(input);
    expect(analytics.dailyReturns.map((day) => Math.round(day.returnPercent))).toEqual([10, -10]);
    expect(analytics.bestDay?.returnPercent).toBeCloseTo(10, 5);
    expect(analytics.worstDay?.returnPercent).toBeCloseTo(-10, 5);
    expect(analytics.volatilityPercent).toBeCloseTo(14.142, 2); // sample stddev of [10, -10]
    expect(analytics.portfolioReturnPercent).toBeCloseTo(-1, 5); // last totalPnl -1000 / 100000
  });

  it('flags insufficient data with a single snapshot', () => {
    const analytics = computeAnalytics({
      ...input,
      snapshots: snapshotsFrom([{ day: '2026-06-01', value: 100_000 }], 100_000),
    });
    expect(analytics.hasSeries).toBe(true);
    expect(analytics.dailyReturns).toEqual([]);
    expect(analytics.volatilityPercent).toBeNull();
    expect(analytics.bestDay).toBeNull();
  });
});

describe('computeAnalytics — contributions and concentration', () => {
  const holdings: HoldingSlice[] = [
    {
      symbol: 'TITAN',
      companyName: 'Titan',
      sector: 'Consumer Durables',
      marketValuePaise: 45_000n,
      unrealizedPnlPaise: -5_500n,
      allocationPercent: 48,
    },
    {
      symbol: 'ASIANPAINT',
      companyName: 'Asian Paints',
      sector: 'Consumer Durables',
      marketValuePaise: 30_000n,
      unrealizedPnlPaise: -4_500n,
      allocationPercent: 32,
    },
    {
      symbol: 'TCS',
      companyName: 'TCS',
      sector: 'IT',
      marketValuePaise: 19_000n,
      unrealizedPnlPaise: 1_000n,
      allocationPercent: 20,
    },
  ];
  const analytics = computeAnalytics({
    startingBalancePaise: 100_000n,
    cashPaise: 6_000n,
    portfolioValuePaise: 100_000n,
    snapshots: [],
    holdings,
  });

  it('makes per-holding contributions sum to total holding P&L', () => {
    const sum = analytics.contributions.reduce((total, c) => total + c.pnlPaise, 0n);
    expect(sum).toBe(analytics.totalHoldingPnlPaise);
    expect(analytics.totalHoldingPnlPaise).toBe(-9_000n); // -5500 -4500 +1000
  });

  it('ranks contributions with the biggest loss first', () => {
    expect(analytics.contributions[0].symbol).toBe('TITAN');
    expect(analytics.contributions[0].pnlPaise).toBe(-5_500n);
  });

  it('reports the largest holding and groups sector concentration', () => {
    expect(analytics.largestHolding?.label).toBe('TITAN');
    expect(analytics.largestHolding?.allocationPercent).toBe(48);
    const consumer = analytics.sectorConcentration.find((s) => s.label === 'Consumer Durables');
    expect(consumer?.count).toBe(2);
    expect(consumer?.allocationPercent).toBe(75); // (45000 + 30000) / 100000
  });

  it('computes cash allocation', () => {
    expect(analytics.cashAllocationPercent).toBe(6); // 6000 / 100000
  });
});

describe('computeTradeStats — realized round-trips', () => {
  // Buy 10 @₹100 then 10 @₹120 (avg ₹110). Sell 10 @₹150 → +₹400 (win, Momentum).
  // Sell 10 @₹90 → −₹200 (loss, Value).
  const trades: TradeExecutionInput[] = [
    { instrumentId: 'i1', symbol: 'ACME', side: 'BUY', quantity: 10, pricePaise: 10_000n, timestamp: new Date('2026-06-01') },
    { instrumentId: 'i1', symbol: 'ACME', side: 'BUY', quantity: 10, pricePaise: 12_000n, timestamp: new Date('2026-06-02') },
    { instrumentId: 'i1', symbol: 'ACME', side: 'SELL', quantity: 10, pricePaise: 15_000n, timestamp: new Date('2026-06-03'), strategyTag: 'Momentum' },
    { instrumentId: 'i1', symbol: 'ACME', side: 'SELL', quantity: 10, pricePaise: 9_000n, timestamp: new Date('2026-06-04'), strategyTag: 'Value' },
  ];

  it('derives win rate, profit factor and average win/loss from average cost', () => {
    const stats = computeTradeStats(trades);
    expect(stats.closedTradeCount).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.winRatePercent).toBe(50);
    expect(stats.avgWinPaise).toBe(40_000n); // 150000 − 110000
    expect(stats.avgLossPaise).toBe(20_000n); // |90000 − 110000|
    expect(stats.profitFactor).toBe(2); // 40000 / 20000
    expect(stats.netRealizedPnlPaise).toBe(20_000n);
    expect(stats.expectancyPaise).toBe(10_000n);
  });

  it('groups P&L by tag, worst first', () => {
    const stats = computeTradeStats(trades);
    expect(stats.byStrategy.map((tag) => tag.tag)).toEqual(['Value', 'Momentum']);
    expect(stats.byStrategy[0].netPnlPaise).toBe(-20_000n);
    expect(stats.byStrategy[1].netPnlPaise).toBe(40_000n);
  });

  it('is empty when nothing has been closed', () => {
    const stats = computeTradeStats([trades[0]]);
    expect(stats.closedTradeCount).toBe(0);
    expect(stats.winRatePercent).toBeNull();
    expect(stats.profitFactor).toBeNull();
  });
});
