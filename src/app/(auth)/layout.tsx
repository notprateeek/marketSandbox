import Link from 'next/link';

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(320px,0.85fr)_1.15fr]">
      <section className="hidden flex-col justify-between bg-deep-green p-10 text-white lg:flex xl:p-14">
        <Link
          href="/sign-in"
          className="flex w-fit items-center gap-3"
          aria-label="TradePlay sign in"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-sm bg-white/10">
            <MarketMark />
          </span>
          <span className="font-display text-xl tracking-tight">TradePlay</span>
        </Link>

        <div className="max-w-lg">
          <p className="text-mono-label text-white/50">Practice before you trade</p>
          <p className="mt-4 font-display text-4xl leading-tight tracking-tight xl:text-5xl">
            Learn the market with virtual money and real discipline.
          </p>
        </div>

        <p className="text-sm text-white/45">Indian equities · No real money involved</p>
      </section>

      <section className="flex min-h-screen items-center px-5 py-10 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-md">
          <Link
            href="/sign-in"
            className="mb-12 flex w-fit items-center gap-2.5 lg:hidden"
            aria-label="TradePlay sign in"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-deep-green text-white">
              <MarketMark />
            </span>
            <span className="font-display text-lg tracking-tight text-primary">TradePlay</span>
          </Link>
          {children}
        </div>
      </section>
    </main>
  );
}

function MarketMark() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941"
      />
    </svg>
  );
}
