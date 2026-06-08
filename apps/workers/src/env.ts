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
  TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
  /**
   * Admin connection: the send pipeline reads audiences across the
   * workspace and writes send rows; it is a trusted backend service
   * (see ADR-0010/0011).
   */
  DATABASE_ADMIN_URL: z.string().min(1),
  SMTP_HOST: z.string().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().min(3),
  APP_URL: z.string().url(),
  PUBLIC_TRACKING_URL: z.string().url(),
  TRACKING_SECRET: z.string().min(24),
  UNSUBSCRIBE_SECRET: z.string().min(24),
  KAFKA_BROKERS: z.string().min(1).default('localhost:19092'),
  EVENTS_TOPIC: z.string().min(1).default('helio.events.v1'),
  /** Consume tracked events and enroll contacts into ACTIVE journeys. */
  JOURNEY_TRIGGERS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type Env = typeof env;
