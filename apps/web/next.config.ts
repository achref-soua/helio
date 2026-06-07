import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // Self-contained server output for the Docker image.
  output: 'standalone',
  transpilePackages: ['@helio/ui', '@helio/core'],
};

export default withNextIntl(nextConfig);
