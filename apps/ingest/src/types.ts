import type { EventBusProducer } from '@helio/bus';
import type { Redis } from 'ioredis';

export type { EventBusProducer } from '@helio/bus';

/** Minimal Redis surface the service needs — satisfied by ioredis and mocks. */
export type RedisLike = Pick<Redis, 'incr' | 'expire' | 'ttl' | 'ping'>;

/** What the auth middleware needs to know about a write key. */
export interface ResolvedWriteKey {
  organizationId: string;
  workspaceId: string;
}

export interface WriteKeyResolver {
  resolve(key: string): Promise<ResolvedWriteKey | null>;
}

/** Persists a browser push subscription into the resolved workspace. */
export interface PushStore {
  upsert(input: {
    organizationId: string;
    workspaceId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userId?: string;
  }): Promise<void>;
}

export interface IngestDeps {
  keys: WriteKeyResolver;
  producer: EventBusProducer;
  redis: RedisLike;
  rateLimit: { max: number; windowSeconds: number };
  /** Optional Web Push subscription sink; absent in event-only deploys. */
  pushStore?: PushStore;
  /** Extra /readyz probes (broker, ClickHouse) supplied by the entrypoint. */
  readiness?: Record<string, () => Promise<void>>;
  now?: () => Date;
}

export interface IngestVariables {
  requestId: string;
  writeKey: ResolvedWriteKey;
}

export type IngestEnv = { Variables: IngestVariables };
