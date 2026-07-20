import { CachedMarketDataProvider } from './cached-provider';
import { DatabaseMarketDataProvider } from './database-provider';
import { LiveMarketDataProvider } from './live-provider';
import { MockMarketDataProvider } from './mock-provider';
import type { MarketDataProvider } from './types';

export function createMarketDataProvider(
  providerName = process.env.MARKET_DATA_PROVIDER ?? 'live',
): MarketDataProvider {
  switch (providerName.trim().toLowerCase()) {
    // Synthetic live prices that fluctuate over real market hours (default). The
    // underlying real-candle/metadata reads go through a TTL cache; the intraday
    // walk on top stays live because it recomputes from the clock each call.
    case 'live':
      return new LiveMarketDataProvider(
        undefined,
        undefined,
        new CachedMarketDataProvider(new DatabaseMarketDataProvider()),
      );
    // Raw newest-candle prices, with no live movement.
    case 'database':
      return new DatabaseMarketDataProvider();
    case 'mock':
      return new MockMarketDataProvider();
    default:
      throw new Error(`Unsupported market-data provider: ${providerName}`);
  }
}

export const marketDataProvider = createMarketDataProvider();

export { CachedMarketDataProvider } from './cached-provider';
export { DatabaseMarketDataProvider } from './database-provider';
export { LiveMarketDataProvider } from './live-provider';
export { importPriceCandlesCsv, parseCsv } from './csv-importer';
export type {
  ImportPriceCandlesOptions,
  PriceCandleImportError,
  PriceCandleImportSummary,
} from './csv-importer';
export {
  importNseBhavcopy,
  parseBhavcopy,
  toCanonicalCsv,
  type CanonicalCandleRow,
} from './bhavcopy-importer';
export { MockMarketDataProvider } from './mock-provider';
export type { MockMarketDataProviderOptions } from './mock-provider';
export { SimulationMarketDataProvider } from './simulation-provider';
export { CandleInterval, MarketDataUnavailableError } from './types';
export type {
  InstrumentExchange,
  InstrumentSearchResult,
  MarketDataProvider,
  MarketPrice,
  PriceCandle,
} from './types';
