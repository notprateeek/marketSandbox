'use client';

import { useActionState, useRef, useState } from 'react';

import {
  closeAccountAction,
  createAccountAction,
  type AccountFormState,
} from '@/app/actions/accounts';

const initialState: AccountFormState = { status: 'IDLE', message: '' };
const inputClass =
  'mt-2 h-11 w-full rounded-sm border border-hairline bg-canvas px-3 text-sm text-primary focus:border-focus-blue';

const PRESET_NAMES = [
  'Long-term investing',
  'Experimental',
  'Sector portfolio',
  'Historical challenge',
];

export function CreatePortfolioForm() {
  const [state, formAction, pending] = useActionState(createAccountAction, initialState);
  const [name, setName] = useState('');

  return (
    <form action={formAction} className="rounded-sm border border-hairline bg-canvas p-5">
      <h3 className="text-heading-feature text-primary">Create a portfolio</h3>

      {state.status === 'ERROR' ? (
        <p
          role="alert"
          className="mt-3 rounded-sm border border-loss/25 bg-loss/5 px-4 py-2.5 text-sm text-loss"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === 'SUCCESS' ? (
        <p
          role="status"
          className="mt-3 rounded-sm border border-deep-green/15 bg-pale-green px-4 py-2.5 text-sm text-primary"
        >
          {state.message}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {PRESET_NAMES.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setName(preset)}
            className="rounded-pill border border-hairline px-3 py-1.5 text-xs font-medium text-body-muted transition-colors hover:border-slate"
          >
            {preset}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="portfolio-name" className="text-sm font-medium text-ink">
            Name
          </label>
          <input
            id="portfolio-name"
            name="name"
            type="text"
            required
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Long-term investing"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="portfolio-balance" className="text-sm font-medium text-ink">
            Starting balance (₹)
          </label>
          <input
            id="portfolio-balance"
            name="initialBalance"
            type="text"
            inputMode="decimal"
            defaultValue="50000"
            className={inputClass}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-5 rounded-pill bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create portfolio'}
      </button>
    </form>
  );
}

export function ClosePortfolioDialog({
  accountId,
  accountName,
}: {
  accountId: string;
  accountName: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="text-sm font-medium text-body-muted transition-colors hover:text-loss"
      >
        Delete
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto max-w-md rounded-sm border border-hairline p-0 backdrop:bg-black/40"
      >
        <div className="p-6">
          <h3 className="text-heading-card text-primary">Delete “{accountName}”?</h3>
          <p className="mt-2 text-sm text-body-muted">
            The portfolio is closed and hidden, but its ledger, orders and positions are kept for
            your records. This cannot be undone from here.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-pill border border-hairline px-4 py-2 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone"
            >
              Cancel
            </button>
            <form action={closeAccountAction}>
              <input type="hidden" name="accountId" value={accountId} />
              <button
                type="submit"
                className="rounded-pill bg-loss px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
              >
                Delete portfolio
              </button>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}
