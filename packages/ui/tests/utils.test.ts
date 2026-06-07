import { describe, expect, it } from 'vitest';

import { cn } from '../src/lib/utils';

describe('cn', () => {
  it('joins class names and drops falsy values', () => {
    const include = Boolean(process.env.NEVER_SET);
    expect(cn('a', include && 'b', undefined, 'c')).toBe('a c');
  });

  it('resolves Tailwind conflicts in favor of the last class', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm text-muted-foreground', 'text-lg')).toBe('text-muted-foreground text-lg');
  });

  it('supports conditional objects', () => {
    expect(cn({ 'font-bold': true, italic: false }, 'underline')).toBe('font-bold underline');
  });
});
