// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import { CandleInterval, OrderSide, OrderStatus, PrismaClient } from '@/generated/prisma/client';
import { MarketDataUnavailableError, SimulationMarketDataProvider } from '@/server/market-data';
import { registerUser } from '@/server/services/register-user';
import {
  advanceSimulation,
  createSimulation,
  loadSimulation,
  resetSimulation,
  submitSimulationOrder,
} from '@/server/services/simulation';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;

// Four consecutive minute candles. Opens are distinct from closes so a fill can
// be traced to the *next* candle's open rather than the current candle.
const T0 = new Date('2026-06-15T03:45:00.000Z');
const T1 = new Date('2026-06-15T03:46:00.000Z');
const T2 = new Date('2026-06-15T03:47:00.000Z');
const T3 = new Date('2026-06-15T03:48:00.000Z');
const INITIAL = 50_000_00n;

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
});

afterAll(async () => {
  await ephemeral.drop();
});

describe('SimulationMarketDataProvider — fill timing and look-ahead', () => {
  it('fills at the next candle open, clamps reads, and rejects when no later candle exists', async () => {
    const instrument = await createInstrument();
    await candles(instrument.id);

    // Submitted at T0 → fills at the OPEN of T1 (10,500), never the T0 candle.
    const atT0 = await new SimulationMarketDataProvider(T0, database).getLatestPrice(instrument.id);
    expect(atT0.pricePaise).toBe(10_500n);
    expect(atT0.timestamp).toEqual(T1);

    // Before any candle → first candle's open.
    const early = new Date(T0.getTime() - 60_000);
    expect(
      (await new SimulationMarketDataProvider(early, database).getLatestPrice(instrument.id))
        .pricePaise,
    ).toBe(10_000n);

    // Reads never see the future: at T2, a request for T3 is clamped to T2's close.
    const priceAtT2 = await new SimulationMarketDataProvider(T2, database).getPriceAt(
      instrument.id,
      T3,
    );
    expect(priceAtT2?.pricePaise).toBe(11_100n);

    // At the last candle there is no later candle to fill against → reject.
    await expect(
      new SimulationMarketDataProvider(T3, database).getLatestPrice(instrument.id),
    ).rejects.toBeInstanceOf(MarketDataUnavailableError);
  });
});

describe('createSimulation + submitSimulationOrder', () => {
  it('ties fills to simulation time and never uses a future price for valuation', async () => {
    const user = await createUser();
    const instrument = await createInstrument();
    await candles(instrument.id);

    const sim = await createSimulation(
      { userId: user.id, name: 'Look-ahead', startTimestamp: T0, initialBalancePaise: INITIAL },
      database,
    );

    const order = await submitSimulationOrder(
      {
        sessionId: sim.id,
        userId: user.id,
        side: OrderSide.BUY,
        instrumentId: instrument.id,
        amountPaise: 1_000_00n,
      },
      database,
    );

    // Filled at T1 open (10,500): floor(100000 / 10500) = 9 shares.
    expect(order.status).toBe(OrderStatus.FILLED);
    expect(order.pricePaise).toBe(10_500n);
    expect(order.filledQuantity).toBe(9);

    const execution = await database.tradeExecution.findFirstOrThrow({
      where: { virtualAccountId: sim.virtualAccountId },
    });
    expect(execution.simulationTimestamp).toEqual(T1);

    // Clock still at T0 → holding valued at the T0 close (10,100), not any future price.
    const atStart = await loadSimulation(sim.id, user.id, database);
    expect(atStart?.portfolio?.holdings[0].currentPricePaise).toBe(10_100n);

    // Move to T2 → valued at the T2 close (11,100); the future T3 open/close is never used.
    await advanceSimulation(
      { sessionId: sim.id, userId: user.id, step: 'CUSTOM', customTimestamp: T2 },
      database,
    );
    const atT2 = await loadSimulation(sim.id, user.id, database);
    expect(atT2?.portfolio?.holdings[0].currentPricePaise).toBe(11_100n);
    expect(atT2?.session.currentTimestamp).toEqual(T2); // state persisted to the DB
  });

  it('is deterministic: identical actions produce identical outcomes', async () => {
    const user = await createUser();
    const instrument = await createInstrument();
    await candles(instrument.id);

    const outcomes = [];
    for (const name of ['Run A', 'Run B']) {
      const sim = await createSimulation(
        { userId: user.id, name, startTimestamp: T0, initialBalancePaise: INITIAL },
        database,
      );
      await submitSimulationOrder(
        {
          sessionId: sim.id,
          userId: user.id,
          side: OrderSide.BUY,
          instrumentId: instrument.id,
          amountPaise: 1_000_00n,
        },
        database,
      );
      const account = await database.virtualAccount.findUniqueOrThrow({
        where: { id: sim.virtualAccountId },
        include: { positions: true },
      });
      outcomes.push({
        cash: account.availableCashPaise,
        quantity: account.positions[0]?.quantity,
        totalCost: account.positions[0]?.totalCostPaise,
      });
    }

    expect(outcomes[0]).toEqual(outcomes[1]);
  });
});

