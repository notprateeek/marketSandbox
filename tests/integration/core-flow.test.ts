// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import { CandleInterval, OrderSide, PrismaClient } from '@/generated/prisma/client';
import { DatabaseMarketDataProvider } from '@/server/market-data';
import { loadPortfolioForAccount } from '@/server/services/portfolio';
import { reconcileAccount } from '@/server/services/reconciliation';
import { INITIAL_BALANCE_PAISE, registerUser } from '@/server/services/register-user';
import {
  advanceSimulation,
  createSimulation,
  loadSimulation,
  submitSimulationOrder,
} from '@/server/services/simulation';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;

// Tata Motors daily candles: buy at D1 fills at D2 open, sell at D3 fills at D4 open.
const D1 = new Date('2026-06-01T10:00:00.000Z');
const D2 = new Date('2026-06-02T10:00:00.000Z');
const D3 = new Date('2026-06-03T10:00:00.000Z');
const D4 = new Date('2026-06-04T10:00:00.000Z');

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
});

afterAll(async () => {
  await ephemeral.drop();
});

describe('core end-to-end flow', () => {
  it('registers, funds, trades in a simulation, advances time, sells and reconciles', async () => {
    // 1. Register.
    const user = await registerUser(
      { name: 'Core Flow', email: `core-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );

    // 2. Receive ₹50,000.
    const primary = await database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });
    expect(primary.availableCashPaise).toBe(INITIAL_BALANCE_PAISE); // ₹50,000.00

    // 3. Search Tata Motors.
    const tata = await seedTataMotors();
    const results = await new DatabaseMarketDataProvider(database).searchInstruments('Tata Motors');
    expect(results.some((r) => r.symbol === 'TATAMOTORS')).toBe(true);

    // 4. Buy shares (in a ₹50,000 historical simulation).
    const sim = await createSimulation(
      {
        userId: user.id,
        name: 'Core flow',
        startTimestamp: D1,
        initialBalancePaise: INITIAL_BALANCE_PAISE,
      },
      database,
    );
    const buy = await submitSimulationOrder(
      {
        sessionId: sim.id,
        userId: user.id,
        side: OrderSide.BUY,
        instrumentId: tata.id,
        amountPaise: 20_000_00n,
      },
      database,
    );
    expect(buy.status).toBe('FILLED');
    expect(buy.filledQuantity).toBe(18); // ₹20,000 / ₹1,100 (D2 open) = 18 whole shares

    // 5. Confirm reduced cash.
    const afterBuy = await database.virtualAccount.findUniqueOrThrow({
      where: { id: sim.virtualAccountId },
    });
    expect(afterBuy.availableCashPaise).toBe(INITIAL_BALANCE_PAISE - 19_800_00n); // 18 × ₹1,100
    expect(afterBuy.availableCashPaise).toBeLessThan(INITIAL_BALANCE_PAISE);

    // 6. Confirm holding.
    const position = await database.position.findFirstOrThrow({
      where: { virtualAccountId: sim.virtualAccountId },
    });
    expect(position.quantity).toBe(18);

    // ...P&L before advancing (valued at the D1 price).
    const beforeAdvance = await loadSimulation(sim.id, user.id, database);
    const pnlBefore = beforeAdvance!.portfolio!.totalPnlPaise;

    // 7. Advance simulation time.
    await advanceSimulation(
      { sessionId: sim.id, userId: user.id, step: 'CUSTOM', customTimestamp: D3 },
      database,
    );

    // 8. Confirm changed P&L.
    const afterAdvance = await loadSimulation(sim.id, user.id, database);
    const pnlAfter = afterAdvance!.portfolio!.totalPnlPaise;
    expect(pnlAfter).not.toBe(pnlBefore);
    expect(pnlAfter).toBe(3_600_00n); // 18 × (₹1,300 − ₹1,100) = +₹3,600 unrealized

    // 9. Sell part of the position.
    const sell = await submitSimulationOrder(
      {
        sessionId: sim.id,
        userId: user.id,
        side: OrderSide.SELL,
        instrumentId: tata.id,
        quantity: 9,
      },
      database,
    );
    expect(sell.status).toBe('FILLED');
    expect(sell.pricePaise).toBe(125_000n); // D4 open

    // 10. Confirm realized P&L and ledger reconciliation.
    const soldPosition = await database.position.findFirstOrThrow({
      where: { virtualAccountId: sim.virtualAccountId },
    });
    expect(soldPosition.quantity).toBe(9);
    expect(soldPosition.realizedPnlPaise).toBe(1_350_00n); // 9 × (₹1,250 − ₹1,100)

    expect(await reconcileAccount(sim.virtualAccountId, database)).toEqual([]);

    // Portfolio identity holds: total P&L = realized + unrealized.
    const finalPortfolio = await loadPortfolioForAccount(
      sim.virtualAccountId,
      { valuationTimestamp: D3 },
      database,
      new DatabaseMarketDataProvider(database),
    );
    expect(finalPortfolio!.totalPnlPaise).toBe(
      finalPortfolio!.realizedPnlPaise + finalPortfolio!.unrealizedPnlPaise,
    );

    // The user's personal ₹50,000 account is untouched by the simulation.
    const primaryAfter = await database.virtualAccount.findUniqueOrThrow({
      where: { id: primary.id },
    });
    expect(primaryAfter.availableCashPaise).toBe(INITIAL_BALANCE_PAISE);
  });
});

async function seedTataMotors() {
  const instrument = await database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: 'TATAMOTORS',
      companyName: 'Tata Motors Limited',
      isin: 'INE155A01022',
      sector: 'Automobile',
      industry: 'Passenger Cars & Utility Vehicles',
      currency: 'INR',
    },
  });
  const rows: [Date, number][] = [
    [D1, 100_000], // ₹1,000
    [D2, 110_000], // ₹1,100 — buy fills here
    [D3, 130_000], // ₹1,300 — advance/value here
    [D4, 125_000], // ₹1,250 — sell fills here
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
        source: 'core-flow-test',
      },
    });
  }
  return instrument;
}
