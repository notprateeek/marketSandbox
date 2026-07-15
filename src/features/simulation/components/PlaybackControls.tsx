import { advanceSimulationAction, setSimulationStatusAction } from '@/app/actions/simulation';

const STEPS = [
  { step: 'MINUTE', label: '+1 min' },
  { step: 'HOUR', label: '+1 hour' },
  { step: 'TRADING_DAY', label: '+1 trading day' },
  { step: 'WEEK', label: '+1 week' },
] as const;

interface PlaybackControlsProps {
  sessionId: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  customMin: string;
  customMax: string;
}

const stepButton =
  'rounded-pill border border-hairline px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone disabled:cursor-not-allowed disabled:opacity-40';

export function PlaybackControls({
  sessionId,
  status,
  customMin,
  customMax,
}: PlaybackControlsProps) {
  const active = status === 'ACTIVE';

  if (status === 'COMPLETED') {
    return (
      <p className="rounded-sm border border-hairline bg-soft-stone/35 px-4 py-3 text-sm text-body-muted">
        This simulation has reached its end. Reset it to replay from the start.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-mono-label text-muted">Advance the clock</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {STEPS.map(({ step, label }) => (
            <form key={step} action={advanceSimulationAction}>
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="step" value={step} />
              <button type="submit" disabled={!active} className={stepButton}>
                {label}
              </button>
            </form>
          ))}
        </div>
      </div>

      <form action={advanceSimulationAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="step" value="CUSTOM" />
        <div className="flex-1">
          <label htmlFor="sim-custom" className="text-xs text-muted">
            Jump to a specific time (IST)
          </label>
          <input
            id="sim-custom"
            name="custom"
            type="datetime-local"
            min={customMin}
            max={customMax}
            step={60}
            required
            disabled={!active}
            className="mt-1 h-11 w-full rounded-sm border border-hairline bg-canvas px-3 text-sm text-primary transition-colors hover:border-slate focus:border-focus-blue disabled:opacity-40"
          />
        </div>
        <button type="submit" disabled={!active} className={stepButton}>
          Jump
        </button>
      </form>

      <form action={setSimulationStatusAction}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="paused" value={active ? 'true' : 'false'} />
        <button
          type="submit"
          className="rounded-pill border border-hairline px-4 py-2 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone"
        >
          {active ? 'Pause' : 'Resume'}
        </button>
      </form>
    </div>
  );
}
