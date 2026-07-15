import type { PrismaClient } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import {
  MarketDataUnavailableError,
  type CandleInterval,
  type InstrumentSearchResult,
  type MarketDataProvider,
  type MarketPrice,
  type PriceCandle,
} from './types';

export class DatabaseMarketDataProvider implements MarketDataProvider {
  constructor(private readonly database: PrismaClient = prisma) {}

  async searchInstruments(query: string): Promise<InstrumentSearchResult[]> {
    const value = query.trim();
    if (!value) return [];

    const instruments = await this.database.instrument.findMany({
      where: {
        isActive: true,
        OR: [{ symbol: { contains: value.toUpperCase() } }, { companyName: { contains: value } }],
      },
      orderBy: { symbol: 'asc' },
      take: 50,
    });

    return instruments.map(toInstrumentSearchResult);
  }

  async listInstruments(limit = 100): Promise<InstrumentSearchResult[]> {
    const instruments = await this.database.instrument.findMany({
      where: { isActive: true },
      orderBy: { symbol: 'asc' },
      take: limit,
    });

    return instruments.map(toInstrumentSearchResult);
  }

  async getInstrument(instrumentId: string): Promise<InstrumentSearchResult | null> {
    const instrument = await this.database.instrument.findFirst({
      where: { id: instrumentId, isActive: true },
    });

    return instrument ? toInstrumentSearchResult(instrument) : null;
  }

  async getLatestPrice(instrumentId: string): Promise<MarketPrice> {
    const candle = await this.database.priceCandle.findFirst({
      where: { instrumentId },
      orderBy: [{ timestamp: 'desc' }, { interval: 'desc' }],
    });

    if (!candle) throw new MarketDataUnavailableError(instrumentId);
    return toMarketPrice(candle);
  }

  async getPriceAt(instrumentId: string, timestamp: Date): Promise<MarketPrice | null> {
    const candle = await this.database.priceCandle.findFirst({
      where: { instrumentId, timestamp: { lte: timestamp } },
      orderBy: [{ timestamp: 'desc' }, { interval: 'desc' }],
    });

    return candle ? toMarketPrice(candle) : null;
  }

  async getCandles(
    instrumentId: string,
    from: Date,
    to: Date,
    interval: CandleInterval,
  ): Promise<PriceCandle[]> {
    if (from > to) return [];

    return this.database.priceCandle.findMany({
      where: {
        instrumentId,
        interval,
        timestamp: { gte: from, lte: to },
      },
      orderBy: { timestamp: 'asc' },
    });
  }
}

function toInstrumentSearchResult(instrument: {
  id: string;
  exchange: 'NSE' | 'BSE';
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
  currency: string;
}): InstrumentSearchResult {
  return {
    id: instrument.id,
    exchange: instrument.exchange,
    symbol: instrument.symbol,
    companyName: instrument.companyName,
    sector: instrument.sector,
    industry: instrument.industry,
    currency: instrument.currency,
  };
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
