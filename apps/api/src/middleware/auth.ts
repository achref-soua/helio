import { timingSafeEqual } from 'node:crypto';

import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Bearer auth against the bootstrap service token (Phase 0 surface). */
export function bearerAuth(expectedToken: string) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !safeEqual(token, expectedToken)) {
      throw new HTTPException(401, { message: 'invalid or missing bearer token' });
    }
    await next();
  });
}
