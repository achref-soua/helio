import { expect, test } from '@playwright/test';

// Response-header hardening: the dashboard refuses framing and ships a CSP,
// while the hosted (embeddable) surfaces relax exactly one directive —
// frame-ancestors — and keep everything else.

test('dashboard responses carry the security headers', async ({ request }) => {
  const response = await request.get('/login');
  const headers = response.headers();

  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toContain('camera=()');

  const csp = headers['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
});

test('hosted forms stay embeddable while keeping the rest of the policy', async ({ request }) => {
  // Any /f path gets the embeddable policy — the route resolving (or not)
  // is irrelevant to the header layer.
  const response = await request.get('/f/headers-probe');
  const csp = response.headers()['content-security-policy'] ?? '';

  expect(csp).toContain('frame-ancestors *');
  expect(csp).not.toContain("frame-ancestors 'none'");
  expect(csp).toContain("default-src 'self'");
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
});
