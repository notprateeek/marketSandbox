import 'dotenv/config';

import { prisma } from '@/lib/prisma';
import { importPriceCandlesCsv, CandleInterval } from '@/server/market-data';

/**
 * Curated historical event replay packs (Phase 3 content). Each pack seeds the
 * instruments it needs, imports representative ONE_DAY candles for its window via
 * the shared CSV importer, and upserts the ScenarioPack row (instrument ids +
 * checkpoint narratives as JSON). Idempotent — safe to re-run.
 *
 * Candle paths trace the real shape of each event (crash / drawdown / rebound)
 * at daily resolution; swap in real bhavcopy history later without touching the
 * engine. Prices are rupees; the importer converts to paise.
 */

interface InstrumentSeed {
  symbol: string;
  companyName: string;
  isin: string;
  sector: string;
  industry: string;
}

interface CheckpointSeed {
  date: string; // YYYY-MM-DD
  title: string;
  body: string;
}

interface PackSeed {
  slug: string;
  title: string;
  description: string;
  startingBalanceRupees: number;
  series: Record<string, [string, number][]>; // symbol -> [date, close]
  checkpoints: CheckpointSeed[];
}

const INSTRUMENTS: Record<string, InstrumentSeed> = {
  RELIANCE: { symbol: 'RELIANCE', companyName: 'Reliance Industries Limited', isin: 'INE002A01018', sector: 'Diversified', industry: 'Diversified' },
  HDFCBANK: { symbol: 'HDFCBANK', companyName: 'HDFC Bank Limited', isin: 'INE040A01034', sector: 'Financials', industry: 'Private Bank' },
  ADANIENT: { symbol: 'ADANIENT', companyName: 'Adani Enterprises Limited', isin: 'INE423A01024', sector: 'Diversified', industry: 'Trading' },
  YESBANK: { symbol: 'YESBANK', companyName: 'Yes Bank Limited', isin: 'INE528G01035', sector: 'Financials', industry: 'Private Bank' },
};

const PACKS: PackSeed[] = [
  {
    slug: 'covid-crash-2020',
    title: 'The COVID Crash — March 2020',
    description:
      'From record highs to the fastest bear market in history. Can you keep your nerve as the Nifty falls a third in five weeks — and would you buy the bottom?',
    startingBalanceRupees: 500_000,
    series: {
      RELIANCE: [
        ['2020-02-19', 1520], ['2020-02-24', 1480], ['2020-02-28', 1330], ['2020-03-04', 1350],
        ['2020-03-06', 1300], ['2020-03-09', 1130], ['2020-03-12', 1050], ['2020-03-13', 1090],
        ['2020-03-18', 1000], ['2020-03-19', 960], ['2020-03-23', 875], ['2020-03-25', 1030],
        ['2020-03-27', 1100], ['2020-04-01', 1080], ['2020-04-03', 1130],
      ],
      HDFCBANK: [
        ['2020-02-19', 1210], ['2020-02-24', 1180], ['2020-02-28', 1120], ['2020-03-04', 1140],
        ['2020-03-06', 1090], ['2020-03-09', 1010], ['2020-03-12', 920], ['2020-03-13', 940],
        ['2020-03-18', 840], ['2020-03-19', 790], ['2020-03-23', 740], ['2020-03-25', 860],
        ['2020-03-27', 900], ['2020-04-01', 870], ['2020-04-03', 880],
      ],
    },
    checkpoints: [
      { date: '2020-02-19', title: 'Markets at record highs', body: 'The Nifty sits near all-time highs. COVID-19 still looks like a distant China problem — most investors are fully invested.' },
      { date: '2020-03-09', title: 'Black Monday', body: 'An oil-price war and spreading virus trigger a global rout. Circuit breakers halt trading. This is where fortunes are lost — or made.' },
      { date: '2020-03-23', title: 'The bottom', body: 'The index hits its low as a nationwide lockdown is announced. It will not be obvious in the moment, but the recovery starts tomorrow.' },
    ],
  },
  {
    slug: 'adani-hindenburg-2023',
    title: 'Adani vs. Hindenburg — January 2023',
    description:
      'A short-seller’s report wipes out over half of Adani Enterprises in a week, forcing a fully-subscribed ₹20,000cr share sale to be pulled. Do you catch the falling knife?',
    startingBalanceRupees: 300_000,
    series: {
      ADANIENT: [
        ['2023-01-24', 3440], ['2023-01-25', 3390], ['2023-01-27', 2760], ['2023-01-30', 2890],
        ['2023-01-31', 2890], ['2023-02-01', 2130], ['2023-02-02', 1565], ['2023-02-03', 1585],
      ],
    },
    checkpoints: [
      { date: '2023-01-24', title: 'Before the storm', body: 'Adani Enterprises trades near its highs, days into a ₹20,000cr follow-on public offer. The group is India’s hottest conglomerate.' },
      { date: '2023-01-27', title: 'The report', body: 'Hindenburg Research alleges accounting fraud and stock manipulation. The stock craters and drags the whole group down.' },
      { date: '2023-02-01', title: 'FPO withdrawn', body: 'Despite being fully subscribed, the share sale is pulled to “protect investors”. The selloff deepens.' },
    ],
  },
  {
    slug: 'election-results-2024',
    title: 'Election Results Day — June 2024',
    description:
      'Exit polls promised a landslide; the count delivered a coalition. Markets swung violently in 48 hours. Trade the shock and the rebound.',
    startingBalanceRupees: 400_000,
    series: {
      RELIANCE: [['2024-06-03', 2960], ['2024-06-04', 2660], ['2024-06-05', 2870], ['2024-06-06', 2920], ['2024-06-07', 2960]],
      HDFCBANK: [['2024-06-03', 1560], ['2024-06-04', 1430], ['2024-06-05', 1520], ['2024-06-06', 1680], ['2024-06-07', 1720]],
    },
    checkpoints: [
      { date: '2024-06-03', title: 'Exit-poll euphoria', body: 'Weekend exit polls predict a sweeping majority. Markets gap up to record highs on Monday.' },
      { date: '2024-06-04', title: 'Counting-day shock', body: 'The actual count falls well short of the polls. The Sensex plunges nearly 6% intraday — the worst session in years.' },
      { date: '2024-06-06', title: 'The rebound', body: 'Coalition arithmetic settles and continuity looks likely. Markets rip back to new highs.' },
    ],
  },
  {
    slug: 'yes-bank-2020',
    title: 'The Yes Bank Collapse — March 2020',
    description:
      'A withdrawal moratorium and a state-led rescue turn a private bank into a lottery ticket. Extreme volatility, real lessons about single-stock risk.',
    startingBalanceRupees: 200_000,
    series: {
      YESBANK: [
        ['2020-03-05', 37], ['2020-03-06', 16], ['2020-03-09', 21], ['2020-03-11', 37],
        ['2020-03-12', 29], ['2020-03-13', 37], ['2020-03-16', 26], ['2020-03-17', 30], ['2020-03-18', 26],
      ],
    },
    checkpoints: [
      { date: '2020-03-05', title: 'Moratorium', body: 'The RBI caps withdrawals at ₹50,000 and supersedes the board. The stock collapses over 50% in a day.' },
      { date: '2020-03-06', title: 'State-led rescue', body: 'SBI is asked to lead a reconstruction. Hope and fear whipsaw the price with no fundamentals to anchor it.' },
      { date: '2020-03-13', title: 'Reconstruction notified', body: 'The rescue scheme is formalised with a lock-in on most shares. Speculators pile in and out.' },
    ],
  },
];

