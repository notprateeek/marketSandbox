'use client';

import { useActionState, useState } from 'react';

import { purchaseFundsAction, type ProfileFormState } from '@/app/actions/profile';
import { formatINR } from '@/lib/finance/currency';

const initialState: ProfileFormState = { status: 'IDLE', message: '' };
const inputClass =
  'mt-2 h-11 w-full rounded-sm border border-hairline bg-canvas px-3 text-sm text-primary focus:border-focus-blue';

// Pay amounts in rupees. You receive half (0.5x) as virtual cash.
const PACKS = [1000, 5000, 25000, 100000];

export function BuyFundsCheckout({ activePortfolioName }: { activePortfolioName: string }) {
  const [state, formAction, pending] = useActionState(purchaseFundsAction, initialState);
  const [amount, setAmount] = useState('1000');

  const pay = Number(amount);
  const receive = Number.isFinite(pay) && pay > 0 ? Math.floor(pay * 100 * 0.5) / 100 : 0;

  return (
    <section className="overflow-hidden rounded-sm border border-hairline bg-canvas">
      <div className="border-b border-hairline px-5 py-4">
        <h3 className="text-heading-feature text-primary">Buy virtual funds</h3>
        <p className="mt-1 text-sm text-body-muted">
          Top up <span className="font-medium text-primary">{activePortfolioName}</span> — your
          active portfolio. You receive 50% of what you pay as virtual cash.
        </p>
      </div>

      <form action={formAction} className="p-5">
        {state.status === 'ERROR' ? (
          <p
            role="alert"
            className="mb-4 rounded-sm border border-loss/25 bg-loss/5 px-4 py-2.5 text-sm text-loss"
          >
            {state.message}
          </p>
        ) : null}
        {state.status === 'SUCCESS' ? (
          <p
            role="status"
            className="mb-4 rounded-sm border border-deep-green/15 bg-pale-green px-4 py-2.5 text-sm text-primary"
          >
            {state.message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {PACKS.map((pack) => (
            <button
              key={pack}
              type="button"
              onClick={() => setAmount(String(pack))}
              className={`rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors ${
                amount === String(pack)
                  ? 'border-action-blue bg-pale-blue/40 text-primary'
                  : 'border-hairline text-body-muted hover:border-slate'
              }`}
            >
              {formatINR(pack)}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label htmlFor="pay-amount" className="text-sm font-medium text-ink">
            You pay (₹)
          </label>
          <input
            id="pay-amount"
            name="amount"
            type="text"
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
          />
        </div>

        {/* Highlighted "you receive" summary */}
        <div className="mt-4 rounded-sm bg-deep-green px-5 py-4 text-white">
          <p className="text-mono-label text-white/55">You receive</p>
          <p className="mt-1 font-display text-3xl tracking-tight">{formatINR(receive)}</p>
          <p className="mt-1 text-sm text-white/70">Virtual cash · credited instantly</p>
        </div>

        {/* Cosmetic payment fields — nothing here is submitted or charged. */}
        <fieldset className="mt-5 space-y-3 rounded-sm border border-hairline p-4">
          <legend className="px-1 text-mono-label text-muted">Payment details</legend>
          <div>
            <label htmlFor="card-number" className="text-sm font-medium text-ink">
              Card / UPI ID
            </label>
            <input
              id="card-number"
              type="text"
              autoComplete="off"
              placeholder="4242 4242 4242 4242"
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="card-expiry" className="text-sm font-medium text-ink">
                Expiry
              </label>
              <input id="card-expiry" type="text" placeholder="12/29" className={inputClass} />
            </div>
            <div>
              <label htmlFor="card-cvv" className="text-sm font-medium text-ink">
                CVV
              </label>
              <input id="card-cvv" type="text" placeholder="123" className={inputClass} />
            </div>
          </div>
          <p className="text-xs text-muted">
            Simulated checkout — no real payment is taken and these details are not stored.
          </p>
        </fieldset>

        <button
          type="submit"
          disabled={pending || receive <= 0}
          className="mt-5 w-full rounded-pill bg-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:opacity-60"
        >
          {pending ? 'Processing…' : `Pay ${formatINR(pay > 0 ? pay : 0)}`}
        </button>
      </form>
    </section>
  );
}
