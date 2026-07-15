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
import { loadJournal, saveJournalEntry } from '@/server/services/journal';
import { registerUser } from '@/server/services/register-user';
import { submitBuyOrder } from '@/server/services/submit-market-order';
import {
  addWatchlistItem,
  createWatchlist,
  loadWatchlistItems,
  moveWatchlistItem,
  WatchlistError,
} from '@/server/services/watchlist';

const databasePath = resolve(tmpdir(), `tradeplay-org-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let database: PrismaClient;

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

describe('watchlists', () => {
  it('keeps entries unique per watchlist and reorders items', async () => {
    const user = await registerUser(
      { name: 'W', email: `w-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const list = await createWatchlist({ userId: user.id, name: 'Tech' }, database);
    const a = await createInstrument('AAA');
    const b = await createInstrument('BBB');

    await addWatchlistItem({ userId: user.id, watchlistId: list.id, instrumentId: a.id }, database);
    await addWatchlistItem({ userId: user.id, watchlistId: list.id, instrumentId: b.id }, database);

    // Adding the same instrument again is rejected (unique per watchlist).
    await expect(
      addWatchlistItem({ userId: user.id, watchlistId: list.id, instrumentId: a.id }, database),
    ).rejects.toBeInstanceOf(WatchlistError);

    // The same instrument CAN live on a different watchlist.
    const other = await createWatchlist({ userId: user.id, name: 'Watch 2' }, database);
    await addWatchlistItem(
      { userId: user.id, watchlistId: other.id, instrumentId: a.id },
      database,
    );

    // Reorder: B starts second, move it up to first.
    const prices = new DatabaseMarketDataProvider(database);
    let items = await loadWatchlistItems(list.id, user.id, database, prices);
    expect(items.map((item) => item.instrumentId)).toEqual([a.id, b.id]);

    await moveWatchlistItem(
      { userId: user.id, itemId: items[1].itemId, direction: 'UP' },
      database,
    );
    items = await loadWatchlistItems(list.id, user.id, database, prices);
    expect(items.map((item) => item.instrumentId)).toEqual([b.id, a.id]);
  });
});

describe('investment journal', () => {
  it('keeps a journal entry connected to its trade', async () => {
    const user = await registerUser(
      { name: 'J', email: `j-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const account = await database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });
    const instrument = await createInstrument('JRN');
    await database.priceCandle.create({
      data: {
        instrumentId: instrument.id,
        interval: CandleInterval.ONE_MINUTE,
        timestamp: new Date('2026-06-01T04:00:00.000Z'),
        openPaise: 10_000,
        highPaise: 10_000,
        lowPaise: 10_000,
        closePaise: 10_000,
        volume: 1_000,
        source: 'org-test',
      },
    });

    const order = await submitBuyOrder(
      {
        orderId: randomUUID(),
        virtualAccountId: account.id,
        instrumentId: instrument.id,
        amountPaise: 10_000_00,
      },
      database,
      new DatabaseMarketDataProvider(database),
    );

    await saveJournalEntry(
      {
        userId: user.id,
        orderId: order.orderId,
        fields: { reason: 'Undervalued', confidence: 4, intendedHoldingPeriod: '6 months' },
      },
      database,
    );

    // Saving again upserts the same entry (still one per trade).
    await saveJournalEntry(
      {
        userId: user.id,
        orderId: order.orderId,
        fields: { reason: 'Undervalued and growing', confidence: 5 },
      },
      database,
    );

    const entry = await database.journalEntry.findUniqueOrThrow({
      where: { orderId: order.orderId },
    });
    expect(entry.orderId).toBe(order.orderId); // connected to the trade
    expect(entry.reason).toBe('Undervalued and growing');
    expect(entry.confidence).toBe(5);

    const trades = await loadJournal({ userId: user.id, virtualAccountId: account.id }, database);
    const journaled = trades.find((trade) => trade.orderId === order.orderId);
    expect(journaled?.entry?.confidence).toBe(5);
    expect(journaled?.entry?.intendedHoldingPeriod).toBe('6 months');
  });
});

async function createInstrument(prefix: string) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  return database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `${prefix}-${suffix}`,
      companyName: `${prefix} ${suffix}`,
      isin: `TEST-${suffix}`,
      sector: 'Testing',
      industry: 'Testing',
      currency: 'INR',
    },
  });
}
