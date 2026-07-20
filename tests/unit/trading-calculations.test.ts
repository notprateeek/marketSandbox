import { describe, expect, it } from 'vitest';

import { MAX_PAISE } from '@/lib/finance/currency';
import {
  calculateBuyQuote,
  calculatePositionAfterBuy,
  calculatePositionAfterSell,
} from '@/server/services/submit-market-order';

describe('market-order calculations', () => {
  it('buys only whole shares and leaves the unspent amount out of the debit', () => {
    expect(calculateBuyQuote(20_999n, 10_000n)).toEqual({
      quantity: 2,
      grossAmountPaise: 20_000n,
    });
    expect(calculateBuyQuote(9_999n, 10_000n)).toEqual({
      quantity: 0,
      grossAmountPaise: 0n,
    });
  });

  it('calculates a weighted average from exact total cost', () => {
    const firstBuy = calculatePositionAfterBuy(null, 2, 20_000n);
    const secondBuy = calculatePositionAfterBuy(firstBuy, 3, 42_000n);

    expect(secondBuy).toEqual({
      quantity: 5,
      averageBuyPricePaise: 12_400n,
      totalCostPaise: 62_000n,
      realizedPnlPaise: 0n,
    });
  });

  it('allocates cost basis and accumulates realized profit and loss across sells', () => {
    const position = {
      quantity: 5,
      averageBuyPricePaise: 12_400n,
      totalCostPaise: 62_000n,
      realizedPnlPaise: 0n,
    };
    const partialSell = calculatePositionAfterSell(position, 2, 30_000n);

    expect(partialSell).toEqual({
      quantity: 3,
      averageBuyPricePaise: 12_400n,
      totalCostPaise: 37_200n,
      realizedPnlPaise: 5_200n,
      realizedPnlDeltaPaise: 5_200n,
    });
    expect(calculatePositionAfterSell(partialSell!, 3, 33_000n)).toEqual({
      quantity: 0,
      averageBuyPricePaise: 0n,
      totalCostPaise: 0n,
      realizedPnlPaise: 1_000n,
      realizedPnlDeltaPaise: -4_200n,
    });
  });

  // Amounts are bigint paise: a fractional/non-finite value can no longer be
  // constructed, so the only invalid amounts are non-positive or out-of-range.
  it.each([0n, -1n, MAX_PAISE + 1n])('rejects an invalid amount %s', (invalidAmount) => {
    expect(calculateBuyQuote(invalidAmount, 10_000n)).toBeNull();
  });

  // Quantities are share counts (number): non-integer and non-finite are invalid.
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid quantity %s',
    (invalidQuantity) => {
      expect(calculatePositionAfterBuy(null, invalidQuantity, 10_000n)).toBeNull();
      expect(
        calculatePositionAfterSell(
          {
            quantity: 2,
            averageBuyPricePaise: 10_000n,
            totalCostPaise: 20_000n,
            realizedPnlPaise: 0n,
          },
          invalidQuantity,
          10_000n,
        ),
      ).toBeNull();
    },
  );
});
