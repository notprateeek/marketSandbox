import type { PrismaClient } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { CandleInterval } from './types';
import {
  importPriceCandlesCsv,
  parseCsv,
  type PriceCandleImportSummary,
} from './csv-importer';

/**
 * NSE EOD "bhavcopy" importer. The exchange publishes a free daily UDiFF CSV
 * (columns like TckrSymb / TradDt / OpnPric …). This maps the EQ-series rows of
 * that file onto the canonical candle CSV the existing {@link importPriceCandlesCsv}
 * understands and reuses it wholesale — so all the validation, dedup and
 * unknown-instrument handling is shared, not re-implemented.
 *
 * Official, free, EOD, and legally clean (real-time ticks need exchange
 * licensing). Run it as a post-market job (~6:30pm IST) to append ONE_DAY
 * candles; the live intraday walk then rides on top of the newest real close.
 */

// UDiFF sec-bhavcopy columns we read (case-insensitive match).
const COLUMNS = {
  symbol: 'tckrsymb',
  series: 'sctysrs',
  date: 'traddt',
  open: 'opnpric',
  high: 'hghpric',
  low: 'lwpric',
  close: 'clspric',
  volume: 'ttltradgvol',
} as const;

const CANONICAL_HEADER = 'exchange,symbol,timestamp,open,high,low,close,volume';

export interface CanonicalCandleRow {
  symbol: string;
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

/**
 * Parses an NSE bhavcopy CSV into canonical rows, keeping only the EQ series and
 * (when `symbols` is given) only tracked symbols. Pure — no I/O. Prices pass
 * through as rupee strings; the canonical importer converts them to paise.
 */
export function parseBhavcopy(
  csv: string,
  symbols?: ReadonlySet<string>,
): CanonicalCandleRow[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];

  const header = rows[0].map((name) => name.replace(/^﻿/, '').trim().toLowerCase());
  const index = (key: string) => header.indexOf(key);
  const cols = Object.fromEntries(
    Object.entries(COLUMNS).map(([field, name]) => [field, index(name)]),
  ) as Record<keyof typeof COLUMNS, number>;

  // If the file isn't a bhavcopy (missing our columns), yield nothing.
  if (Object.values(cols).some((column) => column < 0)) return [];

  const out: CanonicalCandleRow[] = [];
  for (const values of rows.slice(1)) {
    const series = values[cols.series]?.trim().toUpperCase();
    if (series !== 'EQ') continue;

    const symbol = values[cols.symbol]?.trim().toUpperCase();
    if (!symbol || (symbols && !symbols.has(symbol))) continue;

    const timestamp = sessionCloseIso(values[cols.date]?.trim() ?? '');
    if (!timestamp) continue;

    out.push({
      symbol,
      timestamp,
      open: values[cols.open]?.trim() ?? '',
      high: values[cols.high]?.trim() ?? '',
      low: values[cols.low]?.trim() ?? '',
      close: values[cols.close]?.trim() ?? '',
      volume: values[cols.volume]?.trim() ?? '',
    });
  }
  return out;
}

export function toCanonicalCsv(rows: CanonicalCandleRow[]): string {
  const lines = rows.map((row) =>
    [
      'NSE',
      row.symbol,
      row.timestamp,
      row.open,
      row.high,
      row.low,
      row.close,
      row.volume,
    ]
      .map(csvCell)
      .join(','),
  );
  return [CANONICAL_HEADER, ...lines].join('\n');
}

/**
 * Imports an NSE bhavcopy: filters to the EQ rows for instruments we already
 * track (so the summary isn't drowned by the ~2,000 symbols we don't), then
 * hands the canonical CSV to the shared importer as ONE_DAY candles.
 */
export async function importNseBhavcopy(
  csv: string,
  options: { source?: string } = {},
  database: PrismaClient = prisma,
): Promise<PriceCandleImportSummary> {
  const tracked = await database.instrument.findMany({
    where: { exchange: 'NSE', isActive: true },
    select: { symbol: true },
  });
  const symbols = new Set(tracked.map((instrument) => instrument.symbol.toUpperCase()));

  const rows = parseBhavcopy(csv, symbols);
  return importPriceCandlesCsv(
    toCanonicalCsv(rows),
    { interval: CandleInterval.ONE_DAY, source: options.source ?? 'nse-bhavcopy' },
    database,
  );
}

/** NSE bhavcopy trade date → the session close instant (15:30 IST) as ISO. */
function sessionCloseIso(tradeDate: string): string | null {
  const isoDay = normalizeTradeDate(tradeDate);
  return isoDay ? `${isoDay}T15:30:00+05:30` : null;
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/** Accepts UDiFF "YYYY-MM-DD" or legacy "DD-MMM-YYYY"; returns "YYYY-MM-DD". */
function normalizeTradeDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const legacy = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(value);
  if (legacy) {
    const month = MONTHS[legacy[2].toUpperCase()];
    if (month) return `${legacy[3]}-${month}-${legacy[1]}`;
  }
  return null;
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
