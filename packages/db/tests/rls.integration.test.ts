import { execSync } from 'node:child_process';
import path from 'node:path';

import { newId } from '@helio/core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, forTenant, type PrismaClient } from '../src/index';

/**
 * Proves tenant isolation is enforced by Postgres RLS itself:
 * the app role cannot read or write across organizations, with or without
 * cooperative query filters.
 */
describe('row-level security tenant isolation', () => {
  let container: StartedPostgreSqlContainer;
  let admin: PrismaClient;
  let app: PrismaClient;

  const orgA = { id: newId('org'), name: 'Org A', slug: 'org-a' };
  const orgB = { id: newId('org'), name: 'Org B', slug: 'org-b' };
  let workspaceA: string;
  let workspaceB: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('helio_test')
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

    await admin.organization.createMany({ data: [orgA, orgB] });
    workspaceA = newId('ws');
    workspaceB = newId('ws');
    await admin.workspace.createMany({
      data: [
        { id: workspaceA, organizationId: orgA.id, name: 'A Main', slug: 'main' },
        { id: workspaceB, organizationId: orgB.id, name: 'B Main', slug: 'main' },
      ],
    });
  });

  afterAll(async () => {
    await admin?.$disconnect();
    await app?.$disconnect();
    await container?.stop();
  });

  it('admin (BYPASSRLS) sees every tenant — sanity baseline', async () => {
    expect(await admin.workspace.count()).toBe(2);
  });

  it('app role without a tenant context sees nothing', async () => {
    expect(await app.workspace.findMany()).toEqual([]);
    expect(await app.organization.findMany()).toEqual([]);
  });

  it('tenant-scoped client sees only its own rows', async () => {
    const tenantA = forTenant(app, orgA.id);
    const workspaces = await tenantA.workspace.findMany();
    expect(workspaces.map((w) => w.id)).toEqual([workspaceA]);

    const tenantB = forTenant(app, orgB.id);
    expect((await tenantB.workspace.findMany()).map((w) => w.id)).toEqual([workspaceB]);
  });

  it('tenant-scoped client cannot read another tenant even by direct id', async () => {
    const tenantA = forTenant(app, orgA.id);
    expect(await tenantA.workspace.findUnique({ where: { id: workspaceB } })).toBeNull();
  });

  it('tenant-scoped client cannot write rows into another tenant', async () => {
    const tenantA = forTenant(app, orgA.id);
    await expect(
      tenantA.workspace.create({
        data: { id: newId('ws'), organizationId: orgB.id, name: 'Smuggled', slug: 'smuggled' },
      }),
    ).rejects.toThrowError(/row-level security|denied/i);
    expect(await admin.workspace.count({ where: { organizationId: orgB.id } })).toBe(1);
  });

  it('tenant-scoped client cannot update or delete foreign rows', async () => {
    const tenantA = forTenant(app, orgA.id);
    // RLS filters the target row out, so Prisma reports "not found".
    await expect(
      tenantA.workspace.update({ where: { id: workspaceB }, data: { name: 'Hijacked' } }),
    ).rejects.toThrowError();
    await expect(tenantA.workspace.delete({ where: { id: workspaceB } })).rejects.toThrowError();

    const untouched = await admin.workspace.findUnique({ where: { id: workspaceB } });
    expect(untouched?.name).toBe('B Main');
  });

  it('audit log rows are tenant-isolated too', async () => {
    await forTenant(app, orgA.id).auditLog.create({
      data: { id: newId('audit'), organizationId: orgA.id, action: 'test.write' },
    });
    expect(await forTenant(app, orgB.id).auditLog.count()).toBe(0);
    expect(await forTenant(app, orgA.id).auditLog.count()).toBe(1);
  });

  it('CRM pipelines, stages, and deals are tenant-isolated', async () => {
    const tenantA = forTenant(app, orgA.id);
    const pipelineId = newId('pipe');
    const stageId = newId('stg');
    await tenantA.pipeline.create({
      data: {
        id: pipelineId,
        organizationId: orgA.id,
        workspaceId: workspaceA,
        name: 'New business',
        stages: {
          create: [
            {
              id: stageId,
              organizationId: orgA.id,
              workspaceId: workspaceA,
              name: 'Lead',
              position: 0,
            },
          ],
        },
      },
    });
    await tenantA.deal.create({
      data: {
        id: newId('deal'),
        organizationId: orgA.id,
        workspaceId: workspaceA,
        pipelineId,
        stageId,
        title: 'Big contract',
        valueCents: 500000,
      },
    });

    // Org B sees none of it, even by direct id.
    const tenantB = forTenant(app, orgB.id);
    expect(await tenantB.pipeline.count()).toBe(0);
    expect(await tenantB.deal.count()).toBe(0);
    expect(await tenantB.pipeline.findUnique({ where: { id: pipelineId } })).toBeNull();

    // Org B cannot smuggle a deal into Org A's pipeline.
    await expect(
      tenantB.deal.create({
        data: {
          id: newId('deal'),
          organizationId: orgA.id,
          workspaceId: workspaceA,
          pipelineId,
          stageId,
          title: 'Smuggled',
        },
      }),
    ).rejects.toThrowError(/row-level security|denied/i);

    expect(await tenantA.deal.count()).toBe(1);
  });

  it('subscriptions are tenant-isolated', async () => {
    await forTenant(app, orgA.id).subscription.create({
      data: { id: newId('sub'), organizationId: orgA.id, plan: 'PRO' },
    });
    expect(await forTenant(app, orgB.id).subscription.count()).toBe(0);
    const mine = await forTenant(app, orgA.id).subscription.findUnique({
      where: { organizationId: orgA.id },
    });
    expect(mine?.plan).toBe('PRO');
  });
});
