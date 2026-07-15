import {
  AccountStatus,
  LedgerEntryType,
  OrderSide,
  OrderStatus,
  OrderType,
  type Order,
  type Prisma,
  type PrismaClient,
} from '@/generated/prisma/client';
import { isMarketOpen } from '@/lib/finance/market-hours';
import { prisma } from '@/lib/prisma';
import {
  MarketDataUnavailableError,
  marketDataProvider,
  type MarketDataProvider,
  type MarketPrice,
} from '@/server/market-data';

export const MAX_DATABASE_INT = 2_147_483_647;
const MIN_DATABASE_INT = -2_147_483_648;
const MAX_TRANSACTION_ATTEMPTS = 3;
// ponytail: SQLite permits one writer; replace this queue with row locks on a server database.
let sqliteWriterQueue = Promise.resolve();

export const TradingRejectionReason = {
  INVALID_AMOUNT: 'Enter a valid amount greater than zero.',
  INVALID_QUANTITY: 'Enter a valid whole-share quantity greater than zero.',
  INACTIVE_ACCOUNT: 'This virtual account is not active.',
  INACTIVE_INSTRUMENT: 'This instrument is inactive.',
  PRICE_UNAVAILABLE: 'A latest price is unavailable for this instrument.',
  ZERO_QUANTITY: 'The amount is too small to buy one whole share.',
  INSUFFICIENT_CASH: 'Available cash is insufficient for this order.',
  NO_POSITION: 'You do not own shares of this instrument.',
  INSUFFICIENT_SHARES: 'The sell quantity exceeds the shares you own.',
  VALUE_OUT_OF_RANGE: 'The order value is outside the supported range.',
} as const;

export type OrderSubmissionResult = {
  orderId: string;
  status: OrderStatus;
  side: OrderSide;
  message: string;
  requestedQuantity: number;
  filledQuantity: number;
  pricePaise?: number;
  grossAmountPaise?: number;
  availableCashPaise: number;
  positionQuantity: number;
};

export type PositionSnapshot = {
  quantity: number;
  averageBuyPricePaise: number;
  totalCostPaise: number;
  realizedPnlPaise: number;
};

type SubmitBuyOrderInput = {
  orderId: string;
  virtualAccountId: string;
  instrumentId: string;
  amountPaise: number;
};

type SubmitSellOrderInput = {
  orderId: string;
  virtualAccountId: string;
  instrumentId: string;
  quantity: number;
};

type MarketOrderCommand =
  | (SubmitBuyOrderInput & { side: typeof OrderSide.BUY })
  | (SubmitSellOrderInput & { side: typeof OrderSide.SELL });

export function calculateBuyQuote(amountPaise: number, pricePaise: number) {
  if (!isPositiveDatabaseInt(amountPaise) || !isPositiveDatabaseInt(pricePaise)) return null;

  const quantity = Math.floor(amountPaise / pricePaise);
  return { quantity, grossAmountPaise: quantity * pricePaise };
}

export function calculatePositionAfterBuy(
  current: PositionSnapshot | null,
  quantity: number,
  grossAmountPaise: number,
): PositionSnapshot | null {
  if (!isPositiveDatabaseInt(quantity) || !isPositiveDatabaseInt(grossAmountPaise)) return null;

  const nextQuantity = (current?.quantity ?? 0) + quantity;
  const nextTotalCost = (current?.totalCostPaise ?? 0) + grossAmountPaise;
  if (!isPositiveDatabaseInt(nextQuantity) || !isPositiveDatabaseInt(nextTotalCost)) return null;

  return {
    quantity: nextQuantity,
    averageBuyPricePaise: roundedRatio(nextTotalCost, nextQuantity),
    totalCostPaise: nextTotalCost,
    realizedPnlPaise: current?.realizedPnlPaise ?? 0,
  };
}

