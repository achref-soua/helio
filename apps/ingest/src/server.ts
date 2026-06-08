/* eslint-disable no-console -- process entrypoint logs its bind address */
import { KafkaEventProducer } from '@helio/bus';
import { newId } from '@helio/core';
import { createPrismaClient } from '@helio/db';
import { serve } from '@hono/node-server';
import { Redis } from 'ioredis';

import { createApp, logger } from './app';
import { applyClickHouseMigrations, createClickHouseClient } from './clickhouse';
import { env } from './env';
import { PrismaWriteKeyResolver } from './keys';
import { startTracing } from './observability';
import { ClickHouseSink } from './sink';

await startTracing('helio-ingest');

const brokers = env.KAFKA_BROKERS.split(',').map((broker) => broker.trim());
const producer = new KafkaEventProducer(brokers, env.EVENTS_TOPIC, 'helio-ingest');
await producer.connect();

const clickhouse = createClickHouseClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,
  database: env.CLICKHOUSE_DB,
});
const migrated = await applyClickHouseMigrations(clickhouse);
if (migrated.length > 0) console.log(`clickhouse migrations applied: ${migrated.join(', ')}`);

const prisma = createPrismaClient(env.DATABASE_ADMIN_URL);

const app = createApp({
  keys: new PrismaWriteKeyResolver(prisma),
  producer,
  pushStore: {
    async upsert(input) {
      // Resolve the contact by email (userId) within the workspace when
      // one is known, so journey push can target by audience.
      const contact = input.userId
        ? await prisma.contact.findUnique({
            where: { workspaceId_email: { workspaceId: input.workspaceId, email: input.userId } },
            select: { id: true },
          })
        : null;
      await prisma.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        update: { p256dh: input.p256dh, auth: input.auth, contactId: contact?.id ?? null },
        create: {
          id: newId('push'),
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          contactId: contact?.id ?? null,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
        },
      });
    },
  },
  redis: new Redis(env.REDIS_URL),
  rateLimit: { max: env.INGEST_RATE_LIMIT_MAX, windowSeconds: env.INGEST_RATE_LIMIT_WINDOW_S },
  readiness: {
    clickhouse: async () => {
      const ping = await clickhouse.ping();
      if (!ping.success) throw new Error('clickhouse not ready');
    },
  },
});

if (env.INGEST_SINK_ENABLED) {
  const sink = new ClickHouseSink(clickhouse, logger, { brokers, topic: env.EVENTS_TOPIC });
  sink.start().catch((error) => {
    logger.error({ error }, 'sink crashed');
    process.exitCode = 1;
  });
}

serve({ fetch: app.fetch, port: env.INGEST_PORT }, (info) => {
  console.log(`helio ingest listening on :${info.port}`);
});
