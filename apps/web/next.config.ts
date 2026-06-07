import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Monorepo convention: one .env at the repo root for every service.
// loadEnvFile never overrides variables that are already set.
const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
if (existsSync(rootEnv)) {
  loadEnvFile(rootEnv);
}

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // Self-contained server output for the Docker image.
  output: 'standalone',
  transpilePackages: ['@helio/ui', '@helio/core'],
};

export default withNextIntl(nextConfig);
