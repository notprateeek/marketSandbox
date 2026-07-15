'use client';

import { useActionState, useState } from 'react';

import { createPredictionAction, type PredictionFormState } from '@/app/actions/prediction';

type Direction = 'UP' | 'DOWN' | 'FLAT';

interface InstrumentOption {
  id: string;
  symbol: string;
  companyName: string;
}

interface SimulationOption {
  id: string;
  name: string;
}

interface PredictionFormProps {
  instruments: InstrumentOption[];
  simulations: SimulationOption[];
}

const initialState: PredictionFormState = { status: 'IDLE', message: '' };
const inputClassName =
  'mt-2 h-12 w-full rounded-sm border border-hairline bg-canvas px-3.5 text-primary placeholder:text-muted transition-colors hover:border-slate focus:border-focus-blue';

const DIRECTION_LABEL: Record<Direction, string> = {
  UP: 'Rise',
  DOWN: 'Fall',
  FLAT: 'Stay flat',
};

export function PredictionForm({ instruments, simulations }: PredictionFormProps) {
  const [direction, setDirection] = useState<Direction>('UP');
  const [state, formAction, pending] = useActionState(createPredictionAction, initialState);

  const percentLabel =
    direction === 'FLAT'
      ? 'Tolerance band (%)'
      : `Target ${DIRECTION_LABEL[direction].toLowerCase()} (%)`;

  return (
    <form action={formAction} className="rounded-sm border border-hairline bg-canvas p-5">
      <h3 className="text-heading-feature text-primary">Record a prediction</h3>

      {state.status === 'ERROR' ? (
        <p
          role="alert"
          className="mt-3 rounded-sm border border-loss/25 bg-loss/5 px-4 py-3 text-sm text-loss"
        >
          {state.message}
        </p>
      ) : null}
      {state.status === 'SUCCESS' ? (
        <p
          role="status"
          className="mt-3 rounded-sm border border-deep-green/15 bg-pale-green px-4 py-3 text-sm text-primary"
        >
          {state.message}
        </p>
      ) : null}

      <input type="hidden" name="direction" value={direction} />

      <div className="mt-4">
        <label htmlFor="prediction-instrument" className="text-sm font-medium text-ink">
          Instrument
        </label>
        <select
          id="prediction-instrument"
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

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-ink">Direction</legend>
        <div className="mt-2 grid grid-cols-3 rounded-sm bg-soft-stone/55 p-1">
          {(['UP', 'DOWN', 'FLAT'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={direction === option}
              onClick={() => setDirection(option)}
              className={`rounded-xs px-3 py-2.5 text-sm font-semibold transition-colors ${
                direction === option
                  ? 'border border-action-blue bg-canvas text-action-blue'
                  : 'border border-transparent text-body-muted hover:text-primary'
              }`}
            >
              {DIRECTION_LABEL[option]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="prediction-percent" className="text-sm font-medium text-ink">
            {percentLabel}
          </label>
          <input
            id="prediction-percent"
            name="targetPercentage"
            type="number"
            min={0.1}
            step={0.1}
            required
            placeholder="5"
            className={inputClassName}
          />
        </div>
        <div>
          <label htmlFor="prediction-expiry" className="text-sm font-medium text-ink">
            Expiry (IST)
          </label>
          <input
            id="prediction-expiry"
            name="expiryTimestamp"
            type="datetime-local"
            step={60}
            required
            className={inputClassName}
          />
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="prediction-sim" className="text-sm font-medium text-ink">
          Context
        </label>
        <select
          id="prediction-sim"
          name="simulationSessionId"
          className={inputClassName}
          defaultValue=""
        >
          <option value="">Live (latest prices)</option>
          {simulations.map((simulation) => (
            <option key={simulation.id} value={simulation.id}>
              Simulation: {simulation.name}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-body-muted">
          In a simulation, the prediction is timed to the simulation clock and only resolves once it
          passes the expiry.
        </p>
      </div>

      <div className="mt-4">
        <label htmlFor="prediction-notes" className="text-sm font-medium text-ink">
          Notes (optional)
        </label>
        <textarea
          id="prediction-notes"
          name="notes"
          rows={2}
          maxLength={280}
          className="mt-2 w-full rounded-sm border border-hairline bg-canvas px-3.5 py-2.5 text-primary placeholder:text-muted focus:border-focus-blue"
          placeholder="Why do you expect this move?"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-5 w-full rounded-pill bg-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:cursor-wait disabled:opacity-60 sm:w-auto"
      >
        {pending ? 'Recording…' : 'Record prediction'}
      </button>
    </form>
  );
}
