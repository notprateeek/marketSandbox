import type {
  CandleInterval,
  InstrumentSearchResult,
  MarketDataProvider,
  MarketPrice,
  PriceCandle,
} from './types';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-process TTL cache over another provider. Only memoises the reads that
 * change solely when new candles are imported (daily EOD): the newest price,
 * plus instrument metadata and listings. The live intraday walk sits ABOVE this
 * and recomputes from `now()` on every call, so movement stays live while the
 * underlying database reads are absorbed. Rejections (e.g. no data yet) are not
 * cached, so an instrument starts serving as soon as its first candle lands.
 *
 * ponytail: per-process memo — right for a single Next instance; front it with a
 * shared cache (Redis) only once it scales horizontally.
 */
export class CachedMarketDataProvider implements MarketDataProvider {
  private readonly store = new Map<string, Entry<unknown>>();

  constructor(
    private readonly delegate: MarketDataProvider,
    private readonly ttlMs = 30_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value as T;
    const value = await load();
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }

  searchInstruments(query: string): Promise<InstrumentSearchResult[]> {
    return this.cached(`search:${query.trim().toLowerCase()}`, () =>
      this.delegate.searchInstruments(query),
    );
  }

  listInstruments(limit?: number): Promise<InstrumentSearchResult[]> {
    return this.cached(`list:${limit ?? ''}`, () => this.delegate.listInstruments(limit));
  }

  getInstrument(instrumentId: string): Promise<InstrumentSearchResult | null> {
    return this.cached(`instrument:${instrumentId}`, () =>
      this.delegate.getInstrument(instrumentId),
    );
  }

  getLatestPrice(instrumentId: string): Promise<MarketPrice> {
    return this.cached(`latest:${instrumentId}`, () => this.delegate.getLatestPrice(instrumentId));
  }

  // Point/range historical reads are immutable but many-keyed — pass straight through.
  getPriceAt(instrumentId: string, timestamp: Date): Promise<MarketPrice | null> {
    return this.delegate.getPriceAt(instrumentId, timestamp);
  }

  getCandles(
    instrumentId: string,
    from: Date,
    to: Date,
    interval: CandleInterval,
  ): Promise<PriceCandle[]> {
    return this.delegate.getCandles(instrumentId, from, to, interval);
  }

  /** Drops all cached entries (e.g. immediately after an EOD import). */
  clear(): void {
    this.store.clear();
  }
}