export function calculatePositionAfterSell(
  current: PositionSnapshot,
  quantity: number,
  grossAmountPaise: number,
): (PositionSnapshot & { realizedPnlDeltaPaise: number }) | null {
  if (
    !isPositiveDatabaseInt(quantity) ||
    !isPositiveDatabaseInt(grossAmountPaise) ||
    !isPositiveDatabaseInt(current.quantity) ||
    quantity > current.quantity
  ) {
    return null;
  }

  const remainingQuantity = current.quantity - quantity;
  const soldCostPaise =
    remainingQuantity === 0
      ? current.totalCostPaise
      : roundedRatioBigInt(
          BigInt(current.totalCostPaise) * BigInt(quantity),
          BigInt(current.quantity),
        );
  const remainingCostPaise = current.totalCostPaise - soldCostPaise;
  const realizedPnlDeltaPaise = grossAmountPaise - soldCostPaise;
  const realizedPnlPaise = current.realizedPnlPaise + realizedPnlDeltaPaise;

  if (!isDatabaseInt(realizedPnlPaise)) return null;

  return {
    quantity: remainingQuantity,
    averageBuyPricePaise:
      remainingQuantity === 0 ? 0 : roundedRatio(remainingCostPaise, remainingQuantity),
    totalCostPaise: remainingCostPaise,
    realizedPnlPaise,
    realizedPnlDeltaPaise,
  };
}

export function submitBuyOrder(
  input: SubmitBuyOrderInput,
  database: PrismaClient = prisma,
  prices: MarketDataProvider = marketDataProvider,
) {
  return submitMarketOrder({ ...input, side: OrderSide.BUY }, database, prices);
}

export function submitSellOrder(
  input: SubmitSellOrderInput,
  database: PrismaClient = prisma,
  prices: MarketDataProvider = marketDataProvider,
) {
  return submitMarketOrder({ ...input, side: OrderSide.SELL }, database, prices);
}

export function queueBuyOrder(
  input: SubmitBuyOrderInput,
  database: PrismaClient = prisma,
  prices: MarketDataProvider = marketDataProvider,
) {
  return queueMarketOrder({ ...input, side: OrderSide.BUY }, database, prices);
}

export function queueSellOrder(
  input: SubmitSellOrderInput,
  database: PrismaClient = prisma,
  prices: MarketDataProvider = marketDataProvider,
) {
  return queueMarketOrder({ ...input, side: OrderSide.SELL }, database, prices);
}

/**
 * Accepts a market order while the exchange is closed: it validates and sizes
 * the order against the last known (frozen) price, then leaves it PENDING to be
 * filled at the next open by {@link processPendingLiveOrders}. No cash or shares
 * move here — those change only on the eventual fill, re-validated then.
 */
async function queueMarketOrder(
  command: MarketOrderCommand,
  database: PrismaClient,
  prices: MarketDataProvider,
): Promise<OrderSubmissionResult> {
  const existing = await database.order.findUnique({ where: { id: command.orderId } });
  if (existing) return resultForExistingOrder(database, existing, command);

  const inputRejection = inputRejectionFor(command);
  const price = inputRejection ? null : await latestPriceOrNull(prices, command.instrumentId);
  const quote =
    command.side === OrderSide.BUY && price
      ? calculateBuyQuote(command.amountPaise, price.pricePaise)
      : null;
  const requestedQuantity =
    command.side === OrderSide.BUY
      ? (quote?.quantity ?? 0)
      : isPositiveDatabaseInt(command.quantity)
        ? command.quantity
        : 0;

  return withSqliteWriterTurn(() =>
    database.$transaction(async (transaction) => {
      const order = await transaction.order.create({
        data: {
          id: command.orderId,
          virtualAccountId: command.virtualAccountId,
          instrumentId: command.instrumentId,
          side: command.side,
          orderType: OrderType.MARKET,
          requestedQuantity,
          status: OrderStatus.PENDING,
        },
      });

      const [account, instrument, position] = await Promise.all([
        transaction.virtualAccount.findUnique({ where: { id: command.virtualAccountId } }),
        transaction.instrument.findUnique({ where: { id: command.instrumentId } }),
        transaction.position.findUnique({
          where: {
            virtualAccountId_instrumentId: {
              virtualAccountId: command.virtualAccountId,
              instrumentId: command.instrumentId,
            },
          },
        }),
      ]);
      if (!account || !instrument) throw new Error('Order references an unavailable account');

      // Same guards as an immediate order, sized against the frozen price. Cash
      // and holdings are re-checked at fill, so a queued order can still be
      // rejected then if the account changes overnight.
      const rejection = rejectionFor(command, inputRejection, price, account, instrument, position);
      if (rejection) {
        return rejectOrder(
          transaction,
          order,
          rejection,
          account.availableCashPaise,
          position?.quantity ?? 0,
        );
      }

      return {
        orderId: order.id,
        status: OrderStatus.PENDING,
        side: command.side,
        message: 'Order queued — it will be placed when the market next opens.',
        requestedQuantity,
        filledQuantity: 0,
        pricePaise: price?.pricePaise,
        availableCashPaise: account.availableCashPaise,
        positionQuantity: position?.quantity ?? 0,
      };
    }),
  );
}

