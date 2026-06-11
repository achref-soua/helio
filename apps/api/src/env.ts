import { createEnv } from '@helio/core';
import { z } from 'zod';

export const env = createEnv({
  API_PORT: z.coerce.number().int().default(4000),
  // RLS-bound runtime connection — same role the dashboard uses.
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  RATE_LIMIT_MAX: z.coerce.number().int().default(100),
  RATE_LIMIT_WINDOW_S: z.coerce.number().int().default(60),
  // Shared secret on the bounce/complaint webhook URL (?token=…). The
  // endpoint is disabled (404) until set.
  EMAIL_WEBHOOK_TOKEN: z.string().default(''),
});

export type Env = typeof env;
