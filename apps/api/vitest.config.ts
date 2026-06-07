import { createVitestConfig } from '@helio/config/vitest';

export default createVitestConfig({
  test: {
    // Contract tests run against a disposable Postgres container.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    coverage: {
      exclude: ['src/server.ts', 'src/scripts/**'],
    },
  },
});
