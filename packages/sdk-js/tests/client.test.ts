import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HelioClient, SDK_NAME } from '../src/client';

const HOST = 'https://ingest.test';

interface SentBatch {
  batch: Array<Record<string, unknown>>;
  sentAt: string;
  writeKey: string;
}

function lastBody(fetchMock: ReturnType<typeof vi.fn>): SentBatch {
  const call = fetchMock.mock.calls.at(-1)!;
  return JSON.parse((call[1] as RequestInit).body as string) as SentBatch;
}

describe('HelioClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function makeClient(overrides: Partial<ConstructorParameters<typeof HelioClient>[0]> = {}) {
    return new HelioClient({ writeKey: 'wk_test', host: `${HOST}/`, ...overrides });
  }

  it('requires writeKey and host', () => {
    expect(() => new HelioClient({ writeKey: '', host: HOST })).toThrowError(/writeKey/);
    expect(() => new HelioClient({ writeKey: 'wk', host: '' })).toThrowError(/host/);
  });

  it('keeps a stable anonymous id across instances', () => {
    const first = makeClient().anonymousId();
    const second = makeClient().anonymousId();
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(8);
  });

  it('flushes on the batch-size threshold with enriched events', async () => {
    const client = makeClient({ flushAt: 2 });
    client.track('First', { n: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    client.track('Second');
    await client.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${HOST}/v1/batch`);
    expect((init as RequestInit).method).toBe('POST');

    const body = lastBody(fetchMock);
    expect(body.writeKey).toBe('wk_test');
    expect(body.batch).toHaveLength(2);
    const event = body.batch[0]!;
    expect(event).toMatchObject({ type: 'track', event: 'First', properties: { n: 1 } });
    expect(event.anonymousId).toBeTruthy();
    expect(String(event.messageId)).toMatch(/^sdk-/);
    expect((event.context as { library: { name: string } }).library.name).toBe(SDK_NAME);
    expect((event.context as { page: { path: string } }).page.path).toBeDefined();
  });

  it('flushes on the interval timer', async () => {
    const client = makeClient({ flushIntervalMs: 5_000 });
    client.track('Patient Event');
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    void client;
  });

  it('identify persists the user id onto subsequent events', async () => {
    const client = makeClient();
    client.identify('user-42', { plan: 'pro' });
    client.track('After Identify');
    await client.flush();

    const body = lastBody(fetchMock);
    expect(body.batch[0]).toMatchObject({
      type: 'identify',
      userId: 'user-42',
      traits: { plan: 'pro' },
    });
    expect(body.batch[1]).toMatchObject({ type: 'track', userId: 'user-42' });

    client.reset();
    client.track('After Reset');
    await client.flush();
    expect(lastBody(fetchMock).batch[0]!.userId).toBeUndefined();
  });

  it('page captures the page name', async () => {
    const client = makeClient();
    client.page('Pricing', { experiment: 'b' });
    await client.flush();
    expect(lastBody(fetchMock).batch[0]).toMatchObject({
      type: 'page',
      name: 'Pricing',
      properties: { experiment: 'b' },
    });
  });

  it('requeues on server errors and network failures, drops on client errors', async () => {
    const client = makeClient();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    client.track('Retry Me');
    await client.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The 503 batch went back on the queue; the next flush resends it.
    await client.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastBody(fetchMock).batch[0]).toMatchObject({ event: 'Retry Me' });

    // 401 is permanent: nothing requeued.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    client.track('Dropped');
    await client.flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await client.flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('caps the queue at maxQueueSize, dropping the oldest', async () => {
    const client = makeClient({ maxQueueSize: 3, flushAt: 100 });
    for (let i = 1; i <= 5; i++) client.track(`E${i}`);
    await client.flush();
    const names = lastBody(fetchMock).batch.map((event) => event.event);
    expect(names).toEqual(['E3', 'E4', 'E5']);
  });

  it('uses sendBeacon when the page hides', () => {
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const client = makeClient();
    client.track('Goodbye');
    window.dispatchEvent(new Event('pagehide'));

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const [url, blob] = beacon.mock.calls[0]!;
    expect(url).toBe(`${HOST}/v1/batch`);
    expect(blob).toBeInstanceOf(Blob);
    void client;
  });
});

describe('HelioClient fallbacks', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('falls back to memory identity when localStorage throws', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked (private mode)');
      },
    });
    try {
      const client = new HelioClient({ writeKey: 'wk', host: 'https://ingest.test' });
      const id = client.anonymousId();
      expect(id).toBe(client.anonymousId()); // stable within the instance
      client.identify('user-9');
      expect(client.userId()).toBe('user-9');
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });

  it('generates ids without crypto.randomUUID', () => {
    const original = globalThis.crypto;
    vi.stubGlobal('crypto', {});
    try {
      const client = new HelioClient({ writeKey: 'wk', host: 'https://ingest.test' });
      expect(client.anonymousId()).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    } finally {
      vi.stubGlobal('crypto', original);
    }
  });

  it('falls back to a keepalive fetch when sendBeacon refuses the payload', () => {
    const beacon = vi.fn().mockReturnValue(false); // refused
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const client = new HelioClient({ writeKey: 'wk', host: 'https://ingest.test' });
    client.track('Goodbye');
    window.dispatchEvent(new Event('pagehide'));

    // A refused beacon must fall through to a keepalive fetch carrying
    // this client's batch. (jsdom shares window, so other clients'
    // pagehide listeners may also fire — assert behavior, not counts.)
    expect(beacon).toHaveBeenCalled();
    const keepaliveCall = fetchMock.mock.calls.find(
      (call) =>
        (call[1] as RequestInit)?.keepalive === true &&
        String((call[1] as RequestInit)?.body).includes('Goodbye'),
    );
    expect(keepaliveCall).toBeDefined();
  });

  it('flushes the queue on visibilitychange → hidden', () => {
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const client = new HelioClient({ writeKey: 'wk', host: 'https://ingest.test' });
    client.track('Bye');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(beacon).toHaveBeenCalled();
    const sentBye = beacon.mock.calls.some((call) => {
      const blob = call[1] as Blob | undefined;
      return blob instanceof Blob;
    });
    expect(sentBye).toBe(true);
    // Restore so later tests see a default visibility.
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
});
