import { generateScimToken, newId } from '@helio/core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { auth, authDb } from '@/lib/auth';
import { env } from '@/lib/env';

import { orgProcedure, requirePermission, router } from '../init';

/** Base URL an IdP points SCIM at, e.g. https://app/scim/v2. */
function scimBaseUrl(): string {
  return `${env.APP_URL}/scim/v2`;
}

const endpoint = z.string().url();

/**
 * Registration accepts the common case (issuer + client credentials, with
 * the IdP's endpoints auto-discovered) and an advanced case for IdPs without
 * a discovery document: provide all three endpoints to skip discovery.
 */
const registerInput = z
  .object({
    providerId: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and hyphens.'),
    domain: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-z0-9.-]+$/i, 'Enter a bare domain, e.g. acme.com.'),
    issuer: z.string().url(),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    authorizationEndpoint: endpoint.optional(),
    tokenEndpoint: endpoint.optional(),
    jwksEndpoint: endpoint.optional(),
  })
  .refine(
    (v) => {
      const manual = [v.authorizationEndpoint, v.tokenEndpoint, v.jwksEndpoint];
      // All-or-nothing: rely on discovery, or pin the full endpoint set.
      return manual.every(Boolean) || manual.every((e) => !e);
    },
    {
      message: 'Provide all three endpoints, or leave them blank to use discovery.',
      path: ['authorizationEndpoint'],
    },
  );

/** Where the IdP must send users back — shown so admins can configure it. */
function callbackUrl(providerId: string): string {
  return `${env.APP_URL}/api/auth/sso/callback/${providerId}`;
}

/**
 * Enterprise single sign-on administration. Providers are bound to the
 * caller's active organization, which the BFF supplies — never the client —
 * so an admin can only ever configure SSO for their own org. Reads go
 * through the admin client and deliberately omit `oidc_config`, which holds
 * the OIDC client secret (also walled off from the RLS role at the database;
 * see ADR-0013).
 */
export const ssoRouter = router({
  list: orgProcedure.query(async ({ ctx }) => {
    requirePermission(ctx.memberRole, 'settings:sso');
    const providers = await authDb.ssoProvider.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, providerId: true, issuer: true, domain: true },
      orderBy: { domain: 'asc' },
    });
    return providers.map((p) => ({ ...p, callbackUrl: callbackUrl(p.providerId) }));
  }),

  register: orgProcedure.input(registerInput).mutation(async ({ ctx, input }) => {
    requirePermission(ctx.memberRole, 'settings:sso');
    const manual = Boolean(input.authorizationEndpoint);
    try {
      await auth.api.registerSSOProvider({
        headers: ctx.headers,
        body: {
          providerId: input.providerId,
          issuer: input.issuer,
          domain: input.domain,
          // Bind to the verified active org — never a client-supplied id.
          organizationId: ctx.organizationId,
          oidcConfig: {
            clientId: input.clientId,
            clientSecret: input.clientSecret,
            scopes: ['openid', 'email', 'profile'],
            ...(manual
              ? {
                  skipDiscovery: true,
                  authorizationEndpoint: input.authorizationEndpoint,
                  tokenEndpoint: input.tokenEndpoint,
                  jwksEndpoint: input.jwksEndpoint,
                }
              : {}),
          },
        },
      });
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Could not register the SSO provider.',
      });
    }
    return { providerId: input.providerId, callbackUrl: callbackUrl(input.providerId) };
  }),

  remove: orgProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requirePermission(ctx.memberRole, 'settings:sso');
      // Scope the delete to the active org: a foreign id removes nothing.
      const { count } = await authDb.ssoProvider.deleteMany({
        where: { id: input.id, organizationId: ctx.organizationId },
      });
      if (count === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),

  // ── SCIM provisioning token (one per org) ──────────────────────────────

  scimStatus: orgProcedure.query(async ({ ctx }) => {
    requirePermission(ctx.memberRole, 'settings:sso');
    const token = await authDb.scimToken.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { createdAt: true, lastUsedAt: true },
    });
    return {
      configured: Boolean(token),
      createdAt: token?.createdAt ?? null,
      lastUsedAt: token?.lastUsedAt ?? null,
      baseUrl: scimBaseUrl(),
    };
  }),

  generateScimToken: orgProcedure.mutation(async ({ ctx }) => {
    requirePermission(ctx.memberRole, 'settings:sso');
    const { token, hash } = await generateScimToken();
    // One token per org: regenerating replaces (and invalidates) the old one.
    await authDb.scimToken.upsert({
      where: { organizationId: ctx.organizationId },
      create: { id: newId('scim'), organizationId: ctx.organizationId, tokenHash: hash },
      update: { tokenHash: hash, lastUsedAt: null },
    });
    // The plaintext is returned exactly once; only its hash is stored.
    return { token, baseUrl: scimBaseUrl() };
  }),

  revokeScimToken: orgProcedure.mutation(async ({ ctx }) => {
    requirePermission(ctx.memberRole, 'settings:sso');
    await authDb.scimToken.deleteMany({ where: { organizationId: ctx.organizationId } });
    return { ok: true };
  }),
});
