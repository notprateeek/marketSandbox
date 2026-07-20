'use server';

import { refresh, revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { parsePriceToPaise } from '@/lib/finance/currency';
import { isMarketOpen } from '@/lib/finance/market-hours';
import { getActiveAccountId } from '@/server/services/accounts';
import {
  processPendingLiveOrders,
  queueBuyOrder,
  queueSellOrder,
  submitBuyOrder,
  submitSellOrder,
  type OrderSubmissionResult,
} from '@/server/services/submit-market-order';

export type TradingActionState =
  | { status: 'IDLE'; message: '' }
  | { status: 'ERROR'; message: string; orderId?: string }
  | OrderSubmissionResult;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function submitMarketOrderAction(
  _previousState: TradingActionState,
  formData: FormData,
): Promise<TradingActionState> {
  const orderIdValue = formData.get('orderId');
  const orderId = typeof orderIdValue === 'string' ? orderIdValue.trim() : '';
  const instrumentIdValue = formData.get('instrumentId');
  const instrumentId = typeof instrumentIdValue === 'string' ? instrumentIdValue.trim() : '';
  const side = formData.get('side');

  if (!UUID_PATTERN.test(orderId)) {
    return { status: 'ERROR', message: 'This order could not be identified. Please try again.' };
  }
  if (!instrumentId || (side !== 'BUY' && side !== 'SELL')) {
    return { status: 'ERROR', message: 'The order details are invalid.', orderId };
  }

  const session = await auth();
  if (!session?.user?.id) {
    return { status: 'ERROR', message: 'Sign in again before placing an order.', orderId };
  }

  try {
    const accountId = await getActiveAccountId(session.user.id);
    if (!accountId) {
      return { status: 'ERROR', message: 'Your virtual account is unavailable.', orderId };
    }
    const account = { id: accountId };

    // Closed exchange → queue the order for the next open; open → fill now, but
    // first clear anything that was queued while it was shut.
    const marketOpen = isMarketOpen();
    if (marketOpen) await processPendingLiveOrders(account.id);

    const amountPaise = parseBuyAmount(formData.get('amount'));
    const quantity = parseQuantity(formData.get('quantity'));
    const result = marketOpen
      ? side === 'BUY'
        ? await submitBuyOrder({ orderId, virtualAccountId: account.id, instrumentId, amountPaise })
        : await submitSellOrder({ orderId, virtualAccountId: account.id, instrumentId, quantity })
      : side === 'BUY'
        ? await queueBuyOrder({ orderId, virtualAccountId: account.id, instrumentId, amountPaise })
        : await queueSellOrder({ orderId, virtualAccountId: account.id, instrumentId, quantity });

    if (result.status === 'FILLED' || result.status === 'PENDING') {
      revalidatePath('/');
      refresh();
    }

    return result;
  } catch {
    return {
      status: 'ERROR',
      message: 'We could not submit this order. Please try again.',
      orderId,
    };
  }
}

/**
 * Fills any orders queued while the market was closed. Called from the live
 * price heartbeat, so queued orders execute shortly after the open without the
 * user having to place a new trade. Safe to call often: it's a no-op when the
 * market is shut or nothing is queued.
 */
export async function processQueuedOrdersAction(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const accountId = await getActiveAccountId(session.user.id);
  if (!accountId) return;

  const filled = await processPendingLiveOrders(accountId);
  if (filled > 0) revalidatePath('/');
}

// 0n is rejected by the order engine (isPositivePaise), matching how NaN was
// rejected before — an unparseable amount never becomes a real order.
function parseBuyAmount(value: FormDataEntryValue | null): bigint {
  if (typeof value !== 'string') return 0n;

  try {
    return parsePriceToPaise(value);
  } catch {
    return 0n;
  }
}

function parseQuantity(value: FormDataEntryValue | null): number {
  return typeof value === 'string' ? Number(value) : Number.NaN;
}
