import { createEnv } from '@helio/core';
import { z } from 'zod';

export const env = createEnv({
  INGEST_PORT: z.coerce.number().int().default(4100),
  /**
   * Admin connection: write-key resolution is a cross-tenant lookup by
   * nature (key → workspace), so it cannot run under the RLS app role.
   * The service touches only the write_key table — see ADR-0010.
   */
  DATABASE_ADMIN_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  KAFKA_BROKERS: z.string().min(1).default('localhost:19092'),
  EVENTS_TOPIC: z.string().min(1).default('helio.events.v1'),
  CLICKHOUSE_URL: z.string().min(1).default('http://localhost:8123'),
  CLICKHOUSE_USER: z.string().min(1).default('helio'),
  CLICKHOUSE_PASSWORD: z.string().min(1),
  CLICKHOUSE_DB: z.string().min(1).default('helio'),
  INGEST_RATE_LIMIT_MAX: z.coerce.number().int().default(600),
  INGEST_RATE_LIMIT_WINDOW_S: z.coerce.number().int().default(60),
  /** Run the ClickHouse sink consumer inside this process (single-box default). */
  INGEST_SINK_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type Env = typeof env;
