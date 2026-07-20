'use client';

import { useActionState } from 'react';

import { generateCoachReviewAction, type CoachActionState } from '@/app/actions/coach';

const initialState: CoachActionState = { status: 'IDLE', message: '' };

export function RegenerateReviewButton({ sessionId, label }: { sessionId: string; label: string }) {
  const [state, formAction, pending] = useActionState(generateCoachReviewAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-pill bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:opacity-60"
      >
        {pending ? 'Asking the coach…' : label}
      </button>
      {state.status === 'ERROR' ? <span className="text-sm text-loss">{state.message}</span> : null}
      {state.status === 'SUCCESS' ? (
        <span className="text-sm text-deep-green">{state.message}</span>
      ) : null}
    </form>
  );
}
