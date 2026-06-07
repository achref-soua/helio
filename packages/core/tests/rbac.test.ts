import { describe, expect, it } from 'vitest';

import { hasRole, INVITABLE_ROLES, isRole, ROLES } from '../src/rbac';

describe('rbac', () => {
  it('orders roles by privilege', () => {
    expect(hasRole('owner', 'viewer')).toBe(true);
    expect(hasRole('owner', 'owner')).toBe(true);
    expect(hasRole('admin', 'editor')).toBe(true);
    expect(hasRole('editor', 'admin')).toBe(false);
    expect(hasRole('viewer', 'editor')).toBe(false);
  });

  it('rejects unknown role strings', () => {
    expect(hasRole('superuser', 'viewer')).toBe(false);
    expect(hasRole('', 'viewer')).toBe(false);
    expect(isRole('member')).toBe(false);
    expect(isRole('owner')).toBe(true);
  });

  it('never allows inviting an owner', () => {
    expect(INVITABLE_ROLES).not.toContain('owner');
    for (const role of INVITABLE_ROLES) expect(ROLES).toContain(role);
  });
});
