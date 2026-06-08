import {
  type EmailDocument,
  emailDocumentSchema,
  type PersonalizationContact,
  renderTokens,
} from '@helio/core';
import { render } from '@react-email/render';

import { BlockEmail } from './block-email';

export interface RenderEmailOptions {
  document: EmailDocument;
  /** When set, `{{token}}`s in text, urls, and the subject are substituted. */
  contact?: PersonalizationContact;
  subject?: string;
  unsubscribeUrl?: string;
  footerText?: string;
  /** Open-tracking pixel URL appended to the body. */
  pixelUrl?: string;
  /** Rewrites click-through targets (button links) for tracking. */
  wrapLink?: (url: string) => Promise<string>;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Apply personalization tokens across every text-bearing block field. */
function personalizeDocument(
  document: EmailDocument,
  contact: PersonalizationContact,
): EmailDocument {
  return {
    blocks: document.blocks.map((block) => {
      switch (block.type) {
        case 'heading':
        case 'paragraph':
          return { ...block, text: renderTokens(block.text, contact) };
        case 'button':
          return { ...block, label: renderTokens(block.label, contact) };
        case 'image':
          return { ...block, alt: renderTokens(block.alt, contact) };
        default:
          return block;
      }
    }),
  };
}

/**
 * Render a block document to inbox-ready HTML and a plain-text part.
 * Validates the document shape first — render paths never trust input.
 */
export async function renderEmail(options: RenderEmailOptions): Promise<RenderedEmail> {
  const parsed = emailDocumentSchema.parse(options.document);
  let document = options.contact ? personalizeDocument(parsed, options.contact) : parsed;
  if (options.wrapLink) document = await wrapDocumentLinks(document, options.wrapLink);
  const subject = options.contact
    ? renderTokens(options.subject ?? '', options.contact)
    : (options.subject ?? '');

  const element = BlockEmail({
    document,
    previewText: firstParagraph(document),
    unsubscribeUrl: options.unsubscribeUrl,
    footerText: options.footerText,
    pixelUrl: options.pixelUrl,
  });

  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}

/** Buttons are the click-through surface; images load, they aren't clicked. */
async function wrapDocumentLinks(
  document: EmailDocument,
  wrap: (url: string) => Promise<string>,
): Promise<EmailDocument> {
  return {
    blocks: await Promise.all(
      document.blocks.map(async (block) =>
        block.type === 'button' ? { ...block, url: await wrap(block.url) } : block,
      ),
    ),
  };
}

function firstParagraph(document: EmailDocument): string | undefined {
  for (const block of document.blocks) {
    if (block.type === 'paragraph' && block.text.trim()) return block.text.slice(0, 90);
  }
  return undefined;
}

export { BlockEmail } from './block-email';
