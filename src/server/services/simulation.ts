import { randomUUID } from 'node:crypto';

import {
  AccountStatus,
  CandleInterval,
  LedgerEntryType,
  OrderSide,
  OrderStatus,
  OrderType,
  SimulationStatus,
  type PrismaClient,
} from '@/generated/prisma/client';
import { MAX_PAISE } from '@/lib/finance/currency';
import { evaluatePendingOrder, type Candle } from '@/lib/finance/pending-order';
import { prisma } from '@/lib/prisma';
import {
  DatabaseMarketDataProvider,
  SimulationMarketDataProvider,
  type MarketDataProvider,
} from '@/server/market-data';
import { advanceSimulationTime, type AdvanceStep } from '@/server/services/simulation-clock';
import { loadPortfolioForAccount, type PortfolioView } from '@/server/services/portfolio';
import { captureSnapshot, captureSnapshotsThrough } from '@/server/services/portfolio-snapshot';
import {
  executePendingOrder,
  submitBuyOrder,
  submitSellOrder,
  type OrderSubmissionResult,
} from '@/server/services/submit-market-order';

export class SimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationError';
  }
}

export interface CreateSimulationInput {
  userId: string;
  name: string;
  startTimestamp: Date;
  initialBalancePaise: bigint;
}

/** The min/max timestamps of available market data, bounding valid start times. */
export async function getDataRange(database: PrismaClient = prisma) {
  const range = await database.priceCandle.aggregate({
    _min: { timestamp: true },
    _max: { timestamp: true },
  });
  return { min: range._min.timestamp, max: range._max.timestamp };
}

export async function createSimulation(
  input: CreateSimulationInput,
  database: PrismaClient = prisma,
) {
  if (!isPositivePaise(input.initialBalancePaise)) {
    throw new SimulationError('Enter a starting balance greater than zero.');
  }

  const { min, max } = await getDataRange(database);
  if (!min || !max) {
    throw new SimulationError('No market data is available to run a simulation.');
  }
  const start = input.startTimestamp;
  if (Number.isNaN(start.getTime()) || start < min || start >= max) {
    throw new SimulationError(
      `Choose a start time between ${min.toISOString()} and ${max.toISOString()}.`,
    );
  }

  const name = input.name.trim() || 'Historical replay';

  const session = await database.$transaction(async (transaction) => {
    const account = await transaction.virtualAccount.create({
      data: {
        userId: input.userId,
        name: `Simulation · ${name}`,
        startingBalancePaise: input.initialBalancePaise,
        availableCashPaise: input.initialBalancePaise,
        status: AccountStatus.ACTIVE,
        ledgerEntries: { create: openingCredit(input.initialBalancePaise) },
      },
    });

    return transaction.simulationSession.create({
      data: {
        userId: input.userId,
        virtualAccountId: account.id,
        name,
        startTimestamp: start,
        currentTimestamp: start,
        endTimestamp: max,
        initialBalancePaise: input.initialBalancePaise,
        status: SimulationStatus.ACTIVE,
      },
    });
  });

  // Baseline snapshot at the opening instant.
  await captureSnapshot(snapshotTarget(session), session.startTimestamp, database);
  return session;
}

/** A session as a snapshot target (snapshots tagged to the simulation). */
function snapshotTarget(session: { id: string; virtualAccountId: string }) {
  return { virtualAccountId: session.virtualAccountId, simulationSessionId: session.id };
}

