/**
 * Helio browser tracking client. Zero dependencies; safe to import in
 * SSR code (every browser API is feature-checked). Events queue locally
 * and flush as batches to the ingestion service.
 */

export interface HelioClientOptions {
  /** Workspace write key (public-ish: only grants event appends). */
  writeKey: string;
  /** Ingestion origin, e.g. https://ingest.example.com */
  host: string;
  /** Flush when this many events are queued. Default 20. */
  flushAt?: number;
  /** Flush at least this often while events are queued (ms). Default 5000. */
  flushIntervalMs?: number;
  /** Queue hard cap; oldest events drop beyond it. Default 1000. */
  maxQueueSize?: number;
}

interface QueuedEvent {
  type: 'track' | 'identify' | 'page';
  event?: string;
  name?: string;
  properties?: Record<string, unknown>;
  traits?: Record<string, unknown>;
  messageId: string;
  anonymousId?: string;
  userId?: string;
  timestamp: string;
  context: Record<string, unknown>;
}

export const SDK_NAME = '@helio/sdk-js';
export const SDK_VERSION = '0.1.0';

const ANONYMOUS_ID_KEY = 'helio_anonymous_id';
const USER_ID_KEY = 'helio_user_id';

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** localStorage that degrades to memory (private mode, SSR, quota). */
function createStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (hasWindow() && window.localStorage) {
      const probe = '__helio_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, value),
    removeItem: (key) => void memory.delete(key),
  };
}

export class HelioClient {
  private readonly options: Required<HelioClientOptions>;
  private readonly storage = createStorage();
  private queue: QueuedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> = Promise.resolve();

  constructor(options: HelioClientOptions) {
    if (!options.writeKey) throw new Error('HelioClient: writeKey is required');
    if (!options.host) throw new Error('HelioClient: host is required');
    this.options = {
      flushAt: 20,
      flushIntervalMs: 5_000,
      maxQueueSize: 1_000,
      ...options,
      host: options.host.replace(/\/+$/, ''),
    };

    if (hasWindow()) {
      // pagehide/hidden are the only reliable unload signals; sendBeacon
      // survives the page teardown where fetch would be cancelled.
      const flushNow = () => this.flushWithBeacon();
      window.addEventListener('pagehide', flushNow);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushNow();
      });
    }
  }

  /** Stable per-browser anonymous identity. */
  anonymousId(): string {
    let id = this.storage.getItem(ANONYMOUS_ID_KEY);
    if (!id) {
      id = randomId();
      this.storage.setItem(ANONYMOUS_ID_KEY, id);
    }
    return id;
  }

  /** The identified user id, when identify() has been called. */
  userId(): string | null {
    return this.storage.getItem(USER_ID_KEY);
  }

  track(event: string, properties?: Record<string, unknown>): void {
    this.enqueue({ type: 'track', event, properties });
  }

  identify(userId: string, traits?: Record<string, unknown>): void {
    this.storage.setItem(USER_ID_KEY, userId);
    this.enqueue({ type: 'identify', userId, traits });
  }

  page(name?: string, properties?: Record<string, unknown>): void {
    this.enqueue({ type: 'page', name, properties });
  }

  /** Forget identity (logout) without losing the device's anonymous id. */
  reset(): void {
    this.storage.removeItem(USER_ID_KEY);
  }

  /** Send everything queued; resolves when the request settles. */
  flush(): Promise<void> {
    const batch = this.takeBatch();
    if (batch.length === 0) return this.inflight;
    // Serialize sends so batches arrive in order.
    this.inflight = this.inflight.then(() => this.send(batch));
    return this.inflight;
  }

  private enqueue(
    partial: Pick<QueuedEvent, 'type' | 'event' | 'name' | 'properties' | 'traits'> & {
      userId?: string;
    },
  ): void {
    const event: QueuedEvent = {
      ...partial,
      messageId: `sdk-${randomId()}`,
      anonymousId: this.anonymousId(),
      userId: partial.userId ?? this.userId() ?? undefined,
      timestamp: new Date().toISOString(),
      context: this.buildContext(),
    };
    this.queue.push(event);
    if (this.queue.length > this.options.maxQueueSize) {
      this.queue = this.queue.slice(-this.options.maxQueueSize);
    }
    if (this.queue.length >= this.options.flushAt) {
      void this.flush();
      return;
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.options.flushIntervalMs);
  }

  private takeBatch(): QueuedEvent[] {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const batch = this.queue;
    this.queue = [];
    return batch;
  }

  private buildContext(): Record<string, unknown> {
    const context: Record<string, unknown> = {
      library: { name: SDK_NAME, version: SDK_VERSION },
    };
    if (hasWindow()) {
      context.page = {
        url: window.location.href,
        path: window.location.pathname,
        title: document.title,
        referrer: document.referrer,
      };
      context.userAgent = navigator.userAgent;
      context.locale = navigator.language;
      try {
        context.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        /* unsupported runtime */
      }
    }
    return context;
  }

  private payload(batch: QueuedEvent[]): string {
    return JSON.stringify({
      batch,
      sentAt: new Date().toISOString(),
      writeKey: this.options.writeKey,
    });
  }

  private async send(batch: QueuedEvent[]): Promise<void> {
    try {
      const response = await fetch(`${this.options.host}/v1/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: this.payload(batch),
        keepalive: batch.length <= 20,
      });
      // Client errors are permanent (bad key, invalid payload): drop, don't loop.
      if (response.status >= 500) this.requeue(batch);
    } catch {
      this.requeue(batch);
    }
  }

  private requeue(batch: QueuedEvent[]): void {
    this.queue = [...batch, ...this.queue].slice(0, this.options.maxQueueSize);
    this.scheduleFlush();
  }

  private flushWithBeacon(): void {
    const batch = this.takeBatch();
    if (batch.length === 0) return;
    const body = this.payload(batch);
    if (hasWindow() && typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(
        `${this.options.host}/v1/batch`,
        new Blob([body], { type: 'application/json' }),
      );
      if (ok) return;
    }
    // Beacon unavailable or refused the payload: best-effort keepalive fetch.
    void fetch(`${this.options.host}/v1/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      /* page is going away; nothing left to do */
    });
  }
}
