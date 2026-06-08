import { execSync } from 'node:child_process';
import path from 'node:path';

import { newId } from '@helio/core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, forTenant, type PrismaClient } from '../src/index';

describe('contacts: RLS isolation and constraints', () => {
  let container: StartedPostgreSqlContainer;
  let admin: PrismaClient;
  let app: PrismaClient;

  const orgA = newId('org');
  const orgB = newId('org');
  const wsA = newId('ws');
  const wsB = newId('ws');

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('helio_contacts_test')
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
        { id: orgA, name: 'A', slug: 'ct-a' },
        { id: orgB, name: 'B', slug: 'ct-b' },
      ],
    });
    await admin.workspace.createMany({
      data: [
        { id: wsA, organizationId: orgA, name: 'A', slug: 'main' },
        { id: wsB, organizationId: orgB, name: 'B', slug: 'main' },
      ],
    });
  });

  afterAll(async () => {
    await admin?.$disconnect();
    await app?.$disconnect();
    await container?.stop();
  });

  it('tenant-scoped clients cannot see or create foreign contacts', async () => {
    const tenantA = forTenant(app, orgA);
    const tenantB = forTenant(app, orgB);

    const contact = await tenantA.contact.create({
      data: { id: newId('contact'), organizationId: orgA, workspaceId: wsA, email: 'a@x.com' },
    });
    expect(await tenantB.contact.findMany()).toEqual([]);
    expect(await tenantB.contact.findUnique({ where: { id: contact.id } })).toBeNull();

    await expect(
      tenantB.contact.create({
        data: { id: newId('contact'), organizationId: orgA, workspaceId: wsA, email: 'evil@x.com' },
      }),
    ).rejects.toThrowError();
  });

  it('enforces email uniqueness per workspace', async () => {
    const tenantA = forTenant(app, orgA);
    await expect(
      tenantA.contact.create({
        data: { id: newId('contact'), organizationId: orgA, workspaceId: wsA, email: 'a@x.com' },
      }),
    ).rejects.toThrowError(/unique/i);
  });

  it('isolates lists and cascades membership on contact deletion', async () => {
    const tenantA = forTenant(app, orgA);
    const list = await tenantA.contactList.create({
      data: { id: newId('list'), organizationId: orgA, workspaceId: wsA, name: 'VIP' },
    });
    const contact = await tenantA.contact.create({
      data: { id: newId('contact'), organizationId: orgA, workspaceId: wsA, email: 'vip@x.com' },
    });
    await tenantA.contactListMember.create({
      data: { listId: list.id, contactId: contact.id, organizationId: orgA },
    });

    expect(await forTenant(app, orgB).contactList.findMany()).toEqual([]);

    await tenantA.contact.delete({ where: { id: contact.id } });
    expect(await tenantA.contactListMember.count({ where: { listId: list.id } })).toBe(0);
  });
});
