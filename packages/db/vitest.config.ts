import { createVitestConfig } from '@helio/config/vitest';

export default createVitestConfig({
  test: {
    // Integration tests start a real Postgres container.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    coverage: {
      // seed-demo is operator tooling, exercised by running the seed itself.
      exclude: ['src/generated/**', 'src/seed-demo.ts', 'prisma/**'],
    },
  },
});
