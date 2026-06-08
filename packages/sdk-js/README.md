# @helio/sdk-js

Helio's JS/TS SDK. Two zero-dependency clients:

- **`@helio/sdk-js`** — the browser tracking client (`track` / `identify` /
  `page`), below.
- **`@helio/sdk-js/rest`** — a typed client for the public REST API (manage
  contacts, lists, and workspaces server-side), [further down](#rest-api-client).

## Browser tracking

Zero dependencies, ~2 kB of logic: queue, batch, and deliver events to a
Helio ingestion endpoint, with `sendBeacon` flushing when the page goes away.

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

## REST API client

A typed wrapper over the public gateway. The types are generated from the
gateway's OpenAPI document (`pnpm --filter @helio/sdk-js generate`, kept in
sync by a test), so the client always matches the live contract. Runs
anywhere `fetch` exists; the API key grants full org access, so use it
**server-side only**.

```ts
import { HelioApiClient, HelioApiError } from '@helio/sdk-js/rest';

const helio = new HelioApiClient({
  apiKey: process.env.HELIO_API_KEY!, // hk_<org>.<secret> from Settings → API keys
  baseUrl: 'https://api.your-helio.example',
});

const contact = await helio.contacts.create(
  { workspaceId: 'ws_…', email: 'jane@example.com', firstName: 'Jane' },
  { idempotencyKey: crypto.randomUUID() },
);

const list = await helio.lists.create({ workspaceId: 'ws_…', name: 'VIPs' });
await helio.lists.addMembers(list.id, [contact.id]);

// Cursor pagination.
let cursor: string | null = null;
do {
  const page = await helio.contacts.list({ workspaceId: 'ws_…', cursor: cursor ?? undefined });
  for (const c of page.data) console.log(c.email);
  cursor = page.nextCursor;
} while (cursor);

try {
  await helio.contacts.get('contact_missing');
} catch (error) {
  if (error instanceof HelioApiError) console.error(error.status, error.type, error.detail);
}
```

Resources: `workspaces` (list/create), `contacts` (list/create/get/update/delete),
`lists` (list/create/get/delete/addMembers/removeMember). Every non-2xx
response throws a `HelioApiError` carrying the RFC 9457 problem document.
