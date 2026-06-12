import { createVitestConfig } from '@helio/config/vitest';

export default createVitestConfig({
  test: {
    coverage: {
      // Command modules orchestrate docker/network side effects and are
      // exercised by the install-story E2E (plan §Verification); the pure
      // libraries under src/lib carry the unit coverage.
      exclude: ['src/main.ts', 'src/commands/**', 'src/lib/docker.ts', 'src/lib/ui.ts'],
    },
  },
});
