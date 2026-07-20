// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import {
  CandleInterval,
  OrderSide,
  PredictionDirection,
  PredictionStatus,
  PrismaClient,
} from '@/generated/prisma/client';
import { saveJournalEntry } from '@/server/services/journal';
import { loadAnalytics } from '@/server/services/portfolio-analytics';
import { captureDailySnapshotIfNeeded } from '@/server/services/portfolio-snapshot';
import { loadPredictionStreak } from '@/server/services/prediction';
import { INITIAL_BALANCE_PAISE, registerUser } from '@/server/services/register-user';
import {
  advanceSimulation,
  createSimulation,
  submitSimulationOrder,
} from '@/server/services/simulation';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;

const D1 = new Date('2026-06-01T10:00:00.000Z');
const D3 = new Date('2026-06-03T10:00:00.000Z');

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
});

afterAll(async () => {
  await ephemeral.drop();
});

describe('Phase 1 analytics — trade stats, journal tags, snapshots, streaks', () => {
  it('derives realized trade stats and per-tag P&L from a round-trip', async () => {
    const user = await registerUser(
      { name: 'Analytics', email: `analytics-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const tata = await seedTataMotors();

    const sim = await createSimulation(
      { userId: user.id, name: 'Stats', startTimestamp: D1, initialBalancePaise: INITIAL_BALANCE_PAISE },
      database,
    );
    await submitSimulationOrder(
      { sessionId: sim.id, userId: user.id, side: OrderSide.BUY, instrumentId: tata.id, amountPaise: 20_000_00n },
      database,
    );
    await advanceSimulation(
      { sessionId: sim.id, userId: user.id, step: 'CUSTOM', customTimestamp: D3 },
      database,
    );
    const sell = await submitSimulationOrder(
      { sessionId: sim.id, userId: user.id, side: OrderSide.SELL, instrumentId: tata.id, quantity: 9 },
      database,
    );
    expect(sell.status).toBe('FILLED');

    const before = await loadAnalytics(sim.id, user.id, {}, database);
    expect(before!.analytics.tradeStats.closedTradeCount).toBe(1);
    expect(before!.analytics.tradeStats.wins).toBe(1);
    expect(before!.analytics.tradeStats.winRatePercent).toBe(100);
    // Sold 9 of 18 held @₹1,100 avg, filled @₹1,250 → 9 × ₹150 = ₹1,350 realized.
    expect(before!.analytics.tradeStats.netRealizedPnlPaise).toBe(135_000n);
    expect(before!.analytics.tradeStats.byStrategy).toEqual([]); // untagged yet

    // Tag the closing sell; the round-trip's P&L now attributes to that tag.
    await saveJournalEntry(
      { userId: user.id, orderId: sell.orderId, fields: { strategyTag: 'Momentum', emotionTag: 'Confident' } },
      database,
    );
    const after = await loadAnalytics(sim.id, user.id, {}, database);
    expect(after!.analytics.tradeStats.byStrategy).toEqual([
      expect.objectContaining({ tag: 'Momentum', trades: 1, wins: 1, netPnlPaise: 135_000n }),
    ]);
    expect(after!.analytics.tradeStats.byEmotion[0].tag).toBe('Confident');
  });

  it('captures at most one live snapshot per IST day', async () => {
    const user = await registerUser(
      { name: 'Snap', email: `snap-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const primary = await database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });

    const first = await captureDailySnapshotIfNeeded(primary.id, database);
    const second = await captureDailySnapshotIfNeeded(primary.id, database);
    expect(first).not.toBeNull();
    expect(second).toBeNull(); // already have today's snapshot

    const count = await database.portfolioSnapshot.count({
      where: { virtualAccountId: primary.id },
    });
    expect(count).toBe(1);
  });

  it('counts a correct resolved prediction toward today’s streak', async () => {
    const user = await registerUser(
      { name: 'Streak', email: `streak-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const tata = await seedTataMotors();

    await database.prediction.create({
      data: {
        userId: user.id,
        instrumentId: tata.id,
        direction: PredictionDirection.UP,
        startingPricePaise: 100_000n,
        targetPricePaise: 105_000n,
        targetPercentage: 5,
        predictionTimestamp: new Date(),
        expiryTimestamp: new Date(),
        status: PredictionStatus.RESOLVED,
        directionCorrect: true,
        resolvedAt: new Date(),
      },
    });

    const view = await loadPredictionStreak(user.id, database);
    expect(view.resolvedCount).toBe(1);
    expect(view.streak.current).toBe(1);
    expect(view.madeToday).toBe(true);
  });
});

async function seedTataMotors() {
  const instrument = await database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `TATA_${randomUUID().slice(0, 8)}`,
      companyName: 'Tata Motors Limited',
      isin: 'INE155A01022',
      sector: 'Automobile',
      industry: 'Passenger Cars & Utility Vehicles',
      currency: 'INR',
    },
  });
  const rows: [Date, number][] = [
    [new Date('2026-06-01T10:00:00.000Z'), 100_000],
    [new Date('2026-06-02T10:00:00.000Z'), 110_000], // buy fills here
    [new Date('2026-06-03T10:00:00.000Z'), 130_000], // value here
    [new Date('2026-06-04T10:00:00.000Z'), 125_000], // sell fills here
  ];
  for (const [timestamp, price] of rows) {
    await database.priceCandle.create({
      data: {
        instrumentId: instrument.id,
        interval: CandleInterval.ONE_DAY,
        timestamp,
        openPaise: price,
        highPaise: price,
        lowPaise: price,
        closePaise: price,
        volume: 1_000,
        source: 'analytics-test',
      },
    });
  }
  return instrument;
}
