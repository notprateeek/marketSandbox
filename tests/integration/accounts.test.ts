// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import { CandleInterval, PrismaClient } from '@/generated/prisma/client';
import { MAX_PAISE } from '@/lib/finance/currency';
import { DatabaseMarketDataProvider } from '@/server/market-data';
import {
  AccountError,
  addFunds,
  closeAccount,
  createAccount,
  getActiveAccountId,
  listPortfolios,
  setActiveAccount,
} from '@/server/services/accounts';
import { loadPortfolioForAccount } from '@/server/services/portfolio';
import { reconcileAccount } from '@/server/services/reconciliation';
import { INITIAL_BALANCE_PAISE, registerUser } from '@/server/services/register-user';
import { submitBuyOrder } from '@/server/services/submit-market-order';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;
let prices: DatabaseMarketDataProvider;

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
  prices = new DatabaseMarketDataProvider(database);
});

afterAll(async () => {
  await ephemeral.drop();
});

describe('multiple portfolios', () => {
  it('keeps balances, holdings and ledgers independent across accounts', async () => {
    const user = await registerUser(
      { name: 'Multi', email: `multi-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const primary = await database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });
    const experimental = await createAccount(
      { userId: user.id, name: 'Experimental', initialBalancePaise: 20_000_00n },
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
        amountPaise: 10_000_00n,
      },
      database,
      prices,
    ); // 100 shares, ₹10,000
    await submitBuyOrder(
      {
        orderId: randomUUID(),
        virtualAccountId: experimental.id,
        instrumentId: instrument.id,
        amountPaise: 5_000_00n,
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
    expect(primaryPortfolio?.availableCashPaise).toBe(INITIAL_BALANCE_PAISE - 10_000_00n);
    expect(experimentalPortfolio?.availableCashPaise).toBe(20_000_00n - 5_000_00n);

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
      { userId: user.id, name: 'Sector portfolio', initialBalancePaise: 10_000_00n },
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
      { userId: user.id, name: 'Historical challenge', initialBalancePaise: 10_000_00n },
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

describe('addFunds (simulated purchase)', () => {
  async function freshPrimary(label: string) {
    const user = await registerUser(
      { name: label, email: `${label}-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const primary = await database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });
    return { userId: user.id, accountId: primary.id };
  }

  it('credits half of the amount paid and stays reconciled', async () => {
    const { userId, accountId } = await freshPrimary('fund');

    await addFunds({ userId, accountId, amountPaidPaise: 100_000n }, database); // pay ₹1,000

    const account = await database.virtualAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.availableCashPaise).toBe(INITIAL_BALANCE_PAISE + 50_000n); // received ₹500
    // Purchased funds are new principal, so the cost basis rises too.
    expect(account.startingBalancePaise).toBe(INITIAL_BALANCE_PAISE + 50_000n);

    const adjustments = await database.ledgerEntry.findMany({
      where: { virtualAccountId: accountId, type: 'ADJUSTMENT' },
    });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].amountPaise).toBe(50_000n);
    expect(adjustments[0].balanceAfterPaise).toBe(account.availableCashPaise);

    expect(await reconcileAccount(accountId, database)).toEqual([]);
  });

  it('floors the credited amount at odd paise', async () => {
    const { userId, accountId } = await freshPrimary('floor');

    await addFunds({ userId, accountId, amountPaidPaise: 101n }, database); // 0.5 * 101 = 50.5

    const account = await database.virtualAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.availableCashPaise).toBe(INITIAL_BALANCE_PAISE + 50n);
    expect(await reconcileAccount(accountId, database)).toEqual([]);
  });

  it('rejects amounts that would overflow the maximum balance', async () => {
    const user = await registerUser(
      { name: 'Overflow', email: `overflow-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const brimming = await createAccount(
      { userId: user.id, name: 'Brimming', initialBalancePaise: MAX_PAISE },
      database,
    );

    await expect(
      addFunds({ userId: user.id, accountId: brimming.id, amountPaidPaise: 100n }, database),
    ).rejects.toBeInstanceOf(AccountError);
  });

  it('rejects an amount too small to credit anything', async () => {
    const { userId, accountId } = await freshPrimary('tiny');

    await expect(
      addFunds({ userId, accountId, amountPaidPaise: 1n }, database), // 0.5 * 1 floors to 0
    ).rejects.toBeInstanceOf(AccountError);
  });

  it("refuses to fund another user's portfolio", async () => {
    const owner = await freshPrimary('owner');
    const intruder = await freshPrimary('intruder');

    await expect(
      addFunds(
        { userId: intruder.userId, accountId: owner.accountId, amountPaidPaise: 100_000n },
        database,
      ),
    ).rejects.toBeInstanceOf(AccountError);
  });
});

describe('creating a portfolio funded by transfer', () => {
  it('moves cash and cost basis from the source, leaving both reconciled', async () => {
    const user = await registerUser(
      { name: 'Xfer', email: `xfer-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const primary = await database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });

    const funded = await createAccount(
      {
        userId: user.id,
        name: 'Sector portfolio',
        initialBalancePaise: 15_000_00n,
        transferFromAccountId: primary.id,
      },
      database,
    );

    const source = await database.virtualAccount.findUniqueOrThrow({ where: { id: primary.id } });
    const created = await database.virtualAccount.findUniqueOrThrow({ where: { id: funded.id } });

    // Source is debited in both cash and cost basis; destination is credited.
    expect(source.availableCashPaise).toBe(INITIAL_BALANCE_PAISE - 15_000_00n);
    expect(source.startingBalancePaise).toBe(INITIAL_BALANCE_PAISE - 15_000_00n);
    expect(created.availableCashPaise).toBe(15_000_00n);
    expect(created.startingBalancePaise).toBe(15_000_00n);

    // No money was created: the two ledgers still reconcile.
    expect(await reconcileAccount(primary.id, database)).toEqual([]);
    expect(await reconcileAccount(funded.id, database)).toEqual([]);
  });

  it('refuses to transfer more than the source has', async () => {
    const user = await registerUser(
      { name: 'Greedy', email: `greedy-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const primary = await database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });

    await expect(
      createAccount(
        {
          userId: user.id,
          name: 'Too big',
          initialBalancePaise: INITIAL_BALANCE_PAISE + 1n,
          transferFromAccountId: primary.id,
        },
        database,
      ),
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
