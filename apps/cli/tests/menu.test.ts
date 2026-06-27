import '../src/commands/index';

import { describe, expect, it } from 'vitest';

import { menuItems } from '../src/commands/menu';
import { getCommand } from '../src/registry';

describe('wizard menu', () => {
  it('offers install (not operate) when nothing is installed', () => {
    const keys = menuItems(false).map((item) => item.key);
    expect(keys).toContain('install');
    expect(keys).not.toContain('uninstall');
    expect(keys).not.toContain('update');
  });

  it('offers the day-2 lifecycle once installed', () => {
    const keys = menuItems(true).map((item) => item.key);
    for (const key of ['up', 'down', 'status', 'update', 'backup', 'uninstall']) {
      expect(keys).toContain(key);
    }
    expect(keys).not.toContain('install');
  });

  // Guards against a menu entry that dispatches to a command that does not
  // exist (a typo would silently make a menu choice a no-op). `open` is the
  // one key handled inline by the wizard rather than the registry.
  it('every menu key resolves to a registered command (except open)', () => {
    const keys = [...menuItems(false), ...menuItems(true)].map((item) => item.key);
    for (const key of keys) {
      if (key === 'open') continue;
      expect(getCommand(key), `menu key "${key}" has no command`).toBeDefined();
    }
  });
});
