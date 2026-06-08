import { type ClickHouseClient, createClient } from '@clickhouse/client';

import { env } from './env';

/**
 * Lazy ClickHouse client for analytics reads. The core compose profile
 * runs without ClickHouse, so analytics callers must treat failures as
 * "no data yet", never as a crash.
 */
const globalForClickHouse = globalThis as unknown as { chClient?: ClickHouseClient };

export function getClickHouse(): ClickHouseClient {
  globalForClickHouse.chClient ??= createClient({
    url: env.CLICKHOUSE_URL,
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
    database: env.CLICKHOUSE_DB,
    request_timeout: 5_000,
  });
  return globalForClickHouse.chClient;
}
