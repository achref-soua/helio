import { describe, expect, it } from 'vitest';

import {
  composeProfiles,
  envKeys,
  envValue,
  fillTemplate,
  mergeTemplate,
  setEnvValue,
  withComposeProfile,
} from '../src/lib/envfile';

const TEMPLATE = `# ── Datastores ──
POSTGRES_PASSWORD=__GENERATE_PASSWORD_PG__
HELIO_APP_DB_PASSWORD=__GENERATE_PASSWORD_APP__
# The url embeds the SAME app password.
DATABASE_URL=postgresql://helio_app:__GENERATE_PASSWORD_APP__@postgres:5432/helio

# Session signing.
BETTER_AUTH_SECRET=__GENERATE_HEX32_AUTH__
HELIO_ENCRYPTION_KEY=__GENERATE_B64_VAULT__
VAPID_PUBLIC_KEY=__GENERATE_VAPID_PUBLIC__
VAPID_PRIVATE_KEY=__GENERATE_VAPID_PRIVATE__
APP_URL=http://localhost:3000
`;

describe('fillTemplate', () => {
  it('fills every marker and repeats values for a shared name', () => {
    const { content } = fillTemplate(TEMPLATE);
    expect(content).not.toContain('__GENERATE_');
    const appPassword = envValue(content, 'HELIO_APP_DB_PASSWORD')!;
    expect(envValue(content, 'DATABASE_URL')).toContain(`helio_app:${appPassword}@`);
    expect(envValue(content, 'POSTGRES_PASSWORD')).not.toBe(appPassword);
    expect(envValue(content, 'BETTER_AUTH_SECRET')).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(envValue(content, 'HELIO_ENCRYPTION_KEY')!, 'base64')).toHaveLength(32);
  });

  it('generates the vapid keys as one pair', () => {
    const { content } = fillTemplate(TEMPLATE);
    const publicKey = Buffer.from(envValue(content, 'VAPID_PUBLIC_KEY')!, 'base64url');
    expect(publicKey[0]).toBe(0x04);
    expect(envValue(content, 'VAPID_PRIVATE_KEY')).toBeTruthy();
  });

  it('rejects unknown marker kinds loudly', () => {
    expect(() => fillTemplate('X=__GENERATE_ROT13_X__')).toThrowError(/unknown secret marker/);
  });
});

describe('mergeTemplate', () => {
  it('keeps the existing file byte-identical and appends only new keys', () => {
    const existing = 'BETTER_AUTH_SECRET=user-edited\nAPP_URL=https://crm.acme.com\n';
    const { content, added } = mergeTemplate(existing, TEMPLATE, 'v2.1.0');
    expect(content.startsWith(existing)).toBe(true);
    expect(added).toContain('HELIO_ENCRYPTION_KEY');
    expect(added).not.toContain('APP_URL');
    expect(envValue(content, 'BETTER_AUTH_SECRET')).toBe('user-edited');
    expect(content).toContain('Added by helio update (v2.1.0)');
    // A new key arrives with the comment documenting it; a skipped key's
    // comment ("# Session signing." above BETTER_AUTH_SECRET) does not.
    expect(content).toContain('# The url embeds the SAME app password.');
    expect(content).not.toContain('# Session signing.');
    expect(content).not.toContain('__GENERATE_');
  });

  it('is a no-op when nothing is new', () => {
    const { content } = fillTemplate(TEMPLATE);
    const merged = mergeTemplate(content, TEMPLATE, 'v2.1.0');
    expect(merged.added).toEqual([]);
    expect(merged.content).toBe(content);
  });
});

describe('envKeys', () => {
  it('lists defined keys, ignoring comments', () => {
    expect([...envKeys('# A=1\nA=2\nB=3\n')]).toEqual(['A', 'B']);
  });
});

describe('mergeTemplate (new required keys self-heal)', () => {
  it('adds a brand-new required secret key with a generated value', () => {
    const existing = 'APP_URL=https://crm.acme.com\n';
    const template = `${existing}HELIO_UPDATE_SECRET=__GENERATE_HEX32_UPDATE__\n`;
    const { content, added } = mergeTemplate(existing, template, 'v2.0.7');
    expect(added).toEqual(['HELIO_UPDATE_SECRET']);
    expect(envValue(content, 'HELIO_UPDATE_SECRET')).toMatch(/^[0-9a-f]{64}$/);
    expect(envValue(content, 'APP_URL')).toBe('https://crm.acme.com');
  });
});

describe('setEnvValue', () => {
  it('replaces an existing definition in place, leaving the rest byte-identical', () => {
    const { content, changed } = setEnvValue('A=1\nB=2\nC=3\n', 'B', '9');
    expect(content).toBe('A=1\nB=9\nC=3\n');
    expect(changed).toBe(true);
  });

  it('is a no-op when the value already matches', () => {
    const before = 'A=1\nB=2\n';
    const { content, changed } = setEnvValue(before, 'B', '2');
    expect(content).toBe(before);
    expect(changed).toBe(false);
  });

  it('appends a missing key under a single trailing newline', () => {
    expect(setEnvValue('A=1\n', 'B', '2').content).toBe('A=1\nB=2\n');
    expect(setEnvValue('A=1', 'B', '2').content).toBe('A=1\nB=2\n');
  });
});

describe('composeProfiles', () => {
  it('defaults to core when unset', () => {
    expect(composeProfiles('A=1\n')).toEqual(['core']);
  });

  it('parses and trims a comma list', () => {
    expect(composeProfiles('COMPOSE_PROFILES=core, update ,full\n')).toEqual([
      'core',
      'update',
      'full',
    ]);
  });
});

describe('withComposeProfile', () => {
  it('adds a profile that is missing', () => {
    const { content, changed } = withComposeProfile('COMPOSE_PROFILES=core\n', 'update', true);
    expect(composeProfiles(content)).toEqual(['core', 'update']);
    expect(changed).toBe(true);
  });

  it('is a no-op when adding one already present', () => {
    const before = 'COMPOSE_PROFILES=core,update\n';
    expect(withComposeProfile(before, 'update', true)).toEqual({ content: before, changed: false });
  });

  it('removes a profile that is present', () => {
    const { content, changed } = withComposeProfile(
      'COMPOSE_PROFILES=core,update\n',
      'update',
      false,
    );
    expect(composeProfiles(content)).toEqual(['core']);
    expect(changed).toBe(true);
  });

  it('is a no-op when removing one that is absent', () => {
    const before = 'COMPOSE_PROFILES=core\n';
    expect(withComposeProfile(before, 'update', false)).toEqual({
      content: before,
      changed: false,
    });
  });
});
