import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

import { createEnv } from '@helio/core';
import { z } from 'zod';

// Local dev convenience: the repo-root .env is the single config source.
// Containers get real env injected and ship no .env file — no-op there.
const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

export const env = createEnv({
  TRACKING_PORT: z.coerce.number().int().default(4200),
  /**
   * Admin connection: send-id resolution is a cross-tenant lookup
   * (send → workspace/contact). Single-table read; see ADR-0010.
   */
  DATABASE_ADMIN_URL: z.string().min(1),
  KAFKA_BROKERS: z.string().min(1).default('localhost:19092'),
  EVENTS_TOPIC: z.string().min(1).default('helio.events.v1'),
  /** [required] HMAC key binding click targets to their send. */
  TRACKING_SECRET: z.string().min(24),
});

export type Env = typeof env;
