import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { CandleInterval, PrismaClient } from '../src/generated/prisma/client';

const instruments = [
  [
    'NSE',
    'TATAMOTORS',
    'Tata Motors Limited',
    'INE155A01022',
    'Automobile',
    'Passenger Cars & Utility Vehicles',
  ],
  [
    'NSE',
    'TITAN',
    'Titan Company Limited',
    'INE280A01028',
    'Consumer Durables',
    'Jewellery & Watches',
  ],
  ['NSE', 'ASIANPAINT', 'Asian Paints Limited', 'INE021A01026', 'Consumer Durables', 'Paints'],
  ['NSE', 'RELIANCE', 'Reliance Industries Limited', 'INE002A01018', 'Diversified', 'Diversified'],
  [
    'NSE',
    'TCS',
    'Tata Consultancy Services Limited',
    'INE467B01029',
    'Information Technology',
    'IT Services',
  ],
  ['NSE', 'INFY', 'Infosys Limited', 'INE009A01021', 'Information Technology', 'IT Services'],
  [
    'NSE',
    'HDFCBANK',
    'HDFC Bank Limited',
    'INE040A01034',
    'Financial Services',
    'Private Sector Bank',
  ],
  [
    'NSE',
    'ICICIBANK',
    'ICICI Bank Limited',
    'INE090A01021',
    'Financial Services',
    'Private Sector Bank',
  ],
  [
    'NSE',
    'SBIN',
    'State Bank of India',
    'INE062A01020',
    'Financial Services',
    'Public Sector Bank',
  ],
  ['NSE', 'ITC', 'ITC Limited', 'INE154A01025', 'Fast Moving Consumer Goods', 'Diversified FMCG'],
  [
    'NSE',
    'HINDUNILVR',
    'Hindustan Unilever Limited',
    'INE030A01027',
    'Fast Moving Consumer Goods',
    'Personal Products',
  ],
  [
    'NSE',
    'BHARTIARTL',
    'Bharti Airtel Limited',
    'INE397D01024',
    'Telecommunication',
    'Telecom Services',
  ],
  ['NSE', 'LT', 'Larsen & Toubro Limited', 'INE018A01030', 'Construction', 'Civil Construction'],
  [
    'NSE',
    'BAJFINANCE',
    'Bajaj Finance Limited',
    'INE296A01024',
    'Financial Services',
    'Non-Banking Financial Company',
  ],
  [
    'NSE',
    'MARUTI',
    'Maruti Suzuki India Limited',
    'INE585B01010',
    'Automobile',
    'Passenger Cars & Utility Vehicles',
  ],
  [
    'NSE',
    'SUNPHARMA',
    'Sun Pharmaceutical Industries Limited',
    'INE044A01036',
    'Healthcare',
    'Pharmaceuticals',
  ],
  [
    'NSE',
    'KOTAKBANK',
    'Kotak Mahindra Bank Limited',
    'INE237A01028',
    'Financial Services',
    'Private Sector Bank',
  ],
  [
    'NSE',
    'AXISBANK',
    'Axis Bank Limited',
    'INE238A01034',
    'Financial Services',
    'Private Sector Bank',
  ],
  ['NSE', 'WIPRO', 'Wipro Limited', 'INE075A01022', 'Information Technology', 'IT Services'],
  [
    'NSE',
    'HCLTECH',
    'HCL Technologies Limited',
    'INE860A01027',
    'Information Technology',
    'IT Services',
  ],
  [
    'NSE',
    'ULTRACEMCO',
    'UltraTech Cement Limited',
    'INE481G01011',
    'Construction Materials',
    'Cement',
  ],
  ['NSE', 'NTPC', 'NTPC Limited', 'INE733E01010', 'Power', 'Power Generation'],
  [
    'NSE',
    'POWERGRID',
    'Power Grid Corporation of India Limited',
    'INE752E01010',
    'Power',
    'Power Transmission',
  ],
  [
    'NSE',
    'ONGC',
    'Oil and Natural Gas Corporation Limited',
    'INE213A01029',
    'Oil, Gas & Consumable Fuels',
    'Oil Exploration & Production',
  ],
] as const;

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://tradeplay:tradeplay@localhost:5433/tradeplay';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

