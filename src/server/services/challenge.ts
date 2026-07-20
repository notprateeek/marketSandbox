import { randomUUID } from 'node:crypto';

import {
  AccountStatus,
  ChallengeRecurrence,
  ChallengeScoringMethod,
  ChallengeStatus,
  ChallengeVisibility,
  LedgerEntryType,
  OrderSide,
  OrderStatus,
  Prisma,
  type PrismaClient,
} from '@/generated/prisma/client';
import { computeMaxDrawdown } from '@/lib/finance/analytics';
import { rankChallenge, type ScoreInput } from '@/lib/finance/challenge';
import { summarizeAccuracy, type PredictionRecord } from '@/lib/finance/prediction';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { prisma } from '@/lib/prisma';
import { marketDataProvider, type MarketDataProvider } from '@/server/market-data';
import { loadPortfolioForAccount } from '@/server/services/portfolio';
import { captureSnapshot } from '@/server/services/portfolio-snapshot';
import { resolveDuePredictions } from '@/server/services/prediction';
import {
  submitBuyOrder,
  submitSellOrder,
  type OrderSubmissionResult,
} from '@/server/services/submit-market-order';

export class ChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChallengeError';
  }
}

export interface CreateChallengeInput {
  creatorId: string;
  name: string;
  description: string;
  startTimestamp: Date;
  endTimestamp: Date;
  startingBalancePaise: bigint;
  allowedInstrumentIds?: string[] | null;
  maxTrades?: number | null;
  resetAllowed?: boolean;
  scoringMethod: ChallengeScoringMethod;
  visibility?: ChallengeVisibility;
  recurrence?: ChallengeRecurrence | null;
  sponsorName?: string | null;
  sponsorLogoUrl?: string | null;
}

/** A short, human-readable, URL-safe invite code (no ambiguous 0/O/1/I). */
function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (const byte of randomUUID().replace(/-/g, '').slice(0, 8)) {
    code += alphabet[byte.charCodeAt(0) % alphabet.length];
  }
  return code;
}

export async function createChallenge(
  input: CreateChallengeInput,
  database: PrismaClient = prisma,
) {
  if (!input.name.trim()) throw new ChallengeError('Name the challenge.');
  if (Number.isNaN(input.startTimestamp.getTime()) || Number.isNaN(input.endTimestamp.getTime())) {
    throw new ChallengeError('Choose valid start and end times.');
  }
  if (input.endTimestamp <= input.startTimestamp) {
    throw new ChallengeError('The end must be after the start.');
  }
  if (!(input.startingBalancePaise > 0n)) {
    throw new ChallengeError('Enter a starting balance greater than zero.');
  }

  const visibility = input.visibility ?? ChallengeVisibility.PUBLIC;
  // PRIVATE challenges are unlisted; the invite code is how people join them.
  const needsInvite = visibility === ChallengeVisibility.PRIVATE;

  const data = {
    creatorId: input.creatorId,
    name: input.name.trim(),
    description: input.description.trim(),
    startTimestamp: input.startTimestamp,
    endTimestamp: input.endTimestamp,
    startingBalancePaise: input.startingBalancePaise,
    allowedInstrumentIds:
      input.allowedInstrumentIds && input.allowedInstrumentIds.length > 0
        ? JSON.stringify(input.allowedInstrumentIds)
        : null,
    maxTrades: input.maxTrades ?? null,
    resetAllowed: input.resetAllowed ?? false,
    scoringMethod: input.scoringMethod,
    visibility,
    recurrence: input.recurrence ?? null,
    sponsorName: input.sponsorName?.trim() || null,
    sponsorLogoUrl: input.sponsorLogoUrl?.trim() || null,
    status: ChallengeStatus.ACTIVE,
  };

  // Retry on the astronomically unlikely invite-code collision.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await database.challenge.create({
        data: { ...data, inviteCode: needsInvite ? generateInviteCode() : null },
      });
    } catch (error) {
      const isCollision =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!isCollision || !needsInvite || attempt === 4) throw error;
    }
  }
  throw new ChallengeError('Could not allocate an invite code. Please try again.');
}

