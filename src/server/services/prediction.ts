import {
  CandleInterval,
  PredictionDirection,
  PredictionStatus,
  type PrismaClient,
} from '@/generated/prisma/client';
import {
  evaluatePrediction,
  summarizeAccuracy,
  targetPriceFor,
  type AccuracySummary,
  type PredictionRecord,
  type PriceBar,
} from '@/lib/finance/prediction';
import { prisma } from '@/lib/prisma';
import { DatabaseMarketDataProvider } from '@/server/market-data';

export class PredictionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PredictionError';
  }
}

export interface CreatePredictionInput {
  userId: string;
  instrumentId: string;
  simulationSessionId?: string | null;
  direction: PredictionDirection;
  targetPercentage: number;
  expiryTimestamp: Date;
  notes?: string;
}

export interface PredictionView {
  id: string;
  symbol: string;
  companyName: string;
  simulationName: string | null;
  direction: PredictionDirection;
  status: PredictionStatus;
  startingPricePaise: number;
  targetPricePaise: number;
  targetPercentage: number;
  predictionTimestamp: Date;
  expiryTimestamp: Date;
  endingPricePaise: number | null;
  directionCorrect: boolean | null;
  targetReached: boolean | null;
  notes: string | null;
  actualMovementPercent: number | null;
  absolutePercentageErrorPercent: number | null;
  timeToTargetMs: number | null;
}

export async function createPrediction(
  input: CreatePredictionInput,
  database: PrismaClient = prisma,
) {
  if (!(input.targetPercentage > 0)) {
    throw new PredictionError('Enter a target percentage greater than zero.');
  }

  const session = input.simulationSessionId
    ? await ownedSession(input.simulationSessionId, input.userId, database)
    : null;
  const predictionTimestamp = session ? session.currentTimestamp : new Date();

  if (
    Number.isNaN(input.expiryTimestamp.getTime()) ||
    input.expiryTimestamp <= predictionTimestamp
  ) {
    throw new PredictionError('The expiry must be after the prediction time.');
  }

  const prices = new DatabaseMarketDataProvider(database);
  const startingPrice = await prices.getPriceAt(input.instrumentId, predictionTimestamp);
  if (!startingPrice) {
    throw new PredictionError('No price is available for this instrument at the prediction time.');
  }

  const targetPricePaise = targetPriceFor(
    input.direction,
    startingPrice.pricePaise,
    input.targetPercentage,
  );

  return database.prediction.create({
    data: {
      userId: input.userId,
      instrumentId: input.instrumentId,
      simulationSessionId: input.simulationSessionId ?? null,
      direction: input.direction,
      startingPricePaise: startingPrice.pricePaise,
      targetPricePaise,
      targetPercentage: input.targetPercentage,
      predictionTimestamp,
      expiryTimestamp: input.expiryTimestamp,
      status: PredictionStatus.OPEN,
      notes: input.notes?.trim() || null,
    },
  });
}

export async function cancelPrediction(
  params: { predictionId: string; userId: string },
  database: PrismaClient = prisma,
) {
  const prediction = await database.prediction.findUnique({ where: { id: params.predictionId } });
  if (!prediction || prediction.userId !== params.userId) {
    throw new PredictionError('Prediction not found.');
  }
  if (prediction.status !== PredictionStatus.OPEN) return prediction;

  return database.prediction.update({
    where: { id: prediction.id },
    data: { status: PredictionStatus.CANCELLED },
  });
}

/**
 * Resolves every open prediction whose evaluation time has arrived. A
 * simulation-scoped prediction is only evaluated once its session's clock has
 * reached the expiry — before that it stays OPEN, so no post-expiry (future)
 * price is ever read in historical mode. Live predictions use the real clock.
 */
export async function resolveDuePredictions(userId: string, database: PrismaClient = prisma) {
  const open = await database.prediction.findMany({
    where: { userId, status: PredictionStatus.OPEN },
    include: { simulationSession: { select: { currentTimestamp: true } } },
  });

  const now = new Date();
  const prices = new DatabaseMarketDataProvider(database);

  for (const prediction of open) {
    const clock = prediction.simulationSession?.currentTimestamp ?? now;
    if (clock < prediction.expiryTimestamp) continue; // not due — do not peek at the future

    const endingPrice = await prices.getPriceAt(
      prediction.instrumentId,
      prediction.expiryTimestamp,
    );
    if (!endingPrice) {
      await database.prediction.update({
        where: { id: prediction.id },
        data: { status: PredictionStatus.EXPIRED, resolvedAt: new Date() },
      });
      continue;
    }

    const bars = await fetchBars(
      prediction.instrumentId,
      prediction.predictionTimestamp,
      prediction.expiryTimestamp,
      database,
    );
    const outcome = evaluatePrediction(
      {
        direction: prediction.direction,
        startingPricePaise: prediction.startingPricePaise,
        targetPricePaise: prediction.targetPricePaise,
        targetPercentage: prediction.targetPercentage,
        predictionTimestamp: prediction.predictionTimestamp,
      },
      endingPrice.pricePaise,
      bars,
    );

    await database.prediction.update({
      where: { id: prediction.id },
      data: {
        endingPricePaise: endingPrice.pricePaise,
        directionCorrect: outcome.directionCorrect,
        targetReached: outcome.targetReached,
        status: PredictionStatus.RESOLVED,
        resolvedAt: new Date(),
      },
    });
  }
}

