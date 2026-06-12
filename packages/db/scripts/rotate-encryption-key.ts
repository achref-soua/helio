/* eslint-disable no-console -- operator-facing script */
import {
  type CredentialKind,
  credentialSpec,
  decryptField,
  encryptField,
  isEnvelope,
  keyFingerprint,
} from '@helio/core';

import { createPrismaClient, type PrismaClient } from '../src/client';

/**
 * The encryption-key rotation walk (ADR-0019). Runs on the ADMIN
 * connection (an explicit operator action, like migrations): every sealed
 * value whose fingerprint is not the active key's gets decrypted with the
 * previous key and re-sealed with the active one. Legacy plaintext
 * integration secrets and DKIM private keys are sealed on the way.
 *
 * Idempotent and resumable — a crash mid-walk leaves rows either old-key
 * (still readable while HELIO_ENCRYPTION_KEY_PREVIOUS is set) or new-key.
 *
 * Invocation (the helio CLI wraps this):
 *   DATABASE_ADMIN_URL=… HELIO_ENCRYPTION_KEY=… [HELIO_ENCRYPTION_KEY_PREVIOUS=…] \
 *     pnpm exec tsx scripts/rotate-encryption-key.ts
 */

export interface RotateSummary {
  credentials: number;
  integrations: number;
  sendingDomains: number;
}

export async function rotateEncryptionKey(
  prisma: PrismaClient,
  options: { activeKey: string; previousKey?: string },
): Promise<RotateSummary> {
  const activeFp = await keyFingerprint(options.activeKey);
  const summary: RotateSummary = { credentials: 0, integrations: 0, sendingDomains: 0 };

  const reseal = async (envelope: string, scope: Parameters<typeof decryptField>[1]) => {
    const plaintext = await decryptField(envelope, scope, options.activeKey, options.previousKey);
    return encryptField(plaintext, scope, options.activeKey);
  };

  // 1. Vault credentials: re-seal any field under a non-active fingerprint.
  const credentials = await prisma.providerCredential.findMany({
    select: { id: true, organizationId: true, kind: true, secrets: true },
  });
  for (const row of credentials) {
    const stored = (row.secrets ?? {}) as Record<string, string>;
    let changed = false;
    const next: Record<string, string> = { ...stored };
    for (const field of credentialSpec(row.kind as CredentialKind).secretFields) {
      const envelope = stored[field.name];
      if (!envelope || !isEnvelope(envelope)) continue;
      if (envelope.split(':')[2] === activeFp) continue;
      next[field.name] = await reseal(envelope, {
        organizationId: row.organizationId,
        credentialId: row.id,
        field: field.name,
      });
      changed = true;
    }
    if (changed) {
      // The masks (secretsMeta) describe the plaintext and survive rotation.
      await prisma.providerCredential.update({
        where: { id: row.id },
        data: { secrets: next },
      });
      summary.credentials += 1;
    }
  }

  // 2. Integration signing secrets: seal plaintext, re-seal old-key rows.
  const integrations = await prisma.integration.findMany({
    select: { id: true, organizationId: true, secret: true },
  });
  for (const row of integrations) {
    if (!row.secret) continue;
    const scope = { organizationId: row.organizationId, credentialId: row.id, field: 'secret' };
    let next: string | null = null;
    if (!isEnvelope(row.secret)) {
      next = await encryptField(row.secret, scope, options.activeKey);
    } else if (row.secret.split(':')[2] !== activeFp) {
      next = await reseal(row.secret, scope);
    }
    if (next) {
      await prisma.integration.update({ where: { id: row.id }, data: { secret: next } });
      summary.integrations += 1;
    }
  }

  // 3. DKIM private keys: same treatment.
  const domains = await prisma.sendingDomain.findMany({
    select: { id: true, organizationId: true, dkimPrivateKey: true },
  });
  for (const row of domains) {
    const scope = {
      organizationId: row.organizationId,
      credentialId: row.id,
      field: 'dkimPrivateKey',
    };
    let next: string | null = null;
    if (!isEnvelope(row.dkimPrivateKey)) {
      next = await encryptField(row.dkimPrivateKey, scope, options.activeKey);
    } else if (row.dkimPrivateKey.split(':')[2] !== activeFp) {
      next = await reseal(row.dkimPrivateKey, scope);
    }
    if (next) {
      await prisma.sendingDomain.update({
        where: { id: row.id },
        data: { dkimPrivateKey: next },
      });
      summary.sendingDomains += 1;
    }
  }

  return summary;
}

const invokedDirectly =
  process.argv[1]?.endsWith('rotate-encryption-key.ts') ||
  process.argv[1]?.endsWith('rotate-encryption-key.js');

if (invokedDirectly) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const activeKey = process.env.HELIO_ENCRYPTION_KEY;
  if (!adminUrl || !activeKey) {
    console.error('DATABASE_ADMIN_URL and HELIO_ENCRYPTION_KEY are required');
    process.exit(1);
  }
  const prisma = createPrismaClient(adminUrl);
  rotateEncryptionKey(prisma, {
    activeKey,
    previousKey: process.env.HELIO_ENCRYPTION_KEY_PREVIOUS || undefined,
  })
    .then(async (summary) => {
      console.log(
        `re-sealed ${summary.credentials} credentials, ${summary.integrations} integrations, ${summary.sendingDomains} sending domains`,
      );
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