async function main() {
  for (const pack of PACKS) {
    const symbols = Object.keys(pack.series);
    const instrumentIds: string[] = [];

    for (const symbol of symbols) {
      const seed = INSTRUMENTS[symbol];
      const instrument = await prisma.instrument.upsert({
        where: { exchange_symbol: { exchange: 'NSE', symbol } },
        create: { exchange: 'NSE', ...seed, currency: 'INR' },
        update: {},
      });
      instrumentIds.push(instrument.id);
    }

    const csv = buildCandleCsv(pack.series);
    const summary = await importPriceCandlesCsv(
      csv,
      { interval: CandleInterval.ONE_DAY, source: `scenario:${pack.slug}` },
      prisma,
    );

    const allDates = symbols.flatMap((symbol) => pack.series[symbol].map(([date]) => date)).sort();
    const start = sessionClose(allDates[0]);
    const end = sessionClose(allDates[allDates.length - 1]);

    await prisma.scenarioPack.upsert({
      where: { slug: pack.slug },
      create: {
        slug: pack.slug,
        title: pack.title,
        description: pack.description,
        startTimestamp: start,
        endTimestamp: end,
        instrumentIds: JSON.stringify(instrumentIds),
        startingBalancePaise: BigInt(pack.startingBalanceRupees) * 100n,
        checkpoints: JSON.stringify(
          pack.checkpoints.map((c) => ({ timestamp: sessionClose(c.date).toISOString(), title: c.title, body: c.body })),
        ),
      },
      update: {
        title: pack.title,
        description: pack.description,
        startTimestamp: start,
        endTimestamp: end,
        instrumentIds: JSON.stringify(instrumentIds),
        startingBalancePaise: BigInt(pack.startingBalanceRupees) * 100n,
        checkpoints: JSON.stringify(
          pack.checkpoints.map((c) => ({ timestamp: sessionClose(c.date).toISOString(), title: c.title, body: c.body })),
        ),
      },
    });

    console.log(
      `Seeded "${pack.title}" — ${summary.importedRows} imported, ${summary.duplicateRows} already present.`,
    );
  }
}

/** Build the canonical importer CSV from per-symbol [date, close] series. */
function buildCandleCsv(series: Record<string, [string, number][]>): string {
  const lines = ['exchange,symbol,timestamp,open,high,low,close,volume'];
  for (const [symbol, points] of Object.entries(series)) {
    let previousClose = points[0][1];
    for (const [date, close] of points) {
      const open = previousClose;
      const high = round2(Math.max(open, close) * 1.01);
      const low = round2(Math.min(open, close) * 0.99);
      lines.push(
        [
          'NSE',
          symbol,
          sessionClose(date).toISOString(),
          round2(open),
          high,
          low,
          round2(close),
          1_000_000,
        ].join(','),
      );
      previousClose = close;
    }
  }
  return lines.join('\n');
}

function sessionClose(date: string): Date {
  return new Date(`${date}T15:30:00+05:30`);
}

function round2(value: number): string {
  return value.toFixed(2);
}

main()
  .then(() => console.log('Scenario packs seeded.'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => process.exit(0));
