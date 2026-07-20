'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import {
  SocialError,
  cloneToSandbox,
  followByHandle,
  unfollowByHandle,
  updateProfile,
} from '@/server/services/social';

export type ProfileSettingsState = { status: 'IDLE' | 'ERROR' | 'SUCCESS'; message: string };

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function updateProfileAction(
  _previousState: ProfileSettingsState,
  formData: FormData,
): Promise<ProfileSettingsState> {
  const userId = await currentUserId();
  if (!userId) return { status: 'ERROR', message: 'Sign in again.' };

  try {
    await updateProfile({
      userId,
      handle: stringField(formData, 'handle'),
      bio: stringField(formData, 'bio') || null,
      isPublic: formData.get('isPublic') === 'on',
    });
  } catch (error) {
    if (error instanceof SocialError) return { status: 'ERROR', message: error.message };
    return { status: 'ERROR', message: 'We could not save your profile.' };
  }

  revalidatePath('/profile');
  return { status: 'SUCCESS', message: 'Profile saved.' };
}

export async function followAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  const handle = stringField(formData, 'handle');
  if (!userId || !handle) return;
  try {
    await followByHandle({ followerId: userId, handle });
  } catch (error) {
    if (!(error instanceof SocialError)) throw error;
  }
  revalidatePath(`/u/${handle}`);
  revalidatePath('/feed');
}

export async function unfollowAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  const handle = stringField(formData, 'handle');
  if (!userId || !handle) return;
  try {
    await unfollowByHandle({ followerId: userId, handle });
  } catch (error) {
    if (!(error instanceof SocialError)) throw error;
  }
  revalidatePath(`/u/${handle}`);
  revalidatePath('/feed');
}

export type CloneState = { status: 'IDLE' | 'ERROR'; message: string };

export async function cloneToSandboxAction(
  _previousState: CloneState,
  formData: FormData,
): Promise<CloneState> {
  const userId = await currentUserId();
  if (!userId) return { status: 'ERROR', message: 'Sign in again.' };
  const handle = stringField(formData, 'handle');
  if (!handle) return { status: 'ERROR', message: 'Unknown profile.' };

  let sessionId: string;
  try {
    const session = await cloneToSandbox({ viewerId: userId, handle });
    sessionId = session.id;
  } catch (error) {
    if (error instanceof SocialError) return { status: 'ERROR', message: error.message };
    return { status: 'ERROR', message: 'We could not clone this portfolio.' };
  }

  redirect(`/simulations/${sessionId}`);
}