// Approximate real-world price levels (₹) and annualised volatility per stock,
// so charts, portfolios and simulations behave like actual market data instead
// of obvious dummy numbers.
const PROFILE: Record<string, { basePaise: number; annualVol: number }> = {
  RELIANCE: { basePaise: 2_950_00, annualVol: 0.24 },
  TCS: { basePaise: 3_900_00, annualVol: 0.2 },
  HDFCBANK: { basePaise: 1_680_00, annualVol: 0.22 },
  ICICIBANK: { basePaise: 1_200_00, annualVol: 0.24 },
  SBIN: { basePaise: 820_00, annualVol: 0.28 },
  ITC: { basePaise: 430_00, annualVol: 0.2 },
  HINDUNILVR: { basePaise: 2_450_00, annualVol: 0.18 },
  BHARTIARTL: { basePaise: 1_500_00, annualVol: 0.24 },
  LT: { basePaise: 3_600_00, annualVol: 0.26 },
  BAJFINANCE: { basePaise: 7_200_00, annualVol: 0.32 },
  MARUTI: { basePaise: 12_500_00, annualVol: 0.26 },
  SUNPHARMA: { basePaise: 1_800_00, annualVol: 0.24 },
  KOTAKBANK: { basePaise: 1_750_00, annualVol: 0.24 },
  AXISBANK: { basePaise: 1_150_00, annualVol: 0.28 },
  ASIANPAINT: { basePaise: 2_300_00, annualVol: 0.22 },
  WIPRO: { basePaise: 550_00, annualVol: 0.26 },
  HCLTECH: { basePaise: 1_700_00, annualVol: 0.24 },
  ULTRACEMCO: { basePaise: 11_500_00, annualVol: 0.24 },
  NTPC: { basePaise: 360_00, annualVol: 0.26 },
  POWERGRID: { basePaise: 320_00, annualVol: 0.22 },
  ONGC: { basePaise: 270_00, annualVol: 0.3 },
  TATAMOTORS: { basePaise: 980_00, annualVol: 0.34 },
  TITAN: { basePaise: 3_400_00, annualVol: 0.26 },
  INFY: { basePaise: 1_560_00, annualVol: 0.24 },
};

const TRADING_DAYS = 400; // ~18 months of daily candles
const SESSION_MINUTES = 375; // 09:15–15:30 IST
const ANNUAL_DRIFT = 0.1;
const SEED_CREATED_AT = new Date('2020-01-01T00:00:00.000Z');
const NOW = new Date();

interface CandleRow {
  instrumentId: string;
  interval: CandleInterval;
  timestamp: Date;
  openPaise: number;
  highPaise: number;
  lowPaise: number;
  closePaise: number;
  volume: number;
  source: string;
  createdAt: Date;
}

async function main() {
  try {
    const instrumentIds = new Map<string, string>();
    for (const [exchange, symbol, companyName, isin, sector, industry] of instruments) {
      const data = {
        exchange,
        symbol,
        companyName,
        isin,
        sector,
        industry,
        currency: 'INR',
        isActive: true,
      } as const;
      const instrument = await prisma.instrument.upsert({
        where: { exchange_symbol: { exchange, symbol } },
        update: data,
        create: data,
      });
      instrumentIds.set(symbol, instrument.id);
    }

    // Regenerate a fresh, realistic price history each run.
    await prisma.priceCandle.deleteMany({
      where: { instrumentId: { in: [...instrumentIds.values()] } },
    });

    const days = tradingDays(TRADING_DAYS);
    const rows: CandleRow[] = [];
    for (const [, symbol] of instruments) {
      const id = instrumentIds.get(symbol)!;
      const profile = PROFILE[symbol] ?? { basePaise: 1_000_00, annualVol: 0.25 };
      rows.push(...generateCandles(id, symbol, profile, days));
    }
    await insertCandles(rows);
  } finally {
    await prisma.$disconnect();
  }
}

