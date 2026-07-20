// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import { CandleInterval, OrderSide, PrismaClient } from '@/generated/prisma/client';
import { registerUser } from '@/server/services/register-user';
import { checkpointAt, loadScenarioForSession, startScenario } from '@/server/services/scenario';
import { submitSimulationOrder } from '@/server/services/simulation';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;

const DAY1 = new Date('2020-03-05T15:30:00+05:30');
const DAY2 = new Date('2020-03-06T15:30:00+05:30');
const DAY3 = new Date('2020-03-09T15:30:00+05:30');

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
});

afterAll(async () => {
  await ephemeral.drop();
});

describe('startScenario — replay pinned to a curated window', () => {
  it('spins up a simulation on the pack window and trades on real candles', async () => {
    const user = await registerUser(
      { name: 'Replayer', email: `replay-${randomUUID()}@example.com`, password: 'tradeplay123' },
      database,
    );
    const instrument = await database.instrument.create({
      data: {
        exchange: 'NSE',
        symbol: `ACME_${randomUUID().slice(0, 8)}`,
        companyName: 'Acme',
        isin: 'INE000A01000',
        sector: 'Test',
        industry: 'Test',
        currency: 'INR',
      },
    });
    for (const [timestamp, price] of [
      [DAY1, 3_700_00],
      [DAY2, 1_600_00],
      [DAY3, 2_100_00],
    ] as const) {
      await database.priceCandle.create({
        data: {
          instrumentId: instrument.id,
          interval: CandleInterval.ONE_DAY,
          timestamp,
          openPaise: BigInt(price),
          highPaise: BigInt(price),
          lowPaise: BigInt(price),
          closePaise: BigInt(price),
          volume: 1_000,
          source: 'scenario-test',
        },
      });
    }

    const pack = await database.scenarioPack.create({
      data: {
        slug: `crash-${randomUUID().slice(0, 8)}`,
        title: 'Test Crash',
        description: 'A sharp fall and bounce.',
        startTimestamp: DAY1,
        endTimestamp: DAY3,
        instrumentIds: JSON.stringify([instrument.id]),
        startingBalancePaise: 200_000_00n,
        checkpoints: JSON.stringify([
          { timestamp: DAY1.toISOString(), title: 'Moratorium', body: 'It begins.' },
          { timestamp: DAY3.toISOString(), title: 'Rescue', body: 'It ends.' },
        ]),
      },
    });

    const session = await startScenario({ userId: user.id, slug: pack.slug }, database);
    expect(session.scenarioPackId).toBe(pack.id);
    expect(session.startTimestamp.getTime()).toBe(DAY1.getTime());
    expect(session.currentTimestamp.getTime()).toBe(DAY1.getTime());
    expect(session.endTimestamp.getTime()).toBe(DAY3.getTime());
    expect(session.initialBalancePaise).toBe(200_000_00n);

    // A buy fills against the pack's candles — the ordinary engine, pinned window.
    const buy = await submitSimulationOrder(
      {
        sessionId: session.id,
        userId: user.id,
        side: OrderSide.BUY,
        instrumentId: instrument.id,
        amountPaise: 100_000_00n,
      },
      database,
    );
    expect(buy.status).toBe('FILLED');

    // The scenario is discoverable from the session and its checkpoint tracks the clock.
    const view = await loadScenarioForSession(session.scenarioPackId, database);
    expect(view?.checkpoints).toHaveLength(2);
    expect(checkpointAt(view!.checkpoints, session.currentTimestamp)?.title).toBe('Moratorium');
    expect(checkpointAt(view!.checkpoints, DAY3)?.title).toBe('Rescue');
  });
});
