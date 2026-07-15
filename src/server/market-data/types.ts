export const CandleInterval = {
  ONE_MINUTE: 'ONE_MINUTE',
  ONE_DAY: 'ONE_DAY',
} as const;

export type CandleInterval = (typeof CandleInterval)[keyof typeof CandleInterval];
export type InstrumentExchange = 'NSE' | 'BSE';

export interface PriceCandle {
  id: string;
  instrumentId: string;
  interval: CandleInterval;
  timestamp: Date;
  openPaise: number;
  highPaise: number;
  lowPaise: number;
  closePaise: number;
  volume: number;
  source: string;
  createdAt: Date;
}

export interface InstrumentSearchResult {
  id: string;
  exchange: InstrumentExchange;
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
  currency: string;
}

export interface MarketPrice {
  instrumentId: string;
  interval: CandleInterval;
  pricePaise: number;
  openPaise: number;
  highPaise: number;
  lowPaise: number;
  volume: number;
  timestamp: Date;
  source: string;
}

export interface MarketDataProvider {
  searchInstruments(query: string): Promise<InstrumentSearchResult[]>;
  listInstruments(limit?: number): Promise<InstrumentSearchResult[]>;
  getInstrument(instrumentId: string): Promise<InstrumentSearchResult | null>;
  getLatestPrice(instrumentId: string): Promise<MarketPrice>;
  getPriceAt(instrumentId: string, timestamp: Date): Promise<MarketPrice | null>;
  getCandles(
    instrumentId: string,
    from: Date,
    to: Date,
    interval: CandleInterval,
  ): Promise<PriceCandle[]>;
}

export class MarketDataUnavailableError extends Error {
  constructor(public readonly instrumentId: string) {
    super(`No market data is available for instrument ${instrumentId}`);
    this.name = 'MarketDataUnavailableError';
  }
}
