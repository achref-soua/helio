import type { EmailDocument } from '@helio/core';
import { describe, expect, it } from 'vitest';

import { renderEmail } from '../src/index';

const document: EmailDocument = {
  blocks: [
    { id: 'b1', type: 'heading', text: 'Hello {{firstName|there}}' },
    { id: 'b2', type: 'paragraph', text: 'Your plan: {{attributes.plan|free}}.' },
    { id: 'b3', type: 'button', label: 'Open dashboard', url: 'https://app.example.com/welcome' },
    { id: 'b4', type: 'divider' },
    { id: 'b5', type: 'image', url: 'https://cdn.example.com/hero.png', alt: 'Hero' },
  ],
};

describe('renderEmail', () => {
  it('renders HTML and plain text with personalization', async () => {
    const result = await renderEmail({
      document,
      subject: 'Welcome, {{firstName}}!',
      contact: { email: 'ada@example.com', firstName: 'Ada', attributes: { plan: 'pro' } },
      unsubscribeUrl: 'https://app.example.com/u/token',
      footerText: 'Acme Inc., 1 Main St',
    });

    expect(result.subject).toBe('Welcome, Ada!');
    expect(result.html).toContain('Hello Ada');
    expect(result.html).toContain('Your plan: pro.');
    expect(result.html).toContain('https://app.example.com/welcome');
    expect(result.html).toContain('https://cdn.example.com/hero.png');
    expect(result.html).toContain('https://app.example.com/u/token');
    expect(result.html).toContain('Unsubscribe');
    expect(result.html).toContain('Acme Inc., 1 Main St');

    expect(result.text).toContain('HELLO ADA');
    expect(result.text).toContain('https://app.example.com/welcome');
  });

  it('uses fallbacks without a contact value and renders without one at all', async () => {
    const personalized = await renderEmail({
      document,
      subject: 'Hi',
      contact: { email: 'x@example.com' },
    });
    expect(personalized.html).toContain('Hello there');
    expect(personalized.html).toContain('Your plan: free.');

    const raw = await renderEmail({ document, subject: 'Hi {{firstName}}' });
    expect(raw.subject).toBe('Hi {{firstName}}'); // untouched without a contact
    expect(raw.html).toContain('Hello {{firstName|there}}');
  });

  it('rejects invalid documents', async () => {
    await expect(
      renderEmail({ document: { blocks: [] } as unknown as EmailDocument }),
    ).rejects.toThrowError();
  });

  it('derives the preview text from the first paragraph', async () => {
    const result = await renderEmail({ document, subject: 's' });
    expect(result.html).toContain('Your plan: {{attributes.plan|free}}.'.slice(0, 30));
  });
});

describe('renderEmail extras', () => {
  it('wraps button links and leaves other blocks untouched', async () => {
    const wrapped = await renderEmail({
      document,
      subject: 's',
      wrapLink: (url) => Promise.resolve(`https://track.test/c?u=${encodeURIComponent(url)}`),
    });
    expect(wrapped.html).toContain(
      'https://track.test/c?u=https%3A%2F%2Fapp.example.com%2Fwelcome',
    );
    // The image URL is not a click surface — passes through verbatim.
    expect(wrapped.html).toContain('https://cdn.example.com/hero.png');
  });

  it('embeds the open pixel when given a pixel URL', async () => {
    const result = await renderEmail({
      document,
      subject: 's',
      pixelUrl: 'https://track.test/o/snd_1.gif',
    });
    expect(result.html).toContain('https://track.test/o/snd_1.gif');
  });

  it('omits preview text when there is no paragraph block', async () => {
    const headingOnly = {
      blocks: [{ id: 'h', type: 'heading' as const, text: 'Just a heading' }],
    };
    const result = await renderEmail({ document: headingOnly, subject: 's' });
    expect(result.html).toContain('Just a heading');
    expect(result.text).toContain('JUST A HEADING');
  });
});
