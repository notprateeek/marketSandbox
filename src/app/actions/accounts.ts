'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { parsePriceToPaise } from '@/lib/finance/currency';
import {
  AccountError,
  closeAccount,
  createAccount,
  setActiveAccount,
} from '@/server/services/accounts';

export type AccountFormState = { status: 'IDLE' | 'ERROR' | 'SUCCESS'; message: string };

export async function createAccountAction(
  _previousState: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const session = await auth();
  if (!session?.user?.id) return { status: 'ERROR', message: 'Sign in again to add a portfolio.' };

  let initialBalancePaise: number;
  try {
    initialBalancePaise = parsePriceToPaise(stringField(formData, 'initialBalance'));
  } catch {
    return { status: 'ERROR', message: 'Enter a valid starting balance.' };
  }

  try {
    await createAccount({
      userId: session.user.id,
      name: stringField(formData, 'name'),
      initialBalancePaise,
    });
  } catch (error) {
    if (error instanceof AccountError) return { status: 'ERROR', message: error.message };
    return { status: 'ERROR', message: 'We could not create this portfolio. Please try again.' };
  }

  revalidatePath('/');
  return { status: 'SUCCESS', message: 'Portfolio created.' };
}

export async function setActiveAccountAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  const accountId = stringField(formData, 'accountId');
  if (!userId || !accountId) return;

  await safely(() => setActiveAccount({ userId, accountId }));
  revalidatePath('/', 'layout');
}

export async function closeAccountAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  const accountId = stringField(formData, 'accountId');
  if (!userId || !accountId) return;

  await safely(() => closeAccount({ userId, accountId }));
  revalidatePath('/', 'layout');
}

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

async function safely(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof AccountError)) throw error;
  }
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}