export async function advanceSimulation(
  params: { sessionId: string; userId: string; step: AdvanceStep; customTimestamp?: Date | null },
  database: PrismaClient = prisma,
) {
  const session = await ownedSession(params.sessionId, params.userId, database);
  if (session.status !== SimulationStatus.ACTIVE) return session;

  const { timestamp, completed } = advanceSimulationTime(
    session.currentTimestamp,
    session.endTimestamp,
    params.step,
    params.customTimestamp,
  );

  const updated = await database.simulationSession.update({
    where: { id: session.id },
    data: {
      currentTimestamp: timestamp,
      status: completed ? SimulationStatus.COMPLETED : SimulationStatus.ACTIVE,
    },
  });

  // Trigger/execute any pending limit & stop-loss orders reached in this window,
  // then snapshot each trading-day close crossed plus the new clock instant.
  await processPendingOrders(updated, updated.currentTimestamp, database);
  await captureSnapshotsThrough(
    snapshotTarget(updated),
    session.currentTimestamp,
    updated.currentTimestamp,
    database,
  );
  return updated;
}

export async function setSimulationStatus(
  params: { sessionId: string; userId: string; paused: boolean },
  database: PrismaClient = prisma,
) {
  const session = await ownedSession(params.sessionId, params.userId, database);
  // Pause/resume only toggles between ACTIVE and PAUSED; a completed run is final.
  if (session.status === SimulationStatus.COMPLETED) return session;

  return database.simulationSession.update({
    where: { id: session.id },
    data: { status: params.paused ? SimulationStatus.PAUSED : SimulationStatus.ACTIVE },
  });
}

/**
 * Restores the simulation to its start: clears this run's orders, executions,
 * positions and non-opening ledger entries, restores the opening cash, and
 * rewinds the clock. The immutable INITIAL_CREDIT entry is preserved (a DB
 * trigger forbids deleting it), so the account returns to exactly its opening
 * ledger. Scoped to this simulation's account only — the user's primary account
 * and any other simulation are untouched.
 */
export async function resetSimulation(
  params: { sessionId: string; userId: string },
  database: PrismaClient = prisma,
) {
  const session = await ownedSession(params.sessionId, params.userId, database);
  const virtualAccountId = session.virtualAccountId;

  const updated = await database.$transaction(async (transaction) => {
    await transaction.portfolioSnapshot.deleteMany({ where: { virtualAccountId } });
    await transaction.tradeExecution.deleteMany({ where: { virtualAccountId } });
    await transaction.order.deleteMany({ where: { virtualAccountId } });
    await transaction.position.deleteMany({ where: { virtualAccountId } });
    await transaction.ledgerEntry.deleteMany({
      where: { virtualAccountId, type: { not: LedgerEntryType.INITIAL_CREDIT } },
    });
    await transaction.virtualAccount.update({
      where: { id: virtualAccountId },
      data: { availableCashPaise: session.initialBalancePaise },
    });

    return transaction.simulationSession.update({
      where: { id: session.id },
      data: { currentTimestamp: session.startTimestamp, status: SimulationStatus.ACTIVE },
    });
  });

  // Fresh baseline at the start instant.
  await captureSnapshot(snapshotTarget(updated), updated.startTimestamp, database);
  return updated;
}

export interface SubmitSimulationOrderInput {
  sessionId: string;
  userId: string;
  side: OrderSide;
  instrumentId: string;
  amountPaise?: bigint;
  quantity?: number;
}

/**
 * Places a market order inside the simulation. Prices come from a provider
 * bound to the current simulation time, so fills follow the documented
 * next-candle-open policy and never use future data.
 */
export async function submitSimulationOrder(
  input: SubmitSimulationOrderInput,
  database: PrismaClient = prisma,
): Promise<OrderSubmissionResult> {
  const session = await ownedSession(input.sessionId, input.userId, database);
  if (session.status !== SimulationStatus.ACTIVE) {
    throw new SimulationError('Resume the simulation before placing orders.');
  }

  const prices = new SimulationMarketDataProvider(session.currentTimestamp, database);
  const common = {
    orderId: randomUUID(),
    virtualAccountId: session.virtualAccountId,
    instrumentId: input.instrumentId,
  };

  const result =
    input.side === OrderSide.BUY
      ? await submitBuyOrder({ ...common, amountPaise: input.amountPaise ?? 0n }, database, prices)
      : await submitSellOrder({ ...common, quantity: input.quantity ?? 0 }, database, prices);

  // A filled order changes the portfolio; snapshot it at the current clock.
  if (result.status === 'FILLED') {
    await captureSnapshot(snapshotTarget(session), session.currentTimestamp, database);
  }
  return result;
}

