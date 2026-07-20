// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import {
  CandleInterval,
  OrderSide,
  PredictionDirection,
  PrismaClient,
} from '@/generated/prisma/client';
import { registerUser } from '@/server/services/register-user';
import {
  cancelPrediction,
  createPrediction,
  loadPredictionsOverview,
  loadResolvedPredictions,
  resolveDuePredictions,
} from '@/server/services/prediction';
import {
  advanceSimulation,
  createSimulation,
  submitSimulationOrder,
} from '@/server/services/simulation';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;

const DAY1 = new Date('2026-06-01T10:00:00.000Z');
const DAY3 = new Date('2026-06-03T10:00:00.000Z');
const INITIAL = 50_000_00n;

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
});

afterAll(async () => {
  await ephemeral.drop();
});

describe('predictions', () => {
  it('records predictions without touching the portfolio and resolves only after expiry', async () => {
    const user = await registerUser(
      { name: 'Pred', email: `pred-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const instrument = await createInstrument();
    const sim = await createSimulation(
      { userId: user.id, name: 'Pred run', startTimestamp: DAY1, initialBalancePaise: INITIAL },
      database,
    );

    // Establish a real portfolio state to prove predictions never touch it.
    await submitSimulationOrder(
      {
        sessionId: sim.id,
        userId: user.id,
        side: OrderSide.BUY,
        instrumentId: instrument.id,
        amountPaise: 5_000_00n,
      },
      database,
    );
    const before = await portfolioState(sim.virtualAccountId);

    const prediction = await createPrediction(
      {
        userId: user.id,
        instrumentId: instrument.id,
        simulationSessionId: sim.id,
        direction: PredictionDirection.UP,
        targetPercentage: 5,
        expiryTimestamp: DAY3,
        notes: 'Up 5% by day 3',
      },
      database,
    );
    // Starting price is the price at the (current) simulation time — never later.
    expect(prediction.startingPricePaise).toBe(100_000n); // DAY1 close
    expect(prediction.targetPricePaise).toBe(105_000n);
    expect(prediction.status).toBe('OPEN');

    // Sim clock is still DAY1 (< expiry DAY3): resolving must NOT peek at future prices.
    await resolveDuePredictions(user.id, database);
    expect((await getPrediction(prediction.id)).status).toBe('OPEN');
    expect((await getPrediction(prediction.id)).endingPricePaise).toBeNull();

    // Advance the sim past the expiry, then it resolves against the DAY3 price.
    await advanceSimulation(
      { sessionId: sim.id, userId: user.id, step: 'CUSTOM', customTimestamp: DAY3 },
      database,
    );
    await resolveDuePredictions(user.id, database);

    const resolved = await getPrediction(prediction.id);
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.endingPricePaise).toBe(106_000n); // DAY3 close, +6%
    expect(resolved.directionCorrect).toBe(true); // rose
    expect(resolved.targetReached).toBe(true); // DAY3 high 106,500 >= 105,000 target

    // The portfolio is byte-for-byte unchanged by the whole prediction lifecycle.
    expect(await portfolioState(sim.virtualAccountId)).toEqual(before);
  });

  it('excludes cancelled predictions from accuracy metrics', async () => {
    const user = await registerUser(
      { name: 'Acc', email: `acc-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const instrument = await createInstrument();
    const sim = await createSimulation(
      { userId: user.id, name: 'Acc run', startTimestamp: DAY1, initialBalancePaise: INITIAL },
      database,
    );

    const kept = await createPrediction(
      {
        userId: user.id,
        instrumentId: instrument.id,
        simulationSessionId: sim.id,
        direction: PredictionDirection.UP,
        targetPercentage: 5,
        expiryTimestamp: DAY3,
      },
      database,
    );
    const cancelled = await createPrediction(
      {
        userId: user.id,
        instrumentId: instrument.id,
        simulationSessionId: sim.id,
        direction: PredictionDirection.DOWN,
        targetPercentage: 5,
        expiryTimestamp: DAY3,
      },
      database,
    );

    await cancelPrediction({ predictionId: cancelled.id, userId: user.id }, database);
    await advanceSimulation(
      { sessionId: sim.id, userId: user.id, step: 'CUSTOM', customTimestamp: DAY3 },
      database,
    );

    const overview = await loadPredictionsOverview(user.id, database);
    expect(overview.accuracy.total).toBe(1); // only the resolved (kept) one
    expect(overview.accuracy.directionAccuracyPercent).toBe(100); // it rose, UP was correct
    expect((await getPrediction(cancelled.id)).status).toBe('CANCELLED');
    expect((await getPrediction(kept.id)).status).toBe('RESOLVED');
  });

  it('paginates resolved predictions with a cursor, without gaps or overlap', async () => {
    const user = await registerUser(
      { name: 'Page', email: `page-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const instrument = await createInstrument();
    const sim = await createSimulation(
      { userId: user.id, name: 'Page run', startTimestamp: DAY1, initialBalancePaise: INITIAL },
      database,
    );

    for (let i = 0; i < 3; i += 1) {
      await createPrediction(
        {
          userId: user.id,
          instrumentId: instrument.id,
          simulationSessionId: sim.id,
          direction: PredictionDirection.UP,
          targetPercentage: 5,
          expiryTimestamp: DAY3,
        },
        database,
      );
    }
    await advanceSimulation(
      { sessionId: sim.id, userId: user.id, step: 'CUSTOM', customTimestamp: DAY3 },
      database,
    );

    const first = await loadResolvedPredictions(user.id, { limit: 2 }, database);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await loadResolvedPredictions(
      user.id,
      { cursor: first.nextCursor!, limit: 2 },
      database,
    );
    expect(second.items).toHaveLength(1); // 3 total → 2 + 1
    expect(second.nextCursor).toBeNull();

    // Every resolved prediction appears exactly once across the two pages.
    const ids = [...first.items, ...second.items].map((prediction) => prediction.id);
    expect(new Set(ids).size).toBe(3);
  });
});

async function portfolioState(virtualAccountId: string) {
  const [account, positions, ledgerCount] = await Promise.all([
    database.virtualAccount.findUniqueOrThrow({ where: { id: virtualAccountId } }),
    database.position.count({ where: { virtualAccountId } }),
    database.ledgerEntry.count({ where: { virtualAccountId } }),
  ]);
  return { cash: account.availableCashPaise, positions, ledgerCount };
}

function getPrediction(id: string) {
  return database.prediction.findUniqueOrThrow({ where: { id } });
}

async function createInstrument() {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  const instrument = await database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `PRED-${suffix}`,
      companyName: `Pred ${suffix}`,
      isin: `TEST-${suffix}`,
      sector: 'Testing',
      industry: 'Testing',
      currency: 'INR',
    },
  });
  const rows: [Date, number, number, number, number][] = [
    // timestamp, open, high, low, close
    [DAY1, 100_000, 100_500, 99_500, 100_000],
    [new Date('2026-06-02T10:00:00.000Z'), 101_000, 103_500, 100_500, 103_000],
    [DAY3, 105_000, 106_500, 104_000, 106_000],
  ];
  for (const [timestamp, openPaise, highPaise, lowPaise, closePaise] of rows) {
    await database.priceCandle.create({
      data: {
        instrumentId: instrument.id,
        interval: CandleInterval.ONE_DAY,
        timestamp,
        openPaise,
        highPaise,
        lowPaise,
        closePaise,
        volume: 1_000,
        source: 'pred-test',
      },
    });
  }
  return instrument;
}
