'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { OrderSide, OrderType } from '@/generated/prisma/client';
import { parsePriceToPaise } from '@/lib/finance/currency';
import { parseISTInputValue } from '@/lib/finance/datetime';
import type { AdvanceStep } from '@/server/services/simulation-clock';
import {
  advanceSimulation,
  cancelSimulationOrder,
  createSimulation,
  resetSimulation,
  setSimulationStatus,
  submitPendingSimulationOrder,
  submitSimulationOrder,
  SimulationError,
} from '@/server/services/simulation';
import type { OrderSubmissionResult } from '@/server/services/submit-market-order';

export type CreateSimulationState = { status: 'IDLE' | 'ERROR'; message: string };

export type SimulationOrderState =
  | { status: 'IDLE'; message: '' }
  | { status: 'ERROR'; message: string }
  | { status: 'PENDING_PLACED'; message: string }
  | OrderSubmissionResult;

const ADVANCE_STEPS: readonly AdvanceStep[] = ['MINUTE', 'HOUR', 'TRADING_DAY', 'WEEK', 'CUSTOM'];

export async function createSimulationAction(
  _previousState: CreateSimulationState,
  formData: FormData,
): Promise<CreateSimulationState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { status: 'ERROR', message: 'Sign in again to create a simulation.' };
  }

  const startTimestamp = parseIstLocal(stringField(formData, 'startTimestamp'));
  if (!startTimestamp) {
    return { status: 'ERROR', message: 'Choose a valid historical start date and time.' };
  }

  let created;
  try {
    created = await createSimulation({
      userId: session.user.id,
      name: stringField(formData, 'name'),
      startTimestamp,
      initialBalancePaise: parseAmount(formData.get('initialBalance')),
    });
  } catch (error) {
    if (error instanceof SimulationError) return { status: 'ERROR', message: error.message };
    throw error;
  }

  redirect(`/simulations/${created.id}`);
}

export async function advanceSimulationAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  const sessionId = stringField(formData, 'sessionId');
  const step = stringField(formData, 'step');
  if (!userId || !sessionId || !ADVANCE_STEPS.includes(step as AdvanceStep)) return;

  const customTimestamp = step === 'CUSTOM' ? parseIstLocal(stringField(formData, 'custom')) : null;
  if (step === 'CUSTOM' && !customTimestamp) return;

  await safely(() =>
    advanceSimulation({ sessionId, userId, step: step as AdvanceStep, customTimestamp }),
  );
  revalidatePath(`/simulations/${sessionId}`);
}

export async function setSimulationStatusAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  const sessionId = stringField(formData, 'sessionId');
  if (!userId || !sessionId) return;

  const paused = stringField(formData, 'paused') === 'true';
  await safely(() => setSimulationStatus({ sessionId, userId, paused }));
  revalidatePath(`/simulations/${sessionId}`);
}

export async function resetSimulationAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  const sessionId = stringField(formData, 'sessionId');
  if (!userId || !sessionId) return;

  await safely(() => resetSimulation({ sessionId, userId }));
  revalidatePath(`/simulations/${sessionId}`);
}

export async function submitSimulationOrderAction(
  _previousState: SimulationOrderState,
  formData: FormData,
): Promise<SimulationOrderState> {
  const userId = await currentUserId();
  if (!userId) return { status: 'ERROR', message: 'Sign in again to place an order.' };

  const sessionId = stringField(formData, 'sessionId');
  const instrumentId = stringField(formData, 'instrumentId');
  const side = formData.get('side');
  const orderType = stringField(formData, 'orderType') || 'MARKET';
  if (!sessionId || !instrumentId || (side !== 'BUY' && side !== 'SELL')) {
    return { status: 'ERROR', message: 'The order details are invalid.' };
  }
  const resolvedSide = side === 'BUY' ? OrderSide.BUY : OrderSide.SELL;

  try {
    if (orderType === 'LIMIT' || orderType === 'STOP_LOSS') {
      const expiry = parseISTInputValue(stringField(formData, 'expiryTimestamp'));
      await submitPendingSimulationOrder({
        sessionId,
        userId,
        side: resolvedSide,
        instrumentId,
        orderType: orderType === 'LIMIT' ? OrderType.LIMIT : OrderType.STOP_LOSS,
        quantity: parseQuantity(formData.get('quantity')),
        limitPricePaise:
          orderType === 'LIMIT' ? parsePriceOrNull(formData.get('limitPrice')) : null,
        stopPricePaise:
          orderType === 'STOP_LOSS' ? parsePriceOrNull(formData.get('stopPrice')) : null,
        expiryTimestamp: expiry,
      });
      revalidatePath(`/simulations/${sessionId}`);
      return {
        status: 'PENDING_PLACED',
        message: `${orderType === 'LIMIT' ? 'Limit' : 'Stop-loss'} order placed — it will trigger as the simulation advances.`,
      };
    }

    const result = await submitSimulationOrder({
      sessionId,
      userId,
      side: resolvedSide,
      instrumentId,
      amountPaise: side === 'BUY' ? parseAmount(formData.get('amount')) : undefined,
      quantity: side === 'SELL' ? parseQuantity(formData.get('quantity')) : undefined,
    });
    revalidatePath(`/simulations/${sessionId}`);
    return result;
  } catch (error) {
    if (error instanceof SimulationError) return { status: 'ERROR', message: error.message };
    return { status: 'ERROR', message: 'We could not place this order. Please try again.' };
  }
}

export async function cancelSimulationOrderAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  const sessionId = stringField(formData, 'sessionId');
  const orderId = stringField(formData, 'orderId');
  if (!userId || !sessionId || !orderId) return;

  await safely(() => cancelSimulationOrder({ sessionId, userId, orderId }));
  revalidatePath(`/simulations/${sessionId}`);
}

function parsePriceOrNull(value: FormDataEntryValue | null): bigint | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return parsePriceToPaise(value);
  } catch {
    return null;
  }
}

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

async function safely(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof SimulationError)) throw error;
  }
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

// 0n is an invalid order/opening amount, so the service layer rejects it the
// same way it rejected NaN — an unparseable amount never becomes a real order.
function parseAmount(value: FormDataEntryValue | null): bigint {
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

/**
 * `<input type="datetime-local">` yields a zone-less "YYYY-MM-DDTHH:mm". The
 * app treats market time as IST, so interpret it as IST (+05:30) to get a
 * stable instant regardless of server timezone.
 */
function parseIstLocal(value: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/.exec(value);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T${match[2]}${match[3] ?? ':00'}+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