/**
 * Fills every queued (PENDING MARKET) order on an account at the current live
 * price, oldest first — the after-hours counterpart to placing them live. A
 * no-op while the market is closed or nothing is queued. Returns how many filled.
 */
export async function processPendingLiveOrders(
  virtualAccountId: string,
  database: PrismaClient = prisma,
  prices: MarketDataProvider = marketDataProvider,
  now: Date = new Date(),
): Promise<number> {
  if (!isMarketOpen(now)) return 0;

  const queued = await database.order.findMany({
    where: {
      virtualAccountId,
      orderType: OrderType.MARKET,
      status: OrderStatus.PENDING,
    },
    orderBy: { submittedAt: 'asc' },
    select: { id: true, instrumentId: true },
  });
  if (queued.length === 0) return 0;

  let filled = 0;
  for (const order of queued) {
    const price = await latestPriceOrNull(prices, order.instrumentId);
    if (!price) continue; // no price yet — leave it queued for a later pass
    const result = await executePendingOrder(
      { orderId: order.id, pricePaise: price.pricePaise, executedAt: now, triggeredAt: now },
      database,
    );
    if (result.status === 'FILLED') filled += 1;
  }
  return filled;
}

export type PendingExecutionResult =
  | { status: 'FILLED'; filledQuantity: number; pricePaise: number; grossAmountPaise: number }
  | { status: 'REJECTED'; reason: string }
  | { status: 'SKIPPED' };

/**
 * Fills an existing PENDING/TRIGGERED order (LIMIT or STOP_LOSS) at a
 * caller-supplied price and quantity — used by the simulation processor once a
 * candle satisfies the order. Runs in the SQLite writer queue and a
 * transaction, re-checking cash/holdings at execution time. Idempotent: an
 * order that is no longer pending is SKIPPED, and the unique execution row makes
 * a second fill impossible.
 */
export async function executePendingOrder(
  params: { orderId: string; pricePaise: number; executedAt: Date; triggeredAt: Date },
  database: PrismaClient = prisma,
): Promise<PendingExecutionResult> {
  return withSqliteWriterTurn(async () => {
    try {
      return await database.$transaction((transaction) => fillPending(transaction, params));
    } catch (error) {
      if (isUniqueConstraintError(error)) return { status: 'SKIPPED' };
      throw error;
    }
  });
}

