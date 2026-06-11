import { describe, expect, it } from 'vitest';

import { healthPayload, helioCommit, helioVersion, isNewerHelioVersion } from '../src/version';

describe('helioVersion', () => {
  it('reports the baked release version without a v prefix', () => {
    expect(helioVersion({ HELIO_VERSION: 'v2.0.0' })).toBe('2.0.0');
    expect(helioVersion({ HELIO_VERSION: '2.0.0-rc.1' })).toBe('2.0.0-rc.1');
  });

  it('falls back to dev when unset or blank', () => {
    expect(helioVersion({})).toBe('dev');
    expect(helioVersion({ HELIO_VERSION: '  ' })).toBe('dev');
  });
});

describe('helioCommit', () => {
  it('truncates to a short hash and is null outside release builds', () => {
    expect(helioCommit({ HELIO_COMMIT: 'abcdef0123456789abcdef0123456789abcdef01' })).toBe(
      'abcdef012345',
    );
    expect(helioCommit({})).toBeNull();
  });
});

describe('isNewerHelioVersion', () => {
  it('orders plain releases numerically', () => {
    expect(isNewerHelioVersion('2.0.0', '1.9.9')).toBe(true);
    expect(isNewerHelioVersion('1.10.0', '1.9.0')).toBe(true);
    expect(isNewerHelioVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerHelioVersion('1.0.0', '2.0.0')).toBe(false);
  });

  it('handles v prefixes and pre-releases', () => {
    expect(isNewerHelioVersion('v2.0.0', '1.0.0')).toBe(true);
    expect(isNewerHelioVersion('2.0.0', '2.0.0-rc.1')).toBe(true);
    expect(isNewerHelioVersion('2.0.0-rc.1', '2.0.0')).toBe(false);
    expect(isNewerHelioVersion('2.0.0-rc.10', '2.0.0-rc.2')).toBe(true);
  });

  it('never reports garbage as newer', () => {
    expect(isNewerHelioVersion('latest', '1.0.0')).toBe(false);
    expect(isNewerHelioVersion('2.0.0', 'dev')).toBe(false);
  });
});

describe('healthPayload', () => {
  it('is the shared liveness shape', () => {
    expect(healthPayload('api', { HELIO_VERSION: '2.0.0', HELIO_COMMIT: 'abc123def456' })).toEqual({
      status: 'ok',
      service: 'api',
      version: '2.0.0',
      commit: 'abc123def456',
    });
  });
});
