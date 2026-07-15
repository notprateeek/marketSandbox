'use client';

import { useActionState } from 'react';

import {
  addWatchlistItemAction,
  createWatchlistAction,
  type WatchlistFormState,
} from '@/app/actions/watchlist';

const initialState: WatchlistFormState = { status: 'IDLE', message: '' };

interface InstrumentOption {
  id: string;
  symbol: string;
  companyName: string;
}

export function CreateWatchlistForm() {
  const [state, formAction, pending] = useActionState(createWatchlistAction, initialState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex-1">
        <label htmlFor="new-watchlist" className="sr-only">
          New watchlist name
        </label>
        <input
          id="new-watchlist"
          name="name"
          type="text"
          required
          maxLength={60}
          placeholder="New watchlist name"
          className="h-10 w-full rounded-sm border border-hairline bg-canvas px-3 text-sm text-primary focus:border-focus-blue"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-pill bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:opacity-60"
      >
        Create
      </button>
      {state.status === 'ERROR' ? (
        <p role="alert" className="w-full text-sm text-loss">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function AddInstrumentForm({
  watchlistId,
  instruments,
}: {
  watchlistId: string;
  instruments: InstrumentOption[];
}) {
  const [state, formAction, pending] = useActionState(addWatchlistItemAction, initialState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="watchlistId" value={watchlistId} />
      <div className="flex-1">
        <label htmlFor="add-instrument" className="sr-only">
          Add instrument
        </label>
        <select
          id="add-instrument"
          name="instrumentId"
          required
          defaultValue={instruments[0]?.id}
          className="h-10 w-full rounded-sm border border-hairline bg-canvas px-3 text-sm text-primary focus:border-focus-blue"
        >
          {instruments.map((instrument) => (
            <option key={instrument.id} value={instrument.id}>
              {instrument.symbol} — {instrument.companyName}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="h-10 rounded-pill border border-hairline px-4 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone disabled:opacity-60"
      >
        Add
      </button>
      {state.status === 'ERROR' ? (
        <p role="alert" className="w-full text-sm text-loss">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
