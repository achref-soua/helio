/* eslint-disable no-console -- process entrypoint logs its lifecycle */
import { registerShutdown } from '@helio/core';
import { createPrismaClient } from '@helio/db';
import { serve } from '@hono/node-server';
import { Redis } from 'ioredis';

import { createApp } from './app';
import { env } from './env';
import { startTracing } from './observability';

await startTracing('helio-api');

const prisma = createPrismaClient(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL);

const app = createApp({
  prisma,
  redis,
  rateLimit: { max: env.RATE_LIMIT_MAX, windowSeconds: env.RATE_LIMIT_WINDOW_S },
  stripe: env.STRIPE_WEBHOOK_SECRET
    ? {
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
        priceToPlan: {
          ...(env.STRIPE_PRICE_PRO ? { [env.STRIPE_PRICE_PRO]: 'PRO' as const } : {}),
          ...(env.STRIPE_PRICE_SCALE ? { [env.STRIPE_PRICE_SCALE]: 'SCALE' as const } : {}),
        },
      }
    : undefined,
  emailWebhook: env.EMAIL_WEBHOOK_TOKEN
    ? { token: env.EMAIL_WEBHOOK_TOKEN, fetch: (url) => fetch(url) }
    : undefined,
});

const server = serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
  console.log(`helio api listening on :${info.port}`);
});

registerShutdown({
  log: console.log,
  tasks: [
    {
      name: 'http',
      run: () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          if ('closeIdleConnections' in server) server.closeIdleConnections();
        }),
    },
    { name: 'postgres', run: () => prisma.$disconnect() },
    { name: 'redis', run: () => redis.quit() },
  ],
});
