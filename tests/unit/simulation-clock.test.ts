import { describe, expect, it } from 'vitest';

import { advanceSimulationTime } from '@/server/services/simulation-clock';

const ist = (value: string) => new Date(`${value}+05:30`);
const FAR_END = ist('2026-12-31T00:00');

describe('advanceSimulationTime — fixed increments', () => {
  it('advances by one minute, hour and week', () => {
    const start = ist('2026-06-10T10:00:00');
    expect(advanceSimulationTime(start, FAR_END, 'MINUTE').timestamp).toEqual(
      ist('2026-06-10T10:01:00'),
    );
    expect(advanceSimulationTime(start, FAR_END, 'HOUR').timestamp).toEqual(
      ist('2026-06-10T11:00:00'),
    );
    expect(advanceSimulationTime(start, FAR_END, 'WEEK').timestamp).toEqual(
      ist('2026-06-17T10:00:00'),
    );
  });
});

describe('advanceSimulationTime — trading day skips weekends (IST)', () => {
  it('moves a weekday to the next weekday', () => {
    // 2026-01-07 is a Wednesday in IST.
    const wednesday = ist('2026-01-07T10:00:00');
    expect(advanceSimulationTime(wednesday, FAR_END, 'TRADING_DAY').timestamp).toEqual(
      ist('2026-01-08T10:00:00'),
    );
  });

  it('jumps Friday to Monday, keeping the time of day', () => {
    // 2026-01-02 is a Friday in IST; Sat + Sun are skipped.
    const friday = ist('2026-01-02T10:00:00');
    expect(advanceSimulationTime(friday, FAR_END, 'TRADING_DAY').timestamp).toEqual(
      ist('2026-01-05T10:00:00'),
    );
  });
});

describe('advanceSimulationTime — custom target', () => {
  it('jumps to a valid future timestamp', () => {
    const current = ist('2026-06-10T10:00:00');
    const target = ist('2026-06-15T14:30:00');
    const result = advanceSimulationTime(current, FAR_END, 'CUSTOM', target);
    expect(result.timestamp).toEqual(target);
    expect(result.completed).toBe(false);
  });

  it('never rewinds: a target before now stays put', () => {
    const current = ist('2026-06-10T10:00:00');
    const past = ist('2026-06-01T10:00:00');
    expect(advanceSimulationTime(current, FAR_END, 'CUSTOM', past).timestamp).toEqual(current);
  });
});

describe('advanceSimulationTime — clamping and completion', () => {
  it('stops exactly at the end and marks completed when a step overshoots', () => {
    const current = ist('2026-06-10T10:00:00');
    const end = ist('2026-06-10T10:00:30'); // 30s away, a minute step overshoots
    const result = advanceSimulationTime(current, end, 'MINUTE');
    expect(result.timestamp).toEqual(end);
    expect(result.completed).toBe(true);
  });

  it('marks completed when a custom target lands past the end', () => {
    const current = ist('2026-06-10T10:00:00');
    const end = ist('2026-06-11T00:00:00');
    const result = advanceSimulationTime(current, end, 'CUSTOM', ist('2026-06-20T00:00:00'));
    expect(result.timestamp).toEqual(end);
    expect(result.completed).toBe(true);
  });

  it('stays completed once the clock is already at the end', () => {
    const end = ist('2026-06-11T00:00:00');
    expect(advanceSimulationTime(end, end, 'HOUR')).toEqual({ timestamp: end, completed: true });
  });
});
