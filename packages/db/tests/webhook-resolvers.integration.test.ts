import { execSync } from 'node:child_process';
import path from 'node:path';

import { newId } from '@helio/core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  activeContactsByEmailForWebhook,
  createPrismaClient,
  forTenant,
  type PrismaClient,
  shopifyConnectionForWebhook,
  stripeOrganizationForWebhook,
} from '../src/index';

/**
 * Regression coverage for ADR-0017: signature-authenticated webhooks must
 * resolve their tenant through the SECURITY DEFINER resolvers. A plain
 * table read on the app role matches nothing before a tenant context is
 * set — exactly the bug that silently no-oped the Stripe and Shopify
 * webhooks against a real database.
 */
describe('webhook tenant resolvers', () => {
  let container: StartedPostgreSqlContainer;
  let admin: PrismaClient;
  let app: PrismaClient;

  const org = { id: newId('org'), name: 'Resolver Org', slug: 'resolver-org' };
  const orgB = { id: newId('org'), name: 'Resolver Org B', slug: 'resolver-org-b' };
  const workspaceId = newId('ws');
  const workspaceB = newId('ws');
  const shopDomain = 'resolver-test.myshopify.com';
  const stripeCustomerId = 'cus_resolver_test';
  const sharedEmail = 'bounced@example.com';
  const contactA = newId('contact');
  const contactB = newId('contact');

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

    await admin.organization.create({ data: org });
    await admin.workspace.create({
      data: { id: workspaceId, organizationId: org.id, name: 'Main', slug: 'main' },
    });
    await admin.integration.create({
      data: {
        id: newId('intg'),
        organizationId: org.id,
        workspaceId,
        provider: 'SHOPIFY',
        externalId: shopDomain,
        secret: 'shpss_secret',
      },
    });
    await admin.subscription.create({
      data: {
        id: newId('sub'),
        organizationId: org.id,
        plan: 'PRO',
        stripeCustomerId,
      },
    });

    // The same address lives in two tenants; a third contact is already
    // suppressed and must not resurface through the resolver.
    await admin.organization.create({ data: orgB });
    await admin.workspace.create({
      data: { id: workspaceB, organizationId: orgB.id, name: 'B Main', slug: 'main' },
    });
    await admin.contact.createMany({
      data: [
        { id: contactA, organizationId: org.id, workspaceId, email: sharedEmail },
        { id: contactB, organizationId: orgB.id, workspaceId: workspaceB, email: sharedEmail },
        {
          id: newId('contact'),
          organizationId: org.id,
          workspaceId,
          email: 'gone@example.com',
          status: 'UNSUBSCRIBED',
        },
      ],
    });
  });

  afterAll(async () => {
    await admin?.$disconnect();
    await app?.$disconnect();
    await container?.stop();
  });

  it('plain app-role reads match nothing before a tenant context exists — the bug', async () => {
    expect(
      await app.integration.findFirst({ where: { provider: 'SHOPIFY', externalId: shopDomain } }),
    ).toBeNull();
    expect(await app.subscription.findFirst({ where: { stripeCustomerId } })).toBeNull();
  });

  it('resolves a Shopify shop domain to its connection on the app role', async () => {
    const connection = await shopifyConnectionForWebhook(app, shopDomain);
    expect(connection).toEqual({
      organizationId: org.id,
      workspaceId,
      secret: 'shpss_secret',
    });
  });

  it('answers null for an unknown or disabled shop', async () => {
    expect(await shopifyConnectionForWebhook(app, 'other.myshopify.com')).toBeNull();

    await admin.integration.updateMany({
      where: { externalId: shopDomain },
      data: { enabled: false },
    });
    expect(await shopifyConnectionForWebhook(app, shopDomain)).toBeNull();
    await admin.integration.updateMany({
      where: { externalId: shopDomain },
      data: { enabled: true },
    });
  });

  it('resolves a Stripe customer to its organization on the app role', async () => {
    expect(await stripeOrganizationForWebhook(app, stripeCustomerId)).toBe(org.id);
    expect(await stripeOrganizationForWebhook(app, 'cus_unknown')).toBeNull();
  });

  it('writes work under forTenant once the org is resolved', async () => {
    const orgId = await stripeOrganizationForWebhook(app, stripeCustomerId);
    const tenantDb = forTenant(app, orgId!);
    await tenantDb.subscription.update({
      where: { organizationId: orgId! },
      data: { status: 'active' },
    });
    const updated = await admin.subscription.findUnique({ where: { organizationId: org.id } });
    expect(updated?.status).toBe('active');
  });

  it('finds every ACTIVE contact holding an address, across tenants', async () => {
    const contacts = await activeContactsByEmailForWebhook(app, sharedEmail);
    expect(contacts.map((c) => c.id).sort()).toEqual([contactA, contactB].sort());
    expect(new Set(contacts.map((c) => c.organizationId))).toEqual(new Set([org.id, orgB.id]));
  });

  it('omits contacts that are already suppressed', async () => {
    expect(await activeContactsByEmailForWebhook(app, 'gone@example.com')).toEqual([]);
  });

  it('suppression writes flow per tenant after resolution', async () => {
    const contacts = await activeContactsByEmailForWebhook(app, sharedEmail);
    for (const contact of contacts) {
      await forTenant(app, contact.organizationId).contact.update({
        where: { id: contact.id },
        data: { status: 'BOUNCED' },
      });
    }
    const statuses = await admin.contact.findMany({
      where: { email: sharedEmail },
      select: { status: true },
    });
    expect(statuses.map((s) => s.status)).toEqual(['BOUNCED', 'BOUNCED']);
    // Suppressed contacts no longer resolve — the lookup is self-limiting.
    expect(await activeContactsByEmailForWebhook(app, sharedEmail)).toEqual([]);
  });

  it('the resolvers expose only their single lookup, not the tables', async () => {
    // The function is the escape hatch; direct table access stays sealed.
    expect(await app.integration.count()).toBe(0);
    expect(await app.subscription.count()).toBe(0);
    expect(await app.contact.count()).toBe(0);
  });
});
