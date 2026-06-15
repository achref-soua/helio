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
  // The backups panel (Settings) — enabled in the self-host bundle, where
  // the sidecar's folder is mounted read-only at this path.
  BACKUPS_PANEL_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  HELIO_BACKUPS_PATH: z.string().default('/var/lib/helio/backups'),
  // One-click in-app updates (Settings → Updates). Enabled in the self-host
  // bundle's `update` profile, where the updater sidecar shares the
  // update-state volume mounted at HELIO_UPDATE_STATE_DIR. The secret
  // authorizes the dashboard's request to that sidecar. Only `true` enables it;
  // `false` (not configured) and `off` (durable opt-out, set by
  // `helio install/update --no-inapp-update`) both read as disabled.
  HELIO_INAPP_UPDATE: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  HELIO_UPDATE_SECRET: z.string().optional(),
  HELIO_UPDATE_STATE_DIR: z.string().default('/var/lib/helio/update-state'),
  // Analytics reads (full profile); callers degrade gracefully without it.
  CLICKHOUSE_URL: z.string().min(1).default('http://localhost:8123'),
  CLICKHOUSE_USER: z.string().min(1).default('helio'),
  CLICKHOUSE_PASSWORD: z.string().min(1).default('helio_dev_password'),
  CLICKHOUSE_DB: z.string().min(1).default('helio'),
  // The intelligence service (AI copilot). The BFF authenticates the user
  // and forwards the verified org/workspace; this is the only caller.
  INTELLIGENCE_URL: z.string().min(1).default('http://localhost:8000'),
  // Sibling services + stores for the admin health page (G5). HTTP ones
  // answer /healthz; Redis/Temporal get a TCP reachability probe.
  API_URL: z.string().min(1).default('http://localhost:4000'),
  INGEST_URL: z.string().min(1).default('http://localhost:4100'),
  TRACKING_URL: z.string().min(1).default('http://localhost:4200'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  // Self-hosted instances are invite-only once set up; flip to 'true' to
  // accept stranger signups (the dev default keeps local flows easy).
  ALLOW_PUBLIC_SIGNUP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  // The GitHub repo (`owner/name`) that in-app bug reports are filed to when an
  // org has not set its own. Defaults to the upstream repo.
  HELIO_SUPPORT_REPO: z.string().min(1).default('achref-soua/helio'),
  // Deployment-wide GitHub PAT (scope: issues) used to file in-app bug reports
  // as issues server-side when an org has not set its own under Settings →
  // Maintenance. Without any token, reports are delivered by email only.
  HELIO_SUPPORT_TOKEN: z.string().optional(),
  // Where in-app bug reports are emailed when an org has not set its own
  // recipient. Falls back to MAIL_FROM, so a report is never dropped (Mailpit
  // in dev).
  HELIO_SUPPORT_EMAIL: z.string().email().optional(),
  // Per-replica abuse damping on the public, unauthenticated endpoints
  // (forms, booking, widget/in-app delivery, SCIM). Disable for load tests.
  PUBLIC_RATE_LIMITS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});
