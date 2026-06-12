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

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Baseline CSP for the dashboard. Next injects inline bootstrap scripts and
 * Tailwind/Radix write inline styles, so both keep 'unsafe-inline'; dev
 * additionally needs eval and websockets for fast refresh. The email editor
 * previews rendered templates in a same-origin srcdoc iframe, and org
 * branding logos may live on any https host.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Only meaningful (and only honored by browsers) over TLS.
  ...(process.env.APP_URL?.startsWith('https://')
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

// Hosted forms, booking pages, and landing pages are made to be embedded
// in customers' sites; everything else refuses framing.
const embeddableHeaders = securityHeaders.map((header) =>
  header.key === 'Content-Security-Policy'
    ? {
        key: header.key,
        value: contentSecurityPolicy.replace("frame-ancestors 'none'", 'frame-ancestors *'),
      }
    : header,
);

const nextConfig: NextConfig = {
  // Self-contained server output for the Docker image.
  output: 'standalone',
  // The dev-mode overlay badge is cosmetic tooling; hiding it keeps
  // generated screenshots and the demo video clean. No production effect.
  devIndicators: false,
  transpilePackages: ['@helio/ui', '@helio/core'],
  async headers() {
    // Later sources win on key collisions, so the embeddable routes only
    // override the frame-ancestors policy.
    return [
      { source: '/(.*)', headers: securityHeaders },
      { source: '/f/:path*', headers: embeddableHeaders },
      { source: '/m/:path*', headers: embeddableHeaders },
      { source: '/p/:path*', headers: embeddableHeaders },
    ];
  },
};

export default withNextIntl(nextConfig);
