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
  // Seals per-org provider credentials at rest (base64 of 32 bytes; the
  // installer generates it). The vault is disabled until set. During a
  // key rotation the previous key stays readable via _PREVIOUS.
  HELIO_ENCRYPTION_KEY: z.string().optional(),
  HELIO_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  // Analytics reads (full profile); callers degrade gracefully without it.
  CLICKHOUSE_URL: z.string().min(1).default('http://localhost:8123'),
  CLICKHOUSE_USER: z.string().min(1).default('helio'),
  CLICKHOUSE_PASSWORD: z.string().min(1).default('helio_dev_password'),
  CLICKHOUSE_DB: z.string().min(1).default('helio'),
  // The intelligence service (AI copilot). The BFF authenticates the user
  // and forwards the verified org/workspace; this is the only caller.
  INTELLIGENCE_URL: z.string().min(1).default('http://localhost:8000'),
  // Per-replica abuse damping on the public, unauthenticated endpoints
  // (forms, booking, widget/in-app delivery, SCIM). Disable for load tests.
  PUBLIC_RATE_LIMITS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});
