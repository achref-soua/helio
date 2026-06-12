import type { PrismaClient } from '@helio/db';
import type { Redis } from 'ioredis';

/** Minimal Redis surface the gateway needs — satisfied by ioredis and mocks. */
export type RedisLike = Pick<Redis, 'incr' | 'expire' | 'get' | 'set' | 'ping' | 'ttl'>;

/** Bounce/complaint webhook config; absent disables the endpoint (404). */
export interface EmailWebhookConfig {
  /** Shared secret carried as `?token=` on the webhook URL. */
  token: string;
  /** Outbound fetch confirming SNS subscriptions — injectable for tests. */
  fetch: (url: string) => Promise<unknown>;
}

export interface GatewayDeps {
  prisma: PrismaClient;
  redis: RedisLike;
  rateLimit: { max: number; windowSeconds: number };
  emailWebhook?: EmailWebhookConfig;
  /** Twilio delivery-status callback config; absent disables it (404). */
  smsWebhook?: { token: string };
  /** Deployment encryption key(s) for sealed integration secrets. */
  vault?: { key: string; previousKey?: string };
}

export interface GatewayVariables {
  requestId: string;
  /** The organization resolved from the API key; set by apiKeyAuth on /v1. */
  organizationId: string;
  /** The presenting API key's grants (M2). */
  scopes: string[];
}

export type GatewayEnv = { Variables: GatewayVariables };
