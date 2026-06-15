import { describe, expect, it } from 'vitest';

import {
  composeProfiles,
  envValue,
  IN_APP_UPDATE_OPT_OUT,
  IN_APP_UPDATE_PROFILE,
  reconcileInAppUpdate,
} from '../src/lib/envfile';

/**
 * `helio update`'s in-app-update self-heal. The bug it fixes: installs that
 * predate v2.0.4 (or took `--no-inapp-update`) never gained the secret, the
 * `update` profile, or the toggle, so the dashboard's Update button stayed off
 * forever. Reconciliation flips it on idempotently while keeping a durable
 * opt-out (`HELIO_INAPP_UPDATE=off`) respected.
 */

// A legacy install: the feature's keys arrived as template defaults on an
// earlier update, but the profile and toggle were never turned on.
const LEGACY = ['COMPOSE_PROFILES=core', 'HELIO_INAPP_UPDATE=false', 'APP_URL=http://x'].join('\n');

describe('reconcileInAppUpdate — self-heal', () => {
  it('enables a legacy install: toggle on, secret generated, profile added', () => {
    const result = reconcileInAppUpdate(LEGACY);
    expect(result.changed).toBe(true);
    expect(result.enabled).toBe(true);
    expect(result.optedOut).toBe(false);
    expect(envValue(result.content, 'HELIO_INAPP_UPDATE')).toBe('true');
    expect(envValue(result.content, 'HELIO_UPDATE_SECRET')).toMatch(/^[0-9a-f]{64}$/);
    expect(composeProfiles(result.content)).toContain(IN_APP_UPDATE_PROFILE);
    // Unrelated keys are left untouched.
    expect(envValue(result.content, 'APP_URL')).toBe('http://x');
  });

  it('keeps an existing secret rather than regenerating it', () => {
    const withSecret = `${LEGACY}\nHELIO_UPDATE_SECRET=deadbeef`;
    expect(envValue(reconcileInAppUpdate(withSecret).content, 'HELIO_UPDATE_SECRET')).toBe(
      'deadbeef',
    );
  });

  it('appends the toggle when the key is absent entirely', () => {
    const result = reconcileInAppUpdate('COMPOSE_PROFILES=full\n');
    expect(envValue(result.content, 'HELIO_INAPP_UPDATE')).toBe('true');
    expect(composeProfiles(result.content)).toEqual(['full', 'update']);
  });

  it('is a no-op on an already-wired install', () => {
    const wired = [
      'COMPOSE_PROFILES=core,update',
      'HELIO_INAPP_UPDATE=true',
      'HELIO_UPDATE_SECRET=abc123',
      '',
    ].join('\n');
    const result = reconcileInAppUpdate(wired);
    expect(result.changed).toBe(false);
    expect(result.enabled).toBe(true);
    expect(result.content).toBe(wired);
  });

  it('is idempotent: a second pass changes nothing', () => {
    const once = reconcileInAppUpdate(LEGACY).content;
    const twice = reconcileInAppUpdate(once);
    expect(twice.changed).toBe(false);
    expect(twice.content).toBe(once);
  });
});

describe('reconcileInAppUpdate — opt-out', () => {
  it('respects a durable opt-out (off) and does not re-enable', () => {
    const optedOut = ['COMPOSE_PROFILES=core', `HELIO_INAPP_UPDATE=${IN_APP_UPDATE_OPT_OUT}`].join(
      '\n',
    );
    const result = reconcileInAppUpdate(optedOut);
    expect(result.changed).toBe(false);
    expect(result.enabled).toBe(false);
    expect(result.optedOut).toBe(true);
    expect(composeProfiles(result.content)).not.toContain(IN_APP_UPDATE_PROFILE);
  });

  it('re-enables a durable opt-out when the user opts back in', () => {
    const optedOut = `HELIO_INAPP_UPDATE=${IN_APP_UPDATE_OPT_OUT}\nCOMPOSE_PROFILES=core\n`;
    const result = reconcileInAppUpdate(optedOut, { optIn: true });
    expect(result.enabled).toBe(true);
    expect(envValue(result.content, 'HELIO_INAPP_UPDATE')).toBe('true');
    expect(composeProfiles(result.content)).toContain(IN_APP_UPDATE_PROFILE);
  });

  it('records a durable opt-out and drops the sidecar profile', () => {
    const wired = 'COMPOSE_PROFILES=core,update\nHELIO_INAPP_UPDATE=true\n';
    const result = reconcileInAppUpdate(wired, { optOut: true });
    expect(result.changed).toBe(true);
    expect(result.enabled).toBe(false);
    expect(result.optedOut).toBe(true);
    expect(envValue(result.content, 'HELIO_INAPP_UPDATE')).toBe(IN_APP_UPDATE_OPT_OUT);
    expect(composeProfiles(result.content)).not.toContain(IN_APP_UPDATE_PROFILE);
  });
});
