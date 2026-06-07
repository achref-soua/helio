import { defineConfig, mergeConfig } from 'vitest/config';

/** Coverage gate applied to every package. Raised as the codebase matures. */
export const COVERAGE_THRESHOLD = 70;

const baseConfig = defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: COVERAGE_THRESHOLD,
        functions: COVERAGE_THRESHOLD,
        branches: COVERAGE_THRESHOLD,
        statements: COVERAGE_THRESHOLD,
      },
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.config.*',
        '**/*.gen.ts',
        '**/*.stories.*',
        '**/tests/**',
      ],
    },
  },
});

/**
 * Create a package-level Vitest config that inherits the shared defaults.
 * @param {import('vitest/config').UserConfig} overrides
 */
export function createVitestConfig(overrides = {}) {
  return mergeConfig(baseConfig, defineConfig(overrides));
}

export default baseConfig;
