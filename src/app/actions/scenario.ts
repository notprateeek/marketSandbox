'use server';

import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ScenarioError, startScenario } from '@/server/services/scenario';

export type ScenarioActionState = { status: 'IDLE' | 'ERROR'; message: string };

export async function startScenarioAction(
  _previousState: ScenarioActionState,
  formData: FormData,
): Promise<ScenarioActionState> {
  const session = await auth();
  if (!session?.user?.id) return { status: 'ERROR', message: 'Sign in again.' };

  const slug = typeof formData.get('slug') === 'string' ? (formData.get('slug') as string).trim() : '';
  if (!slug) return { status: 'ERROR', message: 'Missing scenario.' };

  let simulationId: string;
  try {
    const created = await startScenario({ userId: session.user.id, slug });
    simulationId = created.id;
  } catch (error) {
    if (error instanceof ScenarioError) return { status: 'ERROR', message: error.message };
    return { status: 'ERROR', message: 'We could not start this scenario.' };
  }

  redirect(`/simulations/${simulationId}`);
}
