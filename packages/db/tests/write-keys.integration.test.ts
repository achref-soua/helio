import { execSync } from 'node:child_process';
import path from 'node:path';

import { newId } from '@helio/core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, forTenant, type PrismaClient } from '../src/index';

describe('write keys: RLS isolation and constraints', () => {
  let container: StartedPostgreSqlContainer;
  let admin: PrismaClient;
  let app: PrismaClient;

  const orgA = newId('org');
  const orgB = newId('org');
  const wsA = newId('ws');

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('helio_write_keys_test')
      .start();
    const adminUrl = container.getConnectionUri();
    execSync('pnpm exec prisma migrate deploy', {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl },
      stdio: 'pipe',
    });
    admin = createPrismaClient(adminUrl);
    const appUrl = new URL(adminUrl);
    appUrl.username = 'helio_app';
    appUrl.password = 'helio_app';
    app = createPrismaClient(appUrl.toString());

    await admin.organization.createMany({
      data: [
        { id: orgA, name: 'A', slug: 'wk-a' },
        { id: orgB, name: 'B', slug: 'wk-b' },
      ],
    });
    await admin.workspace.create({
      data: { id: wsA, organizationId: orgA, name: 'A', slug: 'main' },
    });
  });

  afterAll(async () => {
    await admin?.$disconnect();
    await app?.$disconnect();
    await container?.stop();
  });

  it('tenant-scoped clients cannot read or mint foreign keys', async () => {
    const tenantA = forTenant(app, orgA);
    const tenantB = forTenant(app, orgB);

    const created = await tenantA.writeKey.create({
      data: {
        id: newId('wkey'),
        organizationId: orgA,
        workspaceId: wsA,
        key: 'wk_test_aaaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'Browser',
      },
    });
    expect(await tenantB.writeKey.findMany()).toEqual([]);
    expect(await tenantB.writeKey.findUnique({ where: { id: created.id } })).toBeNull();

    await expect(
      tenantB.writeKey.create({
        data: {
          id: newId('wkey'),
          organizationId: orgA,
          workspaceId: wsA,
          key: 'wk_test_bbbbbbbbbbbbbbbbbbbbbbbbb',
          name: 'Forged',
        },
      }),
    ).rejects.toThrowError();
  });

  it('the admin connection resolves any key cross-tenant (ingest lookup path)', async () => {
    const resolved = await admin.writeKey.findUnique({
      where: { key: 'wk_test_aaaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    expect(resolved?.organizationId).toBe(orgA);
    expect(resolved?.workspaceId).toBe(wsA);
    expect(resolved?.revokedAt).toBeNull();
  });

  it('enforces global key uniqueness', async () => {
    await expect(
      forTenant(app, orgA).writeKey.create({
        data: {
          id: newId('wkey'),
          organizationId: orgA,
          workspaceId: wsA,
          key: 'wk_test_aaaaaaaaaaaaaaaaaaaaaaaaa',
          name: 'Duplicate',
        },
      }),
    ).rejects.toThrowError(/unique/i);
  });
});
