'use client';

import { useActionState } from 'react';

import { saveJournalEntryAction, type JournalFormState } from '@/app/actions/journal';
import type { JournalFields } from '@/server/services/journal';

const initialState: JournalFormState = { status: 'IDLE', message: '' };
const fieldClass =
  'mt-1 w-full rounded-sm border border-hairline bg-canvas px-3 py-2 text-sm text-primary placeholder:text-muted focus:border-focus-blue';

// Plain, curated vocabularies (not a tag system) so per-tag P&L stays comparable.
export const STRATEGY_TAGS = [
  'Breakout',
  'Value',
  'Momentum',
  'Mean reversion',
  'News',
  'Earnings',
  'Technical',
] as const;
export const EMOTION_TAGS = [
  'Confident',
  'FOMO',
  'Fear',
  'Greed',
  'Revenge',
  'Patient',
  'Uncertain',
] as const;

export function JournalEntryForm({
  orderId,
  side,
  entry,
}: {
  orderId: string;
  side: 'BUY' | 'SELL';
  entry: JournalFields | null;
}) {
  const [state, formAction, pending] = useActionState(saveJournalEntryAction, initialState);
  const isBuy = side === 'BUY';

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="orderId" value={orderId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Strategy">
          <TagSelect name="strategyTag" options={STRATEGY_TAGS} value={entry?.strategyTag} />
        </Field>
        <Field label="Emotion">
          <TagSelect name="emotionTag" options={EMOTION_TAGS} value={entry?.emotionTag} />
        </Field>
      </div>

      {isBuy ? (
        <>
          <Field label="Reason for trade">
            <textarea
              name="reason"
              rows={2}
              defaultValue={entry?.reason ?? ''}
              className={fieldClass}
            />
          </Field>
          <Field label="Expected outcome">
            <textarea
              name="expectedOutcome"
              rows={2}
              defaultValue={entry?.expectedOutcome ?? ''}
              className={fieldClass}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Intended holding period">
              <input
                name="intendedHoldingPeriod"
                type="text"
                defaultValue={entry?.intendedHoldingPeriod ?? ''}
                placeholder="e.g. 6 months"
                className={fieldClass}
              />
            </Field>
            <Field label="Confidence (1–5)">
              <select
                name="confidence"
                defaultValue={entry?.confidence?.toString() ?? ''}
                className={fieldClass}
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((score) => (
                  <option key={score} value={score}>
                    {score}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Risk considered">
            <textarea
              name="riskConsidered"
              rows={2}
              defaultValue={entry?.riskConsidered ?? ''}
              className={fieldClass}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="What happened">
            <textarea
              name="whatHappened"
              rows={2}
              defaultValue={entry?.whatHappened ?? ''}
              className={fieldClass}
            />
          </Field>
          <Field label="What you learned">
            <textarea
              name="whatLearned"
              rows={2}
              defaultValue={entry?.whatLearned ?? ''}
              className={fieldClass}
            />
          </Field>
          <Field label="Was the original thesis correct?">
            <select
              name="thesisCorrect"
              defaultValue={thesisDefault(entry?.thesisCorrect)}
              className={fieldClass}
            >
              <option value="">Not sure</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
        </>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-pill bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save entry'}
        </button>
        {state.status === 'SUCCESS' ? (
          <span className="text-sm text-deep-green">{state.message}</span>
        ) : null}
        {state.status === 'ERROR' ? (
          <span className="text-sm text-loss">{state.message}</span>
        ) : null}
      </div>
    </form>
  );
}

function TagSelect({
  name,
  options,
  value,
}: {
  name: string;
  options: readonly string[];
  value?: string | null;
}) {
  return (
    <select name={name} defaultValue={value ?? ''} className={fieldClass}>
      <option value="">—</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}

function thesisDefault(value: boolean | null | undefined): string {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return '';
}
