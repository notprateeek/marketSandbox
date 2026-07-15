'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { parsePriceToPaise } from '@/lib/finance/currency';
import { AccountError, addFunds, getActiveAccountId } from '@/server/services/accounts';

export type ProfileFormState = { status: 'IDLE' | 'ERROR' | 'SUCCESS'; message: string };

const initialError = (message: string): ProfileFormState => ({ status: 'ERROR', message });

export async function purchaseFundsAction(
  _previousState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const userId = await currentUserId();
  if (!userId) return initialError('Sign in again to add funds.');

  let amountPaidPaise: number;
  try {
    amountPaidPaise = parsePriceToPaise(stringField(formData, 'amount'));
  } catch {
    return initialError('Enter a valid amount to pay.');
  }

  const accountId = await getActiveAccountId(userId);
  if (!accountId) return initialError('Create a portfolio before adding funds.');

  try {
    await addFunds({ userId, accountId, amountPaidPaise });
  } catch (error) {
    if (error instanceof AccountError) return initialError(error.message);
    return initialError('We could not add funds. Please try again.');
  }

  revalidatePath('/profile');
  revalidatePath('/');
  revalidatePath('/', 'layout');
  return { status: 'SUCCESS', message: 'Funds added to your active portfolio.' };
}

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}
