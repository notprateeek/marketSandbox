import { DatabaseMarketDataProvider } from './database-provider';
import { MockMarketDataProvider } from './mock-provider';
import type { MarketDataProvider } from './types';

export function createMarketDataProvider(
  providerName = process.env.MARKET_DATA_PROVIDER ?? 'database',
): MarketDataProvider {
  switch (providerName.trim().toLowerCase()) {
    case 'database':
      return new DatabaseMarketDataProvider();
    case 'mock':
      return new MockMarketDataProvider();
    default:
      throw new Error(`Unsupported market-data provider: ${providerName}`);
  }
}

export const marketDataProvider = createMarketDataProvider();

export { DatabaseMarketDataProvider } from './database-provider';
export { importPriceCandlesCsv } from './csv-importer';
export type {
  ImportPriceCandlesOptions,
  PriceCandleImportError,
  PriceCandleImportSummary,
} from './csv-importer';
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
