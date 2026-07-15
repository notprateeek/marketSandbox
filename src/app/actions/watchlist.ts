'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import {
  addWatchlistItem,
  createWatchlist,
  deleteWatchlist,
  moveWatchlistItem,
  removeWatchlistItem,
  WatchlistError,
} from '@/server/services/watchlist';

export type WatchlistFormState = { status: 'IDLE' | 'ERROR'; message: string };

export async function createWatchlistAction(
  _previousState: WatchlistFormState,
  formData: FormData,
): Promise<WatchlistFormState> {
  const userId = await currentUserId();
  if (!userId) return { status: 'ERROR', message: 'Sign in again.' };

  const name = stringField(formData, 'name');
  if (!name) return { status: 'ERROR', message: 'Name the watchlist.' };

  await createWatchlist({ userId, name });
  revalidatePath('/watchlist');
  return { status: 'IDLE', message: '' };
}

export async function addWatchlistItemAction(
  _previousState: WatchlistFormState,
  formData: FormData,
): Promise<WatchlistFormState> {
  const userId = await currentUserId();
  if (!userId) return { status: 'ERROR', message: 'Sign in again.' };

  const watchlistId = stringField(formData, 'watchlistId');
  const instrumentId = stringField(formData, 'instrumentId');
  if (!watchlistId || !instrumentId) return { status: 'ERROR', message: 'Choose an instrument.' };

  try {
    await addWatchlistItem({ userId, watchlistId, instrumentId });
  } catch (error) {
    if (error instanceof WatchlistError) return { status: 'ERROR', message: error.message };
    throw error;
  }
  revalidatePath('/watchlist');
  return { status: 'IDLE', message: '' };
}

export async function deleteWatchlistAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  const watchlistId = stringField(formData, 'watchlistId');
  if (!userId || !watchlistId) return;
  await safely(() => deleteWatchlist({ userId, watchlistId }));
  revalidatePath('/watchlist');
}

export async function removeWatchlistItemAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  const itemId = stringField(formData, 'itemId');
  if (!userId || !itemId) return;
  await safely(() => removeWatchlistItem({ userId, itemId }));
  revalidatePath('/watchlist');
}

export async function moveWatchlistItemAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  const itemId = stringField(formData, 'itemId');
  const direction = stringField(formData, 'direction');
  if (!userId || !itemId || (direction !== 'UP' && direction !== 'DOWN')) return;
  await safely(() => moveWatchlistItem({ userId, itemId, direction }));
  revalidatePath('/watchlist');
}

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

async function safely(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof WatchlistError)) throw error;
  }
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}
