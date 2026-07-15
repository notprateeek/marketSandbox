'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { PredictionDirection } from '@/generated/prisma/client';
import { parseISTInputValue } from '@/lib/finance/datetime';
import { cancelPrediction, createPrediction, PredictionError } from '@/server/services/prediction';

export type PredictionFormState = { status: 'IDLE' | 'ERROR' | 'SUCCESS'; message: string };

const DIRECTIONS: readonly PredictionDirection[] = ['UP', 'DOWN', 'FLAT'];

export async function createPredictionAction(
  _previousState: PredictionFormState,
  formData: FormData,
): Promise<PredictionFormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { status: 'ERROR', message: 'Sign in again to record a prediction.' };
  }

  const instrumentId = stringField(formData, 'instrumentId');
  const direction = stringField(formData, 'direction') as PredictionDirection;
  const targetPercentage = Number(stringField(formData, 'targetPercentage'));
  const expiryTimestamp = parseISTInputValue(stringField(formData, 'expiryTimestamp'));
  const simulationSessionId = stringField(formData, 'simulationSessionId') || null;

  if (!instrumentId || !DIRECTIONS.includes(direction)) {
    return { status: 'ERROR', message: 'Choose an instrument and a direction.' };
  }
  if (!Number.isFinite(targetPercentage)) {
    return { status: 'ERROR', message: 'Enter a valid target percentage.' };
  }
  if (!expiryTimestamp) {
    return { status: 'ERROR', message: 'Choose a valid expiry date and time.' };
  }

  try {
    await createPrediction({
      userId: session.user.id,
      instrumentId,
      simulationSessionId,
      direction,
      targetPercentage,
      expiryTimestamp,
      notes: stringField(formData, 'notes'),
    });
  } catch (error) {
    if (error instanceof PredictionError) return { status: 'ERROR', message: error.message };
    return { status: 'ERROR', message: 'We could not record this prediction. Please try again.' };
  }

  revalidatePath('/predictions');
  return { status: 'SUCCESS', message: 'Prediction recorded.' };
}

export async function cancelPredictionAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  const predictionId = stringField(formData, 'predictionId');
  if (!userId || !predictionId) return;

  try {
    await cancelPrediction({ predictionId, userId });
  } catch (error) {
    if (!(error instanceof PredictionError)) throw error;
  }
  revalidatePath('/predictions');
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}
