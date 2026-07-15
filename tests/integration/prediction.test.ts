// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  resolveDuePredictions,
} from '@/server/services/prediction';
import {
  advanceSimulation,
  createSimulation,
  submitSimulationOrder,
} from '@/server/services/simulation';

const databasePath = resolve(tmpdir(), `tradeplay-pred-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let database: PrismaClient;

const DAY1 = new Date('2026-06-01T10:00:00.000Z');
const DAY3 = new Date('2026-06-03T10:00:00.000Z');
const INITIAL = 50_000_00;

beforeAll(async () => {
  closeSync(openSync(databasePath, 'a'));
  execFileSync(
    process.execPath,
    [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' },
  );
  database = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl, timeout: 50 }),
  });
});

afterAll(async () => {
  await database.$disconnect();
  for (const suffix of ['', '-shm', '-wal', '-journal']) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
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
        amountPaise: 5_000_00,
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
    expect(prediction.startingPricePaise).toBe(100_000); // DAY1 close
    expect(prediction.targetPricePaise).toBe(105_000);
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
    expect(resolved.endingPricePaise).toBe(106_000); // DAY3 close, +6%
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
