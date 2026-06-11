import { describe, expect, it } from 'vitest';

import {
  can,
  minimumRoleFor,
  type Permission,
  permissionMatrix,
  PERMISSIONS,
  permissionsForRole,
} from '../src/permissions';

describe('the permission matrix', () => {
  it('owners can do everything, and only owners reach backups', () => {
    for (const permission of PERMISSIONS) {
      expect(can('owner', permission)).toBe(true);
    }
    expect(can('admin', 'admin:backups')).toBe(false);
    expect(minimumRoleFor('admin:backups')).toBe('owner');
  });

  it('admins hold every editor permission plus configuration', () => {
    const editor = new Set(permissionsForRole('editor'));
    for (const permission of permissionsForRole('admin')) {
      if (editor.has(permission)) continue;
      expect(minimumRoleFor(permission)).toBe('admin');
    }
    expect(can('admin', 'settings:credentials')).toBe(true);
    expect(can('editor', 'settings:credentials')).toBe(false);
  });

  it('viewers hold no mutating permissions at all', () => {
    expect(permissionsForRole('viewer')).toEqual([]);
  });

  it('editors run content, not configuration', () => {
    expect(can('editor', 'campaigns:manage')).toBe(true);
    expect(can('editor', 'journeys:manage')).toBe(true);
    expect(can('editor', 'admin:audit')).toBe(false);
  });

  it('unknown role strings never pass', () => {
    expect(can('superuser', 'contacts:write')).toBe(false);
    expect(can('', 'admin:backups')).toBe(false);
  });

  it('the matrix is monotone: each role keeps everything below it', () => {
    const matrix = permissionMatrix();
    const order = ['viewer', 'editor', 'admin', 'owner'] as const;
    for (let i = 1; i < order.length; i += 1) {
      const below = new Set<Permission>(matrix[order[i - 1]!]);
      for (const permission of below) {
        expect(matrix[order[i]!]).toContain(permission);
      }
    }
  });
});
