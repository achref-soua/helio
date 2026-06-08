/* eslint-disable no-console -- process entrypoint logs its bind address */
import { KafkaEventProducer } from '@helio/bus';
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

const app = createApp({
  keys: new PrismaWriteKeyResolver(createPrismaClient(env.DATABASE_ADMIN_URL)),
  producer,
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
