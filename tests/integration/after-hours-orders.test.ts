// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CandleInterval, OrderStatus, PrismaClient } from '@/generated/prisma/client';
import { DatabaseMarketDataProvider } from '@/server/market-data';
import { reconcileAccount } from '@/server/services/reconciliation';
import { INITIAL_BALANCE_PAISE, registerUser } from '@/server/services/register-user';
import {
  processPendingLiveOrders,
  queueBuyOrder,
  queueSellOrder,
} from '@/server/services/submit-market-order';

const databasePath = resolve(tmpdir(), `tradeplay-afterhours-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let database: PrismaClient;
let prices: DatabaseMarketDataProvider;

// 2026-07-15 is a Wednesday.
const MARKET_OPEN = new Date('2026-07-15T10:00:00+05:30'); // 10:00 IST, session open
const MARKET_CLOSED = new Date('2026-07-15T20:00:00+05:30'); // 20:00 IST, shut

beforeAll(() => {
  closeSync(openSync(databasePath, 'a'));
  execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  database = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl, timeout: 50 }) });
  prices = new DatabaseMarketDataProvider(database);
});

afterAll(async () => {
  await database.$disconnect();
  for (const suffix of ['', '-shm', '-wal', '-journal']) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
});

describe('after-hours order queuing', () => {
  it('queues a buy without moving cash, then fills it at the next open', async () => {
    const account = await createAccount();
    const instrument = await createInstrument();
    await addPrice(instrument.id, 10_000); // ₹100/share

    const orderId = randomUUID();
    const queued = await queueBuyOrder(
      { orderId, virtualAccountId: account.id, instrumentId: instrument.id, amountPaise: 50_000 },
      database,
      prices,
    );

    // Queued, not filled — no cash or shares have moved.
    expect(queued.status).toBe(OrderStatus.PENDING);
    expect(queued.requestedQuantity).toBe(5); // ₹500 / ₹100
    const afterQueue = await database.virtualAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(afterQueue.availableCashPaise).toBe(INITIAL_BALANCE_PAISE);
    expect(await database.tradeExecution.count({ where: { orderId } })).toBe(0);

    // A pass while the market is shut does nothing.
    expect(await processPendingLiveOrders(account.id, database, prices, MARKET_CLOSED)).toBe(0);
    const stillPending = await database.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(stillPending.status).toBe(OrderStatus.PENDING);

    // A pass once open fills it at the current price.
    expect(await processPendingLiveOrders(account.id, database, prices, MARKET_OPEN)).toBe(1);
    const filled = await database.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(filled.status).toBe(OrderStatus.FILLED);
    expect(filled.filledQuantity).toBe(5);

    await expectReconciled(account.id, INITIAL_BALANCE_PAISE - 50_000); // 5 × ₹100
  });

  it('rejects an unaffordable queued buy at submission', async () => {
    const account = await createAccount();
    const instrument = await createInstrument();
    await addPrice(instrument.id, 10_000);

    const queued = await queueBuyOrder(
      {
        orderId: randomUUID(),
        virtualAccountId: account.id,
        instrumentId: instrument.id,
        amountPaise: INITIAL_BALANCE_PAISE + 10_000, // more than the account holds
      },
      database,
      prices,
    );
    expect(queued.status).toBe(OrderStatus.REJECTED);
  });

  it('queues and fills a sell of owned shares', async () => {
    const account = await createAccount();
    const instrument = await createInstrument();
    await addPrice(instrument.id, 10_000);

    // Acquire shares first via a queued+filled buy.
    const buyId = randomUUID();
    await queueBuyOrder(
      { orderId: buyId, virtualAccountId: account.id, instrumentId: instrument.id, amountPaise: 100_000 },
      database,
      prices,
    );
    await processPendingLiveOrders(account.id, database, prices, MARKET_OPEN); // 10 shares

    const sellId = randomUUID();
    const queuedSell = await queueSellOrder(
      { orderId: sellId, virtualAccountId: account.id, instrumentId: instrument.id, quantity: 4 },
      database,
      prices,
    );
    expect(queuedSell.status).toBe(OrderStatus.PENDING);

    await processPendingLiveOrders(account.id, database, prices, MARKET_OPEN);
    const filled = await database.order.findUniqueOrThrow({ where: { id: sellId } });
    expect(filled.status).toBe(OrderStatus.FILLED);

    const position = await database.position.findUniqueOrThrow({
      where: { virtualAccountId_instrumentId: { virtualAccountId: account.id, instrumentId: instrument.id } },
    });
    expect(position.quantity).toBe(6); // 10 bought − 4 sold
    expect(await reconcileAccount(account.id, database)).toEqual([]);
  });
});

async function createAccount() {
  const user = await registerUser(
    { name: 'After Hours', email: `afterhours-${randomUUID()}@example.com`, password: 'tradeplay123' },
    database,
  );
  return database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });
}

async function createInstrument() {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  return database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `AH${suffix}`,
      companyName: `After Hours ${suffix}`,
      isin: `TEST-${suffix}`,
      sector: 'Testing',
      industry: 'Testing',
      currency: 'INR',
    },
  });
}

function addPrice(instrumentId: string, pricePaise: number) {
  return database.priceCandle.create({
    data: {
      instrumentId,
      interval: CandleInterval.ONE_MINUTE,
      timestamp: new Date('2026-07-14T04:00:00.000Z'),
      openPaise: pricePaise,
      highPaise: pricePaise,
      lowPaise: pricePaise,
      closePaise: pricePaise,
      volume: 1_000,
      source: 'afterhours-test',
    },
  });
}

async function expectReconciled(virtualAccountId: string, expectedCashPaise: number) {
  const account = await database.virtualAccount.findUniqueOrThrow({ where: { id: virtualAccountId } });
  expect(account.availableCashPaise).toBe(expectedCashPaise);
  expect(await reconcileAccount(virtualAccountId, database)).toEqual([]);
}