export interface SubmitPendingOrderInput {
  sessionId: string;
  userId: string;
  side: OrderSide;
  instrumentId: string;
  orderType: typeof OrderType.LIMIT | typeof OrderType.STOP_LOSS;
  quantity: number;
  limitPricePaise?: bigint | null;
  stopPricePaise?: bigint | null;
  expiryTimestamp?: Date | null;
}

/**
 * Places a resting LIMIT or STOP_LOSS order. It does not execute or reserve
 * cash now — it waits for the simulation clock to advance onto a candle that
 * satisfies it (see processPendingOrders).
 */
export async function submitPendingSimulationOrder(
  input: SubmitPendingOrderInput,
  database: PrismaClient = prisma,
) {
  const session = await ownedSession(input.sessionId, input.userId, database);
  if (session.status !== SimulationStatus.ACTIVE) {
    throw new SimulationError('Resume the simulation before placing orders.');
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new SimulationError('Enter a whole-share quantity greater than zero.');
  }

  if (input.orderType === OrderType.LIMIT) {
    if (!(Number(input.limitPricePaise) > 0)) {
      throw new SimulationError('Enter a limit price greater than zero.');
    }
  } else {
    if (input.side !== OrderSide.SELL) {
      throw new SimulationError('Stop-loss orders can only sell.');
    }
    if (!(Number(input.stopPricePaise) > 0)) {
      throw new SimulationError('Enter a stop price greater than zero.');
    }
  }

  if (input.expiryTimestamp && input.expiryTimestamp <= session.currentTimestamp) {
    throw new SimulationError('Expiry must be after the current simulation time.');
  }

  return database.order.create({
    data: {
      virtualAccountId: session.virtualAccountId,
      instrumentId: input.instrumentId,
      side: input.side,
      orderType: input.orderType,
      requestedQuantity: input.quantity,
      status: OrderStatus.PENDING,
      limitPricePaise: input.orderType === OrderType.LIMIT ? input.limitPricePaise : null,
      stopPricePaise: input.orderType === OrderType.STOP_LOSS ? input.stopPricePaise : null,
      expiryTimestamp: input.expiryTimestamp ?? null,
      simulationTimestamp: session.currentTimestamp,
    },
  });
}

/** Cancels a resting order. Only works before it executes (PENDING or TRIGGERED). */
export async function cancelSimulationOrder(
  params: { sessionId: string; userId: string; orderId: string },
  database: PrismaClient = prisma,
) {
  const session = await ownedSession(params.sessionId, params.userId, database);
  const order = await database.order.findFirst({
    where: { id: params.orderId, virtualAccountId: session.virtualAccountId },
  });
  if (!order) throw new SimulationError('Order not found.');
  if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.TRIGGERED) {
    throw new SimulationError('Only pending orders can be cancelled.');
  }
  return database.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.CANCELLED },
  });
}

/**
 * Processes every resting order for the session up to `toTime`, in submission
 * order. Each order is evaluated against the candles observed since it was
 * placed; the pure policy decides whether to fill, trigger, expire or wait.
 * Filling goes through executePendingOrder, which re-checks cash/holdings and
 * cannot execute an order twice.
 */
