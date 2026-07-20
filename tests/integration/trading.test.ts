// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import {
  CandleInterval,
  LedgerEntryType,
  OrderSide,
  OrderStatus,
  OrderType,
  PrismaClient,
} from '@/generated/prisma/client';
import { DatabaseMarketDataProvider } from '@/server/market-data';
import { INITIAL_BALANCE_PAISE, registerUser } from '@/server/services/register-user';
import {
  TradingRejectionReason,
  submitBuyOrder,
  submitSellOrder,
} from '@/server/services/submit-market-order';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;
let contender: PrismaClient;

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
  contender = new PrismaClient({ adapter: new PrismaPg({ connectionString: ephemeral.url }) });
});

afterAll(async () => {
  await contender.$disconnect();
  await ephemeral.drop();
});

describe('virtual market orders', () => {
  it('buys whole shares, preserves unused cash, and recalculates the weighted average', async () => {
    const account = await createAccount();
    const instrument = await createInstrument();
    const firstTimestamp = new Date('2026-07-14T03:45:00.000Z');
    const secondTimestamp = new Date('2026-07-14T03:46:00.000Z');
    const firstOrderId = randomUUID();
    const secondOrderId = randomUUID();
    const prices = new DatabaseMarketDataProvider(database);
    await addPrice(instrument.id, 10_000, firstTimestamp);

    const first = await submitBuyOrder(
      {
        orderId: firstOrderId,
        virtualAccountId: account.id,
        instrumentId: instrument.id,
        amountPaise: 20_999n,
      },
      database,
      prices,
    );
    await addPrice(instrument.id, 14_000, secondTimestamp);
    const second = await submitBuyOrder(
      {
        orderId: secondOrderId,
        virtualAccountId: account.id,
        instrumentId: instrument.id,
        amountPaise: 43_999n,
      },
      database,
      prices,
    );

    expect(first).toMatchObject({
      status: OrderStatus.FILLED,
      requestedQuantity: 2,
      filledQuantity: 2,
      grossAmountPaise: 20_000n,
      availableCashPaise: INITIAL_BALANCE_PAISE - 20_000n,
    });
    expect(second).toMatchObject({
      status: OrderStatus.FILLED,
      requestedQuantity: 3,
      filledQuantity: 3,
      grossAmountPaise: 42_000n,
      availableCashPaise: INITIAL_BALANCE_PAISE - 62_000n,
      positionQuantity: 5,
    });

    const [position, firstOrder, secondOrder, executions, ledgerEntries] = await Promise.all([
      positionFor(account.id, instrument.id),
      database.order.findUniqueOrThrow({ where: { id: firstOrderId } }),
      database.order.findUniqueOrThrow({ where: { id: secondOrderId } }),
      database.tradeExecution.findMany({
        where: { orderId: { in: [firstOrderId, secondOrderId] } },
        orderBy: { simulationTimestamp: 'asc' },
      }),
      database.ledgerEntry.findMany({
        where: {
          virtualAccountId: account.id,
          referenceType: 'ORDER',
          referenceId: { in: [firstOrderId, secondOrderId] },
        },
      }),
    ]);

    expect(position).toMatchObject({
      quantity: 5,
      averageBuyPricePaise: 12_400n,
      totalCostPaise: 62_000n,
      realizedPnlPaise: 0n,
    });
    expect(firstOrder).toMatchObject({
      side: OrderSide.BUY,
      orderType: OrderType.MARKET,
      status: OrderStatus.FILLED,
      requestedQuantity: 2,
      filledQuantity: 2,
      simulationTimestamp: firstTimestamp,
      rejectionReason: null,
    });
    expect(secondOrder).toMatchObject({
      status: OrderStatus.FILLED,
      requestedQuantity: 3,
      filledQuantity: 3,
      simulationTimestamp: secondTimestamp,
    });
    expect(executions).toMatchObject([
      {
        orderId: firstOrderId,
        side: OrderSide.BUY,
        quantity: 2,
        pricePaise: 10_000n,
        grossAmountPaise: 20_000n,
        simulationTimestamp: firstTimestamp,
      },
      {
        orderId: secondOrderId,
        side: OrderSide.BUY,
        quantity: 3,
        pricePaise: 14_000n,
        grossAmountPaise: 42_000n,
        simulationTimestamp: secondTimestamp,
      },
    ]);
    expect(ledgerEntries).toHaveLength(2);
    expect(ledgerEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: LedgerEntryType.BUY_DEBIT,
          amountPaise: -20_000n,
          balanceAfterPaise: INITIAL_BALANCE_PAISE - 20_000n,
          referenceId: firstOrderId,
        }),
        expect.objectContaining({
          type: LedgerEntryType.BUY_DEBIT,
          amountPaise: -42_000n,
          balanceAfterPaise: INITIAL_BALANCE_PAISE - 62_000n,
          referenceId: secondOrderId,
        }),
      ]),
    );
    await expectReconciled(account.id, INITIAL_BALANCE_PAISE - 62_000n);
  });

  it('realizes profit and loss on partial and full sells while retaining a closed position', async () => {
    const account = await createAccount();
    const instrument = await createInstrument();
    const prices = new DatabaseMarketDataProvider(database);
    const buyOrderId = randomUUID();
    const partialSellId = randomUUID();
    const finalSellId = randomUUID();
    await addPrice(instrument.id, 12_400, new Date('2026-07-14T04:00:00.000Z'));
    await submitBuyOrder(
      {
        orderId: buyOrderId,
        virtualAccountId: account.id,
        instrumentId: instrument.id,
        amountPaise: 62_000n,
      },
      database,
      prices,
    );

    const partialTimestamp = new Date('2026-07-14T04:01:00.000Z');
    await addPrice(instrument.id, 15_000, partialTimestamp);
    const partial = await submitSellOrder(
      {
        orderId: partialSellId,
        virtualAccountId: account.id,
        instrumentId: instrument.id,
        quantity: 2,
      },
      database,
      prices,
    );

    expect(partial).toMatchObject({
      status: OrderStatus.FILLED,
      grossAmountPaise: 30_000n,
      positionQuantity: 3,
      availableCashPaise: INITIAL_BALANCE_PAISE - 32_000n,
    });
    expect(await positionFor(account.id, instrument.id)).toMatchObject({
      quantity: 3,
      averageBuyPricePaise: 12_400n,
      totalCostPaise: 37_200n,
      realizedPnlPaise: 5_200n,
    });

    const finalTimestamp = new Date('2026-07-14T04:02:00.000Z');
    await addPrice(instrument.id, 11_000, finalTimestamp);
    const final = await submitSellOrder(
      {
        orderId: finalSellId,
        virtualAccountId: account.id,
        instrumentId: instrument.id,
        quantity: 3,
      },
      database,
      prices,
    );

    expect(final).toMatchObject({
      status: OrderStatus.FILLED,
      grossAmountPaise: 33_000n,
      positionQuantity: 0,
      availableCashPaise: INITIAL_BALANCE_PAISE + 1_000n,
    });
    expect(await positionFor(account.id, instrument.id)).toMatchObject({
      quantity: 0,
      averageBuyPricePaise: 0n,
      totalCostPaise: 0n,
      realizedPnlPaise: 1_000n,
    });

    const sellExecutions = await database.tradeExecution.findMany({
      where: { orderId: { in: [partialSellId, finalSellId] } },
      orderBy: { simulationTimestamp: 'asc' },
    });
    expect(sellExecutions).toMatchObject([
      {
        orderId: partialSellId,
        side: OrderSide.SELL,
        quantity: 2,
        pricePaise: 15_000n,
        grossAmountPaise: 30_000n,
        simulationTimestamp: partialTimestamp,
      },
      {
        orderId: finalSellId,
        side: OrderSide.SELL,
        quantity: 3,
        pricePaise: 11_000n,
        grossAmountPaise: 33_000n,
        simulationTimestamp: finalTimestamp,
      },
    ]);
    expect(
      await database.ledgerEntry.findMany({
        where: {
          virtualAccountId: account.id,
          type: LedgerEntryType.SELL_CREDIT,
        },
        select: { referenceId: true, amountPaise: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { referenceId: partialSellId, amountPaise: 30_000n },
        { referenceId: finalSellId, amountPaise: 33_000n },
      ]),
    );
    expect(
      await database.tradeExecution.count({
        where: { orderId: { in: [buyOrderId, partialSellId, finalSellId] } },
      }),
    ).toBe(3);
    await expectReconciled(account.id, INITIAL_BALANCE_PAISE + 1_000n);
  });

  it('persists every listed buy rejection without changing cash or holdings', async () => {
    const account = await createAccount();
    const prices = new DatabaseMarketDataProvider(database);
    const valid = await createInstrument();
    const inactive = await createInstrument({ isActive: false });
    const unavailable = await createInstrument();
    const tooSmall = await createInstrument();
    const tooExpensive = await createInstrument();
    await Promise.all([
      addPrice(valid.id, 10_000, new Date('2026-07-14T05:00:00.000Z')),
      addPrice(inactive.id, 10_000, new Date('2026-07-14T05:00:00.000Z')),
      addPrice(tooSmall.id, 10_000, new Date('2026-07-14T05:00:00.000Z')),
      addPrice(tooExpensive.id, 3_000_000, new Date('2026-07-14T05:00:00.000Z')),
    ]);

    const cases = [
      {
        instrumentId: valid.id,
        amountPaise: 0n,
        reason: TradingRejectionReason.INVALID_AMOUNT,
      },
      {
        instrumentId: inactive.id,
        amountPaise: 10_000n,
        reason: TradingRejectionReason.INACTIVE_INSTRUMENT,
      },
      {
        instrumentId: unavailable.id,
        amountPaise: 10_000n,
        reason: TradingRejectionReason.PRICE_UNAVAILABLE,
      },
      {
        instrumentId: tooSmall.id,
        amountPaise: 9_999n,
        reason: TradingRejectionReason.ZERO_QUANTITY,
      },
      {
        instrumentId: tooExpensive.id,
        amountPaise: 6_000_000n,
        reason: TradingRejectionReason.INSUFFICIENT_CASH,
      },
    ].map((testCase) => ({ ...testCase, orderId: randomUUID() }));

    const results = [];
    for (const testCase of cases) {
      results.push(
        await submitBuyOrder(
          {
            orderId: testCase.orderId,
            virtualAccountId: account.id,
            instrumentId: testCase.instrumentId,
            amountPaise: testCase.amountPaise,
          },
          database,
          prices,
        ),
      );
    }

    expect(results.map(({ status, message }) => ({ status, message }))).toEqual(
      cases.map(({ reason }) => ({ status: OrderStatus.REJECTED, message: reason })),
    );
    const rejectedOrders = await database.order.findMany({
      where: { id: { in: cases.map(({ orderId }) => orderId) } },
    });
    expect(rejectedOrders).toHaveLength(cases.length);
    expect(
      rejectedOrders.every(
        ({ status, filledQuantity }) => status === 'REJECTED' && filledQuantity === 0,
      ),
    ).toBe(true);
    expect(await database.tradeExecution.count({ where: { virtualAccountId: account.id } })).toBe(
      0,
    );
    expect(await database.position.count({ where: { virtualAccountId: account.id } })).toBe(0);
    expect(await database.ledgerEntry.count({ where: { virtualAccountId: account.id } })).toBe(1);
    await expectReconciled(account.id, INITIAL_BALANCE_PAISE);
  });

  it('persists every listed sell rejection without changing cash or positions', async () => {
    const account = await createAccount();
    const prices = new DatabaseMarketDataProvider(database);
    const owned = await createInstrument();
    const ownedWithoutPrice = await createInstrument();
    const notOwned = await createInstrument();
    await Promise.all([
      addPrice(owned.id, 10_000, new Date('2026-07-14T06:00:00.000Z')),
      addPrice(ownedWithoutPrice.id, 8_000, new Date('2026-07-14T06:00:00.000Z')),
      addPrice(notOwned.id, 5_000, new Date('2026-07-14T06:00:00.000Z')),
    ]);
    await submitBuyOrder(
      {
        orderId: randomUUID(),
        virtualAccountId: account.id,
        instrumentId: owned.id,
        amountPaise: 20_000n,
      },
      database,
      prices,
    );
    await submitBuyOrder(
      {
        orderId: randomUUID(),
        virtualAccountId: account.id,
        instrumentId: ownedWithoutPrice.id,
        amountPaise: 8_000n,
      },
      database,
      prices,
    );
    await database.priceCandle.deleteMany({ where: { instrumentId: ownedWithoutPrice.id } });

    const cases = [
      {
        instrumentId: owned.id,
        quantity: 0,
        reason: TradingRejectionReason.INVALID_QUANTITY,
      },
      {
        instrumentId: notOwned.id,
        quantity: 1,
        reason: TradingRejectionReason.NO_POSITION,
      },
      {
        instrumentId: owned.id,
        quantity: 3,
        reason: TradingRejectionReason.INSUFFICIENT_SHARES,
      },
      {
        instrumentId: ownedWithoutPrice.id,
        quantity: 1,
        reason: TradingRejectionReason.PRICE_UNAVAILABLE,
      },
    ].map((testCase) => ({ ...testCase, orderId: randomUUID() }));

    const results = [];
    for (const testCase of cases) {
      results.push(
        await submitSellOrder(
          {
            orderId: testCase.orderId,
            virtualAccountId: account.id,
            instrumentId: testCase.instrumentId,
            quantity: testCase.quantity,
          },
          database,
          prices,
        ),
      );
    }

    expect(results.map(({ status, message }) => ({ status, message }))).toEqual(
      cases.map(({ reason }) => ({ status: OrderStatus.REJECTED, message: reason })),
    );
    expect(await database.tradeExecution.count({ where: { virtualAccountId: account.id } })).toBe(
      2,
    );
    expect(await database.ledgerEntry.count({ where: { virtualAccountId: account.id } })).toBe(3);
    expect(await positionFor(account.id, owned.id)).toMatchObject({ quantity: 2 });
    expect(await positionFor(account.id, ownedWithoutPrice.id)).toMatchObject({ quantity: 1 });
    expect(
      await database.order.count({
        where: { id: { in: cases.map(({ orderId }) => orderId) }, status: OrderStatus.REJECTED },
      }),
    ).toBe(cases.length);
    await expectReconciled(account.id, INITIAL_BALANCE_PAISE - 28_000n);
  });

  it('replays one order id safely across simultaneous and refreshed submissions', async () => {
    const account = await createAccount();
    const instrument = await createInstrument();
    const orderId = randomUUID();
    await addPrice(instrument.id, 10_000, new Date('2026-07-14T07:00:00.000Z'));
    const input = {
      orderId,
      virtualAccountId: account.id,
      instrumentId: instrument.id,
      amountPaise: 20_999n,
    };

    const simultaneous = await runTogether([
      () => submitBuyOrder(input, database, new DatabaseMarketDataProvider(database)),
      () => submitBuyOrder(input, contender, new DatabaseMarketDataProvider(contender)),
    ]);
    const refreshed = await submitBuyOrder(
      input,
      database,
      new DatabaseMarketDataProvider(database),
    );

    expect(
      [...simultaneous, refreshed].every((result) => result.status === OrderStatus.FILLED),
    ).toBe(true);
    expect([...simultaneous, refreshed].map((result) => result.orderId)).toEqual([
      orderId,
      orderId,
      orderId,
    ]);
    expect(await database.order.count({ where: { id: orderId } })).toBe(1);
    expect(await database.tradeExecution.count({ where: { orderId } })).toBe(1);
    expect(
      await database.ledgerEntry.count({
        where: { virtualAccountId: account.id, referenceType: 'ORDER', referenceId: orderId },
      }),
    ).toBe(1);
    expect(await positionFor(account.id, instrument.id)).toMatchObject({ quantity: 2 });
    await expectReconciled(account.id, INITIAL_BALANCE_PAISE - 20_000n);
  });

  it('serializes competing buys so cash cannot be spent twice', async () => {
    const account = await createAccount();
    const instrument = await createInstrument();
    await addPrice(instrument.id, 3_000_000, new Date('2026-07-14T08:00:00.000Z'));
    const orderIds = [randomUUID(), randomUUID()];

    const results = await runTogether([
      () =>
        submitBuyOrder(
          {
            orderId: orderIds[0],
            virtualAccountId: account.id,
            instrumentId: instrument.id,
            amountPaise: 3_000_000n,
          },
          database,
          new DatabaseMarketDataProvider(database),
        ),
      () =>
        submitBuyOrder(
          {
            orderId: orderIds[1],
            virtualAccountId: account.id,
            instrumentId: instrument.id,
            amountPaise: 3_000_000n,
          },
          contender,
          new DatabaseMarketDataProvider(contender),
        ),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual([
      OrderStatus.FILLED,
      OrderStatus.REJECTED,
    ]);
    expect(results.find(({ status }) => status === OrderStatus.REJECTED)?.message).toBe(
      TradingRejectionReason.INSUFFICIENT_CASH,
    );
    expect(await database.tradeExecution.count({ where: { orderId: { in: orderIds } } })).toBe(1);
    expect(
      await database.ledgerEntry.count({
        where: {
          virtualAccountId: account.id,
          type: LedgerEntryType.BUY_DEBIT,
          referenceId: { in: orderIds },
        },
      }),
    ).toBe(1);
    expect(await positionFor(account.id, instrument.id)).toMatchObject({ quantity: 1 });
    await expectReconciled(account.id, INITIAL_BALANCE_PAISE - 3_000_000n);
  });

  it('serializes competing sells so the same shares cannot be sold twice', async () => {
    const account = await createAccount();
    const instrument = await createInstrument();
    const prices = new DatabaseMarketDataProvider(database);
    await addPrice(instrument.id, 10_000, new Date('2026-07-14T09:00:00.000Z'));
    await submitBuyOrder(
      {
        orderId: randomUUID(),
        virtualAccountId: account.id,
        instrumentId: instrument.id,
        amountPaise: 50_000n,
      },
      database,
      prices,
    );
    await addPrice(instrument.id, 15_000, new Date('2026-07-14T09:01:00.000Z'));
    const orderIds = [randomUUID(), randomUUID()];

    const results = await runTogether([
      () =>
        submitSellOrder(
          {
            orderId: orderIds[0],
            virtualAccountId: account.id,
            instrumentId: instrument.id,
            quantity: 4,
          },
          database,
          new DatabaseMarketDataProvider(database),
        ),
      () =>
        submitSellOrder(
          {
            orderId: orderIds[1],
            virtualAccountId: account.id,
            instrumentId: instrument.id,
            quantity: 4,
          },
          contender,
          new DatabaseMarketDataProvider(contender),
        ),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual([
      OrderStatus.FILLED,
      OrderStatus.REJECTED,
    ]);
    expect(results.find(({ status }) => status === OrderStatus.REJECTED)?.message).toBe(
      TradingRejectionReason.INSUFFICIENT_SHARES,
    );
    expect(await database.tradeExecution.count({ where: { orderId: { in: orderIds } } })).toBe(1);
    expect(
      await database.ledgerEntry.count({
        where: {
          virtualAccountId: account.id,
          type: LedgerEntryType.SELL_CREDIT,
          referenceId: { in: orderIds },
        },
      }),
    ).toBe(1);
    expect(await positionFor(account.id, instrument.id)).toMatchObject({
      quantity: 1,
      averageBuyPricePaise: 10_000n,
      totalCostPaise: 10_000n,
      realizedPnlPaise: 20_000n,
    });
    await expectReconciled(account.id, INITIAL_BALANCE_PAISE + 10_000n);
  });
});

async function createAccount() {
  const user = await registerUser(
    {
      name: 'Trading Test User',
      email: `trading-${randomUUID()}@example.com`,
      password: 'tradeplay123',
    },
    database,
  );

  return database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });
}

async function createInstrument({ isActive = true }: { isActive?: boolean } = {}) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  return database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `T${suffix}`,
      companyName: `Test Instrument ${suffix}`,
      isin: `TEST-${suffix}`,
      sector: 'Testing',
      industry: 'Testing',
      currency: 'INR',
      isActive,
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
      source: 'trading-test',
    },
  });
}

function positionFor(virtualAccountId: string, instrumentId: string) {
  return database.position.findUniqueOrThrow({
    where: { virtualAccountId_instrumentId: { virtualAccountId, instrumentId } },
  });
}

async function expectReconciled(virtualAccountId: string, expectedCashPaise: bigint) {
  const [account, ledgerEntries] = await Promise.all([
    database.virtualAccount.findUniqueOrThrow({ where: { id: virtualAccountId } }),
    database.ledgerEntry.findMany({ where: { virtualAccountId } }),
  ]);

  expect(account.availableCashPaise).toBe(expectedCashPaise);
  expect(ledgerEntries.reduce((sum, entry) => sum + entry.amountPaise, 0n)).toBe(expectedCashPaise);
}

async function runTogether<T>(operations: Array<() => Promise<T>>) {
  let release!: () => void;
  const start = new Promise<void>((resolveStart) => {
    release = resolveStart;
  });
  const pending = operations.map(async (operation) => {
    await start;
    return operation();
  });

  release();
  return Promise.all(pending);
}
