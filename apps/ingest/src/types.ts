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

export interface IngestDeps {
  keys: WriteKeyResolver;
  producer: EventBusProducer;
  redis: RedisLike;
  rateLimit: { max: number; windowSeconds: number };
  /** Extra /readyz probes (broker, ClickHouse) supplied by the entrypoint. */
  readiness?: Record<string, () => Promise<void>>;
  now?: () => Date;
}

export interface IngestVariables {
  requestId: string;
  writeKey: ResolvedWriteKey;
}

export type IngestEnv = { Variables: IngestVariables };
