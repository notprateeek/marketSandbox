'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { submitMarketOrderAction, type TradingActionState } from '@/app/actions/trading';
import { formatPaise, parsePriceToPaise } from '@/lib/finance/currency';
import { isMarketOpen } from '@/lib/finance/market-hours';
import type { OrderSubmissionResult } from '@/server/services/submit-market-order';

type OrderSide = 'BUY' | 'SELL';

interface TradeTicketProps {
  instrumentId: string;
  symbol: string;
  pricePaise: bigint | null;
  availableCashPaise: bigint | null;
  ownedQuantity: number;
  disabledReason?: string;
}

interface ReviewOrder {
  orderId: string;
  side: OrderSide;
  value: string;
}

interface OrderEstimate {
  quantity: number | null;
  grossAmountPaise: bigint | null;
}

const initialActionState: TradingActionState = { status: 'IDLE', message: '' };
const inputClassName =
  'mt-2 h-12 w-full rounded-sm border border-hairline bg-canvas px-3.5 text-primary placeholder:text-muted transition-colors hover:border-slate focus:border-focus-blue';

export function TradeTicket({
  instrumentId,
  symbol,
  pricePaise,
  availableCashPaise,
  ownedQuantity,
  disabledReason,
}: TradeTicketProps) {
  const [side, setSide] = useState<OrderSide>('BUY');
  const [inputValue, setInputValue] = useState('');
  const [review, setReview] = useState<ReviewOrder | null>(null);
  const marketOpen = isMarketOpen();
  const [actionState, formAction, pending] = useActionState(
    submitMarketOrderAction,
    initialActionState,
  );
  const reviewedEstimate = review ? estimateOrder(review.side, review.value, pricePaise) : null;
  const currentResult =
    review && 'orderId' in actionState && actionState.orderId === review.orderId
      ? actionState
      : null;

  function chooseSide(nextSide: OrderSide) {
    setSide(nextSide);
    setInputValue('');
    setReview(null);
  }

  function reviewOrder() {
    if (!inputValue.trim() || disabledReason) return;
    setReview({ orderId: crypto.randomUUID(), side, value: inputValue.trim() });
  }

  function editOrder() {
    setReview(null);
  }

  function startAnotherOrder() {
    setInputValue('');
    setReview(null);
  }

  return (
    <section aria-labelledby="trade-ticket-heading" className="rounded-sm border border-hairline">
      <header className="border-b border-hairline px-5 py-5">
        <p className="text-mono-label text-muted">Market order</p>
        <h3 id="trade-ticket-heading" className="mt-1 text-heading-card text-primary">
          Trade {symbol}
        </h3>
      </header>

      <dl className="grid grid-cols-2 divide-x divide-hairline border-b border-hairline">
        <TicketDetail
          label="Latest price"
          value={pricePaise == null ? 'Unavailable' : formatPaise(pricePaise)}
        />
        <TicketDetail
          label="Available cash"
          value={availableCashPaise == null ? 'Unavailable' : formatPaise(availableCashPaise)}
        />
        <TicketDetail label="Shares owned" value={ownedQuantity.toLocaleString('en-IN')} />
        <TicketDetail label="Order type" value="Market" />
      </dl>

      <div className="p-5">
        {currentResult?.status === 'FILLED' ? (
          <SuccessState result={currentResult} onTradeAgain={startAnotherOrder} />
        ) : currentResult?.status === 'PENDING' ? (
          <QueuedState result={currentResult} onTradeAgain={startAnotherOrder} />
        ) : currentResult ? (
          <RejectionState result={currentResult} onEdit={editOrder} />
        ) : review && reviewedEstimate ? (
          <ConfirmationState
            instrumentId={instrumentId}
            review={review}
            estimate={reviewedEstimate}
            pricePaise={pricePaise}
            pending={pending}
            marketOpen={marketOpen}
            formAction={formAction}
            onEdit={editOrder}
          />
        ) : disabledReason ? (
          <p
            role="status"
            className="rounded-sm border border-hairline bg-soft-stone/35 px-4 py-3 text-sm text-body-muted"
          >
            {disabledReason}
          </p>
        ) : (
          <>
            {marketOpen ? null : <MarketClosedNotice />}
            <OrderEditor
              side={side}
              value={inputValue}
              pricePaise={pricePaise}
              ownedQuantity={ownedQuantity}
              marketOpen={marketOpen}
              onSideChange={chooseSide}
              onValueChange={setInputValue}
              onReview={reviewOrder}
            />
          </>
        )}
      </div>
    </section>
  );
}

