import { describe, expect, it } from 'vitest';

import { emailDocumentSchema, extractTokens, renderTokens } from '../src/email-doc';

describe('emailDocumentSchema', () => {
  it('accepts a document with every block type', () => {
    const result = emailDocumentSchema.safeParse({
      blocks: [
        { id: 'b1', type: 'heading', text: 'Hello {{firstName|there}}' },
        { id: 'b2', type: 'paragraph', text: 'Welcome to Helio.' },
        { id: 'b3', type: 'button', label: 'Open dashboard', url: 'https://app.example.com' },
        { id: 'b4', type: 'image', url: 'https://cdn.example.com/hero.png', alt: 'Hero' },
        { id: 'b5', type: 'divider' },
        { id: 'b6', type: 'spacer' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty documents, bad urls, and unknown block types', () => {
    expect(emailDocumentSchema.safeParse({ blocks: [] }).success).toBe(false);
    expect(
      emailDocumentSchema.safeParse({
        blocks: [{ id: 'b', type: 'button', label: 'x', url: 'not-a-url' }],
      }).success,
    ).toBe(false);
    expect(
      emailDocumentSchema.safeParse({ blocks: [{ id: 'b', type: 'video', url: 'https://x.test' }] })
        .success,
    ).toBe(false);
  });
});

describe('renderTokens', () => {
  const contact = {
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: null,
    attributes: { plan: 'pro' },
  };

  it('substitutes known tokens and attribute paths', () => {
    expect(renderTokens('Hi {{firstName}} ({{email}}), plan: {{attributes.plan}}', contact)).toBe(
      'Hi Ada (ada@example.com), plan: pro',
    );
  });

  it('uses fallbacks for missing values and empties unknown tokens', () => {
    expect(renderTokens('Hi {{lastName|friend}}!', contact)).toBe('Hi friend!');
    expect(renderTokens('Hi {{firstName|pal}}!', contact)).toBe('Hi Ada!');
    expect(renderTokens('{{attributes.tier|free}} / {{nonsense}}', contact)).toBe('free / ');
  });

  it('tolerates whitespace inside braces', () => {
    expect(renderTokens('Hi {{ firstName }}', contact)).toBe('Hi Ada');
  });
});

describe('extractTokens', () => {
  it('lists unique token paths', () => {
    expect(extractTokens('{{firstName}} {{firstName|x}} {{attributes.plan}} plain text')).toEqual([
      'firstName',
      'attributes.plan',
    ]);
  });
});
