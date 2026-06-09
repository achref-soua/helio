import { hashGatewayApiKey, parseGatewayApiKey } from '@helio/core';
import { forTenant } from '@helio/db';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

import type { GatewayDeps, GatewayEnv } from '../types';

/**
 * Per-organization API key authentication. The key embeds its org
 * (`hk_<orgId>.<secret>`), so we set that org's RLS context first and look
 * the key up through the unprivileged app role — the gateway never needs an
 * admin connection. The lookup is by the hash of the whole presented key, so
 * a tampered org segment yields a different hash and no match; RLS is a
 * second wall, scoping the lookup to the claimed org. On success the verified
 * org is put on the context for handlers to scope by.
 */
export function apiKeyAuth(deps: GatewayDeps) {
  return createMiddleware<GatewayEnv>(async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const parsed = token ? parseGatewayApiKey(token) : null;
    if (!parsed) {
      throw new HTTPException(401, { message: 'invalid or missing API key' });
    }

    const tenantDb = forTenant(deps.prisma, parsed.organizationId);
    const keyHash = await hashGatewayApiKey(token);
    const key = await tenantDb.gatewayApiKey.findUnique({
      where: { keyHash },
      select: { id: true },
    });
    if (!key) {
      throw new HTTPException(401, { message: 'invalid or missing API key' });
    }

    c.set('organizationId', parsed.organizationId);
    // Best-effort last-used stamp; never block the request on it.
    void tenantDb.gatewayApiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
    await next();
  });
}
