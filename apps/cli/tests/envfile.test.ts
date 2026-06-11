import { describe, expect, it } from 'vitest';

import { envKeys, envValue, fillTemplate, mergeTemplate } from '../src/lib/envfile';

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
