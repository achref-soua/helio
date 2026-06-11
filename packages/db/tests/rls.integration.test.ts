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

  it('CRM tasks are tenant-isolated', async () => {
    const tenantA = forTenant(app, orgA.id);
    const taskId = newId('task');
    await tenantA.task.create({
      data: {
        id: taskId,
        organizationId: orgA.id,
        workspaceId: workspaceA,
        title: 'Call the lead',
      },
    });

    // Org B sees none of it, even by direct id.
    const tenantB = forTenant(app, orgB.id);
    expect(await tenantB.task.count()).toBe(0);
    expect(await tenantB.task.findUnique({ where: { id: taskId } })).toBeNull();

    // Org B cannot smuggle a task into Org A.
    await expect(
      tenantB.task.create({
        data: {
          id: newId('task'),
          organizationId: orgA.id,
          workspaceId: workspaceA,
          title: 'Smuggled',
        },
      }),
    ).rejects.toThrowError(/row-level security|denied/i);

    expect(await tenantA.task.count()).toBe(1);
  });

  it('webhook endpoints (and their secrets) are tenant-isolated', async () => {
    const tenantA = forTenant(app, orgA.id);
    const endpointId = newId('whe');
    await tenantA.webhookEndpoint.create({
      data: {
        id: endpointId,
        organizationId: orgA.id,
        url: 'https://a.example/hook',
        secret: 'whsec_a',
        events: ['deal.won'],
      },
    });

    const tenantB = forTenant(app, orgB.id);
    expect(await tenantB.webhookEndpoint.count()).toBe(0);
    expect(await tenantB.webhookEndpoint.findUnique({ where: { id: endpointId } })).toBeNull();
    await expect(
      tenantB.webhookEndpoint.create({
        data: {
          id: newId('whe'),
          organizationId: orgA.id,
          url: 'https://b.example/hook',
          secret: 'whsec_b',
          events: ['deal.won'],
        },
      }),
    ).rejects.toThrowError(/row-level security|denied/i);

    expect(await tenantA.webhookEndpoint.count()).toBe(1);
  });

  it('scheduler booking pages and meetings are tenant-isolated', async () => {
    const tenantA = forTenant(app, orgA.id);
    const pageId = newId('bpg');
    await tenantA.bookingPage.create({
      data: { id: pageId, organizationId: orgA.id, workspaceId: workspaceA, title: 'Intro call' },
    });
    await tenantA.meeting.create({
      data: {
        id: newId('mtg'),
        organizationId: orgA.id,
        workspaceId: workspaceA,
        bookingPageId: pageId,
        startAt: new Date('2026-06-09T15:00:00Z'),
        durationMinutes: 30,
        inviteeEmail: 'invitee@example.com',
      },
    });

    const tenantB = forTenant(app, orgB.id);
    expect(await tenantB.bookingPage.count()).toBe(0);
    expect(await tenantB.meeting.count()).toBe(0);
    expect(await tenantB.bookingPage.findUnique({ where: { id: pageId } })).toBeNull();
    await expect(
      tenantB.meeting.create({
        data: {
          id: newId('mtg'),
          organizationId: orgA.id,
          workspaceId: workspaceA,
          bookingPageId: pageId,
          startAt: new Date('2026-06-10T15:00:00Z'),
          durationMinutes: 30,
          inviteeEmail: 'smuggled@example.com',
        },
      }),
    ).rejects.toThrowError(/row-level security|denied/i);

    expect(await tenantA.meeting.count()).toBe(1);
  });

  it('integrations (and their secrets) are tenant-isolated', async () => {
    const tenantA = forTenant(app, orgA.id);
    const integrationId = newId('intg');
    await tenantA.integration.create({
      data: {
        id: integrationId,
        organizationId: orgA.id,
        workspaceId: workspaceA,
        provider: 'SHOPIFY',
        externalId: 'a.myshopify.com',
        secret: 'shh',
      },
    });

    const tenantB = forTenant(app, orgB.id);
    expect(await tenantB.integration.count()).toBe(0);
    expect(await tenantB.integration.findUnique({ where: { id: integrationId } })).toBeNull();
    await expect(
      tenantB.integration.create({
        data: {
          id: newId('intg'),
          organizationId: orgA.id,
          workspaceId: workspaceA,
          provider: 'SALESFORCE',
          secret: 'token',
        },
      }),
    ).rejects.toThrowError(/row-level security|denied/i);

    expect(await tenantA.integration.count()).toBe(1);
  });

  it('support tickets are tenant-isolated', async () => {
    const tenantA = forTenant(app, orgA.id);
    const ticketId = newId('tkt');
    await tenantA.supportTicket.create({
      data: { id: ticketId, organizationId: orgA.id, subject: 'Broken', body: 'It broke' },
    });

    const tenantB = forTenant(app, orgB.id);
    expect(await tenantB.supportTicket.count()).toBe(0);
    expect(await tenantB.supportTicket.findUnique({ where: { id: ticketId } })).toBeNull();
    await expect(
      tenantB.supportTicket.create({
        data: { id: newId('tkt'), organizationId: orgA.id, subject: 'X', body: 'Y' },
      }),
    ).rejects.toThrowError(/row-level security|denied/i);

    expect(await tenantA.supportTicket.count()).toBe(1);
  });

  it('sending domains (and their DKIM private keys) are tenant-isolated', async () => {
    const tenantA = forTenant(app, orgA.id);
    const domainId = newId('dom');
    await tenantA.sendingDomain.create({
      data: {
        id: domainId,
        organizationId: orgA.id,
        workspaceId: workspaceA,
        domain: 'mail.a.example',
        dkimPublicKey: 'PUB',
        dkimPrivateKey: 'PRIV',
      },
    });

    const tenantB = forTenant(app, orgB.id);
    expect(await tenantB.sendingDomain.count()).toBe(0);
    expect(await tenantB.sendingDomain.findUnique({ where: { id: domainId } })).toBeNull();
    await expect(
      tenantB.sendingDomain.create({
        data: {
          id: newId('dom'),
          organizationId: orgA.id,
          workspaceId: workspaceA,
          domain: 'smuggled.example',
          dkimPublicKey: 'P',
          dkimPrivateKey: 'P',
        },
      }),
    ).rejects.toThrowError(/row-level security|denied/i);

    expect(await tenantA.sendingDomain.count()).toBe(1);
  });

  it('landing pages are tenant-isolated', async () => {
    const tenantA = forTenant(app, orgA.id);
    const pageId = newId('lp');
    await tenantA.landingPage.create({
      data: { id: pageId, organizationId: orgA.id, workspaceId: workspaceA, title: 'Launch' },
    });

    const tenantB = forTenant(app, orgB.id);
    expect(await tenantB.landingPage.count()).toBe(0);
    expect(await tenantB.landingPage.findUnique({ where: { id: pageId } })).toBeNull();
    await expect(
      tenantB.landingPage.create({
        data: { id: newId('lp'), organizationId: orgA.id, workspaceId: workspaceA, title: 'X' },
      }),
    ).rejects.toThrowError(/row-level security|denied/i);

    expect(await tenantA.landingPage.count()).toBe(1);
  });

  it('on-site widgets are tenant-isolated', async () => {
    const tenantA = forTenant(app, orgA.id);
    const widgetId = newId('wgt');
    await tenantA.widget.create({
      data: {
        id: widgetId,
        organizationId: orgA.id,
        workspaceId: workspaceA,
        name: 'Sale',
        title: '20% off',
        body: 'Today only',
      },
    });

    const tenantB = forTenant(app, orgB.id);
    expect(await tenantB.widget.count()).toBe(0);
    expect(await tenantB.widget.findUnique({ where: { id: widgetId } })).toBeNull();
    await expect(
      tenantB.widget.create({
        data: {
          id: newId('wgt'),
          organizationId: orgA.id,
          workspaceId: workspaceA,
          name: 'X',
          title: 'X',
          body: 'X',
        },
      }),
    ).rejects.toThrowError(/row-level security|denied/i);

    expect(await tenantA.widget.count()).toBe(1);
  });

  it('in-app messages are tenant-isolated', async () => {
    const tenantA = forTenant(app, orgA.id);
    const messageId = newId('iam');
    await tenantA.inAppMessage.create({
      data: {
        id: messageId,
        organizationId: orgA.id,
        workspaceId: workspaceA,
        name: 'Welcome',
        title: 'Welcome aboard',
        body: 'Glad you’re here',
      },
    });

    const tenantB = forTenant(app, orgB.id);
    expect(await tenantB.inAppMessage.count()).toBe(0);
    expect(await tenantB.inAppMessage.findUnique({ where: { id: messageId } })).toBeNull();
    await expect(
      tenantB.inAppMessage.create({
        data: {
          id: newId('iam'),
          organizationId: orgA.id,
          workspaceId: workspaceA,
          name: 'X',
          title: 'X',
          body: 'X',
        },
      }),
    ).rejects.toThrowError(/row-level security|denied/i);

    expect(await tenantA.inAppMessage.count()).toBe(1);
  });

  it('provider credentials are tenant-isolated', async () => {
    await forTenant(app, orgA.id).providerCredential.create({
      data: {
        id: newId('cred'),
        organizationId: orgA.id,
        kind: 'EMAIL_POSTMARK',
        name: 'Production',
        config: { fromEmail: 'hello@orga.test' },
        secrets: { serverToken: 'enc:v1:aabbccdd:stub:stub:stub' },
        secretsMeta: { serverToken: { last4: '1234', setAt: new Date().toISOString() } },
      },
    });
    expect(await forTenant(app, orgB.id).providerCredential.count()).toBe(0);
    const mine = await forTenant(app, orgA.id).providerCredential.findFirst({
      where: { kind: 'EMAIL_POSTMARK' },
    });
    expect(mine?.name).toBe('Production');
  });

  it('the SSO provider table is walled off from the RLS app role entirely', async () => {
    // SSO providers hold the OIDC client secret. Like the rest of the auth
    // domain the table is reached only through the admin client; the app
    // role's grant is revoked outright (not merely RLS-filtered), so it can
    // never read the secret even with a tenant context set.
    const userId = newId('user');
    await admin.user.create({
      data: { id: userId, name: 'IdP Admin', email: `idp-${userId}@example.com` },
    });
    await admin.ssoProvider.create({
      data: {
        id: newId('sso'),
        issuer: 'https://idp.example.com',
        domain: 'example.com',
        providerId: `okta-${userId}`,
        oidcConfig: JSON.stringify({ clientId: 'id', clientSecret: 'shh' }),
        userId,
        organizationId: orgA.id,
      },
    });

    // Revoked grant => hard permission error, with or without tenant context.
    await expect(app.ssoProvider.findMany()).rejects.toThrowError(/permission denied/i);
    await expect(forTenant(app, orgA.id).ssoProvider.findMany()).rejects.toThrowError(
      /permission denied/i,
    );

    // The admin client (auth kernel) still sees it.
    expect(await admin.ssoProvider.count({ where: { organizationId: orgA.id } })).toBe(1);
  });

  it('gateway API keys are tenant-isolated, even by their unique hash', async () => {
    // The gateway resolves a key under the org the key embeds; RLS ensures a
    // hash minted for one org can never be looked up under another.
    await forTenant(app, orgA.id).gatewayApiKey.create({
      data: {
        id: newId('gwk'),
        organizationId: orgA.id,
        name: 'CI',
        keyHash: 'a'.repeat(64),
        prefix: 'hk_a…',
      },
    });
    // Org B, even targeting the exact unique hash, sees nothing.
    expect(
      await forTenant(app, orgB.id).gatewayApiKey.findUnique({
        where: { keyHash: 'a'.repeat(64) },
      }),
    ).toBeNull();
    expect(await forTenant(app, orgA.id).gatewayApiKey.count()).toBe(1);
    // And cannot mint a key into org A.
    await expect(
      forTenant(app, orgB.id).gatewayApiKey.create({
        data: {
          id: newId('gwk'),
          organizationId: orgA.id,
          name: 'smuggled',
          keyHash: 'b'.repeat(64),
          prefix: 'hk_b…',
        },
      }),
    ).rejects.toThrowError(/row-level security|denied/i);
  });

  it('the SCIM token table is walled off from the RLS app role entirely', async () => {
    // SCIM tokens gate identity provisioning; the table is auth-domain and
    // its grant is revoked from the app role outright.
    await admin.scimToken.create({
      data: { id: newId('scim'), organizationId: orgA.id, tokenHash: 'deadbeef'.repeat(8) },
    });
    await expect(app.scimToken.findMany()).rejects.toThrowError(/permission denied/i);
    await expect(forTenant(app, orgA.id).scimToken.findMany()).rejects.toThrowError(
      /permission denied/i,
    );
    expect(await admin.scimToken.count({ where: { organizationId: orgA.id } })).toBe(1);
  });
});