async function fillPending(
  transaction: Prisma.TransactionClient,
  params: { orderId: string; pricePaise: number; executedAt: Date; triggeredAt: Date },
): Promise<PendingExecutionResult> {
  const order = await transaction.order.findUnique({ where: { id: params.orderId } });
  if (!order || (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.TRIGGERED)) {
    return { status: 'SKIPPED' };
  }

  const quantity = order.requestedQuantity;
  const [account, position] = await Promise.all([
    transaction.virtualAccount.findUnique({ where: { id: order.virtualAccountId } }),
    transaction.position.findUnique({
      where: {
        virtualAccountId_instrumentId: {
          virtualAccountId: order.virtualAccountId,
          instrumentId: order.instrumentId,
        },
      },
    }),
  ]);
  if (!account) throw new Error('Pending order references an unavailable account');

  const grossAmountPaise = multiplyWithinDatabaseInt(quantity, params.pricePaise);
  const rejection = pendingRejectionFor(order.side, quantity, grossAmountPaise, account, position);
  if (rejection) {
    await transaction.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.REJECTED,
        rejectionReason: rejection,
        triggeredAt: params.triggeredAt,
      },
    });
    return { status: 'REJECTED', reason: rejection };
  }

  await transaction.tradeExecution.create({
    data: {
      orderId: order.id,
      virtualAccountId: order.virtualAccountId,
      instrumentId: order.instrumentId,
      side: order.side,
      quantity,
      pricePaise: params.pricePaise,
      grossAmountPaise: grossAmountPaise!,
      simulationTimestamp: params.executedAt,
    },
  });

  if (order.side === OrderSide.BUY) {
    const nextPosition = calculatePositionAfterBuy(position, quantity, grossAmountPaise!)!;
    const [accountAfter] = await transaction.virtualAccount.updateManyAndReturn({
      where: {
        id: order.virtualAccountId,
        status: AccountStatus.ACTIVE,
        availableCashPaise: { gte: grossAmountPaise! },
      },
      data: { availableCashPaise: { decrement: grossAmountPaise! } },
      select: { availableCashPaise: true },
    });
    if (!accountAfter) throw new Error('Cash changed while the pending order was executing');

    await transaction.ledgerEntry.create({
      data: {
        virtualAccountId: order.virtualAccountId,
        type: LedgerEntryType.BUY_DEBIT,
        amountPaise: -grossAmountPaise!,
        balanceAfterPaise: accountAfter.availableCashPaise,
        referenceType: 'ORDER',
        referenceId: order.id,
        description: `${order.orderType} buy of ${quantity} share${quantity === 1 ? '' : 's'}`,
      },
    });
    await transaction.position.upsert({
      where: {
        virtualAccountId_instrumentId: {
          virtualAccountId: order.virtualAccountId,
          instrumentId: order.instrumentId,
        },
      },
      create: {
        virtualAccountId: order.virtualAccountId,
        instrumentId: order.instrumentId,
        ...nextPosition,
      },
      update: nextPosition,
    });
  } else {
    const nextPosition = calculatePositionAfterSell(position!, quantity, grossAmountPaise!)!;
    const [accountAfter] = await transaction.virtualAccount.updateManyAndReturn({
      where: {
        id: order.virtualAccountId,
        status: AccountStatus.ACTIVE,
        availableCashPaise: { lte: MAX_DATABASE_INT - grossAmountPaise! },
      },
      data: { availableCashPaise: { increment: grossAmountPaise! } },
      select: { availableCashPaise: true },
    });
    if (!accountAfter) throw new Error('Cash changed while the pending order was executing');

    await transaction.ledgerEntry.create({
      data: {
        virtualAccountId: order.virtualAccountId,
        type: LedgerEntryType.SELL_CREDIT,
        amountPaise: grossAmountPaise!,
        balanceAfterPaise: accountAfter.availableCashPaise,
        referenceType: 'ORDER',
        referenceId: order.id,
        description: `${order.orderType} sell of ${quantity} share${quantity === 1 ? '' : 's'}`,
      },
    });
    const [positionAfter] = await transaction.position.updateManyAndReturn({
      where: {
        virtualAccountId: order.virtualAccountId,
        instrumentId: order.instrumentId,
        quantity: { gte: quantity },
      },
      data: {
        quantity: nextPosition.quantity,
        averageBuyPricePaise: nextPosition.averageBuyPricePaise,
        totalCostPaise: nextPosition.totalCostPaise,
        realizedPnlPaise: nextPosition.realizedPnlPaise,
      },
      select: { quantity: true },
    });
    if (!positionAfter) throw new Error('Shares changed while the pending order was executing');
  }

  await transaction.order.update({
    where: { id: order.id },
    data: {
      status: OrderStatus.FILLED,
      filledQuantity: quantity,
      triggeredAt: params.triggeredAt,
      simulationTimestamp: params.executedAt,
    },
  });

  return {
    status: 'FILLED',
    filledQuantity: quantity,
    pricePaise: params.pricePaise,
    grossAmountPaise: grossAmountPaise!,
  };
}

