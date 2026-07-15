import { formatPaise, formatPercentage } from '@/lib/finance/currency';
import type { LeaderboardRow } from '@/server/services/challenge';

const SCORE_LABEL: Record<string, string> = {
  RETURN: 'Return',
  DRAWDOWN: 'Max drawdown',
  PREDICTION_ACCURACY: 'Accuracy',
};

export function Leaderboard({
  rows,
  scoringMethod,
  finalized,
}: {
  rows: LeaderboardRow[];
  scoringMethod: string;
  finalized: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-sm border border-dashed border-hairline px-4 py-8 text-center text-sm text-body-muted">
        No participants yet.
      </p>
    );
  }

  return (
    <div>
      {!finalized ? (
        <p className="mb-2 text-xs text-muted">
          Provisional — final rankings are frozen from finalized snapshots when the challenge ends.
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-sm border border-hairline">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-mono-label text-muted">
              <Th className="text-left">#</Th>
              <Th className="text-left">Participant</Th>
              <Th>{SCORE_LABEL[scoringMethod] ?? 'Score'}</Th>
              <Th>Return</Th>
              <Th>Value</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.participantId}
                className={`border-b border-hairline last:border-0 ${row.isMe ? 'bg-pale-blue/40' : ''}`}
              >
                <Td className="text-left font-mono">{row.rank}</Td>
                <Td className="text-left">
                  <span className="font-medium text-primary">{row.displayName}</span>
                  {row.isMe ? (
                    <span className="ml-2 text-xs font-medium text-action-blue">You</span>
                  ) : null}
                </Td>
                <Td className="font-mono">{scoreValue(scoringMethod, row)}</Td>
                <Td className="font-mono">{formatPercentage(row.returnPercent)}</Td>
                <Td className="font-mono">{formatPaise(row.finalValuePaise)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function scoreValue(scoringMethod: string, row: LeaderboardRow): string {
  if (scoringMethod === 'DRAWDOWN') return `-${row.maxDrawdownPercent.toFixed(1)}%`;
  if (scoringMethod === 'PREDICTION_ACCURACY') {
    return row.predictionAccuracyPercent === null
      ? '—'
      : `${row.predictionAccuracyPercent.toFixed(0)}%`;
  }
  return formatPercentage(row.returnPercent);
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
  return <td className={`px-3 py-3 ${className}`}>{children}</td>;
}
