import { describe, expect, it } from 'vitest';

import { parseBhavcopy, toCanonicalCsv } from '@/server/market-data';

const HEADER = 'TradDt,TckrSymb,SctySrs,OpnPric,HghPric,LwPric,ClsPric,TtlTradgVol';
const BHAVCOPY = [
  HEADER,
  '2026-07-17,TATAMOTORS,EQ,1100.00,1120.50,1095.00,1110.25,1500000',
  '2026-07-17,TCS,EQ,3500,3550,3490,3520,800000',
  '2026-07-17,TATAMOTORS,BE,1100.00,1120.50,1095.00,1110.25,10', // non-EQ series → skipped
].join('\n');

describe('parseBhavcopy — NSE UDiFF → canonical rows', () => {
  it('keeps EQ series only and stamps the session close in IST', () => {
    const rows = parseBhavcopy(BHAVCOPY);
    expect(rows.map((row) => row.symbol)).toEqual(['TATAMOTORS', 'TCS']);
    expect(rows[0]).toMatchObject({
      symbol: 'TATAMOTORS',
      timestamp: '2026-07-17T15:30:00+05:30',
      open: '1100.00',
      high: '1120.50',
      close: '1110.25',
      volume: '1500000',
    });
  });

  it('filters to tracked symbols when provided', () => {
    const rows = parseBhavcopy(BHAVCOPY, new Set(['TATAMOTORS']));
    expect(rows.map((row) => row.symbol)).toEqual(['TATAMOTORS']);
  });

  it('accepts the legacy DD-MMM-YYYY date format', () => {
    const legacy = [HEADER, '17-JUL-2026,TCS,EQ,3500,3550,3490,3520,800000'].join('\n');
    expect(parseBhavcopy(legacy)[0].timestamp).toBe('2026-07-17T15:30:00+05:30');
  });

  it('yields nothing for a file that is not a bhavcopy', () => {
    expect(parseBhavcopy('foo,bar\n1,2')).toEqual([]);
  });

  it('serialises to the canonical importer CSV', () => {
    const csv = toCanonicalCsv(parseBhavcopy(BHAVCOPY, new Set(['TCS'])));
    expect(csv.split('\n')[0]).toBe('exchange,symbol,timestamp,open,high,low,close,volume');
    expect(csv).toContain('NSE,TCS,2026-07-17T15:30:00+05:30,3500,3550,3490,3520,800000');
  });
});
