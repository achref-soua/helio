import { createVitestConfig } from '@helio/config/vitest';

export default createVitestConfig({
  test: {
    // The pipeline test runs against disposable Redpanda + ClickHouse +
    // Postgres containers; first boot may pull images.
    testTimeout: 180_000,
    hookTimeout: 240_000,
    coverage: {
      exclude: ['src/server.ts', 'src/observability.ts', 'src/scripts/**'],
    },
  },
});
