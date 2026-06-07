import type { PrismaClient } from '@helio/db';
import type { Redis } from 'ioredis';

/** Minimal Redis surface the gateway needs — satisfied by ioredis and mocks. */
export type RedisLike = Pick<Redis, 'incr' | 'expire' | 'get' | 'set' | 'ping' | 'ttl'>;

export interface GatewayDeps {
  prisma: PrismaClient;
  redis: RedisLike;
  bootstrapToken: string;
  rateLimit: { max: number; windowSeconds: number };
}

export interface GatewayVariables {
  requestId: string;
}

export type GatewayEnv = { Variables: GatewayVariables };
