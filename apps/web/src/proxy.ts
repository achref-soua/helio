import { getSessionCookie } from 'better-auth/cookies';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Optimistic auth gate: redirects anonymous visitors to /login based on
 * cookie presence only. Real session validation happens server-side in the
 * dashboard layout and in every protected tRPC procedure — this just keeps
 * obviously-anonymous traffic off authenticated routes.
 */
export default function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except auth pages, auth/trpc APIs, health, static assets,
    // and the public surfaces: u/* (unsubscribe), f/* (hosted forms),
    // m/* (booking pages), p/* (landing pages), and scim/* (bearer-
    // authenticated provisioning) — these callers are not session-cookie
    // holders by definition.
    '/((?!login|signup|accept-invitation|api/auth|api/trpc|api/healthz|u/|f/|m/|p/|scim/|_next|favicon.ico).*)',
  ],
};