export async function processPendingOrders(
  session: { virtualAccountId: string },
  toTime: Date,
  database: PrismaClient = prisma,
) {
  const orders = await database.order.findMany({
    where: {
      virtualAccountId: session.virtualAccountId,
      orderType: { in: [OrderType.LIMIT, OrderType.STOP_LOSS] },
      status: { in: [OrderStatus.PENDING, OrderStatus.TRIGGERED] },
    },
    orderBy: { submittedAt: 'asc' },
  });

  const provider = new DatabaseMarketDataProvider(database);

  for (const order of orders) {
    const submittedAt = order.simulationTimestamp ?? order.submittedAt;
    const candles = await fetchOrderCandles(provider, order.instrumentId, submittedAt, toTime);
    const decision = evaluatePendingOrder(
      {
        orderType: order.orderType === OrderType.LIMIT ? 'LIMIT' : 'STOP_LOSS',
        side: order.side === OrderSide.BUY ? 'BUY' : 'SELL',
        status: order.status === OrderStatus.TRIGGERED ? 'TRIGGERED' : 'PENDING',
        limitPricePaise: order.limitPricePaise,
        stopPricePaise: order.stopPricePaise,
        submissionTimestamp: submittedAt,
        triggeredAt: order.triggeredAt,
        expiryTimestamp: order.expiryTimestamp,
      },
      candles,
      toTime,
    );

    if (decision.kind === 'FILL') {
      await executePendingOrder(
        {
          orderId: order.id,
          pricePaise: decision.pricePaise,
          executedAt: decision.executedAt,
          triggeredAt: decision.triggeredAt,
        },
        database,
      );
    } else if (decision.kind === 'TRIGGER') {
      await database.order.updateMany({
        where: { id: order.id, status: OrderStatus.PENDING },
        data: { status: OrderStatus.TRIGGERED, triggeredAt: decision.triggeredAt },
      });
    } else if (decision.kind === 'EXPIRE') {
      await database.order.updateMany({
        where: { id: order.id, status: { in: [OrderStatus.PENDING, OrderStatus.TRIGGERED] } },
        data: { status: OrderStatus.EXPIRED },
      });
    }
  }
}

async function fetchOrderCandles(
  provider: MarketDataProvider,
  instrumentId: string,
  from: Date,
  to: Date,
): Promise<Candle[]> {
  if (from.getTime() > to.getTime()) return [];
  let candles = await provider.getCandles(instrumentId, from, to, CandleInterval.ONE_MINUTE);
  if (candles.length === 0) {
    candles = await provider.getCandles(instrumentId, from, to, CandleInterval.ONE_DAY);
  }
  return candles.map((candle) => ({
    timestamp: candle.timestamp,
    openPaise: candle.openPaise,
    highPaise: candle.highPaise,
    lowPaise: candle.lowPaise,
  }));
}

export interface PendingOrderView {
  id: string;
  symbol: string;
  companyName: string;
  side: OrderSide;
  orderType: string;
  status: string;
  requestedQuantity: number;
  limitPricePaise: bigint | null;
  stopPricePaise: bigint | null;
  expiryTimestamp: Date | null;
  triggeredAt: Date | null;
}

export async function loadPendingOrders(
  virtualAccountId: string,
  database: PrismaClient = prisma,
): Promise<PendingOrderView[]> {
  const orders = await database.order.findMany({
    where: {
      virtualAccountId,
      orderType: { in: [OrderType.LIMIT, OrderType.STOP_LOSS] },
      status: { in: [OrderStatus.PENDING, OrderStatus.TRIGGERED] },
    },
    orderBy: { submittedAt: 'asc' },
    include: { instrument: { select: { symbol: true, companyName: true } } },
  });

  return orders.map((order) => ({
    id: order.id,
    symbol: order.instrument.symbol,
    companyName: order.instrument.companyName,
    side: order.side,
    orderType: order.orderType,
    status: order.status,
    requestedQuantity: order.requestedQuantity,
    limitPricePaise: order.limitPricePaise,
    stopPricePaise: order.stopPricePaise,
    expiryTimestamp: order.expiryTimestamp,
    triggeredAt: order.triggeredAt,
  }));
}

