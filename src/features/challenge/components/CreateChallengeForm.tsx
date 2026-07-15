'use client';

import { useActionState } from 'react';

import { createChallengeAction, type ChallengeFormState } from '@/app/actions/challenge';

const initialState: ChallengeFormState = { status: 'IDLE', message: '' };
const inputClass =
  'mt-2 h-11 w-full rounded-sm border border-hairline bg-canvas px-3 text-sm text-primary focus:border-focus-blue';

const SCORING = [
  { value: 'RETURN', label: 'Highest percentage return' },
  { value: 'DRAWDOWN', label: 'Lowest maximum drawdown' },
  { value: 'PREDICTION_ACCURACY', label: 'Best prediction accuracy' },
];

interface InstrumentOption {
  id: string;
  symbol: string;
  companyName: string;
}

export function CreateChallengeForm({ instruments }: { instruments: InstrumentOption[] }) {
  const [state, formAction, pending] = useActionState(createChallengeAction, initialState);

  return (
    <form action={formAction} className="space-y-6">
      {state.status === 'ERROR' ? (
        <p
          role="alert"
          className="rounded-sm border border-loss/25 bg-loss/5 px-4 py-3 text-sm text-loss"
        >
          {state.message}
        </p>
      ) : null}

      <Field label="Name">
        <input
          name="name"
          type="text"
          required
          maxLength={80}
          className={inputClass}
          placeholder="July growth sprint"
        />
      </Field>
      <Field label="Description">
        <textarea
          name="description"
          rows={2}
          maxLength={280}
          className="mt-2 w-full rounded-sm border border-hairline bg-canvas px-3 py-2 text-sm text-primary focus:border-focus-blue"
          placeholder="What is this challenge about?"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Registration closes / starts (IST)">
          <input
            name="startTimestamp"
            type="datetime-local"
            step={60}
            required
            className={inputClass}
          />
        </Field>
        <Field label="Ends (IST)">
          <input
            name="endTimestamp"
            type="datetime-local"
            step={60}
            required
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starting balance (₹)">
          <input
            name="startingBalance"
            type="text"
            inputMode="decimal"
            defaultValue="100000"
            className={inputClass}
          />
        </Field>
        <Field label="Scoring method" hint="A single metric — scores are never blended.">
          <select name="scoringMethod" className={inputClass} defaultValue="RETURN">
            {SCORING.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Maximum trades (optional)">
          <input
            name="maxTrades"
            type="number"
            min={1}
            step={1}
            className={inputClass}
            placeholder="Unlimited"
          />
        </Field>
        <Field label="Visibility">
          <select name="visibility" className={inputClass} defaultValue="PUBLIC">
            <option value="PUBLIC">Public (listed)</option>
            <option value="PRIVATE">Private (link only)</option>
          </select>
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input name="resetAllowed" type="checkbox" className="h-4 w-4" />
        Allow participants to reset their account
      </label>

      <Field
        label="Allowed instruments (optional)"
        hint="Tick the instruments to allow. Leave all unticked to allow everything."
      >
        <div className="mt-2 max-h-56 overflow-y-auto rounded-sm border border-hairline bg-canvas p-1">
          {instruments.map((instrument) => (
            <label
              key={instrument.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-xs px-2 py-1.5 text-sm text-primary hover:bg-soft-stone/60"
            >
              <input
                type="checkbox"
                name="allowedInstrumentIds"
                value={instrument.id}
                className="h-4 w-4 shrink-0"
              />
              <span className="font-medium">{instrument.symbol}</span>
              <span className="truncate text-body-muted">{instrument.companyName}</span>
            </label>
          ))}
        </div>
      </Field>

      <button
        type="submit"
        disabled={pending}
        className="rounded-pill bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create challenge'}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-ink">{label}</label>
      {hint ? <p className="mt-0.5 text-xs text-body-muted">{hint}</p> : null}
      {children}
    </div>
  );
}
