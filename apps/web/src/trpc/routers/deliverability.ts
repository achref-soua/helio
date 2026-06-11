import { generateKeyPairSync } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';

import { dkimPasses, dmarcPasses, isLikelyDomain, newId, spfPasses } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { sealRowSecret, vaultReady } from '@/lib/vault';

import { orgProcedure, requirePermission, router } from '../init';

/** An RSA-2048 DKIM key pair: a PEM private key and the base64 DER public key. */
function generateDkimKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

async function lookupTxt(host: string): Promise<string[]> {
  try {
    return (await resolveTxt(host)).map((chunks) => chunks.join(''));
  } catch {
    return [];
  }
}

/**
 * The deliverability wizard: manage sending domains, generate their DKIM keys,
 * and verify the published SPF/DKIM/DMARC records by DNS lookup. Workspace-
 * scoped through the tenant client; admin-gated.
 */
export const deliverabilityRouter = router({
  list: orgProcedure.input(z.object({ workspaceId: z.string().min(1) })).query(({ ctx, input }) =>
    ctx.tenantDb.sendingDomain.findMany({
      where: { workspaceId: input.workspaceId },
      // The DKIM private key is never selected back to the client.
      select: {
        id: true,
        domain: true,
        dkimSelector: true,
        dkimPublicKey: true,
        spfInclude: true,
        status: true,
        verifiedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ),

  add: orgProcedure
    .input(
      z.object({
        workspaceId: z.string().min(1),
        domain: z.string().trim().toLowerCase().refine(isLikelyDomain, 'Enter a valid domain'),
        spfInclude: z.string().trim().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:deliverability');
      const keys = generateDkimKeys();
      const id = newId('dom');
      // Seal the private key at rest when the vault is configured; rows
      // created before the vault existed stay readable via openRowSecret.
      const dkimPrivateKey = vaultReady()
        ? await sealRowSecret(ctx.organizationId, id, 'dkimPrivateKey', keys.privateKey)
        : keys.privateKey;
      try {
        const created = await ctx.tenantDb.sendingDomain.create({
          data: {
            id,
            organizationId: ctx.organizationId,
            workspaceId: input.workspaceId,
            domain: input.domain,
            dkimPublicKey: keys.publicKey,
            dkimPrivateKey,
            spfInclude: input.spfInclude || null,
          },
        });
        return { id: created.id };
      } catch {
        throw new TRPCError({ code: 'CONFLICT', message: 'That domain is already added' });
      }
    }),

  verify: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:deliverability');
      const domain = await ctx.tenantDb.sendingDomain.findUnique({ where: { id: input.id } });
      if (!domain) throw new TRPCError({ code: 'NOT_FOUND' });

      const [spfTxt, dkimTxt, dmarcTxt] = await Promise.all([
        lookupTxt(domain.domain),
        lookupTxt(`${domain.dkimSelector}._domainkey.${domain.domain}`),
        lookupTxt(`_dmarc.${domain.domain}`),
      ]);
      const checks = {
        SPF: spfPasses(spfTxt),
        DKIM: dkimPasses(dkimTxt, domain.dkimPublicKey),
        DMARC: dmarcPasses(dmarcTxt),
      };
      const verified = checks.SPF && checks.DKIM && checks.DMARC;
      await ctx.tenantDb.sendingDomain.update({
        where: { id: input.id },
        data: {
          status: verified ? 'VERIFIED' : 'PENDING',
          verifiedAt: verified ? new Date() : null,
        },
      });
      return { checks, verified };
    }),

  remove: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:deliverability');
      const { count } = await ctx.tenantDb.sendingDomain.deleteMany({ where: { id: input.id } });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),
});
