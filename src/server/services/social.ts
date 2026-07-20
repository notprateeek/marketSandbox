import { CandleInterval, OrderSide, type PrismaClient } from '@/generated/prisma/client';
import { computeTradeStats } from '@/lib/finance/analytics';
import type { StreakBadge } from '@/lib/finance/prediction';
import { normalizeHandle } from '@/lib/social';
import { prisma } from '@/lib/prisma';
import { getActiveAccountId } from '@/server/services/accounts';
import { loadPortfolioForAccount } from '@/server/services/portfolio';
import { loadPredictionStreak } from '@/server/services/prediction';
import { createSimulation, getDataRange, submitSimulationOrder } from '@/server/services/simulation';

export class SocialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SocialError';
  }
}

export interface UpdateProfileInput {
  userId: string;
  handle: string;
  bio?: string | null;
  isPublic: boolean;
}

/**
 * Sets the user's public profile. A public profile needs a valid, unique handle;
 * privacy defaults off, so nothing is exposed until the user opts in.
 */
export async function updateProfile(input: UpdateProfileInput, database: PrismaClient = prisma) {
  const handle = normalizeHandle(input.handle);
  if (!handle) {
    throw new SocialError('Handle must be 3–20 characters: letters, numbers or underscores.');
  }

  const clash = await database.user.findFirst({
    where: { handle, id: { not: input.userId } },
    select: { id: true },
  });
  if (clash) throw new SocialError('That handle is already taken.');

  return database.user.update({
    where: { id: input.userId },
    data: { handle, bio: input.bio?.trim() || null, isPublic: input.isPublic },
  });
}

export interface ChallengeHistoryEntry {
  challengeName: string;
  rank: number;
  returnPercent: number;
  finalizedAt: Date;
}

export interface PublicProfile {
  userId: string;
  handle: string;
  name: string;
  bio: string | null;
  joinedAt: Date;
  returnPercent: number | null;
  winRatePercent: number | null;
  closedTrades: number;
  streakCurrent: number;
  streakLongest: number;
  badges: StreakBadge[];
  challengeHistory: ChallengeHistoryEntry[];
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  isSelf: boolean;
}

/**
 * A public trader profile keyed by handle. Everything shown is computed by the
 * Phase 1 analytics/streak code over the user's active portfolio. Returns null
 * when the handle doesn't exist or the profile is private and the viewer isn't
 * its owner.
 */
