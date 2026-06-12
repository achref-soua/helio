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
    // Everything except auth pages (two-factor runs mid-login on a partial
    // cookie), auth/trpc APIs, health, static assets (including the
    // metadata icon routes — browsers fetch favicons without credentials),
    // and the public surfaces: u/* (unsubscribe), f/* (hosted forms),
    // m/* (booking pages), p/* (landing pages), a/* (email image
    // assets — inbox clients fetch them anonymously), scim/* (bearer-
    // authenticated provisioning), and the write-key-scoped embed
    // endpoints api/widgets and api/inapp — these callers are not
    // session-cookie holders by definition.
    '/((?!login|signup|setup|forgot-password|reset-password|change-password|two-factor|accept-invitation|api/auth|api/trpc|api/healthz|api/widgets|api/inapp|u/|f/|m/|p/|a/|scim/|_next|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest).*)',
  ],
};
