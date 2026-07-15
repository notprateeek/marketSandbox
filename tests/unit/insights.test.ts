import { describe, expect, it } from 'vitest';

import type { PortfolioAnalytics } from '@/lib/finance/analytics';
import { deriveInsights } from '@/lib/finance/insights';

// A neutral analytics object; each test overrides only what its rule reads.
function analytics(overrides: Partial<PortfolioAnalytics>): PortfolioAnalytics {
  return {
    hasSeries: true,
    hasDailySeries: true,
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
    totalHoldingPnlPaise: 0,
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
          peakValuePaise: 100,
          troughValuePaise: 82,
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
          { symbol: 'TITAN', companyName: 'Titan', pnlPaise: -5_500, percent: 61.1 },
          { symbol: 'ASIANPAINT', companyName: 'Asian Paints', pnlPaise: -4_500, percent: 50 },
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

  it('emits nothing when there is no signal', () => {
    expect(deriveInsights(analytics({}))).toEqual([]);
  });
});
