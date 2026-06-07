/* eslint-disable no-console -- operator-facing CLI script */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

// Standalone script: load the repo-root .env when present.
const rootEnv = path.resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

const { applyClickHouseMigrations, createClickHouseClient } = await import('../clickhouse');
const { env } = await import('../env');

const client = createClickHouseClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,
  database: env.CLICKHOUSE_DB,
});

const applied = await applyClickHouseMigrations(client);
console.log(
  applied.length > 0 ? `applied: ${applied.join(', ')}` : 'clickhouse schema is up to date',
);
await client.close();
