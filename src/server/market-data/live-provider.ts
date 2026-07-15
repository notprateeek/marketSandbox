import type { PrismaClient } from '@/generated/prisma/client';
import { marketSecondsBetween, SESSION_SECONDS } from '@/lib/finance/market-hours';
import { livePricePaise, seedFromId } from '@/lib/finance/price-walk';
import { prisma } from '@/lib/prisma';
import { DatabaseMarketDataProvider } from './database-provider';
import {
  type CandleInterval,
  type InstrumentSearchResult,
  type MarketDataProvider,
  type MarketPrice,
  type PriceCandle,
} from './types';

/**
 * The default live feed. Instrument metadata, historical candles and daily
 * charts come straight from the database; the CURRENT price is synthesised from
 * the newest real candle via a deterministic random walk advanced by elapsed
 * NSE-session time (see price-walk + market-hours). So prices fluctuate up and
 * down through the trading day and freeze overnight and on weekends — with no
 * ticker process and no writes. Deterministic per instant, so reloads and the
 * client auto-refresh never flicker.
 */
export class LiveMarketDataProvider implements MarketDataProvider {
  private readonly delegate: DatabaseMarketDataProvider;

  constructor(
    database: PrismaClient = prisma,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.delegate = new DatabaseMarketDataProvider(database);
  }

  searchInstruments(query: string): Promise<InstrumentSearchResult[]> {
    return this.delegate.searchInstruments(query);
  }

  listInstruments(limit?: number): Promise<InstrumentSearchResult[]> {
    return this.delegate.listInstruments(limit);
  }

  getInstrument(instrumentId: string): Promise<InstrumentSearchResult | null> {
    return this.delegate.getInstrument(instrumentId);
  }

  getCandles(
    instrumentId: string,
    from: Date,
    to: Date,
    interval: CandleInterval,
  ): Promise<PriceCandle[]> {
    return this.delegate.getCandles(instrumentId, from, to, interval);
  }

  async getLatestPrice(instrumentId: string): Promise<MarketPrice> {
    const base = await this.delegate.getLatestPrice(instrumentId);
    return this.synthesize(base, this.now());
  }

  async getPriceAt(instrumentId: string, timestamp: Date): Promise<MarketPrice | null> {
    // Past timestamps read real history; "now or later" gets the live price.
    let base: MarketPrice;
    try {
      base = await this.delegate.getLatestPrice(instrumentId);
    } catch {
      return this.delegate.getPriceAt(instrumentId, timestamp);
    }
    if (timestamp.getTime() <= base.timestamp.getTime()) {
      return this.delegate.getPriceAt(instrumentId, timestamp);
    }
    return this.synthesize(base, timestamp);
  }

  private synthesize(base: MarketPrice, at: Date): MarketPrice {
    const seed = seedFromId(base.instrumentId);
    const delta = marketSecondsBetween(base.timestamp, at);
    const pricePaise = livePricePaise(seed, base.pricePaise, delta);
    const session = sampleSession(seed, base.pricePaise, delta);

    return {
      instrumentId: base.instrumentId,
      interval: base.interval,
      pricePaise,
      openPaise: session.open,
      highPaise: Math.max(pricePaise, session.high),
      lowPaise: Math.min(pricePaise, session.low),
      volume: base.volume,
      timestamp: at,
      source: 'live-sim',
    };
  }
}

/** Cheap, coherent session Open/High/Low by sampling the walk across the day. */
function sampleSession(
  seed: number,
  baseClosePaise: number,
  delta: number,
): { open: number; high: number; low: number } {
  const span = Math.min(delta, SESSION_SECONDS);
  const start = delta - span; // ≈ this session's open
  const open = livePricePaise(seed, baseClosePaise, start);
  let high = open;
  let low = open;
  const steps = 24;
  for (let k = 1; k <= steps; k += 1) {
    const point = livePricePaise(seed, baseClosePaise, start + (span * k) / steps);
    if (point > high) high = point;
    if (point < low) low = point;
  }
  return { open, high, low };
}
