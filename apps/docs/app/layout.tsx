import './global.css';

import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Absolute URLs in metadata need a base; set HELIO_DOCS_URL for the
// deployed site so OpenGraph, canonicals, and the sitemap resolve.
const SITE_URL = process.env.HELIO_DOCS_URL ?? 'https://helio.dev';
const DESCRIPTION =
  'Helio is the open-source, self-hostable, AI-native marketing-automation platform — a free alternative to HubSpot, Mautic, and Customer.io. CDP, segmentation, cross-channel journeys, email, and analytics, on a modern stack you own.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: '%s · Helio',
    default: 'Helio — the open-source marketing-automation platform',
  },
  description: DESCRIPTION,
  applicationName: 'Helio',
  keywords: [
    'Helio',
    'open-source marketing automation',
    'self-hosted marketing automation',
    'HubSpot alternative',
    'Mautic alternative',
    'Customer.io alternative',
    'customer data platform',
    'email marketing',
    'AI marketing automation',
  ],
  authors: [{ name: 'Achref Soua', url: 'https://github.com/achref-soua' }],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Helio',
    title: 'Helio — the open-source marketing-automation platform',
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Helio — the open-source marketing-automation platform',
    description: DESCRIPTION,
  },
};

/** Schema.org SoftwareApplication so search engines render a rich result
 *  for the project, linking the canonical repository. */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Helio',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Linux, macOS, Windows (Docker)',
  description: DESCRIPTION,
  url: SITE_URL,
  license: 'https://www.gnu.org/licenses/agpl-3.0.html',
  isAccessibleForFree: true,
  codeRepository: 'https://github.com/achref-soua/helio',
  author: { '@type': 'Person', name: 'Achref Soua', url: 'https://github.com/achref-soua' },
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <script
          type="application/ld+json"
          // Static, build-time JSON — no user input.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
