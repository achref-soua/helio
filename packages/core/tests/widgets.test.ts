import { describe, expect, it } from 'vitest';

import { WIDGET_TYPES, widgetEmbedSnippet, widgetTypeSchema } from '../src/widgets';

describe('widget schema & embed', () => {
  it('accepts the known types and rejects others', () => {
    for (const type of WIDGET_TYPES) expect(widgetTypeSchema.parse(type)).toBe(type);
    expect(widgetTypeSchema.safeParse('MODAL').success).toBe(false);
  });

  it('builds the async embed snippet for a write key', () => {
    expect(widgetEmbedSnippet('https://app.helio.test/widget.js', 'wk_123')).toBe(
      '<script async src="https://app.helio.test/widget.js" data-write-key="wk_123"></script>',
    );
  });
});
