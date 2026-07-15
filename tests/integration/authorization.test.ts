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
  OrderType,
  PredictionDirection,
  PrismaClient,
} from '@/generated/prisma/client';
import { DatabaseMarketDataProvider } from '@/server/market-data';
import {
  AccountError,
  closeAccount,
  createAccount,
  setActiveAccount,
} from '@/server/services/accounts';
import {
  ChallengeError,
  createChallenge,
  joinChallenge,
  loadChallengePortfolio,
  resetChallengeAccount,
  submitChallengeOrder,
} from '@/server/services/challenge';
import { JournalError, loadJournal, saveJournalEntry } from '@/server/services/journal';
import { cancelPrediction, createPrediction, PredictionError } from '@/server/services/prediction';
import { registerUser } from '@/server/services/register-user';
import {
  advanceSimulation,
  cancelSimulationOrder,
  createSimulation,
  loadOrderDetails,
  loadSimulation,
  SimulationError,
  submitPendingSimulationOrder,
  submitSimulationOrder,
} from '@/server/services/simulation';
import { submitBuyOrder } from '@/server/services/submit-market-order';
import {
  addWatchlistItem,
  createWatchlist,
  deleteWatchlist,
  loadWatchlistItems,
  moveWatchlistItem,
  removeWatchlistItem,
  WatchlistError,
} from '@/server/services/watchlist';

