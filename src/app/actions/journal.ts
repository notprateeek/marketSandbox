'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { JournalError, saveJournalEntry } from '@/server/services/journal';

export type JournalFormState = { status: 'IDLE' | 'ERROR' | 'SUCCESS'; message: string };

export async function saveJournalEntryAction(
  _previousState: JournalFormState,
  formData: FormData,
): Promise<JournalFormState> {
  const session = await auth();
  if (!session?.user?.id) return { status: 'ERROR', message: 'Sign in again.' };

  const orderId = stringField(formData, 'orderId');
  if (!orderId) return { status: 'ERROR', message: 'Missing trade reference.' };

  try {
    await saveJournalEntry({
      userId: session.user.id,
      orderId,
      fields: {
        reason: optional(formData, 'reason'),
        expectedOutcome: optional(formData, 'expectedOutcome'),
        intendedHoldingPeriod: optional(formData, 'intendedHoldingPeriod'),
        riskConsidered: optional(formData, 'riskConsidered'),
        confidence: numberOrNull(formData, 'confidence'),
        whatHappened: optional(formData, 'whatHappened'),
        whatLearned: optional(formData, 'whatLearned'),
        thesisCorrect: thesisValue(formData),
      },
    });
  } catch (error) {
    if (error instanceof JournalError) return { status: 'ERROR', message: error.message };
    return { status: 'ERROR', message: 'We could not save this journal entry.' };
  }

  revalidatePath('/journal');
  return { status: 'SUCCESS', message: 'Saved.' };
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function optional(formData: FormData, key: string): string | null {
  return stringField(formData, key) || null;
}

function numberOrNull(formData: FormData, key: string): number | null {
  const value = stringField(formData, key);
  return value ? Number(value) : null;
}

function thesisValue(formData: FormData): boolean | null {
  const value = stringField(formData, 'thesisCorrect');
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}
