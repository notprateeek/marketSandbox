import { describe, expect, it } from 'vitest';

import {
  MAX_DATABASE_INT,
  calculateBuyQuote,
  calculatePositionAfterBuy,
  calculatePositionAfterSell,
} from '@/server/services/submit-market-order';

describe('market-order calculations', () => {
  it('buys only whole shares and leaves the unspent amount out of the debit', () => {
    expect(calculateBuyQuote(20_999, 10_000)).toEqual({
      quantity: 2,
      grossAmountPaise: 20_000,
    });
    expect(calculateBuyQuote(9_999, 10_000)).toEqual({
      quantity: 0,
      grossAmountPaise: 0,
    });
  });

  it('calculates a weighted average from exact total cost', () => {
    const firstBuy = calculatePositionAfterBuy(null, 2, 20_000);
    const secondBuy = calculatePositionAfterBuy(firstBuy, 3, 42_000);

    expect(secondBuy).toEqual({
      quantity: 5,
      averageBuyPricePaise: 12_400,
      totalCostPaise: 62_000,
      realizedPnlPaise: 0,
    });
  });

  it('allocates cost basis and accumulates realized profit and loss across sells', () => {
    const position = {
      quantity: 5,
      averageBuyPricePaise: 12_400,
      totalCostPaise: 62_000,
      realizedPnlPaise: 0,
    };
    const partialSell = calculatePositionAfterSell(position, 2, 30_000);

    expect(partialSell).toEqual({
      quantity: 3,
      averageBuyPricePaise: 12_400,
      totalCostPaise: 37_200,
      realizedPnlPaise: 5_200,
      realizedPnlDeltaPaise: 5_200,
    });
    expect(calculatePositionAfterSell(partialSell!, 3, 33_000)).toEqual({
      quantity: 0,
      averageBuyPricePaise: 0,
      totalCostPaise: 0,
      realizedPnlPaise: 1_000,
      realizedPnlDeltaPaise: -4_200,
    });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_DATABASE_INT + 1])(
    'rejects invalid database integer input %s',
    (invalid) => {
      expect(calculateBuyQuote(invalid, 10_000)).toBeNull();
      expect(calculatePositionAfterBuy(null, invalid, 10_000)).toBeNull();
      expect(
        calculatePositionAfterSell(
          {
            quantity: 2,
            averageBuyPricePaise: 10_000,
            totalCostPaise: 20_000,
            realizedPnlPaise: 0,
          },
          invalid,
          10_000,
        ),
      ).toBeNull();
    },
  );
});
