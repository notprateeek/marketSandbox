import { redirect } from 'next/navigation';

// Trading is instrument-centric: pick a stock in the market search, then use the
// trade ticket on its detail page. "Trade" routes there.
export default function TradePage() {
  redirect('/instruments');
}