export async function listChallenges(userId: string, database: PrismaClient = prisma) {
  // Lazy rollover of any ended recurring contests before we list (no cron).
  await rolloverRecurringChallenges(database).catch(() => undefined);

  const challenges = await database.challenge.findMany({
    where: {
      OR: [
        { visibility: ChallengeVisibility.PUBLIC },
        { creatorId: userId },
        { participants: { some: { userId } } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { participants: true } },
      participants: { where: { userId }, select: { id: true } },
    },
  });

  return challenges.map((challenge) => ({
    id: challenge.id,
    name: challenge.name,
    description: challenge.description,
    scoringMethod: challenge.scoringMethod,
    visibility: challenge.visibility,
    status: challenge.status,
    startTimestamp: challenge.startTimestamp,
    endTimestamp: challenge.endTimestamp,
    participantCount: challenge._count.participants,
    joined: challenge.participants.length > 0,
    recurrence: challenge.recurrence,
    sponsorName: challenge.sponsorName,
    sponsorLogoUrl: challenge.sponsorLogoUrl,
  }));
}

export async function joinChallenge(
  params: { challengeId: string; userId: string; inviteCode?: string | null },
  database: PrismaClient = prisma,
) {
  const challenge = await database.challenge.findUnique({ where: { id: params.challengeId } });
  if (!challenge) throw new ChallengeError('Challenge not found.');

  const existing = await database.challengeParticipant.findUnique({
    where: { challengeId_userId: { challengeId: params.challengeId, userId: params.userId } },
  });
  if (existing) return existing;

  // PRIVATE challenges require the invite code (the creator can always join).
  if (
    challenge.visibility === ChallengeVisibility.PRIVATE &&
    challenge.creatorId !== params.userId &&
    (!params.inviteCode || params.inviteCode.trim().toUpperCase() !== challenge.inviteCode)
  ) {
    throw new ChallengeError('This challenge is private — a valid invite code is required.');
  }

  if (challenge.status !== ChallengeStatus.ACTIVE) {
    throw new ChallengeError('This challenge is not open to join.');
  }
  // Registration closes when the challenge starts.
  if (new Date() >= challenge.startTimestamp) {
    throw new ChallengeError('Registration for this challenge has closed.');
  }

  const participant = await database.$transaction(async (transaction) => {
    const account = await transaction.virtualAccount.create({
      data: {
        userId: params.userId,
        name: `Challenge · ${challenge.name}`,
        startingBalancePaise: challenge.startingBalancePaise,
        availableCashPaise: challenge.startingBalancePaise,
        status: AccountStatus.ACTIVE,
        ledgerEntries: {
          create: {
            type: LedgerEntryType.INITIAL_CREDIT,
            amountPaise: challenge.startingBalancePaise,
            balanceAfterPaise: challenge.startingBalancePaise,
            referenceType: 'SYSTEM',
            referenceId: 'ACCOUNT_OPENING',
            description: 'Initial challenge cash credit',
          },
        },
      },
    });
    const created = await transaction.challengeParticipant.create({
      data: { challengeId: params.challengeId, userId: params.userId },
    });
    await transaction.challengeAccount.create({
      data: { participantId: created.id, virtualAccountId: account.id },
    });
    return { participant: created, virtualAccountId: account.id };
  });

  // Baseline snapshot for the drawdown series (challenge accounts have no session).
  await captureSnapshot(
    { virtualAccountId: participant.virtualAccountId, simulationSessionId: null },
    new Date(),
    database,
  );
  return participant.participant;
}

/**
 * Joins a (typically PRIVATE) challenge by its invite code. Returns the joined
 * participant plus the challenge id so callers can route to it.
 */
export async function joinChallengeByCode(
  params: { userId: string; inviteCode: string },
  database: PrismaClient = prisma,
) {
  const code = params.inviteCode.trim().toUpperCase();
  if (!code) throw new ChallengeError('Enter an invite code.');
  const challenge = await database.challenge.findUnique({ where: { inviteCode: code } });
  if (!challenge) throw new ChallengeError('No challenge matches that invite code.');

  const participant = await joinChallenge(
    { challengeId: challenge.id, userId: params.userId, inviteCode: code },
    database,
  );
  return { participant, challengeId: challenge.id };
}

const RECURRENCE_PERIOD_MS: Record<ChallengeRecurrence, number> = {
  [ChallengeRecurrence.WEEKLY]: 7 * 24 * 60 * 60 * 1_000,
};

/**
 * Lazy rollover of recurring challenges (no cron): any recurring challenge whose
 * window has ended is finalized, stripped of its recurrence flag (so it becomes a
 * fixed historical contest and never rolls twice), and succeeded by a fresh
 * instance shifted forward by whole periods until its window is in the future.
 * Called when listing challenges. ponytail: on-read rollover; move to a cron if
 * the listing gets hot.
 */
export async function rolloverRecurringChallenges(
  database: PrismaClient = prisma,
  now: Date = new Date(),
) {
  const due = await database.challenge.findMany({
    where: { recurrence: { not: null }, endTimestamp: { lte: now } },
  });

  for (const challenge of due) {
    const period = RECURRENCE_PERIOD_MS[challenge.recurrence!];
    const duration = challenge.endTimestamp.getTime() - challenge.startTimestamp.getTime();
    // Smallest number of whole periods that puts the new window's end in the future.
    const gap = now.getTime() - challenge.endTimestamp.getTime();
    const shifts = Math.floor(gap / period) + 1;
    const nextStart = new Date(challenge.startTimestamp.getTime() + shifts * period);
    const nextEnd = new Date(nextStart.getTime() + duration);

    await finalizeChallenge(challenge.id, database).catch(() => undefined);
    await database.$transaction(async (transaction) => {
      // Detach recurrence from the finished instance so it only rolls once.
      await transaction.challenge.update({
        where: { id: challenge.id },
        data: { recurrence: null },
      });
      await transaction.challenge.create({
        data: {
          creatorId: challenge.creatorId,
          name: challenge.name,
          description: challenge.description,
          startTimestamp: nextStart,
          endTimestamp: nextEnd,
          startingBalancePaise: challenge.startingBalancePaise,
          allowedInstrumentIds: challenge.allowedInstrumentIds,
          maxTrades: challenge.maxTrades,
          resetAllowed: challenge.resetAllowed,
          scoringMethod: challenge.scoringMethod,
          visibility: challenge.visibility,
          recurrence: challenge.recurrence,
          sponsorName: challenge.sponsorName,
          sponsorLogoUrl: challenge.sponsorLogoUrl,
          inviteCode:
            challenge.visibility === ChallengeVisibility.PRIVATE ? generateInviteCode() : null,
          status: ChallengeStatus.ACTIVE,
        },
      });
    });
  }
}

export interface SubmitChallengeOrderInput {
  challengeId: string;
  userId: string;
  side: OrderSide;
  instrumentId: string;
  amountPaise?: bigint;
  quantity?: number;
}

export async function submitChallengeOrder(
  input: SubmitChallengeOrderInput,
  database: PrismaClient = prisma,
  prices: MarketDataProvider = marketDataProvider,
): Promise<OrderSubmissionResult> {
  const participant = await database.challengeParticipant.findUnique({
    where: { challengeId_userId: { challengeId: input.challengeId, userId: input.userId } },
    include: { challenge: true, account: true },
  });
  if (!participant || !participant.account) throw new ChallengeError('Join the challenge first.');

  const { challenge } = participant;
  if (challenge.status !== ChallengeStatus.ACTIVE || new Date() > challenge.endTimestamp) {
    throw new ChallengeError('This challenge is not accepting trades.');
  }
  if (!instrumentAllowed(challenge.allowedInstrumentIds, input.instrumentId)) {
    throw new ChallengeError('That instrument is not allowed in this challenge.');
  }
  if (challenge.maxTrades !== null) {
    const trades = await database.order.count({
      where: { virtualAccountId: participant.account.virtualAccountId, status: OrderStatus.FILLED },
    });
    if (trades >= challenge.maxTrades) {
      throw new ChallengeError(`This challenge allows at most ${challenge.maxTrades} trades.`);
    }
  }

  const common = {
    orderId: randomUUID(),
    virtualAccountId: participant.account.virtualAccountId,
    instrumentId: input.instrumentId,
  };
  const result =
    input.side === OrderSide.BUY
      ? await submitBuyOrder({ ...common, amountPaise: input.amountPaise ?? 0n }, database, prices)
      : await submitSellOrder({ ...common, quantity: input.quantity ?? 0 }, database, prices);

  if (result.status === OrderStatus.FILLED) {
    await captureSnapshot(
      { virtualAccountId: participant.account.virtualAccountId, simulationSessionId: null },
      new Date(),
      database,
    );
  }
  return result;
}

/** Wipes the participant's challenge account back to the opening balance. */
export async function resetChallengeAccount(
  params: { challengeId: string; userId: string },
  database: PrismaClient = prisma,
) {
  const participant = await database.challengeParticipant.findUnique({
    where: { challengeId_userId: { challengeId: params.challengeId, userId: params.userId } },
    include: { challenge: true, account: true },
  });
  if (!participant || !participant.account) throw new ChallengeError('Join the challenge first.');
  if (!participant.challenge.resetAllowed) {
    throw new ChallengeError('Reset is not allowed in this challenge.');
  }
  if (participant.challenge.status !== ChallengeStatus.ACTIVE) {
    throw new ChallengeError('This challenge is not active.');
  }

  const virtualAccountId = participant.account.virtualAccountId;
  await database.$transaction(async (transaction) => {
    await transaction.portfolioSnapshot.deleteMany({ where: { virtualAccountId } });
    await transaction.tradeExecution.deleteMany({ where: { virtualAccountId } });
    await transaction.order.deleteMany({ where: { virtualAccountId } });
    await transaction.position.deleteMany({ where: { virtualAccountId } });
    await transaction.ledgerEntry.deleteMany({
      where: { virtualAccountId, type: { not: LedgerEntryType.INITIAL_CREDIT } },
    });
    await transaction.virtualAccount.update({
      where: { id: virtualAccountId },
      data: { availableCashPaise: participant.challenge.startingBalancePaise },
    });
  });
  await captureSnapshot({ virtualAccountId, simulationSessionId: null }, new Date(), database);
}

interface ParticipantScore {
  input: ScoreInput;
  finalValuePaise: bigint;
  returnPercent: number;
  maxDrawdownPercent: number;
  predictionAccuracyPercent: number | null;
  tradeCount: number;
}

interface ScoreableParticipant {
  id: string;
  userId: string;
  joinedAt: Date;
  account: { virtualAccountId: string } | null;
}

/**
 * Values every account as of `valuationTimestamp` in a fixed number of queries
 * (positions, cash, and one latest-price-per-instrument read) instead of one
 * portfolio load per account — the Phase 4 fix for the leaderboard N+1. Value =
 * cash + Σ qty × latest close at-or-before the timestamp; unpriced holdings are
 * excluded, matching the per-account valuation.
 */
async function valueAccountsAt(
  accountIds: string[],
  valuationTimestamp: Date,
  database: PrismaClient,
): Promise<Map<string, bigint>> {
  if (accountIds.length === 0) return new Map();

  const [accounts, positions] = await Promise.all([
    database.virtualAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, availableCashPaise: true },
    }),
    database.position.findMany({
      where: { virtualAccountId: { in: accountIds } },
      select: { virtualAccountId: true, instrumentId: true, quantity: true },
    }),
  ]);

  const instrumentIds = [...new Set(positions.map((position) => position.instrumentId))];
  const priceByInstrument = new Map<string, bigint>();
  if (instrumentIds.length > 0) {
    // One "latest candle at-or-before T per instrument" read (DISTINCT ON).
    // interval ASC prefers the finer ONE_MINUTE candle at a tie, like getPriceAt.
    const rows = await database.$queryRaw<{ instrumentId: string; closePaise: bigint }[]>`
      SELECT DISTINCT ON ("instrumentId") "instrumentId", "closePaise"
      FROM "PriceCandle"
      WHERE "instrumentId" IN (${Prisma.join(instrumentIds)}) AND "timestamp" <= ${valuationTimestamp}
      ORDER BY "instrumentId", "timestamp" DESC, "interval" ASC
    `;
    for (const row of rows) priceByInstrument.set(row.instrumentId, row.closePaise);
  }

  const values = new Map<string, bigint>(
    accounts.map((account) => [account.id, account.availableCashPaise]),
  );
  for (const position of positions) {
    const price = priceByInstrument.get(position.instrumentId);
    if (price === undefined) continue; // unpriced holding excluded from the total
    values.set(
      position.virtualAccountId,
      (values.get(position.virtualAccountId) ?? 0n) + BigInt(position.quantity) * price,
    );
  }
  return values;
}

