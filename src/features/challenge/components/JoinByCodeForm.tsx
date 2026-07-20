'use client';

import { useActionState } from 'react';

import { joinByCodeAction, type JoinByCodeState } from '@/app/actions/challenge';

const initialState: JoinByCodeState = { status: 'IDLE', message: '' };

export function JoinByCodeForm() {
  const [state, formAction, pending] = useActionState(joinByCodeAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        name="inviteCode"
        type="text"
        required
        maxLength={16}
        placeholder="e.g. 7QK2P9"
        aria-label="Invite code"
        className="h-10 w-40 rounded-sm border border-hairline bg-canvas px-3 text-sm uppercase tracking-wide text-primary placeholder:normal-case placeholder:tracking-normal placeholder:text-muted/80 focus:border-focus-blue"
      />
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-pill bg-primary px-5 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:opacity-60"
      >
        {pending ? 'Joining…' : 'Join'}
      </button>
      {state.status === 'ERROR' ? <span className="text-sm text-loss">{state.message}</span> : null}
    </form>
  );
}
