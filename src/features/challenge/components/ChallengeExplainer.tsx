const STEPS = [
  {
    title: 'Create or join',
    body: 'Spin up a challenge or join an existing one before it starts. Registration closes the moment the challenge begins.',
  },
  {
    title: 'Everyone starts equal',
    body: 'Each participant trades a separate virtual account seeded with the same starting balance. Your main portfolio is never touched.',
  },
  {
    title: 'Trade the window',
    body: 'Buy and sell — optionally limited to a set list of instruments — until the challenge ends. An optional trade cap keeps it disciplined.',
  },
  {
    title: 'Ranked by one metric',
    body: 'Standings use a single scoring method, never a blend. Whoever leads that metric tops the leaderboard.',
  },
];

const SCORING = [
  { name: 'Highest return', body: 'Percentage growth of the virtual account — pure performance.' },
  {
    name: 'Lowest drawdown',
    body: 'Smallest peak-to-trough drop — rewards steady, risk-controlled trading.',
  },
  {
    name: 'Best prediction accuracy',
    body: 'Share of your price predictions that resolved correct.',
  },
];

/**
 * Plain-language primer for the challenges feature. Rendered on the challenges
 * list (collapsible) and above the create form, so first-timers understand what
 * a challenge is before joining or building one.
 */
export function ChallengeExplainer() {
  return (
    <details open className="rounded-sm border border-hairline bg-canvas">
      <summary className="cursor-pointer px-5 py-4 text-heading-feature text-primary">
        How challenges work
      </summary>
      <div className="border-t border-hairline px-5 py-5">
        <ol className="grid gap-4 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pale-blue text-xs font-semibold text-action-blue">
                {index + 1}
              </span>
              <div>
                <p className="font-medium text-primary">{step.title}</p>
                <p className="mt-0.5 text-sm text-body-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 border-t border-hairline pt-4">
          <p className="text-mono-label text-muted">Scoring methods</p>
          <dl className="mt-2 space-y-1.5 text-sm">
            {SCORING.map((method) => (
              <div key={method.name} className="sm:flex sm:gap-2">
                <dt className="font-medium text-primary sm:w-48 sm:shrink-0">{method.name}</dt>
                <dd className="text-body-muted">{method.body}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="mt-4 text-xs text-muted">
          Everything here is simulated — no real money is ever involved.
        </p>
      </div>
    </details>
  );
}
