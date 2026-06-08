import { createVitestConfig } from '@helio/config/vitest';

export default createVitestConfig({
  test: {
    coverage: {
      // The Kafka implementation is exercised end-to-end by the ingest
      // pipeline integration test against a real Redpanda container.
      exclude: ['src/kafka.ts'],
    },
  },
});
