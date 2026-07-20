'use client';

import { useActionState } from 'react';

import { startScenarioAction, type ScenarioActionState } from '@/app/actions/scenario';

const initialState: ScenarioActionState = { status: 'IDLE', message: '' };

export function StartScenarioForm({ slug }: { slug: string }) {
  const [state, formAction, pending] = useActionState(startScenarioAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="slug" value={slug} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-pill bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:opacity-60"
      >
        {pending ? 'Starting…' : 'Start scenario'}
      </button>
      {state.status === 'ERROR' ? (
        <span className="text-sm text-loss">{state.message}</span>
      ) : null}
    </form>
  );
}
