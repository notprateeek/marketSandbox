import { describe, expect, it } from 'vitest';

import {
  calculatePortfolio,
  percentageOrNull,
  type PositionInput,
  type PriceStatus,
} from '@/lib/finance/portfolio';

/** Build a priced holding in paise; a fall fraction discounts the buy price. */
function holding(
  overrides: Partial<PositionInput> & Pick<PositionInput, 'symbol' | 'totalCostPaise'>,
): PositionInput {
  return {
    instrumentId: overrides.symbol,
    companyName: overrides.symbol,
    quantity: 1,
    averageBuyPricePaise: overrides.totalCostPaise,
    currentPricePaise: overrides.totalCostPaise,
    priceTimestamp: new Date('2026-07-14T00:00:00.000Z'),
    priceStatus: 'OK' as PriceStatus,
    ...overrides,
  };
}

describe('calculatePortfolio — worked example', () => {
  // Starting balance ₹50,000; Tata ₹10,000, Titan ₹20,000, Asian Paints ₹20,000;
  // all three fall 40%. Ignoring whole-share rounding: value ₹30,000, loss ₹20,000, -40%.
  it('reconciles the ₹50,000 / 40%-fall example to ₹30,000, −₹20,000, −40%', () => {
    const fall = 0.6; // remaining value after a 40% drop
    const summary = calculatePortfolio({
      startingBalancePaise: 50_000_00n,
      availableCashPaise: 0n,
      realizedPnlPaise: 0n,
      positions: [
        holding({
          symbol: 'TATAMOTORS',
          totalCostPaise: 10_000_00n,
          currentPricePaise: BigInt(10_000_00 * fall),
        }),
        holding({
          symbol: 'TITAN',
          totalCostPaise: 20_000_00n,
          currentPricePaise: BigInt(20_000_00 * fall),
        }),
        holding({
          symbol: 'ASIANPAINT',
          totalCostPaise: 20_000_00n,
          currentPricePaise: BigInt(20_000_00 * fall),
        }),
      ],
    });

    expect(summary.portfolioValuePaise).toBe(30_000_00n);
    expect(summary.holdingsValuePaise).toBe(30_000_00n);
    expect(summary.investedValuePaise).toBe(50_000_00n);
    expect(summary.totalPnlPaise).toBe(-20_000_00n);
    expect(summary.unrealizedPnlPaise).toBe(-20_000_00n);
    expect(summary.realizedPnlPaise).toBe(0n);
    expect(summary.totalReturnPercent).toBe(-40);
    expect(summary.unrealizedReturnPercent).toBe(-40);
    expect(summary.holdings.map((h) => h.returnPercent)).toEqual([-40, -40, -40]);
    expect(summary.holdings.map((h) => h.allocationPercent)).toEqual([20, 40, 40]);
    expect(summary.hasPricingGaps).toBe(false);
  });
});

describe('calculatePortfolio — realized vs unrealized', () => {
  it('keeps realized P&L (from closed/partial sells) separate from unrealized', () => {
    // Ledger-consistent cash: startingBalance + realized − invested = 45,000.
    const summary = calculatePortfolio({
      startingBalancePaise: 50_000_00n,
      availableCashPaise: 45_000_00n,
      realizedPnlPaise: 5_000_00n, // locked in earlier — not derived from current prices
      positions: [
        holding({ symbol: 'TCS', totalCostPaise: 10_000_00n, currentPricePaise: 12_000_00n }),
      ],
    });

    expect(summary.realizedPnlPaise).toBe(5_000_00n);
    expect(summary.unrealizedPnlPaise).toBe(2_000_00n); // 12,000 − 10,000
    // total P&L reconciles: realized + unrealized === portfolioValue − startingBalance
    expect(summary.totalPnlPaise).toBe(summary.realizedPnlPaise + summary.unrealizedPnlPaise);
    expect(summary.best?.symbol).toBe('TCS');
    expect(summary.worst?.symbol).toBe('TCS');
    expect(summary.largestAllocation?.symbol).toBe('TCS');
  });

  it('ranks best and worst performers by return percentage', () => {
    const summary = calculatePortfolio({
      startingBalancePaise: 100_000_00n,
      availableCashPaise: 0n,
      realizedPnlPaise: 0n,
      positions: [
        holding({ symbol: 'WIN', totalCostPaise: 10_000_00n, currentPricePaise: 15_000_00n }), // +50%
        holding({ symbol: 'FLAT', totalCostPaise: 10_000_00n, currentPricePaise: 10_000_00n }), // 0%
        holding({ symbol: 'LOSE', totalCostPaise: 10_000_00n, currentPricePaise: 6_000_00n }), // −40%
      ],
    });

    expect(summary.best?.symbol).toBe('WIN');
    expect(summary.worst?.symbol).toBe('LOSE');
  });
});

