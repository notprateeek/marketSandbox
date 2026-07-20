import { describe, expect, it } from 'vitest';

import { checkpointAt, type ScenarioCheckpoint } from '@/server/services/scenario';

const checkpoints: ScenarioCheckpoint[] = [
  { timestamp: new Date('2020-02-19T10:00:00Z'), title: 'Highs', body: 'a' },
  { timestamp: new Date('2020-03-09T10:00:00Z'), title: 'Black Monday', body: 'b' },
  { timestamp: new Date('2020-03-23T10:00:00Z'), title: 'Bottom', body: 'c' },
];

describe('checkpointAt — latest checkpoint the clock has reached', () => {
  it('returns null before the first checkpoint', () => {
    expect(checkpointAt(checkpoints, new Date('2020-02-01T10:00:00Z'))).toBeNull();
  });

  it('shows the first once reached, exactly at its timestamp', () => {
    expect(checkpointAt(checkpoints, new Date('2020-02-19T10:00:00Z'))?.title).toBe('Highs');
  });

  it('advances to the latest crossed checkpoint', () => {
    expect(checkpointAt(checkpoints, new Date('2020-03-10T10:00:00Z'))?.title).toBe('Black Monday');
    expect(checkpointAt(checkpoints, new Date('2020-04-01T10:00:00Z'))?.title).toBe('Bottom');
  });

  it('is order-independent', () => {
    const shuffled = [checkpoints[2], checkpoints[0], checkpoints[1]];
    expect(checkpointAt(shuffled, new Date('2020-03-10T10:00:00Z'))?.title).toBe('Black Monday');
  });
});