/**
 * Scores all participants in batched reads (valuation, snapshots, trade counts,
 * predictions) — no per-participant round trips for the reads.
 */
async function scoreParticipants(
  participants: ScoreableParticipant[],
  challenge: { startTimestamp: Date; endTimestamp: Date; startingBalancePaise: bigint },
  database: PrismaClient,
): Promise<ParticipantScore[]> {
  const withAccounts = participants.filter(
    (participant): participant is ScoreableParticipant & { account: { virtualAccountId: string } } =>
      participant.account !== null,
  );
  if (withAccounts.length === 0) return [];

  const accountIds = withAccounts.map((participant) => participant.account.virtualAccountId);
  const userIds = [...new Set(withAccounts.map((participant) => participant.userId))];
  const now = new Date();
  const valuationTimestamp = now < challenge.endTimestamp ? now : challenge.endTimestamp;

  // Resolve any due predictions before the batched read (write path, per user).
  await Promise.all(userIds.map((userId) => resolveDuePredictions(userId, database)));

  const [valueByAccount, snapshotRows, tradeGroups, predictionRows] = await Promise.all([
    valueAccountsAt(accountIds, valuationTimestamp, database),
    database.portfolioSnapshot.findMany({
      where: { virtualAccountId: { in: accountIds } },
      orderBy: { timestamp: 'asc' },
      select: { virtualAccountId: true, timestamp: true, portfolioValuePaise: true },
    }),
    database.order.groupBy({
      by: ['virtualAccountId'],
      where: { virtualAccountId: { in: accountIds }, status: OrderStatus.FILLED },
      _count: { _all: true },
    }),
    database.prediction.findMany({
      where: {
        userId: { in: userIds },
        predictionTimestamp: { gte: challenge.startTimestamp, lte: challenge.endTimestamp },
      },
      select: { userId: true, status: true, directionCorrect: true, targetReached: true },
    }),
  ]);

  const snapshotsByAccount = groupBy(snapshotRows, (row) => row.virtualAccountId);
  const tradeCountByAccount = new Map(
    tradeGroups.map((group) => [group.virtualAccountId, group._count._all]),
  );
  const predictionsByUser = groupBy(predictionRows, (row) => row.userId);

  return withAccounts.map((participant) => {
    const accountId = participant.account.virtualAccountId;
    const finalValuePaise = valueByAccount.get(accountId) ?? challenge.startingBalancePaise;
    const returnPercent =
      (Number(finalValuePaise - challenge.startingBalancePaise) /
        Number(challenge.startingBalancePaise)) *
      100;

    const drawdown = computeMaxDrawdown(snapshotsByAccount.get(accountId) ?? []);
    const accuracy = summarizeAccuracy(
      (predictionsByUser.get(participant.userId) ?? []).map<PredictionRecord>((prediction) => ({
        status: prediction.status,
        instrumentSymbol: '',
        directionCorrect: prediction.directionCorrect,
        targetReached: prediction.targetReached,
        durationMs: 0,
      })),
    );

    return {
      input: {
        participantId: participant.id,
        returnPercent,
        maxDrawdownPercent: drawdown?.magnitudePercent ?? 0,
        predictionAccuracyPercent: accuracy.directionAccuracyPercent,
        joinedAt: participant.joinedAt,
      },
      finalValuePaise,
      returnPercent,
      maxDrawdownPercent: drawdown?.magnitudePercent ?? 0,
      predictionAccuracyPercent: accuracy.directionAccuracyPercent,
      tradeCount: tradeCountByAccount.get(accountId) ?? 0,
    };
  });
}

