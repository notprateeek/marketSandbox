'use client';

import { useRef } from 'react';

import { resetSimulationAction } from '@/app/actions/simulation';

export function ResetDialog({ sessionId }: { sessionId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-pill border border-loss/40 px-4 py-2 text-sm font-medium text-loss transition-colors hover:bg-loss/5"
      >
        Reset simulation
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto max-w-md rounded-sm border border-hairline p-0 backdrop:bg-black/40"
      >
        <div className="p-6">
          <h3 className="text-heading-card text-primary">Reset this simulation?</h3>
          <p className="mt-2 text-sm text-body-muted">
            This clears every simulated order, position and ledger entry for this run and returns
            the clock to the start. Your primary account and other simulations are not affected.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-pill border border-hairline px-4 py-2 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone"
            >
              Cancel
            </button>
            <form action={resetSimulationAction}>
              <input type="hidden" name="sessionId" value={sessionId} />
              <button
                type="submit"
                className="rounded-pill bg-loss px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
              >
                Reset to start
              </button>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}
