import type { Metadata } from 'next';
import Form from 'next/form';
import Link from 'next/link';

import { marketDataProvider } from '@/server/market-data';

export const metadata: Metadata = {
  title: 'Markets',
};

export default async function InstrumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const query = firstValue((await searchParams).q)?.trim() ?? '';
  // With no query, browse the whole universe so users have something to explore.
  const instruments = query
    ? await marketDataProvider.searchInstruments(query)
    : await marketDataProvider.listInstruments();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-14">
      <section aria-labelledby="instrument-search-heading">
        <h2
          id="instrument-search-heading"
          className="font-display text-4xl tracking-tight text-primary md:text-5xl"
        >
          Find an instrument
        </h2>
        <p className="mt-3 text-body-large text-body-muted">Search by symbol or company name.</p>

        <Form
          action="/instruments"
          className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-stretch"
        >
          <label htmlFor="instrument-query" className="sr-only">
            Symbol or company name
          </label>
          <div className="relative min-w-0 flex-1">
            <svg
              className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-slate"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <circle cx="10.75" cy="10.75" r="6.75" />
              <path strokeLinecap="round" d="m16 16 4 4" />
            </svg>
            <input
              id="instrument-query"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Search RELIANCE, Tata Motors…"
              autoComplete="off"
              className="h-16 w-full rounded-sm border border-slate bg-canvas pl-13 pr-4 text-base text-primary placeholder:text-muted transition-colors hover:border-primary focus:border-focus-blue"
            />
          </div>
          <button
            type="submit"
            className="h-16 rounded-sm bg-action-blue px-10 text-base font-semibold text-white transition-colors hover:bg-focus-blue sm:min-w-40"
          >
            Search
          </button>
        </Form>

        <p className="mt-4 text-sm text-body-muted">
          {query
            ? `${instruments.length} ${instruments.length === 1 ? 'match' : 'matches'} for “${query}”`
            : `Browse all ${instruments.length} instruments, or search above`}
        </p>
      </section>

      {instruments.length > 0 ? (
        <section
          aria-label={query ? 'Instrument search results' : 'All instruments'}
          className="mt-7"
        >
          <ul className="overflow-hidden rounded-sm border border-hairline bg-canvas">
            {instruments.map((instrument) => (
              <li key={instrument.id} className="border-b border-hairline last:border-b-0">
                <Link
                  href={`/instruments/${instrument.id}`}
                  className="group grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-4 transition-colors hover:bg-soft-stone/45 sm:grid-cols-[150px_minmax(0,1fr)_70px_150px_auto] sm:px-6"
                >
                  <span className="font-semibold text-primary">{instrument.symbol}</span>
                  <span className="col-start-1 truncate text-sm text-ink sm:col-start-auto sm:text-base">
                    {instrument.companyName}
                  </span>
                  <span className="col-start-1 text-xs font-medium text-body-muted sm:col-start-auto sm:text-sm">
                    {instrument.exchange}
                  </span>
                  <span className="truncate text-xs text-body-muted sm:text-sm">
                    {instrument.sector}
                  </span>
                  <svg
                    className="col-start-2 row-start-1 h-5 w-5 text-primary transition-transform group-hover:translate-x-0.5 sm:col-start-auto sm:row-start-auto"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m7.5 4.5 5.5 5.5-5.5 5.5"
                    />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : query ? (
        <section className="mt-7 rounded-sm border border-hairline bg-soft-stone/30 px-5 py-8">
          <p className="font-medium text-primary">No instruments found</p>
          <p className="mt-1 text-sm text-body-muted">
            Try another symbol or a broader company name.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
