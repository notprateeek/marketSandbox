// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import { CandleInterval, PrismaClient } from '@/generated/prisma/client';
import { DatabaseMarketDataProvider } from '@/server/market-data';
import { INITIAL_BALANCE_PAISE, registerUser } from '@/server/services/register-user';
import { loadPortfolioSummary } from '@/server/services/portfolio';
import { submitBuyOrder } from '@/server/services/submit-market-order';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;
let prices: DatabaseMarketDataProvider;

const BUY_TIME = new Date('2026-07-14T03:45:00.000Z');
const VALUATION_TIME = new Date('2026-07-14T03:50:00.000Z');

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
  prices = new DatabaseMarketDataProvider(database);
});

afterAll(async () => {
  await ephemeral.drop();
});

describe('loadPortfolioSummary — worked example with real whole-share fills', () => {
  it('values holdings after a 40% fall, keeps the remaining cash, and reconciles to the ledger', async () => {
    const account = await createAccount();
    // Prices chosen so ₹10k / ₹20k / ₹20k buys leave ₹200 of unspendable cash each.
    const tata = await createInstrument('TATAMOTORS');
    const titan = await createInstrument('TITAN');
    const asian = await createInstrument('ASIANPAINT');
    await Promise.all([
      addPrice(tata.id, 70_000, BUY_TIME),
      addPrice(titan.id, 110_000, BUY_TIME),
      addPrice(asian.id, 90_000, BUY_TIME),
    ]);

    await buy(account.id, tata.id, 10_000_00n);
    await buy(account.id, titan.id, 20_000_00n);
    await buy(account.id, asian.id, 20_000_00n);

    // Each price falls 40% at the valuation time (60% of the buy price).
    await Promise.all([
      addPrice(tata.id, 42_000, VALUATION_TIME),
      addPrice(titan.id, 66_000, VALUATION_TIME),
      addPrice(asian.id, 54_000, VALUATION_TIME),
    ]);

    const summary = await loadPortfolioSummary(
      account.userId,
      { valuationTimestamp: VALUATION_TIME },
      database,
      prices,
    );
    if (!summary) throw new Error('portfolio summary should exist');

    // Fills: Tata 14 sh @700 = ₹9,800; Titan 18 @1,100 = ₹19,800; Asian 22 @900 = ₹19,800.
    // Spent ₹49,400, ₹600 cash remains. After the fall holdings are worth ₹29,640.
    expect(summary.startingBalancePaise).toBe(INITIAL_BALANCE_PAISE); // ₹50,000
    expect(summary.availableCashPaise).toBe(600_00n);
    expect(summary.investedValuePaise).toBe(49_400_00n);
    expect(summary.holdingsValuePaise).toBe(29_640_00n);
    expect(summary.portfolioValuePaise).toBe(30_240_00n);
    expect(summary.totalPnlPaise).toBe(-19_760_00n);
    expect(summary.realizedPnlPaise).toBe(0n);

    // Reconciliation identities.
    expect(summary.portfolioValuePaise).toBe(
      summary.availableCashPaise + summary.holdingsValuePaise,
    );
    expect(summary.totalPnlPaise).toBe(summary.realizedPnlPaise + summary.unrealizedPnlPaise);
    expect(summary.availableCashPaise).toBe(await ledgerBalance(account.id));

    // Actual return is ~-39.52%, close to the ideal -40% (whole-share rounding + spare cash).
    expect(summary.totalReturnPercent).toBeCloseTo(-39.52, 2);
    expect(summary.totalReturnPercent).toBeCloseTo(-40, 0);

    expect(summary.hasPricingGaps).toBe(false);
    expect(summary.missingPriceCount).toBe(0);
    expect(summary.priceDataTimestamp).toEqual(VALUATION_TIME);
    expect(summary.holdings.every((h) => h.returnPercent! < 0)).toBe(true);
  });

  it('flags a holding with no price data instead of valuing it at zero', async () => {
    const account = await createAccount();
    const priced = await createInstrument('RELIANCE');
    const unpriced = await createInstrument('INFY');
    await Promise.all([
      addPrice(priced.id, 100_000, BUY_TIME),
      addPrice(unpriced.id, 50_000, BUY_TIME),
    ]);
    await buy(account.id, priced.id, 10_000_00n);
    await buy(account.id, unpriced.id, 10_000_00n);

    // The second instrument loses all its market data after the fill.
    await database.priceCandle.deleteMany({ where: { instrumentId: unpriced.id } });
    await addPrice(priced.id, 120_000, VALUATION_TIME);

    const summary = await loadPortfolioSummary(
      account.userId,
      { valuationTimestamp: VALUATION_TIME },
      database,
      prices,
    );
    if (!summary) throw new Error('portfolio summary should exist');

    expect(summary.hasPricingGaps).toBe(true);
    expect(summary.missingPriceCount).toBe(1);
    expect(summary.pricedCount).toBe(1);

    const missing = summary.holdings.find((h) => h.instrumentId === unpriced.id);
    expect(missing?.priceStatus).toBe('MISSING');
    expect(missing?.marketValuePaise).toBeNull();

    // Holdings value counts only the priced holding — the gap is never silently zero.
    const priceHolding = summary.holdings.find((h) => h.instrumentId === priced.id);
    expect(summary.holdingsValuePaise).toBe(priceHolding!.marketValuePaise);
  });
});

async function createAccount() {
  const user = await registerUser(
    {
      name: 'Portfolio Test User',
      email: `portfolio-${randomUUID()}@example.com`,
      password: 'tradeplay123',
    },
    database,
  );
  const account = await database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });
  return { ...account, userId: user.id };
}

async function createInstrument(symbol: string) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  return database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `${symbol}-${suffix}`,
      companyName: `${symbol} Test`,
      isin: `TEST-${suffix}`,
      sector: 'Testing',
      industry: 'Testing',
      currency: 'INR',
    },
  });
}

function addPrice(instrumentId: string, pricePaise: number, timestamp: Date) {
  return database.priceCandle.create({
    data: {
      instrumentId,
      interval: CandleInterval.ONE_MINUTE,
      timestamp,
      openPaise: pricePaise,
      highPaise: pricePaise,
      lowPaise: pricePaise,
      closePaise: pricePaise,
      volume: 1_000,
      source: 'portfolio-test',
    },
  });
}

function buy(virtualAccountId: string, instrumentId: string, amountPaise: bigint) {
  return submitBuyOrder(
    { orderId: randomUUID(), virtualAccountId, instrumentId, amountPaise },
    database,
    prices,
  );
}

async function ledgerBalance(virtualAccountId: string) {
  const entries = await database.ledgerEntry.findMany({ where: { virtualAccountId } });
  return entries.reduce((sum, entry) => sum + entry.amountPaise, 0n);
}