describe('advanceSimulation — completion', () => {
  it('stops at the end and marks the run completed', async () => {
    const user = await createUser();
    const instrument = await createInstrument();
    await candles(instrument.id);
    const sim = await createSimulation(
      { userId: user.id, name: 'To the end', startTimestamp: T0, initialBalancePaise: INITIAL },
      database,
    );

    // End is the last candle (T3); jumping past it clamps and completes.
    const advanced = await advanceSimulation(
      {
        sessionId: sim.id,
        userId: user.id,
        step: 'CUSTOM',
        customTimestamp: new Date(T3.getTime() + 60_000),
      },
      database,
    );
    expect(advanced.currentTimestamp).toEqual(T3);
    expect(advanced.status).toBe('COMPLETED');
  });
});

describe('resetSimulation', () => {
  it('restores the account and leaves other simulations untouched', async () => {
    const user = await createUser();
    const instrument = await createInstrument();
    await candles(instrument.id);

    const kept = await createSimulation(
      { userId: user.id, name: 'Kept', startTimestamp: T0, initialBalancePaise: INITIAL },
      database,
    );
    const target = await createSimulation(
      { userId: user.id, name: 'Reset me', startTimestamp: T0, initialBalancePaise: INITIAL },
      database,
    );
    const buy = (sessionId: string) =>
      submitSimulationOrder(
        {
          sessionId,
          userId: user.id,
          side: OrderSide.BUY,
          instrumentId: instrument.id,
          amountPaise: 1_000_00n,
        },
        database,
      );
    await buy(kept.id);
    await buy(target.id);
    await advanceSimulation({ sessionId: target.id, userId: user.id, step: 'MINUTE' }, database);

    const afterReset = await resetSimulation({ sessionId: target.id, userId: user.id }, database);

    // Same account, rewound to its opening state.
    expect(afterReset.currentTimestamp).toEqual(T0);
    expect(afterReset.status).toBe('ACTIVE');
    expect(afterReset.virtualAccountId).toBe(target.virtualAccountId);

    const targetAccount = await database.virtualAccount.findUniqueOrThrow({
      where: { id: target.virtualAccountId },
      include: { positions: true, ledgerEntries: true },
    });
    expect(targetAccount.availableCashPaise).toBe(INITIAL);
    expect(targetAccount.positions).toHaveLength(0);
    // The immutable opening credit is preserved; nothing else remains.
    expect(targetAccount.ledgerEntries).toHaveLength(1);
    expect(targetAccount.ledgerEntries[0].type).toBe('INITIAL_CREDIT');

    // The other simulation's ledger and holdings are intact.
    const keptAccount = await database.virtualAccount.findUniqueOrThrow({
      where: { id: kept.virtualAccountId },
      include: { positions: true },
    });
    expect(keptAccount.positions).toHaveLength(1);
    expect(keptAccount.availableCashPaise).toBeLessThan(INITIAL);
  });
});

async function createUser() {
  return registerUser(
    { name: 'Sim User', email: `sim-${randomUUID()}@example.com`, password: 'tradeplay123' },
    database,
  );
}

async function createInstrument() {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  return database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `SIM-${suffix}`,
      companyName: `Sim ${suffix}`,
      isin: `TEST-${suffix}`,
      sector: 'Testing',
      industry: 'Testing',
      currency: 'INR',
    },
  });
}

async function candles(instrumentId: string) {
  const rows: [Date, number, number][] = [
    [T0, 10_000, 10_100],
    [T1, 10_500, 10_600],
    [T2, 11_000, 11_100],
    [T3, 12_000, 12_100],
  ];
  for (const [timestamp, openPaise, closePaise] of rows) {
    await database.priceCandle.create({
      data: {
        instrumentId,
        interval: CandleInterval.ONE_MINUTE,
        timestamp,
        openPaise,
        highPaise: Math.max(openPaise, closePaise) + 50,
        lowPaise: Math.min(openPaise, closePaise) - 50,
        closePaise,
        volume: 1_000,
        source: 'sim-test',
      },
    });
  }
}
