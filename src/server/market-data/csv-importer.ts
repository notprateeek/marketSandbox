import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { parsePriceToPaise } from '@/lib/finance/currency';
import { prisma } from '@/lib/prisma';
import { CandleInterval, type CandleInterval as CandleIntervalValue } from './types';

const HEADERS = [
  'exchange',
  'symbol',
  'timestamp',
  'open',
  'high',
  'low',
  'close',
  'volume',
] as const;
const MAX_DATABASE_INT = BigInt(2_147_483_647);

const priceSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    try {
      return parsePriceToPaise(value);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid price',
      });
      return z.NEVER;
    }
  });

const volumeSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    if (!/^\d+$/.test(value)) {
      context.addIssue({ code: 'custom', message: 'Volume must be a nonnegative integer' });
      return z.NEVER;
    }

    const volume = BigInt(value);
    if (volume > MAX_DATABASE_INT) {
      context.addIssue({ code: 'custom', message: 'Volume exceeds the supported range' });
      return z.NEVER;
    }

    return Number(volume);
  });

const rowSchema = z
  .object({
    exchange: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.enum(['NSE', 'BSE'])),
    symbol: z
      .string()
      .trim()
      .min(1, 'Symbol is required')
      .transform((value) => value.toUpperCase()),
    timestamp: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
    open: priceSchema,
    high: priceSchema,
    low: priceSchema,
    close: priceSchema,
    volume: volumeSchema,
  })
  .superRefine((row, context) => {
    const maxOfOthers = [row.open, row.low, row.close].reduce((m, v) => (v > m ? v : m));
    const minOfOthers = [row.open, row.high, row.close].reduce((m, v) => (v < m ? v : m));
    if (row.high < maxOfOthers) {
      context.addIssue({
        code: 'custom',
        path: ['high'],
        message: 'High price must be at least open, low, and close',
      });
    }
    if (row.low > minOfOthers) {
      context.addIssue({
        code: 'custom',
        path: ['low'],
        message: 'Low price must be at most open, high, and close',
      });
    }
  });

export interface ImportPriceCandlesOptions {
  interval: CandleIntervalValue;
  source?: string;
}

export interface PriceCandleImportError {
  row: number;
  message: string;
}

export interface PriceCandleImportSummary {
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  rejectedRows: number;
  errors: PriceCandleImportError[];
}

export async function importPriceCandlesCsv(
  csv: string,
  options: ImportPriceCandlesOptions,
  database: PrismaClient = prisma,
): Promise<PriceCandleImportSummary> {
  const interval = z
    .enum([CandleInterval.ONE_MINUTE, CandleInterval.ONE_DAY])
    .parse(options.interval);
  const source = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .parse(options.source ?? 'csv');
  let parsedRows: string[][];
  try {
    parsedRows = parseCsv(csv);
  } catch (error) {
    return fileErrorSummary(error instanceof Error ? error.message : 'Malformed CSV');
  }

  if (parsedRows.length === 0) return fileErrorSummary('CSV is empty');

  const headers = parsedRows[0].map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim().toLowerCase(),
  );
  const rows = parsedRows.slice(1).filter((row) => row.some((value) => value.trim() !== ''));
  try {
    assertHeaders(headers);
  } catch (error) {
    return fileErrorSummary(
      error instanceof Error ? error.message : 'Invalid CSV headers',
      rows.length,
    );
  }
  const summary: PriceCandleImportSummary = {
    totalRows: rows.length,
    importedRows: 0,
    duplicateRows: 0,
    rejectedRows: 0,
    errors: [],
  };
  const instrumentIds = new Map<string, string | null>();
  const seenCandles = new Set<string>();

  for (const [index, values] of rows.entries()) {
    const rowNumber = index + 2;

    if (values.length !== headers.length) {
      reject(summary, rowNumber, `Expected ${headers.length} columns, received ${values.length}`);
      continue;
    }

    const rawRow = Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    const parsed = rowSchema.safeParse(rawRow);

    if (!parsed.success) {
      reject(
        summary,
        rowNumber,
        parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'row'}: ${issue.message}`)
          .join('; '),
      );
      continue;
    }

    const instrumentKey = `${parsed.data.exchange}:${parsed.data.symbol}`;
    if (!instrumentIds.has(instrumentKey)) {
      const instrument = await database.instrument.findUnique({
        where: {
          exchange_symbol: {
            exchange: parsed.data.exchange,
            symbol: parsed.data.symbol,
          },
        },
      });
      instrumentIds.set(instrumentKey, instrument?.isActive ? instrument.id : null);
    }

    const instrumentId = instrumentIds.get(instrumentKey);
    if (!instrumentId) {
      reject(summary, rowNumber, `Unknown instrument: ${instrumentKey}`);
      continue;
    }

    const candleKey = `${instrumentId}:${interval}:${parsed.data.timestamp.toISOString()}`;
    if (seenCandles.has(candleKey)) {
      summary.duplicateRows += 1;
      continue;
    }
    seenCandles.add(candleKey);

    try {
      await database.priceCandle.create({
        data: {
          instrumentId,
          interval,
          timestamp: parsed.data.timestamp,
          openPaise: parsed.data.open,
          highPaise: parsed.data.high,
          lowPaise: parsed.data.low,
          closePaise: parsed.data.close,
          volume: parsed.data.volume,
          source,
        },
      });
      summary.importedRows += 1;
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      summary.duplicateRows += 1;
    }
  }

  return summary;
}

function assertHeaders(headers: string[]): void {
  if (
    headers.length !== HEADERS.length ||
    new Set(headers).size !== HEADERS.length ||
    HEADERS.some((header) => !headers.includes(header))
  ) {
    throw new Error(`CSV headers must be exactly: ${HEADERS.join(', ')}`);
  }
}

function reject(summary: PriceCandleImportSummary, row: number, message: string): void {
  summary.rejectedRows += 1;
  summary.errors.push({ row, message });
}

function fileErrorSummary(message: string, totalRows = 0): PriceCandleImportSummary {
  return {
    totalRows,
    importedRows: 0,
    duplicateRows: 0,
    rejectedRows: totalRows,
    errors: [{ row: 1, message }],
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let quoteClosed = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];

    if (inQuotes) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          quoteClosed = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (quoteClosed) {
      if (character === ' ' || character === '\t') continue;
      if (character !== ',' && character !== '\n' && character !== '\r') {
        throw new Error(`Unexpected character after a quoted CSV field at position ${index + 1}`);
      }
      quoteClosed = false;
    }

    if (character === '"') {
      if (field.length !== 0) {
        throw new Error(`Unexpected quote in CSV field at position ${index + 1}`);
      }
      inQuotes = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (character === '\r' && csv[index + 1] === '\n') index += 1;
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error('Unterminated quoted CSV field');

  row.push(field);
  rows.push(row);
  return rows.filter((values) => values.some((value) => value.trim() !== ''));
}
