import { describe, expect, it } from 'vitest';

import {
  generateGatewayApiKey,
  hashGatewayApiKey,
  parseGatewayApiKey,
  scopeAllows,
} from '../src/gateway-keys';

describe('generateGatewayApiKey', () => {
  it('mints an org-bound key whose hash is stable', async () => {
    const org = 'org_01jx3ye5k8f5rv9t6n0c2qme7a';
    const { key, keyHash, prefix } = await generateGatewayApiKey(org);
    expect(key.startsWith(`hk_${org}.`)).toBe(true);
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashGatewayApiKey(key)).toBe(keyHash);
    expect(prefix.startsWith(`hk_${org}.`)).toBe(true);
    expect(prefix.length).toBeLessThan(key.length);
  });

  it('produces distinct secrets and hashes', async () => {
    const a = await generateGatewayApiKey('org_a');
    const b = await generateGatewayApiKey('org_a');
    expect(a.key).not.toBe(b.key);
    expect(a.keyHash).not.toBe(b.keyHash);
  });
});

describe('parseGatewayApiKey', () => {
  it('extracts the claimed org id, including underscored ids', () => {
    expect(parseGatewayApiKey('hk_org_01jx3ye5.c2VjcmV0')).toEqual({
      organizationId: 'org_01jx3ye5',
    });
  });

  it('rejects malformed keys', () => {
    expect(parseGatewayApiKey('nope_org.secret')).toBeNull();
    expect(parseGatewayApiKey('hk_orgwithoutdot')).toBeNull();
    expect(parseGatewayApiKey('hk_.secret')).toBeNull();
    expect(parseGatewayApiKey('hk_org.')).toBeNull();
    expect(parseGatewayApiKey('')).toBeNull();
  });

  it('round-trips a freshly generated key', async () => {
    const { key } = await generateGatewayApiKey('org_round_trip');
    expect(parseGatewayApiKey(key)).toEqual({ organizationId: 'org_round_trip' });
  });
});

describe('API key scopes', () => {
  it('star grants everything; write implies read; read never implies write', () => {
    expect(scopeAllows(['*'], 'contacts:write')).toBe(true);
    expect(scopeAllows(['contacts:write'], 'contacts:read')).toBe(true);
    expect(scopeAllows(['contacts:read'], 'contacts:write')).toBe(false);
    expect(scopeAllows(['lists:read'], 'contacts:read')).toBe(false);
    expect(scopeAllows([], 'workspaces:read')).toBe(false);
  });
});