function pendingRejectionFor(
  side: OrderSide,
  quantity: number,
  grossAmountPaise: number | null,
  account: { status: string; availableCashPaise: number },
  position: PositionSnapshot | null,
): string | null {
  if (account.status !== AccountStatus.ACTIVE) return TradingRejectionReason.INACTIVE_ACCOUNT;
  if (grossAmountPaise === null) return TradingRejectionReason.VALUE_OUT_OF_RANGE;

  if (side === OrderSide.BUY) {
    if (grossAmountPaise > account.availableCashPaise) {
      return TradingRejectionReason.INSUFFICIENT_CASH;
    }
    if (!calculatePositionAfterBuy(position, quantity, grossAmountPaise)) {
      return TradingRejectionReason.VALUE_OUT_OF_RANGE;
    }
    return null;
  }

  if (!position || position.quantity < quantity) return TradingRejectionReason.INSUFFICIENT_SHARES;
  if (
    account.availableCashPaise > MAX_DATABASE_INT - grossAmountPaise ||
    !calculatePositionAfterSell(position, quantity, grossAmountPaise)
  ) {
    return TradingRejectionReason.VALUE_OUT_OF_RANGE;
  }
  return null;
}

async function submitMarketOrder(
  command: MarketOrderCommand,
  database: PrismaClient,
  prices: MarketDataProvider,
): Promise<OrderSubmissionResult> {
  const existing = await database.order.findUnique({ where: { id: command.orderId } });
  if (existing) return resultForExistingOrder(database, existing, command);

  const inputRejection = inputRejectionFor(command);
  const price = inputRejection ? null : await latestPriceOrNull(prices, command.instrumentId);
  const quote =
    command.side === OrderSide.BUY && price
      ? calculateBuyQuote(command.amountPaise, price.pricePaise)
      : null;
  const requestedQuantity =
    command.side === OrderSide.BUY
      ? (quote?.quantity ?? 0)
      : isPositiveDatabaseInt(command.quantity)
        ? command.quantity
        : 0;

  return withSqliteWriterTurn(async () => {
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await database.$transaction(async (transaction) => {
          // The first statement is deliberately a write. SQLite then serializes all
          // cash and position reads behind the database's single writer lock.
          const order = await transaction.order.create({
            data: {
              id: command.orderId,
              virtualAccountId: command.virtualAccountId,
              instrumentId: command.instrumentId,
              side: command.side,
              orderType: OrderType.MARKET,
              requestedQuantity,
              simulationTimestamp: price?.timestamp,
            },
          });

          const [account, instrument, position] = await Promise.all([
            transaction.virtualAccount.findUnique({
              where: { id: command.virtualAccountId },
            }),
            transaction.instrument.findUnique({ where: { id: command.instrumentId } }),
            transaction.position.findUnique({
              where: {
                virtualAccountId_instrumentId: {
                  virtualAccountId: command.virtualAccountId,
                  instrumentId: command.instrumentId,
                },
              },
            }),
          ]);

          if (!account || !instrument) throw new Error('Order references an unavailable account');

          const rejection = rejectionFor(
            command,
            inputRejection,
            price,
            account,
            instrument,
            position,
          );
          if (rejection) {
            return rejectOrder(
              transaction,
              order,
              rejection,
              account.availableCashPaise,
              position?.quantity ?? 0,
            );
          }

          if (!price) throw new Error('Expected a validated market price');

          return command.side === OrderSide.BUY
            ? fillBuyOrder(transaction, order, command, price, position)
            : fillSellOrder(transaction, order, command, price, position!);
        });
      } catch (error) {
        const committedOrder = await existingOrderAfterConflict(database, command, error);
        if (committedOrder) return committedOrder;
        if (
          (!isRetryableSqliteContention(error) && !isUniqueConstraintError(error)) ||
          attempt === MAX_TRANSACTION_ATTEMPTS
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 20));
      }
    }

    throw new Error('Order submission exhausted all transaction attempts');
  });
}

