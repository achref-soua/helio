import { describe, expect, it } from 'vitest';

import eslintBase from '../eslint/base.mjs';
import eslintReact from '../eslint/react.mjs';
import prettierPreset from '../prettier/index.mjs';
import vitestBase, { COVERAGE_THRESHOLD, createVitestConfig } from '../vitest/base.mjs';

describe('@helio/config exports', () => {
  it('exposes a non-empty flat ESLint base config', () => {
    expect(Array.isArray(eslintBase)).toBe(true);
    expect(eslintBase.length).toBeGreaterThan(2);
  });

  it('react config extends the base config', () => {
    expect(eslintReact.length).toBeGreaterThan(eslintBase.length);
  });

  it('prettier preset pins the shared style', () => {
    expect(prettierPreset).toMatchObject({ singleQuote: true, printWidth: 100 });
  });

  it('vitest base enforces the coverage gate on every metric', () => {
    const { thresholds } = vitestBase.test.coverage;
    for (const metric of ['lines', 'functions', 'branches', 'statements']) {
      expect(thresholds[metric]).toBe(COVERAGE_THRESHOLD);
    }
  });

  it('createVitestConfig deep-merges package overrides without losing defaults', () => {
    const merged = createVitestConfig({ test: { environment: 'jsdom' } });
    expect(merged.test.environment).toBe('jsdom');
    expect(merged.test.coverage.thresholds.lines).toBe(COVERAGE_THRESHOLD);
  });
});
