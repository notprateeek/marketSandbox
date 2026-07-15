import type { PrismaClient } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { DatabaseMarketDataProvider } from './database-provider';
import {
  MarketDataUnavailableError,
  type CandleInterval,
  type InstrumentSearchResult,
  type MarketDataProvider,
  type MarketPrice,
  type PriceCandle,
} from './types';

/**
 * Market data bound to a single simulation instant. It enforces the two rules
 * that keep a replay honest:
 *
 * 1. **Execution (`getLatestPrice`)** — the order engine's only pricing call.
 *    An order submitted at simulation time `t` fills at the OPEN of the
 *    earliest candle strictly after `t` (the next price you could actually
 *    trade at). If no later candle exists the order cannot fill, so this
 *    throws and the engine rejects it. A candle at or before `t` is never used
 *    to fill — no look-ahead, and deterministic for a given `t` + dataset.
 *
 * 2. **Reads (`getPriceAt`, `getCandles`)** — clamped to `t`, so valuations and
 *    charts can never surface a price from the future.
 */
export class SimulationMarketDataProvider implements MarketDataProvider {
  private readonly delegate: DatabaseMarketDataProvider;

  constructor(
    private readonly simTimestamp: Date,
    private readonly database: PrismaClient = prisma,
  ) {
    this.delegate = new DatabaseMarketDataProvider(database);
  }

  async getLatestPrice(instrumentId: string): Promise<MarketPrice> {
    const candle = await this.database.priceCandle.findFirst({
      where: { instrumentId, timestamp: { gt: this.simTimestamp } },
      orderBy: [{ timestamp: 'asc' }, { interval: 'desc' }],
    });

    if (!candle) throw new MarketDataUnavailableError(instrumentId);
    return toFillPrice(candle);
  }

  getInstrument(instrumentId: string): Promise<InstrumentSearchResult | null> {
    return this.delegate.getInstrument(instrumentId);
  }

  searchInstruments(query: string): Promise<InstrumentSearchResult[]> {
    return this.delegate.searchInstruments(query);
  }

  listInstruments(limit?: number): Promise<InstrumentSearchResult[]> {
    return this.delegate.listInstruments(limit);
  }

  getPriceAt(instrumentId: string, timestamp: Date): Promise<MarketPrice | null> {
    return this.delegate.getPriceAt(instrumentId, this.cap(timestamp));
  }

  getCandles(
    instrumentId: string,
    from: Date,
    to: Date,
    interval: CandleInterval,
  ): Promise<PriceCandle[]> {
    return this.delegate.getCandles(instrumentId, from, this.cap(to), interval);
  }

  private cap(timestamp: Date): Date {
    return timestamp.getTime() < this.simTimestamp.getTime() ? timestamp : this.simTimestamp;
  }
}

/** The fill price is the candle's open, timestamped at the candle. */
function toFillPrice(candle: {
  instrumentId: string;
  interval: CandleInterval;
  openPaise: number;
  highPaise: number;
  lowPaise: number;
  volume: number;
  timestamp: Date;
  source: string;
}): MarketPrice {
  return {
    instrumentId: candle.instrumentId,
    interval: candle.interval,
    pricePaise: candle.openPaise,
    openPaise: candle.openPaise,
    highPaise: candle.highPaise,
    lowPaise: candle.lowPaise,
    volume: candle.volume,
    timestamp: candle.timestamp,
    source: candle.source,
  };
}
