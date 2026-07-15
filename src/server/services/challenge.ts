import { randomUUID } from 'node:crypto';

import {
  AccountStatus,
  ChallengeScoringMethod,
  ChallengeStatus,
  ChallengeVisibility,
  LedgerEntryType,
  OrderSide,
  OrderStatus,
  type PrismaClient,
} from '@/generated/prisma/client';
import { computeMaxDrawdown } from '@/lib/finance/analytics';
import { rankChallenge, type ScoreInput } from '@/lib/finance/challenge';
import { summarizeAccuracy, type PredictionRecord } from '@/lib/finance/prediction';
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
  startingBalancePaise: number;
  allowedInstrumentIds?: string[] | null;
  maxTrades?: number | null;
  resetAllowed?: boolean;
  scoringMethod: ChallengeScoringMethod;
  visibility?: ChallengeVisibility;
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
  if (!(input.startingBalancePaise > 0)) {
    throw new ChallengeError('Enter a starting balance greater than zero.');
  }

  return database.challenge.create({
    data: {
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
      visibility: input.visibility ?? ChallengeVisibility.PUBLIC,
      status: ChallengeStatus.ACTIVE,
    },
  });
}

export async function listChallenges(userId: string, database: PrismaClient = prisma) {
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
  }));
}

export async function joinChallenge(
  params: { challengeId: string; userId: string },
  database: PrismaClient = prisma,
) {
  const challenge = await database.challenge.findUnique({ where: { id: params.challengeId } });
  if (!challenge) throw new ChallengeError('Challenge not found.');

  const existing = await database.challengeParticipant.findUnique({
    where: { challengeId_userId: { challengeId: params.challengeId, userId: params.userId } },
  });
  if (existing) return existing;

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

export interface SubmitChallengeOrderInput {
  challengeId: string;
  userId: string;
  side: OrderSide;
  instrumentId: string;
  amountPaise?: number;
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
      ? await submitBuyOrder({ ...common, amountPaise: input.amountPaise ?? 0 }, database, prices)
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
  finalValuePaise: number;
  returnPercent: number;
  maxDrawdownPercent: number;
  predictionAccuracyPercent: number | null;
  tradeCount: number;
}

async function scoreParticipant(
  participant: {
    id: string;
    userId: string;
    joinedAt: Date;
    account: { virtualAccountId: string } | null;
  },
  challenge: { startTimestamp: Date; endTimestamp: Date; startingBalancePaise: number },
  database: PrismaClient,
): Promise<ParticipantScore> {
  const accountId = participant.account!.virtualAccountId;
  const now = new Date();
  const valuationTimestamp = now < challenge.endTimestamp ? now : challenge.endTimestamp;

  const portfolio = await loadPortfolioForAccount(accountId, { valuationTimestamp }, database);
  const finalValuePaise = portfolio?.portfolioValuePaise ?? challenge.startingBalancePaise;
  const returnPercent =
    ((finalValuePaise - challenge.startingBalancePaise) / challenge.startingBalancePaise) * 100;

  const snapshots = await database.portfolioSnapshot.findMany({
    where: { virtualAccountId: accountId },
    orderBy: { timestamp: 'asc' },
    select: { timestamp: true, portfolioValuePaise: true },
  });
  const drawdown = computeMaxDrawdown(snapshots);
  const maxDrawdownPercent = drawdown?.magnitudePercent ?? 0;

  await resolveDuePredictions(participant.userId, database);
  const predictions = await database.prediction.findMany({
    where: {
      userId: participant.userId,
      predictionTimestamp: { gte: challenge.startTimestamp, lte: challenge.endTimestamp },
    },
    select: { status: true, directionCorrect: true, targetReached: true },
  });
  const accuracy = summarizeAccuracy(
    predictions.map<PredictionRecord>((prediction) => ({
      status: prediction.status,
      instrumentSymbol: '',
      directionCorrect: prediction.directionCorrect,
      targetReached: prediction.targetReached,
      durationMs: 0,
    })),
  );

  const tradeCount = await database.order.count({
    where: { virtualAccountId: accountId, status: OrderStatus.FILLED },
  });

  return {
    input: {
      participantId: participant.id,
      returnPercent,
      maxDrawdownPercent,
      predictionAccuracyPercent: accuracy.directionAccuracyPercent,
      joinedAt: participant.joinedAt,
    },
    finalValuePaise,
    returnPercent,
    maxDrawdownPercent,
    predictionAccuracyPercent: accuracy.directionAccuracyPercent,
    tradeCount,
  };
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

  const scored = await Promise.all(
    challenge.participants
      .filter((participant) => participant.account)
      .map((participant) => scoreParticipant(participant, challenge, database)),
  );
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
  finalValuePaise: number;
  isMe: boolean;
}

export async function loadLeaderboard(
  challengeId: string,
  userId: string,
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
    const scored = await Promise.all(
      challenge.participants
        .filter((participant) => participant.account)
        .map(async (participant) => ({
          participant,
          score: await scoreParticipant(participant, challenge, database),
        })),
    );
    const ranked = rankChallenge(
      scored.map((entry) => entry.score.input),
      challenge.scoringMethod as ChallengeScoringMethod,
    );
    const rankById = new Map(ranked.map((entry) => [entry.participantId, entry]));
    rows = scored
      .map(({ participant, score }) => {
        const ranking = rankById.get(participant.id)!;
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
  return { challenge, rows, personalRank: me?.rank ?? null, finalized };
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
