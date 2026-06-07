import path from 'node:path';

import { createVitestConfig } from '@helio/config/vitest';

export default createVitestConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    coverage: {
      exclude: [
        // Vendored shadcn/radix primitives: exercised via Storybook a11y
        // checks and app-level E2E, not unit-tested line by line.
        'src/components/ui/**',
        '.storybook/**',
        '**/*.stories.*',
      ],
    },
  },
});
