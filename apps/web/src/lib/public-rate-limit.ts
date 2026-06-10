import { FixedWindowRateLimiter, type RateLimitDecision } from '@helio/core';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { env } from '@/lib/env';

/**
 * Per-surface budgets for the public, unauthenticated web endpoints. They
 * live in-process (per replica — see FixedWindowRateLimiter), generous
 * enough that real traffic never notices and tight enough to damp scripted
 * abuse. The token-authed unsubscribe endpoints are deliberately unlimited:
 * one-click unsubscribe must always land (RFC 8058), and an invalid token
 * costs one HMAC check and no database work.
 */
const BUDGETS = {
  /** Widget config fetch — once per embedding page load. */
  widgets: { max: 120, windowSeconds: 60 },
  /** In-app message poll — periodic per identified visitor. */
  inappRead: { max: 240, windowSeconds: 60 },
  /** In-app mark-seen writes. */
  inappWrite: { max: 60, windowSeconds: 60 },
  /** Hosted form submissions — the public contact-write path. */
  form: { max: 30, windowSeconds: 60 },
  /** Public meeting booking — writes meetings, contacts, and tasks. */
  booking: { max: 30, windowSeconds: 60 },
  /** SCIM provisioning — sized for an IdP sync burst. */
  scim: { max: 240, windowSeconds: 60 },
} as const;

export type PublicSurface = keyof typeof BUDGETS;

const limiters = new Map<PublicSurface, FixedWindowRateLimiter>();

const UNLIMITED: RateLimitDecision = {
  allowed: true,
  limit: 0,
  remaining: 0,
  retryAfterSeconds: 0,
};

/** First forwarded hop (set by the fronting proxy), else the direct peer. */
async function clientIp(): Promise<string> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || requestHeaders.get('x-real-ip') || 'local';
}

/**
 * Count a hit on a public surface for the calling client. `discriminator`
 * widens the key (e.g. the write key) so unrelated tenants behind one IP
 * don't share a budget.
 */
export async function checkPublicRateLimit(
  surface: PublicSurface,
  discriminator = '',
): Promise<RateLimitDecision> {
  if (!env.PUBLIC_RATE_LIMITS_ENABLED) return UNLIMITED;
  let limiter = limiters.get(surface);
  if (!limiter) {
    limiter = new FixedWindowRateLimiter(BUDGETS[surface]);
    limiters.set(surface, limiter);
  }
  const ip = await clientIp();
  return limiter.check(discriminator ? `${ip}:${discriminator}` : ip);
}

/** 429 with Retry-After; `extraHeaders` carries CORS on embed endpoints. */
export function rateLimitedResponse(
  decision: RateLimitDecision,
  extraHeaders?: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    { error: 'rate_limited' },
    {
      status: 429,
      headers: {
        ...extraHeaders,
        'Retry-After': String(decision.retryAfterSeconds),
        'RateLimit-Limit': String(decision.limit),
        'RateLimit-Remaining': String(decision.remaining),
        // A throttle decision is never cacheable, whatever the surface says.
        'Cache-Control': 'no-store',
      },
    },
  );
}
