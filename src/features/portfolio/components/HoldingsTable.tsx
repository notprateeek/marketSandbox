'use client';

import { useRouter } from 'next/navigation';

import { formatPaise, formatPercentage, formatSignedPaise } from '@/lib/finance/currency';
import type { HoldingValuation } from '@/lib/finance/portfolio';

const quantityFormatter = new Intl.NumberFormat('en-IN');

export function HoldingsTable({ holdings }: { holdings: HoldingValuation[] }) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <caption className="sr-only">Your current holdings and their valuation</caption>
        <thead>
          <tr className="border-b border-hairline text-left text-mono-label text-muted">
            <Th className="text-left">Company</Th>
            <Th className="text-left">Symbol</Th>
            <Th>Qty</Th>
            <Th>Avg price</Th>
            <Th>Current price</Th>
            <Th>Invested</Th>
            <Th>Current value</Th>
            <Th>P/L</Th>
            <Th>Return</Th>
            <Th>Allocation</Th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => {
            const gain = (holding.unrealizedPnlPaise ?? 0) >= 0;
            const open = () => router.push(`/instruments/${holding.instrumentId}`);
            return (
              <tr
                key={holding.instrumentId}
                role="link"
                tabIndex={0}
                aria-label={`Trade ${holding.symbol}`}
                onClick={open}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') open();
                }}
                className="cursor-pointer border-b border-hairline transition-colors last:border-0 hover:bg-soft-stone/40 focus:bg-soft-stone/40"
              >
                <Td className="text-left">
                  <span className="font-medium text-primary">{holding.companyName}</span>
                </Td>
                <Td className="text-left">
                  <span className="font-mono text-body-muted">{holding.symbol}</span>
                </Td>
                <Td className="font-mono">{quantityFormatter.format(holding.quantity)}</Td>
                <Td className="font-mono">{formatPaise(holding.averageBuyPricePaise)}</Td>
                <Td className="font-mono">
                  {holding.currentPricePaise === null ? (
                    <MissingBadge />
                  ) : (
                    formatPaise(holding.currentPricePaise)
                  )}
                </Td>
                <Td className="font-mono">{formatPaise(holding.totalCostPaise)}</Td>
                <Td className="font-mono">
                  {holding.marketValuePaise === null ? '—' : formatPaise(holding.marketValuePaise)}
                </Td>
                <Td className={`font-mono ${gain ? 'text-gain' : 'text-loss'}`}>
                  {holding.unrealizedPnlPaise === null
                    ? '—'
                    : formatSignedPaise(holding.unrealizedPnlPaise)}
                </Td>
                <Td className={`font-mono ${gain ? 'text-gain' : 'text-loss'}`}>
                  {holding.returnPercent === null ? '—' : formatPercentage(holding.returnPercent)}
                </Td>
                <Td className="font-mono">
                  {holding.allocationPercent === null
                    ? '—'
                    : `${holding.allocationPercent.toFixed(1)}%`}
                </Td>
              </tr>
            );
          })}
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
  return <td className={`px-3 py-3.5 align-top ${className}`}>{children}</td>;
}

function MissingBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-coral/10 px-2 py-0.5 text-xs font-medium text-coral">
      No price
    </span>
  );
}