const databasePath = resolve(tmpdir(), `tradeplay-authz-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let database: PrismaClient;
let prices: DatabaseMarketDataProvider;

const D1 = new Date('2026-06-01T10:00:00.000Z');
const D2 = new Date('2026-06-02T10:00:00.000Z');
const HOUR = 60 * 60 * 1_000;

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
  prices = new DatabaseMarketDataProvider(database);
});

afterAll(async () => {
  await database.$disconnect();
  for (const suffix of ['', '-shm', '-wal', '-journal']) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
});

describe('cross-account authorization', () => {
  it('prevents user B from accessing or altering any of user A’s resources', async () => {
    const alice = await user();
    const bob = await user();
    const instrument = await instrumentWithCandles();

    // ── Alice's resources ──────────────────────────────────────────────
    const aliceAccount = await database.virtualAccount.findFirstOrThrow({
      where: { userId: alice.id },
    });
    await createAccount(
      { userId: alice.id, name: 'Second', initialBalancePaise: 10_000_00 },
      database,
    );

    const filled = await submitBuyOrder(
      {
        orderId: randomUUID(),
        virtualAccountId: aliceAccount.id,
        instrumentId: instrument.id,
        amountPaise: 5_000_00,
      },
      database,
      prices,
    );
    await saveJournalEntry(
      { userId: alice.id, orderId: filled.orderId, fields: { reason: 'mine' } },
      database,
    );

    const sim = await createSimulation(
      { userId: alice.id, name: 'Alice sim', startTimestamp: D1, initialBalancePaise: 20_000_00 },
      database,
    );
    const pending = await submitPendingSimulationOrder(
      {
        sessionId: sim.id,
        userId: alice.id,
        side: OrderSide.BUY,
        instrumentId: instrument.id,
        orderType: OrderType.LIMIT,
        quantity: 5,
        limitPricePaise: 9_000,
      },
      database,
    );

    const prediction = await createPrediction(
      {
        userId: alice.id,
        instrumentId: instrument.id,
        direction: PredictionDirection.UP,
        targetPercentage: 5,
        expiryTimestamp: future(24 * HOUR),
      },
      database,
    );

    const watchlist = await createWatchlist({ userId: alice.id, name: 'Alice list' }, database);
    const item = await addWatchlistItem(
      { userId: alice.id, watchlistId: watchlist.id, instrumentId: instrument.id },
      database,
    );

    const challenge = await createChallenge(
      {
        creatorId: alice.id,
        name: 'Alice challenge',
        description: 'x',
        startTimestamp: future(HOUR),
        endTimestamp: future(8 * 24 * HOUR),
        startingBalancePaise: 20_000_00,
        scoringMethod: 'RETURN',
      },
      database,
    );
    await joinChallenge({ challengeId: challenge.id, userId: alice.id }, database);

    // ── Bob is denied everywhere ───────────────────────────────────────
    // Accounts
    await expect(
      setActiveAccount({ userId: bob.id, accountId: aliceAccount.id }, database),
    ).rejects.toBeInstanceOf(AccountError);
    await expect(
      closeAccount({ userId: bob.id, accountId: aliceAccount.id }, database),
    ).rejects.toBeInstanceOf(AccountError);

    // Simulations / orders / positions
    expect(await loadSimulation(sim.id, bob.id, database)).toBeNull();
    expect(await loadOrderDetails(pending.id, bob.id, database)).toBeNull();
    await expect(
      advanceSimulation({ sessionId: sim.id, userId: bob.id, step: 'MINUTE' }, database),
    ).rejects.toBeInstanceOf(SimulationError);
    await expect(
      cancelSimulationOrder({ sessionId: sim.id, userId: bob.id, orderId: pending.id }, database),
    ).rejects.toBeInstanceOf(SimulationError);
    await expect(
      submitSimulationOrder(
        {
          sessionId: sim.id,
          userId: bob.id,
          side: OrderSide.BUY,
          instrumentId: instrument.id,
          amountPaise: 100_00,
        },
        database,
      ),
    ).rejects.toBeInstanceOf(SimulationError);

    // Predictions
    await expect(
      cancelPrediction({ predictionId: prediction.id, userId: bob.id }, database),
    ).rejects.toBeInstanceOf(PredictionError);

    // Watchlists
    await expect(loadWatchlistItems(watchlist.id, bob.id, database)).rejects.toBeInstanceOf(
      WatchlistError,
    );
    await expect(
      addWatchlistItem(
        { userId: bob.id, watchlistId: watchlist.id, instrumentId: instrument.id },
        database,
      ),
    ).rejects.toBeInstanceOf(WatchlistError);
    await expect(
      removeWatchlistItem({ userId: bob.id, itemId: item.id }, database),
    ).rejects.toBeInstanceOf(WatchlistError);
    await expect(
      moveWatchlistItem({ userId: bob.id, itemId: item.id, direction: 'UP' }, database),
    ).rejects.toBeInstanceOf(WatchlistError);
    await expect(
      deleteWatchlist({ userId: bob.id, watchlistId: watchlist.id }, database),
    ).rejects.toBeInstanceOf(WatchlistError);

    // Journal
    await expect(
      saveJournalEntry(
        { userId: bob.id, orderId: filled.orderId, fields: { reason: 'hijack' } },
        database,
      ),
    ).rejects.toBeInstanceOf(JournalError);
    expect(
      await loadJournal({ userId: bob.id, virtualAccountId: aliceAccount.id }, database),
    ).toEqual([]);

    // Challenges (Bob has not joined)
    await expect(
      submitChallengeOrder(
        {
          challengeId: challenge.id,
          userId: bob.id,
          side: OrderSide.BUY,
          instrumentId: instrument.id,
          amountPaise: 100_00,
        },
        database,
      ),
    ).rejects.toBeInstanceOf(ChallengeError);
    await expect(
      resetChallengeAccount({ challengeId: challenge.id, userId: bob.id }, database),
    ).rejects.toBeInstanceOf(ChallengeError);
    expect(await loadChallengePortfolio(challenge.id, bob.id, database)).toBeNull();

    // ── Alice's data is intact and still hers ──────────────────────────
    expect((await database.order.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
      'PENDING',
    );
    expect(await database.journalEntry.count({ where: { orderId: filled.orderId } })).toBe(1);
    const journal = await loadJournal(
      { userId: alice.id, virtualAccountId: aliceAccount.id },
      database,
    );
    expect(journal.find((trade) => trade.orderId === filled.orderId)?.entry?.reason).toBe('mine');
  });
});

async function user() {
  return registerUser(
    { name: 'U', email: `authz-${randomUUID()}@example.com`, password: 'tradeplay123' },
    database,
  );
}

async function instrumentWithCandles() {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  const instrument = await database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `AZ-${suffix}`,
      companyName: `Authz ${suffix}`,
      isin: `TEST-${suffix}`,
      sector: 'Testing',
      industry: 'Testing',
      currency: 'INR',
    },
  });
  for (const timestamp of [D1, D2]) {
    await database.priceCandle.create({
      data: {
        instrumentId: instrument.id,
        interval: CandleInterval.ONE_DAY,
        timestamp,
        openPaise: 10_000,
        highPaise: 10_000,
        lowPaise: 10_000,
        closePaise: 10_000,
        volume: 1_000,
        source: 'authz-test',
      },
    });
  }
  return instrument;
}

function future(ms: number): Date {
  return new Date(Date.now() + ms);
}
