import { createVitestConfig } from '@helio/config/vitest';

export default createVitestConfig({
  test: {
    environment: 'jsdom',
  },
});