export async function loadPredictionsOverview(userId: string, database: PrismaClient = prisma) {
  await resolveDuePredictions(userId, database);
  const predictions = await loadUserPredictions(userId, database);

  const open = predictions.filter((prediction) => prediction.status === PredictionStatus.OPEN);
  const accuracy: AccuracySummary = summarizeAccuracy(
    predictions.map<PredictionRecord>((prediction) => ({
      status: prediction.status,
      instrumentSymbol: prediction.instrument.symbol,
      directionCorrect: prediction.directionCorrect,
      targetReached: prediction.targetReached,
      durationMs: prediction.expiryTimestamp.getTime() - prediction.predictionTimestamp.getTime(),
    })),
  );

  return {
    open: await Promise.all(open.map((prediction) => toView(prediction, database))),
    accuracy,
    resolvedCount: predictions.filter((p) => p.status === PredictionStatus.RESOLVED).length,
  };
}

export async function loadResolvedPredictions(userId: string, database: PrismaClient = prisma) {
  await resolveDuePredictions(userId, database);
  const predictions = await loadUserPredictions(userId, database);
  const closed = predictions.filter((prediction) =>
    (['RESOLVED', 'EXPIRED', 'CANCELLED'] as PredictionStatus[]).includes(prediction.status),
  );
  return Promise.all(closed.map((prediction) => toView(prediction, database)));
}

type LoadedPrediction = Awaited<ReturnType<typeof loadUserPredictions>>[number];

function loadUserPredictions(userId: string, database: PrismaClient) {
  return database.prediction.findMany({
    where: { userId },
    include: {
      instrument: { select: { symbol: true, companyName: true } },
      simulationSession: { select: { name: true } },
    },
    orderBy: [{ status: 'asc' }, { expiryTimestamp: 'asc' }],
  });
}

async function toView(
  prediction: LoadedPrediction,
  database: PrismaClient,
): Promise<PredictionView> {
  const base: PredictionView = {
    id: prediction.id,
    symbol: prediction.instrument.symbol,
    companyName: prediction.instrument.companyName,
    simulationName: prediction.simulationSession?.name ?? null,
    direction: prediction.direction,
    status: prediction.status,
    startingPricePaise: prediction.startingPricePaise,
    targetPricePaise: prediction.targetPricePaise,
    targetPercentage: prediction.targetPercentage,
    predictionTimestamp: prediction.predictionTimestamp,
    expiryTimestamp: prediction.expiryTimestamp,
    endingPricePaise: prediction.endingPricePaise,
    directionCorrect: prediction.directionCorrect,
    targetReached: prediction.targetReached,
    notes: prediction.notes,
    actualMovementPercent: null,
    absolutePercentageErrorPercent: null,
    timeToTargetMs: null,
  };

  if (prediction.status !== PredictionStatus.RESOLVED || prediction.endingPricePaise === null) {
    return base;
  }

  const bars = await fetchBars(
    prediction.instrumentId,
    prediction.predictionTimestamp,
    prediction.expiryTimestamp,
    database,
  );
  const outcome = evaluatePrediction(
    {
      direction: prediction.direction,
      startingPricePaise: prediction.startingPricePaise,
      targetPricePaise: prediction.targetPricePaise,
      targetPercentage: prediction.targetPercentage,
      predictionTimestamp: prediction.predictionTimestamp,
    },
    prediction.endingPricePaise,
    bars,
  );

  return {
    ...base,
    actualMovementPercent: outcome.actualMovementPercent,
    absolutePercentageErrorPercent: outcome.absolutePercentageErrorPercent,
    timeToTargetMs: outcome.timeToTargetMs,
  };
}

/** Price bars over a window, at the finest interval available for the instrument. */
async function fetchBars(
  instrumentId: string,
  from: Date,
  to: Date,
  database: PrismaClient,
): Promise<PriceBar[]> {
  const provider = new DatabaseMarketDataProvider(database);
  let candles = await provider.getCandles(instrumentId, from, to, CandleInterval.ONE_MINUTE);
  if (candles.length === 0) {
    candles = await provider.getCandles(instrumentId, from, to, CandleInterval.ONE_DAY);
  }
  return candles.map((candle) => ({
    timestamp: candle.timestamp,
    highPaise: candle.highPaise,
    lowPaise: candle.lowPaise,
  }));
}

async function ownedSession(sessionId: string, userId: string, database: PrismaClient) {
  const session = await database.simulationSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId) {
    throw new PredictionError('Simulation not found.');
  }
  return session;
}
