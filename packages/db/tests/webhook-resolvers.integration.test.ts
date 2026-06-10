import { execSync } from 'node:child_process';
import path from 'node:path';

import { newId } from '@helio/core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
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
  const workspaceId = newId('ws');
  const shopDomain = 'resolver-test.myshopify.com';
  const stripeCustomerId = 'cus_resolver_test';

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

  it('the resolvers expose only their single lookup, not the tables', async () => {
    // The function is the escape hatch; direct table access stays sealed.
    expect(await app.integration.count()).toBe(0);
    expect(await app.subscription.count()).toBe(0);
  });
});
