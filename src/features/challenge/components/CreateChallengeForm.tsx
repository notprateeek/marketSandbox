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

      <fieldset>
        <legend className="text-sm font-medium text-ink">Schedule (IST)</legend>
        <p className="mt-0.5 text-xs text-body-muted">
          Players join before the start, then trade until the end.
        </p>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <Field label="Starts" hint="Registration closes; trading begins.">
            <input
              name="startTimestamp"
              type="datetime-local"
              step={60}
              required
              className={inputClass}
            />
          </Field>
          <Field label="Ends" hint="Trading stops; leaderboard is final.">
            <input
              name="endTimestamp"
              type="datetime-local"
              step={60}
              required
              className={inputClass}
            />
          </Field>
        </div>
      </fieldset>

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
        <Field
          label="Visibility"
          hint="Private challenges get an invite code — it appears on the challenge page after you create it, to share with players."
        >
          <select name="visibility" className={inputClass} defaultValue="PUBLIC">
            <option value="PUBLIC">Public (listed)</option>
            <option value="PRIVATE">Private (invite code)</option>
          </select>
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input name="resetAllowed" type="checkbox" className="h-4 w-4" />
        Allow participants to reset their account
      </label>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input name="recurring" type="checkbox" className="h-4 w-4" />
        Repeat weekly (auto-rolls to a fresh contest when this one ends)
      </label>

      <fieldset className="rounded-sm border border-hairline p-4">
        <legend className="px-1 text-sm font-medium text-ink">Sponsor (optional)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sponsor name">
            <input name="sponsorName" type="text" maxLength={80} className={inputClass} placeholder="Acme Broking" />
          </Field>
          <Field label="Sponsor logo URL">
            <input name="sponsorLogoUrl" type="url" maxLength={500} className={inputClass} placeholder="https://…/logo.png" />
          </Field>
        </div>
      </fieldset>

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
