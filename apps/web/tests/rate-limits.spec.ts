import { expect, test } from '@playwright/test';

// Public-surface abuse damping: hammer the widget config endpoint until the
// fixed window closes. The probe uses its own (bogus) write key, and budgets
// are keyed by ip + key, so other specs hitting /api/widgets with the real
// demo key keep their full budget even inside the same minute.

test('the public widget endpoint throttles a hammering client', async ({ request }) => {
  const probe = '/api/widgets?key=wk_rate_limit_probe';

  let throttled = null;
  // The budget is 120/min; 260 attempts guarantee one window absorbs more
  // than the budget even when the loop straddles a window boundary.
  for (let attempt = 0; attempt < 260; attempt += 1) {
    const response = await request.get(probe);
    if (response.status() === 429) {
      throttled = response;
      break;
    }
    expect(response.status()).toBe(200);
  }

  expect(throttled, 'expected the probe to be throttled').not.toBeNull();
  const headers = throttled!.headers();
  expect(Number(headers['retry-after'])).toBeGreaterThan(0);
  expect(Number(headers['ratelimit-limit'])).toBeGreaterThan(0);
  // CORS must survive the 429 so an embedding page reads a clean error
  // instead of an opaque network failure.
  expect(headers['access-control-allow-origin']).toBe('*');
  expect(headers['cache-control']).toBe('no-store');

  // A different write key is a different budget — the throttle is scoped,
  // not global.
  const other = await request.get('/api/widgets?key=wk_rate_limit_other');
  expect(other.status()).toBe(200);
});
