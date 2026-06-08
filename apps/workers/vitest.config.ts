import { createVitestConfig } from '@helio/config/vitest';

export default createVitestConfig({
  test: {
    // Workflow tests download a Temporal test server on first run;
    // activity tests run against a disposable Postgres container.
    testTimeout: 240_000,
    hookTimeout: 300_000,
    coverage: {
      // workflows.ts runs inside Temporal's sandboxed VM where v8 cannot
      // instrument it — the workflow tests cover it behaviorally.
      // email-provider's SMTP class is nodemailer glue, exercised against
      // Mailpit in dev; the in-memory double drives the activity tests.
      exclude: [
        'src/worker.ts',
        'src/env.ts',
        'src/workflows.ts',
        'src/journey-workflows.ts',
        'src/email-provider.ts',
        'src/trigger-consumer.ts',
      ],
    },
  },
});
