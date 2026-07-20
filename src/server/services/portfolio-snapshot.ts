import { CandleInterval, type PrismaClient } from '@/generated/prisma/client';
import { istDayStart } from '@/lib/finance/datetime';
import { prisma } from '@/lib/prisma';
import { DatabaseMarketDataProvider, type MarketDataProvider } from '@/server/market-data';
import { loadPortfolioForAccount } from '@/server/services/portfolio';

/** A snapshot belongs to a virtual account, optionally tagged to a simulation. */
export interface SnapshotTarget {
  virtualAccountId: string;
  simulationSessionId: string | null;
}

/**
 * Records the portfolio state at `timestamp`. Idempotent: keyed on
 * (virtualAccountId, timestamp) via upsert, so re-capturing the same instant
 * updates the single row rather than duplicating it.
 */
export async function captureSnapshot(
  target: SnapshotTarget,
  timestamp: Date,
  database: PrismaClient = prisma,
  prices: MarketDataProvider = new DatabaseMarketDataProvider(database),
) {
  const portfolio = await loadPortfolioForAccount(
    target.virtualAccountId,
    { valuationTimestamp: timestamp },
    database,
    prices,
  );
  if (!portfolio) return null;

  const values = {
    simulationSessionId: target.simulationSessionId,
    cashPaise: portfolio.availableCashPaise,
    holdingsValuePaise: portfolio.holdingsValuePaise,
    portfolioValuePaise: portfolio.portfolioValuePaise,
    realizedPnlPaise: portfolio.realizedPnlPaise,
    unrealizedPnlPaise: portfolio.unrealizedPnlPaise,
    totalPnlPaise: portfolio.totalPnlPaise,
  };

  return database.portfolioSnapshot.upsert({
    where: {
      virtualAccountId_timestamp: { virtualAccountId: target.virtualAccountId, timestamp },
    },
    create: { virtualAccountId: target.virtualAccountId, timestamp, ...values },
    update: values,
  });
}

/**
 * Records at most one snapshot per IST day for a live (non-simulation) account,
 * captured on the first authenticated page-load of the day. No cron: the visit
 * itself drives it. A no-op once today already has a snapshot, so it's safe to
 * call on every page render. Fills the sparse-drawdown gap for personal
 * portfolios, which otherwise never snapshot.
 */
export async function captureDailySnapshotIfNeeded(
  virtualAccountId: string,
  database: PrismaClient = prisma,
  prices: MarketDataProvider = new DatabaseMarketDataProvider(database),
  now: Date = new Date(),
) {
  const existing = await database.portfolioSnapshot.findFirst({
    where: { virtualAccountId, timestamp: { gte: istDayStart(now) } },
    select: { id: true },
  });
  if (existing) return null;
  return captureSnapshot({ virtualAccountId, simulationSessionId: null }, now, database, prices);
}

/**
 * Captures an end-of-day snapshot at every trading-day close (each ONE_DAY
 * candle) in the half-open interval (from, to], plus one at `to` itself. Used
 * when the clock advances so daily returns and drawdown have a point per day.
 */
export async function captureSnapshotsThrough(
  target: SnapshotTarget,
  from: Date,
  to: Date,
  database: PrismaClient = prisma,
  prices: MarketDataProvider = new DatabaseMarketDataProvider(database),
) {
  const dailyCloses = await database.priceCandle.findMany({
    where: { interval: CandleInterval.ONE_DAY, timestamp: { gt: from, lte: to } },
    distinct: ['timestamp'],
    select: { timestamp: true },
    orderBy: { timestamp: 'asc' },
  });

  for (const { timestamp } of dailyCloses) {
    await captureSnapshot(target, timestamp, database, prices);
  }
  await captureSnapshot(target, to, database, prices);
}
