import { describe, expect, it } from 'vitest';
import {
  CandleInterval,
  DatabaseMarketDataProvider,
  MarketDataUnavailableError,
  MockMarketDataProvider,
  createMarketDataProvider,
  type InstrumentSearchResult,
  type PriceCandle,
} from '@/server/market-data';

const instruments: InstrumentSearchResult[] = [
  {
    id: 'tcs',
    exchange: 'NSE',
    symbol: 'TCS',
    companyName: 'Tata Consultancy Services Limited',
    sector: 'Information Technology',
    industry: 'IT Services',
    currency: 'INR',
  },
  {
    id: 'reliance',
    exchange: 'NSE',
    symbol: 'RELIANCE',
    companyName: 'Reliance Industries Limited',
    sector: 'Diversified',
    industry: 'Diversified',
    currency: 'INR',
  },
  {
    id: 'no-prices',
    exchange: 'BSE',
    symbol: 'EMPTY',
    companyName: 'No Price Limited',
    sector: 'Testing',
    industry: 'Testing',
    currency: 'INR',
  },
];

const candles: PriceCandle[] = [
  candle('newest', '2026-01-05T10:00:00.000Z', 10_500),
  candle('newest-minute', '2026-01-05T10:00:00.000Z', 10_600, CandleInterval.ONE_MINUTE),
  candle('oldest', '2026-01-02T10:00:00.000Z', 10_000),
  candle('middle', '2026-01-03T10:00:00.000Z', 10_250),
  candle('minute', '2026-01-03T10:01:00.000Z', 10_275, CandleInterval.ONE_MINUTE),
];

describe('MockMarketDataProvider', () => {
  const provider = new MockMarketDataProvider({ instruments, candles });

  it('searches case-insensitively by symbol and company name', async () => {
    await expect(provider.searchInstruments('tcs')).resolves.toMatchObject([{ id: 'tcs' }]);
    await expect(provider.searchInstruments('reliance ind')).resolves.toMatchObject([
      { id: 'reliance' },
    ]);
    await expect(provider.searchInstruments('   ')).resolves.toEqual([]);
    await expect(provider.searchInstruments('unknown')).resolves.toEqual([]);
  });

  it('returns the latest close and an at-or-before historical price', async () => {
    await expect(provider.getLatestPrice('tcs')).resolves.toMatchObject({
      instrumentId: 'tcs',
      interval: CandleInterval.ONE_MINUTE,
      pricePaise: 10_600,
      openPaise: 10_500,
      timestamp: new Date('2026-01-05T10:00:00.000Z'),
    });

    await expect(
      provider.getPriceAt('tcs', new Date('2026-01-04T00:00:00.000Z')),
    ).resolves.toMatchObject({
      pricePaise: 10_275,
      timestamp: new Date('2026-01-03T10:01:00.000Z'),
    });
    await expect(
      provider.getPriceAt('tcs', new Date('2026-01-01T00:00:00.000Z')),
    ).resolves.toBeNull();
  });

  it('filters candles by interval and inclusive range in ascending timestamp order', async () => {
    const result = await provider.getCandles(
      'tcs',
      new Date('2026-01-02T10:00:00.000Z'),
      new Date('2026-01-03T10:00:00.000Z'),
      CandleInterval.ONE_DAY,
    );

    expect(result.map(({ id }) => id)).toEqual(['oldest', 'middle']);
  });

  it('returns instruments and reports unavailable latest prices', async () => {
    await expect(provider.getInstrument('tcs')).resolves.toMatchObject({ symbol: 'TCS' });
    await expect(provider.getInstrument('unknown')).resolves.toBeNull();
    await expect(provider.getLatestPrice('no-prices')).rejects.toBeInstanceOf(
      MarketDataUnavailableError,
    );
  });
});

describe('configured provider selection', () => {
  it('selects either implementation and rejects unsupported configuration', () => {
    expect(createMarketDataProvider('mock')).toBeInstanceOf(MockMarketDataProvider);
    expect(createMarketDataProvider('database')).toBeInstanceOf(DatabaseMarketDataProvider);
    expect(() => createMarketDataProvider('unsupported')).toThrow(
      /Unsupported market-data provider/,
    );
  });
});

function candle(
  id: string,
  timestamp: string,
  closePaise: number,
  interval: CandleInterval = CandleInterval.ONE_DAY,
): PriceCandle {
  return {
    id,
    instrumentId: 'tcs',
    interval,
    timestamp: new Date(timestamp),
    openPaise: closePaise - 100,
    highPaise: closePaise + 100,
    lowPaise: closePaise - 200,
    closePaise,
    volume: 1_000,
    source: 'mock-test',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}
