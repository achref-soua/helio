import { check } from 'k6';
import http from 'k6/http';
import { Counter, Rate } from 'k6/metrics';

/**
 * Ingestion load test (README §7 target: sustained ≥ 5k events/s on a
 * modest box). Drives the same /v1/batch endpoint the browser SDK uses,
 * with realistic 10-event batches.
 *
 *   task up:full && pnpm --filter @helio/ingest dev
 *   task db:seed   # provisions the demo write key
 *   k6 run infra/k6/ingest.js
 *
 * Tunables (env): INGEST_URL, WRITE_KEY, BATCH_SIZE, RATE (batches/s),
 * VUS, DURATION.
 */
const INGEST_URL = __ENV.INGEST_URL || 'http://localhost:4100';
const WRITE_KEY = __ENV.WRITE_KEY || 'wk_demo_0000000000000000000000000';
const BATCH_SIZE = Number(__ENV.BATCH_SIZE || 10);
const RATE = Number(__ENV.RATE || 600); // 600 batches/s × 10 = 6k events/s
const VUS = Number(__ENV.VUS || 200);
const DURATION = __ENV.DURATION || '1m';

const accepted = new Counter('events_accepted');
const acceptRate = new Rate('batch_accepted');

export const options = {
  scenarios: {
    firehose: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: VUS,
      maxVUs: VUS * 2,
    },
  },
  thresholds: {
    // README budget: ingestion accepts the firehose with low latency.
    http_req_duration: ['p(95)<150'],
    batch_accepted: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
  },
};

const EVENTS = ['Page Viewed', 'Product Viewed', 'Added To Cart', 'Signed Up', 'Checkout Started'];

export default function () {
  const batch = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    const anonymousId = `vu-${__VU}-${Math.floor(Math.random() * 100000)}`;
    batch.push({
      type: 'track',
      event: EVENTS[Math.floor(Math.random() * EVENTS.length)],
      anonymousId,
      properties: { price: Math.floor(Math.random() * 200), sku: `SKU-${__ITER % 50}` },
    });
  }

  const response = http.post(`${INGEST_URL}/v1/batch`, JSON.stringify({ batch }), {
    headers: { 'Content-Type': 'application/json', 'X-Write-Key': WRITE_KEY },
  });

  const ok = check(response, { 'status is 202': (r) => r.status === 202 });
  acceptRate.add(ok);
  if (ok) accepted.add(BATCH_SIZE);
}