function OrderEditor({
  side,
  value,
  pricePaise,
  ownedQuantity,
  marketOpen,
  onSideChange,
  onValueChange,
  onReview,
}: {
  side: OrderSide;
  value: string;
  pricePaise: bigint | null;
  ownedQuantity: number;
  marketOpen: boolean;
  onSideChange: (side: OrderSide) => void;
  onValueChange: (value: string) => void;
  onReview: () => void;
}) {
  const estimate = estimateOrder(side, value, pricePaise);
  const isBuy = side === 'BUY';

  return (
    <>
      <fieldset>
        <legend className="text-sm font-medium text-ink">Side</legend>
        <div className="mt-2 grid grid-cols-2 rounded-sm bg-soft-stone/55 p-1">
          {(['BUY', 'SELL'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={side === option}
              onClick={() => onSideChange(option)}
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

      <div className="mt-5">
        <label htmlFor="trade-order-value" className="text-sm font-medium text-ink">
          {isBuy ? 'Amount (₹)' : 'Quantity'}
        </label>
        <input
          id="trade-order-value"
          type={isBuy ? 'text' : 'number'}
          inputMode={isBuy ? 'decimal' : 'numeric'}
          min={isBuy ? undefined : 1}
          step={isBuy ? undefined : 1}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={isBuy ? '5000.00' : '1'}
          autoComplete="off"
          aria-describedby="trade-order-hint"
          className={inputClassName}
        />
        <p id="trade-order-hint" className="mt-2 text-xs text-body-muted">
          {isBuy
            ? 'Only whole shares are bought. Unused money remains as cash.'
            : `Enter whole shares. You currently own ${ownedQuantity.toLocaleString('en-IN')}.`}
        </p>
      </div>

      <Estimate estimate={estimate} />

      <button
        type="button"
        disabled={!value.trim()}
        onClick={onReview}
        className="mt-5 w-full rounded-pill bg-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:cursor-not-allowed disabled:opacity-45"
      >
        Review {isBuy ? 'buy' : 'sell'} order{marketOpen ? '' : ' (queued)'}
      </button>
    </>
  );
}

function ConfirmationState({
  instrumentId,
  review,
  estimate,
  pricePaise,
  pending,
  marketOpen,
  formAction,
  onEdit,
}: {
  instrumentId: string;
  review: ReviewOrder;
  estimate: OrderEstimate;
  pricePaise: bigint | null;
  pending: boolean;
  marketOpen: boolean;
  formAction: (formData: FormData) => void;
  onEdit: () => void;
}) {
  const isBuy = review.side === 'BUY';

  return (
    <div aria-labelledby="order-confirmation-heading">
      <p className="text-mono-label text-muted">Confirmation</p>
      <h4 id="order-confirmation-heading" className="mt-1 font-medium text-primary">
        Confirm {isBuy ? 'buy' : 'sell'} order
      </h4>

      <dl className="mt-4 divide-y divide-hairline border-y border-hairline text-sm">
        <ConfirmationDetail
          label={isBuy ? 'Requested amount' : 'Requested quantity'}
          value={formatRequestedValue(review.side, review.value)}
        />
        <ConfirmationDetail label="Estimated quantity" value={formatQuantity(estimate.quantity)} />
        <ConfirmationDetail
          label="Estimated value"
          value={formatOptionalPaise(estimate.grossAmountPaise)}
        />
        <ConfirmationDetail label="Reference price" value={formatOptionalPaise(pricePaise)} />
      </dl>

      <p className="mt-3 text-xs text-body-muted">
        {marketOpen
          ? 'The final quantity and value use the latest available market price.'
          : 'The market is closed. This order is queued and fills at the next open using the price then, so the final quantity and value may differ.'}
      </p>

      <form action={formAction} className="mt-5 grid grid-cols-2 gap-2">
        <input type="hidden" name="orderId" value={review.orderId} />
        <input type="hidden" name="instrumentId" value={instrumentId} />
        <input type="hidden" name="side" value={review.side} />
        <input type="hidden" name={isBuy ? 'amount' : 'quantity'} value={review.value} />
        <button
          type="button"
          disabled={pending}
          onClick={onEdit}
          className="rounded-pill border border-hairline px-4 py-3 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone disabled:cursor-wait disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-pill bg-primary px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black disabled:cursor-wait disabled:opacity-60"
        >
          {pending
            ? marketOpen
              ? 'Submitting…'
              : 'Queuing…'
            : marketOpen
              ? `Confirm ${isBuy ? 'buy' : 'sell'}`
              : `Queue ${isBuy ? 'buy' : 'sell'}`}
        </button>
      </form>
    </div>
  );
}

function MarketClosedNotice() {
  return (
    <div
      role="status"
      className="mb-4 rounded-sm border border-hairline bg-soft-stone/40 px-4 py-3 text-sm text-body-muted"
    >
      <span className="font-medium text-primary">Market closed.</span> Your order will be queued and
      filled at the next open.
    </div>
  );
}

function QueuedState({
  result,
  onTradeAgain,
}: {
  result: OrderSubmissionResult;
  onTradeAgain: () => void;
}) {
  return (
    <div role="status" aria-live="polite">
      <div className="rounded-sm border border-hairline bg-soft-stone/40 px-4 py-4">
        <p className="text-mono-label text-body-muted">Order queued</p>
        <p className="mt-1 font-medium text-primary">{result.message}</p>
      </div>

      <dl className="mt-4 divide-y divide-hairline border-y border-hairline text-sm">
        <ConfirmationDetail
          label={result.side === 'BUY' ? 'Estimated quantity' : 'Quantity'}
          value={formatQuantity(result.requestedQuantity)}
        />
        <ConfirmationDetail label="Reference price" value={formatOptionalPaise(result.pricePaise)} />
      </dl>

      <p className="mt-3 text-xs text-body-muted">
        It fills at the next open using the price then, so the final quantity and value may differ.
        Track it under Queued orders in your History.
      </p>

      <button
        type="button"
        onClick={onTradeAgain}
        className="mt-5 w-full rounded-pill border border-hairline px-5 py-3 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone"
      >
        Place another order
      </button>
    </div>
  );
}

function SuccessState({
  result,
  onTradeAgain,
}: {
  result: OrderSubmissionResult;
  onTradeAgain: () => void;
}) {
  return (
    <div role="status" aria-live="polite">
      <div className="rounded-sm border border-deep-green/15 bg-pale-green px-4 py-4">
        <p className="text-mono-label text-deep-green">Order filled</p>
        <p className="mt-1 font-medium text-primary">{result.message}</p>
      </div>

      <dl className="mt-4 divide-y divide-hairline border-y border-hairline text-sm">
        <ConfirmationDetail
          label="Execution price"
          value={formatOptionalPaise(result.pricePaise)}
        />
        <ConfirmationDetail
          label="Order value"
          value={formatOptionalPaise(result.grossAmountPaise)}
        />
        <ConfirmationDetail label="Available cash" value={formatPaise(result.availableCashPaise)} />
        <ConfirmationDetail
          label="Shares owned"
          value={result.positionQuantity.toLocaleString('en-IN')}
        />
      </dl>

      {result.promptJournal ? (
        <Link
          href={`/journal#${result.orderId}`}
          className="mt-4 block rounded-sm border border-action-blue/30 bg-pale-blue/40 px-4 py-3 text-sm text-action-blue transition-colors hover:bg-pale-blue"
        >
          <span className="font-medium">Reflect on this sell →</span> Record what happened and what
          you learned while it&apos;s fresh.
        </Link>
      ) : null}

      <button
        type="button"
        onClick={onTradeAgain}
        className="mt-5 w-full rounded-pill border border-hairline px-5 py-3 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone"
      >
        Place another order
      </button>
    </div>
  );
}

function RejectionState({
  result,
  onEdit,
}: {
  result: Exclude<TradingActionState, { status: 'IDLE' } | { status: 'FILLED' }>;
  onEdit: () => void;
}) {
  return (
    <div>
      <div role="alert" className="rounded-sm border border-loss/25 bg-loss/5 px-4 py-4">
        <p className="text-mono-label text-loss">
          {result.status === 'REJECTED' ? 'Order rejected' : 'Order not submitted'}
        </p>
        <p className="mt-1 text-sm text-loss">{result.message}</p>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="mt-5 w-full rounded-pill border border-hairline px-5 py-3 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone"
      >
        Edit order
      </button>
    </div>
  );
}

function Estimate({ estimate }: { estimate: OrderEstimate }) {
  return (
    <dl className="mt-5 grid grid-cols-2 divide-x divide-hairline border-y border-hairline">
      <TicketDetail label="Estimated quantity" value={formatQuantity(estimate.quantity)} />
      <TicketDetail
        label="Estimated value"
        value={formatOptionalPaise(estimate.grossAmountPaise)}
      />
    </dl>
  );
}

function TicketDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-3.5 odd:border-b odd:border-hairline even:border-b even:border-hairline [&:nth-last-child(-n+2)]:border-b-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-primary">{value}</dd>
    </div>
  );
}

function ConfirmationDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-body-muted">{label}</dt>
      <dd className="text-right font-medium text-primary">{value}</dd>
    </div>
  );
}

