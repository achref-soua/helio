// Explicit import: consumers compile this file under varying JSX
// transforms (Next/Vite use automatic; tsx may use classic).
import type { EmailDocument } from '@helio/core';
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

export interface BlockEmailProps {
  document: EmailDocument;
  /** First ~90 chars shown by inbox clients next to the subject. */
  previewText?: string;
  /** Rendered in the footer; legally required for marketing mail. */
  unsubscribeUrl?: string;
  footerText?: string;
  /** Open-tracking pixel, appended after the footer when set. */
  pixelUrl?: string;
}

const styles = {
  body: { backgroundColor: '#f5f5f4', fontFamily: 'Helvetica, Arial, sans-serif' },
  container: {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    margin: '24px auto',
    padding: '32px',
    maxWidth: '600px',
  },
  heading: { fontSize: '24px', lineHeight: '32px', color: '#1c1917', margin: '0 0 16px' },
  paragraph: { fontSize: '15px', lineHeight: '24px', color: '#44403c', margin: '0 0 16px' },
  button: {
    backgroundColor: '#1c1917',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '15px',
    padding: '12px 20px',
    textDecoration: 'none',
  },
  divider: { borderColor: '#e7e5e4', margin: '24px 0' },
  footer: { fontSize: '12px', lineHeight: '20px', color: '#a8a29e', margin: '24px 0 0' },
  image: { borderRadius: '6px', maxWidth: '100%' },
} as const;

/** The single Phase 1 layout: a centered card over a neutral background. */
export function BlockEmail({
  document,
  previewText,
  unsubscribeUrl,
  footerText,
  pixelUrl,
}: BlockEmailProps) {
  return (
    <Html lang="en">
      <Head />
      {previewText ? <Preview>{previewText}</Preview> : null}
      <Body style={styles.body}>
        <Container style={styles.container}>
          {document.blocks.map((block) => {
            switch (block.type) {
              case 'heading':
                return (
                  <Heading key={block.id} as="h1" style={styles.heading}>
                    {block.text}
                  </Heading>
                );
              case 'paragraph':
                return (
                  <Text key={block.id} style={styles.paragraph}>
                    {block.text}
                  </Text>
                );
              case 'button':
                return (
                  <Section key={block.id} style={{ margin: '0 0 16px' }}>
                    <Button href={block.url} style={styles.button}>
                      {block.label}
                    </Button>
                  </Section>
                );
              case 'image':
                return <Img key={block.id} src={block.url} alt={block.alt} style={styles.image} />;
              case 'divider':
                return <Hr key={block.id} style={styles.divider} />;
              case 'spacer':
                return <Section key={block.id} style={{ height: '24px' }} />;
            }
          })}
          {(footerText || unsubscribeUrl) && (
            <Text style={styles.footer}>
              {footerText}
              {footerText && unsubscribeUrl ? ' · ' : ''}
              {unsubscribeUrl ? (
                <Link href={unsubscribeUrl} style={{ color: '#a8a29e' }}>
                  Unsubscribe
                </Link>
              ) : null}
            </Text>
          )}
          {pixelUrl ? (
            <Img src={pixelUrl} alt="" width={1} height={1} style={{ display: 'block' }} />
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}
