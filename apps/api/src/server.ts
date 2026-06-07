/* eslint-disable no-console -- process entrypoint logs its bind address */
import { createPrismaClient } from '@helio/db';
import { serve } from '@hono/node-server';
import { Redis } from 'ioredis';

import { createApp } from './app';
import { env } from './env';
import { startTracing } from './observability';

await startTracing('helio-api');

const app = createApp({
  prisma: createPrismaClient(env.DATABASE_URL),
  redis: new Redis(env.REDIS_URL),
  bootstrapToken: env.API_BOOTSTRAP_TOKEN,
  rateLimit: { max: env.RATE_LIMIT_MAX, windowSeconds: env.RATE_LIMIT_WINDOW_S },
});

serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
  console.log(`helio api listening on :${info.port}`);
});