function inputRejectionFor(command: MarketOrderCommand): string | null {
  if (command.side === OrderSide.BUY) {
    return isPositiveDatabaseInt(command.amountPaise)
      ? null
      : TradingRejectionReason.INVALID_AMOUNT;
  }

  return isPositiveDatabaseInt(command.quantity) ? null : TradingRejectionReason.INVALID_QUANTITY;
}

function rejectionFor(
  command: MarketOrderCommand,
  inputRejection: string | null,
  price: MarketPrice | null,
  account: { status: string; availableCashPaise: number },
  instrument: { isActive: boolean },
  position: PositionSnapshot | null,
): string | null {
  if (account.status !== AccountStatus.ACTIVE) return TradingRejectionReason.INACTIVE_ACCOUNT;
  if (inputRejection) return inputRejection;
  if (command.side === OrderSide.BUY && !instrument.isActive) {
    return TradingRejectionReason.INACTIVE_INSTRUMENT;
  }
  if (!price || !isPositiveDatabaseInt(price.pricePaise)) {
    return TradingRejectionReason.PRICE_UNAVAILABLE;
  }

  if (command.side === OrderSide.BUY) {
    const quote = calculateBuyQuote(command.amountPaise, price.pricePaise);
    if (!quote?.quantity) return TradingRejectionReason.ZERO_QUANTITY;
    if (quote.grossAmountPaise > account.availableCashPaise) {
      return TradingRejectionReason.INSUFFICIENT_CASH;
    }
    if (!calculatePositionAfterBuy(position, quote.quantity, quote.grossAmountPaise)) {
      return TradingRejectionReason.VALUE_OUT_OF_RANGE;
    }
    return null;
  }

  if (!position?.quantity) return TradingRejectionReason.NO_POSITION;
  if (command.quantity > position.quantity) return TradingRejectionReason.INSUFFICIENT_SHARES;

  const grossAmountPaise = multiplyWithinDatabaseInt(command.quantity, price.pricePaise);
  if (
    grossAmountPaise === null ||
    account.availableCashPaise > MAX_DATABASE_INT - grossAmountPaise ||
    !calculatePositionAfterSell(position, command.quantity, grossAmountPaise)
  ) {
    return TradingRejectionReason.VALUE_OUT_OF_RANGE;
  }

  return null;
}

async function fillBuyOrder(
  transaction: Prisma.TransactionClient,
  order: Order,
  command: SubmitBuyOrderInput & { side: typeof OrderSide.BUY },
  price: MarketPrice,
  position: PositionSnapshot | null,
): Promise<OrderSubmissionResult> {
  const quote = calculateBuyQuote(command.amountPaise, price.pricePaise)!;
  const nextPosition = calculatePositionAfterBuy(position, quote.quantity, quote.grossAmountPaise)!;

  await transaction.tradeExecution.create({
    data: {
      orderId: order.id,
      virtualAccountId: command.virtualAccountId,
      instrumentId: command.instrumentId,
      side: OrderSide.BUY,
      quantity: quote.quantity,
      pricePaise: price.pricePaise,
      grossAmountPaise: quote.grossAmountPaise,
      simulationTimestamp: price.timestamp,
    },
  });

  const [accountAfter] = await transaction.virtualAccount.updateManyAndReturn({
    where: {
      id: command.virtualAccountId,
      status: AccountStatus.ACTIVE,
      availableCashPaise: { gte: quote.grossAmountPaise },
    },
    data: { availableCashPaise: { decrement: quote.grossAmountPaise } },
    select: { availableCashPaise: true },
  });
  if (!accountAfter) throw new Error('Cash changed while the order was being filled');

  await transaction.ledgerEntry.create({
    data: {
      virtualAccountId: command.virtualAccountId,
      type: LedgerEntryType.BUY_DEBIT,
      amountPaise: -quote.grossAmountPaise,
      balanceAfterPaise: accountAfter.availableCashPaise,
      referenceType: 'ORDER',
      referenceId: order.id,
      description: `Market buy of ${quote.quantity} share${quote.quantity === 1 ? '' : 's'}`,
    },
  });

  await transaction.position.upsert({
    where: {
      virtualAccountId_instrumentId: {
        virtualAccountId: command.virtualAccountId,
        instrumentId: command.instrumentId,
      },
    },
    create: {
      virtualAccountId: command.virtualAccountId,
      instrumentId: command.instrumentId,
      ...nextPosition,
    },
    update: nextPosition,
  });

  await transaction.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.FILLED, filledQuantity: quote.quantity },
  });

  return {
    orderId: order.id,
    status: OrderStatus.FILLED,
    side: OrderSide.BUY,
    message: `Bought ${quote.quantity} share${quote.quantity === 1 ? '' : 's'}.`,
    requestedQuantity: quote.quantity,
    filledQuantity: quote.quantity,
    pricePaise: price.pricePaise,
    grossAmountPaise: quote.grossAmountPaise,
    availableCashPaise: accountAfter.availableCashPaise,
    positionQuantity: nextPosition.quantity,
  };
}

