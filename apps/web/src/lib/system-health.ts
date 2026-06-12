import { connect } from 'node:net';

import { helioVersion } from '@helio/core';

import { getClickHouse } from './clickhouse';
import { appDb } from './db';
import { env } from './env';

/**
 * The admin health roll-up (G5): every sibling service's /healthz, plus
 * TCP reachability for the stores that don't speak HTTP. Checks run in
 * parallel with short timeouts — this page must render fast even when
 * half the stack is down, because that is exactly when it matters.
 */

export interface ServiceHealth {
  name: string;
  up: boolean;
  version: string | null;
  /** Services the core profile runs without (full-profile components). */
  optional: boolean;
}

async function httpHealth(name: string, url: string, optional: boolean): Promise<ServiceHealth> {
  try {
    const response = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return { name, up: false, version: null, optional };
    const body = (await response.json()) as { version?: string };
    return { name, up: true, version: body.version ?? null, optional };
  } catch {
    return { name, up: false, version: null, optional };
  }
}

function tcpReachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 1_500 });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function hostPort(value: string, defaultPort: number): { host: string; port: number } {
  try {
    const url = new URL(value.includes('://') ? value : `tcp://${value}`);
    return { host: url.hostname, port: url.port ? Number(url.port) : defaultPort };
  } catch {
    return { host: 'localhost', port: defaultPort };
  }
}

export async function collectSystemHealth(): Promise<{
  services: ServiceHealth[];
  stores: ServiceHealth[];
}> {
  const redis = hostPort(env.REDIS_URL, 6379);
  const temporal = hostPort(env.TEMPORAL_ADDRESS, 7233);

  const [api, ingest, tracking, intelligence, postgresUp, clickhouseUp, redisUp, temporalUp] =
    await Promise.all([
      httpHealth('api', env.API_URL, false),
      httpHealth('ingest', env.INGEST_URL, true),
      httpHealth('tracking', env.TRACKING_URL, true),
      httpHealth('intelligence', env.INTELLIGENCE_URL, false),
      appDb.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      getClickHouse()
        .ping()
        .then(
          (result) => result.success,
          () => false,
        ),
      tcpReachable(redis.host, redis.port),
      tcpReachable(temporal.host, temporal.port),
    ]);

  return {
    services: [
      { name: 'web', up: true, version: helioVersion(), optional: false },
      api,
      ingest,
      tracking,
      intelligence,
    ],
    stores: [
      { name: 'postgres', up: postgresUp, version: null, optional: false },
      { name: 'redis', up: redisUp, version: null, optional: false },
      { name: 'clickhouse', up: clickhouseUp, version: null, optional: true },
      { name: 'temporal', up: temporalUp, version: null, optional: true },
    ],
  };
}
