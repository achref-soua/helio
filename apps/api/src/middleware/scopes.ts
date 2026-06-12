import { type ApiScope, scopeAllows } from '@helio/core';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { GatewayEnv } from '../types';

/**
 * Per-handler scope check (M2). Explicit at the top of every handler so a
 * reader sees the grant a route needs without tracing middleware chains.
 */
export function assertScope(c: Context<GatewayEnv>, needed: ApiScope): void {
  if (!scopeAllows(c.get('scopes') ?? [], needed)) {
    throw new HTTPException(403, { message: `API key is missing the ${needed} scope` });
  }
}
