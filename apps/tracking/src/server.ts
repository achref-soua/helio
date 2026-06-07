/* eslint-disable no-console -- process entrypoint logs its bind address */
import { createPrismaClient } from '@helio/db';
import { serve } from '@hono/node-server';

import { createApp } from './app';
import { KafkaEventProducer } from './bus';
import { env } from './env';
import { startTracing } from './observability';
import { PrismaSendResolver } from './sends';

await startTracing('helio-tracking');

const brokers = env.KAFKA_BROKERS.split(',').map((broker) => broker.trim());
const producer = new KafkaEventProducer(brokers, env.EVENTS_TOPIC);
await producer.connect();

const prisma = createPrismaClient(env.DATABASE_ADMIN_URL);

const app = createApp({
  sends: new PrismaSendResolver(prisma),
  producer,
  secret: env.TRACKING_SECRET,
  readiness: {
    database: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
  },
});

serve({ fetch: app.fetch, port: env.TRACKING_PORT }, (info) => {
  console.log(`helio tracking listening on :${info.port}`);
});
