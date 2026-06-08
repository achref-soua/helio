import { createVitestConfig } from '@helio/config/vitest';

export default createVitestConfig({
  test: {
    // Contract tests run against a disposable Postgres container.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    coverage: {
      // OTel tracing is dynamic-import glue that only runs with an OTLP
      // endpoint configured; exercised in deployment, not unit tests.
      exclude: ['src/server.ts', 'src/scripts/**', 'src/observability.ts'],
    },
  },
});