export async function loadPublicProfile(
  rawHandle: string,
  viewerId: string | null,
  database: PrismaClient = prisma,
): Promise<PublicProfile | null> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) return null;

  const user = await database.user.findUnique({ where: { handle } });
  if (!user) return null;

  const isSelf = user.id === viewerId;
  if (!user.isPublic && !isSelf) return null; // private — trust boundary

  const accountId = await getActiveAccountId(user.id, database);

  const [portfolio, executions, streakView, results, followerCount, followingCount, follow] =
    await Promise.all([
      accountId ? loadPortfolioForAccount(accountId, {}, database) : Promise.resolve(null),
      accountId
        ? database.tradeExecution.findMany({
            where: { virtualAccountId: accountId },
            orderBy: [{ simulationTimestamp: 'asc' }, { createdAt: 'asc' }],
            select: {
              instrumentId: true,
              side: true,
              quantity: true,
              pricePaise: true,
              simulationTimestamp: true,
              instrument: { select: { symbol: true } },
            },
          })
        : Promise.resolve([]),
      loadPredictionStreak(user.id, database),
      database.challengeResult.findMany({
        where: { participant: { userId: user.id } },
        orderBy: { finalizedAt: 'desc' },
        take: 10,
        include: { participant: { include: { challenge: { select: { name: true } } } } },
      }),
      database.follow.count({ where: { followingId: user.id } }),
      database.follow.count({ where: { followerId: user.id } }),
      viewerId
        ? database.follow.findUnique({
            where: { followerId_followingId: { followerId: viewerId, followingId: user.id } },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

  const tradeStats = computeTradeStats(
    executions.map((execution) => ({
      instrumentId: execution.instrumentId,
      symbol: execution.instrument.symbol,
      side: execution.side,
      quantity: execution.quantity,
      pricePaise: execution.pricePaise,
      timestamp: execution.simulationTimestamp,
    })),
  );

  return {
    userId: user.id,
    handle,
    name: user.name?.trim() || handle,
    bio: user.bio,
    joinedAt: user.createdAt,
    returnPercent: portfolio?.totalReturnPercent ?? null,
    winRatePercent: tradeStats.winRatePercent,
    closedTrades: tradeStats.closedTradeCount,
    streakCurrent: streakView.streak.current,
    streakLongest: streakView.streak.longest,
    badges: streakView.streak.earnedBadges,
    challengeHistory: results.map((result) => ({
      challengeName: result.participant.challenge.name,
      rank: result.rank,
      returnPercent: result.returnPercent,
      finalizedAt: result.finalizedAt,
    })),
    followerCount,
    followingCount,
    isFollowing: follow !== null,
    isSelf,
  };
}

async function publicUserByHandle(rawHandle: string, database: PrismaClient) {
  const handle = normalizeHandle(rawHandle);
  if (!handle) throw new SocialError('Unknown handle.');
  const user = await database.user.findUnique({
    where: { handle },
    select: { id: true, isPublic: true },
  });
  if (!user || !user.isPublic) throw new SocialError('That profile is private or does not exist.');
  return user;
}

export async function followByHandle(
  params: { followerId: string; handle: string },
  database: PrismaClient = prisma,
) {
  const target = await publicUserByHandle(params.handle, database);
  if (target.id === params.followerId) throw new SocialError('You cannot follow yourself.');

  return database.follow.upsert({
    where: { followerId_followingId: { followerId: params.followerId, followingId: target.id } },
    create: { followerId: params.followerId, followingId: target.id },
    update: {},
  });
}

export async function unfollowByHandle(
  params: { followerId: string; handle: string },
  database: PrismaClient = prisma,
) {
  const target = await publicUserByHandle(params.handle, database);
  await database.follow.deleteMany({
    where: { followerId: params.followerId, followingId: target.id },
  });
}

export type FeedItem =
  | {
      kind: 'CHALLENGE';
      timestamp: Date;
      handle: string;
      name: string;
      challengeName: string;
      rank: number;
      returnPercent: number;
    }
  | {
      kind: 'PREDICTION';
      timestamp: Date;
      handle: string;
      name: string;
      symbol: string;
      correct: boolean;
    };

/**
 * The following feed: a query-time union of the people you follow — their recent
 * finalized challenge results and resolved predictions, newest first. No fan-out
 * tables (ponytail: query-time; add fan-out only when follower counts demand it).
 */
export async function loadFollowingFeed(
  userId: string,
  options: { limit?: number } = {},
  database: PrismaClient = prisma,
): Promise<FeedItem[]> {
  const limit = options.limit ?? 30;
  const edges = await database.follow.findMany({
    where: { followerId: userId },
    select: { followingId: true },
  });
  const followingIds = edges.map((edge) => edge.followingId);
  if (followingIds.length === 0) return [];

  const [challengeResults, predictions] = await Promise.all([
    database.challengeResult.findMany({
      where: { participant: { userId: { in: followingIds } } },
      orderBy: { finalizedAt: 'desc' },
      take: limit,
      include: {
        participant: {
          include: {
            challenge: { select: { name: true } },
            user: { select: { handle: true, name: true } },
          },
        },
      },
    }),
    database.prediction.findMany({
      where: { userId: { in: followingIds }, status: 'RESOLVED', resolvedAt: { not: null } },
      orderBy: { resolvedAt: 'desc' },
      take: limit,
      include: {
        instrument: { select: { symbol: true } },
        user: { select: { handle: true, name: true } },
      },
    }),
  ]);

  const items: FeedItem[] = [
    ...challengeResults.map<FeedItem>((result) => ({
      kind: 'CHALLENGE',
      timestamp: result.finalizedAt,
      handle: result.participant.user.handle ?? '',
      name: result.participant.user.name?.trim() || result.participant.user.handle || 'A trader',
      challengeName: result.participant.challenge.name,
      rank: result.rank,
      returnPercent: result.returnPercent,
    })),
    ...predictions.map<FeedItem>((prediction) => ({
      kind: 'PREDICTION',
      timestamp: prediction.resolvedAt!,
      handle: prediction.user.handle ?? '',
      name: prediction.user.name?.trim() || prediction.user.handle || 'A trader',
      symbol: prediction.instrument.symbol,
      correct: prediction.directionCorrect === true,
    })),
  ];

  return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
}

/**
 * "Study this portfolio": spins up a private simulation for the viewer holding
 * the same instruments and quantities as the target's active portfolio, opened
 * at the latest available prices. Pure reuse of the simulation + order engine —
 * each position is a real BUY sized to reproduce the holding.
 */
export async function cloneToSandbox(
  params: { viewerId: string; handle: string },
  database: PrismaClient = prisma,
) {
  const handle = normalizeHandle(params.handle);
  if (!handle) throw new SocialError('Unknown handle.');
  const target = await database.user.findUnique({ where: { handle } });
  if (!target || (!target.isPublic && target.id !== params.viewerId)) {
    throw new SocialError('That profile is private or does not exist.');
  }

  const accountId = await getActiveAccountId(target.id, database);
  const holdings = accountId
    ? await database.position.findMany({
        where: { virtualAccountId: accountId, quantity: { gt: 0 } },
        select: { instrumentId: true, quantity: true },
      })
    : [];
  if (holdings.length === 0) {
    throw new SocialError('This portfolio has no open positions to study.');
  }

  // Start one trading day before the newest candle so BUYs fill at the latest
  // ("current") open — the sim engine fills at the first candle strictly after t.
  const { max } = await getDataRange(database);
  if (!max) throw new SocialError('No market data is available.');
  const previous = await database.priceCandle.findFirst({
    where: { interval: CandleInterval.ONE_DAY, timestamp: { lt: max } },
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true },
  });
  const start = previous?.timestamp;
  if (!start) throw new SocialError('Not enough price history to clone this portfolio.');

  // Price each holding at its fill (earliest candle strictly after the start).
  const priced: { instrumentId: string; quantity: number; amountPaise: bigint }[] = [];
  let totalPaise = 0n;
  for (const holding of holdings) {
    const fill = await database.priceCandle.findFirst({
      where: { instrumentId: holding.instrumentId, timestamp: { gt: start } },
      orderBy: [{ timestamp: 'asc' }, { interval: 'asc' }],
      select: { openPaise: true },
    });
    if (!fill) continue; // no tradeable price after the start — skip this holding
    const amountPaise = BigInt(holding.quantity) * fill.openPaise;
    priced.push({ instrumentId: holding.instrumentId, quantity: holding.quantity, amountPaise });
    totalPaise += amountPaise;
  }
  if (priced.length === 0 || totalPaise <= 0n) {
    throw new SocialError('This portfolio could not be priced for cloning.');
  }

  const session = await createSimulation(
    {
      userId: params.viewerId,
      name: `Study @${handle}`,
      startTimestamp: start,
      initialBalancePaise: totalPaise,
    },
    database,
  );

  for (const holding of priced) {
    await submitSimulationOrder(
      {
        sessionId: session.id,
        userId: params.viewerId,
        side: OrderSide.BUY,
        instrumentId: holding.instrumentId,
        amountPaise: holding.amountPaise,
      },
      database,
    );
  }

  return session;
}
