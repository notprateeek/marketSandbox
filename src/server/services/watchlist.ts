import { CandleInterval, type PrismaClient } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import {
  marketDataProvider,
  MarketDataUnavailableError,
  type MarketDataProvider,
} from '@/server/market-data';

export class WatchlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WatchlistError';
  }
}

const FAR_FUTURE = new Date('2100-01-01T00:00:00.000Z');

export interface WatchlistItemView {
  itemId: string;
  instrumentId: string;
  symbol: string;
  companyName: string;
  position: number;
  pricePaise: number | null;
  timestamp: Date | null;
  changePercent: number | null;
}

export function listWatchlists(userId: string, database: PrismaClient = prisma) {
  return database.watchlist.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, _count: { select: { items: true } } },
  });
}

export async function createWatchlist(
  params: { userId: string; name: string },
  database: PrismaClient = prisma,
) {
  return database.watchlist.create({
    data: { userId: params.userId, name: params.name.trim() || 'Watchlist' },
  });
}

export async function deleteWatchlist(
  params: { userId: string; watchlistId: string },
  database: PrismaClient = prisma,
) {
  await ownedWatchlist(params.watchlistId, params.userId, database);
  await database.watchlist.delete({ where: { id: params.watchlistId } });
}

export async function addWatchlistItem(
  params: { userId: string; watchlistId: string; instrumentId: string },
  database: PrismaClient = prisma,
) {
  await ownedWatchlist(params.watchlistId, params.userId, database);

  const last = await database.watchlistItem.findFirst({
    where: { watchlistId: params.watchlistId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  try {
    return await database.watchlistItem.create({
      data: {
        watchlistId: params.watchlistId,
        instrumentId: params.instrumentId,
        position: (last?.position ?? 0) + 1,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new WatchlistError('That instrument is already on this watchlist.');
    }
    throw error;
  }
}

export async function removeWatchlistItem(
  params: { userId: string; itemId: string },
  database: PrismaClient = prisma,
) {
  const item = await ownedItem(params.itemId, params.userId, database);
  await database.watchlistItem.delete({ where: { id: item.id } });
}

/** Swaps an item with its neighbour in the given direction to reorder the list. */
export async function moveWatchlistItem(
  params: { userId: string; itemId: string; direction: 'UP' | 'DOWN' },
  database: PrismaClient = prisma,
) {
  const item = await ownedItem(params.itemId, params.userId, database);
  const neighbour = await database.watchlistItem.findFirst({
    where: {
      watchlistId: item.watchlistId,
      position: params.direction === 'UP' ? { lt: item.position } : { gt: item.position },
    },
    orderBy: { position: params.direction === 'UP' ? 'desc' : 'asc' },
  });
  if (!neighbour) return; // already at the edge

  await database.$transaction([
    database.watchlistItem.update({
      where: { id: item.id },
      data: { position: neighbour.position },
    }),
    database.watchlistItem.update({
      where: { id: neighbour.id },
      data: { position: item.position },
    }),
  ]);
}

export async function loadWatchlistItems(
  watchlistId: string,
  userId: string,
  database: PrismaClient = prisma,
  prices: MarketDataProvider = marketDataProvider,
): Promise<WatchlistItemView[]> {
  await ownedWatchlist(watchlistId, userId, database);

  const items = await database.watchlistItem.findMany({
    where: { watchlistId },
    orderBy: { position: 'asc' },
    include: { instrument: { select: { symbol: true, companyName: true } } },
  });

  return Promise.all(
    items.map(async (item) => {
      const info = await priceInfo(item.instrumentId, prices);
      return {
        itemId: item.id,
        instrumentId: item.instrumentId,
        symbol: item.instrument.symbol,
        companyName: item.instrument.companyName,
        position: item.position,
        pricePaise: info?.pricePaise ?? null,
        timestamp: info?.timestamp ?? null,
        changePercent: info?.changePercent ?? null,
      };
    }),
  );
}

/** Latest daily close and the day-over-day % move for an instrument. */
async function priceInfo(instrumentId: string, prices: MarketDataProvider) {
  const daily = await prices.getCandles(
    instrumentId,
    new Date(0),
    FAR_FUTURE,
    CandleInterval.ONE_DAY,
  );
  if (daily.length > 0) {
    const last = daily[daily.length - 1];
    const previous = daily[daily.length - 2];
    const changePercent =
      previous && previous.closePaise !== 0
        ? ((last.closePaise - previous.closePaise) / previous.closePaise) * 100
        : null;
    return { pricePaise: last.closePaise, timestamp: last.timestamp, changePercent };
  }

  // Instruments with only intraday data still get a price, without a daily change.
  try {
    const latest = await prices.getLatestPrice(instrumentId);
    return { pricePaise: latest.pricePaise, timestamp: latest.timestamp, changePercent: null };
  } catch (error) {
    if (error instanceof MarketDataUnavailableError) return null;
    throw error;
  }
}

async function ownedWatchlist(watchlistId: string, userId: string, database: PrismaClient) {
  const watchlist = await database.watchlist.findFirst({
    where: { id: watchlistId, userId },
    select: { id: true },
  });
  if (!watchlist) throw new WatchlistError('Watchlist not found.');
  return watchlist;
}

async function ownedItem(itemId: string, userId: string, database: PrismaClient) {
  const item = await database.watchlistItem.findFirst({
    where: { id: itemId, watchlist: { userId } },
    select: { id: true, watchlistId: true, position: true },
  });
  if (!item) throw new WatchlistError('Watchlist item not found.');
  return item;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
