import { createEnv } from '@helio/core';
import { z } from 'zod';

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
