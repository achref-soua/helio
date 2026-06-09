import { createFromSource } from 'fumadocs-core/search/server';

import { source } from '@/lib/source';

// Static, build-time search index over the documentation content.
export const { GET } = createFromSource(source, {
  language: 'english',
});
