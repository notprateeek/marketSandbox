'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { generateCoachReview } from '@/server/services/coach';

export type CoachActionState = { status: 'IDLE' | 'ERROR' | 'SUCCESS'; message: string };

export async function generateCoachReviewAction(
  _previousState: CoachActionState,
  formData: FormData,
): Promise<CoachActionState> {
  const session = await auth();
  if (!session?.user?.id) return { status: 'ERROR', message: 'Sign in again.' };

  const sessionId = typeof formData.get('sessionId') === 'string' ? (formData.get('sessionId') as string) : '';
  if (!sessionId) return { status: 'ERROR', message: 'Missing simulation.' };

  const result = await generateCoachReview({ sessionId, userId: session.user.id, force: true });

  switch (result.status) {
    case 'GENERATED':
      revalidatePath(`/simulations/${sessionId}/coach`);
      return { status: 'SUCCESS', message: 'Fresh review generated.' };
    case 'RATE_LIMITED':
      return { status: 'ERROR', message: 'A review was generated recently — try again in a few minutes.' };
    case 'NO_KEY':
      return { status: 'ERROR', message: 'The AI coach is not configured on this server.' };
    case 'NO_DATA':
      return { status: 'ERROR', message: 'No analytics available for this simulation yet.' };
    default:
      return { status: 'ERROR', message: 'Not enough closed trades to review yet.' };
  }
}