function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    (map.get(key) ?? map.set(key, []).get(key)!).push(item);
  }
  return map;
}

/**
 * Freezes results and ranks once the challenge has ended. Idempotent: a
 * completed challenge is returned unchanged, so rankings are stable.
 */
export async function finalizeChallenge(challengeId: string, database: PrismaClient = prisma) {
  const challenge = await database.challenge.findUnique({
    where: { id: challengeId },
    include: { participants: { include: { account: true } } },
  });
  if (!challenge) throw new ChallengeError('Challenge not found.');
  if (challenge.status === ChallengeStatus.COMPLETED) return challenge;
  if (new Date() < challenge.endTimestamp) return challenge; // not over yet

  const scored = await scoreParticipants(challenge.participants, challenge, database);
  const ranked = rankChallenge(
    scored.map((entry) => entry.input),
    challenge.scoringMethod as ChallengeScoringMethod,
  );
  const rankById = new Map(ranked.map((entry) => [entry.participantId, entry]));

  await database.$transaction(async (transaction) => {
    for (const entry of scored) {
      const ranking = rankById.get(entry.input.participantId)!;
      await transaction.challengeResult.upsert({
        where: { participantId: entry.input.participantId },
        create: {
          participantId: entry.input.participantId,
          finalValuePaise: entry.finalValuePaise,
          returnPercent: entry.returnPercent,
          maxDrawdownPercent: entry.maxDrawdownPercent,
          predictionAccuracyPercent: entry.predictionAccuracyPercent,
          tradeCount: entry.tradeCount,
          score: ranking.score,
          rank: ranking.rank,
        },
        update: {
          finalValuePaise: entry.finalValuePaise,
          returnPercent: entry.returnPercent,
          maxDrawdownPercent: entry.maxDrawdownPercent,
          predictionAccuracyPercent: entry.predictionAccuracyPercent,
          tradeCount: entry.tradeCount,
          score: ranking.score,
          rank: ranking.rank,
        },
      });
    }
    await transaction.challenge.update({
      where: { id: challenge.id },
      data: { status: ChallengeStatus.COMPLETED },
    });
  });

  return { ...challenge, status: ChallengeStatus.COMPLETED };
}

