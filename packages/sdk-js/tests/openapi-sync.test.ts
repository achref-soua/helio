import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The REST client's types are generated from the gateway's OpenAPI document.
 * This guard fails if the committed `src/openapi.d.ts` drifts from the spec —
 * regenerate with `pnpm --filter @helio/sdk-js generate`.
 */
describe('openapi types', () => {
  it('committed openapi.d.ts matches the gateway spec', () => {
    const pkgDir = path.resolve(import.meta.dirname, '..');
    const committed = readFileSync(path.join(pkgDir, 'src/openapi.d.ts'), 'utf8');
    const regenerated = execSync('pnpm exec openapi-typescript ../../apps/api/openapi.json', {
      cwd: pkgDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    expect(regenerated.trim()).toBe(committed.trim());
  }, 30_000);
});
