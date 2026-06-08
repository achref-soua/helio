/**
 * Billing: the plan catalog, usage limits, and Stripe-compatible webhook
 * signature verification. Pure and isomorphic (Web Crypto), so the same
 * code runs in the gateway and is unit-tested without the Stripe SDK.
 *
 * Helio is self-hostable and free to run; billing is opt-in for hosted
 * deployments. When Stripe is not configured the plan is UNLIMITED and no
 * cap is enforced — owning your data should never be paywalled.
 */

export const PLANS = ['FREE', 'PRO', 'SCALE', 'UNLIMITED'] as const;
export type Plan = (typeof PLANS)[number];

export interface PlanSpec {
  /** Maximum active contacts; null means unlimited. */
  contactLimit: number | null;
  /** Monthly price in minor units (cents); 0 for free/self-hosted. */
  priceCents: number;
}

export const PLAN_CATALOG: Record<Plan, PlanSpec> = {
  FREE: { contactLimit: 1_000, priceCents: 0 },
  PRO: { contactLimit: 25_000, priceCents: 4900 },
  SCALE: { contactLimit: 250_000, priceCents: 19900 },
  // Self-hosted default: no metering, no cap.
  UNLIMITED: { contactLimit: null, priceCents: 0 },
};

export function planSpec(plan: Plan): PlanSpec {
  return PLAN_CATALOG[plan];
}

export function contactLimitFor(plan: Plan): number | null {
  return PLAN_CATALOG[plan].contactLimit;
}

/** True when adding `adding` contacts to `current` would exceed the plan. */
export function wouldExceedContactLimit(plan: Plan, current: number, adding = 1): boolean {
  const limit = contactLimitFor(plan);
  if (limit === null) return false;
  return current + adding > limit;
}

export function isValidPlan(value: string): value is Plan {
  return (PLANS as readonly string[]).includes(value);
}

const encoder = new TextEncoder();

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a Stripe webhook signature header (`t=<ts>,v1=<sig>,...`) against
 * the raw request body, the same way Stripe's own libraries do: HMAC-SHA256
 * over `${timestamp}.${body}`, compared in constant time, with a replay
 * window. Returns true only when a v1 signature matches and is fresh.
 */
export async function verifyStripeSignature(
  body: string,
  signatureHeader: string | null | undefined,
  secret: string,
  options: { toleranceSeconds?: number; nowMs?: number } = {},
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const tolerance = options.toleranceSeconds ?? 300;
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000);

  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key === 't') timestamp = value ?? null;
    else if (key === 'v1' && value) signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return false;

  const expected = await hmacHex(secret, `${timestamp}.${body}`);
  return signatures.some((candidate) => constantTimeEquals(candidate, expected));
}

/** Test/helper: produce the signature header Stripe would send for a body. */
export async function signStripePayload(
  body: string,
  secret: string,
  timestampSeconds: number,
): Promise<string> {
  const signature = await hmacHex(secret, `${timestampSeconds}.${body}`);
  return `t=${timestampSeconds},v1=${signature}`;
}
