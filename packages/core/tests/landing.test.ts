import { describe, expect, it } from 'vitest';

import { emptyLandingBlock, LANDING_BLOCK_TYPES, landingDocumentSchema } from '../src/landing';

describe('landingDocumentSchema', () => {
  it('accepts a valid mixed document', () => {
    const doc = [
      { type: 'heading', text: 'Welcome' },
      { type: 'text', text: 'Some copy.' },
      { type: 'image', url: 'https://cdn.example.com/hero.png', alt: 'Hero' },
      { type: 'button', label: 'Start', href: 'https://acme.com/start' },
      { type: 'form', buttonLabel: 'Join' },
    ];
    expect(landingDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects bad blocks', () => {
    expect(landingDocumentSchema.safeParse([{ type: 'heading', text: '' }]).success).toBe(false);
    expect(landingDocumentSchema.safeParse([{ type: 'image', url: 'not-a-url' }]).success).toBe(
      false,
    );
    expect(landingDocumentSchema.safeParse([{ type: 'video' }]).success).toBe(false);
  });
});

describe('emptyLandingBlock', () => {
  it('produces a block of the requested type', () => {
    for (const type of LANDING_BLOCK_TYPES) {
      expect(emptyLandingBlock(type).type).toBe(type);
    }
    // Text-only defaults are immediately valid; image/button carry a
    // `https://` placeholder the operator must complete before saving.
    expect(landingDocumentSchema.safeParse([emptyLandingBlock('heading')]).success).toBe(true);
    expect(landingDocumentSchema.safeParse([emptyLandingBlock('form')]).success).toBe(true);
  });
});
