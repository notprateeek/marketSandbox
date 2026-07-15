// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CandleInterval, OrderSide, PrismaClient } from '@/generated/prisma/client';
import { registerUser } from '@/server/services/register-user';
import { captureSnapshot } from '@/server/services/portfolio-snapshot';
import { loadAnalytics } from '@/server/services/portfolio-analytics';
import {
  advanceSimulation,
  createSimulation,
  submitSimulationOrder,
} from '@/server/services/simulation';

const databasePath = resolve(tmpdir(), `tradeplay-snap-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let database: PrismaClient;

const DAY1 = new Date('2026-06-01T10:00:00.000Z');
const DAY3 = new Date('2026-06-03T10:00:00.000Z');
const INITIAL = 50_000_00;

beforeAll(async () => {
  closeSync(openSync(databasePath, 'a'));
  execFileSync(
    process.execPath,
    [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' },
  );
  database = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl, timeout: 50 }),
  });
});

afterAll(async () => {
  await database.$disconnect();
  for (const suffix of ['', '-shm', '-wal', '-journal']) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
});

describe('portfolio snapshots', () => {
  it('generates snapshots on create, trade and advance, and stays idempotent', async () => {
    const user = await registerUser(
      { name: 'Snap', email: `snap-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const instrument = await createInstrument();

    const sim = await createSimulation(
      { userId: user.id, name: 'Snap run', startTimestamp: DAY1, initialBalancePaise: INITIAL },
      database,
    );

    // Baseline snapshot at the opening instant.
    expect(await snapshotCount(sim.virtualAccountId)).toBe(1);

    // A trade re-snapshots the current clock (same timestamp → still one row there).
    await submitSimulationOrder(
      {
        sessionId: sim.id,
        userId: user.id,
        side: OrderSide.BUY,
        instrumentId: instrument.id,
        amountPaise: 5_000_00,
      },
      database,
    );
    expect(await snapshotCount(sim.virtualAccountId)).toBe(1);

    // Advancing across two trading-day closes adds an end-of-day snapshot for each.
    const advanced = await advanceSimulation(
      { sessionId: sim.id, userId: user.id, step: 'CUSTOM', customTimestamp: DAY3 },
      database,
    );
    expect(advanced.status).toBe('COMPLETED');
    expect(await snapshotCount(sim.virtualAccountId)).toBe(3); // day1, day2, day3

    // Re-capturing an existing instant is a no-op on the row count (idempotent).
    const target = { virtualAccountId: sim.virtualAccountId, simulationSessionId: sim.id };
    await captureSnapshot(target, DAY3, database);
    await captureSnapshot(target, DAY3, database);
    expect(await snapshotCount(sim.virtualAccountId)).toBe(3);

    // Every snapshot reconciles: portfolioValue = cash + holdingsValue.
    const snapshots = await database.portfolioSnapshot.findMany({
      where: { virtualAccountId: sim.virtualAccountId },
    });
    for (const snapshot of snapshots) {
      expect(snapshot.portfolioValuePaise).toBe(snapshot.cashPaise + snapshot.holdingsValuePaise);
    }

    // Viewing analytics on demand does not create duplicate rows.
    const before = await snapshotCount(sim.virtualAccountId);
    const view = await loadAnalytics(sim.id, user.id, {}, database);
    await loadAnalytics(sim.id, user.id, {}, database);
    expect(await snapshotCount(sim.virtualAccountId)).toBe(before);

    expect(view?.analytics.valueSeries.length).toBe(3);
    expect(view?.analytics.maxDrawdown).not.toBeNull();
  });

  it('rejects duplicate snapshots at the same account and timestamp', async () => {
    const user = await registerUser(
      { name: 'Dup', email: `dup-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const sim = await createSimulation(
      { userId: user.id, name: 'Dup run', startTimestamp: DAY1, initialBalancePaise: INITIAL },
      database,
    );

    await expect(
      database.portfolioSnapshot.create({
        data: {
          virtualAccountId: sim.virtualAccountId,
          simulationSessionId: sim.id,
          timestamp: DAY1, // already has the baseline snapshot
          cashPaise: 1,
          holdingsValuePaise: 0,
          portfolioValuePaise: 1,
          realizedPnlPaise: 0,
          unrealizedPnlPaise: 0,
          totalPnlPaise: 0,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

async function createInstrument() {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  const instrument = await database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `SNAP-${suffix}`,
      companyName: `Snap ${suffix}`,
      isin: `TEST-${suffix}`,
      sector: 'Testing',
      industry: 'Testing',
      currency: 'INR',
    },
  });
  const days: [Date, number][] = [
    [DAY1, 10_000],
    [new Date('2026-06-02T10:00:00.000Z'), 11_000],
    [DAY3, 9_000],
  ];
  for (const [timestamp, price] of days) {
    await database.priceCandle.create({
      data: {
        instrumentId: instrument.id,
        interval: CandleInterval.ONE_DAY,
        timestamp,
        openPaise: price,
        highPaise: price,
        lowPaise: price,
        closePaise: price,
        volume: 1_000,
        source: 'snap-test',
      },
    });
  }
  return instrument;
}

function snapshotCount(virtualAccountId: string) {
  return database.portfolioSnapshot.count({ where: { virtualAccountId } });
}
