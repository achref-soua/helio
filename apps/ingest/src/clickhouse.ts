import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { type ClickHouseClient, createClient } from '@clickhouse/client';

export interface ClickHouseConfig {
  url: string;
  username: string;
  password: string;
  database: string;
}

export function createClickHouseClient(config: ClickHouseConfig): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    clickhouse_settings: {
      // The sink batches inserts itself; waiting keeps at-least-once honest.
      wait_end_of_query: 1,
      // Rows carry ISO 8601 timestamps ('Z' suffix); basic parsing rejects them.
      date_time_input_format: 'best_effort',
    },
  });
}

/** Locate clickhouse/ next to the bundle (container) or one level up (dev). */
function defaultMigrationsDir(): string {
  const candidates = [
    path.resolve(import.meta.dirname, 'clickhouse'),
    path.resolve(import.meta.dirname, '../clickhouse'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[1]!;
}

/**
 * Minimal forward-only migration runner. Each `clickhouse/*.sql` file
 * holds exactly one statement and is applied in filename order; applied
 * names are recorded in `_ch_migrations`.
 */
export async function applyClickHouseMigrations(
  client: ClickHouseClient,
  dir = defaultMigrationsDir(),
): Promise<string[]> {
  await client.command({
    query: `CREATE TABLE IF NOT EXISTS _ch_migrations (
      name String,
      applied_at DateTime DEFAULT now()
    ) ENGINE = MergeTree ORDER BY name`,
  });

  const appliedResult = await client.query({
    query: 'SELECT name FROM _ch_migrations',
    format: 'JSONEachRow',
  });
  const applied = new Set(
    ((await appliedResult.json()) as Array<{ name: string }>).map((row) => row.name),
  );

  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const query = await readFile(path.join(dir, file), 'utf8');
    await client.command({ query });
    await client.insert({
      table: '_ch_migrations',
      values: [{ name: file }],
      format: 'JSONEachRow',
    });
    newlyApplied.push(file);
  }
  return newlyApplied;
}
