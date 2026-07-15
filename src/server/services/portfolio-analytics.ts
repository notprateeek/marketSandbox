import type { PrismaClient, SimulationSession } from '@/generated/prisma/client';
import {
  computeAnalytics,
  type HoldingSlice,
  type PortfolioAnalytics,
} from '@/lib/finance/analytics';
import { deriveInsights, type Insight } from '@/lib/finance/insights';
import { prisma } from '@/lib/prisma';
import { DatabaseMarketDataProvider } from '@/server/market-data';
import { loadPortfolioForAccount } from '@/server/services/portfolio';
import { captureSnapshot } from '@/server/services/portfolio-snapshot';

export interface AnalyticsView {
  session: SimulationSession;
  analytics: PortfolioAnalytics;
  insights: Insight[];
  range: { from: Date; to: Date };
}

/**
 * Loads analytics for a simulation. Generates an on-demand snapshot at the
 * current clock first (so the series is current), then computes everything from
 * the stored snapshots within the requested range and the current holdings.
 */
export async function loadAnalytics(
  sessionId: string,
  userId: string,
  options: { from?: Date; to?: Date } = {},
  database: PrismaClient = prisma,
): Promise<AnalyticsView | null> {
  const session = await database.simulationSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId) return null;

  const prices = new DatabaseMarketDataProvider(database);

  // On-demand snapshot so analytics always includes the present moment.
  await captureSnapshot(
    { virtualAccountId: session.virtualAccountId, simulationSessionId: session.id },
    session.currentTimestamp,
    database,
    prices,
  );

  const from = options.from ?? session.startTimestamp;
  const to = options.to ?? session.currentTimestamp;

  const [snapshots, portfolio] = await Promise.all([
    database.portfolioSnapshot.findMany({
      where: { virtualAccountId: session.virtualAccountId, timestamp: { gte: from, lte: to } },
      orderBy: { timestamp: 'asc' },
    }),
    loadPortfolioForAccount(
      session.virtualAccountId,
      { valuationTimestamp: session.currentTimestamp },
      database,
      prices,
    ),
  ]);

  const holdings = await withSectors(portfolio?.holdings ?? [], database);

  const analytics = computeAnalytics({
    startingBalancePaise: session.initialBalancePaise,
    cashPaise: portfolio?.availableCashPaise ?? session.initialBalancePaise,
    portfolioValuePaise: portfolio?.portfolioValuePaise ?? session.initialBalancePaise,
    snapshots: snapshots.map((snapshot) => ({
      timestamp: snapshot.timestamp,
      portfolioValuePaise: snapshot.portfolioValuePaise,
      totalPnlPaise: snapshot.totalPnlPaise,
      cashPaise: snapshot.cashPaise,
      holdingsValuePaise: snapshot.holdingsValuePaise,
    })),
    holdings,
  });

  return { session, analytics, insights: deriveInsights(analytics), range: { from, to } };
}

async function withSectors(
  holdings: {
    instrumentId: string;
    symbol: string;
    companyName: string;
    marketValuePaise: number | null;
    unrealizedPnlPaise: number | null;
    allocationPercent: number | null;
  }[],
  database: PrismaClient,
): Promise<HoldingSlice[]> {
  if (holdings.length === 0) return [];

  const instruments = await database.instrument.findMany({
    where: { id: { in: holdings.map((holding) => holding.instrumentId) } },
    select: { id: true, sector: true },
  });
  const sectorById = new Map(instruments.map((instrument) => [instrument.id, instrument.sector]));

  return holdings.map((holding) => ({
    symbol: holding.symbol,
    companyName: holding.companyName,
    sector: sectorById.get(holding.instrumentId) ?? 'Unknown',
    marketValuePaise: holding.marketValuePaise,
    unrealizedPnlPaise: holding.unrealizedPnlPaise,
    allocationPercent: holding.allocationPercent,
  }));
}
