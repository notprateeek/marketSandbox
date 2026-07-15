'use client';

import { useActionState, useState } from 'react';

import { createSimulationAction, type CreateSimulationState } from '@/app/actions/simulation';

const initialState: CreateSimulationState = { status: 'IDLE', message: '' };
const BALANCE_PRESETS = [
  { label: '₹50,000', value: '50000' },
  { label: '₹1,00,000', value: '100000' },
  { label: '₹5,00,000', value: '500000' },
];
const inputClassName =
  'mt-2 h-12 w-full rounded-sm border border-hairline bg-canvas px-3.5 text-primary placeholder:text-muted transition-colors hover:border-slate focus:border-focus-blue';

interface SimulationWizardProps {
  minLocal: string;
  maxLocal: string;
  defaultLocal: string;
}

export function SimulationWizard({ minLocal, maxLocal, defaultLocal }: SimulationWizardProps) {
  const [state, formAction, pending] = useActionState(createSimulationAction, initialState);
  const [balance, setBalance] = useState('50000');

  return (
    <form action={formAction} className="space-y-8">
      {state.status === 'ERROR' ? (
        <div
          role="alert"
          className="rounded-sm border border-loss/25 bg-loss/5 px-4 py-3 text-sm text-loss"
        >
          {state.message}
        </div>
      ) : null}

      <Step number={1} title="Name your simulation">
        <label htmlFor="sim-name" className="sr-only">
          Simulation name
        </label>
        <input
          id="sim-name"
          name="name"
          type="text"
          defaultValue="Historical replay"
          maxLength={80}
          autoComplete="off"
          className={inputClassName}
        />
      </Step>

      <Step
        number={2}
        title="Choose a historical start"
        hint="The clock begins here; you move it forward manually."
      >
        <label htmlFor="sim-start" className="sr-only">
          Start date and time (IST)
        </label>
        <input
          id="sim-start"
          name="startTimestamp"
          type="datetime-local"
          min={minLocal}
          max={maxLocal}
          defaultValue={defaultLocal}
          step={60}
          required
          className={inputClassName}
        />
        <p className="mt-2 text-xs text-body-muted">
          Market data runs from {minLocal.replace('T', ' ')} to {maxLocal.replace('T', ' ')} IST.
        </p>
      </Step>

      <Step number={3} title="Set a virtual starting balance">
        <div className="flex flex-wrap gap-2">
          {BALANCE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              aria-pressed={balance === preset.value}
              onClick={() => setBalance(preset.value)}
              className={`rounded-pill border px-4 py-2 text-sm font-medium transition-colors ${
                balance === preset.value
                  ? 'border-action-blue text-action-blue'
                  : 'border-hairline text-body-muted hover:border-slate'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <label htmlFor="sim-balance" className="mt-4 block text-sm font-medium text-ink">
          Amount (₹)
        </label>
        <input
          id="sim-balance"
          name="initialBalance"
          type="text"
          inputMode="decimal"
          value={balance}
          onChange={(event) => setBalance(event.target.value)}
          className={inputClassName}
        />
      </Step>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-pill bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:cursor-wait disabled:opacity-60 sm:w-auto"
      >
        {pending ? 'Creating…' : 'Create simulation'}
      </button>
    </form>
  );
}

function Step({
  number,
  title,
  hint,
  children,
}: {
  number: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className="flex items-baseline gap-2">
        <span className="text-mono-label text-muted">Step {number}</span>
        <span className="text-heading-feature text-primary">{title}</span>
      </legend>
      {hint ? <p className="mt-1 text-sm text-body-muted">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </fieldset>
  );
}
