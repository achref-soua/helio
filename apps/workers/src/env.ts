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
  CLICKHOUSE_URL: z.string().min(1).default('http://localhost:8123'),
  CLICKHOUSE_USER: z.string().min(1).default('helio'),
  CLICKHOUSE_PASSWORD: z.string().min(1).default('helio_dev_password'),
  CLICKHOUSE_DB: z.string().min(1).default('helio'),
  EVENTS_TOPIC: z.string().min(1).default('helio.events.v1'),
  /** Optional HMAC key for journey webhook signatures (x-helio-signature). */
  WEBHOOK_SIGNING_SECRET: z.string().min(24).optional(),
  /** Opens per-org provider credentials (ADR-0019); absent → env providers. */
  HELIO_ENCRYPTION_KEY: z.string().optional(),
  HELIO_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  /** VAPID keys for Web Push; push nodes no-op when unset. */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:push@helio.local'),
  /** Twilio credentials for SMS; send_sms nodes no-op when unset. */
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  /** WhatsApp Cloud API; send_whatsapp nodes no-op when unset. */
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  /** Consume tracked events and enroll contacts into ACTIVE journeys. */
  JOURNEY_TRIGGERS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type Env = typeof env;
