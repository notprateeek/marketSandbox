import { describe, expect, it } from 'vitest';

import { CachedMarketDataProvider } from '@/server/market-data';
import type { MarketDataProvider, MarketPrice } from '@/server/market-data';

function priceFor(instrumentId: string): MarketPrice {
  return {
    instrumentId,
    interval: 'ONE_DAY',
    pricePaise: 100_000n,
    openPaise: 100_000n,
    highPaise: 100_000n,
    lowPaise: 100_000n,
    volume: 1,
    timestamp: new Date('2026-07-17T15:30:00+05:30'),
    source: 'test',
  };
}

// A delegate that counts calls and can fail the first getLatestPrice.
function countingDelegate(failFirst = false) {
  const calls = { latest: 0, candles: 0 };
  let failed = !failFirst;
  const delegate: MarketDataProvider = {
    searchInstruments: async () => [],
    listInstruments: async () => [],
    getInstrument: async () => null,
    getLatestPrice: async (id) => {
      calls.latest += 1;
      if (!failed) {
        failed = true;
        throw new Error('no data yet');
      }
      return priceFor(id);
    },
    getPriceAt: async () => null,
    getCandles: async () => {
      calls.candles += 1;
      return [];
    },
  };
  return { delegate, calls };
}

describe('CachedMarketDataProvider — TTL memoisation', () => {
  it('serves within the TTL and refetches after it expires', async () => {
    let now = 0;
    const { delegate, calls } = countingDelegate();
    const cache = new CachedMarketDataProvider(delegate, 30_000, () => now);

    await cache.getLatestPrice('a');
    now = 10_000;
    await cache.getLatestPrice('a');
    expect(calls.latest).toBe(1); // second read served from cache

    now = 40_000; // past the 30s TTL
    await cache.getLatestPrice('a');
    expect(calls.latest).toBe(2);
  });

  it('keys the cache per instrument', async () => {
    const { delegate, calls } = countingDelegate();
    const cache = new CachedMarketDataProvider(delegate, 30_000, () => 0);
    await cache.getLatestPrice('a');
    await cache.getLatestPrice('b');
    expect(calls.latest).toBe(2);
  });

  it('does not cache rejections', async () => {
    const { delegate, calls } = countingDelegate(true);
    const cache = new CachedMarketDataProvider(delegate, 30_000, () => 0);
    await expect(cache.getLatestPrice('a')).rejects.toThrow('no data yet');
    await cache.getLatestPrice('a'); // retries the delegate, then caches success
    expect(calls.latest).toBe(2);
  });

  it('passes range reads straight through', async () => {
    const { delegate, calls } = countingDelegate();
    const cache = new CachedMarketDataProvider(delegate, 30_000, () => 0);
    await cache.getCandles('a', new Date(0), new Date(1), 'ONE_DAY');
    await cache.getCandles('a', new Date(0), new Date(1), 'ONE_DAY');
    expect(calls.candles).toBe(2);
  });
});