export interface LeaderboardRow {
  participantId: string;
  displayName: string;
  rank: number;
  score: number;
  returnPercent: number;
  maxDrawdownPercent: number;
  predictionAccuracyPercent: number | null;
  finalValuePaise: bigint;
  isMe: boolean;
}

export async function loadLeaderboard(
  challengeId: string,
  userId: string,
  options: { cursor?: string; limit?: number } = {},
  database: PrismaClient = prisma,
) {
  await finalizeChallenge(challengeId, database).catch(() => undefined);

  const challenge = await database.challenge.findUnique({
    where: { id: challengeId },
    include: {
      participants: {
        include: { account: true, result: true, user: { select: { name: true, email: true } } },
      },
    },
  });
  if (!challenge) return null;

  const finalized = challenge.status === ChallengeStatus.COMPLETED;
  let rows: LeaderboardRow[];

  if (finalized) {
    rows = challenge.participants
      .filter((participant) => participant.result)
      .map((participant) => ({
        participantId: participant.id,
        displayName: displayName(participant.user),
        rank: participant.result!.rank,
        score: participant.result!.score,
        returnPercent: participant.result!.returnPercent,
        maxDrawdownPercent: participant.result!.maxDrawdownPercent,
        predictionAccuracyPercent: participant.result!.predictionAccuracyPercent,
        finalValuePaise: participant.result!.finalValuePaise,
        isMe: participant.userId === userId,
      }))
      .sort((a, b) => a.rank - b.rank);
  } else {
    const scored = await scoreParticipants(challenge.participants, challenge, database);
    const scoreById = new Map(scored.map((entry) => [entry.input.participantId, entry]));
    const ranked = rankChallenge(
      scored.map((entry) => entry.input),
      challenge.scoringMethod as ChallengeScoringMethod,
    );
    const rankById = new Map(ranked.map((entry) => [entry.participantId, entry]));
    rows = challenge.participants
      .filter((participant) => scoreById.has(participant.id))
      .map((participant) => {
        const ranking = rankById.get(participant.id)!;
        const score = scoreById.get(participant.id)!;
        return {
          participantId: participant.id,
          displayName: displayName(participant.user),
          rank: ranking.rank,
          score: ranking.score,
          returnPercent: score.returnPercent,
          maxDrawdownPercent: score.maxDrawdownPercent,
          predictionAccuracyPercent: score.predictionAccuracyPercent,
          finalValuePaise: score.finalValuePaise,
          isMe: participant.userId === userId,
        };
      })
      .sort((a, b) => a.rank - b.rank);
  }

  const me = rows.find((row) => row.isMe) ?? null;

  // Ranking needs every participant (and so does the winner / personal rank), so
  // we window the fully-ranked list for display. Cursor is the last shown
  // participant id. (Reducing the scoring read itself is the Phase 4 batch item.)
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const start = options.cursor
    ? rows.findIndex((row) => row.participantId === options.cursor) + 1
    : 0;
  const windowed = rows.slice(start, start + limit);
  const nextCursor =
    start + limit < rows.length ? (windowed[windowed.length - 1]?.participantId ?? null) : null;

  return {
    challenge,
    rows: windowed,
    winner: rows[0] ?? null,
    total: rows.length,
    personalRank: me?.rank ?? null,
    nextCursor,
    finalized,
  };
}

