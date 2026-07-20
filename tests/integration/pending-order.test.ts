// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import { CandleInterval, OrderSide, OrderType, PrismaClient } from '@/generated/prisma/client';
import { registerUser } from '@/server/services/register-user';
import { executePendingOrder, TradingRejectionReason } from '@/server/services/submit-market-order';
import {
  advanceSimulation,
  cancelSimulationOrder,
  createSimulation,
  submitPendingSimulationOrder,
  SimulationError,
} from '@/server/services/simulation';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;

const D1 = new Date('2026-06-01T10:00:00.000Z');
const D2 = new Date('2026-06-02T10:00:00.000Z');
const D3 = new Date('2026-06-03T10:00:00.000Z');

type CandleRow = [Date, number, number, number, number]; // timestamp, open, high, low, close

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
});

afterAll(async () => {
  await ephemeral.drop();
});

describe('pending limit & stop-loss orders', () => {
  it('triggers a buy limit at the historical price and cannot execute twice', async () => {
    const { user, sim, instrument } = await setup(50_000_00n, [
      [D1, 100_000, 100_000, 100_000, 100_000],
      [D2, 98_000, 99_000, 94_000, 96_000], // low 94,000 dips to the 95,000 limit
      [D3, 96_000, 97_000, 95_000, 96_500],
    ]);

    const order = await placeLimit(sim, user, instrument, OrderSide.BUY, 10, 95_000n);
    await advance(sim, user, D2);

    const filled = await getOrder(order.id);
    expect(filled.status).toBe('FILLED');
    expect(filled.triggeredAt).toEqual(D2);
    const execution = await database.tradeExecution.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    expect(execution.pricePaise).toBe(95_000n); // filled at the limit, within the candle range
    expect(execution.quantity).toBe(10);
    expect(await cash(sim)).toBe(50_000_00n - 9_500_00n);

    // A second execution attempt is a no-op — no duplicate fill.
    const again = await executePendingOrder(
      { orderId: order.id, pricePaise: 95_000n, executedAt: D2, triggeredAt: D2 },
      database,
    );
    expect(again.status).toBe('SKIPPED');
    expect(await database.tradeExecution.count({ where: { orderId: order.id } })).toBe(1);
    expect(await cash(sim)).toBe(50_000_00n - 9_500_00n);
  });

  it('fills at the open when the candle gaps through the limit', async () => {
    const { user, sim, instrument } = await setup(50_000_00n, [
      [D1, 100_000, 100_000, 100_000, 100_000],
      [D2, 90_000, 91_000, 89_000, 90_500], // gapped open 90,000, below the 95,000 limit
    ]);

    const order = await placeLimit(sim, user, instrument, OrderSide.BUY, 10, 95_000n);
    await advance(sim, user, D2);

    const execution = await database.tradeExecution.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    expect(execution.pricePaise).toBe(90_000n); // the better, gapped price — not the limit
  });

  it('rejects a triggered buy limit when cash is insufficient at execution', async () => {
    const { user, sim, instrument } = await setup(1_000_00n, [
      [D1, 100_000, 100_000, 100_000, 100_000],
      [D2, 98_000, 99_000, 94_000, 96_000],
    ]);

    const order = await placeLimit(sim, user, instrument, OrderSide.BUY, 10, 95_000n); // needs ₹9,500 > ₹1,000
    await advance(sim, user, D2);

    const rejected = await getOrder(order.id);
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe(TradingRejectionReason.INSUFFICIENT_CASH);
    expect(await database.tradeExecution.count({ where: { orderId: order.id } })).toBe(0);
    expect(await cash(sim)).toBe(1_000_00n); // untouched
    expect(
      await database.position.count({ where: { virtualAccountId: sim.virtualAccountId } }),
    ).toBe(0);
  });

  it('rejects a sell order when shares are insufficient at execution', async () => {
    const { user, sim, instrument } = await setup(50_000_00n, [
      [D1, 100_000, 100_000, 100_000, 100_000],
      [D2, 98_000, 99_000, 94_000, 96_000], // high 99,000 ≥ 90,000 sell limit
    ]);

    const order = await placeLimit(sim, user, instrument, OrderSide.SELL, 10, 90_000n); // holds no shares
    await advance(sim, user, D2);

    const rejected = await getOrder(order.id);
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe(TradingRejectionReason.INSUFFICIENT_SHARES);
  });

  it('triggers a stop-loss then executes at the next candle open', async () => {
    const { user, sim, instrument } = await setup(50_000_00n, [
      [D1, 100_000, 100_000, 100_000, 100_000],
      [D2, 96_000, 96_500, 94_000, 95_000], // low 94,000 ≤ 95,000 stop → triggers on D2
      [D3, 97_000, 98_000, 96_000, 97_500], // executes at D3 open 97,000
    ]);
    await database.position.create({
      data: {
        virtualAccountId: sim.virtualAccountId,
        instrumentId: instrument.id,
        quantity: 10,
        averageBuyPricePaise: 90_000,
        totalCostPaise: 900_000,
        realizedPnlPaise: 0,
      },
    });

    const order = await submitPendingSimulationOrder(
      {
        sessionId: sim.id,
        userId: user.id,
        side: OrderSide.SELL,
        instrumentId: instrument.id,
        orderType: OrderType.STOP_LOSS,
        quantity: 10,
        stopPricePaise: 95_000n,
      },
      database,
    );
    await advance(sim, user, D3);

    const filled = await getOrder(order.id);
    expect(filled.status).toBe('FILLED');
    expect(filled.triggeredAt).toEqual(D2);
    const execution = await database.tradeExecution.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    expect(execution.pricePaise).toBe(97_000n); // next candle open after the trigger
    expect(execution.simulationTimestamp).toEqual(D3);
    expect(
      await database.position.count({
        where: { virtualAccountId: sim.virtualAccountId, quantity: { gt: 0 } },
      }),
    ).toBe(0);
  });

  it('cancels only before execution', async () => {
    const { user, sim, instrument } = await setup(50_000_00n, [
      [D1, 100_000, 100_000, 100_000, 100_000],
      [D2, 98_000, 99_000, 94_000, 96_000],
    ]);

    const cancellable = await placeLimit(sim, user, instrument, OrderSide.BUY, 10, 90_000n);
    await cancelSimulationOrder(
      { sessionId: sim.id, userId: user.id, orderId: cancellable.id },
      database,
    );
    expect((await getOrder(cancellable.id)).status).toBe('CANCELLED');

    const willFill = await placeLimit(sim, user, instrument, OrderSide.BUY, 10, 95_000n);
    await advance(sim, user, D2);
    expect((await getOrder(willFill.id)).status).toBe('FILLED');

    await expect(
      cancelSimulationOrder({ sessionId: sim.id, userId: user.id, orderId: willFill.id }, database),
    ).rejects.toBeInstanceOf(SimulationError);
  });
});

