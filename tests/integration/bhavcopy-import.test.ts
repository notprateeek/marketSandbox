// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import { CandleInterval, PrismaClient } from '@/generated/prisma/client';
import { DatabaseMarketDataProvider, LiveMarketDataProvider, importNseBhavcopy } from '@/server/market-data';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;

const BHAVCOPY = [
  'TradDt,TckrSymb,SctySrs,OpnPric,HghPric,LwPric,ClsPric,TtlTradgVol',
  '2026-07-17,TATAMOTORS,EQ,1100.00,1120.50,1095.00,1110.25,1500000',
  '2026-07-17,TCS,EQ,3500.00,3550.00,3490.00,3520.00,800000',
  '2026-07-17,RELIANCE,EQ,2900.00,2950.00,2880.00,2930.00,500000', // not tracked → ignored
  '2026-07-17,TATAMOTORS,BE,1100.00,1120.50,1095.00,1110.25,10', // non-EQ → skipped
].join('\n');

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
});

afterAll(async () => {
  await ephemeral.drop();
});

describe('importNseBhavcopy — real EOD daily closes', () => {
  it('appends ONE_DAY candles for tracked instruments only, and the live walk rides them', async () => {
    const tata = await createInstrument('TATAMOTORS', 'Tata Motors Limited');
    await createInstrument('TCS', 'Tata Consultancy Services Limited');

    const summary = await importNseBhavcopy(BHAVCOPY, {}, database);
    expect(summary.importedRows).toBe(2); // TATAMOTORS + TCS; RELIANCE untracked, BE non-EQ
    expect(summary.rejectedRows).toBe(0);

    const candle = await database.priceCandle.findFirstOrThrow({
      where: { instrumentId: tata.id, interval: CandleInterval.ONE_DAY },
    });
    expect(candle.closePaise).toBe(111_025n); // ₹1,110.25
    expect(candle.timestamp.toISOString()).toBe('2026-07-17T10:00:00.000Z'); // 15:30 IST
    expect(candle.source).toBe('nse-bhavcopy');

    // Re-import is idempotent (unique candle key).
    const again = await importNseBhavcopy(BHAVCOPY, {}, database);
    expect(again.importedRows).toBe(0);
    expect(again.duplicateRows).toBe(2);

    // The intraday walk synthesises live movement from the real close.
    const marketOpen = new Date('2026-07-20T11:00:00+05:30'); // Monday, mid-session
    const live = new LiveMarketDataProvider(database, () => marketOpen);
    const price = await live.getLatestPrice(tata.id);
    expect(price.source).toBe('live-sim');
    expect(price.timestamp.getTime()).toBe(marketOpen.getTime());
    expect(price.pricePaise).toBeGreaterThan(0n);

    // Past reads still return the real close.
    const historical = await new DatabaseMarketDataProvider(database).getPriceAt(
      tata.id,
      new Date('2026-07-17T12:00:00Z'),
    );
    expect(historical?.pricePaise).toBe(111_025n);
  });
});

async function createInstrument(symbol: string, companyName: string) {
  return database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol,
      companyName,
      isin: `INE${symbol.slice(0, 6).padEnd(6, '0')}`,
      sector: 'Test',
      industry: 'Test',
      currency: 'INR',
    },
  });
}
