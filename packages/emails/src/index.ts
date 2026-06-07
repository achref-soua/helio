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
  const document = options.contact ? personalizeDocument(parsed, options.contact) : parsed;
  const subject = options.contact
    ? renderTokens(options.subject ?? '', options.contact)
    : (options.subject ?? '');

  const element = BlockEmail({
    document,
    previewText: firstParagraph(document),
    unsubscribeUrl: options.unsubscribeUrl,
    footerText: options.footerText,
  });

  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}

function firstParagraph(document: EmailDocument): string | undefined {
  for (const block of document.blocks) {
    if (block.type === 'paragraph' && block.text.trim()) return block.text.slice(0, 90);
  }
  return undefined;
}

export { BlockEmail } from './block-email';
