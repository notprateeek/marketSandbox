import { describe, expect, it } from 'vitest';

import type { PortfolioAnalytics, TradeStats } from '@/lib/finance/analytics';
import { deriveInsights } from '@/lib/finance/insights';

const NEUTRAL_TRADE_STATS: TradeStats = {
  closedTradeCount: 0,
  wins: 0,
  losses: 0,
  winRatePercent: null,
  profitFactor: null,
  avgWinPaise: null,
  avgLossPaise: null,
  grossProfitPaise: 0n,
  grossLossPaise: 0n,
  netRealizedPnlPaise: 0n,
  expectancyPaise: null,
  byStrategy: [],
  byEmotion: [],
};

// A neutral analytics object; each test overrides only what its rule reads.
function analytics(overrides: Partial<PortfolioAnalytics>): PortfolioAnalytics {
  return {
    hasSeries: true,
    hasDailySeries: true,
    tradeStats: NEUTRAL_TRADE_STATS,
    portfolioReturnPercent: 0,
    valueSeries: [],
    cumulativeSeries: [],
    drawdownSeries: [],
    dailyReturns: [],
    maxDrawdown: null,
    bestDay: null,
    worstDay: null,
    volatilityPercent: null,
    holdingConcentration: [],
    sectorConcentration: [],
    largestHolding: null,
    cashAllocationPercent: null,
    contributions: [],
    totalHoldingPnlPaise: 0n,
    ...overrides,
  };
}

function messages(a: PortfolioAnalytics): string[] {
  return deriveInsights(a).map((insight) => insight.message);
}

describe('deriveInsights — deterministic rules over real numbers', () => {
  it('reports maximum drawdown', () => {
    const result = messages(
      analytics({
        maxDrawdown: {
          magnitudePercent: 18,
          peakValuePaise: 100n,
          troughValuePaise: 82n,
          peakAt: new Date(0),
          troughAt: new Date(0),
        },
      }),
    );
    expect(result).toContain('The portfolio reached a maximum drawdown of 18%.');
  });

  it('reports the largest holding concentration', () => {
    const result = messages(
      analytics({
        largestHolding: { key: 'TITAN', label: 'TITAN', allocationPercent: 48, count: 1 },
      }),
    );
    expect(result).toContain('Your largest holding (TITAN) represents 48% of the portfolio.');
  });

  it('attributes the dominant share of a loss to one holding', () => {
    const result = messages(
      analytics({
        contributions: [
          { symbol: 'TITAN', companyName: 'Titan', pnlPaise: -5_500n, percent: 61.1 },
          { symbol: 'ASIANPAINT', companyName: 'Asian Paints', pnlPaise: -4_500n, percent: 50 },
        ],
      }),
    );
    // gross loss = -10,000; Titan's share = 5,500 / 10,000 = 55%.
    expect(result).toContain('TITAN contributed 55% of your total loss.');
  });

  it('suggests a cash cushion only when the portfolio declined with little cash', () => {
    expect(
      messages(analytics({ portfolioReturnPercent: -12, cashAllocationPercent: 5 })),
    ).toContain('Keeping 20% in cash would have reduced the portfolio decline.');
    // No suggestion when the portfolio gained.
    expect(
      messages(analytics({ portfolioReturnPercent: 8, cashAllocationPercent: 5 })),
    ).not.toContain('Keeping 20% in cash would have reduced the portfolio decline.');
  });

  it('flags two holdings in the same sector', () => {
    const result = messages(
      analytics({
        sectorConcentration: [
          { key: 'Consumer Durables', label: 'Consumer Durables', allocationPercent: 75, count: 2 },
          { key: 'IT', label: 'IT', allocationPercent: 20, count: 1 },
        ],
      }),
    );
    expect(result).toContain('2 holdings belong to the same sector (Consumer Durables).');
  });

  it('flags the tag whose trades lose most heavily vs the average', () => {
    const result = messages(
      analytics({
        tradeStats: {
          ...NEUTRAL_TRADE_STATS,
          closedTradeCount: 6,
          wins: 2,
          losses: 4,
          winRatePercent: (2 / 6) * 100,
          netRealizedPnlPaise: -6_000n,
          expectancyPaise: -1_000n, // average trade loses ₹10
          byEmotion: [
            { tag: 'FOMO', trades: 3, wins: 0, losses: 3, netPnlPaise: -9_000n, avgPnlPaise: -3_000n, winRatePercent: 0 },
            { tag: 'Patient', trades: 3, wins: 2, losses: 1, netPnlPaise: 3_000n, avgPnlPaise: 1_000n, winRatePercent: 66.7 },
          ],
        },
      }),
    );
    // FOMO avg loss ₹30 ÷ average loss ₹10 = 3×.
    expect(result).toContain('FOMO-tagged trades lose 3× more than your average trade.');
  });

  it('does not flag a tag when the average trade is profitable', () => {
    const result = messages(
      analytics({
        tradeStats: {
          ...NEUTRAL_TRADE_STATS,
          closedTradeCount: 4,
          netRealizedPnlPaise: 8_000n,
          expectancyPaise: 2_000n, // average trade profits → no tag-loss warning
          byEmotion: [
            { tag: 'FOMO', trades: 3, wins: 0, losses: 3, netPnlPaise: -3_000n, avgPnlPaise: -1_000n, winRatePercent: 0 },
          ],
        },
      }),
    );
    expect(result.some((message) => message.includes('FOMO-tagged'))).toBe(false);
  });

  it('reports the round-trip win rate', () => {
    const result = messages(
      analytics({
        tradeStats: { ...NEUTRAL_TRADE_STATS, closedTradeCount: 5, wins: 3, winRatePercent: 60 },
      }),
    );
    expect(result).toContain('You closed 60% of your 5 round-trips at a profit.');
  });

  it('emits nothing when there is no signal', () => {
    expect(deriveInsights(analytics({}))).toEqual([]);
  });
});
