import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { defineConfig } from 'prisma/config';

// Prisma 7 no longer auto-loads .env — load the repo-root one when present
// so local CLI invocations (migrate/studio/seed) just work.
const repoRootEnv = path.resolve(import.meta.dirname, '../../.env');
if (fs.existsSync(repoRootEnv)) {
  process.loadEnvFile(repoRootEnv);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Migrate/Studio connect as the admin role (schema owner, bypasses RLS).
    // Runtime clients never use this URL — see src/client.ts.
    url: process.env.DATABASE_ADMIN_URL ?? '',
  },
});
