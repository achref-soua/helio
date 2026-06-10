import type { Plan } from '@helio/core';
import type { PrismaClient } from '@helio/db';
import type { Redis } from 'ioredis';

/** Minimal Redis surface the gateway needs — satisfied by ioredis and mocks. */
export type RedisLike = Pick<Redis, 'incr' | 'expire' | 'get' | 'set' | 'ping' | 'ttl'>;

/** Stripe billing config; absent on self-hosted/unbilled deployments. */
export interface StripeConfig {
  webhookSecret: string;
  /** Stripe price id → Helio plan, for subscription events. */
  priceToPlan: Record<string, Plan>;
}

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
  stripe?: StripeConfig;
  emailWebhook?: EmailWebhookConfig;
}

export interface GatewayVariables {
  requestId: string;
  /** The organization resolved from the API key; set by apiKeyAuth on /v1. */
  organizationId: string;
}

export type GatewayEnv = { Variables: GatewayVariables };
