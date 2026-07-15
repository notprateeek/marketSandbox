import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { formatPaise } from '@/lib/finance/currency';
import { formatISTDateTime } from '@/lib/finance/datetime';
import { loadOrderDetails } from '@/server/services/simulation';

export const metadata: Metadata = {
  title: 'Order details',
};

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-soft-stone text-body-muted',
  TRIGGERED: 'bg-coral/10 text-coral',
  FILLED: 'bg-pale-green text-deep-green',
  REJECTED: 'bg-loss/10 text-loss',
  CANCELLED: 'bg-soft-stone text-body-muted',
  EXPIRED: 'bg-soft-stone text-body-muted',
};

export default async function OrderDetailsPage({
  params,
}: {
  params: Promise<{ id: string; orderId: string }>;
}) {
  const [{ id, orderId }, session] = await Promise.all([params, auth()]);
  if (!session?.user?.id) redirect('/sign-in');

  const order = await loadOrderDetails(orderId, session.user.id);
  if (!order) notFound();

  const triggerLabel =
    order.orderType === 'STOP_LOSS'
      ? order.stopPricePaise === null
        ? '—'
        : `Stop ≤ ${formatPaise(order.stopPricePaise)}`
      : order.orderType === 'LIMIT'
        ? order.limitPricePaise === null
          ? '—'
          : `Limit ${order.side === 'BUY' ? '≤' : '≥'} ${formatPaise(order.limitPricePaise)}`
        : 'Market';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <nav aria-label="Breadcrumb" className="mb-5 text-sm">
        <Link
          href={`/simulations/${id}`}
          className="font-medium text-action-blue underline-offset-4 hover:underline"
        >
          Simulation
        </Link>
        <span className="mx-2 text-muted">/</span>
        <span className="text-body-muted">Order</span>
      </nav>

      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-mono-label text-muted">
            {order.orderType} · {order.side}
          </p>
          <h2 className="mt-2 text-display-section text-primary">{order.instrument.symbol}</h2>
          <p className="mt-1 text-body-muted">{order.instrument.companyName}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[order.status] ?? ''}`}
        >
          {order.status}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-hairline bg-hairline sm:grid-cols-3">
        <Detail label="Quantity" value={`${order.requestedQuantity}`} />
        <Detail label="Trigger" value={triggerLabel} />
        <Detail
          label="Expiry"
          value={
            order.expiryTimestamp
              ? `${formatISTDateTime(order.expiryTimestamp)} IST`
              : 'Good till cancelled'
          }
        />
        <Detail
          label="Placed"
          value={
            order.simulationTimestamp ? `${formatISTDateTime(order.simulationTimestamp)} IST` : '—'
          }
        />
        <Detail
          label="Triggered"
          value={order.triggeredAt ? `${formatISTDateTime(order.triggeredAt)} IST` : '—'}
        />
        <Detail label="Filled qty" value={`${order.filledQuantity}`} />
      </dl>

      {order.execution ? (
        <section className="mt-6 rounded-sm border border-hairline bg-canvas p-5">
          <h3 className="text-mono-label text-muted">Execution</h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <Inline label="Fill price" value={formatPaise(order.execution.pricePaise)} />
            <Inline label="Value" value={formatPaise(order.execution.grossAmountPaise)} />
            <Inline
              label="Executed"
              value={`${formatISTDateTime(order.execution.simulationTimestamp)} IST`}
            />
          </dl>
        </section>
      ) : null}

      {order.rejectionReason ? (
        <p className="mt-6 rounded-sm border border-loss/25 bg-loss/5 px-4 py-3 text-sm text-loss">
          {order.rejectionReason}
        </p>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-canvas px-4 py-4">
      <dt className="text-mono-label text-muted">{label}</dt>
      <dd className="mt-1.5 font-mono text-sm text-primary">{value}</dd>
    </div>
  );
}

function Inline({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-primary">{value}</dd>
    </div>
  );
}