export async function getChallenge(
  challengeId: string,
  userId: string,
  database: PrismaClient = prisma,
) {
  await finalizeChallenge(challengeId, database).catch(() => undefined);
  const challenge = await database.challenge.findUnique({
    where: { id: challengeId },
    include: {
      participants: { where: { userId }, include: { account: true, result: true } },
      _count: { select: { participants: true } },
    },
  });
  if (!challenge) return null;
  const registrationOpen =
    challenge.status === ChallengeStatus.ACTIVE && new Date() < challenge.startTimestamp;
  const allowedInstrumentCount = challenge.allowedInstrumentIds
    ? (JSON.parse(challenge.allowedInstrumentIds) as string[]).length
    : null;
  return {
    challenge,
    participation: challenge.participants[0] ?? null,
    registrationOpen,
    allowedInstrumentCount,
  };
}

export async function loadChallengePortfolio(
  challengeId: string,
  userId: string,
  database: PrismaClient = prisma,
) {
  const participant = await database.challengeParticipant.findUnique({
    where: { challengeId_userId: { challengeId, userId } },
    include: { challenge: true, account: true },
  });
  if (!participant || !participant.account) return null;

  const { challenge } = participant;
  const now = new Date();
  const valuationTimestamp = now < challenge.endTimestamp ? now : challenge.endTimestamp;
  const [portfolio, tradeCount, instruments] = await Promise.all([
    loadPortfolioForAccount(participant.account.virtualAccountId, { valuationTimestamp }, database),
    database.order.count({
      where: { virtualAccountId: participant.account.virtualAccountId, status: OrderStatus.FILLED },
    }),
    allowedInstruments(challenge.allowedInstrumentIds, database),
  ]);

  return {
    challenge,
    portfolio,
    tradeCount,
    instruments,
    tradingOpen: challenge.status === ChallengeStatus.ACTIVE && now <= challenge.endTimestamp,
  };
}

function instrumentAllowed(allowedInstrumentIds: string | null, instrumentId: string): boolean {
  if (!allowedInstrumentIds) return true;
  return (JSON.parse(allowedInstrumentIds) as string[]).includes(instrumentId);
}

function allowedInstruments(allowedInstrumentIds: string | null, database: PrismaClient) {
  const where = allowedInstrumentIds
    ? { id: { in: JSON.parse(allowedInstrumentIds) as string[] } }
    : { isActive: true };
  return database.instrument.findMany({
    where,
    select: { id: true, symbol: true, companyName: true },
    orderBy: { symbol: 'asc' },
  });
}

function displayName(user: { name: string | null; email: string }): string {
  return user.name?.trim() || user.email.split('@')[0];
}
