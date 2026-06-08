import { describe, expect, it } from 'vitest';

import {
  contactLimitFor,
  isValidPlan,
  planSpec,
  signStripePayload,
  verifyStripeSignature,
  wouldExceedContactLimit,
} from '../src/billing';

describe('plan limits', () => {
  it('exposes per-plan contact caps, with UNLIMITED uncapped', () => {
    expect(contactLimitFor('FREE')).toBe(1_000);
    expect(contactLimitFor('PRO')).toBe(25_000);
    expect(contactLimitFor('UNLIMITED')).toBeNull();
  });

  it('decides when an import would exceed the cap', () => {
    expect(wouldExceedContactLimit('FREE', 999, 1)).toBe(false);
    expect(wouldExceedContactLimit('FREE', 1_000, 1)).toBe(true);
    expect(wouldExceedContactLimit('FREE', 500, 600)).toBe(true);
    // Unlimited never blocks.
    expect(wouldExceedContactLimit('UNLIMITED', 10_000_000, 1)).toBe(false);
  });

  it('validates plan strings', () => {
    expect(isValidPlan('PRO')).toBe(true);
    expect(isValidPlan('ENTERPRISE')).toBe(false);
  });

  it('exposes the full plan spec (limit + price)', () => {
    expect(planSpec('PRO')).toEqual({ contactLimit: 25_000, priceCents: 4900 });
  });
});

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' });

  it('accepts a fresh, correctly-signed payload', async () => {
    const ts = 1_000_000;
    const header = await signStripePayload(body, secret, ts);
    expect(await verifyStripeSignature(body, header, secret, { nowMs: ts * 1000 })).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const ts = 1_000_000;
    const header = await signStripePayload(body, secret, ts);
    expect(await verifyStripeSignature(body + 'x', header, secret, { nowMs: ts * 1000 })).toBe(
      false,
    );
  });

  it('rejects the wrong secret', async () => {
    const ts = 1_000_000;
    const header = await signStripePayload(body, secret, ts);
    expect(await verifyStripeSignature(body, header, 'whsec_other', { nowMs: ts * 1000 })).toBe(
      false,
    );
  });

  it('rejects a stale timestamp outside the tolerance (replay)', async () => {
    const ts = 1_000_000;
    const header = await signStripePayload(body, secret, ts);
    // 10 minutes later, default tolerance is 5 minutes.
    const later = (ts + 600) * 1000;
    expect(await verifyStripeSignature(body, header, secret, { nowMs: later })).toBe(false);
  });

  it('rejects malformed or empty headers', async () => {
    expect(await verifyStripeSignature(body, null, secret)).toBe(false);
    expect(await verifyStripeSignature(body, 'garbage', secret)).toBe(false);
    expect(await verifyStripeSignature(body, 't=1', secret, { nowMs: 1000 })).toBe(false);
    expect(await verifyStripeSignature(body, 'v1=abc', secret)).toBe(false);
  });

  it('accepts when any of several v1 signatures matches (key rotation)', async () => {
    const ts = 1_000_000;
    const good = await signStripePayload(body, secret, ts);
    const v1 = good.split('v1=')[1]!;
    const header = `t=${ts},v1=deadbeef,v1=${v1}`;
    expect(await verifyStripeSignature(body, header, secret, { nowMs: ts * 1000 })).toBe(true);
  });
});
