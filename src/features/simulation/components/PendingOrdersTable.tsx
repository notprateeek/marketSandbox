import Link from 'next/link';

import { cancelSimulationOrderAction } from '@/app/actions/simulation';
import { formatPaise } from '@/lib/finance/currency';
import { formatISTDateTime } from '@/lib/finance/datetime';
import type { PendingOrderView } from '@/server/services/simulation';

export function PendingOrdersTable({
  sessionId,
  orders,
}: {
  sessionId: string;
  orders: PendingOrderView[];
}) {
  if (orders.length === 0) {
    return (
      <p className="rounded-sm border border-dashed border-hairline px-4 py-6 text-center text-sm text-body-muted">
        No pending limit or stop-loss orders.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-sm border border-hairline">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-mono-label text-muted">
            <Th className="text-left">Order</Th>
            <Th>Qty</Th>
            <Th>Trigger</Th>
            <Th>Expiry</Th>
            <Th>Status</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-b border-hairline last:border-0">
              <Td className="text-left">
                <span className="font-medium text-primary">{order.symbol}</span>{' '}
                <span className="text-body-muted">
                  {order.orderType === 'STOP_LOSS' ? 'Stop-loss' : 'Limit'}{' '}
                  {order.side.toLowerCase()}
                </span>
              </Td>
              <Td className="font-mono">{order.requestedQuantity}</Td>
              <Td className="font-mono">
                {order.orderType === 'STOP_LOSS'
                  ? order.stopPricePaise === null
                    ? '—'
                    : `≤ ${formatPaise(order.stopPricePaise)}`
                  : order.limitPricePaise === null
                    ? '—'
                    : `${order.side === 'BUY' ? '≤' : '≥'} ${formatPaise(order.limitPricePaise)}`}
              </Td>
              <Td className="text-xs text-body-muted">
                {order.expiryTimestamp ? formatISTDateTime(order.expiryTimestamp) : 'GTC'}
              </Td>
              <Td>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    order.status === 'TRIGGERED'
                      ? 'bg-coral/10 text-coral'
                      : 'bg-soft-stone text-body-muted'
                  }`}
                >
                  {order.status}
                </span>
              </Td>
              <Td>
                <div className="flex items-center justify-end gap-3">
                  <Link
                    href={`/simulations/${sessionId}/orders/${order.id}`}
                    className="text-action-blue underline-offset-4 hover:underline"
                  >
                    Details
                  </Link>
                  <form action={cancelSimulationOrderAction}>
                    <input type="hidden" name="sessionId" value={sessionId} />
                    <input type="hidden" name="orderId" value={order.id} />
                    <button
                      type="submit"
                      className="font-medium text-body-muted transition-colors hover:text-loss"
                    >
                      Cancel
                    </button>
                  </form>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className = 'text-right',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`px-3 py-2.5 font-normal ${className}`}>{children}</th>;
}

function Td({
  children,
  className = 'text-right',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-3 align-middle ${className}`}>{children}</td>;
}
