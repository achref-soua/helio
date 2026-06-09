import { describe, expect, it } from 'vitest';

import { SUPPORT_KINDS, supportKindSchema, supportStatusSchema } from '../src/support';

describe('support schemas', () => {
  it('accept the known vocabularies and reject anything else', () => {
    for (const kind of SUPPORT_KINDS) expect(supportKindSchema.parse(kind)).toBe(kind);
    expect(supportKindSchema.safeParse('COMPLAINT').success).toBe(false);
    expect(supportStatusSchema.parse('RESOLVED')).toBe('RESOLVED');
    expect(supportStatusSchema.safeParse('PENDING').success).toBe(false);
  });
});