export async function loadOrderDetails(
  orderId: string,
  userId: string,
  database: PrismaClient = prisma,
) {
  const order = await database.order.findFirst({
    where: { id: orderId, virtualAccount: { userId } },
    include: {
      instrument: { select: { symbol: true, companyName: true } },
      execution: {
        select: {
          pricePaise: true,
          grossAmountPaise: true,
          quantity: true,
          simulationTimestamp: true,
        },
      },
      virtualAccount: { select: { simulationSession: { select: { id: true, name: true } } } },
    },
  });
  return order;
}

export interface TimelineEvent {
  kind: 'STARTED' | 'FILLED' | 'REJECTED';
  timestamp: Date;
  title: string;
  detail: string;
}

export interface SimulationDetail {
  session: Awaited<ReturnType<typeof ownedSession>>;
  portfolio: PortfolioView | null;
  timeline: TimelineEvent[];
  pendingOrders: PendingOrderView[];
}

export async function loadSimulation(
  sessionId: string,
  userId: string,
  database: PrismaClient = prisma,
): Promise<SimulationDetail | null> {
  const session = await database.simulationSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId) return null;

  const [portfolio, timeline, pendingOrders] = await Promise.all([
    loadPortfolioForAccount(
      session.virtualAccountId,
      { valuationTimestamp: session.currentTimestamp },
      database,
      new DatabaseMarketDataProvider(database),
    ),
    buildTimeline(session, database),
    loadPendingOrders(session.virtualAccountId, database),
  ]);

  return { session, portfolio, timeline, pendingOrders };
}

export function listSimulations(userId: string, database: PrismaClient = prisma) {
  return database.simulationSession.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

async function buildTimeline(
  session: { virtualAccountId: string; startTimestamp: Date; initialBalancePaise: bigint },
  database: PrismaClient,
): Promise<TimelineEvent[]> {
  const orders = await database.order.findMany({
    where: { virtualAccountId: session.virtualAccountId },
    include: {
      instrument: { select: { symbol: true } },
      execution: { select: { pricePaise: true, grossAmountPaise: true, quantity: true } },
    },
    orderBy: [{ simulationTimestamp: 'desc' }, { createdAt: 'desc' }],
  });

  const orderEvents = orders.map<TimelineEvent>((order) => {
    const verb = order.side === OrderSide.BUY ? 'Bought' : 'Sold';
    if (order.status === 'FILLED' && order.execution) {
      return {
        kind: 'FILLED',
        timestamp: order.simulationTimestamp ?? order.createdAt,
        title: `${verb} ${order.execution.quantity} ${order.instrument.symbol}`,
        detail: `at ${paise(order.execution.pricePaise)} · ${paise(order.execution.grossAmountPaise)}`,
      };
    }
    return {
      kind: 'REJECTED',
      timestamp: order.simulationTimestamp ?? order.createdAt,
      title: `${order.side === OrderSide.BUY ? 'Buy' : 'Sell'} ${order.instrument.symbol} rejected`,
      detail: order.rejectionReason ?? 'Order was not filled',
    };
  });

  return [
    ...orderEvents,
    {
      kind: 'STARTED',
      timestamp: session.startTimestamp,
      title: 'Simulation started',
      detail: `Opening balance ${paise(session.initialBalancePaise)}`,
    },
  ];
}

async function ownedSession(sessionId: string, userId: string, database: PrismaClient) {
  const session = await database.simulationSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId) {
    throw new SimulationError('Simulation not found.');
  }
  return session;
}

function openingCredit(initialBalancePaise: bigint) {
  return {
    type: LedgerEntryType.INITIAL_CREDIT,
    amountPaise: initialBalancePaise,
    balanceAfterPaise: initialBalancePaise,
    referenceType: 'SYSTEM',
    referenceId: 'ACCOUNT_OPENING',
    description: 'Initial simulation cash credit',
  };
}

function isPositivePaise(value: bigint): boolean {
  return value > 0n && value <= MAX_PAISE;
}

function paise(value: bigint): string {
  return `₹${(Number(value) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
