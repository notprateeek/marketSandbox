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
        placeholder="Invite code"
        aria-label="Invite code"
        className="h-10 w-40 rounded-sm border border-hairline bg-canvas px-3 text-sm uppercase tracking-wide text-primary focus:border-focus-blue"
      />
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-pill border border-hairline px-4 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone disabled:opacity-60"
      >
        {pending ? 'Joining…' : 'Join by code'}
      </button>
      {state.status === 'ERROR' ? <span className="text-sm text-loss">{state.message}</span> : null}
    </form>
  );
}
