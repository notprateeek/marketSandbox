import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { consumeToken, type RateLimit } from '@/lib/rate-limit';

// Next 16 renamed `middleware` → `proxy`; it runs on the Node.js runtime, so the
// in-memory token buckets in `@/lib/rate-limit` persist across requests here.

// Auth attempts are server-action POSTs to these pages (see app/actions/auth.ts).
const AUTH_PATHS = new Set(['/sign-in', '/sign-up']);

// Strict, per-IP: absorb a handful of login/register attempts, then ~8/min.
const AUTH_LIMIT: RateLimit = { capacity: 8, refillPerSec: 8 / 60 };
// Generous, per-session (IP fallback): order-placement and other mutation
// actions. Comfortably above the 8s live-price heartbeat (~7.5/min) and any
// human trading pace; only scripted abuse hits it.
const ACTION_LIMIT: RateLimit = { capacity: 40, refillPerSec: 40 / 60 };

export function proxy(request: NextRequest): NextResponse {
  // Only mutations are throttled — page/RSC GETs pass straight through.
  if (request.method !== 'POST') return NextResponse.next();

  const pathname = request.nextUrl.pathname;
  const ip = clientIp(request);

  if (AUTH_PATHS.has(pathname)) {
    return consumeToken(`auth:${ip}`, AUTH_LIMIT) ? NextResponse.next() : tooManyRequests();
  }

  // Server Functions are POSTs to their page route, tagged with `Next-Action`.
  if (request.headers.has('next-action')) {
    const key = sessionKey(request) ?? ip;
    return consumeToken(`action:${key}`, ACTION_LIMIT) ? NextResponse.next() : tooManyRequests();
  }

  return NextResponse.next();
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

// Opaque per-login key: the next-auth session cookie value. Avoids decoding the
// JWT — different signed-in users get separate buckets even behind one NAT/IP.
function sessionKey(request: NextRequest): string | null {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.endsWith('authjs.session-token')) return cookie.value;
  }
  return null;
}

function tooManyRequests(): NextResponse {
  return new NextResponse('Too many requests. Please slow down and try again.', {
    status: 429,
    headers: { 'Retry-After': '10' },
  });
}

export const config = {
  // Run on app routes (where server actions POST); skip static assets and API.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
