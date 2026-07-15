// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import {
  CandleInterval,
  DatabaseMarketDataProvider,
  MarketDataUnavailableError,
  importPriceCandlesCsv,
} from '@/server/market-data';

const databasePath = resolve(tmpdir(), `tradeplay-market-data-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
const header = 'exchange,symbol,timestamp,open,high,low,close,volume';
let database: PrismaClient;

beforeAll(() => {
  closeSync(openSync(databasePath, 'a'));
  execFileSync(
    process.execPath,
    [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    },
  );

  database = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
  });
});

beforeEach(async () => {
  await database.priceCandle.deleteMany();
  await database.instrument.deleteMany();
});

afterAll(async () => {
  await database.$disconnect();
  for (const suffix of ['', '-shm', '-wal']) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
});

describe('DatabaseMarketDataProvider', () => {
  it('searches instruments and reads the latest and at-or-before close', async () => {
    const tcs = await createInstrument('TCS', 'Tata Consultancy Services Limited');
    const reliance = await createInstrument('RELIANCE', 'Reliance Industries Limited');
    const empty = await createInstrument('EMPTY', 'No Price Limited', 'BSE');

    await database.priceCandle.createMany({
      data: [
        storedCandle(tcs.id, 'minute', '2026-01-01T10:01:00.000Z', 9_900, 'ONE_MINUTE'),
        storedCandle(tcs.id, 'oldest', '2026-01-02T10:00:00.000Z', 10_000),
        storedCandle(tcs.id, 'middle', '2026-01-03T10:00:00.000Z', 10_250),
        storedCandle(tcs.id, 'newest', '2026-01-05T10:00:00.000Z', 10_500),
        storedCandle(tcs.id, 'newest-minute', '2026-01-05T10:00:00.000Z', 10_600, 'ONE_MINUTE'),
      ],
    });

    const provider = new DatabaseMarketDataProvider(database);

    await expect(provider.searchInstruments('tcs')).resolves.toMatchObject([
      { id: tcs.id, symbol: 'TCS' },
    ]);
    await expect(provider.searchInstruments('reliance ind')).resolves.toMatchObject([
      { id: reliance.id, symbol: 'RELIANCE' },
    ]);
    await expect(provider.searchInstruments('   ')).resolves.toEqual([]);

    await expect(provider.getLatestPrice(tcs.id)).resolves.toMatchObject({
      instrumentId: tcs.id,
      interval: CandleInterval.ONE_MINUTE,
      pricePaise: 10_600,
      openPaise: 10_500,
      timestamp: new Date('2026-01-05T10:00:00.000Z'),
    });
    await expect(
      provider.getPriceAt(tcs.id, new Date('2026-01-04T00:00:00.000Z')),
    ).resolves.toMatchObject({
      pricePaise: 10_250,
      timestamp: new Date('2026-01-03T10:00:00.000Z'),
    });
    await expect(
      provider.getPriceAt(tcs.id, new Date('2025-12-31T00:00:00.000Z')),
    ).resolves.toBeNull();

    await expect(provider.getInstrument(tcs.id)).resolves.toMatchObject({ symbol: 'TCS' });
    await expect(provider.getLatestPrice(empty.id)).rejects.toBeInstanceOf(
      MarketDataUnavailableError,
    );
  });

  it('filters candle interval and inclusive range and returns chronological rows', async () => {
    const instrument = await createInstrument('TCS', 'Tata Consultancy Services Limited');
    await database.priceCandle.createMany({
      data: [
        storedCandle(instrument.id, 'third', '2026-01-04T10:00:00.000Z', 10_300),
        storedCandle(instrument.id, 'first', '2026-01-02T10:00:00.000Z', 10_000),
        storedCandle(instrument.id, 'minute', '2026-01-03T10:00:00.000Z', 10_150, 'ONE_MINUTE'),
        storedCandle(instrument.id, 'second', '2026-01-03T10:00:00.000Z', 10_200),
      ],
    });

    const result = await new DatabaseMarketDataProvider(database).getCandles(
      instrument.id,
      new Date('2026-01-02T10:00:00.000Z'),
      new Date('2026-01-03T10:00:00.000Z'),
      CandleInterval.ONE_DAY,
    );

    expect(result.map(({ id }) => id)).toEqual(['first', 'second']);
  });
});

describe('CSV candle import', () => {
  it('stores exact integer paise and is idempotent across repeat imports', async () => {
    await createInstrument('TCS', 'Tata Consultancy Services Limited');
    const csv = [
      header,
      'NSE,TCS,2026-01-06T09:15:00.000Z,100.01,101.25,99.90,100.29,1200',
      'NSE,TCS,2026-01-07T09:15:00.000Z,100.29,102.00,100.00,101.50,1300',
    ].join('\n');

    const first = await importPriceCandlesCsv(
      csv,
      { interval: CandleInterval.ONE_DAY, source: 'integration-test' },
      database,
    );
    const repeated = await importPriceCandlesCsv(
      csv,
      { interval: CandleInterval.ONE_DAY, source: 'integration-test' },
      database,
    );

    expect(first).toMatchObject({
      totalRows: 2,
      importedRows: 2,
      duplicateRows: 0,
      rejectedRows: 0,
      errors: [],
    });
    expect(repeated).toMatchObject({
      totalRows: 2,
      importedRows: 0,
      duplicateRows: 2,
      rejectedRows: 0,
      errors: [],
    });

    const stored = await database.priceCandle.findMany({ orderBy: { timestamp: 'asc' } });
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      openPaise: 10_001,
      highPaise: 10_125,
      lowPaise: 9_990,
      closePaise: 10_029,
      volume: 1_200,
      interval: CandleInterval.ONE_DAY,
      source: 'integration-test',
    });
  });

  it('deduplicates within one file while keeping intervals distinct', async () => {
    await createInstrument('TCS', 'Tata Consultancy Services Limited');
    const csv = [
      header,
      'NSE,TCS,2026-01-06T09:15:00.000Z,100,101,99,100.50,1200',
      'NSE,TCS,2026-01-06T09:15:00.000Z,100,101,99,100.50,1200',
    ].join('\n');

    const daily = await importPriceCandlesCsv(csv, { interval: CandleInterval.ONE_DAY }, database);
    const minute = await importPriceCandlesCsv(
      csv,
      { interval: CandleInterval.ONE_MINUTE },
      database,
    );

    expect(daily).toMatchObject({ importedRows: 1, duplicateRows: 1, rejectedRows: 0 });
    expect(minute).toMatchObject({ importedRows: 1, duplicateRows: 1, rejectedRows: 0 });
    expect(await database.priceCandle.count()).toBe(2);
  });

  it('rejects invalid prices, inconsistent OHLC values, and negative volume', async () => {
    await createInstrument('TCS', 'Tata Consultancy Services Limited');
    const csv = [
      header,
      'NSE,TCS,2026-01-08T09:15:00.000Z,0,101,99,100,100',
      'NSE,TCS,2026-01-09T09:15:00.000Z,100,99,90,95,100',
      'NSE,TCS,2026-01-10T09:15:00.000Z,100,110,101,105,100',
      'NSE,TCS,2026-01-11T09:15:00.000Z,100,110,90,105,-1',
      'NSE,TCS,not-a-date,100,110,90,105,100',
    ].join('\n');

    const summary = await importPriceCandlesCsv(
      csv,
      { interval: CandleInterval.ONE_DAY },
      database,
    );

    expect(summary).toMatchObject({
      totalRows: 5,
      importedRows: 0,
      duplicateRows: 0,
      rejectedRows: 5,
    });
    expect(summary.errors.map(({ row }) => row)).toEqual([2, 3, 4, 5, 6]);
    expect(await database.priceCandle.count()).toBe(0);
  });

  it('returns a summary for file-level CSV errors', async () => {
    const wrongHeaders = await importPriceCandlesCsv(
      `symbol,timestamp\nTCS,2026-01-06T09:15:00.000Z`,
      { interval: CandleInterval.ONE_DAY },
      database,
    );
    const malformed = await importPriceCandlesCsv(
      `${header}\n"NSE,TCS,2026-01-06T09:15:00.000Z,100,101,99,100,1200`,
      { interval: CandleInterval.ONE_DAY },
      database,
    );

    expect(wrongHeaders).toMatchObject({
      totalRows: 1,
      importedRows: 0,
      duplicateRows: 0,
      rejectedRows: 1,
      errors: [{ row: 1 }],
    });
    expect(malformed).toMatchObject({
      totalRows: 0,
      importedRows: 0,
      duplicateRows: 0,
      rejectedRows: 0,
      errors: [{ row: 1, message: 'Unterminated quoted CSV field' }],
    });
  });
});

function createInstrument(symbol: string, companyName: string, exchange: 'NSE' | 'BSE' = 'NSE') {
  return database.instrument.create({
    data: {
      exchange,
      symbol,
      companyName,
      isin: `TEST-${exchange}-${symbol}`,
      sector: 'Test Sector',
      industry: 'Test Industry',
      currency: 'INR',
    },
  });
}

function storedCandle(
  instrumentId: string,
  id: string,
  timestamp: string,
  closePaise: number,
  interval: 'ONE_DAY' | 'ONE_MINUTE' = 'ONE_DAY',
) {
  return {
    id,
    instrumentId,
    interval,
    timestamp: new Date(timestamp),
    openPaise: closePaise - 100,
    highPaise: closePaise + 100,
    lowPaise: closePaise - 200,
    closePaise,
    volume: 1_000,
    source: 'database-test',
  };
}
