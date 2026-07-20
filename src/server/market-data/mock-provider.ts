import {
  CandleInterval,
  MarketDataUnavailableError,
  type InstrumentSearchResult,
  type MarketDataProvider,
  type MarketPrice,
  type PriceCandle,
} from './types';

export interface MockMarketDataProviderOptions {
  instruments?: InstrumentSearchResult[];
  candles?: PriceCandle[];
}

export class MockMarketDataProvider implements MarketDataProvider {
  private readonly instruments: InstrumentSearchResult[];
  private readonly candles: PriceCandle[];

  constructor(options: MockMarketDataProviderOptions = {}) {
    this.instruments = options.instruments ?? DEFAULT_INSTRUMENTS;
    this.candles = options.candles ?? DEFAULT_CANDLES;
  }

  async searchInstruments(query: string): Promise<InstrumentSearchResult[]> {
    const value = query.trim().toLowerCase();
    if (!value) return [];

    return this.instruments.filter(
      (instrument) =>
        instrument.symbol.toLowerCase().includes(value) ||
        instrument.companyName.toLowerCase().includes(value),
    );
  }

  async listInstruments(limit = 100): Promise<InstrumentSearchResult[]> {
    return this.instruments.slice(0, limit);
  }

  async getInstrument(instrumentId: string): Promise<InstrumentSearchResult | null> {
    return this.instruments.find((instrument) => instrument.id === instrumentId) ?? null;
  }

  async getLatestPrice(instrumentId: string): Promise<MarketPrice> {
    const candle = latestCandle(
      this.candles.filter((candidate) => candidate.instrumentId === instrumentId),
    );

    if (!candle) throw new MarketDataUnavailableError(instrumentId);
    return toMarketPrice(candle);
  }

  async getPriceAt(instrumentId: string, timestamp: Date): Promise<MarketPrice | null> {
    const candle = latestCandle(
      this.candles.filter(
        (candidate) =>
          candidate.instrumentId === instrumentId &&
          candidate.timestamp.getTime() <= timestamp.getTime(),
      ),
    );

    return candle ? toMarketPrice(candle) : null;
  }

  async getCandles(
    instrumentId: string,
    from: Date,
    to: Date,
    interval: PriceCandle['interval'],
  ): Promise<PriceCandle[]> {
    if (from > to) return [];

    return this.candles
      .filter(
        (candle) =>
          candle.instrumentId === instrumentId &&
          candle.interval === interval &&
          candle.timestamp >= from &&
          candle.timestamp <= to,
      )
      .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  }
}

function latestCandle(candles: PriceCandle[]): PriceCandle | undefined {
  return candles.reduce<PriceCandle | undefined>(
    (latest, candle) =>
      !latest ||
      candle.timestamp.getTime() > latest.timestamp.getTime() ||
      (candle.timestamp.getTime() === latest.timestamp.getTime() &&
        candle.interval === CandleInterval.ONE_MINUTE &&
        latest.interval !== CandleInterval.ONE_MINUTE)
        ? candle
        : latest,
    undefined,
  );
}

function toMarketPrice(candle: PriceCandle): MarketPrice {
  return {
    instrumentId: candle.instrumentId,
    interval: candle.interval,
    pricePaise: candle.closePaise,
    openPaise: candle.openPaise,
    highPaise: candle.highPaise,
    lowPaise: candle.lowPaise,
    volume: candle.volume,
    timestamp: candle.timestamp,
    source: candle.source,
  };
}

const DEFAULT_INSTRUMENTS: InstrumentSearchResult[] = [
  {
    id: 'mock-tatamotors',
    exchange: 'NSE',
    symbol: 'TATAMOTORS',
    companyName: 'Tata Motors Limited',
    sector: 'Automobile',
    industry: 'Passenger Cars & Utility Vehicles',
    currency: 'INR',
  },
  {
    id: 'mock-tcs',
    exchange: 'NSE',
    symbol: 'TCS',
    companyName: 'Tata Consultancy Services Limited',
    sector: 'Information Technology',
    industry: 'IT Services',
    currency: 'INR',
  },
];

const MOCK_CREATED_AT = new Date('2026-06-01T00:00:00.000Z');

const DEFAULT_CANDLES: PriceCandle[] = [
  mockCandle('tatamotors-day-1', 'mock-tatamotors', '2026-05-28T10:00:00.000Z', 72_000, 73_200),
  mockCandle('tatamotors-day-2', 'mock-tatamotors', '2026-05-29T10:00:00.000Z', 73_200, 72_650),
  mockCandle('tatamotors-day-3', 'mock-tatamotors', '2026-06-01T10:00:00.000Z', 72_650, 74_100),
  mockCandle('tcs-day-1', 'mock-tcs', '2026-05-29T10:00:00.000Z', 350_000, 352_300),
  mockCandle('tcs-day-2', 'mock-tcs', '2026-06-01T10:00:00.000Z', 352_300, 351_400),
];

function mockCandle(
  id: string,
  instrumentId: string,
  timestamp: string,
  openPaise: number,
  closePaise: number,
): PriceCandle {
  return {
    id,
    instrumentId,
    interval: CandleInterval.ONE_DAY,
    timestamp: new Date(timestamp),
    openPaise: BigInt(openPaise),
    highPaise: BigInt(Math.max(openPaise, closePaise) + 400),
    lowPaise: BigInt(Math.max(1, Math.min(openPaise, closePaise) - 350)),
    closePaise: BigInt(closePaise),
    volume: 1_000_000,
    source: 'mock',
    createdAt: MOCK_CREATED_AT,
  };
}
