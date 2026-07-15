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
import {
  AccountError,
  closeAccount,
  createAccount,
  getActiveAccountId,
  listPortfolios,
  setActiveAccount,
} from '@/server/services/accounts';
import { loadPortfolioForAccount } from '@/server/services/portfolio';
import { INITIAL_BALANCE_PAISE, registerUser } from '@/server/services/register-user';
import { submitBuyOrder } from '@/server/services/submit-market-order';

const databasePath = resolve(tmpdir(), `tradeplay-accounts-${randomUUID()}.db`);
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

describe('multiple portfolios', () => {
  it('keeps balances, holdings and ledgers independent across accounts', async () => {
    const user = await registerUser(
      { name: 'Multi', email: `multi-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const primary = await database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });
    const experimental = await createAccount(
      { userId: user.id, name: 'Experimental', initialBalancePaise: 20_000_00 },
      database,
    );

    const instrument = await createInstrument();
    await addPrice(instrument.id, 10_000); // ₹100 per share

    // Different-sized buys in each account.
    await submitBuyOrder(
      {
        orderId: randomUUID(),
        virtualAccountId: primary.id,
        instrumentId: instrument.id,
        amountPaise: 10_000_00,
      },
      database,
      prices,
    ); // 100 shares, ₹10,000
    await submitBuyOrder(
      {
        orderId: randomUUID(),
        virtualAccountId: experimental.id,
        instrumentId: instrument.id,
        amountPaise: 5_000_00,
      },
      database,
      prices,
    ); // 50 shares, ₹5,000

    // Balances are independent.
    const primaryPortfolio = await loadPortfolioForAccount(primary.id, {}, database, prices);
    const experimentalPortfolio = await loadPortfolioForAccount(
      experimental.id,
      {},
      database,
      prices,
    );
    expect(primaryPortfolio?.availableCashPaise).toBe(INITIAL_BALANCE_PAISE - 10_000_00);
    expect(experimentalPortfolio?.availableCashPaise).toBe(20_000_00 - 5_000_00);

    // Holdings are independent.
    expect(primaryPortfolio?.holdings[0].quantity).toBe(100);
    expect(experimentalPortfolio?.holdings[0].quantity).toBe(50);

    // Ledgers are independent (opening credit + one buy each).
    expect(await database.ledgerEntry.count({ where: { virtualAccountId: primary.id } })).toBe(2);
    expect(await database.ledgerEntry.count({ where: { virtualAccountId: experimental.id } })).toBe(
      2,
    );
  });

  it('switches the active account without mixing accounts', async () => {
    const user = await registerUser(
      { name: 'Switch', email: `switch-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const primary = await database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });
    const other = await createAccount(
      { userId: user.id, name: 'Sector portfolio', initialBalancePaise: 10_000_00 },
      database,
    );

    // Creating a portfolio makes it active.
    expect(await getActiveAccountId(user.id, database)).toBe(other.id);

    await setActiveAccount({ userId: user.id, accountId: primary.id }, database);
    expect(await getActiveAccountId(user.id, database)).toBe(primary.id);
  });

  it('closes an account as a soft-close, keeping its ledger auditable', async () => {
    const user = await registerUser(
      { name: 'Close', email: `close-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const primary = await database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });
    const disposable = await createAccount(
      { userId: user.id, name: 'Historical challenge', initialBalancePaise: 10_000_00 },
      database,
    );

    await closeAccount({ userId: user.id, accountId: disposable.id }, database);

    // Excluded from the portfolio list and never resolved as active...
    const remaining = await listPortfolios(user.id, database);
    expect(remaining.map((portfolio) => portfolio.id)).toEqual([primary.id]);
    expect(await getActiveAccountId(user.id, database)).toBe(primary.id);

    // ...but the account row and its ledger survive for audit.
    const closed = await database.virtualAccount.findUniqueOrThrow({
      where: { id: disposable.id },
    });
    expect(closed.status).toBe('CLOSED');
    expect(await database.ledgerEntry.count({ where: { virtualAccountId: disposable.id } })).toBe(
      1,
    );
  });

  it('refuses to close the last open portfolio', async () => {
    const user = await registerUser(
      { name: 'Last', email: `last-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const only = await database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });

    await expect(
      closeAccount({ userId: user.id, accountId: only.id }, database),
    ).rejects.toBeInstanceOf(AccountError);
  });
});

async function createInstrument() {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  return database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `ACC-${suffix}`,
      companyName: `Acc ${suffix}`,
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
      timestamp: new Date('2026-06-01T04:00:00.000Z'),
      openPaise: pricePaise,
      highPaise: pricePaise,
      lowPaise: pricePaise,
      closePaise: pricePaise,
      volume: 1_000,
      source: 'accounts-test',
    },
  });
}
