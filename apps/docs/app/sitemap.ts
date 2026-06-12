import type { MetadataRoute } from 'next';

import { source } from '@/lib/source';

const SITE_URL = process.env.HELIO_DOCS_URL ?? 'https://helio.dev';

/** Every documentation page, so search engines crawl the whole tree. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL.replace(/\/$/, '');
  const pages = source.getPages().map((page) => ({
    url: `${base}${page.url}`,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));
  return [{ url: base, changeFrequency: 'weekly', priority: 1 }, ...pages];
}