describe('calculatePortfolio — zero denominators return null, never Infinity/NaN', () => {
  it('returns null when the starting balance is zero', () => {
    const summary = calculatePortfolio({
      startingBalancePaise: 0n,
      availableCashPaise: 0n,
      realizedPnlPaise: 0n,
      positions: [],
    });
    expect(summary.totalReturnPercent).toBeNull();
    expect(summary.cashAllocationPercent).toBeNull(); // portfolio value is 0
    expect(summary.unrealizedReturnPercent).toBeNull();
  });

  it('returns null for a holding return when its cost basis is zero', () => {
    const summary = calculatePortfolio({
      startingBalancePaise: 50_000_00n,
      availableCashPaise: 50_000_00n,
      realizedPnlPaise: 0n,
      positions: [holding({ symbol: 'FREE', totalCostPaise: 0n, currentPricePaise: 1_000_00n })],
    });
    expect(summary.holdings[0].returnPercent).toBeNull();
    expect(summary.holdings[0].marketValuePaise).toBe(1_000_00n);
  });

  it('percentageOrNull guards the zero denominator directly', () => {
    expect(percentageOrNull(5n, 0n)).toBeNull();
    expect(percentageOrNull(-100n, 0n)).toBeNull();
    expect(percentageOrNull(50n, 200n)).toBe(25);
  });
});

describe('calculatePortfolio — missing and stale prices are explicit', () => {
  it('excludes missing-price holdings from value and flags the gap without inventing zero', () => {
    const summary = calculatePortfolio({
      startingBalancePaise: 50_000_00n,
      availableCashPaise: 10_000_00n,
      realizedPnlPaise: 0n,
      positions: [
        holding({ symbol: 'PRICED', totalCostPaise: 10_000_00n, currentPricePaise: 12_000_00n }),
        holding({
          symbol: 'MISSING',
          totalCostPaise: 8_000_00n,
          currentPricePaise: null,
          priceTimestamp: null,
          priceStatus: 'MISSING',
        }),
      ],
    });

    expect(summary.holdingsValuePaise).toBe(12_000_00n); // only the priced holding
    expect(summary.portfolioValuePaise).toBe(22_000_00n); // cash + priced holdings
    expect(summary.investedValuePaise).toBe(18_000_00n); // cost basis still counts both
    expect(summary.pricedCount).toBe(1);
    expect(summary.missingPriceCount).toBe(1);
    expect(summary.hasPricingGaps).toBe(true);

    const missing = summary.holdings.find((h) => h.symbol === 'MISSING');
    expect(missing?.marketValuePaise).toBeNull();
    expect(missing?.unrealizedPnlPaise).toBeNull();
    expect(missing?.allocationPercent).toBeNull();
  });

  it('counts stale holdings and reports the freshest price timestamp used', () => {
    const fresh = new Date('2026-07-14T00:00:00.000Z');
    const old = new Date('2026-01-01T00:00:00.000Z');
    const summary = calculatePortfolio({
      startingBalancePaise: 50_000_00n,
      availableCashPaise: 0n,
      realizedPnlPaise: 0n,
      positions: [
        holding({ symbol: 'FRESH', totalCostPaise: 10_000_00n, priceTimestamp: fresh }),
        holding({
          symbol: 'STALE',
          totalCostPaise: 10_000_00n,
          priceTimestamp: old,
          priceStatus: 'STALE',
        }),
      ],
    });

    expect(summary.stalePriceCount).toBe(1);
    expect(summary.pricedCount).toBe(2); // stale prices are still used, just flagged
    expect(summary.priceDataTimestamp).toEqual(fresh);
  });
});
