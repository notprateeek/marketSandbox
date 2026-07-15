'use client';

import { useActionState, useState } from 'react';

import { submitChallengeOrderAction, type ChallengeOrderState } from '@/app/actions/challenge';

type Side = 'BUY' | 'SELL';

interface InstrumentOption {
  id: string;
  symbol: string;
  companyName: string;
}

const initialState: ChallengeOrderState = { status: 'IDLE', message: '' };
const inputClassName =
  'mt-2 h-12 w-full rounded-sm border border-hairline bg-canvas px-3.5 text-primary placeholder:text-muted transition-colors hover:border-slate focus:border-focus-blue';

export function ChallengeTradeTicket({
  challengeId,
  instruments,
  disabledReason,
}: {
  challengeId: string;
  instruments: InstrumentOption[];
  disabledReason?: string;
}) {
  const [side, setSide] = useState<Side>('BUY');
  const [state, formAction, pending] = useActionState(submitChallengeOrderAction, initialState);
  const isBuy = side === 'BUY';

  return (
    <section
      aria-labelledby="challenge-trade-heading"
      className="rounded-sm border border-hairline"
    >
      <header className="border-b border-hairline px-5 py-4">
        <p className="text-mono-label text-muted">Challenge trade</p>
        <h3 id="challenge-trade-heading" className="mt-1 text-heading-feature text-primary">
          Place a market order
        </h3>
      </header>

      <div className="p-5">
        <OrderResult state={state} />

        {disabledReason ? (
          <p className="rounded-sm border border-hairline bg-soft-stone/35 px-4 py-3 text-sm text-body-muted">
            {disabledReason}
          </p>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="challengeId" value={challengeId} />
            <input type="hidden" name="side" value={side} />

            <fieldset>
              <legend className="text-sm font-medium text-ink">Side</legend>
              <div className="mt-2 grid grid-cols-2 rounded-sm bg-soft-stone/55 p-1">
                {(['BUY', 'SELL'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={side === option}
                    onClick={() => setSide(option)}
                    className={`rounded-xs px-3 py-2.5 text-sm font-semibold transition-colors ${
                      side === option
                        ? 'border border-action-blue bg-canvas text-action-blue'
                        : 'border border-transparent text-body-muted hover:text-primary'
                    }`}
                  >
                    {option === 'BUY' ? 'Buy' : 'Sell'}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-4">
              <label htmlFor="challenge-instrument" className="text-sm font-medium text-ink">
                Instrument
              </label>
              <select
                id="challenge-instrument"
                name="instrumentId"
                required
                className={inputClassName}
                defaultValue={instruments[0]?.id}
              >
                {instruments.map((instrument) => (
                  <option key={instrument.id} value={instrument.id}>
                    {instrument.symbol} — {instrument.companyName}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4">
              <label htmlFor="challenge-value" className="text-sm font-medium text-ink">
                {isBuy ? 'Amount (₹)' : 'Quantity'}
              </label>
              {isBuy ? (
                <input
                  id="challenge-value"
                  name="amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="5000.00"
                  className={inputClassName}
                />
              ) : (
                <input
                  id="challenge-value"
                  name="quantity"
                  type="number"
                  min={1}
                  step={1}
                  placeholder="1"
                  className={inputClassName}
                />
              )}
            </div>

            <button
              type="submit"
              disabled={pending}
              className="mt-5 w-full rounded-pill bg-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? 'Submitting…' : `Submit ${isBuy ? 'buy' : 'sell'}`}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

function OrderResult({ state }: { state: ChallengeOrderState }) {
  if (state.status === 'IDLE') return null;
  if (state.status === 'ERROR' || state.status === 'REJECTED') {
    return (
      <div role="alert" className="mb-4 rounded-sm border border-loss/25 bg-loss/5 px-4 py-3">
        <p className="text-mono-label text-loss">
          {state.status === 'REJECTED' ? 'Order rejected' : 'Order not placed'}
        </p>
        <p className="mt-1 text-sm text-loss">{state.message}</p>
      </div>
    );
  }
  return (
    <div
      role="status"
      className="mb-4 rounded-sm border border-deep-green/15 bg-pale-green px-4 py-3"
    >
      <p className="text-mono-label text-deep-green">Order filled</p>
      <p className="mt-1 text-sm text-primary">{state.message}</p>
    </div>
  );
}
