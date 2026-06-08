# @helio/sdk-js

Helio's browser tracking SDK. Zero dependencies, ~2 kB of logic: queue,
batch, and deliver `track` / `identify` / `page` events to a Helio
ingestion endpoint, with `sendBeacon` flushing when the page goes away.

## Usage

```ts
import { HelioClient } from '@helio/sdk-js';

const helio = new HelioClient({
  writeKey: 'wk_…', // Workspace write key (Settings → Sources)
  host: 'https://ingest.your-helio.example',
});

helio.page('Pricing');
helio.track('Signed Up', { plan: 'pro' });
helio.identify('user-42', { email: 'ada@example.com' });
helio.reset(); // on logout
await helio.flush(); // usually unnecessary — batching handles it
```

## Behavior

- **Identity** — a per-browser `anonymousId` persists in localStorage
  (memory fallback when unavailable); `identify()` pins a `userId` that
  rides every later event until `reset()`.
- **Batching** — events flush at `flushAt` (default 20) or after
  `flushIntervalMs` (default 5 s), whichever comes first.
- **Page exit** — `pagehide`/`visibilitychange: hidden` flush via
  `navigator.sendBeacon` (the write key travels in the body, which the
  ingestion endpoint accepts precisely for this).
- **Failures** — 5xx and network errors requeue (capped at
  `maxQueueSize`, default 1000, oldest dropped); 4xx are permanent and
  the batch is discarded rather than retried forever.
- **SSR-safe** — every browser API is feature-checked; importing on the
  server is harmless.
