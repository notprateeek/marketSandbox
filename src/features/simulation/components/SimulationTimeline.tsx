import { formatISTDateTime } from '@/lib/finance/datetime';
import type { TimelineEvent } from '@/server/services/simulation';

const DOT: Record<TimelineEvent['kind'], string> = {
  FILLED: 'bg-gain',
  REJECTED: 'bg-loss',
  STARTED: 'bg-slate',
};

export function SimulationTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-body-muted">No orders yet. Place a trade to build history.</p>
    );
  }

  return (
    <ol className="relative space-y-5 border-l border-hairline pl-5">
      {events.map((event, index) => (
        <li key={`${event.timestamp.toISOString()}-${index}`} className="relative">
          <span
            className={`absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-canvas ${DOT[event.kind]}`}
            aria-hidden="true"
          />
          <p className="font-medium text-primary">{event.title}</p>
          <p className="mt-0.5 text-sm text-body-muted">{event.detail}</p>
          <time dateTime={event.timestamp.toISOString()} className="mt-1 block text-xs text-muted">
            {formatISTDateTime(event.timestamp)} IST
          </time>
        </li>
      ))}
    </ol>
  );
}
