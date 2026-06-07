import { createEnv } from '@helio/core';
import { z } from 'zod';

/** Server-side environment for the dashboard. Fails fast at startup. */
export const env = createEnv({
  // Auth kernel connection — admin role; see ADR-0004. The auth layer
  // enforces membership itself; domain data access stays RLS-bound.
  DATABASE_ADMIN_URL: z.string().min(1),
  // Runtime (RLS-bound) connection used for all tenant-scoped domain data.
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  APP_URL: z.string().url().default('http://localhost:3000'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  MAIL_FROM: z.string().default('Helio <no-reply@helio.local>'),
  // Durable execution (campaign sends run on Temporal workers).
  TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
  // Verifies the stateless unsubscribe tokens minted by the senders.
  UNSUBSCRIBE_SECRET: z.string().min(24),
});