async function fillSellOrder(
  transaction: Prisma.TransactionClient,
  order: Order,
  command: SubmitSellOrderInput & { side: typeof OrderSide.SELL },
  price: MarketPrice,
  position: PositionSnapshot,
): Promise<OrderSubmissionResult> {
  const grossAmountPaise = multiplyWithinDatabaseInt(command.quantity, price.pricePaise)!;
  const nextPosition = calculatePositionAfterSell(position, command.quantity, grossAmountPaise)!;

  await transaction.tradeExecution.create({
    data: {
      orderId: order.id,
      virtualAccountId: command.virtualAccountId,
      instrumentId: command.instrumentId,
      side: OrderSide.SELL,
      quantity: command.quantity,
      pricePaise: price.pricePaise,
      grossAmountPaise,
      simulationTimestamp: price.timestamp,
    },
  });

  const [accountAfter] = await transaction.virtualAccount.updateManyAndReturn({
    where: {
      id: command.virtualAccountId,
      status: AccountStatus.ACTIVE,
      availableCashPaise: { lte: MAX_DATABASE_INT - grossAmountPaise },
    },
    data: { availableCashPaise: { increment: grossAmountPaise } },
    select: { availableCashPaise: true },
  });
  if (!accountAfter) throw new Error('Cash changed while the order was being filled');

  await transaction.ledgerEntry.create({
    data: {
      virtualAccountId: command.virtualAccountId,
      type: LedgerEntryType.SELL_CREDIT,
      amountPaise: grossAmountPaise,
      balanceAfterPaise: accountAfter.availableCashPaise,
      referenceType: 'ORDER',
      referenceId: order.id,
      description: `Market sell of ${command.quantity} share${command.quantity === 1 ? '' : 's'}`,
    },
  });

  const [positionAfter] = await transaction.position.updateManyAndReturn({
    where: {
      virtualAccountId: command.virtualAccountId,
      instrumentId: command.instrumentId,
      quantity: { gte: command.quantity },
    },
    data: {
      quantity: nextPosition.quantity,
      averageBuyPricePaise: nextPosition.averageBuyPricePaise,
      totalCostPaise: nextPosition.totalCostPaise,
      realizedPnlPaise: nextPosition.realizedPnlPaise,
    },
    select: { quantity: true },
  });
  if (!positionAfter) throw new Error('Position changed while the order was being filled');

  await transaction.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.FILLED, filledQuantity: command.quantity },
  });

  return {
    orderId: order.id,
    status: OrderStatus.FILLED,
    side: OrderSide.SELL,
    message: `Sold ${command.quantity} share${command.quantity === 1 ? '' : 's'}.`,
    requestedQuantity: command.quantity,
    filledQuantity: command.quantity,
    pricePaise: price.pricePaise,
    grossAmountPaise,
    availableCashPaise: accountAfter.availableCashPaise,
    positionQuantity: positionAfter.quantity,
  };
}

