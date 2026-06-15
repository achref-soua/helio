import { describe, expect, it } from 'vitest';

import { SUPPORT_KINDS, supportKindSchema } from '../src/support';

describe('support schemas', () => {
  it('accept the known kinds and reject anything else', () => {
    for (const kind of SUPPORT_KINDS) expect(supportKindSchema.parse(kind)).toBe(kind);
    expect(supportKindSchema.safeParse('COMPLAINT').success).toBe(false);
  });
});
