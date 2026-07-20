'use client';

import { useActionState } from 'react';

import { updateProfileAction, type ProfileSettingsState } from '@/app/actions/social';

const initialState: ProfileSettingsState = { status: 'IDLE', message: '' };
const inputClass =
  'mt-1 w-full rounded-sm border border-hairline bg-canvas px-3 py-2 text-sm text-primary placeholder:text-muted focus:border-focus-blue';

export function ProfileSettingsForm({
  handle,
  bio,
  isPublic,
}: {
  handle: string | null;
  bio: string | null;
  isPublic: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateProfileAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-ink">Handle</span>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-body-muted">@</span>
          <input
            name="handle"
            type="text"
            required
            defaultValue={handle ?? ''}
            maxLength={20}
            placeholder="your_handle"
            className={`${inputClass} lowercase`}
          />
        </div>
        <p className="mt-1 text-xs text-body-muted">
          3–20 characters: letters, numbers, underscores. Your public page is /u/&lt;handle&gt;.
        </p>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-ink">Bio</span>
        <textarea name="bio" rows={2} maxLength={280} defaultValue={bio ?? ''} className={inputClass} />
      </label>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input name="isPublic" type="checkbox" defaultChecked={isPublic} className="h-4 w-4" />
        Make my profile public (return, win rate, streak, badges & challenge history)
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-pill bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save profile'}
        </button>
        {state.status === 'SUCCESS' ? (
          <span className="text-sm text-deep-green">{state.message}</span>
        ) : null}
        {state.status === 'ERROR' ? <span className="text-sm text-loss">{state.message}</span> : null}
        {handle ? (
          <a
            href={`/u/${handle}`}
            className="text-sm font-medium text-action-blue underline-offset-4 hover:underline"
          >
            View public profile →
          </a>
        ) : null}
      </div>
    </form>
  );
}