/** Daily geometric-random-walk candles plus a one-minute session for the last day. */
function generateCandles(
  instrumentId: string,
  symbol: string,
  profile: { basePaise: number; annualVol: number },
  days: Date[],
): CandleRow[] {
  const random = makeRandom(symbol);
  const dailyDrift = ANNUAL_DRIFT / 252;
  const dailyVol = profile.annualVol / Math.sqrt(252);

  // Walk in relative units, then rescale so the LATEST close equals the
  // realistic base price. This keeps a genuine random-walk shape while pinning
  // "today" to a sensible level for each stock.
  const raw: {
    timestamp: Date;
    open: number;
    close: number;
    high: number;
    low: number;
    volume: number;
  }[] = [];
  let close = 1;
  for (const timestamp of days) {
    const open = close * (1 + dailyVol * 0.15 * normal(random)); // overnight gap
    close = open * (1 + dailyDrift + dailyVol * normal(random));
    const high = Math.max(open, close) * (1 + Math.abs(normal(random)) * dailyVol * 0.6);
    const low = Math.min(open, close) * (1 - Math.abs(normal(random)) * dailyVol * 0.6);
    raw.push({ timestamp, open, close, high, low, volume: dailyVolume(random) });
  }

  const factor = profile.basePaise / raw[raw.length - 1].close;
  const rows: CandleRow[] = raw.map((bar) => ({
    instrumentId,
    interval: CandleInterval.ONE_DAY,
    timestamp: bar.timestamp,
    openPaise: clamp(Math.round(bar.open * factor)),
    highPaise: clamp(Math.round(bar.high * factor)),
    lowPaise: clamp(Math.round(bar.low * factor)),
    closePaise: clamp(Math.round(bar.close * factor)),
    volume: bar.volume,
    source: 'database-seed',
    createdAt: SEED_CREATED_AT,
  }));

  const lastDay = days.at(-1);
  if (lastDay) {
    const lastOpen = clamp(Math.round(raw[raw.length - 1].open * factor));
    rows.push(...generateMinuteCandles(instrumentId, profile, lastDay, lastOpen, random));
  }
  return rows;
}

function generateMinuteCandles(
  instrumentId: string,
  profile: { basePaise: number; annualVol: number },
  day: Date,
  dayOpenPaise: number,
  random: () => number,
): CandleRow[] {
  const sessionStart = new Date(day);
  sessionStart.setUTCHours(3, 45, 0, 0); // 09:15 IST
  const minuteVol = profile.annualVol / Math.sqrt(252 * SESSION_MINUTES);
  const rows: CandleRow[] = [];

  let close = dayOpenPaise;
  for (let minute = 0; minute < SESSION_MINUTES; minute += 1) {
    const timestamp = new Date(sessionStart.getTime() + minute * 60_000);
    if (timestamp.getTime() > NOW.getTime()) break; // never seed future candles
    const open = close;
    close = clamp(Math.round(open * (1 + minuteVol * normal(random))));
    rows.push({
      instrumentId,
      interval: CandleInterval.ONE_MINUTE,
      timestamp,
      openPaise: open,
      highPaise: clamp(
        Math.round(Math.max(open, close) * (1 + Math.abs(normal(random)) * minuteVol * 0.5)),
      ),
      lowPaise: clamp(
        Math.round(Math.min(open, close) * (1 - Math.abs(normal(random)) * minuteVol * 0.5)),
      ),
      closePaise: close,
      volume: Math.max(1, Math.round(dailyVolume(random) / SESSION_MINUTES)),
      source: 'database-seed',
      createdAt: SEED_CREATED_AT,
    });
  }
  return rows;
}

/** Most recent `count` trading days (weekdays), ending at the latest close ≤ now. */
function tradingDays(count: number): Date[] {
  const days: Date[] = [];
  const cursor = new Date(NOW);
  cursor.setUTCHours(10, 0, 0, 0); // 15:30 IST close
  if (cursor.getTime() > NOW.getTime()) cursor.setUTCDate(cursor.getUTCDate() - 1);

  while (days.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days.reverse();
}

async function insertCandles(rows: CandleRow[]) {
  const chunk = 1_000;
  for (let index = 0; index < rows.length; index += chunk) {
    await prisma.priceCandle.createMany({ data: rows.slice(index, index + chunk) });
  }
}

function clamp(paise: number): number {
  return Math.min(2_147_483_647, Math.max(1, paise));
}

function dailyVolume(random: () => number): number {
  return Math.round(500_000 + random() * 2_000_000);
}

/** Deterministic per-symbol PRNG so re-seeding reproduces the same price path. */
function makeRandom(seed: string): () => number {
  let state = fnv1a(seed) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function fnv1a(text: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** Standard normal via Box–Muller. */
function normal(random: () => number): number {
  const u1 = Math.max(random(), 1e-9);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

void main();
