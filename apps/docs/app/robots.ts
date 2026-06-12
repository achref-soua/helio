import type { MetadataRoute } from 'next';

const SITE_URL = process.env.HELIO_DOCS_URL ?? 'https://helio.dev';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${SITE_URL.replace(/\/$/, '')}/sitemap.xml`,
  };
}