function estimateOrder(side: OrderSide, value: string, pricePaise: bigint | null): OrderEstimate {
  if (pricePaise == null || pricePaise <= 0n) return { quantity: null, grossAmountPaise: null };

  if (side === 'BUY') {
    const amountPaise = parseAmountOrNull(value);
    if (amountPaise == null) return { quantity: null, grossAmountPaise: null };
    const quantity = Number(amountPaise / pricePaise);
    return { quantity, grossAmountPaise: BigInt(quantity) * pricePaise };
  }

  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { quantity: null, grossAmountPaise: null };
  }
  return { quantity, grossAmountPaise: BigInt(quantity) * pricePaise };
}

function parseAmountOrNull(value: string): bigint | null {
  try {
    return parsePriceToPaise(value);
  } catch {
    return null;
  }
}

function formatRequestedValue(side: OrderSide, value: string): string {
  if (side === 'SELL') return `${value} share${value === '1' ? '' : 's'}`;
  const amountPaise = parseAmountOrNull(value);
  return amountPaise == null ? value : formatPaise(amountPaise);
}

function formatQuantity(quantity: number | null): string {
  return quantity == null
    ? '—'
    : `${quantity.toLocaleString('en-IN')} share${quantity === 1 ? '' : 's'}`;
}

function formatOptionalPaise(value: bigint | null | undefined): string {
  return value == null ? '—' : formatPaise(value);
}
