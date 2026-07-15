'use client';

import { useActionState, useState } from 'react';

import { submitSimulationOrderAction, type SimulationOrderState } from '@/app/actions/simulation';

type Side = 'BUY' | 'SELL';
type OrderType = 'MARKET' | 'LIMIT' | 'STOP_LOSS';

interface InstrumentOption {
  id: string;
  symbol: string;
  companyName: string;
}

interface SimulationTradeTicketProps {
  sessionId: string;
  instruments: InstrumentOption[];
  disabledReason?: string;
}

const initialState: SimulationOrderState = { status: 'IDLE', message: '' };
const inputClassName =
  'mt-2 h-12 w-full rounded-sm border border-hairline bg-canvas px-3.5 text-primary placeholder:text-muted transition-colors hover:border-slate focus:border-focus-blue';

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: 'MARKET', label: 'Market' },
  { value: 'LIMIT', label: 'Limit' },
  { value: 'STOP_LOSS', label: 'Stop-loss' },
];

export function SimulationTradeTicket({
  sessionId,
  instruments,
  disabledReason,
}: SimulationTradeTicketProps) {
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [side, setSide] = useState<Side>('BUY');
  const [state, formAction, pending] = useActionState(submitSimulationOrderAction, initialState);

  // Stop-loss is sell-only.
  const effectiveSide: Side = orderType === 'STOP_LOSS' ? 'SELL' : side;
  const isMarketBuy = orderType === 'MARKET' && effectiveSide === 'BUY';

  function chooseType(next: OrderType) {
    setOrderType(next);
    if (next === 'STOP_LOSS') setSide('SELL');
  }

  return (
    <section aria-labelledby="sim-trade-heading" className="rounded-sm border border-hairline">
      <header className="border-b border-hairline px-5 py-4">
        <p className="text-mono-label text-muted">Trade at simulation time</p>
        <h3 id="sim-trade-heading" className="mt-1 text-heading-feature text-primary">
          Place an order
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
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="side" value={effectiveSide} />
            <input type="hidden" name="orderType" value={orderType} />

            <Segmented
              legend="Order type"
              options={ORDER_TYPES.map((type) => ({ value: type.value, label: type.label }))}
              value={orderType}
              onChange={(value) => chooseType(value as OrderType)}
            />

            <div className="mt-4">
              <Segmented
                legend="Side"
                options={[
                  { value: 'BUY', label: 'Buy' },
                  { value: 'SELL', label: 'Sell' },
                ]}
                value={effectiveSide}
                onChange={(value) => setSide(value as Side)}
                disabled={orderType === 'STOP_LOSS'}
              />
              {orderType === 'STOP_LOSS' ? (
                <p className="mt-1 text-xs text-muted">
                  Stop-loss orders sell to protect a position.
                </p>
              ) : null}
            </div>

            <div className="mt-4">
              <label htmlFor="sim-instrument" className="text-sm font-medium text-ink">
                Instrument
              </label>
              <select
                id="sim-instrument"
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

            {isMarketBuy ? (
              <Text label="Amount (₹)" name="amount" placeholder="5000.00" />
            ) : (
              <Number label="Quantity" name="quantity" placeholder="10" />
            )}

            {orderType === 'LIMIT' ? (
              <Text label="Limit price (₹)" name="limitPrice" placeholder="950.00" />
            ) : null}
            {orderType === 'STOP_LOSS' ? (
              <Text label="Stop price (₹)" name="stopPrice" placeholder="900.00" />
            ) : null}

            {orderType !== 'MARKET' ? (
              <div className="mt-4">
                <label htmlFor="sim-expiry" className="text-sm font-medium text-ink">
                  Expiry (optional, IST)
                </label>
                <input
                  id="sim-expiry"
                  name="expiryTimestamp"
                  type="datetime-local"
                  step={60}
                  className={inputClassName}
                />
                <p className="mt-2 text-xs text-body-muted">
                  {orderType === 'LIMIT'
                    ? 'Fills at your limit (or better) when a candle reaches it as the clock advances.'
                    : 'Triggers when a candle reaches the stop, then fills at the next candle open.'}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-body-muted">
                Fills at the next available candle open after the current simulation time.
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="mt-5 w-full rounded-pill bg-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:cursor-wait disabled:opacity-60"
            >
              {pending
                ? 'Submitting…'
                : orderType === 'MARKET'
                  ? `Submit ${effectiveSide.toLowerCase()}`
                  : 'Place order'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

function Segmented({
  legend,
  options,
  value,
  onChange,
  disabled,
}: {
  legend: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <div
        className={`mt-2 grid rounded-sm bg-soft-stone/55 p-1 ${options.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} ${disabled ? 'opacity-60' : ''}`}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-xs px-3 py-2.5 text-sm font-semibold transition-colors ${
              value === option.value
                ? 'border border-action-blue bg-canvas text-action-blue'
                : 'border border-transparent text-body-muted hover:text-primary'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Text({ label, name, placeholder }: { label: string; name: string; placeholder: string }) {
  return (
    <div className="mt-4">
      <label htmlFor={`sim-${name}`} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={`sim-${name}`}
        name={name}
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        autoComplete="off"
        className={inputClassName}
      />
    </div>
  );
}

function Number({
  label,
  name,
  placeholder,
}: {
  label: string;
  name: string;
  placeholder: string;
}) {
  return (
    <div className="mt-4">
      <label htmlFor={`sim-${name}`} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={`sim-${name}`}
        name={name}
        type="number"
        min={1}
        step={1}
        placeholder={placeholder}
        className={inputClassName}
      />
    </div>
  );
}

function OrderResult({ state }: { state: SimulationOrderState }) {
  if (state.status === 'IDLE') return null;

  if (state.status === 'PENDING_PLACED') {
    return (
      <div
        role="status"
        className="mb-4 rounded-sm border border-action-blue/25 bg-pale-blue px-4 py-3"
      >
        <p className="text-mono-label text-action-blue">Order placed</p>
        <p className="mt-1 text-sm text-primary">{state.message}</p>
      </div>
    );
  }

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
