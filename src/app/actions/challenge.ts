'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ChallengeScoringMethod, ChallengeVisibility, OrderSide } from '@/generated/prisma/client';
import { parsePriceToPaise } from '@/lib/finance/currency';
import { parseISTInputValue } from '@/lib/finance/datetime';
import {
  ChallengeError,
  createChallenge,
  joinChallenge,
  resetChallengeAccount,
  submitChallengeOrder,
} from '@/server/services/challenge';
import type { OrderSubmissionResult } from '@/server/services/submit-market-order';

export type ChallengeFormState = { status: 'IDLE' | 'ERROR'; message: string };
export type ChallengeOrderState =
  { status: 'IDLE'; message: '' } | { status: 'ERROR'; message: string } | OrderSubmissionResult;

const SCORING_METHODS: readonly ChallengeScoringMethod[] = [
  'RETURN',
  'DRAWDOWN',
  'PREDICTION_ACCURACY',
];

export async function createChallengeAction(
  _previousState: ChallengeFormState,
  formData: FormData,
): Promise<ChallengeFormState> {
  const session = await auth();
  if (!session?.user?.id)
    return { status: 'ERROR', message: 'Sign in again to create a challenge.' };

  const startTimestamp = parseISTInputValue(stringField(formData, 'startTimestamp'));
  const endTimestamp = parseISTInputValue(stringField(formData, 'endTimestamp'));
  if (!startTimestamp || !endTimestamp) {
    return { status: 'ERROR', message: 'Choose valid start and end times.' };
  }
  const scoringMethod = stringField(formData, 'scoringMethod') as ChallengeScoringMethod;
  if (!SCORING_METHODS.includes(scoringMethod)) {
    return { status: 'ERROR', message: 'Choose a scoring method.' };
  }

  let startingBalancePaise: number;
  try {
    startingBalancePaise = parsePriceToPaise(stringField(formData, 'startingBalance'));
  } catch {
    return { status: 'ERROR', message: 'Enter a valid starting balance.' };
  }

  const maxTradesRaw = stringField(formData, 'maxTrades');
  const allowed = formData
    .getAll('allowedInstrumentIds')
    .filter((v): v is string => typeof v === 'string');

  let created;
  try {
    created = await createChallenge({
      creatorId: session.user.id,
      name: stringField(formData, 'name'),
      description: stringField(formData, 'description'),
      startTimestamp,
      endTimestamp,
      startingBalancePaise,
      allowedInstrumentIds: allowed.length > 0 ? allowed : null,
      maxTrades: maxTradesRaw ? Number(maxTradesRaw) : null,
      resetAllowed: formData.get('resetAllowed') === 'on',
      scoringMethod,
      visibility:
        stringField(formData, 'visibility') === 'PRIVATE'
          ? ChallengeVisibility.PRIVATE
          : ChallengeVisibility.PUBLIC,
    });
  } catch (error) {
    if (error instanceof ChallengeError) return { status: 'ERROR', message: error.message };
    return { status: 'ERROR', message: 'We could not create this challenge. Please try again.' };
  }

  redirect(`/challenges/${created.id}`);
}

export async function joinChallengeAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  const challengeId = stringField(formData, 'challengeId');
  if (!userId || !challengeId) return;
  await safely(() => joinChallenge({ challengeId, userId }));
  revalidatePath(`/challenges/${challengeId}`);
}

export async function resetChallengeAccountAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  const challengeId = stringField(formData, 'challengeId');
  if (!userId || !challengeId) return;
  await safely(() => resetChallengeAccount({ challengeId, userId }));
  revalidatePath(`/challenges/${challengeId}/portfolio`);
}

export async function submitChallengeOrderAction(
  _previousState: ChallengeOrderState,
  formData: FormData,
): Promise<ChallengeOrderState> {
  const userId = await currentUserId();
  if (!userId) return { status: 'ERROR', message: 'Sign in again to trade.' };

  const challengeId = stringField(formData, 'challengeId');
  const instrumentId = stringField(formData, 'instrumentId');
  const side = formData.get('side');
  if (!challengeId || !instrumentId || (side !== 'BUY' && side !== 'SELL')) {
    return { status: 'ERROR', message: 'The order details are invalid.' };
  }

  try {
    const result = await submitChallengeOrder({
      challengeId,
      userId,
      side: side === 'BUY' ? OrderSide.BUY : OrderSide.SELL,
      instrumentId,
      amountPaise: side === 'BUY' ? parseAmount(formData.get('amount')) : undefined,
      quantity: side === 'SELL' ? parseQuantity(formData.get('quantity')) : undefined,
    });
    revalidatePath(`/challenges/${challengeId}/portfolio`);
    return result;
  } catch (error) {
    if (error instanceof ChallengeError) return { status: 'ERROR', message: error.message };
    return { status: 'ERROR', message: 'We could not place this order. Please try again.' };
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
    if (!(error instanceof ChallengeError)) throw error;
  }
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function parseAmount(value: FormDataEntryValue | null): number {
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
