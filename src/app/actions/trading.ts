'use server';

import { refresh, revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { parsePriceToPaise } from '@/lib/finance/currency';
import { getActiveAccountId } from '@/server/services/accounts';
import {
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

    const result =
      side === 'BUY'
        ? await submitBuyOrder({
            orderId,
            virtualAccountId: account.id,
            instrumentId,
            amountPaise: parseBuyAmount(formData.get('amount')),
          })
        : await submitSellOrder({
            orderId,
            virtualAccountId: account.id,
            instrumentId,
            quantity: parseQuantity(formData.get('quantity')),
          });

    if (result.status === 'FILLED') {
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

function parseBuyAmount(value: FormDataEntryValue | null): number {
  if (typeof value !== 'string') return Number.NaN;

  try {
    return parsePriceToPaise(value);
  } catch {
    return Number.NaN;
  }
}

function parseQuantity(value: FormDataEntryValue | null): number {
  return typeof value === 'string' ? Number(value) : Number.NaN;
}
