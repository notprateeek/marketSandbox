'use client';

import { useActionState } from 'react';

import {
  cloneToSandboxAction,
  followAction,
  unfollowAction,
  type CloneState,
} from '@/app/actions/social';

const initialClone: CloneState = { status: 'IDLE', message: '' };

export function ProfileActions({
  handle,
  isFollowing,
  isSelf,
}: {
  handle: string;
  isFollowing: boolean;
  isSelf: boolean;
}) {
  const [cloneState, cloneAction, cloning] = useActionState(cloneToSandboxAction, initialClone);

  if (isSelf) {
    return (
      <a
        href="/profile"
        className="rounded-pill border border-hairline px-5 py-2.5 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone"
      >
        Edit profile
      </a>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={isFollowing ? unfollowAction : followAction}>
        <input type="hidden" name="handle" value={handle} />
        <button
          type="submit"
          className={`rounded-pill px-5 py-2.5 text-sm font-medium transition-colors ${
            isFollowing
              ? 'border border-hairline text-primary hover:border-slate hover:bg-soft-stone'
              : 'bg-primary text-white hover:bg-cohere-black'
          }`}
        >
          {isFollowing ? 'Following' : 'Follow'}
        </button>
      </form>

      <form action={cloneAction}>
        <input type="hidden" name="handle" value={handle} />
        <button
          type="submit"
          disabled={cloning}
          className="rounded-pill border border-action-blue px-5 py-2.5 text-sm font-medium text-action-blue transition-colors hover:bg-pale-blue disabled:opacity-60"
        >
          {cloning ? 'Cloning…' : 'Study this portfolio'}
        </button>
      </form>

      {cloneState.status === 'ERROR' ? (
        <span className="text-sm text-loss">{cloneState.message}</span>
      ) : null}
    </div>
  );
}