async function setup(initialBalancePaise: bigint, rows: CandleRow[]) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  const instrument = await database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `PND-${suffix}`,
      companyName: `Pending ${suffix}`,
      isin: `TEST-${suffix}`,
      sector: 'Testing',
      industry: 'Testing',
      currency: 'INR',
    },
  });
  for (const [timestamp, openPaise, highPaise, lowPaise, closePaise] of rows) {
    await database.priceCandle.create({
      data: {
        instrumentId: instrument.id,
        interval: CandleInterval.ONE_DAY,
        timestamp,
        openPaise,
        highPaise,
        lowPaise,
        closePaise,
        volume: 1_000,
        source: 'pending-test',
      },
    });
  }

  const user = await registerUser(
    { name: 'Pending', email: `pending-${randomUUID()}@example.com`, password: 'tradeplay123' },
    database,
  );
  const sim = await createSimulation(
    { userId: user.id, name: 'Pending run', startTimestamp: D1, initialBalancePaise },
    database,
  );
  return { user, sim, instrument };
}

function placeLimit(
  sim: { id: string },
  user: { id: string },
  instrument: { id: string },
  side: OrderSide,
  quantity: number,
  limitPricePaise: bigint,
) {
  return submitPendingSimulationOrder(
    {
      sessionId: sim.id,
      userId: user.id,
      side,
      instrumentId: instrument.id,
      orderType: OrderType.LIMIT,
      quantity,
      limitPricePaise,
    },
    database,
  );
}

function advance(sim: { id: string }, user: { id: string }, to: Date) {
  return advanceSimulation(
    { sessionId: sim.id, userId: user.id, step: 'CUSTOM', customTimestamp: to },
    database,
  );
}

async function cash(sim: { virtualAccountId: string }) {
  const account = await database.virtualAccount.findUniqueOrThrow({
    where: { id: sim.virtualAccountId },
  });
  return account.availableCashPaise;
}

function getOrder(id: string) {
  return database.order.findUniqueOrThrow({ where: { id } });
}
