import { createVitestConfig } from '@helio/config/vitest';

export default createVitestConfig({
  test: {
    coverage: {
      // bus.ts's Kafka producer is exercised end-to-end by the ingest
      // pipeline integration test; handlers here use the in-memory double.
      exclude: ['src/server.ts', 'src/observability.ts'],
    },
  },
});
