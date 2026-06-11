import { decryptField } from '@helio/core';

import { env } from '@/lib/env';

/**
 * Open one sealed field of a vault credential, server-side only. Returns
 * undefined when the credential, the field, or the deployment key is
 * missing — callers treat that as "no secret configured", and the value
 * never leaves the server.
 */
export async function decryptCredentialField(
  ctx: {
    organizationId: string;
    tenantDb: {
      providerCredential: {
        findUnique: (args: {
          where: { id: string };
          select: { id: true; secrets: true };
        }) => Promise<{ id: string; secrets: unknown } | null>;
      };
    };
  },
  credentialId: string,
  field: string,
): Promise<string | undefined> {
  if (!env.HELIO_ENCRYPTION_KEY) return undefined;
  const row = await ctx.tenantDb.providerCredential.findUnique({
    where: { id: credentialId },
    select: { id: true, secrets: true },
  });
  const envelope = (row?.secrets as Record<string, string> | null)?.[field];
  if (!envelope) return undefined;
  try {
    return await decryptField(
      envelope,
      { organizationId: ctx.organizationId, credentialId, field },
      env.HELIO_ENCRYPTION_KEY,
      env.HELIO_ENCRYPTION_KEY_PREVIOUS,
    );
  } catch {
    return undefined;
  }
}