async function rejectOrder(
  transaction: Prisma.TransactionClient,
  order: Order,
  rejectionReason: string,
  availableCashPaise: number,
  positionQuantity: number,
): Promise<OrderSubmissionResult> {
  await transaction.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.REJECTED, rejectionReason },
  });

  return {
    orderId: order.id,
    status: OrderStatus.REJECTED,
    side: order.side,
    message: rejectionReason,
    requestedQuantity: order.requestedQuantity,
    filledQuantity: 0,
    availableCashPaise,
    positionQuantity,
  };
}

async function latestPriceOrNull(prices: MarketDataProvider, instrumentId: string) {
  try {
    const price = await prices.getLatestPrice(instrumentId);
    return price.instrumentId === instrumentId && isPositiveDatabaseInt(price.pricePaise)
      ? price
      : null;
  } catch (error) {
    if (error instanceof MarketDataUnavailableError) return null;
    throw error;
  }
}

async function existingOrderAfterConflict(
  database: PrismaClient,
  command: MarketOrderCommand,
  error: unknown,
) {
  if (!isUniqueConstraintError(error) && !isRetryableSqliteContention(error)) return null;
  let existing: Order | null;
  try {
    existing = await database.order.findUnique({ where: { id: command.orderId } });
  } catch {
    return null;
  }
  return existing ? resultForExistingOrder(database, existing, command) : null;
}

async function resultForExistingOrder(
  database: PrismaClient,
  order: Order,
  command: MarketOrderCommand,
): Promise<OrderSubmissionResult> {
  if (
    order.virtualAccountId !== command.virtualAccountId ||
    order.instrumentId !== command.instrumentId ||
    order.side !== command.side
  ) {
    throw new Error('Order id is already in use');
  }

  const [execution, account, position] = await Promise.all([
    database.tradeExecution.findUnique({ where: { orderId: order.id } }),
    database.virtualAccount.findUnique({
      where: { id: order.virtualAccountId },
      select: { availableCashPaise: true },
    }),
    database.position.findUnique({
      where: {
        virtualAccountId_instrumentId: {
          virtualAccountId: order.virtualAccountId,
          instrumentId: order.instrumentId,
        },
      },
      select: { quantity: true },
    }),
  ]);
  if (!account) throw new Error('Order account is unavailable');

  return {
    orderId: order.id,
    status: order.status,
    side: order.side,
    message:
      order.status === OrderStatus.FILLED
        ? `${order.side === OrderSide.BUY ? 'Bought' : 'Sold'} ${order.filledQuantity} share${order.filledQuantity === 1 ? '' : 's'}.`
        : (order.rejectionReason ?? `Order is ${order.status.toLowerCase()}.`),
    requestedQuantity: order.requestedQuantity,
    filledQuantity: order.filledQuantity,
    pricePaise: execution?.pricePaise,
    grossAmountPaise: execution?.grossAmountPaise,
    availableCashPaise: account.availableCashPaise,
    positionQuantity: position?.quantity ?? 0,
  };
}

function multiplyWithinDatabaseInt(left: number, right: number): number | null {
  const result = BigInt(left) * BigInt(right);
  return result > BigInt(MAX_DATABASE_INT) ? null : Number(result);
}

function roundedRatio(numerator: number, denominator: number) {
  return roundedRatioBigInt(BigInt(numerator), BigInt(denominator));
}

function roundedRatioBigInt(numerator: bigint, denominator: bigint) {
  return Number((numerator + denominator / BigInt(2)) / denominator);
}

function isPositiveDatabaseInt(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_DATABASE_INT;
}

function isDatabaseInt(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_DATABASE_INT && value <= MAX_DATABASE_INT;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function isRetryableSqliteContention(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  let metadata = '';
  if (typeof error === 'object' && error !== null && 'meta' in error) {
    try {
      metadata = JSON.stringify(error.meta);
    } catch {
      metadata = '';
    }
  }
  return /SQLITE_BUSY|database is locked|SocketTimeout/i.test(`${message} ${metadata}`);
}

async function withSqliteWriterTurn<T>(work: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previousTurn = sqliteWriterQueue;
  sqliteWriterQueue = previousTurn.then(() => turn);

  await previousTurn;
  try {
    return await work();
  } finally {
    release();
  }
}
