// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CandleInterval, PrismaClient } from '@/generated/prisma/client';
import { DatabaseMarketDataProvider } from '@/server/market-data';
import { reconcileAccount, reconcileAllAccounts } from '@/server/services/reconciliation';
import { INITIAL_BALANCE_PAISE, registerUser } from '@/server/services/register-user';
import { submitBuyOrder, submitSellOrder } from '@/server/services/submit-market-order';

const databasePath = resolve(tmpdir(), `tradeplay-recon-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let database: PrismaClient;
let prices: DatabaseMarketDataProvider;

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

describe('financial reconciliation', () => {
  it('reports a clean account after a mix of trades', async () => {
    const account = await createAccount();
    const instrument = await createInstrument(10_000);

    await buy(account.id, instrument.id, 20_000_00);
    await sell(account.id, instrument.id, 50);

    expect(await reconcileAccount(account.id, database)).toEqual([]);
  });

  // Property test: any sequence of trades must leave every invariant intact.
  it('stays reconciled across a randomized sequence of trades', async () => {
    const account = await createAccount();
    const instrument = await createInstrument(7_000);
    const random = seededRandom(1234);

    for (let step = 0; step < 40; step += 1) {
      if (random() < 0.55) {
        await buy(account.id, instrument.id, (1 + Math.floor(random() * 12)) * 1_000_00);
      } else {
        await sell(account.id, instrument.id, 1 + Math.floor(random() * 40));
      }
    }

    const violations = await reconcileAccount(account.id, database);
    expect(violations).toEqual([]);

    // Sanity: cash never went negative and the position is non-negative.
    const state = await database.virtualAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(state.availableCashPaise).toBeGreaterThanOrEqual(0);
    const position = await database.position.findFirst({ where: { virtualAccountId: account.id } });
    expect(position === null || position.quantity >= 0).toBe(true);
  });

  it('stays reconciled after concurrent competing trades', async () => {
    const account = await createAccount();
    const instrument = await createInstrument(3_000_000); // expensive → contention on cash

    const contender = new PrismaClient({
      adapter: new PrismaBetterSqlite3({ url: databaseUrl, timeout: 50 }),
    });
    try {
      await Promise.all([
        submitBuyOrder(
          {
            orderId: randomUUID(),
            virtualAccountId: account.id,
            instrumentId: instrument.id,
            amountPaise: 3_000_000,
          },
          database,
          prices,
        ),
        submitBuyOrder(
          {
            orderId: randomUUID(),
            virtualAccountId: account.id,
            instrumentId: instrument.id,
            amountPaise: 3_000_000,
          },
          contender,
          new DatabaseMarketDataProvider(contender),
        ),
      ]);
    } finally {
      await contender.$disconnect();
    }

    expect(await reconcileAccount(account.id, database)).toEqual([]);
  });

  it('detects a corrupted balance (the checker is not vacuous)', async () => {
    const account = await createAccount();
    const instrument = await createInstrument(10_000);
    await buy(account.id, instrument.id, 5_000_00);

    // Tamper with the cash directly, bypassing the ledger.
    await database.virtualAccount.update({
      where: { id: account.id },
      data: { availableCashPaise: INITIAL_BALANCE_PAISE }, // wrong: ignores the buy
    });

    const violations = await reconcileAccount(account.id, database);
    expect(violations.map((v) => v.code)).toContain('CASH_MISMATCH');

    // Restore the true cash so the shared database is left reconciled.
    const ledger = await database.ledgerEntry.findMany({ where: { virtualAccountId: account.id } });
    await database.virtualAccount.update({
      where: { id: account.id },
      data: { availableCashPaise: ledger.reduce((sum, entry) => sum + entry.amountPaise, 0) },
    });
    expect(await reconcileAccount(account.id, database)).toEqual([]);
  });

  it('reconciles every account in the database', async () => {
    await createAccount();
    expect(await reconcileAllAccounts(database)).toEqual([]);
  });
});

async function createAccount() {
  const user = await registerUser(
    { name: 'Recon', email: `recon-${randomUUID()}@example.com`, password: 'tradeplay123' },
    database,
  );
  return database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });
}

async function createInstrument(pricePaise: number) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  const instrument = await database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `RCN-${suffix}`,
      companyName: `Recon ${suffix}`,
      isin: `TEST-${suffix}`,
      sector: 'Testing',
      industry: 'Testing',
      currency: 'INR',
    },
  });
  await database.priceCandle.create({
    data: {
      instrumentId: instrument.id,
      interval: CandleInterval.ONE_MINUTE,
      timestamp: new Date('2026-06-01T04:00:00.000Z'),
      openPaise: pricePaise,
      highPaise: pricePaise,
      lowPaise: pricePaise,
      closePaise: pricePaise,
      volume: 1_000,
      source: 'recon-test',
    },
  });
  return instrument;
}

function buy(virtualAccountId: string, instrumentId: string, amountPaise: number) {
  return submitBuyOrder(
    { orderId: randomUUID(), virtualAccountId, instrumentId, amountPaise },
    database,
    prices,
  );
}

function sell(virtualAccountId: string, instrumentId: string, quantity: number) {
  return submitSellOrder(
    { orderId: randomUUID(), virtualAccountId, instrumentId, quantity },
    database,
    prices,
  );
}

/** Deterministic LCG so the property test is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}
