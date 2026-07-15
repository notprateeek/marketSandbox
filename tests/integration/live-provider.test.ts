// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CandleInterval, PrismaClient } from '@/generated/prisma/client';
import { LiveMarketDataProvider } from '@/server/market-data';

const databasePath = resolve(tmpdir(), `tradeplay-live-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let database: PrismaClient;

// A known NSE-open instant (Wed 10:00 IST) so elapsed market-seconds accrue.
const T0 = new Date('2026-07-15T10:00:00+05:30');
const BASE_CLOSE = 1_000_00; // ₹1,000
let instrumentId: string;

const ist = (value: string) => new Date(`${value}+05:30`);

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

  const instrument = await database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: 'LIVE',
      companyName: 'Live Test Ltd',
      isin: 'INE000LIVE01',
      sector: 'Testing',
      industry: 'Testing',
      currency: 'INR',
    },
  });
  instrumentId = instrument.id;
  await database.priceCandle.create({
    data: {
      instrumentId,
      interval: CandleInterval.ONE_MINUTE,
      timestamp: T0,
      openPaise: BASE_CLOSE,
      highPaise: BASE_CLOSE,
      lowPaise: BASE_CLOSE,
      closePaise: BASE_CLOSE,
      volume: 10_000,
      source: 'live-test',
    },
  });
});

afterAll(async () => {
  await database.$disconnect();
  for (const suffix of ['', '-shm', '-wal', '-journal']) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
});

function providerAt(clock: Date) {
  return new LiveMarketDataProvider(database, () => clock);
}

describe('LiveMarketDataProvider', () => {
  it('equals the last real close at the candle instant', async () => {
    const price = await providerAt(T0).getLatestPrice(instrumentId);
    expect(price.pricePaise).toBe(BASE_CLOSE);
    expect(price.timestamp.getTime()).toBe(T0.getTime());
  });

  it('moves the price as market time elapses, stamped at "now"', async () => {
    const at = ist('2026-07-15T10:20:00'); // 20 market-minutes later
    const price = await providerAt(at).getLatestPrice(instrumentId);
    expect(price.pricePaise).not.toBe(BASE_CLOSE);
    expect(price.timestamp.getTime()).toBe(at.getTime());
    // Sane band and Low ≤ price ≤ High from the synthesized session range.
    expect(price.pricePaise).toBeGreaterThan(BASE_CLOSE * 0.8);
    expect(price.pricePaise).toBeLessThan(BASE_CLOSE * 1.2);
    expect(price.lowPaise).toBeLessThanOrEqual(price.pricePaise);
    expect(price.highPaise).toBeGreaterThanOrEqual(price.pricePaise);
  });

  it('rises above and falls below the anchor across the session', async () => {
    let sawUp = false;
    let sawDown = false;
    for (let minute = 0; minute <= 375; minute += 3) {
      const at = new Date(T0.getTime() + minute * 60_000);
      const price = await providerAt(at).getLatestPrice(instrumentId);
      if (price.pricePaise > BASE_CLOSE) sawUp = true;
      if (price.pricePaise < BASE_CLOSE) sawDown = true;
    }
    expect(sawUp).toBe(true);
    expect(sawDown).toBe(true);
  });

  it('freezes the price outside market hours', async () => {
    const evening = await providerAt(ist('2026-07-15T20:00:00')).getLatestPrice(instrumentId);
    const nextMorningPreOpen = await providerAt(
      ist('2026-07-16T09:00:00'),
    ).getLatestPrice(instrumentId);
    // Both accrue the same market-seconds (the full 10:00→15:30 remainder), so
    // the frozen price is identical while the market is shut.
    expect(evening.pricePaise).toBe(nextMorningPreOpen.pricePaise);
  });

  it('reads real history for past timestamps and the live price for now', async () => {
    const provider = providerAt(ist('2026-07-15T10:20:00'));
    const historical = await provider.getPriceAt(instrumentId, T0);
    expect(historical?.pricePaise).toBe(BASE_CLOSE);

    const live = await provider.getPriceAt(instrumentId, ist('2026-07-15T10:20:00'));
    expect(live?.timestamp.getTime()).toBe(ist('2026-07-15T10:20:00').getTime());
  });
});
