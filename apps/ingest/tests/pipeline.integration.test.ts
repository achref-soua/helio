import { execSync } from 'node:child_process';
import path from 'node:path';

import type { ClickHouseClient } from '@clickhouse/client';
import { newId } from '@helio/core';
import { createPrismaClient, type PrismaClient } from '@helio/db';
import { ClickHouseContainer, type StartedClickHouseContainer } from '@testcontainers/clickhouse';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedpandaContainer, type StartedRedpandaContainer } from '@testcontainers/redpanda';
import RedisMock from 'ioredis-mock';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { KafkaEventProducer } from '../src/bus';
import { applyClickHouseMigrations, createClickHouseClient } from '../src/clickhouse';
import { PrismaWriteKeyResolver } from '../src/keys';
import { ClickHouseSink } from '../src/sink';
import type { RedisLike } from '../src/types';

const TOPIC = 'helio.events.test';
const WRITE_KEY = 'wk_pipeline_aaaaaaaaaaaaaaaaaaaa';

/**
 * Full-path test: HTTP batch → write-key auth against Postgres →
 * Redpanda → sink consumer → rows queryable in ClickHouse.
 */
describe('ingestion pipeline (Redpanda + ClickHouse + Postgres)', () => {
  let redpanda: StartedRedpandaContainer;
  let clickhouseContainer: StartedClickHouseContainer;
  let postgres: StartedPostgreSqlContainer;
  let clickhouse: ClickHouseClient;
  let admin: PrismaClient;
  let producer: KafkaEventProducer;
  let sink: ClickHouseSink;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    [redpanda, clickhouseContainer, postgres] = await Promise.all([
      new RedpandaContainer('redpandadata/redpanda:v24.3.1').start(),
      new ClickHouseContainer('clickhouse/clickhouse-server:24.12').start(),
      new PostgreSqlContainer('pgvector/pgvector:pg16').withDatabase('helio_ingest_test').start(),
    ]);

    // Postgres: schema + a workspace with an active write key.
    const adminUrl = postgres.getConnectionUri();
    execSync('pnpm --filter @helio/db exec prisma migrate deploy', {
      cwd: path.resolve(import.meta.dirname, '../../..'),
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl },
      stdio: 'pipe',
    });
    admin = createPrismaClient(adminUrl);
    const orgId = newId('org');
    const wsId = newId('ws');
    await admin.organization.create({ data: { id: orgId, name: 'P', slug: 'pipeline' } });
    await admin.workspace.create({
      data: { id: wsId, organizationId: orgId, name: 'P', slug: 'main' },
    });
    await admin.writeKey.create({
      data: {
        id: newId('wkey'),
        organizationId: orgId,
        workspaceId: wsId,
        key: WRITE_KEY,
        name: 'Pipeline test',
      },
    });

    // ClickHouse: apply migrations (idempotency asserted in a test below).
    clickhouse = createClickHouseClient({
      url: clickhouseContainer.getHttpUrl(),
      username: clickhouseContainer.getUsername(),
      password: clickhouseContainer.getPassword(),
      database: clickhouseContainer.getDatabase(),
    });
    await applyClickHouseMigrations(clickhouse);

    // Bus: real producer + sink against the disposable broker.
    const brokers = [redpanda.getBootstrapServers()];
    producer = new KafkaEventProducer(brokers, TOPIC);
    await producer.connect();
    sink = new ClickHouseSink(clickhouse, pino({ level: 'silent' }), { brokers, topic: TOPIC });
    await sink.start();

    app = createApp({
      keys: new PrismaWriteKeyResolver(admin),
      producer,
      redis: new RedisMock() as unknown as RedisLike,
      rateLimit: { max: 1000, windowSeconds: 60 },
    });
  });

  afterAll(async () => {
    await sink?.stop();
    await producer?.disconnect();
    await clickhouse?.close();
    await admin?.$disconnect();
    await Promise.all([redpanda?.stop(), clickhouseContainer?.stop(), postgres?.stop()]);
  });

  it('applies ClickHouse migrations idempotently', async () => {
    expect(await applyClickHouseMigrations(clickhouse)).toEqual([]);
  });

  it('lands an accepted batch in ClickHouse with tenancy stamped', async () => {
    const response = await app.request('/v1/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-write-key': WRITE_KEY },
      body: JSON.stringify({
        batch: [
          {
            type: 'track',
            event: 'Pipeline Tested',
            anonymousId: 'anon-pipe',
            messageId: 'msg-pipe-1',
            properties: { ok: true },
          },
          { type: 'page', name: 'Docs', anonymousId: 'anon-pipe' },
        ],
      }),
    });
    expect(response.status).toBe(202);

    // The sink commits after insert; poll until both rows are queryable.
    const rows = await pollForRows(clickhouse, 2);
    const track = rows.find((row) => row.type === 'track');
    expect(track).toMatchObject({
      message_id: 'msg-pipe-1',
      event: 'Pipeline Tested',
      anonymous_id: 'anon-pipe',
      properties: '{"ok":true}',
    });
    expect(track!.workspace_id).toMatch(/^ws_/);
    expect(track!.organization_id).toMatch(/^org_/);
  });

  it('rejects an unknown write key against the real lookup', async () => {
    const response = await app.request('/v1/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-write-key': 'wk_wrong' },
      body: JSON.stringify({ batch: [{ type: 'track', event: 'X', anonymousId: 'a' }] }),
    });
    expect(response.status).toBe(401);
  });
});

interface EventRow {
  type: string;
  event: string;
  message_id: string;
  anonymous_id: string;
  properties: string;
  workspace_id: string;
  organization_id: string;
}

async function pollForRows(client: ClickHouseClient, minimum: number): Promise<EventRow[]> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const result = await client.query({ query: 'SELECT * FROM events', format: 'JSONEachRow' });
    const rows = (await result.json()) as EventRow[];
    if (rows.length >= minimum) return rows;
    if (Date.now() > deadline) {
      throw new Error(`expected ${minimum} rows in ClickHouse, saw ${rows.length}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
