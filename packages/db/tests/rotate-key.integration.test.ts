import { execSync } from 'node:child_process';
import path from 'node:path';

import { decryptField, encryptField, generateEncryptionKey, isEnvelope, newId } from '@helio/core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { rotateEncryptionKey } from '../scripts/rotate-encryption-key';
import { createPrismaClient, type PrismaClient } from '../src/index';

/**
 * The key-rotation walk against a real database: sealed values under the
 * old key get re-sealed under the new one, legacy plaintext secrets get
 * sealed, and a second run is a no-op.
 */
describe('rotate-encryption-key', () => {
  let container: StartedPostgreSqlContainer;
  let admin: PrismaClient;

  const oldKey = generateEncryptionKey();
  const newKey = generateEncryptionKey();
  const orgId = newId('org');
  const credId = newId('cred');
  const intgId = newId('intg');
  const domId = newId('dom');

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('helio_rotate_test')
      .start();
    const adminUrl = container.getConnectionUri();
    execSync('pnpm exec prisma migrate deploy', {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl },
      stdio: 'pipe',
    });
    admin = createPrismaClient(adminUrl);

    await admin.organization.create({ data: { id: orgId, name: 'Rotate Org', slug: 'rotate' } });
    const wsId = newId('ws');
    await admin.workspace.create({
      data: { id: wsId, organizationId: orgId, name: 'Main', slug: 'main' },
    });
    await admin.providerCredential.create({
      data: {
        id: credId,
        organizationId: orgId,
        kind: 'EMAIL_POSTMARK',
        name: 'Prod',
        config: { fromEmail: 'a@b.test' },
        secrets: {
          serverToken: await encryptField(
            'pm-token',
            { organizationId: orgId, credentialId: credId, field: 'serverToken' },
            oldKey,
          ),
        },
        secretsMeta: { serverToken: { last4: 'oken', setAt: new Date().toISOString() } },
      },
    });
    // A pre-vault integration: plaintext signing secret.
    await admin.integration.create({
      data: {
        id: intgId,
        organizationId: orgId,
        workspaceId: wsId,
        provider: 'SHOPIFY',
        externalId: 'rotate.myshopify.com',
        secret: 'shpss_plaintext_legacy',
      },
    });
    await admin.sendingDomain.create({
      data: {
        id: domId,
        organizationId: orgId,
        workspaceId: wsId,
        domain: 'rotate.test',
        dkimSelector: 'helio',
        dkimPublicKey: 'pub',
        dkimPrivateKey: '-----BEGIN PRIVATE KEY----- legacy',
      },
    });
  }, 120_000);

  afterAll(async () => {
    await admin?.$disconnect();
    await container?.stop();
  });

  it('re-seals old-key envelopes and seals legacy plaintext', async () => {
    const summary = await rotateEncryptionKey(admin, { activeKey: newKey, previousKey: oldKey });
    expect(summary).toEqual({ credentials: 1, integrations: 1, sendingDomains: 1 });

    const credential = await admin.providerCredential.findUniqueOrThrow({
      where: { id: credId },
    });
    const sealed = (credential.secrets as Record<string, string>).serverToken!;
    await expect(
      decryptField(
        sealed,
        { organizationId: orgId, credentialId: credId, field: 'serverToken' },
        newKey,
      ),
    ).resolves.toBe('pm-token');

    const integration = await admin.integration.findUniqueOrThrow({ where: { id: intgId } });
    expect(isEnvelope(integration.secret)).toBe(true);
    await expect(
      decryptField(
        integration.secret!,
        { organizationId: orgId, credentialId: intgId, field: 'secret' },
        newKey,
      ),
    ).resolves.toBe('shpss_plaintext_legacy');

    const domain = await admin.sendingDomain.findUniqueOrThrow({ where: { id: domId } });
    expect(isEnvelope(domain.dkimPrivateKey)).toBe(true);

    // Second run: everything already under the active key.
    const again = await rotateEncryptionKey(admin, { activeKey: newKey, previousKey: oldKey });
    expect(again).toEqual({ credentials: 0, integrations: 0, sendingDomains: 0 });
  });
});
