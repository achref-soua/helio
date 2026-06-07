import { createVitestConfig } from '@helio/config/vitest';

export default createVitestConfig({
  test: {
    // Integration tests start a real Postgres container.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    coverage: {
      exclude: ['src/generated/**', 'prisma/**'],
    },
  },
});
